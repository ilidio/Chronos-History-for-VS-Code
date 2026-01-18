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
            .entry { padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; transition: background-color 0.2s; position: relative; }
            .entry:hover { background-color: var(--vscode-list-hoverBackground); }
            .entry.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .header { display: flex; justify-content: space-between; font-size: 0.85em; margin-bottom: 6px; }
            .event-type { font-weight: bold; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.5px; }
            .label-badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; display: inline-block; font-size: 0.8em; margin: 4px 0; }
            .search-box { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 4px; }
            .search-input { flex: 1; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
            .btn-semantic { padding: 4px 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; cursor: pointer; border-radius: 2px; font-size: 0.8em; }
            .btn-semantic:hover { background: var(--vscode-button-secondaryHoverBackground); }
            
            .magnitude { font-size: 0.8em; font-weight: bold; margin-top: 4px; }
            .mag-add { color: #2ea043; margin-right: 6px; }
            .mag-del { color: #f85149; }

            .cluster-header { background: var(--vscode-editor-lineHighlightBackground); padding: 6px 12px; font-size: 0.8em; font-weight: bold; opacity: 0.8; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
            .cluster-items { display: none; border-left: 2px solid var(--vscode-panel-border); margin-left: 10px; }
            .cluster-items.expanded { display: block; }

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
            
            .explanation-box { margin-top: 10px; padding: 10px; background-color: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); font-size: 0.9em; display: none; white-space: pre-wrap; }
            .diff-container { flex: 1; overflow: auto; background-color: var(--vscode-editor-background); }
            .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.5; text-align: center; padding: 40px; font-style: italic; }
            pre { margin: 0; padding: 0; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.4; }
            .diff-line { display: flex; white-space: pre; min-width: 100%; }
            .diff-line > div { padding: 0 10px; }
            .diff-add { background-color: var(--vscode-diffEditor-insertedTextBackground); color: var(--vscode-gitDecoration-addedResourceForeground); width: 100%; }
            .diff-del { background-color: var(--vscode-diffEditor-removedTextBackground); color: var(--vscode-gitDecoration-deletedResourceForeground); width: 100%; }
            .diff-meta { color: var(--vscode-descriptionForeground); opacity: 0.7; background-color: var(--vscode-editor-lineHighlightBackground); width: 100%; font-weight: bold; }
        `;
    }

    public show(snapshots: any[], currentFileUri: vscode.Uri | undefined, getDiff?: any, selection?: vscode.Range, onSearch?: any, onExplain?: any, onSemanticSearch?: any) {
        const panel = vscode.window.createWebviewPanel(HistoryViewProvider.viewType, 'Chronos History', vscode.ViewColumn.Two, { enableScripts: true, localResourceRoots: [this._extensionUri], retainContextWhenHidden: true });
        panel.webview.html = this._getHtmlForWebview();

        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'log') { this._outputChannel.appendLine(`[Webview Local Log] ${message.text}`); return; }
            switch (message.command) {
                case 'ready':
                    panel.webview.postMessage({ command: 'loadHistory', snapshots, selection: selection ? { startLine: selection.start.line, endLine: selection.end.line } : null, filePath: currentFileUri ? currentFileUri.fsPath : '', showDiffSideBySide: vscode.workspace.getConfiguration('chronos').get('showDiffSideBySide', true), explainEnabled: !!onExplain, semanticEnabled: !!onSemanticSearch });
                    return;
                case 'openDiff': vscode.commands.executeCommand('_chronos.openDiff', message.snapshot, message.baseFilePath, message.currentSelection); return;
                case 'getDiff': if (getDiff) { try { const diff = await getDiff(message.snapshot); panel.webview.postMessage({ command: 'diffLoaded', diff }); } catch (e) { panel.webview.postMessage({ command: 'diffLoaded', diff: 'Error: ' + e }); } } return;
                case 'explain': if (onExplain) { const text = await onExplain(message.snapshot); panel.webview.postMessage({ command: 'explainResult', text }); } return;
                case 'restore': vscode.commands.executeCommand('chronos.restoreSnapshot', message.snapshotId, message.filePath); return;
                case 'search': if (onSearch) { const results = await onSearch(message.query); panel.webview.postMessage({ command: 'loadHistory', snapshots: results, selection: null, filePath: 'Search: ' + message.query }); } return;
                case 'semanticSearch': if (onSemanticSearch) { const results = await onSemanticSearch(message.query); panel.webview.postMessage({ command: 'loadHistory', snapshots: results, selection: null, filePath: 'AI Search: ' + message.query }); } return;
            }
        });
    }

    public showGit(commits: GitCommit[], filePath: string, onExplain?: (c: GitCommit) => Promise<string>) {
        const panel = vscode.window.createWebviewPanel(HistoryViewProvider.viewType, 'Git History Selection', vscode.ViewColumn.Two, { enableScripts: true });
        panel.webview.html = this._getGitHtml();
        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'log') { this._outputChannel.appendLine(`[Webview Git Log] ${message.text}`); return; }
            if (message.command === 'ready') panel.webview.postMessage({ command: 'loadCommits', commits, filePath, showDiffSideBySide: vscode.workspace.getConfiguration('chronos').get('showDiffSideBySide', true), explainEnabled: !!onExplain });
            else if (message.command === 'openDiff') vscode.commands.executeCommand('_chronos.openDiffGit', message.commit, message.filePath);
            else if (message.command === 'explain') { if (onExplain) { const text = await onExplain(message.commit); panel.webview.postMessage({ command: 'explainResult', text }); } }
        });
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${this._getSharedStyles()}</style></head>
        <body><div class="container"><div class="sidebar">
            <div class="search-box">
                <input type="text" id="searchInput" class="search-input" placeholder="Search history...">
                <button id="btnSemantic" class="btn-semantic" title="Semantic AI Search">🧠</button>
            </div>
            <div id="list" class="list"></div>
        </div><div class="main-view"><div id="detailsHeader" class="details-header"><div class="actions">
            <button id="btnRestore">Restore</button><button id="btnExplain" style="display:none">✨ Explain</button>
        </div><div id="explanationBox" class="explanation-box"></div></div><div id="diffContainer" class="diff-container">
        <div class="empty-state">Select a snapshot</div></div></div></div>
        <script>
            const vscode = acquireVsCodeApi();
            let snapshots = []; let currentSelection = null; let baseFilePath = ''; let showDiffSideBySide = true; let explainEnabled = false;
            window.onload = () => vscode.postMessage({ command: 'ready' });
            document.getElementById('searchInput').addEventListener('keyup', e => { if (e.key === 'Enter') vscode.postMessage({ command: 'search', query: e.target.value }); });
            document.getElementById('btnSemantic').onclick = () => { const q = document.getElementById('searchInput').value; if(q) { document.getElementById('list').innerHTML = '<div class="empty-state">AI is searching...</div>'; vscode.postMessage({ command: 'semanticSearch', query: q }); } };
            window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.command === 'loadHistory') {
                    snapshots = msg.snapshots || []; currentSelection = msg.selection; baseFilePath = msg.filePath; showDiffSideBySide = msg.showDiffSideBySide; explainEnabled = msg.explainEnabled;
                    document.getElementById('diffContainer').style.display = showDiffSideBySide ? 'none' : 'block';
                    document.querySelector('.sidebar').style.width = showDiffSideBySide ? '100%' : '300px';
                    renderList();
                } else if (msg.command === 'diffLoaded') renderDiff(msg.diff);
                else if (msg.command === 'explainResult') { document.getElementById('btnExplain').textContent = '✨ Explain'; document.getElementById('btnExplain').disabled = false; document.getElementById('explanationBox').style.display = 'block'; document.getElementById('explanationBox').textContent = msg.text; }
            });
            function renderList() {
                const el = document.getElementById('list');
                if (snapshots.length === 0) { el.innerHTML = '<div class="empty-state">No history found.</div>'; return; }
                el.innerHTML = snapshots.map((s, i) => {
                    if (s.type === 'cluster') {
                        return '<div class="cluster-container"><div class="cluster-header" onclick="toggleCluster(' + i + ')">📦 Session: ' + s.items.length + ' saves (' + new Date(s.timestamp).toLocaleTimeString() + ')</div>' +
                               '<div id="cluster-' + i + '" class="cluster-items">' + s.items.map((item, j) => renderEntry(item, i + '-' + j)).join('') + '</div></div>';
                    }
                    return renderEntry(s, i);
                }).join('');
            }
            function renderEntry(s, id) {
                const date = new Date(s.timestamp);
                const mag = (s.linesAdded || s.linesDeleted) ? '<div class="magnitude">' + (s.linesAdded ? '<span class="mag-add">+' + s.linesAdded + '</span>' : '') + (s.linesDeleted ? '<span class="mag-del">-' + s.linesDeleted + '</span>' : '') + '</div>' : '';
                return '<div class="entry" id="entry-' + id + '" onclick="selectSnapshot(' + (typeof id === 'string' ? "'" + id + "'" : id) + ')">' + 
                    '<div class="header"><span class="event-type">' + s.eventType + '</span><span>' + date.toLocaleTimeString([], {hour: "2-digit",minute: "2-digit"}) + '</span></div>' + 
                    (s.label ? '<div class="label-badge">' + s.label + '</div>' : '') + 
                    '<div style="font-size:0.75em; opacity:0.6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + s.filePath + '</div>' + 
                    mag + '</div>';
            }
            function toggleCluster(id) { document.getElementById('cluster-' + id).classList.toggle('expanded'); }
            function selectSnapshot(id) {
                let s;
                if (typeof id === 'string') { const [cIdx, iIdx] = id.split('-'); s = snapshots[cIdx].items[iIdx]; }
                else { s = snapshots[id]; }
                document.querySelectorAll('.entry').forEach(e => e.classList.toggle('selected', e.id === 'entry-' + id));
                document.getElementById('detailsHeader').style.display = 'block';
                document.getElementById('explanationBox').style.display = 'none';
                document.getElementById('btnRestore').onclick = () => vscode.postMessage({ command: 'restore', snapshotId: s.id, filePath: s.filePath });
                if (explainEnabled) { 
                    const btn = document.getElementById('btnExplain'); btn.style.display = 'inline-block'; 
                    btn.onclick = () => { btn.textContent = 'Thinking...'; btn.disabled = true; vscode.postMessage({ command: 'explain', snapshot: s }); };
                }
                if (showDiffSideBySide) vscode.postMessage({ command: 'openDiff', snapshot: s, baseFilePath: baseFilePath, currentSelection: currentSelection });
                else { document.getElementById('diffContainer').innerHTML = '<div class="empty-state">Loading...</div>'; vscode.postMessage({ command: 'getDiff', snapshot: s }); }
            }
            function renderDiff(diff) {
                const c = document.getElementById('diffContainer'); if (!diff) { c.innerHTML = ''; return; }
                c.innerHTML = '<pre>' + diff.split(/\\r?\\n/).map(l => {
                    if (l.startsWith('diff') || l.startsWith('index') || l.startsWith('---') || l.startsWith('+++')) return '';
                    let cls = l.startsWith('+') ? 'diff-add' : (l.startsWith('-') ? 'diff-del' : (l.startsWith('@@') ? 'diff-meta' : ''));
                    return '<div class="diff-line"><div class="' + cls + '">' + l.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div></div>';
                }).join('') + '</pre>';
            }
        </script></body></html>`;
    }

    private _getGitHtml() {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${this._getSharedStyles()}</style></head>
        <body><div class="container"><div class="sidebar"><div id="list" class="list"></div></div>
        <div class="main-view"><div id="detailsHeader" class="details-header"><div class="actions">
            <button id="btnExplain" style="display:none">✨ Explain</button>
        </div><div id="explanationBox" class="explanation-box"></div></div><div id="diffContainer" class="diff-container">
        <div class="empty-state">Select a commit</div></div></div></div>
        <script>
            const vscode = acquireVsCodeApi(); let commits = []; let baseFilePath = ''; let showDiffSideBySide = true; let explainEnabled = false;
            window.onload = () => vscode.postMessage({ command: 'ready' });
            window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.command === 'loadCommits') {
                    commits = msg.commits || []; baseFilePath = msg.filePath; showDiffSideBySide = msg.showDiffSideBySide; explainEnabled = msg.explainEnabled;
                    document.getElementById('diffContainer').style.display = showDiffSideBySide ? 'none' : 'block';
                    document.querySelector('.sidebar').style.width = showDiffSideBySide ? '100%' : '300px';
                    render();
                } else if (msg.command === 'explainResult') {
                    const btn = document.getElementById('btnExplain'); btn.textContent = '✨ Explain'; btn.disabled = false;
                    const box = document.getElementById('explanationBox'); box.style.display = 'block'; box.textContent = msg.text;
                }
            });
            function render() {
                const el = document.getElementById('list'); if (commits.length === 0) { el.innerHTML = '<div class="empty-state">No git history.</div>'; return; }
                el.innerHTML = commits.map((c, i) => '<div class="entry" id="entry-' + i + '" onclick="select(' + i + ')"><div class="header"><span class="event-type" style="font-family:monospace">' + c.hash.substring(0,7) + '</span><span>' + c.date + '</span></div><div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + c.message + '</div></div>').join('');
            }
            function select(i) {
                const c = commits[i]; document.querySelectorAll('.entry').forEach((e, idx) => e.classList.toggle('selected', idx === i));
                document.getElementById('detailsHeader').style.display = 'block';
                document.getElementById('explanationBox').style.display = 'none';
                
                const btnExplain = document.getElementById('btnExplain');
                if (explainEnabled) {
                    btnExplain.style.display = 'inline-block';
                    btnExplain.onclick = () => { btnExplain.textContent = 'Thinking...'; btnExplain.disabled = true; vscode.postMessage({ command: 'explain', commit: c }); };
                }

                if (showDiffSideBySide) vscode.postMessage({ command: 'openDiff', commit: c, filePath: baseFilePath });
                else renderDiff(c.diff);
            }
            function renderDiff(diff) {
                const container = document.getElementById('diffContainer');
                container.innerHTML = '<pre>' + diff.split(/\\r?\\n/).map(l => {
                    if (l.startsWith('diff') || l.startsWith('index') || l.startsWith('---') || l.startsWith('+++')) return '';
                    let cls = l.startsWith('+') ? 'diff-add' : (l.startsWith('-') ? 'diff-del' : (l.startsWith('@@') ? 'diff-meta' : ''));
                    return '<div class="diff-line"><div class="' + cls + '">' + l.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div></div>';
                }).join('') + '</pre>';
            }
        </script></body></html>`;
    }
}