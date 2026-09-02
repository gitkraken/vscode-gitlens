/**
 * GitLens Graph — worktree Scope / branch Focus E2E tests
 *
 * Scope and Focus are two INDEPENDENT states (see `.work/dev/graph-worktree-rebind/two-modes.md`):
 *  - Scope is the worktree PERSPECTIVE — the graph is rebound onto that worktree, so HEAD markers, the
 *    primary working-changes row, branch state and the cwd of any action all become the worktree's,
 *    while every commit stays visible. Shown by the branch pill (with its ✕) and the titlebar tint.
 *  - Focus is the branch PROJECTION — the rows narrow to a branch's first-parent spine. Shown by the
 *    search row's mode chip.
 *
 * These specs assert on the observable each state actually owns: the tint CLASSES the titlebar
 * carries, the pill's presence and label, which worktree's WIP row is the primary (top) row, whether a
 * row outside the focused branch is still rendered, and — for the perspective's whole point — that a
 * mutation run while scoped lands in the WORKTREE's working tree and not the home checkout's, proven
 * with git rather than with the UI that requested it.
 *
 * Serial, and ordered deliberately: the Undo Commit journey moves the worktree branch and leaves it
 * dirty, so it runs LAST and no test after it may assume the fixture's original shape.
 */
import * as path from 'node:path';
import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import {
	branchPill,
	clickSidebarRowAction,
	doubleClickWipRow,
	expectScopeTint,
	getGraphRowCount,
	getGraphScrollTop,
	graphCommitRow,
	graphRow,
	graphWipRow,
	isChipFocused,
	isFocusTinted,
	modeChipClear,
	openGraph,
	openGraphSidebarPanel,
	rowUndoCommitAction,
	scrollGraphDeep,
	scrollGraphToTop,
	sidebarRow,
	sidebarRowScopedBadge,
	unscopeWorktreeButton,
	visibleGraphRows,
} from '../graphScopeHelpers.js';

/** The main checkout the test window is opened on — the graph's HOME. */
let home: GitFixture;
/** A secondary worktree on `wt-feature` — the scope target. */
let worktree: GitFixture;
let worktreePath: string;

