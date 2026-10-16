import * as vscode from 'vscode';
import { HistoryStorage } from './storage';
import { GitService } from './git/gitService';
import { Snapshot, RangeAnchoring } from './types';
import {
    DiffHunk,
    LineRange,
    clampRange,
    isRangeRelevant,
    mapRangeBackwards,
    parseHunks
} from './utils/rangeMapper';

/** What identifies the tracked block, beyond its position. */
export interface RangeAnchor {
    /** First non-blank line of the block, e.g. "render() {". */
    signatureLine: string;
}

/** Internal result of placing a range inside one snapshot. */
interface Landing {
    range: LineRange;
    anchoring: RangeAnchoring | 'lost';
}

export class HistoryFilter {
    /**
     * Hunks between two snapshots, keyed by their ids. Snapshot content never
     * changes, so this is valid for the lifetime of the session.
     */
    private hunkCache = new Map<string, DiffHunk[]>();

    constructor(
        private storage: HistoryStorage,
        private gitService: GitService
    ) {}

    /**
     * Filters the local timeline down to the snapshots where a range actually
     * changed, following the range backwards through history.
     *
     * The walk is positional (diff arithmetic) but verified by content: when an
     * `anchor` is given, every mapped range is checked against the anchor's
     * signature line and corrected if the block moved. When the block cannot be
     * found at all, the walk stops there — that snapshot is where it appears —
     * instead of dragging a meaningless range further back.
     */
    async filterHistoryForSelection(
        history: Snapshot[],
        fileUri: vscode.Uri,
        selection: vscode.Range,
        anchor?: RangeAnchor
    ): Promise<Snapshot[]> {
        if (history.length === 0) return [];

        // Sort new -> old
        const sorted = [...history].sort((a, b) => b.timestamp - a.timestamp);
        let signature = (anchor?.signatureLine ?? '').trim();
        let range = toLineRange(selection);
        let anchoring: RangeAnchoring = 'position';

        console.log(`[HistoryFilter] Filtering ${history.length} snapshots for ${fileUri.fsPath} range ${range.startLine}-${range.endLine}${signature ? ` anchored on "${signature}"` : ''}`);

        // Step 0: map the range from the file on disk onto the newest snapshot.
        try {
            const newestUri = await this.storage.getSnapshotUri(sorted[0], fileUri);
            // Not cached: the file on disk keeps changing.
            const hunks = parseHunks(await this.gitService.getHunks(newestUri.fsPath, fileUri.fsPath));
            const landed = await this.place(mapRangeBackwards(range, hunks), sorted[0], fileUri, signature, height(range));
            range = landed.range;

            if (landed.anchoring === 'lost') {
                // The anchor text is not in the newest snapshot — the block was
                // probably just renamed on disk. Track by position rather than
                // claiming there is no history.
                console.log('[HistoryFilter] Anchor not found in the newest snapshot; falling back to positional tracking.');
                signature = '';
            } else {
                anchoring = landed.anchoring;
            }
            console.log(`[HistoryFilter] Initial map (Current -> Newest): ${range.startLine}-${range.endLine} (${anchoring})`);
        } catch (e) {
            console.error('[HistoryFilter] Error mapping initial range:', e);
        }

        const relevant: Snapshot[] = [];

        for (let i = 0; i < sorted.length - 1; i++) {
            const newSnapshot = sorted[i];
            const oldSnapshot = sorted[i + 1];

            let hunks: DiffHunk[];
            try {
                hunks = await this.hunksBetween(oldSnapshot, newSnapshot, fileUri);
            } catch (e) {
                console.error(`[HistoryFilter] Error diffing snapshots at index ${i}:`, e);
                continue;
            }

            const touched = isRangeRelevant(range, hunks);
            if (touched) {
                relevant.push(withRange(newSnapshot, range, anchoring));
                console.log(`[HistoryFilter] Relevant: ${newSnapshot.id} (${newSnapshot.label || newSnapshot.eventType}) range ${range.startLine}-${range.endLine} (${anchoring})`);
            }

            const landed = await this.place(mapRangeBackwards(range, hunks), oldSnapshot, fileUri, signature, height(range));
            if (landed.anchoring === 'lost') {
                // The block does not exist this far back: newSnapshot is where it
                // first appears, and there is nothing older to follow.
                console.log(`[HistoryFilter] Block originates in ${newSnapshot.id}; stopping the walk.`);
                markOrigin(relevant, newSnapshot, range, touched);
                return relevant;
            }

            range = landed.range;
            anchoring = landed.anchoring;
        }

        // The oldest snapshot has no older neighbour to diff against, so it can
        // never count as "changed here". Include it as the earliest version of
        // the block we hold, but only when there is a trail to attach it to —
        // that way a range nothing ever touched comes back empty instead of
        // showing one stray entry.
        const oldest = sorted[sorted.length - 1];
        if (relevant.length > 0 || sorted.length === 1) {
            relevant.push(withRange(oldest, range, 'origin'));
            console.log(`[HistoryFilter] Oldest snapshot included: ${oldest.id} (range ${range.startLine}-${range.endLine})`);
        }

        console.log(`[HistoryFilter] Found ${relevant.length} relevant snapshots.`);
        return relevant;
    }

