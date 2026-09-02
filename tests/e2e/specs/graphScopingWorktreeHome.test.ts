/**
 * GitLens Graph — scope from a window opened ON a worktree
 *
 * The regression class this exists for: HOME is whichever checkout the window was opened on, NOT the
 * repository's default worktree. Open the window on a worktree and the MAIN checkout becomes an
 * ordinary scope target — a gesture on it must produce a real scoped state, not the silent "you're
 * already home" no-op it would get if home were keyed on `worktree.isDefault`.
 *
 * Its own spec file because the workspace folder the editor opens is a worker-scoped fixture: this
 * one opens on the worktree, `graphScoping.test.ts` opens on the main checkout.
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
	openGraphSidebarPanel,
	sidebarRow,
	sidebarRowScopedBadge,
	unscopeWorktreeButton,
} from '../graphScopeHelpers.js';

/** The repository's main checkout — a scope TARGET here, not home. */
let mainCheckoutPath: string;
/** The worktree the test window is opened on — the graph's home. */
let homeWorktreePath: string;

const homeBranch = 'sidecar';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			userSettings: {
				// Pinned, so the graph's own side bar takes its width out of the split instead of floating
				// over the rows, where its rail swallows clicks aimed at a worktree row.
				'gitlens.graph.sidebar.pinned': true,
			},
			setup: async () => {
				const repoDir = await createTmpDir();
				const repo = new GitFixture(repoDir);
				await repo.init();
				await repo.commit('Base commit', 'base.txt', 'base\n', { date: '2024-01-01T00:00:00Z' });
				await repo.branch(homeBranch);
				await repo.commit('Main only commit', 'main-only.txt', 'main\n', { date: '2024-01-02T00:00:00Z' });

				mainCheckoutPath = repoDir;
				homeWorktreePath = path.join(await createTmpDir(), 'sidecar');
				await repo.worktree(homeWorktreePath, homeBranch);

				const home = new GitFixture(homeWorktreePath);
				await home.commit('Sidecar commit', 'sidecar.txt', 'sidecar\n', { date: '2024-03-01T00:00:00Z' });

				// The window opens on the WORKTREE.
				return homeWorktreePath;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — scope from a window opened on a worktree', () => {
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('scoping the main checkout genuinely scopes, and unscoping returns to the worktree', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		const webview = await openGraph(vscode);

		// Home is the worktree the window opened on: its working-changes row is the primary one and the
		// pill names its branch.
		await expect(graphWipRow(webview, homeWorktreePath)).toHaveAttribute('data-index', '0', { timeout: 30000 });
		await expect(branchPill(webview)).toContainText(homeBranch);
		await expectScopeTint(webview, 'none');

		// The main checkout is an ordinary target from here — this must scope, not no-op.
		await doubleClickWipRow(webview, mainCheckoutPath);
		await expectScopeTint(webview, 'whole-bar');
		await expect(unscopeWorktreeButton(webview)).toBeVisible({ timeout: MaxTimeout });
		await expect(branchPill(webview)).toContainText('main');
		await expect(graphWipRow(webview, mainCheckoutPath)).toHaveAttribute('data-index', '0', { timeout: 30000 });

		// And the side bar badges the row it is scoped to — the visible half of the same state.
		await openGraphSidebarPanel(vscode, 'worktrees');
		await expect(sidebarRowScopedBadge(sidebarRow(webview, 'main'))).toBeVisible({ timeout: 30000 });

		await unscopeWorktreeButton(webview).click();
		await expectScopeTint(webview, 'none');
		await expect(branchPill(webview)).toContainText(homeBranch);
		await expect(graphWipRow(webview, homeWorktreePath)).toHaveAttribute('data-index', '0', { timeout: 30000 });
	});
});
