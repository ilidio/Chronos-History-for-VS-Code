const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const fs = require('fs');
const os = require('os');
const { mockVscode } = require('./mock_vscode_real_fs');

// Mock vscode module
Module.prototype.require = function(request) {
    if (request === 'vscode') {
        return mockVscode;
    }
    return originalRequire.apply(this, arguments);
};

async function runBackupTests() {
    console.log('--- Starting Chronos Backup Tests ---');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-test-'));
    const sourceStoragePath = path.join(tmpDir, 'source_storage');
    const destStoragePath = path.join(tmpDir, 'dest_storage');
    const backupFile = path.join(tmpDir, 'backup.zip');

    try {
        // Load modules
        const { HistoryStorage } = require('../out/storage');
        const { BackupService } = require('../out/backup');

        // Setup Source Context
        const sourceContext = new mockVscode.ExtensionContext(sourceStoragePath);
        const sourceStorage = new HistoryStorage(sourceContext);
        
        // 1. Create some history in Source
        console.log('[Test] Creating source history...');
        await sourceStorage.init();
        const doc = {
            uri: mockVscode.Uri.file('/workspace/test.txt'),
            getText: () => 'Version 1 Content'
        };
        await sourceStorage.saveSnapshot(doc, 'save');
        
        // Verify source has data
        const sourceHistory = await sourceStorage.getHistoryForFile(doc.uri);
        if (sourceHistory.length !== 1) throw new Error('Source history creation failed');
        console.log(`✅ Source history created (${sourceHistory.length} snapshot).`);

        // 2. Export
        console.log('[Test] Exporting history...');
        const backupServiceSource = new BackupService(sourceStorage);
        await backupServiceSource.exportHistory(backupFile);
        
        if (fs.existsSync(backupFile)) {
            console.log('✅ Backup file created.');
        } else {
            throw new Error('Backup file not found.');
        }

        // 3. Import to Destination
        console.log('[Test] Importing history...');
        const destContext = new mockVscode.ExtensionContext(destStoragePath);
        const destStorage = new HistoryStorage(destContext);
        const backupServiceDest = new BackupService(destStorage);

        await backupServiceDest.importHistory(backupFile);

        // 4. Verify Destination
        const destHistory = await destStorage.getHistoryForFile(doc.uri);
        if (destHistory.length === 1 && destHistory[0].id === sourceHistory[0].id) {
            console.log('✅ Import successful. Snapshot found in destination.');
        } else {
            console.error('❌ Import failed. History:', destHistory);
            throw new Error('Import verification failed');
        }

        // 5. Test Merge (Import again)
        console.log('[Test] Testing Merge (Duplicate Import)...');
        await backupServiceDest.importHistory(backupFile);
        const destHistory2 = await destStorage.getHistoryForFile(doc.uri);
        if (destHistory2.length === 1) {
            console.log('✅ Merge successful. Duplicates ignored.');
        } else {
            console.error('❌ Merge failed. History count:', destHistory2.length);
        }

    } catch (e) {
        console.error('Test Failed:', e);
        process.exit(1);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runBackupTests();
