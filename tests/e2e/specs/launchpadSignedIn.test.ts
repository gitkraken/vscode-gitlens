/**
 * Launchpad on a signed-in worker (#5682): what an unattended run could only see disconnected before — the
 * Launchpad quick pick, the Launchpad view, the status bar item and the Commit Graph header indicator, filled
 * from the test account's connected GitHub integration.
 *
 * The account's Launchpad holds every PR the bound GitHub account is involved in, across repositories, and that
 * list changes on its own. So nothing here asserts counts, order or other PRs: the quick pick and view checks follow
 * one known PR, `E2E_GITHUB_PR_URL` (the same PR the MCP Start Review spec uses), and the summaries are only checked
 * for their connected state. That PR is kept open, non-draft, without reviewers, failing checks or conflicts, which
 * Launchpad files under Blocked ("Unassigned Reviewers"); assigning a reviewer would move it and fail these tests.
 *
 * Read-only: no item action is run (no pin, snooze, merge, reviewer assignment or checkout) — the PR step is
 * only opened and dismissed. Another integration on the account may fail to load; Launchpad then shows a
 * partial-failure row next to the items, which the tests leave alone.
 *
 * Plan: Launchpad is Pro, and the account's own plan changes over time, so the tests run under a simulated Pro
 * subscription (`gitlens.plus.simulate.subscription`, present in `bundle:e2e`). The status bar check relies on the
 * default `gitlens.launchpad.indicator.*` settings of a fresh profile.
 *
 * Skips without `GK_E2E_ACCESS_TOKEN_COOKIE` or `E2E_GITHUB_PR_URL` (fails instead under `E2E_REQUIRE_SIGNIN`).
 * No traces, videos or screenshots, and no retries (see `signIn.test.ts`). Assertion messages carry only the public
 * PR reference and fixed words, never the account's items — but the `error-context.md` of a failed test can snapshot
 * the open quick pick or view, with other PRs' titles and authors, so keep signed-in results unshared.
 */
import * as process from 'node:process';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, canSignIn, createTmpDir, expect, GitFixture } from '../baseTest.js';
import { widenSideBarForGraph } from '../graphHelpers.js';

const prUrl = process.env.E2E_GITHUB_PR_URL;
// `https://github.com/<owner>/<repo>/pull/<n>` → `<owner>/<repo>#<n>`, the reference Launchpad shows for it
const prRef = (() => {
	const match = prUrl == null ? null : /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(prUrl);
	return match == null ? undefined : `${match[1]}#${match[2]}`;
})();
// The reference not followed by another digit: `#1` must not match `#10`
const prRefPattern = prRef == null ? undefined : new RegExp(`${prRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`);

if (prRef == null && process.env.E2E_REQUIRE_SIGNIN) {
	throw new Error('E2E_GITHUB_PR_URL is required (E2E_REQUIRE_SIGNIN) but not set to a GitHub PR URL');
}

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			signIn: { requiredIntegrations: ['GitHub'] },
			// The Commit Graph needs a repository to render its header
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Initial commit', 'a.txt', 'a\n');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.skip(!canSignIn(), 'GK_E2E_ACCESS_TOKEN_COOKIE is not set');
test.skip(prRef == null, 'E2E_GITHUB_PR_URL is not set to a GitHub PR URL');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const quickPickRows = '.quick-input-widget .monaco-list-row';
// The first items arrive once every connected integration has answered (~11 s measured on staging)
const itemsTimeout = 90_000;

