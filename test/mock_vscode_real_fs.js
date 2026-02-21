const Module = require('module');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class MockUri {
    constructor(scheme, authority, pathStr, query, fragment) {
        this.scheme = scheme;
        this.authority = authority;
        this.path = pathStr;
        this.query = query;
        this.fragment = fragment;
        this.fsPath = pathStr; 
    }
    static file(pathStr) { return new MockUri('file', '', pathStr, '', ''); }
    static parse(str) { 
        // extremely basic parse
        if (str.startsWith('file://')) return new MockUri('file', '', str.substring(7), '', '');
        return new MockUri('file', '', str, '', ''); 
    }
    static joinPath(base, ...paths) {
        return new MockUri(base.scheme, base.authority, path.join(base.path, ...paths), '', '');
    }
    toString() { return this.path; }
}

const mockVscode = {
    Uri: MockUri,
    EventEmitter: EventEmitter,
    window: {
        createOutputChannel: () => ({ appendLine: () => {} }),
        showInformationMessage: (msg) => console.log(`[MockInfo] ${msg}`),
        showErrorMessage: (msg) => console.error(`[MockError] ${msg}`)
    },
    workspace: {
        fs: {
            createDirectory: async (uri) => {
                if (!fs.existsSync(uri.fsPath)) fs.mkdirSync(uri.fsPath, { recursive: true });
            },
            writeFile: async (uri, content) => {
                const dir = path.dirname(uri.fsPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(uri.fsPath, content);
            },
            readFile: async (uri) => {
                return fs.readFileSync(uri.fsPath);
            },
            stat: async (uri) => {
                const stats = fs.statSync(uri.fsPath);
                return { type: stats.isDirectory() ? 2 : 1 };
            }
        },
        getConfiguration: () => ({ get: (k, d) => d }),
        asRelativePath: (p) => path.basename(p.fsPath || p),
        workspaceFolders: [{ uri: MockUri.file(path.join(process.cwd(), 'test_workspace')) }],
        getWorkspaceFolder: () => ({ uri: MockUri.file(path.join(process.cwd(), 'test_workspace')) })
    },
    ExtensionContext: class {
        constructor(storagePath) {
            this.subscriptions = [];
            this.storageUri = MockUri.file(storagePath);
            this.globalStorageUri = MockUri.file(storagePath);
        }
    }
};

module.exports = { mockVscode };
