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
}

export interface GitCommit {
    hash: string;
    author: string;
    date: string;
    message: string;
    diff: string;
    relevantRange?: { start: number; end: number };
}