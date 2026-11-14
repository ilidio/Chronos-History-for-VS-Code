/**
 * Git Range Failure Tests
 * Covers the failure modes of the `git log -L` path:
 *  - a git failure is reported as such, not as "no history"
 *  - each of git's fatal messages maps to a sentence the user can act on
 *  - the commit limit reaches git instead of being applied after the walk
 *  - a named block falls back to the pickaxe (-S), then to -G
 *  - the pickaxe searches survive git failing to start
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
const { mockVscode, commandsMap } = require('./mock_vscode');
const EventEmitter = require('events');

// ─── Mock child_process ──────────────────────────────────────────────────────
const gitCalls = [];
let logResult = { code: 0, stdout: '', stderr: '' };
let symbolResult = { code: 0, stdout: '' };
let searchResult = { code: 0, stdout: '' };
let failToSpawn = false;

const argStartingWith = (args, prefix) => args.find(a => String(a).startsWith(prefix));

const mockSpawn = (cmd, args, opts) => {
    gitCalls.push(args);
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    setTimeout(() => {
        if (failToSpawn) {
            proc.emit('error', new Error('spawn git ENOENT'));
            return;
        }

        let result = { code: 0, stdout: '', stderr: '' };
        if (argStartingWith(args, '-L')) result = logResult;
        else if (argStartingWith(args, '-S')) result = symbolResult;
        else if (argStartingWith(args, '-G')) result = searchResult;

        if (result.stdout) proc.stdout.emit('data', result.stdout);
        if (result.stderr) proc.stderr.emit('data', result.stderr);
        proc.emit('close', result.code ?? 0);
    }, 1);

    return proc;
};

Module.prototype.require = function(request) {
    if (request === 'vscode') return mockVscode;
    if (request === 'child_process') {
        return {
            spawn: mockSpawn,
            execFile: (cmd, args, opts, cb) => cb(null, '', ''),
            exec: (cmd, opts, cb) => cb(null, '', '')
        };
    }
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

const FILE = '/workspace/target.ts';
const CONFIG = { maxCommits: 100, followRenames: true, dateFormat: 'yyyy-MM-dd HH:mm' };

function commitLog(hash, message) {
    return `commit ${hash}\nAuthor: Me\nDate: 2024-01-01\n    ${message}\n`;
}

function reset() {
    gitCalls.length = 0;
    logResult = { code: 0, stdout: '', stderr: '' };
    symbolResult = { code: 0, stdout: '' };
    searchResult = { code: 0, stdout: '' };
    failToSpawn = false;
}

// ─── Tests ───────────────────────────────────────────────────────────────────
async function runGitRangeFailureTests() {
    console.log('\n--- Starting Git Range Failure Tests ---\n');

    const { GitService, classifyGitRangeFailure } = require('../out/git/gitService');
    const git = new GitService();

    // ── Section 1: git's fatal messages become sentences ─────────────────────
    console.log('[Test 1] Each fatal message maps to a reason');
    assertEqual(
        classifyGitRangeFailure("fatal: There is no path target.ts in the commit", 'target.ts').reason,
        'not-tracked', 'an uncommitted file is reported as not tracked'
    );
    assertEqual(
        classifyGitRangeFailure("fatal: your current branch 'main' does not have any commits yet", 'target.ts').reason,
        'no-commits', 'an empty repository is reported as having no commits'
    );
    assertEqual(
        classifyGitRangeFailure('fatal: file target.ts has only 213 lines', 'target.ts').reason,
        'bad-range', 'a range past the end of the committed file is reported as a bad range'
    );
    assertEqual(
        classifyGitRangeFailure('fatal: not a git repository (or any of the parent directories): .git', 'target.ts').reason,
        'no-repo', 'a file outside a repository is reported as such'
    );
    assertEqual(
        classifyGitRangeFailure('fatal: something nobody has seen before', 'target.ts').reason,
        'unknown', 'anything else is reported as unknown'
    );
    const notTracked = classifyGitRangeFailure('fatal: There is no path target.ts in the commit', 'target.ts');
    assert(notTracked.message.includes('target.ts'), 'the message names the file');
    assert(notTracked.detail.includes('There is no path'), 'the raw stderr is kept for the log');

    // ── Section 2: failures are not reported as emptiness ────────────────────
    console.log('\n[Test 2] A failing git log -L returns a failure, not an empty history');
    reset();
    logResult = { code: 128, stdout: '', stderr: 'fatal: There is no path target.ts in the commit\n' };
    let history = await git.getHistoryForSelection(FILE, 0, 5, CONFIG);
    assertEqual(history.commits.length, 0, 'no commits are returned');
    assert(!!history.failure, 'a failure is reported');
    assertEqual(history.failure.reason, 'not-tracked', 'with the reason git gave');

    console.log('\n[Test 3] Git failing to start is reported too');
    reset();
    failToSpawn = true;
    history = await git.getHistoryForSelection(FILE, 0, 5, CONFIG);
    assertEqual(history.failure && history.failure.reason, 'git-missing', 'the reason says git could not start');

    console.log('\n[Test 4] An empty answer from a successful run is not a failure');
    reset();
    history = await git.getHistoryForSelection(FILE, 0, 5, CONFIG);
    assertEqual(history.commits.length, 0, 'no commits are returned');
    assertEqual(history.failure, undefined, 'and no failure is invented');

    // ── Section 3: the commit limit reaches git ──────────────────────────────
    console.log('\n[Test 5] The commit limit is passed to git, not applied afterwards');
    reset();
    logResult = { code: 0, stdout: commitLog('aaa1111', 'one') + commitLog('bbb2222', 'two'), stderr: '' };
    history = await git.getHistoryForSelection(FILE, 0, 5, { ...CONFIG, maxCommits: 1 });
    const logCall = gitCalls.find(args => argStartingWith(args, '-L'));
    assertEqual(argStartingWith(logCall, '-n'), '-n1', 'git is asked for one commit');
    assertEqual(history.commits.length, 1, 'and the parser does not overshoot the limit either');

    console.log('\n[Test 6] The pickaxe searches are limited the same way');
    reset();
    symbolResult = { code: 0, stdout: commitLog('ccc3333', 'added render') };
    await git.getHistoryBySymbol(FILE, 'render', { ...CONFIG, maxCommits: 7 });
    const symbolCall = gitCalls.find(args => argStartingWith(args, '-S'));
    assertEqual(argStartingWith(symbolCall, '-n'), '-n7', 'the limit reaches git');

    console.log('\n[Test 7] A pickaxe search survives git failing to start');
    reset();
    failToSpawn = true;
    const resilient = await git.getHistoryBySymbol(FILE, 'render', CONFIG);
    assertEqual(resilient.length, 0, 'it resolves empty instead of throwing');

    // ── Section 4: the command surfaces all of this ──────────────────────────
    console.log('\n[Test 8] The command warns the user when git could not answer');
    const extension = require('../out/extension');
    extension.activate(new mockVscode.ExtensionContext());

    const warnings = [];
    const statusMessages = [];
    const originalWarning = mockVscode.window.showWarningMessage;
    const originalStatus = mockVscode.window.setStatusBarMessage;
    mockVscode.window.showWarningMessage = (msg) => { warnings.push(String(msg)); };
    mockVscode.window.setStatusBarMessage = (msg) => { statusMessages.push(String(msg)); };

    const selection = new mockVscode.Range(10, 0, 12, 5);
    selection.active = new mockVscode.Position(12, 5);
    mockVscode.window.activeTextEditor = {
        document: {
            uri: mockVscode.Uri.file(FILE),
            lineCount: 40,
            getText: () => Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
        },
        selection
    };

    try {
        reset();
        logResult = { code: 128, stdout: '', stderr: 'fatal: There is no path target.ts in the commit\n' };
        await commandsMap.get('chronos.gitHistoryForSelection')();
        await new Promise(r => setTimeout(r, 60));

        assertEqual(warnings.length, 1, 'one warning is shown');
        assert(warnings[0].includes('not committed yet'), 'and it explains why there is no history');
        assert(!statusMessages.some(m => m.includes('no git history')), 'the misleading "no git history" message is not shown');

        // ── Section 5: the symbol fallback ───────────────────────────────────
        console.log('\n[Test 9] A named block with no line history falls back to the pickaxe');
        commandsMap.set('vscode.executeDocumentSymbolProvider', () => [{
            name: 'MyClass',
            kind: mockVscode.SymbolKind.Class,
            range: new mockVscode.Range(5, 0, 20, 1),
            children: [{
                name: 'render',
                kind: mockVscode.SymbolKind.Method,
                range: new mockVscode.Range(10, 4, 14, 5),
                children: []
            }]
        }]);

        reset();
        warnings.length = 0;
        statusMessages.length = 0;
        symbolResult = { code: 0, stdout: commitLog('ddd4444', 'extract render') };
        await commandsMap.get('chronos.gitHistoryForContext')();
        await new Promise(r => setTimeout(r, 60));

        const pickaxeCall = gitCalls.find(args => argStartingWith(args, '-S'));
        assert(!!pickaxeCall, 'the pickaxe was tried');
        assertEqual(argStartingWith(pickaxeCall, '-S'), '-Srender', 'with the block name, not the dotted path');
        assert(
            statusMessages.some(m => m.includes('added or removed') && m.includes('render')),
            'and the user is told the result comes from a symbol search'
        );

        console.log('\n[Test 10] When the pickaxe finds nothing, -G is tried');
        reset();
        statusMessages.length = 0;
        searchResult = { code: 0, stdout: commitLog('eee5555', 'tweak render') };
        await commandsMap.get('chronos.gitHistoryForContext')();
        await new Promise(r => setTimeout(r, 60));

        const searchCall = gitCalls.find(args => argStartingWith(args, '-G'));
        assert(!!searchCall, '-G was tried after the pickaxe came back empty');
        assertEqual(argStartingWith(searchCall, '-G'), '-Grender', 'with the block name as the pattern');
        assert(statusMessages.some(m => m.includes('mention')), 'and the broader search is labelled differently');

        console.log('\n[Test 11] With no name to trace, nothing is invented');
        reset();
        statusMessages.length = 0;
        await commandsMap.get('chronos.gitHistoryForSelection')();
        await new Promise(r => setTimeout(r, 60));

        assert(!gitCalls.some(args => argStartingWith(args, '-S')), 'a plain selection does not fall back to a symbol search');
        assert(statusMessages.some(m => m.includes('no git history')), 'the user is told there is no history for those lines');
    } finally {
        mockVscode.window.showWarningMessage = originalWarning;
        mockVscode.window.setStatusBarMessage = originalStatus;
    }

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log(`\n--- Git Range Failure Tests: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exit(1);
}

runGitRangeFailureTests().catch(e => {
    console.error('Test suite error:', e);
    process.exit(1);
});
