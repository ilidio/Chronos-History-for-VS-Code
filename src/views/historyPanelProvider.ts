import * as vscode from 'vscode';
import { Snapshot, GitCommit } from '../types';

export class HistoryPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'chronos.historyPanel';
    private _view?: vscode.WebviewView;
    private _currentMode: 'local' | 'git' = 'local';
    private _pendingData: any = null;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.onDidReceiveMessage(async message => {
            const config = vscode.workspace.getConfiguration('chronos');
            const enableHtmlPreview = config.get('diff.enableHtmlPreview', true);
            const htmlLayout = config.get('diff.htmlPreviewLayout', 'side-by-side');
            const htmlPosition = config.get('diff.htmlPreviewPosition', 'top');
            const isSyncScroll = config.get('diff.syncScroll', true);
            const defaultAction = config.get('diff.defaultAction', 'openDiff');

            if (message.command === 'ready') {
                this._view?.webview.postMessage({ command: 'readyConfig', htmlLayout, htmlPosition, isSyncScroll, defaultAction });
                if (this._pendingData) {
                    this._view?.webview.postMessage({ ...this._pendingData, enableHtmlPreview, defaultAction });
                }
            } else if (message.command === 'openDiff') {
                if (enableHtmlPreview && message.action !== 'openNative') {
                    if (defaultAction === 'openDiff' && !message.forcePreview) {
                        if (this._currentMode === 'local') {
                            vscode.commands.executeCommand('_chronos.openDiff', message.snapshot, message.baseFilePath, message.currentSelection);
                        } else {
                            if (message.compareWithCurrent) {
                                vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.commit, message.baseFilePath, message.currentSelection);
                            } else {
                                vscode.commands.executeCommand('_chronos.openDiffGit', message.commit, message.baseFilePath);
                            }
                        }
                        return;
                    }
                    
                    let diff = '';
                    if (this._currentMode === 'local') {
                        diff = await vscode.commands.executeCommand<string>('_chronos.getDiffForSnapshot', message.snapshot, message.baseFilePath) || '';
                        this._view?.webview.postMessage({ command: 'showHtmlDiff', diff, title: (message.snapshot.label || 'Snapshot') + ' Diff', params: { type: 'snapshot', snapshot: message.snapshot, baseFilePath: message.baseFilePath, selection: message.currentSelection } });
                    } else {
                        if (!message.compareWithCurrent) {
                            diff = await vscode.commands.executeCommand<string>('_chronos.getGitDiff', message.commit, message.baseFilePath) || '';
                            this._view?.webview.postMessage({ command: 'showHtmlDiff', diff, title: 'Commit ' + message.commit.hash.substring(0, 7), params: { type: 'commit', commit: message.commit, filePath: message.baseFilePath, selection: message.currentSelection, compareWithCurrent: false } });
                        } else {
                            vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.commit, message.baseFilePath, message.currentSelection);
                        }
                    }
                } else {
                    if (this._currentMode === 'local') {
                        vscode.commands.executeCommand('_chronos.openDiff', message.snapshot, message.baseFilePath, message.currentSelection);
                    } else {
                        if (message.compareWithCurrent) {
                            vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.commit, message.baseFilePath, message.currentSelection);
                        } else {
                            vscode.commands.executeCommand('_chronos.openDiffGit', message.commit, message.baseFilePath);
                        }
                    }
                }
            } else if (message.command === 'explain') {
                const text = this._currentMode === 'local' ? 
                    await vscode.commands.executeCommand<string>('chronos.explainSnapshot', message.snapshot) :
                    await vscode.commands.executeCommand<string>('chronos.explainCommit', message.commit);
                this._view?.webview.postMessage({ command: 'explainResult', text });
            } else if (message.command === 'restore') {
                vscode.commands.executeCommand('chronos.restoreSnapshot', message.snapshotId, message.filePath);
            } else if (message.command === 'compareWithBranch') {
                const branches = await vscode.commands.executeCommand<string[]>('_chronos.getBranches', message.filePath);
                if (branches && branches.length > 0) {
                    const selectedBranch = await vscode.window.showQuickPick(branches, { placeHolder: 'Select branch to compare with' });
                    if (selectedBranch && enableHtmlPreview) {
                        if (message.snapshot) {
                            const diff = await vscode.commands.executeCommand<string>('_chronos.getDiffSnapshotWithBranch', message.snapshot, selectedBranch);
                            this._view?.webview.postMessage({ command: 'showHtmlDiff', diff, title: 'Snapshot ↔ Branch: ' + selectedBranch, params: { type: 'snapshotWithBranch', snapshot: message.snapshot, branch: selectedBranch } });
                        } else if (message.commit) {
                            const diff = await vscode.commands.executeCommand<string>('_chronos.getDiffCommitWithBranch', message.commit, selectedBranch, message.filePath);
                            this._view?.webview.postMessage({ command: 'showHtmlDiff', diff, title: 'Commit ↔ Branch: ' + selectedBranch, params: { type: 'commitWithBranch', commit: message.commit, branch: selectedBranch, filePath: message.filePath } });
                        }
                    }
                }
            } else if (message.command === 'compareWithBranchVersion') {
                vscode.commands.executeCommand('chronos.compareWithBranchVersion', { snapshot: message.snapshot, commit: message.commit, filePath: message.filePath });
            } else if (message.command === 'openNativeDiff') {
                if (message.params.type === 'snapshot') vscode.commands.executeCommand('_chronos.openDiff', message.params.snapshot, message.params.baseFilePath, message.params.selection);
                else if (message.params.type === 'snapshotWithBranch') vscode.commands.executeCommand('chronos.compareSnapshotWithBranch', message.params.snapshot, message.params.branch);
                else if (message.params.type === 'commitWithBranch') vscode.commands.executeCommand('chronos.compareCommitWithBranch', message.params.commit, message.params.branch, message.params.filePath);
                else if (message.params.type === 'commit') {
                    if (message.params.compareWithCurrent) vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.params.commit, message.params.filePath, message.params.selection);
                    else vscode.commands.executeCommand('_chronos.openDiffGit', message.params.commit, message.params.filePath);
                }
            } else if (message.command === 'updateLayout') {
                vscode.workspace.getConfiguration('chronos').update('diff.htmlPreviewLayout', message.layout, vscode.ConfigurationTarget.Global);
            } else if (message.command === 'updateSync') {
                vscode.workspace.getConfiguration('chronos').update('diff.syncScroll', message.sync, vscode.ConfigurationTarget.Global);
            } else if (message.command === 'savePatch') {
                vscode.commands.executeCommand('_chronos.savePatch', message.diffText);
            }
        });

        webviewView.webview.html = this._getHtmlForWebview();
    }

    public showLocalHistory(snapshots: any[], filePath: string, selection?: any, aiConfigured: boolean = false) {
        this._currentMode = 'local';
        const config = vscode.workspace.getConfiguration('chronos');
        const enableHtmlPreview = config.get('diff.enableHtmlPreview', true);
        const defaultAction = config.get('diff.defaultAction', 'openDiff');
        this._pendingData = { command: 'loadLocal', snapshots, filePath, selection, aiConfigured, enableHtmlPreview, defaultAction };
        if (this._view) {
            this._view.show?.(true); 
            this._view.webview.postMessage(this._pendingData);
        }
    }

    public showGitHistory(commits: GitCommit[], filePath: string, selection?: any, aiConfigured: boolean = false) {
        this._currentMode = 'git';
        const config = vscode.workspace.getConfiguration('chronos');
        const enableHtmlPreview = config.get('diff.enableHtmlPreview', true);
        const defaultAction = config.get('diff.defaultAction', 'openDiff');
        this._pendingData = { command: 'loadGit', commits, filePath, selection, aiConfigured, enableHtmlPreview, defaultAction };
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage(this._pendingData);
        }
    }

    private _getHtmlForWebview() {
        const config = vscode.workspace.getConfiguration('chronos');
        const useJetBrains = config.get('ui.useJetBrainsStyle', true);
        const enableHtmlPreview = config.get('diff.enableHtmlPreview', true);
        const htmlLayout = config.get('diff.htmlPreviewLayout', 'side-by-side');
        const htmlPosition = config.get('diff.htmlPreviewPosition', 'top');
        const isSyncScroll = config.get('diff.syncScroll', true);
        const defaultAction = config.get('diff.defaultAction', 'openDiff');
        
        const sharedStyle = `
            .diff-container { display: none; flex: 1; flex-direction: column; overflow: hidden; background: var(--vscode-editor-background); }
            .diff-header { padding: 4px 8px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); font-size: 0.8em; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
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
            .btn-action { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 0 8px; height: 28px; cursor: pointer; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 0.85em; }
            .btn-action.active { background: var(--vscode-textLink-foreground); }
            .diff-info-bar { background: var(--vscode-editor-lineHighlightBackground); padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 8px; font-size: 0.75em; }
            .diff-info-path { font-family: var(--vscode-editor-font-family); opacity: 0.9; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .diff-info-tag { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 4px; border-radius: 2px; font-size: 0.85em; font-weight: bold; }
            .jb-th { padding: 4px 8px; text-align: left; font-size: 0.75em; font-weight: bold; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; z-index: 10; cursor: pointer; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .jb-th:hover { background: var(--vscode-list-hoverBackground); }
            .jb-th.active-sort { color: var(--vscode-textLink-foreground); }
        `;

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
            function escapeHtml(unsafe) { if (!unsafe) return ""; return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
        `;

        const containerFlex = htmlPosition === 'top' || htmlPosition === 'bottom' ? 'column' : 'row';
        const diffBorder = htmlPosition === 'top' ? 'border-bottom: 1px solid var(--vscode-panel-border);' : 
                           htmlPosition === 'bottom' ? 'border-top: 1px solid var(--vscode-panel-border);' : 
                           htmlPosition === 'right' ? 'border-left: 1px solid var(--vscode-panel-border);' : '';
        const diffOrder = htmlPosition === 'top' ? '-1' : '1';

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
            <div id="diffInfoBar" class="diff-info-bar" style="display: none;"><span id="diffInfoTag" class="diff-info-tag"></span><span id="diffInfoPath" class="diff-info-path"></span></div>
        `;

        if (!useJetBrains) {
            const script = `(function() { 
                const vscode = acquireVsCodeApi(); 
                ${sharedScript}
                let items = [], selectedIndex = -1, lastMsg = null;
                window.addEventListener("message", event => {
                    const msg = event.data;
                    if (msg.command === "showHtmlDiff") { renderDiff(msg.diff, msg.title, msg.params); return; }
                    if (msg.command === "loadLocal" || msg.command === "loadGit") {
                        const el = document.getElementById("list"); if (!el) return; el.innerHTML = "";
                        let raw = []; lastMsg = msg;
                        if (msg.command === "loadLocal") { (msg.snapshots || []).forEach(s => { if (s.type === "cluster") raw.push(...s.items); else raw.push(s); }); }
                        else if (msg.command === "loadGit") { raw = msg.commits || []; }
                        if (raw.length === 0) { el.innerHTML = '<div class="empty-state">No history found.</div>'; return; }
                        items = raw.map((item, index) => {
                            const entry = document.createElement("div"); entry.className = "entry";
                            entry.onclick = () => {
                                selectedIndex = index;
                                document.querySelectorAll('.entry').forEach(e => e.classList.remove('selected'));
                                entry.classList.add('selected');
                                if (msg.command === "loadLocal") vscode.postMessage({ command: "openDiff", snapshot: item, baseFilePath: msg.filePath, currentSelection: msg.selection });
                                else vscode.postMessage({ command: "openDiff", commit: item, baseFilePath: msg.filePath, currentSelection: msg.selection, compareWithCurrent: false });
                            };
                            const type = msg.command === "loadLocal" ? item.eventType : (item.hash ? item.hash.substring(0, 7) : 'Git');
                            const time = msg.command === "loadLocal" ? new Date(item.timestamp).toLocaleTimeString() : item.date;
                            const msgStr = msg.command === "loadLocal" ? (item.label || item.filePath.split(/[\\\\/]/).pop()) : item.message;
                            entry.innerHTML = '<div class="header"><span class="event-type">' + escapeHtml(type) + '</span><span class="time">' + escapeHtml(time) + '</span><span class="message">' + escapeHtml(msgStr) + '</span></div>';
                            el.appendChild(entry);
                            return { item, element: entry };
                        });
                    }
                });
                vscode.postMessage({ command: "ready" });
                updateLayoutButtons();
            })();`;

            return `<!DOCTYPE html><html><head><meta charset='UTF-8'><style>body { margin: 0; padding: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); font-family: var(--vscode-font-family); height: 100vh; overflow: hidden; display: flex; flex-direction: ${containerFlex}; } .list { flex: 1; overflow-y: auto; min-height: 0; } .entry { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; display: flex; align-items: center; gap: 10px; } .entry:hover { background-color: var(--vscode-list-hoverBackground); } .header { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; } .event-type { font-weight: bold; text-transform: uppercase; font-size: 0.8em; opacity: 0.8; min-width: 60px; } .time { font-family: monospace; opacity: 0.9; min-width: 110px; } .message { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; } .empty-state { padding: 20px; text-align: center; opacity: 0.5; } ${sharedStyle}</style></head><body><div id='diffContainer' class='diff-container' style='order: ${diffOrder}; ${diffBorder} flex: 1; min-height: 200px;'>${diffHeaderHtml}<div id='diffContent' class='diff-content'></div></div><div id='list' class='list' style='order: 0;'><div class='empty-state'>Waiting...</div></div><script>${script}</script></body></html>`;
        }

        const jbScript = `(function() {
            const vscode = acquireVsCodeApi(); 
            ${sharedScript}
            let items = [], selectedIndex = -1, lastMsg = null, currentMode = 'local';
            let currentSort = { column: 'date', direction: 'desc' };

            window.addEventListener("message", event => {
                const msg = event.data;
                if (msg.command === "showHtmlDiff") { renderDiff(msg.diff, msg.title, msg.params); return; }
                if (msg.command === "explainResult") { 
                    const box = document.getElementById('explanationBox'); if (box) { box.style.display = 'block'; box.textContent = msg.text; }
                    document.getElementById('jbBtnExplain').textContent = '✨ Explain'; return;
                }
                if (msg.command === "loadLocal" || msg.command === "loadGit") {
                    lastMsg = msg;
                    currentMode = (msg.command === "loadLocal") ? 'local' : 'git';
                    currentSort.column = (currentMode === 'local') ? 'timestamp' : 'date';
                    currentSort.direction = 'desc';
                    let raw = [];
                    if (currentMode === "local") { (msg.snapshots || []).forEach(s => { if (s.type === "cluster") raw.push(...s.items); else raw.push(s); }); }
                    else { raw = msg.commits || []; }
                    items = raw.map(i => ({ item: i, element: null }));
                    renderList();
                }
            });

            window.sortBy = (column) => {
                if (currentSort.column === column) { currentSort.direction = (currentSort.direction === 'asc') ? 'desc' : 'asc'; }
                else { currentSort.column = column; currentSort.direction = (column === 'date' || column === 'timestamp') ? 'desc' : 'asc'; }
                renderList();
            };

            function renderList() {
                const el = document.getElementById('list'); const hr = document.getElementById('headerRow');
                if (!el || !hr) return; el.innerHTML = '';
                if (currentMode === 'local') {
                    hr.innerHTML = '<th class="jb-th" data-column="timestamp" data-label="Time" onclick="sortBy(\\'timestamp\\')" style="width: 100px;">Time</th><th class="jb-th" data-column="eventType" data-label="Type" onclick="sortBy(\\'eventType\\')" style="width: 80px;">Type</th><th class="jb-th" data-column="label" data-label="Description" onclick="sortBy(\\'label\\')">Description</th>';
                } else {
                    hr.innerHTML = '<th class="jb-th" data-column="hash" data-label="Version" onclick="sortBy(\\'hash\\')" style="width: 80px;">Version</th><th class="jb-th" data-column="date" data-label="Date" onclick="sortBy(\\'date\\')" style="width: 150px;">Date</th><th class="jb-th" data-column="author" data-label="Author" onclick="sortBy(\\'author\\')" style="width: 120px;">Author</th><th class="jb-th" data-column="message" data-label="Message" onclick="sortBy(\\'message\\')">Message</th>';
                }
                items.sort((a, b) => {
                    let vA, vB;
                    if (currentMode === 'local') {
                        if (currentSort.column === 'timestamp' || currentSort.column === 'date') { vA = a.item.timestamp; vB = b.item.timestamp; }
                        else if (currentSort.column === 'eventType') { vA = a.item.eventType; vB = b.item.eventType; }
                        else { vA = a.item.label || a.item.filePath; vB = b.item.label || b.item.filePath; }
                    } else {
                        if (currentSort.column === 'date' || currentSort.column === 'timestamp') { vA = a.item.date ? new Date(a.item.date).getTime() : 0; vB = b.item.date ? new Date(b.item.date).getTime() : 0; }
                        else if (currentSort.column === 'hash') { vA = a.item.hash || ""; vB = b.item.hash || ""; }
                        else if (currentSort.column === 'author') { vA = a.item.author || ""; vB = b.item.author || ""; }
                        else { vA = a.item.message || ""; vB = b.item.message || ""; }
                    }
                    if (vA < vB) return (currentSort.direction === 'asc') ? -1 : 1;
                    if (vA > vB) return (currentSort.direction === 'asc') ? 1 : -1;
                    return 0;
                });
                items.forEach((obj, idx) => {
                    const tr = document.createElement('tr'); tr.className = 'jb-tr';
                    if (selectedIndex === idx) tr.classList.add('selected');
                    tr.onclick = () => {
                        selectedIndex = idx; document.querySelectorAll('.jb-tr').forEach(r => r.classList.remove('selected')); tr.classList.add('selected');
                        if (currentMode === "local") { vscode.postMessage({ command: "openDiff", snapshot: obj.item, baseFilePath: lastMsg.filePath, currentSelection: lastMsg.selection }); updateDetails(obj.item, 'local', lastMsg.filePath); }
                        else { vscode.postMessage({ command: "openDiff", commit: obj.item, baseFilePath: lastMsg.filePath, currentSelection: lastMsg.selection, compareWithCurrent: false }); updateDetails(obj.item, 'git', lastMsg.filePath); }
                    };
                    if (currentMode === 'local') {
                        const t = new Date(obj.item.timestamp).toLocaleTimeString();
                        tr.innerHTML = '<td class="jb-td">' + escapeHtml(t) + '</td><td class="jb-td">' + escapeHtml(obj.item.eventType) + '</td><td class="jb-td">' + escapeHtml(obj.item.label || obj.item.filePath.split(/[\\\\/]/).pop()) + '</td>';
                    } else {
                        tr.innerHTML = '<td class="jb-td" style="font-family: monospace;">' + escapeHtml(obj.item.hash ? obj.item.hash.substring(0,7) : "---") + '</td><td class="jb-td">' + escapeHtml(obj.item.date) + '</td><td class="jb-td">' + escapeHtml(obj.item.author) + '</td><td class="jb-td">' + escapeHtml(obj.item.message) + '</td>';
                    }
                    el.appendChild(tr); obj.element = tr;
                });
                updateSortHeaders();
            }

            function updateSortHeaders() {
                document.querySelectorAll('.jb-th').forEach(th => {
                    th.classList.remove('active-sort');
                    if (th.dataset.column === currentSort.column || (currentSort.column === 'timestamp' && th.dataset.column === 'date') || (currentSort.column === 'date' && th.dataset.column === 'timestamp')) {
                        th.classList.add('active-sort'); th.innerHTML = th.dataset.label + (currentSort.direction === 'asc' ? ' ↑' : ' ↓');
                    } else { th.innerHTML = th.dataset.label; }
                });
            }

            function updateDetails(item, mode, filePath) {
                const dh = document.getElementById('detailsHeader'); if (dh) dh.style.display = 'flex';
                document.getElementById('explanationBox').style.display = 'none';
                if (mode === 'local') {
                    document.getElementById('detTime').textContent = new Date(item.timestamp).toLocaleString();
                    document.getElementById('jbBtnRestore').style.display = 'block';
                    document.getElementById('jbBtnRestore').onclick = () => vscode.postMessage({ command: 'restore', snapshotId: item.id, filePath: item.filePath });
                    document.getElementById('jbBtnBranch').onclick = () => vscode.postMessage({ command: 'compareWithBranch', filePath: filePath, snapshot: item });
                    document.getElementById('jbBtnBranchVersion').onclick = () => vscode.postMessage({ command: 'compareWithBranchVersion', filePath: filePath, snapshot: item });
                    document.getElementById('jbBtnExplain').onclick = () => { document.getElementById('jbBtnExplain').textContent = 'Thinking...'; vscode.postMessage({ command: 'explain', snapshot: item }); };
                } else {
                    document.getElementById('detTime').textContent = (item.hash ? item.hash.substring(0,7) : "") + ' - ' + item.author;
                    document.getElementById('jbBtnRestore').style.display = 'none';
                    document.getElementById('jbBtnBranch').onclick = () => vscode.postMessage({ command: 'compareWithBranch', filePath: filePath, commit: item });
                    document.getElementById('jbBtnBranchVersion').onclick = () => vscode.postMessage({ command: 'compareWithBranchVersion', filePath: filePath, commit: item });
                    document.getElementById('jbBtnExplain').onclick = () => { document.getElementById('jbBtnExplain').textContent = 'Thinking...'; vscode.postMessage({ command: 'explain', commit: item }); };
                }
            }

            vscode.postMessage({ command: "ready" });
            updateLayoutButtons();
        })();`;

        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body { margin: 0; padding: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); font-family: var(--vscode-font-family); height: 100vh; overflow: hidden; display: flex; flex-direction: ${containerFlex}; } .jb-main { display: flex; flex: 1; overflow: hidden; order: 0; min-height: 0; } .jb-table-wrapper { flex: 1; overflow: auto; border-right: 1px solid var(--vscode-panel-border); min-height: 0; } .jb-table { width: 100%; border-collapse: collapse; table-layout: fixed; } .jb-tr { cursor: pointer; border-bottom: 1px solid rgba(128,128,128,0.05); } .jb-tr:hover { background-color: var(--vscode-list-hoverBackground); } .jb-tr.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); } .jb-td { padding: 4px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.85em; } ${sharedStyle}</style></head><body><div id="diffContainer" class="diff-container" style="order: ${diffOrder}; ${diffBorder} flex: 1; min-height: 200px;">${diffHeaderHtml}<div id="detailsHeader" style="display:none;"><div style="display:flex; gap:8px; align-items:center;"><span id="detTime" style="font-size:0.85em; font-weight:bold; opacity:0.8;"></span></div><div class="actions" style="border:none; padding:0; background:transparent;"><button id="jbBtnRestore">Restore</button><button id="jbBtnBranch">Branch</button><button id="jbBtnBranchVersion">Version</button><button id="jbBtnExplain">✨ Explain</button></div></div><div id="explanationBox" style="margin: 8px 12px; font-size: 0.85em; white-space: pre-wrap; display: none; background: var(--vscode-editor-lineHighlightBackground); padding: 8px; border-radius: 4px;"></div><div id="diffContent" class="diff-content"></div></div><div class="jb-main"><div class="jb-table-wrapper"><table class="jb-table"><thead><tr id="headerRow"></tr></thead><tbody id="list"></tbody></table></div></div><script>${jbScript}</script></body></html>`;
    }
}
