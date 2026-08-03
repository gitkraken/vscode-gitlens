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
 */
export async function widenSideBarForGraph(vscode: VSCodeInstance, steps = 12): Promise<void> {
	await vscode.gitlens.executeCommand<void>('gitlens.views.graph.focus');
	for (let i = 0; i < steps; i++) {
		await vscode.gitlens.executeCommand<void>('workbench.action.decreaseViewWidth');
	}
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
