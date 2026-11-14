/**
 * Line-range mathematics over unified diffs.
 *
 * Pure functions with no vscode dependency, so the history filter, the git
 * commands and the tests can all share one implementation of "where were these
 * lines in the previous version?".
 */

/** A line range with an inclusive end, 0-based. */
export interface LineRange {
    startLine: number;
    endLine: number;
}

export interface DiffHunk {
    /** 1-based, exactly as written in the @@ header. */
    oldStart: number;
    oldLines: number;
    /** 1-based, exactly as written in the @@ header. */
    newStart: number;
    newLines: number;
    /** 0-based line indices on the NEW side that the hunk added or removed content at. */
    touchedLines: Set<number>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * 0-based index on the new side where the hunk starts.
 *
 * A hunk with no new lines (a pure deletion) writes the line it follows, so the
 * gap sits at that index rather than one before it.
 */
function newSideStart(hunk: DiffHunk): number {
    return hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;
}

/** 0-based index on the old side where the hunk starts, same convention. */
function oldSideStart(hunk: DiffHunk): number {
    return hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
}

/**
 * The lines a hunk occupies on the new side, 0-based and inclusive.
 *
 * A hunk with no new lines (a pure deletion) has no content to point at, so the
 * range collapses onto the seam where the content used to be.
 */
export function hunkNewRange(hunk: DiffHunk): LineRange {
    const start = newSideStart(hunk);
    if (hunk.newLines === 0) return { startLine: start, endLine: start };
    return { startLine: start, endLine: start + hunk.newLines - 1 };
}

export function parseHunks(diff: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    if (!diff) return hunks;

    let current: DiffHunk | null = null;
    let currentNew = 0;

    for (const line of diff.split(/\r?\n/)) {
        const match = line.match(HUNK_HEADER);
        if (match) {
            if (current) hunks.push(current);
            current = {
                oldStart: parseInt(match[1], 10),
                oldLines: match[2] !== undefined ? parseInt(match[2], 10) : 1,
                newStart: parseInt(match[3], 10),
                newLines: match[4] !== undefined ? parseInt(match[4], 10) : 1,
                touchedLines: new Set<number>()
            };
            currentNew = newSideStart(current);
            continue;
        }

        if (!current) continue;

        if (line.startsWith(' ')) {
            currentNew++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            // A deletion leaves a seam at the current new-side position and does
            // not advance it.
            current.touchedLines.add(currentNew);
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            current.touchedLines.add(currentNew);
            currentNew++;
        }
    }

    if (current) hunks.push(current);
    return hunks;
}

/**
 * Maps a range expressed in the NEW version back to the OLD version.
 *
 * Hunks above the range shift it; a hunk that overlaps a boundary pulls that
 * boundary to where the hunk started in the old version, which is the best a
 * purely positional mapping can do. Callers that have a content anchor should
 * verify the result with it — see HistoryFilter.
 */
export function mapRangeBackwards(range: LineRange, hunks: DiffHunk[]): LineRange {
    let startLine = range.startLine;
    let endLine = Math.max(range.startLine, range.endLine);

    for (const hunk of hunks) {
        const hunkStart = newSideStart(hunk);
        const hunkEnd = hunkStart + hunk.newLines; // exclusive
        const shift = hunk.newLines - hunk.oldLines;

        if (hunkEnd <= range.startLine) {
            startLine -= shift;
        } else if (hunkStart <= range.startLine) {
            startLine = oldSideStart(hunk);
        }

        if (hunkEnd <= range.endLine) {
            endLine -= shift;
        } else if (hunkStart <= range.endLine) {
            endLine = oldSideStart(hunk) + Math.max(0, hunk.oldLines - 1);
        }
    }

    const start = Math.max(0, startLine);
    return { startLine: start, endLine: Math.max(start, endLine) };
}

/** True when the diff added or removed anything inside the range. */
export function isRangeRelevant(range: LineRange, hunks: DiffHunk[]): boolean {
    for (const hunk of hunks) {
        for (const line of hunk.touchedLines) {
            if (line >= range.startLine && line <= range.endLine) return true;
        }
    }
    return false;
}

/** Keeps a range inside a file of `lineCount` lines, preserving its height where possible. */
export function clampRange(range: LineRange, lineCount: number): LineRange {
    const lastLine = Math.max(0, lineCount - 1);
    const startLine = Math.max(0, Math.min(range.startLine, lastLine));
    const endLine = Math.max(startLine, Math.min(range.endLine, lastLine));
    return { startLine, endLine };
}
