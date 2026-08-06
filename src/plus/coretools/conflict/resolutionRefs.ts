import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import { getConflictIncomingRef } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import type { ResolutionRefs } from './types.js';

/**
 * The two sides a conflict resolution is diffed against, derived from the paused operation.
 *
 * `ResolutionRefs` feeds conflict-tools' `buildThreeWayDiff`, which computes `base..ours` and
 * `base..theirs` for the conflicted file. That diff is the prompt's primary evidence — the system
 * prompt tells the model to prefer it over calling tools — so getting the two sides right is what
 * makes the difference between real evidence and two copies of the same one.
 *
 * The trap this exists to contain: **`GitPausedOperationStatus.HEAD` is not git's HEAD.** Every
 * builder in `pausedOperations.ts` sets it to the operation's *incoming* pseudo-ref — `MERGE_HEAD`,
 * `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `REBASE_HEAD`. Reading it as the "ours" side (which both call
 * sites used to do) yields incoming-vs-incoming: two identical diffs, which read to the model as
 * "both sides made the same change" rather than as a conflict.
 */
export function getResolutionRefs(status: GitPausedOperationStatus | undefined): ResolutionRefs | undefined {
	if (status == null) return undefined;

	// Derive the incoming side through the shared helper rather than reading `status.HEAD` — it maps
	// all four operation types, including revert, where git's "theirs" is the state *before* the
	// reverted commit (`REVERT_HEAD^`) and not the commit itself.
	const theirs = getConflictIncomingRef(status);
	// No usable incoming ref: omit the refs entirely so the library skips the three-way diff. A
	// missing diff degrades the prompt; a wrong one actively misleads it.
	if (theirs == null) return undefined;

	return {
		// Git's own HEAD is the "ours" side in all four paused states. Deliberately NOT
		// `getConflictCurrentRef`: for a rebase that resolves to `status.current ?? status.onto`, the
		// *original* onto commit — but from step 2 on, "ours" is onto plus the already-applied
		// commits, which is exactly what HEAD points at and that ref does not. (The helper stays
		// correct for its labelling callers; this is a diffing-vs-labelling distinction.)
		ours: 'HEAD',
		theirs: theirs,
		...(status.mergeBase != null ? { base: status.mergeBase } : {}),
	};
}
