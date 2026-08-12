import type { State } from '../../../../plus/graph/protocol.js';

export function resolveScopeToBranchTarget(
	branch: State['branch'],
	repoPath: string | undefined,
): { branch: NonNullable<State['branch']>; repoPath: string } | undefined {
	if (branch == null || branch.detached || repoPath == null) return undefined;

	return { branch: branch, repoPath: repoPath };
}

export function shouldDrainParkedScopeToBranch(
	pending: boolean,
	branch: State['branch'],
	repoPath: string | undefined,
): boolean {
	return pending && resolveScopeToBranchTarget(branch, repoPath) != null;
}
