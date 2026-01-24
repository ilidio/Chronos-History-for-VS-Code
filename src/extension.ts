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
let gitService: GitService;
let aiService: AIService;
let backupService: BackupService;
let projectRestorer: ProjectRestorer;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("Chronos Debug");
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('Activating Chronos History Extension...');

    storage = new HistoryStorage(context);
    viewProvider = new HistoryViewProvider(context.extensionUri, outputChannel);
    graphViewProvider = new GraphViewProvider(context.extensionUri, outputChannel);
    gitService = new GitService();
    aiService = new AIService();
    
    manager = new HistoryManager(context, storage, gitService);
    
    historyFilter = new HistoryFilter(storage, gitService);
    deletedFilesProvider = new DeletedFilesProvider(manager, storage);
    activityProvider = new ActivityProvider(storage);
    backupService = new BackupService(storage);
    projectRestorer = new ProjectRestorer(storage, manager);

    vscode.window.registerTreeDataProvider('chronos.deletedFiles', deletedFilesProvider);
    vscode.window.registerTreeDataProvider('chronos.activity', activityProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('chronos.showHistory', showHistory),
        vscode.commands.registerCommand('chronos.showHistoryForSelection', showHistoryForSelection),
        vscode.commands.registerCommand('chronos.showProjectHistory', showProjectHistory),
        vscode.commands.registerCommand('chronos.showRecentChanges', showRecentChanges),
        vscode.commands.registerCommand('chronos.showGraph', showGraph),
        vscode.commands.registerCommand('chronos.putLabel', putLabel),
        vscode.commands.registerCommand('chronos.compareToCurrent', compareToCurrent),
        vscode.commands.registerCommand('chronos.restoreSnapshot', restoreSnapshot),
        vscode.commands.registerCommand('chronos.restoreProject', () => projectRestorer.restoreProjectState()),
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
        vscode.commands.registerCommand('chronos.showLogs', () => outputChannel.show(true)),
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

async function openDiff(snapshot: Snapshot, baseFilePath: string, currentSelection?: { startLine: number, endLine: number }) {
    await ensureStorage();
    let fileUri: vscode.Uri | undefined;
    if (baseFilePath && baseFilePath !== 'unknown') fileUri = vscode.Uri.file(baseFilePath);
    else if (snapshot.filePath && vscode.workspace.workspaceFolders) {
        fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, snapshot.filePath);
    }
    if (!fileUri) return;

    const ext = path.extname(fileUri.fsPath) || '.txt';
    if (!snapshot.relevantRange && !currentSelection) {
         try {
            const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
            await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, `Chronos: ${new Date(snapshot.timestamp).toLocaleString()} ↔ Current`);
        } catch (e) {}
        return;
    }

    try {
        const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
        const snapshotContent = (await vscode.workspace.fs.readFile(snapshotUri)).toString();
        const currentContent = (await vscode.workspace.fs.readFile(fileUri)).toString();
        const snapRange = snapshot.relevantRange;
        const currRange = currentSelection;

        if (!snapRange || !currRange) {
             const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
             await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, `Chronos: ${new Date(snapshot.timestamp).toLocaleString()} ↔ Current`);
             return;
        }

        const snapLines = snapshotContent.split('\n').slice(snapRange.start, snapRange.end + 1).join('\n');
        const currLines = currentContent.split('\n').slice(currRange.startLine, currRange.endLine + 1).join('\n');
        const snapTemp = await createTempFile(`v_${snapshot.id.substring(0,8)}${ext}`, snapLines);
        const currTemp = await createTempFile(`current_selection${ext}`, currLines);
        await vscode.commands.executeCommand('vscode.diff', snapTemp, currTemp, `Selection: ${new Date(snapshot.timestamp).toLocaleString()} ↔ Current`);
    } catch (e) {}
}

async function openDiffGit(commit: GitCommit, filePath: string) {
    if (!commit || !commit.diff) return;
    const ext = path.extname(filePath) || '.txt';
    try {
        const lines = commit.diff.split('\n');
        let leftContent = '', rightContent = '';
        for (const line of lines) {
            if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
            if (line.startsWith('-')) leftContent += line.substring(1) + '\n';
            else if (line.startsWith('+')) rightContent += line.substring(1) + '\n';
            else { leftContent += line.substring(1) + '\n'; rightContent += line.substring(1) + '\n'; }
        }
        const leftTemp = await createTempFile(`git_${commit.hash.substring(0,7)}_before${ext}`, leftContent);
        const rightTemp = await createTempFile(`git_${commit.hash.substring(0,7)}_after${ext}`, rightContent);
        await vscode.commands.executeCommand('vscode.diff', leftTemp, rightTemp, `Git: ${commit.hash.substring(0,7)} (${commit.message.trim()})`);
    } catch (e) {}
}

