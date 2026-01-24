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
                .controls { position: absolute; top: 10px; left: 10px; z-index: 10; background: var(--vscode-editor-background); padding: 5px; border: 1px solid var(--vscode-input-border); }
            </style>
            <script src="${scriptUri}"></script>
        </head>
        <body>
            <div id="network"></div>
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                let network;
                let nodes = new vis.DataSet([]);
                let edges = new vis.DataSet([]);

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'update':
                            renderGraph(message.data);
                            break;
                    }
                });

                function renderGraph(snapshots) {
                    nodes.clear();
                    edges.clear();

                    if (!snapshots || snapshots.length === 0) return;

                    // Group by File
                    const fileGroups = {};
                    snapshots.forEach(s => {
                        if (!fileGroups[s.filePath]) fileGroups[s.filePath] = [];
                        fileGroups[s.filePath].push(s);
                    });

                    // Sort snapshots per file (oldest first)
                    // Note: 'snapshots' passed from extension is typically newest first.
                    // We reverse for processing order.
                    const sortedSnapshots = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);

                    sortedSnapshots.forEach((s, index) => {
                        let color = '#97c2fc';
                        let shape = 'dot';
                        if (s.eventType === 'label') { color = '#ffb347'; shape = 'star'; }
                        if (s.eventType === 'manual') { color = '#7BE141'; }

                        nodes.add({
                            id: s.id,
                            label: new Date(s.timestamp).toLocaleTimeString(),
                            title: 'File: ' + s.filePath + '\\nType: ' + s.eventType + '\\nLabel: ' + (s.label || ''),
                            group: s.filePath,
                            color: color,
                            shape: shape,
                            data: s
                        });
                    });

                    // Create edges (simple linear timeline per file)
                    // In a real graph, we would track parents. Here we infer chronological order per file.
                    Object.keys(fileGroups).forEach(file => {
                        const fileSnaps = fileGroups[file].sort((a, b) => a.timestamp - b.timestamp);
                        for (let i = 0; i < fileSnaps.length - 1; i++) {
                            edges.add({
                                from: fileSnaps[i].id,
                                to: fileSnaps[i+1].id,
                                arrows: 'to'
                            });
                        }
                    });

                    // Create the network
                    const container = document.getElementById('network');
                    const data = { nodes: nodes, edges: edges };
                    const options = {
                        layout: {
                            hierarchical: {
                                direction: 'LR',
                                sortMethod: 'directed',
                                levelSeparation: 150
                            }
                        },
                        groups: {
                            useDefaultGroups: true
                        },
                        physics: false,
                        interaction: { hover: true }
                    };
                    
                    if (network) network.destroy();
                    network = new vis.Network(container, data, options);

                    network.on("click", function (params) {
                        if (params.nodes.length > 0) {
                            const nodeId = params.nodes[0];
                            const node = nodes.get(nodeId);
                            // On Click -> Maybe show details or just select?
                            // For now, let's trigger a comparison on double click or offer context menu?
                            // Simple click just selects. 
                        }
                    });

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
