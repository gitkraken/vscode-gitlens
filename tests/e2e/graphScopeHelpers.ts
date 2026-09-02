import type { FrameLocator, Locator } from '@playwright/test';
import type { VSCodeInstance } from './baseTest.js';
import { expect, MaxTimeout } from './baseTest.js';
import { ensureGraphRowsRendered, widenSideBarForGraph } from './graphHelpers.js';

/**
 * Locators and gestures for the Commit Graph's two independent worktree states — SCOPE (the worktree
 * perspective the graph is bound to) and FOCUS (the branch projection that narrows the rows).
 *
 * Kept beside {@link file://./graphHelpers.ts} rather than inside it: everything here keys on the
 * scope/focus vocabulary (the pill, the chip, the titlebar tint, the sidebar's worktree rows), which
 * no other graph spec needs.
 */

/**
 * The synthetic row id of a worktree's working-changes row, mirroring `createWipRowId`
 * (`packages/plus/commit-graph/src/identity.ts`) — the id the graph stamps into each WIP row's
 * `data-sha`, and the only stable way to address one worktree's row rather than another's (every WIP
 * row renders the same "Working Changes" text).
 *
 * Only the POSIX half of the normalization is reproduced: the harness's fixture repos always live
 * under `os.tmpdir()`, so a drive letter never reaches this.
 */
export function wipRowId(worktreePath: string): string {
	return `wip::${worktreePath.replace(/\\/g, '/').replace(/\/$/, '')}`;
}

/** The graph's row tree. Named so a details-panel `treeitem` can never be mistaken for a graph row. */
export function graphTree(webview: FrameLocator): Locator {
	return webview.getByRole('tree', { name: 'Commit graph' });
}

/** One graph row by its `data-sha` — the row identity the engine renders with. */
export function graphRow(webview: FrameLocator, sha: string): Locator {
	return graphTree(webview).locator(`.gl-graph__row[data-sha="${sha}"]`);
}

/** A worktree's working-changes row (its own, not whichever one happens to be at the top). */
export function graphWipRow(webview: FrameLocator, worktreePath: string): Locator {
	return graphRow(webview, wipRowId(worktreePath));
}

/** A commit row by its message. */
export function graphCommitRow(webview: FrameLocator, message: string): Locator {
	return graphTree(webview).getByRole('treeitem', { name: message }).filter({ visible: true }).first();
}

/**
 * The graph's scrolling element — the element whose `scrollTop` a spec has to read to prove a rebind
 * left the user's position alone.
 *
 * It is the `<lit-virtualizer scroller>` inside the row tree, NOT the enclosing `.gl-graph__viewport`:
 * the viewport is a flex column sized to fit its children exactly, so it never overflows and its
 * `scrollTop` is permanently 0 — a spec reading it would report "the viewport didn't move" no matter
 * what happened.
 */
export function graphViewport(webview: FrameLocator): Locator {
	return webview.locator('.gl-graph__tree lit-virtualizer').first();
}

export async function getGraphScrollTop(webview: FrameLocator): Promise<number> {
	return graphViewport(webview).evaluate(el => el.scrollTop);
}

/**
 * Scroll the graph and return the position it actually took — a short page clamps the request, so the
 * caller records what happened rather than what it asked for.
 */
/**
 * Scroll the graph with a real wheel gesture and return where it ended up.
 *
 * A wheel, not `scrollTo`: the graph tracks its own scroll anchor and re-applies it whenever it
 * re-renders, so a position set straight on the DOM is reverted by the next state push (a row click is
 * enough) — the spec would then be measuring its own scroll trick rather than the product.
 */
export async function scrollGraphBy(vscode: VSCodeInstance, webview: FrameLocator, deltaY: number): Promise<number> {
	await graphViewport(webview).hover({ position: { x: 5, y: 5 } });
	await vscode.page.mouse.wheel(0, deltaY);
	// The virtualizer mounts rows off the scroll event, so the position can be read mid-flight; settle on
	// two consecutive readings that agree.
	let last = -1;
	await expect
		.poll(
			async () => {
				const current = await getGraphScrollTop(webview);
				const stable = current === last;
				last = current;
				return stable;
			},
			{ timeout: MaxTimeout },
		)
		.toBe(true);
	return last;
}

/**
 * Park the graph a few screens down, well clear of its first page.
 *
 * Deliberately a bounded depth rather than "scroll to the end": hitting the bottom makes the graph page
 * in more history, so the position keeps moving and there is nothing stable for a spec to compare
 * against. Fails loudly if the fixture's history is too short to scroll at all — a spec that silently
 * stayed at the top would otherwise "prove" the viewport didn't move.
 */
