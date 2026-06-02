import type { GraphRepository } from '../../../../plus/graph/protocol.js';

/**
 * Resolves the filesystem PATH of the graph's selected repository from its comparison-key id.
 *
 * The id and the path coincide for `file://` repos but diverge on virtual/remote/vsls schemes, so
 * callers that need a real path (to build refs, resolve a repository service, etc.) must map id→path
 * rather than use the id directly. Falls back to the first repository's path when the selected id is
 * absent or not (yet) present in `repositories` (e.g. mid repo-switch).
 *
 * Single source of truth for the `selectedRepository → path` resolution that was previously inlined
 * across the graph webview (graph-wrapper, graph-app, on-demand context reconstruction). Note the
 * separate `commonPath`-based "repo family" resolution (graph-app `fallbackRepoFamily`) is a different
 * concept and intentionally not folded in here.
 */
export function getSelectedRepoPath(state: {
	repositories?: GraphRepository[];
	selectedRepository?: string;
}): string | undefined {
	const { repositories, selectedRepository } = state;
	if (selectedRepository != null) {
		const found = repositories?.find(r => r.id === selectedRepository)?.path;
		if (found != null) return found;
	}
	return repositories?.[0]?.path;
}
