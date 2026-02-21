const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const { mockVscode, fsStore } = require('./mock_vscode');
const { GoogleGenAI } = require("@google/genai");

// CONFIGURATION PROVIDED BY USER
const apiKey = "AIzaSyBBE38sDhriz8ZsP_0hAj84qDKNATnxi0M";
const modelId = "gemini-3-flash-preview";

// Mock modules
Module.prototype.require = function(request) {
    if (request === 'vscode') return mockVscode;
    return originalRequire.apply(this, arguments);
};

async function runComprehensiveTests() {
    console.log('--- Starting Chronos Comprehensive Tests ---');

    try {
        const { HistoryManager } = require('../out/historyManager');
        const { HistoryStorage } = require('../out/storage');
        const { AIService } = require('../out/ai/aiService');
        const { GitService } = require('../out/git/gitService');
        const { HistoryFilter } = require('../out/historyFilter');

        const context = new mockVscode.ExtensionContext();
        const storage = new HistoryStorage(context);
        const gitService = new GitService();
        const manager = new HistoryManager(context, storage, gitService);
        const aiService = new AIService();
        const filter = new HistoryFilter(storage, gitService);

        // --- 1. LOGIC TEST: Magnitude Parsing ---
        console.log('\n[Test 1] Magnitude Parsing');
        const diff = '--- a\n+++ b\n@@ -1,1 +1,2 @@\n context\n-old\n+new 1\n+new 2';
        // Accessing private method for test
        const mag = manager.parseMagnitude(diff);
        if (mag.added === 2 && mag.deleted === 1) {
            console.log('✅ Magnitude parsing PASSED');
        } else {
            console.error('❌ Magnitude parsing FAILED:', mag);
        }

        // --- 2. LOGIC TEST: Clustering ---
        console.log('\n[Test 2] Snapshot Clustering');
        const t = Date.now();
        const snaps = [
            { id: 'a', timestamp: t },
            { id: 'b', timestamp: t - 60000 }, // 1 min
            { id: 'c', timestamp: t - 120000 }, // 2 min
            { id: 'd', timestamp: t - 1000000 } // 16 min
        ];
        const clustered = manager.clusterSnapshots(snaps);
        if (clustered.length === 2 && clustered[0].type === 'cluster') {
            console.log('✅ Clustering PASSED');
        } else {
            console.error('❌ Clustering FAILED:', clustered.length);
        }

        // --- 3. AI INTEGRATION TEST ---
        console.log('\n[Test 3] AI Integration (Gemini)');
        
        // Mocking config
        mockVscode.workspace.getConfiguration = (section) => {
            if (section === 'chronos.ai') {
                return {
                    get: (k, d) => (k === 'apiKey' ? apiKey : (k === 'model' ? modelId : d))
                };
            }
            return { get: (k, d) => d };
        };
        aiService.init();

        console.log('Calling Gemini...');
        const summary = await aiService.summarizeDiff(diff);
        console.log('AI Summary:', summary);
        
        const explanation = await aiService.explainDiff(diff);
        console.log('AI Explanation:', explanation);

        const commitMsg = await aiService.generateCommitMessage(diff);
        console.log('AI Commit Message:', commitMsg);

        const searchRes = await aiService.semanticSearch("Fix old logic", JSON.stringify([{id:'1', label: 'Fixed old bug'}]))
        console.log('AI Semantic Search IDs:', searchRes);

        if (summary && explanation && commitMsg && searchRes) {
            console.log('✅ AI Integration PASSED');
        } else {
            console.error('❌ AI Integration FAILED (missing results)');
        }

        // --- 4. CORE TEST: History Filter (Regression) ---
        console.log('\n[Test 4] History Filter (Selection Range)');
        // Mock git diff for filter
        gitService.getDiff = async () => '@@ -1,1 +1,1 @@\n-old\n+new';
        storage.getSnapshotUri = async (s) => mockVscode.Uri.file('/tmp/' + s.id);
        
        const history = [{ id: 'h1', timestamp: Date.now(), filePath: 'test.ts', eventType: 'save', storagePath: 'h1' }];
        const sel = new mockVscode.Range(0, 0, 1, 0);
        
        const filtered = await filter.filterHistoryForSelection(history, mockVscode.Uri.file('/test.ts'), sel);
        if (filtered.length > 0 && filtered[0].relevantRange) {
            console.log('✅ History Filter regression test PASSED');
        } else {
            console.error('❌ History Filter FAILED (range missing)');
        }

        // --- 5. REGRESSION CHECK: Registered Commands ---
        console.log('\n[Test 5] Regression Check (Registered Commands)');
        // Mocking activate context
        const extension = require('../out/extension');
        const extContext = new mockVscode.ExtensionContext();
        extension.activate(extContext);
        
        const commands = mockVscode.commands.getCommands();
        const necessary = ['_chronos.openDiff', '_chronos.openDiffGit', 'chronos.generateCommitMessage'];
        let missing = 0;
        necessary.forEach(c => {
            if (!commands.has(c)) {
                console.error(`❌ Regression: Command ${c} is NOT registered!`);
                missing++;
            }
        });
        if (missing === 0) console.log('✅ All necessary internal/AI commands are registered.');

    } catch (e) {
        console.error('Test Suite Exception:', e);
    }
}

runComprehensiveTests();
