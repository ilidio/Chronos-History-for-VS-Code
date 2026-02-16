import * as vscode from 'vscode';
import * as path from 'path';
import { HistoryStorage } from './storage';
import { ChronosConfig, Snapshot } from './types';
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
            exclude: config.get<string[]>('exclude', []),
            dailyBriefing: config.get<boolean>('ai.dailyBriefing', true)
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
            // Maintenance
            this.storage.prune(this.config.maxDays).catch(err => console.error('Pruning failed:', err));
        }, 1000);
    }
    
    public async togglePin(snapshotId: string): Promise<boolean> {
        return await this.storage.togglePin(snapshotId);
    }

    public async showDailyBriefing() {
        if (!this.aiService.isEnabled('smartSummaries')) return;

        const history = await this.storage.getProjectHistory();
        if (history.length === 0) return;

        const lastSnapshotTime = history[0].timestamp;
        const oneDay = 24 * 60 * 60 * 1000;
        const sessionSnapshots = history.filter(s => s.timestamp > (lastSnapshotTime - oneDay) && s.eventType === 'save');

        await this.generateBriefingForSnapshots(sessionSnapshots, `State at ${new Date(lastSnapshotTime).toLocaleDateString()}`);
    }

    public async showDailyBriefingForDate() {
        const history = await this.storage.getProjectHistory();
        if (history.length === 0) return;

        // Group snapshots by date
        const groups = new Map<string, Snapshot[]>();
        for (const s of history) {
            const dateStr = new Date(s.timestamp).toLocaleDateString();
            if (!groups.has(dateStr)) groups.set(dateStr, []);
            groups.get(dateStr)!.push(s);
        }

        const items = Array.from(groups.keys()).map(date => ({
            label: date,
            description: `${groups.get(date)!.length} snapshots`
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a date to generate a briefing for'
        });

        if (selected) {
            const daySnapshots = groups.get(selected.label)!;
            await this.generateBriefingForSnapshots(daySnapshots, selected.label);
        }
    }

    private async generateBriefingForSnapshots(snapshots: Snapshot[], title: string) {
        if (snapshots.length < 1) return;

        const summaryData = snapshots.slice(0, 20).map(s => `- ${s.filePath}: ${s.label || 'Modified'}`).join('\n');
        
        const briefing = await this.aiService.generateDailyBriefing(summaryData);
        if (briefing) {
            const channel = vscode.window.createOutputChannel(`Chronos Brief: ${title}`);
            channel.appendLine(`📅 Chronos Progress Briefing - ${title}`);
            channel.appendLine("==================================");
            channel.appendLine("");
            channel.appendLine(briefing);
            channel.show(true);
        }
    }

    public async generateChangelog() {
        const history = await this.storage.getProjectHistory();
        if (history.length === 0) return;

        const presets = [
            { label: 'Last 24 Hours', value: 24 * 60 * 60 * 1000 },
            { label: 'Last 7 Days', value: 7 * 24 * 60 * 60 * 1000 },
            { label: 'Last 30 Days', value: 30 * 24 * 60 * 60 * 1000 },
            { label: 'Custom Range...', value: -1 }
        ];

        const selected = await vscode.window.showQuickPick(presets, { placeHolder: 'Select time range for Changelog' });
        if (!selected) return;

        let startTime = Date.now() - selected.value;
        let endTime = Date.now();

        if (selected.value === -1) {
            const snapshots = history.map(s => ({
                label: new Date(s.timestamp).toLocaleString(),
                description: s.label || s.filePath,
                timestamp: s.timestamp
            }));

            const start = await vscode.window.showQuickPick(snapshots, { title: 'Select START point' });
            if (!start) return;
            const end = await vscode.window.showQuickPick(snapshots, { title: 'Select END point' });
            if (!end) return;

            startTime = Math.min(start.timestamp, end.timestamp);
            endTime = Math.max(start.timestamp, end.timestamp);
        }

        const filtered = history.filter(s => s.timestamp >= startTime && s.timestamp <= endTime && s.eventType === 'save');
        if (filtered.length === 0) {
            vscode.window.showInformationMessage('No changes found in the selected range.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating Changelog Draft...",
            cancellable: false
        }, async () => {
            const activityData = filtered.slice(0, 50).map(s => `- ${s.filePath}: ${s.label || 'Modified'}`).join('\n');
            const changelog = await this.aiService.generateChangelog(activityData);
            
            if (changelog) {
                const doc = await vscode.workspace.openTextDocument({ content: changelog, language: 'markdown' });
                await vscode.window.showTextDocument(doc);
            }
        });
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
        
        if (this.aiService.isEnabled('experimentPostMortem')) {
            try {
                let fileUri: vscode.Uri | undefined;
                if (this.activeExperiment.filePath) {
                    if (path.isAbsolute(this.activeExperiment.filePath)) {
                        fileUri = vscode.Uri.file(this.activeExperiment.filePath);
                    } else if (vscode.workspace.workspaceFolders) {
                        fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, this.activeExperiment.filePath);
                    }
                }
                
                if (fileUri) {
                    const history = await this.storage.getHistoryForFile(fileUri);
                    const startSnapshot = history.find(s => s.id === this.activeExperiment!.snapshotId);
                    
                    if (startSnapshot) {
                        const startPath = (await this.storage.getSnapshotUri(startSnapshot, fileUri)).fsPath;
                        const diff = await this.gitService.getDiff(startPath, fileUri.fsPath);
                        
                        const summary = await this.aiService.experimentPostMortem(diff, keep);
                        if (summary) {
                            if (keep) {
                                const doc = await vscode.workspace.openTextDocument({ content: summary, language: 'markdown' });
                                await vscode.window.showTextDocument(doc);
                            } else {
                                vscode.window.showInformationMessage(`AI Note: ${summary}`, { modal: true });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("Experiment Post-Mortem failed", e);
            }
        }

        if (!keep) {
            await vscode.commands.executeCommand('chronos.restoreSnapshot', this.activeExperiment.snapshotId, this.activeExperiment.filePath);
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
                await this.storage.saveSnapshot(doc, 'manual', 'Initial Baseline');
            }
        } catch (e) {}
    }

    private async onSave(doc: vscode.TextDocument) {
        if (doc.uri.scheme !== 'file') return;
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
        if (this.isExcluded(relativePath)) return;

        try {
            let label = undefined;
            let magnitude = { added: 0, deleted: 0 };
            
            const history = await this.storage.getHistoryForFile(doc.uri);
            if (history.length > 0) {
                const prev = history[0];
                const prevPath = (await this.storage.getSnapshotUri(prev, doc.uri)).fsPath;
                const diff = await this.gitService.getDiff(prevPath, doc.fileName);
                
                if (diff && diff.trim().length > 0) {
                    magnitude = this.parseMagnitude(diff);
                    if (this.aiService.isEnabled('smartSummaries')) {
                        label = await this.aiService.summarizeDiff(diff);
                    }
                }
            }

            const result = await this.storage.saveSnapshot(
                doc, 
                'save', 
                label, 
                undefined, 
                magnitude.added, 
                magnitude.deleted
            );
            
            if (result) {
                const msg = label ? `Snapshot: ${label}` : `Snapshot: ${relativePath}`;
                vscode.window.setStatusBarMessage(msg, 3000);
            }
        } catch (e) {
            console.error('[HistoryManager] Save failed:', e);
        }
    }

    private parseMagnitude(diff: string): { added: number, deleted: number } {
        let added = 0;
        let deleted = 0;
        const lines = diff.split('\n');
        for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) added++;
            else if (line.startsWith('-') && !line.startsWith('---')) deleted++;
        }
        return { added, deleted };
    }

    public async generateCommitDraft(): Promise<string> {
        if (!vscode.workspace.workspaceFolders) return "";
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const lastCommitTime = await this.gitService.getLastCommitTimestamp(root);
        
        const history = await this.storage.getProjectHistory();
        const recentSnapshots = history.filter(s => s.timestamp > lastCommitTime && s.eventType === 'save');
        
        if (recentSnapshots.length === 0) return "No changes since last commit.";

        const files = new Set(recentSnapshots.map(s => s.filePath));
        let aggregateDiff = "";

        for (const file of files) {
            const fileUri = vscode.Uri.file(path.join(root, file));
            const fileHistory = recentSnapshots.filter(s => s.filePath === file);
            if (fileHistory.length > 0) {
                const oldestInSession = fileHistory[fileHistory.length - 1];
                const startPath = (await this.storage.getSnapshotUri(oldestInSession, fileUri)).fsPath;
                const currentPath = fileUri.fsPath;
                const diff = await this.gitService.getDiff(startPath, currentPath);
                aggregateDiff += `\nFile: ${file}\n${diff}\n`;
            }
        }

        return await this.aiService.generateCommitMessage(aggregateDiff);
    }

    public async semanticSearch(query: string): Promise<Snapshot[]> {
        const snapshots = await this.storage.getProjectHistory();
        const data = snapshots.slice(0, 100).map(s => ({
            id: s.id, 
            label: s.label || s.eventType, 
            path: s.filePath, 
            date: new Date(s.timestamp).toLocaleString() 
        }));
        
        const result = await this.aiService.semanticSearch(query, JSON.stringify(data));
        try {
            const match = result.match(/.*\[.*\].*/s); 
            if (match) {
                const ids = JSON.parse(match[0]);
                return snapshots.filter(s => ids.includes(s.id));
            }
        } catch (e) {}
        return [];
    }

    public clusterSnapshots(snapshots: Snapshot[]): (Snapshot | { type: 'cluster', items: Snapshot[], timestamp: number })[] {
        if (snapshots.length < 2) return snapshots;
        
        const result: (Snapshot | { type: 'cluster', items: Snapshot[], timestamp: number })[] = [];
        let currentCluster: Snapshot[] = [snapshots[0]];
        const WINDOW = 5 * 60 * 1000; 

        for (let i = 1; i < snapshots.length; i++) {
            const prev = snapshots[i-1];
            const curr = snapshots[i];
            
            if (Math.abs(prev.timestamp - curr.timestamp) < WINDOW) {
                currentCluster.push(curr);
            } else {
                if (currentCluster.length > 2) {
                    result.push({ type: 'cluster', items: currentCluster, timestamp: currentCluster[0].timestamp });
                } else {
                    result.push(...currentCluster);
                }
                currentCluster = [curr];
            }
        }
        
        if (currentCluster.length > 2) {
            result.push({ type: 'cluster', items: currentCluster, timestamp: currentCluster[0].timestamp });
        } else {
            result.push(...currentCluster);
        }
        
        return result;
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

    public async putLabel(name: string, description?: string, document?: vscode.TextDocument, filePath?: string) {
        if (!document && filePath) {
            const fileUri = vscode.Uri.file(filePath);
            await this.storage.createLabel(name, description, undefined, fileUri);
        } else {
            await this.storage.createLabel(name, description, document);
        }
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
                } catch {}
            }
            if (!exists) {
                deletedFiles.push(relativePath);
            }
        }
        return deletedFiles;
    }
}