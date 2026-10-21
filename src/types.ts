export type RangeAnchoring = 'position' | 'content' | 'origin';

export interface Snapshot {
    id: string;
    timestamp: number;
    filePath: string; // Relative to workspace root
    eventType: 'save' | 'rename' | 'delete' | 'label' | 'manual' | 'selection';
    storagePath?: string; // Filename in the storage directory
    label?: string;
    description?: string;
    relevantRange?: { start: number; end: number };
    /** How relevantRange was obtained: by diff arithmetic, by re-finding the
     *  block's content, or because the block first appears in this snapshot. */
    rangeAnchoring?: RangeAnchoring;
    linesAdded?: number;
    linesDeleted?: number;
    pinned?: boolean;
    /** Set at read time when the stored content is not on disk. Never persisted. */
    contentMissing?: boolean;
}

export interface HistoryEntry extends Snapshot {
    // Extended properties for UI if needed
    displayDate?: string;
}

export interface WorkspaceMetadata {
    id: string; // Hash or unique identifier
    name: string; // Folder name
    rootPath: string; // Original workspace path
    lastActivity: number;
}

export interface HistoryIndex {
    workspace?: WorkspaceMetadata;
    snapshots: Snapshot[];
}

export interface WorkspaceRegistry {
    workspaces: WorkspaceMetadata[];
}

export interface ChronosConfig {
    enabled: boolean;
    maxDays: number;
    maxSizeMB: number;
    trackSelectionHistory: boolean;
    exclude: string[];
    dailyBriefing?: boolean;
    language?: string;
    respectGitIgnore?: boolean;
}

export interface GitHistoryConfig {
    maxCommits: number;
    followRenames: boolean;
    dateFormat: string;
}

export type GitRangeFailureReason =
    | 'not-tracked'
    | 'no-commits'
    | 'bad-range'
    | 'no-repo'
    | 'git-missing'
    | 'unknown';

/** Why git could not answer, as opposed to there being no history. */
export interface GitRangeFailure {
    reason: GitRangeFailureReason;
    /** One sentence for the user. */
    message: string;
    /** Raw stderr, for the log. */
    detail: string;
}

export interface GitRangeHistory {
    commits: GitCommit[];
    /** Set when git itself failed. Absent means the answer is trustworthy. */
    failure?: GitRangeFailure;
    /** Set when the answer is complete as far as `git log -L` can see, but the
     *  block demonstrably has history older than that. */
    truncation?: GitRangeTruncation;
}

/**
 * Where line tracking gave up.
 *
 * `git log -L` follows a range by diff arithmetic, so a block that changed
 * position reads as a deletion plus an insertion: the lines look created there
 * and the walk stops, with everything older unreachable. The answer is not
 * wrong, it is cut short — and saying nothing would present a fragment as the
 * whole history.
 */
export interface GitRangeTruncation {
    /** The oldest commit `-L` reached, where the block appears to be created. */
    hash: string;
    /**
     * `block-moved`: the file itself has older commits, so the block's history
     * does not begin there — the lines only look new because they moved.
     * `new-file`: that commit is the file's first, so anything older would have
     * to live in another file, which line tracking cannot reach. On its own
     * that is also what a genuinely new file looks like, so a caller must find
     * corroboration before it says anything.
     */
    reason: 'block-moved' | 'new-file';
    /** A commit that changed the file before that. Empty for `new-file`. */
    previousFileCommit: string;
}

export interface GitCommit {
    hash: string;
    author: string;
    date: string;
    message: string;
    diff: string;
    relevantRange?: { start: number; end: number };
}