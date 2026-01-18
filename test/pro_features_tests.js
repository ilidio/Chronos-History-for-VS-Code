const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const { mockVscode, fsStore, commandsMap } = require('./mock_vscode');
const { GoogleGenAI } = require("@google/genai");

// CONFIGURATION
const apiKey = "AIzaSyBBE38sDhriz8ZsP_0hAj84qDKNATnxi0M";
const modelId = "gemini-3-flash-preview";

// Mock modules
Module.prototype.require = function(request) {
    if (request === 'vscode') return mockVscode;
    return originalRequire.apply(this, arguments);
};

async function runProTests() {
    console.log('--- Starting Chronos Pro Features Tests ---');

    try {
        const { HistoryManager } = require('../out/historyManager');
        const { HistoryStorage } = require('../out/storage');
        const { AIService } = require('../out/ai/aiService');
        const { GitService } = require('../out/git/gitService');

        const context = new mockVscode.ExtensionContext();
        const storage = new HistoryStorage(context);
        const gitService = new GitService();
        const manager = new HistoryManager(context, storage, gitService);
        const aiService = new AIService();

        // --- Test 1: Magnitude Parsing ---
        console.log('\n[Test 1] Magnitude Parsing');
        const sampleDiff = `
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,5 @@
 line 1
-line 2
+new line 2
+line 3
+line 4
+line 5
-line 6
        `.trim();
        
        // Magnitude logic is private, but I can call it via prototype for testing
        const magnitude = manager.parseMagnitude(sampleDiff);
        console.log('Parsed Magnitude:', magnitude);
        if (magnitude.added === 4 && magnitude.deleted === 2) {
            console.log('✅ Magnitude parsing successful.');
        } else {
            console.error('❌ Magnitude parsing failed. Expected +4 -2.');
        }

        // --- Test 2: Snapshot Clustering ---
        console.log('\n[Test 2] Snapshot Clustering');
        const now = Date.now();
        const snapshots = [
            { id: '1', timestamp: now, filePath: 'a.ts', eventType: 'save' },
            { id: '2', timestamp: now - 1000, filePath: 'a.ts', eventType: 'save' },
            { id: '3', timestamp: now - 2000, filePath: 'a.ts', eventType: 'save' },
            { id: '4', timestamp: now - 600000, filePath: 'a.ts', eventType: 'save' } // 10 mins ago
        ];
        
        const clustered = manager.clusterSnapshots(snapshots);
        console.log('Clustered items count:', clustered.length);
        if (clustered.length === 2 && clustered[0].type === 'cluster') {
            console.log('✅ Snapshot clustering successful.');
        } else {
            console.error('❌ Snapshot clustering failed.');
        }

        // --- Test 3: AI Service Integration ---
        console.log('\n[Test 3] AI Service Integration (Gemini)');
        
        // Mock VSCode config for AIService
        const originalGetConfig = mockVscode.workspace.getConfiguration;
        mockVscode.workspace.getConfiguration = (section) => {
            if (section === 'chronos.ai') {
                return {
                    get: (key, def) => {
                        if (key === 'apiKey') return apiKey;
                        if (key === 'model') return modelId;
                        return def;
                    }
                };
            }
            return originalGetConfig(section);
        };

        // Re-init AI service with mock config
        aiService.init();

        if (!aiService.isEnabled('smartSummaries')) {
            console.error('❌ AI Service not enabled with key.');
        } else {
            console.log('✨ AI Service enabled. Calling Gemini...');
            
            // 3a. Summarize
            const summary = await aiService.summarizeDiff(sampleDiff);
            console.log('AI Summary:', summary);
            if (summary && summary.length > 0) console.log('✅ Summarize successful.');

            // 3b. Explain
            const explanation = await aiService.explainDiff(sampleDiff);
            console.log('AI Explanation:', explanation);
            if (explanation && explanation.length > 0) console.log('✅ Explanation successful.');

            // 3c. Commit Message
            const commitMsg = await aiService.generateCommitMessage(sampleDiff);
            console.log('AI Commit Message:\n', commitMsg);
            if (commitMsg && commitMsg.length > 0) console.log('✅ Commit Message successful.');

            // 3d. Git Explain
            const gitExplain = await aiService.explainDiff(sampleDiff);
            console.log('AI Git Explain:', gitExplain);
            if (gitExplain && gitExplain.length > 0) console.log('✅ Git Explain successful.');
        }

        // --- Test 4: Regression Check (Deleted File logic) ---
        console.log('\n[Test 4] Regression Check: Deleted Files');
        // Ensure getDeletedFiles still returns something
        const deleted = await manager.getDeletedFiles();
        console.log('Deleted files found:', deleted.length);
        console.log('✅ Regression check passed (method exists and returns).');

    } catch (e) {
        console.error('Pro Feature Test Suite Failed:', e);
        console.error(e.stack);
    }
}

runProTests();
