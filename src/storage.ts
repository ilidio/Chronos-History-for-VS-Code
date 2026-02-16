import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Snapshot, HistoryIndex, ChronosConfig } from './types';

export class HistoryStorage {
    private globalStorageRoot: vscode.Uri;
    private indices: Map<string, { index: HistoryIndex, root: vscode.Uri }> = new Map();
    private initialized = false;
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(private context: vscode.ExtensionContext, private outputChannel?: vscode.OutputChannel) {
        this.globalStorageRoot = context.storageUri || context.globalStorageUri;
    }

    private log(msg: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`[Storage] ${msg}`);
        }
    }

    private normalizePath(p: string): string {
        if (!p) return '';
        return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').toLowerCase();
    }

    async init(): Promise<void> {
        if (this.initialized) return;
        
        try {
            await vscode.workspace.fs.createDirectory(this.globalStorageRoot);
            this.initialized = true;
            this.log('Initialized');
        } catch (e) {
            this.log(`Global init failed: ${e}`);
        }
    }

    async getWorkspaceStorageRoot(): Promise<vscode.Uri> {
        await this.init();
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const { root } = await this.getStorageForFile(vscode.workspace.workspaceFolders[0].uri);
            return root;
        }
        return this.globalStorageRoot;
    }

    private async getStorageForFile(fileUri: vscode.Uri): Promise<{ root: vscode.Uri, indexUri: vscode.Uri }> {
        const config = vscode.workspace.getConfiguration('chronos');
        const saveInProject = config.get<boolean>('saveInProjectFolder', false);        
        let root = this.globalStorageRoot;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
        
        if (saveInProject && workspaceFolder) {
            root = vscode.Uri.joinPath(workspaceFolder.uri, '.history');
        }

        return {
            root,
            indexUri: vscode.Uri.joinPath(root, 'index.json')
        };
    }

    private async loadIndex(indexUri: vscode.Uri, forceReload: boolean = false): Promise<HistoryIndex> {
        const key = indexUri.toString();
        if (!forceReload && this.indices.has(key)) return this.indices.get(key)!.index;

        const root = vscode.Uri.joinPath(indexUri, '..');
        try {
            const data = await vscode.workspace.fs.readFile(indexUri);
            const decoded = new TextDecoder().decode(data);
            const index = JSON.parse(decoded);
            this.indices.set(key, { index, root });
            this.log(`Loaded index: ${key} (${index.snapshots.length} snapshots)`);
            return index;
        } catch (e) {
            // Only set empty if it doesn't exist, don't cache permanent failures
            const newIndex: HistoryIndex = { snapshots: [] };
            this.indices.set(key, { index: newIndex, root });
            return newIndex;
        }
    }

    async saveSnapshot(
        document: vscode.TextDocument, 
        eventType: Snapshot['eventType'], 
        label?: string, 
        description?: string,
        linesAdded?: number,
        linesDeleted?: number
    ): Promise<Snapshot | null> {
        await this.init();
        
        const { root, indexUri } = await this.getStorageForFile(document.uri);
        const index = await this.loadIndex(indexUri);
        const relativePath = vscode.workspace.asRelativePath(document.uri, false);
        const normalizedRelPath = this.normalizePath(relativePath);

        const currentContent = document.getText();

        const lastSnapshot = [...index.snapshots]
            .filter(s => this.normalizePath(s.filePath) === normalizedRelPath)
            .sort((a, b) => b.timestamp - a.timestamp)[0];

        if (eventType !== 'label' && lastSnapshot && lastSnapshot.storagePath) {
            try {
                const lastUri = vscode.Uri.joinPath(root, lastSnapshot.storagePath);
                const lastData = await vscode.workspace.fs.readFile(lastUri);
                const lastContent = new TextDecoder().decode(lastData);
                
                if (lastContent === currentContent) {
                    this.log(`Content identical for ${normalizedRelPath}, skipping.`);
                    return null;
                }
            } catch (e) {}
        }

        const id = uuidv4();
        const blobUri = vscode.Uri.joinPath(root, id);

        try {
            await vscode.workspace.fs.createDirectory(root);
            const content = new TextEncoder().encode(currentContent);
            await vscode.workspace.fs.writeFile(blobUri, content);
        } catch (e) {
            this.log(`Save failed: ${e}`);
            return null;
        }

        const snapshot: Snapshot = {
            id,
            timestamp: Date.now(),
            filePath: relativePath,
            eventType,
            storagePath: id,
            label,
            description,
            linesAdded,
            linesDeleted
        };

        index.snapshots.push(snapshot);
        await this.saveIndex(index, indexUri);
        this.log(`Saved snapshot ${id} for ${relativePath}`);
        
        return snapshot;
    }

    async getHistoryForFile(fileUri: vscode.Uri): Promise<Snapshot[]> {
        await this.init();
        await this.refreshIndices(true); // Force reload to see changes from other instances
        
        const rawRelPath = vscode.workspace.asRelativePath(fileUri, false);
        const normalizedRelPath = this.normalizePath(rawRelPath);
        this.log(`getHistoryForFile searching for: ${rawRelPath} (normalized: ${normalizedRelPath})`);
        
        let results: Snapshot[] = [];

        for (const [key, { index }] of this.indices.entries()) {
            const matches = index.snapshots.filter(s => {
                const sPath = this.normalizePath(s.filePath);
                const match = sPath === normalizedRelPath || 
                             (sPath.endsWith('/' + normalizedRelPath)) || 
                             (normalizedRelPath.endsWith('/' + sPath)) ||
                             (s.eventType === 'label' && sPath === '');
                if (match) this.log(`Match found in index ${key}: ${s.filePath} (id: ${s.id})`);
                return match;
            });
            results = results.concat(matches);
        }

        this.log(`Total history entries found: ${results.length}`);
        return results.sort((a, b) => b.timestamp - a.timestamp);
    }

    private async refreshIndices(force: boolean = false): Promise<void> {
        const globalIndexUri = vscode.Uri.joinPath(this.globalStorageRoot, 'index.json');
        await this.loadIndex(globalIndexUri, force);

        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const localIndexUri = vscode.Uri.joinPath(folder.uri, '.history', 'index.json');
                try {
                    await vscode.workspace.fs.stat(localIndexUri);
                    await this.loadIndex(localIndexUri, force);
                } catch {
                    // Skip
                }
            }
        }
    }

    public async runDiagnostics(): Promise<string> {
        await this.init();
        await this.refreshIndices(true);
        let out = `Chronos Storage Diagnostics\n`;
        out += `============================\n`;
        out += `Global Storage Root: ${this.globalStorageRoot.toString()}\n`;
        out += `Loaded Indices: ${this.indices.size}\n\n`;

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const uri = activeEditor.document.uri;
            const rawRel = vscode.workspace.asRelativePath(uri, false);
            out += `Active File: ${uri.fsPath}\n`;
            out += `Raw Relative Path: ${rawRel}\n`;
            out += `Normalized Path: ${this.normalizePath(rawRel)}\n\n`;
        } else {
            out += `No active editor found.\n\n`;
        }

        for (const [key, { index, root }] of this.indices.entries()) {
            out += `Index: ${key}\n`;
            out += `Root: ${root.toString()}\n`;
            out += `Snapshots: ${index.snapshots.length}\n`;
            if (index.snapshots.length > 0) {
                const last = index.snapshots[index.snapshots.length - 1];
                out += `Last Snapshot: ${last.filePath} (Normalized: ${this.normalizePath(last.filePath)}) at ${new Date(last.timestamp).toLocaleString()}\n`;
            }
            out += `----------------------------\n`;
        }
        return out;
    }

    async getProjectHistory(): Promise<Snapshot[]> {
        await this.init();
        await this.refreshIndices();
        
        let all: Snapshot[] = [];
        for (const { index } of this.indices.values()) {
            all = all.concat(index.snapshots);
        }
        return all.sort((a, b) => b.timestamp - a.timestamp);
    }

    async getSnapshotUri(snapshot: Snapshot, fileUri: vscode.Uri): Promise<vscode.Uri> {
        await this.init();
        await this.refreshIndices();

        for (const { index, root } of this.indices.values()) {
            if (index.snapshots.some(s => s.id === snapshot.id)) {
                return vscode.Uri.joinPath(root, snapshot.storagePath!);
            }
        }

        const { root } = await this.getStorageForFile(fileUri);
        return vscode.Uri.joinPath(root, snapshot.storagePath!);
    }

    private async saveIndex(index: HistoryIndex, indexUri: vscode.Uri) {
        this.saveQueue = this.saveQueue.then(async () => {
            try {
                const data = new TextEncoder().encode(JSON.stringify(index, null, 2));
                await vscode.workspace.fs.writeFile(indexUri, data);
            } catch (e) {
                this.log(`Index save failed: ${e}`);
            }
        });
        return this.saveQueue;
    }

    async createLabel(name: string, description?: string, document?: vscode.TextDocument, fileUri?: vscode.Uri) {
        if (document) {
            await this.saveSnapshot(document, 'label', name, description);
            return;
        }

        let targetUri = fileUri;
        if (!targetUri) {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                targetUri = vscode.workspace.workspaceFolders[0].uri;
            } else {
                targetUri = this.globalStorageRoot;
            }
        }
        
        const { indexUri } = await this.getStorageForFile(targetUri);
        const index = await this.loadIndex(indexUri);

        index.snapshots.push({
            id: uuidv4(),
            timestamp: Date.now(),
            filePath: fileUri ? vscode.workspace.asRelativePath(fileUri, false) : '',
            eventType: 'label',
            label: name,
            description
        });
        await this.saveIndex(index, indexUri);
    }

    async togglePin(snapshotId: string): Promise<boolean> {
        await this.init();
        await this.refreshIndices();

        for (const [key, { index }] of this.indices) {
            const snapshot = index.snapshots.find(s => s.id === snapshotId);
            if (snapshot) {
                snapshot.pinned = !snapshot.pinned;
                const indexUri = vscode.Uri.parse(key);
                await this.saveIndex(index, indexUri);
                return snapshot.pinned;
            }
        }
        return false;
    }

    async prune(maxDays: number): Promise<void> {
        if (maxDays <= 0) return;
        await this.init();
        await this.refreshIndices();

        const cutoff = Date.now() - (maxDays * 24 * 60 * 60 * 1000);

        for (const [key, { index, root }] of this.indices) {
            const originalCount = index.snapshots.length;
            const toKeep: Snapshot[] = [];
            const toDelete: Snapshot[] = [];

            for (const s of index.snapshots) {
                if (s.pinned || s.timestamp > cutoff) {
                    toKeep.push(s);
                } else {
                    toDelete.push(s);
                }
            }

            if (toKeep.length !== originalCount) {
                for (const s of toDelete) {
                    if (s.storagePath) {
                        try {
                            const blobUri = vscode.Uri.joinPath(root, s.storagePath);
                            await vscode.workspace.fs.delete(blobUri, { recursive: false, useTrash: false });
                        } catch (e) {}
                    }
                }

                index.snapshots = toKeep;
                const indexUri = vscode.Uri.parse(key);
                await this.saveIndex(index, indexUri);
            }
        }
    }

    async search(query: string, searchContent: boolean = false): Promise<Snapshot[]> {
        await this.init();
        await this.refreshIndices();
        
        const results: Snapshot[] = [];
        const limit = 50;
        const lowerQuery = query.toLowerCase();
        
        for (const { index, root } of this.indices.values()) {
            if (results.length >= limit) break;
            
            for (const snapshot of index.snapshots) {
                if (results.length >= limit) break;
                
                let match = false;
                if (snapshot.label?.toLowerCase().includes(lowerQuery)) match = true;
                else if (snapshot.description?.toLowerCase().includes(lowerQuery)) match = true;
                else if (snapshot.filePath.toLowerCase().includes(lowerQuery)) match = true;
                else if (snapshot.eventType.toLowerCase().includes(lowerQuery)) match = true;

                if (!match && searchContent && snapshot.storagePath) {
                    try {
                        const blobUri = vscode.Uri.joinPath(root, snapshot.storagePath);
                        const data = await vscode.workspace.fs.readFile(blobUri);
                        const content = new TextDecoder().decode(data);
                        if (content.toLowerCase().includes(lowerQuery)) match = true;
                    } catch (e) {}
                }

                if (match) results.push(snapshot);
            }
        }
        
        return results.sort((a, b) => b.timestamp - a.timestamp);
    }
}
