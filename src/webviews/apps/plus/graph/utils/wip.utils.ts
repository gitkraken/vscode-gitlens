import { hasKeys } from '@gitlens/utils/object.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type {
	GraphIncludeOnlyRefs,
	GraphScope,
	GraphWipRowsById,
	WorkDirStats,
} from '../../../../plus/graph/protocol.js';

/** Whether `stats` describes a working tree with anything in it. Shared so the WIP bar's pill, the node
 *  glyph, and the merge's probe/counts contradiction check can never disagree about what "dirty" means —
 *  `renamed` is optional and was the field the three used to differ on. */
export function hasDirtyCounts(stats: Partial<WorkDirStats> | undefined): boolean {
	if (stats == null) return false;

	return (stats.added ?? 0) + (stats.modified ?? 0) + (stats.deleted ?? 0) + (stats.renamed ?? 0) > 0;
}

/**
 * NOTE: callers pass the NON-PRIMARY partition of `wipRowsById`. The graph's own worktree's row has
 * its own visibility rule ({@link shouldShowPrimaryWipRow}) — it is anchored to HEAD rather than to a
 * branch it can be attributed to, so running it through the branch-ref match below would answer the
 * wrong question.
 *
 * Filters PEER (non-primary) worktree WIP rows for the active scope: keeps only entries whose
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
	wipRows: GraphWipRowsById | undefined,
	scope: GraphScope | undefined,
): GraphWipRowsById | undefined {
	if (wipRows == null || scope == null) return wipRows;

	const scopeRefs = new Set<string>();
	scopeRefs.add(scope.branchRef);
	if (scope.additionalBranchRefs != null) {
		for (const ref of scope.additionalBranchRefs) {
			scopeRefs.add(ref);
		}
	}

	const result: GraphWipRowsById = {};
	let dropped = false;
	for (const [sha, meta] of Object.entries(wipRows)) {
		if (meta.branchRef == null || !scopeRefs.has(meta.branchRef)) {
			dropped = true;
			continue;
		}

		result[sha] = meta;
	}
	return dropped ? result : wipRows;
}

/**
 * Answers, from the rows alone, whether the scope's focal branch tip is the row HEAD points at —
 * the question `scope.branchRef === branch.id` is only ever a proxy for. `isCurrentHead` comes from
 * the rows' `%D` decoration, which travels on a different channel from `state.branch`, so this still
 * resolves while the branch payload is missing (see {@link shouldShowPrimaryWipRow}).
 *
 * Reads the FOCAL head's own `isCurrentHead`, not the row's — branches sharing a tip put several
 * heads on one row, so "some head here is current" would let a scope on `feature` inherit `main`'s
 * answer (and with it `main`'s working changes) whenever the two point at the same commit.
 *
 * Returns `undefined` only when genuinely undecidable: no scope, or the focal tip row isn't loaded
 * AND no loaded row claims HEAD. If the focal tip is missing but some other row IS HEAD, that's
 * proof enough the focal branch isn't it, so the answer is `false` rather than a shrug — otherwise
 * the caller defaults to showing and leaks the current branch's WIP under the unloaded scope.
 */
