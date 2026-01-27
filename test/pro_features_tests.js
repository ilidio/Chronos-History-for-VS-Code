const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const { mockVscode, fsStore } = require('./mock_vscode');

// Mock vscode module
Module.prototype.require = function(request) {
    if (request === 'vscode') {
        return mockVscode;
    }
    return originalRequire.apply(this, arguments);
};

const { HistoryStorage } = require('../out/storage');

async function runProTests() {
    console.log('\n--- Starting Chronos Pro Features Tests ---');

    try {
        const context = new mockVscode.ExtensionContext();
        const rootUri = mockVscode.Uri.file('/globalStorage');
        const indexUri = mockVscode.Uri.joinPath(rootUri, 'index.json');
        
        const saveIndex = async (data) => {
            await mockVscode.workspace.fs.writeFile(indexUri, new TextEncoder().encode(JSON.stringify(data, null, 2)));
        };

        // --- Test 1: Search Toggle (Metadata vs Content) ---
        console.log('\n[Test 1] Search Toggle (Metadata vs Content)');
        let storage = new HistoryStorage(context);
        await storage.init();
        
        const snap1 = 'snap-meta';
        const snap2 = 'snap-content';
        
        const indexData = {
            snapshots: [
                { id: snap1, timestamp: Date.now(), filePath: 'test.ts', eventType: 'save', label: 'Feature Alpha', storagePath: snap1 },
                { id: snap2, timestamp: Date.now(), filePath: 'other.ts', eventType: 'save', label: 'Regular Save', storagePath: snap2 }
            ]
        };

        await saveIndex(indexData);
        await mockVscode.workspace.fs.writeFile(mockVscode.Uri.joinPath(rootUri, snap1), new TextEncoder().encode('some code here'));
        await mockVscode.workspace.fs.writeFile(mockVscode.Uri.joinPath(rootUri, snap2), new TextEncoder().encode('export function hidden() {}'));

        const metaResults = await storage.search('Alpha', false);
        if (metaResults.length === 1 && metaResults[0].id === snap1) {
            console.log('✅ Metadata search found "Feature Alpha" label.');
        } else {
            console.error('❌ Metadata search failed.');
        }

        const metaFail = await storage.search('hidden', false);
        if (metaFail.length === 0) {
            console.log('✅ Metadata search correctly skipped content string "hidden".');
        } else {
            console.error('❌ Metadata search incorrectly found content string.');
        }

        const deepSuccess = await storage.search('hidden', true);
        if (deepSuccess.length === 1 && deepSuccess[0].id === snap2) {
            console.log('✅ Deep search found "hidden" inside file content.');
        } else {
            console.error('❌ Deep search failed to find content string.');
        }


        // --- Test 2: Pinning & Pruning ---
        console.log('\n[Test 2] Pinning & Pruning');
        storage = new HistoryStorage(context);
        await storage.init();
        
        const oldSnapId = 'old-snap';
        const pinnedSnapId = 'pinned-snap';
        const now = Date.now();
        const thirtyOneDaysAgo = now - (31 * 24 * 60 * 60 * 1000);

        const pruneIndexData = {
            snapshots: [
                { id: oldSnapId, timestamp: thirtyOneDaysAgo, filePath: 'old.ts', eventType: 'save', storagePath: oldSnapId },
                { id: pinnedSnapId, timestamp: thirtyOneDaysAgo, filePath: 'critical.ts', eventType: 'save', storagePath: pinnedSnapId, pinned: true }
            ]
        };

        await saveIndex(pruneIndexData);
        await mockVscode.workspace.fs.writeFile(mockVscode.Uri.joinPath(rootUri, oldSnapId), new TextEncoder().encode('old'));
        await mockVscode.workspace.fs.writeFile(mockVscode.Uri.joinPath(rootUri, pinnedSnapId), new TextEncoder().encode('pinned'));

        console.log('Running pruning (30 days limit)...');
        await storage.prune(30);

        storage = new HistoryStorage(context);
        await storage.init();
        const finalHistory = await storage.getProjectHistory();

        const hasOld = finalHistory.some(s => s.id === oldSnapId);
        const hasPinned = finalHistory.some(s => s.id === pinnedSnapId);

        if (!hasOld && hasPinned) {
            console.log('✅ Pruning successfully removed old snapshot but KEPT pinned snapshot.');
        } else {
            console.error('❌ Pruning logic failed. Old exists:', hasOld, 'Pinned exists:', hasPinned);
        }

        // --- Test 3: Toggle Pin API ---
        console.log('\n[Test 3] Toggle Pin API');
        const targetSnap = finalHistory.find(s => s.id === pinnedSnapId);
        const initialState = targetSnap.pinned || false;
        const newState = await storage.togglePin(pinnedSnapId);
        
        if (newState === !initialState) {
            console.log('✅ togglePin correctly flipped the state.');
        } else {
            console.error('❌ togglePin failed.');
        }

    } catch (e) {
        console.error('Pro Features Test Failed:', e);
        console.error(e.stack);
        process.exit(1);
    }
}

runProTests();
