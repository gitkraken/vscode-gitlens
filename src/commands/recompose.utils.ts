import { window } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { Container } from '../container.js';
import { create as createWorktree } from '../git/actions/worktree.js';
import type { GitRepositoryService } from '../git/gitRepositoryService.js';
import { getBranchWorktree } from '../git/utils/-webview/branch.utils.js';
import { getReferenceFromBranch } from '../git/utils/-webview/reference.utils.js';

/**
 * Resolves the worktree a recompose should run in: the branch's own worktree (primary or
 * secondary), or one created on demand for a branch with no worktree. Returns `undefined` when
 * the user declines or cancels the worktree creation.
 */
export async function resolveRecomposeAnchor(
	container: Container,
	branch: GitBranch,
): Promise<{ svc: GitRepositoryService; worktreePath: string } | undefined> {
	let worktree = await getBranchWorktree(container, branch);
	if (worktree == null) {
		const create = { title: 'Create Worktree' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`Branch '${branch.name}' isn't checked out. Create a worktree to recompose it?`,
			{ modal: true },
			create,
			cancel,
		);
		if (result !== create) return undefined;

		worktree = await createWorktree(branch.repoPath, undefined, getReferenceFromBranch(branch));
		if (worktree == null) return undefined;
	}

	const repo = await container.git.getOrAddRepository(worktree.uri, { opened: false, detectNested: true });
	if (repo == null) return undefined;

	return { svc: repo.git, worktreePath: worktree.path };
}
