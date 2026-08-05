import * as assert from 'assert';
import type { GlCommands } from '../../../../../../constants.commands.js';
import { sidebarItemActions } from '../../../../../plus/graph/graphSidebarActionTelemetry.js';
import type { GraphSidebarBranch } from '../../../../../plus/graph/protocol.js';
import {
	branchTreeIcon,
	focusRefActionId,
	getBranchLeafActions,
	remoteProviderFolderIcon,
	remoteProviderIconsByName,
} from '../branchActions.utils.js';

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
	// Focus never leaves the webview — it's a view-state toggle handled in `sidebar-panel`, not a
	// command, and reports itself through `graph/scope/changed|cleared`. The shared table maps
	// command ids only, so exclude it rather than inventing a branchAction name for it.
	produced.delete(focusRefActionId);
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

	test('branchTreeIcon brands remote branches and leaves local ones on the branch glyph', () => {
		assert.deepStrictEqual(branchTreeIcon(makeBranch({ status: 'ahead', worktree: true })), {
			type: 'branch',
			status: 'ahead',
			worktree: true,
		});

		assert.strictEqual(
			branchTreeIcon(makeBranch({ name: 'origin/test', remote: true, providerIcon: 'github' })),
			'gl-provider-github',
		);
		// No provider, or one the icon font doesn't cover, falls back to the cloud codicon
		assert.strictEqual(branchTreeIcon(makeBranch({ name: 'origin/test', remote: true })), 'cloud');
		assert.strictEqual(
			branchTreeIcon(makeBranch({ name: 'origin/test', remote: true, providerIcon: 'remote' })),
			'cloud',
		);
	});

	test('remoteProviderIconsByName keys the group icon off the remote segment', () => {
		const icons = remoteProviderIconsByName([
			makeBranch({ name: 'feature/local', providerIcon: 'github' }),
			makeBranch({ name: 'origin/feature/test', remote: true, providerIcon: 'github' }),
			makeBranch({ name: 'upstream/feature/test', remote: true }),
		]);

		// Local branches carry a providerIcon too (their upstream's), but they never fold under a remote node
		assert.deepStrictEqual(
			[...icons],
			[
				['origin', 'gl-provider-github'],
				['upstream', 'cloud'],
			],
		);
	});

	test('remoteProviderFolderIcon brands only the node standing in for the remote', () => {
		const icons = new Map([['origin', 'gl-provider-github']]);

		assert.strictEqual(remoteProviderFolderIcon(icons, 'origin'), 'gl-provider-github');
		// A compacted node fronting the remote is named for the whole run it swallowed
		assert.strictEqual(remoteProviderFolderIcon(icons, 'origin/feature'), 'gl-provider-github');
		// A folder nested under the remote is named for itself alone, and stays a folder
		assert.strictEqual(remoteProviderFolderIcon(icons, 'feature'), undefined);
		assert.strictEqual(remoteProviderFolderIcon(icons, ''), undefined);
	});
});
