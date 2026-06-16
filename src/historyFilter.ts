import * as vscode from 'vscode';
import { HistoryStorage } from './storage';
import { GitService } from './git/gitService';
import { Snapshot } from './types';

interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    touchedLines: Set<number>;
}

export class HistoryFilter {
    constructor(
        private storage: HistoryStorage,
        private gitService: GitService
    ) {}

        async filterHistoryForSelection(
            history: Snapshot[], 
            fileUri: vscode.Uri, 
            selection: vscode.Range
        ): Promise<Snapshot[]> {
            if (history.length === 0) return [];
    
            console.log(`[HistoryFilter] Filtering ${history.length} snapshots for ${fileUri.fsPath} selection ${selection.start.line}-${selection.end.line}`);
    
            // Sort new -> old
            const sortedHistory = [...history].sort((a, b) => b.timestamp - a.timestamp);
            
            const relevantSnapshots: Snapshot[] = [];
            let currentRange = selection;
    
            // Step 0: Map selection from Current File (disk) to Newest Snapshot
            try {
                const newestSnapshot = sortedHistory[0];
                const newestSnapshotUri = await this.storage.getSnapshotUri(newestSnapshot, fileUri);
                
                const diff = await this.gitService.getDiff(newestSnapshotUri.fsPath, fileUri.fsPath);
                const hunks = this.parseHunks(diff);
                
                currentRange = this.mapRangeBackwards(currentRange, hunks);
                console.log(`[HistoryFilter] Initial map (Current -> Newest): ${selection.start.line}-${selection.end.line} -> ${currentRange.start.line}-${currentRange.end.line}`);
            } catch (e) {
                console.error('[HistoryFilter] Error mapping initial range:', e);
            }
    
            // Step 1: Iterate backwards through history
            for (let i = 0; i < sortedHistory.length - 1; i++) {
                const newSnapshot = sortedHistory[i];
                const oldSnapshot = sortedHistory[i + 1];
    
                try {
                    const newUri = await this.storage.getSnapshotUri(newSnapshot, fileUri);
                    const oldUri = await this.storage.getSnapshotUri(oldSnapshot, fileUri);
    
                    const diff = await this.gitService.getDiff(oldUri.fsPath, newUri.fsPath);
                    const hunks = this.parseHunks(diff);
    
                    if (this.isRelevant(currentRange, hunks)) {
                        // currentRange uses VS Code's exclusive-end convention: when end.character === 0
                        // the end.line is one past the actual last line. Store inclusive end.
                        const inclusiveEnd = (currentRange.end.character === 0 && currentRange.end.line > currentRange.start.line)
                            ? currentRange.end.line - 1
                            : currentRange.end.line;
                        relevantSnapshots.push({
                            ...newSnapshot,
                            relevantRange: { start: currentRange.start.line, end: inclusiveEnd }
                        });
                        console.log(`[HistoryFilter] Relevant snapshot found: ${newSnapshot.id} (${newSnapshot.label || newSnapshot.eventType}) range ${currentRange.start.line}-${inclusiveEnd}`);
                    }
    
                    const prevRange = currentRange;
                    currentRange = this.mapRangeBackwards(currentRange, hunks);
                    // console.log(`[HistoryFilter] Mapped range ${prevRange.start.line}-${prevRange.end.line} -> ${currentRange.start.line}-${currentRange.end.line}`);
    
                } catch (e) {
                    console.error(`[HistoryFilter] Error processing history at index ${i}:`, e);
                }
            }
    
            // Only include the oldest snapshot if the tracked range maps to valid lines within it,
            // i.e. the selection exists in the initial version of the file. This avoids always
            // showing a "file vs empty" diff for the very first snapshot when nothing changed there.
            const oldest = sortedHistory[sortedHistory.length - 1];
            try {
                const oldestUri = await this.storage.getSnapshotUri(oldest, fileUri);
                const oldestData = await (await import('fs')).promises.readFile(oldestUri.fsPath, 'utf8');
                const oldestLines = oldestData.split('\n');
                const rangeStart = currentRange.start.line;
                const rangeEnd = currentRange.end.line;
                // Only include if the range falls within the oldest snapshot's line count
                if (rangeStart < oldestLines.length) {
                    relevantSnapshots.push({
                        ...oldest,
                        relevantRange: { start: rangeStart, end: Math.min(rangeEnd, oldestLines.length - 1) }
                    });
                    console.log(`[HistoryFilter] Oldest snapshot included: ${oldest.id} (range ${rangeStart}-${rangeEnd})`);
                } else {
                    console.log(`[HistoryFilter] Oldest snapshot skipped: mapped range ${rangeStart}-${rangeEnd} is out of bounds (file has ${oldestLines.length} lines)`);
                }
            } catch (e) {
                // Fallback: always include the oldest snapshot if we can't read it
                const inclusiveEnd = (currentRange.end.character === 0 && currentRange.end.line > currentRange.start.line)
                    ? currentRange.end.line - 1
                    : currentRange.end.line;
                relevantSnapshots.push({
                    ...oldest,
                    relevantRange: { start: currentRange.start.line, end: inclusiveEnd }
                });
            }

            // If no relevant snapshots were found at all, return the full unfiltered history
            // so the user isn't left with a confusing empty or single-entry list.
            if (relevantSnapshots.length === 0) {
                console.log(`[HistoryFilter] No relevant snapshots found, returning full history as fallback.`);
                return history;
            }

            console.log(`[HistoryFilter] Found ${relevantSnapshots.length} relevant snapshots.`);
    
            return relevantSnapshots;
        }
    private parseHunks(diff: string): DiffHunk[] {
        const hunks: DiffHunk[] = [];
        const lines = diff.split('\n');
        
        let currentHunk: DiffHunk | null = null;
        let currentNew = 0;

        for (const line of lines) {
            if (line.startsWith('@@')) {
                const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                if (match) {
                    if (currentHunk) hunks.push(currentHunk);
                    
                    const newStart = parseInt(match[3]);
                    currentHunk = {
                        oldStart: parseInt(match[1]),
                        oldLines: match[2] ? parseInt(match[2]) : 1,
                        newStart: newStart,
                        newLines: match[4] ? parseInt(match[4]) : 1,
                        touchedLines: new Set()
                    };
                    currentNew = newStart - 1; // 0-based
                }
            } else if (currentHunk) {
                if (line.startsWith(' ')) {
                    currentNew++;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    // Deletion: affects the current seam (currentNew).
                    currentHunk.touchedLines.add(currentNew);
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                    // Addition: The content at currentNew is new.
                    currentHunk.touchedLines.add(currentNew);
                    currentNew++;
                }
            }
        }
        if (currentHunk) hunks.push(currentHunk);
        return hunks;
    }

