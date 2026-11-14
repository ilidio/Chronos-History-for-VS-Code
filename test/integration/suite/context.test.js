/**
 * Runs inside a real VS Code, against the real API.
 *
 * The mock-based suites cannot test two things, and both are load-bearing:
 *
 *  1. What a language extension's symbol provider actually returns. Every
 *     DocumentSymbol in test/context_resolver_tests.js was written by hand, so
 *     those tests pass whether or not the assumption behind them is true. Here
 *     the symbols come from the built-in TypeScript language features.
 *  2. That `vscode.diff` really positions the editor when given a selection in
 *     TextDocumentShowOptions — the mechanism the whole "scroll to the range"
 *     feature rests on.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vscode = require('vscode');

// The compiled extension code, loaded in the extension host where `vscode`
// resolves for real.
const { resolveContext } = require(path.resolve(__dirname, '../../../out/utils/contextResolver.js'));

const FIXTURE_DIR = path.resolve(__dirname, '../fixture');
const SAMPLE = path.join(FIXTURE_DIR, 'sample.ts');
const NOTES = path.join(FIXTURE_DIR, 'notes.txt');

/** Line numbers in sample.ts, 0-based. */
const LINES = {
    classStart: 3,
    prefixField: 4,
    greetStart: 6,
    greetBody: 7,
    greetEnd: 13,
    farewellStart: 15,
    farewellBody: 16,
    classEnd: 19,
    standaloneStart: 21,
    standaloneBody: 22,
    standaloneEnd: 24
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * The TypeScript language service answers nothing until it has loaded the
 * project, so a symbol request right after opening the file comes back empty.
 */
async function waitForSymbols(uri, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
        if (Array.isArray(last) && last.length > 0) return last;
        await sleep(500);
    }
    throw new Error('The TypeScript symbol provider never answered for ' + uri.fsPath);
}

function describeRange(context) {
    return `${context.source} ${context.anchor.kind} "${context.anchor.namePath}" ${context.startLine}-${context.endLine}`;
}

describe('resolveContext against the real VS Code API', () => {
    let document;

    before(async () => {
        document = await vscode.workspace.openTextDocument(vscode.Uri.file(SAMPLE));
        await vscode.window.showTextDocument(document);
        const symbols = await waitForSymbols(document.uri);
        console.log(`      (symbol provider answered with ${symbols.length} top-level symbol(s))`);
    });

    it('resolves a cursor in a method body to the whole method', async () => {
        const context = await resolveContext(document, new vscode.Position(LINES.greetBody, 10));

        assert.strictEqual(context.source, 'symbol', describeRange(context));
        assert.strictEqual(context.anchor.namePath, 'Greeter.greet', describeRange(context));
        assert.strictEqual(context.anchor.kind, 'Method', describeRange(context));

        // The assumption the mocks encode: a method's range spans its whole
        // declaration, signature through closing brace — not just the signature.
        assert.strictEqual(context.startLine, LINES.greetStart, describeRange(context));
        assert.strictEqual(context.endLine, LINES.greetEnd, describeRange(context));
        assert.strictEqual(context.anchor.signatureLine, 'public greet(name: string): string {', describeRange(context));
    });

    it('walks out of a field to the enclosing class', async () => {
        const context = await resolveContext(document, new vscode.Position(LINES.prefixField, 8));

        assert.strictEqual(context.anchor.namePath, 'Greeter', describeRange(context));
        assert.strictEqual(context.anchor.kind, 'Class', describeRange(context));
        assert.strictEqual(context.startLine, LINES.classStart, describeRange(context));
        assert.strictEqual(context.endLine, LINES.classEnd, describeRange(context));
    });

    it('widens a selection spanning two methods to the class', async () => {
        const selection = new vscode.Range(LINES.greetBody, 0, LINES.farewellBody, 20);
        const context = await resolveContext(document, selection);

        assert.strictEqual(context.anchor.namePath, 'Greeter', describeRange(context));
        assert.strictEqual(context.startLine, LINES.classStart, describeRange(context));
        assert.strictEqual(context.endLine, LINES.classEnd, describeRange(context));
    });

    it('resolves a top-level function', async () => {
        const context = await resolveContext(document, new vscode.Position(LINES.standaloneBody, 6));

        assert.strictEqual(context.anchor.namePath, 'standalone', describeRange(context));
        assert.strictEqual(context.anchor.kind, 'Function', describeRange(context));
        assert.strictEqual(context.startLine, LINES.standaloneStart, describeRange(context));
        assert.strictEqual(context.endLine, LINES.standaloneEnd, describeRange(context));
    });
});

