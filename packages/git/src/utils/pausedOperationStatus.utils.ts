import type { GitFile } from '../models/file.js';
import type { GitPausedOperationStatus } from '../models/pausedOperationStatus.js';
import type { GitReference } from '../models/reference.js';

/**
 * Gets the ref for the incoming side of a conflict:
 * - rebase: REBASE_HEAD (the commit being applied)
 * - revert: parent of REVERT_HEAD (git's "theirs" in a revert is the state before the reverted commit)
 * - cherry-pick/merge: the operation-specific HEAD (CHERRY_PICK_HEAD, MERGE_HEAD)
 */
export function getConflictIncomingRef(status: GitPausedOperationStatus): string | undefined {
	if (status.type === 'rebase') return status.steps.current.commit?.ref ?? status.HEAD.ref;
	if (status.type === 'revert') return `${status.HEAD.ref}^`;
	return status.HEAD.ref;
}

/**
 * Gets the reference representing the "current" (ours/HEAD) side of the operation
 * For rebase, falls back to `onto` when no branch/tag points at the onto commit
 */
export function getConflictCurrentRef(status: GitPausedOperationStatus): GitReference | undefined {
	if (status.type === 'rebase') return status.current ?? status.onto;
	return status.current;
}

export const pausedOperationStatusStringsByType = {
	'cherry-pick': {
		label: 'Cherry picking',
		conflicts: 'Resolve conflicts to continue cherry picking',
		directionality: 'into',
	},
	merge: {
		label: 'Merging',
		conflicts: 'Resolve conflicts to continue merging',
		directionality: 'into',
	},
	rebase: {
		label: 'Rebasing',
		conflicts: 'Resolve conflicts to continue rebasing',
		directionality: 'onto',
		pending: 'Pending rebase of',
	},
	revert: {
		label: 'Reverting',
		conflicts: 'Resolve conflicts to continue reverting',
		directionality: 'in',
	},
} as const;

/**
 * Resolves the correct file paths for each side of a merge conflict diff when the file may have been renamed.
 *
 * Conflict files from `git status` don't carry `originalPath`, so we use diff status (from
 * `git diff --name-status -M`) to detect renames between the merge-base and each branch.
 *
 * Note: The diff status must NOT use a pathspec filter, because git applies pathspecs before
 * rename detection — so `git diff -M BASE HEAD -- new.ts` returns `A new.ts` instead of `R old.ts new.ts`
 * when the file was renamed from `old.ts`.
 *
 * @param currentFiles - Diff status from merge-base to my ref (e.g. merge-base..HEAD for current changes)
 * @param incomingFiles - Diff status from merge-base to the other ref (e.g. merge-base..incoming for current changes)
 * @param filePath - The file's current path in the working tree
 * @returns The resolved LHS path (at merge-base) and RHS path (at myRef)
 */
export function resolveConflictFilePaths(
	currentFiles: GitFile[] | undefined,
	incomingFiles: GitFile[] | undefined,
	filePath: string,
): { lhsPath: string; rhsPath: string } {
	// Check if the file was renamed between merge-base and my side
	const currentRename = currentFiles?.find(
		f => (f.status === 'R' || f.status === 'C') && f.path === filePath && f.originalPath,
	);
	if (currentRename?.originalPath) {
		// My side renamed: merge-base has the original name, my side has the new name
		return { lhsPath: currentRename.originalPath, rhsPath: filePath };
	}

	// Check if the other side renamed the file
	if (incomingFiles != null) {
		const incomingRename = incomingFiles.find(
			f => (f.status === 'R' || f.status === 'C') && f.path === filePath && f.originalPath,
		);
		if (incomingRename?.originalPath) {
			// Other side renamed: merge-base AND my side both have the original name
			return { lhsPath: incomingRename.originalPath, rhsPath: incomingRename.originalPath };
		}
	}

	// Fallback: git's rename detection can fail when the diff is large or the content similarity is
	// below the threshold. Look for the add+delete pattern that indicates an undetected rename.

	// Check if my side has an undetected rename (filePath added on my side, original path deleted)
	if (currentFiles != null) {
		const originalPath = findUndetectedRename(currentFiles, incomingFiles, filePath);
		if (originalPath != null) {
			return { lhsPath: originalPath, rhsPath: filePath };
		}
	}

	// Check if other side has an undetected rename (filePath added on other side, original path deleted)
	if (incomingFiles != null && currentFiles != null) {
		const originalPath = findUndetectedRename(incomingFiles, currentFiles, filePath);
		if (originalPath != null) {
			return { lhsPath: originalPath, rhsPath: originalPath };
		}
	}

	// No rename detected
	return { lhsPath: filePath, rhsPath: filePath };
}

/**
 * Looks for an undetected rename in a diff: `filePath` was added on `sideFiles` and
 * a corresponding path was deleted on `sideFiles` while being present in `otherSideFiles`.
 *
 * Git's `-M` rename detection can fail when there are many files (exceeding `diff.renameLimit`)
 * or when content similarity is below the threshold. In those cases, git reports the rename as
 * separate `A` (add) and `D` (delete) entries. This function matches those pairs.
 *
 * @returns The original (deleted) path, or undefined if no match.
 */
function findUndetectedRename(
	sideFiles: GitFile[],
	otherSideFiles: GitFile[] | undefined,
	filePath: string,
): string | undefined {
	// Verify filePath was added on this side (not renamed — that was already checked)
	if (!sideFiles.some(f => f.status === 'A' && f.path === filePath)) return undefined;

	// Find a deleted file on this side that the other side also references.
	// Use path-suffix matching to disambiguate: renames that add a directory prefix (e.g. monorepo
	// migrations moving `src/x.ts` → `packages/utils/src/x.ts`) produce a pair where one path
	// is a suffix of the other at a directory boundary.
	let fallbackMatch: string | undefined;
	for (const deleted of sideFiles) {
		if (deleted.status !== 'D') continue;

		// The other side must have an entry for the deleted path (confirming it's a real file both sides know about)
		if (otherSideFiles != null && !otherSideFiles.some(f => f.path === deleted.path)) continue;

		// Prefer suffix match (strong signal): one path ends with the other at a directory boundary
		if (filePath.endsWith(`/${deleted.path}`) || deleted.path.endsWith(`/${filePath}`)) {
			return deleted.path;
		}

		// Track the first D+cross-reference match as a weaker fallback
		fallbackMatch ??= deleted.path;
	}

	return fallbackMatch;
}
