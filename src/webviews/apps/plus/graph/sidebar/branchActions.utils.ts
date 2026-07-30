import type { GraphSidebarBranch } from '../../../../plus/graph/protocol.js';
import type { TreeItemAction } from '../../../shared/components/tree/base.js';

/** Sentinel `TreeItemAction.action` handled inside the webview instead of dispatched to the host —
 *  focusing (scoping) the graph is view state, so it never needs to leave the webview. */
export const focusRefActionId = 'gl-graph-focus-ref';

/** Payload carried by a {@link focusRefActionId} action: the branch to focus the graph on. */
export interface FocusRefActionArgs {
	branchName: string;
	upstreamName?: string;
	/** Set when `branchName` is a remote branch that no local branch tracks, so the scope needs a
	 *  `remotes/*` ref id rather than a local head. */
	remote?: boolean;
}

/**
 * Inline action focusing (scoping) the graph onto a branch — shared by the branch, worktree, and
 * remote-branch leaves, which all ultimately focus a branch.
 *
 * Clicking it while the graph is already focused there unfocuses, mirroring the header's
 * jump-to-ref button. The label is deliberately fixed across both states so the row's icons don't
 * shift meaning as the scope changes.
 */
export function createFocusRefAction(label: string, args: FocusRefActionArgs): TreeItemAction {
	return { icon: 'target', label: label, action: focusRefActionId, arguments: [args] };
}

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

	// Always last, so it lands on the row's right edge (the trailing cluster is right-packed against
	// a flexing label) and stays put no matter which state-dependent actions precede it.
	actions.push(
		createFocusRefAction('Focus on Branch', {
			branchName: b.name,
			upstreamName: b.upstream?.missing ? undefined : b.upstream?.name,
		}),
	);

	return actions;
}
