// Cross-tool interop conformance test.
//
// The project-folder hash is the contract that lets the Chronos VS Code extension,
// the Chronos Diff App, and the Chronos Visual Studio extension share one
// `.chronos-history` store. All three must produce the SAME folder name
// (`{projectName}-{hash}`) for a given absolute project path, or they cannot
// discover each other's history.
//
// The golden values below were verified byte-for-byte against the C# port in
// HistoryStorage.GenerateProjectHash (Chronos-History-Visual-Studio-Extension)
// and the JS copy in the Diff App (main.js generateProjectHash). If this test
// ever fails, the JS side has drifted — DO NOT just update the golden values;
// re-verify against the C# and Diff App implementations first.

const Module = require('module');
const originalRequire = Module.prototype.require;
const path = require('path');
const { mockVscode } = require('./mock_vscode');

Module.prototype.require = function (request) {
    if (request === 'vscode') return mockVscode;
    return originalRequire.apply(this, arguments);
};

const { HistoryStorage } = require('../out/storage');

// path -> expected hash (verified against C# GenerateProjectHash and Diff App)
const GOLDEN = [
    ['/Users/ilidiomartins/src/Personal/Chronos-History-Visual-Studio-Extension', '3b885e0c'],
    ['/Users/ilidiomartins/src/Personal/Chronos-History-for-VS-Code', '5350bed0'],
    ['C:\\Users\\ilidio\\source\\repos\\MyApp', '40d40158'],
    ['/home/dev/projects/website', '32a275f'],
];

const SHARED_BASE = '/tmp/.chronos-history-interop-test';

async function run() {
    console.log('\n--- Chronos Interop Hash Conformance ---');
    let failures = 0;

    for (const [projectPath, expectedHash] of GOLDEN) {
        const projectName = path.basename(projectPath.replace(/[\\/]+$/, '').replace(/\\/g, '/'));
        const projectUri = mockVscode.Uri.file(projectPath);
        const fileUri = mockVscode.Uri.file(path.join(projectPath, 'src/index.ts'));

        const workspaceFolders = [{ uri: projectUri, name: projectName, index: 0 }];
        mockVscode.workspace.workspaceFolders = workspaceFolders;
        mockVscode.workspace.getWorkspaceFolder = (uri) =>
            workspaceFolders.find(f => uri.fsPath.startsWith(f.uri.fsPath));
        mockVscode.window.activeTextEditor = { document: { uri: fileUri } };

        // Force the shared-folder code path (custom global path, not in-project).
        const configStore = new Map();
        configStore.set('saveInProjectFolder', false);
        configStore.set('customStoragePath', SHARED_BASE);
        mockVscode.workspace.getConfiguration = () => ({
            get: (key, def) => (configStore.has(key) ? configStore.get(key) : def),
            update: async (key, value) => { configStore.set(key, value); },
        });

        const context = new mockVscode.ExtensionContext();
        const storage = new HistoryStorage(context);
        await storage.init();

        const root = await storage.getWorkspaceStorageRoot();
        const folder = path.basename(root.fsPath);
        const expectedFolder = `${projectName}-${expectedHash}`;

        if (folder === expectedFolder) {
            console.log(`✅ ${projectName} -> ${folder}`);
        } else {
            failures++;
            console.error(`❌ ${projectPath}\n     expected folder: ${expectedFolder}\n     got folder:      ${folder}`);
        }
    }

    if (failures > 0) {
        console.error(`\n❌ Interop hash conformance FAILED (${failures} mismatch(es)).`);
        process.exit(1);
    }
    console.log('\n✅ All project hashes match the cross-tool golden values.');
}

run().catch(e => { console.error('Test crashed:', e); process.exit(1); });