export async function scrollGraphDeep(vscode: VSCodeInstance, webview: FrameLocator): Promise<number> {
	const top = await scrollGraphBy(vscode, webview, 600);
	expect(top, 'the graph did not overflow its viewport — the fixture needs more commits').toBeGreaterThan(0);
	return top;
}

/** Return the graph to the top of its history with a real wheel gesture. */
export async function scrollGraphToTop(vscode: VSCodeInstance, webview: FrameLocator): Promise<void> {
	await scrollGraphBy(vscode, webview, -100000);
	await expect.poll(() => getGraphScrollTop(webview), { timeout: MaxTimeout }).toBe(0);
}

/** The graph rows currently mounted and on screen — the virtualizer renders no others. */
export function visibleGraphRows(webview: FrameLocator): Locator {
	return graphTree(webview).locator('.gl-graph__row[data-sha]').filter({ visible: true });
}

/**
 * How many rows the graph is showing in total, read off a rendered row's `aria-setsize`.
 *
 * The only way to ask "are the rows narrowed?" that survives virtualization: a commit outside the
 * focused branch isn't merely hidden, it's unmounted — and so is any commit below the fold, which
 * makes "is this particular row present?" answer the same for both.
 */
export async function getGraphRowCount(webview: FrameLocator): Promise<number> {
	const setsize = await visibleGraphRows(webview).first().getAttribute('aria-setsize');
	return setsize != null ? Number(setsize) : 0;
}

/** The graph's titlebar — the element the whole-bar scope tint is set on. */
export function titlebar(webview: FrameLocator): Locator {
	return webview.locator('header.titlebar').first();
}

/** The titlebar's search row — the surface a plain branch focus tints on its own. */
export function titlebarSearchRow(webview: FrameLocator): Locator {
	return webview.locator('.titlebar__row--search').first();
}

/**
 * What the titlebar's tint says the scope state is:
 * - `whole-bar` — scoped AND focused (one surface across both rows)
 * - `top-row` — scoped WITHOUT a focus (only the identity row keeps the tint)
 * - `none` — not worktree-scoped (a plain branch focus tints the search row instead; see
 *   {@link isFocusTinted})
 */
export type ScopeTint = 'none' | 'top-row' | 'whole-bar';

const wholeBarTintClass = /(?:^|\s)titlebar--worktree-scoped(?:\s|$)/;
const topRowTintClass = /(?:^|\s)titlebar--worktree-scoped-only(?:\s|$)/;

/** Web-first (auto-retrying) on purpose, not an `expect.poll` over `evaluate`: a poll's callback throwing
 *  ends the poll, and `evaluate` throws `Frame was detached` whenever the webview iframe is replaced under
 *  it (a reload) — a retrying assertion just re-resolves the locator against the frame that replaced it. */
export async function expectScopeTint(webview: FrameLocator, expected: ScopeTint, timeout = 30000): Promise<void> {
	const bar = titlebar(webview);
	switch (expected) {
		case 'whole-bar':
			await expect(bar).toHaveClass(wholeBarTintClass, { timeout: timeout });
			break;
		case 'top-row':
			await expect(bar).toHaveClass(topRowTintClass, { timeout: timeout });
			await expect(bar).not.toHaveClass(wholeBarTintClass, { timeout: timeout });
			break;
		case 'none':
			await expect(bar).not.toHaveClass(wholeBarTintClass, { timeout: timeout });
			await expect(bar).not.toHaveClass(topRowTintClass, { timeout: timeout });
			break;
	}
}

/**
 * Reloads the graph webview (`workbench.action.webview.reloadWebviewAction`) and returns the frame that
 * REPLACES it. The command returns before VS Code tears the old iframe down, and until it does every
 * locator still resolves against the OLD document — which passes every check and then detaches under
 * the first assertion that outlives it. So the old document is stamped first, and the swap is awaited
 * as the moment a document WITHOUT the stamp answers; the frame locator re-resolves across the swap.
 */
export async function reloadGraphWebview(
	vscode: VSCodeInstance,
	webview: FrameLocator,
	timeout = MaxTimeout,
): Promise<FrameLocator> {
	await webview.locator('html').evaluate(el => {
		(el as HTMLElement).dataset.e2eReloadGen = 'pre';
	});
	await vscode.gitlens.executeCommand('workbench.action.webview.reloadWebviewAction');
	await expect(webview.locator('html')).not.toHaveAttribute('data-e2e-reload-gen', 'pre', { timeout: timeout });

	const reloaded = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', timeout);
	expect(reloaded).not.toBeNull();
	return reloaded!;
}

