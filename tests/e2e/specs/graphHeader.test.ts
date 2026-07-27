/**
 * GitLens Graph — Header menus E2E Tests
 *
 * Covers the deterministic surfaces of the Commit Graph header (toolbar):
 *  - Create menu: Create Branch / Create Worktree / Apply-Pop Stash, wired to their commands.
 *  - Start New menu: Start Work on an Issue / Start Review on a PR.
 *  - Launchpad indicator: the rocket button, its not-connected state, and the "Open Launchpad"
 *    action.
 *  - Commit-signing indicator in the WIP details (gated on repo commit.gpgsign).
 *  - Pro feature badge absence — the badge was removed from the header (the Start New menu
 *    occupies that area), so it must never render regardless of subscription state.
 *
 * These assert on the header→command WIRING (the command: links the menu items carry) rather than
 * invoking the commands, which would open quick-pick wizards — those flows are covered separately
 * (quickWizard.test.ts). Launchpad PR data (network/integration-dependent) and the
 * push/pull/publish/fetch action buttons are intentionally out of scope.
 */
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout, ShortTimeout } from '../baseTest.js';

let git: GitFixture;

/** A header action button by its accessible label (light DOM of the graph app). */
function headerButton(webview: FrameLocator, label: string) {
	return webview.locator(`button.action-button[aria-label="${label}"]`).first();
}

/** An element carrying a `command:<id>` link (menu items / action links; shadow DOM pierced). */
function commandLink(webview: FrameLocator, commandId: string) {
	return webview.locator(`[href*="command:${commandId}"]`).first();
}

/** Open the Commit Graph and wait until the header (Create action) has rendered. */
async function openGraph(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	const webview = await vscode.gitlens.commitGraphViewWebview;
	expect(webview).not.toBeNull();
	// The Create action only renders once the graph is allowed + a repo is selected — good readiness
	// signal that the header is up.
	await expect.poll(() => headerButton(webview!, 'Create').count(), { timeout: 30000 }).toBeGreaterThan(0);
	return webview!;
}

/**
 * Open a header dropdown (a `click focus`-triggered gl-popover) and keep it open. Re-issues the
 * click only while the popover is still closed, so an initial click swallowed during a layout
 * reflow retries without toggling an already-open menu shut. Bounded by the existing MaxTimeout.
 */
async function openHeaderMenu(webview: FrameLocator, label: string, commandInside: string): Promise<void> {
	const button = headerButton(webview, label);
	const popover = webview.locator(`gl-popover:has([href*="command:${commandInside}"])`);
	const item = commandLink(webview, commandInside);
	await expect(async () => {
		if ((await popover.getAttribute('open')) == null) {
			await button.click();
		}
		await expect(item).toBeVisible({ timeout: ShortTimeout });
	}).toPass({ timeout: MaxTimeout });
}

/** Ensure the graph's details panel is expanded (it may start collapsed). */
async function ensureDetailsPanelOpen(webview: FrameLocator): Promise<void> {
	const toggle = webview.locator('gl-button[aria-label$="Details Panel"]').first();
	await expect(toggle).toBeVisible({ timeout: MaxTimeout });
	if ((await toggle.getAttribute('aria-label')) === 'Show Details Panel') {
		await toggle.click();
		await expect(webview.locator('gl-button[aria-label="Hide Details Panel"]').first()).toBeVisible({
			timeout: MaxTimeout,
		});
	}
}

