const Module = require('module');
const originalRequire = Module.prototype.require;
const { mockVscode, fsStore } = require('./mock_vscode');

// Mock vscode module
Module.prototype.require = function(request) {
    if (request === 'vscode') {
        return mockVscode;
    }
    return originalRequire.apply(this, arguments);
};

const { GitService } = require('../out/git/gitService');
const { HistoryStorage } = require('../out/storage');

async function runComparisonTests() {
    console.log('\n--- Starting Chronos Comparison Features Tests ---');

    try {
        const gitService = new GitService();
        const context = new mockVscode.ExtensionContext();
        const storage = new HistoryStorage(context);
        await storage.init();

        // --- Test 1: Git Churn Calculation ---
        console.log('\n[Test 1] Git Workspace Churn');
        const churn = await gitService.getWorkspaceChurn();
        // Since we are in a mock/real git environment mismatch, we expect it to at least run
        console.log('Detected Churn:', churn);
        if (typeof churn.added === 'number' && typeof churn.deleted === 'number') {
            console.log('✅ Churn calculation returned numeric values.');
        } else {
            console.error('❌ Churn calculation failed.');
        }

        // --- Test 2: Git Commit Range Diff (Mocked) ---
        console.log('\n[Test 2] Git Commit Range Diff');
        // We can't easily run real git diffs in the mock, but we can verify the method exists and handles empty/error cases
        const diff = await gitService.getCommitDiff('hash1', 'hash2', '/workspace/file.ts', 0, 10);
        if (typeof diff === 'string') {
            console.log('✅ getCommitDiff executed successfully.');
        } else {
            console.error('❌ getCommitDiff failed.');
        }

        // --- Test 3: Local Snapshot URI Resolution ---
        console.log('\n[Test 3] Snapshot URI Resolution');
        const snapshot = {
            id: 'snap-xyz',
            storagePath: 'snap-xyz',
            filePath: 'test.ts'
        };
        const fileUri = mockVscode.Uri.file('/workspace/test.ts');
        const snapUri = await storage.getSnapshotUri(snapshot, fileUri);
        
        if (snapUri.fsPath.includes('snap-xyz')) {
            console.log('✅ Snapshot URI resolved correctly to storage path.');
        } else {
            console.error('❌ Snapshot URI resolution failed. Path:', snapUri.fsPath);
        }

    } catch (e) {
        console.error('Comparison Tests Failed:', e);
        process.exit(1);
    }
}

runComparisonTests();
