import * as vscode from 'vscode';
import { Snapshot, GitCommit } from '../types';

export class HistoryViewProvider {
    public static readonly viewType = 'chronos.historyView';

    constructor(private readonly _extensionUri: vscode.Uri, private readonly _outputChannel: vscode.OutputChannel) {}

    private _getSharedStyles() {
        return `
            body { margin: 0; padding: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); font-family: var(--vscode-font-family); height: 100vh; overflow: hidden; display: flex; }
            .container { display: flex; width: 100%; height: 100%; }
            .sidebar { width: 300px; min-width: 250px; border-right: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; background-color: var(--vscode-sideBar-background); }
            .list { flex: 1; overflow-y: auto; }
            .entry { padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; transition: background-color 0.2s; }
            .entry:hover { background-color: var(--vscode-list-hoverBackground); }
            .entry.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .header { display: flex; justify-content: space-between; font-size: 0.85em; margin-bottom: 6px; }
            .event-type { font-weight: bold; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.5px; }
            .label-badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; display: inline-block; font-size: 0.8em; margin: 4px 0; }
            .search-box { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); }
            .search-input { width: 100%; box-sizing: border-box; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
            
            .main-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
            .details-header { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); background-color: var(--vscode-editor-background); display: none; }
            .actions { margin-top: 5px; display: flex; gap: 8px; justify-content: flex-start; align-items: center; }
            .actions button { 
                background: var(--vscode-button-background); 
                color: var(--vscode-button-foreground); 
                border: none; 
                padding: 6px 14px; 
                cursor: pointer; 
                border-radius: 2px;
                font-size: 0.9em;
            }
            .actions button:hover { background: var(--vscode-button-hoverBackground); }
            
            .explanation-box {
                margin-top: 10px;
                padding: 10px;
                background-color: var(--vscode-textBlockQuote-background);
                border-left: 3px solid var(--vscode-textBlockQuote-border);
                font-size: 0.9em;
                display: none;
                white-space: pre-wrap;
            }

            .diff-container { flex: 1; overflow: auto; background-color: var(--vscode-editor-background); }
            .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.5; text-align: center; padding: 40px; font-style: italic; }
            
            pre { margin: 0; padding: 0; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.4; }
            .diff-line { display: flex; white-space: pre; min-width: 100%; }
            .diff-line > div { padding: 0 10px; }
            .diff-add { background-color: var(--vscode-diffEditor-insertedTextBackground); color: var(--vscode-gitDecoration-addedResourceForeground); width: 100%; }
            .diff-del { background-color: var(--vscode-diffEditor-removedTextBackground); color: var(--vscode-gitDecoration-deletedResourceForeground); width: 100%; }
            .diff-meta { color: var(--vscode-descriptionForeground); opacity: 0.7; background-color: var(--vscode-editor-lineHighlightBackground); width: 100%; font-weight: bold; }
            .diff-header { color: var(--vscode-symbolIcon-propertyForeground); font-weight: bold; background-color: var(--vscode-editor-lineHighlightBackground); width: 100%; padding: 5px 10px !important; border-bottom: 1px solid var(--vscode-panel-border); }
        `;
    }

