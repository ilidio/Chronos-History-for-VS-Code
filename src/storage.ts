import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Snapshot, HistoryIndex, ChronosConfig } from './types';

export class HistoryStorage {
    private globalStorageRoot: vscode.Uri;
    private indices: Map<string, HistoryIndex> = new Map();
    private initialized = false;
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(private context: vscode.ExtensionContext) {
        this.globalStorageRoot = context.storageUri || context.globalStorageUri;
    }

    async init(): Promise<void> {
        if (this.initialized) return;
        
        try {
            await vscode.workspace.fs.createDirectory(this.globalStorageRoot);
            this.initialized = true;
            console.log('[HistoryStorage] Initialized');
        } catch (e) {
            console.error('[HistoryStorage] Global init failed:', e);
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

    private async loadIndex(indexUri: vscode.Uri): Promise<HistoryIndex> {
        const key = indexUri.toString();
        if (this.indices.has(key)) return this.indices.get(key)!;

        try {
            const data = await vscode.workspace.fs.readFile(indexUri);
            const decoded = new TextDecoder().decode(data);
            const index = JSON.parse(decoded);
            this.indices.set(key, index);
            return index;
        } catch (e) {
            const newIndex = { snapshots: [] };
            this.indices.set(key, newIndex);
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

        const currentContent = document.getText();

        // Optimization: Don't save if content is identical to last snapshot
        const lastSnapshot = [...index.snapshots]
            .filter(s => s.filePath === relativePath)
            .sort((a, b) => b.timestamp - a.timestamp)[0];

        if (eventType !== 'label' && lastSnapshot && lastSnapshot.storagePath) {
            try {
                const lastUri = vscode.Uri.joinPath(root, lastSnapshot.storagePath);
                const lastData = await vscode.workspace.fs.readFile(lastUri);
                const lastContent = new TextDecoder().decode(lastData);
                
                if (lastContent === currentContent) {
                    console.log('[HistoryStorage] Content identical to last snapshot, skipping save.');
                    return null;
                }
            } catch (e) {
                // If we can't read last snapshot, proceed with saving new one
            }
        }

        const id = uuidv4();
        const blobUri = vscode.Uri.joinPath(root, id);

        try {
            await vscode.workspace.fs.createDirectory(root);
            const content = new TextEncoder().encode(currentContent);
            await vscode.workspace.fs.writeFile(blobUri, content);
        } catch (e) {
            console.error('[HistoryStorage] Save failed:', e);
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
        
        return snapshot;
    }

    async getHistoryForFile(fileUri: vscode.Uri): Promise<Snapshot[]> {
        await this.init();
        
        const { indexUri } = await this.getStorageForFile(fileUri);
        const index = await this.loadIndex(indexUri);
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);

        return index.snapshots
            .filter(s => s.filePath === relativePath || s.eventType === 'label')
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    private async refreshIndices(): Promise<void> {
        // Always ensure global index is loaded
        const globalIndexUri = vscode.Uri.joinPath(this.globalStorageRoot, 'index.json');
        await this.loadIndex(globalIndexUri);

        // If enabled, check all workspace folders for local indices
        const config = vscode.workspace.getConfiguration('chronos');
        const saveInProject = config.get<boolean>('saveInProjectFolder', false);
        
        if (saveInProject && vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const localIndexUri = vscode.Uri.joinPath(folder.uri, '.history', 'index.json');
                try {
                    await vscode.workspace.fs.stat(localIndexUri);
                    await this.loadIndex(localIndexUri);
                } catch {
                    // Index doesn't exist in this folder, skip
                }
            }
        }
    }

    async getProjectHistory(): Promise<Snapshot[]> {
        await this.init();
        await this.refreshIndices();
        
        let all: Snapshot[] = [];
        for (const index of this.indices.values()) {
            all = all.concat(index.snapshots);
        }
        return all.sort((a, b) => b.timestamp - a.timestamp);
    }

    async getSnapshotUri(snapshot: Snapshot, fileUri: vscode.Uri): Promise<vscode.Uri> {
        const { root } = await this.getStorageForFile(fileUri);
        return vscode.Uri.joinPath(root, snapshot.storagePath!);
    }

    private async saveIndex(index: HistoryIndex, indexUri: vscode.Uri) {
        this.saveQueue = this.saveQueue.then(async () => {
            try {
                const data = new TextEncoder().encode(JSON.stringify(index, null, 2));
                await vscode.workspace.fs.writeFile(indexUri, data);
            } catch (e) {
                console.error('[HistoryStorage] Index save failed:', e);
            }
        });
        return this.saveQueue;
    }

    async createLabel(name: string, description?: string, document?: vscode.TextDocument) {
        if (document) {
            await this.saveSnapshot(document, 'label', name, description);
            return;
        }

        let targetUri = this.globalStorageRoot;
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            targetUri = vscode.workspace.workspaceFolders[0].uri;
        }
        const { indexUri } = await this.getStorageForFile(targetUri);
        const index = await this.loadIndex(indexUri);

        index.snapshots.push({
            id: uuidv4(),
            timestamp: Date.now(),
            filePath: '',
            eventType: 'label',
            label: name,
            description
        });
        await this.saveIndex(index, indexUri);
    }

    async search(query: string): Promise<Snapshot[]> {
        await this.init();
        await this.refreshIndices();
        
        const allSnapshots = await this.getProjectHistory();
        const results: Snapshot[] = [];
        
        // Limit concurrency and total results
        const limit = 50;
        
        for (const snapshot of allSnapshots) {
            if (results.length >= limit) break;
            if (!snapshot.storagePath) continue;
            
            try {
                // Determine root for this snapshot
                let root = this.globalStorageRoot;
                // If we knew which workspace folder this came from, we'd use it.
                // But getProjectHistory merges all indices.
                // We need to find where the snapshot is stored. 
                // Currently indices are mapped by key (indexUri).
                // But the snapshot object doesn't know its source index.
                // We might need to try both global and local if we don't know.
                
                // Improvement: storage logic needs to know where to look.
                // For now, let's assume we can resolve it.
                // Actually, getSnapshotUri takes a fileUri. We don't have fileUri here easily.
                
                // Workaround: We iterate known indices to find where this snapshot belongs?
                // Or simply try to resolve it.
                
                // Let's refactor slightly: getProjectHistory could return { snapshot, rootUri }?
                // Or we iterate indices here directly.
            } catch (e) {}
        }

        // Re-implementing loop to handle storage roots correctly
        for (const [key, index] of this.indices) {
            if (results.length >= limit) break;
            
            // key is indexUri string. Root is parent of indexUri.
            const indexUri = vscode.Uri.parse(key);
            const root = vscode.Uri.joinPath(indexUri, '..');
            
            for (const snapshot of index.snapshots) {
                if (results.length >= limit) break;
                if (!snapshot.storagePath) continue;

                try {
                    const blobUri = vscode.Uri.joinPath(root, snapshot.storagePath);
                    const data = await vscode.workspace.fs.readFile(blobUri);
                    const content = new TextDecoder().decode(data);
                    
                    if (content.toLowerCase().includes(query.toLowerCase())) {
                        results.push(snapshot);
                    }
                } catch (e) {
                    // ignore read errors
                }
            }
        }
        
        return results.sort((a, b) => b.timestamp - a.timestamp);
    }
}