async function restoreDeletedFile(item: DeletedFileItem) {
    if (!vscode.workspace.workspaceFolders) return;
    const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, item.filePath);
    const history = await storage.getHistoryForFile(fileUri);
    if (history.length === 0) return;
    const snapshotUri = await storage.getSnapshotUri(history[0], fileUri);
    const content = await vscode.workspace.fs.readFile(snapshotUri);
    await vscode.workspace.fs.writeFile(fileUri, content);
    deletedFilesProvider.refresh();
}

async function previewDeletedFile(item: DeletedFileItem) {
    if (!vscode.workspace.workspaceFolders) return;
    const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, item.filePath);
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
    if (snapshot.filePath && vscode.workspace.workspaceFolders) {
        fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, snapshot.filePath);
    }
    if (!fileUri) return 'Error: No file URI';
    const fileHistory = await storage.getHistoryForFile(fileUri);
    const index = fileHistory.findIndex(s => s.id === snapshot.id);
    if (index === -1) return 'Snapshot not found';
    let prevPath = index === fileHistory.length - 1 ? (process.platform === 'win32' ? 'NUL' : '/dev/null') : (await storage.getSnapshotUri(fileHistory[index + 1], fileUri)).fsPath;
    const currentPath = (await storage.getSnapshotUri(snapshot, fileUri)).fsPath;
    let diff = await gitService.getDiff(prevPath, currentPath);
    const relativePath = vscode.workspace.asRelativePath(fileUri, false);
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    diff = diff.replace(new RegExp(escapeRegex(prevPath), 'g'), 'a/' + relativePath);
    diff = diff.replace(new RegExp(escapeRegex(currentPath), 'g'), 'b/' + relativePath);
    return diff;
}

async function showHistory(uri?: vscode.Uri, selection?: vscode.Range) {
    await ensureStorage();
    if (!uri) uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) return;
    const history = await storage.getHistoryForFile(uri);
    const clustered = manager.clusterSnapshots(history);
    viewProvider.show(clustered, uri, (s: Snapshot) => getDiffForSnapshot(s, uri), selection, (q: string) => storage.search(q), (s: Snapshot) => explainSnapshot(s, uri), (q: string) => manager.semanticSearch(q));
}

async function showHistoryForSelection() {
    await ensureStorage();
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri;
    const history = await storage.getHistoryForFile(uri);
    try {
        const filtered = await historyFilter.filterHistoryForSelection(history, uri, editor.selection);
        viewProvider.show(filtered, uri, (s: Snapshot) => getDiffForSnapshot(s, uri), editor.selection, (q: string) => storage.search(q), (s: Snapshot) => explainSnapshot(s, uri), (q: string) => manager.semanticSearch(q));
    } catch (e) {}
}

async function showProjectHistory() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    const clustered = manager.clusterSnapshots(history);
    viewProvider.show(clustered, undefined, (s: Snapshot) => getDiffForSnapshot(s, undefined), undefined, (q: string) => storage.search(q), undefined, (q: string) => manager.semanticSearch(q));
}

async function showRecentChanges() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    viewProvider.show(history.slice(0, 20), undefined, (s: Snapshot) => getDiffForSnapshot(s, undefined), undefined, (q: string) => storage.search(q), undefined, (q: string) => manager.semanticSearch(q));
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
    if (filePath && vscode.workspace.workspaceFolders) fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filePath);
    if (!fileUri) fileUri = vscode.window.activeTextEditor?.document.uri;
    if (!fileUri) return;
    const history = await storage.getHistoryForFile(fileUri);
    const snapshot = history.find(s => s.id === snapshotId);
    if (!snapshot) return;
    try {
        const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
        await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, `Compare vs Current`);
    } catch (e) {}
}

async function restoreSnapshot(snapshotId: string, filePath?: string) {
    await ensureStorage();
    let fileUri: vscode.Uri | undefined;
    if (filePath && vscode.workspace.workspaceFolders) fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filePath);
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
            viewProvider.showGit(commits, editor.document.uri.fsPath, (c: GitCommit) => explainGitCommit(c));
        }
    } catch (e) {}
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

export function deactivate() {}