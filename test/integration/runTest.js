/**
 * Launches a real VS Code and runs the integration suite inside it.
 *
 * Everything in test/*.js runs against test/mock_vscode.js, a stub written by
 * hand. That proves the logic but not the assumptions about what the real API
 * returns — above all the shape of what a language extension's symbol provider
 * gives back, which is what the whole context resolution rests on. This runner
 * is the only place those assumptions meet the real thing.
 *
 * VS Code is downloaded on first run into .vscode-test/ (gitignored).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const workspace = path.resolve(__dirname, 'fixture');

    // A throwaway profile, so the user's own settings and installed extensions
    // (including any released build of this one) cannot take part. Built-in
    // extensions live inside the VS Code app, so the TypeScript language
    // features still load — which is the point.
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-vscode-'));

    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                workspace,
                '--user-data-dir', path.join(profile, 'user-data'),
                '--extensions-dir', path.join(profile, 'extensions'),
                '--disable-workspace-trust',
                '--skip-welcome',
                '--skip-release-notes',
                '--disable-gpu'
            ]
        });
    } finally {
        fs.rmSync(profile, { recursive: true, force: true });
    }
}

main().catch(err => {
    console.error('Integration run failed:', err);
    process.exit(1);
});