/** The accessible labels of the quick pick rows currently rendered (the list renders only the rows in view). */
function readQuickPickRows(vscode: VSCodeInstance): Promise<string[]> {
	return vscode.page
		.locator(quickPickRows)
		.evaluateAll(els =>
			els.map(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ')),
		);
}

/** Opens the Launchpad quick pick and narrows it to the test PR; resolves with that PR's row label. */
async function filterLaunchpadToPr(vscode: VSCodeInstance): Promise<string | undefined> {
	const quickPick = vscode.gitlens.quickPick;
	await vscode.gitlens.executeCommand('gitlens.showLaunchpad');
	await quickPick.waitForVisible(30_000);
	// The loading row carries no PR reference: wait for the first PR row before filtering
	await vscode.page
		.locator(quickPickRows)
		.filter({ hasText: /\w+\/[\w.-]+#\d+/ })
		.first()
		.waitFor({ state: 'visible', timeout: itemsTimeout });
	await quickPick.enterText(prRef!);

	let row: string | undefined;
	await expect
		.poll(
			async () => {
				row = (await readQuickPickRows(vscode)).find(label => prRefPattern!.test(label));
				return row != null;
			},
			{ message: `${prRef} listed in Launchpad`, timeout: 15_000 },
		)
		.toBe(true);
	return row;
}

test.describe('Launchpad on a signed-in worker', { tag: '@signed-in' }, () => {
	test.describe.configure({ mode: 'serial', retries: 0 });

	test.beforeAll(async ({ vscode }) => {
		const simulation = await vscode.gitlens.startSubscriptionSimulation();
		expect(simulation.success, 'Pro subscription simulated').toBe(true);
	});

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.stopSubscriptionSimulation().catch(() => {});
	});

	test.afterEach(async ({ vscode }) => {
		// Leave no Launchpad step open for the next test
		await vscode.gitlens.quickPick.cancel();
		await vscode.gitlens.quickPick.waitForHidden(5_000);
	});

	test('quick pick lists the test PR as blocked on unassigned reviewers', async ({ vscode }) => {
		const row = await filterLaunchpadToPr(vscode);
		expect(row?.includes('Unassigned Reviewers'), `${prRef} row names its Blocked reason`).toBe(true);
	});

	test('selecting the test PR opens its step with the PR actions', async ({ vscode }) => {
		await filterLaunchpadToPr(vscode);
		const quickPick = vscode.gitlens.quickPick;
		// Avoid the row's buttons and tooltip by clicking its top-left corner (as `quickPick.selectItem` does)
		await vscode.page
			.locator(quickPickRows)
			.filter({ hasText: prRefPattern, visible: true })
			.first()
			.click({ position: { x: 1, y: 1 } });
		await quickPick.waitForTitle(`Launchpad • Pull Request ${prRef}`, 30_000);

		// The step can be taller than the list, which renders only the rows in view: walk the active item down the
		// list (arrow keys only move it, nothing runs) and collect the rows as they render
		const expected = [
			'No reviewers have been assigned',
			'Open in Worktree',
			'Switch to Branch',
			'Open in Commit Graph',
		];
		const seen = new Set<string>();
		for (let i = 0; i < 20; i++) {
			for (const label of await readQuickPickRows(vscode)) {
				seen.add(label);
			}
			if (expected.every(e => [...seen].some(label => label.includes(e)))) break;

			await vscode.page.keyboard.press('ArrowDown');
		}
		for (const e of expected) {
			expect(
				[...seen].some(label => label.includes(e)),
				`PR step offers "${e}"`,
			).toBe(true);
		}
		// Dismissed without running any of them (afterEach)
	});

	test('Launchpad view files the test PR under Blocked', async ({ vscode }) => {
		await vscode.gitlens.executeCommand('gitlens.showLaunchpadView');
		const tree = vscode.gitlens.launchpadViewTreeView;
		const groups = tree.locator('[role="treeitem"][aria-level="1"]');
		const blocked = groups.filter({ hasText: /^Blocked/ }).first();
		await blocked.waitFor({ state: 'visible', timeout: itemsTimeout });

		// The tree renders only the rows in view, and Blocked alone can hold dozens of the account's PRs. With every
		// other group collapsed, any PR row is one of Blocked's, so the test PR is looked for by scrolling, not by its
		// position under a group header that may already be out of view. Every group is collapsed first, Blocked
		// included: an expanded group pushes the headers below it out of the rendered rows, where they can't be seen
		// (or collapsed). The handful of headers alone all fit.
		const expanded = groups.and(tree.locator('[aria-expanded="true"]'));
		// Bounded: a row whose click doesn't collapse it must not spin until the test times out
		for (let i = 0; i < 10; i++) {
			const count = await expanded.count();
			if (count === 0) break;

			await expanded.first().click();
			// Wait for the collapse to render, so the next round doesn't click the same row open again
			await expect
				.poll(() => expanded.count(), { message: 'group collapsed', timeout: 10_000 })
				.toBeLessThan(count);
		}
		expect(await expanded.count(), 'every group collapsed').toBe(0);
		await blocked.click();
		await expect
			.poll(() => blocked.getAttribute('aria-expanded'), { message: 'Blocked expanded', timeout: 10_000 })
			.toBe('true');

		const prRow = tree.locator(`[role="treeitem"][aria-level="2"][aria-label*="${prRef}"]`);
		// Scroll by less than the tree's height, or rows between two steps are never rendered
		const step = Math.max(22, Math.floor((await tree.evaluate(el => (el as HTMLElement).clientHeight)) / 2));
		await tree.hover();
		await expect
			.poll(
				async () => {
					if ((await prRow.count()) > 0) return true;

					await vscode.page.mouse.wheel(0, step);
					return false;
				},
				{ message: `${prRef} listed under Blocked in the Launchpad view`, timeout: 30_000 },
			)
			.toBe(true);
		// Still the only group open when the PR was found: a refresh restores the groups' stored expansion
		expect(await expanded.count(), 'only Blocked expanded').toBe(1);
		expect(await blocked.getAttribute('aria-expanded'), 'Blocked still expanded').toBe('true');
	});

	test('status bar item and Commit Graph indicator summarize the connected Launchpad', async ({ vscode }) => {
		// The status bar names only the top-priority PR, which may be any of the account's: connected and loaded means
		// it names one (disconnected, loading, failed and idle show none). Reduced to fixed words, so a failure never
		// prints the account's PR or counts.
		await expect
			.poll(
				async () => {
					const label = (await vscode.gitlens.launchpadStatusBarItem.getAttribute('aria-label')) ?? '';
					return /\S+#\d+ /.test(label) ? 'names a PR' : 'names no PR';
				},
				{ message: 'Launchpad status bar item', timeout: itemsTimeout },
			)
			.toBe('names a PR');

		// The indicator counts the account's PRs by group: connected and loaded means counts, and the test PR (filed
		// under Blocked by the tests above) makes "blocked" one of them
		await vscode.gitlens.showCommitGraphView();
		await widenSideBarForGraph(vscode);
		const webview = await vscode.gitlens.commitGraphViewWebview;
		expect(webview, 'Commit Graph webview found').not.toBeNull();
		const indicator = webview!.locator('.action-button[aria-label^="Launchpad"]').first();
		await indicator.waitFor({ state: 'attached', timeout: 30_000 });
		await expect
			.poll(async () => (await indicator.getAttribute('aria-label')) ?? '', {
				message: 'Commit Graph Launchpad indicator counts blocked PRs',
				timeout: itemsTimeout,
			})
			.toMatch(/^Launchpad — .*\d+ pull requests? (?:is|are) blocked/);
	});
});
