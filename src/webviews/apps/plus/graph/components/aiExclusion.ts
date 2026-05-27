import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';

interface SyncAiExcludedResult {
	aiExcludedSet: ReadonlySet<string> | undefined;
	/** Updated user-exclusion set if the merge added paths; undefined when nothing changed. */
	excludedFiles?: Set<string>;
}

/**
 * Reconciles a panel's local `aiExcludedSet` with a fresh `aiExcludedFiles` input from the
 * orchestrator and merges any newly-AI-excluded paths into the user's exclusion set.
 *
 * Returns `undefined` when the new input matches the previous set in both size and content,
 * so callers can short-circuit and avoid no-op `@state` writes that would trigger a render.
 */
export function syncAiExcluded(
	aiExcludedFiles: readonly string[] | undefined,
	prev: ReadonlySet<string> | undefined,
	currentExcluded: ReadonlySet<string>,
): SyncAiExcludedResult | undefined {
	const next = aiExcludedFiles?.length ? new Set(aiExcludedFiles) : undefined;
	const sameSize = (next?.size ?? 0) === (prev?.size ?? 0);
	const sameContent = sameSize && (!next || [...next].every(p => prev?.has(p)));
	if (sameContent) return undefined;

	if (aiExcludedFiles?.length) {
		const merged = new Set(currentExcluded);
		let dirty = false;
		for (const path of aiExcludedFiles) {
			if (!merged.has(path)) {
				merged.add(path);
				dirty = true;
			}
		}
		return { aiExcludedSet: next, excludedFiles: dirty ? merged : undefined };
	}
	return { aiExcludedSet: next };
}

/**
 * Drops exclusion entries whose paths are no longer in the current scoped file list, so stale
 * entries from a previous scope can't keep the panel disabled or misrepresent counts.
 *
 * Returns `undefined` when nothing was pruned, so callers can avoid no-op state writes.
 */
export function pruneExcludedToFiles(
	excluded: ReadonlySet<string>,
	files: readonly GitFileChangeShape[] | undefined,
): Set<string> | undefined {
	if (excluded.size === 0) return undefined;
	// Skip when `files` is missing or empty: the orchestrator routinely transitions `files`
	// through `undefined`/`[]` during a refetch (scope change, anchor change), and pruning
	// against an empty list would wipe every user exclusion just before the real list arrives.
	// The next non-empty `files` push runs through here and prunes correctly.
	if (!files?.length) return undefined;

	const current = new Set(files.map(f => f.path));
	let changed = false;
	const pruned = new Set<string>();
	for (const path of excluded) {
		if (current.has(path)) {
			pruned.add(path);
		} else {
			changed = true;
		}
	}
	return changed ? pruned : undefined;
}

/** Counts files that are not in either the user's or the AI's exclusion set. */
export function countIncludedFiles(
	files: readonly GitFileChangeShape[] | undefined,
	excluded: ReadonlySet<string>,
	aiExcluded: ReadonlySet<string> | undefined,
): number {
	if (!files?.length) return 0;

	let count = 0;
	for (const f of files) {
		if (excluded.has(f.path)) continue;
		if (aiExcluded?.has(f.path)) continue;

		count++;
	}
	return count;
}
