const path = require('path');
const Mocha = require('mocha');
const { glob } = require('glob');

/** Entry point VS Code calls inside the extension host. */
async function run() {
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        // The TypeScript language service needs a moment to warm up before it
        // answers a symbol request.
        timeout: 60000
    });

    const testsRoot = __dirname;
    const files = await glob('**/*.test.js', { cwd: testsRoot });
    files.sort().forEach(file => mocha.addFile(path.resolve(testsRoot, file)));

    return new Promise((resolve, reject) => {
        mocha.run(failures => {
            if (failures > 0) reject(new Error(`${failures} integration test(s) failed.`));
            else resolve();
        });
    });
}

module.exports = { run };
