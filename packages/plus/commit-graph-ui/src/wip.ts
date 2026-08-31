import type { GraphPlacement, ZoneSpec } from '@gitkraken/commit-graph/view.js';

/**
 * Per-working-tree-row identity supplied by the host. The renderer uses this separately from the row's
 * generic commit payload so the inline branch pill, scroll marker, tooltip, and accessible label can name
 * a working tree without encoding product-specific identity into the row message.
 */
export interface WipRowInfo {
	/** Tip branch name, or a host-synthesized detached-HEAD label when {@link detached} is true. */
	branchName?: string;
	/** Whether the working tree is on a detached HEAD, making its identity pill non-interactive. */
	detached?: boolean;
	/** Tracked upstream name, when already available to the host. */
	upstreamName?: string;
	/** Already-resolved merge target; the renderer never fetches it. */
	target?: { sha: string; name?: string };
	/** Display name for a secondary working tree. */
	worktreeName?: string;
	/** HEAD sha used as the branch-pill jump target. */
	tipSha?: string;
	/** Whether this row represents the host's primary working tree. */
	isPrimary: boolean;
}

/** The first zone after both the lanes and message cell that may be suppressed for a constrained WIP row. */
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

export const wipRowFullLabel = 'Working Changes';
export const wipRowShortLabel = 'WIP';

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

export interface WipRowFit {
	/** Visible label override; `undefined` retains the full label. */
	label: string | undefined;
	/** Maximum branch-name width; `undefined` leaves the pill unclamped. */
	pillMaxWidth: number | undefined;
}

/** Pure width-degradation decision for the WIP label and branch-pill name. */
export function computeWipRowFit(availableWidth: number, metrics: WipRowFitMetrics): WipRowFit {
	const pillWidth = metrics.pillChromeWidth + metrics.pillNameWidth;
	const fixed = metrics.statsWidth + metrics.slack;

	if (metrics.fullLabelWidth + pillWidth + fixed <= availableWidth) {
		return { label: undefined, pillMaxWidth: undefined };
	}

	if (metrics.shortLabelWidth + pillWidth + fixed <= availableWidth) {
		return { label: wipRowShortLabel, pillMaxWidth: undefined };
	}

	const nameBudget = availableWidth - metrics.shortLabelWidth - fixed - metrics.pillChromeWidth;
	return { label: wipRowShortLabel, pillMaxWidth: Math.max(0, nameBudget) };
}
