import * as vscode from 'vscode';
import { HistoryStorage } from '../storage';
import { Snapshot } from '../types';

export class ActivityProvider implements vscode.TreeDataProvider<ActivityItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ActivityItem | undefined | null | void> = new vscode.EventEmitter<ActivityItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ActivityItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private storage: HistoryStorage) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ActivityItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ActivityItem): Promise<ActivityItem[]> {
        if (element) return [];

        const snapshots = await this.storage.getProjectHistory();
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recentSnapshots = snapshots.filter(s => s.timestamp > oneDayAgo);

        const counts = new Map<string, number>();
        recentSnapshots.forEach(s => {
            if (s.filePath) {
                counts.set(s.filePath, (counts.get(s.filePath) || 0) + 1);
            }
        });

        const sortedFiles = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1]);

        return sortedFiles.map(([filePath, count]) => new ActivityItem(filePath, count));
    }
}

export class ActivityItem extends vscode.TreeItem {
    constructor(public readonly filePath: string, public readonly count: number) {
        super(filePath, vscode.TreeItemCollapsibleState.None);
        this.description = `${count} changes`;
        this.tooltip = `${filePath}: ${count} snapshots in the last 24h`;
        this.iconPath = new vscode.ThemeIcon('graph');
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [this.getResourceUri()]
        };
    }

    getResourceUri(): vscode.Uri | undefined {
        if (vscode.workspace.workspaceFolders) {
            return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, this.filePath);
        }
        return undefined;
    }
}
