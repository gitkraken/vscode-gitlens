import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';

export interface WorktreeTooltipStatsInput {
	/** Filesystem path — the key both the request and the result map use. */
	path: string | undefined;
	/** Clean/dirty from the cheap probe. `undefined` = unknown (bare worktree, or the probe failed). */
	hasChanges: boolean | undefined;
	/** Whether this row is the primary worktree, whose breakdown arrives on the working-tree channel. */
	primary: boolean;
	/** `gitlens.graph.showWorktreeWipStats`; `undefined` until config lands. */
	enabled: boolean | undefined;
}

/**
 * Whether hovering this row should cost a `git status`.
 *
 * Every `false` here is a case where the request would be pure waste — and since the eager fetch is gone,
 * waste here isn't a wash, it's a net regression over what shipped before.
 */
export function shouldRequestWorktreeWipStats(input: WorktreeTooltipStatsInput): boolean {
	if (input.path == null) return false;
	// A clean row has nothing to break down; asking would make hover more expensive than the eager path.
	if (input.hasChanges !== true) return false;
	// The user opted out of worktree WIP stats — don't spend a round-trip to be told so.
	if (input.enabled === false) return false;
	// The primary worktree's breakdown already arrives on the working-tree channel.
	if (input.primary) return false;

	return true;
}

export type WorktreeTooltipStatsState =
	| { state: 'stats'; stats: GitDiffFileStats }
	| { state: 'loading' }
	| { state: 'dirty' }
	| { state: 'clean' }
	| { state: 'unknown' };

/**
 * Resolves what the tooltip's stats line should show.
 *
 * `loading` is driven by `inFlight` — whether a request is actually outstanding — and never by whether one
 * *would* be made. Those differ exactly when a request has already failed: the entry is absent (so the next
 * open retries) but nothing is coming, and inferring "loading" from the absence would spin forever.
 */
export function getWorktreeTooltipStatsState(
	input: WorktreeTooltipStatsInput & { stats: GitDiffFileStats | null | undefined; inFlight: boolean },
): WorktreeTooltipStatsState {
	if (input.hasChanges == null) return { state: 'unknown' };
	if (!input.hasChanges) return { state: 'clean' };

	const { stats } = input;
	// A zero-total breakdown is settled data with nothing to draw — it means the row's dirty flag went stale
	// between the cheap probe and the status read. Show the plain dirty line rather than an empty pill.
	if (stats != null && stats.added + stats.changed + stats.deleted > 0) return { state: 'stats', stats: stats };
	// Only spin while something is genuinely outstanding, and only when there's no previous answer to show.
	if (stats === undefined && input.inFlight) return { state: 'loading' };

	return { state: 'dirty' };
}
