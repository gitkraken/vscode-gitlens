import { filterMap } from '../../system/iterable';
import { PageableResult } from '../../system/paging';
import type { GitBranch } from './branch';
import type { Repository } from './repository';
import type { GitWorktree } from './worktree';

export function getOpenedWorktreesByBranch(
	worktreesByBranch: Map<string, GitWorktree> | undefined,
): Set<string> | undefined {
	let openedWorktreesByBranch: Set<string> | undefined;
	if (worktreesByBranch?.size) {
		openedWorktreesByBranch = new Set(filterMap(worktreesByBranch, ([id, wt]) => (wt.opened ? id : undefined)));
		if (!openedWorktreesByBranch.size) {
			openedWorktreesByBranch = undefined;
		}
	}
	return openedWorktreesByBranch;
}

export async function getWorktreeForBranch(
	repo: Repository,
	branchName: string,
	upstreamNames?: string | string[],
	worktrees?: GitWorktree[],
	branches?: PageableResult<GitBranch> | Map<unknown, GitBranch>,
): Promise<GitWorktree | undefined> {
	if (upstreamNames != null && !Array.isArray(upstreamNames)) {
		upstreamNames = [upstreamNames];
	}

	function matches(branch: GitBranch): boolean {
		return (
			branch.upstream?.name != null &&
			(upstreamNames!.includes(branch.upstream.name) ||
				(branch.upstream.name.startsWith('remotes/') &&
					upstreamNames!.includes(branch.upstream.name.substring(8))))
		);
	}

	worktrees ??= await repo.git.getWorktrees();
	for (const worktree of worktrees) {
		if (worktree.branch?.name === branchName) return worktree;

		if (upstreamNames == null || worktree.branch == null) continue;

		branches ??= new PageableResult<GitBranch>(p => repo.git.getBranches(p != null ? { paging: p } : undefined));

		const values = branches.values();
		if (Symbol.asyncIterator in values) {
			for await (const branch of values) {
				if (branch.name === worktree.branch.name) {
					if (matches(branch)) return worktree;
					break;
				}
			}
		} else {
			for (const branch of values) {
				if (branch.name === worktree.branch.name) {
					if (matches(branch)) return worktree;
					break;
				}
			}
		}
	}

	return undefined;
}

export async function getWorktreesByBranch(
	repos: Repository | Repository[] | undefined,
	options?: { includeDefault?: boolean },
) {
	const worktreesByBranch = new Map<string, GitWorktree>();
	if (repos == null) return worktreesByBranch;

	async function addWorktrees(repo: Repository) {
		groupWorktreesByBranch(await repo.git.getWorktrees(), {
			includeDefault: options?.includeDefault,
			worktreesByBranch: worktreesByBranch,
		});
	}

	if (!Array.isArray(repos)) {
		await addWorktrees(repos);
	} else {
		await Promise.allSettled(repos.map(async r => addWorktrees(r)));
	}

	return worktreesByBranch;
}

export function groupWorktreesByBranch(
	worktrees: GitWorktree[],
	options?: { includeDefault?: boolean; worktreesByBranch?: Map<string, GitWorktree> },
) {
	const worktreesByBranch = options?.worktreesByBranch ?? new Map<string, GitWorktree>();
	if (worktrees == null) return worktreesByBranch;

	for (const wt of worktrees) {
		if (wt.branch == null || (!options?.includeDefault && wt.isDefault)) continue;

		worktreesByBranch.set(wt.branch.id, wt);
	}

	return worktreesByBranch;
}
