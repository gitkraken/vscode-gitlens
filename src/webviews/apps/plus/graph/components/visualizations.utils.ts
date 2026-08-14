import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { GraphVisualizationKey } from '../../../../../constants.telemetry.js';
import type { GraphIncludeOnlyRefs, GraphScope, VisualizationMode } from '../../../../plus/graph/protocol.js';
import type { TreemapMode, TreemapNode } from '../../../../plus/treemap/protocol.js';

// Re-exported from the telemetry contract (the single source of truth for the visualization
// vocabulary) so the switcher, the wrapper's render routing, and the `closed` telemetry all name
// visualizations identically and can't drift.
export type { GraphVisualizationKey };

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

	const mode = visualizationMode ?? 'timeline';
	if (mode === 'timeline') return 'timeline';
	// Health has no sub-mode to collapse, so it maps straight across.
	if (mode === 'health') return 'health';

	return `treemap-${treemapMode ?? 'files'}`;
}

/** The slice of graph state the branch-walk helpers read. */
export interface BranchWalkContext {
	branchesVisibility?: GraphBranchesVisibility;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
	scope?: GraphScope;
}

/** When the Graph is in "All Branches" visibility AND no specific branch is scoped, a visualization
 *  uses the host's `--all` shortcut. For every other visibility mode (smart/favorited/current) the
 *  caller walks specific refs via {@link getAdditionalBranches} instead — keeping the visualization's
 *  data in sync with what the Graph is showing. */
export function shouldWalkAllBranches(state: BranchWalkContext): boolean {
	if (state.scope != null) return false;
	return state.branchesVisibility === 'all';
}

/** Branch names from the Graph's `includeOnlyRefs` filter — the actual refs the Graph is showing for
 *  non-`'all'` visibility modes. Returns `undefined` when scoped to one branch (a single ref goes via
 *  head), when the `--all` walk already covers everything, or when there are no refs to add (the
 *  caller falls back to HEAD). */
export function getAdditionalBranches(state: BranchWalkContext): string[] | undefined {
	if (state.scope != null) return undefined;
	if (shouldWalkAllBranches(state)) return undefined;

	const includeOnlyRefs = state.includeOnlyRefs;
	if (includeOnlyRefs == null) return undefined;

	const names: string[] = [];
	for (const ref of Object.values(includeOnlyRefs)) {
		// Skip the empty-set marker ('gk.empty-set-marker') and any malformed entries — only pull
		// genuine refs with names.
		if (ref == null || typeof ref !== 'object' || !('name' in ref) || typeof ref.name !== 'string') continue;
		if (!ref.name) continue;

		names.push(ref.name);
	}
	return names.length ? names : undefined;
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
