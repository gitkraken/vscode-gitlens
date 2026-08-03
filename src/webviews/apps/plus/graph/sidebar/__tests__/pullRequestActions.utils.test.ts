import * as assert from 'assert';
import type { GlCommands } from '../../../../../../constants.commands.js';
import { sidebarItemActions } from '../../../../../plus/graph/graphSidebarActionTelemetry.js';
import type { GraphSidebarPullRequest } from '../../../../../plus/graph/protocol.js';
import { getPullRequestLeafActions } from '../pullRequestActions.utils.js';

function makePullRequest(overrides: Partial<GraphSidebarPullRequest>): GraphSidebarPullRequest {
	return {
		number: '1',
		id: 'pr-1',
		title: 'Test pull request',
		state: 'opened',
		url: 'https://example.com/pulls/1',
		headBranch: 'feature/test',
		headUrl: 'https://example.com/owner/repo',
		...overrides,
	};
}

// The PR-state permutations that drive getPullRequestLeafActions' branching: whether the row has an
// actionable head (a refless provider has neither half; a gone head repository leaves no branch; a
// provider that exposes no clone url leaves a branch with no url) × where that head is checked out ×
// whether the PR is still open (a merged/closed one reaches the list through the by-number search
// fallback).
const heads: Partial<GraphSidebarPullRequest>[] = [
	{},
	{ headBranch: undefined },
	{ headUrl: undefined },
	{ headBranch: undefined, headUrl: undefined },
];
const checkouts: Partial<GraphSidebarPullRequest>[] = [
	{},
	{ worktree: true },
	{ current: true },
	{ worktree: true, current: true },
];
const states: Partial<GraphSidebarPullRequest>[] = [{}, { state: 'closed' }, { state: 'merged' }];

function collectProducedCommands(): Set<string> {
	const produced = new Set<string>();
	for (const head of heads) {
		for (const checkout of checkouts) {
			for (const state of states) {
				for (const action of getPullRequestLeafActions(makePullRequest({ ...head, ...checkout, ...state }))) {
					produced.add(action.action);
					if (action.altAction != null) {
						produced.add(action.altAction);
					}
				}
			}
		}
	}
	return produced;
}

suite('pullRequestActions.utils', () => {
	test('every command a pull request leaf can produce resolves to a telemetry action name', () => {
		// If a new inline action is added without a mapping, graph/pullRequests/pullRequestAction drops
		// it silently — this test turns that into a failure.
		// Note: the shared table (sidebarItemActions.pullRequest) intentionally contains MORE commands
		// than the inline leaves produce — the extras are context-menu-only actions — so only the
		// "inline ⊆ table" direction is asserted.
		for (const command of collectProducedCommands()) {
			assert.ok(
				sidebarItemActions.pullRequest[command as GlCommands] != null,
				`Command '${command}' has no graph/pullRequests/pullRequestAction telemetry mapping — ` +
					`add it to sidebarItemActions.pullRequest (graphSidebarActionTelemetry.ts)`,
			);
		}
	});

	test('the leading chip only appears when it has a head to act on', () => {
		const leading = (pr: Partial<GraphSidebarPullRequest>) => getPullRequestLeafActions(makePullRequest(pr))[0];

		// No head (refless provider, gone head repository): neither switch nor worktree has anything to
		// name, so Open on Remote leads.
		assert.strictEqual(leading({ headBranch: undefined }).action, 'gitlens.openPullRequestOnRemote:graph');
		assert.strictEqual(
			leading({ headBranch: undefined, worktree: true }).action,
			'gitlens.openPullRequestOnRemote:graph',
		);
		// A head branch with no url is just as dead: both commands resolve the branch through its head's
		// remote url, and refuse to act without one.
		assert.strictEqual(leading({ headUrl: undefined }).action, 'gitlens.openPullRequestOnRemote:graph');
		assert.strictEqual(
			leading({ headUrl: undefined, worktree: true }).action,
			'gitlens.openPullRequestOnRemote:graph',
		);
		// Already checked out here: the deep link behind both actions skips the switch on a name match, so
		// neither chip is offered — including when a worktree exists, where it would open no window.
		assert.strictEqual(leading({ current: true }).action, 'gitlens.openPullRequestOnRemote:graph');
		assert.strictEqual(leading({ worktree: true, current: true }).action, 'gitlens.openPullRequestOnRemote:graph');
		assert.strictEqual(leading({ worktree: true }).action, 'gitlens.graph.openInWorktree');
		assert.strictEqual(leading({}).action, 'gitlens.switchToPullRequest:graph');
	});

	test('the leading chip is withheld from a merged or closed pull request', () => {
		// These rows only reach the list through the by-number search fallback, and their head branch is
		// usually deleted — switching onto it, or worktree-ing it, is what the context menu's `+closed`
		// exclusion already refuses. The chip has to agree, so Open on Remote leads instead.
		const leading = (pr: Partial<GraphSidebarPullRequest>) => getPullRequestLeafActions(makePullRequest(pr))[0];

		for (const state of ['merged', 'closed'] as const) {
			assert.strictEqual(leading({ state: state }).action, 'gitlens.openPullRequestOnRemote:graph', state);
			assert.strictEqual(
				leading({ state: state, worktree: true }).action,
				'gitlens.openPullRequestOnRemote:graph',
				`${state} + worktree`,
			);
		}
	});
});
