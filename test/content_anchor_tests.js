/**
 * Content Anchor Tests
 * Covers the content-anchored range mapping behind "Show History for Context":
 *  - rangeMapper's diff arithmetic (deletions, insertions, boundary hunks)
 *  - a block that moved inside the file is found again by its signature line
 *  - a hunk overlapping the range start no longer swallows the lines above it
 *  - the walk stops where the block first appears, instead of dragging on
 *  - a range nothing ever touched comes back empty, with no silent fallback
 *  - editor line numbers are mapped onto HEAD before `git log -L` sees them
 *  - how each range was obtained reaches both webviews as a tooltip
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const { mockVscode, fsStore, commandsMap } = require('./mock_vscode');
const EventEmitter = require('events');

// ─── Mock child_process ──────────────────────────────────────────────────────
const gitCalls = [];
let headDiff = '';
let logOutput = '';

const mockSpawn = (cmd, args, opts) => {
    gitCalls.push(args);
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => {
        let out = '';
        if (args.includes('diff') && args.includes('HEAD')) out = headDiff;
        else if (args.includes('log')) out = logOutput;
        proc.stdout.emit('data', out);
        proc.emit('close', 0);
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

function assertRange(range, start, end, msg) {
    if (range && range.start === start && range.end === end) {
        console.log(`  ✅ ${msg} (${start}-${end})`);
        passed++;
    } else {
        const got = range ? `${range.start}-${range.end}` : String(range);
        console.error(`  ❌ ${msg} — expected ${start}-${end}, got ${got}`);
        failed++;
    }
}

const ROOT = mockVscode.Uri.file('/globalStorage');
const FILE = mockVscode.Uri.file('/workspace/target.ts');

/** Writes a snapshot's content and returns its index entry. */
async function putSnapshot(id, timestamp, lines) {
    await mockVscode.workspace.fs.writeFile(
        mockVscode.Uri.joinPath(ROOT, id),
        new TextEncoder().encode(lines.join('\n'))
    );
    return { id, timestamp, filePath: 'target.ts', eventType: 'save', storagePath: id };
}

/**
 * HistoryFilter only needs getSnapshotUri from storage and getHunks from git,
 * so the test supplies both directly: diffs are keyed by the two file names,
 * which keeps each fixture readable and independent of call order.
 */
function makeFilter(HistoryFilter, diffs) {
    const storage = {
        getSnapshotUri: async (snapshot) => mockVscode.Uri.joinPath(ROOT, snapshot.storagePath)
    };
    const git = {
        getHunks: async (oldPath, newPath) => {
            const key = `${path.basename(oldPath)}->${path.basename(newPath)}`;
            return diffs[key] ?? '';
        }
    };
    return new HistoryFilter(storage, git);
}

const FOO = 'function foo() {';
const BAR = 'function bar() {';
const BAZ = 'function baz() {';

