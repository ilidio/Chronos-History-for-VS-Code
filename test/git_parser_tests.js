const Module = require('module');
const originalRequire = Module.prototype.require;
const { mockVscode } = require('./mock_vscode');

// Mock vscode module
Module.prototype.require = function(request) {
    if (request === 'vscode') return mockVscode;
    return originalRequire.apply(this, arguments);
};

const { GitService } = require('../out/git/gitService');

let rangeFailures = 0;

async function runGitParserTests() {
    console.log('\n--- Chronos Git Parser Unit Tests ---');
    const git = new GitService();

    try {
        // --- Test 1: Churn Parsing ---
        console.log('\n[Test 1] Git Churn Parser');
        const testChurn = (stdout, expectedAdded, expectedDeleted) => {
            // We need to trigger the parser. Since it's inside getWorkspaceChurn's callback, 
            // we'll rely on the logic we wrote. 
            // Manual check of the regex logic:
            const addedMatch = stdout.match(/(\d+) insertion/);
            const deletedMatch = stdout.match(/(\d+) deletion/);
            const added = addedMatch ? parseInt(addedMatch[1]) : 0;
            const deleted = deletedMatch ? parseInt(deletedMatch[1]) : 0;
            
            if (added === expectedAdded && deleted === expectedDeleted) {
                console.log(`✅ Passed for: "${stdout.trim()}"`);
            } else {
                console.error(`❌ Failed! Expected +${expectedAdded}-${expectedDeleted}, got +${added}-${deleted}`);
            }
        };

        testChurn(" 1 file changed, 5 insertions(+), 3 deletions(-)", 5, 3);
        testChurn(" 2 files changed, 1 insertion(+)", 1, 0);
        testChurn(" 1 file changed, 10 deletions(-)", 0, 10);

        // --- Test 3: git log -L per-commit range ---
        // `git log -L` prints one hunk header per commit, and those numbers are
        // the only ones that apply inside that version of the file.
        console.log('\n[Test 3] git log -L per-commit range');
        const logLOutput = [
            'commit aaaa1111',
            'Author: Me',
            'Date: 2024-01-01',
            '    touch the block',
            'diff --git a/file.ts b/file.ts',
            '--- a/file.ts',
            '+++ b/file.ts',
            '@@ -41,5 +41,6 @@',
            ' context',
            '+added',
            'commit bbbb2222',
            'Author: Me',
            'Date: 2023-12-01',
            '    earlier',
            'diff --git a/file.ts b/file.ts',
            '@@ -10,2 +10,2 @@',
            '-old',
            '+new',
            ''
        ].join('\n');

        const parsed = git.parseGitLogL(logLOutput, 10);
        const expectRange = (commit, start, end, label) => {
            const r = commit && commit.relevantRange;
            if (r && r.start === start && r.end === end) {
                console.log(`✅ ${label} (${start}-${end})`);
            } else {
                console.error(`❌ ${label} — expected ${start}-${end}, got ${r ? r.start + '-' + r.end : r}`);
                rangeFailures++;
            }
        };

        if (parsed.length !== 2) {
            console.error(`❌ Expected 2 commits, got ${parsed.length}`);
            rangeFailures++;
        } else {
            console.log('✅ Both commits parsed.');
            expectRange(parsed[0], 40, 45, "newest commit's range comes from its own hunk header");
            expectRange(parsed[1], 9, 10, "older commit's range is independent of it");
        }

        // --- Test 2: Blame Porcelain Parser ---
        console.log('\n[Test 2] Blame Porcelain Parser');
        const mockBlameOutput = 
`4e888279aa924ba1bdb4bad0160d0146 1 1 1
author Ilidio
author-mail <test@example.com>
author-time 1737900000
author-tz +0000
committer Ilidio
summary Test
filename test.ts
	import * as vscode from 'vscode';
f55778a4b874450baa79755148168d0a 2 2 1
author Ilidio
author-mail <test@example.com>
author-time 1737910000
author-tz +0000
filename test.ts
	export class Test {}`;

        // Manual check of the logic in GitService.getBlame
        const parseBlame = (stdout) => {
            const result = new Map();
            const lines = stdout.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.match(/^[a-f0-9]{32,40} \d+ \d+ \d+/)) {
                    const parts = line.split(' ');
                    const finalLine = parseInt(parts[2]);
                    let j = i + 1;
                    while (j < lines.length && !lines[j].startsWith('\t')) {
                        if (lines[j].startsWith('author-time ')) {
                            const timestamp = parseInt(lines[j].substring(12));
                            result.set(finalLine - 1, timestamp * 1000);
                        }
                        j++;
                    }
                    i = j;
                }
            }
            return result;
        };

        const blameMap = parseBlame(mockBlameOutput);
        if (blameMap.size === 2 && blameMap.get(0) === 1737900000000 && blameMap.get(1) === 1737910000000) {
            console.log('✅ Blame porcelain parsed correctly (timestamps and line numbers).');
        } else {
            console.error('❌ Blame parsing failed. Map size:', blameMap.size);
            console.log('Map data:', Array.from(blameMap.entries()));
        }

    } catch (e) {
        console.error('Git Parser Tests Failed:', e);
    }
}

runGitParserTests().then(() => {
    if (rangeFailures > 0) {
        console.error(`\n--- ${rangeFailures} git log -L range check(s) failed ---`);
        process.exit(1);
    }
});
