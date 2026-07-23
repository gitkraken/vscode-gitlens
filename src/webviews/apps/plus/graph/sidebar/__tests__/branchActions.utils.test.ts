import * as assert from 'assert';
import type { GlCommands } from '../../../../../../constants.commands.js';
import { sidebarItemActions } from '../../../../../plus/graph/graphSidebarActionTelemetry.js';
import type { GraphSidebarBranch } from '../../../../../plus/graph/protocol.js';
import { getBranchLeafActions } from '../branchActions.utils.js';

function makeBranch(overrides: Partial<GraphSidebarBranch>): GraphSidebarBranch {
	return {
		name: 'feature/test',
		sha: 'abc123',
		current: false,
		remote: false,
		...overrides,
	};
}

// The branch-state permutations that drive getBranchLeafActions' branching:
// tracking state (behind / ahead / in-sync upstream / missing upstream / none) × role
// (current / checked out in a worktree / other).
const trackingStates: Partial<GraphSidebarBranch>[] = [
	{ tracking: { ahead: 0, behind: 2 }, upstream: { name: 'origin/test', missing: false } },
	{ tracking: { ahead: 2, behind: 0 }, upstream: { name: 'origin/test', missing: false } },
	{ tracking: { ahead: 0, behind: 0 }, upstream: { name: 'origin/test', missing: false } },
	{ upstream: { name: 'origin/test', missing: true } },
	{},
];
const roles: Partial<GraphSidebarBranch>[] = [{ current: true }, { checkedOut: true }, {}];

function collectProducedCommands(): Set<string> {
	const produced = new Set<string>();
	for (const tracking of trackingStates) {
		for (const role of roles) {
			for (const action of getBranchLeafActions(makeBranch({ ...tracking, ...role }))) {
				produced.add(action.action);
				if (action.altAction != null) {
					produced.add(action.altAction);
				}
			}
		}
	}
	return produced;
}

suite('branchActions.utils', () => {
	test('every command a branch leaf can produce resolves to a telemetry action name', () => {
		// If a new inline action is added without a mapping, graph/branches/branchAction drops
		// it silently — this test turns that into a failure.
		// Note: the shared table (sidebarItemActions.branch) intentionally contains MORE commands
		// than the inline leaves produce — the extras are context-menu-only actions — so only the
		// "inline ⊆ table" direction is asserted.
		for (const command of collectProducedCommands()) {
			assert.ok(
				sidebarItemActions.branch[command as GlCommands] != null,
				`Command '${command}' has no graph/branches/branchAction telemetry mapping — ` +
					`add it to sidebarItemActions.branch (graphSidebarActionTelemetry.ts)`,
			);
		}
	});
});
