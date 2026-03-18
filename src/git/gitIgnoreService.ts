import * as vscode from 'vscode';
import * as path from 'path';
import { minimatch } from 'minimatch';

export class GitIgnoreService {
    private gitIgnorePatterns: string[] = [];
    private lastGitIgnoreReadTime: number = 0;
    private readonly GITIGNORE_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

    constructor(private outputChannel?: vscode.OutputChannel) {}

    private log(msg: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`[GitIgnoreService] ${msg}`);
        }
    }

    /**
     * Reads .gitignore files from the workspace and updates the patterns.
     * Only re-reads if the last read was beyond the refresh interval or forced.
     */
    public async refreshGitIgnorePatterns(force: boolean = false): Promise<void> {
        if (!force && (Date.now() - this.lastGitIgnoreReadTime < this.GITIGNORE_REFRESH_INTERVAL)) {
            return; // No need to refresh yet
        }

        this.gitIgnorePatterns = [];
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            this.log('No workspace folders found.');
            return;
        }

        for (const folder of vscode.workspace.workspaceFolders) {
            const gitIgnorePath = vscode.Uri.joinPath(folder.uri, '.gitignore');
            try {
                const content = await vscode.workspace.fs.readFile(gitIgnorePath);
                const text = new TextDecoder().decode(content);
                // Corrected regex for splitting lines
                const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));

                // Convert gitignore patterns to minimatch patterns
                // minimatch expects patterns relative to the base, and handles leading /
                // For directory patterns ending with /, minimatch needs specific handling
                const processedLines = lines.map(line => {
                    if (line.startsWith('!')) {
                        // Negation patterns. minimatch handles these with '!' prefix.
                        return line;
                    }
                    if (line.endsWith('/')) {
                        // If a pattern ends with '/', it only matches directories.
                        // minimatch for directory matching needs `foo/**`
                        // or just `foo` if matching `foo/` directly (which we'll handle with options)
                        // For simplicity, for now, we'll just treat it as a file/directory pattern.
                        // A more robust solution might involve checking if path is a directory.
                        return line + '**'; // Match directory and its contents
                    }
                    return line;
                });

                this.gitIgnorePatterns.push(...processedLines);
                this.log(`Loaded .gitignore from ${folder.uri.fsPath}`);

            } catch (error) {
                // .gitignore might not exist, which is fine
                if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                    this.log(`No .gitignore found in ${folder.uri.fsPath}`);
                } else {
                    this.log(`Error reading .gitignore in ${folder.uri.fsPath}: ${error}`);
                }
            }
        }
        this.lastGitIgnoreReadTime = Date.now();
        this.log(`Total .gitignore patterns loaded: ${this.gitIgnorePatterns.length}`);
    }

    /**
     * Checks if a given file path should be ignored based on the loaded .gitignore patterns.
     * @param filePath The absolute path of the file to check.
     * @returns True if the path should be ignored, false otherwise.
     */
    public isPathIgnored(filePath: string): boolean {
        if (this.gitIgnorePatterns.length === 0) {
            return false;
        }

        // We need the path relative to each workspace folder to match .gitignore patterns correctly.
        for (const folder of vscode.workspace.workspaceFolders || []) {
            if (filePath.startsWith(folder.uri.fsPath)) {
                const relativePath = path.relative(folder.uri.fsPath, filePath);
                let ignored = false;
                for (const pattern of this.gitIgnorePatterns) {
                    const isNegation = pattern.startsWith('!');
                    const cleanPattern = isNegation ? pattern.substring(1) : pattern;

                    if (minimatch(relativePath, cleanPattern, { dot: true, matchBase: true })) {
                        if (isNegation) {
                            ignored = false; // Negation pattern un-ignores it
                        } else {
                            ignored = true; // Regular pattern ignores it
                        }
                    }
                }
                if (ignored) {
                    this.log(`Path ${filePath} (relative: ${relativePath}) ignored by .gitignore in ${folder.uri.fsPath}`);
                    return true;
                }
            }
        }
        return false;
    }
    
    /**
     * Clears all loaded gitignore patterns.
     */
    public clearPatterns(): void {
        this.gitIgnorePatterns = [];
        this.lastGitIgnoreReadTime = 0;
        this.log('Gitignore patterns cleared.');
    }
}
