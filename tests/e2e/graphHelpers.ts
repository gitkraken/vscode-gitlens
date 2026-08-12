import type { FrameLocator } from '@playwright/test';
import type { VSCodeInstance } from './baseTest.js';
import { expect } from './baseTest.js';

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

/**
 * Widen the primary side bar so the Graph gets a panel-like width: at its default ~300px (#5545)
 * the details panel's file tree paints no `gl-tree-item`s. `decreaseViewWidth` always shrinks the
 * EDITOR part (~60px per call, clamping at its minimum, so over-calling is harmless); the freed
 * width goes to its grid neighbours — the primary side bar here, since `resetUI` keeps the
 * secondary one closed. The focus call just makes sure the view is open first.
 *
 * Width is all this buys, and it is not enough for the details panel's file tree on its own: the panel
 * only moves beside the graph past ~820px, so below that it keeps splitting the side bar's HEIGHT with
 * the graph — which the Welcome pane also takes ~220px of by default. See
 * {@link scrollDetailsToFileTree} for what a spec gating on that tree needs.
 */
export async function widenSideBarForGraph(vscode: VSCodeInstance, steps = 12): Promise<void> {
	await vscode.gitlens.executeCommand<void>('gitlens.views.graph.focus');
	for (let i = 0; i < steps; i++) {
		await vscode.gitlens.executeCommand<void>('workbench.action.decreaseViewWidth');
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
