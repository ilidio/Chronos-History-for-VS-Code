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

async function runPathMatchingTests() {
    console.log('\n--- Starting Chronos Path Matching Tests ---');

    try {
        const context = new mockVscode.ExtensionContext();
        const storage = new HistoryStorage(context);
        await storage.init();

        const globalRoot = context.globalStorageUri;
        const indexUri = mockVscode.Uri.joinPath(globalRoot, 'index.json');

        const indexData = {
            snapshots: [
                { id: '1', filePath: 'src/main.ts', timestamp: Date.now() },
                { id: '2', filePath: 'package.json', timestamp: Date.now() },
                { id: '3', filePath: 'app/utils/helper.js', timestamp: Date.now() }
            ]
        };
        await mockVscode.workspace.fs.writeFile(indexUri, new TextEncoder().encode(JSON.stringify(indexData)));

        // Test 1: Exact
        console.log('[Test 1] Exact Match');
        const h1 = await storage.getHistoryForFile(mockVscode.Uri.file('/workspace/src/main.ts'));
        if (h1.length === 1) console.log('✅ Passed'); else console.error('❌ Failed');

        // Test 2: Case & Slashes
        console.log('[Test 2] Normalization (Case & Slashes)');
        const originalAsRel = mockVscode.workspace.asRelativePath;
        
        // We simulate a Windows-style path with backslashes
        mockVscode.workspace.asRelativePath = () => 'SRC\\MAIN.TS';
        const h2 = await storage.getHistoryForFile(mockVscode.Uri.file('/workspace/src/main.ts'));
        if (h2.length === 1 && h2[0].id === '1') {
            console.log('✅ Passed');
        } else {
            console.error('❌ Failed. Normalized was likely:', h2.length > 0 ? h2[0].filePath : 'none');
        }

        // Test 3: Suffix
        console.log('[Test 3] Loose Matching (Suffix)');
        mockVscode.workspace.asRelativePath = () => 'project/package.json';
        const h3 = await storage.getHistoryForFile(mockVscode.Uri.file('/workspace/package.json'));
        if (h3.length === 1 && h3[0].id === '2') console.log('✅ Passed'); else console.error('❌ Failed');

        // Test 4: Prefix
        console.log('[Test 4] Loose Matching (Prefix)');
        mockVscode.workspace.asRelativePath = () => 'utils/helper.js';
        const h4 = await storage.getHistoryForFile(mockVscode.Uri.file('/workspace/app/utils/helper.js'));
        if (h4.length === 1 && h4[0].id === '3') console.log('✅ Passed'); else console.error('❌ Failed');

        mockVscode.workspace.asRelativePath = originalAsRel;

    } catch (e) {
        console.error('Path Matching Tests Failed:', e);
        process.exit(1);
    }
}

runPathMatchingTests();