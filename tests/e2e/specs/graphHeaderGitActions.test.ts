/**
 * GitLens Graph — Header git-action buttons E2E Tests
 *
 * Covers the `gl-git-actions-buttons` cluster in the Commit Graph header (toolbar) — the
 * push / pull / publish / fetch / force-push affordances that switch on the current branch's
 * upstream state:
 *  - Fetch: always present, wired to `gitlens.fetch`.
 *  - Publish Branch: shown when the branch has no upstream, wired to `gitlens.publishBranch`.
 *  - Push: shown when the branch is ahead (not behind), wired to `gitlens.graph.push`.
 *  - Pull: shown when the branch is behind, wired to `gitlens.graph.pull`.
 *  - Force Push: shown when the branch has diverged (ahead AND behind), wired to
 *    `gitlens.graph.pushWithForce`.
 *
 * Like graphHeader.test.ts these assert the header→command WIRING (the `command:` link each
 * affordance carries) and its state-gated presence/absence, rather than invoking the commands.
 *
 * The branch states are built with local remote-tracking refs + upstream config (no real remote is
 * contacted) — the established GitFixture pattern for exercising upstream flows offline.
 *
 * NOTE: `gitlens.graph.push` is a substring of `gitlens.graph.pushWithForce`, so Push is matched by
 * the `.is-ahead` anchor (which force-push never carries) rather than by an href substring.
 */
import * as process from 'node:process';
import type { FrameLocator, Locator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

let git: GitFixture;

/** A header action button by its accessible label (light DOM of the graph app). */
function headerButton(webview: FrameLocator, label: string): Locator {
	return webview.locator(`button.action-button[aria-label="${label}"]`).first();
}

/** The always-present Fetch affordance — doubles as a "git-action buttons have rendered" anchor. */
function fetchLink(webview: FrameLocator): Locator {
	return webview.locator('gl-fetch-button a.action-button[aria-label="Fetch"]').first();
}

/** Open the Commit Graph and wait until the header (Create action) has rendered. */
async function openGraph(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	const webview = await vscode.gitlens.commitGraphViewWebview;
	expect(webview).not.toBeNull();
	// The Create action only renders once the graph is allowed + a repo is selected — good readiness
	// signal that the header (and the git-action buttons beside it) is up.
	await expect.poll(() => headerButton(webview!, 'Create').count(), { timeout: 30000 }).toBeGreaterThan(0);
	return webview!;
}

/** Check out a branch on the shared fixture repo, then open the graph on that branch. */
async function openGraphOnBranch(vscode: VSCodeInstance, branch: string): Promise<FrameLocator> {
	await git.checkout(branch);
	const webview = await openGraph(vscode);
	// Anchor on the fetch button so the git-action cluster has actually rendered before any
	// presence/absence assertion runs (avoids a false-negative count-0 on the pre-render gap).
	await expect(fetchLink(webview)).toBeVisible({ timeout: MaxTimeout });
	return webview;
}

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				git = new GitFixture(repoDir);
				await git.init(); // Initial commit
				await git.commit('Second commit', 'a.txt', 'v2\n'); // main tip (no upstream → Publish)

				// A dummy remote so the upstream config is well-formed; it is never contacted.
				await git.addRemote('origin', repoDir);

				// Ahead: one local commit past the upstream ref.
				await git.checkout('feature-ahead', true);
				await git.commit('Ahead commit', 'ahead.txt', 'x\n');
				await git.createRemoteBranch('origin', 'feature-ahead', 'HEAD~1');
				await git.setUpstream('feature-ahead', 'origin/feature-ahead');

				// Behind: upstream ref one commit past the local tip.
				await git.checkout('main');
				await git.checkout('feature-behind', true);
				await git.commit('Behind commit', 'behind.txt', 'y\n');
				await git.createRemoteBranch('origin', 'feature-behind', 'HEAD');
				await git.reset('HEAD~1');
				await git.setUpstream('feature-behind', 'origin/feature-behind');

				// Diverged: upstream has a commit the local tip doesn't, and vice-versa (1 ahead, 1 behind).
				await git.checkout('main');
				await git.checkout('feature-diverged', true);
				await git.commit('Remote-only commit', 'remote.txt', 'r\n');
				await git.createRemoteBranch('origin', 'feature-diverged', 'HEAD');
				await git.reset('HEAD~1');
				await git.commit('Local-only commit', 'local.txt', 'l\n');
				await git.setUpstream('feature-diverged', 'origin/feature-diverged');

				// Deterministic starting branch: main (no upstream → Publish + Fetch).
				await git.checkout('main');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — Header git-action buttons', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('Fetch button is wired to the fetch command', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		const webview = await openGraphOnBranch(vscode, 'main');

		await expect(fetchLink(webview)).toHaveAttribute('href', /command:gitlens\.fetch/);
	});

	test('Publish Branch button is shown (and wired) for an unpublished branch', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		// main has no upstream → unpublished.
		const webview = await openGraphOnBranch(vscode, 'main');

		const publish = webview.locator('gl-publish-button a.action-button[aria-label="Publish Branch"]').first();
		await expect(publish).toBeVisible({ timeout: MaxTimeout });
		await expect(publish).toHaveAttribute('href', /command:gitlens\.publishBranch/);

		// No upstream means neither push nor pull is offered.
		await expect(webview.locator('gl-push-pull-button a.action-button')).toHaveCount(0);
	});

	test('Push button is shown (and wired) when the branch is ahead', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraphOnBranch(vscode, 'feature-ahead');

		const push = webview.locator('gl-push-pull-button a.action-button.is-ahead').first();
		await expect(push).toBeVisible({ timeout: MaxTimeout });
		await expect(push).toHaveAttribute('href', /command:gitlens\.graph\.push/);

		// Ahead-only: no pull, and (upstream present) no publish.
		await expect(webview.locator('gl-push-pull-button a.action-button.is-behind')).toHaveCount(0);
		await expect(webview.locator('gl-publish-button a.action-button')).toHaveCount(0);
	});

	test('Pull button is shown (and wired) when the branch is behind', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraphOnBranch(vscode, 'feature-behind');

		const pull = webview.locator('gl-push-pull-button a.action-button.is-behind').first();
		await expect(pull).toBeVisible({ timeout: MaxTimeout });
		await expect(pull).toHaveAttribute('href', /command:gitlens\.graph\.pull/);

		await expect(webview.locator('gl-push-pull-button a.action-button.is-ahead')).toHaveCount(0);
	});

	test('Force Push button is shown (and wired) when the branch has diverged', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraphOnBranch(vscode, 'feature-diverged');

		// Diverged surfaces Pull as the primary action plus a dedicated Force Push button.
		await expect(webview.locator('gl-push-pull-button a.action-button.is-behind').first()).toBeVisible({
			timeout: MaxTimeout,
		});
		const forcePush = webview.locator('gl-button[aria-label="Force Push"]').first();
		await expect(forcePush).toBeVisible({ timeout: MaxTimeout });
		await expect(forcePush).toHaveAttribute('href', /command:gitlens\.graph\.pushWithForce/);
	});
});
