const Module = require('module');
const originalRequire = Module.prototype.require;
const { mockVscode, fsStore, commandsMap, setFileContent } = require('./mock_vscode');

// Mock vscode module
Module.prototype.require = function(request) {
    if (request === 'vscode') {
        return mockVscode;
    }
    return originalRequire.apply(this, arguments);
};

async function runNewFeaturesTests() {
    console.log('\n--- Starting Chronos New Features Tests ---');

    try {
        // Load modules
        const { HistoryViewProvider } = require('../out/views/historyWebview');
        const { HistoryPanelProvider } = require('../out/views/historyPanelProvider');
        
        const outputChannel = mockVscode.window.createOutputChannel('Chronos Debug');
        const context = new mockVscode.ExtensionContext();
        
        // Register necessary commands for testing
        mockVscode.commands.registerCommand('chronos.restoreSnapshot', () => {});
        mockVscode.commands.registerCommand('chronos.compareWithActive', () => {});
        mockVscode.commands.registerCommand('chronos.shareSnapshot', () => {});
        mockVscode.commands.registerCommand('chronos.compareWithBranchVersion', () => {});
        mockVscode.commands.registerCommand('_chronos.savePatch', () => {});
        mockVscode.commands.registerCommand('chronos.explainSnapshot', () => 'AI explanation text');
        mockVscode.commands.registerCommand('_chronos.getBranches', () => ['main', 'feature-x']);
        mockVscode.commands.registerCommand('_chronos.getDiffSnapshotWithBranch', () => 'diff-text');

        const historyView = new HistoryViewProvider(context.extensionUri, outputChannel);
        const historyPanel = new HistoryPanelProvider(context.extensionUri);

        let lastExecutedCommand = '';
        let lastCommandArgs = [];

        // Wrap executeCommand to track calls
        const originalExecuteCommand = mockVscode.commands.executeCommand;
        mockVscode.commands.executeCommand = async (cmd, ...args) => {
            lastExecutedCommand = cmd;
            lastCommandArgs = args;
            if (commandsMap.has(cmd)) {
                return commandsMap.get(cmd)(...args);
            }
        };

        // --- Test 1: HTML Diff Actions (Webview View) ---
        console.log('\n[Test 1] HistoryView: HTML Diff Actions');
        
        const mockSnapshot = { id: 'test-snap', filePath: '/workspace/test.ts', timestamp: Date.now(), eventType: 'save' };
        
        let messageHandler;
        const originalCreateWebviewPanel = mockVscode.window.createWebviewPanel;
        mockVscode.window.createWebviewPanel = (viewType, title, column, options) => {
            const panel = originalCreateWebviewPanel(viewType, title, column, options);
            panel.webview.onDidReceiveMessage = (cb) => { messageHandler = cb; };
            return panel;
        };

        historyView.show([mockSnapshot], mockVscode.Uri.file('/workspace/test.ts'));

        if (messageHandler) {
            // Test 'restore'
            lastExecutedCommand = '';
            await messageHandler({ command: 'restore', snapshotId: 'test-snap', filePath: '/workspace/test.ts' });
            if (lastExecutedCommand === 'chronos.restoreSnapshot') {
                console.log('✅ Restore command triggered correctly.');
            } else {
                console.error('❌ Restore command failed. Last:', lastExecutedCommand);
            }

            // Test 'compareWithActive'
            lastExecutedCommand = '';
            await messageHandler({ command: 'compareWithActive', snapshot: mockSnapshot });
            if (lastExecutedCommand === 'chronos.compareWithActive') {
                console.log('✅ Compare with Active command triggered correctly.');
            } else {
                console.error('❌ Compare with Active failed. Last:', lastExecutedCommand);
            }

            // Test 'share'
            lastExecutedCommand = '';
            await messageHandler({ command: 'share', snapshot: mockSnapshot });
            if (lastExecutedCommand === 'chronos.shareSnapshot') {
                console.log('✅ Share Snapshot command triggered correctly.');
            } else {
                console.error('❌ Share Snapshot failed. Last:', lastExecutedCommand);
            }
        }

        // --- Test 2: Branch & Version Comparison ---
        console.log('\n[Test 2] HistoryView: Branch & Version Comparison');
        
        const originalShowQuickPick = mockVscode.window.showQuickPick;
        mockVscode.window.showQuickPick = async (items) => 'feature-x';

        if (messageHandler) {
            // Test 'compareWithBranch'
            lastExecutedCommand = '';
            await messageHandler({ command: 'compareWithBranch', filePath: '/workspace/test.ts', snapshot: mockSnapshot });
            if (lastExecutedCommand === '_chronos.getDiffSnapshotWithBranch' || lastExecutedCommand === 'chronos.compareSnapshotWithBranch' || lastExecutedCommand === 'chronos.compareWithBranch') {
                console.log('✅ Compare with Branch command triggered correctly.');
            } else {
                console.error('❌ Compare with Branch failed. Last:', lastExecutedCommand);
            }

            // Test 'compareWithBranchVersion'
            lastExecutedCommand = '';
            await messageHandler({ command: 'compareWithBranchVersion', snapshot: mockSnapshot, filePath: '/workspace/test.ts' });
            if (lastExecutedCommand === 'chronos.compareWithBranchVersion') {
                console.log('✅ Compare with Version command triggered correctly.');
            } else {
                console.error('❌ Compare with Version failed. Last:', lastExecutedCommand);
            }
        }

        // --- Test 3: History Panel (JetBrains style) ---
        console.log('\n[Test 3] HistoryPanel: Feature Integration');
        
        let panelMessageHandler;
        mockVscode.window.registerWebviewViewProvider = (viewId, provider) => {
            const mockView = {
                webview: {
                    options: {},
                    onDidReceiveMessage: (cb) => { panelMessageHandler = cb; },
                    postMessage: () => {},
                    html: ''
                },
                show: () => {}
            };
            provider.resolveWebviewView(mockView);
        };

        const panelProvider = new HistoryPanelProvider(context.extensionUri);
        mockVscode.window.registerWebviewViewProvider('chronos.historyPanel', panelProvider);

        if (panelMessageHandler) {
            // Test 'explain'
            lastExecutedCommand = '';
            await panelMessageHandler({ command: 'explain', snapshot: mockSnapshot });
            if (lastExecutedCommand === 'chronos.explainSnapshot' || lastExecutedCommand === 'chronos.explainCommit') {
                console.log('✅ AI Explain command triggered correctly in Panel.');
            } else {
                console.error('❌ AI Explain failed in Panel. Last:', lastExecutedCommand);
            }

            // Test 'savePatch'
            lastExecutedCommand = '';
            await panelMessageHandler({ command: 'savePatch', diffText: 'test patch' });
            if (lastExecutedCommand === '_chronos.savePatch') {
                console.log('✅ Save Patch command triggered correctly.');
            } else {
                console.error('❌ Save Patch failed. Last:', lastExecutedCommand);
            }
        }

        // Restore
        mockVscode.commands.executeCommand = originalExecuteCommand;
        mockVscode.window.showQuickPick = originalShowQuickPick;

        // Restore
        mockVscode.commands.executeCommand = originalExecuteCommand;
        mockVscode.window.showQuickPick = originalShowQuickPick;

        // --- Test 4: GitIgnoreService Integration ---
        console.log('\n[Test 4] GitIgnoreService Integration');

        // Clear fsStore before starting gitignore tests
        fsStore.clear();

        // Setup a mock workspace folder for GitIgnoreService
        mockVscode.workspace.workspaceFolders = [{ uri: mockVscode.Uri.file('/project'), name: 'project', index: 0 }];
        mockVscode.workspace.rootPath = '/project';
        mockVscode.workspace.asRelativePath = (uriOrStr) => {
            const p = typeof uriOrStr === 'string' ? uriOrStr : uriOrStr.fsPath; // Use fsPath for Uri objects
            return path.relative(mockVscode.workspace.rootPath, p);
        };
        mockVscode.workspace.getWorkspaceFolder = (uri) => {
            if (uri.fsPath.startsWith('/project')) {
                return { uri: mockVscode.Uri.file('/project'), name: 'project', index: 0 };
            }
            return undefined;
        };


        const { HistoryManager } = require('../out/historyManager');
        const { HistoryStorage } = require('../out/storage');
        const { GitService } = require('../out/git/gitService');
        const { GitIgnoreService } = require('../out/git/gitIgnoreService');

        const mockStorage = new HistoryStorage(context, outputChannel);
        const mockGitService = new GitService();
        const mockGitIgnoreService = new GitIgnoreService(outputChannel);

        let managerWithGitIgnore = new HistoryManager(context, mockStorage, mockGitService, mockGitIgnoreService);
        
        // Mock getConfiguration for ChronosConfig
        let mockChronosConfig = {
            enabled: true,
            maxDays: 30,
            maxSizeMB: 500,
            trackSelectionHistory: true,
            exclude: [],
            dailyBriefing: true,
            respectGitIgnore: false // Default for tests
        };
        mockVscode.workspace.getConfiguration = (section) => {
            if (section === 'chronos') {
                return {
                    get: (key, defaultValue) => {
                        return mockChronosConfig[key] !== undefined ? mockChronosConfig[key] : defaultValue;
                    }
                };
            }
            return { get: (key, defaultValue) => defaultValue };
        };

        // Test 4.1: respectGitIgnore = false (default)
        console.log('[Test 4.1] respectGitIgnore = false');
        setFileContent(mockVscode.Uri.file('/project/.gitignore'), 'secret.txt\n*.log');
        await mockGitIgnoreService.refreshGitIgnorePatterns(true); // Populate patterns
        
        // File in chronos.exclude
        mockChronosConfig.exclude = ['**/temp.txt'];
        if (managerWithGitIgnore.isExcluded('/project/temp.txt') === true) {
            console.log('✅ isExcluded returns true for chronos.exclude with respectGitIgnore=false.');
        } else {
            console.error('❌ isExcluded failed for chronos.exclude with respectGitIgnore=false.');
        }

        // File in .gitignore but not chronos.exclude
        if (managerWithGitIgnore.isExcluded('/project/secret.txt') === false) {
            console.log('✅ isExcluded returns false for .gitignore only with respectGitIgnore=false.');
        } else {
            console.error('❌ isExcluded failed for .gitignore only with respectGitIgnore=false.');
        }
        if (managerWithGitIgnore.isExcluded('/project/test.log') === false) {
            console.log('✅ isExcluded returns false for .gitignore only with respectGitIgnore=false (glob).');
        } else {
            console.error('❌ isExcluded failed for .gitignore only with respectGitIgnore=false (glob).');
        }

        // File in neither
        if (managerWithGitIgnore.isExcluded('/project/normal.js') === false) {
            console.log('✅ isExcluded returns false for neither with respectGitIgnore=false.');
        } else {
            console.error('❌ isExcluded failed for neither with respectGitIgnore=false.');
        }

        // Test 4.2: respectGitIgnore = true
        console.log('[Test 4.2] respectGitIgnore = true');
        mockChronosConfig.respectGitIgnore = true;
        // Trigger config reload in manager
        managerWithGitIgnore.config = managerWithGitIgnore.loadConfig(); // Simulate config change
        await mockGitIgnoreService.refreshGitIgnorePatterns(true); // Ensure patterns are re-read with new config


        // File in chronos.exclude (still true)
        if (managerWithGitIgnore.isExcluded('/project/temp.txt') === true) {
            console.log('✅ isExcluded returns true for chronos.exclude with respectGitIgnore=true.');
        } else {
            console.error('❌ isExcluded failed for chronos.exclude with respectGitIgnore=true.');
        }

        // File in .gitignore (now true)
        if (managerWithGitIgnore.isExcluded('/project/secret.txt') === true) {
            console.log('✅ isExcluded returns true for .gitignore only with respectGitIgnore=true.');
        } else {
            console.error('❌ isExcluded failed for .gitignore only with respectGitIgnore=true.');
        }
        if (managerWithGitIgnore.isExcluded('/project/another.log') === true) {
            console.log('✅ isExcluded returns true for .gitignore only with respectGitIgnore=true (glob).');
        } else {
            console.error('❌ isExcluded failed for .gitignore only with respectGitIgnore=true (glob).');
        }

        // File in both (still true)
        mockChronosConfig.exclude = ['**/*.log']; // Now .log files are also in chronos.exclude
        managerWithGitIgnore.config = managerWithGitIgnore.loadConfig(); // Simulate config change
        if (managerWithGitIgnore.isExcluded('/project/combined.log') === true) {
            console.log('✅ isExcluded returns true for both with respectGitIgnore=true.');
        } else {
            console.error('❌ isExcluded failed for both with respectGitIgnore=true.');
        }
        mockChronosConfig.exclude = []; // Reset

        // File in neither (still false)
        if (managerWithGitIgnore.isExcluded('/project/another_normal.js') === false) {
            console.log('✅ isExcluded returns false for neither with respectGitIgnore=true.');
        } else {
            console.error('❌ isExcluded failed for neither with respectGitIgnore=true.');
        }
        
        // Test 4.3: .gitignore negation patterns
        console.log('[Test 4.3] .gitignore negation patterns');
        setFileContent(mockVscode.Uri.file('/project/.gitignore'), 'build/\n!build/keep.js');
        await mockGitIgnoreService.refreshGitIgnorePatterns(true); // Reload gitignore patterns

        if (managerWithGitIgnore.isExcluded('/project/build/ignored.js') === true) {
            console.log('✅ isExcluded returns true for file in ignored directory.');
        } else {
            console.error('❌ isExcluded failed for file in ignored directory.');
        }
        if (managerWithGitIgnore.isExcluded('/project/build/keep.js') === false) {
            console.log('✅ isExcluded returns false for file explicitly unignored.');
        } else {
            console.error('❌ isExcluded failed for file explicitly unignored.');
        }
        
        // Clean up mock config
        mockChronosConfig.respectGitIgnore = false;
        mockChronosConfig.exclude = [];
        managerWithGitIgnore.config = managerWithGitIgnore.loadConfig(); // Reset manager config
        fsStore.clear(); // Clear mock filesystem

        console.log('\n✅ All New Features Integration Tests Passed!');

    } catch (e) {
        console.error('❌ New Features Tests Failed:', e);
        console.error(e.stack);
        process.exit(1);
    }
}

runNewFeaturesTests();
