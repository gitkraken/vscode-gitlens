/**
 * GitLens Graph — worktree scope on a COLD open
 *
 * Its own spec file, and its own editor instance, because "cold" is the whole point: once the graph
 * has been opened its session is up and the scope request lands on a ready webview — the path this
 * covers is the one where the request arrives before a session exists and has to be retried. A
 * stranded tint or a silently dropped request would both look like "nothing happened", so the
 * assertion is the end state: the graph is open AND scoped.
 *
 * Drives the exact payload `showWorktreeInGraph` dispatches (`src/plus/graph/worktreeActions.ts`) —
 * the one shape behind both "Focus in Commit Graph" commands (the terminal editor's and the agent
 * tab's), neither of which can be summoned here without a live terminal or agent session.
 */
import * as path from 'node:path';
import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { ensureGraphRowsRendered } from '../graphHelpers.js';
import { branchPill, expectScopeTint, unscopeWorktreeButton } from '../graphScopeHelpers.js';

/** The all-zeroes `uncommitted` revision — what the show-wip payload targets. */
const uncommitted = '0000000000000000000000000000000000000000';

const worktreeBranch = 'wt-feature';
let worktreePath: string;

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const home = new GitFixture(repoDir);
				await home.init();
				await home.commit('Base commit', 'base.txt', 'base\n', { date: '2024-01-01T00:00:00Z' });
				await home.branch(worktreeBranch);
				await home.commit('Main only commit', 'main-only.txt', 'main\n', { date: '2024-01-02T00:00:00Z' });

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

test.describe('Graph — worktree scope on a cold open', () => {
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('Focus in Commit Graph opens the graph and lands scoped on the worktree', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		// No `showCommitGraphView` first — the request itself has to open the graph.
		await vscode.gitlens.executeCommand('gitlens.showGraph', {
			action: 'show-wip',
			target: { sha: uncommitted, worktreePath: worktreePath },
			revealOnly: true,
			scopeBranch: { branchName: worktreeBranch },
			scopeOrigin: { kind: 'worktree', path: worktreePath },
			source: { source: 'graph' },
		});

		const webview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(webview).not.toBeNull();
		await ensureGraphRowsRendered(vscode, webview!, 30000);

		// The retry path's whole job: the request survives the not-ready window and still applies. The
		// branch FOCUS half of the same gesture lands either way — it never goes through the host — so
		// the perspective is what separates "it worked" from "half of it worked", and it's asserted first.
		await expectScopeTint(webview!, 'whole-bar');
		await expect(unscopeWorktreeButton(webview!)).toBeVisible({ timeout: MaxTimeout });
		await expect(branchPill(webview!)).toContainText(worktreeBranch);
	});
});
