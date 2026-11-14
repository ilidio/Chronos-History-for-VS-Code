import * as os from 'os';
import * as path from 'path';

/**
 * The folder Chronos writes the throwaway files it hands to `vscode.diff`.
 *
 * It lives here, and nowhere else, because two unrelated parts of the
 * extension have to agree on it: the diff commands that create those files,
 * and the capture guard that must refuse to record them. When the two
 * disagreed, Chronos snapshotted its own diff views — the temporaries are
 * deleted straight after, so they turned up in "Deleted Files" as if they
 * were the user's own lost work.
 */
export const CHRONOS_TEMP_DIR_NAME = 'chronos_diff';

/** Absolute path of the folder above, for this machine. */
export function getChronosTempDir(): string {
    return path.join(os.tmpdir(), CHRONOS_TEMP_DIR_NAME);
}

/** True when `filePath` is one of Chronos's own diff temporaries. */
export function isChronosTempPath(filePath: string): boolean {
    if (!filePath || !path.isAbsolute(filePath)) return false;
    const normalized = path.normalize(filePath);
    if (isUnder(getChronosTempDir(), normalized)) return true;
    // The temp root is the OS's, and it is not stable: macOS hands out a
    // per-session /var/folders/... path, so entries recorded in an earlier
    // session no longer sit under the current tmpdir. The folder name is what
    // identifies them.
    return normalized.split(path.sep).includes(CHRONOS_TEMP_DIR_NAME);
}

/** True when `child` is the directory `parent` or anything inside it. */
export function isUnder(parent: string, child: string): boolean {
    const rel = path.relative(path.normalize(parent), path.normalize(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
