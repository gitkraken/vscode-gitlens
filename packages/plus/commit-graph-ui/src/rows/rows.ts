import type { CommitGraphSourceRow } from '../contracts/rows.js';

/**
 * Returns the committer-date for a graph row. The provider (`packages/git-cli/src/providers/graph.ts`)
 * always populates `commitDate` with the committer date — `row.date` itself follows the user's
 * commit-ordering setting (committer or author). The minimap (and any timeline-anchored visual) should
 * pin to committer date so a rebased commit doesn't teleport backward to its original author date.
 */
export function getCommitDateFromRow(row: { date: number; commitDate?: number }): number {
	return row.commitDate ?? row.date;
}

/**
 * Decides whether a row survives the branches-visibility + hidden-ref filter
 * (`filterRowsByRefVisibility` in `gl-commit-graph.ts`), given the shas reachable from the mode's visible
 * ref tips (`collectReachable` over `collectVisibleRefTips`'s seeds).
 *
 * - `workdir` (WIP) rows always survive, unconditionally — see the "WIP rows deliberately bypass
 *   `isVisible`/`add`" comment in `refFind.utils.ts`; the same exemption applies here.
 * - The current HEAD's own row always survives too, but only the ROW — it anchors "you are here"
 *   regardless of the mode. Its ancestry is NOT auto-included: `collectVisibleRefTips` seeds the
 *   reachability walk from HEAD only when it's genuinely in the mode's include set, so a mode built to
 *   exclude HEAD's branch still can.
 * - `stash` rows survive iff their BASE commit is reachable. The provider (`git-cli/providers/graph.ts`)
 *   truncates a stash row's `parents` to exactly one entry — the commit the stash was taken on top of,
 *   dropping the index/untracked synthetic parents `git stash` also records — so `parents[0]` IS the
 *   base commit. A stash whose base is filtered out would otherwise render with its parent commit gone,
 *   a dangling row/lane — the same hazard `excludeTypes.stashes` avoids by dropping stash rows from the
 *   engine input outright.
 * - `commit`/`merge` rows survive iff their own sha is reachable.
 */
export function keepRowUnderRefVisibility(
	row: Pick<CommitGraphSourceRow, 'kind' | 'sha' | 'parents' | 'heads'>,
	reachable: ReadonlySet<string>,
): boolean {
	if (row.kind === 'workdir') return true;
	if (row.heads?.some(h => h.isCurrentHead)) return true;

	if (row.kind === 'stash') return row.parents[0] != null && reachable.has(row.parents[0]);

	return reachable.has(row.sha);
}

/**
 * Picks the _Undo Commit_ target for a commit row from its heads. Eligibility:
 * - The commit must be a **leaf** — `hasChildren` must be false. Undoing a commit that other work is
 *   stacked on (an ancestor of another ref) is unsafe: `reset --soft HEAD~1` would drop it from its
 *   branch while descendants still embed it, breaking the stack on re-commit. Only a tip nothing
 *   builds on is safely undoable. When `hasChildren` is true, returns neither head.
 * - The active worktree always wins (`currentHead` ⇒ undo targets the active workspace, no `worktreePath`).
 * - Otherwise a worktree HEAD qualifies only when EXACTLY ONE worktree owns this tip — multiple worktree
 *   HEADs on the same sha are ambiguous (no way to pick one), so we surface no undo affordance there.
 *
 * Shared by the on-demand right-click context builder (`rowContext.utils.buildRowCommitContext`, which
 * builds the `+HEAD`/`+worktreeHEAD` token) and the inline row adornment, so the two surfaces can't
 * drift on which worktree they'd undo — or on the leaf rule.
 *
 * Generic over the head shape so both the full `GitGraphRowHead[]` and the lean row-context head shape
 * can be passed directly.
 */
export function pickRowUndoTarget<T extends { isCurrentHead?: boolean; worktree?: { path: string } | undefined }>(
	heads: ReadonlyArray<T> | undefined,
	hasChildren: boolean,
): { currentHead: T | undefined; worktreeHead: T | undefined } {
	if (hasChildren) return { currentHead: undefined, worktreeHead: undefined };

	const currentHead = heads?.find(h => h.isCurrentHead);
	const worktreeHeads = currentHead == null ? heads?.filter(h => h.worktree != null) : undefined;
	const worktreeHead = worktreeHeads?.length === 1 ? worktreeHeads[0] : undefined;
	return { currentHead: currentHead, worktreeHead: worktreeHead };
}
