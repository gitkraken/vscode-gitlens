/**
 * Kepler — the install gate and the menu contribution (#5760)
 *
 * What this spec does NOT own as a contract: which rows the "Kepler isn't installed" prompt offers per
 * intent, which telemetry it reports, and what each row runs —
 * `src/plus/kepler/__tests__/keplerTask.test.ts` holds that against a stubbed quick pick.
 *
 * What it owns is the wiring those stubs stand in for: that `gitlens.kepler.newTask` is registered in
 * the packaged extension and runs without arguments, that `KeplerService` resolved `installed` from a
 * real filesystem probe at activation, and that the refusal reaches the user as an actual quick pick
 * offering Install Kepler and Learn More — not as a silently swallowed no-op. The copy is used as
 * locators: matching any quick pick would pass for someone else's.
 *
 * `new-task` is the only Kepler entry point reachable here: every `start-review` path needs a pull
 * request, and the harness connects no hosting integration.
 *
 * Preconditions, asserted rather than assumed: desktop and local (a remote window can't tell whether
 * Kepler is installed and skips the gate), and no Kepler on this machine — checked against the paths
 * the product checks, so the run can't take the installed branch and still go green. An installed
 * Kepler is normal on a developer machine (skip) and a misconfiguration on a runner (fail).
 *
 * No row is picked: Install Kepler would download Kepler, and Learn More opens an https page, which
 * VS Code refuses in test mode (`DialogService: refused to show dialog in tests`).
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

/** Copy owned by `src/plus/kepler/keplerNotInstalled.ts`, used to identify the prompt rather than to assert it. */
const refusalHeader = "Kepler isn't installed";
const refusalActions = ['Install Kepler', 'Learn More'];
/** Menu title owned by `contributions.json`, which also titles the prompt for this intent. */
const newTaskMenuItem = 'Start Task in Kepler';

/**
 * Where the product itself looks (`src/env/node/kepler/keplerInstall.ts`), resolved for this machine.
 *
 * Imported from `src/` rather than restated here, which makes this the suite's first runtime import of
 * extension code (`gitLensPage.ts` takes a type, which compiles away). The point is drift: a copied
 * path list keeps passing after the product changes its channel, product name or layout, and a
 * precondition that silently stops matching the product is worse than no precondition — the spec would
 * take the installed branch and still report green. `keplerProviders.ts` imports only types and the
 * dependency-free `keplerRelease.ts`, so pulling it in costs the test process no extension runtime.
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

	// Visible items only: since VS Code 1.144 the context view also holds four zero-size items ("Ask in a Side
	// Chat", "Quote", a separator, "Copy") ahead of the row's own, so its first item is never visible.
	const items = page.locator('.context-view .action-item').filter({ visible: true });
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

	// The prompt is modal to the editor instance, which is worker-scoped: left open, it would swallow the
	// next spec's first keystrokes.
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.quickPick.cancel();
	});

	test('new task offers to install Kepler or learn more', async ({ vscode }) => {
		const quickPick = vscode.gitlens.quickPick;
		// The command settles only once the prompt closes, so it is awaited after dismissing it
		const command = vscode.gitlens.executeCommand('gitlens.kepler.newTask');

		await quickPick.waitForTitle(newTaskMenuItem);
		await expect(quickPick.locator).toContainText(refusalHeader);
		for (const action of refusalActions) {
			await quickPick.getVisibleItem(action);
		}

		await quickPick.cancel();
		await command;
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
