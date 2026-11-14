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
//   5. The index outlived its blobs: entries were listed and offered as if they
//      were openable, with no way to see how many were broken or clear them.
//   6. Changing the storage root moved nothing and warned about nothing, so all
//      history recorded under the old root silently stopped being found.
//   7. prune() deleted the blobs before writing the index, and a failed index
//      write was logged and swallowed: the entries stayed, their content was
//      gone, and nothing said so. This is what produced 21 broken entries in a
//      real store, all of them past the retention cutoff.

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


// --- Test 5: orphaned entries are counted and listed, never guessed at ---
async function testOrphanDetection() {
    console.log('\n[Test 5] Orphaned entries are detected and grouped by file');
    const s = await freshStorage();
    const now = Date.now();

    await s.writeIndex({
        snapshots: [
            { id: 'good', timestamp: now - 1000, filePath: 'src/cart.js', eventType: 'save', storagePath: 'good' },
            { id: 'gone-1', timestamp: now - 2000, filePath: 'src/cart.js', eventType: 'save', storagePath: 'gone-1' },
            { id: 'gone-2', timestamp: now - 3000, filePath: 'src/cart.js', eventType: 'save', storagePath: 'gone-2' },
            { id: 'gone-3', timestamp: now - 4000, filePath: 'src/other.js', eventType: 'save', storagePath: 'gone-3' },
            { id: 'lbl', timestamp: now - 5000, filePath: '', eventType: 'label', label: 'Before refactor' }
        ]
    });
    await s.writeBlob('good', 'the only content still on disk');

    const reports = await s.storage.findOrphanedEntries();
    check(reports.length === 1 && reports[0].own === true,
        'One report, for this project\'s own index.',
        `Expected one own-index report, got ${JSON.stringify(reports.map(r => [r.rootPath, r.own, r.total]))}`);

    const report = reports[0] || { total: 0, files: [] };
    check(report.total === 3,
        'All three entries without content were counted.',
        `Expected 3 orphans, found ${report.total}.`);

    const cart = report.files.find(f => f.filePath === 'src/cart.js');
    const other = report.files.find(f => f.filePath === 'src/other.js');
    check(!!cart && cart.snapshots.length === 2 && !!other && other.snapshots.length === 1,
        'Orphans are grouped per file.',
        `Wrong grouping: ${JSON.stringify(report.files.map(f => [f.filePath, f.snapshots.length]))}`);

    const reportedIds = report.files.flatMap(f => f.snapshots.map(x => x.id));
    check(!reportedIds.includes('good') && !reportedIds.includes('lbl'),
        'The entry with content and the content-less label are not orphans.',
        `Reported entries that are not orphans: ${JSON.stringify(reportedIds)}`);

    // The UI reads history through getHistoryForFile, which flags the entries
    // it cannot open so they are shown as unavailable rather than offered.
    const history = await s.storage.getHistoryForFile(mockVscode.Uri.file('/workspace/src/cart.js'), true);
    const flagged = history.filter(x => x.contentMissing).map(x => x.id);
    check(flagged.includes('gone-1') && flagged.includes('gone-2') && !flagged.includes('good') && !flagged.includes('lbl'),
        'History entries with no content are flagged as unavailable.',
        `Wrong contentMissing flags: ${JSON.stringify(history.map(x => [x.id, !!x.contentMissing]))}`);

    // The flag is a read-time judgement about disk, never a record on disk:
    // the content may be a remount away.
    const onDisk = (await s.readIndex()).snapshots;
    check(onDisk.every(x => x.contentMissing === undefined),
        'The flag was not written into the index.',
        'contentMissing was persisted to the index.');

    // The label the webviews render comes from the same flag.
    const { withAnchoringLabels } = require('../out/utils/rangeLabel');
    const labelled = withAnchoringLabels(history);
    check(labelled.find(x => x.id === 'gone-1').availabilityLabel === 'content unavailable' &&
          labelled.find(x => x.id === 'good').availabilityLabel === undefined,
        'Only unavailable entries get a label for the UI.',
        `Wrong availability labels: ${JSON.stringify(labelled.map(x => [x.id, x.availabilityLabel]))}`);

    // The diagnostics report is how the user sees this before deciding.
    const diag = await s.storage.runDiagnostics();
    check(diag.includes('Orphaned Entries: 3') && diag.includes('src/cart.js: 2'),
        'Diagnostics states the count and names the files.',
        `Diagnostics did not report the orphans:\n${diag}`);
}

