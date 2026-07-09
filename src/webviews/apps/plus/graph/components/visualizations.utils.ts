import type { VisualizationMode } from '../../../../plus/graph/protocol.js';
import type { TreemapMode, TreemapNode } from '../../../../plus/treemap/protocol.js';

/** Flat key naming the visualization the user is actually looking at — collapses the two-axis
 *  (`visualizationMode` × `treemapMode`) state into one value, matching the switcher's tab model. */
export type GraphVisualizationKey = 'timeline' | 'treemap-files' | 'treemap-commits' | 'treemap-activity';

/** Resolves the effective visualization key, gating non-timeline modes behind the experimental
 *  flag exactly as `gl-graph-visualizations` routes: when the flag is off, force `timeline`
 *  regardless of the persisted `visualizationMode`/`treemapMode` (the stored values are preserved
 *  so re-enabling restores the user's prior choice). Single source of truth for the wrapper's
 *  render routing, the switcher's active tab, and the `graph/visualizations/closed` telemetry mode
 *  — so a `timeline shown → treemap closed` mismatch can't arise when the flag is toggled off after
 *  a treemap was picked. */
export function getEffectiveVisualizationKey(
	visualizationMode: VisualizationMode | undefined,
	treemapMode: TreemapMode | undefined,
	visualizationsEnabled: boolean,
): GraphVisualizationKey {
	if (!visualizationsEnabled) return 'timeline';
	if ((visualizationMode ?? 'timeline') === 'timeline') return 'timeline';
	return `treemap-${treemapMode ?? 'files'}`;
}

export interface TreemapZoomClassification {
	/** False when the path is unchanged (same depth + same leaf) — the chart re-emits an identical
	 *  path when it rehydrates the preserved zoom after an error→retry, which is not a user zoom. */
	changed: boolean;
	direction: 'in' | 'out';
	depth: number;
}

/** Classifies a treemap zoom-path transition for telemetry. Zoom is strictly push/pop (drill
 *  deeper or breadcrumb up), so once past the equal-path `changed:false` guard the lengths always
 *  differ — `>=` therefore only ever means a genuine deeper level, never a lateral same-depth jump. */
export function classifyTreemapZoom(previous: TreemapNode[], next: TreemapNode[]): TreemapZoomClassification {
	const changed = !(previous.length === next.length && previous.at(-1)?.path === next.at(-1)?.path);
	return { changed: changed, direction: next.length >= previous.length ? 'in' : 'out', depth: next.length };
}

/** Counts file (leaf) nodes in a treemap tree — the `files.count` reported by `graph/treemap/shown`. */
export function countFileLeaves(node: TreemapNode | undefined): number {
	if (node == null) return 0;
	if (node.type === 'file') return 1;

	let count = 0;
	for (const child of node.children ?? []) {
		count += countFileLeaves(child);
	}
	return count;
}
