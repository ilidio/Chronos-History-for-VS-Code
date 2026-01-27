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
            
            .entry { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; position: relative; display: flex; flex-direction: column; gap: 4px; }
            .entry:hover { background-color: var(--vscode-list-hoverBackground); }
            .entry.selected { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
            .entry.compare-source { border-left: 4px solid var(--vscode-textLink-foreground); background-color: var(--vscode-editor-lineHighlightBackground); }
            
            .entry-actions { position: absolute; right: 4px; top: 4px; display: none; gap: 4px; z-index: 10; }
            .entry:hover .entry-actions { display: flex; }
            .btn-action { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 10px; cursor: pointer; border-radius: 2px; font-size: 1em; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
            .btn-action:hover { background: var(--vscode-button-hoverBackground); transform: scale(1.1); }
            
            /* Visual hint when in comparison mode */
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

            .main-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
            .details-header { padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); background-color: var(--vscode-editor-background); display: none; }
            .selection-note { font-size: 0.85em; margin-bottom: 8px; font-weight: bold; color: var(--vscode-textLink-foreground); }
            .actions { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
            .actions button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px; font-size: 0.9em; }
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

    public show(snapshots: any[], currentFileUri: vscode.Uri | undefined, getDiff?: any, selection?: vscode.Range, onSearch?: any, onExplain?: any, onSemanticSearch?: any, onTogglePin?: any, onCompareSnapshots?: any) {
        const panel = vscode.window.createWebviewPanel(HistoryViewProvider.viewType, 'Chronos History', vscode.ViewColumn.Two, { enableScripts: true, localResourceRoots: [this._extensionUri], retainContextWhenHidden: true });
        panel.webview.html = this._getHtmlForWebview();

        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'log') { this._outputChannel.appendLine(message.text); return; }
            switch (message.command) {
                case 'ready':
                    panel.webview.postMessage({ command: 'loadHistory', snapshots, selection: selection ? { startLine: selection.start.line, endLine: selection.end.line } : null, filePath: currentFileUri ? currentFileUri.fsPath : '', showDiffSideBySide: vscode.workspace.getConfiguration('chronos').get('showDiffSideBySide', true), explainEnabled: !!onExplain, semanticEnabled: !!onSemanticSearch });
                    return;
                case 'openDiff': vscode.commands.executeCommand('_chronos.openDiff', message.snapshot, message.baseFilePath, message.currentSelection); return;
                case 'getDiff': if (getDiff) { try { const diff = await getDiff(message.snapshot); panel.webview.postMessage({ command: 'diffLoaded', diff }); } catch (e) { panel.webview.postMessage({ command: 'diffLoaded', diff: 'Error: ' + e }); } } return;
                case 'explain': if (onExplain) { const text = await onExplain(message.snapshot); panel.webview.postMessage({ command: 'explainResult', text }); } return;
                case 'restore': vscode.commands.executeCommand('chronos.restoreSnapshot', message.snapshotId, message.filePath); return;
                case 'share': vscode.commands.executeCommand('chronos.shareSnapshot', message.snapshot); return;
                case 'compareWithActive': vscode.commands.executeCommand('chronos.compareWithActive', message.snapshot); return;
                case 'compareSnapshots': if (onCompareSnapshots) { const diff = await onCompareSnapshots(message.snapshot1, message.snapshot2); panel.webview.postMessage({ command: 'diffLoaded', diff }); } return;
                case 'openTwoSnapshotsDiff': vscode.commands.executeCommand('chronos.compareTwoSnapshots', message.snapshot1, message.snapshot2); return;
                case 'search': if (onSearch) { const results = await onSearch(message.query, message.searchContent); panel.webview.postMessage({ command: 'loadHistory', snapshots: results, selection: null, filePath: 'Search: ' + message.query }); } return;
                case 'semanticSearch': if (onSemanticSearch) { const results = await onSemanticSearch(message.query); panel.webview.postMessage({ command: 'loadHistory', snapshots: results, selection: null, filePath: 'AI Search: ' + message.query }); } return;
                case 'togglePin': if (onTogglePin) { const newState = await onTogglePin(message.snapshotId); panel.webview.postMessage({ command: 'pinUpdated', snapshotId: message.snapshotId, pinned: newState }); } return;
            }
        });
    }

    public showGit(commits: GitCommit[], filePath: string, selection: {startLine: number, endLine: number}, onExplain?: (c: GitCommit) => Promise<string>, onCompare?: (h1: string, h2: string) => Promise<string>) {
        const panel = vscode.window.createWebviewPanel(HistoryViewProvider.viewType, 'Git History Selection', vscode.ViewColumn.Two, { enableScripts: true });
        panel.webview.html = this._getGitHtml();
        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'log') { this._outputChannel.appendLine(message.text); return; }
            if (message.command === 'ready') panel.webview.postMessage({ command: 'loadCommits', commits, filePath, selection, showDiffSideBySide: vscode.workspace.getConfiguration('chronos').get('showDiffSideBySide', true), explainEnabled: !!onExplain });
            else if (message.command === 'openDiff') {
                if (message.compareWithCurrent) vscode.commands.executeCommand('_chronos.openDiffGitCurrent', message.commit, filePath, selection);
                else vscode.commands.executeCommand('_chronos.openDiffGit', message.commit, filePath);
            }
            else if (message.command === 'compareCommits') {
                if (onCompare) {
                    const diff = await onCompare(message.baseHash, message.targetHash);
                    panel.webview.postMessage({ command: 'diffLoaded', diff });
                }
            }
            else if (message.command === 'openTwoCommitsDiff') {
                vscode.commands.executeCommand('chronos.compareTwoCommits', message.h1, message.h2, filePath);
            }
            else if (message.command === 'explain') { if (onExplain) { const text = await onExplain(message.commit); panel.webview.postMessage({ command: 'explainResult', text }); } }
        });
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${this._getSharedStyles()}</style></head>
        <body><div class="container"><div class="sidebar">
            <div class="search-box">
                <div class="search-row">
                    <input type="text" id="searchInput" class="search-input" placeholder="Search history...">
                    <button id="btnSemantic" class="btn-semantic" title="Semantic AI Search">🧠</button>
                </div>
                <div class="search-options">
                    <input type="checkbox" id="chkContent">
                    <label for="chkContent">Deep Search (Content)</label>
                </div>
            </div>
            <div id="compareBanner" class="compare-banner">
                <span>Select comparison target...</span>
                <button onclick="cancelCompare()">Cancel</button>
            </div>
            <div class="player-controls">
                <button id="btnPrev" class="btn-player" title="Previous Snapshot">◀</button>
                <button id="btnPlay" class="btn-player" title="Play Session">▶</button>
                <button id="btnNext" class="btn-player" title="Next Snapshot">▶</button>
                <select id="speedSelect" class="speed-select" title="Playback Speed">
                    <option value="2000">0.5x</option>
                    <option value="1000" selected>1x</option>
                    <option value="500">2x</option>
                    <option value="200">5x</option>
                </select>
            </div>
            <div id="list" class="list"></div>
        </div>
        <div class="main-view"><div id="detailsHeader" class="details-header">
            <div id="selectionNote" class="selection-note"></div>
            <div class="actions" id="mainActions">
                <button id="btnRestore">Restore</button>
                <button id="btnCompareActive" title="Compare with active editor file">Compare with Active</button>
                <button id="btnShare">Share</button>
                <button id="btnPin">📌 Pin</button>
                <button id="btnExplain" style="display:none">✨ Explain</button>
            </div><div id="explanationBox" class="explanation-box"></div></div><div id="diffContainer" class="diff-container">
        <div class="empty-state">Select a snapshot or use ↔ to compare</div></div></div></div>
        <script>
            const vscode = acquireVsCodeApi();
            window.onerror = function(msg, url, line, col, error) {
                vscode.postMessage({ command: 'log', text: "Webview Error: " + msg + " at " + line + ":" + col });
            };
            let snapshots = []; let currentSelection = null; let baseFilePath = ''; let showDiffSideBySide = true; let explainEnabled = false;
            let flatSnapshots = []; let currentIndex = -1; let compareSourceId = null; let isPlaying = false; let playInterval = null;

            window.onload = () => vscode.postMessage({ command: 'ready' });
            document.getElementById('searchInput').addEventListener('keyup', e => { 
                if (e.key === 'Enter') vscode.postMessage({ command: 'search', query: e.target.value, searchContent: document.getElementById('chkContent').checked }); 
            });
            document.getElementById('btnSemantic').onclick = () => { const q = document.getElementById('searchInput').value; if(q) vscode.postMessage({ command: 'semanticSearch', query: q }); };

            document.getElementById('btnPrev').onclick = () => step(1);
            document.getElementById('btnNext').onclick = () => step(-1);
            document.getElementById('btnPlay').onclick = togglePlay;

            function togglePlay() { if (isPlaying) stopPlayback(); else startPlayback(); }
            function startPlayback() {
                if (currentIndex <= 0) currentIndex = flatSnapshots.length; 
                isPlaying = true; document.getElementById('btnPlay').textContent = '⏸';
                const speed = parseInt(document.getElementById('speedSelect').value);
                playInterval = setInterval(() => { if (currentIndex > 0) step(-1); else stopPlayback(); }, speed);
            }
            function stopPlayback() { isPlaying = false; document.getElementById('btnPlay').textContent = '▶'; clearInterval(playInterval); }
            function step(dir) {
                let next = currentIndex + dir;
                if (next >= 0 && next < flatSnapshots.length) selectSnapshotById(flatSnapshots[next].id, { autoScroll: true });
                else if (isPlaying) stopPlayback();
            }

            window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.command === 'loadHistory') {
                    snapshots = msg.snapshots || []; currentSelection = msg.selection; baseFilePath = msg.filePath; showDiffSideBySide = msg.showDiffSideBySide; explainEnabled = msg.explainEnabled;
                    flatSnapshots = [];
                    snapshots.forEach(s => { if (s.type === 'cluster') flatSnapshots.push(...s.items); else flatSnapshots.push(s); });
                    renderList();
                } else if (msg.command === 'diffLoaded') renderDiff(msg.diff);
                else if (msg.command === 'explainResult') { 
                    const box = document.getElementById('explanationBox');
                    box.style.display = 'block'; box.textContent = msg.text;
                    document.getElementById('btnExplain').textContent = '✨ Explain'; document.getElementById('btnExplain').disabled = false;
                } else if (msg.command === 'pinUpdated') {
                    const s = flatSnapshots.find(x => x.id === msg.snapshotId);
                    if (s) { s.pinned = msg.pinned; renderList(); updateDetails(); }
                }
            });

            function renderList() {
                const el = document.getElementById('list');
                el.innerHTML = snapshots.map((s, i) => {
                    if (s.type === 'cluster') {
                        return \`<div class="cluster-container"><div class="cluster-header" onclick="toggleCluster(\${i})">📦 Session: \${s.items.length} saves</div>
                               <div id="cluster-\${i}" class="cluster-items">\${s.items.map(item => renderEntry(item)).join('')}</div></div>\`;
                    }
                    return renderEntry(s);
                }).join('');
            }

            function renderEntry(s) {
                const isSelected = currentIndex === flatSnapshots.findIndex(x => x.id === s.id);
                const isSource = compareSourceId === s.id;
                const mag = (s.linesAdded || s.linesDeleted) ? \`<div class="magnitude">\${s.linesAdded ? '<span class="mag-add">+' + s.linesAdded + '</span>' : ''}\${s.linesDeleted ? '<span class="mag-del">-' + s.linesDeleted + '</span>' : ''}</div>\` : '';
                return \`<div class="entry \${isSelected ? 'selected' : ''} \${isSource ? 'compare-source' : ''}" id="entry-\${s.id}" onclick="selectSnapshotById('\${s.id}')">
                    <div class="entry-actions">
                        <button class="btn-action" onclick="event.stopPropagation(); startCompare('\${s.id}')" title="Select for comparison">↔</button>
                    </div>
                    <div class="header">
                        <span class="event-type">\${escapeHtml(s.eventType)}</span>
                        <div style="display:flex; align-items:center">
                            <span>\${new Date(s.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                            <span class="icon-pin \${s.pinned ? 'pinned' : ''}">📌</span>
                        </div>
                    </div>
                    <div style="font-size:0.75em; opacity:0.6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">\${escapeHtml(s.filePath)}</div>
                    \${s.label ? \`<div class="label-badge">\${escapeHtml(s.label)}</div>\` : ''}
                    \${mag}
                </div>\`;
            }

            function startCompare(id) {
                vscode.postMessage({ command: 'log', text: 'startCompare called for: ' + id + ' (current source: ' + compareSourceId + ')' });
                if (compareSourceId === null) {
                    compareSourceId = id;
                    document.body.classList.add('comparing');
                    document.getElementById('compareBanner').style.display = 'flex';
                    renderList();
                } else if (compareSourceId === id) {
                    cancelCompare();
                } else {
                    const s1 = flatSnapshots.find(x => x.id === compareSourceId);
                    const s2 = flatSnapshots.find(x => x.id === id);
                    if (!s1 || !s2) {
                        vscode.postMessage({ command: 'log', text: 'Error: Could not find snapshots for comparison' });
                        cancelCompare();
                        return;
                    }
                    if (showDiffSideBySide) {
                        vscode.postMessage({ command: 'openTwoSnapshotsDiff', snapshot1: s1, snapshot2: s2 });
                    } else {
                        const target = document.getElementById('selectionNote');
                        target.style.display = 'block';
                        const t1 = new Date(s1.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
                        const t2 = new Date(s2.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
                        target.textContent = 'Comparing: ' + t1 + ' ↔ ' + t2;
                        vscode.postMessage({ command: 'compareSnapshots', snapshot1: s1, snapshot2: s2 });
                    }
                    cancelCompare();
                }
            }
            function cancelCompare() { 
                compareSourceId = null; 
                document.body.classList.remove('comparing');
                document.getElementById('compareBanner').style.display = 'none'; 
                renderList(); 
            }

            function selectSnapshotById(id, opts) {
                if (compareSourceId !== null && compareSourceId !== id) {
                    vscode.postMessage({ command: 'log', text: 'Completing comparison via entry click' });
                    startCompare(id);
                    return;
                }
                const s = flatSnapshots.find(x => x.id === id);
                if (!s) return;
                currentIndex = flatSnapshots.indexOf(s);
                renderList();
                updateDetails();
            }

            function updateDetails() {
                const s = flatSnapshots[currentIndex]; if (!s) return;
                const header = document.getElementById('detailsHeader'); header.style.display = 'block';
                document.getElementById('explanationBox').style.display = 'none';
                document.getElementById('selectionNote').style.display = 'none';
                
                document.getElementById('btnRestore').style.display = 'inline-block';
                document.getElementById('btnRestore').onclick = () => vscode.postMessage({ command: 'restore', snapshotId: s.id, filePath: s.filePath });
                document.getElementById('btnShare').onclick = () => vscode.postMessage({ command: 'share', snapshot: s });
                document.getElementById('btnCompareActive').onclick = () => vscode.postMessage({ command: 'compareWithActive', snapshot: s });
                
                const btnPin = document.getElementById('btnPin'); btnPin.style.display = 'inline-block';
                btnPin.onclick = () => vscode.postMessage({ command: 'togglePin', snapshotId: s.id });
                btnPin.textContent = s.pinned ? '📌 Unpin' : '📌 Pin';

                if (explainEnabled) { 
                    const btn = document.getElementById('btnExplain'); btn.style.display = 'inline-block'; 
                    btn.onclick = () => { btn.textContent = 'Thinking...'; btn.disabled = true; vscode.postMessage({ command: 'explain', snapshot: s }); };
                }

                if (showDiffSideBySide) vscode.postMessage({ command: 'openDiff', snapshot: s, baseFilePath: baseFilePath, currentSelection: currentSelection });
                else { document.getElementById('diffContainer').innerHTML = '<div class="empty-state">Loading...</div>'; vscode.postMessage({ command: 'getDiff', snapshot: s }); }
            }

            function escapeHtml(text) {
                if (!text) return '';
                return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/\\\`/g, '&#96;');
            }

            function renderDiff(diff) {
                const c = document.getElementById('diffContainer');
                if (!diff || diff.startsWith('Error:')) {
                    c.innerHTML = '<div class="empty-state">' + escapeHtml(diff || 'No differences found.') + '</div>';
                    return;
                }
                const lines = diff.split('\\n');
                c.innerHTML = '<pre>' + lines.map(l => {
                    let cls = '';
                    if (l.startsWith('+') && !l.startsWith('+++')) cls = 'diff-add';
                    else if (l.startsWith('-') && !l.startsWith('---')) cls = 'diff-del';
                    else if (l.startsWith('@@') || l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('---') || l.startsWith('+++')) cls = 'diff-meta';
                    return \`<div class="diff-line"><div class="\${cls}">\${escapeHtml(l)}</div></div>\`;
                }).join('') + '</pre>';
            }
            function toggleCluster(id) { document.getElementById('cluster-' + id).classList.toggle('expanded'); }
        </script></body></html>`;
    }

    private _getGitHtml() {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            ${this._getSharedStyles()}
            .range-info { background: var(--vscode-editor-lineHighlightBackground); padding: 4px 8px; font-size: 0.8em; margin-bottom: 8px; opacity: 0.8; }
        </style></head>
        <body><div class="container"><div class="sidebar">
            <div id="compareBanner" class="compare-banner">
                <span>Select second commit...</span>
                <button onclick="cancelCompare()">Cancel</button>
            </div>
            <div id="rangeInfo" class="range-info"></div>
            <div id="list" class="list"></div>
        </div>
        <div class="main-view"><div id="detailsHeader" class="details-header">
            <div id="selectionNote" class="selection-note"></div>
            <div class="actions">
                <button id="btnCompareCurrent">Compare with Current</button>
                <button id="btnExplain" style="display:none">✨ Explain</button>
            </div><div id="explanationBox" class="explanation-box"></div></div><div id="diffContainer" class="diff-container">
        <div class="empty-state">Select a commit or use ↔ to compare</div></div></div></div>
        <script>
            const vscode = acquireVsCodeApi(); 
            let commits = []; let compareSourceId = null; let selectedId = null; let explainEnabled = false; let showDiffSideBySide = true;

            window.onload = () => vscode.postMessage({ command: 'ready' });
            window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.command === 'loadCommits') {
                    commits = msg.commits || []; explainEnabled = msg.explainEnabled; showDiffSideBySide = msg.showDiffSideBySide;
                    if (msg.selection) document.getElementById('rangeInfo').textContent = 'Lines: ' + (msg.selection.startLine + 1) + '-' + (msg.selection.endLine + 1);
                    render();
                } else if (msg.command === 'diffLoaded') renderDiff(msg.diff);
                else if (msg.command === 'explainResult') {
                    const btn = document.getElementById('btnExplain'); btn.textContent = '✨ Explain'; btn.disabled = false;
                    const box = document.getElementById('explanationBox'); box.style.display = 'block'; box.textContent = msg.text;
                }
            });

            function render() {
                const el = document.getElementById('list');
                if (commits.length === 0) { el.innerHTML = '<div class="empty-state">No git history found for this selection.</div>'; return; }
                el.innerHTML = commits.map(c => {
                    const isSelected = selectedId === c.hash;
                    const isSource = compareSourceId === c.hash;
                    return \`<div class="entry \${isSelected ? 'selected' : ''} \${isSource ? 'compare-source' : ''}" onclick="select('\${c.hash}')">
                        <div class="entry-actions">
                            <button class="btn-action" onclick="event.stopPropagation(); startCompare('\${c.hash}')" title="Select for comparison">↔</button>
                        </div>
                        <div class="header"><span class="event-type" style="font-family:monospace">\${c.hash.substring(0,7)}</span><span>\${escapeHtml(c.date)}</span></div>
                        <div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">\${escapeHtml(c.message)}</div>
                    </div>\`;
                }).join('');
            }

            function startCompare(hash) {
                if (compareSourceId === null) {
                    compareSourceId = hash;
                    document.body.classList.add('comparing');
                    document.getElementById('compareBanner').style.display = 'flex';
                    render();
                } else if (compareSourceId === hash) {
                    cancelCompare();
                } else {
                    const idx1 = commits.findIndex(x => x.hash === compareSourceId);
                    const idx2 = commits.findIndex(x => x.hash === hash);
                    // Commits are usually newest-first, so higher index is older
                    const newerHash = commits[Math.min(idx1, idx2)].hash;
                    const olderHash = commits[Math.max(idx1, idx2)].hash;

                    if (showDiffSideBySide) {
                        vscode.postMessage({ command: 'openTwoCommitsDiff', h1: olderHash, h2: newerHash });
                    } else {
                        const target = document.getElementById('selectionNote');
                        target.style.display = 'block'; target.textContent = 'Comparing range: ' + olderHash.substring(0,7) + ' ↔ ' + newerHash.substring(0,7);
                        vscode.postMessage({ command: 'compareCommits', baseHash: olderHash, targetHash: newerHash });
                    }
                    cancelCompare();
                }
            }
            function cancelCompare() { 
                compareSourceId = null; 
                document.body.classList.remove('comparing');
                document.getElementById('compareBanner').style.display = 'none'; 
                render(); 
            }

            function select(hash) {
                if (compareSourceId !== null && compareSourceId !== hash) {
                    startCompare(hash);
                    return;
                }
                selectedId = hash; const c = commits.find(x => x.hash === hash);
                document.getElementById('detailsHeader').style.display = 'block';
                document.getElementById('selectionNote').style.display = 'none';
                document.getElementById('btnCompareCurrent').onclick = () => vscode.postMessage({ command: 'openDiff', commit: c, compareWithCurrent: true });
                if (explainEnabled) {
                    const btn = document.getElementById('btnExplain'); btn.style.display = 'inline-block';
                    btn.onclick = () => { btn.textContent = 'Thinking...'; btn.disabled = true; vscode.postMessage({ command: 'explain', commit: c }); };
                }
                render();
                if (showDiffSideBySide) vscode.postMessage({ command: 'openDiff', commit: c, compareWithCurrent: false });
                else renderDiff(c.diff);
            }

            function escapeHtml(text) {
                if (!text) return '';
                return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/\\\`/g, '&#96;');
            }

            function renderDiff(diff) {
                const container = document.getElementById('diffContainer');
                if (!diff || diff.startsWith('Error:')) {
                    container.innerHTML = '<div class="empty-state">' + escapeHtml(diff || 'No differences found.') + '</div>';
                    return;
                }
                const lines = diff.split('\\n');
                container.innerHTML = '<pre>' + lines.map(l => {
                    let cls = '';
                    if (l.startsWith('+') && !l.startsWith('+++')) cls = 'diff-add';
                    else if (l.startsWith('-') && !l.startsWith('---')) cls = 'diff-del';
                    else if (l.startsWith('@@') || l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('---') || l.startsWith('+++')) cls = 'diff-meta';
                    return \`<div class="diff-line"><div class="\${cls}">\${escapeHtml(l)}</div></div>\`;
                }).join('') + '</pre>';
            }
        </script></body></html>`;
    }
}