import type { GitWorktree } from '../models/worktree.js';

export function getWorktreeId(repoPath: string, name: string): string {
	return `${repoPath}|worktrees/${name}`;
}

export function groupWorktreesByBranch(
	worktrees: GitWorktree[],
	options?: { includeDefault?: boolean; worktreesByBranch?: Map<string, GitWorktree> },
): Map<string, GitWorktree> {
	const worktreesByBranch = options?.worktreesByBranch ?? new Map<string, GitWorktree>();
	if (worktrees == null) return worktreesByBranch;

	for (const wt of worktrees) {
		if (wt.branch == null || (!options?.includeDefault && wt.isDefault)) continue;

		worktreesByBranch.set(wt.branch.id, wt);
	}

	return worktreesByBranch;
}
