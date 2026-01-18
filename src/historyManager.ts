import * as vscode from 'vscode';
import { HistoryStorage } from './storage';
import { ChronosConfig } from './types';
import { minimatch } from 'minimatch';
import { AIService } from './ai/aiService';
import { GitService } from './git/gitService';

export class HistoryManager {
    private storage: HistoryStorage;
    private config: ChronosConfig;
    private statusBarItem: vscode.StatusBarItem;
    private activeExperiment: { name: string, snapshotId: string, filePath: string } | null = null;
    private aiService: AIService;
    private gitService: GitService;

    constructor(context: vscode.ExtensionContext, storage: HistoryStorage, gitService: GitService) {
        this.storage = storage;
        this.gitService = gitService;
        this.aiService = new AIService();
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
        
        // AI Post-Mortem
        if (this.aiService.isEnabled('experimentPostMortem')) {
            try {
                // Resolve file URI
                let fileUri: vscode.Uri | undefined;
                if (vscode.workspace.workspaceFolders) {
                    fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, this.activeExperiment.filePath);
                }
                
                if (fileUri) {
                    const history = await this.storage.getHistoryForFile(fileUri);
                    const startSnapshot = history.find(s => s.id === this.activeExperiment!.snapshotId);
                    
                    if (startSnapshot) {
                        const startPath = (await this.storage.getSnapshotUri(startSnapshot, fileUri)).fsPath;
                        const diff = await this.gitService.getDiff(startPath, fileUri.fsPath);
                        
                        vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Generating Experiment Summary...",
                            cancellable: false
                        }, async () => {
                            const summary = await this.aiService.experimentPostMortem(diff, keep);
                            if (summary) {
                                if (keep) {
                                    const doc = await vscode.workspace.openTextDocument({ content: summary, language: 'markdown' });
                                    await vscode.window.showTextDocument(doc);
                                } else {
                                    vscode.window.showInformationMessage(`Experiment Discarded.\n\nAI Summary: ${summary}`, { modal: true });
                                }
                            }
                        });
                    }
                }
            } catch (e) {
                console.error("Experiment Post-Mortem failed", e);
            }
        }

        if (!keep) {
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
            let label = undefined;
            
            // Smart Summaries
            if (this.aiService.isEnabled('smartSummaries')) {
                const history = await this.storage.getHistoryForFile(doc.uri);
                if (history.length > 0) {
                    const prev = history[0]; // Latest snapshot before this save
                    const prevPath = (await this.storage.getSnapshotUri(prev, doc.uri)).fsPath;
                    const diff = await this.gitService.getDiff(prevPath, doc.fileName);
                    
                    if (diff && diff.trim().length > 0) {
                        label = await this.aiService.summarizeDiff(diff);
                    }
                }
            }

            const result = await this.storage.saveSnapshot(doc, 'save', label);
            if (result) {
                const msg = label ? `Snapshot: ${label}` : `Snapshot: ${relativePath}`;
                vscode.window.setStatusBarMessage(msg, 3000);
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
