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
 * separate `commonPath`-based "repo family" resolution is a different concept, deliberately not folded in
 * here — see {@link getSelectedRepoFamily}.
 */
export function getSelectedRepoPath(state: {
	repositories?: GraphRepository[];
	selectedRepository?: string;
}): string | undefined {
	return getSelectedRepo(state)?.path;
}

/**
 * Resolves the graph's selected repository, falling back to the first when the selected id is absent
 * or not (yet) present in `repositories` (e.g. mid repo-switch).
 *
 * Note the deliberately STRICTER variants elsewhere, which must not be folded in here: the kanban's
 * `effectiveRepo` and graph-app's `fallbackRepoFamily` drop the fallback so a stale id resolves to
 * `undefined` rather than silently answering for the wrong repo. {@link getSelectedRepoFamily} below
 * deliberately keeps this fallback: it's used for view-identity stability, where answering with the first
 * repo during a mid-switch window is the safe default.
 */
export function getSelectedRepo(state: {
	repositories?: GraphRepository[];
	selectedRepository?: string;
}): GraphRepository | undefined {
	const { repositories, selectedRepository } = state;
	if (selectedRepository != null) {
		const found = repositories?.find(r => r.id === selectedRepository);
		if (found != null) return found;
	}
	return repositories?.[0];
}

/**
 * Resolves the "repository family" identity of the graph's selected repository —
 * {@link GraphRepository.commonPath} when it's a worktree, otherwise its own path (mirrors
 * `commonPath ?? path`, the "same repo family" comparison documented on `RepositoryShape`).
 *
 * Unlike {@link getSelectedRepoPath}, this is stable across a same-family rebind: a worktree and its
 * main repo (or two sibling worktrees) resolve to the SAME family value even though `selectedRepository`
 * and `path` themselves change. Client state that should survive a rebind unchanged — rather than reset
 * as if the dataset were a different repo — keys on this instead of the literal path.
 */
export function getSelectedRepoFamily(state: {
	repositories?: GraphRepository[];
	selectedRepository?: string;
}): string | undefined {
	const repo = getSelectedRepo(state);
	return repo?.commonPath ?? repo?.path;
}
