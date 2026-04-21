import type { Cache } from '@gitlens/git/cache.js';
import { GitBranch } from '@gitlens/git/models/branch.js';
import type { BranchContributionsOverview, GitBranchesSubProvider } from '@gitlens/git/providers/branches.js';
import { createRevisionRange, stripOrigin } from '@gitlens/git/utils/revision.utils.js';
import type { BranchSortOptions } from '@gitlens/git/utils/sorting.js';
import { sortBranches, sortContributors } from '@gitlens/git/utils/sorting.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import { emptyPagedResult } from '@gitlens/utils/paging.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import { HeadType } from '../../context.js';
import type { GitHubBranch } from '../../models.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	constructor(
		private readonly cache: Cache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@debug()
	async getBranch(repoPath: string, name?: string, cancellation?: AbortSignal): Promise<GitBranch | undefined> {
		const scope = getScopedLogger();

		if (name != null) {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.name === name }, cancellation);
			return branch;
		}

		return this.cache.branch.getOrCreate(
			repoPath,
			async (_cacheable, signal): Promise<GitBranch | undefined> => {
				// Prefer the cache-provided aggregate signal (only fires when every joined
				// caller aborts); fall back to this caller's cancellation for the first-caller path.
				signal ??= cancellation;
				const {
					values: [branch],
				} = await this.getBranches(repoPath, { filter: b => b.current }, signal);
				if (branch != null) return branch;

				try {
					const { metadata } = await this.provider.ensureRepositoryContext(repoPath);

					const revision = await metadata.getRevision();
					switch (revision.type) {
						case HeadType.Tag:
						case HeadType.Commit:
							return new GitBranch(
								repoPath,
								`refs/heads/${revision.name}`,
								true,
								undefined,
								undefined,
								revision.revision,
								undefined,
								false,
								true,
							);
					}

					return undefined;
				} catch (ex) {
					debugger;
					scope?.error(ex);
					return undefined;
				}
			},
			cancellation,
		);
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getBranches(
		repoPath: string | undefined,
		options?: {
			filter?: (b: GitBranch) => boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			paging?: PagingOptions;
			sort?: boolean | BranchSortOptions;
		},
		cancellation?: AbortSignal,
	): Promise<PagedResult<GitBranch>> {
		if (repoPath == null) return emptyPagedResult;
		const path = repoPath;

		const scope = getScopedLogger();

		const load = async (cacheable?: CacheController): Promise<PagedResult<GitBranch>> => {
			try {
				const { metadata, github, session } = await this.provider.ensureRepositoryContext(path);

				const branches: GitBranch[] = [];

				const commitOrdering = options?.ordering;

				function addBranches(branch: GitHubBranch, current: boolean) {
					const date = new Date(
						commitOrdering === 'author-date' ? branch.target.authoredDate : branch.target.committedDate,
					);
					const ref = branch.target.oid;

					branches.push(
						new GitBranch(
							path,
							`refs/heads/${branch.name}`,
							current,
							date,
							undefined,
							ref,
							{
								name: `origin/${branch.name}`,
								missing: false,
								state: { ahead: 0, behind: 0 },
							},
							false,
						),
						new GitBranch(
							path,
							`refs/remotes/origin/${branch.name}`,
							false,
							date,
							undefined,
							ref,
							undefined,
							false,
						),
					);
				}

				let currentBranch: string | undefined;

				const revision = await metadata.getRevision();
				switch (revision.type) {
					case HeadType.Branch:
						currentBranch = revision.name;
						break;
					case HeadType.RemoteBranch: {
						const index = revision.name.indexOf(':');
						currentBranch = index === -1 ? revision.name : revision.name.substring(index + 1);
						break;
					}
				}

				let cursor = options?.paging?.cursor;
				const loadAll = cursor == null;

				while (true) {
					const result = await github.getBranches(
						toTokenInfo(this.provider.authenticationProviderId, session),
						metadata.repo.owner,
						metadata.repo.name,
						{ cursor: cursor },
					);

					for (const branch of result.values) {
						addBranches(branch, branch.name === currentBranch);
					}

					if (!result.paging?.more || !loadAll) return { ...result, values: branches };

					cursor = result.paging.cursor;
				}
			} catch (ex) {
				scope?.error(ex);
				debugger;

				// Mark the cache entry invalidated so the empty fallback self-evicts on settle
				// rather than getting stuck serving stale emptiness to subsequent callers.
				cacheable?.invalidate();
				return emptyPagedResult;
			}
		};

		// Bypass cache entirely for paged follow-ups — they're driven by an opaque cursor and
		// don't represent "all branches".
		const branchesPromise =
			options?.paging?.cursor != null
				? load()
				: this.cache.branches.getOrCreate(path, cacheable => load(cacheable), cancellation);

		let result = await branchesPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		if (options?.sort != null) {
			sortBranches(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@debug()
	async getBranchContributionsOverview(
		repoPath: string,
		ref: string,
		options?: { associatedPullRequest?: Promise<{ refs?: { base?: { branch: string } } } | undefined> },
		_cancellation?: AbortSignal,
	): Promise<BranchContributionsOverview | undefined> {
		const scope = getScopedLogger();

		try {
			let mergeTarget: string | undefined;

			// PR-based lookup (GitHub provider has no stored targets or base branch detection)
			if (options?.associatedPullRequest != null) {
				const pr = await options.associatedPullRequest;
				if (pr?.refs?.base != null) {
					mergeTarget = pr.refs.base.branch;
				}
			}

			mergeTarget ??= await this.getDefaultBranchName(repoPath);
			if (mergeTarget == null) return undefined;

			const mergeBase = await this.provider.refs.getMergeBase(repoPath, ref, mergeTarget);
			if (mergeBase == null) return undefined;

			const result = await this.provider.contributors.getContributors(
				repoPath,
				createRevisionRange(mergeBase, ref, '..'),
				{ stats: true },
			);

			sortContributors(result.contributors, { orderBy: 'score:desc' });

			let totalCommits = 0;
			let totalFiles = 0;
			let totalAdditions = 0;
			let totalDeletions = 0;
			let firstCommitTimestamp;
			let latestCommitTimestamp;

			for (const c of result.contributors) {
				totalCommits += c.contributionCount;
				totalFiles += c.stats?.files ?? 0;
				totalAdditions += c.stats?.additions ?? 0;
				totalDeletions += c.stats?.deletions ?? 0;

				const firstTimestamp = c.firstCommitDate?.getTime();
				const latestTimestamp = c.latestCommitDate?.getTime();

				if (firstTimestamp != null || latestTimestamp != null) {
					firstCommitTimestamp =
						firstCommitTimestamp != null
							? Math.min(firstCommitTimestamp, firstTimestamp ?? Infinity, latestTimestamp ?? Infinity)
							: (firstTimestamp ?? latestTimestamp);

					latestCommitTimestamp =
						latestCommitTimestamp != null
							? Math.max(latestCommitTimestamp, firstTimestamp ?? -Infinity, latestTimestamp ?? -Infinity)
							: (latestTimestamp ?? firstTimestamp);
				}
			}

			return {
				repoPath: repoPath,
				branch: ref,
				mergeTarget: mergeTarget,
				mergeBase: mergeBase,

				commits: totalCommits,
				files: totalFiles,
				additions: totalAdditions,
				deletions: totalDeletions,

				latestCommitDate: latestCommitTimestamp != null ? new Date(latestCommitTimestamp) : undefined,
				firstCommitDate: firstCommitTimestamp != null ? new Date(firstCommitTimestamp) : undefined,

				contributors: result.contributors,
			};
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@debug()
	async getBranchesWithCommits(
		repoPath: string,
		shas: string[],
		branch?: string | undefined,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
		_cancellation?: AbortSignal,
	): Promise<string[]> {
		if (repoPath == null || options?.commitDate == null) return [];

		const scope = getScopedLogger();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			let branches;

			if (branch) {
				branches = await github.getBranchWithCommit(
					toTokenInfo(this.provider.authenticationProviderId, session),
					metadata.repo.owner,
					metadata.repo.name,
					branch,
					shas.map(stripOrigin),
					options?.mode ?? 'contains',
					options?.commitDate,
				);
			} else {
				branches = await github.getBranchesWithCommits(
					toTokenInfo(this.provider.authenticationProviderId, session),
					metadata.repo.owner,
					metadata.repo.name,
					shas.map(stripOrigin),
					options?.mode ?? 'contains',
					options?.commitDate,
				);
			}

			return branches;
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return [];
		}
	}

	@debug()
	async getDefaultBranchName(
		repoPath: string | undefined,
		_remote?: string,
		_cancellation?: AbortSignal,
	): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);
			return await github.getDefaultBranchName(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
			);
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}
}
