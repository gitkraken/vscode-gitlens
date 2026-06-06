import { Uri } from 'vscode';
import { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import { Logger } from '@gitlens/utils/logger.js';
import { ProviderNotSupportedError } from '../../../errors.js';

/** The git side-effects `discardOneWith` needs, injected so the orchestration is testable. */
export interface DiscardExecutor {
	/** Whether the provider supports `restore` (`ops.restore`). */
	readonly canRestore: boolean;
	/** Provider name, for the unsupported-operation error. */
	readonly providerName: string;
	/** Move the working-tree file to Trash (recoverable). */
	moveToTrash(uri: Uri): Promise<void>;
	/** Unstage a path (`git reset -- <path>`). */
	unstage(path: string): Promise<void>;
	/** Restore a path from the index (no ref) or from a ref (e.g. `HEAD`). */
	restore(path: string, options?: { ref?: string }): Promise<void>;
}

/**
 * Whether HEAD (our side) has a version of a conflicted file to restore on discard. False when the
 * other side added it (added-by-them) or our/both sides deleted it (deleted-by-us, deleted-by-both) —
 * in those cases discard leaves the file removed. Restoring from HEAD when HEAD lacks the path would
 * error (`pathspec did not match`), so those cases must skip the restore.
 *
 * Note this does NOT decide whether to trash the working copy: git keeps the *other* side's version on
 * disk for most conflicts (modify/delete included), so discard always trashes (a no-op when nothing is
 * on disk, e.g. both-deleted).
 */
export function conflictHasHeadVersion(conflictStatus: GitFileConflictStatus): boolean {
	return (
		conflictStatus !== GitFileConflictStatus.AddedByThem &&
		conflictStatus !== GitFileConflictStatus.DeletedByUs &&
		conflictStatus !== GitFileConflictStatus.DeletedByBoth
	);
}

/**
 * Discard a single file's working-tree changes, reverting it to the appropriate source per its status.
 * The git side-effects run through `exec` so this orchestration can be exercised against a real repo in
 * tests without the full extension Container.
 */
export async function discardOneWith(exec: DiscardExecutor, file: GitStatusFile): Promise<void> {
	const uri = Uri.joinPath(Uri.file(file.repoPath), file.path);

	if (file.conflictStatus != null) {
		const headHasFile = conflictHasHeadVersion(file.conflictStatus);

		if (headHasFile && !exec.canRestore) {
			throw new ProviderNotSupportedError(exec.providerName);
		}

		// Trash whatever is on disk (git keeps the other side's version for most conflicts, incl.
		// modify/delete) — a no-op when nothing's there (both-deleted). Then clear the unmerged index
		// entry and restore our version when HEAD has one; otherwise the file is left removed.
		await exec.moveToTrash(uri);
		await exec.unstage(file.path);
		if (headHasFile) {
			await exec.restore(file.path, { ref: 'HEAD' });
		}
		return;
	}

	if (file.mixed) {
		// Require restore BEFORE the trash step so we don't move the file off-disk and then have nothing
		// to restore from the index on a provider that lacks operations support.
		if (!exec.canRestore) {
			throw new ProviderNotSupportedError(exec.providerName);
		}

		if (file.workingTreeStatus !== 'D') {
			await exec.moveToTrash(uri);
		}
		// Let restore failures propagate — the working-tree file is already in Trash, so a silent warn
		// would leave the user thinking discard succeeded while the file is missing.
		await exec.restore(file.path);
		return;
	}

	// Untracked and newly-added files don't exist in HEAD — trashing is the whole operation, no HEAD
	// restore (and no provider-ops requirement).
	const isUntrackedOrAdded = file.status === '?' || file.status === 'A';

	// Preflight the restore capability BEFORE trashing, mirroring the mixed branch.
	if (!isUntrackedOrAdded && !exec.canRestore) {
		throw new ProviderNotSupportedError(exec.providerName);
	}

	// trash + unstage: skip the trash when the working copy is already deleted, unstage only if staged.
	if (file.status !== 'D') {
		await exec.moveToTrash(uri);
	}
	if (file.staged) {
		await exec.unstage(file.path);
	}

	if (isUntrackedOrAdded) return;

	// Renames/copies: restore the original path from HEAD (not the new name).
	if (file.status === 'R' || file.status === 'C') {
		if (file.originalPath) {
			await exec.restore(file.originalPath, { ref: 'HEAD' });
		} else {
			Logger.warn(`Renamed file ${file.path} missing originalPath — original not restored`);
		}
		return;
	}

	await exec.restore(file.path, { ref: 'HEAD' });
}
