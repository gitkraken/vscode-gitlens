import { hasKeys } from '@gitlens/utils/object.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { GraphIncludeOnlyRefs, GraphScope, GraphWipMetadataBySha } from '../../../../plus/graph/protocol.js';

/**
 * Filters secondary worktree WIP metadata for the active scope: keeps only entries whose
 * worktree branch is one of the scoped local refs (`branchRef` / `additionalBranchRefs`).
 *
 * `scope.upstreamRef` is deliberately not part of the match set — it's a `remotes/*` id, while
 * non-detached worktrees always have a `heads/*` `branchRef` (git only attaches worktrees to
 * local branches), so the two can never collide.
 *
 * Detached worktrees (`branchRef == null`) are DROPPED under an active scope — they have no
 * branch identity to attribute to the scoped branch, and surfacing them as a second WIP row
 * adjacent to the scoped worktree's WIP confuses the picture. The graph component's SHA-based
 * scope filter would otherwise re-introduce them whenever a detached worktree's HEAD happens
 * to be in the scoped window, producing a stray "Working Changes (…)" row that isn't on the
 * scoped branch.
 *
 * Trade-off: a worktree intentionally checked out to a SHA on the scoped branch's history
 * (release-inspection workflows) is now invisible under scope. To re-allow it we'd need to
 * either (a) plumb the scope's loaded-ancestry set down to this filter and gate on parentSha
 * membership, or (b) gate on the scope's anchor SHAs (`mergeBase.sha`, `mergeTargetTipSha`,
 * `focalBranchTipSha`) which is cheaper but stricter. Deferred — the stray-row UX issue this
 * solves is more common than the explicit-checkout workflow it regresses.
 *
 * When no scope is active, this is identity (returns the same reference).
 */
export function filterSecondariesForScope(
	wipMetadataBySha: GraphWipMetadataBySha | undefined,
	scope: GraphScope | undefined,
): GraphWipMetadataBySha | undefined {
	if (wipMetadataBySha == null || scope == null) return wipMetadataBySha;

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
		if (meta.branchRef == null || !scopeRefs.has(meta.branchRef)) {
			dropped = true;
			continue;
		}

		result[sha] = meta;
	}
	return dropped ? result : wipMetadataBySha;
}

/**
 * Determines whether the primary "Working Changes" row (for the current worktree's branch)
 * should render under the active scope + `branchesVisibility` filters.
 *
 * Scope check (runs first): when a scope is active and its focal branch (`scope.branchRef`)
 * isn't the branch HEAD points at, the primary WIP is hidden. The Working Changes row is
 * anchored to HEAD, so it only "belongs" to the scoped branch when the scoped branch is the
 * one HEAD points at — see `getOverviewBranchSelectionSha` for the matching selection-side
 * convention. `additionalBranchRefs` deliberately does NOT count: the primary WIP only
 * attributes to the focal branch. In a detached-HEAD-plus-scope state this returns false —
 * with no current branch there's nothing to attribute the WIP to.
 *
 * `branchesVisibility` check (runs after scope):
 * - `'all'` (and absent): always show.
 * - `'current'`, `'smart'`, `'favorited'`: these modes always include the current branch by
 *   construction, so this returns true in normal cases.
 * - `'agents'`: only shows if the current branch is in the host-computed include set
 *   (i.e. an active agent is running on the current branch's worktree).
 *
 * Empty `{}` is treated as "no filter" — same convention as `filterSecondariesForIncludeOnlyRefs`.
 * If the current branch id is unknown (detached HEAD under a non-`'all'` `branchesVisibility`
 * filter with no `scope` active), defaults to showing the primary — the user's local WIP
 * still matters even when there's no branch to match against.
 */
