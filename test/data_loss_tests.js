// Regression tests for the four history-loss bugs found in the storage review.
//
// Every case here destroyed history that the user expected to keep, and every
// one of them was silent — no error surfaced in the UI. They are grouped in one
// file because they share a single invariant: Chronos must never drop history
// that it did not explicitly decide to prune.
//
//   1. Size pruning shifted pinned snapshots off the keep list without putting
//      them back, so pinned snapshots vanished and the index could end up empty.
//   2. prune() walked every index loaded from the shared global store, so one
//      project's retention settings pruned every other project's history.
//   3. A label has no stored content. It is matched as history for every file,
//      so asking for the newest snapshot's content threw and aborted the save —
//      after one "Put Label" with no active editor, nothing was recorded again.
//   4. An unreadable index.json was treated like a missing one: an empty index
//      was cached and the next save overwrote the only copy of that history.

const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const { mockVscode, fsStore } = require('./mock_vscode');

Module.prototype.require = function (request) {
    if (request === 'vscode') return mockVscode;
    return originalRequire.apply(this, arguments);
};

const { HistoryStorage } = require('../out/storage');
const { HistoryManager } = require('../out/historyManager');

let failures = 0;

function check(ok, passMsg, failMsg) {
    if (ok) {
        console.log(`✅ ${passMsg}`);
    } else {
        failures++;
        console.error(`❌ ${failMsg}`);
    }
}

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

async function freshStorage() {
    fsStore.clear();
    const storage = new HistoryStorage(new mockVscode.ExtensionContext());
    await storage.init();
    const root = await storage.getWorkspaceStorageRoot();
    const indexUri = mockVscode.Uri.joinPath(root, 'index.json');
    return {
        storage,
        root,
        indexUri,
        writeIndex: (data) => mockVscode.workspace.fs.writeFile(indexUri, enc(JSON.stringify(data, null, 2))),
        writeBlob: (name, content) => mockVscode.workspace.fs.writeFile(mockVscode.Uri.joinPath(root, name), enc(content)),
        blobExists: (name) => fsStore.has(mockVscode.Uri.joinPath(root, name).toString()),
        readIndex: async () => JSON.parse(dec(await mockVscode.workspace.fs.readFile(indexUri)))
    };
}

// --- Test 1: size pruning must never remove pinned snapshots ---
async function testSizePruneKeepsPinned() {
    console.log('\n[Test 1] Size pruning keeps pinned snapshots');
    const s = await freshStorage();
    const now = Date.now();
    const blob = 'x'.repeat(200 * 1024); // 200KB each, 600KB total

    await s.writeIndex({
        snapshots: [
            { id: 'pin-old', timestamp: now - 3000, filePath: 'a.ts', eventType: 'save', storagePath: 'pin-old', pinned: true },
            { id: 'pin-new', timestamp: now - 2000, filePath: 'b.ts', eventType: 'save', storagePath: 'pin-new', pinned: true },
            { id: 'plain', timestamp: now - 1000, filePath: 'c.ts', eventType: 'save', storagePath: 'plain' }
        ]
    });
    await s.writeBlob('pin-old', blob);
    await s.writeBlob('pin-new', blob);
    await s.writeBlob('plain', blob);

    // 0.3MB limit against 0.6MB of content: the limit cannot be met without
    // touching pinned snapshots, so only the unpinned one may be evicted.
    await s.storage.prune(30, 0.3);

    const ids = (await s.readIndex()).snapshots.map(x => x.id);
    check(ids.includes('pin-old') && ids.includes('pin-new'),
        'Pinned snapshots survived size pruning.',
        `Pinned snapshots were pruned. Index now holds: ${JSON.stringify(ids)}`);
    check(!ids.includes('plain'),
        'Unpinned snapshot was evicted to reclaim space.',
        'Unpinned snapshot was not evicted, so pruning did nothing.');
    check(!s.blobExists('plain') && s.blobExists('pin-old') && s.blobExists('pin-new'),
        'Only the evicted snapshot\'s blob was deleted.',
        'Wrong blobs deleted from disk.');
}

