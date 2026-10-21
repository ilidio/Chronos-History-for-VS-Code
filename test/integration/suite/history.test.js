/**
 * The whole chain, in a real VS Code: real document symbols decide the range,
 * real snapshots are written to disk, a real `git diff` compares them, and the
 * filter decides which versions touched the block.
 *
 * This is the behaviour behind "Show History for Context" — the one that looked
 * like it showed nothing — verified without anyone clicking.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vscode = require('vscode');

const OUT = path.resolve(__dirname, '../../../out');
const { resolveContext } = require(path.join(OUT, 'utils/contextResolver.js'));
const { HistoryStorage } = require(path.join(OUT, 'storage.js'));
const { HistoryFilter } = require(path.join(OUT, 'historyFilter.js'));
const { GitService } = require(path.join(OUT, 'git/gitService.js'));

const FIXTURE_DIR = path.resolve(__dirname, '../fixture');
const SCRATCH = path.join(FIXTURE_DIR, 'scratch.ts');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function version(greetBody, farewellBody) {
    return [
        'export class Greeter {',
        '    private prefix = \'Hello\';',
        '',
        '    public greet(name: string): string {',
        `        ${greetBody}`,
        '        return this.prefix;',
        '    }',
        '',
        '    public farewell(name: string): string {',
        `        ${farewellBody}`,
        '        return \'bye\';',
        '    }',
        '}',
        ''
    ].join('\n');
}

/** Writes through the editor so the open document stays authoritative. */
async function setContent(uri, text) {
    // openTextDocument refuses a path that is not there yet, so the first
    // version has to land on disk before the editor can own the file.
    if (!fs.existsSync(uri.fsPath)) fs.writeFileSync(uri.fsPath, text);

    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, doc.lineCount + 1, 0), text);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    return doc;
}

async function waitForSymbols(uri, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
        if (Array.isArray(symbols) && symbols.length > 0) return symbols;
        await sleep(500);
    }
    throw new Error('no symbols for ' + uri.fsPath);
}

describe('history for a context, end to end', () => {
    const uri = vscode.Uri.file(SCRATCH);
    let storageDir;
    let storage;
    let snapshots = [];

    before(async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-store-'));
        // The throwaway profile has no user settings, so customStoragePath is
        // empty and storage lands in the context path given here.
        storage = new HistoryStorage({
            subscriptions: [],
            storageUri: vscode.Uri.file(storageDir),
            globalStorageUri: vscode.Uri.file(storageDir),
            extensionUri: vscode.Uri.file(path.resolve(__dirname, '../../..'))
        });

        // Three versions: the first is the starting point, the second changes
        // only greet(), the third only farewell().
        let doc = await setContent(uri, version('const a = 1;', 'const b = 1;'));
        await vscode.window.showTextDocument(doc);
        await waitForSymbols(uri);
        snapshots.push(await storage.saveSnapshot(doc, 'save', 'v1 baseline'));

        doc = await setContent(uri, version('const a = 2;', 'const b = 1;'));
        snapshots.push(await storage.saveSnapshot(doc, 'save', 'v2 greet changed'));

        doc = await setContent(uri, version('const a = 2;', 'const b = 99;'));
        snapshots.push(await storage.saveSnapshot(doc, 'save', 'v3 farewell changed'));

        assert.ok(snapshots.every(Boolean), `a snapshot was skipped: ${JSON.stringify(snapshots.map(s => !!s))}`);
    });

    after(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        fs.rmSync(storageDir, { recursive: true, force: true });
        fs.rmSync(SCRATCH, { force: true });
    });

    it('lists only the versions where the resolved block changed', async () => {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        await waitForSymbols(uri);

        // The range comes from the real symbol provider, not from a fixture.
        const context = await resolveContext(document, new vscode.Position(4, 10));
        assert.strictEqual(context.anchor.namePath, 'Greeter.greet', JSON.stringify(context.anchor));

        const history = await storage.getHistoryForFile(uri);
        assert.strictEqual(history.length, 3, `expected three snapshots, got ${history.length}`);

        const filter = new HistoryFilter(storage, new GitService());
        const filtered = await filter.filterHistoryForSelection(
            history, uri, context.range, { signatureLine: context.anchor.signatureLine }
        );

        const labels = filtered.map(s => s.label);
        assert.ok(filtered.length > 0, 'the block has history, so the list must not be empty');
        assert.ok(labels.includes('v2 greet changed'), `the version that changed greet() is missing: ${labels}`);
        assert.ok(
            !labels.includes('v3 farewell changed'),
            `the version that only changed farewell() should not be listed: ${labels}`
        );
    });

    it('runs the command itself without failing', async () => {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(4, 10, 4, 10);

        // The extension's own storage is elsewhere in this profile, so this only
        // asserts the command path survives a real invocation.
        await vscode.commands.executeCommand('chronos.showHistoryForContext');
        await sleep(500);
    });
});
