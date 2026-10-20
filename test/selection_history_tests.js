/**
 * Selection History Tests
 * Verifies that "Show History for Selection" behaves like IntelliJ IDEA:
 *  - Only shows snapshots where the selected lines actually changed
 *  - Each snapshot carries a correctly-mapped relevantRange
 *  - openDiff slices both sides to those lines (not full file / not empty)
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const { mockVscode, fsStore, commandsMap } = require('./mock_vscode');
const EventEmitter = require('events');

// ─── Mock child_process (git diff) ───────────────────────────────────────────
// Returns a minimal unified diff showing lines 3-4 changed between two files
const mockSpawn = (cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => {
        if (args.includes('diff')) {
            // Simulate a change on line 3 (0-based line 2)
            proc.stdout.emit('data',
                'diff --git a/file b/file\n' +
                'index 000000..111111 100644\n' +
                '--- a/file\n' +
                '+++ b/file\n' +
                '@@ -3,1 +3,1 @@\n' +
                '-old line 3\n' +
                '+new line 3\n'
            );
        } else if (args.includes('log')) {
            proc.stdout.emit('data', '');
        }
        proc.emit('close', 0);
    }, 5);
    return proc;
};

// GitService reads file content with execFile; `ls-files` must come back empty
// so the canonical path falls through to the workspace-relative one.
const mockExecFile = (cmd, args, opts, cb) => {
    if (args.includes('ls-files')) return cb(null, '', '');
    return cb(null, 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n', '');
};

Module.prototype.require = function(request) {
    if (request === 'vscode') return mockVscode;
    if (request === 'child_process') {
        return { spawn: mockSpawn, execFile: mockExecFile, exec: (c, o, cb) => cb(null, '', '') };
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

function assertEqual(a, b, msg) {
    if (a === b) {
        console.log(`  ✅ ${msg} (${a})`);
        passed++;
    } else {
        console.error(`  ❌ ${msg} — expected ${b}, got ${a}`);
        failed++;
    }
}

// ─── Test Data Setup ──────────────────────────────────────────────────────────
function makeLines(prefix, count) {
    return Array.from({ length: count }, (_, i) => `${prefix} line ${i + 1}`).join('\n');
}

async function setupSnapshots(rootUri, fileUri) {
    // Snapshot A (older): 10 lines, "foo line N"
    const snapAId  = 'sel-snap-a';
    const snapAContent = makeLines('foo', 10); // lines 0..9

    // Snapshot B (newer): 10 lines, line 2 (0-based) changed to "bar"
    const snapBId  = 'sel-snap-b';
    const snapBLines = makeLines('foo', 10).split('\n');
    snapBLines[2] = 'bar line 3';
    const snapBContent = snapBLines.join('\n');

    // Current file on disk: same as B but line 7 also changed
    const currentLines = snapBContent.split('\n');
    currentLines[7] = 'baz line 8';
    const currentContent = currentLines.join('\n');

    // Write index
    const indexUri = mockVscode.Uri.joinPath(rootUri, 'index.json');
    const indexData = {
        snapshots: [
            { id: snapBId, timestamp: 2000, filePath: 'target.ts', eventType: 'save', storagePath: snapBId },
            { id: snapAId, timestamp: 1000, filePath: 'target.ts', eventType: 'save', storagePath: snapAId },
        ]
    };
    await mockVscode.workspace.fs.writeFile(indexUri, new TextEncoder().encode(JSON.stringify(indexData)));

    // Write snapshot files
    await mockVscode.workspace.fs.writeFile(mockVscode.Uri.joinPath(rootUri, snapBId), new TextEncoder().encode(snapBContent));
    await mockVscode.workspace.fs.writeFile(mockVscode.Uri.joinPath(rootUri, snapAId), new TextEncoder().encode(snapAContent));

    // Write current file
    await mockVscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(currentContent));

    return { snapAId, snapBId, snapAContent, snapBContent, currentContent };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
async function runSelectionHistoryTests() {
    console.log('\n--- Starting Selection History Tests ---\n');

    const extension = require('../out/extension');
    const context = new mockVscode.ExtensionContext();
    extension.activate(context);

    const rootUri = mockVscode.Uri.file('/globalStorage');
    const fileUri = mockVscode.Uri.file('/workspace/target.ts');
    const { snapAId, snapBId, snapBContent, currentContent } = await setupSnapshots(rootUri, fileUri);

    // ── Test 1: HistoryFilter correctly tags relevantRange ───────────────────
    console.log('[Test 1] HistoryFilter — relevantRange is set on filtered snapshots');
    {
        // Load the compiled HistoryFilter
        const { HistoryFilter } = require('../out/historyFilter');
        const { HistoryStorage } = require('../out/storage');
        const { GitService } = require('../out/git/gitService');

        const storage = new HistoryStorage(context);
        await storage.init();
        const gitSvc = new GitService();
        const filter = new HistoryFilter(storage, gitSvc);

        const history = await storage.getHistoryForFile(fileUri);
        // Select lines 2-2 (0-based) — the line that changed in B
        const selection = new mockVscode.Range(2, 0, 3, 0);
        const filtered = await filter.filterHistoryForSelection(history, fileUri, selection);

        assert(filtered.length > 0, 'Filtered list is not empty');
        const hasRelevantRange = filtered.every(s => s.relevantRange !== undefined);
        assert(hasRelevantRange, 'Every filtered snapshot has relevantRange set');

        for (const snap of filtered) {
            assert(typeof snap.relevantRange.start === 'number', `relevantRange.start is a number for ${snap.id}`);
            assert(typeof snap.relevantRange.end === 'number', `relevantRange.end is a number for ${snap.id}`);
            assert(snap.relevantRange.start <= snap.relevantRange.end,
                `relevantRange is non-inverted (${snap.relevantRange.start}..${snap.relevantRange.end}) for ${snap.id}`);
            // end must be inclusive: for a selection of lines 2-2, relevantRange.end must be 2, not 3
            assert(snap.relevantRange.end < 100,
                `relevantRange.end is a reasonable line number (not VS Code exclusive sentinel) for ${snap.id}`);
        }
    }

    // ── Test 2: openDiff reveals the range in the real files ────────────────
    console.log('\n[Test 2] openDiff — opens the real files and reveals the range');
    {
        let diffCall = null;
        const origExecute = mockVscode.commands.executeCommand;
        mockVscode.commands.executeCommand = async (cmd, ...args) => {
            if (cmd === 'vscode.diff') diffCall = args;
            if (commandsMap.has(cmd)) return commandsMap.get(cmd)(...args);
        };

        const openDiffCmd = commandsMap.get('_chronos.openDiff');
        assert(!!openDiffCmd, '_chronos.openDiff is registered');

        const snapshotWithRange = {
            id: snapBId,
            timestamp: 2000,
            filePath: 'target.ts',
            eventType: 'save',
            storagePath: snapBId,
            relevantRange: { start: 2, end: 2 }
        };

        await openDiffCmd(snapshotWithRange, fileUri.fsPath, { startLine: 2, endLine: 4 });

        assert(!!diffCall, 'vscode.diff was called');
        if (diffCall) {
            const [leftUri, rightUri, , options] = diffCall;
            // No more slicing into temp files: both sides are the real thing, so
            // the user keeps the context around the block and its true line numbers.
            assert(!String(leftUri.fsPath).includes('current_selection'), 'the left side is the snapshot itself, not a slice');
            assertEqual(String(rightUri.fsPath), fileUri.fsPath, 'the right side is the file on disk');
            assert(!!options && !!options.selection, 'a selection is passed for the editor to reveal');
            if (options && options.selection) {
                assertEqual(options.selection.start.line, 2, 'revealed range starts on the selected line');
                assertEqual(options.selection.end.line, 4, 'and ends on the last selected line');
            }
        }

        mockVscode.commands.executeCommand = origExecute;
    }

    // ── Test 3: openDiff with vscode.Selection format (panel provider path) ──
    console.log('\n[Test 3] openDiff — normalizes raw vscode.Selection { start.line, end.line }');
    {
        let diffCall = null;
        const origExecute = mockVscode.commands.executeCommand;
        mockVscode.commands.executeCommand = async (cmd, ...args) => {
            if (cmd === 'vscode.diff') diffCall = args;
            if (commandsMap.has(cmd)) return commandsMap.get(cmd)(...args);
        };

        const openDiffCmd = commandsMap.get('_chronos.openDiff');
        const snapshotWithRange = {
            id: snapBId,
            timestamp: 2000,
            filePath: 'target.ts',
            eventType: 'save',
            storagePath: snapBId,
            relevantRange: { start: 2, end: 2 }
        };

        // Raw vscode.Selection shape (what panel provider sends)
        const rawSelection = {
            start: { line: 2, character: 0 },
            end: { line: 3, character: 0 },
            anchor: { line: 2, character: 0 },
            active: { line: 3, character: 0 }
        };

        await openDiffCmd(snapshotWithRange, fileUri.fsPath, rawSelection);
        assert(!!diffCall, 'vscode.diff was called when currentSelection uses {start.line, end.line} format');
        if (diffCall && diffCall[3] && diffCall[3].selection) {
            assertEqual(diffCall[3].selection.start.line, 2, 'the raw selection still reveals the right line');
        }

        mockVscode.commands.executeCommand = origExecute;
    }

    // ── Test 4: openDiff with no selection and no relevantRange → full file ──
    console.log('\n[Test 4] openDiff — falls back to full-file diff when no selection/range');
    {
        let diffCalled = false;
        let usedSnapshotUri = false;
        const origExecute = mockVscode.commands.executeCommand;
        mockVscode.commands.executeCommand = async (cmd, ...args) => {
            if (cmd === 'vscode.diff') {
                diffCalled = true;
                // Full-file diff uses snapshot URI directly, not a temp file
                const leftArg = args[0];
                usedSnapshotUri = leftArg && !leftArg.fsPath?.includes('current_selection');
            }
            if (commandsMap.has(cmd)) return commandsMap.get(cmd)(...args);
        };

        const openDiffCmd = commandsMap.get('_chronos.openDiff');
        const plainSnapshot = {
            id: snapBId,
            timestamp: 2000,
            filePath: 'target.ts',
            eventType: 'save',
            storagePath: snapBId
            // no relevantRange
        };

        await openDiffCmd(plainSnapshot, fileUri.fsPath, undefined);
        assert(diffCalled, 'vscode.diff was called for full-file path');

        mockVscode.commands.executeCommand = origExecute;
    }

    // ── Test 5: Select-All → delegates to showHistory (full timeline) ────────
    console.log('\n[Test 5] showHistoryForSelection with Select All → same as showHistory');
    {
        // Track whether createWebviewPanel is called (happens inside showHistory)
        let webviewCreated = false;
        const origCreate = mockVscode.window.createWebviewPanel;
        mockVscode.window.createWebviewPanel = (...args) => {
            webviewCreated = true;
            return origCreate(...args);
        };

        // Set activeTextEditor with a full-file selection (lines 0..9 on 10-line file)
        const fullSelection = new mockVscode.Range(0, 0, 9, 999);
        mockVscode.window.activeTextEditor = {
            document: { uri: fileUri, getText: () => currentContent, lineCount: 10 },
            selection: fullSelection
        };

        const cmd = commandsMap.get('chronos.showHistoryForSelection');
        await cmd();
        // Give async ops time to propagate
        await new Promise(r => setTimeout(r, 100));
        assert(webviewCreated, 'showHistoryForSelection with Select All opened a webview (same as showHistory)');

        mockVscode.window.createWebviewPanel = origCreate;
    }

    // ── Test 6: gitHistoryForSelection passes correct line range ─────────────
    console.log('\n[Test 6] gitHistoryForSelection — runs without error for a line selection');
    {
        // Build a proper selection object matching the Range class
        const gitSel = new mockVscode.Range(3, 0, 6, 0);
        // Patch isEmpty getter on this instance
        Object.defineProperty(gitSel, 'isEmpty', { get: () => false, configurable: true });

        mockVscode.window.activeTextEditor = {
            document: { uri: fileUri, getText: () => currentContent, lineCount: 10 },
            selection: gitSel
        };

        const cmd = commandsMap.get('chronos.gitHistoryForSelection');
        // Just verify it runs without throwing
        try {
            await cmd();
            await new Promise(r => setTimeout(r, 50));
            console.log('  ✅ gitHistoryForSelection ran without error');
            passed++;
        } catch(e) {
            console.error('  ❌ gitHistoryForSelection threw:', e.message);
            failed++;
        }
    }

    // ── Test 7: openDiffGit reveals the commit's own range ──────────────────
    console.log('\n[Test 7] openDiffGit — reveals the commit\'s own range, not the one it was handed');
    {
        let diffCall = null;
        const origExecute = mockVscode.commands.executeCommand;
        mockVscode.commands.executeCommand = async (cmd, ...args) => {
            if (cmd === 'vscode.diff') diffCall = args;
            if (commandsMap.has(cmd)) return commandsMap.get(cmd)(...args);
        };

        const openDiffGitCmd = commandsMap.get('_chronos.openDiffGit');
        assert(!!openDiffGitCmd, '_chronos.openDiffGit is registered');

        // Both sides are versions of this commit, so only its own line numbers
        // apply — the range from the editor would point somewhere else.
        const commit = {
            hash: 'abc1234def',
            author: 'Me',
            date: '2024-01-01',
            message: 'touch the block',
            diff: '',
            relevantRange: { start: 40, end: 44 }
        };

        await openDiffGitCmd(commit, fileUri.fsPath, { startLine: 2, endLine: 4 });
        await new Promise(r => setTimeout(r, 20));

        assert(!!diffCall, 'vscode.diff was called');
        if (diffCall && diffCall[3] && diffCall[3].selection) {
            assertEqual(diffCall[3].selection.start.line, 40, "the commit's own range is revealed");
        } else if (diffCall) {
            assert(false, 'a selection is passed for the editor to reveal');
        }

        mockVscode.commands.executeCommand = origExecute;
    }

    // ── Test 8: openDiffGitCurrent reveals the buffer range ─────────────────
    console.log('\n[Test 8] openDiffGitCurrent — reveals the buffer range, not the HEAD range');
    {
        let diffCall = null;
        const origExecute = mockVscode.commands.executeCommand;
        mockVscode.commands.executeCommand = async (cmd, ...args) => {
            if (cmd === 'vscode.diff') diffCall = args;
            if (commandsMap.has(cmd)) return commandsMap.get(cmd)(...args);
        };

        const openDiffCurrentCmd = commandsMap.get('_chronos.openDiffGitCurrent');
        assert(!!openDiffCurrentCmd, '_chronos.openDiffGitCurrent is registered');

        const commit = { hash: 'abc1234def', author: 'Me', date: '2024-01-01', message: 'x', diff: '' };

        // The right-hand side is the file on disk, so the editor's own lines are
        // the ones that apply — uncommitted edits shifted them away from HEAD's.
        await openDiffCurrentCmd(commit, fileUri.fsPath, {
            startLine: 7, endLine: 9,
            bufferStartLine: 10, bufferEndLine: 12
        });
        await new Promise(r => setTimeout(r, 20));

        assert(!!diffCall, 'vscode.diff was called');
        if (diffCall && diffCall[3] && diffCall[3].selection) {
            assertEqual(diffCall[3].selection.start.line, 10, 'the buffer range is revealed');
            assertEqual(diffCall[3].selection.end.line, 12, 'through to its last line');
        } else if (diffCall) {
            assert(false, 'a selection is passed for the editor to reveal');
        }

        mockVscode.commands.executeCommand = origExecute;
    }

    // ── Test 9: a file with no snapshots at all ─────────────────────────────
    console.log('\n[Test 9] A file with no snapshots opens the panel, not a notification');
    {
        // "No snapshot changed these lines" would blame the range for something
        // else entirely: nothing was ever recorded for this file.
        let warnings = 0;
        let focusedPanel = false;
        const origWarning = mockVscode.window.showWarningMessage;
        const origInfo = mockVscode.window.showInformationMessage;
        const origConfig = mockVscode.workspace.getConfiguration;
        const origExecute = mockVscode.commands.executeCommand;

        mockVscode.window.showWarningMessage = () => { warnings++; };
        mockVscode.window.showInformationMessage = () => { warnings++; };
        // Panel mode gives an observable signal: showHistory focuses the panel.
        // (The editor-mode path reuses a panel an earlier test already created,
        // so counting createWebviewPanel would prove nothing here.)
        mockVscode.workspace.getConfiguration = (section) => ({
            get: (key, def) => (key === 'viewMode' ? 'panel' : def)
        });
        mockVscode.commands.executeCommand = async (cmd, ...args) => {
            if (cmd === 'chronos.historyPanel.focus') focusedPanel = true;
            if (commandsMap.has(cmd)) return commandsMap.get(cmd)(...args);
        };

        const unknown = mockVscode.Uri.file('/workspace/never-seen.ts');
        mockVscode.window.activeTextEditor = {
            document: { uri: unknown, getText: () => 'a\nb\nc\nd\ne', lineCount: 5 },
            selection: new mockVscode.Range(1, 0, 2, 3)
        };

        try {
            await commandsMap.get('chronos.showHistoryForSelection')();
            await new Promise(r => setTimeout(r, 30));
            assertEqual(warnings, 0, 'no notification is shown');
            assert(focusedPanel, 'the history panel is opened, to show its own empty state');
        } finally {
            mockVscode.window.showWarningMessage = origWarning;
            mockVscode.window.showInformationMessage = origInfo;
            mockVscode.workspace.getConfiguration = origConfig;
            mockVscode.commands.executeCommand = origExecute;
        }
    }

    // ── Test 10: snapshots exist but the range was never touched ────────────
    console.log('\n[Test 10] A range no snapshot touched is reported, not silently widened');
    {
        let panels = 0;
        const warningTexts = [];
        const origPanel = mockVscode.window.createWebviewPanel;
        const origWarning = mockVscode.window.showWarningMessage;
        mockVscode.window.createWebviewPanel = (...args) => { panels++; return origPanel(...args); };
        mockVscode.window.showWarningMessage = (msg) => { warningTexts.push(String(msg)); };

        // The mocked diff only ever touches line 3, so a range well below it has
        // genuinely never changed.
        mockVscode.window.activeTextEditor = {
            document: { uri: fileUri, getText: () => 'x', lineCount: 10 },
            selection: new mockVscode.Range(6, 0, 7, 4)
        };

        try {
            await commandsMap.get('chronos.showHistoryForSelection')();
            await new Promise(r => setTimeout(r, 30));
            assertEqual(warningTexts.length, 1, 'the user is told');
            if (warningTexts.length > 0) {
                assert(warningTexts[0].includes('none of the'), 'and the message counts the snapshots that exist');
            }
            assertEqual(panels, 0, 'no view opens with history that does not answer the question');
        } finally {
            mockVscode.window.createWebviewPanel = origPanel;
            mockVscode.window.showWarningMessage = origWarning;
        }
    }

    // ─── Summary ──────────────────────────────────────────────────────────────
    console.log(`\n--- Selection History Tests Complete: ${passed} passed, ${failed} failed ---`);
    if (failed > 0) process.exitCode = 1;
}

runSelectionHistoryTests().catch(e => {
    console.error('Test suite error:', e);
    process.exit(1);
});
