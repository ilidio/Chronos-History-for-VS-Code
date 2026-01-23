const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const { mockVscode, fsStore, commandsMap } = require('./mock_vscode');
const EventEmitter = require('events');

// Mock child_process for GitService
const mockSpawn = (cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    
    setTimeout(() => {
        if (args.includes('log')) {
            const logOutput = `commit 1234567890abcdef
Author: Me
Date: 2023-01-01
    Initial commit
`;
            proc.stdout.emit('data', logOutput);
        } else if (args.includes('diff')) {
            proc.stdout.emit('data', 'diff --git a/file b/file\nindex 000000..111111\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-foo\n+bar');
        }
        proc.emit('close', 0);
    }, 10);
    
    return proc;
};

// Mock modules
Module.prototype.require = function(request) {
    if (request === 'vscode') {
        return mockVscode;
    }
    if (request === 'child_process') {
        return { spawn: mockSpawn };
    }
    return originalRequire.apply(this, arguments);
};

async function runMenuTests() {
    console.log('--- Starting Chronos Menu Tests ---');

    try {
        const extension = require('../out/extension');
        const context = new mockVscode.ExtensionContext();
        
        // Initialize extension (registers commands)
        extension.activate(context);
        
        // Populate mock file system and active editor
        const rootUri = mockVscode.Uri.file('/globalStorage');
        const indexUri = mockVscode.Uri.joinPath(rootUri, 'index.json');
        const fileUri = mockVscode.Uri.file('/workspace/test.ts');
        
        const snapshotId = 'snap-menu-1';
        const indexData = {
            snapshots: [{
                id: snapshotId,
                timestamp: Date.now(),
                filePath: 'test.ts',
                eventType: 'save',
                storagePath: snapshotId
            }]
        };
        
        await mockVscode.workspace.fs.writeFile(indexUri, new TextEncoder().encode(JSON.stringify(indexData)));
        await mockVscode.workspace.fs.writeFile(
            mockVscode.Uri.joinPath(rootUri, snapshotId), 
            new TextEncoder().encode('content')
        );

        mockVscode.window.activeTextEditor = {
            document: {
                uri: fileUri,
                getText: () => 'content',
                lineCount: 10
            },
            selection: new mockVscode.Range(0, 0, 5, 0)
        };

        // --- Test 1: Show History ---
        console.log('\n[Test 1] Menu: Show History');
        const showHistoryCmd = commandsMap.get('chronos.showHistory');
        if (showHistoryCmd) {
            await showHistoryCmd(fileUri);
            console.log('✅ chronos.showHistory executed.');
        } else {
            console.error('❌ chronos.showHistory not registered.');
        }

        // --- Test 2: Show History for Selection ---
        console.log('\n[Test 2] Menu: Show History for Selection');
        const showHistorySelCmd = commandsMap.get('chronos.showHistoryForSelection');
        if (showHistorySelCmd) {
            await showHistorySelCmd();
            console.log('✅ chronos.showHistoryForSelection executed.');
        } else {
            console.error('❌ chronos.showHistoryForSelection not registered.');
        }

        // --- Test 3: Git History for Selection ---
        console.log('\n[Test 3] Menu: Git History for Selection');
        const gitHistoryCmd = commandsMap.get('chronos.gitHistoryForSelection');
        if (gitHistoryCmd) {
            await gitHistoryCmd();
            // Async wait for git log to finish and webview to show
            await new Promise(r => setTimeout(r, 50));
            console.log('✅ chronos.gitHistoryForSelection executed.');
        } else {
            console.error('❌ chronos.gitHistoryForSelection not registered.');
        }

        // --- Test 4: Show Project History ---
        console.log('\n[Test 4] Menu: Show Project History');
        const projectHistoryCmd = commandsMap.get('chronos.showProjectHistory');
        if (projectHistoryCmd) {
            await projectHistoryCmd();
            console.log('✅ chronos.showProjectHistory executed.');
        } else {
            console.error('❌ chronos.showProjectHistory not registered.');
        }

        // --- Test 5: Show Recent Changes ---
        console.log('\n[Test 5] Menu: Show Recent Changes');
        const recentCmd = commandsMap.get('chronos.showRecentChanges');
        if (recentCmd) {
            await recentCmd();
            console.log('✅ chronos.showRecentChanges executed.');
        } else {
            console.error('❌ chronos.showRecentChanges not registered.');
        }

        // --- Test 6: Put Label ---
        console.log('\n[Test 6] Menu: Put Label');
        const putLabelCmd = commandsMap.get('chronos.putLabel');
        if (putLabelCmd) {
            await putLabelCmd();
            // Check if label snapshot was created in index
            const rawIndex = await mockVscode.workspace.fs.readFile(indexUri);
            const savedIndex = JSON.parse(new TextDecoder().decode(rawIndex));
            const labelSnap = savedIndex.snapshots.find(s => s.eventType === 'label');
            
            if (labelSnap && labelSnap.label === 'MockInput') {
                console.log('✅ chronos.putLabel executed and label saved.');
            } else {
                console.error('❌ chronos.putLabel failed to save label.');
            }
        } else {
            console.error('❌ chronos.putLabel not registered.');
        }

    } catch (e) {
        console.error('Test Suite Failed:', e);
        console.error(e.stack);
    }
}

runMenuTests();
