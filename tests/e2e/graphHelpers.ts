import type { FrameLocator, Locator } from '@playwright/test';
import type { VSCodeInstance } from './baseTest.js';
import { expect, ShortTimeout } from './baseTest.js';

/**
 * Wait until the graph has painted commit rows. The tree container (role="tree", aria-label
 * "Commit graph") mounts before the virtualizer paints its role="treeitem" rows, so gating readiness
 * on the container alone races the row paint on slower webviews (VS Code forks) — the window where a
 * row resolves in the DOM but reports `hidden`. Gate on the first visible treeitem.
 *
 * Use this before asserting on anything the graph renders. A spec that instead waits directly on its
 * own target puts activation, paint and that target's own state under one timeout, so any of the
 * three failing looks the same.
 */
export async function waitForGraphRowsRendered(graphWebview: FrameLocator, timeout = 30000): Promise<void> {
	// Scope to the graph tree so we don't match a details-panel file-tree treeitem (the details
	// `gl-tree-view` also exposes role="treeitem"); graph rows are descendants of this tree.
	await expect(
		graphWebview
			.getByRole('tree', { name: 'Commit graph' })
			.getByRole('treeitem')
			.filter({ visible: true })
			.first(),
	).toBeVisible({ timeout: timeout });
}

/** Width the primary side bar needs before the Graph's details panel lays out beside the graph (#5545). */
const graphSideBarTargetWidth = 820;

/** Width left to the editor part when asking for the side bar's target, so the drag stays possible. */
const editorPartKeepWidth = 200;

/**
 * Find a page point that actually grabs the primary side bar's trailing sash, or `null` if none does.
 *
 * Several sashes stack on that edge — measured on Windsurf: one live `vertical` sash spanning the full
 * window height and two `disabled` ones over the side bar's own height, all at the same x. A drag is
 * delivered to whatever sits topmost at the point, so aiming at the edge grabs the live sash or a dead
 * one depending on paint order, which is what made a coordinate drag widen the side bar only sometimes.
 * Hovering the live sash by locator does not help either: the dead ones cover it, so it never takes the
 * pointer. Hence `elementFromPoint` — walk down the live sash and return the first point that resolves
 * to it, which on the stacked edge is the strip above where the dead ones start.
 */
async function findSideBarSashPoint(vscode: VSCodeInstance): Promise<{ x: number; y: number } | null> {
	return vscode.page.evaluate(() => {
		const sideBar = document.querySelector('.part.sidebar');
		if (sideBar == null) return null;

		const edge = sideBar.getBoundingClientRect().right;

		let candidate: Element | null = null;
		let best = Infinity;
		for (const sash of document.querySelectorAll('.monaco-sash.vertical')) {
			if (sash.classList.contains('disabled')) continue;

			const rect = sash.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) continue;

			const distance = Math.abs(rect.left + rect.width / 2 - edge);
			if (distance < best) {
				best = distance;
				candidate = sash;
			}
		}
		if (candidate == null || best > 8) return null;

		const rect = candidate.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		for (let fraction = 0.02; fraction < 1; fraction += 0.02) {
			const y = rect.top + rect.height * fraction;
			if (document.elementFromPoint(x, y) === candidate) return { x: x, y: y };
		}

		return null;
	});
}

/**
 * Widen the primary side bar so the Graph gets a panel-like width: at its default ~300px (#5545)
 * the details panel's file tree paints no `gl-tree-item`s. `decreaseViewWidth` always shrinks the
 * EDITOR part (~60px per call, clamping at its minimum, so over-calling is harmless); on VS Code the
 * freed width goes to its grid neighbours — the primary side bar here, since `resetUI` keeps the
 * secondary one closed. The focus call just makes sure the view is open first.
 *
 * That command path is VS Code-specific, so it is followed by a drag of the side bar's own sash.
 * Measured on Windsurf: the command runs without error but leaves the side bar at 300px and hands
 * every freed pixel to the secondary side bar (300 → 878); closing that bar first only makes the
 * command stop moving anything at all, while dragging the sash widens the side bar on both editors.
 * The short nudge after `mouse.down` is what starts the drag — a single long move can be consumed as
 * a click. Best-effort by design: an editor that refuses both mechanisms still gets the side bar it
 * had, because several specs here read fine at its default width and only the width-sensitive ones
 * (details panel, file tree) care. Those gate on their own state — see {@link ensureGraphRowsRendered}
 * and {@link scrollDetailsToFileTree}.
 *
 * Width is all this buys, and it is not enough for the details panel's file tree on its own: the panel
 * only moves beside the graph past ~820px, so below that it keeps splitting the side bar's HEIGHT with
 * the graph — which the Welcome pane also takes ~220px of by default.
 */