    public show(snapshots: Snapshot[], currentFileUri: vscode.Uri | undefined, getDiff: ((s: Snapshot) => Promise<string>) | undefined, selection?: vscode.Range, onSearch?: (query: string) => Promise<Snapshot[]>, onExplain?: (s: Snapshot) => Promise<string>) {
        const panel = vscode.window.createWebviewPanel(
            HistoryViewProvider.viewType,
            'Chronos History',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this._getHtmlForWebview();

        const selectionData = selection ? {
            startLine: selection.start.line,
            endLine: selection.end.line
        } : null;

        const config = vscode.workspace.getConfiguration('chronos');
        const showDiffSideBySide = config.get<boolean>('showDiffSideBySide', true);
        const explainEnabled = !!onExplain;

        panel.webview.onDidReceiveMessage(
            async message => {
                if (message.command === 'log') {
                    this._outputChannel.appendLine(`[Webview Local Log] ${message.text}`);
                    return;
                }
                
                this._outputChannel.appendLine(`[Webview Local] Received message: ${message.command}`);
                switch (message.command) {
                    case 'ready':
                        panel.webview.postMessage({
                            command: 'loadHistory',
                            snapshots,
                            selection: selectionData,
                            filePath: currentFileUri ? currentFileUri.fsPath : '',
                            showDiffSideBySide,
                            explainEnabled
                        });
                        return;
                    case 'openDiff':
                        this._outputChannel.appendLine(`[Webview Local] Triggering openDiff for snapshot ${message.snapshot?.id}`);
                        vscode.commands.executeCommand('_chronos.openDiff', message.snapshot, message.baseFilePath, message.currentSelection);
                        return;
                    case 'getDiff':
                        if (getDiff) {
                            try {
                                const diff = await getDiff(message.snapshot);
                                panel.webview.postMessage({ command: 'diffLoaded', diff });
                            } catch (e) {
                                panel.webview.postMessage({ command: 'diffLoaded', diff: 'Error loading diff: ' + e });
                            }
                        }
                        return;
                    case 'explain':
                        if (onExplain) {
                            try {
                                const text = await onExplain(message.snapshot);
                                panel.webview.postMessage({ command: 'explainResult', text });
                            } catch (e) {
                                panel.webview.postMessage({ command: 'explainResult', text: 'Error generating explanation: ' + e });
                            }
                        }
                        return;
                    case 'restore':
                        vscode.commands.executeCommand('chronos.restoreSnapshot', message.snapshotId, message.filePath);
                        return;
                    case 'search':
                        if (onSearch) {
                            const results = await onSearch(message.query);
                            panel.webview.postMessage({
                                command: 'loadHistory',
                                snapshots: results,
                                selection: null,
                                filePath: 'Search Results: "' + message.query + '"',
                                showDiffSideBySide,
                                explainEnabled
                            });
                        }
                        return;
                }
            }
        );
    }

    public showGit(commits: GitCommit[], filePath: string) {
        const panel = vscode.window.createWebviewPanel(
            HistoryViewProvider.viewType,
            'Git History Selection',
            vscode.ViewColumn.Two,
            { enableScripts: true }
        );

        panel.webview.html = this._getGitHtml();
        
        const config = vscode.workspace.getConfiguration('chronos');
        const showDiffSideBySide = config.get<boolean>('showDiffSideBySide', true);

        panel.webview.onDidReceiveMessage(message => {
            if (message.command === 'log') {
                this._outputChannel.appendLine(`[Webview Git Log] ${message.text}`);
                return;
            }

            this._outputChannel.appendLine(`[Webview Git] Received message: ${message.command}`);
            if (message.command === 'ready') {
                panel.webview.postMessage({ command: 'loadCommits', commits, filePath, showDiffSideBySide });
            } else if (message.command === 'openDiff') {
                this._outputChannel.appendLine(`[Webview Git] Triggering openDiffGit for commit ${message.commit?.hash}`);
                vscode.commands.executeCommand('_chronos.openDiffGit', message.commit, message.filePath);
            }
        });
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>${this._getSharedStyles()}</style>
        </head>
        <body>
            <div class="container">
                <div class="sidebar">
                    <div class="search-box">
                        <input type="text" id="searchInput" class="search-input" placeholder="Search history...">
                    </div>
                    <div id="list" class="list"><div class="empty-state">Initializing...</div></div>
                </div>
                <div class="main-view">
                    <div id="detailsHeader" class="details-header">
                        <div class="actions">
                            <button id="btnRestore">Restore Snapshot</button>
                            <button id="btnExplain" style="display:none; margin-left:8px">✨ Explain</button>
                        </div>
                        <div id="explanationBox" class="explanation-box"></div>
                    </div>
                    <div id="diffContainer" class="diff-container">
                        <div class="empty-state">Select a snapshot to view changes</div>
                    </div>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                let snapshots = [];
                let currentSelection = null;
                let baseFilePath = '';
                let showDiffSideBySide = true;
                let explainEnabled = false;

                function log(text) {
                    vscode.postMessage({ command: 'log', text: text });
                }

                window.onload = () => {
                    log('Window loaded, sending ready');
                    vscode.postMessage({ command: 'ready' });
                };

                document.getElementById('searchInput').addEventListener('keyup', (e) => {
                    if (e.key === 'Enter') {
                        document.getElementById('list').innerHTML = '<div class="empty-state">Searching...</div>';
                        vscode.postMessage({ command: 'search', query: e.target.value });
                    }
                });

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.command === 'loadHistory') {
                        log('Received loadHistory with ' + (msg.snapshots ? msg.snapshots.length : 0) + ' snapshots');
                        snapshots = msg.snapshots || [];
                        currentSelection = msg.selection;
                        baseFilePath = msg.filePath;
                        showDiffSideBySide = msg.showDiffSideBySide;
                        explainEnabled = msg.explainEnabled;
                        
                        if (showDiffSideBySide) {
                            document.getElementById('diffContainer').style.display = 'none';
                            document.querySelector('.sidebar').style.width = '100%';
                        } else {
                            document.getElementById('diffContainer').style.display = 'block';
                            document.querySelector('.sidebar').style.width = '300px';
                        }
                        
                        renderList(msg.filePath);
                    } else if (msg.command === 'diffLoaded') {
                        log('Received diffLoaded');
                        renderDiff(msg.diff);
                    } else if (msg.command === 'explainResult') {
                        const btn = document.getElementById('btnExplain');
                        btn.textContent = '✨ Explain';
                        btn.disabled = false;
                        
                        const box = document.getElementById('explanationBox');
                        box.style.display = 'block';
                        box.textContent = msg.text;
                    }
                });

                function renderList(path) {
                    const el = document.getElementById('list');
                    if (snapshots.length === 0) {
                        el.innerHTML = '<div class="empty-state">No history found for:<br>' + path + '</div>';
                        return;
                    }
                    el.innerHTML = snapshots.map((s, i) => {
                        const date = new Date(s.timestamp);
                        return '<div class="entry" onclick="selectSnapshot(' + i + ')">' + 
                            '<div class="header">' + 
                                '<span class="event-type">' + s.eventType + '</span>' + 
                                '<span>' + date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) + '</span>' + 
                            '</div>' + 
                            (s.label ? '<div class="label-badge">' + s.label + '</div>' : '') + 
                            '<div style="font-size:0.75em; opacity:0.6; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + s.filePath + '</div>' +
                            '<div style="font-size:0.85em; opacity:0.6">' + date.toLocaleDateString() + '</div>' + 
                        '</div>';
                    }).join('');
                }

                function selectSnapshot(i) {
                    const s = snapshots[i];
                    const entries = document.querySelectorAll('.entry');
                    entries.forEach((e, idx) => e.classList.toggle('selected', idx === i));
                    
                    document.getElementById('detailsHeader').style.display = 'block';
                    document.getElementById('explanationBox').style.display = 'none';
                    document.getElementById('btnRestore').onclick = (e) => {
                        e.stopPropagation();
                        vscode.postMessage({ command: 'restore', snapshotId: s.id, filePath: s.filePath });
                    };

                    const btnExplain = document.getElementById('btnExplain');
                    if (explainEnabled) {
                        btnExplain.style.display = 'inline-block';
                        btnExplain.onclick = (e) => {
                            e.stopPropagation();
                            btnExplain.textContent = 'Thinking...';
                            btnExplain.disabled = true;
                            vscode.postMessage({ command: 'explain', snapshotId: s.id, snapshot: s });
                        };
                    } else {
                        btnExplain.style.display = 'none';
                    }

                    if (showDiffSideBySide) {
                        vscode.postMessage({
                            command: 'openDiff', 
                            snapshot: s, 
                            baseFilePath: baseFilePath,
                            currentSelection: currentSelection
                        });
                    } else {
                        document.getElementById('diffContainer').innerHTML = '<div class="empty-state">Loading diff...</div>';
                        vscode.postMessage({ command: 'getDiff', snapshot: s });
                    }
                }

                function renderDiff(diff) {
                    const container = document.getElementById('diffContainer');
                    if (!diff || diff.trim() === '') {
                        container.innerHTML = '<div class="empty-state">No changes detected.</div>';
                        return;
                    }
                    container.innerHTML = '<pre>' + diff.split(/\\r?\\n/).map(line => {
                        if (line.startsWith('diff --git') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('new file mode') || line.startsWith('deleted file mode')) {
                            return '';
                        }
                        
                        let cls = '';
                        if (line.startsWith("+") && !line.startsWith("+++")) cls = "diff-add";
                        else if (line.startsWith("-") && !line.startsWith("---")) cls = "diff-del";
                        else if (line.startsWith("@@")) cls = "diff-meta";
                        return '<div class="diff-line"><div class="' + cls + '">' + escapeHtml(line) + '</div></div>';
                    }).join('') + '</pre>';
                }

                function escapeHtml(s) {
                    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                }
            </script>
        </body>
        </html>`;
    }

    private _getGitHtml() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>${this._getSharedStyles()}</style>
        </head>
        <body>
            <div class="container">
                <div class="sidebar">
                    <div id="list" class="list"></div>
                </div>
                <div class="main-view">
                    <div id="diffContainer" class="diff-container">
                        <div class="empty-state">Select a commit</div>
                    </div>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                let commits = [];
                let baseFilePath = '';
                let showDiffSideBySide = true;

                function log(text) {
                    vscode.postMessage({ command: 'log', text: text });
                }

                window.onload = () => {
                    log('Window loaded, sending ready');
                    vscode.postMessage({ command: 'ready' });
                };

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.command === 'loadCommits') {
                        log('Received loadCommits with ' + (msg.commits ? msg.commits.length : 0) + ' commits');
                        commits = msg.commits || [];
                        baseFilePath = msg.filePath;
                        showDiffSideBySide = msg.showDiffSideBySide;

                         // Hide diff container if side-by-side
                        if (showDiffSideBySide) {
                            document.getElementById('diffContainer').style.display = 'none';
                            document.querySelector('.sidebar').style.width = '100%';
                        } else {
                            document.getElementById('diffContainer').style.display = 'block';
                            document.querySelector('.sidebar').style.width = '300px';
                        }

                        render();
                    }
                });
                function render() {
                    const listEl = document.getElementById('list');
                    if (!listEl) return;
                    if (commits.length === 0) {
                        listEl.innerHTML = '<div class="empty-state">No git history found.</div>';
                        return;
                    }
                    listEl.innerHTML = commits.map((c, i) => {
                        return '<div class="entry" onclick="select(' + i + ')">' + 
                            '<div class="header">' + 
                                '<span class="event-type" style="font-family:monospace">' + c.hash.substring(0,7) + '</span>' + 
                                '<span>' + c.date + '</span>' + 
                            '</div>' + 
                            '<div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + c.message + '</div>' + 
                        '</div>';
                    }).join('');
                }
                function select(i) {
                    const c = commits[i];
                    log('Selected commit ' + i);
                    const entries = document.querySelectorAll('.entry');
                    entries.forEach((e, idx) => e.classList.toggle('selected', idx === i));
                    
                    if (showDiffSideBySide) {
                        vscode.postMessage({
                            command: 'openDiff', 
                            commit: c, 
                            filePath: baseFilePath 
                        });
                    } else {
                        renderDiff(c.diff);
                    }
                }
                function renderDiff(diff) {
                    const container = document.getElementById('diffContainer');
                    if (!diff) {
                        container.innerHTML = '<div class="empty-state">No diff available</div>';
                        return;
                    }
                    container.innerHTML = '<pre>' + diff.split(/\\r?\\n/).map(line => {
                        if (line.startsWith('diff --git') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('new file mode') || line.startsWith('deleted file mode')) {
                            return '';
                        }

                        let cls = '';
                        if (line.startsWith("+") && !line.startsWith("+++")) cls = "diff-add";
                        else if (line.startsWith("-") && !line.startsWith("---")) cls = "diff-del";
                        else if (line.startsWith("@@")) cls = "diff-meta";
                        return '<div class="diff-line"><div class="' + cls + '">' + escapeHtml(line) + '</div></div>';
                    }).join('') + '</pre>';
                }
                function escapeHtml(s) {
                    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                }
            </script>
        </body>
        </html>`;
    }
}
