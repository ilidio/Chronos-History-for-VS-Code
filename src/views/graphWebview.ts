import * as vscode from 'vscode';
import { Snapshot } from '../types';

export class GraphViewProvider {
    public static readonly viewType = 'chronos.graphView';
    private _panel: vscode.WebviewPanel | undefined;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public async show(history: Snapshot[]) {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
        } else {
            this._panel = vscode.window.createWebviewPanel(
                GraphViewProvider.viewType,
                'Chronos History Graph',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [this._extensionUri],
                    retainContextWhenHidden: true
                }
            );

            this._panel.onDidDispose(() => {
                this._panel = undefined;
            });
        }

        const visJsUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'vis-network.min.js'));
        this._panel.webview.html = this._getHtmlForWebview(visJsUri, history);

        this._panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'openDiff') {
                const snapshot = message.snapshot;
                vscode.commands.executeCommand('_chronos.openDiff', snapshot, snapshot.filePath);
            } else if (message.command === 'compare') {
                vscode.commands.executeCommand('chronos.compareTwoSnapshots', message.s1, message.s2);
            }
        });
    }

    private _getHtmlForWebview(visJsUri: vscode.Uri, history: Snapshot[]) {
        const historyJson = JSON.stringify(history).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chronos History Graph</title>
    <script type="text/javascript" src="${visJsUri}"></script>
    <style>
        body { margin: 0; padding: 0; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); overflow: hidden; }
        #network { width: 100vw; height: 100vh; background-color: var(--vscode-editor-background); }
        .controls { position: absolute; top: 10px; left: 10px; z-index: 10; background: var(--vscode-sideBar-background); padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
        .legend { position: absolute; bottom: 20px; right: 10px; z-index: 10; background: var(--vscode-sideBar-background); padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-size: 0.85em; }
        .legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .legend-color { width: 12px; height: 12px; border-radius: 50%; }
        .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; cursor: pointer; border-radius: 2px; font-size: 0.9em; }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <div class="controls">
        <button class="btn" onclick="resetView()">Reset View</button>
        <div style="margin-top: 8px; font-size: 0.8em; opacity: 0.7;">Double-click to compare snapshots</div>
    </div>
    <div class="legend">
        <div class="legend-item"><div class="legend-color" style="background: #4a9eff;"></div> Save</div>
        <div class="legend-item"><div class="legend-color" style="background: #ff4a4a;"></div> Delete</div>
        <div class="legend-item"><div class="legend-color" style="background: #4aff4a;"></div> Create</div>
        <div class="legend-item"><div class="legend-color" style="background: #ffd700;"></div> Label/Pinned</div>
    </div>
    <div id="network"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let network = null;
        let snapshots = ${historyJson};

        function resetView() { if (network) network.fit(); }

        window.onload = function() {
            const nodes = new vis.DataSet();
            const edges = new vis.DataSet();
            const fileGroups = {};
            
            // Sort history by time
            snapshots.sort((a, b) => a.timestamp - b.timestamp);

            const fileColors = {};
            const colors = ['#4a9eff', '#ff4a4a', '#4aff4a', '#ff9e4a', '#e94aff', '#4affef', '#ffef4a', '#a2ff4a'];
            let colorIdx = 0;

            snapshots.forEach((s, i) => {
                if (!fileColors[s.filePath]) {
                    fileColors[s.filePath] = colors[colorIdx % colors.length];
                    colorIdx++;
                }

                let color = fileColors[s.filePath];
                let shape = 'dot';
                let size = 10;
                let label = '';

                if (s.label) {
                    label = s.label;
                    shape = 'diamond';
                    size = 15;
                }

                if (!fileGroups[s.filePath]) {
                    fileGroups[s.filePath] = [];
                    label = s.filePath.split(/[\\\\/]/).pop();
                }
                fileGroups[s.filePath].push(s);

                const timeStr = new Date(s.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                const fullTimeStr = new Date(s.timestamp).toLocaleString();
                const safePath = s.filePath.split(String.fromCharCode(96)).join(String.fromCharCode(92) + String.fromCharCode(96));

                nodes.add({
                    id: s.id,
                    label: label || timeStr,
                    title: '<b>File:</b> ' + safePath + '<br><b>Time:</b> ' + fullTimeStr + '<br><b>Type:</b> ' + s.eventType + '<br><b>Changes:</b> +' + (s.linesAdded || 0) + ' -' + (s.linesDeleted || 0),
                    group: s.filePath,
                    color: {
                        background: color,
                        border: s.pinned ? '#ffd700' : color,
                        highlight: { border: '#fff', background: color }
                    },
                    borderWidth: s.pinned ? 3 : 1,
                    shape: shape,
                    size: size,
                    font: { color: 'var(--vscode-editor-foreground)', size: 12, strokeWidth: 2, strokeColor: 'var(--vscode-editor-background)' },
                    data: s
                });

                // Link to previous snapshot of the SAME file
                const fileSnaps = fileGroups[s.filePath];
                if (fileSnaps.length > 1) {
                    edges.add({
                        from: fileSnaps[fileSnaps.length - 2].id,
                        to: s.id,
                        arrows: 'to',
                        color: { color: color, opacity: 0.4 },
                        width: 2
                    });
                }
            });

            const container = document.getElementById('network');
            const data = { nodes: nodes, edges: edges };
            const options = {
                physics: {
                    stabilization: true,
                    barnesHut: { gravitationalConstant: -2000, centralGravity: 0.3, springLength: 150 }
                },
                interaction: { hover: true, tooltipDelay: 200 },
                nodes: { shadow: true },
                edges: { smooth: { type: 'continuous' } }
            };
            network = new vis.Network(container, data, options);

            network.on("doubleClick", function (params) {
                if (params.nodes.length === 1) {
                    const nodeId = params.nodes[0];
                    const node = nodes.get(nodeId);
                    vscode.postMessage({ command: 'openDiff', snapshot: node.data });
                }
            });
        };
    </script>
</body>
</html>`;
    }
}
