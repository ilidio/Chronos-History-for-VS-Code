import * as vscode from 'vscode';
import * as path from 'path';
import { Snapshot } from '../types';

export class GraphViewProvider {
    public static readonly viewType = 'chronos.graphView';
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    public show(snapshots: Snapshot[]) {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                GraphViewProvider.viewType,
                'Chronos Graph',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [this.extensionUri]
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        }

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
        this.panel.webview.postMessage({ type: 'update', data: snapshots });
        
        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openSnapshot':
                        vscode.commands.executeCommand('chronos.restoreSnapshot', message.snapshotId, message.filePath);
                        return;
                    case 'compareSnapshot':
                         vscode.commands.executeCommand('chronos.compareToCurrent', message.snapshotId, message.filePath);
                        return;
                }
            }
        );
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptPathOnDisk = vscode.Uri.joinPath(this.extensionUri, 'resources', 'vis-network.min.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        const nonce = getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Chronos History Graph</title>
            <style>
                body, html { height: 100%; margin: 0; padding: 0; overflow: hidden; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
                #network { width: 100%; height: 100%; }
                .toolbar { position: absolute; top: 12px; left: 12px; z-index: 10; display: flex; gap: 8px; background: var(--vscode-sideBar-background); padding: 8px; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid var(--vscode-panel-border); align-items: center; }
                .toolbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; font-size: 0.85em; }
                .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
                .toolbar input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; font-size: 0.85em; width: 150px; }
                .legend { position: absolute; bottom: 20px; right: 20px; z-index: 10; background: var(--vscode-sideBar-background); padding: 10px; border-radius: 4px; font-size: 0.8em; border: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; gap: 6px; }
                .legend-item { display: flex; align-items: center; gap: 8px; }
                .dot { width: 10px; height: 10px; border-radius: 50%; }
                .star { width: 10px; height: 10px; clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); }
            </style>
            <script src="${scriptUri}"></script>
        </head>
        <body>
            <div class="toolbar">
                <button id="btnFit">Fit View</button>
                <button id="btnToggleLayout">Toggle Layout</button>
                <input type="text" id="searchNodes" placeholder="Search file...">
                <span style="opacity: 0.6; font-size: 0.8em;">(Double-click node to compare)</span>
            </div>
            <div class="legend">
                <div class="legend-item"><div class="dot" style="background: #97c2fc;"></div> Snapshot</div>
                <div class="legend-item"><div class="star" style="background: #ffb347;"></div> Label / Checkpoint</div>
                <div class="legend-item"><div class="dot" style="background: #7BE141;"></div> Manual Save</div>
                <div class="legend-item"><div class="dot" style="background: #f85149;"></div> Delete</div>
            </div>
            <div id="network"></div>
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                let network;
                let nodes = new vis.DataSet([]);
                let edges = new vis.DataSet([]);
                let isHierarchical = true;

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'update':
                            renderGraph(message.data);
                            break;
                    }
                });

                document.getElementById('btnFit').onclick = () => network.fit();
                document.getElementById('btnToggleLayout').onclick = () => {
                    isHierarchical = !isHierarchical;
                    updateOptions();
                };
                document.getElementById('searchNodes').oninput = (e) => {
                    const q = e.target.value.toLowerCase();
                    const allNodes = nodes.get();
                    const updates = allNodes.map(n => ({
                        id: n.id,
                        opacity: q === '' || n.data.filePath.toLowerCase().includes(q) ? 1 : 0.2
                    }));
                    nodes.update(updates);
                };

                function updateOptions() {
                    const options = {
                        layout: {
                            hierarchical: isHierarchical ? {
                                direction: 'LR',
                                sortMethod: 'directed',
                                levelSeparation: 200,
                                nodeSpacing: 100
                            } : false
                        },
                        physics: !isHierarchical
                    };
                    network.setOptions(options);
                }

                function renderGraph(snapshots) {
                    nodes.clear();
                    edges.clear();

                    if (!snapshots || snapshots.length === 0) return;

                    const fileGroups = {};
                    const sortedSnapshots = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);

                    sortedSnapshots.forEach((s, index) => {
                        let color = '#97c2fc';
                        let shape = 'dot';
                        let label = '';
                        
                        if (s.eventType === 'label') { color = '#ffb347'; shape = 'star'; label = s.label || 'Label'; }
                        else if (s.eventType === 'manual') { color = '#7BE141'; }
                        else if (s.eventType === 'delete') { color = '#f85149'; shape = 'diamond'; }

                        // Calculate size based on magnitude
                        const magnitude = (s.linesAdded || 0) + (s.linesDeleted || 0);
                        const size = 10 + Math.min(magnitude / 2, 20);

                        // Show filename if it's the first node for this file or a specific event
                        if (!fileGroups[s.filePath]) {
                            fileGroups[s.filePath] = [];
                            label = s.filePath.split(/[\\\\/]/).pop();
                        }
                        fileGroups[s.filePath].push(s);

                        nodes.add({
                            id: s.id,
                            label: label || new Date(s.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                            title: \`<b>File:</b> \${s.filePath}<br><b>Time:</b> \${new Date(s.timestamp).toLocaleString()}<br><b>Type:</b> \${s.eventType}<br><b>Changes:</b> +\${s.linesAdded || 0} -\${s.linesDeleted || 0}\`,
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
                    });

                    Object.keys(fileGroups).forEach(file => {
                        const fileSnaps = fileGroups[file];
                        for (let i = 0; i < fileSnaps.length - 1; i++) {
                            edges.add({
                                from: fileSnaps[i].id,
                                to: fileSnaps[i+1].id,
                                arrows: 'to',
                                color: { opacity: 0.4 },
                                width: 1.5
                            });
                        }
                    });

                    const container = document.getElementById('network');
                    const data = { nodes: nodes, edges: edges };
                    const options = {
                        layout: {
                            hierarchical: {
                                direction: 'LR',
                                sortMethod: 'directed',
                                levelSeparation: 200,
                                nodeSpacing: 100
                            }
                        },
                        physics: false,
                        interaction: { 
                            hover: true,
                            tooltipDelay: 200
                        }
                    };
                    
                    if (network) network.destroy();
                    network = new vis.Network(container, data, options);

                    network.on("doubleClick", function (params) {
                        if (params.nodes.length > 0) {
                            const nodeId = params.nodes[0];
                            const node = nodes.get(nodeId);
                            vscode.postMessage({
                                command: 'compareSnapshot',
                                snapshotId: node.id,
                                filePath: node.data.filePath
                            });
                        }
                    });
                }
                
                function getNonce() {
                    let text = '';
                    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                    for (let i = 0; i < 32; i++) {
                        text += possible.charAt(Math.floor(Math.random() * possible.length));
                    }
                    return text;
                }
            </script>
        </body>
        </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
