import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { HistoryStorage } from './storage';
import { HistoryManager } from './historyManager';
import { HistoryFilter } from './historyFilter';
import { HistoryViewProvider } from './views/historyWebview';
import { DeletedFilesProvider, DeletedFileItem } from './views/deletedFilesProvider';
import { ActivityProvider } from './views/activityProvider';
import { GitService } from './git/gitService';
import { Snapshot, GitCommit } from './types';

let storage: HistoryStorage;
let manager: HistoryManager;
let historyFilter: HistoryFilter;
let viewProvider: HistoryViewProvider;
let deletedFilesProvider: DeletedFilesProvider;
let activityProvider: ActivityProvider;
let gitService: GitService;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("Chronos Debug");
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('Activating Chronos History Extension...');

    storage = new HistoryStorage(context);
    viewProvider = new HistoryViewProvider(context.extensionUri, outputChannel);
    gitService = new GitService();
    manager = new HistoryManager(context, storage);
    historyFilter = new HistoryFilter(storage, gitService);
    deletedFilesProvider = new DeletedFilesProvider(manager, storage);
    activityProvider = new ActivityProvider(storage);

    vscode.window.registerTreeDataProvider('chronos.deletedFiles', deletedFilesProvider);
    vscode.window.registerTreeDataProvider('chronos.activity', activityProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('chronos.showHistory', showHistory),
        vscode.commands.registerCommand('chronos.showHistoryForSelection', showHistoryForSelection),
        vscode.commands.registerCommand('chronos.showProjectHistory', showProjectHistory),
        vscode.commands.registerCommand('chronos.showRecentChanges', showRecentChanges),
        vscode.commands.registerCommand('chronos.putLabel', putLabel),
        vscode.commands.registerCommand('chronos.compareToCurrent', compareToCurrent),
        vscode.commands.registerCommand('chronos.restoreSnapshot', restoreSnapshot),
        vscode.commands.registerCommand('chronos.gitHistoryForSelection', gitHistoryForSelection),
        vscode.commands.registerCommand('chronos.restoreDeletedFile', restoreDeletedFile),
        vscode.commands.registerCommand('chronos.previewDeletedFile', previewDeletedFile),
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
        vscode.commands.registerCommand('chronos.showLogs', () => outputChannel.show(true))
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
        console.error('Storage init failed:', err);
    });
}

async function createTempFile(name: string, content: string): Promise<vscode.Uri> {
    try {
        const tmpDir = path.join(os.tmpdir(), 'chronos_diff');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir);
        }
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, content);
        return vscode.Uri.file(filePath);
    } catch (e) {
        outputChannel.appendLine(`Error creating temp file ${name}: ${e}`);
        throw e;
    }
}

async function openDiff(snapshot: Snapshot, baseFilePath: string, currentSelection?: { startLine: number, endLine: number }) {
    outputChannel.appendLine(`[openDiff] Called for snapshot ${snapshot.id}`);
    await ensureStorage();
    
    let fileUri: vscode.Uri | undefined;
    
    if (baseFilePath && baseFilePath !== 'unknown') {
        fileUri = vscode.Uri.file(baseFilePath);
    } else if (snapshot.filePath && vscode.workspace.workspaceFolders) {
        const root = vscode.workspace.workspaceFolders[0].uri;
        fileUri = vscode.Uri.joinPath(root, snapshot.filePath);
    }

    if (!fileUri) {
        outputChannel.appendLine('[openDiff] Error: Could not determine file path.');
        vscode.window.showErrorMessage('Could not determine file path.');
        return;
    }

    const ext = path.extname(fileUri.fsPath) || '.txt';

    if (!snapshot.relevantRange && !currentSelection) {
         try {
            const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
            outputChannel.appendLine(`[openDiff] Opening full diff between ${snapshotUri.fsPath} and ${fileUri.fsPath}`);
            await vscode.commands.executeCommand(
                'vscode.diff',
                snapshotUri,
                fileUri,
                `Chronos: ${new Date(snapshot.timestamp).toLocaleString()} ↔ Current`
            );
        } catch (e) {
            outputChannel.appendLine(`[openDiff] Error opening full diff: ${e}`);
            vscode.window.showErrorMessage('Could not open diff.');
        }
        return;
    }

    try {
        const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
        const snapshotContent = (await vscode.workspace.fs.readFile(snapshotUri)).toString();
        const currentContent = (await vscode.workspace.fs.readFile(fileUri)).toString();

        const snapRange = snapshot.relevantRange;
        const currRange = currentSelection;

        if (!snapRange || !currRange) {
             outputChannel.appendLine('[openDiff] Missing range info, falling back to full diff');
             vscode.window.showWarningMessage('Missing range information for selection diff. showing full file.');
             const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
             await vscode.commands.executeCommand('vscode.diff', snapshotUri, fileUri, `Chronos: ${new Date(snapshot.timestamp).toLocaleString()} ↔ Current`);
             return;
        }

        const snapLines = snapshotContent.split('\n').slice(snapRange.start, snapRange.end + 1).join('\n');
        const currLines = currentContent.split('\n').slice(currRange.startLine, currRange.endLine + 1).join('\n');

        const snapTemp = await createTempFile(`v_${snapshot.id.substring(0,8)}${ext}`, snapLines);
        const currTemp = await createTempFile(`current_selection${ext}`, currLines);

        outputChannel.appendLine(`[openDiff] Created temp selection files: ${snapTemp.fsPath}, ${currTemp.fsPath}`);

        await vscode.commands.executeCommand(
            'vscode.diff',
            snapTemp,
            currTemp,
            `Selection: ${new Date(snapshot.timestamp).toLocaleString()} ↔ Current`
        );

    } catch (e) {
        outputChannel.appendLine(`[openDiff] Error preparing selection diff: ${e}`);
        vscode.window.showErrorMessage('Error preparing selection diff: ' + e);
    }
}

