import type { RowAdornment, RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { TemplateResult } from 'lit';
import { html } from 'lit';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { StyleInfo } from '../../../../shared/components/csp-style-map.directive.js';
import { cspStyleMap } from '../../../../shared/components/csp-style-map.directive.js';
import '../../../../shared/components/code-icon.js';
import '../../../../shared/components/commit/wip-stats.js';
import type { PausedOpIndicatorInfo } from '../../utils/pausedOp.utils.js';
import { pausedOperationVariantIcons, pausedOpIndicatorInfo } from '../../utils/pausedOp.utils.js';

/**
 * Pure Lit port of the React `WipStatsAdornmentProvider`. Emits a working-changes stats badge on
 * workdir rows so users see uncommitted-changes magnitude at a glance without selecting the row.
 *
 * Uses the shared `<commit-stats symbol="icons" appearance="pill">` element — the SAME pill the WIP
 * header / overview / Home cards render — so all working-tree stats look identical.
 *
 * Four states, and the distinction between them is the point:
 *   - **no stats yet** — renders nothing. "Not loaded" must never be drawn, or a row briefly claims a
 *     state it hasn't measured.
 *   - **all zeros** — renders the CLEAN check. A measured-clean worktree is information, not an absence;
 *     the legacy renderer showed it (`Graph-WorkInProgress-Clean`) and dropping it made clean and
 *     unmeasured look identical.
 *   - **any change** — renders the stats pill.
 *   - **paused rebase/merge/cherry-pick/revert, or conflicts with no paused op** — REPLACES the stats
 *     pill with a paused-op pill (icon + `pausedOpIndicatorInfo`'s label, e.g. "Rebasing" or "Resolve
 *     conflicts to continue rebasing"): the row's headline while an operation is in flight is that state,
 *     not a file count. Exact counts stay available in the details panel.
 *
 * Placement is `'refs'`; the badge right-aligns within the Refs column (see `.gl-graph__wip-stats`
 * in graph.scss) so it sits at the column's trailing edge.
 */

/**
 * Stats payload for a single workdir/WIP row. Mirrors the wire `WorkDirStats` shape (plus the paused-op/
 * conflicts fields from `GraphWipState`) so consumers can pass through the host-supplied data without
 * translation.
 */
export interface WipStats {
	added?: number;
	modified?: number;
	deleted?: number;
	renamed?: number;
	/** When true, render the badge in a "fetching fresh stats" muted state. */
	stale?: boolean;
	/** Paused rebase/merge/cherry-pick/revert running in this worktree, when any — takes over the whole
	 *  badge (see `renderWipStatsBadge`), replacing the file-count pill. */
	pausedOpStatus?: GitPausedOperationStatus;
	/** Whether this worktree's working tree has merge/rebase conflicts, UNGATED (mirrors
	 *  `RowRenderContext.wipHasConflicts` — true on peer worktrees too, not just the graph's own) — drives
	 *  the paused-op pill even with no {@link pausedOpStatus} (e.g. conflicts left by a plain `git merge`). */
	hasConflicts?: boolean;
	/** Number of conflicted paths, when {@link hasConflicts}. */
	conflictsCount?: number;
}

export interface WipStatsAdornmentOptions {
	/**
	 * Stats keyed by row sha. Provide entries only for workdir rows that have stats to show.
	 * Omit emails / non-workdir rows entirely — the provider doesn't render anything for them.
	 */
	statsBySha: ReadonlyMap<Sha, WipStats>;
}

export function createWipStatsAdornmentProvider(
	options: WipStatsAdornmentOptions,
): RowAdornmentProvider<TemplateResult, WipStats> {
	return {
		// WIP rows carry no refs, so render their working-tree stats in the refs zone — they show in
		// the Refs column when it's its own column (otherwise empty for WIP rows), and follow refs
		// inline otherwise. Keeps the stats grouped with the lane/refs region rather than the message.
		zone: 'ref',
		provideRowAdornment: function (row: ProcessedGraphRow): RowAdornment<WipStats> | undefined {
			if (row.kind !== 'workdir') return undefined;

			const stats = options.statsBySha.get(row.sha);
			if (stats == null) return undefined;

			return { context: stats, dynamic: true };
		},

		resolveAdornment: function (_row: ProcessedGraphRow, stats?: WipStats): TemplateResult | null {
			if (!stats) {
				return null;
			}

			// Clean and dirty both render through `<gl-wip-stats>`, which picks the pill from the counts.
			// Reaching here at all means the worktree WAS measured, so an all-zero result is "clean", not
			// "unknown" — the distinction the early return above exists to preserve.
			return renderWipStatsBadge(stats);
		},

		describeForA11y: function (_row: ProcessedGraphRow, stats?: WipStats): string | null {
			if (!stats) {
				return null;
			}

			// A paused op/conflicts state REPLACES the stats sentence — same swap `renderWipStatsBadge`
			// makes for the visible pill, so the announced text matches what's on screen.
			const paused = pausedOpFor(stats);
			if (paused != null) {
				return paused.label;
			}

			const parts: string[] = [];
			if ((stats.added ?? 0) > 0) {
				parts.push(`${stats.added} added`);
			}

			if ((stats.modified ?? 0) > 0) {
				parts.push(`${stats.modified} modified`);
			}

			if ((stats.deleted ?? 0) > 0) {
				parts.push(`${stats.deleted} deleted`);
			}

			if ((stats.renamed ?? 0) > 0) {
				parts.push(`${stats.renamed} renamed`);
			}

			// Clean is announced, not skipped — it mirrors the visible check, and silence here would read
			// to a screen reader as "stats not loaded" exactly when they are.
			if (parts.length === 0) {
				return 'no working changes';
			}

			return parts.join(', ');
		},
	};
}

/** Shared by `resolveAdornment`/`describeForA11y` so the visible pill and its announced text can't
 *  disagree about whether a paused op/conflicts state applies. */
function pausedOpFor(stats: WipStats): PausedOpIndicatorInfo | undefined {
	return pausedOpIndicatorInfo(stats.pausedOpStatus, stats.hasConflicts === true, stats.conflictsCount);
}

function renderWipStatsBadge(stats: WipStats): TemplateResult {
	const paused = pausedOpFor(stats);
	if (paused != null) {
		return renderPausedOpPill(paused);
	}

	const added = stats.added ?? 0;
	// Renames are folded into modified — `<commit-stats>` (add/edit/remove, like the rest of GitLens) has no
	// separate rename slot, and a rename is one modified FILE for at-a-glance magnitude. Counting it as an
	// add plus a delete would imply two files were touched.
	const modified = (stats.modified ?? 0) + (stats.renamed ?? 0);
	const deleted = stats.deleted ?? 0;

	// Right-aligned wrapper (see graph.scss); the dynamic `stale` opacity is the only inline style.
	const wrapStyle: StyleInfo = { opacity: stats.stale ? 0.55 : 1, transition: 'opacity 200ms linear' };

	// `<gl-wip-stats show-clean>` owns BOTH states — the `+ ~ -` pill when dirty and the check pill when
	// clean — so the graph row renders the same working-tree affordance as the WIP header, overview bar and
	// Home cards instead of a look-alike. Counts are passed as PROPERTIES (`.added`), not attributes: a
	// clean tree is all zeros, and `added=${0 || nothing}` would drop the attribute, leaving the component
	// unable to tell "clean" from "no data" — which is exactly the distinction it guards on.
	return html`<span class="gl-graph__wip-stats" style=${cspStyleMap(wrapStyle)}>
		<gl-wip-stats .added=${added} .modified=${modified} .removed=${deleted} show-clean no-tooltip></gl-wip-stats>
	</span>`;
}

// Replaces the stats pill while an operation is paused (or conflicts are unresolved with no operation
// recorded) — the row's headline reads "Rebasing" / "Resolve conflicts to continue rebasing" instead of
// a file count. Kept in the SAME `.gl-graph__wip-stats` wrapper as the stats pill (not a sibling
// element) so it inherits that class's layout rules (never-truncate width pin, `--commit-stats-pill-
// line-height: 1.8rem`) — the row's height and the zone's clip behavior don't change when an operation
// starts or ends. See graph.scss for `.gl-graph__paused-op-pill`.
function renderPausedOpPill(info: PausedOpIndicatorInfo): TemplateResult {
	return html`<span class="gl-graph__wip-stats">
		<span class="gl-graph__paused-op-pill gl-graph__paused-op-pill--${info.variant}">
			<code-icon icon=${pausedOperationVariantIcons[info.variant]}></code-icon>
			<span class="gl-graph__paused-op-pill-label">${info.label}</span>
		</span>
	</span>`;
}
