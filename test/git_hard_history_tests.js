/**
 * Git History over an awkward history.
 *
 * `git log -L` is the whole basis of "Git History for Selection" and "for
 * Context", and its line tracking has edges that only show up on a history
 * shaped like a real one. This suite builds such a history on purpose —
 * branches, a real merge, a squash merge, a rename, a function extracted into
 * another file, a genuine cherry-pick, a reindent — and because every commit is
 * authored here, the expectations are the author's intent, not a restatement of
 * what the tool happens to return.
 *
 * Some cases assert limitations rather than successes. They are `git log -L`'s
 * limitations, not ours, and they are pinned here so that improving them has to
 * be a deliberate act: the test fails loudly and says what to reconsider. Where
 * we can do better than git — telling the user that an answer was cut short —
 * that is asserted as behaviour we owe them.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const { mockVscode } = require('./mock_vscode_real_fs');

Module.prototype.require = function (request) {
    if (request === 'vscode') return mockVscode;
    return originalRequire.apply(this, arguments);
};

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; }
    else { console.error(`  ❌ ${msg}`); failed++; }
}

function assertSame(actual, expected, msg) {
    const a = [...actual].sort().join(' ');
    const e = [...expected].sort().join(' ');
    if (a === e) { console.log(`  ✅ ${msg}`); passed++; }
    else { console.error(`  ❌ ${msg}\n      expected: ${e}\n      actual:   ${a}`); failed++; }
}

const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Hard History', GIT_AUTHOR_EMAIL: 'hard@example.invalid',
    GIT_COMMITTER_NAME: 'Hard History', GIT_COMMITTER_EMAIL: 'hard@example.invalid',
    GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'
};

const CONFIG = { maxCommits: 100, followRenames: true, dateFormat: 'yyyy-MM-dd HH:mm' };

/** The repository, plus which commits genuinely touched which block. */
function buildRepo(repo) {
    const git = (...args) => cp.execFileSync('git', args, { cwd: repo, env: GIT_ENV, encoding: 'utf8' });
    const write = (rel, text) => {
        const p = path.join(repo, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    };
    const touches = {};           // block -> [short hash]
    const head = () => git('rev-parse', '--short', 'HEAD').trim();
    const commit = (msg, ...blocks) => {
        git('add', '-A');
        git('commit', '-q', '-m', msg);
        const h = head();
        for (const b of blocks) (touches[b] = touches[b] || []).push(h);
        return h;
    };

    const HEADER = ['// calc.js — arithmetic helpers'];
    const HEADER2 = [...HEADER, '// precision rules apply'];
    const calc = (header, addBody, mulBody, order = ['add', 'mul'], indent = '    ') => {
        const blocks = {
            add: ['function add(a, b) {', ...addBody.map(l => indent + l), '}'],
            mul: ['function mul(a, b) {', ...mulBody.map(l => indent + l), '}']
        };
        return [...header, '', ...order.flatMap(n => [...blocks[n], '']), ''].join('\n');
    };
    const ADD_V1 = ['return a + b;'];
    const ADD_V2 = ['if (isNaN(a) || isNaN(b)) return 0;', 'return a + b;'];
    const ADD_V3 = ['if (isNaN(a) || isNaN(b)) return 0;', 'return Math.min(a + b, 1e9);'];
    const MUL_V1 = ['return a * b;'];
    const MUL_V2 = ['const product = a * b;', 'return product;'];
    const MUL_V3 = ['const product = a * b;', 'return Math.round(product * 100) / 100;'];

    git('-c', 'init.defaultBranch=main', 'init', '-q');

    write('src/calc.js', calc(HEADER, ADD_V1, MUL_V1));
    write('notes.txt', 'notes\n');
    const born = commit('feat: add add() and mul()', 'add', 'mul');

    write('src/calc.js', calc(HEADER, ADD_V2, MUL_V1));
    const guard = commit('fix: guard add() against NaN', 'add');

    write('src/calc.js', calc(HEADER, ADD_V2, MUL_V2));
    const product = commit('refactor: name the product in mul()', 'mul');

    // A branch that edits mul() and the header, merged with a real merge commit.
    git('checkout', '-q', '-b', 'feat/precision');
    write('src/calc.js', calc(HEADER, ADD_V2, MUL_V3));
    const round = commit('feat(precision): round in mul()', 'mul');
    write('src/calc.js', calc(HEADER2, ADD_V2, MUL_V3));
    const headerCommit = commit('docs(precision): note the rules in the header', 'header');

    git('checkout', '-q', 'main');
    write('notes.txt', 'notes\nmain moved on\n');
    commit('chore: main moves on', 'notes');
    git('merge', '-q', '--no-ff', 'feat/precision', '-m', 'merge: feat/precision into main');
    const merge = head();

    // The two blocks swap places: no logic changes, but every line moves.
    write('src/calc.js', calc(HEADER2, ADD_V2, MUL_V3, ['mul', 'add']));
    const moved = commit('refactor: put mul() above add()', 'position-only');

    // A reindent: every line of both blocks changes, no logic does.
    write('src/calc.js', calc(HEADER2, ADD_V2, MUL_V3, ['mul', 'add'], '  '));
    const reindent = commit('style: reindent to two spaces', 'whitespace-only');

    git('mv', 'src/calc.js', 'src/math.js');
    const rename = commit('refactor: rename calc.js to math.js', 'rename-only');

    write('src/math.js', calc(HEADER2, ADD_V3, MUL_V3, ['mul', 'add'], '  '));
    const clamp = commit('fix: clamp the result of add()', 'add');

    // mul() is extracted into a file of its own.
    write('src/math.js', [...HEADER2, '', 'function add(a, b) {', ...ADD_V3.map(l => '  ' + l), '}', ''].join('\n'));
    write('src/mul.js', ['// mul.js — extracted from math.js', '', 'function mul(a, b) {',
        ...MUL_V3.map(l => '  ' + l), '}', ''].join('\n'));
    const extracted = commit('refactor: extract mul() into mul.js', 'mul', 'extraction');

    // A cherry-pick: main moves first, so the twin is a different commit.
    git('checkout', '-q', '-b', 'hotfix/message');
    const commented = ['if (isNaN(a) || isNaN(b)) return 0; // defensive', 'return Math.min(a + b, 1e9);'];
    write('src/math.js', [...HEADER2, '', 'function add(a, b) {', ...commented.map(l => '  ' + l), '}', ''].join('\n'));
    const hotfix = commit('fix: comment the NaN guard in add()', 'add-on-hotfix');
    git('checkout', '-q', 'main');
    write('notes.txt', 'notes\nmain moved on\nagain\n');
    commit('chore: main moves on again', 'notes');
    git('cherry-pick', hotfix);
    const picked = head();
    (touches['add'] = touches['add']).push(picked);

    // A branch of three commits, squashed into one.
    git('checkout', '-q', '-b', 'feat/trim');
    for (let i = 1; i <= 3; i++) {
        write('src/math.js', [...HEADER2, '', 'function add(a, b) {',
            '  if (isNaN(a) || isNaN(b)) return 0; // defensive',
            `  const sum = Number(a) + Number(b); // step ${i}`,
            '  return Math.min(Math.max(sum, 0), 1e9);', '}', ''].join('\n'));
        git('add', '-A');
        git('commit', '-q', '-m', `wip(${i}): trim add()`);
    }
    git('checkout', '-q', 'main');
    git('merge', '-q', '--squash', 'feat/trim');
    const squashed = commit('feat: trim add() (#42)', 'add');

    return { born, guard, product, round, headerCommit, merge, moved, reindent,
             rename, clamp, extracted, hotfix, picked, squashed, touches };
}

async function run() {
    console.log('\n--- Starting Hard Git History Tests ---\n');
    try {
        cp.execFileSync('git', ['--version'], { encoding: 'utf8' });
    } catch (e) {
        console.log('  ⚠️  git is not available; skipping.');
        return;
    }

    const { GitService } = require('../out/git/gitService');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-hard-'));
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);

    const repoUri = mockVscode.Uri.file(repo);
    mockVscode.workspace.workspaceFolders = [{ uri: repoUri }];
    mockVscode.workspace.getWorkspaceFolder = () => ({ uri: repoUri, name: 'repo', index: 0 });

    try {
        const c = buildRepo(repo);
        const gitService = new GitService();
        const file = path.join(repo, 'src/math.js');
        const mulFile = path.join(repo, 'src/mul.js');
        const found = async (f, a, b) => {
            const r = await gitService.getHistoryForSelection(f, a - 1, b - 1, CONFIG);
            return r.failure ? { failure: r.failure.reason, hashes: [] }
                             : { hashes: r.commits.map(x => x.hash.slice(0, 7)) };
        };

        // add() is the last block in src/math.js at HEAD.
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        const addStart = lines.findIndex(l => l.startsWith('function add(')) + 1;
        const addEnd = addStart + 3;

        // ── What it gets right ───────────────────────────────────────────────
        console.log('[Test 1] A line added on a branch is attributed through a real merge');
        const headerLine = lines.findIndex(l => l.includes('precision rules apply')) + 1;
        const header = await found(file, headerLine, headerLine);
        assertSame(header.hashes, [c.headerCommit],
            'the branch commit is the one reported, not the merge');
        assert(!header.hashes.includes(c.merge), 'the merge commit itself is not listed as the change');

        console.log('\n[Test 2] History crosses a rename');
        const add = await found(file, addStart, addEnd);
        assert(add.hashes.includes(c.reindent) || add.hashes.includes(c.moved),
            'commits made while the file was still called calc.js are reported');
        assert(!add.hashes.includes(c.rename),
            'the rename itself changed no line, so it is not reported as a change');

        console.log('\n[Test 3] A squash merge is reported as the one commit it is');
        assert(add.hashes.includes(c.squashed), 'the squashed commit is listed');

        console.log('\n[Test 4] A cherry-pick is listed once, under the hash in this history');
        assert(add.hashes.includes(c.picked), 'the cherry-picked commit is listed');
        assert(!add.hashes.includes(c.hotfix),
            'its twin on the unmerged branch is not, so the same change is not shown twice');

        console.log('\n[Test 5] A block that never changed has no history of its own');
        const mul = await found(mulFile, 3, 6);
        assertSame(mul.hashes, [c.extracted], 'the extracted file reports the commit that created it');

        // ── What it cannot do, pinned on purpose ─────────────────────────────
        console.log('\n[Test 6] `-L` stops where a block changed position, and says so');
        // "put mul() above add()" rewrote the region as a deletion plus an
        // insertion, so -L reads it as the lines being created there and walks
        // no further. The two commits before it are unreachable this way — but
        // the answer now carries the fact that it was cut short.
        assert(add.hashes.includes(c.moved), 'the move is reported as if it changed the block');
        assert(!add.hashes.includes(c.born) && !add.hashes.includes(c.guard),
            'and everything older than the move is missing from the line-tracked answer');

        const addRaw = await gitService.getHistoryForSelection(file, addStart - 1, addEnd - 1, CONFIG);
        assert(!!addRaw.truncation, 'the result is flagged as truncated rather than looking complete');
        assert(addRaw.truncation && addRaw.truncation.hash.startsWith(c.moved),
            `the flag names the commit where tracking stopped (${addRaw.truncation && addRaw.truncation.hash.slice(0, 7)})`);
        assert(addRaw.truncation && addRaw.truncation.reason === 'block-moved',
            'and says why: the file is older than the point where tracking stopped');
        assert(addRaw.truncation && addRaw.truncation.previousFileCommit.length > 0,
            'naming the commit that changed the file before that, which is the proof there is more');
        const beforeTheMove = cp.execFileSync('git',
            ['log', '--format=%h', `-L${3},${6}:src/calc.js`, `${c.moved}~1`],
            { cwd: repo, env: GIT_ENV, encoding: 'utf8' })
            .split('\n').filter(l => /^[0-9a-f]{7,}$/.test(l)).map(l => l.slice(0, 7));
        assert(beforeTheMove.includes(c.born) && beforeTheMove.includes(c.guard),
            'they are reachable before the move, which is what makes this a loss and not an absence');

        console.log('\n[Test 7] LIMITATION: changes that touch no logic are reported as changes');
        assert(add.hashes.includes(c.reindent), 'a whitespace-only reindent is listed');
        const withW = cp.execFileSync('git',
            ['log', '-w', '--format=%h', `-L${addStart},${addEnd}:src/math.js`],
            { cwd: repo, env: GIT_ENV, encoding: 'utf8' })
            .split('\n').filter(l => /^[0-9a-f]{7,}$/.test(l)).map(l => l.slice(0, 7));
        assert(withW.includes(c.reindent),
            'and `-w` does not drop it either, so this cannot be fixed by asking git nicely');

        console.log('\n[Test 8] LIMITATION: a block extracted into another file loses its past');
        const truth = [...new Set(c.touches['mul'])];
        assert(truth.length > mul.hashes.length,
            `mul() was touched by ${truth.length} commits but reports ${mul.hashes.length}`);
        const byName = cp.execFileSync('git',
            ['log', '--format=%h', '-Sfunction mul', '--', '*.js'],
            { cwd: repo, env: GIT_ENV, encoding: 'utf8' })
            .split('\n').filter(l => /^[0-9a-f]{7,}$/.test(l)).map(l => l.slice(0, 7));
        assert(byName.includes(c.born),
            'a name search would recover the commit that created it, which the fallback could offer');
        assert(!byName.includes(c.product) && !byName.includes(c.round),
            'though not the edits to its body, which no name search can see');
        assert(mul.hashes.length === 1, 'line tracking alone reports only the extraction');

        console.log('\n[Test 9] The extracted block is flagged as starting with its file');
        const mulRaw = await gitService.getHistoryForSelection(mulFile, 2, 5, CONFIG);
        assert(!!mulRaw.truncation, 'the one-commit answer is flagged rather than looking complete');
        assert(mulRaw.truncation && mulRaw.truncation.reason === 'new-file',
            'with the reason that this is the file\'s first commit, so anything older lived elsewhere');
        // Which is only worth telling the user when something corroborates it,
        // and that is what the repository-wide name search is for: scoped to
        // mul.js it can only find the commit that created the file.
        const inThisFile = (await gitService.getHistoryBySymbol(mulFile, 'mul', CONFIG))
            .map(c => c.hash.slice(0, 7));
        assertSame(inThisFile, [c.extracted],
            'a search scoped to the new file adds nothing, because the past is not in it');

        const anywhere = (await gitService.getHistoryBySymbolAnywhere(mulFile, 'mul', CONFIG))
            .map(c => c.hash.slice(0, 7));
        assert(anywhere.includes(c.born),
            'the repository-wide search finds the commit that first wrote mul(), in the file it lived in then');
        assert(anywhere.filter(h => !mul.hashes.includes(h)).length > 0,
            'so there is something to add to the line-tracked answer');
        assert(!anywhere.includes(c.product) && !anywhere.includes(c.round),
            'though not the edits to its body, which no name search can see');

        console.log('\n[Test 10] A range that does not exist in the committed file is reported, not guessed');
        const beyond = await found(file, 500, 501);
        assert(beyond.failure === 'bad-range', `a range past the end is reported (${beyond.failure})`);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }

    console.log(`\n--- Hard Git History Tests: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Test suite error:', e); process.exit(1); });
