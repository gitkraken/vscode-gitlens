import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { filterMap } from '@gitlens/utils/iterable.js';
import { PageableResult } from '@gitlens/utils/paging.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../models/repository.js';

export function getOpenedWorktreesByBranch(
	worktreesByBranch: ReadonlyMap<string, GitWorktree> | undefined,
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
	repo: GlRepository,
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

	worktrees ??= await repo.git.worktrees?.getWorktrees();
	if (!worktrees?.length) return undefined;

	for (const worktree of worktrees) {
		if (worktree.branch?.name === branchName) return worktree;

		if (upstreamNames == null || worktree.branch == null) continue;

		branches ??= new PageableResult<GitBranch>(p =>
			repo.git.branches.getBranches(p != null ? { paging: p } : undefined),
		);

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

/**
 * Returns the worktrees — other than the one at `repoPath` — whose HEAD reaches `sha`, i.e. the
 * worktrees that hold a working copy of the commit's files on a branch that contains the commit.
 * Used to surface the "(Worktree)" file actions for commits whose branch lives in a sibling worktree.
 */
export async function getReachableWorktrees(
	container: Container,
	repoPath: string,
	sha: string,
	cancellation?: AbortSignal,
): Promise<GitWorktree[]> {
	const worktrees = await container.git.getRepository(repoPath)?.git.worktrees?.getWorktrees(cancellation);
	if (worktrees == null || worktrees.length <= 1) return [];

	const normalizedRepoPath = normalizePath(repoPath);
	const candidates = worktrees.filter(
		wt => wt.type !== 'bare' && wt.sha != null && normalizePath(wt.path) !== normalizedRepoPath,
	);
	if (!candidates.length) return [];

	const svc = container.git.getRepositoryService(repoPath);

	// A worktree's checked-out branch tip IS its HEAD, so the set of refs containing the commit answers
	// every branch worktree at once — one cached `for-each-ref --contains` instead of a `merge-base
	// --is-ancestor` subprocess per worktree, which doesn't scale (a repo with ~100 worktrees spent
	// longer spawning those than the rest of the details fetch took). Detached worktrees carry no branch,
	// so they still need the per-worktree check — there are rarely any.
	const reachability = await svc.commits.getCommitReachability?.(sha, cancellation);
	if (reachability != null) {
		const reachableBranches = new Set(
			reachability.refs.filter(r => r.refType === 'branch' && !r.remote).map(r => r.name),
		);

		const detached = candidates.filter(wt => wt.branch == null);
		const reachableDetached = new Set<GitWorktree>();
		if (detached.length) {
			const results = await Promise.allSettled(
				detached.map(wt => svc.commits.isAncestorOf(sha, wt.sha!, cancellation)),
			);
			for (const [i, wt] of detached.entries()) {
				if (getSettledValue(results[i]) === true) {
					reachableDetached.add(wt);
				}
			}
		}

		return candidates.filter(wt =>
			wt.branch != null ? reachableBranches.has(wt.branch.name) : reachableDetached.has(wt),
		);
	}

	// No reachability support (e.g. virtual/browser providers) — fall back to the per-worktree check.
	const results = await Promise.allSettled(
		candidates.map(wt => svc.commits.isAncestorOf(sha, wt.sha!, cancellation)),
	);
	return candidates.filter((_wt, i) => getSettledValue(results[i]) === true);
}

/**
 * Names of the branches checked out in worktrees other than `repoPath` — the git-free counterpart to
 * {@link getReachableWorktrees}. A checked-out branch's tip IS that worktree's HEAD, so a commit whose
 * reachable refs include one of these branches is necessarily an ancestor of that worktree's HEAD.
 * Detached worktrees have no branch and so can't be answered this way (they need the git check).
 */
export function getSiblingWorktreeBranches(
	worktrees: GitWorktree[] | undefined,
	repoPath: string,
): string[] | undefined {
	if (worktrees == null || worktrees.length <= 1) return undefined;

	const normalizedRepoPath = normalizePath(repoPath);

	const branches: string[] = [];
	for (const wt of worktrees) {
		if (wt.type !== 'branch' || wt.branch == null) continue;
		if (normalizePath(wt.path) === normalizedRepoPath) continue;

		branches.push(wt.branch.name);
	}
	return branches.length ? branches : undefined;
}

export async function getWorktreesByBranch(
	repos: GlRepository | GlRepository[] | undefined,
	options?: { includeDefault?: boolean },
	cancellation?: AbortSignal,
): Promise<Map<string, GitWorktree>> {
	const worktreesByBranch = new Map<string, GitWorktree>();
	if (repos == null) return worktreesByBranch;

	async function addWorktrees(repo: GlRepository) {
		if (repo.git.worktrees == null) return;

		groupWorktreesByBranch(await repo.git.worktrees.getWorktrees(cancellation), {
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
): Map<string, GitWorktree> {
	const worktreesByBranch = options?.worktreesByBranch ?? new Map<string, GitWorktree>();
	if (worktrees == null) return worktreesByBranch;

	for (const wt of worktrees) {
		if (wt.branch == null || (!options?.includeDefault && wt.isDefault)) continue;

		worktreesByBranch.set(wt.branch.id, wt);
	}

	return worktreesByBranch;
}

export async function getWorktreeStatus(container: Container, worktree: GitWorktree): Promise<GitStatus | undefined> {
	if (worktree.type === 'bare') return undefined;
	return container.git.getRepositoryService(worktree.uri.fsPath).status.getStatus();
}

export async function getWorktreeHasWorkingChanges(
	container: Container,
	worktree: GitWorktree,
	options?: { staged?: boolean; unstaged?: boolean; untracked?: boolean },
): Promise<boolean | undefined> {
	if (worktree.type === 'bare') return undefined;
	return container.git.getRepositoryService(worktree.uri.fsPath).status?.hasWorkingChanges(options);
}

/** Whether the worktree's checked-out tip has commits not on any remote (unpushed). Cheap early-exit
 *  probe — for LOCAL-ONLY branches; tracked branches get their ahead count for free from the upstream
 *  state. Returns `undefined` for detached/bare worktrees or when the provider can't determine it. */
export async function getWorktreeHasUnpublishedCommits(
	container: Container,
	worktree: GitWorktree,
): Promise<boolean | undefined> {
	if (worktree.type !== 'branch' || worktree.sha == null) return undefined;
	return container.git.getRepositoryService(worktree.uri.fsPath).commits.hasUnpublishedCommits?.(worktree.sha);
}
