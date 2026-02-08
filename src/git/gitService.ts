import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import { GitCommit, GitHistoryConfig } from '../types';

export class GitService {
    
    async getWorkspaceChurn(): Promise<{added: number, deleted: number}> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return { added: 0, deleted: 0 };

        const args = ['-c', 'color.ui=false', 'diff', '--shortstat', 'HEAD'];
        
        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolders[0].uri.fsPath });
            let stdout = '';

            git.stdout.on('data', data => stdout += data);
            git.on('error', err => {
                console.warn('Git churn failed to start:', err);
                resolve({ added: 0, deleted: 0 });
            });
            git.on('close', code => {
                if (code !== 0 || !stdout.trim()) {
                    resolve({ added: 0, deleted: 0 });
                    return;
                }
                
                // Example output: " 1 file changed, 5 insertions(+), 3 deletions(-)"
                const addedMatch = stdout.match(/(\d+) insertion/);
                const deletedMatch = stdout.match(/(\d+) deletion/);
                
                resolve({
                    added: addedMatch ? parseInt(addedMatch[1]) : 0,
                    deleted: deletedMatch ? parseInt(deletedMatch[1]) : 0
                });
            });
        });
    }

    async getCommitDiff(hash1: string, hash2: string, filePath: string, startLine: number, endLine: number): Promise<string> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) return "";

        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
        const range = `${startLine + 1},${endLine + 1}`;
        // Note: hash1 is base, hash2 is target. To see progress forward, hash1 should be the older commit.
        const args = ['-c', 'color.ui=false', 'diff', hash1, hash2, `-L${range}:${relativePath}`];
        
        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath });
            let stdout = '';
            git.stdout.on('data', data => stdout += data);
            git.on('error', err => {
                console.warn('Git commit diff failed to start:', err);
                resolve("");
            });
            git.on('close', () => resolve(stdout));
        });
    }

    async getBlame(filePath: string): Promise<Map<number, number>> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) return new Map();

        const args = ['-c', 'color.ui=false', 'blame', '--line-porcelain', filePath];
        
        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath });
            let stdout = '';
            let stderr = '';

            git.stdout.on('data', data => stdout += data);
            git.stderr.on('data', data => stderr += data);

            git.on('error', err => {
                console.warn('Git blame failed to start:', err);
                resolve(new Map());
            });

            git.on('close', code => {
                if (code !== 0) {
                    resolve(new Map());
                    return;
                }
                
                const result = new Map<number, number>();
                const lines = stdout.split('\n');
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    // porcelain format starts with: <hash> <origLine> <finalLine> <groupLines>
                    if (line.match(/^[a-f0-9]{32,40} \d+ \d+ \d+/)) {
                        const parts = line.split(' ');
                        const finalLine = parseInt(parts[2]); // 1-based
                        
                        // Find author-time
                        // It usually follows within the next few lines before the content line (starts with \t)
                        let j = i + 1;
                        while (j < lines.length && !lines[j].startsWith('\t')) {
                            if (lines[j].startsWith('author-time ')) {
                                const timestamp = parseInt(lines[j].substring(12));
                                result.set(finalLine - 1, timestamp * 1000); // Convert to ms
                            }
                            j++;
                        }
                        i = j; // Skip to the content line
                    }
                }
                resolve(result);
            });
        });
    }

    public async runGit(args: string[], cwd: string): Promise<{stdout: string, stderr: string}> {
        return new Promise((resolve, reject) => {
            cp.execFile('git', args, { cwd }, (error, stdout, stderr) => {
                if (error && error.code !== 0 && error.code !== 1) { // git diff returns 1 for differences
                    reject(error);
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
    }

    async getHistoryForSelection(filePath: string, startLine: number, endLine: number, config: GitHistoryConfig): Promise<GitCommit[]> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) {
            throw new Error('File not in workspace');
        }

        // git log -L <start>,<end>:<file>
        // Note: git -L uses 1-based line numbers.
        const range = `${startLine + 1},${endLine + 1}`;
        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

        const args = ['-c', 'color.ui=false', 'log', `-L${range}:${relativePath}`];
        
        // Since we are parsing manually, we can't easily limit commits via git args for -L
        // (git log -L doesn't always play nice with -n). We will limit during parsing.

        return new Promise((resolve, reject) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath });
            let stdout = '';
            let stderr = '';

            git.stdout.on('data', data => stdout += data);
            git.stderr.on('data', data => stderr += data);

            git.on('error', err => {
                console.warn('Git log failed to start:', err);
                resolve([]);
            });

            git.on('close', code => {
                if (code !== 0) {
                    // git log -L can fail if lines are not tracked or file is new.
                    console.warn('Git log -L failed:', stderr);
                    resolve([]); 
                    return;
                }
                resolve(this.parseGitLogL(stdout, config.maxCommits));
            });
        });
    }

    async getHistoryForFile(filePath: string, config: GitHistoryConfig): Promise<GitCommit[]> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) {
            throw new Error('File not in workspace');
        }

        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
        const args = ['-c', 'color.ui=false', 'log', '-p', '--follow', '--', relativePath];
        
        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath });
            let stdout = '';
            let stderr = '';

            git.stdout.on('data', data => stdout += data);
            git.stderr.on('data', data => stderr += data);

            git.on('error', err => {
                console.warn('Git log -p failed to start:', err);
                resolve([]);
            });

            git.on('close', code => {
                if (code !== 0) {
                    console.warn('Git log -p failed:', stderr);
                    resolve([]); 
                    return;
                }
                resolve(this.parseGitLogL(stdout, config.maxCommits));
            });
        });
    }

    async getDiff(file1: string, file2: string): Promise<string> {
        // git diff --no-index <file1> <file2>
        const args = ['-c', 'color.ui=false', 'diff', '--no-index', file1, file2];
        
        return new Promise((resolve, reject) => {
            // We use cwd as the dirname of one of the files or root, doesn't matter much for --no-index
            const git = cp.spawn('git', args);
            let stdout = '';
            let stderr = '';

            git.stdout.on('data', data => stdout += data);
            git.stderr.on('data', data => stderr += data);

            git.on('error', err => {
                console.warn('Git diff failed to start:', err);
                resolve('Error calculating diff.');
            });

            git.on('close', code => {
                // git diff --no-index returns 1 if differences are found, 0 if equal.
                // It returns > 1 on error.
                if (code !== null && code > 1) {
                     console.warn('Git diff failed:', stderr);
                     resolve('Error calculating diff.');
                     return;
                }
                resolve(stdout);
            });
        });
    }

    async getLastCommitTimestamp(cwd: string): Promise<number> {
        return new Promise((resolve) => {
            cp.exec('git log -1 --format=%ct', { cwd }, (err, stdout) => {
                if (err) resolve(0);
                else resolve(parseInt(stdout.trim()) * 1000);
            });
        });
    }

    private parseGitLogL(output: string, maxCommits: number): GitCommit[] {
        const commits: GitCommit[] = [];
        const lines = output.split('\n');
        
        let currentCommit: GitCommit | null = null;
        let captureDiff = false;
        
        for (const line of lines) {
            if (line.startsWith('commit ')) {
                if (currentCommit) {
                    commits.push(currentCommit);
                    if (commits.length >= maxCommits) {
                        return commits;
                    }
                }
                currentCommit = {
                    hash: line.substring(7).trim(),
                    author: '',
                    date: '',
                    message: '',
                    diff: ''
                };
                captureDiff = false;
            } else if (currentCommit) {
                if (line.startsWith('Author: ')) {
                    currentCommit.author = line.substring(8).trim();
                } else if (line.startsWith('Date: ')) {
                    currentCommit.date = line.substring(6).trim();
                } else if (line.startsWith('diff --git')) {
                    captureDiff = true;
                    currentCommit.diff += line + '\n';
                } else if (captureDiff) {
                    currentCommit.diff += line + '\n';
                } else if (!captureDiff && line.trim().length > 0 && !line.startsWith('Author') && !line.startsWith('Date')) {
                     // Message (indented usually)
                     currentCommit.message += line.trim() + ' ';
                }
            }
        }
        if (currentCommit) {
            commits.push(currentCommit);
        }
        
        return commits;
    }
}
