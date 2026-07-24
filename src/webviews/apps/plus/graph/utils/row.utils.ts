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
 * builds the `+HEAD`/`+worktreeHEAD` token) and the inline adornment (`gl-graph.react`), so the two
 * surfaces can't drift on which worktree they'd undo — or on the leaf rule.
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
