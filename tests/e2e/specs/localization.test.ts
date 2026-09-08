/**
 * GitLens Localization E2E Smoke Test
 *
 * Launches VS Code with GitLens in Microsoft's `qps-ploc` pseudo-locale and asserts that a small,
 * fixed set of well-known labels — chosen because they are certainly localized on this branch (see
 * the `l10n/bundle.l10n.json` lookup in `beforeAll` below) — render pseudo-translated, and that
 * their plain-English forms are absent. This is a regression net for the next string that ships
 * unwrapped in an `l10n.t(...)` call, not a coverage audit of GitLens' localization.
 *
 * The expected pseudo text is read from the generated `l10n/bundle.l10n.qps-ploc.json` catalog
 * itself (regenerated in `beforeAll` if missing) rather than re-implemented here, so the test can't
 * drift from whatever `generate:l10n:pseudo` actually produces.
 *
 * Candidates are all runtime `l10n.t(...)` strings (the extension's own `@vscode/l10n` catalog,
 * selected purely by `vscode.env.language` — confirmed live to track `--locale` reliably here).
 * A MANIFEST string (`package.nls.json`, substituted by VS Code itself into `contributes.views` at
 * extension-scan time) was tried first for the Graph webview's title and dropped: even with
 * `vscode.env.language` confirmed `qps-ploc`, that substitution depends on VS Code's own core-NLS/
 * language-pack resolution succeeding end-to-end, which proved unreliable in this harness — so the
 * Graph webview below is identified structurally (a DOM element only the Graph app renders) instead
 * of by its title.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { widenSideBarForGraph } from '../graphHelpers.js';

// Configure vscodeOptions with the qps-ploc pseudo-locale and a minimal test repository.
const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			locale: 'qps-ploc',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Initial commit', 'file.txt', 'content\n');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

/** Repo root — this file lives at `tests/e2e/specs/`, three levels below it. */
const repoRoot = path.resolve(__dirname, '../../..');
const l10nBundlePath = path.join(repoRoot, 'l10n', 'bundle.l10n.json');
const l10nPseudoBundlePath = path.join(repoRoot, 'l10n', 'bundle.l10n.qps-ploc.json');

/**
 * Candidate labels for the regression net, each a literal key verified to exist in
 * `l10n/bundle.l10n.json` in `beforeAll`. The last is rendered with its `{0}` placeholder substituted.
 */
const branchesSidebarPanelKey = 'Branches';
const worktreesSidebarPanelKey = 'Worktrees';
const chooseCommandPlaceholderKey = 'Choose a command';
const chooseSubcommandPlaceholderKey = 'Choose a {0} command';

let english: Record<string, string>;
let pseudo: Record<string, string>;

test.beforeAll(() => {
	if (!existsSync(l10nPseudoBundlePath)) {
		execFileSync('pnpm', ['run', 'generate:l10n:pseudo'], { cwd: repoRoot, stdio: 'inherit' });
	}

	english = JSON.parse(readFileSync(l10nBundlePath, 'utf8')) as Record<string, string>;
	pseudo = JSON.parse(readFileSync(l10nPseudoBundlePath, 'utf8')) as Record<string, string>;

	for (const key of [
		branchesSidebarPanelKey,
		worktreesSidebarPanelKey,
		chooseCommandPlaceholderKey,
		chooseSubcommandPlaceholderKey,
	]) {
		if (!(key in english)) {
			throw new Error(
				`Candidate localization key ${JSON.stringify(key)} is missing from l10n/bundle.l10n.json — ` +
					`pick a different well-known label for this regression net.`,
			);
		}

		if (!(key in pseudo)) {
			throw new Error(
				`Candidate localization key ${JSON.stringify(key)} is missing from the generated ` +
					`l10n/bundle.l10n.qps-ploc.json — the pseudo catalog may be stale; delete it and rerun.`,
			);
		}
	}
});

/** Escapes a literal string for embedding inside a `RegExp` source. */
function escapeForRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a `^...$` pattern from an `l10n.t('...{0}...')`-style template, matching the template's
 * literal text exactly and accepting any (non-empty) substitution for `{0}`. Used for the nested
 * Git wizard placeholder, whose substituted command name is itself pseudo-translated — asserting on
 * the surrounding literal text is what actually verifies the template stayed localized.
 */
function patternFromTemplate(template: string): RegExp {
	const [prefix, suffix] = template.split('{0}');

	return new RegExp(`^${escapeForRegExp(prefix)}.+${escapeForRegExp(suffix)}$`);
}

