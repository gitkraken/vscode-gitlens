/**
 * Signed-in Launchpad E2E — the connected complement to graphHeader.test.ts's not-connected indicator.
 *
 * `graphHeader.test.ts` asserts the Commit Graph header Launchpad indicator in the NOT-connected state
 * (no integration → the `plug` overlay, the "connect an integration" label, and the welcome blurb in the
 * popover) — all an unattended, signed-out run can reach. This spec needs what #5682 added: a worker that
 * signs in to the GitKraken test account (`fixtures/gkSignIn.ts`), which brings the account's connected
 * cloud integrations with it. With one hosting integration connected, the same indicator must render its
 * CONNECTED state instead:
 *  - the summary element is marked `has-integrations-connected` (the graph's `connected === true`),
 *  - the action button never advertises "connect an integration" (that is the `plug`, `connected === false`),
 *  - the popover drops the not-connected welcome blurb and still wires "Open Launchpad" to gitlens.showLaunchpad.
 *
 * Whether the account currently has any actionable pull requests is network/integration-dependent and out
 * of scope — `connected` is set from the integration states alone (accountLaunchpadController.ts), so these
 * assertions are deterministic without any PR data. Pro is simulated (state 6) for a deterministic gate,
 * exactly as graphHeader.test.ts and mcpGitlensWritePathSignedIn.test.ts do (the test account's own plan
 * drifts over time).
 *
 * Skips without `GK_E2E_ACCESS_TOKEN_COOKIE` (fails instead when `E2E_REQUIRE_SIGNIN` is set). No traces,
 * videos or screenshots (a failure snapshot could carry the account's Launchpad data), and no retries: a
 * retry starts a new worker, and every worker sign-in mints a non-expiring account token.
 */
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, canSignIn, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { widenSideBarForGraph } from '../graphHelpers.js';

/** Open the Commit Graph and wait until the header Launchpad indicator has rendered. */
async function openGraph(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	// Give the header room so its action buttons render (see graphHeader.test.ts / widenSideBarForGraph).
	await widenSideBarForGraph(vscode);

	const webview = await vscode.gitlens.commitGraphViewWebview;
	expect(webview).not.toBeNull();

	// The Launchpad indicator renders as soon as the header is up — good readiness signal.
	await expect
		.poll(() => webview!.locator('.action-button[aria-label^="Launchpad"]').count(), { timeout: 30000 })
		.toBeGreaterThan(0);

	// Start with the Launchpad popover closed: this spec ends with the pointer on the rocket, and a wide
	// side bar leaves it there, so the hover popover would stay open over the next action. The pointer has
	// to leave INSIDE the webview or the popover never sees a mouseout (see graphHeader.test.ts).
	await webview!
		.locator('gl-graph-header')
		.first()
		.hover({ force: true, position: { x: 4, y: 4 } });
	await expect(webview!.locator('gl-graph-launchpad-indicator gl-popover[open]')).toHaveCount(0, {
		timeout: MaxTimeout,
	});
	return webview!;
}

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			signIn: true,
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await git.commit('First commit', 'a.txt', 'v1\n');
				await git.commit('Second commit', 'a.txt', 'v2\n');
				await git.addRemote('origin', 'https://github.com/gitkraken/vscode-gitlens.git');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.skip(!canSignIn(), 'GK_E2E_ACCESS_TOKEN_COOKIE is not set');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('Signed-in Launchpad', { tag: '@signed-in' }, () => {
	test.describe.configure({ mode: 'serial', retries: 0 });

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('Graph Launchpad indicator renders the connected state for a signed-in account', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		const webview = await openGraph(vscode);

		const launchpadButton = webview.locator('.action-button[aria-label^="Launchpad"]').first();
		await expect(launchpadButton).toBeVisible({ timeout: MaxTimeout });

		// The account carries a connected hosting integration, so the indicator resolves to its connected
		// state: the summary element is marked `has-integrations-connected` (`connected === true`). That flag
		// is driven by the integration states alone, independent of whether any PR is actionable, so it is
		// deterministic without network data. Poll — the connection resolves asynchronously after the graph
		// opens (integration states, then the Launchpad refresh).
		await expect
			.poll(
				() =>
					webview
						.locator('gl-graph-launchpad-indicator gl-launchpad-summary[has-integrations-connected]')
						.count(),
				{ timeout: 30000 },
			)
			.toBeGreaterThan(0);

		// And it must never advertise the not-connected ("connect an integration") label (the `plug` state).
		await expect(launchpadButton).not.toHaveAttribute('aria-label', /connect an integration/i);

		// Hover opens the popover (trigger is hover/focus). Connected, it drops the not-connected welcome
		// blurb and still offers the "Open Launchpad" action wired to gitlens.showLaunchpad.
		await launchpadButton.hover();
		await expect(webview.locator('gl-graph-launchpad-indicator gl-popover[open]')).toHaveCount(1, {
			timeout: MaxTimeout,
		});
		await expect(
			webview
				.locator('gl-graph-launchpad-indicator [slot="content"] [href*="command:gitlens.showLaunchpad"]')
				.first(),
		).toBeVisible({ timeout: MaxTimeout });
		// The welcome blurb renders only when NOT connected.
		await expect(webview.locator('gl-graph-launchpad-indicator .welcome')).toHaveCount(0);
	});
});
