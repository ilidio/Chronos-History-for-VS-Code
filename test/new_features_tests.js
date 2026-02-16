const Module = require('module');
const originalRequire = Module.prototype.require;
const { mockVscode, fsStore, commandsMap } = require('./mock_vscode');

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

        console.log('\n✅ All New Features Integration Tests Passed!');

    } catch (e) {
        console.error('❌ New Features Tests Failed:', e);
        console.error(e.stack);
        process.exit(1);
    }
}

runNewFeaturesTests();
