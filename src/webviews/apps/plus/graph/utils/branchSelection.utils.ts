import type { GraphRow } from '@gitkraken/gitkraken-components';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { hasKeys } from '@gitlens/utils/object.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { GraphIncludeOnlyRefs, GraphWipMetadataBySha } from '../../../../plus/graph/protocol.js';
import { createSecondaryWipSha } from '../../../../plus/graph/protocol.js';

export interface SelectionContext {
	wipMetadataBySha: GraphWipMetadataBySha | undefined;
	rows: readonly GraphRow[] | undefined;
	branchesVisibility: GraphBranchesVisibility | undefined;
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined;
}

/** Minimal shape `getOverviewBranchSelectionSha` reads from a branch — declared narrowly so the
 *  header-popover fallback path can synthesize a stand-in from a `branchName + repoPath` and
 *  route through the same helper as the overview-card path. */
export interface SelectionBranch {
	id: string;
	repoPath: string;
	opened: boolean;
	reference: { sha?: string };
	worktree?: { path: string };
}

/** Returns the graph-row SHA to select when the user picks a branch from a webview-side panel
 *  (overview cards, agents sidebar, header popover, etc.). Cascade:
 *    1. Secondary worktree (path differs from `branch.repoPath`) AND a `wipMetadataBySha` entry
 *       for that path exists AND its `parentSha` is in loaded rows → that worktree's WIP row.
 *    2. `wipMetadataBySha` has any entry whose `branchRef` matches `branch.id` AND its
 *       `parentSha` is in loaded rows → that worktree's WIP row. Picks up worktree WIPs whose
 *       OverviewBranch lost its `worktree` field at the graph-provider boundary (the host
 *       strips the default worktree from `worktreesByBranch`), so case (1) misses them.
 *    3. Scoped branch IS the currently-opened branch AND the primary "Working Changes" row
 *       will actually render under the active `branchesVisibility` / `includeOnlyRefs` →
 *       `uncommitted`. The visibility check predicts whether the wrapper's `showPrimary` will
 *       be true; without it, the cascade returned an unrenderable WIP sha under restrictive
 *       modes (`'agents'` / `'current'` / `'favorited'`) where the open branch isn't in the
 *       include set — `ensureAndSelectCommit` would retry 10 RAFs and silently give up.
 *    4. Otherwise → the branch's tip commit.
 *
 *  The "parentSha in loaded rows" gate on (1) and (2) prevents the same silent-failure mode:
 *  the wrapper drops a WIP row from `decoratedRows` when its parent isn't anchorable, so
 *  handing back the unselectable WIP sha would spin the retry without any visible outcome.
 *
 *  Returns `undefined` only when the branch has no resolvable tip — callers treat that as a
 *  no-op navigation. */
export function getOverviewBranchSelectionSha(branch: SelectionBranch, ctx: SelectionContext): string | undefined {
	const { wipMetadataBySha, rows, branchesVisibility, includeOnlyRefs } = ctx;
	const loadedShas: Set<string> | undefined = rows != null ? new Set(rows.map(r => r.sha)) : undefined;

	if (branch.worktree != null && branch.worktree.path !== branch.repoPath) {
		const wipSha = createSecondaryWipSha(branch.worktree.path);
		const meta = wipMetadataBySha?.[wipSha];
		// Require BOTH a known anchor AND the anchor in loaded rows — without metadata we can't
		// promise the synthetic row exists in `decoratedRows`, and the `meta == null` short-
		// circuit would otherwise hand back an unselectable sha that `ensureAndSelectCommit`
		// spins 10 RAFs trying to find. Falls through to case (2) / tip when metadata is cold.
		if (meta != null && (loadedShas == null || loadedShas.has(meta.parentSha))) {
			return wipSha;
		}
	}

	if (wipMetadataBySha != null) {
		for (const [sha, meta] of Object.entries(wipMetadataBySha)) {
			if (meta.branchRef !== branch.id) continue;
			if (loadedShas != null && !loadedShas.has(meta.parentSha)) continue;

			return sha;
		}
	}

	// `branch.opened === true` means the scoped branch is the current (primary worktree) branch.
	// The primary "Working Changes" row only renders when the wrapper's `shouldShowPrimaryWipRow`
	// returns true — predict the same gate here so we never return `uncommitted` when the row
	// won't actually exist. Mirrors the logic in `src/webviews/apps/plus/graph/utils/wip.utils.ts`.
	if (branch.opened && willRenderPrimaryWipRow(branchesVisibility, includeOnlyRefs, branch.id)) {
		return uncommitted;
	}

	return branch.reference.sha;
}

/** Predicts whether the wrapper's `shouldShowPrimaryWipRow` will be true for the active scope —
 *  inlined here (instead of importing) to keep the visibility logic close to the selection
 *  cascade that depends on it. Assumes the user is scoping TO `branchId` (so the scope guard's
 *  `scope.branchRef !== currentBranchId` rejection wouldn't fire). Keep in sync with
 *  `shouldShowPrimaryWipRow` in `wip.utils.ts`. */
function willRenderPrimaryWipRow(
	branchesVisibility: GraphBranchesVisibility | undefined,
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined,
	currentBranchId: string | undefined,
): boolean {
	if (branchesVisibility == null || branchesVisibility === 'all') return true;
	if (includeOnlyRefs == null) return true;
	if (currentBranchId == null) return true; // detached HEAD fallback — match `shouldShowPrimaryWipRow`
	if (!hasKeys(includeOnlyRefs)) return true;
	return includeOnlyRefs[currentBranchId] != null;
}
