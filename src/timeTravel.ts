import * as vscode from 'vscode';
import * as path from 'path';
import { HistoryStorage } from './storage';
import { HistoryManager } from './historyManager';
import { Snapshot } from './types';

export class ProjectRestorer {
    constructor(
        private storage: HistoryStorage,
        private manager: HistoryManager
    ) {}

    public async restoreProjectState() {
        const snapshots = await this.storage.getProjectHistory();
        if (snapshots.length === 0) {
            vscode.window.showInformationMessage('No history available to restore.');
            return;
        }

        // Create QuickPick Items from snapshots to let user pick a time
        const items = snapshots.map(s => {
            const date = new Date(s.timestamp);
            return {
                label: `$(clock) ${date.toLocaleString()}`,
                description: s.eventType === 'label' ? `Label: ${s.label}` : `${s.eventType} - ${s.filePath}`,
                detail: s.id,
                timestamp: s.timestamp
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a point in time to restore the project to',
            title: 'Restore Project State'
        });

        if (!selected) return;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to restore the ENTIRE project to ${selected.label}? Current changes will be overwritten.`,
            { modal: true },
            'Restore'
        );

        if (confirm !== 'Restore') return;

        await this.performRestore(selected.timestamp);
    }

    private async performRestore(targetTime: number) {
        if (!vscode.workspace.workspaceFolders) return;
        const rootUri = vscode.workspace.workspaceFolders[0].uri;

        const snapshots = await this.storage.getProjectHistory();
        const files = new Set(snapshots.map(s => s.filePath));
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Restoring Project...",
            cancellable: false
        }, async (progress) => {
            let restoredCount = 0;
            const total = files.size;
            
            for (const file of files) {
                if (!file) continue;
                
                // Find latest snapshot for this file <= targetTime
                const fileSnapshots = snapshots
                    .filter(s => s.filePath === file && s.timestamp <= targetTime)
                    .sort((a, b) => b.timestamp - a.timestamp);

                const targetSnapshot = fileSnapshots[0];
                const fileUri = vscode.Uri.joinPath(rootUri, file);

                if (targetSnapshot) {
                    if (targetSnapshot.eventType === 'delete') {
                        // If the last event before targetTime was a delete, ensure file is deleted
                        try {
                            await vscode.workspace.fs.delete(fileUri);
                        } catch (e) {
                            // Ignore if already deleted
                        }
                    } else if (targetSnapshot.storagePath) {
                        // Restore content
                        try {
                            const snapshotUri = await this.storage.getSnapshotUri(targetSnapshot, fileUri);
                            const content = await vscode.workspace.fs.readFile(snapshotUri);
                            
                            // Ensure directory exists
                            const dir = path.dirname(fileUri.fsPath);
                            if (!require('fs').existsSync(dir)) {
                                await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
                            }
                            
                            await vscode.workspace.fs.writeFile(fileUri, content);
                            restoredCount++;
                        } catch (e) {
                            console.error(`Failed to restore ${file}:`, e);
                        }
                    }
                } else {
                    // No snapshot before targetTime exists for this file. 
                    // This implies the file was created AFTER targetTime.
                    // Strictly speaking, we should delete it to match state at T.
                    // However, that might be too destructive. Let's just ignore it or maybe warn?
                    // "Time Travel" usually implies exact state match.
                    // Let's delete it if it exists.
                    try {
                        await vscode.workspace.fs.delete(fileUri);
                    } catch (e) {}
                }
                
                progress.report({ increment: (1 / total) * 100, message: `Restoring ${file}...` });
            }
            
            vscode.window.showInformationMessage(`Project restored to state at ${new Date(targetTime).toLocaleString()}. (${restoredCount} files modified)`);
        });
    }
}
