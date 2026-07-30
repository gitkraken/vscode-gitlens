import type { FrameLocator } from '@playwright/test';
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
