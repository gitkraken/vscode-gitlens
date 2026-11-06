/**
 * Signed-in worker (#5682): the worker signs in to the GitKraken test account unattended (see
 * `fixtures/gkSignIn.ts`) and the account's cloud integrations come with it.
 *
 * Skips without `GK_E2E_ACCESS_TOKEN_COOKIE` (fails instead when `E2E_REQUIRE_SIGNIN` is set).
 * No traces, videos or screenshots (the account page shows the account), and no retries: a sign-in failure
 * should surface on the first attempt, not be masked by a fresh worker.
 */
import * as process from 'node:process';
import { test as base, canSignIn, expect, requiredIntegrations } from '../baseTest.js';

const test = base.extend({
	vscodeOptions: [{ vscodeVersion: process.env.VSCODE_VERSION ?? 'stable', signIn: true }, { scope: 'worker' }],
});

test.skip(!canSignIn(), 'GK_E2E_ACCESS_TOKEN_COOKIE is not set');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('Signed-in worker', { tag: '@signed-in' }, () => {
	test.describe.configure({ mode: 'serial', retries: 0 });

	test('account page shows the signed-in state', async ({ vscode }) => {
		await vscode.gitlens.executeCommand('gitlens.showSettingsPage!account');
		const settings = await vscode.gitlens.getGitLensWebview('GitLens Settings', 'webviewPanel', 30_000);
		expect(settings, 'GitLens Settings webview found').not.toBeNull();
		// `locator.waitFor` and counts, not locator matchers: a failed matcher puts an ARIA snapshot of its target —
		// here the Account page, with the account's name and e-mail — into Playwright's error-context
		await settings!.getByText('Sign Out', { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
		expect(await settings!.getByText('Sign In', { exact: true }).count(), 'no Sign In').toBe(0);
	});

	// The required set (E2E_REQUIRED_INTEGRATIONS) names the git hosts and, where #5106 needs them, the trackers
	test('required cloud integrations are connected through the account', async ({ vscode }) => {
		await vscode.gitlens.executeCommand('gitlens.showSettingsPage!integrations');
		const settings = await vscode.gitlens.getGitLensWebview('GitLens Settings', 'webviewPanel', 30_000);
		expect(settings, 'GitLens Settings webview found').not.toBeNull();
		for (const name of requiredIntegrations()) {
			const manage = settings!.getByText(`Manage ${name}`, { exact: true }).first();
			const connected = await manage.waitFor({ state: 'attached', timeout: 30_000 }).then(
				() => true,
				() => false,
			);
			expect(connected, `${name} connected`).toBe(true);
		}
	});
});
