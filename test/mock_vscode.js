const path = require('path');
const EventEmitter = require('events');

class MockUri {
    constructor(scheme, authority, path, query, fragment) {
        this.scheme = scheme;
        this.authority = authority;
        this.path = path;
        this.query = query;
        this.fragment = fragment;
        this.fsPath = path; 
    }
    static file(pathStr) { return new MockUri('file', '', pathStr, '', ''); }
    static parse(str) { return new MockUri('file', '', str, '', ''); }
    static joinPath(base, ...paths) {
        return new MockUri(base.scheme, base.authority, path.join(base.path, ...paths), '', '');
    }
    toString() { return this.path; }
}

const commandsMap = new Map();
const fsStore = new Map();

const mockVscode = {
    Uri: MockUri,
    Position: class {
        constructor(line, character) {
            this.line = line;
            this.character = character;
        }
    },
    Range: class {
        constructor(startLine, startChar, endLine, endChar) {
            if (typeof startLine === 'object') {
                this.start = startLine;
                this.end = startChar;
            } else {
                this.start = new mockVscode.Position(startLine, startChar);
                this.end = new mockVscode.Position(endLine, endChar);
            }
        }
        get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
    },
    TreeItem: class {
        constructor(label, collapsibleState) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { One: 1, Two: 2 },
    ThemeIcon: class { constructor(id) {} },
    EventEmitter: class extends EventEmitter {
        constructor() { super(); this.event = (listener) => this.on('event', listener); }
        fire(data) { this.emit('event', data); }
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
        createStatusBarItem: () => ({ show: () => {}, hide: () => {}, text: '', command: '' }),
        createOutputChannel: (name) => ({
            appendLine: (msg) => console.log(`[OutputChannel: ${name}] ${msg}`),
            show: (preserveFocus) => {},
            dispose: () => {}
        }),
        showInformationMessage: (msg) => console.log('Info:', msg),
        showErrorMessage: (msg) => console.error('Error:', msg),
        showInputBox: async (opts) => { console.log('InputBox:', opts.prompt); return 'MockInput'; },
        registerTreeDataProvider: () => {},
        setStatusBarMessage: () => {},
        createWebviewPanel: (viewType, title, column, options) => {
            console.log(`createWebviewPanel: ${title}`);
            return {
                webview: {
                    html: '',
                    onDidReceiveMessage: (cb) => {
                        // Mock receiving a message immediately if needed, or store cb
                    },
                    postMessage: (msg) => {}
                }
            };
        },
        activeTextEditor: undefined 
    },
    workspace: {
        fs: {
            createDirectory: async (uri) => {},
            writeFile: async (uri, content) => { fsStore.set(uri.toString(), content); },
            readFile: async (uri) => {
                const data = fsStore.get(uri.toString());
                if (!data) throw new Error('File not found: ' + uri.toString());
                return data;
            },
            stat: async (uri) => {
                if (!fsStore.has(uri.toString())) throw new Error('File not found');
                return { type: 1, ctime: 0, mtime: 0, size: 0 };
            }
        },
        getConfiguration: (section) => ({
            get: (key, defaultValue) => defaultValue
        }),
        asRelativePath: (uriOrStr) => {
            const p = typeof uriOrStr === 'string' ? uriOrStr : uriOrStr.path;
            return path.basename(p); 
        },
        workspaceFolders: [{ uri: MockUri.file('/workspace') }],
        getWorkspaceFolder: (uri) => {
            return { uri: MockUri.file('/workspace'), name: 'workspace', index: 0 };
        },
        textDocuments: [],
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        onDidCreateFiles: () => ({ dispose: () => {} }),
        onDidSaveTextDocument: () => ({ dispose: () => {} }),
        onDidOpenTextDocument: () => ({ dispose: () => {} }),
        onDidRenameFiles: () => ({ dispose: () => {} }),
        onDidDeleteFiles: () => ({ dispose: () => {} }),
        rootPath: '/workspace'
    },
    commands: {
        registerCommand: (command, callback) => {
            console.log(`Registered command: ${command}`);
            commandsMap.set(command, callback);
            return { dispose: () => {} };
        },
        executeCommand: async (cmd, ...args) => {
            console.log(`Executed command: ${cmd}`, args);
            if (commandsMap.has(cmd)) {
                return commandsMap.get(cmd)(...args);
            }
        },
        getCommands: () => commandsMap
    },
    ExtensionContext: class {
        constructor() {
            this.subscriptions = [];
            this.storageUri = MockUri.file('/globalStorage');
            this.globalStorageUri = MockUri.file('/globalStorage');
            this.extensionUri = MockUri.file('/extension');
        }
    }
};

module.exports = { mockVscode, fsStore, commandsMap };