async function openDiffGit(commit: GitCommit, filePath: string) {
    outputChannel.appendLine(`[openDiffGit] Called for commit ${commit?.hash}`);
    
    if (!commit) {
        outputChannel.appendLine('[openDiffGit] Error: Commit object is null/undefined');
        vscode.window.showErrorMessage('Internal Error: Invalid commit object.');
        return;
    }

    if (commit.diff === undefined || commit.diff === null) {
        outputChannel.appendLine('[openDiffGit] Error: commit.diff is null/undefined');
        vscode.window.showErrorMessage('No diff content found for this commit.');
        return;
    }

    const diffPreview = commit.diff.length > 100 ? commit.diff.substring(0, 100) + '...' : commit.diff;
    outputChannel.appendLine(`[openDiffGit] Diff content preview: ${diffPreview.replace(/\n/g, '\\n')}`);

    const ext = path.extname(filePath) || '.txt';

    try {
        const lines = commit.diff.split('\n');
        let leftContent = '';
        let rightContent = '';
        
        outputChannel.appendLine(`[openDiffGit] Parsing ${lines.length} lines of diff`);

        for (const line of lines) {
            if (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('@@') && line.length > 0) {
                 outputChannel.appendLine(`[openDiffGit] Unrecognized line prefix: "${line.substring(0, 10)}"..."`);
            }

            if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
                continue;
            }
            if (line.startsWith('-')) {
                leftContent += line.substring(1) + '\n';
            } else if (line.startsWith('+')) {
                rightContent += line.substring(1) + '\n';
            } else {
                leftContent += line.substring(1) + '\n';
                rightContent += line.substring(1) + '\n';
            }
        }
        
        outputChannel.appendLine(`[openDiffGit] Left content size: ${leftContent.length}, Right content size: ${rightContent.length}`);

        const leftTemp = await createTempFile(`git_${commit.hash.substring(0,7)}_before${ext}`, leftContent);
        const rightTemp = await createTempFile(`git_${commit.hash.substring(0,7)}_after${ext}`, rightContent);
        
        outputChannel.appendLine(`[openDiffGit] Opening diff between ${leftTemp.fsPath} and ${rightTemp.fsPath}`);

        await vscode.commands.executeCommand(
            'vscode.diff',
            leftTemp,
            rightTemp,
            `Git: ${commit.hash.substring(0,7)} (${commit.message.trim()})`
        );

    } catch (e) {
        outputChannel.appendLine(`[openDiffGit] Critical Error: ${e}`);
        if (e instanceof Error) {
            outputChannel.appendLine(e.stack || '');
        }
        outputChannel.show(true); 
        vscode.window.showErrorMessage('Error parsing git diff: ' + e);
    }
}

