import * as crypto from 'crypto';

export interface SelectionRange {
    startLine: number;
    endLine: number;
}

interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    touchedLines: Set<number>;
}

export class HistoryFilter {
    /**
     * Maps a line range backwards through a set of diff hunks.
     * This ensures that if lines were added above the selection in a previous version,
     * we correctly "drift" the selection to its original position.
     */
    public static mapRangeBackwards(range: SelectionRange, diff: string): SelectionRange {
        const hunks = this.parseHunks(diff);
        let newStart = range.startLine;
        let newEnd = range.endLine;

        // Sort hunks in reverse order (bottom to top) to ensure mapping consistency
        const sortedHunks = [...hunks].sort((a, b) => b.newStart - a.newStart);

        for (const h of sortedHunks) {
            const hNewStart = h.newStart - 1; // 0-based
            const hNewEnd = h.newStart - 1 + h.newLines;
            const shift = h.newLines - h.oldLines;

            // If the hunk is entirely above the selection, the selection shifted down in the new version
            // So we shift it back up for the old version.
            if (hNewEnd <= range.startLine) {
                newStart -= shift;
            } 
            // If the selection starts inside a changed hunk, we anchor it to the hunk's old start
            else if (hNewStart < range.startLine && hNewEnd > range.startLine) {
                newStart = h.oldStart - 1;
            }

            if (hNewEnd <= range.endLine) {
                newEnd -= shift;
            } 
            else if (hNewStart < range.endLine && hNewEnd > range.endLine) {
                newEnd = (h.oldStart - 1) + (h.oldLines > 0 ? h.oldLines - 1 : 0);
            }
        }

        return {
            startLine: Math.max(0, newStart),
            endLine: Math.max(0, newEnd)
        };
    }

    private static parseHunks(diff: string): DiffHunk[] {
        const hunks: DiffHunk[] = [];
        if (!diff) return hunks;

        const lines = diff.split(/\r?\n/);
        let currentHunk: DiffHunk | null = null;
        let currentNewLine = 0;

        const hunkHeaderRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

        for (const line of lines) {
            const match = line.match(hunkHeaderRegex);
            if (match) {
                if (currentHunk) hunks.push(currentHunk);
                
                const newStart = parseInt(match[3]);
                currentHunk = {
                    oldStart: parseInt(match[1]),
                    oldLines: match[2] ? parseInt(match[2]) : 1,
                    newStart: newStart,
                    newLines: match[4] ? parseInt(match[4]) : 1,
                    touchedLines: new Set<number>()
                };
                currentNewLine = newStart - 1;
            } else if (currentHunk) {
                if (line.startsWith(' ')) {
                    currentNewLine++;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    currentHunk.touchedLines.add(currentNewLine);
                    // Deletion doesn't increment the 'new' line counter
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentHunk.touchedLines.add(currentNewLine);
                    currentNewLine++;
                }
            }
        }

        if (currentHunk) hunks.push(currentHunk);
        return hunks;
    }

    /**
     * Checks if a specific range was affected by the changes in a diff.
     */
    public static isRangeRelevant(range: SelectionRange, diff: string): boolean {
        const hunks = this.parseHunks(diff);
        for (const h of hunks) {
            for (const lineIdx of h.touchedLines) {
                if (lineIdx >= range.startLine && lineIdx <= range.endLine) {
                    return true;
                }
            }
        }
        return false;
    }
}
