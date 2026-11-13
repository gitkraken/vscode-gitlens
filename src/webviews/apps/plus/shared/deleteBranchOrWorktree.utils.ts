import * as l10n from '@vscode/l10n';
import type { DeleteBranchOrWorktreeRefs } from '../../../shared/branchRefs.js';
import type { OverviewBranchLanded } from '../../../shared/overviewBranches.js';

/**
 * The label for `gitlens.deleteBranchOrWorktree`, naming what it will actually delete. It follows the command's own
 * rule (`deleteBranchOrWorktree`): a branch checked out in any worktree but the default one takes its worktree with
 * it, whichever window that worktree is open in. Anything else deletes only the branch.
 * - `local` reads "Delete Local Branch", for where the remote branch is gone and "local" says which one goes
 * - `named` returns a `{branch}` template, for `localizedContent`
 */
export function getDeleteBranchOrWorktreeLabel(
	worktree: { readonly isDefault: boolean } | false | undefined,
	form?: 'local' | 'named',
): string {
	const deletesWorktree = worktree != null && worktree !== false && !worktree.isDefault;
	switch (form) {
		case 'local':
			return deletesWorktree ? l10n.t('Delete Worktree') : l10n.t('Delete Local Branch');
		case 'named':
			return deletesWorktree ? l10n.t('Delete Worktree {branch}') : l10n.t('Delete Branch {branch}');
		default:
			return deletesWorktree ? l10n.t('Delete Worktree') : l10n.t('Delete Branch');
	}
}

/**
 * The evidence `gitlens.deleteBranchOrWorktree` gets for a landed branch, stamped with the tip it was decided for.
 * Only PR evidence may pre-select Force Delete; git evidence can't prove the work is safe to drop, so it only lets the
 * delete explain why the branch counts as merged.
 */
export function getDeleteBranchOrWorktreeEvidence(
	landed: OverviewBranchLanded | undefined,
): Pick<DeleteBranchOrWorktreeRefs, 'mergedPullRequest' | 'mergedByGit'> | undefined {
	if (landed?.tipSha == null) return undefined;
	if (landed.via === 'git') return { mergedByGit: { confidence: landed.confidence, sha: landed.tipSha } };

	return landed.pullRequest != null
		? { mergedPullRequest: { id: landed.pullRequest.id, sha: landed.tipSha } }
		: undefined;
}
