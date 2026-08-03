import type { GraphSidebarOverviewActionName } from '../../../../../constants.telemetry.js';
import type { LaunchpadActionCategory, LaunchpadGroup } from '../../../../../plus/launchpad/models/launchpad.js';
import { launchpadCategoryToGroupMap, launchpadGroupIconMap } from '../../../../../plus/launchpad/models/launchpad.js';

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