// --- Test 2: pruning must not reach into another project's history ---
async function testPruneIsScopedToThisProject() {
    console.log('\n[Test 2] Pruning is scoped to the current project');
    const s = await freshStorage();
    const globalRoot = mockVscode.Uri.joinPath(s.root, '..');

    // Project B shares the global store and is registered for the Diff App.
    const bName = 'project-b';
    const bId = 'deadbeef';
    const bRoot = mockVscode.Uri.joinPath(globalRoot, `${bName}-${bId}`);
    const bIndexUri = mockVscode.Uri.joinPath(bRoot, 'index.json');
    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;

    await mockVscode.workspace.fs.writeFile(
        mockVscode.Uri.joinPath(globalRoot, 'workspaces.json'),
        enc(JSON.stringify({ workspaces: [{ id: bId, name: bName, rootPath: '/other/project-b', lastActivity: Date.now() }] }))
    );
    await mockVscode.workspace.fs.writeFile(bIndexUri, enc(JSON.stringify({
        snapshots: [{ id: 'b-old', timestamp: sixtyDaysAgo, filePath: 'src/b.ts', eventType: 'save', storagePath: 'b-old' }]
    })));
    await mockVscode.workspace.fs.writeFile(mockVscode.Uri.joinPath(bRoot, 'b-old'), enc('project B content'));

    // This project keeps 30 days. Project B's snapshot is 60 days old, but it is
    // not ours to prune.
    await s.writeIndex({ snapshots: [] });
    await s.storage.prune(30, 500);

    const bIndex = JSON.parse(dec(await mockVscode.workspace.fs.readFile(bIndexUri)));
    check(bIndex.snapshots.length === 1 && bIndex.snapshots[0].id === 'b-old',
        'Another project\'s index was left untouched.',
        `Another project's history was pruned: ${JSON.stringify(bIndex.snapshots)}`);
    check(fsStore.has(mockVscode.Uri.joinPath(bRoot, 'b-old').toString()),
        'Another project\'s snapshot content was left on disk.',
        'Another project\'s snapshot content was deleted.');
}

// --- Test 3: an unreadable index must be preserved, never overwritten ---
async function testCorruptIndexIsPreserved() {
    console.log('\n[Test 3] A corrupt index is backed up, not overwritten');
    const s = await freshStorage();
    const truncated = '{"snapshots":[{"id":"precious","timestamp":1,"filePa';
    await mockVscode.workspace.fs.writeFile(s.indexUri, enc(truncated));

    const history = await s.storage.getProjectHistory(true);
    check(history.length === 0, 'Corrupt index yields no snapshots (as before).', 'Unexpected snapshots parsed from corrupt index.');

    const backups = [...fsStore.keys()].filter(k => k.includes('index.corrupt-'));
    check(backups.length === 1,
        'Corrupt index was copied aside.',
        `Expected exactly one index.corrupt-* backup, found ${backups.length}.`);
    check(backups.length === 1 && dec(fsStore.get(backups[0])) === truncated,
        'Backup holds the original bytes.',
        'Backup does not match the original index bytes.');

    // The next save rewrites index.json; the backup must still be intact.
    const doc = {
        uri: mockVscode.Uri.file('/workspace/src/app.ts'),
        fileName: '/workspace/src/app.ts',
        getText: () => 'brand new content'
    };
    await s.storage.saveSnapshot(doc, 'save');

    check(backups.length === 1 && fsStore.has(backups[0]) && dec(fsStore.get(backups[0])) === truncated,
        'Backup survived the next save.',
        'Backup was lost when the index was rewritten.');
    check((await s.readIndex()).snapshots.length === 1,
        'New index recorded the new snapshot.',
        'New snapshot was not recorded after recovering from a corrupt index.');

    // An index that is present but unreadable (locked, permissions, I/O error)
    // must not be treated as "no index yet" either: the save has to fail rather
    // than start from empty and overwrite it.
    const goodIndex = { snapshots: [{ id: 'keep-me', timestamp: Date.now(), filePath: 'app.ts', eventType: 'save', storagePath: 'keep-me' }] };
    await s.writeIndex(goodIndex);

    // A new instance, as a freshly opened window would have: nothing cached, so
    // the index really is read from disk.
    const coldStorage = new HistoryStorage(new mockVscode.ExtensionContext());
    const realReadFile = mockVscode.workspace.fs.readFile;
    mockVscode.workspace.fs.readFile = async (uri) => {
        if (uri.toString() === s.indexUri.toString()) {
            const err = new Error('EBUSY: resource busy or locked');
            err.code = 'Unavailable';
            throw err;
        }
        return realReadFile(uri);
    };
    let threw = false;
    try {
        await coldStorage.saveSnapshot({ ...doc, getText: () => 'content written while the index was locked' }, 'save');
    } catch (e) {
        threw = true;
    }
    mockVscode.workspace.fs.readFile = realReadFile;

    check(threw, 'Save aborted while the index was unreadable.', 'Save proceeded despite an unreadable index.');
    check((await s.readIndex()).snapshots.some(x => x.id === 'keep-me'),
        'Unreadable index was left intact on disk.',
        'Unreadable index was overwritten and its history lost.');
}

