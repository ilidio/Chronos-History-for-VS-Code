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

// Helper to run tests
async function runTests() {
    console.log('--- Starting Chronos Feature Tests ---');

    try {
        // Load modules
        const { HistoryStorage } = require('../out/storage');
        const { HistoryManager } = require('../out/historyManager');
        const { ActivityProvider } = require('../out/views/activityProvider');
        const { DeletedFilesProvider } = require('../out/views/deletedFilesProvider');

        // Setup Context
        const context = new mockVscode.ExtensionContext();
        
        // Helper to update index on disk
        const rootUri = mockVscode.Uri.file('/globalStorage');
        const indexUri = mockVscode.Uri.joinPath(rootUri, 'index.json');
        
        const saveIndex = async (data) => {
            await mockVscode.workspace.fs.writeFile(indexUri, new TextEncoder().encode(JSON.stringify(data)));
        };

        // --- Test 1: Full-Text Search ---
        console.log('\n[Test 1] Full-Text Search');
        let storage = new HistoryStorage(context);
        
        const snapshotId = 'snap-1';
        const snapshotContent = 'This is a secret function with hidden logic.';
        
        let indexData = {
            snapshots: [{
                id: snapshotId,
                timestamp: Date.now(),
                filePath: 'secret.ts',
                eventType: 'save',
                storagePath: snapshotId
            }]
        };

        await saveIndex(indexData);
        await mockVscode.workspace.fs.writeFile(
            mockVscode.Uri.joinPath(rootUri, snapshotId), 
            new TextEncoder().encode(snapshotContent)
        );
        
        // Also exist the file in workspace so it's not "deleted"
        await mockVscode.workspace.fs.writeFile(mockVscode.Uri.file('/workspace/secret.ts'), new TextEncoder().encode('current content'));

        const searchResults = await storage.search('hidden logic', true);
        if (searchResults.length === 1 && searchResults[0].id === snapshotId) {
            console.log('✅ Search found the correct snapshot.');
        } else {
            console.error('❌ Search failed. Found:', searchResults.length);
        }


        // --- Test 2: Activity View ---
        console.log('\n[Test 2] Activity View');
        storage = new HistoryStorage(context); // New instance to clear cache
        const activityProvider = new ActivityProvider(storage);
        
        const recentSnapshots = [
            { id: 's2', timestamp: Date.now(), filePath: 'active.ts', eventType: 'save', storagePath: 's2' },
            { id: 's3', timestamp: Date.now(), filePath: 'active.ts', eventType: 'save', storagePath: 's3' },
            { id: 's4', timestamp: Date.now() - 100000, filePath: 'other.ts', eventType: 'save', storagePath: 's4' }
        ];
        // Merge with existing
        indexData.snapshots.push(...recentSnapshots);
        await saveIndex(indexData);
        
        // Create these files in workspace too
        await mockVscode.workspace.fs.writeFile(mockVscode.Uri.file('/workspace/active.ts'), new TextEncoder().encode(''));
        await mockVscode.workspace.fs.writeFile(mockVscode.Uri.file('/workspace/other.ts'), new TextEncoder().encode(''));

        const activityItems = await activityProvider.getChildren();
        const activeItem = activityItems.find(i => i.label === 'active.ts');
        
        if (activeItem && activeItem.count === 2) {
             console.log('✅ Activity View correctly counted 2 changes for active.ts.');
        } else {
             console.error('❌ Activity View failed. Items:', activityItems);
        }


        // --- Test 3: Deleted Files ---
        console.log('\n[Test 3] Deleted File Resurrection');
        storage = new HistoryStorage(context);
        const manager = new HistoryManager(context, storage);
        const deletedProvider = new DeletedFilesProvider(manager, storage);
        
        // Add a snapshot for a file that does NOT exist in fsStore
        indexData.snapshots.push({
            id: 'del1',
            timestamp: Date.now(),
            filePath: 'deleted.ts',
            eventType: 'save',
            storagePath: 'del1'
        });
        await saveIndex(indexData);
        
        // Ensure deleted.ts is NOT in /workspace (it isn't by default)

        const deletedFiles = await deletedProvider.getChildren();
        const deletedItem = deletedFiles.find(i => i.label === 'deleted.ts');
        const secretItem = deletedFiles.find(i => i.label === 'secret.ts');

        if (deletedItem && !secretItem) {
            console.log('✅ Deleted file "deleted.ts" detected correctly.');
        } else {
            console.error('❌ Deleted file detection failed. Found:', deletedFiles.map(d => d.label));
        }


        // --- Test 4: Local Experiments ---
        console.log('\n[Test 4] Local Experiments');
        
        mockVscode.window.activeTextEditor = {
            document: {
                uri: mockVscode.Uri.file('/workspace/experiment.ts'),
                getText: () => 'experimental content'
            }
        };

        await manager.startExperiment('MyExperiment');
        
        // Reload index to check for new snapshot
        const rawIndex = await mockVscode.workspace.fs.readFile(indexUri);
        const savedIndexData = JSON.parse(new TextDecoder().decode(rawIndex));
        
        const expSnapshot = savedIndexData.snapshots.find(s => s.eventType === 'label' && s.label === 'Experiment Start: MyExperiment');
        
        if (expSnapshot) {
            console.log('✅ Experiment snapshot created.');
            
            // Test Discard
            await manager.stopExperiment(false);
            console.log('✅ Experiment stopped (discard path triggered).');
        } else {
            console.error('❌ Experiment start failed. Snapshots:', savedIndexData.snapshots.map(s => s.description));
        }

    } catch (e) {
        console.error('Test Suite Failed:', e);
        console.error(e.stack);
    }
}

runTests();
