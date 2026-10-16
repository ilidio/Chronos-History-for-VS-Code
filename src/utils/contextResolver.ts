import * as vscode from 'vscode';

/**
 * Resolves the "context" around the cursor or selection — the enclosing
 * function, method or class — so history can be filtered by a semantic block
 * instead of a raw line range.
 *
 * Resolution is language-agnostic: it asks VS Code's own providers, which are
 * supplied by whatever language extensions the user has installed. The cascade
 * is symbols -> folding ranges -> the selection itself, so there is always an
 * answer, and `source` says which one produced it.
 */
export type ContextSource = 'symbol' | 'folding' | 'selection';

export interface ContextAnchor {
    /** Dotted path of the enclosing symbols, e.g. "MyClass.render". Empty when unknown. */
    namePath: string;
    /** Human-readable symbol kind, e.g. "Method". Empty when unknown. */
    kind: string;
    /** First non-blank line of the block: a content anchor for finding it in older versions. */
    signatureLine: string;
}

export interface ResolvedContext {
    /** Whole-line range covering the block. `end.line` is the inclusive last line. */
    range: vscode.Range;
    startLine: number;
    endLine: number;
    anchor: ContextAnchor;
    source: ContextSource;
    /** Short description for the UI, e.g. "MyClass.render" or "lines 12-40". */
    label: string;
}

/**
 * Symbol kinds that represent a block of code worth tracking as a unit.
 * When the innermost symbol is something finer (a variable, a field), we walk
 * back out to the closest of these instead.
 */
const BLOCK_KINDS: ReadonlySet<number> = new Set<number>([
    vscode.SymbolKind.Module,
    vscode.SymbolKind.Namespace,
    vscode.SymbolKind.Package,
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Struct,
    vscode.SymbolKind.Enum,
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Constructor
]);

const KIND_NAMES: { [kind: number]: string } = {
    [vscode.SymbolKind.Module]: 'Module',
    [vscode.SymbolKind.Namespace]: 'Namespace',
    [vscode.SymbolKind.Package]: 'Package',
    [vscode.SymbolKind.Class]: 'Class',
    [vscode.SymbolKind.Interface]: 'Interface',
    [vscode.SymbolKind.Struct]: 'Struct',
    [vscode.SymbolKind.Enum]: 'Enum',
    [vscode.SymbolKind.Function]: 'Function',
    [vscode.SymbolKind.Method]: 'Method',
    [vscode.SymbolKind.Constructor]: 'Constructor',
    [vscode.SymbolKind.Property]: 'Property',
    [vscode.SymbolKind.Field]: 'Field',
    [vscode.SymbolKind.Variable]: 'Variable',
    [vscode.SymbolKind.Constant]: 'Constant'
};

/** Normalized shape covering both DocumentSymbol (nested) and SymbolInformation (flat). */
interface SymbolNode {
    name: string;
    kind: number;
    container: string;
    range: vscode.Range;
    children: SymbolNode[];
}

export async function resolveContext(
    document: vscode.TextDocument,
    target: vscode.Range | vscode.Position
): Promise<ResolvedContext> {
    const { startLine, endLine } = normalizeTarget(target);

    const bySymbol = await resolveBySymbols(document, startLine, endLine);
    if (bySymbol) return bySymbol;

    const byFolding = await resolveByFolding(document, startLine, endLine);
    if (byFolding) return byFolding;

    return makeContext(document, startLine, endLine, 'selection', '', '');
}

/** Resolves the context for an editor: its selection when there is one, else the cursor. */
export async function resolveContextForEditor(editor: vscode.TextEditor): Promise<ResolvedContext> {
    const selection: any = editor.selection;
    let target: vscode.Range | vscode.Position;

    if (selection && !selection.isEmpty) {
        target = selection;
    } else {
        target = selection?.active ?? selection?.start ?? new vscode.Position(0, 0);
    }

    return resolveContext(editor.document, target);
}

function normalizeTarget(target: vscode.Range | vscode.Position): { startLine: number, endLine: number } {
    const asRange = target as vscode.Range;
    if (asRange && asRange.start && asRange.end) {
        let endLine = asRange.end.line;
        // VS Code selections use an exclusive end: when end.character is 0 the
        // end.line is one past the last selected line.
        if (asRange.end.character === 0 && endLine > asRange.start.line) {
            endLine--;
        }
        return { startLine: asRange.start.line, endLine: Math.max(asRange.start.line, endLine) };
    }

    const line = (target as vscode.Position).line ?? 0;
    return { startLine: line, endLine: line };
}

