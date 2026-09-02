/**
 * GitLens Graph — the SCOPED worktree deleted EXTERNALLY (a terminal `git worktree remove`)
 *
 * `git worktree remove` run outside GitLens (a terminal, another tool) never touches
 * `container.git.openRepositories` — a rebound worktree was never added there in the first place
 * (`rebindRepositoryCore` resolves it with `opened: false`) — so the graph's existing
 * `onDidChangeRepositories`-keyed recovery (which watches for a Repository dropping out of that list)
 * never fires. Left uncaught, the graph wedges on the dead binding forever: scoped chrome (tint, pill)
 * and the deleted worktree's own phantom WIP row persist with no way back to home.
 *
 * The actual seam: the physical `.git` directory's common watcher dispatches a `worktrees`-classified
 * change to EVERY session sharing it (see `WatchGroup.onCommonEvent` in
 * `packages/git/src/watching/watchGroup.ts`) — including the session for the worktree that was just
 * deleted. `graphWebview.ts`'s `onRepositoryChanged` now uses that event to confirm the bound worktree
 * still exists and, if not, runs the same rebind-home recovery. Two more gaps had to close before that
 * signal could ever arrive or land cleanly:
 *  - `ensureRepositorySubscriptions` never held a `Repository.watch()` lease on the bound repo — only
 *    `watchWorkingTree()` — so `RepositoryChangeEvent`s (this one included) never reached the graph at
 *    all for a rebound-but-unopened worktree, regardless of cause.
 *  - `watcherPatterns.ts`'s `worktrees/*` glob only matches a worktree's OWN admin directory, not the
 *    parent `worktrees` entry — and removing the last worktree deletes that parent directory too. A
 *    bare `worktrees` pattern was added alongside it.
 *  - Client-side, a same-family rebind that lands back on home only cleared the worktree PERSPECTIVE
 *    (`stateProvider.ts`'s `restampScopeStateForRebind`), not the branch FOCUS — a gesture-driven exit
 *    clears both eagerly, but this HOST-initiated recovery has no client gesture to do that, so the
 *    focus stayed narrowed to the deleted worktree's branch and hid home's own rows (WIP row included).
 *
 * The sidebar still listing the deleted worktree is a separate, pre-existing gap (its own
 * invalidation gate is missing `worktrees`) — NOT covered or asserted here.
 */
import * as path from 'node:path';
import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import {
	branchPill,
	doubleClickWipRow,
	expectScopeTint,
	graphWipRow,
	openGraph,
	unscopeWorktreeButton,
} from '../graphScopeHelpers.js';

/** The main checkout the test window is opened on — the graph's home. */
let home: GitFixture;
let homePath: string;
let worktreePath: string;

const worktreeBranch = 'wt-feature';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			userSettings: {
				// Pinned, so the graph's own side bar takes its width out of the split instead of
				// floating over the rows, where its rail swallows clicks aimed at a worktree row.
				'gitlens.graph.sidebar.pinned': true,
			},
			setup: async () => {
				const repoDir = await createTmpDir();
				home = new GitFixture(repoDir);
				await home.init();
				await home.commit('Base commit', 'base.txt', 'base\n', { date: '2024-01-01T00:00:00Z' });
				await home.branch(worktreeBranch);
				await home.commit('Main only commit', 'main-only.txt', 'main\n', { date: '2024-01-02T00:00:00Z' });

				homePath = repoDir;
				worktreePath = path.join(await createTmpDir(), 'wt-feature');
				await home.worktree(worktreePath, worktreeBranch);

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — the scoped worktree deleted externally', () => {
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('external `git worktree remove` of the scoped worktree returns the graph to home, unscoped', async ({
		vscode,
	}) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		const webview = await openGraph(vscode);
		await expectScopeTint(webview, 'none');
		await expect(branchPill(webview)).toContainText('main');

		await doubleClickWipRow(webview, worktreePath);
		await expectScopeTint(webview, 'whole-bar');
		await expect(unscopeWorktreeButton(webview)).toBeVisible({ timeout: MaxTimeout });
		await expect(branchPill(webview)).toContainText(worktreeBranch);

		// The external deletion — run from HOME's cwd, since the worktree's own directory is what's
		// about to disappear.
		await home.removeWorktree(worktreePath);

		// Recovery is event-driven (a `worktrees` repo-change reaching `onRepositoryChanged`), not
		// immediate — poll rather than assert once. Chrome and binding must both land back on home: no
		// tint, no unscope affordance, home's branch in the pill, and home's WIP row as the primary row.
		await expectScopeTint(webview, 'none', 30000);
		await expect(unscopeWorktreeButton(webview)).toHaveCount(0);
		await expect(branchPill(webview)).toContainText('main');
		await expect(graphWipRow(webview, homePath)).toHaveAttribute('data-index', '0', { timeout: 30000 });
	});
});
