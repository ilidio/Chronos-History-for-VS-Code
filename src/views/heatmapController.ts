import * as vscode from 'vscode';
import { GitService } from '../git/gitService';

export class HeatmapController {
    private enabled = false;
    private hotDecoration: vscode.TextEditorDecorationType;
    private warmDecoration: vscode.TextEditorDecorationType;
    private lukewarmDecoration: vscode.TextEditorDecorationType;
    private disposables: vscode.Disposable[] = [];

    constructor(private gitService: GitService) {
        this.hotDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 0, 0, 0.15)',
            overviewRulerColor: 'rgba(255, 0, 0, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            isWholeLine: true
        });

        this.warmDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 165, 0, 0.1)',
            overviewRulerColor: 'rgba(255, 165, 0, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            isWholeLine: true
        });

        this.lukewarmDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.05)',
            overviewRulerColor: 'rgba(255, 255, 0, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            isWholeLine: true
        });
    }

    public toggle() {
        this.enabled = !this.enabled;
        if (this.enabled) {
            this.update();
            this.disposables.push(
                vscode.window.onDidChangeActiveTextEditor(() => this.update()),
                vscode.workspace.onDidSaveTextDocument(() => this.update())
            );
            vscode.window.showInformationMessage('Code Heatmap: Enabled (Red < 24h, Orange < 1w, Yellow < 1m)');
        } else {
            this.clear();
            this.disposables.forEach(d => d.dispose());
            this.disposables = [];
            vscode.window.showInformationMessage('Code Heatmap: Disabled');
        }
    }

    private clear() {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.setDecorations(this.hotDecoration, []);
            editor.setDecorations(this.warmDecoration, []);
            editor.setDecorations(this.lukewarmDecoration, []);
        }
    }

    private async update() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.enabled) return;

        const blame = await this.gitService.getBlame(editor.document.uri.fsPath);
        if (blame.size === 0) return;

        const now = Date.now();
        const hotRanges: vscode.DecorationOptions[] = [];
        const warmRanges: vscode.DecorationOptions[] = [];
        const lukewarmRanges: vscode.DecorationOptions[] = [];

        const ONE_DAY = 24 * 60 * 60 * 1000;
        const ONE_WEEK = 7 * ONE_DAY;
        const ONE_MONTH = 30 * ONE_DAY;

        for (const [line, timestamp] of blame) {
            if (line >= editor.document.lineCount) continue;
            
            const age = now - timestamp;
            const range = new vscode.Range(line, 0, line, 0);
            const hoverMessage = `Last modified: ${new Date(timestamp).toLocaleDateString()}`;

            if (age < ONE_DAY) {
                hotRanges.push({ range, hoverMessage });
            } else if (age < ONE_WEEK) {
                warmRanges.push({ range, hoverMessage });
            } else if (age < ONE_MONTH) {
                lukewarmRanges.push({ range, hoverMessage });
            }
        }

        editor.setDecorations(this.hotDecoration, hotRanges);
        editor.setDecorations(this.warmDecoration, warmRanges);
        editor.setDecorations(this.lukewarmDecoration, lukewarmRanges);
    }

    public dispose() {
        this.clear();
        this.hotDecoration.dispose();
        this.warmDecoration.dispose();
        this.lukewarmDecoration.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
