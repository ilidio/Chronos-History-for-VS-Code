import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { HistoryStorage } from './storage';
import { HistoryManager } from './historyManager';
import { HistoryFilter } from './historyFilter';
import { HistoryViewProvider } from './views/historyWebview';
import { HistoryPanelProvider } from './views/historyPanelProvider';
import { GraphViewProvider } from './views/graphWebview';
import { DeletedFilesProvider, DeletedFileItem } from './views/deletedFilesProvider';
import { ActivityProvider } from './views/activityProvider';
import { HeatmapController } from './views/heatmapController';
import { DivergenceProvider } from './views/divergenceProvider';
import { GitService } from './git/gitService';
import { GitIgnoreService } from './git/gitIgnoreService';
import { AIService } from './ai/aiService';
import { BackupService } from './backup';
import { ProjectRestorer } from './timeTravel';
import { Snapshot, GitCommit } from './types';

let storage: HistoryStorage;
let manager: HistoryManager;
let historyFilter: HistoryFilter;
let viewProvider: HistoryViewProvider;
let panelProvider: HistoryPanelProvider;
let graphViewProvider: GraphViewProvider;
let deletedFilesProvider: DeletedFilesProvider;
let activityProvider: ActivityProvider;
let heatmapController: HeatmapController;
let divergenceProvider: DivergenceProvider;
let gitService: GitService;
let gitIgnoreService: GitIgnoreService;
let aiService: AIService;
let backupService: BackupService;
let projectRestorer: ProjectRestorer;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    try {
        outputChannel = vscode.window.createOutputChannel("Chronos Debug");
        context.subscriptions.push(outputChannel);
        outputChannel.appendLine('Activating Chronos History Extension...');

        storage = new HistoryStorage(context, outputChannel);
        viewProvider = new HistoryViewProvider(context.extensionUri, outputChannel);
        panelProvider = new HistoryPanelProvider(context.extensionUri);
        graphViewProvider = new GraphViewProvider(context.extensionUri);
        gitService = new GitService();
        aiService = new AIService();
        gitIgnoreService = new GitIgnoreService(outputChannel); // Instantiate GitIgnoreService
        
        manager = new HistoryManager(context, storage, gitService, gitIgnoreService); // Pass to HistoryManager
        
        historyFilter = new HistoryFilter(storage, gitService);
        deletedFilesProvider = new DeletedFilesProvider(manager, storage);
        activityProvider = new ActivityProvider(storage);
        heatmapController = new HeatmapController(gitService);
        divergenceProvider = new DivergenceProvider(gitService);
        backupService = new BackupService(storage);
        projectRestorer = new ProjectRestorer(storage, manager);

        vscode.window.registerTreeDataProvider('chronos.deletedFiles', deletedFilesProvider);
        vscode.window.registerTreeDataProvider('chronos.activity', activityProvider);
        vscode.window.registerWebviewViewProvider('chronos.historyPanel', panelProvider);

        context.subscriptions.push(
            heatmapController,
            divergenceProvider,
            vscode.commands.registerCommand('chronos.showHistory', showHistory),
            vscode.commands.registerCommand('chronos.showHistoryForSelection', showHistoryForSelection),
            vscode.commands.registerCommand('chronos.showProjectHistory', showProjectHistory),
            vscode.commands.registerCommand('chronos.showRecentChanges', showRecentChanges),
            vscode.commands.registerCommand('chronos.showGraph', showGraph),
            vscode.commands.registerCommand('chronos.toggleHeatmap', () => heatmapController.toggle()),
            vscode.commands.registerCommand('chronos.putLabel', putLabel),
            vscode.commands.registerCommand('chronos.compareToCurrent', compareToCurrent),
            vscode.commands.registerCommand('chronos.restoreSnapshot', restoreSnapshot),
            vscode.commands.registerCommand('chronos.restoreProject', () => projectRestorer.restoreProjectState()),
            vscode.commands.registerCommand('chronos.showBriefingForDate', () => {
                if (!aiService.isConfigured()) {
                    vscode.window.showWarningMessage("AI features require a Google Gemini API Key. Please add one in settings.", "Open Settings").then(action => {
                        if (action === "Open Settings") vscode.commands.executeCommand('workbench.action.openSettings', 'chronos.ai.apiKey');
                    });
                    return;
                }
                manager.showDailyBriefingForDate();
            }),
            vscode.commands.registerCommand('chronos.generateChangelog', () => {
                if (!aiService.isConfigured()) {
                    vscode.window.showWarningMessage("AI features require a Google Gemini API Key. Please add one in settings.", "Open Settings").then(action => {
                        if (action === "Open Settings") vscode.commands.executeCommand('workbench.action.openSettings', 'chronos.ai.apiKey');
                    });
                    return;
                }
                manager.generateChangelog();
            }),
            vscode.commands.registerCommand('chronos.compareTwoSnapshots', compareTwoSnapshots),
            vscode.commands.registerCommand('chronos.compareTwoCommits', compareTwoCommits),
            vscode.commands.registerCommand('chronos.compareWithActive', compareWithActive),
            vscode.commands.registerCommand('chronos.showGitHistory', showGitHistory),
            vscode.commands.registerCommand('chronos.gitHistoryForSelection', gitHistoryForSelection),
            vscode.commands.registerCommand('chronos.restoreDeletedFile', restoreDeletedFile),
            vscode.commands.registerCommand('chronos.previewDeletedFile', previewDeletedFile),
            vscode.commands.registerCommand('chronos.generateCommitMessage', generateAICommitMessage),
            vscode.commands.registerCommand('chronos.startExperiment', async () => {
                const name = await vscode.window.showInputBox({ prompt: 'Experiment Name' });
                if (name) await manager.startExperiment(name);
            }),
            vscode.commands.registerCommand('chronos.manageExperiment', async () => {
                const selection = await vscode.window.showQuickPick(['Keep Experiment', 'Discard Experiment'], { placeHolder: 'Manage active experiment' });
                if (selection === 'Keep Experiment') {
                    await manager.stopExperiment(true);
                } else if (selection === 'Discard Experiment') {
                    await manager.stopExperiment(false);
                }
            }),
            vscode.commands.registerCommand('_chronos.openDiff', openDiff),
            vscode.commands.registerCommand('_chronos.openDiffGit', openDiffGit),
            vscode.commands.registerCommand('_chronos.openDiffGitCurrent', openDiffGitCurrent),
            vscode.commands.registerCommand('_chronos.getDiffForSnapshot', async (s, path) => getDiffForSnapshot(s, path ? vscode.Uri.file(path) : undefined)),
            vscode.commands.registerCommand('_chronos.getDiffWithBranch', async (branch: string, filePath: string) => {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
                if (!workspaceFolder) return '';
                try {
                    const repoRoot = await gitService.getRepoRoot(workspaceFolder.uri.fsPath);
                    const canonicalPath = await gitService.getCanonicalPath(filePath);
                    const historicalContent = await gitService.getFileContentFromBranch(branch, canonicalPath, repoRoot);
                    const currentContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
                    
                    const ext = path.extname(filePath) || '.txt';
                    const branchSafe = branch.replace(/[\/\\]/g, '_');
                    const temp1 = await createTempFile(`branch_${branchSafe}_${path.basename(filePath)}${ext}`, historicalContent);
                    const temp2 = await createTempFile(`current_${path.basename(filePath)}${ext}`, currentContent);
                    
                    let diff = await gitService.getDiff(temp1.fsPath, temp2.fsPath);
                    // Standardize diff paths
                    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    diff = diff.replace(new RegExp(escapeRegex(temp1.fsPath), 'g'), `a/${branch}/${canonicalPath}`);
                    diff = diff.replace(new RegExp(escapeRegex(temp2.fsPath), 'g'), `b/current/${canonicalPath}`);
                    return diff;
                } catch (e) { 
                    outputChannel.appendLine(`Error getting diff with branch ${branch}: ${e}`);
                    return `Error calculating diff with branch ${branch}.`; 
                }
            }),
            vscode.commands.registerCommand('_chronos.getDiffTwoSnapshots', async (s1: Snapshot, s2: Snapshot) => {
                return await compareSnapshots(s1, s2);
            }),
            vscode.commands.registerCommand('_chronos.getDiffSnapshotWithBranch', async (snapshot: Snapshot, branch: string) => {
                const fileUri = resolveSnapshotUri(snapshot.filePath);
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
                if (!workspaceFolder) return '';
                try {
                    const repoRoot = await gitService.getRepoRoot(workspaceFolder.uri.fsPath);
                    const canonicalPath = await gitService.getCanonicalPath(fileUri.fsPath);
                    const branchContent = await gitService.getFileContentFromBranch(branch, canonicalPath, repoRoot);
                    const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
                    const snapshotContent = (await vscode.workspace.fs.readFile(snapshotUri)).toString();
                    
                    const branchSafe = branch.replace(/[\/\\]/g, '_');
                    const temp1 = await createTempFile(`snapshot_${snapshot.id.substring(0,8)}_${path.basename(snapshot.filePath)}`, snapshotContent);
                    const temp2 = await createTempFile(`branch_${branchSafe}_${path.basename(snapshot.filePath)}`, branchContent);
                    
                    let diff = await gitService.getDiff(temp1.fsPath, temp2.fsPath);
                    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    diff = diff.replace(new RegExp(escapeRegex(temp1.fsPath), 'g'), `a/snapshot/${snapshot.id.substring(0,8)}/${canonicalPath}`);
                    diff = diff.replace(new RegExp(escapeRegex(temp2.fsPath), 'g'), `b/branch/${branch}/${canonicalPath}`);
                    return diff;
                } catch (e) { return `Error: ${e}`; }
            }),
            vscode.commands.registerCommand('_chronos.getDiffCommitWithBranch', async (commit: GitCommit, branch: string, filePath: string) => {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
                if (!workspaceFolder) return '';
                try {
                    const repoRoot = await gitService.getRepoRoot(workspaceFolder.uri.fsPath);
                    const canonicalPath = await gitService.getCanonicalPath(filePath, commit.hash);
                    const branchContent = await gitService.getFileContentFromBranch(branch, canonicalPath, repoRoot);
                    const { stdout: commitContent } = await gitService.runGit(['show', `${commit.hash}:${canonicalPath}`], repoRoot);
                    
                    const branchSafe = branch.replace(/[\/\\]/g, '_');
                    const temp1 = await createTempFile(`commit_${commit.hash.substring(0,7)}_${path.basename(filePath)}`, commitContent);
                    const temp2 = await createTempFile(`branch_${branchSafe}_${path.basename(filePath)}`, branchContent);
                    
                    let diff = await gitService.getDiff(temp1.fsPath, temp2.fsPath);
                    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    diff = diff.replace(new RegExp(escapeRegex(temp1.fsPath), 'g'), `a/commit/${commit.hash.substring(0,7)}/${canonicalPath}`);
                    diff = diff.replace(new RegExp(escapeRegex(temp2.fsPath), 'g'), `b/branch/${branch}/${canonicalPath}`);
                    return diff;
                } catch (e) { return `Error: ${e}`; }
            }),
            vscode.commands.registerCommand('chronos.compareSnapshotWithBranch', async (snapshot: Snapshot, branchName: string) => {
                const fileUri = resolveSnapshotUri(snapshot.filePath);
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
                if (!workspaceFolder) return;
                try {
                    const repoRoot = await gitService.getRepoRoot(workspaceFolder.uri.fsPath);
                    const canonicalPath = await gitService.getCanonicalPath(fileUri.fsPath);
                    const branchContent = await gitService.getFileContentFromBranch(branchName, canonicalPath, repoRoot);
                    const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
                    const branchTemp = await createTempFile(`branch_${branchName.replace(/[\/\\]/g, '_')}_${path.basename(fileUri.fsPath)}`, branchContent);
                    const title = `${path.basename(fileUri.fsPath)} (Snapshot ${new Date(snapshot.timestamp).toLocaleString()}) ↔ (${branchName})`;
                    await vscode.commands.executeCommand('vscode.diff', snapshotUri, branchTemp, title);
                } catch (e) { vscode.window.showErrorMessage(`Failed: ${e}`); }
            }),
            vscode.commands.registerCommand('chronos.compareCommitWithBranch', async (commit: GitCommit, branchName: string, filePath: string) => {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
                if (!workspaceFolder) return;
                try {
                    const repoRoot = await gitService.getRepoRoot(workspaceFolder.uri.fsPath);
                    const canonicalPath = await gitService.getCanonicalPath(filePath, commit.hash);
                    const branchContent = await gitService.getFileContentFromBranch(branchName, canonicalPath, repoRoot);
                    const { stdout: commitContent } = await gitService.runGit(['show', `${commit.hash}:${canonicalPath}`], repoRoot);
                    const commitTemp = await createTempFile(`commit_${commit.hash.substring(0,7)}_${path.basename(filePath)}`, commitContent);
                    const branchTemp = await createTempFile(`branch_${branchName.replace(/[\/\\]/g, '_')}_${path.basename(filePath)}`, branchContent);
                    const title = `${path.basename(filePath)} (Commit ${commit.hash.substring(0,7)}) ↔ (${branchName})`;
                    await vscode.commands.executeCommand('vscode.diff', commitTemp, branchTemp, title);
                } catch (e) { vscode.window.showErrorMessage(`Failed: ${e}`); }
            }),
            vscode.commands.registerCommand('_chronos.getBranches', async (filePath?: string, filterByFile?: boolean) => {
                let workspaceFolder: vscode.WorkspaceFolder | undefined;
                
                if (filePath) {
                    workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
                }
                
                if (!workspaceFolder && vscode.window.activeTextEditor) {
                    workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
                }
                
                if (!workspaceFolder && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    workspaceFolder = vscode.workspace.workspaceFolders[0];
                }

                if (!workspaceFolder) return [];
                return await gitService.getBranches(workspaceFolder.uri.fsPath, filterByFile ? filePath : undefined);
            }),
            vscode.commands.registerCommand('chronos.compareWithBranch', compareWithBranch),
            vscode.commands.registerCommand('chronos.compareWithBranchVersion', compareWithBranchVersion),
            vscode.commands.registerCommand('_chronos.getGitDiff', async (commit, filePath) => {
                try {
                    // Try to get diff with full context
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
                    if (!workspaceFolder) return commit.diff || '';
                    const canonicalPath = await gitService.getCanonicalPath(filePath, commit.hash);
                    const { stdout } = await gitService.runGit(['show', '-U999999', '--pretty=format:', commit.hash, '--', canonicalPath], workspaceFolder.uri.fsPath);
                    return stdout;
                } catch (e) {
                    return commit.diff || '';
                }
            }),
            vscode.commands.registerCommand('_chronos.savePatch', async (diffText: string) => {
                await saveDiffAsPatch(diffText);
            }),
            vscode.commands.registerCommand('chronos.useSharedStorage', async () => {
                const home = os.homedir();
                const defaultPath = process.platform === 'win32' 
                    ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), '.chronos-history')
                    : path.join(home, '.chronos-history');
                    
                const config = vscode.workspace.getConfiguration('chronos');
                await config.update('customStoragePath', defaultPath, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Chronos: Global storage path set to ${defaultPath}`);
            }),
            vscode.commands.registerCommand('chronos.showLogs', () => outputChannel.show(true)),
            vscode.commands.registerCommand('chronos.runDiagnostics', runDiagnostics),
            vscode.commands.registerCommand('chronos.exportHistory', exportHistory),
            vscode.commands.registerCommand('chronos.importHistory', importHistory),
            vscode.commands.registerCommand('chronos.shareSnapshot', shareSnapshot),
            vscode.commands.registerCommand('chronos.importShared', importHistory),
            vscode.commands.registerCommand('chronos.explainSnapshot', (s) => explainSnapshot(s)),
            vscode.commands.registerCommand('chronos.explainCommit', (c) => explainGitCommit(c))
        );

        // Refresh views when files change
        context.subscriptions.push(
            vscode.workspace.onDidCreateFiles(() => {
                deletedFilesProvider.refresh();
                activityProvider.refresh();
            }),
            vscode.workspace.onDidDeleteFiles(() => {
                deletedFilesProvider.refresh();
                activityProvider.refresh();
            }),
            vscode.workspace.onDidSaveTextDocument(() => activityProvider.refresh())
        );

        storage.init().then(() => {
            if (vscode.workspace.getConfiguration('chronos').get('ai.dailyBriefing', true)) {
                manager.showDailyBriefing();
            }
        }).catch(err => {
            outputChannel.appendLine('Storage init failed: ' + err);
        });

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(async e => {
                if (e.affectsConfiguration('chronos.customStoragePath') || e.affectsConfiguration('chronos.saveInProjectFolder')) {
                    await storage.init();
                    outputChannel.appendLine('Storage configuration changed, re-initialized.');
                    // Refresh indices to ensure we see history from new location
                    activityProvider.refresh();
                }
            })
        );
    } catch (e) {
        vscode.window.showErrorMessage('Chronos Activation Failed: ' + e);
        console.error(e);
    }
}

async function generateAICommitMessage() {
    if (!aiService.isConfigured()) {
        const action = await vscode.window.showWarningMessage(
            "AI features require a Google Gemini API Key. Please add one in settings.",
            "Open Settings"
        );
        if (action === "Open Settings") {
            vscode.commands.executeCommand('workbench.action.openSettings', 'chronos.ai.apiKey');
        }
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing history for commit draft…",
        cancellable: false
    }, async () => {
        const message = await manager.generateCommitDraft();
        if (message) {
            const doc = await vscode.workspace.openTextDocument({ content: message, language: 'markdown' });
            await vscode.window.showTextDocument(doc);
        }
    });
}

async function createTempFile(name: string, content: string): Promise<vscode.Uri> {
    const tmpDir = path.join(os.tmpdir(), 'chronos_diff');
    try {
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
    } catch (e) {
        console.error('Failed to create temp directory:', e);
    }
    
    // Sanitize the name to ensure it doesn't try to create subdirectories
    const safeName = name.replace(/[\/\\]/g, '_');
    const filePath = path.join(tmpDir, safeName);
    
    try {
        fs.writeFileSync(filePath, content);
    } catch (e) {
        console.error('Failed to write temp file:', e);
        throw e;
    }
    return vscode.Uri.file(filePath);
}

function resolveSnapshotUri(filePath: string): vscode.Uri {
    if (path.isAbsolute(filePath)) {
        return vscode.Uri.file(filePath);
    }
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filePath);
    }
    return vscode.Uri.file(filePath);
}

async function openDiff(snapshot: Snapshot, baseFilePath: string, currentSelection?: { startLine: number, endLine: number }) {
    await ensureStorage();
    let fileUri: vscode.Uri | undefined;
    if (baseFilePath && baseFilePath !== 'unknown' && baseFilePath !== '') {
        fileUri = vscode.Uri.file(baseFilePath);
    } else {
        fileUri = resolveSnapshotUri(snapshot.filePath);
    }
    if (!fileUri) return;

    const fileName = path.basename(fileUri.fsPath);
    const ext = path.extname(fileUri.fsPath) || '.txt';
    const timestamp = new Date(snapshot.timestamp).toLocaleString();
    const config = vscode.workspace.getConfiguration('chronos');
    const diffOptions = { 
        viewColumn: vscode.ViewColumn.Active, 
        preview: true
    };

    if (!snapshot.relevantRange && !currentSelection) {
         try {
            const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
            const title = `${fileName} (${timestamp}) ↔ ${fileName} (Current)`;
            await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, title, diffOptions);
        } catch (e) {}
        return;
    }

    try {
        const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
        const snapshotData = await vscode.workspace.fs.readFile(snapshotUri);
        const snapshotContent = new TextDecoder().decode(snapshotData);
        const currentData = await vscode.workspace.fs.readFile(fileUri);
        const currentContent = new TextDecoder().decode(currentData);
        const snapRange = snapshot.relevantRange;
        const currRange = currentSelection;

        if (!snapRange || !currRange) {
             const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
             const title = `${fileName} (${timestamp}) ↔ ${fileName} (Current)`;
             await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, title, diffOptions);
             return;
        }

        const snapLines = snapshotContent.split('\n').slice(snapRange.start, snapRange.end + 1).join('\n');
        const currLines = currentContent.split('\n').slice(currRange.startLine, currRange.endLine + 1).join('\n');
        const snapTemp = await createTempFile(`v_${snapshot.id.substring(0,8)}${ext}`, snapLines);
        const currTemp = await createTempFile(`current_selection${ext}`, currLines);
        
        const title = `${fileName} (${timestamp}) ↔ ${fileName} (Current)`;
        await vscode.commands.executeCommand('vscode.diff', snapTemp, currTemp, title, diffOptions);
    } catch (e) {}
}

async function openDiffGit(commit: GitCommit, filePath: string) {
    if (!commit) return;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!workspaceFolder) return;

    const ext = path.extname(filePath) || '.txt';
    const fileName = path.basename(filePath);
    const diffOptions = { 
        viewColumn: vscode.ViewColumn.Active, 
        preview: true
    };

    try {
        const canonicalPath = await gitService.getCanonicalPath(filePath, commit.hash);
        
        // Get content at current commit
        const { stdout: currentContent } = await gitService.runGit(['show', `${commit.hash}:${canonicalPath}`], workspaceFolder.uri.fsPath);
        
        // Get content at parent commit
        let parentContent = '';
        try {
            const { stdout: pc } = await gitService.runGit(['show', `${commit.hash}^:${canonicalPath}`], workspaceFolder.uri.fsPath);
            parentContent = pc;
        } catch (e) {
            // Might be initial commit
            parentContent = '';
        }

        const leftTemp = await createTempFile(`git_${commit.hash.substring(0,7)}_parent${ext}`, parentContent);
        const rightTemp = await createTempFile(`git_${commit.hash.substring(0,7)}${ext}`, currentContent);
        
        const title = `${fileName} (Parent) ↔ ${fileName} (${commit.hash.substring(0, 7)})`;
        await vscode.commands.executeCommand('vscode.diff', leftTemp, rightTemp, title, diffOptions);
    } catch (e) {
        vscode.window.showErrorMessage('Failed to open Git diff: ' + e);
    }
}

async function openDiffGitCurrent(commit: GitCommit, filePath: string, selection?: {startLine: number, endLine: number}) {
    if (!commit) return;
    const ext = path.extname(filePath) || '.txt';
    const fileName = path.basename(filePath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!workspaceFolder) return;

    const diffOptions = { 
        viewColumn: vscode.ViewColumn.Active, 
        preview: true
    };

    try {
        // 1. Get historical version content
        const canonicalPath = await gitService.getCanonicalPath(filePath, commit.hash);
        const { stdout: historicalContent } = await gitService.runGit(['show', `${commit.hash}:${canonicalPath}`], workspaceFolder.uri.fsPath);
        
        // 2. We always show the full file content for better context
        const leftTemp = await createTempFile(`git_${commit.hash.substring(0,7)}${ext}`, historicalContent);
        const title = `${fileName} (${commit.hash.substring(0, 7)}) ↔ ${fileName} (Current)`;
        
        // Use vscode.diff with the full file URI to allow editing of the current file
        await vscode.commands.executeCommand('vscode.diff', leftTemp, vscode.Uri.file(filePath), title, diffOptions);
        
        // Optional: We could attempt to reveal the selection in the active editor after opening, 
        // but vscode.diff doesn't provide a direct way to do that for both sides reliably.
    } catch (e) {
        vscode.window.showErrorMessage('Failed to open diff with current: ' + e);
    }
}

async function restoreDeletedFile(item: DeletedFileItem) {
    if (!vscode.workspace.workspaceFolders) return;
    const fileUri = resolveSnapshotUri(item.filePath);
    const history = await storage.getHistoryForFile(fileUri);
    if (history.length === 0) return;
    const snapshotUri = await storage.getSnapshotUri(history[0], fileUri);
    const content = await vscode.workspace.fs.readFile(snapshotUri);
    await vscode.workspace.fs.writeFile(fileUri, content);
    deletedFilesProvider.refresh();
}

async function previewDeletedFile(item: DeletedFileItem) {
    if (!vscode.workspace.workspaceFolders) return;
    const fileUri = resolveSnapshotUri(item.filePath);
    const history = await storage.getHistoryForFile(fileUri);
    if (history.length === 0) return;
    const snapshotUri = await storage.getSnapshotUri(history[0], fileUri);
    const doc = await vscode.workspace.openTextDocument(snapshotUri);
    await vscode.window.showTextDocument(doc, { preview: true });
}

async function ensureStorage() { await storage.init(); }

async function getDiffForSnapshot(snapshot: Snapshot, contextFileUri: vscode.Uri | undefined): Promise<string> {
    await ensureStorage();
    let fileUri = contextFileUri;
    if (!fileUri && snapshot.filePath) {
        fileUri = resolveSnapshotUri(snapshot.filePath);
    }
    if (!fileUri) return 'Error: No file URI';
    const fileHistory = await storage.getHistoryForFile(fileUri);
    const index = fileHistory.findIndex(s => s.id === snapshot.id);
    if (index === -1) return 'Snapshot not found';
    
    const currentSnapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
    let prevPath: string;
    if (index === fileHistory.length - 1) {
        prevPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
    } else {
        const prevUri = await storage.getSnapshotUri(fileHistory[index + 1], fileUri);
        prevPath = prevUri.fsPath;
    }
    
    const currentPath = currentSnapshotUri.fsPath;
    let diff = await gitService.getDiff(prevPath, currentPath);
    const relativePath = vscode.workspace.asRelativePath(fileUri, false);
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    diff = diff.replace(new RegExp(escapeRegex(prevPath), 'g'), 'a/' + relativePath);
    diff = diff.replace(new RegExp(escapeRegex(currentPath), 'g'), 'b/' + relativePath);
    return diff;
}

async function compareSnapshots(s1: Snapshot, s2: Snapshot): Promise<string> {
    if (s1.id === s2.id) {
        return "Snapshots are identical.";
    }
    await ensureStorage();
    // Order by timestamp: snap1 should be older
    const [snap1, snap2] = s1.timestamp < s2.timestamp ? [s1, s2] : [s2, s1];
    
    try {
        const uri1 = resolveSnapshotUri(snap1.filePath);
        const uri2 = resolveSnapshotUri(snap2.filePath);
        
        const path1 = (await storage.getSnapshotUri(snap1, uri1)).fsPath;
        const path2 = (await storage.getSnapshotUri(snap2, uri2)).fsPath;
        
        let diff = await gitService.getDiff(path1, path2);
        
        // Cleanup paths in diff
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        diff = diff.replace(new RegExp(escapeRegex(path1), 'g'), 'a/' + snap1.filePath);
        diff = diff.replace(new RegExp(escapeRegex(path2), 'g'), 'b/' + snap2.filePath);
        
        return diff;
    } catch (e) {
        return "Error comparing snapshots: " + e;
    }
}

async function compareTwoSnapshots(s1: Snapshot, s2: Snapshot) {
    if (s1.id === s2.id) {
        vscode.window.showInformationMessage('Snapshots are identical. Nothing to compare.');
        return;
    }
    await ensureStorage();
    // Order by timestamp: snap1 should be older
    const [snap1, snap2] = s1.timestamp < s2.timestamp ? [s1, s2] : [s2, s1];
    
    try {
        const uri1 = resolveSnapshotUri(snap1.filePath);
        const uri2 = resolveSnapshotUri(snap2.filePath);
        const snap1Uri = await storage.getSnapshotUri(snap1, uri1);
        const snap2Uri = await storage.getSnapshotUri(snap2, uri2);

        const fileName1 = path.basename(snap1.filePath);
        const fileName2 = path.basename(snap2.filePath);
        const title1 = `${fileName1} (${new Date(snap1.timestamp).toLocaleString()})`;
        const title2 = `${fileName2} (${new Date(snap2.timestamp).toLocaleString()})`;

        await vscode.commands.executeCommand('vscode.diff', snap1Uri, snap2Uri, `${title1} ↔ ${title2}`);
    } catch (e) {
        vscode.window.showErrorMessage('Failed to compare snapshots: ' + e);
    }
}

async function showHistory(uri?: vscode.Uri, selection?: vscode.Range) {
    await ensureStorage();
    if (!uri) uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) return;
    const history = await storage.getHistoryForFile(uri);
    const clustered = manager.clusterSnapshots(history);

    if (vscode.workspace.getConfiguration('chronos').get('viewMode') === 'panel') {
        panelProvider.showLocalHistory(clustered, uri.fsPath, selection, aiService.isConfigured());
        vscode.commands.executeCommand('chronos.historyPanel.focus');
    } else {
        viewProvider.show(
            clustered, 
            uri, 
            (s: Snapshot) => getDiffForSnapshot(s, uri), 
            selection, 
            (q: string, sc: boolean) => storage.search(q, sc), 
            (s: Snapshot) => explainSnapshot(s, uri), 
            (q: string) => manager.semanticSearch(q), 
            (id: string) => manager.togglePin(id), 
            (s1: Snapshot, s2: Snapshot) => compareSnapshots(s1, s2),
            async (name: string, filePath: string) => {
                await manager.putLabel(name, '', undefined, filePath);
                const updatedHistory = await storage.getHistoryForFile(vscode.Uri.file(filePath));
                viewProvider.updateSnapshots(manager.clusterSnapshots(updatedHistory));
            },
            aiService.isConfigured()
        );
    }
}

async function showHistoryForSelection() {
    await ensureStorage();
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri;
    const history = await storage.getHistoryForFile(uri);
    try {
        const filtered = await historyFilter.filterHistoryForSelection(history, uri, editor.selection);
        if (vscode.workspace.getConfiguration('chronos').get('viewMode') === 'panel') {
            panelProvider.showLocalHistory(filtered, uri.fsPath, editor.selection, aiService.isConfigured());
            vscode.commands.executeCommand('chronos.historyPanel.focus');
        } else {
            viewProvider.show(filtered, uri, (s: Snapshot) => getDiffForSnapshot(s, uri), editor.selection, (q: string, sc: boolean) => storage.search(q, sc), (s: Snapshot) => explainSnapshot(s, uri), (q: string) => manager.semanticSearch(q), (id: string) => manager.togglePin(id), (s1: Snapshot, s2: Snapshot) => compareSnapshots(s1, s2), undefined, aiService.isConfigured());
        }
    } catch (e) {}
}

async function showProjectHistory() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    const clustered = manager.clusterSnapshots(history);
    viewProvider.show(clustered, undefined, (s: Snapshot) => getDiffForSnapshot(s, undefined), undefined, (q: string, sc: boolean) => storage.search(q, sc), undefined, (q: string) => manager.semanticSearch(q), (id: string) => manager.togglePin(id), (s1: Snapshot, s2: Snapshot) => compareSnapshots(s1, s2), undefined, aiService.isConfigured());
}

async function showRecentChanges() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    viewProvider.show(history.slice(0, 20), undefined, (s: Snapshot) => getDiffForSnapshot(s, undefined), undefined, (q: string, sc: boolean) => storage.search(q, sc), undefined, (q: string) => manager.semanticSearch(q), (id: string) => manager.togglePin(id), (s1: Snapshot, s2: Snapshot) => compareSnapshots(s1, s2), undefined, aiService.isConfigured());
}

async function showGraph() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    graphViewProvider.show(history);
}

async function explainSnapshot(snapshot: Snapshot, uri?: vscode.Uri): Promise<string> {
    if (!aiService.isEnabled('explainChanges')) return "AI Disabled";
    const diff = await getDiffForSnapshot(snapshot, uri);
    return await aiService.explainDiff(diff);
}

async function putLabel() {
    const editor = vscode.window.activeTextEditor;
    const name = await vscode.window.showInputBox({ prompt: 'Label Name (e.g. Before refactor)' });
    if (name) {
        await manager.putLabel(name, '', editor?.document);
        if (editor) {
            showHistory(editor.document.uri);
        }
    }
}

async function saveDiffAsPatch(diffText: string) {
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('changes.patch'),
        filters: { 'Patch Files': ['patch', 'diff'] },
        saveLabel: 'Save Patch'
    });
    if (uri) {
        try {
            fs.writeFileSync(uri.fsPath, diffText);
            vscode.window.showInformationMessage('Patch saved successfully.');
        } catch (e) {
            vscode.window.showErrorMessage('Failed to save patch: ' + e);
        }
    }
}

async function compareToCurrent(snapshotId: string, filePath?: string) {
    await ensureStorage();
    let fileUri: vscode.Uri | undefined;
    if (filePath) fileUri = resolveSnapshotUri(filePath);
    if (!fileUri) fileUri = vscode.window.activeTextEditor?.document.uri;
    if (!fileUri) return;
    
    const history = await storage.getHistoryForFile(fileUri);
    const snapshot = history.find(s => s.id === snapshotId);
    if (!snapshot) return;
    try {
        const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
        const fileName = path.basename(fileUri.fsPath);
        const timestamp = new Date(snapshot.timestamp).toLocaleString();
        const title = `${fileName} (${timestamp}) ↔ ${fileName} (Current)`;
        await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, title);
    } catch (e) {}
}

async function compareWithActive(snapshot: Snapshot) {
    await ensureStorage();
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage('No active editor to compare with.');
        return;
    }
    const targetUri = activeEditor.document.uri;

    const originalUri = resolveSnapshotUri(snapshot.filePath);

    try {
        const snapshotUri = await storage.getSnapshotUri(snapshot, originalUri);
        const sourceName = path.basename(snapshot.filePath);
        const targetName = path.basename(targetUri.fsPath);
        const timestamp = new Date(snapshot.timestamp).toLocaleString();
        
        const title = `${sourceName} (${timestamp}) ↔ ${targetName} (Active Editor)`;
        await vscode.commands.executeCommand('vscode.diff', snapshotUri, targetUri, title);
    } catch (e) {
        vscode.window.showErrorMessage('Comparison failed: ' + e);
    }
}

async function restoreSnapshot(snapshotId: string, filePath?: string) {
    await ensureStorage();
    let fileUri: vscode.Uri | undefined;
    if (filePath) fileUri = resolveSnapshotUri(filePath);
    if (!fileUri) fileUri = vscode.window.activeTextEditor?.document.uri;
    if (!fileUri) return;
    const history = await storage.getHistoryForFile(fileUri);
    const snapshot = history.find(s => s.id === snapshotId);
    if (!snapshot) return;
    const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
    const content = await vscode.workspace.fs.readFile(snapshotUri);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(fileUri, new vscode.Range(0, 0, doc.lineCount, 0), new TextDecoder().decode(content));
    await vscode.workspace.applyEdit(edit);
}

async function explainGitCommit(commit: GitCommit): Promise<string> {
    if (!aiService.isEnabled('explainChanges')) return "AI Disabled";
    return await aiService.explainDiff(commit.diff);
}

async function showGitHistory() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    try {
        const commits = await gitService.getHistoryForFile(editor.document.uri.fsPath, { maxCommits: 100, followRenames: true, dateFormat: 'yyyy-MM-dd HH:mm' });
        if (commits.length > 0) {
            if (vscode.workspace.getConfiguration('chronos').get('viewMode') === 'panel') {
                panelProvider.showGitHistory(commits, editor.document.uri.fsPath, undefined, aiService.isConfigured());
                vscode.commands.executeCommand('chronos.historyPanel.focus');
            } else {
                viewProvider.showGit(
                    commits, 
                    editor.document.uri.fsPath, 
                    undefined as any,
                    (c: GitCommit) => explainGitCommit(c),
                    (h1: string, h2: string) => gitService.getCommitDiff(h1, h2, editor.document.uri.fsPath, -1, -1), // -1, -1 signals whole file
                    aiService.isConfigured()
                );
            }
        }
    } catch (e) {
        vscode.window.showErrorMessage('Failed to show git history: ' + e);
    }
}

async function gitHistoryForSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const selection = editor.selection;
    if (selection.isEmpty) return;
    try {
        const commits = await gitService.getHistoryForSelection(editor.document.uri.fsPath, selection.start.line, selection.end.line, { maxCommits: 100, followRenames: true, dateFormat: 'yyyy-MM-dd HH:mm' });
        if (commits.length > 0) {
            if (vscode.workspace.getConfiguration('chronos').get('viewMode') === 'panel') {
                panelProvider.showGitHistory(commits, editor.document.uri.fsPath, { startLine: selection.start.line, endLine: selection.end.line }, aiService.isConfigured());
                vscode.commands.executeCommand('chronos.historyPanel.focus');
            } else {
                viewProvider.showGit(
                    commits, 
                    editor.document.uri.fsPath, 
                    { startLine: selection.start.line, endLine: selection.end.line },
                    (c: GitCommit) => explainGitCommit(c),
                    (h1: string, h2: string) => gitService.getCommitDiff(h1, h2, editor.document.uri.fsPath, selection.start.line, selection.end.line),
                    aiService.isConfigured()
                );
            }
        }
    } catch (e) {}
}

async function runDiagnostics() {
    const report = await storage.runDiagnostics();
    const doc = await vscode.workspace.openTextDocument({ content: report, language: 'text' });
    await vscode.window.showTextDocument(doc);
}

async function exportHistory() {
    const uri = await vscode.window.showSaveDialog({
        filters: { 'Zip Files': ['zip'] },
        saveLabel: 'Export History'
    });
    if (uri) {
        try {
            await backupService.exportHistory(uri.fsPath);
            vscode.window.showInformationMessage('History exported successfully.');
        } catch (e) {
            vscode.window.showErrorMessage('Export failed: ' + e);
        }
    }
}

async function importHistory() {
    const uri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Chronos Files': ['chronos', 'zip'] },
        openLabel: 'Import History'
    });
    if (uri && uri.length > 0) {
        try {
            await backupService.importHistory(uri[0].fsPath);
            // Refresh views
            activityProvider.refresh();
        } catch (e) {
            vscode.window.showErrorMessage('Import failed: ' + e);
        }
    }
}

async function shareSnapshot(snapshot: Snapshot) {
    const defaultName = `snapshot_${snapshot.id.substring(0,8)}.chronos`;
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultName),
        filters: { 'Chronos Share': ['chronos'] },
        saveLabel: 'Share Snapshot'
    });

    if (uri) {
        try {
            await backupService.exportSnapshot(snapshot, uri.fsPath);
            vscode.window.showInformationMessage('Snapshot ready for sharing: ' + path.basename(uri.fsPath));
        } catch (e) {
            vscode.window.showErrorMessage('Sharing failed: ' + e);
        }
    }
}

async function compareWithBranch(branchName?: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor to compare.');
        return;
    }
    const uri = editor.document.uri;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) return;

    let selectedBranch = branchName;
    if (!selectedBranch) {
        let branches = await gitService.getBranches(workspaceFolder.uri.fsPath);
        if (branches.length === 0) {
            vscode.window.showInformationMessage('No branches found.');
            return;
        }

        const filterLabel = "$(filter) Filter by file changes";
        const items = [filterLabel, ...branches];

        let selection = await vscode.window.showQuickPick(items, { placeHolder: 'Select branch to compare with current file' });
        
        if (selection === filterLabel) {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Filtering branches...",
                cancellable: false
            }, async () => {
                branches = await gitService.getBranches(workspaceFolder.uri.fsPath, uri.fsPath);
            }).then(async () => {
                if (branches.length === 0) {
                    vscode.window.showInformationMessage('No branches found with changes to this file.');
                    return;
                }
                selectedBranch = await vscode.window.showQuickPick(branches, { placeHolder: 'Select branch with changes to this file' });
                if (selectedBranch) proceedWithCompare(selectedBranch, uri, workspaceFolder);
            });
            return;
        } else {
            selectedBranch = selection;
        }
    }
    
    if (!selectedBranch) return;
    await proceedWithCompare(selectedBranch, uri, workspaceFolder);
}

async function proceedWithCompare(selectedBranch: string, uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder) {
    try {
        const canonicalPath = await gitService.getCanonicalPath(uri.fsPath);
        const historicalContent = await gitService.getFileContentFromBranch(selectedBranch, canonicalPath, workspaceFolder.uri.fsPath);
        
        if (historicalContent === '' && !fs.existsSync(uri.fsPath)) {
            vscode.window.showInformationMessage(`File not found in current workspace and not found in branch ${selectedBranch}.`);
            return;
        }

        const ext = path.extname(uri.fsPath) || '.txt';
        const branchTemp = await createTempFile(`branch_${selectedBranch.replace(/[\/\\]/g, '_')}_${path.basename(uri.fsPath)}${ext}`, historicalContent);
        
        const title = `${path.basename(uri.fsPath)} (${selectedBranch}) ↔ Current`;
        await vscode.commands.executeCommand('vscode.diff', branchTemp, uri, title);
    } catch (e) {
        vscode.window.showErrorMessage('Failed to compare with branch: ' + e);
    }
}

async function compareWithBranchVersion(source?: { snapshot?: Snapshot, commit?: GitCommit, filePath: string }) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    let branches = await gitService.getBranches(workspaceFolder.uri.fsPath);
    if (branches.length === 0) {
        vscode.window.showInformationMessage('No branches found.');
        return;
    }

    const filterLabel = "$(filter) Filter by file changes";
    const items = [filterLabel, ...branches];
    
    let selectedBranchSelection = await vscode.window.showQuickPick(items, { placeHolder: 'Step 1: Select branch' });
    if (!selectedBranchSelection) return;

    const filePath = source?.filePath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) return;

    let selectedBranch: string | undefined;

    if (selectedBranchSelection === filterLabel) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Filtering branches...",
            cancellable: false
        }, async () => {
            branches = await gitService.getBranches(workspaceFolder.uri.fsPath, filePath);
        });

        if (branches.length === 0) {
            vscode.window.showInformationMessage('No branches found with changes to this file.');
            return;
        }
        selectedBranch = await vscode.window.showQuickPick(branches, { placeHolder: 'Select branch with changes to this file' });
    } else {
        selectedBranch = selectedBranchSelection;
    }

    if (!selectedBranch) return;

    const config = vscode.workspace.getConfiguration('gitHistory.selection');
    const commits = await gitService.getHistoryForFile(filePath, {
        maxCommits: config.get('maxCommits', 100),
        followRenames: config.get('followRenames', true),
        dateFormat: config.get('dateFormat', 'yyyy-MM-dd HH:mm')
    }, selectedBranch);

    if (commits.length === 0) {
        vscode.window.showInformationMessage(`No history found for this file on branch ${selectedBranch}.`);
        return;
    }

    const pickedCommit = await vscode.window.showQuickPick(
        commits.map(c => ({
            label: c.message,
            description: `${c.hash.substring(0, 7)} by ${c.author} on ${c.date}`,
            commit: c
        })),
        { placeHolder: `Step 2: Select version from ${selectedBranch}` }
    );

    if (!pickedCommit) return;

    // Now compare the selected source with this specific commit from the other branch
    if (source?.snapshot) {
        await vscode.commands.executeCommand('chronos.compareSnapshotWithBranch', source.snapshot, `${pickedCommit.commit.hash}`);
    } else if (source?.commit) {
        await vscode.commands.executeCommand('chronos.compareTwoCommits', source.commit.hash, pickedCommit.commit.hash, filePath);
    } else {
        // Compare current file with this specific commit
        const canonicalPath = await gitService.getCanonicalPath(filePath, pickedCommit.commit.hash);
        const commitContent = await gitService.runGit(['show', `${pickedCommit.commit.hash}:${canonicalPath}`], workspaceFolder.uri.fsPath);
        
        const ext = path.extname(filePath) || '.txt';
        const commitTemp = await createTempFile(`commit_${pickedCommit.commit.hash.substring(0,7)}_${path.basename(filePath)}${ext}`, commitContent.stdout);
        const title = `${path.basename(filePath)} (${pickedCommit.commit.hash.substring(0, 7)}) ↔ Current`;
        await vscode.commands.executeCommand('vscode.diff', commitTemp, vscode.Uri.file(filePath), title);
    }
}

async function compareTwoCommits(h1: string, h2: string, filePath: string) {
    if (h1 === h2) {
        vscode.window.showInformationMessage('Commits are identical. Nothing to compare.');
        return;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!workspaceFolder) return;
    const fileName = path.basename(filePath);
    
    try {
        const canonicalPath1 = await gitService.getCanonicalPath(filePath, h1);
        const canonicalPath2 = await gitService.getCanonicalPath(filePath, h2);
        const { stdout: content1 } = await gitService.runGit(['show', `${h1}:${canonicalPath1}`], workspaceFolder.uri.fsPath);
        const { stdout: content2 } = await gitService.runGit(['show', `${h2}:${canonicalPath2}`], workspaceFolder.uri.fsPath);
        
        const ext = path.extname(filePath) || '.txt';
        const leftTemp = await createTempFile(`git_${h1.substring(0,7)}${ext}`, content1);
        const rightTemp = await createTempFile(`git_${h2.substring(0,7)}${ext}`, content2);
        
        const title = `${fileName} (${h1.substring(0, 7)}) ↔ ${fileName} (${h2.substring(0, 7)})`;
        await vscode.commands.executeCommand('vscode.diff', leftTemp, rightTemp, title);
    } catch (e) {
        vscode.window.showErrorMessage('Failed to compare commits: ' + e);
    }
}

export function deactivate() {}