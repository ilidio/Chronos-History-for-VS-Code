import * as vscode from 'vscode';
import { HistoryStorage } from './storage';
import { ChronosConfig } from './types';
import { minimatch } from 'minimatch';

export class HistoryManager {
    private storage: HistoryStorage;
    private config: ChronosConfig;
    private statusBarItem: vscode.StatusBarItem;
    private activeExperiment: { name: string, snapshotId: string, filePath: string } | null = null;

    constructor(context: vscode.ExtensionContext, storage: HistoryStorage) {
        this.storage = storage;
        this.config = this.loadConfig();
        
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        context.subscriptions.push(this.statusBarItem);

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('chronos')) {
                this.config = this.loadConfig();
            }
        });

        if (this.config.enabled) {
            this.activate(context);
        }
    }

    private loadConfig(): ChronosConfig {
        const config = vscode.workspace.getConfiguration('chronos');
        return {
            enabled: config.get<boolean>('enabled', true),
            maxDays: config.get<number>('maxDays', 30),
            maxSizeMB: config.get<number>('maxSizeMB', 500),
            trackSelectionHistory: config.get<boolean>('trackSelectionHistory', true),
            exclude: config.get<string[]>('exclude', [])
        };
    }

    private activate(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(this.onSave, this),
            vscode.workspace.onDidOpenTextDocument(this.onOpen, this),
            vscode.workspace.onDidRenameFiles(this.onRename, this),
            vscode.workspace.onDidDeleteFiles(this.onDelete, this)
        );

        setTimeout(() => {
            vscode.workspace.textDocuments.forEach(doc => this.onOpen(doc));
        }, 1000);
    }
    
    public async startExperiment(name: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Open a file to start an experiment.');
            return;
        }
        
        // We only track experiment for the active file for simplicity in this version,
        // or we could track it globally. Let's start with file-scope or global?
        // "Experiments" usually imply a feature branch, so global is better.
        // But our snapshots are file-based.
        // Let's make it file-based for safety first.
        
        const snapshot = await this.storage.saveSnapshot(editor.document, 'label', `Experiment Start: ${name}`);
        if (snapshot) {
            this.activeExperiment = { 
                name, 
                snapshotId: snapshot.id, 
                filePath: vscode.workspace.asRelativePath(editor.document.uri) 
            };
            this.updateStatusBar();
            vscode.window.showInformationMessage(`Experiment "${name}" started.`);
        }
    }
    
    public async stopExperiment(keep: boolean) {
        if (!this.activeExperiment) return;
        
        if (!keep) {
            // Revert
            // We need to trigger the restore command or call logic directly.
            // Since we are in Manager, we can't easily call 'restoreSnapshot' from extension.ts without circular dep or command execution.
            // Command execution is clean.
            await vscode.commands.executeCommand('chronos.restoreSnapshot', this.activeExperiment.snapshotId, this.activeExperiment.filePath);
            vscode.window.showInformationMessage(`Experiment "${this.activeExperiment.name}" discarded.`);
        } else {
            vscode.window.showInformationMessage(`Experiment "${this.activeExperiment.name}" kept.`);
        }
        
        this.activeExperiment = null;
        this.updateStatusBar();
    }
    
    private updateStatusBar() {
        if (this.activeExperiment) {
            this.statusBarItem.text = `$(beaker) Exp: ${this.activeExperiment.name}`;
            this.statusBarItem.command = 'chronos.manageExperiment';
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    private isExcluded(path: string): boolean {
        return this.config.exclude.some(pattern => minimatch(path, pattern));
    }

    private async onOpen(doc: vscode.TextDocument) {
        if (doc.uri.scheme !== 'file') return;
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
        if (this.isExcluded(relativePath)) return;

        try {
            const history = await this.storage.getHistoryForFile(doc.uri);
            if (history.filter(s => s.eventType !== 'label').length === 0) {
                console.log('[HistoryManager] Creating initial baseline for:', relativePath);
                await this.storage.saveSnapshot(doc, 'manual', 'Initial Baseline');
            }
        } catch (e) {
            console.error('[HistoryManager] onOpen baseline failed:', e);
        }
    }

    private async onSave(doc: vscode.TextDocument) {
        if (doc.uri.scheme !== 'file') return;
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
        if (this.isExcluded(relativePath)) return;

        try {
            const result = await this.storage.saveSnapshot(doc, 'save');
            if (result) {
                vscode.window.setStatusBarMessage('Snapshot: ' + relativePath, 2000);
            }
        } catch (e) {
            console.error('[HistoryManager] Save failed:', e);
        }
    }

    private async onRename(e: vscode.FileRenameEvent) {
        for (const file of e.files) {
            try {
                const doc = await vscode.workspace.openTextDocument(file.newUri);
                const relativePath = vscode.workspace.asRelativePath(file.newUri, false);
                if (this.isExcluded(relativePath)) continue;
                await this.storage.saveSnapshot(doc, 'rename');
            } catch (err) {}
        }
    }

    private async onDelete(e: vscode.FileDeleteEvent) {}

    public async putLabel(name: string, description?: string, document?: vscode.TextDocument) {
        await this.storage.createLabel(name, description, document);
    }

    public async getDeletedFiles(): Promise<string[]> {
        const snapshots = await this.storage.getProjectHistory();
        const allPaths = new Set<string>();
        snapshots.forEach(s => {
            if (s.filePath && s.filePath.trim() !== '') {
                allPaths.add(s.filePath);
            }
        });

        const deletedFiles: string[] = [];
        if (!vscode.workspace.workspaceFolders) return [];
        
        // We assume single root for simplicity or check against all roots
        // For multi-root, we might need to handle it better, but for now let's assume relative paths resolve against the first root or we find the right one.
        // Actually, storage saves relative paths. We should check against the workspace folders.
        
        for (const relativePath of allPaths) {
            let exists = false;
            for (const folder of vscode.workspace.workspaceFolders) {
                const uri = vscode.Uri.joinPath(folder.uri, relativePath);
                try {
                    await vscode.workspace.fs.stat(uri);
                    exists = true;
                    break;
                } catch {
                    // Not found in this folder
                }
            }
            if (!exists) {
                deletedFiles.push(relativePath);
            }
        }
        return deletedFiles;
    }
}