describe('the folding fallback against the real provider dispatch', () => {
    let notes;

    before(async () => {
        notes = await vscode.workspace.openTextDocument(vscode.Uri.file(NOTES));
        await vscode.window.showTextDocument(notes);
    });

    it('falls back to a registered folding range when there are no symbols', async () => {
        const registration = vscode.languages.registerFoldingRangeProvider(
            { language: 'plaintext' },
            { provideFoldingRanges: () => [new vscode.FoldingRange(0, 3)] }
        );

        try {
            const context = await resolveContext(notes, new vscode.Position(2, 4));
            assert.strictEqual(context.source, 'folding', describeRange(context));
            assert.strictEqual(context.startLine, 0, describeRange(context));
            assert.strictEqual(context.endLine, 3, describeRange(context));
        } finally {
            registration.dispose();
        }
    });

    it('prefers symbols over folding when both answer', async () => {
        // Both providers stay registered: asserting the order this way does not
        // depend on a disposal taking effect, and VS Code keeps serving folding
        // ranges it has already computed for a document.
        const folding = vscode.languages.registerFoldingRangeProvider(
            { language: 'plaintext' },
            { provideFoldingRanges: () => [new vscode.FoldingRange(0, 3)] }
        );
        const symbols = vscode.languages.registerDocumentSymbolProvider(
            { language: 'plaintext' },
            {
                provideDocumentSymbols: () => [new vscode.DocumentSymbol(
                    'IndentedBlock',
                    '',
                    vscode.SymbolKind.Function,
                    new vscode.Range(1, 0, 3, 40),
                    new vscode.Range(1, 4, 1, 20)
                )]
            }
        );

        try {
            const context = await resolveContext(notes, new vscode.Position(2, 4));
            assert.strictEqual(context.source, 'symbol', describeRange(context));
            assert.strictEqual(context.anchor.namePath, 'IndentedBlock', describeRange(context));
            assert.strictEqual(context.startLine, 1, describeRange(context));
            assert.strictEqual(context.endLine, 3, describeRange(context));
        } finally {
            symbols.dispose();
            folding.dispose();
        }
    });

    // The bare case — no provider of either kind — is covered in
    // test/context_resolver_tests.js, where the absence can be guaranteed.
    // Here VS Code keeps serving whatever it has already computed.
});

describe('the reveal mechanism', () => {
    it('vscode.diff positions the editor on the range it is given', async () => {
        // The claim behind "scroll to the range": TextDocumentShowOptions.selection
        // applies to the modified side of a diff editor.
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-diff-'));
        const left = path.join(scratch, 'left.ts');
        const original = fs.readFileSync(SAMPLE, 'utf8');
        fs.writeFileSync(left, original.replace("const doubled = value * 2;", "const doubled = value + value;"));

        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.file(left),
                vscode.Uri.file(SAMPLE),
                'reveal check',
                { selection: new vscode.Range(LINES.greetStart, 0, LINES.greetEnd, 0), preview: true }
            );

            // Give the editor a moment to become active.
            let editor;
            for (let i = 0; i < 20 && !editor; i++) {
                await sleep(250);
                const candidate = vscode.window.activeTextEditor;
                if (candidate && candidate.selection.start.line === LINES.greetStart) editor = candidate;
            }

            assert.ok(editor, 'no editor ended up selecting the requested range');
            assert.strictEqual(editor.selection.start.line, LINES.greetStart);
            assert.strictEqual(editor.selection.end.line, LINES.greetEnd);

            // And the range is actually on screen, which is the whole point.
            const visible = editor.visibleRanges.some(r =>
                r.start.line <= LINES.greetStart && LINES.greetStart <= r.end.line
            );
            assert.ok(visible, `the revealed range is not visible; visibleRanges=${JSON.stringify(editor.visibleRanges)}`);
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });
});

describe('the extension in a real host', () => {
    it('registers the context commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        for (const id of ['chronos.showHistoryForContext', 'chronos.gitHistoryForContext',
                          'chronos.showHistoryForSelection', 'chronos.gitHistoryForSelection']) {
            assert.ok(commands.includes(id), `${id} is not registered`);
        }
    });
});
