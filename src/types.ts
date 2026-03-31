export interface Snapshot {
    id: string;
    timestamp: number;
    filePath: string; // Relative to workspace root
    eventType: 'save' | 'rename' | 'delete' | 'label' | 'manual' | 'selection';
    storagePath?: string; // Filename in the storage directory
    label?: string;
    description?: string;
    relevantRange?: { start: number; end: number };
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

export interface GitCommit {
    hash: string;
    author: string;
    date: string;
    message: string;
    diff: string;
    relevantRange?: { start: number; end: number };
}