import * as vscode from 'vscode';
import { HistoryManager } from '../historyManager';
import { HistoryStorage } from '../storage';

export class DeletedFilesProvider implements vscode.TreeDataProvider<DeletedFileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DeletedFileItem | undefined | null | void> = new vscode.EventEmitter<DeletedFileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DeletedFileItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private manager: HistoryManager, private storage: HistoryStorage) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DeletedFileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: DeletedFileItem): Promise<DeletedFileItem[]> {
        if (element) {
            return []; // Flat list
        }

        const deletedFiles = await this.manager.getDeletedFiles();
        return deletedFiles.map(filePath => new DeletedFileItem(filePath));
    }
}

export class DeletedFileItem extends vscode.TreeItem {
    constructor(public readonly filePath: string) {
        super(filePath, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `Deleted File: ${filePath}`;
        this.description = 'Deleted';
        this.iconPath = new vscode.ThemeIcon('trash');
        this.contextValue = 'deletedFile';
        this.command = {
            command: 'chronos.previewDeletedFile',
            title: 'Preview',
            arguments: [this.filePath]
        };
    }
}
