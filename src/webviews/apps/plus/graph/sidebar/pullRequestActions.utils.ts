import type { GraphSidebarPullRequest } from '../../../../plus/graph/protocol.js';
import type { TreeItemAction } from '../../../shared/components/tree/base.js';

/**
 * Builds the inline actions for a pull request leaf in the pull requests sidebar panel — every action
 * but Focus, which the panel appends itself (it's webview-handled view state rather than a command).
 *
 * Every command (action/altAction) produced here must resolve in the shared
 * `sidebarItemActions.pullRequest` table (graphSidebarActionTelemetry.ts) — otherwise
 * `graph/pullRequests/pullRequestAction` telemetry silently drops it. Guarded by
 * `__tests__/pullRequestActions.utils.test.ts`.
 */
export function getPullRequestLeafActions(pr: GraphSidebarPullRequest): TreeItemAction[] {
	const actions: TreeItemAction[] = [];

	// Both leading chips act on the PR's head branch, so a PR without an actionable head gets neither —
	// same gating as the context menu's `+head` requirement. Head *and* url, because that's the pair the
	// handlers check before doing anything: a head repository that's gone leaves the branch empty, but a
	// provider that just doesn't expose a clone url leaves a perfectly good branch with no url, and both
	// make every one of these commands a silent no-op.
	// Only an open PR gets one: a merged/closed head is typically already deleted, so switching lands on a
	// dead branch and the worktree flavor's deep link falls through to opening the whole PR as diffs. Such
	// a row reaches the list only through the by-number search fallback, but it does reach it — and the
	// context menu already hides both commands there (its `+closed` suffix is this same `!== 'opened'`).
	// Neither is offered when the head is already checked out either: the deep link both run compares the
	// checked-out branch to the target by `nameWithoutRemote` alone (`DeepLinkService`'s `SwitchToRef`
	// state) and on a match sets `skipSwitch`, dropping the switch and with it the `worktreeDefaultOpen`
	// the worktree flavor rides on — it goes straight to showing WIP instead. A fork head matches too: the
	// target resolves to the local branch of that name when nothing remote-qualified exists. `pr.current`
	// mirrors that same short-name test, so the row offers only what the link will actually do.
	if (pr.state === 'opened' && pr.headBranch && pr.headUrl && !pr.current) {
		if (pr.worktree) {
			// A worktree already exists for the PR's branch, so the chip opens it rather than offering a
			// switch that would checkout the branch a second time.
			actions.push({
				icon: 'empty-window',
				label: 'Open Worktree in New Window...',
				action: 'gitlens.graph.openInWorktree',
			});
		} else {
			actions.push({
				icon: 'gl-switch',
				label: 'Switch to Branch...',
				action: 'gitlens.switchToPullRequest:graph',
				altIcon: 'empty-window',
				altLabel: 'Open in Worktree...',
				altAction: 'gitlens.graph.openInWorktree',
			});
		}
	}

	actions.push({
		icon: 'globe',
		label: 'Open Pull Request on Remote',
		action: 'gitlens.openPullRequestOnRemote:graph',
		altIcon: 'copy',
		altLabel: 'Copy Pull Request URL',
		altAction: 'gitlens.copyRemotePullRequestUrl:graph',
	});

	return actions;
}
