import * as vscode from 'vscode';
import { GitService } from '../git/gitService';

export class DivergenceProvider {
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    constructor(private gitService: GitService) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.tooltip = 'Line churn since Git HEAD (Uncommitted Work)';
        this.statusBarItem.command = 'chronos.showRecentChanges'; // Or a specific diff command
        
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(() => this.update()),
            vscode.window.onDidChangeActiveTextEditor(() => this.update()),
            this.statusBarItem
        );

        this.update();
    }

    public async update() {
        try {
            const { added, deleted } = await this.gitService.getWorkspaceChurn();
            
            if (added === 0 && deleted === 0) {
                this.statusBarItem.hide();
                return;
            }

            const addedText = added > 0 ? `+${added}` : '';
            const deletedText = deleted > 0 ? `-${deleted}` : '';
            const separator = (added > 0 && deleted > 0) ? ' ' : '';

            this.statusBarItem.text = `$(git-commit) ${addedText}${separator}${deletedText}`;
            this.statusBarItem.show();
        } catch (e) {
            this.statusBarItem.hide();
        }
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
