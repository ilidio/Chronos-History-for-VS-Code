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

// Helper to set file content in the mock FS
function setFileContent(uri, content) {
    fsStore.set(uri.toString(), Buffer.from(content));
}

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
    OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
    FileType: {
        Unknown: 0,
        File: 1,
        Directory: 2,
        SymbolicLink: 64
    },
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
        registerWebviewViewProvider: () => {},
        createTreeView: () => ({ dispose: () => {} }),
        setStatusBarMessage: () => {},
        createTextEditorDecorationType: () => ({ dispose: () => {} }),
        onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
        createWebviewPanel: (viewType, title, column, options) => {
            console.log(`createWebviewPanel: ${title}`);
            return {
                webview: {
                    html: '',
                    onDidReceiveMessage: (cb) => {
                        // Mock receiving a message immediately if needed, or store cb
                    },
                    postMessage: (msg) => {}
                },
                onDidDispose: (cb) => {},
                reveal: () => {},
                dispose: () => {}
            };
        },
        activeTextEditor: undefined 
    },
    workspace: {
        fs: {
            createDirectory: async (uri) => {},
            writeFile: async (uri, content) => { fsStore.set(uri.toString(), Buffer.from(content)); },
            readFile: async (uri) => {
                const data = fsStore.get(uri.toString());
                if (!data) {
                    const error = new Error('File not found: ' + uri.toString());
                    error.code = 'FileNotFound'; // Mimic vscode.FileSystemError
                    throw error;
                }
                return data;
            },
            stat: async (uri) => {
                if (!fsStore.has(uri.toString())) {
                    const error = new Error('File not found');
                    error.code = 'FileNotFound'; // Mimic vscode.FileSystemError
                    throw error;
                }
                return { type: mockVscode.FileType.File, ctime: 0, mtime: 0, size: fsStore.get(uri.toString()).length };
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

module.exports = { mockVscode, fsStore, commandsMap, setFileContent };
