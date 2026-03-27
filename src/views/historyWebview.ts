import * as vscode from 'vscode';
import { Snapshot, GitCommit } from '../types';

export class HistoryViewProvider {
    public static readonly viewType = 'chronos.historyView';
    private _panel: vscode.WebviewPanel | undefined;

    constructor(private readonly _extensionUri: vscode.Uri, private readonly _outputChannel: vscode.OutputChannel) {}

    private _getSharedStyles() {
        return `
            body { margin: 0; padding: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); font-family: var(--vscode-font-family); height: 100vh; overflow: hidden; display: flex; }
            .container { display: flex; width: 100%; height: 100%; flex-direction: column; min-height: 0; }
            .sidebar { flex: 1; display: flex; flex-direction: column; background-color: var(--vscode-sideBar-background); overflow: hidden; min-height: 0; }
            .list { flex: 1; overflow-y: auto; min-height: 0; }
            .entry { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; position: relative; display: flex; flex-direction: column; gap: 4px; }
            .entry:hover { background-color: var(--vscode-list-hoverBackground); }
            .entry.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .header { display: flex; justify-content: space-between; font-size: 0.85em; margin-bottom: 2px; align-items: center; }
            .event-type { font-weight: bold; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.5px; opacity: 0.8; }
            .label-badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; display: inline-block; font-size: 0.8em; margin: 2px 0; width: fit-content; }
            
            .actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
            .actions button, .jb-btn { 
                background: var(--vscode-button-background); 
                color: var(--vscode-button-foreground); 
                border: none; 
                padding: 0 12px; 
                height: 28px;
                min-width: 60px;
                cursor: pointer; 
                border-radius: 2px; 
                font-size: 0.85em; 
                display: flex;
                align-items: center;
                justify-content: center;
                white-space: nowrap;
            }
            .actions button:hover, .jb-btn:hover { background: var(--vscode-button-hoverBackground); }
            
            .explanation-box { margin-top: 10px; padding: 12px; background-color: var(--vscode-editor-lineHighlightBackground); border-radius: 4px; font-size: 0.9em; display: none; white-space: pre-wrap; position: relative; }
            .explanation-close { position: absolute; top: 4px; right: 8px; cursor: pointer; opacity: 0.6; font-weight: bold; }
            
            .diff-container { display: none; flex: 1; flex-direction: column; overflow: hidden; background: var(--vscode-editor-background); }
            .diff-header { padding: 4px 8px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); font-size: 0.85em; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
            #diffTitle { color: var(--vscode-textLink-foreground); letter-spacing: 0.5px; text-transform: uppercase; font-size: 0.85em; }
            .diff-content { flex: 1; overflow: auto; padding: 0; font-family: var(--vscode-editor-font-family); font-size: 0.9em; line-height: 1.4; position: relative; }
            .diff-sbs-wrapper { display: flex; width: 100%; height: 100%; overflow: hidden; }
            .diff-sbs-side { flex: 1; overflow: auto; display: flex; flex-direction: column; border-right: 1px solid var(--vscode-panel-border); }
            .diff-sbs-side:last-child { border-right: none; }
            .diff-sbs-title { padding: 2px 8px; font-size: 0.75em; opacity: 0.6; background: var(--vscode-editor-lineHighlightBackground); border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; z-index: 5; }
            .diff-table { width: 100%; border-collapse: collapse; white-space: pre; table-layout: fixed; }
            .diff-line { display: flex; width: 100%; min-height: 1.4em; }
            .diff-line-num { width: 35px; min-width: 35px; text-align: right; padding-right: 5px; opacity: 0.4; user-select: none; border-right: 1px solid var(--vscode-panel-border); font-size: 0.75em; }
            .diff-line-content { flex: 1; padding-left: 5px; overflow-x: auto; white-space: pre; }
            .diff-line.added { background-color: var(--vscode-diffEditor-insertedTextBackground); }
            .diff-line.removed { background-color: var(--vscode-diffEditor-removedTextBackground); }
            .diff-line.empty { background-color: var(--vscode-editor-background); opacity: 0.3; }
            .diff-line.header { background-color: var(--vscode-editor-lineHighlightBackground); font-weight: bold; opacity: 0.8; font-size: 0.85em; }
            
            .btn-action { 
                background: var(--vscode-button-background); 
                color: var(--vscode-button-foreground); 
                border: none; 
                padding: 0 8px; 
                height: 28px;
                cursor: pointer; 
                border-radius: 2px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.85em;
            }
            .btn-action.active { background: var(--vscode-textLink-foreground); }
            
            .diff-info-bar { background: var(--vscode-sideBar-background); padding: 8px 16px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 16px; font-size: 0.9em; border-left: 4px solid var(--vscode-textLink-foreground); }
            .diff-info-path { font-family: var(--vscode-editor-font-family); opacity: 0.8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em; }
            .diff-info-filename { font-weight: bold; color: var(--vscode-textLink-foreground); margin-right: 8px; }
            
            /* JetBrains Table Styles */
            .jb-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .jb-th { 
                padding: 4px 8px; 
                text-align: left; 
                font-size: 0.8em; 
                font-weight: bold; 
                background: var(--vscode-sideBar-background); 
                border-bottom: 1px solid var(--vscode-panel-border); 
                position: sticky; 
                top: 0; 
                z-index: 10;
                cursor: pointer;
                user-select: none;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .jb-th:hover { background: var(--vscode-list-hoverBackground); }
            .jb-th.active-sort { color: var(--vscode-textLink-foreground); }
            .jb-td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.85em; }
            .jb-tr { cursor: pointer; border-bottom: 1px solid rgba(128,128,128,0.05); }
            .jb-tr:hover { background-color: var(--vscode-list-hoverBackground); }
            .jb-tr.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .jb-details-pane { width: 300px; display: none; flex-direction: column; padding: 12px; background: var(--vscode-sideBar-background); border-left: 1px solid var(--vscode-panel-border); overflow-y: auto; min-height: 0; }
        `;
    }

