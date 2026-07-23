import type { GraphSidebarBranch } from '../../../../plus/graph/protocol.js';
import type { TreeItemAction } from '../../../shared/components/tree/base.js';

/**
 * Builds the inline actions for a branch leaf in the branches sidebar panel.
 *
 * Every command (action/altAction) produced here must resolve in the shared
 * `sidebarItemActions.branch` table (graphSidebarActionTelemetry.ts) — otherwise
 * `graph/branches/branchAction` telemetry silently drops it. Guarded by
 * `__tests__/branchActions.utils.test.ts`.
 */
export function getBranchLeafActions(b: GraphSidebarBranch): TreeItemAction[] {
	const actions: TreeItemAction[] = [];

	if (b.tracking?.behind) {
		actions.push({
			icon: 'repo-pull',
			label: 'Pull',
			action: 'gitlens.graph.pull',
			altIcon: 'repo-fetch',
			altLabel: 'Fetch',
			altAction: 'gitlens.fetch:graph',
		});
	} else if (b.tracking?.ahead) {
		actions.push({ icon: 'repo-push', label: 'Push', action: 'gitlens.graph.push' });
	} else if (b.upstream && !b.upstream.missing) {
		actions.push({
			icon: 'repo-fetch',
			label: 'Fetch',
			action: 'gitlens.fetch:graph',
			altIcon: 'repo-pull',
			altLabel: 'Pull',
			altAction: 'gitlens.graph.pull',
		});
	}

	if (b.current) {
		actions.unshift({
			icon: 'gl-switch',
			label: 'Switch to Another Branch...',
			action: 'gitlens.switchToAnotherBranch:graph',
		});
		actions.push({
			icon: 'gl-compare-ref-working',
			label: 'Compare with Working Tree',
			action: 'gitlens.graph.compareWithWorking',
		});
	} else if (b.checkedOut) {
		actions.push({
			icon: 'empty-window',
			label: 'Open Worktree in New Window...',
			action: 'gitlens.openWorktreeInNewWindow:graph',
			altIcon: 'window',
			altLabel: 'Open Worktree...',
			altAction: 'gitlens.openWorktree:graph',
		});
	} else {
		actions.unshift({
			icon: 'gl-switch',
			label: 'Switch to Branch...',
			action: 'gitlens.switchToBranch:graph',
		});
		actions.push({
			icon: 'compare-changes',
			label: 'Compare with HEAD',
			action: 'gitlens.graph.compareBranchWithHead',
			altIcon: 'gl-compare-ref-working',
			altLabel: 'Compare with Working Tree',
			altAction: 'gitlens.graph.compareWithWorking',
		});
	}

	return actions;
}