/** Whether the search row carries the branch-FOCUS tint (`titlebar__row--scoped`). */
export async function isFocusTinted(webview: FrameLocator): Promise<boolean> {
	const classes = await titlebarSearchRow(webview).evaluate(el => [...el.classList]);
	return classes.includes('titlebar__row--scoped');
}

/** The header's branch pill. While scoped it names the BOUND worktree's branch. */
export function branchPill(webview: FrameLocator): Locator {
	return webview.locator('gl-ref-button.ref-button-group__ref').first();
}

/**
 * The ✕ on the header's branch pill — "Unscope Worktree", the full exit (perspective AND focus).
 *
 * Scoped to the titlebar: the side bar's own Scope action takes the same label on the row that is
 * currently scoped, so an unscoped lookup matches two different affordances.
 */
export function unscopeWorktreeButton(webview: FrameLocator): Locator {
	return titlebar(webview).locator('button[aria-label="Unscope Worktree"]');
}

/** The search row's mode chip — the branch-FOCUS indicator. */
export function modeChip(webview: FrameLocator): Locator {
	return webview.locator('button.mode-chip').first();
}

/** The mode chip's ✕ — clears the branch focus only, never the worktree perspective. */
export function modeChipClear(webview: FrameLocator): Locator {
	return webview.locator('.mode-chip__clear').first();
}

/** Whether the mode chip is in its focused (`mode-chip--scoped`) presentation. */
export async function isChipFocused(webview: FrameLocator): Promise<boolean> {
	const classes = await modeChip(webview).evaluate(el => [...el.classList]);
	return classes.includes('mode-chip--scoped');
}

/** The graph's own side bar panel (worktrees / branches / …), not VS Code's side bar. */
export function sidebarPanel(webview: FrameLocator): Locator {
	return webview.locator('gl-graph-sidebar-panel');
}

/** A row in the graph's side bar panel, addressed by its label (a worktree row's label is its branch). */
export function sidebarRow(webview: FrameLocator, label: string): Locator {
	return sidebarPanel(webview).locator('gl-tree-item').filter({ hasText: label }).first();
}

/**
 * An inline action on a side bar row. The actions are hover-revealed, so the row is hovered first —
 * without it the chip resolves in the DOM but never becomes actionable.
 */
export async function clickSidebarRowAction(row: Locator, label: string): Promise<void> {
	await row.hover();
	const action = row.locator(`gl-action-chip button[aria-label="${label}"]`).first();
	await expect(action).toBeVisible({ timeout: MaxTimeout });
	await action.click();
}

/** The `gl-scope` decoration marking the side bar row the graph is currently scoped to. */
export function sidebarRowScopedBadge(row: Locator): Locator {
	return row.locator('code-icon[aria-label="Scoped"]');
}

/**
 * Opens the Commit Graph view, gives it panel-like width, and waits until its rows have painted.
 *
 * The widening is load-bearing, not cosmetic: at the side bar's default ~300px the persistent
 * row-actions overlay covers a row's subject text and swallows clicks aimed at it — which is exactly
 * where these specs aim (the WIP row's "Working Changes" label is the one part of that row that
 * doesn't resolve to a ref).
 */
export async function openGraph(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	// More steps than the default: these specs also open the graph's OWN side bar panel, which takes its
	// width out of the same pane. `decreaseViewWidth` clamps, so over-asking is free.
	await widenSideBarForGraph(vscode, 20);
	const webview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
	expect(webview).not.toBeNull();
	await ensureGraphRowsRendered(vscode, webview!, 30000);
	return webview!;
}

/** Opens the graph's side bar on a given panel (the same entry point the `gitlens.showGraph` callers use). */
export async function openGraphSidebarPanel(vscode: VSCodeInstance, panel: 'worktrees'): Promise<void> {
	await vscode.gitlens.executeCommand('gitlens.showGraph', { sidebarPanel: panel });
}

/**
 * Double-click a worktree's WIP row — the gesture `graph.doubleClickWorktreeAction` governs.
 *
 * Targets the row's "Working Changes" text rather than the row box: the row also carries an inline
 * branch pill, and a double-click resolved to a ref routes to the ref action (checkout) instead of the
 * row gesture (`surface.ts`'s `onDblClick`).
 */
export async function doubleClickWipRow(webview: FrameLocator, worktreePath: string): Promise<void> {
	const row = graphWipRow(webview, worktreePath);
	await expect(row).toBeVisible({ timeout: 30000 });
	await row.getByText('Working Changes').first().dblclick();
}

/** The inline "Undo Commit" action on a commit row (hover-revealed, like every gated row action). */
export function rowUndoCommitAction(row: Locator): Locator {
	return row.locator('[data-row-action="undo-commit"]').first();
}
