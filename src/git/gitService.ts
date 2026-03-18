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
            const git = cp.spawn('git', args, { cwd: workspaceFolders[0].uri.fsPath, env: process.env });
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

        const canonicalPath = await this.getCanonicalPath(filePath);
        const range = `${startLine + 1},${endLine + 1}`;
        // Note: hash1 is base, hash2 is target. To see progress forward, hash1 should be the older commit.
        const args = ['-c', 'color.ui=false', 'diff', hash1, hash2, `-L${range}:${canonicalPath}`];
        
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
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath, env: process.env });
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
        const canonicalPath = await this.getCanonicalPath(filePath);

        const args = ['-c', 'color.ui=false', 'log', `-L${range}:${canonicalPath}`];
        
        // Since we are parsing manually, we can't easily limit commits via git args for -L
        // (git log -L doesn't always play nice with -n). We will limit during parsing.

        return new Promise((resolve, reject) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath, env: process.env });
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

    async getHistoryForFile(filePath: string, config: GitHistoryConfig, branch?: string): Promise<GitCommit[]> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) {
            throw new Error('File not in workspace');
        }

        const canonicalPath = await this.getCanonicalPath(filePath);
        const args = ['-c', 'color.ui=false', 'log', '-p', '--follow'];
        if (branch) {
            args.push(branch);
        }
        args.push('--', canonicalPath);
        
        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath, env: process.env });
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
            const git = cp.spawn('git', args, { env: process.env });
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

    async getBranches(cwd: string, filterFilePath?: string): Promise<string[]> {
        try {
            // Get local branches and remote branches, excluding HEAD
            const { stdout } = await this.runGit(['branch', '-a', '--format="%(refname:short)"'], cwd);
            const branches = stdout.split('\n')
                .map(b => b.trim().replace(/^remotes\//, ''))
                .map(b => b.replace(/^"(.*)"$/, '$1')) // Remove quotes if they exist
                .filter(b => b.length > 0 && !b.includes('/HEAD'));

            if (filterFilePath) {
                const canonicalPath = await this.getCanonicalPath(filterFilePath);
                const filtered: string[] = [];
                
                // We check each branch if it has changes for the file compared to current HEAD
                // Using parallel promises for efficiency
                await Promise.all(branches.map(async (branch) => {
                    try {
                        // git rev-list --count HEAD..branch -- file
                        // returns number of commits on 'branch' that are not in HEAD and changed 'file'
                        const { stdout: count } = await this.runGit(['rev-list', '--count', `HEAD..${branch}`, '--', canonicalPath], cwd);
                        if (parseInt(count.trim()) > 0) {
                            filtered.push(branch);
                        }
                    } catch (e) {
                        // If HEAD doesn't exist yet or other git error, we skip filtering for this branch
                    }
                }));
                return filtered;
            }

            return branches;
        } catch (e) {
            return [];
        }
    }

    async getRepoRoot(cwd: string): Promise<string> {
        try {
            const { stdout } = await this.runGit(['rev-parse', '--show-toplevel'], cwd);
            return stdout.trim();
        } catch (e) {
            return cwd;
        }
    }

    async getCanonicalPath(filePath: string, hash?: string): Promise<string> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) return filePath;

        try {
            if (hash) {
                // To find the path at a specific commit, we trace history from HEAD following renames
                const { stdout } = await this.runGit(['log', '--follow', '--name-only', '--format=%H', '--', filePath], workspaceFolder.uri.fsPath);
                
                const lines = stdout.trim().split('\n');
                // The log looks like:
                // <hash1>
                // <empty>
                // <path1>
                // <hash2>
                // ...
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line === hash) {
                        // The path is usually 2 lines below if we have an empty line between hash and path
                        // or 1 line below if it's compact. We find the first non-empty line after this hash.
                        for (let j = i + 1; j < lines.length; j++) {
                            const pathLine = lines[j].trim();
                            if (pathLine.length > 0 && !pathLine.match(/^[0-9a-f]{40}$/)) {
                                return pathLine;
                            }
                            if (pathLine.match(/^[0-9a-f]{40}$/)) break; // Found next commit without path?
                        }
                    }
                }
            }

            const { stdout } = await this.runGit(['ls-files', '--full-name', filePath], workspaceFolder.uri.fsPath);
            return stdout.trim() || path.relative(workspaceFolder.uri.fsPath, filePath).replace(/\\/g, '/');
        } catch (e) {
            return path.relative(workspaceFolder.uri.fsPath, filePath).replace(/\\/g, '/');
        }
    }

    async getRepoPath(filePath: string, hash?: string): Promise<string> {
        return this.getCanonicalPath(filePath, hash);
    }

    async getFileContentFromBranch(branch: string, relativePath: string, cwd: string): Promise<string> {
        // Git expects forward slashes
        const normalizedPath = relativePath.replace(/\\/g, '/');
        try {
            const repoPath = await this.getRepoPath(path.join(cwd, relativePath));
            // First check if file exists on that branch using root-relative path
            const { stdout: exists } = await this.runGit(['ls-tree', '-r', branch, '--name-only', repoPath], cwd);
            if (!exists.trim()) {
                return ''; // File doesn't exist on this branch
            }
            const { stdout } = await this.runGit(['show', `${branch}:${repoPath}`], cwd);
            return stdout;
        } catch (e) {
            console.error(`Failed to get content from branch ${branch}:`, e);
            return ''; 
        }
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
