import type { GraphSidebarOverviewActionName, WebviewTelemetryEvents } from '../../../../../constants.telemetry.js';
import type { LaunchpadActionCategory, LaunchpadGroup } from '../../../../../plus/launchpad/models/launchpad.js';
import { launchpadCategoryToGroupMap, launchpadGroupIconMap } from '../../../../../plus/launchpad/models/launchpad.js';
import type { OverviewBranch, OverviewBranchEnrichment } from '../../../../shared/overviewBranches.js';
import type { ActionItem } from '../../../shared/components/actions/action-item.js';

/** Launchpad group for a PR, or undefined when it shouldn't surface a group badge. Shared by the overview
 *  card (drives its border class), `<gl-branch-hover>` (drives the hover's badge) and the sidebar's PR rows
 *  (drive their trailing indicator) so no two surfaces disagree on the same PR's grouping.
 *
 *  Structurally typed rather than tied to `OverviewBranchEnrichment` — the sidebar's PR rows carry their own
 *  (slimmer) wire shape and only these fields decide the group. */
export function getLaunchpadItemGroup(
	pr: { state: string; draft?: boolean } | undefined,
	launchpadItem: { category: LaunchpadActionCategory } | undefined,
): ReturnType<typeof launchpadCategoryToGroupMap.get> {
	if (launchpadItem == null || pr?.state !== 'opened') return undefined;
	if (pr.draft && launchpadItem.category === 'unassigned-reviewers') return undefined;

	const group = launchpadCategoryToGroupMap.get(launchpadItem.category);
	if (group == null || group === 'other' || group === 'draft' || group === 'current-branch') {
		return undefined;
	}

	return group;
}

/** Collapses a Launchpad group to the three visual buckets the card/hover style against. */
export function getLaunchpadItemGrouping(
	group: ReturnType<typeof getLaunchpadItemGroup>,
): 'mergeable' | 'blocked' | 'attention' | undefined {
	switch (group) {
		case 'mergeable':
			return 'mergeable';
		case 'blocked':
			return 'blocked';
		case 'follow-up':
		case 'needs-review':
			return 'attention';
	}

	return undefined;
}

/** Code-icon name for a Launchpad group's glyph — the map's `$(…)` wrapper unwrapped and the host's
 *  `gitlens-` icon prefix rewritten to the webview font's `gl-`. */
export function getLaunchpadGroupIconName(group: LaunchpadGroup | undefined): string | undefined {
	if (group == null) return undefined;

	return launchpadGroupIconMap
		.get(group)
		?.match(/\$\((.*?)\)/)?.[1]
		.replace('gitlens', 'gl');
}

/**
 * Map an `<action-item>`'s command-URI href back to a telemetry action name. Shared by the overview
 * card (its inline action-nav) and `<gl-branch-hover>` (the hover's action-nav), so both surfaces
 * report the same names.
 */
export function commandToOverviewActionName(href: string): GraphSidebarOverviewActionName {
	// command URIs look like `command:gitlens.x?{...}` or `command:gitlens.x:graph?{...}` for
	// "commands with suffix". Capture the full id (up to `?` or end), then strip the trailing
	// `:graph` suffix the overview-card webview emits via createCommandLink.
	const match = /^command:([^?]+)/.exec(href);
	const command = match?.[1].replace(/:graph$/, '');
	switch (command) {
		case 'gitlens.graph.pull':
			return 'pull';
		case 'gitlens.graph.push':
			return 'push';
		case 'gitlens.fetch':
			return 'fetch';
		case 'gitlens.publishBranch':
			return 'publishBranch';
		case 'gitlens.switchToBranch':
			return 'switch';
		case 'gitlens.openWorktree':
		case 'gitlens.openWorktreeInNewWindow':
			return 'openWorktree';
		case 'gitlens.graph.compareBranchWithHead':
			return 'compareWithHead';
		case 'gitlens.graph.compareWithWorking':
			return 'compareWithWorking';
		case 'gitlens.openPullRequestComparison':
			return 'compareWithPr';
		case 'gitlens.openPullRequestChanges':
			return 'openPrChanges';
		case 'gitlens.graph.openChangedFileDiffsWithMergeBase':
			return 'openChanges';
		default:
			return 'other';
	}
}

/** The branch-context fields the overview card's `branchSelected` and `<gl-branch-hover>`'s
 *  `hoverShown` payloads share. Pulled through the events map (the hover event is a superset) rather
 *  than redeclared, so neither impression can drift from the declared contract. */
type OverviewBranchContextData = Omit<WebviewTelemetryEvents['graph/overview/hoverShown'], 'surface' | 'hasAgents'>;

/**
 * Build the branch-context fields shared by the overview card's `branchSelected` and the branch hover's
 * `hoverShown` telemetry, so both surfaces report identical impressions for the same branch. `branch` may
 * be undefined — the hover renders without one for detached worktrees. `hasWip` stays caller-supplied:
 * each component derives it from its own `wip` prop (and uses that getter beyond telemetry).
 */
export function getOverviewBranchContextData(
	branch: Pick<OverviewBranch, 'opened' | 'worktree'> | undefined,
	enrichment: Pick<OverviewBranchEnrichment, 'pr' | 'issues' | 'autolinks'> | undefined,
	hasWip: boolean,
): OverviewBranchContextData {
	return {
		isActive: branch?.opened ?? false,
		isWorktree: branch?.worktree != null,
		hasPr: enrichment?.pr != null,
		hasIssues: (enrichment?.issues?.length ?? 0) > 0 || (enrichment?.autolinks?.length ?? 0) > 0,
		hasWip: hasWip,
	};
}

/**
 * Resolve the `<action-item>` clicked within a composed event and map its effective href to its
 * `graph/overview/action` telemetry name. Shared by the overview card's inline action-nav and the branch
 * hover's action-nav so both surfaces report identical names. Returns undefined when no action-item was
 * clicked, when it has no effective href, or when `bailOnTag` names an element on the composed path (the
 * popover-host-bound card passes `'GL-BRANCH-HOVER'`, whose own handler reports those clicks — bailing
 * here keeps them from double-counting).
 */
export function resolveOverviewActionItemClick(
	e: MouseEvent,
	bailOnTag?: string,
): { name: GraphSidebarOverviewActionName; alt: boolean } | undefined {
	let action: ActionItem | undefined;
	for (const node of e.composedPath()) {
		const el = node as Element;
		if (el?.tagName === bailOnTag) return undefined;

		// Native click events compose through shadow boundaries, so composedPath surfaces the original
		// `<action-item>` even though the event target has been retargeted upward.
		if (action == null && el?.tagName === 'ACTION-ITEM') {
			action = el as ActionItem;
		}
	}
	if (action == null) return undefined;

	const alt = e.altKey || e.shiftKey;
	const href = alt && action.altHref ? action.altHref : action.href;
	if (href == null) return undefined;

	return { name: commandToOverviewActionName(href), alt: alt };
}