async function resolveBySymbols(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number
): Promise<ResolvedContext | undefined> {
    let raw: any[] | undefined;
    try {
        raw = await vscode.commands.executeCommand<any[]>('vscode.executeDocumentSymbolProvider', document.uri);
    } catch (e) {
        console.warn('[ContextResolver] Symbol provider failed:', e);
        return undefined;
    }

    const chain = containingChain(toNodes(raw), startLine, endLine);
    if (chain.length === 0) return undefined;

    // Innermost symbol that is a real block; falls back to the innermost symbol
    // of any kind so single-line declarations still resolve to something.
    let targetIndex = chain.length - 1;
    for (let i = chain.length - 1; i >= 0; i--) {
        if (BLOCK_KINDS.has(chain[i].kind)) {
            targetIndex = i;
            break;
        }
    }

    const target = chain[targetIndex];
    const names = chain.slice(0, targetIndex + 1).map(n => n.name).filter(n => n.length > 0);
    let namePath = names.join('.');
    // Flat SymbolInformation results carry the parent in containerName instead
    // of in the chain.
    if (chain.length === 1 && target.container) {
        namePath = namePath ? `${target.container}.${namePath}` : target.container;
    }

    return makeContext(
        document,
        target.range.start.line,
        target.range.end.line,
        'symbol',
        namePath,
        KIND_NAMES[target.kind] ?? ''
    );
}

async function resolveByFolding(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number
): Promise<ResolvedContext | undefined> {
    let folds: any[] | undefined;
    try {
        folds = await vscode.commands.executeCommand<any[]>('vscode.executeFoldingRangeProvider', document.uri);
    } catch (e) {
        console.warn('[ContextResolver] Folding range provider failed:', e);
        return undefined;
    }

    let best: { start: number, end: number } | undefined;
    for (const fold of folds ?? []) {
        if (typeof fold?.start !== 'number' || typeof fold?.end !== 'number') continue;
        if (fold.start > startLine || fold.end < endLine) continue;
        if (!best || (fold.end - fold.start) < (best.end - best.start)) {
            best = { start: fold.start, end: fold.end };
        }
    }

    if (!best) return undefined;
    return makeContext(document, best.start, best.end, 'folding', '', '');
}

function toNodes(raw: any[] | undefined): SymbolNode[] {
    const nodes: SymbolNode[] = [];
    for (const symbol of raw ?? []) {
        // DocumentSymbol exposes `range`; SymbolInformation exposes `location.range`.
        const range: vscode.Range | undefined = symbol?.range ?? symbol?.location?.range;
        if (!range?.start || !range?.end) continue;

        nodes.push({
            name: typeof symbol.name === 'string' ? symbol.name : '',
            kind: typeof symbol.kind === 'number' ? symbol.kind : -1,
            container: typeof symbol.containerName === 'string' ? symbol.containerName : '',
            range,
            children: toNodes(symbol.children)
        });
    }
    return nodes;
}

/**
 * Outermost-to-innermost chain of symbols whose range covers the whole target
 * range. Picking the smallest match at each level keeps this correct for flat
 * symbol lists, where a class and its methods are siblings.
 */
function containingChain(nodes: SymbolNode[], startLine: number, endLine: number): SymbolNode[] {
    let best: SymbolNode | undefined;
    for (const node of nodes) {
        if (node.range.start.line > startLine || node.range.end.line < endLine) continue;
        if (!best || lineSpan(node) < lineSpan(best)) best = node;
    }

    if (!best) return [];
    return [best, ...containingChain(best.children, startLine, endLine)];
}

function lineSpan(node: SymbolNode): number {
    return node.range.end.line - node.range.start.line;
}

function makeContext(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
    source: ContextSource,
    namePath: string,
    kind: string
): ResolvedContext {
    const lines = document.getText().split(/\r?\n/);
    const count = typeof document.lineCount === 'number' && document.lineCount > 0
        ? Math.min(document.lineCount, lines.length)
        : lines.length;
    const lastLine = Math.max(0, count - 1);

    const start = Math.max(0, Math.min(startLine, lastLine));
    let end = Math.max(start, Math.min(endLine, lastLine));

    // Trailing blank lines are not part of the block, and an empty end line
    // would make the range end at character 0 — which downstream filters read
    // as an exclusive end.
    while (end > start && (lines[end] ?? '').trim().length === 0) {
        end--;
    }

    const endCharacter = (lines[end] ?? '').length;
    const signatureLine = firstNonBlank(lines, start, end);

    return {
        range: new vscode.Range(start, 0, end, endCharacter),
        startLine: start,
        endLine: end,
        anchor: { namePath, kind, signatureLine },
        source,
        label: namePath || `lines ${start + 1}-${end + 1}`
    };
}

function firstNonBlank(lines: string[], start: number, end: number): string {
    for (let i = start; i <= end; i++) {
        const text = (lines[i] ?? '').trim();
        if (text.length > 0) return text;
    }
    return '';
}