    private async hunksBetween(oldSnapshot: Snapshot, newSnapshot: Snapshot, fileUri: vscode.Uri): Promise<DiffHunk[]> {
        const key = `${oldSnapshot.id}->${newSnapshot.id}`;
        const cached = this.hunkCache.get(key);
        if (cached) return cached;

        const oldUri = await this.storage.getSnapshotUri(oldSnapshot, fileUri);
        const newUri = await this.storage.getSnapshotUri(newSnapshot, fileUri);
        const hunks = parseHunks(await this.gitService.getHunks(oldUri.fsPath, newUri.fsPath));

        this.hunkCache.set(key, hunks);
        return hunks;
    }

    /**
     * Places a mapped range inside one snapshot, correcting it by content when
     * an anchor is available.
     *
     * The invariant with an anchor is that the tracked range *begins* at the
     * anchor line. A hunk that overlaps the range start drags it up to where
     * the hunk began, which is how a positional walk slowly swallows unrelated
     * lines above the block; checking the first line catches exactly that, and
     * a block that moved is found again wherever it went.
     */
    private async place(
        candidate: LineRange,
        snapshot: Snapshot,
        fileUri: vscode.Uri,
        signature: string,
        trackedHeight: number
    ): Promise<Landing> {
        const lines = await this.readSnapshotLines(snapshot, fileUri);
        if (!lines) {
            // Cannot verify: keep the positional answer rather than dropping the
            // snapshot from the timeline.
            return { range: candidate, anchoring: 'position' };
        }

        const clamped = clampRange(candidate, lines.length);

        if (!signature) {
            // Without an anchor, a range that maps past the end of the file is
            // the end of the trail.
            if (candidate.startLine >= lines.length) return { range: clamped, anchoring: 'lost' };
            return { range: clamped, anchoring: 'position' };
        }

        if ((lines[clamped.startLine] ?? '').trim() === signature) {
            return { range: clamped, anchoring: 'position' };
        }

        const found = findNearest(lines, signature, clamped.startLine);
        if (found < 0) return { range: clamped, anchoring: 'lost' };

        return {
            range: clampRange({ startLine: found, endLine: found + trackedHeight }, lines.length),
            anchoring: 'content'
        };
    }

    private async readSnapshotLines(snapshot: Snapshot, fileUri: vscode.Uri): Promise<string[] | undefined> {
        try {
            const uri = await this.storage.getSnapshotUri(snapshot, fileUri);
            const data = await vscode.workspace.fs.readFile(uri);
            return new TextDecoder().decode(data).split(/\r?\n/);
        } catch (e) {
            console.warn(`[HistoryFilter] Could not read snapshot ${snapshot.id}:`, e);
            return undefined;
        }
    }
}

/** Line index whose trimmed text equals the signature, closest to `from`. */
function findNearest(lines: string[], signature: string, from: number): number {
    let best = -1;
    let bestDistance = Number.MAX_SAFE_INTEGER;

    for (let i = 0; i < lines.length; i++) {
        if ((lines[i] ?? '').trim() !== signature) continue;
        const distance = Math.abs(i - from);
        if (distance < bestDistance) {
            best = i;
            bestDistance = distance;
        }
    }

    return best;
}

function height(range: LineRange): number {
    return Math.max(0, range.endLine - range.startLine);
}

function toLineRange(selection: vscode.Range): LineRange {
    let endLine = selection.end.line;
    // VS Code selections use an exclusive end: when end.character is 0 the
    // end.line is one past the last selected line.
    if (selection.end.character === 0 && endLine > selection.start.line) {
        endLine--;
    }
    return { startLine: selection.start.line, endLine: Math.max(selection.start.line, endLine) };
}

function withRange(snapshot: Snapshot, range: LineRange, anchoring: RangeAnchoring): Snapshot {
    return {
        ...snapshot,
        relevantRange: { start: range.startLine, end: range.endLine },
        rangeAnchoring: anchoring
    };
}

/** Marks the snapshot where the tracked block first appears. */
function markOrigin(relevant: Snapshot[], snapshot: Snapshot, range: LineRange, alreadyPushed: boolean) {
    if (alreadyPushed && relevant.length > 0) {
        relevant[relevant.length - 1] = { ...relevant[relevant.length - 1], rangeAnchoring: 'origin' };
        return;
    }
    relevant.push(withRange(snapshot, range, 'origin'));
}
