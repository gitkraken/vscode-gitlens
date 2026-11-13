import * as l10n from '@vscode/l10n';

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
