/**
 * Kepler — the install gate and the menu contribution (#5760)
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
import { basename, resolve } from 'node:path';
import * as process from 'node:process';
import type { Locator, Page } from '@playwright/test';
import { getKeplerInstallPaths, getKeplerProductName } from '../../../src/plus/kepler/keplerProviders.js';
import { expect, MaxTimeout, test } from '../baseTest.js';

/** The gate reads the `production` channel here: the override needs a pre-release or Development host. */
const channel = 'production';

/**
 * Copy owned by `src/plus/kepler/keplerTask.ts:122`, used here to identify the surface rather than to
 * assert it. Named so the coupling is visible in code: reword the product strings and these move too.
 */
const refusalMessage = "Kepler isn't installed";
/** Menu title owned by `contributions.json`; a locator for the same reason the strings above are. */
const newTaskMenuItem = 'Start Task in Kepler';
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

/**
 * Opens a tree row's context menu, reads its items and closes it again.
 *
 * Keyboard rather than a right click: `Shift+F10` targets the focused row, so the menu cannot land on
 * a neighbour when the list scrolls between the click and the press. The menu is closed here rather
 * than by the caller, because an assertion failing mid-test would otherwise leave it open for the next
 * one.
 */
async function readRowMenu(page: Page, row: Locator): Promise<string[]> {
	await row.click();
	await page.keyboard.press('Shift+F10');

	const items = page.locator('.context-view .action-item');
	await expect(items.first()).toBeVisible({ timeout: MaxTimeout });
	const texts = (await items.allInnerTexts()).map(t => t.trim()).filter(Boolean);

	await page.keyboard.press('Escape');
	await expect(items.first()).toBeHidden({ timeout: MaxTimeout });

	return texts;
}

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

/**
 * The menu contribution, which is the half no unit can reach: `gitlens.kepler.newTask` is hidden from
 * the command palette (`when: false`), so a context menu is the only way a user arrives at it, and
 * whether it appears there is decided by a `when` clause in `contributions.json`
 * (`viewItem =~ /gitlens:(repository|repo-folder)\b/`) that no TypeScript test evaluates.
 *
 * Both directions are asserted on purpose. Presence alone would still pass if the clause were widened
 * to every node, and a stray "Start Task in Kepler" on a branch or a commit is exactly the regression a
 * loosened regex produces — so a non-repository node is checked to NOT carry it.
 *
 * Install state does not matter here and is not guarded: the clause decides what the menu lists, while
 * `installed` only decides what happens after the click, which the gate spec above owns.
 */
test.describe('Kepler — menu contribution', () => {
	// `readRowMenu` closes what it opens, so this only covers the one path it cannot: an assertion
	// inside the helper failing between the open and the close. A menu left standing there would
	// swallow the first click of whatever runs next in this worker's editor.
	test.afterEach(async ({ vscode }) => {
		await vscode.page.keyboard.press('Escape');
	});

	test('the repository node offers Start Task in Kepler and a child node does not', async ({ vscode }) => {
		await vscode.gitlens.showRepositoriesView();

		// The SCM views are grouped under one tree, so it is named after the group rather than after the
		// view the command just brought forward.
		const items = vscode.gitlens.gitlensViewTreeView.getByRole('treeitem');

		// The child goes first on purpose: selecting a row toggles its expansion, so reading the
		// repository's menu collapses it and takes every child row off screen with it.
		//
		// `Commits` is a child of the repository node, so it carries a different `viewItem` and must not
		// offer the command — the assertion that pins the clause rather than its presence.
		const childRow = items.filter({ hasText: 'Commits' }).first();
		await expect(childRow).toBeVisible({ timeout: MaxTimeout });

		expect(await readRowMenu(vscode.page, childRow)).not.toContain(newTaskMenuItem);

		const repoRow = items.filter({ hasText: basename(resolve(vscode.electron.workspacePath)) }).first();
		await expect(repoRow).toBeVisible({ timeout: MaxTimeout });

		expect(await readRowMenu(vscode.page, repoRow)).toContain(newTaskMenuItem);
	});
});