// --- Test 6: cleanup removes only the broken entries ---
async function testOrphanCleanupPreservesGoodEntries() {
    console.log('\n[Test 6] Orphan cleanup preserves every entry that still has content');
    const s = await freshStorage();
    const now = Date.now();

    await s.writeIndex({
        snapshots: [
            { id: 'good', timestamp: now - 1000, filePath: 'src/cart.js', eventType: 'save', storagePath: 'good' },
            { id: 'pinned-gone', timestamp: now - 1500, filePath: 'src/cart.js', eventType: 'save', storagePath: 'pinned-gone', pinned: true },
            { id: 'gone', timestamp: now - 2000, filePath: 'src/cart.js', eventType: 'save', storagePath: 'gone' },
            { id: 'reappeared', timestamp: now - 2500, filePath: 'src/cart.js', eventType: 'save', storagePath: 'reappeared' },
            { id: 'lbl', timestamp: now - 3000, filePath: '', eventType: 'label', label: 'Before refactor' }
        ]
    });
    await s.writeBlob('good', 'still here');

    const reports = await s.storage.findOrphanedEntries();
    check(reports[0] && reports[0].total === 3,
        'Setup: three entries reported as orphaned.',
        `Setup failed: ${JSON.stringify(reports)}`);

    // Between the report and the confirmation the content of one entry turns up
    // again — a drive that remounted, a copy that finished. Removal re-checks
    // disk, so that entry must survive.
    await s.writeBlob('reappeared', 'content found after all');

    const { removed, keptWithContent } = await s.storage.removeOrphanedEntries(reports);
    check(removed === 2 && keptWithContent === 1,
        'Removed the two still-missing entries and kept the one that reappeared.',
        `Expected removed=2 keptWithContent=1, got removed=${removed} keptWithContent=${keptWithContent}.`);

    const ids = (await s.readIndex()).snapshots.map(x => x.id);
    check(ids.includes('good') && ids.includes('lbl') && ids.includes('reappeared'),
        'Entries with content and the label were all kept.',
        `Good entries were lost. Index now holds: ${JSON.stringify(ids)}`);
    check(!ids.includes('gone') && !ids.includes('pinned-gone'),
        'Both entries with no content were dropped, pinned included.',
        `Orphans survived the cleanup: ${JSON.stringify(ids)}`);
    check(s.blobExists('good') && s.blobExists('reappeared'),
        'No content was deleted from disk.',
        'Cleanup deleted snapshot content it should not have touched.');
}

// --- Test 7: cleanup must not reach into another project's index ---
async function testOrphanCleanupIsScopedToThisProject() {
    console.log('\n[Test 7] Orphans in another project\'s index are reported, not removed');
    const s = await freshStorage();
    const globalRoot = mockVscode.Uri.joinPath(s.root, '..');
    const bRoot = mockVscode.Uri.joinPath(globalRoot, 'project-b-deadbeef');
    const bIndexUri = mockVscode.Uri.joinPath(bRoot, 'index.json');

    await mockVscode.workspace.fs.writeFile(
        mockVscode.Uri.joinPath(globalRoot, 'workspaces.json'),
        enc(JSON.stringify({ workspaces: [{ id: 'deadbeef', name: 'project-b', rootPath: '/other/project-b', lastActivity: Date.now() }] }))
    );
    await mockVscode.workspace.fs.writeFile(bIndexUri, enc(JSON.stringify({
        snapshots: [{ id: 'b-gone', timestamp: Date.now(), filePath: 'src/b.ts', eventType: 'save', storagePath: 'b-gone' }]
    })));
    await s.writeIndex({ snapshots: [] });

    const reports = await s.storage.findOrphanedEntries();
    const bReport = reports.find(r => r.rootPath === bRoot.fsPath);
    check(!!bReport && bReport.own === false,
        'Another project\'s orphans are reported, flagged as not ours.',
        `Expected a foreign report for ${bRoot.fsPath}, got ${JSON.stringify(reports.map(r => [r.rootPath, r.own]))}`);

    // Only the reports the caller passes in are acted on; the command passes
    // its own. Removing "all reports" must still not be what happens here.
    await s.storage.removeOrphanedEntries(reports.filter(r => r.own));

    const bIndex = JSON.parse(dec(await mockVscode.workspace.fs.readFile(bIndexUri)));
    check(bIndex.snapshots.length === 1,
        'Another project\'s index was left untouched.',
        `Another project's entries were removed: ${JSON.stringify(bIndex.snapshots)}`);
}

