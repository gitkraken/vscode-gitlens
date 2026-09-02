/** Prefix for synthetic row ids representing a worktree's working-changes row. */
const wipRowIdPrefix = 'wip::';

/**
 * Normalizes the path portion of a graph row identity without depending on a host path library.
 *
 * Drive letters are normalized on every platform so identities produced in a browser, Electron,
 * and Node agree. POSIX paths are unaffected apart from separator and trailing-slash cleanup.
 */
function normalizeIdentityPath(path: string): string {
	if (path.length === 0) return path;

	path = path.replace(/\\/g, '/');
	path = path.replace(/^\/?([a-zA-Z])(?=:\/)/, (_, drive: string) => drive.toLowerCase());
	// Keep a bare root (`/` or `c:/`) intact — stripping its slash would empty the identity.
	if (path.length > 1 && path.endsWith('/') && !/^[a-zA-Z]:\/$/.test(path)) {
		path = path.slice(0, -1);
	}

	return path;
}

/**
 * Creates the canonical synthetic row id for a worktree's working changes.
 *
 * This id is deliberately distinct from a Git revision such as `uncommitted`; consumers translate
 * revision selections at their host boundary.
 */
export function createWipRowId(worktreePath: string): string {
	return `${wipRowIdPrefix}${normalizeIdentityPath(worktreePath)}`;
}

export function isWipRowId(id: string | undefined): boolean {
	return id?.startsWith(wipRowIdPrefix) ?? false;
}

/** Returns the normalized worktree path, or `undefined` when the id is not a WIP row id. */
export function getWipRowWorktreePath(id: string | undefined): string | undefined {
	return isWipRowId(id) ? id!.slice(wipRowIdPrefix.length) : undefined;
}

/** True when `id` identifies the selected repository's own working-changes row. */
export function isPrimaryWipRowId(id: string | undefined, selectedRepoPath: string | undefined): boolean {
	return id != null && selectedRepoPath != null && id === createWipRowId(selectedRepoPath);
}