export function shouldShowPrimaryWipRow(
	branchesVisibility: GraphBranchesVisibility | undefined,
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined,
	currentBranchId: string | undefined,
	scope: GraphScope | undefined,
): boolean {
	// Scope guard runs first — the Working Changes row is anchored to HEAD, so it only
	// "belongs" to the scoped branch when the scoped branch is the one HEAD points at.
	// Without this gate, the GK component keeps the primary WIP in any descendant-branch
	// scope (HEAD's sha is in the visible ancestor set) and surfaces the current branch's
	// WIP under a branch it doesn't belong to. `additionalBranchRefs` deliberately does
	// NOT count — convention is "focal branch only" (matches `getOverviewBranchSelectionSha`).
	// Detached HEAD under an active scope returns false too — no branch to attribute WIP to.
	if (scope != null && scope.branchRef !== currentBranchId) return false;

	if (branchesVisibility == null || branchesVisibility === 'all') return true;
	if (includeOnlyRefs == null) return true;
	if (currentBranchId == null) return true; // detached HEAD fallback — keep primary visible
	if (!hasKeys(includeOnlyRefs)) return true; // empty `{}` = "no filter"
	return includeOnlyRefs[currentBranchId] != null;
}

/**
 * Composes `filterSecondariesForScope` with `filterSecondariesForIncludeOnlyRefs`, with one
 * important wrinkle: when a `scope` is active, the visibility filter is **skipped**. The active
 * scope is explicit user intent — `filterSecondariesForScope` already pinned the set to the
 * user's chosen ref(s), so applying the implicit `branchesVisibility` filter on top would drop
 * the scoped worktree's WIP under non-`'all'` modes (e.g. scoping to `main` from a
 * `gitlens-debug` worktree under `'current'`/`'agents'` where `main` isn't in `includeOnlyRefs`).
 * Mirrors the GK component's row scope walk, which also bypasses `includeOnlyRefs` once scoped.
 *
 * When no scope is active, both filters apply as usual.
 */
export function filterSecondariesForScopeAndVisibility(
	wipMetadataBySha: GraphWipMetadataBySha | undefined,
	scope: GraphScope | undefined,
	branchesVisibility: GraphBranchesVisibility | undefined,
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined,
): GraphWipMetadataBySha | undefined {
	const scoped = filterSecondariesForScope(wipMetadataBySha, scope);
	if (scope != null) return scoped;
	return filterSecondariesForIncludeOnlyRefs(scoped, branchesVisibility, includeOnlyRefs);
}

/**
 * Filters secondary worktree WIP metadata for the active `branchesVisibility` mode: drops any
 * entry whose worktree branch isn't part of the host-computed `includeOnlyRefs` set. Mirrors
 * `filterSecondariesForScope`'s detached-worktree fall-through — entries with `branchRef`
 * undefined pass through and defer to the graph component's SHA filter.
 *
 * No-op when `branchesVisibility` is `'all'` (or absent), when `includeOnlyRefs` is undefined,
 * or when `includeOnlyRefs` is an empty object (the host's "no filter" sentinel, distinct from
 * the `gk.empty-set-marker` "include nothing" sentinel which has one entry).
 *
 * The `gk.empty-set-marker` empty-state case is handled implicitly: its key is not a real
 * branch ref, so every entry with a real `branchRef` gets dropped.
 */
export function filterSecondariesForIncludeOnlyRefs(
	wipMetadataBySha: GraphWipMetadataBySha | undefined,
	branchesVisibility: GraphBranchesVisibility | undefined,
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined,
): GraphWipMetadataBySha | undefined {
	if (wipMetadataBySha == null) return wipMetadataBySha;
	if (branchesVisibility == null || branchesVisibility === 'all') return wipMetadataBySha;
	if (includeOnlyRefs == null) return wipMetadataBySha;

	const refIds = new Set(Object.keys(includeOnlyRefs));
	// Empty `{}` means "no filter" (graph shows all) — match that semantics here so we don't
	// silently drop every WIP row in detached-HEAD smart/current modes where the host returns
	// `{ refs: {} }` because there's no current branch to anchor on.
	if (!refIds.size) return wipMetadataBySha;

	const result: GraphWipMetadataBySha = {};
	let dropped = false;
	for (const [sha, meta] of Object.entries(wipMetadataBySha)) {
		if (meta.branchRef != null && !refIds.has(meta.branchRef)) {
			dropped = true;
			continue;
		}

		result[sha] = meta;
	}
	return dropped ? result : wipMetadataBySha;
}
