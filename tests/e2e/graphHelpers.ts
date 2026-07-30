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
 * Wait for the graph's rows, maximizing the bottom panel only if they aren't visible yet.
 *
 * A short bottom panel lays the graph tree out but reports its rows `hidden`, so a spec that gates on
 * {@link waitForGraphRowsRendered} needs the panel maximized. `workbench.action.toggleMaximizedPanel`
 * is a stateful toggle and the VS Code instance is shared across spec files, so a spec cannot simply
 * flip it: whether that maximizes or restores depends on what ran before. Probing first makes the
 * outcome the same either way, and costs a toggle only when the rows really are hidden.
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

	await vscode.gitlens.executeCommand<void>('workbench.action.toggleMaximizedPanel');
	await waitForGraphRowsRendered(graphWebview, timeout);
}