async function restoreDeletedFile(item: DeletedFileItem) {
    if (!vscode.workspace.workspaceFolders) return;
    const root = vscode.workspace.workspaceFolders[0].uri;
    const fileUri = vscode.Uri.joinPath(root, item.filePath);

    const history = await storage.getHistoryForFile(fileUri);
    if (history.length === 0) {
        vscode.window.showErrorMessage('No history found for this file.');
        return;
    }
    
    const snapshot = history[0]; 
    const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
    const content = await vscode.workspace.fs.readFile(snapshotUri);
    
    await vscode.workspace.fs.writeFile(fileUri, content);
    vscode.window.showInformationMessage(`Restored ${item.filePath}`);
    deletedFilesProvider.refresh();
}

async function previewDeletedFile(item: DeletedFileItem) {
    if (!vscode.workspace.workspaceFolders) return;
    const root = vscode.workspace.workspaceFolders[0].uri;
    const fileUri = vscode.Uri.joinPath(root, item.filePath);

    const history = await storage.getHistoryForFile(fileUri);
    if (history.length === 0) {
        vscode.window.showErrorMessage('No history found for this file.');
        return;
    }
    
    const snapshot = history[0];
    const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
    const doc = await vscode.workspace.openTextDocument(snapshotUri);
    await vscode.window.showTextDocument(doc, { preview: true });
}

async function ensureStorage() {
    await storage.init();
}

async function getDiffForSnapshot(snapshot: Snapshot, contextFileUri: vscode.Uri | undefined): Promise<string> {
    await ensureStorage();
    
    let fileUri = contextFileUri;
    if (snapshot.filePath && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const root = vscode.workspace.workspaceFolders[0].uri;
        fileUri = vscode.Uri.joinPath(root, snapshot.filePath);
    }
    
    if (!fileUri) return 'Cannot determine file path for snapshot.';

    const fileHistory = await storage.getHistoryForFile(fileUri);
    const index = fileHistory.findIndex(s => s.id === snapshot.id);

    if (index === -1) {
         return 'Snapshot not found in file history index.';
    }

    let prevPath = '';
    if (index === fileHistory.length - 1) {
         prevPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
    } else {
         const prevSnapshot = fileHistory[index + 1];
         if (!prevSnapshot.storagePath) return 'Previous snapshot content unavailable.';
         prevPath = (await storage.getSnapshotUri(prevSnapshot, fileUri)).fsPath;
    }

    if (!snapshot.storagePath) return 'Snapshot has no content.';
    const currentPath = (await storage.getSnapshotUri(snapshot, fileUri)).fsPath;

    let diff = await gitService.getDiff(prevPath, currentPath);

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    const relativePath = workspaceFolder 
        ? path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath)
        : path.basename(fileUri.fsPath);

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\\]/g, '\\$&');
    
    diff = diff.replace(new RegExp(escapeRegex(prevPath), 'g'), 'a/' + relativePath);
    diff = diff.replace(new RegExp(escapeRegex(currentPath), 'g'), 'b/' + relativePath);

    return diff;
}

async function showHistory(uri?: vscode.Uri, selection?: vscode.Range) {
    outputChannel.appendLine('[showHistory] Command triggered');
    await ensureStorage();
    if (!uri) {
        uri = vscode.window.activeTextEditor?.document.uri;
    }
    if (!uri) return;

    const history = await storage.getHistoryForFile(uri);
    
    if (history.length === 0) {
        vscode.window.showInformationMessage('No Chronos history found for this file.');
    }
    
    const diffProvider = (s: Snapshot) => getDiffForSnapshot(s, uri);
    const onSearch = (query: string) => storage.search(query);
    
    viewProvider.show(history, uri, diffProvider, selection, onSearch);
}

async function showHistoryForSelection() {
    outputChannel.appendLine('[showHistoryForSelection] Command triggered');
    await ensureStorage();
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const uri = editor.document.uri;
    const history = await storage.getHistoryForFile(uri);

    if (history.length === 0) {
        vscode.window.showInformationMessage('No Chronos history found for this file.');
        return;
    }

    try {
        const filteredHistory = await historyFilter.filterHistoryForSelection(history, uri, editor.selection);
        outputChannel.appendLine(`[showHistoryForSelection] Found ${filteredHistory.length} snapshots`);
        
        if (filteredHistory.length === 0) {
            vscode.window.showInformationMessage('No history found for this selection.');
            return;
        }

        const diffProvider = (s: Snapshot) => getDiffForSnapshot(s, uri);
        const onSearch = (query: string) => storage.search(query);
        
        viewProvider.show(filteredHistory, uri, diffProvider, editor.selection, onSearch);
    } catch (e) {
        console.error('Error filtering history:', e);
        vscode.window.showErrorMessage('Failed to filter history for selection.');
    }
}

