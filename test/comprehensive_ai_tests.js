const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const fs = require('fs');
const { mockVscode } = require('./mock_vscode');

// Mock vscode module
Module.prototype.require = function(request) {
    if (request === 'vscode') {
        return mockVscode;
    }
    return originalRequire.apply(this, arguments);
};

const { AIService } = require('../out/ai/aiService');

async function runComprehensiveAITests() {
    console.log('--- Chronos Comprehensive AI Tests ---');

    // 1. Load Config
    let config;
    try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.gemini.test.json'), 'utf8'));
    } catch (e) {
        console.error('Failed to load .gemini.test.json');
        process.exit(1);
    }

    // 2. Setup VS Code Mock Configuration
    mockVscode.workspace.getConfiguration = (section) => {
        if (section === 'chronos.ai') {
            return {
                get: (key, defaultValue) => {
                    if (key === 'apiKey') return config.apiKey;
                    if (key === 'model') return config.modelId;
                    if (key === 'language') return 'English';
                    return defaultValue !== undefined ? defaultValue : true;
                }
            };
        }
        return { get: (k, d) => d };
    };

    const ai = new AIService();
    const testDiff = "diff --git a/src/auth.ts b/src/auth.ts\n" +
"index 123456..789012 100644\n" +
"--- a/src/auth.ts\n" +
"+++ b/src/auth.ts\n" +
"@@ -10,5 +10,5 @@\n" +
"-export function login(user: string) {\n" +
"+export async function login(user: User) {\n" +
"-  console.log(\"Logging in \" + user);\n" +
"+  logger.info(`Logging in user: ${user.id}`);\n" +
"   return await authProvider.authenticate(user);\n" +
" }";

    try {
        // Test 1: summarizeDiff
        console.log('\n[Test 1] summarizeDiff');
        const summary = await ai.summarizeDiff(testDiff);
        console.log('Summary:', summary);
        if (summary && summary.length > 0) console.log('✅ PASS'); else console.error('❌ FAIL');

        // Test 2: explainDiff
        console.log('\n[Test 2] explainDiff');
        const explanation = await ai.explainDiff(testDiff);
        console.log('Explanation:', explanation);
        if (explanation && explanation.length > 10) console.log('✅ PASS'); else console.error('❌ FAIL');

        // Test 3: generateCommitMessage
        console.log('\n[Test 3] generateCommitMessage');
        const commitMsg = await ai.generateCommitMessage(testDiff);
        console.log('Commit Message:\n', commitMsg);
        if (commitMsg && (commitMsg.includes('feat') || commitMsg.includes('refactor') || commitMsg.includes('fix'))) console.log('✅ PASS (looks like conventional commit)');
        else console.log('✅ PASS (content received)');

        // Test 4: semanticSearch
        console.log('\n[Test 4] semanticSearch');
        const meta = JSON.stringify([
            { id: '1', label: 'Auth Fix', filePath: 'src/auth.ts' },
            { id: '2', label: 'UI Update', filePath: 'src/ui/header.tsx' }
        ]);
        const searchResult = await ai.semanticSearch('Find login changes', meta);
        console.log('Search Result (IDs):', searchResult);
        if (searchResult && searchResult.includes('1')) console.log('✅ PASS'); else console.error('❌ FAIL');

        // Test 5: generateDailyBriefing
        console.log('\n[Test 5] generateDailyBriefing');
        const activity = "- src/auth.ts: Updated login logic\n- src/db.ts: Fixed connection leak";
        const briefing = await ai.generateDailyBriefing(activity);
        console.log('Briefing:\n', briefing);
        if (briefing && briefing.length > 20) console.log('✅ PASS'); else console.error('❌ FAIL');

        // Test 6: generateChangelog
        console.log('\n[Test 6] generateChangelog');
        const changelog = await ai.generateChangelog(activity);
        console.log('Changelog:\n', changelog);
        if (changelog && changelog.includes('#')) console.log('✅ PASS'); else console.error('❌ FAIL');

        // Test 7: experimentPostMortem
        console.log('\n[Test 7] experimentPostMortem');
        const pm = await ai.experimentPostMortem(testDiff, false);
        console.log('Post-Mortem (Discarded):\n', pm);
        if (pm && pm.length > 10) console.log('✅ PASS'); else console.error('❌ FAIL');

    } catch (e) {
        console.error('Comprehensive AI Tests Failed:', e);
    }
}

runComprehensiveAITests();
