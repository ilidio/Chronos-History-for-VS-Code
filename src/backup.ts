import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as AdmZip from 'adm-zip';
import { HistoryStorage } from './storage';
import { HistoryIndex, Snapshot } from './types';

export class BackupService {
    constructor(private storage: HistoryStorage) {}

    public async exportHistory(destinationPath: string): Promise<void> {
        const rootUri = await this.storage.getWorkspaceStorageRoot();
        const rootPath = rootUri.fsPath;

        if (!fs.existsSync(rootPath)) {
            throw new Error('No history to export.');
        }

        const zip = new AdmZip();
        // Add all files from the storage root to the zip
        zip.addLocalFolder(rootPath);
        
        // Write the zip file
        zip.writeZip(destinationPath);
    }

    public async importHistory(sourcePath: string): Promise<void> {
        const rootUri = await this.storage.getWorkspaceStorageRoot();
        const rootPath = rootUri.fsPath;

        // Ensure root exists
        if (!fs.existsSync(rootPath)) {
            fs.mkdirSync(rootPath, { recursive: true });
        }

        const zip = new AdmZip(sourcePath);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-import-'));

        try {
            zip.extractAllTo(tempDir, true);

            const importIndexUri = vscode.Uri.file(path.join(tempDir, 'index.json'));
            const localIndexUri = vscode.Uri.file(path.join(rootPath, 'index.json'));

            let importedIndex: HistoryIndex = { snapshots: [] };
            let localIndex: HistoryIndex = { snapshots: [] };

            // Read Imported Index
            if (fs.existsSync(importIndexUri.fsPath)) {
                const data = fs.readFileSync(importIndexUri.fsPath, 'utf8');
                importedIndex = JSON.parse(data);
            }

            // Read Local Index
            if (fs.existsSync(localIndexUri.fsPath)) {
                const data = fs.readFileSync(localIndexUri.fsPath, 'utf8');
                localIndex = JSON.parse(data);
            }

            const existingIds = new Set(localIndex.snapshots.map(s => s.id));
            let addedCount = 0;

            for (const snapshot of importedIndex.snapshots) {
                if (!existingIds.has(snapshot.id)) {
                    // Add to index
                    localIndex.snapshots.push(snapshot);
                    existingIds.add(snapshot.id);
                    addedCount++;

                    // Copy snapshot content file
                    if (snapshot.storagePath) {
                        const srcBlob = path.join(tempDir, snapshot.storagePath);
                        const destBlob = path.join(rootPath, snapshot.storagePath);
                        if (fs.existsSync(srcBlob)) {
                            fs.copyFileSync(srcBlob, destBlob);
                        }
                    }
                }
            }

            // Save merged index
            if (addedCount > 0) {
                fs.writeFileSync(localIndexUri.fsPath, JSON.stringify(localIndex, null, 2));
            }

            vscode.window.showInformationMessage(`Import complete. Added ${addedCount} snapshots.`);

        } catch (e) {
            throw new Error(`Import failed: ${e}`);
        } finally {
            // Cleanup temp
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
}
