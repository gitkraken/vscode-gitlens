import type { GraphScope, GraphWipMetadataBySha } from '../../../../plus/graph/protocol.js';

/**
 * Filters secondary worktree WIP metadata for the active scope: drops any entry whose worktree
 * branch isn't one of the scoped local refs (branchRef / additionalBranchRefs).
 *
 * `scope.upstreamRef` is deliberately not part of the match set — see the inline comment.
 *
 * Entries with `branchRef` undefined (detached worktrees) pass through — they have no branch
 * identity to compare against, so the graph component's SHA-based scope filter handles them.
 * That preserves prior behavior for detached worktrees that happen to be at scope anchor SHAs.
 *
 * When no scope is active, this is identity (returns the same reference).
 */
export function filterSecondariesForScope(
	wipMetadataBySha: GraphWipMetadataBySha | undefined,
	scope: GraphScope | undefined,
): GraphWipMetadataBySha | undefined {
	if (wipMetadataBySha == null || scope == null) return wipMetadataBySha;

	// Build the scope ref set once. `scope.upstreamRef` is intentionally excluded — it's a
	// `remotes/*` id, while non-detached worktrees always have a `heads/*` branchRef (git only
	// attaches worktrees to local branches), so the two can never collide. Detached worktrees
	// pass via the `meta.branchRef == null` fall-through below and defer to the graph
	// component's SHA filter.
	const scopeRefs = new Set<string>();
	scopeRefs.add(scope.branchRef);
	if (scope.additionalBranchRefs != null) {
		for (const ref of scope.additionalBranchRefs) {
			scopeRefs.add(ref);
		}
	}

	const result: GraphWipMetadataBySha = {};
	let dropped = false;
	for (const [sha, meta] of Object.entries(wipMetadataBySha)) {
		if (meta.branchRef != null && !scopeRefs.has(meta.branchRef)) {
			dropped = true;
			continue;
		}
		result[sha] = meta;
	}
	return dropped ? result : wipMetadataBySha;
}
