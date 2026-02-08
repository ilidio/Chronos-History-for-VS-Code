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
            if (message.command === 'ready') {
                if (this._pendingData) {
                    this._view?.webview.postMessage(this._pendingData);
                }
            } else if (message.command === 'openDiff') {
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
        });

        webviewView.webview.html = this._getHtmlForWebview();
    }

    public showLocalHistory(snapshots: any[], filePath: string, selection?: any) {
        this._currentMode = 'local';
        this._pendingData = { command: 'loadLocal', snapshots, filePath, selection };
        if (this._view) {
            this._view.show?.(true); 
            this._view.webview.postMessage(this._pendingData);
        }
    }

    public showGitHistory(commits: GitCommit[], filePath: string, selection?: any) {
        this._currentMode = 'git';
        this._pendingData = { command: 'loadGit', commits, filePath, selection };
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage(this._pendingData);
        }
    }

    private _getHtmlForWebview() {
        const useJetBrains = vscode.workspace.getConfiguration('chronos').get('ui.useJetBrainsStyle', true);
        
        if (!useJetBrains) {
            const style = "body { margin: 0; padding: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); font-family: var(--vscode-font-family); height: 100vh; overflow: hidden; display: flex; flex-direction: column; } .list { flex: 1; overflow-y: auto; } .entry { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; display: flex; align-items: center; gap: 10px; } .entry:hover { background-color: var(--vscode-list-hoverBackground); } .header { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; } .event-type { font-weight: bold; text-transform: uppercase; font-size: 0.8em; opacity: 0.8; min-width: 60px; } .time { font-family: monospace; opacity: 0.9; min-width: 110px; } .message { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; } .magnitude { font-size: 0.8em; font-weight: bold; margin-left: 10px; } .mag-add { color: #2ea043; margin-right: 6px; } .mag-del { color: #f85149; } .empty-state { padding: 20px; text-align: center; opacity: 0.5; font-style: italic; }";

            const script = `
                (function() {
                    const vscode = acquireVsCodeApi();
                    
                    window.addEventListener("message", event => {
                        const msg = event.data;
                        const el = document.getElementById("list");
                        if (!el) return;
                        el.innerHTML = "";
                        
                        const baseFilePath = msg.filePath;
                        const currentSelection = msg.selection;

                        let items = [];
                        if (msg.command === "loadLocal") {
                            (msg.snapshots || []).forEach(s => {
                                if (s.type === "cluster") items.push(...s.items);
                                else items.push(s);
                            });
                        } else if (msg.command === "loadGit") {
                            items = msg.commits || [];
                        }

                        if (items.length === 0) {
                            el.innerHTML = '<div class="empty-state">No history found.</div>';
                            return;
                        }

                        items.forEach(itemData => {
                            const entry = document.createElement("div");
                            entry.className = "entry";
                            entry.onclick = () => {
                                if (msg.command === "loadLocal") {
                                    vscode.postMessage({ command: "openDiff", snapshot: itemData, baseFilePath, currentSelection });
                                } else {
                                    vscode.postMessage({ command: "openDiff", commit: itemData, baseFilePath, currentSelection, compareWithCurrent: false });
                                }
                            };

                            const header = document.createElement("div");
                            header.className = "header";

                            const type = document.createElement("span");
                            type.className = "event-type";
                            type.textContent = msg.command === "loadLocal" ? itemData.eventType : itemData.hash.substring(0, 7);

                            const time = document.createElement("span");
                            time.className = "time";
                            time.textContent = msg.command === "loadLocal" ? new Date(itemData.timestamp).toLocaleString() : itemData.date;

                            const message = document.createElement("span");
                            message.className = "message";
                            message.textContent = msg.command === "loadLocal" ? (itemData.label || itemData.filePath) : itemData.message;

                            header.appendChild(type);
                            header.appendChild(time);
                            header.appendChild(message);

                            if (msg.command === "loadLocal" && (itemData.linesAdded || itemData.linesDeleted)) {
                                const mag = document.createElement("div");
                                mag.className = "magnitude";
                                if (itemData.linesAdded) {
                                    const add = document.createElement("span");
                                    add.className = "mag-add";
                                    add.textContent = "+" + itemData.linesAdded;
                                    mag.appendChild(add);
                                }
                                if (itemData.linesDeleted) {
                                    const del = document.createElement("span");
                                    del.className = "mag-del";
                                    del.textContent = "-" + itemData.linesDeleted;
                                    mag.appendChild(del);
                                }
                                header.appendChild(mag);
                            }

                            entry.appendChild(header);
                            el.appendChild(entry);
                        });
                    });

                    vscode.postMessage({ command: "ready" });
                })();
            `;

            return "<!DOCTYPE html><html><head><meta charset='UTF-8'><style>" + style + "</style></head><body><div id='list' class='list'><div class='empty-state'>Waiting for history selection...</div></div><script>" + script + "</script></body></html>";
        }

        // JETBRAINS STYLE FOR PANEL
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body { margin: 0; padding: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); font-family: var(--vscode-font-family); height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
            .jb-main { display: flex; flex: 1; overflow: hidden; }
            .jb-table-wrapper { flex: 1; overflow: auto; border-right: 1px solid var(--vscode-panel-border); }
            .jb-details-pane { width: 250px; display: flex; flex-direction: column; background: var(--vscode-sideBar-background); padding: 8px; gap: 8px; overflow-y: auto; border-left: 1px solid var(--vscode-panel-border); }
            .jb-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .jb-thead { position: sticky; top: 0; background: var(--vscode-sideBar-background); z-index: 10; border-bottom: 1px solid var(--vscode-panel-border); }
            .jb-th { text-align: left; padding: 4px 8px; font-weight: normal; opacity: 0.7; font-size: 0.8em; }
            .jb-tr { cursor: pointer; border-bottom: 1px solid rgba(128,128,128,0.05); }
            .jb-tr:hover { background-color: var(--vscode-list-hoverBackground); }
            .jb-tr.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .jb-td { padding: 4px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.85em; }
            .col-time { width: 85px; }
            .col-type { width: 80px; }
            .jb-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; cursor: pointer; border-radius: 2px; font-size: 0.85em; width: 100%; text-align: center; }
            .jb-btn:hover { background: var(--vscode-button-hoverBackground); }
            .jb-label { font-size: 0.75em; opacity: 0.7; }
            .jb-value { font-size: 0.85em; font-weight: bold; margin-bottom: 4px; word-break: break-all; }
            .empty-state { padding: 20px; text-align: center; opacity: 0.5; font-style: italic; }
        </style></head>
        <body>
        <div class="jb-main">
            <div class="jb-table-wrapper">
                <table class="jb-table">
                    <thead class="jb-thead">
                        <tr>
                            <th class="jb-th col-time">Time</th>
                            <th class="jb-th col-type">Event</th>
                            <th class="jb-th">Message</th>
                        </tr>
                    </thead>
                    <tbody id="list"></tbody>
                </table>
            </div>
            <div id="detailsPane" class="jb-details-pane" style="display: none;">
                <div class="jb-label">Selected Snapshot</div>
                <div id="detTime" class="jb-value"></div>
                <div class="jb-label">Type</div>
                <div id="detType" class="jb-value"></div>
                <button id="jbBtnRestore" class="jb-btn">Restore</button>
                <div id="explanationBox" style="margin-top: 8px; font-size: 0.85em; opacity: 0.9; white-space: pre-wrap;"></div>
            </div>
        </div>
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
                let currentIndex = -1; let items = []; let currentMode = 'local';
                let baseFilePath = ''; let currentSelection = null;

                window.addEventListener("message", event => {
                    const msg = event.data;
                    if (msg.command === "loadLocal" || msg.command === "loadGit") {
                        currentMode = msg.command === "loadLocal" ? 'local' : 'git';
                        baseFilePath = msg.filePath;
                        currentSelection = msg.selection;
                        items = [];
                        if (currentMode === "local") {
                            (msg.snapshots || []).forEach(s => {
                                if (s.type === "cluster") items.push(...s.items);
                                else items.push(s);
                            });
                        } else {
                            items = msg.commits || [];
                        }
                        renderList();
                    }
                });

                function renderList() {
                    const el = document.getElementById('list'); el.innerHTML = '';
                    if (items.length === 0) {
                        el.innerHTML = '<tr><td colspan="3" class="empty-state">No history found.</td></tr>';
                        return;
                    }
                    items.forEach((item, idx) => {
                        const tr = document.createElement('tr');
                        tr.className = 'jb-tr' + (currentIndex === idx ? ' selected' : '');
                        tr.onclick = () => { currentIndex = idx; renderList(); updateDetails(item); };
                        
                        const tdTime = document.createElement('td'); tdTime.className = 'jb-td col-time';
                        if (currentMode === 'local') {
                            tdTime.textContent = new Date(item.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
                        } else {
                            tdTime.textContent = item.date.split(' ')[0];
                        }
                        
                        const tdType = document.createElement('td'); tdType.className = 'jb-td col-type';
                        tdType.textContent = currentMode === 'local' ? item.eventType : item.hash.substring(0, 7);
                        
                        const tdLabel = document.createElement('td'); tdLabel.className = 'jb-td col-label';
                        if (currentMode === 'local') {
                            tdLabel.textContent = item.label || item.filePath.split(/[\\\\/]/).pop() || 'Snapshot';
                        } else {
                            tdLabel.textContent = item.message;
                        }
                        
                        tr.appendChild(tdTime); tr.appendChild(tdType); tr.appendChild(tdLabel);
                        el.appendChild(tr);
                    });
                }

                function updateDetails(item) {
                    document.getElementById('detailsPane').style.display = 'flex';
                    if (currentMode === 'local') {
                        document.getElementById('detTime').textContent = new Date(item.timestamp).toLocaleString();
                        document.getElementById('detType').textContent = item.eventType;
                        document.getElementById('jbBtnRestore').style.display = 'block';
                        document.getElementById('jbBtnRestore').onclick = () => vscode.postMessage({ command: 'openDiff', snapshot: item, baseFilePath, currentSelection });
                        // In Panel mode, we usually trigger the diff on click, but we can also add Restore command
                        // This btn for now just opens the diff to be consistent with your requirement
                        vscode.postMessage({ command: 'openDiff', snapshot: item, baseFilePath, currentSelection });
                    } else {
                        document.getElementById('detTime').textContent = item.date;
                        document.getElementById('detType').textContent = item.hash.substring(0, 7);
                        document.getElementById('jbBtnRestore').style.display = 'none';
                        vscode.postMessage({ command: 'openDiff', commit: item, baseFilePath, currentSelection, compareWithCurrent: false });
                    }
                }

                vscode.postMessage({ command: 'ready' });
            })();
        </script></body></html>`;

    }
}