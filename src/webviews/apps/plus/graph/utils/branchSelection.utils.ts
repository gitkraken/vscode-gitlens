import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GraphWorkingTreeStats } from '../../../../plus/graph/protocol.js';
import { createSecondaryWipSha } from '../../../../plus/graph/protocol.js';
import type { OverviewBranch } from '../../../../shared/overviewBranches.js';

/** Returns the graph-row SHA to select when the user picks a branch from a webview-side panel
 *  (overview cards, agents sidebar, etc.). Cascade matches the rules everywhere graph navigation
 *  for a branch fires:
 *    1. Secondary worktree (path differs from `branch.repoPath`) → that worktree's WIP row.
 *    2. Scoped branch IS the currently-opened branch AND has working changes → primary WIP
 *       (`uncommitted`). The Working Changes row is anchored to HEAD, so it only "belongs" to
 *       the scoped branch when the scoped branch is the one HEAD points at — even though the GK
 *       component visually injects the row at the top of any scoped graph.
 *    3. Otherwise → the branch's tip commit.
 *  Returns `undefined` only when the branch has no resolvable tip (e.g. the cheap reference is
 *  missing a sha) — callers treat that as a no-op navigation. */
export function getOverviewBranchSelectionSha(
	branch: OverviewBranch,
	workingTreeStats: GraphWorkingTreeStats | undefined,
): string | undefined {
	if (branch.worktree != null && branch.worktree.path !== branch.repoPath) {
		return createSecondaryWipSha(branch.worktree.path);
	}

	// After the worktree check, `branch.opened === true` means the scoped branch is the current
	// (primary worktree) branch — so `workingTreeStats` (the primary repo's WIP) is this branch's
	// WIP. Skipping this gate would select the primary WIP row whenever HEAD has uncommitted
	// changes — wrong for any scope where the focal branch isn't current.
	if (
		branch.opened &&
		workingTreeStats != null &&
		workingTreeStats.added + workingTreeStats.modified + workingTreeStats.deleted > 0
	) {
		return uncommitted;
	}

	return branch.reference.sha;
}
