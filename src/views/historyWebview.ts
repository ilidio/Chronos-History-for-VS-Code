import * as vscode from 'vscode';
import { Snapshot, GitCommit } from '../types';

export class HistoryViewProvider {
    public static readonly viewType = 'chronos.historyView';

    constructor(private readonly _extensionUri: vscode.Uri, private readonly _outputChannel: vscode.OutputChannel) {}

    private _getSharedStyles() {
        return `
            body { margin: 0; padding: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); font-family: var(--vscode-font-family); height: 100vh; overflow: hidden; display: flex; }
            .container { display: flex; width: 100%; height: 100%; flex-direction: column; }
            .sidebar { flex: 1; display: flex; flex-direction: column; background-color: var(--vscode-sideBar-background); }
            .list { flex: 1; overflow-y: auto; }
            .entry { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; position: relative; display: flex; flex-direction: column; gap: 4px; }
            .entry:hover { background-color: var(--vscode-list-hoverBackground); }
            .entry.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .entry.compare-source { border-left: 4px solid var(--vscode-textLink-foreground); background-color: var(--vscode-editor-lineHighlightBackground); }
            .entry-actions { position: absolute; right: 4px; top: 4px; display: none; gap: 4px; z-index: 10; }
            .entry:hover .entry-actions { display: flex; }
            .btn-action { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 10px; cursor: pointer; border-radius: 2px; font-size: 1em; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
            .btn-action:hover { background: var(--vscode-button-hoverBackground); transform: scale(1.1); }
            body.comparing .entry:not(.compare-source) { cursor: copy; }
            body.comparing .entry:not(.compare-source):hover { border-right: 4px solid var(--vscode-textLink-foreground); }
            .header { display: flex; justify-content: space-between; font-size: 0.85em; margin-bottom: 2px; align-items: center; }
            .event-type { font-weight: bold; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.5px; opacity: 0.8; }
            .label-badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; display: inline-block; font-size: 0.8em; margin: 2px 0; width: fit-content; }
            .icon-pin { opacity: 0.2; font-size: 1.1em; margin-left: 4px; }
            .icon-pin.pinned { opacity: 1; color: var(--vscode-charts-yellow); }
            .magnitude { font-size: 0.8em; font-weight: bold; margin-top: 2px; }
            .mag-add { color: #2ea043; margin-right: 6px; }
            .mag-del { color: #f85149; }
            .search-box { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; gap: 8px; }
            .search-row { display: flex; gap: 4px; width: 100%; }
            .search-input { flex: 1; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
            .btn-semantic { padding: 4px 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; cursor: pointer; border-radius: 2px; font-size: 0.8em; }
            .btn-semantic:hover { background: var(--vscode-button-secondaryHoverBackground); }
            .search-options { display: flex; align-items: center; gap: 6px; font-size: 0.8em; opacity: 0.8; }
            .compare-banner { background: var(--vscode-textLink-foreground); color: white; padding: 8px 12px; font-size: 0.85em; display: none; justify-content: space-between; align-items: center; z-index: 10; }
            .compare-banner button { background: none; border: 1px solid white; color: white; cursor: pointer; padding: 2px 8px; border-radius: 2px; }
            .cluster-header { background: var(--vscode-editor-lineHighlightBackground); padding: 6px 12px; font-size: 0.8em; font-weight: bold; opacity: 0.8; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
            .cluster-items { display: none; border-left: 2px solid var(--vscode-panel-border); margin-left: 10px; }
            .cluster-items.expanded { display: block; }
            .player-controls { padding: 8px; background: var(--vscode-editor-lineHighlightBackground); border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; justify-content: center; gap: 8px; }
            .btn-player { background: none; border: 1px solid transparent; color: var(--vscode-foreground); cursor: pointer; padding: 4px; border-radius: 4px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
            .btn-player:hover { background-color: var(--vscode-toolbar-hoverBackground); }
            .speed-select { background: none; color: var(--vscode-foreground); border: none; font-size: 0.8em; cursor: pointer; outline: none; }
            .details-header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background-color: var(--vscode-sideBar-background); display: none; }
            .selection-note { font-size: 0.85em; margin-bottom: 8px; font-weight: bold; color: var(--vscode-textLink-foreground); }
            .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
            .actions button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px; font-size: 0.9em; }
            .actions button:hover { background: var(--vscode-button-hoverBackground); }
            .explanation-box { margin-top: 10px; padding: 12px; background-color: var(--vscode-editor-snippetFinalTabstopHighlightBackground); border: 1px solid var(--vscode-editor-snippetFinalTabstopHighlightBorder); border-radius: 4px; font-size: 0.9em; display: none; white-space: pre-wrap; position: relative; animation: fadeIn 0.3s ease-in-out; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
            .explanation-close { position: absolute; top: 4px; right: 8px; cursor: pointer; opacity: 0.6; font-weight: bold; font-size: 1.1em; }
            .explanation-close:hover { opacity: 1; color: var(--vscode-errorForeground); }
            .btn-explain { background-color: var(--vscode-button-secondaryBackground) !important; color: var(--vscode-button-secondaryForeground) !important; }
            .btn-explain:hover { background-color: var(--vscode-button-secondaryHoverBackground) !important; }
            ::-webkit-scrollbar { width: 10px; height: 10px; }
            ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); }
            ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
            ::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground); }
        `;
    }