    public show(snapshots: any[], currentFileUri: vscode.Uri | undefined, getDiff?: any, selection?: vscode.Range, onSearch?: any, onExplain?: any, onSemanticSearch?: any, onTogglePin?: any, onCompareSnapshots?: any, onPutLabel?: (name: string, filePath: string) => void, aiConfigured: boolean = false) {
        const config = vscode.workspace.getConfiguration('chronos');
        const useJetBrains = config.get('ui.useJetBrainsStyle', true);
        const enableHtmlPreview = config.get('diff.enableHtmlPreview', true);
        const htmlLayout = config.get('diff.htmlPreviewLayout', 'side-by-side');
        const htmlPosition = config.get('diff.htmlPreviewPosition', 'top');
        const isSyncScroll = config.get('diff.syncScroll', true);
        const defaultAction = config.get('diff.defaultAction', 'openDiff');

        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
        } else {
            this._panel = vscode.window.createWebviewPanel(HistoryViewProvider.viewType, 'Chronos History', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [this._extensionUri], retainContextWhenHidden: true });
            this._panel.onDidDispose(() => { this._panel = undefined; });
        }

        const panel = this._panel;
        panel.webview.html = this._getHtmlForWebview(useJetBrains, enableHtmlPreview, htmlLayout, htmlPosition, isSyncScroll);
        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'ready':
                    panel.webview.postMessage({ command: 'readyConfig', htmlLayout, htmlPosition, isSyncScroll, defaultAction });
                    panel.webview.postMessage({ command: 'loadHistory', snapshots, selection: selection ? { startLine: selection.start.line, endLine: selection.end.line } : null, filePath: currentFileUri ? currentFileUri.fsPath : '', explainEnabled: !!onExplain, aiConfigured, enableHtmlPreview, defaultAction });
                    return;
                case 'openDiff': 
                    if (enableHtmlPreview && getDiff && message.action !== 'openNative') {
                        if (defaultAction === 'openDiff' && !message.forcePreview) {
                            vscode.commands.executeCommand('_chronos.openDiff', message.snapshot, message.baseFilePath, message.currentSelection);
                            return;
                        }
                        const diff = await getDiff(message.snapshot);
                        panel.webview.postMessage({ command: 'showHtmlDiff', diff, title: (message.snapshot.label || 'Snapshot') + ' Diff', params: { type: 'snapshot', snapshot: message.snapshot, baseFilePath: message.baseFilePath, selection: message.currentSelection } });
                    } else {
                        vscode.commands.executeCommand('_chronos.openDiff', message.snapshot, message.baseFilePath, message.currentSelection); 
                    }
                    return;
                case 'explain': if (onExplain) { const text = await onExplain(message.snapshot); panel.webview.postMessage({ command: 'explainResult', text }); } return;
                case 'restore': vscode.commands.executeCommand('chronos.restoreSnapshot', message.snapshotId, message.filePath); return;
                case 'share': vscode.commands.executeCommand('chronos.shareSnapshot', message.snapshot); return;
                case 'compareWithActive': vscode.commands.executeCommand('chronos.compareWithActive', message.snapshot); return;
                case 'compareWithBranch':
                    let branches = await vscode.commands.executeCommand<string[]>('_chronos.getBranches', message.filePath);
                    if (branches && branches.length > 0) {
                        const filterLabel = "$(filter) Filter by file changes";
                        const items = [filterLabel, ...branches];
                        let selectedBranch = await vscode.window.showQuickPick(items, { placeHolder: 'Select branch to compare with' });
                        
                        if (selectedBranch === filterLabel) {
                            await vscode.window.withProgress({
                                location: vscode.ProgressLocation.Notification,
                                title: "Filtering branches...",
                                cancellable: false
                            }, async () => {
                                branches = await vscode.commands.executeCommand<string[]>('_chronos.getBranches', message.filePath, true);
                            });
                            
                            if (branches.length === 0) {
                                vscode.window.showInformationMessage('No branches found with changes to this file.');
                                return;
                            }
                            selectedBranch = await vscode.window.showQuickPick(branches, { placeHolder: 'Select branch with changes to this file' });
                        }

                        if (selectedBranch && enableHtmlPreview) {
                            const diff = await vscode.commands.executeCommand<string>('_chronos.getDiffSnapshotWithBranch', message.snapshot, selectedBranch);
                            panel.webview.postMessage({ command: 'showHtmlDiff', diff, title: 'Snapshot ↔ Branch: ' + selectedBranch, params: { type: 'snapshotWithBranch', snapshot: message.snapshot, branch: selectedBranch } });
                        }
                    }
                    return;
                case 'compareWithBranchVersion':
                    vscode.commands.executeCommand('chronos.compareWithBranchVersion', { snapshot: message.snapshot, commit: message.commit, filePath: message.filePath });
                    return;
                case 'openNativeDiff':
                    if (message.params.type === 'snapshot') vscode.commands.executeCommand('_chronos.openDiff', message.params.snapshot, message.params.baseFilePath, message.params.selection);
                    else if (message.params.type === 'snapshotWithBranch') vscode.commands.executeCommand('chronos.compareSnapshotWithBranch', message.params.snapshot, message.params.branch);
                    else if (message.params.type === 'commitWithBranch') vscode.commands.executeCommand('chronos.compareCommitWithBranch', message.params.commit, message.params.branch, message.params.filePath);
                    else if (message.params.type === 'commit') {
                        if (message.params.compareWithCurrent) vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.params.commit, message.params.filePath, message.params.selection);
                        else vscode.commands.executeCommand('_chronos.openDiffGit', message.params.commit, message.params.filePath);
                    }
                    return;
                case 'putLabel': if (onPutLabel) onPutLabel(message.name, message.filePath); return;
                case 'updateLayout': vscode.workspace.getConfiguration('chronos').update('diff.htmlPreviewLayout', message.layout, vscode.ConfigurationTarget.Global); return;
                case 'updateSync': vscode.workspace.getConfiguration('chronos').update('diff.syncScroll', message.sync, vscode.ConfigurationTarget.Global); return;
                case 'savePatch': vscode.commands.executeCommand('_chronos.savePatch', message.diffText); return;
            }
        });
    }

    public updateSnapshots(snapshots: any[]) {
        if (this._panel) {
            this._panel.webview.postMessage({ command: 'loadHistory', snapshots });
        }
    }

    public showGit(commits: GitCommit[], filePath: string, selection: {startLine: number, endLine: number}, onExplain?: (c: GitCommit) => Promise<string>, onCompare?: (h1: string, h2: string) => Promise<string>, aiConfigured: boolean = false) {
        const config = vscode.workspace.getConfiguration('chronos');
        const useJetBrains = config.get('ui.useJetBrainsStyle', true);
        const enableHtmlPreview = config.get('diff.enableHtmlPreview', true);
        const htmlLayout = config.get('diff.htmlPreviewLayout', 'side-by-side');
        const htmlPosition = config.get('diff.htmlPreviewPosition', 'top');
        const isSyncScroll = config.get('diff.syncScroll', true);
        const defaultAction = config.get('diff.defaultAction', 'openDiff');

        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
        } else {
            this._panel = vscode.window.createWebviewPanel(HistoryViewProvider.viewType, 'Git History', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [this._extensionUri], retainContextWhenHidden: true });
            this._panel.onDidDispose(() => { this._panel = undefined; });
        }

        const panel = this._panel;
        panel.webview.html = this._getGitHtml(useJetBrains, enableHtmlPreview, htmlLayout, htmlPosition, isSyncScroll, defaultAction);
        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'ready':
                    panel.webview.postMessage({ command: 'readyConfig', htmlLayout, htmlPosition, isSyncScroll, defaultAction });
                    panel.webview.postMessage({ command: 'loadCommits', commits, filePath, selection, explainEnabled: !!onExplain, aiConfigured, enableHtmlPreview, defaultAction });
                    return;
                case 'openDiff':
                    if (enableHtmlPreview && onCompare && !message.compareWithCurrent && message.action !== 'openNative') {
                        if (defaultAction === 'openDiff' && !message.forcePreview) {
                            vscode.commands.executeCommand('_chronos.openDiffGit', message.commit, filePath);
                            return;
                        }
                        const diff = message.commit.diff || await onCompare(message.commit.hash + '^', message.commit.hash);
                        panel.webview.postMessage({ command: 'showHtmlDiff', diff, title: 'Commit ' + message.commit.hash.substring(0, 7), params: { type: 'commit', commit: message.commit, filePath, selection, compareWithCurrent: false } });
                    } else {
                        if (message.compareWithCurrent) vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.commit, filePath, selection);
                        else vscode.commands.executeCommand('_chronos.openDiffGit', message.commit, filePath);
                    }
                    return;
                case 'openNativeDiff':
                    if (message.params.type === 'commitWithBranch') {
                        vscode.commands.executeCommand('chronos.compareCommitWithBranch', message.params.commit, message.params.branch, message.params.filePath);
                    } else if (message.params.type === 'commit') {
                        if (message.params.compareWithCurrent) vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.params.commit, message.params.filePath, message.params.selection);
                        else vscode.commands.executeCommand('_chronos.openDiffGit', message.params.commit, message.params.filePath);
                    }
                    return;
                case 'explain': if (onExplain) { const text = await onExplain(message.commit); panel.webview.postMessage({ command: 'explainResult', text }); } return;
                case 'compareWithBranch':
                    let branches = await vscode.commands.executeCommand<string[]>('_chronos.getBranches', filePath);
                    if (branches && branches.length > 0) {
                        const filterLabel = "$(filter) Filter by file changes";
                        const items = [filterLabel, ...branches];
                        let selectedBranch = await vscode.window.showQuickPick(items, { placeHolder: 'Select branch to compare with' });

                        if (selectedBranch === filterLabel) {
                            await vscode.window.withProgress({
                                location: vscode.ProgressLocation.Notification,
                                title: "Filtering branches...",
                                cancellable: false
                            }, async () => {
                                branches = await vscode.commands.executeCommand<string[]>('_chronos.getBranches', filePath, true);
                            });

                            if (branches.length === 0) {
                                vscode.window.showInformationMessage('No branches found with changes to this file.');
                                return;
                            }
                            selectedBranch = await vscode.window.showQuickPick(branches, { placeHolder: 'Select branch with changes to this file' });
                        }

                        if (selectedBranch && enableHtmlPreview) {
                            const diff = await vscode.commands.executeCommand<string>('_chronos.getDiffCommitWithBranch', message.commit, selectedBranch, filePath);
                            panel.webview.postMessage({ command: 'showHtmlDiff', diff, title: 'Commit ↔ Branch: ' + selectedBranch, params: { type: 'commitWithBranch', commit: message.commit, branch: selectedBranch, filePath: filePath } });
                        }
                    }
                    return;
                case 'compareWithBranchVersion': vscode.commands.executeCommand('chronos.compareWithBranchVersion', { commit: message.commit, filePath: filePath }); return;
                case 'updateLayout': vscode.workspace.getConfiguration('chronos').update('diff.htmlPreviewLayout', message.layout, vscode.ConfigurationTarget.Global); return;
                case 'updateSync': vscode.workspace.getConfiguration('chronos').update('diff.syncScroll', message.sync, vscode.ConfigurationTarget.Global); return;
                case 'savePatch': vscode.commands.executeCommand('_chronos.savePatch', message.diffText); return;
            }
        });
    }

    private _getHtmlForWebview(useJetBrains: boolean, enableHtmlPreview: boolean, htmlLayout: string, htmlPosition: string, isSyncScroll: boolean, defaultAction: string = 'openDiff') {
        const styles = this._getSharedStyles();
        const containerFlex = htmlPosition === 'top' || htmlPosition === 'bottom' ? 'column' : 'row';
        const diffOrder = htmlPosition === 'top' ? '-1' : '1';
        const sidebarStyle = htmlPosition === 'top' || htmlPosition === 'bottom' ? 'max-width: 100%; border-right: none;' : 'max-width: 400px; border-right: 1px solid var(--vscode-panel-border);';

        const sharedScript = `
            window.closeDiff = () => { document.getElementById('diffContainer').style.display = 'none'; };
            let htmlLayout = '${htmlLayout}';
            let isSyncScroll = ${isSyncScroll};
            let defaultAction = '${defaultAction}';
            let lastDiffText = '', lastDiffTitle = '';
            let lastCompareParams = null;

            window.addEventListener('message', event => {
                if (event.data.command === 'readyConfig') {
                    htmlLayout = event.data.htmlLayout; 
                    isSyncScroll = event.data.isSyncScroll; 
                    defaultAction = event.data.defaultAction || defaultAction;
                    updateLayoutButtons();
                }
            });

            function updateLayoutButtons() {
                document.querySelectorAll('.btn-sbs').forEach(btn => {
                    btn.classList.toggle('active', htmlLayout === 'side-by-side');
                    btn.onclick = () => { if (htmlLayout === 'side-by-side') return; htmlLayout = 'side-by-side'; updateLayoutButtons(); if (lastDiffText) renderDiff(lastDiffText, lastDiffTitle); vscode.postMessage({ command: 'updateLayout', layout: 'side-by-side' }); };
                });
                document.querySelectorAll('.btn-unified').forEach(btn => {
                    btn.classList.toggle('active', htmlLayout === 'unified');
                    btn.onclick = () => { if (htmlLayout === 'unified') return; htmlLayout = 'unified'; updateLayoutButtons(); if (lastDiffText) renderDiff(lastDiffText, lastDiffTitle); vscode.postMessage({ command: 'updateLayout', layout: 'unified' }); };
                });
                
                const syncBtns = document.querySelectorAll('.btn-toggle-sync');
                syncBtns.forEach(btn => {
                    btn.textContent = 'Sync: ' + (isSyncScroll ? 'ON' : 'OFF');
                    btn.classList.toggle('active', isSyncScroll);
                    btn.onclick = () => { isSyncScroll = !isSyncScroll; updateLayoutButtons(); vscode.postMessage({ command: 'updateSync', sync: isSyncScroll }); };
                });
                const nativeBtns = document.querySelectorAll('.btn-open-native');
                nativeBtns.forEach(btn => {
                    btn.style.display = defaultAction === 'openDiff' ? 'none' : 'flex';
                    btn.onclick = () => { if (lastCompareParams) vscode.postMessage({ command: 'openNativeDiff', params: lastCompareParams }); };
                });
                const savePatchBtns = document.querySelectorAll('.btn-save-patch');
                savePatchBtns.forEach(btn => {
                    btn.onclick = () => { if (lastDiffText) vscode.postMessage({ command: 'savePatch', diffText: lastDiffText }); };
                });
            }

            function renderDiff(diffText, title, params) {
                lastDiffText = diffText; lastDiffTitle = title; if (params) lastCompareParams = params;
                const container = document.getElementById('diffContainer'); const content = document.getElementById('diffContent');
                if (container) container.style.display = 'flex';
                if (document.getElementById('diffTitle')) document.getElementById('diffTitle').textContent = title;
                
                const infoBar = document.getElementById('diffInfoBar');
                const infoTag = document.getElementById('diffInfoTag');
                const infoPath = document.getElementById('diffInfoPath');
                if (infoBar) {
                    infoBar.style.display = 'flex';
                    if (params) {
                        if (infoTag) infoTag.textContent = params.type === 'snapshot' ? 'SNAPSHOT' : 'COMMIT ' + (params.commit ? params.commit.hash.substring(0,7) : 'DIFF');
                        if (infoPath) infoPath.textContent = params.baseFilePath || params.filePath || '';
                    }
                }

                if (!diffText || diffText.trim() === '') {
                    content.innerHTML = '<div style="padding: 20px; opacity: 0.5;">No differences found.</div>';
                    if (infoBar) infoBar.style.display = 'none';
                    return;
                }

                const lines = diffText.split('\\n').filter(l => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('index '));
                if (htmlLayout === 'unified') {
                    let html = '<table class="diff-table" style="table-layout: auto;">';
                    let leftLine = 0, rightLine = 0;
                    lines.forEach(line => {
                        let cls = 'context';
                        if (line.startsWith("+")) { cls = "added"; rightLine++; }
                        else if (line.startsWith("-")) { cls = "removed"; leftLine++; }
                        else if (line.startsWith("@@")) { 
                            cls = "header"; 
                            const match = line.match(new RegExp('-(\\\\d+),?\\\\d* \\\\+(\\\\d+),?\\\\d*'));
                            if (match) { leftLine = parseInt(match[1]) - 1; rightLine = parseInt(match[2]) - 1; }
                        }
                        else { leftLine++; rightLine++; }
                        html += '<tr class="diff-line ' + cls + '"><td class="diff-line-num">' + (cls === "added" ? "" : leftLine) + '</td><td class="diff-line-num">' + (cls === "removed" ? "" : rightLine) + '</td><td class="diff-line-content">' + escapeHtml(line) + '</td></tr>';
                    });
                    content.innerHTML = html + '</table>';
                } else {
                    let leftHtml = '', rightHtml = ''; let leftLine = 0, rightLine = 0;
                    lines.forEach(line => {
                        if (line.startsWith('@@')) {
                            const match = line.match(new RegExp('-(\\\\d+),?\\\\d* \\\\+(\\\\d+),?\\\\d*'));
                            if (match) { leftLine = parseInt(match[1]) - 1; rightLine = parseInt(match[2]) - 1; }
                            leftHtml += '<div class="diff-line header"><div class="diff-line-num"></div><div class="diff-line-content">' + escapeHtml(line) + '</div></div>';
                            rightHtml += '<div class="diff-line header"><div class="diff-line-num"></div><div class="diff-line-content">' + escapeHtml(line) + '</div></div>';
                        } else if (line.startsWith('-')) {
                            leftLine++; leftHtml += '<div class="diff-line removed"><div class="diff-line-num">' + leftLine + '</div><div class="diff-line-content">' + escapeHtml(line.substring(1)) + '</div></div>';
                            rightHtml += '<div class="diff-line empty"><div class="diff-line-num"></div><div class="diff-line-content"></div></div>';
                        } else if (line.startsWith('+')) {
                            rightLine++; rightHtml += '<div class="diff-line added"><div class="diff-line-num">' + rightLine + '</div><div class="diff-line-content">' + escapeHtml(line.substring(1)) + '</div></div>';
                            leftHtml += '<div class="diff-line empty"><div class="diff-line-num"></div><div class="diff-line-content"></div></div>';
                        } else {
                            leftLine++; rightLine++;
                            const text = line.startsWith(' ') ? line.substring(1) : line;
                            leftHtml += '<div class="diff-line"><div class="diff-line-num">' + leftLine + '</div><div class="diff-line-content">' + escapeHtml(text) + '</div></div>';
                            rightHtml += '<div class="diff-line"><div class="diff-line-num">' + rightLine + '</div><div class="diff-line-content">' + escapeHtml(text) + '</div></div>';
                        }
                    });
                    let leftHeader = '<div class="diff-sbs-title">Original</div>';
                    let rightHeader = '<div class="diff-sbs-title">Modified</div>';
                    content.innerHTML = '<div class="diff-sbs-wrapper"><div class="diff-sbs-side" id="diffLeft">' + leftHeader + leftHtml + '</div><div class="diff-sbs-side" id="diffRight">' + rightHeader + rightHtml + '</div></div>';
                    const l = document.getElementById('diffLeft'), r = document.getElementById('diffRight');
                    if (l && r) {
                        l.onscroll = () => { if (!isSyncScroll) return; r.scrollTop = l.scrollTop; r.scrollLeft = l.scrollLeft; };
                        r.onscroll = () => { if (!isSyncScroll) return; l.scrollTop = r.scrollTop; l.scrollLeft = r.scrollLeft; };
                    }
                }
            }
            function escapeHtml(unsafe) { if (!unsafe) return ""; return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
        `;

        const diffHeaderHtml = `
            <div class="diff-header"><span id="diffTitle">Differences</span>
                <div style="display: flex; gap: 4px; align-items: center;">
                    <div style="display: flex; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden; margin-right: 4px;">
                        <button class="btn-action btn-sbs" title="Side-by-Side View">◫</button>
                        <button class="btn-action btn-unified" title="Unified View">☰</button>
                    </div>
                    <button class="btn-action btn-toggle-sync" style="padding: 2px 4px; font-size: 0.75em; height: 28px;"></button>
                    <button class="btn-action btn-save-patch" title="Save Patch" style="padding: 2px 4px; font-size: 0.75em; height: 28px;">Save</button>
                    <button class="btn-action btn-open-native" title="Open in VS Code" style="padding: 2px 4px; font-size: 0.75em; height: 28px;">Open in Editor ↗</button>
                    <button onclick="closeDiff()" class="btn-action" style="padding: 2px 4px; background: transparent; color: var(--vscode-foreground); min-width: 24px; height: 28px;">✕</button>
                </div>
            </div>
            <div id="diffInfoBar" class="diff-info-bar" style="display: none;"><span id="diffInfoTag" class="diff-info-tag"></span><span id="diffInfoPath" class="diff-info-path" style="margin-left:10px; font-family:monospace; opacity:0.8;"></span><span id="diffInfoRange" class="diff-info-range"></span></div>`;

        if (!useJetBrains) {
            const script = `(function() { const vscode = acquireVsCodeApi(); ${sharedScript} 
                let snapshots = [], currentSelection = null, baseFilePath = '', explainEnabled = false, aiConfigured = false;
                let selectedIndex = -1;
                let currentSort = { column: 'timestamp', direction: 'desc' };

                window.onload = () => { vscode.postMessage({ command: 'ready' }); updateLayoutButtons(); };
                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.command === 'loadHistory') {
                        baseFilePath = msg.filePath; currentSelection = msg.selection; explainEnabled = !!msg.explainEnabled; aiConfigured = !!msg.aiConfigured;
                        const flatItems = [];
                        (msg.snapshots || []).forEach((s, i) => {
                            if (s.type === 'cluster') {
                                s.items.forEach(item => flatItems.push(item));
                            } else {
                                flatItems.push(s);
                            }
                        });
                        snapshots = flatItems.map(item => ({ item, element: null }));
                        renderList();
                    } else if (msg.command === 'showHtmlDiff') { renderDiff(msg.diff, msg.title, msg.params); }
                    else if (msg.command === 'explainResult') { 
                        const box = document.getElementById('explanationBox'); if (box) { box.style.display = 'block'; document.getElementById('explanationText').textContent = msg.text; }
                        document.getElementById('btnExplain').textContent = '✨ Explain';
                    }
                });

                window.sortBy = (column) => {
                    if (currentSort.column === column) {
                        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        currentSort.column = column;
                        currentSort.direction = 'desc';
                    }
                    renderList();
                };

                function renderList() {
                    const el = document.getElementById('list'); el.innerHTML = '';
                    
                    snapshots.sort((a, b) => {
                        let valA, valB;
                        if (currentSort.column === 'timestamp') { valA = a.item.timestamp; valB = b.item.timestamp; }
                        else if (currentSort.column === 'eventType') { valA = a.item.eventType; valB = b.item.eventType; }
                        else { valA = a.item.label || a.item.filePath; valB = b.item.label || b.item.filePath; }
                        
                        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                        return 0;
                    });

                    snapshots.forEach((s, index) => {
                        const entry = createEntry(s.item, index);
                        el.appendChild(entry);
                        s.element = entry;
                    });
                }

                window.addEventListener('keydown', e => {
                    if (e.key === 'ArrowDown') { navigate(1); e.preventDefault(); }
                    else if (e.key === 'ArrowUp') { navigate(-1); e.preventDefault(); }
                });

                function navigate(direction) {
                    if (snapshots.length === 0) return;
                    let next = selectedIndex + direction;
                    if (next < 0) next = 0;
                    if (next >= snapshots.length) next = snapshots.length - 1;
                    if (next !== selectedIndex) {
                        snapshots[next].element.click();
                        snapshots[next].element.scrollIntoView({ block: 'nearest' });
                    }
                }

                function createEntry(s, index) {
                    const div = document.createElement('div'); div.className = 'entry';
                    if (selectedIndex === index) div.classList.add('selected');
                    div.onclick = () => {
                        selectedIndex = index;
                        document.querySelectorAll('.entry').forEach(e => e.classList.remove('selected'));
                        div.classList.add('selected');
                        vscode.postMessage({ command: 'openDiff', snapshot: s, baseFilePath: baseFilePath, currentSelection: currentSelection });
                        updateDetails(s);
                    };
                    const timeStr = new Date(s.timestamp).toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit'});
                    const labelStr = s.label || s.filePath.split(new RegExp('[\\\\\\\\/]', 'g')).pop();
                    div.innerHTML = '<div class="header"><span class="event-type">' + escapeHtml(s.eventType) + '</span><span>' + timeStr + '</span></div><div>' + escapeHtml(labelStr) + '</div>';
                    return div;
                }
            function updateDetails(s) {
                const detailsHeader = document.getElementById('detailsHeader');
                if (detailsHeader) {
                    detailsHeader.style.display = 'flex';
                    detailsHeader.style.alignItems = 'center';
                    detailsHeader.style.justifyContent = 'space-between';
                    detailsHeader.style.padding = '8px 12px';
                    detailsHeader.style.background = 'var(--vscode-editor-lineHighlightBackground)';
                    detailsHeader.style.borderBottom = '1px solid var(--vscode-panel-border)';
                }
                
                const restoreBtn = document.getElementById('btnRestore');
                if (restoreBtn) restoreBtn.onclick = () => vscode.postMessage({ command: 'restore', snapshotId: s.id, filePath: s.filePath });
                
                const branchBtn = document.getElementById('btnBranch');
                if (branchBtn) branchBtn.onclick = () => vscode.postMessage({ command: 'compareWithBranch', filePath: baseFilePath, snapshot: s });
                
                const versionBtn = document.getElementById('btnBranchVersion');
                if (versionBtn) versionBtn.onclick = () => vscode.postMessage({ command: 'compareWithBranchVersion', filePath: baseFilePath, snapshot: s });
                
                const labelBtn = document.getElementById('btnLabel');
                if (labelBtn) labelBtn.onclick = () => { const name = prompt("Enter label:"); if (name) vscode.postMessage({ command: 'putLabel', name, filePath: baseFilePath }); };
                
                const explainBtn = document.getElementById('btnExplain');
                if (explainBtn) {
                    if (explainEnabled) {
                        explainBtn.style.display = 'block';
                        if (!aiConfigured) {
                            explainBtn.textContent = '✨ Explain (Key Required)';
                            explainBtn.style.opacity = '0.5';
                            explainBtn.onclick = () => { alert("Please add a Google Gemini API Key in extension settings to use AI features."); };
                        } else {
                            explainBtn.textContent = '✨ Explain';
                            explainBtn.style.opacity = '1';
                            explainBtn.onclick = () => { explainBtn.textContent = 'Thinking...'; vscode.postMessage({ command: 'explain', snapshot: s }); };
                        }
                    } else explainBtn.style.display = 'none';
                }
            }
        })();`;
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body { margin: 0; display: flex; flex-direction: ${containerFlex}; height: 100vh; font-family: var(--vscode-font-family); color: var(--vscode-foreground); } .jb-main { flex: 1; overflow-y: auto; background: var(--vscode-sideBar-background); min-height: 0; } .list { padding: 10px; } ${styles}</style></head><body><div id="diffContainer" class="diff-container" style="order: ${diffOrder}; flex: 1; min-height: 200px;">${diffHeaderHtml}<div id="detailsHeader" style="display:none;"><div style="display:flex; gap:8px; align-items:center;"><span id="detInfo" style="font-size:0.85em; font-weight:bold; opacity:0.8;"></span></div><div class="actions" style="border:none; padding:0; background:transparent;"><button id="btnRestore">Restore</button><button id="btnBranch">Branch</button><button id="btnBranchVersion">Version</button><button id="btnLabel">Label</button><button id="btnExplain" class="btn-explain">✨ Explain</button></div></div><div id="explanationBox" class="explanation-box" style="margin: 8px 12px;"><div class="explanation-close" onclick="this.parentElement.style.display='none'">✕</div><div id="explanationText"></div></div><div id="diffContent" class="diff-content"></div></div><div class="jb-main" style="${sidebarStyle}"><div id="list" class="list"></div></div><script>${script}</script></body></html>`;        }

        const jbScript = `(function() { const vscode = acquireVsCodeApi(); ${sharedScript}
            let baseFilePath = '', explainEnabled = false, aiConfigured = false;
            let snapshots = [], selectedIndex = -1;
            let currentSort = { column: 'timestamp', direction: 'desc' };

            window.onload = () => { vscode.postMessage({ command: 'ready' }); updateLayoutButtons(); };
            window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.command === 'loadHistory') {
                    baseFilePath = msg.filePath; explainEnabled = !!msg.explainEnabled; aiConfigured = !!msg.aiConfigured;
                    const items = []; (msg.snapshots || []).forEach(s => { if (s.type === 'cluster') items.push(...s.items); else items.push(s); });
                    snapshots = items.map(s => ({ item: s, element: null }));
                    renderList();
                } else if (msg.command === 'showHtmlDiff') { renderDiff(msg.diff, msg.title, msg.params); }
                else if (msg.command === 'explainResult') {
                    document.getElementById('explanationBox').style.display = 'block'; document.getElementById('explanationText').textContent = msg.text;
                    document.getElementById('jbBtnExplain').textContent = '✨ Explain Changes';
                }
            });

            window.sortBy = (column) => {
                if (currentSort.column === column) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = column;
                    currentSort.direction = 'desc';
                }
                renderList();
            };

            function renderList() {
                const el = document.getElementById('list'); el.innerHTML = '';
                
                snapshots.sort((a, b) => {
                    let valA, valB;
                    if (currentSort.column === 'timestamp') { valA = a.item.timestamp; valB = b.item.timestamp; }
                    else if (currentSort.column === 'eventType') { valA = a.item.eventType; valB = b.item.eventType; }
                    else { valA = a.item.label || a.item.filePath; valB = b.item.label || b.item.filePath; }
                    
                    if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                    if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                    return 0;
                });

                snapshots.forEach((s, index) => {
                    const tr = document.createElement('tr'); tr.className = 'jb-tr';
                    if (selectedIndex === index) tr.classList.add('selected');
                    tr.onclick = () => {
                        selectedIndex = index;
                        document.querySelectorAll('.jb-tr').forEach(r => r.classList.remove('selected'));
                        tr.classList.add('selected');
                        vscode.postMessage({ command: 'openDiff', snapshot: s.item, baseFilePath: baseFilePath });
                        updateDetails(s.item);
                    };
                    const timeStr = new Date(s.item.timestamp).toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit'});
                    const labelStr = s.item.label || s.item.filePath.split(new RegExp('[\\\\\\\\/]', 'g')).pop();
                    tr.innerHTML = '<td class="jb-td">' + timeStr + '</td><td class="jb-td">' + escapeHtml(s.item.eventType) + '</td><td class="jb-td">' + escapeHtml(labelStr) + '</td>';
                    el.appendChild(tr);
                    s.element = tr;
                });
                updateSortHeaders();
            }

            function updateSortHeaders() {
                document.querySelectorAll('.jb-th').forEach(th => {
                    th.classList.remove('active-sort');
                    const label = th.dataset.label;
                    if (th.dataset.column === currentSort.column) {
                        th.classList.add('active-sort');
                        th.innerHTML = label + (currentSort.direction === 'asc' ? ' ↑' : ' ↓');
                    } else {
                        th.innerHTML = label;
                    }
                });
            }

            window.addEventListener('keydown', e => {
                if (e.key === 'ArrowDown') { navigate(1); e.preventDefault(); }
                else if (e.key === 'ArrowUp') { navigate(-1); e.preventDefault(); }
            });

            function navigate(direction) {
                if (snapshots.length === 0) return;
                let next = selectedIndex + direction;
                if (next < 0) next = 0;
                if (next >= snapshots.length) next = snapshots.length - 1;
                if (next !== selectedIndex) {
                    snapshots[next].element.click();
                    snapshots[next].element.scrollIntoView({ block: 'nearest' });
                }
            }

            function updateDetails(s) {
                document.getElementById('detailsPane').style.display = 'flex';
                document.getElementById('detTime').textContent = new Date(s.timestamp).toLocaleString();
                document.getElementById('detType').textContent = s.eventType;
                document.getElementById('jbBtnRestore').onclick = () => vscode.postMessage({ command: 'restore', snapshotId: s.id, filePath: s.filePath });
                document.getElementById('jbBtnBranch').onclick = () => vscode.postMessage({ command: 'compareWithBranch', filePath: baseFilePath, snapshot: s });
                document.getElementById('jbBtnBranchVersion').onclick = () => vscode.postMessage({ command: 'compareWithBranchVersion', filePath: baseFilePath, snapshot: s });
                if (explainEnabled) {
                    document.getElementById('jbBtnExplain').style.display = 'block';
                    if (!aiConfigured) {
                        document.getElementById('jbBtnExplain').textContent = '✨ Explain (Key Required)';
                        document.getElementById('jbBtnExplain').style.opacity = '0.5';
                        document.getElementById('jbBtnExplain').onclick = () => { alert("Please add a Google Gemini API Key in extension settings to use AI features."); };
                    } else {
                        document.getElementById('jbBtnExplain').textContent = '✨ Explain';
                        document.getElementById('jbBtnExplain').style.opacity = '1';
                        document.getElementById('jbBtnExplain').onclick = () => { document.getElementById('jbBtnExplain').textContent = 'Thinking...'; vscode.postMessage({ command: 'explain', snapshot: s }); };
                    }
                } else document.getElementById('jbBtnExplain').style.display = 'none';
            }
        })();`;
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body { margin: 0; display: flex; flex-direction: ${containerFlex}; height: 100vh; font-family: var(--vscode-font-family); color: var(--vscode-foreground); } .jb-table { width: 100%; border-collapse: collapse; } .jb-td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); } .jb-tr:hover { background: var(--vscode-list-hoverBackground); cursor: pointer; } .jb-tr.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); } .jb-details-pane { width: 300px; display: none; flex-direction: column; padding: 12px; background: var(--vscode-sideBar-background); border-left: 1px solid var(--vscode-panel-border); overflow-y: auto; min-height: 0; } ${styles}</style></head><body><div id="diffContainer" class="diff-container" style="order: ${diffOrder}; flex: 1; min-height: 200px;">${diffHeaderHtml}<div id="diffContent" class="diff-content"></div></div><div class="jb-main" style="flex: 1; display: flex; overflow: hidden; min-height: 0;"><div style="flex: 1; overflow: auto; min-height: 0;"><table class="jb-table"><thead><tr><th class="jb-th" data-column="timestamp" data-label="Time" onclick="sortBy('timestamp')" style="width: 80px;">Time</th><th class="jb-th" data-column="eventType" data-label="Type" onclick="sortBy('eventType')" style="width: 80px;">Type</th><th class="jb-th" data-column="label" data-label="Description" onclick="sortBy('label')">Description</th></tr></thead><tbody id="list"></tbody></table></div><div id="detailsPane" class="jb-details-pane"><div class="jb-label">Time</div><div id="detTime" class="jb-value"></div><div class="jb-label">Type</div><div id="detType" class="jb-value"></div><button id="jbBtnRestore" class="jb-btn">Restore</button><button id="jbBtnBranch" class="jb-btn" style="margin-top: 4px;">Branch</button><button id="jbBtnBranchVersion" class="jb-btn" style="margin-top: 4px;">Version</button><button id="jbBtnExplain" class="jb-btn" style="margin-top: 4px;">✨ Explain</button><div id="explanationBox" style="display:none; margin-top:10px;"><div id="explanationText" style="font-size:0.85em; white-space:pre-wrap;"></div></div></div></div><script>${jbScript}</script></body></html>`;
    }

    private _getGitHtml(useJetBrains: boolean, enableHtmlPreview: boolean, htmlLayout: string, htmlPosition: string, isSyncScroll: boolean, defaultAction: string = 'openDiff') {
        const styles = this._getSharedStyles();
        const containerFlex = htmlPosition === 'top' || htmlPosition === 'bottom' ? 'column' : 'row';
        const diffOrder = htmlPosition === 'top' ? '-1' : '1';
        const sidebarStyle = htmlPosition === 'top' || htmlPosition === 'bottom' ? 'max-width: 100%;' : 'max-width: 400px; border-right: 1px solid var(--vscode-panel-border);';

        const script = `(function() { const vscode = acquireVsCodeApi(); 
            ${this._getGitSharedScript(htmlLayout, isSyncScroll, defaultAction)}
            let aiConfigured = false;
            let commits = [], selectedIndex = -1;
            let currentSort = { column: 'date', direction: 'desc' };
            let currentFilePath = '';

            window.onload = () => { vscode.postMessage({ command: 'ready' }); updateLayoutButtons(); };
            window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.command === 'loadCommits') {
                    aiConfigured = !!msg.aiConfigured;
                    currentFilePath = msg.filePath;
                    commits = (msg.commits || []).map(c => ({ item: c, element: null }));
                    renderList();
                } else if (msg.command === 'showHtmlDiff') { renderDiff(msg.diff, msg.title, msg.params); }
                else if (msg.command === 'explainResult') { 
                    const box = document.getElementById('explanationBox'); if (box) { box.style.display = 'block'; document.getElementById('explanationText').textContent = msg.text; }
                    document.getElementById('btnExplain').textContent = '✨ Explain';
                }
            });

            window.sortBy = (column) => {
                if (currentSort.column === column) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = column;
                    currentSort.direction = column === 'date' ? 'desc' : 'asc';
                }
                renderList();
            };

            function renderList() {
                const el = document.getElementById('list'); el.innerHTML = '';
                commits.sort((a, b) => {
                    let valA, valB;
                    if (currentSort.column === 'date') { valA = new Date(a.item.date).getTime(); valB = new Date(b.item.date).getTime(); }
                    else if (currentSort.column === 'hash') { valA = a.item.hash; valB = b.item.hash; }
                    else if (currentSort.column === 'author') { valA = a.item.author; valB = b.item.author; }
                    else { valA = a.item.message; valB = b.item.message; }
                    if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                    if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                    return 0;
                });
                commits.forEach((c, index) => {
                    const tr = document.createElement('tr'); tr.className = 'jb-tr';
                    if (selectedIndex === index) tr.classList.add('selected');
                    tr.onclick = () => {
                        selectedIndex = index;
                        document.querySelectorAll('.jb-tr').forEach(r => r.classList.remove('selected'));
                        tr.classList.add('selected');
                        vscode.postMessage({ command: 'openDiff', commit: c.item, filePath: currentFilePath });
                        updateDetails(c.item, currentFilePath);
                    };
                    tr.innerHTML = '<td class="jb-td" style="font-family: monospace;">' + escapeHtml(c.item.hash.substring(0,7)) + '</td>' +
                                   '<td class="jb-td">' + escapeHtml(c.item.date) + '</td>' +
                                   '<td class="jb-td">' + escapeHtml(c.item.author) + '</td>' +
                                   '<td class="jb-td">' + escapeHtml(c.item.message) + '</td>';
                    el.appendChild(tr);
                    c.element = tr;
                });
                updateSortHeaders();
            }

            function updateSortHeaders() {
                document.querySelectorAll('.jb-th').forEach(th => {
                    th.classList.remove('active-sort');
                    const label = th.dataset.label;
                    if (th.dataset.column === currentSort.column) {
                        th.classList.add('active-sort');
                        th.innerHTML = label + (currentSort.direction === 'asc' ? ' ↑' : ' ↓');
                    } else {
                        th.innerHTML = label;
                    }
                });
            }

            window.addEventListener('keydown', e => {
                if (e.key === 'ArrowDown') { navigate(1); e.preventDefault(); }
                else if (e.key === 'ArrowUp') { navigate(-1); e.preventDefault(); }
            });

            function navigate(direction) {
                if (commits.length === 0) return;
                let next = selectedIndex + direction;
                if (next < 0) next = 0;
                if (next >= commits.length) next = commits.length - 1;
                if (next !== selectedIndex) {
                    commits[next].element.click();
                    commits[next].element.scrollIntoView({ block: 'nearest' });
                }
            }

            function updateDetails(c, filePath) {
                const detailsHeader = document.getElementById('detailsHeader');
                if (detailsHeader) {
                    detailsHeader.style.display = 'flex';
                    detailsHeader.style.alignItems = 'center';
                    detailsHeader.style.justifyContent = 'space-between';
                    detailsHeader.style.padding = '8px 12px';
                    detailsHeader.style.background = 'var(--vscode-editor-lineHighlightBackground)';
                    detailsHeader.style.borderBottom = '1px solid var(--vscode-panel-border)';
                }
                document.getElementById('detInfo').textContent = c.hash.substring(0, 7) + ' - ' + c.author;
                
                const branchBtn = document.getElementById('btnBranch');
                if (branchBtn) branchBtn.onclick = () => vscode.postMessage({ command: 'compareWithBranch', filePath: filePath, commit: c });
                
                const versionBtn = document.getElementById('btnBranchVersion');
                if (versionBtn) versionBtn.onclick = () => vscode.postMessage({ command: 'compareWithBranchVersion', filePath: filePath, commit: c });
                
                const explainBtn = document.getElementById('btnExplain');
                if (explainBtn) {
                    if (!aiConfigured) {
                        explainBtn.textContent = '✨ Explain (Key Required)';
                        explainBtn.style.opacity = '0.5';
                        explainBtn.onclick = () => { alert("Please add a Google Gemini API Key in extension settings to use AI features."); };
                    } else {
                        explainBtn.textContent = '✨ Explain';
                        explainBtn.style.opacity = '1';
                        explainBtn.onclick = () => { explainBtn.textContent = 'Thinking...'; vscode.postMessage({ command: 'explain', commit: c }); };
                    }
                }
            }
        })();`;
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles} body { margin: 0; display: flex; flex-direction: ${containerFlex}; height: 100vh; width: 100vw; font-family: var(--vscode-font-family); color: var(--vscode-foreground); overflow: hidden; } .jb-main { display: flex; flex: 1; overflow: hidden; min-height: 0; } .jb-table-wrapper { flex: 1; overflow: auto; min-height: 0; } </style></head><body><div id="diffContainer" class="diff-container" style="order: ${diffOrder}; flex: 1; min-height: 200px;">
            <div class="diff-header"><span id="diffTitle">Git Diff</span>
                <div style="display: flex; gap: 4px; align-items: center;">
                    <div style="display: flex; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden; margin-right: 4px;">
                        <button class="btn-action btn-sbs" title="Side-by-Side View">◫</button>
                        <button class="btn-action btn-unified" title="Unified View">☰</button>
                    </div>
                    <button class="btn-action btn-toggle-sync" style="padding: 2px 4px; font-size: 0.75em; height: 28px;"></button>
                    <button class="btn-action btn-save-patch" title="Save Patch" style="padding: 2px 4px; font-size: 0.75em; height: 28px;">Save</button>
                    <button class="btn-action btn-open-native" title="Open in VS Code" style="padding: 2px 4px; font-size: 0.75em; height: 28px;">Open in Editor ↗</button>
                    <button onclick="window.closeDiff()" class="btn-action" style="padding: 2px 4px; background: transparent; color: var(--vscode-foreground); min-width: 24px; height: 28px;">✕</button>
                </div>
            </div>
            <div id="detailsHeader" style="display:none;"><div style="display:flex; gap:8px; align-items:center;"><span id="detInfo" style="font-size:0.85em; font-weight:bold; opacity:0.8;"></span></div><div class="actions" style="border:none; padding:0; background:transparent;"><button id="btnBranch">Branch</button><button id="btnBranchVersion">Version</button><button id="btnExplain" class="btn-explain">✨ Explain</button></div></div>
            <div id="explanationBox" class="explanation-box" style="margin: 8px 12px;"><div class="explanation-close" onclick="this.parentElement.style.display='none'">✕</div><div id="explanationText"></div></div>
            <div id="diffContent" class="diff-content"></div></div><div class="jb-main" style="flex:1; border-left:1px solid var(--vscode-panel-border); border-right:1px solid var(--vscode-panel-border);"><div class="jb-table-wrapper"><table class="jb-table"><thead><tr><th class="jb-th" data-column="hash" data-label="Version" onclick="sortBy('hash')" style="width: 80px;">Version</th><th class="jb-th" data-column="date" data-label="Date" onclick="sortBy('date')" style="width: 150px;">Date</th><th class="jb-th" data-column="author" data-label="Author" onclick="sortBy('author')" style="width: 120px;">Author</th><th class="jb-th" data-column="message" data-label="Commit Message" onclick="sortBy('message')">Commit Message</th></tr></thead><tbody id="list"></tbody></table></div></div><script>${script}</script></body></html>`;
    }

    private _getGitSharedScript(htmlLayout: string, isSyncScroll: boolean, defaultAction: string = 'openDiff') {
        return `
            window.closeDiff = () => { document.getElementById('diffContainer').style.display = 'none'; };
            let htmlLayout = '${htmlLayout}';
            let isSyncScroll = ${isSyncScroll};
            let defaultAction = '${defaultAction}';
            let lastDiffText = '', lastDiffTitle = '';
            let lastCompareParams = null;

            window.addEventListener('message', event => {
                if (event.data.command === 'readyConfig') {
                    htmlLayout = event.data.htmlLayout; 
                    isSyncScroll = event.data.isSyncScroll; 
                    defaultAction = event.data.defaultAction || defaultAction;
                    updateLayoutButtons();
                }
            });

            function updateLayoutButtons() {
                document.querySelectorAll('.btn-sbs').forEach(btn => {
                    btn.classList.toggle('active', htmlLayout === 'side-by-side');
                    btn.onclick = () => { if (htmlLayout === 'side-by-side') return; htmlLayout = 'side-by-side'; updateLayoutButtons(); if (lastDiffText) renderDiff(lastDiffText, lastDiffTitle); vscode.postMessage({ command: 'updateLayout', layout: 'side-by-side' }); };
                });
                document.querySelectorAll('.btn-unified').forEach(btn => {
                    btn.classList.toggle('active', htmlLayout === 'unified');
                    btn.onclick = () => { if (htmlLayout === 'unified') return; htmlLayout = 'unified'; updateLayoutButtons(); if (lastDiffText) renderDiff(lastDiffText, lastDiffTitle); vscode.postMessage({ command: 'updateLayout', layout: 'unified' }); };
                });
                const syncBtns = document.querySelectorAll('.btn-toggle-sync');
                syncBtns.forEach(btn => {
                    btn.textContent = 'Sync: ' + (isSyncScroll ? 'ON' : 'OFF');
                    btn.classList.toggle('active', isSyncScroll);
                    btn.onclick = () => { isSyncScroll = !isSyncScroll; updateLayoutButtons(); vscode.postMessage({ command: 'updateSync', sync: isSyncScroll }); };
                });
                const nativeBtns = document.querySelectorAll('.btn-open-native');
                nativeBtns.forEach(btn => {
                    btn.style.display = defaultAction === 'openDiff' ? 'none' : 'flex';
                    btn.onclick = () => { if (lastCompareParams) vscode.postMessage({ command: 'openNativeDiff', params: lastCompareParams }); };
                });
                const savePatchBtns = document.querySelectorAll('.btn-save-patch');
                savePatchBtns.forEach(btn => {
                    btn.onclick = () => { if (lastDiffText) vscode.postMessage({ command: 'savePatch', diffText: lastDiffText }); };
                });
            }

            function renderDiff(diffText, title, params) {
                lastDiffText = diffText; lastDiffTitle = title; if (params) lastCompareParams = params;
                const container = document.getElementById('diffContainer'); const content = document.getElementById('diffContent');
                if (container) container.style.display = 'flex';
                if (document.getElementById('diffTitle')) document.getElementById('diffTitle').textContent = title;
                
                const infoBar = document.getElementById('diffInfoBar');
                const infoTag = document.getElementById('diffInfoTag');
                const infoPath = document.getElementById('diffInfoPath');
                if (infoBar) {
                    infoBar.style.display = 'flex';
                    if (params) {
                        if (infoTag) infoTag.textContent = params.type === 'snapshot' ? 'SNAPSHOT' : 'COMMIT ' + (params.commit ? params.commit.hash.substring(0,7) : 'DIFF');
                        if (infoPath) infoPath.textContent = params.baseFilePath || params.filePath || '';
                    }
                }

                if (!diffText || diffText.trim() === '') {
                    content.innerHTML = '<div style="padding: 20px; opacity: 0.5;">No differences found.</div>';
                    if (infoBar) infoBar.style.display = 'none';
                    return;
                }

                const lines = diffText.split('\\n').filter(l => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('index '));
                if (htmlLayout === 'unified') {
                    let html = '<table class="diff-table" style="table-layout: auto;">';
                    let leftLine = 0, rightLine = 0;
                    lines.forEach(line => {
                        let cls = 'context';
                        if (line.startsWith("+")) { cls = "added"; rightLine++; }
                        else if (line.startsWith("-")) { cls = "removed"; leftLine++; }
                        else if (line.startsWith("@@")) { 
                            cls = "header"; 
                            const match = line.match(new RegExp('-(\\\\d+),?\\\\d* \\\\+(\\\\d+),?\\\\d*'));
                            if (match) { leftLine = parseInt(match[1]) - 1; rightLine = parseInt(match[2]) - 1; }
                        }
                        else { leftLine++; rightLine++; }
                        html += '<tr class="diff-line ' + cls + '"><td class="diff-line-num">' + (cls === "added" ? "" : leftLine) + '</td><td class="diff-line-num">' + (cls === "removed" ? "" : rightLine) + '</td><td class="diff-line-content">' + escapeHtml(line) + '</td></tr>';
                    });
                    content.innerHTML = html + '</table>';
                } else {
                    let leftHtml = '', rightHtml = ''; let leftLine = 0, rightLine = 0;
                    lines.forEach(line => {
                        if (line.startsWith('@@')) {
                            const match = line.match(new RegExp('-(\\\\d+),?\\\\d* \\\\+(\\\\d+),?\\\\d*'));
                            if (match) { leftLine = parseInt(match[1]) - 1; rightLine = parseInt(match[2]) - 1; }
                            leftHtml += '<div class="diff-line header"><div class="diff-line-num"></div><div class="diff-line-content">' + escapeHtml(line) + '</div></div>';
                            rightHtml += '<div class="diff-line header"><div class="diff-line-num"></div><div class="diff-line-content">' + escapeHtml(line) + '</div></div>';
                        } else if (line.startsWith('-')) {
                            leftLine++; leftHtml += '<div class="diff-line removed"><div class="diff-line-num">' + leftLine + '</div><div class="diff-line-content">' + escapeHtml(line.substring(1)) + '</div></div>';
                            rightHtml += '<div class="diff-line empty"><div class="diff-line-num"></div><div class="diff-line-content"></div></div>';
                        } else if (line.startsWith('+')) {
                            rightLine++; rightHtml += '<div class="diff-line added"><div class="diff-line-num">' + rightLine + '</div><div class="diff-line-content">' + escapeHtml(line.substring(1)) + '</div></div>';
                            leftHtml += '<div class="diff-line empty"><div class="diff-line-num"></div><div class="diff-line-content"></div></div>';
                        } else {
                            leftLine++; rightLine++;
                            const text = line.startsWith(' ') ? line.substring(1) : line;
                            leftHtml += '<div class="diff-line"><div class="diff-line-num">' + leftLine + '</div><div class="diff-line-content">' + escapeHtml(text) + '</div></div>';
                            rightHtml += '<div class="diff-line"><div class="diff-line-num">' + rightLine + '</div><div class="diff-line-content">' + escapeHtml(text) + '</div></div>';
                        }
                    });
                    let leftHeader = '<div class="diff-sbs-title">Original</div>';
                    let rightHeader = '<div class="diff-sbs-title">Modified</div>';
                    content.innerHTML = '<div class="diff-sbs-wrapper"><div class="diff-sbs-side" id="diffLeft">' + leftHeader + leftHtml + '</div><div class="diff-sbs-side" id="diffRight">' + rightHeader + rightHtml + '</div></div>';
                    const l = document.getElementById('diffLeft'), r = document.getElementById('diffRight');
                    if (l && r) {
                        l.onscroll = () => { if (!isSyncScroll) return; r.scrollTop = l.scrollTop; r.scrollLeft = l.scrollLeft; };
                        r.onscroll = () => { if (!isSyncScroll) return; l.scrollTop = r.scrollTop; l.scrollLeft = r.scrollLeft; };
                    }
                }
            }
            function escapeHtml(unsafe) { if (!unsafe) return ""; return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
        `;
    }
}