// ─── Tests ───────────────────────────────────────────────────────────────────
async function runContentAnchorTests() {
    console.log('\n--- Starting Content Anchor Tests ---\n');

    const { parseHunks, mapRangeBackwards, isRangeRelevant, clampRange } = require('../out/utils/rangeMapper');
    const { HistoryFilter } = require('../out/historyFilter');

    // ── Section 1: range mapper arithmetic ───────────────────────────────────
    console.log('[Test 1] A deletion hunk shifts a range below it back down');
    let hunks = parseHunks('@@ -5,2 +4,0 @@\n-gone one\n-gone two\n');
    assertEqual(hunks.length, 1, 'one hunk parsed');
    assert(hunks[0].touchedLines.has(4), 'the seam is marked on the new side');
    let mapped = mapRangeBackwards({ startLine: 10, endLine: 12 }, hunks);
    assertEqual(`${mapped.startLine}-${mapped.endLine}`, '12-14', 'range maps back past the deleted lines');

    console.log('\n[Test 2] An insertion hunk shifts a range below it back up');
    hunks = parseHunks('@@ -4,0 +5,2 @@\n+added one\n+added two\n');
    assert(hunks[0].touchedLines.has(4) && hunks[0].touchedLines.has(5), 'both added lines are marked');
    mapped = mapRangeBackwards({ startLine: 10, endLine: 12 }, hunks);
    assertEqual(`${mapped.startLine}-${mapped.endLine}`, '8-10', 'range maps back above the added lines');

    console.log('\n[Test 3] A hunk starting exactly at the range start pulls it in');
    hunks = parseHunks('@@ -3,4 +3,2 @@\n-a\n-b\n-c\n-d\n+a\n+b\n');
    mapped = mapRangeBackwards({ startLine: 2, endLine: 6 }, hunks);
    assertEqual(mapped.startLine, 2, 'start is pulled to where the hunk began in the old version');
    assertEqual(mapped.endLine, 8, 'end follows the two lines the hunk removed');

    console.log('\n[Test 4] Relevance only counts lines inside the range');
    hunks = parseHunks('@@ -8,1 +8,1 @@\n-old\n+new\n');
    assert(isRangeRelevant({ startLine: 5, endLine: 9 }, hunks), 'a touched line inside the range counts');
    assert(!isRangeRelevant({ startLine: 0, endLine: 3 }, hunks), 'a touched line outside the range does not');
    const clamped = clampRange({ startLine: 8, endLine: 20 }, 10);
    assertEqual(`${clamped.startLine}-${clamped.endLine}`, '8-9', 'clampRange keeps the range inside the file');

    // ── Section 2: a block that moved is found again ─────────────────────────
    console.log('\n[Test 5] A block that moved is re-found by its signature line');
    const movedC = ['header', FOO, '    body', '}', 'other1', 'other2', 'tail'];
    const movedB = ['header', 'other1', 'other2', FOO, '    body', '}', 'tail'];
    const movedA = ['header', 'other1', 'other2', FOO, '    old body', '}', 'tail'];

    const moveHistory = [
        await putSnapshot('snap-c', 3000, movedC),
        await putSnapshot('snap-b', 2000, movedB),
        await putSnapshot('snap-a', 1000, movedA)
    ];
    await mockVscode.workspace.fs.writeFile(FILE, new TextEncoder().encode(movedC.join('\n')));

    const moveDiffs = {
        'snap-c->target.ts': '',
        'snap-b->snap-c': '@@ -1,0 +2,3 @@\n+' + FOO + '\n+    body\n+}\n@@ -4,3 +7,0 @@\n-' + FOO + '\n-    body\n-}\n',
        'snap-a->snap-b': '@@ -5,1 +5,1 @@\n-    old body\n+    body\n'
    };

    let filter = makeFilter(HistoryFilter, moveDiffs);
    let result = await filter.filterHistoryForSelection(
        moveHistory, FILE, new mockVscode.Range(1, 0, 3, 1), { signatureLine: FOO }
    );

    assertEqual(result.length, 3, 'all three snapshots are on the trail');
    assertEqual(result.map(s => s.id).join(','), 'snap-c,snap-b,snap-a', 'ordered newest to oldest');
    assertRange(result[0].relevantRange, 1, 3, 'newest keeps the block where it is');
    assertRange(result[1].relevantRange, 3, 5, 'the moved block is found at its old position');
    assertEqual(result[1].rangeAnchoring, 'content', 'and is marked as re-found by content');
    assertRange(result[2].relevantRange, 3, 5, 'the oldest keeps the same block');
    assertEqual(result[2].rangeAnchoring, 'origin', 'the oldest is marked as the earliest version held');

    // ── Section 3: drift, anchored against unanchored ────────────────────────
    console.log('\n[Test 6] A hunk overlapping the range start no longer swallows lines above');
    const driftLines = ['header', 'pad', BAR, '    body', '}', 'tail'];
    const driftHistory = [
        await putSnapshot('drift-c', 3000, driftLines),
        await putSnapshot('drift-b', 2000, driftLines),
        await putSnapshot('drift-a', 1000, driftLines)
    ];
    await mockVscode.workspace.fs.writeFile(FILE, new TextEncoder().encode(driftLines.join('\n')));

    const driftDiffs = {
        'drift-c->target.ts': '',
        // A hunk that starts above the block and reaches into its first line.
        'drift-b->drift-c': '@@ -1,3 +1,3 @@\n-header\n-pad\n-' + BAR + '\n+header\n+pad\n+' + BAR + '\n',
        'drift-a->drift-b': '@@ -4,1 +4,1 @@\n-    old\n+    body\n'
    };
    const driftSelection = () => new mockVscode.Range(2, 0, 4, 1);

    const unanchored = await makeFilter(HistoryFilter, driftDiffs)
        .filterHistoryForSelection(driftHistory, FILE, driftSelection());
    const anchored = await makeFilter(HistoryFilter, driftDiffs)
        .filterHistoryForSelection(driftHistory, FILE, driftSelection(), { signatureLine: BAR });

    const unanchoredMiddle = unanchored.find(s => s.id === 'drift-b');
    const anchoredMiddle = anchored.find(s => s.id === 'drift-b');
    assertRange(unanchoredMiddle.relevantRange, 0, 4, 'without an anchor the range swallows the two lines above');
    assertEqual(unanchoredMiddle.rangeAnchoring, 'position', 'and is only tracked by position');
    assertRange(anchoredMiddle.relevantRange, 2, 4, 'with an anchor the range stays on the block');
    assertEqual(anchoredMiddle.rangeAnchoring, 'content', 'and is marked as re-found by content');

    // ── Section 4: the walk stops where the block appears ────────────────────
    console.log('\n[Test 7] The walk stops at the snapshot where the block first appears');
    const withBlock = ['header', BAZ, '    body', '}'];
    const originHistory = [
        await putSnapshot('org-c', 3000, withBlock),
        await putSnapshot('org-b', 2000, withBlock),
        await putSnapshot('org-a', 1000, ['header'])
    ];
    await mockVscode.workspace.fs.writeFile(FILE, new TextEncoder().encode(withBlock.join('\n')));

    const originDiffs = {
        'org-c->target.ts': '',
        'org-b->org-c': '@@ -3,1 +3,1 @@\n-    old\n+    body\n',
        'org-a->org-b': '@@ -1,0 +2,3 @@\n+' + BAZ + '\n+    body\n+}\n'
    };

    result = await makeFilter(HistoryFilter, originDiffs).filterHistoryForSelection(
        originHistory, FILE, new mockVscode.Range(1, 0, 3, 1), { signatureLine: BAZ }
    );

    assertEqual(result.length, 2, 'only the snapshots that hold the block are listed');
    assertEqual(result.map(s => s.id).join(','), 'org-c,org-b', 'the snapshot without the block is left out');
    assertEqual(result[1].rangeAnchoring, 'origin', 'the snapshot where the block appears is marked as its origin');

    // ── Section 5: nothing touched the range ─────────────────────────────────
    console.log('\n[Test 8] A range nothing ever touched comes back empty');
    const quietLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const quietHistory = [
        await putSnapshot('quiet-b', 2000, quietLines),
        await putSnapshot('quiet-a', 1000, quietLines)
    ];
    await mockVscode.workspace.fs.writeFile(FILE, new TextEncoder().encode(quietLines.join('\n')));

    result = await makeFilter(HistoryFilter, {
        'quiet-b->target.ts': '',
        'quiet-a->quiet-b': '@@ -8,1 +8,1 @@\n-line 8\n+line eight\n'
    }).filterHistoryForSelection(quietHistory, FILE, new mockVscode.Range(1, 0, 2, 5));

    assertEqual(result.length, 0, 'no snapshot is returned');
    assert(Array.isArray(result), 'and the full history is not silently substituted');

    // ── Section 6: buffer lines are mapped onto HEAD ─────────────────────────
    console.log('\n[Test 9] Editor line numbers are mapped onto HEAD before git log -L');
    const extension = require('../out/extension');
    extension.activate(new mockVscode.ExtensionContext());

    // Three lines exist in the buffer that HEAD does not have, all above the range.
    headDiff = '@@ -0,0 +1,3 @@\n+uncommitted one\n+uncommitted two\n+uncommitted three\n';
    logOutput = '';

    const selection = new mockVscode.Range(10, 0, 12, 5);
    mockVscode.window.activeTextEditor = {
        document: {
            uri: FILE,
            lineCount: 40,
            getText: () => quietLines.join('\n')
        },
        selection
    };

    gitCalls.length = 0;
    const gitCmd = commandsMap.get('chronos.gitHistoryForSelection');
    assert(typeof gitCmd === 'function', 'chronos.gitHistoryForSelection is registered');
    await gitCmd();
    await new Promise(r => setTimeout(r, 60));

    const logCall = gitCalls.find(args => args.includes('log') && args.some(a => String(a).startsWith('-L')));
    assert(!!logCall, 'git log -L was called');
    if (logCall) {
        const rangeArg = logCall.find(a => String(a).startsWith('-L'));
        assertEqual(rangeArg, '-L8,10:target.ts', 'the range is expressed in HEAD line numbers, not buffer ones');
    }

    console.log('\n[Test 10] With a clean working tree the range is passed through unchanged');
    headDiff = '';
    gitCalls.length = 0;
    await gitCmd();
    await new Promise(r => setTimeout(r, 60));

    const cleanCall = gitCalls.find(args => args.includes('log') && args.some(a => String(a).startsWith('-L')));
    if (cleanCall) {
        const rangeArg = cleanCall.find(a => String(a).startsWith('-L'));
        assertEqual(rangeArg, '-L11,13:target.ts', 'the buffer range is used as is');
    } else {
        assert(false, 'git log -L was called');
    }

    // ── Section 7: how the range was obtained reaches the UI ─────────────────
    console.log('\n[Test 11] The anchoring is turned into a tooltip for the views');
    const { describeRangeAnchoring, withAnchoringLabels } = require('../out/utils/rangeLabel');

    assertEqual(
        describeRangeAnchoring({ relevantRange: { start: 3, end: 7 }, rangeAnchoring: 'content' }),
        'Lines 4-8 \u2014 block re-found by content', 'a re-found block says so'
    );
    assertEqual(
        describeRangeAnchoring({ relevantRange: { start: 3, end: 7 }, rangeAnchoring: 'origin' }),
        'Lines 4-8 \u2014 earliest version of the block we hold', 'the origin says so'
    );
    assertEqual(
        describeRangeAnchoring({ relevantRange: { start: 3, end: 7 }, rangeAnchoring: 'position' }),
        'Lines 4-8 \u2014 tracked by position', 'positional tracking says so'
    );
    assertEqual(
        describeRangeAnchoring({ relevantRange: { start: 5, end: 5 } }),
        'Line 6 \u2014 tracked by position', 'a single line is not written as a range'
    );
    assertEqual(describeRangeAnchoring({ id: 'x' }), undefined, 'a snapshot with no range gets no label');

    console.log('\n[Test 12] Labels are attached through the cluster wrappers');
    const labelled = withAnchoringLabels([
        { id: 'plain', relevantRange: { start: 0, end: 2 }, rangeAnchoring: 'content' },
        { type: 'cluster', items: [{ id: 'inner', relevantRange: { start: 4, end: 4 }, rangeAnchoring: 'origin' }] },
        { id: 'no-range' }
    ]);
    assert(String(labelled[0].anchoringLabel).includes('re-found'), 'a plain snapshot is labelled');
    assertEqual(
        labelled[1].items[0].anchoringLabel,
        'Line 5 \u2014 earliest version of the block we hold', 'a clustered snapshot is labelled too'
    );
    assertEqual(labelled[2].anchoringLabel, undefined, 'a snapshot with no range is left alone');

    console.log('\n[Test 13] Both views render the label and scroll to the range');
    const fs = require('fs');
    for (const view of ['historyPanelProvider', 'historyWebview']) {
        // The rows are built in browser JS inside an HTML string, so from Node
        // the only way to check the wiring is to look for it in the output.
        const source = fs.readFileSync(require.resolve(`../out/views/${view}.js`), 'utf8');
        assert(source.includes('anchoringLabel'), `${view} renders the anchoring label`);
        assert(source.includes('revealDiffTarget'), `${view} scrolls its diff to the target range`);
        assert(source.includes('data-new-line'), `${view} tags diff rows with their line number`);
    }

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log(`\n--- Content Anchor Tests: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exit(1);
}

runContentAnchorTests().catch(e => {
    console.error('Test suite error:', e);
    process.exit(1);
});
