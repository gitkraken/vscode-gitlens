/**
 * Kepler — the install gate (#5760)
 *
 * What this spec does NOT own as a contract: that the refusal carries exactly one action, which
 * telemetry reason it reports, and what choosing the action runs.
 * `src/plus/kepler/__tests__/keplerTask.test.ts:192` and `:210` hold all of that against a stubbed
 * `window.showWarningMessage` and an injected install probe.
 *
 * It does, unavoidably, depend on the copy: the message and the action label are the only thing that
 * tells this notification apart from any other warning toast, so they are used as locators and a
 * reworded string lands here too. Matching a generic warning instead would make the spec pass for
 * someone else's notification, which is worse than a rename touching two files.
 *
 * What it owns is the wiring those stubs stand in for: that `gitlens.kepler.newTask` is registered in
 * the packaged extension and runs without arguments, that `KeplerService` resolved `installed` from a
 * real filesystem probe at activation, and that the refusal reaches the user as an actual VS Code
 * notification carrying an actual action — not as a silently swallowed no-op.
 *
 * `new-task` is the only Kepler entry point reachable here: it needs nothing but an optional repo path
 * (`src/commands/kepler.ts:84-89`), while every `start-review` path needs a pull request, and the
 * harness connects no hosting integration.
 *
 * Preconditions, asserted rather than assumed (`src/plus/kepler/keplerTask.ts:111-124`):
 * - `available` — true off the web, which a desktop run always is.
 * - not remote — `installed` would be `undefined` and the gate would be skipped
 *   (`src/plus/kepler/keplerService.ts:51`); the harness launches a local Electron.
 * - `installed === false` — the probe must find no Kepler on this machine. That one is a property of
 *   the machine, not of the harness, so this spec checks the same paths the product checks rather than
 *   letting the run take a different branch and still go green. Having Kepler installed is a legitimate
 *   state for a developer's machine and a misconfiguration on a runner, so it skips with a reason
 *   locally and fails in CI.
 *
 * The action is deliberately NOT clicked: it opens an https product page, and VS Code refuses
 * external-website dialogs in test mode (`DialogService: refused to show dialog in tests`, measured
 * 2026-10-05), so clicking would fail the run instead of proving anything.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as process from 'node:process';
import { getKeplerInstallPaths, getKeplerProductName } from '../../../src/plus/kepler/keplerProviders.js';
import { expect, MaxTimeout, test } from '../baseTest.js';

/** The gate reads the `production` channel here: the override needs a pre-release or Development host. */
const channel = 'production';

/**
 * Copy owned by `src/plus/kepler/keplerTask.ts:122`, used here to identify the surface rather than to
 * assert it. Named so the coupling is visible in code: reword the product strings and these move too.
 */
const refusalMessage = "Kepler isn't installed";
const refusalAction = 'Get Kepler';

/**
 * Where the product itself looks (`src/env/node/kepler/keplerInstall.ts`), resolved for this machine.
 *
 * Imported from `src/` rather than restated here, which makes this the suite's first runtime import of
 * extension code (`gitLensPage.ts` takes a type, which compiles away). The point is drift: a copied
 * path list keeps passing after the product changes its channel, product name or layout, and a
 * precondition that silently stops matching the product is worse than no precondition — the spec would
 * take the installed branch and still report green. `keplerProviders.ts` imports nothing but types, so
 * pulling it in costs the test process no extension runtime.
 */
const installPaths = getKeplerInstallPaths(channel, process.platform, {
	home: homedir(),
	localAppData: process.env.LOCALAPPDATA,
});

const installedAt = installPaths.filter(p => existsSync(p));
const unreachable = `${getKeplerProductName(channel)} is installed on this machine (${installedAt.join(', ')}), so the not-installed gate is unreachable and this spec would pass without exercising it`;

test.describe('Kepler — install gate', () => {
	// Skipped rather than failed off CI: an installed Kepler is a normal developer machine, and a suite
	// that goes red for it teaches people to ignore it. On a runner the environment is ours, so the
	// same state is a misconfiguration and has to fail — silently skipping there would retire the
	// coverage without anyone noticing.
	test.skip(installedAt.length > 0 && !process.env.CI, unreachable);

	test.beforeAll(() => {
		expect(installedAt, unreachable).toEqual([]);
	});

	// Before: a toast left over from an earlier spec in this worker would satisfy the assertion below
	// without this command having produced anything. After: the editor instance is worker-scoped, so a
	// toast left standing here would be the next spec's inherited state.
	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.executeCommandIfAvailable('notifications.clearAll');
	});

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.executeCommandIfAvailable('notifications.clearAll');
	});

	test('new task refuses with a notification offering to get Kepler', async ({ vscode }) => {
		await vscode.gitlens.executeCommand('gitlens.kepler.newTask');

		const toast = vscode.page
			.locator('.notifications-toasts .notification-list-item')
			.filter({ hasText: refusalMessage });
		await expect(toast).toBeVisible({ timeout: MaxTimeout });
		await expect(toast.locator('.monaco-button', { hasText: refusalAction })).toBeVisible();
	});
});
