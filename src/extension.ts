import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { HistoryStorage } from './storage';
import { HistoryManager } from './historyManager';
import { HistoryFilter } from './historyFilter';
import { HistoryViewProvider } from './views/historyWebview';
import { GraphViewProvider } from './views/graphWebview';
import { DeletedFilesProvider, DeletedFileItem } from './views/deletedFilesProvider';
import { ActivityProvider } from './views/activityProvider';
import { HeatmapController } from './views/heatmapController';
import { DivergenceProvider } from './views/divergenceProvider';
import { GitService } from './git/gitService';
import { AIService } from './ai/aiService';
import { BackupService } from './backup';
import { ProjectRestorer } from './timeTravel';
import { Snapshot, GitCommit } from './types';

let storage: HistoryStorage;
let manager: HistoryManager;
let historyFilter: HistoryFilter;
let viewProvider: HistoryViewProvider;
let graphViewProvider: GraphViewProvider;
let deletedFilesProvider: DeletedFilesProvider;
let activityProvider: ActivityProvider;
let heatmapController: HeatmapController;
let divergenceProvider: DivergenceProvider;
let gitService: GitService;
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
        graphViewProvider = new GraphViewProvider(context.extensionUri, outputChannel);
        gitService = new GitService();
        aiService = new AIService();
        
        manager = new HistoryManager(context, storage, gitService);
        
        historyFilter = new HistoryFilter(storage, gitService);
        deletedFilesProvider = new DeletedFilesProvider(manager, storage);
        activityProvider = new ActivityProvider(storage);
        heatmapController = new HeatmapController(gitService);
        divergenceProvider = new DivergenceProvider(gitService);
        backupService = new BackupService(storage);
        projectRestorer = new ProjectRestorer(storage, manager);

        vscode.window.registerTreeDataProvider('chronos.deletedFiles', deletedFilesProvider);
        vscode.window.registerTreeDataProvider('chronos.activity', activityProvider);

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
            vscode.commands.registerCommand('chronos.showBriefingForDate', () => manager.showDailyBriefingForDate()),
            vscode.commands.registerCommand('chronos.generateChangelog', () => manager.generateChangelog()),
            vscode.commands.registerCommand('chronos.compareTwoSnapshots', compareTwoSnapshots),
            vscode.commands.registerCommand('chronos.compareTwoCommits', compareTwoCommits),
            vscode.commands.registerCommand('chronos.compareWithActive', compareWithActive),
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
            vscode.commands.registerCommand('chronos.showLogs', () => outputChannel.show(true)),
            vscode.commands.registerCommand('chronos.runDiagnostics', runDiagnostics),
            vscode.commands.registerCommand('chronos.exportHistory', exportHistory),
            vscode.commands.registerCommand('chronos.importHistory', importHistory),
            vscode.commands.registerCommand('chronos.shareSnapshot', shareSnapshot),
            vscode.commands.registerCommand('chronos.importShared', importHistory)
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

        storage.init().catch(err => {
            outputChannel.appendLine('Storage init failed: ' + err);
        });
    } catch (e) {
        vscode.window.showErrorMessage('Chronos Activation Failed: ' + e);
        console.error(e);
    }
}

async function generateAICommitMessage() {
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
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content);
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

    if (!snapshot.relevantRange && !currentSelection) {
         try {
            const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
            const title = `${fileName} (${timestamp}) ↔ ${fileName} (Current)`;
            await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, title);
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
             await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, title);
             return;
        }

        const snapLines = snapshotContent.split('\n').slice(snapRange.start, snapRange.end + 1).join('\n');
        const currLines = currentContent.split('\n').slice(currRange.startLine, currRange.endLine + 1).join('\n');
        const snapTemp = await createTempFile(`v_${snapshot.id.substring(0,8)}${ext}`, snapLines);
        const currTemp = await createTempFile(`current_selection${ext}`, currLines);
        
        const title = `${fileName} (${timestamp}) ↔ ${fileName} (Current)`;
        await vscode.commands.executeCommand('vscode.diff', snapTemp, currTemp, title);
    } catch (e) {}
}

async function openDiffGit(commit: GitCommit, filePath: string) {
    if (!commit || !commit.diff) return;
    const ext = path.extname(filePath) || '.txt';
    const fileName = path.basename(filePath);
    try {
        const lines = commit.diff.split('\n');
        let leftContent = '', rightContent = '';
        for (const line of lines) {
            if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
            if (line.startsWith('-')) leftContent += line.substring(1) + '\n';
            else if (line.startsWith('+')) rightContent += line.substring(1) + '\n';
            else { 
                const contextLine = line.startsWith(' ') ? line.substring(1) : line;
                leftContent += contextLine + '\n'; 
                rightContent += contextLine + '\n'; 
            }
        }
        const leftTemp = await createTempFile(`git_${commit.hash.substring(0,7)}_before${ext}`, leftContent);
        const rightTemp = await createTempFile(`git_${commit.hash.substring(0,7)}_after${ext}`, rightContent);
        
        const title = `${fileName} (Parent) ↔ ${fileName} (${commit.hash.substring(0, 7)})`;
        await vscode.commands.executeCommand('vscode.diff', leftTemp, rightTemp, title);
    } catch (e) {}
}