/** Select the WIP row and wait for its details (which host the commit box + signing indicator). */
async function selectWipDetails(webview: FrameLocator): Promise<void> {
	await ensureDetailsPanelOpen(webview);
	const wipRow = webview
		.getByText(/Working (Changes|Tree)/)
		.filter({ visible: true })
		.first();
	await expect(wipRow).toBeVisible({ timeout: MaxTimeout });
	await wipRow.click();
	await ensureDetailsPanelOpen(webview);
	await expect(webview.locator('gl-details-wip-panel').first()).toBeVisible({
		timeout: 30000,
	});
}

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				git = new GitFixture(repoDir);
				await git.init();

				await git.commit('First commit', 'a.txt', 'v1\n');
				await git.commit('Second commit', 'a.txt', 'v2\n');
				await git.checkout('feature', true);
				await git.commit('Feature commit', 'b.txt', 'f\n');
				await git.checkout('main');

				// Enable commit signing AFTER committing (signing at commit time fails without a gpg
				// key). The WIP signing indicator only reads the config for future commits.
				await git.config('commit.gpgsign', 'true');
				// Leave an unstaged change so the WIP row renders.
				await git.createFile('a.txt', 'v2\nwip\n');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — Header menus', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('Create menu wires branch / worktree / stash commands', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* Paid */,
			planId: 'pro',
		});

		const webview = await openGraph(vscode);

		const createButton = headerButton(webview, 'Create');
		await expect(createButton).toHaveAttribute('aria-haspopup', 'true');
		await openHeaderMenu(webview, 'Create', 'gitlens.git.branch');

		await expect(commandLink(webview, 'gitlens.views.createWorktree')).toBeVisible();
		await expect(commandLink(webview, 'gitlens.stashesApply')).toBeVisible();
	});

	test('Start New menu wires start-work / start-review commands', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6,
			planId: 'pro',
		});

		const webview = await openGraph(vscode);

		const startButton = headerButton(webview, 'Start New');
		await expect(startButton).toHaveAttribute('aria-haspopup', 'true');
		await openHeaderMenu(webview, 'Start New', 'gitlens.startWork');

		await expect(commandLink(webview, 'gitlens.startReview')).toBeVisible();
	});

	test('Launchpad indicator shows the not-connected state and Open Launchpad action', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6,
			planId: 'pro',
		});

		const webview = await openGraph(vscode);

		// No integration is connected in the test environment, so the indicator advertises that.
		// The indicator's anchor is an <a href> (click opens Launchpad directly), not a <button>.
		const launchpadButton = webview.locator('.action-button[aria-label^="Launchpad"]').first();
		await expect(launchpadButton).toBeVisible({ timeout: MaxTimeout });
		await expect(launchpadButton).toHaveAttribute('aria-label', /connect an integration/i);

		// Hover opens the popover (trigger is hover/focus) exposing the Open Launchpad action.
		await launchpadButton.hover();
		await expect(commandLink(webview, 'gitlens.showLaunchpad')).toBeVisible({
			timeout: MaxTimeout,
		});
	});

	test('Pro feature badge is not shown in the header, even for a non-paid (trial) subscription', async ({
		vscode,
	}) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 3 /* Trial */,
		});

		const webview = await openGraph(vscode);

		// The Start New menu takes the badge's place in the header
		await expect(webview.locator('button[aria-label="Start New"]').first()).toBeVisible({
			timeout: MaxTimeout,
		});
		await expect(webview.locator('.titlebar gl-feature-badge')).toHaveCount(0);
	});

	test('WIP details show the commit-signing indicator when signing is enabled', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6,
			planId: 'pro',
		});

		const webview = await openGraph(vscode);
		await selectWipDetails(webview);

		const indicator = webview.locator('.signing-indicator').first();
		await expect(indicator).toBeVisible({ timeout: MaxTimeout });
		await expect(indicator).toHaveAttribute('aria-label', /Commits will be signed using/i);
	});

	// Runs last: disabling commit.gpgsign mutates the shared repo, so no later test may depend on
	// signing being on (serial mode guarantees ordering).
	test('WIP details omit the signing indicator when signing is disabled', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6,
			planId: 'pro',
		});

		await git.config('commit.gpgsign', 'false');
		await vscode.gitlens.executeCommand('gitlens.views.graph.refresh');

		const webview = await openGraph(vscode);
		await selectWipDetails(webview);

		// Anchor on the commit box rendering first: the signing indicator (and its host box) render
		// asynchronously after the WIP panel appears, so a bare count-0 poll would pass instantly on
		// the pre-render gap — before the disabled config could ever matter. Once the box is up, the
		// prior test's indicator is still shown from the cached (enabled) signing config until the
		// external `.git/config` edit propagates (repo watcher: `config` → git-cache reset → WIP
		// re-push), so poll until it actually clears. The generous timeout absorbs the watcher latency.
		await expect(webview.locator('gl-commit-box').first()).toBeVisible({ timeout: MaxTimeout });
		await expect
			.poll(() => webview.locator('.signing-indicator').count(), {
				timeout: 30000,
			})
			.toBe(0);
	});
});
