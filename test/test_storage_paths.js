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

async function testStoragePaths() {
    console.log('\n--- Testing Chronos Storage Path Resolution ---');

    const context = new mockVscode.ExtensionContext();
    const storage = new HistoryStorage(context);
    
    const projectPath = '/Users/ilidiomartins/src/Personal/Chronos-History-Visual-Studio-Extension';
    const projectUri = mockVscode.Uri.file(projectPath);
    const fileUri = mockVscode.Uri.file(path.join(projectPath, 'src/extension.ts'));

    // Mock workspace folder
    const workspaceFolders = [
        { uri: projectUri, name: 'Chronos-History-Visual-Studio-Extension', index: 0 }
    ];
    mockVscode.workspace.workspaceFolders = workspaceFolders;
    mockVscode.workspace.getWorkspaceFolder = (uri) => {
        return workspaceFolders.find(f => uri.fsPath.startsWith(f.uri.fsPath));
    };

    // Mock configuration store
    const configStore = new Map();
    mockVscode.workspace.getConfiguration = (section) => ({
        get: (key, defaultValue) => {
            const val = configStore.get(key);
            return val !== undefined ? val : defaultValue;
        },
        update: async (key, value) => {
            configStore.set(key, value);
        }
    });

    try {
        await storage.init();

        // 1. Default Behavior (Internal Storage)
        console.log('\n[Test 1] Default Behavior (Internal Storage)');
        const defaultStorage = await storage.getWorkspaceStorageRoot();
        console.log(`Default Root: ${defaultStorage.fsPath}`);
        if (defaultStorage.fsPath.includes('globalStorage')) {
            console.log('✅ Correctly uses globalStorageUri by default.');
        } else {
            console.error('❌ Default storage is unexpected:', defaultStorage.fsPath);
        }

        // 2. Save In Project Folder
        console.log('\n[Test 2] Save In Project Folder');
        configStore.set('saveInProjectFolder', true);
        await storage.init(); // Refresh root
        
        // We need to trigger getStorageForFile via something like getWorkspaceStorageRoot
        // but getWorkspaceStorageRoot uses activeEditor or first workspaceFolder.
        // Let's mock active editor.
        mockVscode.window.activeTextEditor = { document: { uri: fileUri } };
        
        const projectStorage = await storage.getWorkspaceStorageRoot();
        console.log(`Project Storage Root: ${projectStorage.fsPath}`);
        const expectedProjectPath = path.join(projectPath, '.history');
        if (projectStorage.fsPath === expectedProjectPath || projectStorage.fsPath === expectedProjectPath.toLowerCase()) {
             console.log('✅ Correctly uses .history in project folder.');
        } else {
             console.error(`❌ Project storage mismatch. Expected: ${expectedProjectPath}, Got: ${projectStorage.fsPath}`);
        }

        // 3. Shared Global Storage (via customStoragePath)
        console.log('\n[Test 3] Shared Global Storage (customStoragePath)');
        configStore.set('saveInProjectFolder', false);
        const sharedPath = '/Users/ilidiomartins/.chronos-history';
        configStore.set('customStoragePath', sharedPath);
        await storage.init(); // Refresh root

        const sharedStorage = await storage.getWorkspaceStorageRoot();
        console.log(`Shared Storage Root (base): ${storage.resolveGlobalStorageRoot().fsPath}`);
        console.log(`Shared Storage Root (project-specific): ${sharedStorage.fsPath}`);
        
        if (sharedStorage.fsPath.startsWith(sharedPath)) {
             console.log('✅ Correctly uses custom global path.');
             if (sharedStorage.fsPath.includes('Chronos-History-Visual-Studio-Extension-')) {
                 console.log('✅ Correctly appends project-specific subfolder with hash.');
             } else {
                 console.error('❌ Missing project subfolder in global storage.');
             }
        } else {
             console.error(`❌ Shared storage mismatch. Expected to start with: ${sharedPath}, Got: ${sharedStorage.fsPath}`);
        }

        // 4. Test ~ expansion
        console.log('\n[Test 4] Home (~) expansion');
        configStore.set('customStoragePath', '~/.chronos-history');
        await storage.init();
        const homeResolved = storage.resolveGlobalStorageRoot().fsPath;
        console.log(`~ Resolved to: ${homeResolved}`);
        const os = require('os');
        const expectedHome = path.join(os.homedir(), '.chronos-history');
        if (homeResolved === expectedHome || homeResolved === expectedHome.toLowerCase()) {
            console.log('✅ Correctly expanded ~ to home directory.');
        } else {
            console.error(`❌ ~ Expansion failed. Expected: ${expectedHome}, Got: ${homeResolved}`);
        }

    } catch (e) {
        console.error('Test failed with error:', e);
    }
}

testStoragePaths();
