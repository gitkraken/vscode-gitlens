import type { Cache } from '@gitlens/git/cache.js';
import { GitBranch } from '@gitlens/git/models/branch.js';
import type { BranchContributionsOverview, GitBranchesSubProvider } from '@gitlens/git/providers/branches.js';
import type { GitCommandPriority } from '@gitlens/git/run.types.js';
import { createRevisionRange, stripOrigin } from '@gitlens/git/utils/revision.utils.js';
import type { BranchSortOptions } from '@gitlens/git/utils/sorting.js';
import { sortBranches, sortContributors } from '@gitlens/git/utils/sorting.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import { emptyPagedResult } from '@gitlens/utils/paging.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
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

		// Compose cache key with cursor so re-loads of the same page hit the cache;
		// `repoPath` (no suffix) is reserved for the full "all branches" entry.
		// TODO: `cache.branches` is `PromiseMap<RepoPath, ...>` keyed exactly by repoPath, so
		// `clearCaches('branches')` / `unregisterRepoPath` will not invalidate composite-key entries.
		// Acceptable today because branches don't change during a virtual-repo session, but the entries
		// leak in memory until provider GC. Long-term: switch to RepoPromiseCacheMap or add prefix-invalidate.
		const cacheKey = options?.paging?.cursor != null ? `${path}#${options.paging.cursor}` : path;
		const branchesPromise = this.cache.branches.getOrCreate(cacheKey, cacheable => load(cacheable), cancellation);

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
		// `priority` is unused — the GitHub provider doesn't go through the local git command
		// queue, so the priority signal has no effect here. Accepted for interface compatibility.
		options?: {
			associatedPullRequest?: Promise<{ refs?: { base?: { branch: string } } } | undefined>;
			priority?: GitCommandPriority;
		},
		_cancellation?: AbortSignal,
	): Promise<BranchContributionsOverview | undefined> {
		const scope = getScopedLogger();

		// Expensive body — runs only on cache miss. Closes over `mergeTarget` so the cache key
		// (`${ref}|${mergeTarget}`) fully captures every input that affects the result.
		const fetchBody = async (mergeTarget: string): Promise<BranchContributionsOverview | undefined> => {
			const mergeBase = await this.provider.refs.getMergeBase(repoPath, ref, mergeTarget);
			if (mergeBase == null) return undefined;

			// Fetch the merge-base commit's committer date in parallel with contributors so consumers
			// that just need the date for the scope window don't pay a separate round-trip.
			// `allSettled` so a transient failure in one side doesn't drop the overview entirely.
			const [contributorsSettled, mergeBaseCommitSettled] = await Promise.allSettled([
				this.provider.contributors.getContributors(repoPath, createRevisionRange(mergeBase, ref, '..'), {
					stats: true,
				}),
				this.provider.commits.getCommit(repoPath, mergeBase),
			]);

			const result = getSettledValue(contributorsSettled) ?? { contributors: [] };
			const mergeBaseCommit = getSettledValue(mergeBaseCommitSettled);

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
				mergeBaseDate: mergeBaseCommit?.committer?.date ?? mergeBaseCommit?.author?.date,

				commits: totalCommits,
				files: totalFiles,
				additions: totalAdditions,
				deletions: totalDeletions,

				latestCommitDate: latestCommitTimestamp != null ? new Date(latestCommitTimestamp) : undefined,
				firstCommitDate: firstCommitTimestamp != null ? new Date(firstCommitTimestamp) : undefined,

				contributors: result.contributors,
			};
		};

		try {
			// Resolve `mergeTarget` (PR base or default branch). Only the expensive body below is
			// cached — keyed on `${ref}|${mergeTarget}` so callers that resolve to the same target
			// share the result, while differing targets get independent slots.
			let mergeTarget: string | undefined;

			if (options?.associatedPullRequest != null) {
				const pr = await options.associatedPullRequest;
				if (pr?.refs?.base != null) {
					mergeTarget = pr.refs.base.branch;
				}
			}

			mergeTarget ??= await this.getDefaultBranchName(repoPath);
			if (mergeTarget == null) return undefined;

			// Safe to cache despite PR retargeting: the cache key includes the resolved `mergeTarget`,
			// so a retargeted PR resolves to a fresh slot and the old entry is stale-but-unused (and
			// TTL-evicts). The prior "no outer cache here" rationale assumed a `ref`-only key.
			const resolvedTarget = mergeTarget;
			return await this.cache.getBranchOverview(repoPath, `${ref}|${resolvedTarget}`, () =>
				fetchBody(resolvedTarget),
			);
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
		remote?: string,
		// `priority` is unused — the GitHub provider doesn't go through the local git command
		// queue, so the priority signal has no effect here. Accepted for interface compatibility.
		_options?: { priority?: GitCommandPriority },
		_cancellation?: AbortSignal,
	): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		remote ??= 'origin';

		const scope = getScopedLogger();

		// Throw inside the factory so RepoPromiseCacheMap's default `expireOnError` evicts the
		// entry — a transient API failure shouldn't poison the cache for the rest of the session.
		// The outer try/catch preserves the existing `undefined`-on-error contract for callers.
		try {
			return await this.cache.getDefaultBranchName(repoPath, remote, async () => {
				const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);
				return github.getDefaultBranchName(
					toTokenInfo(this.provider.authenticationProviderId, session),
					metadata.repo.owner,
					metadata.repo.name,
				);
			});
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}
}
