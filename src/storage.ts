import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { Snapshot, HistoryIndex, ChronosConfig } from './types';

export class HistoryStorage {
    private globalStorageRoot: vscode.Uri;
    private indices: Map<string, { index: HistoryIndex, root: vscode.Uri }> = new Map();
    private initialized = false;
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(private context: vscode.ExtensionContext, private outputChannel?: vscode.OutputChannel) {
        this.globalStorageRoot = this.resolveGlobalStorageRoot();
    }

    private resolveGlobalStorageRoot(): vscode.Uri {
        const config = vscode.workspace.getConfiguration('chronos');
        const customPath = config.get<string>('customStoragePath', '');
        
        if (customPath) {
            try {
                let resolvedPath = customPath;
                if (customPath.startsWith('~')) {
                    resolvedPath = path.join(os.homedir(), customPath.slice(1));
                }
                // Handle environment variables like %APPDATA% or $HOME if they happen to be used
                resolvedPath = resolvedPath.replace(/%([^%]+)%/g, (_, n) => process.env[n] || n);
                resolvedPath = resolvedPath.replace(/\$([A-Z_]+)/g, (_, n) => process.env[n] || n);
                
                return vscode.Uri.file(path.resolve(resolvedPath));
            } catch (e) {
                this.log(`Failed to resolve custom storage path: ${e}`);
            }
        }
        
        // If no custom path, use extension storage URI if provided (preferred for tests)
        if (this.context.storageUri || this.context.globalStorageUri) {
            return this.context.storageUri || this.context.globalStorageUri;
        }

        // PRO Default fallback: Shared global storage for Diff App compatibility
        const isWin = process.platform === 'win32';
        const home = os.homedir();
        const defaultGlobalPath = isWin
            ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), '.chronos-history')
            : path.join(home, '.chronos-history');
        
        return vscode.Uri.file(defaultGlobalPath);
    }

    private generateProjectHash(p: string): string {
        // Simple fast string hashing for folder names
        let hash = 0;
        for (let i = 0; i < p.length; i++) {
            const char = p.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16).substring(0, 8);
    }

    private async registerWorkspace(root: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder, index: HistoryIndex): Promise<void> {
        // 1. Tag the local index.json with project metadata
        if (!index.workspace) {
            index.workspace = {
                id: this.generateProjectHash(workspaceFolder.uri.fsPath),
                name: workspaceFolder.name,
                rootPath: workspaceFolder.uri.fsPath,
                lastActivity: Date.now()
            };
            this.log(`Tagging new workspace: ${index.workspace.name}`);
        } else {
            index.workspace.lastActivity = Date.now();
        }

        // 2. Register in the global workspaces.json for the Diff App
        const registryUri = vscode.Uri.joinPath(this.globalStorageRoot, 'workspaces.json');
        try {
            let registry = { workspaces: [] as any[] };
            try {
                const data = await vscode.workspace.fs.readFile(registryUri);
                registry = JSON.parse(new TextDecoder().decode(data));
            } catch (e) {}

            const existingIdx = registry.workspaces.findIndex((w: any) => w.id === index.workspace!.id || w.rootPath === index.workspace!.rootPath);
            if (existingIdx >= 0) {
                registry.workspaces[existingIdx] = index.workspace;
            } else {
                registry.workspaces.push(index.workspace);
            }

            await vscode.workspace.fs.writeFile(registryUri, new TextEncoder().encode(JSON.stringify(registry, null, 2)));
        } catch (e) {
            this.log(`Registry update failed: ${e}`);
        }
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
        // Always refresh root in case config changed
        const newRoot = this.resolveGlobalStorageRoot();
        if (this.globalStorageRoot.toString() !== newRoot.toString()) {
            this.globalStorageRoot = newRoot;
            this.initialized = false; 
            this.indices.clear(); // Clear cached indices if storage root changed
        }

        if (this.initialized) return;
        
        try {
            await vscode.workspace.fs.createDirectory(this.globalStorageRoot);
            this.initialized = true;
            this.log(`Initialized at: ${this.globalStorageRoot.fsPath}`);
        } catch (e) {
            this.log(`Global init failed: ${e}`);
        }
    }

    async getWorkspaceStorageRoot(): Promise<vscode.Uri> {
        await this.init();
        const activeEditor = vscode.window.activeTextEditor;
        const targetUri = activeEditor ? activeEditor.document.uri : (vscode.workspace.workspaceFolders?.[0]?.uri);
        
        if (targetUri) {
            const { root } = await this.getStorageForFile(targetUri);
            return root;
        }
        return this.globalStorageRoot;
    }

    private async getStorageForFile(fileUri: vscode.Uri): Promise<{ root: vscode.Uri, indexUri: vscode.Uri }> {
        const config = vscode.workspace.getConfiguration('chronos');
        const saveInProject = config.get<boolean>('saveInProjectFolder', false);
        const customPath = config.get<string>('customStoragePath', '');
        
        let root = this.globalStorageRoot;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
        
        if (saveInProject && workspaceFolder) {
            root = vscode.Uri.joinPath(workspaceFolder.uri, '.history');
        } else {
            // PRO isolation: When using global shared storage, each project gets a subfolder
            // This is critical for the Diff App to know which project is which.
            if (workspaceFolder) {
                const projectFolderName = workspaceFolder.name;
                const projectHash = this.generateProjectHash(workspaceFolder.uri.fsPath);
                root = vscode.Uri.joinPath(this.globalStorageRoot, `${projectFolderName}-${projectHash}`);
            }
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
            
            // Pro metadata maintenance
            const workspaceFolder = vscode.workspace.workspaceFolders?.find(f => 
                indexUri.toString().includes(f.uri.toString()) || 
                (index.workspace && index.workspace.rootPath === f.uri.fsPath)
            );
            if (workspaceFolder) {
                await this.registerWorkspace(root, workspaceFolder, index);
            }

            this.indices.set(key, { index, root });
            this.log(`Loaded index: ${key} (${index.snapshots.length} snapshots)`);
            return index;
        } catch (e) {
            // Only set empty if it doesn't exist, don't cache permanent failures
            const newIndex: HistoryIndex = { snapshots: [] };
            
            // Try to initialize workspace metadata for new index
            const workspaceFolder = vscode.workspace.workspaceFolders?.find(f => 
                indexUri.toString().includes(f.uri.toString())
            );
            if (workspaceFolder) {
                await this.registerWorkspace(root, workspaceFolder, newIndex);
            }

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

    async getHistoryForFile(fileUri: vscode.Uri, force: boolean = false): Promise<Snapshot[]> {
        await this.init();
        await this.refreshIndices(force); // Optionally force reload to see changes from other instances
        
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
        if (force) {
            this.indices.clear();
        }
        
        const globalIndexUri = vscode.Uri.joinPath(this.globalStorageRoot, 'index.json');
        try {
            await this.loadIndex(globalIndexUri, force);
        } catch {}

        // 1. Scan projects registered in workspaces.json
        const registryUri = vscode.Uri.joinPath(this.globalStorageRoot, 'workspaces.json');
        try {
            const data = await vscode.workspace.fs.readFile(registryUri);
            const decoded = new TextDecoder().decode(data);
            const registry = JSON.parse(decoded);
            if (registry.workspaces && Array.isArray(registry.workspaces)) {
                for (const ws of registry.workspaces) {
                    const wsRoot = vscode.Uri.joinPath(this.globalStorageRoot, `${ws.name}-${ws.id}`);
                    const wsIndexUri = vscode.Uri.joinPath(wsRoot, 'index.json');
                    try {
                        await vscode.workspace.fs.stat(wsIndexUri);
                        await this.loadIndex(wsIndexUri, force);
                    } catch {}
                }
            }
        } catch {}

        // 2. Scan active workspace folders (.history or shared subfolders)
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const { indexUri } = await this.getStorageForFile(folder.uri);
                try {
                    await vscode.workspace.fs.stat(indexUri);
                    await this.loadIndex(indexUri, force);
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
        out += `Global Storage Root: ${this.globalStorageRoot.fsPath}\n`;
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
            out += `Root: ${root.fsPath}\n`;
            out += `Snapshots: ${index.snapshots.length}\n`;
            if (index.snapshots.length > 0) {
                const last = index.snapshots[index.snapshots.length - 1];
                out += `Last Snapshot: ${last.filePath} (Normalized: ${this.normalizePath(last.filePath)}) at ${new Date(last.timestamp).toLocaleString()}\n`;
            }
            out += `----------------------------\n`;
        }
        return out;
    }

    async getProjectHistory(force: boolean = false): Promise<Snapshot[]> {
        await this.init();
        await this.refreshIndices(force);
        
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
                // Update activity timestamp before saving
                if (index.workspace) {
                    index.workspace.lastActivity = Date.now();
                    
                    // Re-register to update the global workspaces.json
                    const workspaceFolder = vscode.workspace.workspaceFolders?.find(f => 
                        indexUri.toString().includes(f.uri.toString()) || 
                        (index.workspace && index.workspace.rootPath === f.uri.fsPath)
                    );
                    if (workspaceFolder) {
                        const root = vscode.Uri.joinPath(indexUri, '..');
                        await this.registerWorkspace(root, workspaceFolder, index);
                    }
                }

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

    async prune(maxDays: number, maxSizeMB: number = 500): Promise<void> {
        if (maxDays <= 0 && maxSizeMB <= 0) return;
        await this.init();
        await this.refreshIndices(true);

        const cutoff = Date.now() - (maxDays * 24 * 60 * 60 * 1000);
        const maxSizeBytes = maxSizeMB * 1024 * 1024;

        for (const [key, { index, root }] of this.indices) {
            const originalCount = index.snapshots.length;
            const toKeep: Snapshot[] = [];
            const toDelete: Snapshot[] = [];

            // 1. Prune by date first
            for (const s of index.snapshots) {
                if (s.pinned || s.timestamp > cutoff) {
                    toKeep.push(s);
                } else {
                    toDelete.push(s);
                }
            }

            // 2. Prune by size if needed (oldest first)
            if (maxSizeBytes > 0) {
                // Sort toKeep by timestamp ascending (oldest first)
                toKeep.sort((a, b) => a.timestamp - b.timestamp);
                
                let currentTotalSize = 0;
                // Calculate total size of all blobs in this index
                const sizeMap = new Map<string, number>();
                for (const s of toKeep) {
                    if (s.storagePath) {
                        try {
                            const blobUri = vscode.Uri.joinPath(root, s.storagePath);
                            const stat = await vscode.workspace.fs.stat(blobUri);
                            sizeMap.set(s.id, stat.size);
                            currentTotalSize += stat.size;
                        } catch (e) {
                            sizeMap.set(s.id, 0);
                        }
                    }
                }

                // Remove oldest until size is within limit
                while (currentTotalSize > maxSizeBytes && toKeep.length > 0) {
                    const oldest = toKeep.shift();
                    if (oldest && !oldest.pinned) {
                        toDelete.push(oldest);
                        currentTotalSize -= sizeMap.get(oldest.id) || 0;
                    } else if (oldest && oldest.pinned) {
                        // If it's pinned, we keep it but it doesn't count towards pruning limit? 
                        // Actually, if we hit here, we should probably stop or skip it.
                        // For simplicity, pinned snapshots are never pruned even if they exceed size limit.
                        continue; 
                    }
                }
                
                // Re-sort back to descending for the index
                toKeep.sort((a, b) => b.timestamp - a.timestamp);
            }

            if (toDelete.length > 0) {
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
