/**
 * Storage integrity against the real `vscode.workspace.fs`.
 *
 * Orphan detection and migration both rest on what the API does rather than on
 * our own arithmetic: whether `stat` rejects for a file that is not there,
 * what `readDirectory` returns for a store laid out in project subfolders, and
 * whether a copy comes back byte for byte. The mock in `test/mock_vscode.js`
 * encodes those assumptions and cannot disagree with them, so they are checked
 * here, on disk.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vscode = require('vscode');

const OUT = path.resolve(__dirname, '../../../out');
const { HistoryStorage } = require(path.join(OUT, 'storage.js'));

function newStorage(dir) {
    return new HistoryStorage({
        subscriptions: [],
        storageUri: vscode.Uri.file(dir),
        globalStorageUri: vscode.Uri.file(dir),
        extensionUri: vscode.Uri.file(path.resolve(__dirname, '../../..'))
    });
}

describe('storage integrity on a real filesystem', () => {
    let storageDir;
    let storage;
    let projectRoot;

    before(async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-integrity-'));
        storage = newStorage(storageDir);
        await storage.init();

        // The same layout the extension writes: the global root, a per-project
        // subfolder with its index, and one blob per snapshot.
        projectRoot = await storage.getWorkspaceStorageRoot();
        fs.mkdirSync(projectRoot.fsPath, { recursive: true });
        fs.writeFileSync(path.join(projectRoot.fsPath, 'present'), 'the content that is still here');
        fs.writeFileSync(path.join(projectRoot.fsPath, 'index.json'), JSON.stringify({
            snapshots: [
                { id: 'present', timestamp: Date.now(), filePath: 'sample.ts', eventType: 'save', storagePath: 'present' },
                { id: 'missing', timestamp: Date.now() - 1000, filePath: 'sample.ts', eventType: 'save', storagePath: 'missing' },
                { id: 'label', timestamp: Date.now() - 2000, filePath: '', eventType: 'label', label: 'a label holds no content' }
            ]
        }, null, 2));
    });

    after(() => {
        fs.rmSync(storageDir, { recursive: true, force: true });
    });

    it('finds the entry whose blob is absent, and only that one', async () => {
        const reports = await storage.findOrphanedEntries();
        const mine = reports.filter(r => r.rootPath === projectRoot.fsPath);
        assert.strictEqual(mine.length, 1, `expected one report for ${projectRoot.fsPath}, got ${JSON.stringify(reports.map(r => r.rootPath))}`);
        assert.strictEqual(mine[0].total, 1, `expected one orphan, got ${mine[0].total}`);

        const ids = mine[0].files.flatMap(f => f.snapshots.map(s => s.id));
        assert.deepStrictEqual(ids, ['missing'], `wrong entries reported: ${JSON.stringify(ids)}`);
    });

    it('counts every snapshot under a root, walking the project subfolders', async () => {
        const total = await storage.countSnapshotsUnder(vscode.Uri.file(storageDir));
        assert.strictEqual(total, 3, `expected 3 snapshots under the root, counted ${total}`);
    });

    it('copies a store to a new root byte for byte and leaves the original', async () => {
        const target = path.join(os.tmpdir(), `chronos-integrity-target-${Date.now()}`);
        try {
            const result = await storage.migrateStorage(vscode.Uri.file(storageDir), vscode.Uri.file(target));
            assert.deepStrictEqual(result.failed, [], `migration failed: ${JSON.stringify(result.failed)}`);

            const copiedBlob = path.join(target, path.basename(projectRoot.fsPath), 'present');
            assert.strictEqual(fs.readFileSync(copiedBlob, 'utf8'), 'the content that is still here');
            assert.strictEqual(await storage.countSnapshotsUnder(vscode.Uri.file(target)), 3);

            // The source is still the authority until the user removes it.
            assert.ok(fs.existsSync(path.join(projectRoot.fsPath, 'present')));
            assert.ok(fs.existsSync(path.join(projectRoot.fsPath, 'index.json')));
        } finally {
            fs.rmSync(target, { recursive: true, force: true });
        }
    });

    it('flags unavailable content on the history it hands to the UI', async () => {
        const fileUri = vscode.Uri.file(path.resolve(__dirname, '../fixture/sample.ts'));
        const history = await storage.getHistoryForFile(fileUri, true);
        const flagged = history.filter(s => s.contentMissing).map(s => s.id);
        assert.ok(flagged.includes('missing'), `the entry with no blob was not flagged: ${JSON.stringify(history.map(s => [s.id, !!s.contentMissing]))}`);
        assert.ok(!flagged.includes('present'), 'an entry that has its content was flagged as missing');

        // And the flag stays out of the index on disk.
        const onDisk = JSON.parse(fs.readFileSync(path.join(projectRoot.fsPath, 'index.json'), 'utf8'));
        assert.ok(onDisk.snapshots.every(s => s.contentMissing === undefined), 'contentMissing was persisted');
    });
});