async function showProjectHistory() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    const diffProvider = (s: Snapshot) => getDiffForSnapshot(s, undefined);
    const onSearch = (query: string) => storage.search(query);
    viewProvider.show(history, undefined, diffProvider, undefined, onSearch);
}

async function showRecentChanges() {
    await ensureStorage();
    const history = await storage.getProjectHistory();
    const diffProvider = (s: Snapshot) => getDiffForSnapshot(s, undefined);
    const onSearch = (query: string) => storage.search(query);
    viewProvider.show(history.slice(0, 20), undefined, diffProvider, undefined, onSearch);
}

async function putLabel() {
    await ensureStorage();
    const name = await vscode.window.showInputBox({ prompt: 'Label Name' });
    if (!name) return;
    const desc = await vscode.window.showInputBox({ prompt: 'Description (optional)' });
    
    const editor = vscode.window.activeTextEditor;
    await manager.putLabel(name, desc, editor?.document);
}

async function compareToCurrent(snapshotId: string, filePath?: string) {
    await ensureStorage();
    
    let fileUri: vscode.Uri | undefined;
    if (filePath && vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            const candidate = vscode.Uri.joinPath(folder.uri, filePath);
            try {
                await vscode.workspace.fs.stat(candidate);
                fileUri = candidate;
                break;
            } catch {}
        }
    }

    if (!fileUri) {
        fileUri = vscode.window.activeTextEditor?.document.uri;
    }
    
    if (!fileUri) return;

    const history = await storage.getHistoryForFile(fileUri);
    const snapshot = history.find(s => s.id === snapshotId);
    if (!snapshot) return;

    try {
        const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
        await vscode.commands.executeCommand(
            'vscode.diff',
            snapshotUri,
            fileUri,
            `Chronos: ${new Date(snapshot.timestamp).toLocaleString()} vs Current`
        );
    } catch (e) {
        vscode.window.showErrorMessage('Could not open diff.');
    }
}

async function restoreSnapshot(snapshotId: string, filePath?: string) {
    await ensureStorage();
    
    let fileUri: vscode.Uri | undefined;
    if (filePath && vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            const candidate = vscode.Uri.joinPath(folder.uri, filePath);
            try {
                await vscode.workspace.fs.stat(candidate);
                fileUri = candidate;
                break;
            } catch {}
        }
    }

    if (!fileUri) {
        fileUri = vscode.window.activeTextEditor?.document.uri;
    }

    if (!fileUri) return;

    const history = await storage.getHistoryForFile(fileUri);
    const snapshot = history.find(s => s.id === snapshotId);
    if (!snapshot) return;

    const snapshotUri = await storage.getSnapshotUri(snapshot, fileUri);
    const content = await vscode.workspace.fs.readFile(snapshotUri);
    
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc);

    const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(fileUri, fullRange, new TextDecoder().decode(content));
    await vscode.workspace.applyEdit(edit);
}

async function gitHistoryForSelection() {
    outputChannel.appendLine('[gitHistoryForSelection] Command triggered');
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    if (selection.isEmpty) return;

    const config = vscode.workspace.getConfiguration('gitHistory.selection');
    const gitConfig = {
        maxCommits: config.get<number>('maxCommits', 100),
        followRenames: config.get<boolean>('followRenames', true),
        dateFormat: config.get<string>('dateFormat', 'yyyy-MM-dd HH:mm')
    };

    try {
        outputChannel.appendLine(`[gitHistoryForSelection] Fetching history for ${editor.document.uri.fsPath}`);
        const commits = await gitService.getHistoryForSelection(
            editor.document.uri.fsPath,
            selection.start.line,
            selection.end.line,
            gitConfig
        );
        outputChannel.appendLine(`[gitHistoryForSelection] Found ${commits.length} commits`);
        
        if (commits.length > 0) {
            viewProvider.showGit(commits, editor.document.uri.fsPath);
        } else {
            vscode.window.showInformationMessage('No git history found.');
        }
    } catch (e) {
        outputChannel.appendLine(`[gitHistoryForSelection] Error: ${e}`);
        vscode.window.showErrorMessage('Failed to load git history.');
    }
}

export function deactivate() {}