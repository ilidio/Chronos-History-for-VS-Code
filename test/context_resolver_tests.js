/**
 * Context Resolver Tests
 * Verifies the resolveContext() layer behind "Show History for Context":
 *  - picks the innermost *block* symbol (function/method/class), not a variable
 *  - widens to the enclosing block when the selection spans several symbols
 *  - handles flat SymbolInformation results (containerName)
 *  - falls back to folding ranges, then to the selection itself
 *  - the two new commands are registered and run end-to-end
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
const { mockVscode, commandsMap } = require('./mock_vscode');
const EventEmitter = require('events');

// ─── Mock child_process (git) ────────────────────────────────────────────────
const mockSpawn = (cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => {
        if (args.includes('diff')) {
            proc.stdout.emit('data',
                '--- a/file\n' +
                '+++ b/file\n' +
                '@@ -6,1 +6,1 @@\n' +
                '-old line 6\n' +
                '+new line 6\n'
            );
        } else if (args.includes('log')) {
            proc.stdout.emit('data', '');
        }
        proc.emit('close', 0);
    }, 5);
    return proc;
};

Module.prototype.require = function(request) {
    if (request === 'vscode') return mockVscode;
    if (request === 'child_process') return { spawn: mockSpawn };
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

const SymbolKind = mockVscode.SymbolKind;
const DOC_URI = mockVscode.Uri.file('/workspace/target.ts');

/**
 * 21-line stand-in for a file:
 *   0  import x
 *   1  (blank)
 *   2  class MyClass {
 *   3    field = 1;
 *   4  (blank)
 *   5    render() {
 *   6      const inner = 1;
 *   ...
 *   12   }
 *   13   other() {
 *   ...
 *   18   }
 *   19 }
 *   20 (blank)
 */
function makeDoc() {
    const lines = [
        'import x from "y";',
        '',
        'class MyClass {',
        '    field = 1;',
        '',
        '    render() {',
        '        const inner = 1;',
        '        use(inner);',
        '        use(inner);',
        '        use(inner);',
        '        use(inner);',
        '        return inner;',
        '    }',
        '    other() {',
        '        return 2;',
        '        // pad',
        '        // pad',
        '        // pad',
        '    }',
        '}',
        ''
    ];
    const text = lines.join('\n');
    return {
        uri: DOC_URI,
        lineCount: lines.length,
        getText: () => text
    };
}

const range = (sl, sc, el, ec) => new mockVscode.Range(sl, sc, el, ec);

/** Nested DocumentSymbol tree: MyClass > { field, render > inner, other }. */
function nestedSymbols() {
    return [{
        name: 'MyClass',
        kind: SymbolKind.Class,
        range: range(2, 0, 19, 1),
        children: [
            { name: 'field', kind: SymbolKind.Property, range: range(3, 4, 3, 14), children: [] },
            {
                name: 'render',
                kind: SymbolKind.Method,
                range: range(5, 4, 12, 5),
                children: [
                    { name: 'inner', kind: SymbolKind.Variable, range: range(6, 8, 6, 24), children: [] }
                ]
            },
            { name: 'other', kind: SymbolKind.Method, range: range(13, 4, 18, 5), children: [] }
        ]
    }];
}

function provideSymbols(symbols) {
    commandsMap.set('vscode.executeDocumentSymbolProvider', () => symbols);
}
function provideFolding(folds) {
    commandsMap.set('vscode.executeFoldingRangeProvider', () => folds);
}
function clearProviders() {
    commandsMap.delete('vscode.executeDocumentSymbolProvider');
    commandsMap.delete('vscode.executeFoldingRangeProvider');
}