export function isScopeFocalHead(
	rows: readonly { heads?: { name: string; isCurrentHead?: boolean }[] }[] | undefined,
	scope: GraphScope | undefined,
): boolean | undefined {
	if (rows == null || scope?.branchName == null) return undefined;

	let sawCurrentHead = false;
	for (const row of rows) {
		const heads = row.heads;
		if (heads == null || heads.length === 0) continue;

		const focalHead = heads.find(h => h.name === scope.branchName);
		if (focalHead != null) return focalHead.isCurrentHead === true;

		if (!sawCurrentHead && heads.some(h => h.isCurrentHead)) {
			sawCurrentHead = true;
		}
	}

	return sawCurrentHead ? false : undefined;
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
 * attributes to the focal branch. A detached HEAD hides it too — no branch to attribute to.
 *
 * The scope check needs a KNOWN current branch: `state.branch` ships only on full-state pushes and
 * writes through unguarded (an errored `getBranch()` sends `branch: undefined`) while `scope` is a
 * webview-local signal, so the two can disagree for a push. Treating unknown as a mismatch deleted the
 * row until the next full state, and only while scoped — so instead the caller answers the same
 * question straight from the rows via `scopeFocalIsHead`: is the scope's focal branch tip the row HEAD
 * points at? That's what `branch.id` was ever a proxy for, and the rows carry it independently of the
 * branch payload. Only when the rows can't answer either do we fall through to the visibility checks
 * (which already default to showing).
 *
 * An established focal === current SHORT-CIRCUITS to visible: focusing a branch is explicit intent
 * and outranks the implicit `branchesVisibility` filter, matching what
 * `filterSecondariesForScopeAndVisibility` already does for worktree WIP rows.
 *
 * `branchesVisibility` check (runs after scope, and only when focus didn't already decide):
 * - `'all'` (and absent): always show.
 * - `'current'`, `'smart'`, `'favorited'`: these modes always include the current branch by
 *   construction, so this returns true in normal cases.
 * - `'agents'`: only shows if the current branch is in the host-computed include set
 *   (i.e. an active agent is running on the current branch's worktree).
 *
 * Empty `{}` is treated as "no filter" — same convention as `filterSecondariesForIncludeOnlyRefs`.
 * If the current branch id is unknown, defaults to showing the primary — the user's local WIP
 * still matters even when there's no branch to match against.
 */
export function shouldShowPrimaryWipRow(
	branchesVisibility: GraphBranchesVisibility | undefined,
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined,
	currentBranch: { id?: string; name: string; detached?: boolean } | undefined,
	scope: GraphScope | undefined,
	scopeFocalIsHead?: boolean,
): boolean {
	const currentBranchId = currentBranch?.id;

	// Scope guard runs first — the Working Changes row is anchored to HEAD, so it only
	// "belongs" to the scoped branch when the scoped branch is the one HEAD points at.
	// Without this gate, the GK component keeps the primary WIP in any descendant-branch
	// scope (HEAD's sha is in the visible ancestor set) and surfaces the current branch's
	// WIP under a branch it doesn't belong to. `additionalBranchRefs` deliberately does
	// NOT count — convention is "focal branch only" (matches `getOverviewBranchSelectionSha`).
	if (scope != null) {
		let focalIsCurrent: boolean;
		if (currentBranch != null) {
			// Detached HEAD points at no branch, so nothing for the scoped branch to claim. The host's
			// resolved flag, never a name test — a detached name is the synthesized `(sha…)` label, but
			// `(release)` is a legal branch name that the same test would wrongly condemn.
			if (currentBranch.detached) return false;
			if (scope.branchRef !== currentBranchId) return false;

			focalIsCurrent = true;
		} else {
			// Branch unknown, but the rows answer the same question directly.
			if (scopeFocalIsHead === false) return false;

			focalIsCurrent = scopeFocalIsHead === true;
		}

		// Focusing a branch is explicit user intent and outranks the implicit `branchesVisibility`
		// filter — the same rule `filterSecondariesForScopeAndVisibility` already applies to worktree
		// WIP rows. Without it, focusing your own branch under `agents` mode still hid your working
		// changes whenever no agent happened to be running on it. Only once focal === current is
		// actually established; "can't tell" falls through to the visibility checks below.
		if (focalIsCurrent) return true;
	}

	if (branchesVisibility == null || branchesVisibility === 'all') return true;
	if (includeOnlyRefs == null) return true;
	if (currentBranchId == null) return true; // unknown current branch — keep primary visible
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
	wipRows: GraphWipRowsById | undefined,
	scope: GraphScope | undefined,
	branchesVisibility: GraphBranchesVisibility | undefined,
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined,
): GraphWipRowsById | undefined {
	const scoped = filterSecondariesForScope(wipRows, scope);
	if (scope != null) return scoped;
	return filterSecondariesForIncludeOnlyRefs(scoped, branchesVisibility, includeOnlyRefs);
}

/**
 * Filters PEER (non-primary) worktree WIP rows for the active `branchesVisibility` mode: drops any
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
	wipRows: GraphWipRowsById | undefined,
	branchesVisibility: GraphBranchesVisibility | undefined,
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined,
): GraphWipRowsById | undefined {
	if (wipRows == null) return wipRows;
	if (branchesVisibility == null || branchesVisibility === 'all') return wipRows;
	if (includeOnlyRefs == null) return wipRows;

	const refIds = new Set(Object.keys(includeOnlyRefs));
	// Empty `{}` means "no filter" (graph shows all) — match that semantics here so we don't
	// silently drop every WIP row in detached-HEAD smart/current modes where the host returns
	// `{ refs: {} }` because there's no current branch to anchor on.
	if (!refIds.size) return wipRows;

	const result: GraphWipRowsById = {};
	let dropped = false;
	for (const [sha, meta] of Object.entries(wipRows)) {
		if (meta.branchRef != null && !refIds.has(meta.branchRef)) {
			dropped = true;
			continue;
		}

		result[sha] = meta;
	}
	return dropped ? result : wipRows;
}
