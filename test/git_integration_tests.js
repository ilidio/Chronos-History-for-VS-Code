/**
 * Git Integration Tests
 * The only suite here that talks to the real git. Everything else runs against
 * hand-written diff fixtures, which proves the logic but not the assumption
 * that git's output looks the way the fixtures say. This one builds a throwaway
 * repository on disk and checks:
 *  - real `git diff -U0` output driving the content-anchored filter
 *  - real `git log -L`, including the -n limit
 *  - real fatal messages reaching the right classification
 *  - real uncommitted changes mapping a buffer range onto HEAD
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const { mockVscode } = require('./mock_vscode_real_fs');

// Only vscode is mocked: child_process stays real, which is the whole point.
Module.prototype.require = function(request) {
    if (request === 'vscode') return mockVscode;
    return originalRequire.apply(this, arguments);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) {
        console.log(`  ✅ ${msg}`);
        passed++;
    } else {
        console.error(`  ❌ ${msg}`);
        failed++;
    }
}

function assertEqual(actual, expected, msg) {
    if (actual === expected) {
        console.log(`  ✅ ${msg} (${actual})`);
        passed++;
    } else {
        console.error(`  ❌ ${msg} — expected ${expected}, got ${actual}`);
        failed++;
    }
}

const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Chronos Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Chronos Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null'
};

function git(repo, args) {
    return cp.execFileSync('git', args, { cwd: repo, env: GIT_ENV, encoding: 'utf8' });
}

function write(file, lines) {
    fs.writeFileSync(file, lines.join('\n') + '\n');
}

/** A whole-line selection, in the shape HistoryFilter reads. */
function selection(startLine, endLine) {
    return {
        start: { line: startLine, character: 0 },
        end: { line: endLine, character: 1 }
    };
}

const FOO = 'function foo() {';

