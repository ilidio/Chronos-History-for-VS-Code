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

/** What a range walk found, and what it could not look at. */
export interface RangeHistoryResult {
    /** Snapshots where the range changed, newest first. */
    relevant: Snapshot[];
    /**
     * Snapshots that could not be read: listed in the index, content gone from
     * storage. They are not evidence that the block did not change — nothing
     * can be said about them at all, which is a different answer and has to be
     * reported as one.
     */
    unreadable: Snapshot[];
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
        return (await this.filterHistoryForRange(history, fileUri, selection, anchor)).relevant;
    }

    /**
     * The same walk, with the snapshots it could not read reported separately.
     *
     * "The block never changed here" and "this version cannot be read" look
     * identical in a filtered list — both leave the entry out — and conflating
     * them tells the user the file has no history for the block when the truth
     * is that its content is missing.
     */
    async filterHistoryForRange(
        history: Snapshot[],
        fileUri: vscode.Uri,
        selection: vscode.Range,
        anchor?: RangeAnchor
    ): Promise<RangeHistoryResult> {
        const unreadable: Snapshot[] = [];
        if (history.length === 0) return { relevant: [], unreadable };

        // Storage has already told us which entries have no content on disk.
        // They are set aside before the walk rather than discovered during it:
        // `git diff --no-index` against a path that is not there resolves to no
        // output, which reads as "nothing changed here" — a missing version
        // would otherwise be silently counted as evidence that the block never
        // changed, which is the opposite of what is known about it.
        const missingContent = history.filter(s => s.contentMissing && s.storagePath);
        for (const snapshot of missingContent) unreadable.push(snapshot);
        if (missingContent.length > 0) {
            console.log(`[HistoryFilter] ${missingContent.length} snapshot(s) have no content in storage and cannot be compared.`);
            history = history.filter(s => !(s.contentMissing && s.storagePath));
            if (history.length === 0) return { relevant: [], unreadable };
        }

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
            await this.noteUnreadable([sorted[0]], fileUri, unreadable, e,
                '[HistoryFilter] Error mapping initial range:');
        }

        const relevant: Snapshot[] = [];

        for (let i = 0; i < sorted.length - 1; i++) {
            const newSnapshot = sorted[i];
            const oldSnapshot = sorted[i + 1];

            let hunks: DiffHunk[];
            try {
                hunks = await this.hunksBetween(oldSnapshot, newSnapshot, fileUri);
            } catch (e) {
                await this.noteUnreadable([newSnapshot, oldSnapshot], fileUri, unreadable, e,
                    `[HistoryFilter] Error diffing snapshots at index ${i}:`);
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
                return { relevant, unreadable };
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

        console.log(`[HistoryFilter] Found ${relevant.length} relevant snapshots${unreadable.length > 0 ? `, ${unreadable.length} unreadable` : ''}.`);
        return { relevant, unreadable };
    }

    /**
     * Records the snapshots in `candidates` whose content is gone.
     *
     * A diff can fail for reasons that have nothing to do with storage, so the
     * failure alone is not enough: each candidate is checked against disk, and
     * only a genuinely missing blob is reported as unreadable. Anything else
     * stays what it was — an error worth logging.
     */
    private async noteUnreadable(
        candidates: Snapshot[],
        fileUri: vscode.Uri,
        unreadable: Snapshot[],
        error: unknown,
        logPrefix: string
    ): Promise<void> {
        const missing: Snapshot[] = [];
        for (const snapshot of candidates) {
            // An entry with no storagePath (a label) holds no content by
            // design; it is not broken and never was part of the content walk.
            if (!snapshot?.storagePath) continue;
            try {
                const uri = await this.storage.getSnapshotUri(snapshot, fileUri);
                await vscode.workspace.fs.stat(uri);
            } catch {
                missing.push(snapshot);
            }
        }

        if (missing.length === 0) {
            console.error(logPrefix, error);
            return;
        }

        for (const snapshot of missing) {
            if (!unreadable.some(u => u.id === snapshot.id)) unreadable.push(snapshot);
        }
        console.log(`[HistoryFilter] Cannot read ${missing.map(m => m.id).join(', ')}: content is not in storage.`);
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
