import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GitCommit, GitHistoryConfig, GitRangeFailure, GitRangeHistory } from '../types';
import { hunkNewRange, parseHunks } from '../utils/rangeMapper';

/**
 * Turns git's stderr into something that can be shown to the user. The strings
 * matched here are git's own fatal messages, which is the only signal it gives
 * for these cases.
 */
export function classifyGitRangeFailure(stderr: string, fileName: string): GitRangeFailure {
    const detail = (stderr || '').trim();

    if (/does not have any commits yet/i.test(detail)) {
        return { reason: 'no-commits', message: 'This repository has no commits yet, so there is no line history to show.', detail };
    }
    if (/there is no path|no such path|exists on disk, but not in/i.test(detail)) {
        return { reason: 'not-tracked', message: `${fileName} is not committed yet, so Git has no history for these lines.`, detail };
    }
    if (/has only \d+ lines/i.test(detail)) {
        return { reason: 'bad-range', message: `Those lines do not exist in the committed version of ${fileName}.`, detail };
    }
    if (/not a git repository/i.test(detail)) {
        return { reason: 'no-repo', message: `${fileName} is not inside a Git repository.`, detail };
    }

    return { reason: 'unknown', message: `Git could not read the line history for ${fileName}.`, detail };
}

/**
 * Records where a commit's own change sits, in that commit's line numbers.
 *
 * `git log -L` prints a hunk header per commit, and those numbers are the only
 * ones that mean anything inside that version of the file — a range taken from
 * HEAD, or from the editor, does not apply to a commit from last year. Without
 * this, anything wanting to reveal the change has nothing accurate to aim at.
 */