// --- Test 8: changing the storage root must not lose history silently ---
async function testStorageRootChangeKeepsHistory() {
    console.log('\n[Test 8] Changing the storage root copies history and keeps the original');
    const s = await freshStorage();
    const oldGlobal = mockVscode.Uri.joinPath(s.root, '..');
    const newGlobal = mockVscode.Uri.file('/elsewhere/.chronos-history');

    await s.writeIndex({
        snapshots: [
            { id: 'a', timestamp: Date.now(), filePath: 'src/cart.js', eventType: 'save', storagePath: 'a' },
            { id: 'b', timestamp: Date.now() - 1000, filePath: 'src/cart.js', eventType: 'save', storagePath: 'b' }
        ]
    });
    await s.writeBlob('a', 'version a');
    await s.writeBlob('b', 'version b');
    await mockVscode.workspace.fs.writeFile(
        mockVscode.Uri.joinPath(oldGlobal, 'workspaces.json'),
        enc(JSON.stringify({ workspaces: [] }))
    );

    // What the user has to be told before the setting changes.
    const leftBehind = await s.storage.countSnapshotsUnder(oldGlobal);
    check(leftBehind === 2,
        'The snapshots that would be left behind are counted before the switch.',
        `Expected 2 snapshots under the old root, counted ${leftBehind}.`);

    // A file already at the destination is never overwritten.
    const collision = mockVscode.Uri.joinPath(newGlobal, 'workspaces.json');
    await mockVscode.workspace.fs.writeFile(collision, enc('{"workspaces":[{"id":"pre-existing"}]}'));

    const result = await s.storage.migrateStorage(oldGlobal, newGlobal);
    check(result.failed.length === 0,
        'Every file copied without a verification failure.',
        `Migration reported failures: ${JSON.stringify(result.failed)}`);
    check(result.skipped === 1 && dec(fsStore.get(collision.toString())).includes('pre-existing'),
        'A file already at the destination was skipped, not overwritten.',
        'Migration overwrote a file that was already at the destination.');

    // The project subfolder, its index and its blobs all arrived.
    const projectFolder = s.root.path.split('/').pop();
    const newIndexUri = mockVscode.Uri.joinPath(newGlobal, projectFolder, 'index.json');
    const newIndex = JSON.parse(dec(await mockVscode.workspace.fs.readFile(newIndexUri)));
    check(newIndex.snapshots.length === 2,
        'The project index arrived at the new root.',
        `New index holds ${JSON.stringify(newIndex.snapshots.map(x => x.id))}`);
    check(dec(fsStore.get(mockVscode.Uri.joinPath(newGlobal, projectFolder, 'a').toString())) === 'version a' &&
          dec(fsStore.get(mockVscode.Uri.joinPath(newGlobal, projectFolder, 'b').toString())) === 'version b',
        'Snapshot content arrived with the index, byte for byte.',
        'Snapshot content did not arrive at the new root.');
    check(await s.storage.countSnapshotsUnder(newGlobal) === 2,
        'The new root reports the same number of snapshots.',
        'The new root does not hold the same history.');

    // Nothing is destroyed: the original stays the authority until the user
    // removes it themselves.
    check(s.blobExists('a') && s.blobExists('b') && (await s.readIndex()).snapshots.length === 2,
        'The original root was left intact.',
        'Migration removed history from the original root.');

    // And the copies are complete: no entry at the new root is an orphan.
    const copiedIds = newIndex.snapshots.map(x => x.id);
    const missing = copiedIds.filter(id => !fsStore.has(mockVscode.Uri.joinPath(newGlobal, projectFolder, id).toString()));
    check(missing.length === 0,
        'Every copied entry has its content at the new root.',
        `Entries copied without content: ${JSON.stringify(missing)}`);
}


