/**
 * Signed-in worker (#5682): the worker signs in to the GitKraken test account unattended (see
 * `fixtures/gkSignIn.ts`) and the account's cloud integrations come with it.
 *
 * Skips without `GK_E2E_ACCESS_TOKEN_COOKIE` (fails instead when `E2E_REQUIRE_SIGNIN` is set).
 * No traces, videos or screenshots (the account page shows the account), and no retries: a retry starts a new
 * worker, and every worker sign-in mints a non-expiring account token.
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
		await expect(settings!.getByText('Sign Out', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
		await expect(settings!.getByText('Sign In', { exact: true })).toHaveCount(0);
	});

	// The required set (E2E_REQUIRED_INTEGRATIONS) names the git hosts and, where #5106 needs them, the trackers
	test('required cloud integrations are connected through the account', async ({ vscode }) => {
		await vscode.gitlens.executeCommand('gitlens.showSettingsPage!integrations');
		const settings = await vscode.gitlens.getGitLensWebview('GitLens Settings', 'webviewPanel', 30_000);
		expect(settings, 'GitLens Settings webview found').not.toBeNull();
		for (const name of requiredIntegrations()) {
			await expect(
				settings!.getByText(`Manage ${name}`, { exact: true }).first(),
				`${name} connected`,
			).toBeAttached({
				timeout: 30_000,
			});
		}
	});
});
