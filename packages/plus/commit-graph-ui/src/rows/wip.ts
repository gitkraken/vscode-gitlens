import type { GraphPlacement } from '@gitkraken/commit-graph/geometry.js';
import * as l10n from '@gitkraken/commit-graph/l10n.js';
import type { ZoneSpec } from '@gitkraken/commit-graph/zones.js';
import type { WipRowInfo } from '../contracts/rows.js';
import type { CommitGraphPausedOperationStatus, WorkDirStats } from '../contracts/state.js';
import type { WipNodeState } from '../gutter/render.js';

export function hasDirtyCounts(stats: Partial<WorkDirStats> | undefined): boolean {
	if (stats == null) return false;

	return (stats.added ?? 0) + (stats.modified ?? 0) + (stats.deleted ?? 0) + (stats.renamed ?? 0) > 0;
}

/**
 * The first zone index (in `zones` order) that counts as "after both the lanes and the message zone" —
 * shared by `graphRow.ts`'s full-row-budget cell suppression and `surface.ts`'s available-width
 * estimate for the degradation ladder, so the two can never disagree about which cells are actually
 * suppressed. Mirrors the graph-column splice's own insertion index for 'column' placement and the lane
 * host's cell for 'grouped' (the zone that CARRIES the lanes is never itself "after" them); 'hidden' has
 * no lanes cell to protect, so the message zone alone gates. Returns `Infinity` when there's no message
 * zone at all — nothing should be suppressed then.
 */
export function wipZoneSuppressFromIndex(
	zones: readonly ZoneSpec[],
	graphPlacement: GraphPlacement,
	graphColumnPos: number,
	graphHostId: string | undefined,
): number {
	const messageIdx = zones.findIndex(z => z.id === 'message');
	if (messageIdx < 0) return Infinity;

	const graphHostIdx = graphHostId != null ? zones.findIndex(z => z.id === graphHostId) : -1;
	const laneZoneIdx = graphHostIdx >= 0 ? graphHostIdx : Math.min(graphColumnPos, Math.max(0, zones.length - 1));
	const laneAfterIdx =
		graphPlacement === 'column'
			? Math.min(graphColumnPos, zones.length)
			: graphPlacement === 'grouped'
				? laneZoneIdx + 1
				: 0;
	return Math.max(messageIdx + 1, laneAfterIdx);
}

/** The full and short forms of a WIP row's visible label — the degradation ladder's first rung
 *  (`computeWipRowFit`) swaps between them; never an ellipsis on the label itself. */
export function wipRowFullLabel(): string {
	return l10n.t('Working Changes');
}

export function wipRowShortLabel(): string {
	return l10n.t('WIP');
}

export function wipRowBranchTitle(info: WipRowInfo | undefined, idLength: number): string | undefined {
	if (info == null) return undefined;
	if (info.detached !== true && info.branchName) return info.branchName;

	const shortSha = info.tipSha?.slice(0, idLength);
	if (info.worktreeName && shortSha) return `${info.worktreeName} (${shortSha})`;

	return info.branchName || info.worktreeName || shortSha || undefined;
}

export function wipRowState(
	wipState: WipNodeState | undefined,
	pausedOpStatus: CommitGraphPausedOperationStatus | undefined,
	hasConflicts: boolean | undefined,
): 'clean' | 'dirty' | undefined {
	if (pausedOpStatus != null || hasConflicts === true) return 'dirty';
	if (wipState == null) return undefined;

	return wipState === 'clean' ? 'clean' : 'dirty';
}

/**
 * Measured inputs `computeWipRowFit` needs to decide a WIP row's label + pill-name cap. All widths are
 * px, measured by the caller (canvas `measureText` for text, computed/rendered chrome for the rest — see
 * `surface.ts`'s `buildWipRowFit`) — this module stays framework/DOM-free so the decision itself is
 * a pure, cheaply-testable function of plain numbers.
 */
export interface WipRowFitMetrics {
	/** Width of {@link wipRowFullLabel} in the rendered message font. */
	fullLabelWidth: number;
	/** Width of {@link wipRowShortLabel} in the rendered message font. */
	shortLabelWidth: number;
	/** Width of the branch pill excluding its name. */
	pillChromeWidth: number;
	/** Natural, unclamped width of the branch name. */
	pillNameWidth: number;
	/** Width of the working-tree stats that share the row's available space. */
	statsWidth: number;
	/** Safety margin for font and layout measurement variance. */
	slack: number;
}

/** The degradation ladder's decision for one WIP row — see `computeWipRowFit`. */
export interface WipRowFit {
	/** Visible label override; `undefined` retains the full label. */
	label: string | undefined;
	/** Maximum branch-name width; `undefined` leaves the pill unclamped. */
	pillMaxWidth: number | undefined;
}

/**
 * Pure width-degradation decision for the WIP label and branch-pill name. `availableWidth` is the
 * message zone's solved width, plus whatever the suppressed trailing zones freed (see
 * `graphRow.ts`'s `wipSuppressFromIdx`); no DOM, no canvas, so it's cheap to exhaustively unit test.
 *
 * Ladder, in order:
 *  1. `wipRowFullLabel` + the pill (at its natural name width) + the stats pill + slack fits → show it,
 *     pill uncapped.
 *  2. Otherwise, the DISCRETE swap to `wipRowShortLabel` (never a label ellipsis) — if that alone fits
 *     with the pill still uncapped, stop there.
 *  3. Otherwise the pill's name is what has to give: capped to whatever's left after the short label +
 *     stats + slack — all the way to zero, so the name ellipsizes as far as it must (no legibility
 *     floor: a hard cell clip with no ellipsis reads worse than a short ellipsized name; the pill
 *     wrapper's own flex shrink in graph.scss is the layout-level backstop for anything this math
 *     misses).
 */
export function computeWipRowFit(availableWidth: number, metrics: WipRowFitMetrics): WipRowFit {
	const pillWidth = metrics.pillChromeWidth + metrics.pillNameWidth;
	const fixed = metrics.statsWidth + metrics.slack;

	if (metrics.fullLabelWidth + pillWidth + fixed <= availableWidth) {
		return { label: undefined, pillMaxWidth: undefined };
	}

	if (metrics.shortLabelWidth + pillWidth + fixed <= availableWidth) {
		return { label: wipRowShortLabel(), pillMaxWidth: undefined };
	}

	const nameBudget = availableWidth - metrics.shortLabelWidth - fixed - metrics.pillChromeWidth;
	return { label: wipRowShortLabel(), pillMaxWidth: Math.max(0, nameBudget) };
}