// --- Test 9: a failed index write during pruning must not delete content ---
async function testPruneWritesIndexBeforeDeletingBlobs() {
    console.log('\n[Test 9] Pruning deletes no content when the index cannot be written');
    const s = await freshStorage();
    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;

    await s.writeIndex({
        snapshots: [
            { id: 'old-1', timestamp: sixtyDaysAgo, filePath: 'src/cart.js', eventType: 'save', storagePath: 'old-1' },
            { id: 'old-2', timestamp: sixtyDaysAgo - 1000, filePath: 'src/cart.js', eventType: 'save', storagePath: 'old-2' }
        ]
    });
    await s.writeBlob('old-1', 'version one');
    await s.writeBlob('old-2', 'version two');

    // The index write fails the way a locked or read-only file does. The blobs
    // must survive: an index that still lists them is the only record of them.
    const realWriteFile = mockVscode.workspace.fs.writeFile;
    const errors = [];
    const realShowError = mockVscode.window.showErrorMessage;
    mockVscode.window.showErrorMessage = (msg) => { errors.push(msg); };
    mockVscode.workspace.fs.writeFile = async (uri, content) => {
        if (uri.toString() === s.indexUri.toString()) {
            const err = new Error('EACCES: permission denied');
            err.code = 'NoPermissions';
            throw err;
        }
        return realWriteFile(uri, content);
    };

    try {
        await s.storage.prune(30, 500);
    } catch (e) {
        // prune() is called fire-and-forget in the manager; whether it rejects
        // is not the point. What must not happen is content being deleted.
    } finally {
        mockVscode.workspace.fs.writeFile = realWriteFile;
        mockVscode.window.showErrorMessage = realShowError;
    }

    check(s.blobExists('old-1') && s.blobExists('old-2'),
        'No snapshot content was deleted after the index write failed.',
        'Content was deleted even though the pruned index never reached disk.');
    check((await s.readIndex()).snapshots.length === 2,
        'The index on disk still lists both snapshots.',
        'The index on disk no longer matches the content that is there.');
    check(errors.some(m => m.includes('could not be written')),
        'The failed index write was reported to the user.',
        `The index write failed silently. Messages seen: ${JSON.stringify(errors)}`);

    // The in-memory index must not be left pruned either, or the next write
    // would commit a deletion the user was never told about.
    const stillListed = (await s.storage.getProjectHistory(false)).map(x => x.id);
    check(stillListed.includes('old-1') && stillListed.includes('old-2'),
        'Both snapshots are still listed in memory.',
        `The cached index was left pruned: ${JSON.stringify(stillListed)}`);

    // And once the disk is writable again, pruning completes properly.
    await s.storage.prune(30, 500);
    check(!s.blobExists('old-1') && !s.blobExists('old-2') && (await s.readIndex()).snapshots.length === 0,
        'A later prune, with a writable index, removed both entries and their content.',
        'Pruning did not recover after the earlier failure.');
}

// --- Test 10: one failed write must not poison every later save ---
async function testSaveQueueRecoversFromAWriteFailure() {
    console.log('\n[Test 10] A failed index write does not block later saves');
    const s = await freshStorage();
    await s.writeIndex({ snapshots: [] });

    const doc = {
        uri: mockVscode.Uri.file('/workspace/src/app.ts'),
        fileName: '/workspace/src/app.ts',
        getText: () => 'first version'
    };

    const realWriteFile = mockVscode.workspace.fs.writeFile;
    const realShowError = mockVscode.window.showErrorMessage;
    mockVscode.window.showErrorMessage = () => {};
    mockVscode.workspace.fs.writeFile = async (uri, content) => {
        if (uri.toString() === s.indexUri.toString()) throw new Error('EACCES: permission denied');
        return realWriteFile(uri, content);
    };
    let failed = false;
    try {
        await s.storage.saveSnapshot(doc, 'save');
    } catch (e) {
        failed = true;
    }
    mockVscode.workspace.fs.writeFile = realWriteFile;
    mockVscode.window.showErrorMessage = realShowError;

    check(failed, 'The save surfaced the index write failure.', 'The save reported success although the index was never written.');

    // The write queue is only there to serialize writes; a rejection left on it
    // would make every later save fail on an error already reported.
    await s.storage.saveSnapshot({ ...doc, getText: () => 'second version' }, 'save');
    const recorded = (await s.readIndex()).snapshots;
    check(recorded.length >= 1,
        'The next save was recorded once the index was writable again.',
        'Later saves were blocked by the earlier failure.');
}

async function run() {
    console.log('\n--- Chronos History-Loss Regression Tests ---');
    await testSizePruneKeepsPinned();
    await testPruneIsScopedToThisProject();
    await testCorruptIndexIsPreserved();
    await testLabelDoesNotBlockCapture();
    await testOrphanDetection();
    await testOrphanCleanupPreservesGoodEntries();
    await testOrphanCleanupIsScopedToThisProject();
    await testStorageRootChangeKeepsHistory();
    await testPruneWritesIndexBeforeDeletingBlobs();
    await testSaveQueueRecoversFromAWriteFailure();

    if (failures > 0) {
        console.error(`\n❌ History-loss regression tests FAILED (${failures} check(s)).`);
        process.exit(1);
    }
    console.log('\n✅ All history-loss regression checks passed.');
    process.exit(0);
}

run().catch(e => { console.error('Test crashed:', e); process.exit(1); });