// ─── Tests ───────────────────────────────────────────────────────────────────
async function runGitIntegrationTests() {
    console.log('\n--- Starting Git Integration Tests ---\n');

    try {
        cp.execFileSync('git', ['--version'], { encoding: 'utf8' });
    } catch (e) {
        console.log('  ⚠️  git is not available; skipping the integration suite.');
        return;
    }

    const { GitService, classifyGitRangeFailure } = require('../out/git/gitService');
    const { HistoryFilter } = require('../out/historyFilter');
    const { parseHunks, mapRangeBackwards } = require('../out/utils/rangeMapper');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-int-'));
    const repo = path.join(root, 'repo');
    const snapshots = path.join(root, 'snapshots');
    fs.mkdirSync(repo);
    fs.mkdirSync(snapshots);

    // The real GitService runs git in the workspace folder, so point the mock
    // at the throwaway repository.
    const repoUri = mockVscode.Uri.file(repo);
    mockVscode.workspace.workspaceFolders = [{ uri: repoUri }];
    mockVscode.workspace.getWorkspaceFolder = () => ({ uri: repoUri, name: 'repo', index: 0 });

    const gitService = new GitService();
    const CONFIG = { maxCommits: 100, followRenames: true, dateFormat: 'yyyy-MM-dd HH:mm' };

    try {
        // ── Section 1: real diffs driving the anchored filter ────────────────
        console.log('[Test 1] A block that moved is re-found through real git diff output');

        // Three snapshots on disk, exactly as storage keeps them: plain copies.
        //
        // The neighbourhood is deliberately larger than the block. Git's diff
        // moves whichever side is cheaper to rewrite, so a 3-line block next to
        // 2 lines comes out as "the 2 lines moved", leaving the block as
        // untouched context that positional tracking follows just fine. Only
        // when the block is the smaller side does git describe the block itself
        // as deleted and re-added — which is the case that defeats line
        // arithmetic, and the one worth testing.
        const neighbourhood = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'];
        const snapC = ['header', FOO, '    body', '}', ...neighbourhood, 'tail'];
        const snapB = ['header', ...neighbourhood, FOO, '    body', '}', 'tail'];
        const snapA = ['header', ...neighbourhood, FOO, '    old body', '}', 'tail'];

        write(path.join(snapshots, 'snap-c'), snapC);
        write(path.join(snapshots, 'snap-b'), snapB);
        write(path.join(snapshots, 'snap-a'), snapA);

        const workingFile = path.join(repo, 'target.ts');
        write(workingFile, snapC);

        const index = [
            { id: 'snap-c', timestamp: 3000, filePath: 'target.ts', eventType: 'save', storagePath: 'snap-c' },
            { id: 'snap-b', timestamp: 2000, filePath: 'target.ts', eventType: 'save', storagePath: 'snap-b' },
            { id: 'snap-a', timestamp: 1000, filePath: 'target.ts', eventType: 'save', storagePath: 'snap-a' }
        ];

        const storage = {
            getSnapshotUri: async (snapshot) => mockVscode.Uri.file(path.join(snapshots, snapshot.storagePath))
        };
        const filter = new HistoryFilter(storage, gitService);

        const result = await filter.filterHistoryForSelection(
            index, mockVscode.Uri.file(workingFile), selection(1, 3), { signatureLine: FOO }
        );

        assertEqual(result.length, 3, 'every snapshot holding the block is on the trail');
        assertEqual(result.map(s => s.id).join(','), 'snap-c,snap-b,snap-a', 'ordered newest to oldest');

        // The assertion that matters: the range must land on the lines that
        // actually hold the block in each snapshot, whatever shape git chose
        // for the diff.
        for (const entry of result) {
            const lines = fs.readFileSync(path.join(snapshots, entry.storagePath), 'utf8').split('\n');
            assertEqual(
                lines[entry.relevantRange.start].trim(), FOO,
                `${entry.id}'s range starts on the block's signature line`
            );
        }
        assertEqual(result[1].rangeAnchoring, 'content', 'the moved block was re-found by content');
        assertEqual(result[1].relevantRange.end - result[1].relevantRange.start, 2, 'and keeps the tracked height');

        console.log('\n[Test 2] Without an anchor, real diffs lose the moved block');
        const unanchored = await new HistoryFilter(storage, gitService).filterHistoryForSelection(
            index, mockVscode.Uri.file(workingFile), selection(1, 3)
        );
        // The range drifts off the block, so the diff that changed the block no
        // longer intersects it: the snapshot where it changed never makes the
        // list at all.
        assertEqual(
            unanchored.find(s => s.id === 'snap-b'), undefined,
            'the snapshot where the block changed drops out of the timeline'
        );
        assert(unanchored.length < result.length, 'fewer snapshots are found than with an anchor');

        const strayOldest = unanchored.find(s => s.id === 'snap-a');
        const snapALines = fs.readFileSync(path.join(snapshots, 'snap-a'), 'utf8').split('\n');
        assert(
            snapALines[strayOldest.relevantRange.start].trim() !== FOO,
            'and the range it kept following is no longer the block'
        );

        // ── Section 2: real git log -L ───────────────────────────────────────
        console.log('\n[Test 3] Real git log -L finds the commits that touched the lines');
        git(repo, ['-c', 'init.defaultBranch=main', 'init', '-q']);

        const tracked = path.join(repo, 'tracked.ts');
        write(tracked, ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']);
        git(repo, ['add', 'tracked.ts']);
        git(repo, ['commit', '-q', '-m', 'first']);

        write(tracked, ['one', 'two', 'THREE', 'four', 'five', 'six', 'seven', 'eight']);
        git(repo, ['commit', '-q', '-am', 'second: touch line 3']);

        write(tracked, ['one', 'two', 'THREE!', 'four', 'five', 'six', 'seven', 'eight']);
        git(repo, ['commit', '-q', '-am', 'third: touch line 3 again']);

        write(tracked, ['one', 'two', 'THREE!', 'four', 'five', 'six', 'seven', 'EIGHT']);
        git(repo, ['commit', '-q', '-am', 'fourth: touch line 8 only']);

        let history = await gitService.getHistoryForSelection(tracked, 2, 2, CONFIG);
        assertEqual(history.failure, undefined, 'no failure is reported');
        assertEqual(history.commits.length, 3, 'the three commits that created or changed line 3');
        assert(
            !history.commits.some(c => c.message.includes('line 8 only')),
            'the commit that only touched line 8 is left out'
        );

        console.log('\n[Test 4] The -n limit is honoured by real git');
        history = await gitService.getHistoryForSelection(tracked, 2, 2, { ...CONFIG, maxCommits: 2 });
        assertEqual(history.commits.length, 2, 'only the requested number of commits comes back');

        // ── Section 3: real fatal messages ───────────────────────────────────
        console.log('\n[Test 5] A real uncommitted file is reported as not tracked');
        const untracked = path.join(repo, 'untracked.ts');
        write(untracked, ['brand', 'new', 'file']);
        history = await gitService.getHistoryForSelection(untracked, 0, 2, CONFIG);
        assert(!!history.failure, 'a failure is reported');
        assertEqual(history.failure.reason, 'not-tracked', 'with the reason read from real stderr');
        assert(history.failure.detail.length > 0, 'and git\'s own words are kept');
        console.log(`     git said: ${history.failure.detail.split('\n')[0]}`);

        console.log('\n[Test 6] A real range past the end of the committed file is reported as such');
        history = await gitService.getHistoryForSelection(tracked, 5000, 5001, CONFIG);
        assert(!!history.failure, 'a failure is reported');
        assertEqual(history.failure.reason, 'bad-range', 'with the bad-range reason');
        console.log(`     git said: ${history.failure.detail.split('\n')[0]}`);

        console.log('\n[Test 7] A real repository with no commits is reported as such');
        const emptyRepo = path.join(root, 'empty');
        fs.mkdirSync(emptyRepo);
        git(emptyRepo, ['-c', 'init.defaultBranch=main', 'init', '-q']);
        const emptyFile = path.join(emptyRepo, 'nothing.ts');
        write(emptyFile, ['a', 'b']);

        const emptyUri = mockVscode.Uri.file(emptyRepo);
        mockVscode.workspace.getWorkspaceFolder = () => ({ uri: emptyUri, name: 'empty', index: 0 });
        history = await gitService.getHistoryForSelection(emptyFile, 0, 1, CONFIG);
        mockVscode.workspace.getWorkspaceFolder = () => ({ uri: repoUri, name: 'repo', index: 0 });

        assertEqual(history.failure && history.failure.reason, 'no-commits', 'the empty repository is recognised');
        console.log(`     git said: ${history.failure.detail.split('\n')[0]}`);

        // ── Section 4: real uncommitted changes mapped onto HEAD ─────────────
        console.log('\n[Test 8] Real uncommitted changes map a buffer range onto HEAD');
        const committed = fs.readFileSync(tracked, 'utf8').split('\n').filter(l => l.length > 0);
        write(tracked, ['added one', 'added two', 'added three', ...committed]);

        const hunks = parseHunks(await gitService.getUncommittedHunks(tracked));
        assert(hunks.length > 0, 'the uncommitted diff produced hunks');

        // "EIGHT" sat on line 8 (index 7) before the three lines were prepended.
        const buffer = fs.readFileSync(tracked, 'utf8').split('\n');
        const bufferLine = buffer.findIndex(l => l.includes('EIGHT'));
        const mapped = mapRangeBackwards({ startLine: bufferLine, endLine: bufferLine }, hunks);
        assertEqual(bufferLine, 10, 'the line sits at index 10 in the buffer');
        assertEqual(mapped.startLine, 7, 'and at index 7 in HEAD');

        const headLines = git(repo, ['show', 'HEAD:tracked.ts']).split('\n');
        assertEqual(headLines[mapped.startLine].includes('EIGHT'), true, 'which is where HEAD really holds it');

        console.log('\n[Test 9] A clean file produces no hunks to map');
        git(repo, ['commit', '-q', '-am', 'fifth: commit the prepended lines']);
        const clean = parseHunks(await gitService.getUncommittedHunks(tracked));
        assertEqual(clean.length, 0, 'nothing to map once the tree is clean');

        console.log('\n[Test 10] The classifier agrees with real stderr, not just fixtures');
        try {
            git(repo, ['log', '-L1,5:untracked.ts']);
            assert(false, 'git should have failed on the untracked path');
        } catch (e) {
            const stderr = String(e.stderr || '');
            assertEqual(
                classifyGitRangeFailure(stderr, 'untracked.ts').reason,
                'not-tracked', 'the real stderr classifies as not-tracked'
            );
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log(`\n--- Git Integration Tests: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exit(1);
}

runGitIntegrationTests().catch(e => {
    console.error('Test suite error:', e);
    process.exit(1);
});
