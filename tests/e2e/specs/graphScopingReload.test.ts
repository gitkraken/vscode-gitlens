/**
 * GitLens Graph — worktree scope SURVIVES a WEBVIEW-only reload
 *
 * `workbench.action.webview.reloadWebviewAction` (and dock/editor-group moves that recreate the
 * iframe) tears down and rebuilds the webview alone — the extension host stays alive and stays bound
 * to whatever it was rebound to. The webview-side scope perspective (`worktreePerspective`) is
 * session-only state that dies with the old iframe, so a fresh bootstrap has no live perspective of
 * its own to render from.
 *
 * Spec ruling REVERSED (was E9: "reload while scoped reopens home, unscoped" — overturned): a scoped
 * graph now stays scoped across a reload. Chrome is derived from the bootstrap STATE itself rather
 * than defaulted to unscoped: `stateProvider.ts`'s `updateState` adopts a perspective straight from
 * `selectedRepository`/`homeRepositoryPath` whenever there's no live one, so chrome can never disagree
 * with the binding — a webview-only reload needs no rebind at all (the host never lost its binding),
 * just this client-side re-adoption. Branch FOCUS (the row-narrowing projection) is a SEPARATE,
 * webview-local concept with no host-side representation to adopt from, so it does NOT survive a
 * reload even though the perspective now does — the tint after reload is `top-row` (scoped, unfocused),
 * not `whole-bar`.
 *
 * This covers the sidebar VIEW's reload, which rebuilds the HTML (`includeBootstrap` runs — a no-op
 * for a webview-only reload, since `_rebindHome` is already set; see its host-side comment). The
 * graph's editor-TAB surface (`gitlens.showGraphPage`, a webview PANEL) reloads via a soft reconnect
 * instead — the iframe re-boots from the ORIGINAL bootstrap and converges over RPC, so
 * `includeBootstrap` never runs and the SAME re-adoption rule in `updateState` (it runs on every
 * apply, not just bootstrap) has to catch the fresh push that follows. That second path is NOT
 * covered here: `getGitLensWebview`'s title match (`gitLensPage.ts`) only accepts an exact title or a
 * `Title (...)`/`Title,...` suffix, and the editor-tab panel's title comes back as
 * `Commit Graph: <workspace-name>` — a suffix shape that lookup doesn't recognize, so the panel can
 * never be located this way. Fixing that is a shared-page-object change outside this task's scope;
 * the soft-reconnect path is verified by live inspection instead.
 */
import * as path from 'node:path';
import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { ensureGraphRowsRendered } from '../graphHelpers.js';
import {
	branchPill,
	doubleClickWipRow,
	expectScopeTint,
	graphWipRow,
	openGraph,
	reloadGraphWebview,
	unscopeWorktreeButton,
} from '../graphScopeHelpers.js';

/** The main checkout the test window is opened on — the graph's home. */
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
				const home = new GitFixture(repoDir);
				await home.init();
				await home.commit('Base commit', 'base.txt', 'base\n', { date: '2024-01-01T00:00:00Z' });
				await home.branch(worktreeBranch);
				await home.commit('Main only commit', 'main-only.txt', 'main\n', { date: '2024-01-02T00:00:00Z' });

				homePath = repoDir;
				worktreePath = path.join(await createTmpDir(), 'wt-feature');
				await home.worktree(worktreePath, worktreeBranch);

				const worktree = new GitFixture(worktreePath);
				await worktree.commit('Worktree commit', 'wt.txt', 'wt\n', { date: '2024-03-01T00:00:00Z' });

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — worktree scope on a webview-only reload', () => {
	// Serial, and ordered deliberately: the host-side rebind now PERSISTS past a reload — and past
	// `resetUI()`, which only closes VS Code UI surfaces, not the graph provider's own binding — so
	// whichever journey runs first leaves the host bound (or not) for the one after it. The unscope
	// journey runs FIRST for exactly that reason: it ends unscoped, which is the clean starting state
	// the scope journey's own opening assertion already expects.
	test.describe.configure({ mode: 'serial' });

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('reloading the webview after unscoping stays unscoped', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		const webview = await openGraph(vscode);
		await doubleClickWipRow(webview, worktreePath);
		await expectScopeTint(webview, 'whole-bar');

		// Full exit — this is the seam that clears the PERSISTED perspective, not just the live one, so
		// a later reload has nothing left to re-adopt.
		await unscopeWorktreeButton(webview).click();
		await expectScopeTint(webview, 'none');

		const reloaded = await reloadGraphWebview(vscode, webview);
		await ensureGraphRowsRendered(vscode, reloaded, 30000);

		await expectScopeTint(reloaded, 'none', 30000);
		await expect(unscopeWorktreeButton(reloaded)).toHaveCount(0);
		await expect(branchPill(reloaded)).toContainText('main');
		await expect(graphWipRow(reloaded, homePath)).toHaveAttribute('data-index', '0', { timeout: 30000 });
	});

	test('reloading the webview while scoped keeps the scope', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		const webview = await openGraph(vscode);
		await expectScopeTint(webview, 'none');
		await expect(branchPill(webview)).toContainText('main');

		await doubleClickWipRow(webview, worktreePath);
		await expectScopeTint(webview, 'whole-bar');
		await expect(unscopeWorktreeButton(webview)).toBeVisible({ timeout: MaxTimeout });
		await expect(branchPill(webview)).toContainText(worktreeBranch);

		// Webview-only reload — the extension host is untouched, so the binding survives on the host
		// side. It's the WEBVIEW's own scope perspective that died with the iframe; re-adoption from the
		// fresh bootstrap state is what has to bring the chrome back, not a host-side rebind.
		const reloaded = await reloadGraphWebview(vscode, webview);
		await ensureGraphRowsRendered(vscode, reloaded, 30000);

		// Chrome and binding must agree, on the WORKTREE this time: scoped tint (top-row — focus is
		// webview-local and does NOT survive), the unscope affordance back, the worktree's branch in
		// the pill, and the worktree's WIP row as the primary row (data-index 0).
		await expectScopeTint(reloaded, 'top-row', 30000);
		await expect(unscopeWorktreeButton(reloaded)).toBeVisible({ timeout: MaxTimeout });
		await expect(branchPill(reloaded)).toContainText(worktreeBranch);
		await expect(graphWipRow(reloaded, worktreePath)).toHaveAttribute('data-index', '0', { timeout: 30000 });
	});
});
