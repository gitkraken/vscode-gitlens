import type { GraphScope } from '../../../../plus/graph/protocol.js';

/**
 * Re-stamps a `${repoPath}|...` id (e.g. `getBranchId`'s output) from one repo path onto another.
 *
 * Used when a same-family rebind (a worktree ↔ its main repo, or two sibling worktrees) swaps which
 * binding the graph renders from: the underlying commit graph is shared, so an id naming a branch by
 * the OLD path is still the same branch under the NEW one — only the path component needs to move.
 *
 * Matches on the exact `${fromRepoPath}|` prefix (including the delimiter), so a path that merely
 * starts with `fromRepoPath` as a string (e.g. `/repo2` against `/repo`) is never mistaken for it.
 * Ids that don't carry the `fromRepoPath` prefix at all are returned unchanged.
 */
export function restampId(id: string, fromRepoPath: string, toRepoPath: string): string {
	const prefix = `${fromRepoPath}|`;
	if (!id.startsWith(prefix)) return id;

	return `${toRepoPath}${id.slice(fromRepoPath.length)}`;
}

/**
 * Re-stamps a {@link GraphScope}'s repoPath-embedded ref ids (`branchRef`, `additionalBranchRefs`,
 * `upstreamRef`) from one repo path onto another for a same-family rebind. Everything else is
 * preserved as-is:
 * - `origin` is deliberately not part of the scope's refresh identity (see its own doc comment) and
 *   isn't a repoPath-embedded id, so it carries over unchanged.
 * - `focalBranchTipSha`/`mergeTargetTipSha`/`mergeBase.sha` are commit SHAs, family-stable by
 *   construction (the family shares one commit graph) — no re-stamping needed or correct to do.
 */
export function restampScope(scope: GraphScope, fromRepoPath: string, toRepoPath: string): GraphScope {
	if (fromRepoPath === toRepoPath) return scope;

	return {
		...scope,
		branchRef: restampId(scope.branchRef, fromRepoPath, toRepoPath),
		// Conditionally spread rather than assigning `undefined` outright — an absent optional field must
		// stay absent (not become a present key holding `undefined`) so the re-stamped scope's shape
		// exactly mirrors the input's.
		...(scope.upstreamRef != null
			? { upstreamRef: restampId(scope.upstreamRef, fromRepoPath, toRepoPath) }
			: undefined),
		...(scope.additionalBranchRefs != null
			? {
					additionalBranchRefs: scope.additionalBranchRefs.map(ref =>
						restampId(ref, fromRepoPath, toRepoPath),
					),
				}
			: undefined),
	};
}
