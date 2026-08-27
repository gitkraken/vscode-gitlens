import { basename } from '@gitlens/utils/path.js';
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
 * separate `commonPath`-based "repo family" resolution is a different concept and intentionally not
 * folded in here — see {@link getSelectedRepoFamily} (this fallback-permissive variant) and graph-app's
 * stricter `fallbackRepoFamily` (drops the fallback).
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
 * intentionally keeps this function's fallback — it's used for view-identity stability, where
 * answering with the first repo during a mid-switch window is the safe default, same as this function.
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

/**
 * Counts the repositories the user actually has OPEN — every entry except the bound-but-closed one the
 * host appends during a rebind ({@link GraphRepository.closed}, stamped only there).
 *
 * This is what "can the user switch repositories" means, and it matches the picker's own list: worktrees
 * the user opened as workspace folders are separate entries AND real switch targets, so they count. Only
 * the injected entry — a worktree the graph was rebound onto that was never opened — is excluded, since
 * it exists to name `selectedRepository`, not to offer a choice the user made.
 */
export function countOpenRepositories(repositories: GraphRepository[] | undefined): number {
	if (!repositories?.length) return 0;

	let count = 0;
	for (const repo of repositories) {
		if (!repo.closed) {
			count++;
		}
	}
	return count;
}

/**
 * Display name for a worktree path — the matching `repositories` entry's `name` when the webview knows it
 * (worktrees surface as their own entries there), falling back to the path's basename (mirroring
 * `overviewBarController`'s `primaryFallbackLabel` and the sidebar worktree tree's fallback).
 */
export function worktreeDisplayName(repositories: GraphRepository[] | undefined, path: string): string {
	return repositories?.find(repo => repo.path === path)?.name ?? basename(path);
}
