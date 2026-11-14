import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { Snapshot, HistoryIndex, ChronosConfig } from './types';

/** Index entries whose blob is gone, grouped per file, for one index. */
export interface OrphanReport {
    /** `index.json` URI, as a string — the key `removeOrphanedEntries` acts on. */
    indexKey: string;
    rootPath: string;
    /** True when this index belongs to a project currently open. */
    own: boolean;
    files: { filePath: string; snapshots: Snapshot[] }[];
    total: number;
}

export interface MigrationResult {
    copied: number;
    skipped: number;
    failed: { path: string; reason: string }[];
}

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

        let raw: Uint8Array | undefined;
        try {
            raw = await vscode.workspace.fs.readFile(indexUri);
        } catch (e) {
            // "No index yet" and "the index is there but unreadable" must not be
            // conflated: starting fresh on a read error would let the next save
            // overwrite history that is still on disk.
            if (await this.exists(indexUri)) {
                this.log(`Index unreadable: ${key} — ${e}`);
                vscode.window.showWarningMessage(
                    `Chronos: the history index at ${indexUri.fsPath} could not be read, so history is not being recorded. The existing history has been left untouched.`
                );
                throw e;
            }
            // First run for this project: a fresh index is created below.
            raw = undefined;
        }

        if (raw) {
            const index = this.parseIndex(raw);
            if (index) {
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
            }

            // The index exists but is unreadable. Starting from an empty index would
            // let the next save overwrite it, so keep the bytes aside first and tell
            // the user where they went — they are the only copy of that history.
            await this.quarantineIndex(indexUri, raw);
        }

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

    private async exists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch (e) {
            return false;
        }
    }

    /** Parses index bytes, returning null when the content is not a usable index. */
    private parseIndex(raw: Uint8Array): HistoryIndex | null {
        try {
            const parsed = JSON.parse(new TextDecoder().decode(raw));
            if (!parsed || !Array.isArray(parsed.snapshots)) return null;
            return parsed as HistoryIndex;
        } catch (e) {
            return null;
        }
    }

    /** Copies a damaged index aside so it is never silently overwritten. */
    private async quarantineIndex(indexUri: vscode.Uri, raw: Uint8Array): Promise<void> {
        const backupUri = vscode.Uri.joinPath(indexUri, '..', `index.corrupt-${Date.now()}.json`);
        try {
            await vscode.workspace.fs.writeFile(backupUri, raw);
            this.log(`Index unreadable: ${indexUri.toString()} — backed up to ${backupUri.fsPath}`);
            vscode.window.showWarningMessage(
                `Chronos: the history index was unreadable and has been backed up to ${backupUri.fsPath}. A new index was started.`
            );
        } catch (e) {
            // Could not preserve it; at least make the failure visible.
            this.log(`Index unreadable: ${indexUri.toString()} — backup FAILED: ${e}`);
            vscode.window.showWarningMessage(
                `Chronos: the history index at ${indexUri.fsPath} is unreadable and could not be backed up.`
            );
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
        const rootById = new Map<string, vscode.Uri>();

        for (const [key, { index, root }] of this.indices.entries()) {
            const matches = index.snapshots.filter(s => {
                const sPath = this.normalizePath(s.filePath);
                const match = sPath === normalizedRelPath || 
                             (sPath.endsWith('/' + normalizedRelPath)) || 
                             (normalizedRelPath.endsWith('/' + sPath)) ||
                             (s.eventType === 'label' && sPath === '');
                if (match) this.log(`Match found in index ${key}: ${s.filePath} (id: ${s.id})`);
                return match;
            });
            for (const m of matches) rootById.set(m.id, root);
            results = results.concat(matches);
        }

        this.log(`Total history entries found: ${results.length}`);
        return this.annotateAvailability(results.sort((a, b) => b.timestamp - a.timestamp), rootById);
    }

    /**
     * Flags entries whose stored content is gone, so callers can present them
     * as unavailable instead of offering a diff that cannot open.
     *
     * The flag is computed per call and never written to the index: an entry
     * may be missing only because the storage root moved or a drive is not
     * mounted, and persisting that judgement would turn a temporary condition
     * into a permanent record. Removing such entries for good is a separate,
     * confirmed action — see `findOrphanedEntries` / `removeOrphanedEntries`.
     */
    private async annotateAvailability(snapshots: Snapshot[], rootById: Map<string, vscode.Uri>): Promise<Snapshot[]> {
        const annotated: Snapshot[] = [];
        for (const s of snapshots) {
            const root = rootById.get(s.id);
            if (!root || !s.storagePath) {
                annotated.push(s);
                continue;
            }
            const missing = await this.isContentMissing(root, s);
            annotated.push(missing ? { ...s, contentMissing: true } : s);
        }
        return annotated;
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

    /** The root every project's history lives under, as currently resolved. */
    public getGlobalRoot(): vscode.Uri {
        return this.globalStorageRoot;
    }

    /**
     * Index entries that point at content which is no longer on disk.
     *
     * The index and the blobs are two separate things, and only the index is
     * rewritten on every save: a storage root that moved under it, an
     * interrupted write or a manual cleanup leaves entries that the UI offers
     * as if they were openable. Entries without a `storagePath` (labels) hold
     * no content by design and are never orphans.
     */
    public async findOrphanedEntries(): Promise<OrphanReport[]> {
        await this.init();
        await this.refreshIndices(true);
        const ownKeys = await this.getOwnIndexKeys();
        const reports: OrphanReport[] = [];

        for (const [key, { index, root }] of this.indices) {
            const byFile = new Map<string, Snapshot[]>();
            let total = 0;
            for (const s of index.snapshots) {
                if (!(await this.isContentMissing(root, s))) continue;
                const list = byFile.get(s.filePath) ?? [];
                list.push(s);
                byFile.set(s.filePath, list);
                total++;
            }
            if (total === 0) continue;
            reports.push({
                indexKey: key,
                rootPath: root.fsPath,
                own: ownKeys.has(key),
                total,
                files: [...byFile.entries()]
                    .map(([filePath, snapshots]) => ({
                        filePath,
                        snapshots: snapshots.sort((a, b) => b.timestamp - a.timestamp)
                    }))
                    .sort((a, b) => b.snapshots.length - a.snapshots.length)
            });
        }
        return reports;
    }

    /** True when the snapshot claims stored content that is not there. */
    private async isContentMissing(root: vscode.Uri, snapshot: Snapshot): Promise<boolean> {
        if (!snapshot.storagePath) return false;
        return !(await this.exists(vscode.Uri.joinPath(root, snapshot.storagePath)));
    }

    /**
     * Drops the entries listed in `reports` from their indices.
     *
     * This deletes the user's history, so the caller is the one that confirms
     * it. Only the ids given are removed, and each is re-checked against disk
     * first: an entry whose blob is present is never dropped, however it was
     * reported. Other projects sharing the global store are left alone unless
     * their report is passed in explicitly.
     */
    public async removeOrphanedEntries(reports: OrphanReport[]): Promise<{ removed: number; keptWithContent: number }> {
        await this.init();
        let removed = 0;
        let keptWithContent = 0;

        for (const report of reports) {
            const entry = this.indices.get(report.indexKey);
            if (!entry) continue;
            const { index, root } = entry;

            const requested = new Set<string>();
            for (const file of report.files) {
                for (const s of file.snapshots) requested.add(s.id);
            }

            const kept: Snapshot[] = [];
            for (const s of index.snapshots) {
                if (!requested.has(s.id)) {
                    kept.push(s);
                    continue;
                }
                if (await this.isContentMissing(root, s)) {
                    removed++;
                } else {
                    // The blob reappeared between the report and the
                    // confirmation. It is real history; keep it.
                    kept.push(s);
                    keptWithContent++;
                }
            }

            if (removed > 0 || keptWithContent > 0) {
                index.snapshots = kept;
                await this.saveIndex(index, vscode.Uri.parse(report.indexKey));
            }
        }

        this.log(`Removed ${removed} orphaned index entries (kept ${keptWithContent} whose content was present).`);
        return { removed, keptWithContent };
    }

    /** Total snapshots recorded under a storage root, across every project in it. */
    public async countSnapshotsUnder(root: vscode.Uri): Promise<number> {
        let total = 0;
        for (const indexUri of await this.findIndexFiles(root)) {
            try {
                const parsed = this.parseIndex(await vscode.workspace.fs.readFile(indexUri));
                if (parsed) total += parsed.snapshots.length;
            } catch (e) {
                // Unreadable index: it is not ours to repair here.
            }
        }
        return total;
    }

    /** `index.json` files directly under `root` or one level down (per project). */
    private async findIndexFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
        const found: vscode.Uri[] = [];
        const rootIndex = vscode.Uri.joinPath(root, 'index.json');
        if (await this.exists(rootIndex)) found.push(rootIndex);

        let children: [string, vscode.FileType][] = [];
        try {
            children = await vscode.workspace.fs.readDirectory(root);
        } catch (e) {
            return found;
        }
        for (const [name, type] of children) {
            if (type !== vscode.FileType.Directory) continue;
            const childIndex = vscode.Uri.joinPath(root, name, 'index.json');
            if (await this.exists(childIndex)) found.push(childIndex);
        }
        return found;
    }

    /**
     * Copies a storage root to a new location, leaving the source untouched.
     *
     * Switching `customStoragePath` does not move anything: the old history
     * simply stops being found. Copying first and verifying every byte written
     * means a failed migration costs nothing — the original is still the only
     * authority, and the caller can leave the setting alone. Files already
     * present at the destination are skipped rather than overwritten.
     */
    public async migrateStorage(from: vscode.Uri, to: vscode.Uri): Promise<MigrationResult> {
        const result: MigrationResult = { copied: 0, skipped: 0, failed: [] };
        if (from.toString() === to.toString()) return result;
        await this.copyTree(from, to, result);
        this.log(`Migration ${from.fsPath} -> ${to.fsPath}: ${result.copied} copied, ${result.skipped} skipped, ${result.failed.length} failed.`);
        return result;
    }

    private async copyTree(from: vscode.Uri, to: vscode.Uri, result: MigrationResult): Promise<void> {
        let children: [string, vscode.FileType][];
        try {
            children = await vscode.workspace.fs.readDirectory(from);
        } catch (e) {
            result.failed.push({ path: from.fsPath, reason: String(e) });
            return;
        }

        try {
            await vscode.workspace.fs.createDirectory(to);
        } catch (e) {
            result.failed.push({ path: to.fsPath, reason: String(e) });
            return;
        }

        for (const [name, type] of children) {
            const src = vscode.Uri.joinPath(from, name);
            const dst = vscode.Uri.joinPath(to, name);

            if (type === vscode.FileType.Directory) {
                await this.copyTree(src, dst, result);
                continue;
            }
            if (type !== vscode.FileType.File) continue;

            if (await this.exists(dst)) {
                // Never overwrite history that is already at the destination.
                result.skipped++;
                continue;
            }

            try {
                const data = await vscode.workspace.fs.readFile(src);
                await vscode.workspace.fs.writeFile(dst, data);
                const written = await vscode.workspace.fs.readFile(dst);
                if (written.length !== data.length) {
                    throw new Error(`copy verification failed (${data.length} bytes in, ${written.length} out)`);
                }
                result.copied++;
            } catch (e) {
                result.failed.push({ path: src.fsPath, reason: e instanceof Error ? e.message : String(e) });
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

        const orphans = await this.findOrphanedEntries();
        const orphansByIndex = new Map(orphans.map(r => [r.indexKey, r]));

        for (const [key, { index, root }] of this.indices.entries()) {
            out += `Index: ${key}\n`;
            out += `Root: ${root.fsPath}\n`;
            out += `Snapshots: ${index.snapshots.length}\n`;
            if (index.snapshots.length > 0) {
                const last = index.snapshots[index.snapshots.length - 1];
                out += `Last Snapshot: ${last.filePath} (Normalized: ${this.normalizePath(last.filePath)}) at ${new Date(last.timestamp).toLocaleString()}\n`;
            }

            const report = orphansByIndex.get(key);
            if (!report) {
                out += `Orphaned Entries: 0\n`;
            } else {
                out += `Orphaned Entries: ${report.total} (listed in the index, content missing from disk)\n`;
                for (const file of report.files) {
                    const newest = new Date(file.snapshots[0].timestamp).toLocaleString();
                    out += `  - ${file.filePath}: ${file.snapshots.length} (newest ${newest})\n`;
                }
            }
            out += `----------------------------\n`;
        }

        const totalOrphans = orphans.reduce((n, r) => n + r.total, 0);
        if (totalOrphans > 0) {
            out += `\n${totalOrphans} orphaned entr${totalOrphans === 1 ? 'y' : 'ies'} found.\n`;
            out += `Run "Chronos: Remove Orphaned History Entries" to clear them from the index.\n`;
            out += `That only removes entries whose content is already gone; nothing openable is touched.\n`;
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

        if (!snapshot.storagePath) {
            throw new Error(`Snapshot ${snapshot.id} has no storagePath`);
        }

        for (const { index, root } of this.indices.values()) {
            if (index.snapshots.some(s => s.id === snapshot.id)) {
                return vscode.Uri.joinPath(root, snapshot.storagePath);
            }
        }

        const { root } = await this.getStorageForFile(fileUri);
        return vscode.Uri.joinPath(root, snapshot.storagePath);
    }

    /**
     * Writes an index, serialized against the other index writes.
     *
     * A failed write used to be logged and swallowed, which is how an index can
     * end up describing history that is no longer there: `prune()` deleted the
     * blobs, the index write that was meant to drop those entries never landed,
     * and nothing said so. The failure is now reported to the user and rethrown,
     * so callers that are about to delete content can stop.
     */
    private async saveIndex(index: HistoryIndex, indexUri: vscode.Uri): Promise<void> {
        const task = this.saveQueue.then(() => this.writeIndex(index, indexUri));
        // The queue exists only to serialize writes. It must not be left in a
        // rejected state, or every later save would fail on an error that has
        // already been reported and handled.
        this.saveQueue = task.catch(() => {});
        return task;
    }

    private async writeIndex(index: HistoryIndex, indexUri: vscode.Uri): Promise<void> {
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
            const reason = e instanceof Error ? e.message : String(e);
            this.log(`Index save failed: ${indexUri.toString()} — ${reason}`);
            vscode.window.showErrorMessage(
                `Chronos: the history index at ${indexUri.fsPath} could not be written (${reason}), so the last change was not recorded.`
            );
            throw e;
        }
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
        const ownKeys = await this.getOwnIndexKeys();

        for (const [key, { index, root }] of this.indices) {
            // Retention is per-project. The global store keeps every registered
            // project's index loaded, so pruning anything but our own indices
            // would delete another project's history using this project's limits.
            if (!ownKeys.has(key)) {
                continue;
            }

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
            let kept = toKeep;
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

                // Evict the oldest snapshots until we are within the limit, but only
                // those that actually free space: pinned snapshots are never pruned,
                // and entries without a blob (labels) reclaim nothing, so dropping
                // either of them would lose history for no gain.
                const survivors: Snapshot[] = [];
                for (const s of toKeep) {
                    const reclaimable = !s.pinned && !!s.storagePath;
                    if (currentTotalSize > maxSizeBytes && reclaimable) {
                        toDelete.push(s);
                        currentTotalSize -= sizeMap.get(s.id) || 0;
                    } else {
                        survivors.push(s);
                    }
                }

                if (currentTotalSize > maxSizeBytes) {
                    this.log(`Still over the ${maxSizeMB}MB limit after pruning; pinned snapshots are never removed.`);
                }

                // Re-sort back to descending for the index
                survivors.sort((a, b) => b.timestamp - a.timestamp);
                kept = survivors;
            }

            if (toDelete.length > 0) {
                // The index is written first, on purpose. The two orders fail
                // very differently: deleting the blobs first and losing the
                // index write leaves entries describing content that is gone —
                // exactly the broken history this has produced before — while
                // this order leaves at worst a few unreferenced blobs, which
                // cost space and nothing else.
                const previous = index.snapshots;
                index.snapshots = kept;
                const indexUri = vscode.Uri.parse(key);
                try {
                    await this.saveIndex(index, indexUri);
                } catch (e) {
                    // The pruned index never reached disk, so those snapshots
                    // are still history. Put them back and delete nothing.
                    index.snapshots = previous;
                    this.log(`Prune aborted for ${key}: the index could not be written, so no content was deleted.`);
                    continue;
                }

                for (const s of toDelete) {
                    if (s.storagePath) {
                        try {
                            const blobUri = vscode.Uri.joinPath(root, s.storagePath);
                            await vscode.workspace.fs.delete(blobUri, { recursive: false, useTrash: false });
                        } catch (e) {}
                    }
                }
            }
        }
    }

    /**
     * Index keys that belong to the project(s) currently open. Used to keep
     * destructive maintenance away from other projects sharing the global store.
     */
    private async getOwnIndexKeys(): Promise<Set<string>> {
        const keys = new Set<string>();
        const folders = vscode.workspace.workspaceFolders;
        if (folders) {
            for (const folder of folders) {
                const { indexUri } = await this.getStorageForFile(folder.uri);
                keys.add(indexUri.toString());
            }
        }
        if (keys.size === 0) {
            keys.add(vscode.Uri.joinPath(this.globalStorageRoot, 'index.json').toString());
        }
        return keys;
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