function withCommitRange(commit: GitCommit): GitCommit {
    const hunks = parseHunks(commit.diff);
    if (hunks.length === 0) return commit;

    const range = hunkNewRange(hunks[0]);
    return { ...commit, relevantRange: { start: range.startLine, end: range.endLine } };
}

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
        const rangeArgs = (startLine === -1 && endLine === -1) ? [] : [`-L${startLine + 1},${endLine + 1}:${canonicalPath}`];
        const args = ['-c', 'color.ui=false', 'diff', hash1, hash2, '--unified=1000', ...rangeArgs];
        if (rangeArgs.length === 0) args.push('--', canonicalPath);
        
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

    async getHistoryForSelection(filePath: string, startLine: number, endLine: number, config: GitHistoryConfig): Promise<GitRangeHistory> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) {
            throw new Error('File not in workspace');
        }

        // git log -L <start>,<end>:<file>
        // Note: git -L uses 1-based line numbers.
        const range = `${startLine + 1},${endLine + 1}`;
        const canonicalPath = await this.getCanonicalPath(filePath);
        const limit = Math.max(1, config.maxCommits);

        // -L does honour -n, so the walk stops at the limit instead of producing
        // history we would only throw away while parsing.
        const args = ['-c', 'color.ui=false', 'log', `-n${limit}`, `-L${range}:${canonicalPath}`];
        const fileName = path.basename(filePath);

        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath, env: process.env });
            let stdout = '';
            let stderr = '';

            git.stdout.on('data', data => stdout += data);
            git.stderr.on('data', data => stderr += data);

            git.on('error', err => {
                console.warn('Git log failed to start:', err);
                resolve({
                    commits: [],
                    failure: {
                        reason: 'git-missing',
                        message: 'Git could not be started. Is it installed and on your PATH?',
                        detail: String(err)
                    }
                });
            });

            git.on('close', code => {
                if (code !== 0) {
                    // Distinguish "git could not answer" from "there is no history
                    // here": the two look identical to the caller otherwise.
                    const failure = classifyGitRangeFailure(stderr, fileName);
                    console.warn(`Git log -L failed (${failure.reason}):`, stderr);
                    resolve({ commits: [], failure });
                    return;
                }
                resolve({ commits: this.parseGitLogL(stdout, limit) });
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

    /**
     * Finds every time a specific symbol or text was changed in the file history.
     * Uses 'git log -G' to find patches that contain the pattern.
     */
    async getHistoryBySearch(filePath: string, pattern: string, config: GitHistoryConfig): Promise<GitCommit[]> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) return [];

        const canonicalPath = await this.getCanonicalPath(filePath);
        // -G looks for patches that match the regex. -p shows the patch.
        const limit = Math.max(1, config.maxCommits);
        const args = ['-c', 'color.ui=false', 'log', '-p', `-n${limit}`, `-G${pattern}`, '--', canonicalPath];

        return this.runLogSearch(args, workspaceFolder.uri.fsPath, limit, '-G');
    }

    /**
     * Finds occurrences of a string adding or removing in the history.
     * Uses 'git log -S' (pickaxe).
     */
    async getHistoryBySymbol(filePath: string, symbol: string, config: GitHistoryConfig): Promise<GitCommit[]> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) return [];

        const canonicalPath = await this.getCanonicalPath(filePath);
        const limit = Math.max(1, config.maxCommits);
        const args = ['-c', 'color.ui=false', 'log', '-p', `-n${limit}`, `-S${symbol}`, '--', canonicalPath];

        return this.runLogSearch(args, workspaceFolder.uri.fsPath, limit, '-S');
    }

    /**
     * Runs a `git log` search and parses it. A failure here is not worth a
     * message of its own: these searches are fallbacks, so an empty result is
     * the right answer for the caller.
     */
    private runLogSearch(args: string[], cwd: string, limit: number, label: string): Promise<GitCommit[]> {
        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { cwd, env: process.env });
            let stdout = '';
            let stderr = '';

            git.stdout.on('data', data => stdout += data);
            git.stderr.on('data', data => stderr += data);

            // Without this listener a failure to spawn git throws instead of
            // resolving.
            git.on('error', err => {
                console.warn(`Git log ${label} failed to start:`, err);
                resolve([]);
            });

            git.on('close', code => {
                if (code !== 0) {
                    console.warn(`Git log ${label} failed:`, stderr);
                    resolve([]);
                    return;
                }
                resolve(this.parseGitLogL(stdout, limit));
            });
        });
    }

    /**
     * Hunk headers only (-U0) for two files on disk.
     *
     * Range tracking needs nothing but the @@ headers, so it must not pay for
     * the full file context that getDiff produces for display.
     */
    async getHunks(file1: string, file2: string): Promise<string> {
        const args = ['-c', 'color.ui=false', 'diff', '--unified=0', '--no-index', file1, file2];

        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { env: process.env });
            let stdout = '';
            let stderr = '';

            git.stdout.on('data', data => stdout += data);
            git.stderr.on('data', data => stderr += data);

            git.on('error', err => {
                console.warn('Git diff (hunks) failed to start:', err);
                resolve('');
            });

            git.on('close', code => {
                // --no-index returns 1 when the files differ, >1 on error.
                if (code !== null && code > 1) {
                    console.warn('Git diff (hunks) failed:', stderr);
                    resolve('');
                    return;
                }
                resolve(stdout);
            });
        });
    }

    /**
     * Hunk headers (-U0) between HEAD and the text the editor is showing.
     *
     * `getUncommittedHunks` compares HEAD with the file on disk, which is blind
     * to edits that have not been saved yet: a selection made in a dirty buffer
     * would then be resolved against lines that have already moved, and
     * `git log -L` would answer about whatever HEAD happens to hold there. The
     * buffer's own text is diffed against HEAD instead, so the mapping sees
     * exactly what the user sees.
     *
     * Returns no hunks when the file is not in HEAD — there is nothing to map a
     * range onto, and `getHistoryForSelection` reports that case itself.
     */
    async getUncommittedHunksForText(filePath: string, bufferText: string): Promise<string> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) return '';
        const cwd = workspaceFolder.uri.fsPath;

        let headContent: string;
        try {
            const canonicalPath = await this.getCanonicalPath(filePath);
            const { stdout, stderr } = await this.runGit(['show', `HEAD:${canonicalPath}`], cwd);
            if (!stdout && stderr) {
                console.warn('Git show HEAD failed:', stderr);
                return '';
            }
            headContent = stdout;
        } catch (e) {
            // Not in HEAD at all (a new file), or not a repository.
            return '';
        }

        // git compares files, so both sides have to be files. They are written
        // to a directory of their own and removed again straight away.
        let dir: string | undefined;
        try {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-buffer-'));
            const base = path.basename(filePath);
            const headFile = path.join(dir, `head-${base}`);
            const bufferFile = path.join(dir, `buffer-${base}`);
            fs.writeFileSync(headFile, headContent);
            fs.writeFileSync(bufferFile, bufferText);
            return await this.getHunks(headFile, bufferFile);
        } catch (e) {
            console.warn('Git diff (buffer hunks) failed:', e);
            return '';
        } finally {
            if (dir) {
                try {
                    fs.rmSync(dir, { recursive: true, force: true });
                } catch (e) {
                    console.warn('Could not remove the temporary buffer diff directory:', e);
                }
            }
        }
    }

    /**
     * Hunk headers (-U0) between HEAD and the working tree for one file.
     *
     * Line numbers taken from the editor describe the buffer, but `git log -L`
     * resolves them against HEAD. These hunks let a caller translate between
     * the two.
     */
    async getUncommittedHunks(filePath: string): Promise<string> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) return '';

        const canonicalPath = await this.getCanonicalPath(filePath);
        const args = ['-c', 'color.ui=false', 'diff', '--unified=0', 'HEAD', '--', canonicalPath];

        return new Promise((resolve) => {
            const git = cp.spawn('git', args, { cwd: workspaceFolder.uri.fsPath, env: process.env });
            let stdout = '';
            let stderr = '';

            git.stdout.on('data', data => stdout += data);
            git.stderr.on('data', data => stderr += data);

            git.on('error', err => {
                console.warn('Git diff HEAD failed to start:', err);
                resolve('');
            });

            git.on('close', code => {
                if (code !== 0) {
                    // No HEAD yet, or the file is untracked: nothing to map.
                    console.warn('Git diff HEAD failed:', stderr);
                    resolve('');
                    return;
                }
                resolve(stdout);
            });
        });
    }

    async getDiff(file1: string, file2: string): Promise<string> {
        // git diff --no-index <file1> <file2>
        const args = ['-c', 'color.ui=false', 'diff', '--unified=999999', '--no-index', file1, file2];
        
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
                    commits.push(withCommitRange(currentCommit));
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
        if (currentCommit && commits.length < maxCommits) {
            commits.push(withCommitRange(currentCommit));
        }
        
        return commits;
    }
}