async function openDiffGitCurrent(commit: GitCommit, filePath: string, selection: {startLine: number, endLine: number}) {
    if (!commit) return;
    const ext = path.extname(filePath) || '.txt';
    const fileName = path.basename(filePath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!workspaceFolder) return;

    try {
        // 1. Get historical version content
        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
        const showArgs = [`${commit.hash}:${relativePath}`];
        const { stdout: historicalContent } = await gitService.runGit(['show', ...showArgs], workspaceFolder.uri.fsPath);
        
        // 2. Get current content
        const currentContent = fs.readFileSync(filePath, 'utf8');

        // 3. Slice to selection
        const histLines = historicalContent.split('\n').slice(selection.startLine, selection.endLine + 1).join('\n');
        const currLines = currentContent.split('\n').slice(selection.startLine, selection.endLine + 1).join('\n');

        const leftTemp = await createTempFile(`git_${commit.hash.substring(0,7)}_selection${ext}`, histLines);
        const rightTemp = await createTempFile(`current_selection${ext}`, currLines);
        
        const title = `${fileName} (${commit.hash.substring(0, 7)}) ↔ ${fileName} (Current)`;
        await vscode.commands.executeCommand('vscode.diff', leftTemp, rightTemp, title);
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
    viewProvider.show(clustered, uri, (s: Snapshot) => getDiffForSnapshot(s, uri), selection, (q: string, sc: boolean) => storage.search(q, sc), (s: Snapshot) => explainSnapshot(s, uri), (q: string) => manager.semanticSearch(q), (id: string) => manager.togglePin(id), (s1: Snapshot, s2: Snapshot) => compareSnapshots(s1, s2));
}

async function showHistoryForSelection() {
    await ensureStorage();
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri;
    const history = await storage.getHistoryForFile(uri);
    try {
        const filtered = await historyFilter.filterHistoryForSelection(history, uri, editor.selection);
        viewProvider.show(filtered, uri, (s: Snapshot) => getDiffForSnapshot(s, uri), editor.selection, (q: string, sc: boolean) => storage.search(q, sc), (s: Snapshot) => explainSnapshot(s, uri), (q: string) => manager.semanticSearch(q), (id: string) => manager.togglePin(id), (s1: Snapshot, s2: Snapshot) => compareSnapshots(s1, s2));
    } catch (e) {}
}

async function showProjectHistory() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    const clustered = manager.clusterSnapshots(history);
    viewProvider.show(clustered, undefined, (s: Snapshot) => getDiffForSnapshot(s, undefined), undefined, (q: string, sc: boolean) => storage.search(q, sc), undefined, (q: string) => manager.semanticSearch(q), (id: string) => manager.togglePin(id), (s1: Snapshot, s2: Snapshot) => compareSnapshots(s1, s2));
}

async function showRecentChanges() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    viewProvider.show(history.slice(0, 20), undefined, (s: Snapshot) => getDiffForSnapshot(s, undefined), undefined, (q: string, sc: boolean) => storage.search(q, sc), undefined, (q: string) => manager.semanticSearch(q), (id: string) => manager.togglePin(id), (s1: Snapshot, s2: Snapshot) => compareSnapshots(s1, s2));
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
    const name = await vscode.window.showInputBox({ prompt: 'Label Name' });
    if (name) await manager.putLabel(name, '', vscode.window.activeTextEditor?.document);
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

async function gitHistoryForSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const selection = editor.selection;
    if (selection.isEmpty) return;
    try {
        const commits = await gitService.getHistoryForSelection(editor.document.uri.fsPath, selection.start.line, selection.end.line, { maxCommits: 100, followRenames: true, dateFormat: 'yyyy-MM-dd HH:mm' });
        if (commits.length > 0) {
            viewProvider.showGit(
                commits, 
                editor.document.uri.fsPath, 
                { startLine: selection.start.line, endLine: selection.end.line },
                (c: GitCommit) => explainGitCommit(c),
                (h1: string, h2: string) => gitService.getCommitDiff(h1, h2, editor.document.uri.fsPath, selection.start.line, selection.end.line)
            );
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

async function compareTwoCommits(h1: string, h2: string, filePath: string) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!workspaceFolder) return;
    const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
    const fileName = path.basename(filePath);
    
    try {
        const { stdout: content1 } = await gitService.runGit(['show', `${h1}:${relativePath}`], workspaceFolder.uri.fsPath);
        const { stdout: content2 } = await gitService.runGit(['show', `${h2}:${relativePath}`], workspaceFolder.uri.fsPath);
        
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