// --- Test 4: a label must not stop snapshot capture ---
async function testLabelDoesNotBlockCapture() {
    console.log('\n[Test 4] A label does not block snapshot capture');
    const s = await freshStorage();

    const gitService = { getDiff: async () => '--- a\n+++ b\n@@ -1,1 +1,2 @@\n context\n+added line' };
    const gitIgnoreService = {
        refreshGitIgnorePatterns: () => {},
        clearPatterns: () => {},
        isPathIgnored: () => false
    };
    const manager = new HistoryManager(new mockVscode.ExtensionContext(), s.storage, gitService, gitIgnoreService);

    const doc = {
        uri: mockVscode.Uri.file('/workspace/src/app.ts'),
        fileName: '/workspace/src/app.ts',
        getText: () => 'first version'
    };

    // A baseline as onOpen records it, then a "Put Label..." with no active
    // editor: that stores a label with no file path and no content, which
    // getHistoryForFile returns as history for every file. Timestamps are fixed
    // here so the label is unambiguously the newest entry.
    const now = Date.now();
    await s.writeIndex({
        snapshots: [
            { id: 'base', timestamp: now - 10000, filePath: 'app.ts', eventType: 'manual', label: 'Initial Baseline', storagePath: 'base' },
            { id: 'lbl', timestamp: now - 1000, filePath: '', eventType: 'label', label: 'Before refactor' }
        ]
    });
    await s.writeBlob('base', 'first version');

    const history = await s.storage.getHistoryForFile(doc.uri, true);
    check(history.length > 0 && history[0].eventType === 'label' && !history[0].storagePath,
        'Setup: the content-less label is the newest history entry.',
        `Setup failed: newest entry is ${JSON.stringify(history[0])}`);

    const edited = { ...doc, getText: () => 'second version' };
    await manager.onSave(edited); // private, called directly as the other suites do

    const saves = (await s.storage.getHistoryForFile(doc.uri, true)).filter(x => x.eventType === 'save');
    check(saves.length === 1,
        'Save was recorded even though a label was the newest entry.',
        `Expected 1 "save" snapshot after onSave, found ${saves.length}.`);
}

async function run() {
    console.log('\n--- Chronos History-Loss Regression Tests ---');
    await testSizePruneKeepsPinned();
    await testPruneIsScopedToThisProject();
    await testCorruptIndexIsPreserved();
    await testLabelDoesNotBlockCapture();

    if (failures > 0) {
        console.error(`\n❌ History-loss regression tests FAILED (${failures} check(s)).`);
        process.exit(1);
    }
    console.log('\n✅ All history-loss regression checks passed.');
    process.exit(0);
}

run().catch(e => { console.error('Test crashed:', e); process.exit(1); });
