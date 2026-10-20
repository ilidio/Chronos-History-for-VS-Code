/**
 * "Show History for Context" over a store whose content is partly gone.
 *
 * This is the case the whole storage-integrity work came from, and it can only
 * be checked here: `git diff --no-index` against a path that does not exist
 * resolves to *no output*, which the range walk reads as "nothing changed in
 * this block". A hand-written mock cannot disagree with that assumption, and it
 * is what made the command answer "none of the N snapshots changed <block>"
 * when the truth was that it could not read them.
 *
 * The extension under test is pointed at a throwaway store through
 * `chronos.customStoragePath`, the way a user would, so the real command path
 * runs against it.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vscode = require('vscode');

const OUT = path.resolve(__dirname, '../../../out');
const { HistoryStorage } = require(path.join(OUT, 'storage.js'));
const { withAnchoringLabels } = require(path.join(OUT, 'utils/rangeLabel.js'));

const SCRATCH = path.join(path.resolve(__dirname, '../fixture'), 'availability.ts');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function version(body) {
    return [
        'export class Cart {',
        '    public addItem(sku: string): number {',
        `        ${body}`,
        '        return 1;',
        '    }',
        '}',
        ''
    ].join('\n');
}

async function setContent(uri, text) {
    if (!fs.existsSync(uri.fsPath)) fs.writeFileSync(uri.fsPath, text);
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, doc.lineCount + 1, 0), text);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    return doc;
}

function diffTabs() {
    return vscode.window.tabGroups.all
        .flatMap(g => g.tabs)
        .filter(t => t.input && t.input.original && t.input.modified)
        .map(t => t.label);
}

describe('history for a context when snapshot content is missing', () => {
    const uri = vscode.Uri.file(SCRATCH);
    let storeDir, storage, projectRoot, snaps = [];

    // The suite runs inside the extension host and shares the `vscode` module
    // with the extension, so these capture what the user would be shown.
    // Without them the commands sit waiting for a click that never comes.
    const notices = [];
    const real = {};
    function capture() {
        real.warn = vscode.window.showWarningMessage;
        real.info = vscode.window.showInformationMessage;
        real.error = vscode.window.showErrorMessage;
        real.status = vscode.window.setStatusBarMessage;
        vscode.window.showWarningMessage = async (msg) => { notices.push(['warn', msg]); };
        vscode.window.showInformationMessage = async (msg) => { notices.push(['info', msg]); };
        vscode.window.showErrorMessage = async (msg) => { notices.push(['error', msg]); };
        vscode.window.setStatusBarMessage = (msg) => { notices.push(['status', msg]); return { dispose() {} }; };
    }
    function restore() {
        vscode.window.showWarningMessage = real.warn;
        vscode.window.showInformationMessage = real.info;
        vscode.window.showErrorMessage = real.error;
        vscode.window.setStatusBarMessage = real.status;
    }
    const said = (kind) => notices.filter(n => n[0] === kind).map(n => n[1]).join(' ');

    async function openContextHistory() {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(2, 10, 2, 10);
        notices.length = 0;
        await vscode.commands.executeCommand('chronos.showHistoryForContext');
        await sleep(2000);
    }

    before(async () => {
        storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-availability-'));
        const config = () => vscode.workspace.getConfiguration('chronos');
        await config().update('customStoragePath', storeDir, vscode.ConfigurationTarget.Global);
        // The live extension watches this store too. Its own capture is off so
        // the index holds exactly the versions set up here; the commands still
        // read the same store.
        await config().update('enabled', false, vscode.ConfigurationTarget.Global);
        await sleep(1500);

        storage = new HistoryStorage({ subscriptions: [], extensionUri: vscode.Uri.file(path.resolve(__dirname, '../../..')) });
        await storage.init();
        assert.strictEqual(storage.getGlobalRoot().fsPath, storeDir, 'the storage root did not follow the setting');

        let doc = await setContent(uri, version('const a = 1;'));
        await vscode.window.showTextDocument(doc);
        await storage.saveSnapshot(doc, 'save', 'v1 baseline');
        await sleep(500);
        doc = await setContent(uri, version('const a = 2;'));
        await storage.saveSnapshot(doc, 'save', 'v2 addItem changed');
        await sleep(500);
        doc = await setContent(uri, version('const a = 3;'));
        await storage.saveSnapshot(doc, 'save', 'v3 addItem changed again');
        await sleep(500);

        projectRoot = await storage.getWorkspaceStorageRoot();
        snaps = (await storage.getHistoryForFile(uri, true)).filter(s => s.storagePath);
        assert.ok(snaps.length >= 3, `expected at least three stored snapshots, got ${snaps.length}`);

        // Everything but the newest loses its content: the shape of a store
        // whose index outlived its blobs.
        for (const s of snaps.slice(1)) {
            fs.rmSync(path.join(projectRoot.fsPath, s.storagePath), { force: true });
        }
        capture();
    });

    after(async () => {
        restore();
        const config = () => vscode.workspace.getConfiguration('chronos');
        await config().update('customStoragePath', undefined, vscode.ConfigurationTarget.Global);
        await config().update('enabled', undefined, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        fs.rmSync(storeDir, { recursive: true, force: true });
        fs.rmSync(SCRATCH, { force: true });
    });

    it('flags the unreadable versions in what the panel is handed', async () => {
        const rows = withAnchoringLabels(await storage.getHistoryForFile(uri, true));
        const flagged = rows.filter(r => r.contentMissing);
        const intact = rows.filter(r => r.storagePath && !r.contentMissing);

        assert.strictEqual(flagged.length, snaps.length - 1, `expected ${snaps.length - 1} flagged, got ${flagged.length}`);
        assert.strictEqual(intact.length, 1, 'exactly one version still has its content');
        assert.strictEqual(intact[0].id, snaps[0].id, 'the intact one is not the newest');
        assert.ok(flagged.every(r => r.availabilityLabel === 'content unavailable'));
        assert.ok(intact.every(r => !r.availabilityLabel));
    });

    it('shows the versions it can read and says the rest could not be read', async () => {
        await openContextHistory();

        assert.match(said('status'), /could not be read/,
            `the incomplete result was not flagged: ${JSON.stringify(notices)}`);
        // The old answer was that nothing changed the block, which is false:
        // two of the three versions simply cannot be compared.
        assert.doesNotMatch(said('warn'), /none of the \d+ snapshots/,
            `the false "nothing changed this block" message was shown: ${said('warn')}`);
    });

    it('opens no diff for a version whose content is gone, and still opens the intact one', async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await sleep(400);
        const before = diffTabs();
        notices.length = 0;

        await vscode.commands.executeCommand('_chronos.openDiff', snaps[snaps.length - 1], SCRATCH, undefined);
        await sleep(1200);
        assert.deepStrictEqual(diffTabs(), before, 'a diff editor opened for content that is not there');
        assert.match(said('warn'), /no longer in storage/, `the user was not told why: ${JSON.stringify(notices)}`);

        await vscode.commands.executeCommand('_chronos.openDiff', snaps[0], SCRATCH, undefined);
        await sleep(1500);
        assert.ok(diffTabs().length > before.length, 'the intact version did not open a diff either');
    });

    it('says the versions cannot be read when none of them can', async () => {
        // Take the last blob away too: now nothing can be compared, so there is
        // no panel to show and the message has to carry the whole answer.
        fs.rmSync(path.join(projectRoot.fsPath, snaps[0].storagePath), { force: true });

        await openContextHistory();

        assert.match(said('warn'), /cannot be read/, `the message did not say the versions cannot be read: ${said('warn')}`);
        assert.match(said('warn'), /no longer in storage/, `the message did not say why: ${said('warn')}`);
        assert.doesNotMatch(said('warn'), /none of the \d+ snapshots of this file changed/,
            `the old, false message is still shown: ${said('warn')}`);
    });

    it('counts the same versions as orphaned in diagnostics', async () => {
        const report = await storage.runDiagnostics();
        assert.match(report, new RegExp(`Orphaned Entries: ${snaps.length}`), `diagnostics did not count them:\n${report}`);
        assert.match(report, /availability\.ts: \d+/, 'diagnostics did not name the file');
    });
});
