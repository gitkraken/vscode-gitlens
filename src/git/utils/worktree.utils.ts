export function getWorktreeId(repoPath: string, name: string): string {
	return `${repoPath}|worktrees/${name}`;
}
