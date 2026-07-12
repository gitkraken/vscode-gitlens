import type { GraphSidebarOverviewActionName } from '../../../../../constants.telemetry.js';
import { launchpadCategoryToGroupMap } from '../../../../../plus/launchpad/models/launchpad.js';
import type { OverviewBranchEnrichment, OverviewBranchLaunchpadItem } from '../../../../shared/overviewBranches.js';

/** Launchpad group for a branch's PR, or undefined when it shouldn't surface a group badge. Shared by
 *  the overview card (drives its border class) and `<gl-branch-hover>` (drives the hover's badge) so the
 *  two never disagree on the same branch's grouping. */
export function getLaunchpadItemGroup(
	pr: OverviewBranchEnrichment['pr'],
	launchpadItem: OverviewBranchLaunchpadItem | undefined,
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