    public show(snapshots: any[], currentFileUri: vscode.Uri | undefined, getDiff?: any, selection?: vscode.Range, onSearch?: any, onExplain?: any, onSemanticSearch?: any, onTogglePin?: any, onCompareSnapshots?: any) {
        const useJetBrains = vscode.workspace.getConfiguration('chronos').get('ui.useJetBrainsStyle', true);
        const panel = vscode.window.createWebviewPanel(HistoryViewProvider.viewType, 'Chronos History', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [this._extensionUri], retainContextWhenHidden: true });
        panel.webview.html = this._getHtmlForWebview(useJetBrains);
        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'log') { this._outputChannel.appendLine(message.text); return; }
            switch (message.command) {
                case 'ready':
                    panel.webview.postMessage({ command: 'loadHistory', snapshots, selection: selection ? { startLine: selection.start.line, endLine: selection.end.line } : null, filePath: currentFileUri ? currentFileUri.fsPath : '', showDiffSideBySide: vscode.workspace.getConfiguration('chronos').get('showDiffSideBySide', true), explainEnabled: !!onExplain, semanticEnabled: !!onSemanticSearch });
                    return;
                case 'openDiff': vscode.commands.executeCommand('_chronos.openDiff', message.snapshot, message.baseFilePath, message.currentSelection); return;
                case 'explain': if (onExplain) { const text = await onExplain(message.snapshot); panel.webview.postMessage({ command: 'explainResult', text }); } return;
                case 'restore': vscode.commands.executeCommand('chronos.restoreSnapshot', message.snapshotId, message.filePath); return;
                case 'share': vscode.commands.executeCommand('chronos.shareSnapshot', message.snapshot); return;
                case 'compareWithActive': vscode.commands.executeCommand('chronos.compareWithActive', message.snapshot); return;
                case 'openTwoSnapshotsDiff': vscode.commands.executeCommand('chronos.compareTwoSnapshots', message.snapshot1, message.snapshot2); return;
                case 'search': if (onSearch) { const results = await onSearch(message.query, message.searchContent); panel.webview.postMessage({ command: 'loadHistory', snapshots: results, selection: null, filePath: 'Search: ' + message.query }); } return;
                case 'semanticSearch': if (onSemanticSearch) { const results = await onSemanticSearch(message.query); panel.webview.postMessage({ command: 'loadHistory', snapshots: results, selection: null, filePath: 'AI Search: ' + message.query }); } return;
                case 'togglePin': if (onTogglePin) { const newState = await onTogglePin(message.snapshotId); panel.webview.postMessage({ command: 'pinUpdated', snapshotId: message.snapshotId, pinned: newState }); } return;
            }
        });
    }

    public showGit(commits: GitCommit[], filePath: string, selection: {startLine: number, endLine: number}, onExplain?: (c: GitCommit) => Promise<string>, onCompare?: (h1: string, h2: string) => Promise<string>) {
        const useJetBrains = vscode.workspace.getConfiguration('chronos').get('ui.useJetBrainsStyle', true);
        const panel = vscode.window.createWebviewPanel(HistoryViewProvider.viewType, 'Git History Selection', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = this._getGitHtml(useJetBrains);
        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'log') { this._outputChannel.appendLine(message.text); return; }
            if (message.command === 'ready') panel.webview.postMessage({ command: 'loadCommits', commits, filePath, selection, showDiffSideBySide: vscode.workspace.getConfiguration('chronos').get('showDiffSideBySide', true), explainEnabled: !!onExplain });
            else if (message.command === 'openDiff') {
                if (message.compareWithCurrent) vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.commit, filePath, selection);
                else vscode.commands.executeCommand('_chronos.openDiffGit', message.commit, filePath);
            }
            else if (message.command === 'explain') { if (onExplain) { const text = await onExplain(message.commit); panel.webview.postMessage({ command: 'explainResult', text }); } }
        });
    }

    private _getHtmlForWebview(useJetBrains: boolean = false) {
        const styles = this._getSharedStyles();
        if (!useJetBrains) {
            return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles}</style></head>
            <body><div class="container">
            <div id="detailsHeader" class="details-header"><div id="selectionNote" class="selection-note"></div>
            <div class="actions" id="mainActions">
                <button id="btnRestore">Restore</button><button id="btnCompareActive" title="Compare with active editor file">Compare</button>
                <button id="btnShare">Share</button><button id="btnPin">📌 Pin</button>
                <button id="btnExplain" class="btn-explain" title="Explain changes with AI">✨ Explain</button>
            </div><div id="explanationBox" class="explanation-box">
                <div class="explanation-close" onclick="document.getElementById('explanationBox').style.display='none'">✕</div>
                <div id="explanationText"></div>
            </div></div>
            <div class="sidebar"><div class="search-box"><div class="search-row">
                <input type="text" id="searchInput" class="search-input" placeholder="Search history..."><button id="btnSemantic" class="btn-semantic" title="Semantic AI Search">🧠</button>
            </div><div class="search-options"><input type="checkbox" id="chkContent"><label for="chkContent">Deep Search</label></div></div>
            <div id="compareBanner" class="compare-banner"><span>Select comparison target...</span><button onclick="cancelCompare()">Cancel</button></div>
            <div class="player-controls"><button id="btnPrev" class="btn-player" title="Previous Snapshot">◀</button>
                <button id="btnPlay" class="btn-player" title="Play Session">▶</button><button id="btnNext" class="btn-player" title="Next Snapshot">▶</button>
                <select id="speedSelect" class="speed-select" title="Playback Speed">
                    <option value="2000">0.5x</option><option value="1000" selected>1x</option><option value="500">2x</option><option value="200">5x</option>
                </select>
            </div><div id="list" class="list"></div></div></div>
            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    let snapshots = []; let currentSelection = null; let baseFilePath = ''; let explainEnabled = false;
                    let flatSnapshots = []; let currentIndex = -1; let compareSourceId = null; let isPlaying = false; let playInterval = null;
                    window.onload = () => vscode.postMessage({ command: 'ready' });
                    document.getElementById('searchInput').addEventListener('keyup', e => { if (e.key === 'Enter') vscode.postMessage({ command: 'search', query: e.target.value, searchContent: document.getElementById('chkContent').checked }); });
                    document.getElementById('btnSemantic').onclick = () => { const q = document.getElementById('searchInput').value; if(q) vscode.postMessage({ command: 'semanticSearch', query: q }); };
                    document.getElementById('btnPrev').onclick = () => step(1);
                    document.getElementById('btnNext').onclick = () => step(-1);
                    document.getElementById('btnPlay').onclick = togglePlay;
                    function togglePlay() { if (isPlaying) stopPlayback(); else startPlayback(); }
                    function startPlayback() { if (currentIndex <= 0) currentIndex = flatSnapshots.length; isPlaying = true; document.getElementById('btnPlay').textContent = '⏸'; const speed = parseInt(document.getElementById('speedSelect').value); playInterval = setInterval(() => { if (currentIndex > 0) step(-1); else stopPlayback(); }, speed); }
                    function stopPlayback() { isPlaying = false; document.getElementById('btnPlay').textContent = '▶'; clearInterval(playInterval); }
                    function step(dir) { let next = currentIndex + dir; if (next >= 0 && next < flatSnapshots.length) selectSnapshotById(flatSnapshots[next].id); else if (isPlaying) stopPlayback(); }
                    window.addEventListener('message', event => {
                        const msg = event.data;
                        if (msg.command === 'loadHistory') {
                            snapshots = msg.snapshots || []; currentSelection = msg.selection; baseFilePath = msg.filePath; explainEnabled = msg.explainEnabled;
                            flatSnapshots = []; snapshots.forEach(s => { if (s.type === 'cluster') flatSnapshots.push(...s.items); else flatSnapshots.push(s); });
                            renderList();
                        } else if (msg.command === 'explainResult') { 
                            document.getElementById('explanationBox').style.display = 'block'; document.getElementById('explanationText').textContent = msg.text;
                            document.getElementById('btnExplain').innerHTML = '✨ Explain'; document.getElementById('btnExplain').disabled = false;
                        } else if (msg.command === 'pinUpdated') {
                            const s = flatSnapshots.find(x => x.id === msg.snapshotId); if (s) { s.pinned = msg.pinned; renderList(); updateDetails(); }
                        }
                    });
                    function renderList() {
                        const el = document.getElementById('list'); el.innerHTML = '';
                        snapshots.forEach((s, i) => {
                            if (s.type === 'cluster') {
                                const container = document.createElement('div'); container.className = 'cluster-container';
                                const header = document.createElement('div'); header.className = 'cluster-header';
                                header.textContent = '📦 Session: ' + s.items.length + ' saves';
                                header.onclick = () => toggleCluster(i);
                                const items = document.createElement('div'); items.id = 'cluster-' + i; items.className = 'cluster-items';
                                s.items.forEach(item => items.appendChild(createEntry(item)));
                                container.appendChild(header); container.appendChild(items); el.appendChild(container);
                            } else el.appendChild(createEntry(s));
                        });
                    }
                    function createEntry(s) {
                        const isSelected = currentIndex === flatSnapshots.findIndex(x => x.id === s.id);
                        const isSource = compareSourceId === s.id;
                        const div = document.createElement('div');
                        div.className = 'entry' + (isSelected ? ' selected' : '') + (isSource ? ' compare-source' : '');
                        div.id = 'entry-' + s.id;
                        div.onclick = () => selectSnapshotById(s.id);
                        const actions = document.createElement('div'); actions.className = 'entry-actions';
                        const btn = document.createElement('button'); btn.className = 'btn-action'; btn.textContent = '↔';
                        btn.onclick = (e) => { e.stopPropagation(); startCompare(s.id); };
                        actions.appendChild(btn); div.appendChild(actions);
                        const header = document.createElement('div'); header.className = 'header';
                        const type = document.createElement('span'); type.className = 'event-type'; type.textContent = s.eventType;
                        const meta = document.createElement('div'); meta.style.display = 'flex'; meta.style.alignItems = 'center';
                        const time = document.createElement('span'); time.textContent = new Date(s.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
                        const pin = document.createElement('span'); pin.className = 'icon-pin' + (s.pinned ? ' pinned' : ''); pin.textContent = '📌';
                        meta.appendChild(time); meta.appendChild(pin); header.appendChild(type); header.appendChild(meta); div.appendChild(header);
                        const path = document.createElement('div'); path.style.fontSize = '0.75em'; path.style.opacity = '0.6'; path.style.overflow = 'hidden'; path.style.textOverflow = 'ellipsis'; path.style.whiteSpace = 'nowrap';
                        path.textContent = s.filePath; div.appendChild(path);
                        if (s.label) { const lb = document.createElement('div'); lb.className = 'label-badge'; lb.textContent = s.label; div.appendChild(lb); }
                        if (s.linesAdded || s.linesDeleted) {
                            const mag = document.createElement('div'); mag.className = 'magnitude';
                            if (s.linesAdded) { const a = document.createElement('span'); a.className = 'mag-add'; a.textContent = '+' + s.linesAdded; mag.appendChild(a); }
                            if (s.linesDeleted) { const d = document.createElement('span'); d.className = 'mag-del'; d.textContent = '-' + s.linesDeleted; mag.appendChild(d); }
                            div.appendChild(mag);
                        }
                        return div;
                    }
                    function startCompare(id) {
                        if (compareSourceId === null) { compareSourceId = id; document.body.classList.add('comparing'); document.getElementById('compareBanner').style.display = 'flex'; renderList(); }
                        else if (compareSourceId === id) cancelCompare();
                        else { const s1 = flatSnapshots.find(x => x.id === compareSourceId); const s2 = flatSnapshots.find(x => x.id === id); if (s1 && s2) vscode.postMessage({ command: 'openTwoSnapshotsDiff', snapshot1: s1, snapshot2: s2 }); cancelCompare(); }
                    }
                    function cancelCompare() { compareSourceId = null; document.body.classList.remove('comparing'); document.getElementById('compareBanner').style.display = 'none'; renderList(); }
                    function selectSnapshotById(id) { if (compareSourceId !== null && compareSourceId !== id) { startCompare(id); return; } const s = flatSnapshots.find(x => x.id === id); if (!s) return; currentIndex = flatSnapshots.indexOf(s); renderList(); updateDetails(); };
                    function updateDetails() {
                        const s = flatSnapshots[currentIndex]; if (!s) return;
                        document.getElementById('detailsHeader').style.display = 'block'; document.getElementById('explanationBox').style.display = 'none';
                        document.getElementById('btnRestore').onclick = () => vscode.postMessage({ command: 'restore', snapshotId: s.id, filePath: s.filePath });
                        document.getElementById('btnShare').onclick = () => vscode.postMessage({ command: 'share', snapshot: s });
                        document.getElementById('btnCompareActive').onclick = () => vscode.postMessage({ command: 'compareWithActive', snapshot: s });
                        const btnPin = document.getElementById('btnPin'); btnPin.onclick = () => vscode.postMessage({ command: 'togglePin', snapshotId: s.id }); btnPin.textContent = s.pinned ? '📌 Unpin' : '📌 Pin';
                        const btnExplain = document.getElementById('btnExplain'); if (explainEnabled) btnExplain.onclick = () => { btnExplain.innerHTML = '✨ Thinking...'; btnExplain.disabled = true; vscode.postMessage({ command: 'explain', snapshot: s }); };
                        vscode.postMessage({ command: 'openDiff', snapshot: s, baseFilePath: baseFilePath, currentSelection: currentSelection });
                    }
                    function toggleCluster(id) { document.getElementById('cluster-' + id).classList.toggle('expanded'); }
                })();
            </script></body></html>`;
        }

        // JETBRAINS STYLE
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            ${styles}
            body { background-color: var(--vscode-sideBar-background); height: 100vh; overflow: hidden; }
            .jb-container { display: flex; flex-direction: column; height: 100vh; width: 100%; }
            .jb-toolbar { display: flex; align-items: center; padding: 4px 8px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); gap: 10px; }
            .jb-main { display: flex; flex: 1; overflow: hidden; }
            .jb-table-wrapper { flex: 1; overflow: auto; background: var(--vscode-editor-background); border-right: 1px solid var(--vscode-panel-border); }
            .jb-details-pane { width: 300px; display: flex; flex-direction: column; background: var(--vscode-sideBar-background); padding: 12px; gap: 10px; overflow-y: auto; }
            .jb-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .jb-thead { position: sticky; top: 0; background: var(--vscode-sideBar-background); z-index: 10; border-bottom: 1px solid var(--vscode-panel-border); }
            .jb-th { text-align: left; padding: 4px 8px; font-weight: normal; opacity: 0.7; font-size: 0.8em; }
            .jb-tr { cursor: pointer; border-bottom: 1px solid rgba(128,128,128,0.05); }
            .jb-tr:hover { background-color: var(--vscode-list-hoverBackground); }
            .jb-tr.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .jb-td { padding: 4px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.85em; }
            .col-time { width: 85px; }
            .col-type { width: 80px; }
            .jb-mag-add { color: #2ea043; }
            .jb-mag-del { color: #f85149; margin-left: 4px; }
            .jb-search-input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 2px 6px; font-size: 0.85em; flex: 1; max-width: 200px; }
            .jb-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; cursor: pointer; border-radius: 2px; font-size: 0.85em; width: 100%; text-align: center; }
            .jb-btn:hover { background: var(--vscode-button-hoverBackground); }
            .jb-label { font-size: 0.8em; opacity: 0.7; margin-bottom: 2px; }
            .jb-value { font-size: 0.9em; font-weight: bold; margin-bottom: 8px; word-break: break-all; }
        </style></head>
        <body><div class="jb-container">
            <div class="jb-toolbar">
                <input type="text" id="searchInput" class="jb-search-input" placeholder="Search history...">
                <div style="flex: 1"></div>
                <button id="btnSemantic" class="btn-semantic" title="Semantic AI Search">🧠</button>
            </div>
            <div class="jb-main">
                <div class="jb-table-wrapper">
                    <table class="jb-table">
                        <thead class="jb-thead">
                            <tr>
                                <th class="jb-th col-time">Time</th>
                                <th class="jb-th col-type">Event</th>
                                <th class="jb-th">Label / Message</th>
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
                    <div class="jb-label">File</div>
                    <div id="detFile" class="jb-value"></div>
                    <hr style="width: 100%; opacity: 0.1; margin: 8px 0;">
                    <button id="jbBtnRestore" class="jb-btn">Restore This Version</button>
                    <button id="jbBtnExplain" class="jb-btn" style="background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);">✨ Explain Changes</button>
                    <div id="explanationBox" class="explanation-box" style="margin-top: 10px; display: none;">
                        <div id="explanationText"></div>
                    </div>
                </div>
            </div>
        </div>
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
                let snapshots = []; let flatSnapshots = []; let currentIndex = -1; let baseFilePath = ''; let currentSelection = null; let explainEnabled = false;
                window.onload = () => vscode.postMessage({ command: 'ready' });
                document.getElementById('searchInput').addEventListener('keyup', e => { if (e.key === 'Enter') vscode.postMessage({ command: 'search', query: e.target.value }); });
                document.getElementById('btnSemantic').onclick = () => { const q = document.getElementById('searchInput').value; if(q) vscode.postMessage({ command: 'semanticSearch', query: q }); };

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.command === 'loadHistory') {
                        snapshots = msg.snapshots || []; currentSelection = msg.selection; baseFilePath = msg.filePath; explainEnabled = msg.explainEnabled;
                        flatSnapshots = []; snapshots.forEach(s => { if (s.type === 'cluster') flatSnapshots.push(...s.items); else flatSnapshots.push(s); });
                        renderList();
                    } else if (msg.command === 'explainResult') {
                        document.getElementById('explanationBox').style.display = 'block';
                        document.getElementById('explanationText').textContent = msg.text;
                        document.getElementById('jbBtnExplain').textContent = '✨ Explain Changes';
                    }
                });

                function renderList() {
                    const el = document.getElementById('list'); el.innerHTML = '';
                    flatSnapshots.forEach((s, idx) => {
                        const tr = document.createElement('tr');
                        tr.className = 'jb-tr' + (currentIndex === idx ? ' selected' : '');
                        tr.onclick = () => { currentIndex = idx; renderList(); updateDetails(s); };
                        
                        const tdTime = document.createElement('td'); tdTime.className = 'jb-td col-time';
                        tdTime.textContent = new Date(s.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
                        
                        const tdType = document.createElement('td'); tdType.className = 'jb-td col-type';
                        tdType.textContent = s.eventType;
                        
                        const tdLabel = document.createElement('td'); tdLabel.className = 'jb-td col-label';
                        tdLabel.textContent = s.label || s.filePath.split(/[\\\\/]/).pop() || 'Snapshot';
                        
                        tr.appendChild(tdTime); tr.appendChild(tdType); tr.appendChild(tdLabel);
                        el.appendChild(tr);
                    });
                }

                function updateDetails(s) {
                    document.getElementById('detailsPane').style.display = 'flex';
                    document.getElementById('detTime').textContent = new Date(s.timestamp).toLocaleString();
                    document.getElementById('detType').textContent = s.eventType;
                    document.getElementById('detFile').textContent = s.filePath;
                    document.getElementById('explanationBox').style.display = 'none';
                    
                    document.getElementById('jbBtnRestore').onclick = () => vscode.postMessage({ command: 'restore', snapshotId: s.id, filePath: s.filePath });
                    
                    const btnExp = document.getElementById('jbBtnExplain');
                    if (explainEnabled) {
                        btnExp.style.display = 'block';
                        btnExp.onclick = () => { btnExp.textContent = 'Thinking...'; vscode.postMessage({ command: 'explain', snapshot: s }); };
                    } else btnExp.style.display = 'none';

                    vscode.postMessage({ command: 'openDiff', snapshot: s, baseFilePath: baseFilePath, currentSelection: currentSelection });
                }
            })();
        </script></body></html>`;
    }

    private _getGitHtml(useJetBrains: boolean = false) {
        const styles = this._getSharedStyles();
        if (!useJetBrains) {
            return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles} .range-info { background: var(--vscode-editor-lineHighlightBackground); padding: 4px 8px; font-size: 0.8em; margin-bottom: 8px; opacity: 0.8; }</style></head>
            <body><div class="container">
            <div id="detailsHeader" class="details-header"><div id="selectionNote" class="selection-note"></div>
            <div class="actions">
                <button id="btnCompareCurrent">Compare with Current</button><button id="btnExplain" class="btn-explain" title="Explain changes with AI">✨ Explain</button>
            </div><div id="explanationBox" class="explanation-box">
                <div class="explanation-close" onclick="document.getElementById('explanationBox').style.display='none'">✕</div>
                <div id="explanationText"></div>
            </div></div>
            <div class="sidebar"><div id="compareBanner" class="compare-banner"><span>Select second commit...</span><button onclick="cancelCompare()">Cancel</button></div>
            <div id="rangeInfo" class="range-info"></div><div id="list" class="list"></div></div></div>
            <script>
                (function() {
                    const vscode = acquireVsCodeApi(); 
                    let commits = []; let compareSourceId = null; let selectedId = null; let explainEnabled = false;
                    window.onload = () => vscode.postMessage({ command: 'ready' });
                    window.addEventListener('message', event => {
                        const msg = event.data;
                        if (msg.command === 'loadCommits') {
                            commits = msg.commits || []; explainEnabled = msg.explainEnabled;
                            if (msg.selection) document.getElementById('rangeInfo').textContent = 'Lines: ' + (msg.selection.startLine + 1) + '-' + (msg.selection.endLine + 1);
                            render();
                        } else if (msg.command === 'explainResult') {
                            document.getElementById('btnExplain').innerHTML = '✨ Explain'; document.getElementById('btnExplain').disabled = false;
                            document.getElementById('explanationBox').style.display = 'block'; document.getElementById('explanationText').textContent = msg.text;
                        }
                    });
                    function render() {
                        const el = document.getElementById('list'); el.innerHTML = '';
                        if (commits.length === 0) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No git history found for this selection.'; el.appendChild(empty); return; }
                        commits.forEach(c => {
                            const isSelected = selectedId === c.hash; const isSource = compareSourceId === c.hash;
                            const div = document.createElement('div');
                            div.className = 'entry' + (isSelected ? ' selected' : '') + (isSource ? ' compare-source' : '');
                            div.onclick = () => selectCommit(c.hash);
                            const actions = document.createElement('div'); actions.className = 'entry-actions';
                            const btn = document.createElement('button'); btn.className = 'btn-action'; btn.textContent = '↔';
                            btn.onclick = (e) => { e.stopPropagation(); startCompareCommit(c.hash); };
                            actions.appendChild(btn); div.appendChild(actions);
                            const header = document.createElement('div'); header.className = 'header';
                            const hash = document.createElement('span'); hash.className = 'event-type'; hash.style.fontFamily = 'monospace'; hash.textContent = c.hash.substring(0,7);
                            const date = document.createElement('span'); date.textContent = c.date;
                            header.appendChild(hash); header.appendChild(date); div.appendChild(header);
                            const msg = document.createElement('div'); msg.style.fontWeight = 'bold'; msg.style.overflow = 'hidden'; msg.style.textOverflow = 'ellipsis'; msg.style.whiteSpace = 'nowrap';
                            msg.textContent = c.message; div.appendChild(msg);
                            el.appendChild(div);
                        });
                    }
                    function startCompareCommit(hash) {
                        if (compareSourceId === null) { compareSourceId = hash; document.body.classList.add('comparing'); document.getElementById('compareBanner').style.display = 'flex'; render(); }
                        else if (compareSourceId === hash) cancelCompare();
                        else { const idx1 = commits.findIndex(x => x.hash === compareSourceId); const idx2 = commits.findIndex(x => x.hash === hash); const newerHash = commits[Math.min(idx1, idx2)].hash; const olderHash = commits[Math.max(idx1, idx2)].hash; vscode.postMessage({ command: 'openTwoCommitsDiff', h1: olderHash, h2: newerHash }); cancelCompare(); }
                    }
                    function cancelCompare() { compareSourceId = null; document.body.classList.remove('comparing'); document.getElementById('compareBanner').style.display = 'none'; render(); }
                    function selectCommit(hash) {
                        if (compareSourceId !== null && compareSourceId !== hash) { startCompareCommit(hash); return; }
                        selectedId = hash; const c = commits.find(x => x.hash === hash);
                        document.getElementById('detailsHeader').style.display = 'block'; render();
                        document.getElementById('btnCompareCurrent').onclick = () => vscode.postMessage({ command: 'openDiff', commit: c, compareWithCurrent: true });
                        const btnExplain = document.getElementById('btnExplain'); if (explainEnabled) btnExplain.onclick = () => { btnExplain.innerHTML = '✨ Thinking...'; btnExplain.disabled = true; vscode.postMessage({ command: 'explain', commit: c }); };
                        vscode.postMessage({ command: 'openDiff', commit: c, compareWithCurrent: false });
                    }
                })();
            </script></body></html>`;
        }

        // JETBRAINS STYLE FOR GIT
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            ${styles}
            body { background-color: var(--vscode-sideBar-background); }
            .jb-container { display: flex; flex-direction: column; height: 100vh; width: 100%; }
            .jb-toolbar { display: flex; align-items: center; padding: 4px 8px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); gap: 10px; }
            .jb-table-wrapper { flex: 1; overflow: auto; background: var(--vscode-editor-background); }
            .jb-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .jb-thead { position: sticky; top: 0; background: var(--vscode-sideBar-background); z-index: 10; border-bottom: 1px solid var(--vscode-panel-border); }
            .jb-th { text-align: left; padding: 4px 8px; font-weight: normal; opacity: 0.7; font-size: 0.8em; white-space: nowrap; }
            .jb-tr { cursor: pointer; border-bottom: 1px solid rgba(128,128,128,0.05); }
            .jb-tr:hover { background-color: var(--vscode-list-hoverBackground); }
            .jb-tr.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .jb-td { padding: 4px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.85em; }
            .col-date { width: 100px; }
            .col-hash { width: 80px; }
            .col-msg { width: auto; }
            .jb-search-input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 2px 6px; font-size: 0.85em; flex: 1; max-width: 200px; }
        </style></head>
        <body><div class="jb-container">
            <div class="jb-toolbar">
                <input type="text" id="searchInput" class="jb-search-input" placeholder="Filter commits...">
                <div style="flex: 1"></div>
                <button id="btnExplain" class="btn-explain" title="Explain changes with AI">✨ Explain</button>
            </div>
            <div class="jb-table-wrapper">
                <table class="jb-table">
                    <thead class="jb-thead">
                        <tr>
                            <th class="jb-th col-date">Date</th>
                            <th class="jb-th col-hash">Hash</th>
                            <th class="jb-th col-msg">Message</th>
                        </tr>
                    </thead>
                    <tbody id="list"></tbody>
                </table>
            </div>
        </div>
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
                let commits = []; let selectedId = null; let baseFilePath = ''; let currentSelection = null;
                window.onload = () => vscode.postMessage({ command: 'ready' });

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.command === 'loadCommits') {
                        commits = msg.commits || []; baseFilePath = msg.filePath; currentSelection = msg.selection;
                        renderList();
                    }
                });

                function renderList() {
                    const el = document.getElementById('list'); el.innerHTML = '';
                    commits.forEach((c, idx) => {
                        const tr = document.createElement('tr');
                        tr.className = 'jb-tr' + (selectedId === c.hash ? ' selected' : '');
                        tr.onclick = () => { selectedId = c.hash; renderList(); selectCommit(c); };
                        
                        const tdDate = document.createElement('td'); tdDate.className = 'jb-td col-date';
                        tdDate.textContent = c.date.split(' ')[0];
                        
                        const tdHash = document.createElement('td'); tdHash.className = 'jb-td col-hash';
                        tdHash.style.fontFamily = 'monospace';
                        tdHash.textContent = c.hash.substring(0, 7);
                        
                        const tdMsg = document.createElement('td'); tdMsg.className = 'jb-td col-msg';
                        tdMsg.textContent = c.message;
                        
                        tr.appendChild(tdDate); tr.appendChild(tdHash); tr.appendChild(tdMsg);
                        el.appendChild(tr);
                    });
                }

                function selectCommit(c) {
                    vscode.postMessage({ command: 'openDiff', commit: c, baseFilePath, currentSelection, compareWithCurrent: false });
                }
            })();
        </script></body></html>`;
    }
}