// ─── Tests ───────────────────────────────────────────────────────────────────
async function runContextResolverTests() {
    console.log('\n--- Starting Context Resolver Tests ---\n');

    const { resolveContext, resolveContextForEditor } = require('../out/utils/contextResolver');
    const doc = makeDoc();

    // Test 1 — cursor inside a variable resolves to the enclosing method
    console.log('[Test 1] Cursor on a variable resolves to the enclosing method');
    clearProviders();
    provideSymbols(nestedSymbols());
    let ctx = await resolveContext(doc, new mockVscode.Position(6, 14));
    assertEqual(ctx.source, 'symbol', 'source is symbol');
    assertEqual(ctx.anchor.namePath, 'MyClass.render', 'namePath is the dotted chain');
    assertEqual(ctx.anchor.kind, 'Method', 'kind is Method');
    assertEqual(ctx.startLine, 5, 'startLine is the method start');
    assertEqual(ctx.endLine, 12, 'endLine is the method end');
    assertEqual(ctx.anchor.signatureLine, 'render() {', 'signatureLine is the first non-blank line');
    assertEqual(ctx.label, 'MyClass.render', 'label is the namePath');
    assert(ctx.range.start.line === 5 && ctx.range.end.line === 12, 'range covers the method');
    assert(ctx.range.end.character > 0, 'range end is not an exclusive line start');

    // Test 2 — cursor between members resolves to the class
    console.log('\n[Test 2] Cursor on a class field resolves to the class');
    ctx = await resolveContext(doc, new mockVscode.Position(3, 6));
    assertEqual(ctx.anchor.namePath, 'MyClass', 'namePath is the class');
    assertEqual(ctx.anchor.kind, 'Class', 'kind is Class');
    assertEqual(ctx.startLine, 2, 'startLine is the class start');

    // Test 3 — a selection spanning two methods widens to the class
    console.log('\n[Test 3] Selection spanning two methods widens to the class');
    ctx = await resolveContext(doc, range(8, 0, 15, 10));
    assertEqual(ctx.anchor.namePath, 'MyClass', 'namePath is the enclosing class');
    assertEqual(ctx.startLine, 2, 'startLine is the class start');
    assertEqual(ctx.endLine, 19, 'endLine is the class end');

    // Test 4 — flat SymbolInformation results use containerName
    console.log('\n[Test 4] Flat SymbolInformation results use containerName');
    provideSymbols([
        { name: 'MyClass', kind: SymbolKind.Class, containerName: '', location: { uri: DOC_URI, range: range(2, 0, 19, 1) } },
        { name: 'render', kind: SymbolKind.Method, containerName: 'MyClass', location: { uri: DOC_URI, range: range(5, 4, 12, 5) } },
        { name: 'other', kind: SymbolKind.Method, containerName: 'MyClass', location: { uri: DOC_URI, range: range(13, 4, 18, 5) } }
    ]);
    ctx = await resolveContext(doc, new mockVscode.Position(7, 8));
    assertEqual(ctx.source, 'symbol', 'source is symbol');
    assertEqual(ctx.anchor.namePath, 'MyClass.render', 'namePath prepends the container');
    assertEqual(ctx.startLine, 5, 'startLine is the method start');

    // Test 5 — trailing blank lines are trimmed off the block
    console.log('\n[Test 5] Trailing blank lines are trimmed off the block');
    provideSymbols([{ name: 'padded', kind: SymbolKind.Function, range: range(2, 0, 20, 0), children: [] }]);
    ctx = await resolveContext(doc, new mockVscode.Position(3, 0));
    assertEqual(ctx.endLine, 19, 'endLine skips the trailing blank line');
    assert(ctx.range.end.character > 0, 'range end lands on real content');

    // Test 6 — no symbol provider falls back to folding ranges
    console.log('\n[Test 6] No symbol provider falls back to folding ranges');
    clearProviders();
    provideFolding([
        new mockVscode.FoldingRange(2, 19),
        new mockVscode.FoldingRange(5, 12),
        new mockVscode.FoldingRange(13, 18)
    ]);
    ctx = await resolveContext(doc, new mockVscode.Position(6, 0));
    assertEqual(ctx.source, 'folding', 'source is folding');
    assertEqual(ctx.startLine, 5, 'startLine is the innermost fold start');
    assertEqual(ctx.endLine, 12, 'endLine is the innermost fold end');
    assertEqual(ctx.anchor.namePath, '', 'namePath is empty without symbols');
    assertEqual(ctx.label, 'lines 6-13', 'label falls back to the line range');

    // Test 7 — empty symbol results fall through to folding
    console.log('\n[Test 7] Empty symbol results fall through to folding');
    provideSymbols([]);
    ctx = await resolveContext(doc, new mockVscode.Position(6, 0));
    assertEqual(ctx.source, 'folding', 'source is folding');
    assertEqual(ctx.startLine, 5, 'startLine is the innermost fold start');

    // Test 8 — no providers at all falls back to the selection
    console.log('\n[Test 8] No providers at all falls back to the selection');
    clearProviders();
    ctx = await resolveContext(doc, range(3, 2, 8, 4));
    assertEqual(ctx.source, 'selection', 'source is selection');
    assertEqual(ctx.startLine, 3, 'startLine is the selection start');
    assertEqual(ctx.endLine, 8, 'endLine is the selection end');

    // Test 9 — a bare cursor with no providers resolves to its own line
    console.log('\n[Test 9] Bare cursor with no providers resolves to its own line');
    ctx = await resolveContext(doc, new mockVscode.Position(6, 3));
    assertEqual(ctx.startLine, 6, 'startLine is the cursor line');
    assertEqual(ctx.endLine, 6, 'endLine is the cursor line');
    assertEqual(ctx.label, 'lines 7-7', 'label names the single line');

    // Test 10 — an exclusive selection end does not leak an extra line
    console.log('\n[Test 10] Exclusive selection end does not leak an extra line');
    ctx = await resolveContext(doc, range(3, 0, 9, 0));
    assertEqual(ctx.endLine, 8, 'endLine drops the exclusive end line');

    // Test 11 — resolveContextForEditor uses the selection, else the cursor
    console.log('\n[Test 11] resolveContextForEditor uses the selection, else the cursor');
    provideSymbols(nestedSymbols());
    const selection = range(6, 0, 7, 5);
    selection.active = new mockVscode.Position(7, 5);
    ctx = await resolveContextForEditor({ document: doc, selection });
    assertEqual(ctx.anchor.namePath, 'MyClass.render', 'selection resolves to the method');

    const caret = range(14, 4, 14, 4);
    caret.active = new mockVscode.Position(14, 4);
    ctx = await resolveContextForEditor({ document: doc, selection: caret });
    assertEqual(ctx.anchor.namePath, 'MyClass.other', 'empty selection resolves from the cursor');

    // Test 12 — both new commands are registered and run end-to-end
    console.log('\n[Test 12] showHistoryForContext / gitHistoryForContext run end-to-end');
    const extension = require('../out/extension');
    extension.activate(new mockVscode.ExtensionContext());

    const rootUri = mockVscode.Uri.file('/globalStorage');
    const snapshots = [
        { id: 'ctx-snap-b', timestamp: 2000, filePath: 'target.ts', eventType: 'save', storagePath: 'ctx-snap-b' },
        { id: 'ctx-snap-a', timestamp: 1000, filePath: 'target.ts', eventType: 'save', storagePath: 'ctx-snap-a' }
    ];
    await mockVscode.workspace.fs.writeFile(
        mockVscode.Uri.joinPath(rootUri, 'index.json'),
        new TextEncoder().encode(JSON.stringify({ snapshots }))
    );
    for (const snap of snapshots) {
        await mockVscode.workspace.fs.writeFile(
            mockVscode.Uri.joinPath(rootUri, snap.id),
            new TextEncoder().encode(makeDoc().getText())
        );
    }
    await mockVscode.workspace.fs.writeFile(DOC_URI, new TextEncoder().encode(makeDoc().getText()));

    const editorSelection = range(6, 0, 6, 0);
    editorSelection.active = new mockVscode.Position(6, 0);
    mockVscode.window.activeTextEditor = { document: makeDoc(), selection: editorSelection };

    const statusMessages = [];
    const originalStatus = mockVscode.window.setStatusBarMessage;
    mockVscode.window.setStatusBarMessage = (msg) => { statusMessages.push(String(msg)); };

    try {
        const localCmd = commandsMap.get('chronos.showHistoryForContext');
        assert(typeof localCmd === 'function', 'chronos.showHistoryForContext is registered');
        if (localCmd) {
            await localCmd();
            await new Promise(r => setTimeout(r, 50));
        }

        const gitCmd = commandsMap.get('chronos.gitHistoryForContext');
        assert(typeof gitCmd === 'function', 'chronos.gitHistoryForContext is registered');
        if (gitCmd) {
            await gitCmd();
            await new Promise(r => setTimeout(r, 50));
        }

        assert(
            statusMessages.some(m => m.includes('MyClass.render')),
            'the resolved context is announced to the user'
        );
    } finally {
        mockVscode.window.setStatusBarMessage = originalStatus;
    }

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log(`\n--- Context Resolver Tests: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exit(1);
}

runContextResolverTests().catch(e => {
    console.error('Test suite error:', e);
    process.exit(1);
});