    private isRelevant(range: vscode.Range, hunks: DiffHunk[]): boolean {
        const rStart = range.start.line;
        let effectiveEnd = range.end.line;
        if (range.end.character === 0 && effectiveEnd > rStart) {
            effectiveEnd--;
        }

        for (const h of hunks) {
            for (const lineIdx of h.touchedLines) {
                if (lineIdx >= rStart && lineIdx <= effectiveEnd) {
                    return true;
                }
            }
        }
        return false;
    }

    private mapRangeBackwards(range: vscode.Range, hunks: DiffHunk[]): vscode.Range {
        let start = range.start.line;
        let end = range.end.line; // Keep simplified line tracking
        
        // Handle end line character check for precise line range
        let effectiveEndLine = end;
        if (range.end.character === 0 && end > start) {
            effectiveEndLine--;
        }

        // We need to apply shifts caused by hunks that appear BEFORE the range.
        // Hunks are usually ordered by line number.
        
        let shiftStart = 0;
        let shiftEnd = 0;
        
        let newStart = start;
        let newEndLine = effectiveEndLine;

        for (const h of hunks) {
            const hNewStart = h.newStart - 1;
            const hNewEnd = h.newStart - 1 + h.newLines; // exclusive limit
            const shift = h.newLines - h.oldLines; // +ve if added lines, -ve if removed

            // Update Start
            if (hNewEnd <= start) {
                // Hunk is strictly before start
                newStart -= shift;
            } else if (hNewStart < start && hNewEnd > start) {
                 // Intersection containing start
                 // Map to start of change in Old
                 newStart = h.oldStart - 1;
            }

            // Update End
            if (hNewEnd <= effectiveEndLine) {
                 newEndLine -= shift;
            } else if (hNewStart < effectiveEndLine && hNewEnd > effectiveEndLine) {
                 // Intersection containing end
                 newEndLine = (h.oldStart - 1) + (h.oldLines > 0 ? h.oldLines - 1 : 0);
            } else if (hNewStart <= effectiveEndLine && hNewEnd > effectiveEndLine) {
                 // partial overlap at end
                 newEndLine = (h.oldStart - 1) + (h.oldLines > 0 ? h.oldLines - 1 : 0); 
            }
        }
        
        // Reconstruct Range
        // We only track lines, so we lose character precision.
        // That's acceptable for "History for Selection".
        // console.log(`Mapped range: ${start}-${effectiveEndLine} -> ${newStart}-${newEndLine}`);
        return new vscode.Range(newStart, 0, newEndLine + 1, 0);
    }
}