const worktreeBranch = 'wt-feature';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			userSettings: {
				// Pinned, so the graph's own side bar takes its width out of the split instead of floating
				// over the rows as an overlay — where its rail sits on top of the panel and swallows every
				// click aimed at a worktree row.
				'gitlens.graph.sidebar.pinned': true,
			},
			setup: async () => {
				const repoDir = await createTmpDir();
				home = new GitFixture(repoDir);
				await home.init();

				// Fixed dates throughout: commits made within the same second sort arbitrarily, which
				// floats rows and would make "is this row above that one" flaky.
				await home.commit('Base commit', 'base.txt', 'base\n', { date: '2024-01-01T00:00:00Z' });

				// The worktree branches off BEFORE main's own commit, so `Main only commit` is not an
				// ancestor of `wt-feature` — that's what makes "are the rows narrowed?" an observable
				// question rather than a matter of degree.
				await home.branch(worktreeBranch);
				await home.commit('Main only commit', 'main-only.txt', 'main\n', { date: '2024-01-02T00:00:00Z' });

				// Enough rows to scroll a viewport well past its first page (the view-survival journey).
				for (let i = 0; i < 80; i++) {
					await home.commit(
						`Filler commit ${String(i).padStart(2, '0')}`,
						`filler-${i}.txt`,
						`filler ${i}\n`,
						{ date: `2024-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` },
					);
				}

				worktreePath = path.join(await createTmpDir(), 'wt-feature');
				await home.worktree(worktreePath, worktreeBranch);

				// The throwaway commit the Undo Commit journey resets. Committed INSIDE the worktree so
				// it is that branch's tip, and nothing is left uncommitted there — Undo Commit prompts a
				// modal only when the target working tree is dirty.
				worktree = new GitFixture(worktreePath);
				await worktree.commit('Throwaway commit', 'throwaway.txt', 'throwaway\n', {
					date: '2024-03-01T00:00:00Z',
				});

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — worktree scope and branch focus', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('double-clicking a worktree WIP row cycles the scope in and fully out, and focuses only when the setting says so', async ({
		vscode,
	}) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		const webview = await openGraph(vscode);
		await expectScopeTint(webview, 'none');

		// `doubleClickWorktreeAction` defaults to 'scope', `scopeBehavior` to 'scopeAndFocus' — so one
		// gesture produces BOTH states, and the tint covers the whole bar.
		await doubleClickWipRow(webview, worktreePath);
		await expectScopeTint(webview, 'whole-bar');
		await expect(unscopeWorktreeButton(webview)).toBeVisible({ timeout: MaxTimeout });
		await expect(branchPill(webview)).toContainText(worktreeBranch);
		await expect.poll(() => isChipFocused(webview)).toBe(true);

		// Same gesture again on the same worktree's row — now the graph's own primary row — is the full
		// exit: both halves, not just the focus.
		await doubleClickWipRow(webview, worktreePath);
		await expectScopeTint(webview, 'none');
		await expect(unscopeWorktreeButton(webview)).toHaveCount(0);
		await expect.poll(() => isChipFocused(webview)).toBe(false);

		// With the setting flipped the same gesture is the CLASSIC branch-focus toggle: the search row
		// tints, the perspective is never touched, and no unscope affordance appears.
		await vscode.gitlens.updateSetting('gitlens.graph.doubleClickWorktreeAction', 'focus');
		try {
			await doubleClickWipRow(webview, worktreePath);
			await expect.poll(() => isChipFocused(webview)).toBe(true);
			await expect.poll(() => isFocusTinted(webview)).toBe(true);
			await expectScopeTint(webview, 'none');
			await expect(unscopeWorktreeButton(webview)).toHaveCount(0);

			// And it toggles back off, still without ever having involved a perspective.
			await doubleClickWipRow(webview, worktreePath);
			await expect.poll(() => isChipFocused(webview)).toBe(false);
			await expectScopeTint(webview, 'none');
		} finally {
			await vscode.gitlens.updateSetting('gitlens.graph.doubleClickWorktreeAction', 'scope');
		}
	});

	test('the chip ✕ drops the focus but keeps the worktree scope; the pill ✕ exits both', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraph(vscode);
		await expectScopeTint(webview, 'none');
		const unnarrowedRowCount = await getGraphRowCount(webview);
		expect(unnarrowedRowCount).toBeGreaterThan(10);

		await doubleClickWipRow(webview, worktreePath);
		await expectScopeTint(webview, 'whole-bar');

		// Focused: the rows are the worktree branch's spine alone — main's own line is projected away.
		await expect.poll(() => getGraphRowCount(webview), { timeout: 30000 }).toBeLessThan(unnarrowedRowCount);

		// Chip ✕ clears the FOCUS only. The scope survives — the tint retreats to the identity row, the
		// unscope affordance stays, and every commit is back ("be the worktree, see everything").
		await modeChipClear(webview).click();
		await expectScopeTint(webview, 'top-row');
		await expect(unscopeWorktreeButton(webview)).toBeVisible({ timeout: MaxTimeout });
		await expect.poll(() => isFocusTinted(webview)).toBe(false);
		await expect.poll(() => getGraphRowCount(webview), { timeout: 30000 }).toBe(unnarrowedRowCount);
		await expect(branchPill(webview)).toContainText(worktreeBranch);

		// Pill ✕ is the full exit: no tint, no pill ✕, no focus, and the header names home's branch again.
		await unscopeWorktreeButton(webview).click();
		await expectScopeTint(webview, 'none');
		await expect(unscopeWorktreeButton(webview)).toHaveCount(0);
		await expect.poll(() => isChipFocused(webview)).toBe(false);
		await expect(branchPill(webview)).toContainText('main');
	});

	test('scoping from the side bar leaves the viewport alone, while the WIP-row gesture follows its row', async ({
		vscode,
	}) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		// Scope-only for this journey. Under the default `scopeAndFocus` the rows legitimately narrow to
		// the worktree branch's spine, so "did the viewport move?" would have no answer worth asserting —
		// there'd be nothing left at the parked position to stay parked at.
		await vscode.gitlens.updateSetting('gitlens.graph.scopeBehavior', 'scope');
		try {
			const webview = await openGraph(vscode);
			await expectScopeTint(webview, 'none');

			// The side bar opens BEFORE the baseline is taken: it splits the pane, and a layout change of
			// its own would move the viewport for reasons that have nothing to do with the rebind.
			await openGraphSidebarPanel(vscode, 'worktrees');
			const row = sidebarRow(webview, worktreeBranch);
			await expect(row).toBeVisible({ timeout: 30000 });

			// Select first, THEN park: a first selection opens the details panel, and that layout change
			// resets the virtualizer's position on its own — taking the baseline after it keeps this test
			// about the rebind rather than about the details panel.
			const selected = visibleGraphRows(webview).nth(4);
			const selectedSha = await selected.getAttribute('data-sha');
			expect(selectedSha).not.toBeNull();
			await selected.click();
			await expect(selected).toHaveAttribute('aria-selected', 'true');
			const parkedScrollTop = await scrollGraphDeep(vscode, webview);

			// A side bar gesture is not a gesture ON a row: this rebind is something the user is watching,
			// not something they aimed somewhere, so neither the viewport nor the selection may move.
			await clickSidebarRowAction(row, 'Scope to Worktree');

			await expectScopeTint(webview, 'top-row');
			await expect(sidebarRowScopedBadge(sidebarRow(webview, worktreeBranch))).toBeVisible({
				timeout: MaxTimeout,
			});
			expect(await getGraphScrollTop(webview)).toBe(parkedScrollTop);

			// The selection outlived the rebind too — asserted from the top, since the virtualizer keeps no
			// element mounted for a row that is currently scrolled away.
			await scrollGraphToTop(vscode, webview);
			await expect(graphRow(webview, selectedSha!)).toHaveAttribute('aria-selected', 'true');

			// The other half of the same rule: a gesture ON a WIP row DOES follow it — the selection moves
			// to that row and it is revealed, rather than staying wherever the user was.
			await unscopeWorktreeButton(webview).click();
			await expectScopeTint(webview, 'none');
			await expect(graphRow(webview, selectedSha!)).toHaveAttribute('aria-selected', 'true');

			await doubleClickWipRow(webview, worktreePath);
			await expectScopeTint(webview, 'top-row');
			const wipRow = graphWipRow(webview, worktreePath);
			await expect(wipRow).toBeVisible({ timeout: 30000 });
			await expect(wipRow).toBeInViewport();
			await expect(wipRow).toHaveAttribute('aria-selected', 'true');

			await unscopeWorktreeButton(webview).click();
			await expectScopeTint(webview, 'none');
		} finally {
			await vscode.gitlens.updateSetting('gitlens.graph.scopeBehavior', 'scopeAndFocus');
		}
	});

	// LAST on purpose: Undo Commit moves `wt-feature` back a commit and leaves the worktree dirty, so
	// the fixture's shape after this test is not the one the tests above rely on.
	test('a mutation run while scoped lands in the worktree, and unscoping restores home', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraph(vscode);

		// Unscoped, home owns the top row and the worktree branch's tip is somebody else's HEAD — its
		// undo action says so, and carries the worktree path it would have to route to.
		await expect(graphWipRow(webview, home.repoPath)).toHaveAttribute('data-index', '0');
		const tip = graphCommitRow(webview, 'Throwaway commit');
		await expect(tip).toBeVisible({ timeout: 30000 });
		await tip.hover();
		await expect(rowUndoCommitAction(tip)).toHaveAttribute('aria-label', `Undo Commit on ${worktreeBranch}`);

		await doubleClickWipRow(webview, worktreePath);
		await expectScopeTint(webview, 'whole-bar');
		await expect(branchPill(webview)).toContainText(worktreeBranch);
		await expect(unscopeWorktreeButton(webview)).toBeVisible({ timeout: MaxTimeout });

		// The perspective moved: the WORKTREE's working-changes row is now the primary (top) row, and
		// that branch's tip is plain HEAD — no worktree to route to, because the graph IS the worktree.
		await expect(graphWipRow(webview, worktreePath)).toHaveAttribute('data-index', '0', { timeout: 30000 });
		const scopedTip = graphCommitRow(webview, 'Throwaway commit');
		await expect(scopedTip).toBeVisible({ timeout: 30000 });
		await scopedTip.hover();
		const undo = rowUndoCommitAction(scopedTip);
		await expect(undo).toHaveAttribute('aria-label', 'Undo Commit');
		await expect(undo).not.toHaveAttribute('data-worktree-path');

		const homeShaBefore = await home.getSha();
		const worktreeShaBefore = await worktree.getSha();
		const worktreeParent = await worktree.getSha('HEAD~1');

		await undo.click();

		// The proof is on disk, not in the UI: the worktree's branch moved back and its index now holds
		// the undone commit's file, while the home checkout is untouched in both respects.
		await expect.poll(() => worktree.getSha(), { timeout: 30000 }).toBe(worktreeParent);
		await expect
			.poll(() => worktree.getStatusLines(), { timeout: 30000 })
			.toContainEqual(expect.stringContaining('throwaway.txt'));
		expect(await home.getSha()).toBe(homeShaBefore);
		expect(await home.getStatusLines()).toEqual([]);
		expect(worktreeShaBefore).not.toBe(worktreeParent);

		// Unscoping returns the binding home: home's branch on the pill, home's WIP row back on top.
		await unscopeWorktreeButton(webview).click();
		await expectScopeTint(webview, 'none');
		await expect(branchPill(webview)).toContainText('main');
		await expect(graphWipRow(webview, home.repoPath)).toHaveAttribute('data-index', '0', { timeout: 30000 });
	});
});
