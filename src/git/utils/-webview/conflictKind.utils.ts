import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitConflictFile } from '@gitlens/git/models/staging.js';
import type { ConflictKind, ConflictRenameKind } from '@gitlens/git/utils/conflictResolution.utils.js';
import {
	canStageCurrent,
	canStageIncoming,
	classifyConflictKind,
} from '@gitlens/git/utils/conflictResolution.utils.js';
import { getConflictIncomingRef, resolveConflictFilePaths } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { GitRepositoryService } from '../../gitRepositoryService.js';

export interface ConflictFileInfo {
	readonly path: string;
	readonly conflictStatus: GitFileConflictStatus;
	readonly kind: ConflictKind;
	readonly canStageCurrent: boolean;
	readonly canStageIncoming: boolean;
	/** Original (pre-rename) path when a rename is involved. */
	readonly renameOf?: string;
	/** For rename/rename: the other side's target path (the "loser" to remove when taking a side). */
	readonly renamePairPath?: string;
}

/**
 * Builds a per-path map describing each conflicted file richly enough to label it and offer the
 * right take-side actions — the conflict {@link ConflictKind}, which sides can be staged, and any
 * rename relationship. Rename detection mirrors `openConflictChanges`: diff the merge-base against
 * each side with rename detection on, then correlate via {@link resolveConflictFilePaths} (conflict
 * files from `git status` don't carry `originalPath`).
 *
 * Binary sniffing is intentionally NOT done here (it would cost a working-tree read per file). A
 * conflicted file that would otherwise classify as `text` but was skipped by the AI resolver (no
 * markers) is binary/unsupported by inference — callers labeling skipped rows should treat a
 * `text` kind as `binary`.
 */
export async function getConflictFileInfos(
	svc: GitRepositoryService,
	conflictFiles?: GitConflictFile[],
): Promise<Map<string, ConflictFileInfo>> {
	conflictFiles ??= await svc.status.getConflictingFiles();

	const infos = new Map<string, ConflictFileInfo>();
	if (!conflictFiles.length) return infos;

	// Rename detection needs the merge-base + the incoming ref to diff each side with `-M`. When the
	// paused-operation status (or its merge-base) is unavailable, fall back to mode/oid/status-only
	// classification — every file still gets a usable kind, just without rename labels.
	let currentFiles: GitFile[] | undefined;
	let incomingFiles: GitFile[] | undefined;

	const pausedStatus = await svc.pausedOps?.getPausedOperationStatus?.();
	const mergeBase = pausedStatus?.mergeBase;
	if (pausedStatus != null && mergeBase != null) {
		const incomingRef = getConflictIncomingRef(pausedStatus) ?? pausedStatus.HEAD.ref;
		const [currentResult, incomingResult] = await Promise.allSettled([
			svc.diff.getDiffStatus(mergeBase, 'HEAD', { renameLimit: 0 }),
			svc.diff.getDiffStatus(mergeBase, incomingRef, { renameLimit: 0 }),
		]);
		currentFiles = getSettledValue(currentResult);
		incomingFiles = getSettledValue(incomingResult);
	}

	for (const file of conflictFiles) {
		const status = file.conflictStatus;
		const rename = detectRename(file, currentFiles, incomingFiles);

		const kind = classifyConflictKind(
			status,
			{ base: file.base?.mode, current: file.current?.mode, incoming: file.incoming?.mode },
			{ base: file.base?.oid, current: file.current?.oid, incoming: file.incoming?.oid },
			{ rename: rename?.kind },
		);

		infos.set(file.path, {
			path: file.path,
			conflictStatus: status,
			kind: kind,
			canStageCurrent: canStageCurrent(status),
			canStageIncoming: canStageIncoming(status),
			renameOf: rename?.renameOf,
			renamePairPath: rename?.renamePairPath,
		});
	}

	return infos;
}

export function detectRename(
	file: GitConflictFile,
	currentFiles: GitFile[] | undefined,
	incomingFiles: GitFile[] | undefined,
): { kind: ConflictRenameKind; renameOf: string; renamePairPath?: string } | undefined {
	if (currentFiles == null && incomingFiles == null) return undefined;

	const path = file.path;
	// `resolveConflictFilePaths` checks a rename on either side and returns the merge-base (original)
	// path as `lhsPath`. A differing lhsPath means this conflicted file was renamed by some side.
	const { lhsPath } = resolveConflictFilePaths(currentFiles, incomingFiles, path);
	if (lhsPath === path) return undefined;

	const renameOf = lhsPath;
	const status = file.conflictStatus;

	// One side renamed, the other deleted the original.
	if (status === 'UD' || status === 'DU') return { kind: 'rename-delete', renameOf: renameOf };

	// Did both sides rename the same original to (different) targets?
	const isRenameTo = (f: GitFile) => (f.status === 'R' || f.status === 'C') && f.originalPath === renameOf;
	const currentTargets = (currentFiles ?? []).filter(isRenameTo).map(f => f.path);
	const incomingTargets = (incomingFiles ?? []).filter(isRenameTo).map(f => f.path);

	if (currentTargets.length && incomingTargets.length) {
		const renamePairPath = [...currentTargets, ...incomingTargets].find(p => p !== path);
		return { kind: 'rename-rename', renameOf: renameOf, renamePairPath: renamePairPath };
	}

	// One side renamed, the other modified content at the original path.
	return { kind: 'rename-modify', renameOf: renameOf };
}