export async function widenSideBarForGraph(vscode: VSCodeInstance, steps = 12): Promise<void> {
	await vscode.gitlens.executeCommand<void>('gitlens.views.graph.focus');
	for (let i = 0; i < steps; i++) {
		await vscode.gitlens.executeCommand<void>('workbench.action.decreaseViewWidth');
	}

	const sideBar = vscode.page.locator('.part.sidebar');
	let box = await sideBar.boundingBox();
	if (box == null || box.width >= graphSideBarTargetWidth) return;

	// Ask for the target, but never for more than the window can spare once the editor part keeps a
	// usable width. On a small window that clamp can land left of where the side bar already ends, and
	// dragging there would NARROW it while still satisfying a naive "reached the target" check.
	const windowWidth = await vscode.page.evaluate(() => window.innerWidth);
	const target = box.x + Math.min(graphSideBarTargetWidth, windowWidth - box.x - editorPartKeepWidth);
	if (target <= box.x + box.width) return;

	for (let attempt = 0; attempt < 3; attempt++) {
		const point = await findSideBarSashPoint(vscode);
		if (point == null) return;

		const before = box.width;
		await vscode.page.mouse.move(point.x, point.y);
		try {
			await vscode.page.mouse.down();
			// The short nudge is what starts the drag — a single long move can be taken for a click.
			await vscode.page.mouse.move(point.x + 40, point.y, { steps: 5 });
			await vscode.page.mouse.move(target, point.y, { steps: 20 });
		} finally {
			// Releasing matters more than the drag landing: the editor is a worker fixture, and a button
			// left down turns every later click in the file into a drag.
			await vscode.page.mouse.up().catch(() => {});
		}

		// Park the pointer off the widened side bar: releasing it there leaves it over the graph rows,
		// and the commit hover that opens under it then intercepts the clicks of whatever runs next.
		await vscode.page.mouse.move(0, 0);
		await vscode.page.waitForTimeout(ShortTimeout);

		box = await sideBar.boundingBox();
		if (box == null) return;
		// Reached it, or the layout will give no more — retrying past that only spends the budget.
		if (box.x + box.width >= target || box.width <= before) return;
	}
}

/**
 * Scroll the Graph's details panel to its *Files changed* tree, so a spec can gate on the tree's rows.
 *
 * The tree is virtualized: `lit-virtualizer` mounts rows only for its own viewport, so a tree below the
 * fold has NO `gl-tree-item` in the DOM at all — indistinguishable from a tree that failed to render.
 * With a commit selected that is the default state on a side-bar-sized panel: the header, message and
 * AI blocks fill the panel on their own. Measured at a ~300px-wide side bar with the Welcome pane
 * expanded (its shipped `visibility`, holding ~220px of the height): `gl-tree-view` sits at y=531 of a
 * 544px viewport with 0 items, and scrolling the 42px to the end of the panel mounts them.
 *
 * Scrolling rather than growing the side bar is deliberate. Pane sizes are shared mutable state
 * across spec files in a worker: collapsing a pane to free height does not keep it collapsed for the
 * specs that follow. A panel's own scroll position, in contrast, is local to the assertion that
 * needs it.
 */
export async function scrollDetailsToFileTree(graphWebview: FrameLocator, timeout = 30000): Promise<void> {
	const content = graphWebview.locator('.details-content').first();
	await expect(content).toBeVisible({ timeout: timeout });
	await content.evaluate(el => el.scrollTo({ top: el.scrollHeight }));
}

/**
 * Wait for the graph's rows, widening the host only if they aren't visible yet.
 *
 * A cramped host lays the graph tree out but reports its rows `hidden`, so a spec that gates on
 * {@link waitForGraphRowsRendered} needs more room first. Probing before widening keeps the outcome the
 * same whatever the previous spec file left behind, and costs nothing when the rows are already there.
 */
export async function ensureGraphRowsRendered(
	vscode: VSCodeInstance,
	graphWebview: FrameLocator,
	timeout = 15000,
): Promise<void> {
	const rows = graphWebview
		.getByRole('tree', { name: 'Commit graph' })
		.getByRole('treeitem')
		.filter({ visible: true })
		.first();
	if (await rows.isVisible().catch(() => false)) return;

	await widenSideBarForGraph(vscode);
	await waitForGraphRowsRendered(graphWebview, timeout);
}

export type GraphDetailsContext = 'commit' | 'multicommit' | 'wip';

const detailsRegionNames: Record<GraphDetailsContext, string> = {
	commit: 'Commit details',
	multicommit: 'Multiple commits selected',
	wip: 'Working changes details',
};

/**
 * The visible, semantic boundary of the integrated details panel.
 *
 * Do not gate on `gl-details-*-panel` itself. Those custom-element hosts can legitimately have no
 * layout box while their children overflow into the visible `.details-content`; Playwright then
 * reports the host as hidden even though the panel is rendered and exposed to assistive technology.
 * The outer region is the product invariant: `gl-graph-details-panel` gives it a context-specific
 * accessible name and it owns the visible scrolling viewport.
 */
export function graphDetailsRegion(graphWebview: FrameLocator, context?: GraphDetailsContext): Locator {
	return graphWebview
		.getByRole('region', {
			name:
				context != null
					? detailsRegionNames[context]
					: /^(?:Commit details|Multiple commits selected|Working changes details)$/,
		})
		.first();
}

/**
 * Expand the details panel and wait for its stable, semantic boundary.
 *
 * The graph can reconcile its header while its first rows are painting, replacing the toggle between
 * Playwright's visibility check and click. Retrying the idempotent action against the current toggle
 * avoids treating that transient host element as the product state.
 */
export async function ensureGraphDetailsPanelOpen(graphWebview: FrameLocator, timeout = 10000): Promise<void> {
	const detailsRegion = graphDetailsRegion(graphWebview);
	await expect(async () => {
		if (await detailsRegion.isVisible()) return;

		const showButton = graphWebview.locator('gl-button[aria-label="Show Details Panel"]').first();
		if (await showButton.isVisible()) {
			await showButton.click();
		}
		await expect(detailsRegion).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: timeout });
}
