import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import { GitCommit, GitHistoryConfig } from '../types';

export class GitService {
    
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