/** Asserts `actual` is exactly the pseudo form of `key` and not its English form. */
function expectPseudoLocalized(actual: string | null, key: string, label: string): void {
	expect(actual, `${label} was empty`).not.toBeNull();
	expect(actual, `${label} rendered in plain English instead of qps-ploc`).not.toBe(english[key]);
	expect(actual, `${label} did not match the generated qps-ploc catalog entry`).toBe(pseudo[key]);
}

test.describe('Localization — qps-ploc smoke', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ vscode }) => {
		test.skip(!(await vscode.gitlens.hasActivityBar()), 'Editor has no standard activity bar (e.g. Cursor)');
	});

	test('Graph sidebar panel headers render pseudo-translated', async ({ vscode }) => {
		// The Graph is Pro-gated — without a simulated subscription the view renders its Welcome/
		// account-gate content instead, and never mounts the Graph app at all.
		await using _subscription = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		await vscode.gitlens.showCommitGraphView();
		await widenSideBarForGraph(vscode);

		// Find the Graph's own content frame structurally — by a DOM element only the Graph app
		// renders (the sidebar rail's Branches icon) — rather than by the webview's title. The title
		// is a MANIFEST string substituted by VS Code itself, which needs its own core-NLS/language-
		// pack resolution to succeed; that proved unreliable in this harness even with
		// `vscode.env.language` confirmed `qps-ploc` (see file header). Structural lookup sidesteps it
		// entirely, and also doesn't care that another GitLens webviewView (a Welcome view) may be
		// mounted alongside the Graph.
		const outerFrames = vscode.page.locator(
			'iframe.webview[src*="extensionId=eamodio.gitlens"][src*="purpose=webviewView"]',
		);
		await expect.poll(() => outerFrames.count(), { timeout: MaxTimeout }).toBeGreaterThan(0);

		// The outer frame appears before the Graph app has mounted inside it, so poll for the rail icon
		// rather than checking each frame once.
		let graphContent: FrameLocator | undefined;
		await expect
			.poll(
				async () => {
					const count = await outerFrames.count();
					for (let i = 0; i < count; i++) {
						const content = outerFrames.nth(i).contentFrame().locator('iframe#active-frame').contentFrame();
						if ((await content.locator('button[data-roving-key="icon:branches"]').count()) > 0) {
							graphContent = content;
							return true;
						}
					}

					return false;
				},
				{
					message: 'Could not find the Commit Graph webview among the open GitLens webviews',
					timeout: MaxTimeout,
				},
			)
			.toBe(true);

		const panelHeader = graphContent!.locator('.header-title__text').first();

		await graphContent!.locator('button[data-roving-key="icon:branches"]').click();
		await expect(panelHeader).toBeVisible({ timeout: MaxTimeout });
		expectPseudoLocalized(
			(await panelHeader.textContent())?.trim() ?? null,
			branchesSidebarPanelKey,
			'Graph Branches sidebar panel header',
		);

		await graphContent!.locator('button[data-roving-key="icon:worktrees"]').click();
		await expect(panelHeader).toBeVisible({ timeout: MaxTimeout });
		expectPseudoLocalized(
			(await panelHeader.textContent())?.trim() ?? null,
			worktreesSidebarPanelKey,
			'Graph Worktrees sidebar panel header',
		);
	});

	test('Git Commands quick pick renders pseudo-translated placeholders', async ({ vscode }) => {
		await vscode.gitlens.executeCommand('gitlens.gitCommands');
		await vscode.gitlens.quickPick.waitForVisible();

		expectPseudoLocalized(
			await vscode.gitlens.quickPick.getPlaceholder(),
			chooseCommandPlaceholderKey,
			'Git Commands root placeholder',
		);

		// Click the first item by position — deterministic regardless of the pseudo-translated item
		// labels, which typed-text filtering could not fuzzy-match. Any command works: the assertion
		// below is on the template's literal text, not on which command was chosen.
		const rootPlaceholder = await vscode.gitlens.quickPick.getPlaceholder();
		await vscode.gitlens.quickPick.firstResult.click();
		await expect
			.poll(() => vscode.gitlens.quickPick.getPlaceholder(), { timeout: MaxTimeout })
			.not.toBe(rootPlaceholder);

		const subcommandPlaceholder = await vscode.gitlens.quickPick.getPlaceholder();
		expect(subcommandPlaceholder, 'Git Commands subcommand placeholder was empty').not.toBeNull();
		expect(
			subcommandPlaceholder,
			'Git Commands subcommand placeholder rendered in plain English instead of qps-ploc',
		).not.toMatch(patternFromTemplate(english[chooseSubcommandPlaceholderKey]));
		expect(
			subcommandPlaceholder,
			'Git Commands subcommand placeholder did not match the generated qps-ploc template',
		).toMatch(patternFromTemplate(pseudo[chooseSubcommandPlaceholderKey]));

		await vscode.gitlens.quickPick.cancel();
	});
});
