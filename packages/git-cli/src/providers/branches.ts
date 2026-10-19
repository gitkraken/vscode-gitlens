import type { Cache, ConflictDetectionCacheKey, GkConfigInvalidationTarget } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { BranchError } from '@gitlens/git/errors.js';
import type { BranchDisposition, BranchMetadata } from '@gitlens/git/models/branch.js';
import { GitBranch } from '@gitlens/git/models/branch.js';
import type { ConflictDetectionErrorReason, ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import type { GitBranchReference, RefRecord } from '@gitlens/git/models/reference.js';
import type { GitRevisionRange } from '@gitlens/git/models/revision.js';
import type {
	AheadOfBase,
	AheadOfBaseTier,
	BranchContributionsOverview,
	GitBranchesSubProvider,
	GitBranchMergedStatus,
} from '@gitlens/git/providers/branches.js';
import type { GitCommandPriority, GitRunOptions } from '@gitlens/git/run.types.js';
import {
	formatDetachedHeadName,
	getLocalBranchByUpstream,
	isDetachedHead,
	isRemoteHEAD,
	parseBranchMetadataGkConfigKey,
	parseRefName,
	parseUpstream,
	setBranchMetadataValue,
	splitRemoteBranchName,
} from '@gitlens/git/utils/branch.utils.js';
import { createConflictDetectionError } from '@gitlens/git/utils/mergeConflicts.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { createRevisionRange, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import type { BranchSortOptions } from '@gitlens/git/utils/sorting.js';
import { sortBranches, sortContributors } from '@gitlens/git/utils/sorting.js';
import { ensureArray, filterMap } from '@gitlens/utils/array.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { getBranchId } from '@gitlens/utils/gitRefs.js';
import { sum } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import { emptyPagedResult, PageableResult } from '@gitlens/utils/paging.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { getSettledValue, mapBounded } from '@gitlens/utils/promise.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { mayWriteTracking } from '../exec/commandClassifier.js';
import type { GitResult } from '../exec/exec.types.js';
import type { Git } from '../exec/git.js';
import {
	getGitCommandError,
	gitConfigsBranch,
	gitConfigsLog,
	GitError,
	GitErrors,
	GitWarnings,
	maxGitCliLength,
} from '../exec/git.js';
import { KeyedSequencer } from '../exec/indexLock.js';
import type { GitMergeConflict } from '../parsers/mergeTreeParser.js';
import { parseMergeTreeConflict } from '../parsers/mergeTreeParser.js';
import { resolveBranchRemote } from './branchRemote.js';

/** Minimum time between writes to the config for last accessed/modified dates */
const dateMetadataStaleThresholdMs = 5 * 60 * 1000; // 5 minutes

/**
 * Run options that keep an unrequested remote read from prompting for credentials or hanging on a dead host.
 * An empty `GIT_ASKPASS` also stops git consulting `core.askPass` and `SSH_ASKPASS` itself.
 */
const nonInteractiveNetworkOptions = {
	configs: ['-c', 'credential.interactive=false'],
	env: {
		GIT_TERMINAL_PROMPT: '0',
		GIT_ASKPASS: '',
		SSH_ASKPASS: '',
		SSH_ASKPASS_REQUIRE: 'never',
		GCM_INTERACTIVE: 'never',
	},
	timeout: 10_000,
} as const satisfies GitRunOptions;

const branchActivityKeys = ['gk-last-accessed', 'gk-last-modified', 'gk-agent-last-activity'] as const;
type BranchActivityKey = (typeof branchActivityKeys)[number];

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	/** Ahead/behind counts by `<baseSha>...<tipSha>` range, from the per-tip fallback; a pair of commits always counts the same */
	private readonly aheadBehindBySha = new LruMap<string, { ahead: number; behind: number }>(4096);
	/**
	 * When each `commonPath\0branch\0key` was last stamped by this process. Bounded: a dropped entry only costs a
	 * read of the stored stamp, which still holds off a write under 5 minutes old
	 */
	private readonly _branchActivityStamps = new LruMap<string, number>(1024);
	/** One call per `commonPath\0branch` at a time, so a call held off by another's write in flight settles after it */
	private readonly _branchActivityCalls = new KeyedSequencer();
	/**
	 * What each `commonPath\0branch`'s reflog says it was created from, as git wrote it; `undefined` when it says
	 * nothing. A branch's creation never changes, so the base read, which reruns on every commit and ref move, reads
	 * it once
	 */
	private readonly _branchCreatedFrom = new LruMap<string, string | undefined>(1024);
	/** Bumped each time a key's created-from is forgotten, so a reflog read in flight across that doesn't store it */
	private readonly _branchCreatedFromGenerations = new LruMap<string, number>(1024);

	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async getBranch(
		repoPath: string,
		name?: string,
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitBranch | undefined> {
		if (options?.force) {
			this.cache.evictCaches(repoPath, 'branches');
		}

		if (name != null) {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.name === name }, cancellation);
			return branch;
		}

		const branchPromise = this.cache.branch.getOrCreate(
			repoPath,
			async (_cacheable, signal) => {
				const {
					values: [branch],
				} = await this.getBranches(repoPath, { filter: b => b.current }, signal);
				return branch ?? this.getCurrentBranch(repoPath, undefined, undefined, signal);
			},
			cancellation,
		);

		if (branchPromise == null) {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.current }, cancellation);
			return branch ?? this.getCurrentBranch(repoPath, undefined, undefined, cancellation);
		}

		return branchPromise;
	}

	private async getCurrentBranch(
		repoPath: string,
		metadataMap: Map<string, BranchMetadata> | undefined,
		ordering: string | undefined,
		cancellation?: AbortSignal,
	): Promise<GitBranch | undefined> {
		const ref = await this.getCurrentBranchReferenceCore(repoPath, ordering, cancellation);
		if (ref == null) return undefined;

		const [pausedOpStatusResult, committerDateResult, defaultWorktreePathResult, metadataMapResult] =
			await Promise.allSettled([
				isDetachedHead(ref.name)
					? this.provider.pausedOps?.getPausedOperationStatus(repoPath, undefined, cancellation)
					: undefined,
				this.git
					.run(
						{
							cwd: repoPath,
							cancellation: cancellation,
							configs: gitConfigsLog,
							errors: 'ignore',
						},
						'log',
						'-n1',
						'--format=%ct',
						ordering ? `--${ordering}-order` : undefined,
						'--',
					)
					.then(result => (result.stdout ? result.stdout.trim() : undefined)),
				this.provider.config.getDefaultWorktreePath?.(repoPath),
				metadataMap != null ? Promise.resolve(metadataMap) : this.getBranchMetadataMap(repoPath),
			]);

		const committerDate = getSettledValue(committerDateResult);
		const pausedOpStatus = getSettledValue(pausedOpStatusResult);
		const rebaseStatus = pausedOpStatus?.type === 'rebase' ? pausedOpStatus : undefined;
		const defaultWorktreePath = getSettledValue(defaultWorktreePathResult);
		metadataMap ??= getSettledValue(metadataMapResult);
		const metadata = metadataMap?.get(ref.name);

		if (cancellation?.aborted) throw new CancellationError();

		const branchRefName = rebaseStatus?.incoming.name ?? `refs/heads/${ref.name}`;

		const branch = new GitBranch(
			repoPath, // Use worktree-specific path for consistent IDs within each worktree
			branchRefName,
			true,
			committerDate != null ? new Date(Number(committerDate) * 1000) : undefined,
			metadata,
			ref.sha,
			ref.upstream ? { ...ref.upstream, state: { ahead: 0, behind: 0 } } : undefined,
			{ path: repoPath, isDefault: repoPath === defaultWorktreePath },
			undefined,
			rebaseStatus != null,
		);

		return branch;
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getBranches(
		repoPath: string,
		options?: {
			filter?: (b: GitBranch) => boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			paging?: PagingOptions;
			sort?: boolean | BranchSortOptions;
		},
		cancellation?: AbortSignal,
	): Promise<PagedResult<GitBranch>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getScopedLogger();

		const getCore = async (
			commonPath: string,
			cacheable?: CacheController,
			signal?: AbortSignal,
		): Promise<PagedResult<GitBranch>> => {
			// Prefer the aggregate signal from the cache when present; fall back to the caller's
			// own cancellation when bypassing the cache (e.g. paging-cursor path).
			signal ??= cancellation;
			try {
				const [recordsResult, supportedResult, defaultWorktreePathResult, metadataMapResult] =
					await Promise.allSettled([
						this.provider.refs.getRefs(commonPath, signal),
						this.git.supported('git:for-each-ref'),
						this.provider.config.getDefaultWorktreePath?.(commonPath),
						this.getBranchMetadataMap(commonPath),
					]);

				const records = getSettledValue(recordsResult) ?? [];
				const supported = getSettledValue(supportedResult) ?? [];
				const metadataMap = getSettledValue(metadataMapResult) ?? new Map<string, BranchMetadata>();
				const defaultWorktreePath = getSettledValue(defaultWorktreePathResult);
				const worktreePathSupported = supported.includes('git:for-each-ref:worktreePath');

				// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
				if (!records.length) {
					// Never CACHE that conclusion. `getRefs` reports a failed enumeration the same way as a
					// genuinely ref-less repo — an empty array (it invalidates its own entry but doesn't
					// throw) — so a transient `for-each-ref` failure would otherwise pin this degraded
					// current-branch-only list in a map with no TTL, and every branch consumer would see a
					// one-branch repo for the session. A truly empty repo re-reads cheaply, so refusing the
					// entry costs nothing in the case this is actually meant to serve.
					cacheable?.invalidate();

					const current = await this.getCurrentBranch(
						commonPath,
						metadataMap,
						options?.ordering ?? this.context.config?.commits.ordering ?? undefined,
						signal,
					);
					return current != null ? { values: [current] } : emptyPagedResult;
				}

				using sw = maybeStopWatch(scope, { log: { onlyExit: true, level: 'debug' } });

				const branches: GitBranch[] = [];

				// Without `%(upstream:remotename)` (git < 2.23) a remote whose own name contains a `/` can't be
				// told from the upstream's short name alone, so read the remote names once, only if needed
				let remoteNames: Promise<string[]> | undefined;
				const resolveUpstreamRemote = async (upstream: string): Promise<string | undefined> => {
					if (!upstream.startsWith('refs/remotes/')) return undefined;

					const { name } = parseRefName(upstream);
					if (!name.includes('/', name.indexOf('/') + 1)) return undefined;

					remoteNames ??= this.provider.remotes.getRemotes(commonPath, undefined, signal).then(
						remotes => {
							// `getRemotes` answers a failed read as no remotes, which leaves only the first-segment split
							if (!remotes.length) {
								cacheable?.invalidate();
							}
							return remotes.map(r => r.name);
						},
						(ex: unknown) => {
							if (isCancellationError(ex)) throw ex;

							// Fall back to the first-segment split, but don't cache a list read without the remotes
							cacheable?.invalidate();
							return [];
						},
					);
					return splitRemoteBranchName(name, await remoteNames)?.[0];
				};

				for (const record of records) {
					const fullName = record.name;
					// Filter to branches and remote-tracking branches; skip tags from the unified records.
					if (!fullName.startsWith('refs/heads/') && !fullName.startsWith('refs/remotes/')) continue;
					// Skip HEAD refs in remote branches
					if (isRemoteHEAD(fullName)) continue;

					const upstream = parseUpstream(
						record.upstream,
						record.upstreamTracking,
						record.upstreamRemote ??
							(!worktreePathSupported ? await resolveUpstreamRemote(record.upstream) : undefined),
						record.upstreamRemoteRef,
					);

					const metadata = metadataMap.get(parseRefName(fullName).name);
					const worktreePath = record.worktreePath ? normalizePath(record.worktreePath) : undefined;

					branches.push(
						new GitBranch(
							commonPath,
							fullName,
							false, // Don't trust %(HEAD) for current as it's per-worktree -- we will set it later
							record.committerDate ? new Date(record.committerDate) : undefined,
							metadata,
							record.objectname,
							upstream,
							worktreePathSupported
								? worktreePath
									? { path: worktreePath, isDefault: worktreePath === defaultWorktreePath }
									: false
								: undefined,
						),
					);
				}

				sw?.stop({ suffix: ` parsed ${branches.length} branches` });

				// Pre-populate current branch cache for worktrees based on worktreePath info
				// This eliminates the need for rev-parse calls during branch reconstruction
				for (const branch of branches) {
					// oxlint-disable-next-line typescript/prefer-optional-chain
					if (branch.worktree && branch.worktree.path) {
						const { name } = parseRefName(branch.refName);
						const reference = createReference(name, branch.worktree.path, {
							refType: 'branch',
							name: name,
							id: getBranchId(branch.worktree.path, false, name),
							remote: false,
							upstream: branch.upstream?.name
								? {
										name: branch.upstream.name,
										missing: branch.upstream.missing,
										remote: branch.upstream.remote,
										remoteBranch: branch.upstream.remoteBranch,
										local: branch.upstream.local,
									}
								: undefined,
							sha: branch.sha,
						});
						this.cache.setCurrentBranchReferenceIfAbsent(branch.worktree.path, reference);
					}
				}

				return branches.length ? { values: branches } : emptyPagedResult;
			} catch (ex) {
				// Signal cache invalidation so the shared cache entry is cleaned up
				cacheable?.invalidate();
				if (isCancellationError(ex)) throw ex;

				return emptyPagedResult;
			}
		};

		// Mapper function that adjusts branches for a specific worktree
		const mapBranches = async (
			shared: PagedResult<GitBranch>,
			targetRepoPath: string,
			commonPath: string,
			mapperSignal?: AbortSignal,
		): Promise<PagedResult<GitBranch>> => {
			if (!shared.values.length) return shared;

			// Prefer the mapper's per-entry aggregate signal when present; fall back to the
			// caller's own cancellation when bypassing the cache (paging-cursor path).
			mapperSignal ??= cancellation;

			// Get current branch info and default worktree path for the target worktree
			const [currentRefResult, defaultWorktreePathResult] = await Promise.allSettled([
				this.getCurrentBranchReferenceCore(targetRepoPath, undefined, mapperSignal),
				this.provider.config.getDefaultWorktreePath?.(commonPath),
			]);
			const currentRef = getSettledValue(currentRefResult);
			const defaultWorktreePath = getSettledValue(defaultWorktreePathResult);
			const isDetached = currentRef != null && isDetachedHead(currentRef.name);

			// Clone branches with correct repoPath and current flag
			const branches: GitBranch[] = shared.values.map(b => {
				// Check if this branch is current in the target worktree
				const isCurrent = !b.remote && b.name === currentRef?.name && !isDetached;

				// Only create new object if something changed
				if (!isCurrent && targetRepoPath === commonPath) return b;

				return new GitBranch(
					targetRepoPath, // Use target worktree path
					b.refName,
					isCurrent,
					b.date,
					b.metadata,
					b.sha,
					b.upstream,
					// For current branch, ensure worktree is set (fallback when git doesn't support worktreePath)
					isCurrent
						? (b.worktree ?? { path: targetRepoPath, isDefault: targetRepoPath === defaultWorktreePath })
						: b.worktree,
					false, // detached - only true for detached HEAD branch itself
					false, // rebasing - only true for detached HEAD branch in rebase
				);
			});

			// Handle detached HEAD - need to create a special branch for it
			if (isDetached || (currentRef != null && !branches.some(b => b.current))) {
				const metadataMap = await this.getBranchMetadataMap(commonPath);
				const current = await this.getCurrentBranch(
					targetRepoPath,
					metadataMap,
					options?.ordering ?? this.context.config?.commits.ordering ?? undefined,
					mapperSignal,
				);
				if (current != null) {
					// Replace if exists (by id), otherwise prepend
					const index = branches.findIndex(b => b.id === current.id);
					if (index !== -1) {
						branches[index] = current;
					} else {
						branches.unshift(current);
					}
				}
			}

			return { ...shared, values: branches };
		};

		let result: PagedResult<GitBranch>;

		// Use paging cursor to bypass cache if paginating
		if (options?.paging?.cursor != null) {
			const commonPath = this.cache.getCommonPath(repoPath);
			const shared = await getCore(commonPath);
			// Still apply the mapper to ensure correct repoPath and current flag for the requesting worktree
			result = await mapBranches(shared, repoPath, commonPath);
		} else {
			result = await this.cache.getBranches(repoPath, getCore, mapBranches, cancellation);
		}

		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		if (options?.sort) {
			sortBranches(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@debug()
	async getBranchContributionsOverview(
		repoPath: string,
		ref: string,
		options?: {
			associatedPullRequest?: Promise<
				{ refs?: { base?: { branch: string } }; stack?: { position: number } } | undefined
			>;
			priority?: GitCommandPriority;
		},
		cancellation?: AbortSignal,
	): Promise<BranchContributionsOverview | undefined> {
		const scope = getScopedLogger();
		const priority = options?.priority;
		const priorityOpts = priority != null ? { priority: priority } : undefined;

		// Expensive body — runs only on cache miss. Closes over `mergeTarget` so the cache key
		// (`${ref}|${mergeTarget}`) fully captures every input that affects the result.
		const fetchBody = async (
			mergeTarget: string,
			signal: AbortSignal | undefined,
		): Promise<BranchContributionsOverview | undefined> => {
			const mergeBase = await this.provider.refs.getMergeBase(repoPath, ref, mergeTarget, priorityOpts, signal);
			if (mergeBase == null) return undefined;

			// Fetch the merge-base commit's dates in parallel with contributors so consumers
			// (e.g. the graph minimap scope window) don't pay a separate round-trip for them.
			// `allSettled` so a transient failure in one side doesn't drop the overview entirely.
			const [contributorsSettled, mergeBaseDatesSettled] = await Promise.allSettled([
				this.provider.contributors.getContributors(
					repoPath,
					createRevisionRange(mergeBase, ref, '..'),
					{ stats: true },
					signal,
				),
				this.provider.commits.getCommitDates(repoPath, mergeBase, signal),
			]);

			if (signal?.aborted) throw new CancellationError();

			const result = getSettledValue(contributorsSettled) ?? { contributors: [] };
			const mergeBaseDates = getSettledValue(mergeBaseDatesSettled);

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
				mergeBaseDate: mergeBaseDates?.committerDate,

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
			// Resolve `mergeTarget` through Tier 1 → Tier 2 → Tier 3. The pieces of each tier are
			// already individually cached (`getStoredMergeTargetBranchName`, `getBaseBranchName`,
			// `getDefaultBranchName`), so this resolution path is cheap on warm caches. Only the
			// expensive body below (`getMergeBase` + `getContributors` w/ stats + `getCommitDates`)
			// is wrapped by `cache.getBranchOverview`, keyed on the resolved `mergeTarget` so any
			// caller that resolves to the same target shares; differing targets get independent
			// slots, which is the correctness constraint that previously forced the Tier 2/3 paths
			// to bypass the cache entirely.
			let mergeTarget: string | undefined;

			// Tier 1: Stored merge target (user-set or previously detected from PR). A target whose
			// branch is gone is skipped, so resolution falls through to the next tier.
			mergeTarget = await this.getStoredMergeTargetBranchName(repoPath, ref, priorityOpts, cancellation);

			// Tier 2: PR-based lookup. The branch object is only needed here (for `remoteName`),
			// so lazy-load it on the cold path instead of paying for it on every call.
			if (mergeTarget == null && options?.associatedPullRequest != null) {
				const pr = await options.associatedPullRequest;
				if (pr?.refs?.base != null) {
					const branch = await this.getBranch(repoPath, ref, undefined, cancellation);
					if (branch == null) return undefined;

					const { remote: remoteName } = await resolveBranchRemote(
						this.provider,
						repoPath,
						branch,
						cancellation,
					);

					// A branch with no remote upstream has no remote to find the PR's base on
					if (remoteName != null) {
						const prTarget = `${remoteName}/${pr.refs.base.branch}`;
						// A PR's base can be gone too (e.g. a stale PR read still naming a merged stack layer),
						// so a confirmed-gone base is skipped like a stored target.
						const { missing } = await this.provider.refs.getSymbolicReferenceNameOrMissing(
							repoPath,
							prTarget,
							priorityOpts,
							cancellation,
						);
						if (!missing) {
							mergeTarget = prTarget;

							// A stacked PR's base is the layer below it, which is deleted when the stack merges.
							// A stored target beats every other tier for as long as its branch exists, and a merged
							// layer's branch can linger (an unpruned remote-tracking ref, or a repo that keeps merged
							// branches). Use it for this lookup, but don't persist it.
							if (pr.stack == null) {
								// Store for future reuse — turns the next call into a Tier 1 path. Skip the
								// `branchOverviews` invalidation that the write would otherwise trigger: we're
								// about to populate `${ref}|${mergeTarget}` with this exact target, so evicting
								// it would just force the next caller to redo the body. (gk-merge-target writes
								// do not affect `baseBranchName`, so no need to skip that target.)
								void this.storeMergeTargetBranchName(repoPath, ref, prTarget, {
									skipInvalidation: ['branchOverviews'],
								});
							}
						}
					}
				}
			}

			// Tier 3: Base branch, then default branch.
			mergeTarget ??= await this.getBaseBranchName(repoPath, ref, priorityOpts, cancellation);
			mergeTarget ??= await this.getDefaultBranchName(repoPath, undefined, priorityOpts, cancellation);

			if (mergeTarget == null) return undefined;

			const resolvedTarget = mergeTarget;
			return await this.cache.getBranchOverview(
				repoPath,
				`${ref}|${resolvedTarget}`,
				(_commonPath, _cacheable, signal) => fetchBody(resolvedTarget, signal ?? cancellation),
				{ cancellation: cancellation },
			);
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	@debug()
	async getBranchesWithCommits(
		repoPath: string,
		commits: string[],
		branch?: string,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
		cancellation?: AbortSignal,
	): Promise<string[]> {
		if (branch != null) {
			const result = await this.branchesContainingCore(
				repoPath,
				commits,
				{ mode: 'contains', name: branch },
				cancellation,
			);
			const data = result.stdout.trim();
			return data ? [data] : [];
		}

		const result = await this.branchesContainingCore(repoPath, commits, options, cancellation);
		if (!result.stdout) return [];

		return filterMap(result.stdout.split('\n'), b => b.trim() || undefined);
	}

	private async branchesContainingCore(
		repoPath: string,
		refs: string[],
		options?: {
			all?: boolean;
			mode?: 'contains' | 'pointsAt';
			name?: string;
			remotes?: boolean;
		},
		cancellation?: AbortSignal,
	): Promise<GitResult> {
		const params: string[] = ['branch'];
		if (options?.all) {
			params.push('-a');
		} else if (options?.remotes) {
			params.push('-r');
		}

		params.push('--format=%(refname:short)');

		for (const ref of refs) {
			params.push(options?.mode === 'pointsAt' ? `--points-at=${ref}` : `--contains=${ref}`);
		}

		if (options?.name != null) {
			params.push(options.name);
		}

		return this.git.run(
			{
				cwd: repoPath,
				cancellation: cancellation,
				configs: gitConfigsBranch,
				errors: 'ignore',
			},
			...params,
		);
	}

	@debug()
	async getCurrentBranchReference(
		repoPath: string,
		cancellation?: AbortSignal,
	): Promise<GitBranchReference | undefined> {
		let ref = await this.getCurrentBranchReferenceCore(repoPath, undefined, cancellation);
		if (ref != null && isDetachedHead(ref.name)) {
			ref = createReference(ref.sha!, repoPath, {
				refType: 'branch',
				name: formatDetachedHeadName(ref.sha!),
				id: getBranchId(repoPath, ref.remote, ref.sha!),
				remote: ref.remote,
				upstream: ref.upstream,
				sha: ref.sha,
			});
		}
		return ref;
	}

	private getCurrentBranchReferenceCore(
		repoPath: string,
		ordering?: string,
		cancellation?: AbortSignal,
	): Promise<GitBranchReference | undefined> {
		return this.cache.currentBranchReference.getOrCreate(
			repoPath,
			async (_cacheable, signal) => {
				const commitOrdering = ordering;

				// `upstream` is the full ref (`refs/heads/…` or `refs/remotes/…`) so a local upstream
				// can't be mistaken for a remote's branch of the same short name
				let data:
					| { name: string; upstream?: string; remote?: string; remoteRef?: string; sha?: string }
					| undefined;
				let result;
				try {
					result = await this.git.run(
						{ cwd: repoPath, cancellation: signal, errors: 'throw' },
						'rev-parse',
						'--symbolic-full-name',
						'@',
						'@{u}',
						'--',
					);
					data = parseSymbolicFullNames(result.stdout);
				} catch (ex) {
					if (isCancellationError(ex)) throw ex;

					const msg: string = ex?.toString() ?? '';
					if (GitErrors.badRevision.test(msg) || GitWarnings.noUpstream.test(msg)) {
						if (ex.stdout != null && ex.stdout.length !== 0) {
							data = parseSymbolicFullNames(ex.stdout);
						} else {
							try {
								result = await this.git.run(
									{ cwd: repoPath, cancellation: signal },
									'symbolic-ref',
									'--short',
									'HEAD',
								);
								if (result.stdout) {
									data = { name: result.stdout.trim() };
								}
							} catch {
								if (isCancellationError(ex)) throw ex;
							}

							if (data == null) {
								const symbolicRef = await this.getDefaultBranchName(
									repoPath,
									'origin',
									undefined,
									signal,
								);
								if (symbolicRef != null) {
									data = {
										name: symbolicRef.startsWith('origin/')
											? symbolicRef.substring('origin/'.length)
											: symbolicRef,
									};
								}
							}

							if (data == null) {
								const defaultBranch =
									(await this.provider.config.getConfig(repoPath, 'init.defaultBranch')) ?? 'main';
								const configMap = await this.provider.config.getConfigRegex(
									repoPath,
									`branch\\.${defaultBranch}\\.+`,
									{ runGitLocally: true },
								);

								const remote = configMap.get(`branch.${defaultBranch}.remote`);
								const merge = configMap.get(`branch.${defaultBranch}.merge`);
								const remoteBranch = merge?.startsWith('refs/heads/')
									? merge.substring('refs/heads/'.length)
									: undefined;

								data = { name: defaultBranch };
								if (remote && remoteBranch) {
									data.upstream =
										remote === '.'
											? `refs/heads/${remoteBranch}`
											: `refs/remotes/${remote}/${remoteBranch}`;
									data.remote = remote;
									data.remoteRef = merge;
								}
							}
						}
					} else if (GitWarnings.headNotABranch.test(msg)) {
						result = await this.git.run(
							{
								cwd: repoPath,
								cancellation: signal,
								configs: gitConfigsLog,
								errors: 'ignore',
							},
							'log',
							'-n1',
							'--format=%H',
							commitOrdering ? `--${commitOrdering}-order` : undefined,
							'--',
						);

						if (result.completion.status === 'cancelled' || signal?.aborted) {
							throw new CancellationError();
						}

						const sha = result.stdout.trim();
						if (sha) {
							data = { name: `(HEAD detached at ${shortenRevision(sha)})`, sha: sha };
						}
					} else {
						Logger.warn(`[${repoPath}] Unable to get current branch: ${ex}`);
					}
				}

				if (data == null) return undefined;

				const { name } = data;

				let { remote, remoteRef } = data;
				if (data.upstream?.startsWith('refs/heads/') && remote == null) {
					// Git reports no remote here, but a custom fetch refspec can put a remote's branches under
					// `refs/heads/`, so ask the config whether this upstream is really a remote's
					[remote, remoteRef] = await Promise.all([
						this.provider.config.getConfig(repoPath, `branch.${name}.remote`),
						this.provider.config.getConfig(repoPath, `branch.${name}.merge`),
					]);
				}

				return createReference(name, repoPath, {
					refType: 'branch',
					name: name,
					id: getBranchId(repoPath, false, name),
					remote: false,
					upstream: data.upstream ? parseUpstream(data.upstream, '', remote, remoteRef) : undefined,
					sha: data.sha,
				});
			},
			{ cancellation: cancellation },
		);
	}

	@debug({ exit: true })
	async getDefaultBranchName(
		repoPath: string | undefined,
		remote?: string,
		options?: { priority?: GitCommandPriority; local?: boolean },
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		remote ??= 'origin';
		const priority = options?.priority;
		const priorityOpts = priority != null ? { priority: priority } : undefined;

		// Local-only: read just the existing local symref, never contacting the remote. Cached under a
		// `${remote}:local` key — a colon can't appear in a refname component, so it can never collide
		// with a real remote name used by the networked variant below. Invalidated by the same
		// remotes/branches cache cascades as the networked lookup.
		if (options?.local) {
			return this.cache.getDefaultBranchName(
				repoPath,
				`${remote}:local`,
				async (commonPath, cacheable, signal) => {
					try {
						// Bind to the aggregate `signal` (fires only when ALL current callers abort), not
						// this-caller's `cancellation` — otherwise a superseded caller's abort would kill the
						// shared command and reject concurrent riders that never cancelled.
						const result = await this.git.run(
							{ cwd: commonPath, cancellation: signal ?? cancellation, ...priorityOpts },
							'symbolic-ref',
							'--short',
							`refs/remotes/${remote}/HEAD`,
						);
						return result.stdout.trim() || undefined;
					} catch (ex) {
						if (isCancellationError(ex)) throw ex;

						// `symbolic-ref` on an absent `refs/remotes/<remote>/HEAD` exits fatal rather than
						// empty, and that message matches no `GitWarnings` entry, so it arrives here as a
						// throw. It is still an ANSWER — the ref genuinely isn't set — and the overwhelmingly
						// common one, so cache it. Invalidating instead means every caller re-probes and the
						// whole point of caching this lookup is lost.
						const stderr = (ex as { stderr?: string }).stderr ?? '';
						if (stderr.includes('is not a symbolic ref')) return undefined;

						// Anything else never produced an answer (spawn failure, queue rejection). This entry
						// has no TTL, so caching that would pin "no default branch" for the session.
						cacheable.invalidate();
						return undefined;
					}
				},
				cancellation,
			);
		}

		return this.cache.getDefaultBranchName(
			repoPath,
			remote,
			async (commonPath, cacheable, signal) => {
				let retried = false;
				while (true) {
					try {
						const result = await this.git.run(
							{ cwd: commonPath, cancellation: signal ?? cancellation, ...priorityOpts },
							'symbolic-ref',
							'--short',
							`refs/remotes/${remote}/HEAD`,
						);
						return result.stdout.trim() || undefined;
					} catch (ex) {
						// Only "no HEAD ref configured" is an ANSWER here; every other throw means the lookup
						// never happened. This entry has no TTL, so caching a failure — an offline `ls-remote`
						// being the likely one — would pin "no default branch" for the session.
						let answered = false;
						if (/is not a symbolic ref/.test(ex.stderr)) {
							try {
								if (!retried) {
									retried = true;
									await this.git.run(
										{ cwd: commonPath, cancellation: signal ?? cancellation, ...priorityOpts },
										'remote',
										'set-head',
										'-a',
										remote,
									);
									// This just created `refs/remotes/<remote>/HEAD`, which the `local` variant
									// may already have cached a miss for. The watcher would also catch the new
									// ref, but evict directly so consumers of this package that don't wire up a
									// watcher aren't stuck with that miss.
									this.cache.deleteDefaultBranchName(commonPath, `${remote}:local`);
									continue;
								}

								const result = await this.git.run(
									{ cwd: commonPath, cancellation: signal ?? cancellation, ...priorityOpts },
									'ls-remote',
									'--symref',
									remote,
									'HEAD',
								);
								if (result.stdout) {
									const match = /ref:\s(\S+)\s+HEAD/m.exec(result.stdout);
									if (match != null) {
										const [, branch] = match;
										return `${remote}/${branch.substring('refs/heads/'.length).trim()}`;
									}
								}

								// `ls-remote` ran and the remote advertised no HEAD — a real "none".
								answered = true;
							} catch {
								if (isCancellationError(ex)) throw ex;
							}
						}

						if (!answered) {
							cacheable.invalidate();
						}
						return undefined;
					}
				}
			},
			cancellation,
		);
	}

	/**
	 * Writes the missing `refs/remotes/<remote>/HEAD` symref from the remote (`remote set-head -a`) in the background,
	 * never prompting for credentials; nothing runs past the cached local check when the symref exists. Rejects when
	 * the remote can't be read.
	 */
	@debug()
	async setRemoteHeadIfMissing(repoPath: string, remote: string): Promise<void> {
		if ((await this.getDefaultBranchName(repoPath, remote, { priority: 'background', local: true })) != null) {
			return;
		}

		await this.git.run(
			{ cwd: repoPath, priority: 'background', ...nonInteractiveNetworkOptions },
			'remote',
			'set-head',
			'-a',
			remote,
		);
		// The `local` lookup above cached the miss; a host without a ref watcher would otherwise keep it
		this.cache.deleteDefaultBranchName(repoPath, `${remote}:local`);
	}

	@debug()
	async createBranch(repoPath: string, name: string, ref: string, options?: { noTracking?: boolean }): Promise<void> {
		const args = ['branch', name, ref];
		if (options?.noTracking) {
			args.push('--no-track');
		}
		try {
			await this.git.run({ cwd: repoPath }, ...args);
			// Evict the cached base so the new branch re-derives its own. The PERSISTED `branch.<ref>.gk-*`
			// keys are left alone: they're dropped when GitLens deletes a branch, never when one is created.
			// Removing them here would mean treating a reused name as proof of a different branch, which
			// nothing can establish — so the trade is that a branch reusing a name deleted outside GitLens
			// inherits the orphaned section.
			this.cache.deleteBaseBranchName(repoPath, name);
			// Unlike the gk keys, the reflog is the new branch's own: a name deleted outside GitLens left its
			// predecessor's start point cached
			this.forgetBranchCreatedFrom(repoPath, name);
		} catch (ex) {
			throw getGitCommandError(
				'branch',
				ex,
				reason =>
					new BranchError(
						{
							reason: reason ?? 'other',
							action: 'create',
							branch: name,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex,
					),
			);
		} finally {
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(
				repoPath,
				mayWriteTracking(ref, options?.noTracking) ? ['config', 'heads'] : ['heads'],
			);
		}
	}

	@debug()
	async deleteLocalBranch(repoPath: string, names: string | string[], options?: { force?: boolean }): Promise<void> {
		const branches = ensureArray(names);
		const args = ['branch', options?.force ? '-D' : '-d', ...branches];
		try {
			await this.git.run({ cwd: repoPath }, ...args);
			for (const branch of branches) {
				await this.forgetDeletedBranch(repoPath, branch);
			}
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'heads']);
		} catch (ex) {
			// A multi-name delete partially succeeds: `git branch -d a bad c` removes `a` and `c`, refuses
			// `bad`, and still exits non-zero — so the loop above never ran for the branches that did go.
			// Clean those up here rather than leave persisted gk metadata behind for a name a later branch
			// can reuse.
			const anyDeleted = await this.cleanupDeletedBranchMetadata(repoPath, branches);

			// The success path's notifications never ran, but some branches DID go — without these the
			// branch caches stay stale and consumers wait on the filesystem watcher (which never fires
			// for a packed ref).
			if (anyDeleted) {
				this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
				this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'heads']);
			}

			if (ex instanceof BranchError) {
				throw ex.update({
					action: options?.force ? 'force delete' : 'delete',
					branch: branches.join(', '),
					gitCommand: { repoPath: repoPath, args: args },
				});
			}

			// Classify the failure (e.g. not fully merged) so consumers like the delete wizard can offer a
			// force retry — without this the reason would be undefined and every failure reads as 'other'.
			throw getGitCommandError(
				'branch',
				ex,
				reason =>
					new BranchError(
						{
							reason: reason ?? 'other',
							action: options?.force ? 'force delete' : 'delete',
							branch: branches.join(', '),
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex,
					),
			);
		}
	}

	/**
	 * Drops what GitLens keeps for a local branch beyond its ref, for both ways one is deleted
	 * (`deleteLocalBranch` and `refs.deleteReference`). The persisted gk metadata goes too, not just the
	 * cached resolution: `getBaseBranchName` reads `branch.<ref>.gk-merge-base` before falling back to the
	 * reflog, so leaving it behind would hand a later branch reusing this name its predecessor's base.
	 */
	async forgetDeletedBranch(repoPath: string, name: string): Promise<void> {
		this.cache.deleteBaseBranchName(repoPath, name);
		await this.provider.config.removeGkConfigBranchSection(repoPath, name);
		this.clearBranchActivityStamps(repoPath, name);
		this.forgetBranchCreatedFrom(repoPath, name);
	}

	/**
	 * Drops the cached and persisted per-branch metadata for whichever of `names` no longer exists. Only
	 * for the partial-failure path — one extra `for-each-ref` is cheap while already handling an error,
	 * and keeps the success path free of it.
	 *
	 * Returns whether any of `names` is confirmed gone; `false` when the probe couldn't answer, so a
	 * spurious notification is never fired on an unrelated failure.
	 */
	private async cleanupDeletedBranchMetadata(repoPath: string, names: string[]): Promise<boolean> {
		try {
			const result = await this.git.run(
				{ cwd: repoPath, errors: 'ignore' },
				'for-each-ref',
				// Full refname, stripped here rather than by git. NOT `%(refname:short)`: that yields the
				// shortest UNAMBIGUOUS name, so a branch with a same-named tag comes back as `heads/<name>`,
				// never matches the requested name, and would read as deleted — wiping a live branch's
				// metadata. `%(refname:strip=2)` also solves that, but `%(refname)` is the oldest, plainest
				// field and needs no assumption about which git version gained `strip`.
				'--format=%(refname)',
				...names.map(n => `refs/heads/${n}`),
			);
			// `errors: 'ignore'` means a failed probe RESOLVES empty, which is indistinguishable from "none
			// of them survived" — and would delete every name's metadata, including user-owned keys like
			// `gk-disposition` and `gk-associated-issues`. Only act on a genuine answer.
			//
			// BOTH conditions: `exitCode !== 0` catches a probe git ran and rejected, `status !== 'exited'`
			// catches one that never produced an answer — a spawn failure or queue rejection (no exit code at
			// all), or a swallowed warning (which carries git's real code, so the exit-code test alone can
			// still read it as "none survived").
			if (result.completion.status !== 'exited' || result.exitCode !== 0) return false;

			const prefix = 'refs/heads/';
			const surviving = new Set(
				result.stdout
					.split('\n')
					.map(l => l.trim())
					.filter(l => l.startsWith(prefix))
					.map(l => l.substring(prefix.length)),
			);

			let anyDeleted = false;
			for (const name of names) {
				if (surviving.has(name)) continue;

				anyDeleted = true;
				await this.forgetDeletedBranch(repoPath, name);
			}

			return anyDeleted;
		} catch {
			// Best-effort bookkeeping while already unwinding a failure — never mask the original error.
			return false;
		}
	}

	@debug()
	async deleteRemoteBranch(repoPath: string, names: string | string[], remote: string): Promise<void> {
		const branches = ensureArray(names);
		const args = ['push', '-d', remote, ...branches];
		try {
			await this.git.run({ cwd: repoPath }, ...args);
		} catch (ex) {
			if (ex instanceof BranchError) {
				throw ex.update({
					action: 'delete',
					branch: branches.join(', '),
					gitCommand: { repoPath: repoPath, args: args },
				});
			}

			// Classify against the underlying `git push -d` failure modes; map the "remote ref does not
			// exist" case onto BranchError's noRemoteReference so consumers get an actionable reason.
			throw getGitCommandError(
				'push',
				ex,
				reason =>
					new BranchError(
						{
							reason: reason === 'rejectedRefDoesNotExist' ? 'noRemoteReference' : 'other',
							action: 'delete',
							branch: branches.join(', '),
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex,
					),
			);
		} finally {
			// A rejected push may have deleted some of its refs
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
		}
	}

	@debug()
	async getBranchMergedStatus(
		repoPath: string,
		branch: GitBranchReference,
		into: GitBranchReference,
		cancellation?: AbortSignal,
	): Promise<GitBranchMergedStatus> {
		if (branch.name === into.name || branch.upstream?.name === into.name) {
			return { merged: false };
		}

		// Hoisted so it can feed the cache key below (its tip is a 3rd key input) and the mapper
		// below reuses it instead of resolving it a second time.
		const localInto = into.remote
			? await this.getLocalBranchByUpstream(repoPath, into.name, cancellation)
			: undefined;

		// Cache key omits repoPath so worktrees of the same common repo share the cached answer.
		// Content-keyed on the involved tip shas (the result is a pure function of them), so tip
		// movement mints a new key instead of relying on eviction; falls back to the name-only
		// identity when a sha is missing (defensive — the sole caller always supplies both tips).
		const cacheKey =
			branch.sha != null && into.sha != null
				? `${branch.remote ? 'r' : 'l'}:${branch.name}@${branch.sha}|${into.remote ? 'r' : 'l'}:${into.name}@${into.sha}${
						localInto?.sha != null ? `|L:${localInto.name}@${localInto.sha}` : ''
					}`
				: `${branch.remote ? 'r' : 'l'}:${branch.name}|${into.remote ? 'r' : 'l'}:${into.name}`;

		return this.cache.getBranchMergedStatus(
			repoPath,
			cacheKey,
			async (commonPath, _cacheable, signal) => {
				const result = await this.getBranchMergedStatusCore(commonPath, branch, into, signal);
				if (result.merged) return result;

				// If there is a local branch and it is not the branch we are checking, check if it has been merged into it
				if (localInto != null && localInto.name !== branch.name) {
					// Skip the second full merge-check cycle when the local branch points at the same commit as the remote —
					// the merge-base/cherry/diff/apply pipeline would produce the same answer we already got for `into` above
					if (localInto.sha != null && localInto.sha === into.sha) {
						return { merged: false };
					}

					const result = await this.getBranchMergedStatusCore(commonPath, branch, localInto, signal);
					if (result.merged) {
						// `localBranchOnly` is built against `commonPath` here; the cache mapper rewrites
						// `repoPath`/`id` to the requesting worktree on retrieval.
						return {
							...result,
							localBranchOnly: createReference(localInto.ref, commonPath, {
								id: getBranchId(commonPath, localInto.remote, localInto.name),
								refType: 'branch',
								name: localInto.name,
								remote: localInto.remote,
								upstream: localInto.upstream,
								sha: localInto.sha,
							}),
						};
					}
				}

				return { merged: false };
			},
			cancellation,
		);
	}

	private async getBranchMergedStatusCore(
		repoPath: string,
		branch: GitBranchReference,
		into: GitBranchReference,
		cancellation?: AbortSignal,
	): Promise<Exclude<GitBranchMergedStatus, 'localBranchOnly'>> {
		const scope = getScopedLogger();

		try {
			// Check if branch is direct ancestor (handles FF merges)
			try {
				await this.git.run(
					{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
					'merge-base',
					'--is-ancestor',
					branch.name,
					into.name,
				);
				return { merged: true, confidence: 'highest' };
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;
			}

			// Cherry-pick detection (handles cherry-picks, rebases, etc)
			let result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation },
				'cherry',
				'--abbrev',
				'-v',
				into.name,
				branch.name,
			);
			// Check if there are no lines or all lines startwith a `-` (i.e. likely merged)
			if (
				!result.stdout ||
				result.stdout
					.trim()
					.split('\n')
					.every(l => l.startsWith('-'))
			) {
				return { merged: true, confidence: 'high' };
			}

			// Attempt to detect squash merges by checking if the diff of the branch can be cleanly removed from the target
			const mergeBase = await this.provider.refs.getMergeBase(
				repoPath,
				into.name,
				branch.name,
				undefined,
				cancellation,
			);
			result = await this.git.run({ cwd: repoPath, cancellation: cancellation }, 'diff', mergeBase, branch.name);
			if (result.stdout) {
				// Create a temporary index file
				await using disposableIndex = await this.provider.staging.createTemporaryIndex(
					repoPath,
					'ref',
					into.name,
				);
				const { env } = disposableIndex;

				result = await this.git.run(
					{
						cwd: repoPath,
						cancellation: cancellation,
						env: env,
						errors: 'ignore',
						stdin: result.stdout,
					},
					'apply',
					'--cached',
					'--reverse',
					'--check',
					'-',
				);

				if (result.exitCode === 0 && !result.stdout.trim() && !result.stderr?.trim()) {
					return { merged: true, confidence: 'medium' };
				}
			}

			return { merged: false };
		} catch (ex) {
			if (Logger.enabled('trace')) {
				scope?.error(ex);
			}
			if (isCancellationError(ex)) throw ex;

			return { merged: false };
		}
	}

	@debug()
	async getLocalBranchByUpstream(
		repoPath: string,
		remoteBranchName: string,
		cancellation?: AbortSignal,
	): Promise<GitBranch | undefined> {
		const branches = new PageableResult<GitBranch>(p =>
			this.getBranches(repoPath, p != null ? { paging: p } : undefined, cancellation),
		);
		return getLocalBranchByUpstream(remoteBranchName, branches);
	}

	/** Detects potential conflicts when applying commits onto a target branch (git rebase and cherry-pick) */
	@debug()
	async getPotentialApplyConflicts(
		repoPath: string,
		targetBranch: string,
		shas: string[],
		options?: { stopOnFirstConflict?: boolean },
		cancellation?: AbortSignal,
	): Promise<ConflictDetectionResult> {
		if (!shas.length) return { status: 'clean' };

		const cacheKey: ConflictDetectionCacheKey = `apply:${targetBranch}:${shas.join(',')}:${options?.stopOnFirstConflict ?? false}`;
		return this.cache.conflictDetection.getOrCreate(
			repoPath,
			cacheKey,
			async (_cacheable, signal) => {
				// Resolve all parent refs in a single call - fails if any commit is a root commit (no parent)
				const parentRefs = shas.map(c => `${c}^`);
				let parentShas: string[];
				try {
					const result = await this.git.run(
						{ cwd: repoPath, cancellation: signal, errors: 'throw' },
						'rev-parse',
						...parentRefs,
					);
					parentShas = result.stdout.trim().split('\n');
				} catch (ex) {
					if (isCancellationError(ex)) throw ex;
					// If any commit doesn't have a parent (root commit), we can't do conflict detection
					return createConflictDetectionError('noParent');
				}

				if (parentShas.length !== shas.length) {
					return createConflictDetectionError('refNotFound');
				}

				const commitsWithParents = shas.map((c, i) => ({ sha: c, parent: parentShas[i] }));
				return this.checkForPotentialConflicts(repoPath, commitsWithParents, targetBranch, signal, options);
			},
			{ cancellation: cancellation },
		);
	}

	/** Detects potential conflict when merge a branch into a target branch (git merge) */
	@debug()
	async getPotentialMergeConflicts(
		repoPath: string,
		branch: string,
		targetBranch: string,
		cancellation?: AbortSignal,
	): Promise<ConflictDetectionResult> {
		const scope = getScopedLogger();

		const cacheKey: ConflictDetectionCacheKey = `merge:${branch}:${targetBranch}`;
		return this.cache.conflictDetection.getOrCreate(
			repoPath,
			cacheKey,
			async (_cacheable, signal) => {
				if (!(await this.git.supports('git:merge-tree:write-tree'))) {
					return createConflictDetectionError('unsupported');
				}

				let data;
				try {
					const result = await this.git.run(
						{ cwd: repoPath, cancellation: signal, errors: 'throw' },
						'merge-tree',
						'-z',
						'--name-only',
						'--no-messages',
						branch,
						targetBranch,
					);
					data = result.stdout;
				} catch (ex) {
					if (isCancellationError(ex)) throw ex;

					const msg: string = ex?.toString() ?? '';
					if (GitErrors.notAValidObjectName.test(msg)) {
						scope?.error(
							ex,
							`'${targetBranch}' or '${branch}' not found - ensure the branches exist and are fully qualified (e.g. 'refs/heads/main')`,
						);
						return createConflictDetectionError('refNotFound');
					} else if (GitErrors.badRevision.test(msg)) {
						scope?.error(ex, `Invalid branch name: ${msg.slice(msg.indexOf("'"))}`);
						return createConflictDetectionError('refNotFound');
					} else if (GitErrors.noMergeBase.test(msg)) {
						scope?.error(
							ex,
							`Unable to merge '${branch}' and '${targetBranch}' as they have no common ancestor`,
						);
						return createConflictDetectionError('noMergeBase');
					} else if (ex instanceof GitError) {
						data = ex.stdout;
					} else {
						scope?.error(ex);
						return createConflictDetectionError('other');
					}
				}
				if (!data) return { status: 'clean' };

				const mergeConflict = parseMergeTreeConflict(data);
				if (!mergeConflict.conflicts.length) return { status: 'clean', treeOid: mergeConflict.treeOid };

				return {
					status: 'conflicts',
					conflict: {
						repoPath: repoPath,
						branch: branch,
						target: targetBranch,
						files: mergeConflict.conflicts,
						shas: undefined, // Merge conflicts don't have a specific commit SHA
					},
					treeOid: mergeConflict.treeOid,
				};
			},
			{ cancellation: cancellation },
		);
	}

	/** Detects conflicts when an autostash is reapplied onto the tree an integration produced */
	@debug()
	async getPotentialStashReapplyConflicts(
		repoPath: string,
		ontoTreeOid: string,
		cancellation?: AbortSignal,
	): Promise<ConflictDetectionResult> {
		// Requires Git v2.38+ for --write-tree with 3-arg form
		// `runMergeTreeStep` relies on `--merge-base`
		if (!(await this.git.supports('git:merge-tree:merge-base'))) {
			return createConflictDetectionError('unsupported');
		}

		// git stash create writes commit objects but touches neither the working tree nor the stash ref, and
		// captures tracked changes only — which is exactly what autostash does
		let stashSha: string;
		try {
			const result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
				'stash',
				'create',
			);
			stashSha = result.stdout.trim();
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			return createConflictDetectionError('other');
		}

		if (!stashSha) return { status: 'clean' };

		// Key on what the simulation actually consumes — the stash's tree and its first parent (the HEAD it was
		// taken against, and so the merge base). The stash SHA itself embeds a commit timestamp, so two runs over
		// an identical tree produce different SHAs and a SHA-keyed entry could never be hit.
		let stashTree: string;
		let stashParent: string;
		try {
			const result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
				'rev-parse',
				`${stashSha}^{tree}`,
				`${stashSha}^`,
			);
			[stashTree, stashParent] = result.stdout.trim().split('\n');
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			return createConflictDetectionError('other');
		}

		const cacheKey: ConflictDetectionCacheKey = `reapply:${ontoTreeOid}:${stashTree}.${stashParent}`;
		return this.cache.conflictDetection.getOrCreate(
			repoPath,
			cacheKey,
			async (_cacheable, signal) => {
				// The stash commit's first parent is the HEAD it was taken against, which is the correct merge
				// base for a reapply — ours is the post-integration tree, theirs is the stash
				const step = await this.runMergeTreeStep(repoPath, `${stashSha}^`, ontoTreeOid, stashSha, signal);
				if (!step.ok) return createConflictDetectionError(step.reason);

				if (!step.result.conflicts.length) return { status: 'clean', treeOid: step.result.treeOid };

				return {
					status: 'conflicts',
					conflict: {
						repoPath: repoPath,
						branch: stashSha,
						target: ontoTreeOid,
						files: step.result.conflicts,
						shas: undefined,
					},
					treeOid: step.result.treeOid,
				};
			},
			{ cancellation: cancellation },
		);
	}

	private async runMergeTreeStep(
		repoPath: string,
		base: string,
		ours: string,
		theirs: string,
		cancellation?: AbortSignal,
	): Promise<{ ok: true; result: GitMergeConflict } | { ok: false; reason: ConflictDetectionErrorReason }> {
		const scope = getScopedLogger();

		let data;
		try {
			const result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
				'merge-tree',
				'--write-tree',
				'-z',
				'--name-only',
				'--no-messages',
				`--merge-base=${base}`,
				ours,
				theirs,
			);
			data = result.stdout;
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			const msg: string = ex?.toString() ?? '';
			if (GitErrors.notAValidObjectName.test(msg)) {
				scope?.error(ex, `'${ours}' or '${theirs}' not found - ensure the branches/commits exist`);
				return { ok: false, reason: 'refNotFound' };
			} else if (GitErrors.badRevision.test(msg)) {
				scope?.error(ex, `Invalid revision: ${msg.slice(msg.indexOf("'"))}`);
				return { ok: false, reason: 'refNotFound' };
			} else if (GitErrors.noMergeBase.test(msg)) {
				scope?.error(ex, `Unable to merge '${ours}' and '${theirs}' as they have no common ancestor`);
				return { ok: false, reason: 'noMergeBase' };
			} else if (ex instanceof GitError) {
				data = ex.stdout;
			} else {
				scope?.error(ex, 'Failed to execute merge-tree for conflict check');
				return { ok: false, reason: 'other' };
			}
		}

		return { ok: true, result: parseMergeTreeConflict(data ?? '') };
	}

	private async checkForPotentialConflicts(
		repoPath: string,
		commits: Iterable<{ sha: string; parent: string }>,
		targetBranch: string,
		cancellation?: AbortSignal,
		options?: { stopOnFirstConflict?: boolean },
	): Promise<ConflictDetectionResult> {
		const scope = getScopedLogger();

		// Requires Git v2.38+ for --write-tree with 3-arg form
		// `runMergeTreeStep` relies on `--merge-base`
		if (!(await this.git.supports('git:merge-tree:merge-base'))) {
			return createConflictDetectionError('unsupported');
		}

		let currentTreeOid: string;
		try {
			// Get the initial target branch tree OID
			const treeResult = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
				'rev-parse',
				`${targetBranch}^{tree}`,
			);
			currentTreeOid = treeResult.stdout.trim();
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			scope?.error(ex, `Failed to resolve target branch '${targetBranch}'`);
			return createConflictDetectionError('refNotFound');
		}

		const conflictingShas: string[] = [];
		const conflictingFilePaths = new Set<string>();

		for (const commit of commits) {
			if (cancellation?.aborted) throw new CancellationError();

			// Use merge-tree --write-tree with --merge-base to simulate cherry-pick:
			// merge-tree --write-tree --merge-base=<commit-parent> <current-tree> <commit>
			// This performs a 3-way merge where:
			//   - base = commit.parent (where the commit started)
			//   - ours = currentTreeOid (current state of the target)
			//   - theirs = commit.sha (what we're cherry-picking)
			const step = await this.runMergeTreeStep(repoPath, commit.parent, currentTreeOid, commit.sha, cancellation);
			if (!step.ok) return createConflictDetectionError(step.reason);

			const mergeConflict = step.result;

			if (mergeConflict.conflicts.length) {
				conflictingShas.push(commit.sha);
				for (const file of mergeConflict.conflicts) {
					conflictingFilePaths.add(file.path);
				}

				if (options?.stopOnFirstConflict) {
					return {
						status: 'conflicts',
						conflict: {
							repoPath: repoPath,
							branch: commit.sha,
							target: targetBranch,
							files: mergeConflict.conflicts,
							shas: [commit.sha],
						},
						stoppedOnFirstConflict: true,
						treeOid: mergeConflict.treeOid || undefined,
					};
				}
			}

			// Update currentTreeOid to the result tree OID for the next iteration
			// This works even when there are conflicts - the tree contains conflict markers
			if (mergeConflict.treeOid) {
				currentTreeOid = mergeConflict.treeOid;
			}
		}

		if (conflictingShas.length) {
			return {
				status: 'conflicts',
				conflict: {
					repoPath: repoPath,
					branch: conflictingShas[0],
					target: targetBranch,
					files: Array.from(conflictingFilePaths, path => ({ path: path })),
					shas: conflictingShas,
				},
				stoppedOnFirstConflict: false,
				treeOid: currentTreeOid,
			};
		}

		return { status: 'clean', treeOid: currentTreeOid };
	}

	@debug({ exit: true })
	getBaseBranchName(
		repoPath: string,
		ref: string,
		options?: { priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		const priority = options?.priority;
		const priorityOpts = priority != null ? { priority: priority } : undefined;

		return this.cache.getBaseBranchName(
			repoPath,
			ref,
			async (commonPath, cacheable, signal) => {
				try {
					// getGkConfig has built-in fallback to regular config for backward compatibility
					let mergeBase = await this.provider.config.getGkConfig(commonPath, `branch.${ref}.gk-merge-base`);
					let update = false;

					// Also check vscode-merge-base in regular config (VS Code compatibility)
					if (mergeBase == null) {
						mergeBase = await this.provider.config.getConfig(commonPath, `branch.${ref}.vscode-merge-base`);
						update = mergeBase != null;
					}

					if (mergeBase != null) {
						const branch = await this.provider.refs.getSymbolicReferenceName(
							commonPath,
							mergeBase,
							priorityOpts,
						);
						if (branch != null) {
							if (update) {
								// Self-write: the value we're storing is exactly what this factory is
								// returning, so any in-flight `branchOverviews` or `baseBranchName` entry
								// being populated against this resolution should NOT be evicted.
								void this.storeBaseBranchName(commonPath, ref, branch, {
									skipInvalidation: ['branchOverviews', 'baseBranchName'],
								});
							}
							return branch;
						}
					}
				} catch {}

				const reflog = await this.getBaseBranchFromReflog(
					commonPath,
					ref,
					{ upstream: true, priority: priority },
					signal,
				);
				if (reflog.branch != null) {
					// Self-write: see comment on the migration path above.
					void this.storeBaseBranchName(commonPath, ref, reflog.branch, {
						skipInvalidation: ['branchOverviews', 'baseBranchName'],
					});
					return reflog.branch;
				}

				// This entry has no TTL and the `'branches'` cascade no longer clears it (a tip move can't
				// change a base), so a failed read cached as `undefined` would read as "no base branch" for
				// the rest of the session. Only a reflog that actually RAN and found nothing is an answer.
				if (reflog.failed) {
					cacheable.invalidate();
				}

				return undefined;
			},
			cancellation,
		);
	}

	/**
	 * `failed` separates "the reflog ran and had no answer" from "the read never happened" — the caller
	 * caches the former forever and must not cache the latter.
	 */
	private async getBaseBranchFromReflog(
		repoPath: string,
		ref: string,
		options?: { upstream: true; priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<{ branch: string | undefined; failed: boolean }> {
		const priority = options?.priority;
		const priorityOpts = priority != null ? { priority: priority } : undefined;

		try {
			const createdFrom = await this.getReflogCreatedFrom(repoPath, ref, priority, cancellation);
			if (createdFrom == null) return { branch: undefined, failed: false };

			// Check if branch created from an explicit branch
			if (createdFrom !== 'HEAD') {
				if (options?.upstream) {
					const upstream = await this.provider.refs.getSymbolicReferenceName(
						repoPath,
						`${createdFrom}@{u}`,
						priorityOpts,
					);
					if (upstream) return { branch: upstream, failed: false };
				}

				const name = await this.provider.refs.getSymbolicReferenceName(repoPath, createdFrom, priorityOpts);
				if (name) return { branch: name, failed: false };
			}

			// Check if branch was created from HEAD
			const entries = await this.provider.refs.getReflogEntries(
				repoPath,
				'HEAD',
				{ grep: `checkout: moving from .* to ${ref.replace('refs/heads/', '')}`, priority: priority },
				cancellation,
			);
			if (!entries.length) return { branch: undefined, failed: false };

			const match = entries.at(-1)!.message.match(/checkout: moving from ([^\s]+)\s/);
			if (match?.length === 2) {
				let name: string | undefined = match[1];
				if (options?.upstream) {
					const upstream = await this.provider.refs.getSymbolicReferenceName(
						repoPath,
						`${name}@{u}`,
						priorityOpts,
					);
					if (upstream) return { branch: upstream, failed: false };
				}

				name = await this.provider.refs.getSymbolicReferenceName(repoPath, name, priorityOpts);
				if (name) return { branch: name, failed: false };
			}
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			// A ref that is unborn, or gone since it was listed, has no reflog to read: an answer, not a failure
			const msg: string = ex?.toString() ?? '';
			const stderr = ex instanceof GitError ? ex.stderr : undefined;
			if (
				[GitErrors.badRevision, GitErrors.ambiguousArgument].some(
					error => error.test(msg) || (stderr != null && error.test(stderr)),
				)
			) {
				return { branch: undefined, failed: false };
			}

			// `getReflogEntries` rejects on a failed read, so a read that never happened isn't taken as "no base"
			return { branch: undefined, failed: true };
		}

		return { branch: undefined, failed: false };
	}

	/**
	 * The start point `ref`'s own reflog says it was created from (`branch: Created from <name>`), as git wrote it:
	 * a branch, `HEAD`, a sha, a tag or any other revision. `undefined` unless exactly one entry says so. Rejects
	 * when the reflog can't be read, including for a ref that doesn't exist.
	 */
	private async getReflogCreatedFrom(
		repoPath: string,
		ref: string,
		priority: GitCommandPriority | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		const entries = await this.provider.refs.getReflogEntries(
			repoPath,
			ref,
			{ grep: 'branch: Created from *.', priority: priority },
			cancellation,
		);
		if (entries.length !== 1) return undefined;

		return entries[0].message.match(/branch: Created from (.*)$/)?.[1];
	}

	/**
	 * The branch `branch` was created from, as a base for {@link getAheadOfBaseInOrder}: the name its own reflog
	 * gives, when that is a local or remote-tracking branch in the cached ref list and not `branch` itself or its
	 * copy on a remote (`git switch <branch>` creates it from `<remote>/<branch>`). Never the checkout history in
	 * HEAD's reflog, which on a long-lived checkout names whatever was checked out last.
	 */
	private async getCreatedFromTarget(
		repoPath: string,
		branch: string,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		const key = this.getBranchActivityKey(repoPath, branch);

		let name: string | undefined;
		if (this._branchCreatedFrom.has(key)) {
			name = this._branchCreatedFrom.get(key);
		} else {
			const generation = this._branchCreatedFromGenerations.get(key);
			try {
				name = await this.getReflogCreatedFrom(repoPath, `refs/heads/${branch}`, undefined, cancellation);
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				// Not remembered: a failed read is no answer, and a branch with no ref yet has no creation to read
				return undefined;
			}
			if (cancellation?.aborted) throw new CancellationError();

			if (this._branchCreatedFromGenerations.get(key) === generation) {
				this._branchCreatedFrom.set(key, name);
			}
		}

		// A ref starting with `-` would be parsed as a git flag
		if (!name || name === 'HEAD' || name.startsWith('-')) return undefined;

		// Only a listed branch: a sha, a tag or a revision expression (`main~2`) names no `refs/heads/` or
		// `refs/remotes/` ref
		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		const fullNames =
			name.startsWith('refs/heads/') || name.startsWith('refs/remotes/')
				? [name]
				: [`refs/heads/${name}`, `refs/remotes/${name}`];
		let listed = false;
		for (const fullName of fullNames) {
			if ((await this.getRefTip(repoPath, records, fullName, cancellation)) != null) {
				listed = true;
				break;
			}
		}
		if (!listed) return undefined;

		if (await this.isSelfRef(repoPath, name, branch, cancellation)) return undefined;

		return name;
	}

	@debug({ exit: true })
	async getAheadOfBase(
		repoPath: string,
		branch: string | undefined,
		options?: { skipUserTarget?: boolean; preferredTarget?: string },
		cancellation?: AbortSignal,
	): Promise<AheadOfBase> {
		// `undefined`, or a name that stands for a detached HEAD, has no branch to be recorded against or to be its own base
		if (branch != null && isDetachedHead(branch)) {
			branch = undefined;
		}

		const dependsOn = new Set<string>(branch != null ? [`refs/heads/${branch}`] : []);

		const preferredTarget = options?.preferredTarget?.trim() || undefined;
		if (preferredTarget == null) {
			return this.getAheadOfBaseInOrder(repoPath, branch, options?.skipUserTarget, dependsOn, cancellation);
		}

		let target = await this.getNearestForkTarget(repoPath, branch, preferredTarget, dependsOn, cancellation);
		if (target != null && branch != null && (await this.isSelfAtHead(repoPath, target.ref, branch, cancellation))) {
			target = undefined;
		}

		// The tolerant reads above answer a cancelled run as "nothing there"; that is no answer
		if (cancellation?.aborted) throw new CancellationError();

		if (target != null) {
			return this.measureAheadOfBase(repoPath, target, 'preferred', dependsOn, cancellation);
		}

		return this.getAheadOfBaseInOrder(repoPath, branch, options?.skipUserTarget, dependsOn, cancellation);
	}

	/**
	 * Resolves the base from the recorded candidates, then the branch it was created from or the default branch, for
	 * {@link getAheadOfBase}
	 */
	private async getAheadOfBaseInOrder(
		repoPath: string,
		branch: string | undefined,
		skipUserTarget: boolean | undefined,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
	): Promise<AheadOfBase> {
		let target: { ref: string; forkPoint: string | undefined } | undefined;
		let tier: AheadOfBaseTier = 'default';
		if (branch != null) {
			for (const candidate of await this.getRecordedBaseCandidates(repoPath, branch, skipUserTarget)) {
				target = await this.getNearestForkTarget(repoPath, branch, candidate.ref, dependsOn, cancellation);
				if (target != null) {
					tier = candidate.tier;
					break;
				}
			}
		}

		if (target == null) {
			const defaultBranch = await this.getLocalDefaultBranchName(repoPath, dependsOn, cancellation);
			// Before the reflog read: the default branch measures against its own upstream, even a gitflow `develop`
			// created from `main`
			if (branch != null && defaultBranch === branch) {
				return this.measureAheadOfSelfUpstream(repoPath, branch, dependsOn, cancellation);
			}

			const createdFrom =
				branch != null ? await this.getCreatedFromTarget(repoPath, branch, cancellation) : undefined;
			if (createdFrom != null) {
				const created = await this.getCreatedFromForkTarget(
					repoPath,
					branch,
					createdFrom,
					defaultBranch,
					dependsOn,
					cancellation,
				);
				if (created != null) {
					({ target, tier } = created);
				}
			} else {
				target = await this.getUpstreamNearestForkTarget(
					repoPath,
					branch,
					defaultBranch,
					dependsOn,
					cancellation,
				);
			}
		}

		// The tolerant reads above answer a cancelled run as "nothing there"; that is no answer
		if (cancellation?.aborted) throw new CancellationError();
		if (target == null) {
			let unborn = false;
			// A detached HEAD always has a commit, and so does a branch the cached refs list
			if (branch != null) {
				try {
					const records = await this.provider.refs.getRefs(repoPath, cancellation);
					unborn =
						findRefTip(records, `refs/heads/${branch}`) == null &&
						(await this.isUnbornHead(repoPath, cancellation));
				} catch (ex) {
					if (isCancellationError(ex)) throw ex;
				}
			}

			return { base: undefined, reason: unborn ? 'unborn' : 'none', dependsOn: [...dependsOn] };
		}

		// A base that is the branch itself, locally or as its copy on one of the repo's remotes, at HEAD's own commit has
		// nothing to measure against: no base, not "0 ahead" (an up-to-date `main` targeting `origin/main`). At a different
		// commit it stays the base, since the work ahead of it is work not yet pushed
		if (branch != null && (await this.isSelfAtHead(repoPath, target.ref, branch, cancellation))) {
			return { base: undefined, reason: 'self', dependsOn: [...dependsOn] };
		}

		return this.measureAheadOfBase(repoPath, target, tier, dependsOn, cancellation);
	}

	/**
	 * The base for a branch created from `createdFrom`: that branch, unless the default branch forked strictly nearer
	 * HEAD, as it does once `createdFrom` merged into it and the branch was rebased onto it. A stacked branch's
	 * unmerged parent forked nearer, and stays its base. `undefined` when neither is usable.
	 */
	private async getCreatedFromForkTarget(
		repoPath: string,
		branch: string | undefined,
		createdFrom: string,
		defaultBranch: string | undefined,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
	): Promise<{ target: { ref: string; forkPoint: string | undefined }; tier: AheadOfBaseTier } | undefined> {
		const skipDefault =
			defaultBranch == null ||
			createdFrom === defaultBranch ||
			createdFrom === `refs/heads/${defaultBranch}` ||
			createdFrom === `refs/remotes/${defaultBranch}`;
		const [created, fallback] = await Promise.all([
			this.getUpstreamNearestForkTarget(repoPath, branch, createdFrom, dependsOn, cancellation),
			skipDefault
				? undefined
				: this.getUpstreamNearestForkTarget(repoPath, branch, defaultBranch, dependsOn, cancellation),
		]);
		if (created == null) return fallback != null ? { target: fallback, tier: 'default' } : undefined;

		if (
			created.forkPoint != null &&
			fallback?.forkPoint != null &&
			created.forkPoint !== fallback.forkPoint &&
			(await this.provider.commits.isAncestorOf(repoPath, created.forkPoint, fallback.forkPoint, cancellation))
		) {
			return { target: fallback, tier: 'default' };
		}
		return { target: created, tier: 'created' };
	}

	/** Counts HEAD's commits past `target` for {@link getAheadOfBase} */
	private async measureAheadOfBase(
		repoPath: string,
		target: { ref: string; forkPoint: string | undefined },
		tier: AheadOfBaseTier,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
	): Promise<AheadOfBase> {
		const [countsResult, refsResult] = await Promise.allSettled([
			this.countAgainstBase(repoPath, target.ref, cancellation),
			// The same cached `for-each-ref` the branch list reads, so the tip usually costs nothing
			this.provider.refs.getRefs(repoPath, cancellation),
		]);
		if (cancellation?.aborted) throw new CancellationError();
		if (countsResult.status === 'rejected') throw countsResult.reason;

		const counts = countsResult.value;
		if (counts == null) return { base: undefined, reason: 'unborn', dependsOn: [...dependsOn] };

		return {
			base: {
				ref: target.ref,
				ahead: counts.right,
				sha: findRefTip(getSettledValue(refsResult, []), target.ref),
				forkPoint: target.forkPoint,
				tier: tier,
			},
			dependsOn: [...dependsOn],
		};
	}

	/** Counts the default branch's own commits past its upstream (see {@link getSelfUpstreamTarget}) for {@link getAheadOfBase} */
	private async measureAheadOfSelfUpstream(
		repoPath: string,
		branch: string,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
	): Promise<AheadOfBase> {
		const upstream = await this.getSelfUpstreamTarget(repoPath, branch, dependsOn, cancellation);
		if (cancellation?.aborted) throw new CancellationError();
		if (upstream == null) return { base: undefined, reason: 'self', dependsOn: [...dependsOn] };

		const counts = await this.countAgainstBase(repoPath, upstream.ref, cancellation);
		if (counts == null) return { base: undefined, reason: 'unborn', dependsOn: [...dependsOn] };
		// Only the same commit leaves neither side a commit the other lacks
		if (counts.left === 0 && counts.right === 0) {
			return { base: undefined, reason: 'self', dependsOn: [...dependsOn] };
		}

		// An upstream with nothing HEAD lacks is an ancestor of HEAD, so its tip is where HEAD forked from it
		const forkPoint =
			counts.left === 0 ? upstream.sha : await this.getForkPoint(repoPath, upstream.ref, cancellation);
		if (cancellation?.aborted) throw new CancellationError();

		return {
			base: { ref: upstream.ref, ahead: counts.right, sha: upstream.sha, forkPoint: forkPoint, tier: 'upstream' },
			dependsOn: [...dependsOn],
		};
	}

	/**
	 * HEAD's count against `ref` from their merge base: `left` only `ref` has, `right` only HEAD has. `undefined`
	 * before HEAD's first commit, when there is nothing to count; any other failure rejects with git's error.
	 */
	private async countAgainstBase(
		repoPath: string,
		ref: string,
		cancellation: AbortSignal | undefined,
	): Promise<{ left: number; right: number } | undefined> {
		// `...` counts from the merge base, so only the branch's own commits count, not what the base moved on with
		const range = createRevisionRange(ref, 'HEAD', '...');

		let counts: { left: number; right: number } | undefined;
		try {
			counts = await this.provider.commits.getLeftRightCommitCount(repoPath, range, undefined, cancellation);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
		}
		if (cancellation?.aborted) throw new CancellationError();
		if (counts != null) return counts;

		// The cached count keeps a failure, so re-run it uncached
		try {
			return await this.getLeftRightCountUncached(repoPath, range, cancellation);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
			if (await this.isUnbornHead(repoPath, cancellation)) return undefined;

			throw ex;
		}
	}

	@debug({ exit: true })
	async getAheadBehindCounts(
		repoPath: string,
		base: string,
		options?: { remotes?: boolean; refs?: readonly string[] },
		cancellation?: AbortSignal,
	): Promise<Map<string, { ahead: number; behind: number }>> {
		const counts = new Map<string, { ahead: number; behind: number }>();

		const refs = options?.refs != null ? new Set(options.refs) : undefined;
		if (refs?.size === 0) return counts;

		// for-each-ref also matches below a pattern (`refs/heads/a` matches `refs/heads/a/b`), so named refs are kept
		// to the exact set; a list too long for the command line is read whole and filtered
		let patterns: string[];
		if (refs == null) {
			patterns = options?.remotes ? ['refs/heads', 'refs/remotes'] : ['refs/heads'];
		} else if (sum(refs, r => r.length + 1) < maxGitCliLength / 2) {
			patterns = [...refs];
		} else {
			patterns = ['refs/heads', 'refs/remotes'];
		}

		// The format atom ends at the first `)`, which a ref name may contain, so such a base is counted per branch
		if (!base.includes(')') && (await this.git.supports('git:for-each-ref:ahead-behind'))) {
			// Tab-separated: ref names can't contain control characters, so no field or line can hold one
			const result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
				'for-each-ref',
				`--format=%(refname)%09%(symref)%09%(ahead-behind:${base})`,
				...patterns,
			);
			if (result.completion.status === 'cancelled' || cancellation?.aborted) throw new CancellationError();

			for (const line of result.stdout.split('\n')) {
				if (!line) continue;

				const [ref, symref, counted] = line.split('\t');
				if (symref || (refs != null && !refs.has(ref))) continue;

				const [ahead, behind] = (counted ?? '').split(' ').map(n => parseInt(n, 10));
				if (isNaN(ahead) || isNaN(behind)) {
					throw new Error(`Unexpected output counting the commits ahead of and behind '${base}': ${line}`);
				}

				counts.set(ref, { ahead: ahead, behind: behind });
			}

			return counts;
		}

		// A leading dash would be read as an option by the `rev-parse` and `rev-list` below
		if (base.startsWith('-')) throw new Error(`Invalid base '${base}'`);

		const [refsResult, baseResult] = await Promise.allSettled([
			this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
				'for-each-ref',
				'--format=%(refname)%09%(symref)%09%(objectname)',
				...patterns,
			),
			this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
				'rev-parse',
				'--is-shallow-repository',
				'--verify',
				`${base}^{commit}`,
			),
		]);
		if (refsResult.status === 'rejected') throw refsResult.reason;

		const result = refsResult.value;
		if (result.completion.status === 'cancelled' || cancellation?.aborted) throw new CancellationError();

		// Refs grouped by the commit they point at, so each tip is counted once
		const refsByTip = new Map<string, string[]>();
		for (const line of result.stdout.split('\n')) {
			const [ref, symref, sha] = line.split('\t');
			if (!ref || symref || !sha || (refs != null && !refs.has(ref))) continue;

			const tipRefs = refsByTip.get(sha);
			if (tipRefs == null) {
				refsByTip.set(sha, [ref]);
			} else {
				tipRefs.push(ref);
			}
		}
		if (!refsByTip.size) return counts;

		if (baseResult.status === 'rejected') throw baseResult.reason;
		if (baseResult.value.completion.status === 'cancelled' || cancellation?.aborted) {
			throw new CancellationError();
		}

		const [shallow, baseSha] = baseResult.value.stdout.trim().split('\n');
		// Deepening a shallow clone changes what a pair of commits counts; git before 2.15 echoes the unknown option
		const cacheable = shallow === 'false';
		const countsByTip = new Map<string, { ahead: number; behind: number }>();
		const uncounted: string[] = [];
		for (const sha of refsByTip.keys()) {
			if (sha === baseSha) {
				countsByTip.set(sha, { ahead: 0, behind: 0 });
				continue;
			}

			const range = createRevisionRange(baseSha, sha, '...');
			const cached = cacheable ? this.aheadBehindBySha.get(range) : undefined;
			if (cached != null) {
				this.aheadBehindBySha.touch(range);
				countsByTip.set(sha, cached);
			} else {
				uncounted.push(sha);
			}
		}

		const results = await mapBounded(uncounted, 8, async sha => {
			const range = createRevisionRange(baseSha, sha, '...');
			// The base is the left side of the range, so `left` is what the branch lacks and `right` what it adds
			const lr = await this.getLeftRightCountUncached(repoPath, range, cancellation, 'background');
			const tipCounts = { ahead: lr.right, behind: lr.left };
			// Remembered as each lands, so a tip that fails doesn't cost the next call the counts that didn't
			if (cacheable) {
				this.aheadBehindBySha.set(range, tipCounts);
			}
			return { sha: sha, counts: tipCounts };
		});
		for (const { sha, counts: tipCounts } of results) {
			countsByTip.set(sha, tipCounts);
		}

		for (const [sha, tipRefs] of refsByTip) {
			const tipCounts = countsByTip.get(sha)!;
			for (const ref of tipRefs) {
				counts.set(ref, { ...tipCounts });
			}
		}

		return counts;
	}

	@debug({ exit: true })
	async getMergedBranches(
		repoPath: string,
		into: string,
		options?: { remotes?: boolean },
		cancellation?: AbortSignal,
	): Promise<Set<string>> {
		const patterns = options?.remotes ? ['refs/heads', 'refs/remotes'] : ['refs/heads'];

		// Tab-separated: ref names can't contain control characters, so no field or line can hold one
		const result = await this.git.run(
			{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
			'for-each-ref',
			`--merged=${into}`,
			'--format=%(refname)%09%(symref)',
			...patterns,
		);
		if (result.completion.status === 'cancelled' || cancellation?.aborted) throw new CancellationError();

		const merged = new Set<string>();
		for (const line of result.stdout.split('\n')) {
			if (!line) continue;

			const [ref, symref] = line.split('\t');
			if (symref) continue;

			merged.add(ref);
		}

		return merged;
	}

	/** Counts `range` with a fresh `rev-list`, bypassing the cached count. Rejects on any failure, with git's error */
	private async getLeftRightCountUncached(
		repoPath: string,
		range: GitRevisionRange,
		cancellation: AbortSignal | undefined,
		priority?: GitCommandPriority,
	): Promise<{ left: number; right: number }> {
		const result = await this.git.run(
			{ cwd: repoPath, cancellation: cancellation, errors: 'throw', priority: priority },
			'rev-list',
			'--left-right',
			'--count',
			range,
			'--',
		);
		if (result.completion.status === 'cancelled' || cancellation?.aborted) throw new CancellationError();

		const parts = result.stdout.split('\t');
		const left = parseInt(parts[0], 10);
		const right = parseInt(parts[1], 10);
		if (parts.length !== 2 || isNaN(left) || isNaN(right)) {
			throw new Error(`Unexpected output counting the commits in '${range}': ${result.stdout}`);
		}

		return { left: left, right: right };
	}

	/** Whether HEAD names a branch with no commit yet. Rejects when that can't be read, so a failure isn't taken for an empty branch */
	private async isUnbornHead(repoPath: string, cancellation: AbortSignal | undefined): Promise<boolean> {
		const result = await this.git.run(
			{ cwd: repoPath, cancellation: cancellation, errors: 'throw', expectedExitCodes: [1] },
			'rev-parse',
			'--verify',
			'--quiet',
			'HEAD',
		);
		return result.exitCode === 1;
	}

	/**
	 * Whether `ref` names `branch` itself: the same name, or `<remote>/<branch>` for one of the repo's actual remotes,
	 * short or as a full ref. Splitting at the first slash instead would call a local `release/main` the same branch
	 * as `main`.
	 */
	private async isSelfRef(
		repoPath: string,
		ref: string,
		branch: string,
		cancellation: AbortSignal | undefined,
	): Promise<boolean> {
		// A full local ref is never a remote copy, even one named like `origin/<branch>`
		if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length) === branch;

		if (ref.startsWith('refs/remotes/')) {
			ref = ref.slice('refs/remotes/'.length);
		}

		if (ref === branch) return true;

		const suffix = `/${branch}`;
		if (!ref.endsWith(suffix)) return false;

		const remoteName = ref.slice(0, -suffix.length);
		if (!remoteName) return false;

		return (await this.getRemoteNames(repoPath, cancellation)).includes(remoteName);
	}

	/** The repo's remote names from the cached remote list; empty when it can't be read */
	private async getRemoteNames(repoPath: string, cancellation: AbortSignal | undefined): Promise<string[]> {
		try {
			const remotes = await this.provider.remotes.getRemotes(repoPath, undefined, cancellation);
			return remotes.map(r => r.name);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			return [];
		}
	}

	/** Whether `ref` names `branch` itself (see {@link isSelfRef}) and sits at HEAD's commit; tips are read only after the name matched */
	private async isSelfAtHead(
		repoPath: string,
		ref: string,
		branch: string,
		cancellation: AbortSignal | undefined,
	): Promise<boolean> {
		if (!(await this.isSelfRef(repoPath, ref, branch, cancellation))) return false;

		const [refSha, headSha] = await Promise.all([
			this.provider.refs.validateReference(repoPath, ref, undefined, cancellation),
			this.provider.refs.validateReference(repoPath, 'HEAD', undefined, cancellation),
		]);
		return refSha != null && refSha === headSha;
	}

	/**
	 * The bases recorded against a branch, most trusted first: the user's merge target, the detected one, then the
	 * base a launch recorded. Only the stored value of the latter — `getBaseBranchName` would fall back to a reflog
	 * guess, which on a long-lived checkout names whatever branch was last checked out from. A failed read is absent.
	 */
	private async getRecordedBaseCandidates(
		repoPath: string,
		branch: string,
		skipUserTarget: boolean | undefined,
	): Promise<{ ref: string; tier: AheadOfBaseTier }[]> {
		const tolerate = async (read: () => Promise<string | undefined>): Promise<string | undefined> => {
			try {
				return (await read())?.trim() || undefined;
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				return undefined;
			}
		};

		const reads = await Promise.all([
			skipUserTarget ? undefined : tolerate(() => this.getStoredUserMergeTargetBranchName(repoPath, branch)),
			tolerate(() => this.getStoredDetectedMergeTargetBranchName(repoPath, branch)),
			tolerate(() => this.provider.config.getGkConfig(repoPath, `branch.${branch}.gk-merge-base`)),
		]);

		const tiers: AheadOfBaseTier[] = ['user', 'detected', 'recorded'];

		const candidates: { ref: string; tier: AheadOfBaseTier }[] = [];
		for (const [i, ref] of reads.entries()) {
			if (ref && !candidates.some(c => c.ref === ref)) {
				candidates.push({ ref: ref, tier: tiers[i] });
			}
		}
		return candidates;
	}

	/**
	 * The repo's default branch from local refs only, never the network: the `HEAD` symref of the `upstream` remote,
	 * else of `origin`, else of the first remote, as its local branch or else as the remote ref; then, in the same
	 * remote order, `<remote>/main` or `<remote>/master`, again as the local branch of that name or else the remote
	 * ref; then `init.defaultBranch`, `main`, `master` — each only if it names a commit.
	 */
	private async getLocalDefaultBranchName(
		repoPath: string,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		// From the cached ref list the base reads anyway, so naming a branch spawns nothing
		let records: readonly RefRecord[] | undefined;
		const exists = async (ref: string): Promise<boolean> => {
			records ??= await this.provider.refs.getRefs(repoPath, cancellation);
			return (await this.getRefTip(repoPath, records, ref, cancellation)) != null;
		};

		const remotes = await this.getRemoteNames(repoPath, cancellation);
		// Each in turn: a remote added after the clone (`upstream`, typically) has no `HEAD` symref until
		// `remote set-head` writes one, and must not hide `origin`'s
		const preferred = new Set(
			[remotes.find(r => r === 'upstream'), remotes.find(r => r === 'origin'), remotes.at(0)].filter(
				r => r != null,
			),
		);
		for (const remote of preferred) {
			dependsOn.add(`refs/remotes/${remote}/HEAD`);

			const symref = await this.getDefaultBranchName(repoPath, remote, { local: true }, cancellation);
			// A remote name can hold a slash, so strip exactly the remote's own prefix
			const local = symref?.startsWith(`${remote}/`) ? symref.slice(remote.length + 1) : undefined;
			if (!symref || !local) continue;

			addRefDependencies(dependsOn, local);
			if (await exists(local)) return local;

			addRefDependencies(dependsOn, symref);
			if (await exists(symref)) return symref;
		}

		// A missing symref is common (git < 2.48 fetches don't create it, nor do fetches of explicit refspecs), so
		// guess from the remote's usual default names
		for (const remote of preferred) {
			for (const name of ['main', 'master']) {
				const remoteRef = `refs/remotes/${remote}/${name}`;
				dependsOn.add(remoteRef);
				if (!(await exists(remoteRef))) continue;

				addRefDependencies(dependsOn, name);
				return (await exists(name)) ? name : `${remote}/${name}`;
			}
		}

		let fromConfig: string | undefined;
		try {
			fromConfig = (await this.provider.config.getConfig(repoPath, 'init.defaultBranch'))?.trim() || undefined;
		} catch {}

		for (const candidate of [fromConfig, 'main', 'master']) {
			if (!candidate) continue;

			addRefDependencies(dependsOn, candidate);
			if (await exists(candidate)) return candidate;
		}

		return undefined;
	}

	/**
	 * `upstream/<name>` for a created-from or default base `<name>` (or `<remote>/<name>`), as another ref that base
	 * is measured against: in a fork whose `main` tracks `origin/main`, a branch taken off (or since rebased onto) a
	 * newer `upstream/main` would otherwise count the commits `origin` hasn't caught up on. Read from the cached
	 * remote and ref lists; `undefined` when there is no `upstream` remote, it lacks the branch, or the base is that
	 * ref itself.
	 */
	private async getUpstreamContender(
		repoPath: string,
		base: string | undefined,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		if (!base) return undefined;

		const remotes = await this.getRemoteNames(repoPath, cancellation);
		if (!remotes.includes('upstream')) return undefined;

		const records = await this.provider.refs.getRefs(repoPath, cancellation);

		// The reflog keeps a start point as typed, so a created-from base can be a full ref
		let name = base;
		if (name.startsWith('refs/heads/')) {
			name = name.slice('refs/heads/'.length);
		} else {
			const isRemoteRef = name.startsWith('refs/remotes/');
			if (isRemoteRef) {
				name = name.slice('refs/remotes/'.length);
			}

			if (isRemoteRef || findRefTip(records, `refs/heads/${name}`) == null) {
				// A remote name can hold a slash, so strip exactly a remote's own prefix
				const remote = remotes.find(r => name.startsWith(`${r}/`));
				if (remote != null) {
					name = name.slice(remote.length + 1);
				}
			}
		}

		const contender = `upstream/${name}`;
		const remoteRef = `refs/remotes/${contender}`;
		if (contender === base || remoteRef === base || findRefTip(records, remoteRef) == null) return undefined;

		dependsOn.add(remoteRef);
		return contender;
	}

	/** {@link getNearestForkTarget} with the `upstream` remote's copy of `candidate` as its contender */
	private async getUpstreamNearestForkTarget(
		repoPath: string,
		branch: string | undefined,
		candidate: string | undefined,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
	): Promise<{ ref: string; forkPoint: string | undefined } | undefined> {
		return this.getNearestForkTarget(repoPath, branch, candidate, dependsOn, cancellation, {
			contender: await this.getUpstreamContender(repoPath, candidate, dependsOn, cancellation),
		});
	}

	/**
	 * A candidate base as the ref HEAD is measured against: the candidate or its tracking ref, whichever forked
	 * nearer HEAD, so a stale local base defers to its upstream while one carrying unpushed work wins over it. A
	 * `contender` other than the tracking ref is taken only when it forked strictly nearer than both, so a tie keeps
	 * the candidate's own pick. A candidate none forks from is used as-is if it names a commit. `undefined` when the
	 * candidate is unusable.
	 */
	private async getNearestForkTarget(
		repoPath: string,
		branch: string | undefined,
		candidate: string | undefined,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
		options?: { contender?: string },
	): Promise<{ ref: string; forkPoint: string | undefined } | undefined> {
		// A ref starting with `-` would be parsed as a git flag
		if (!candidate || candidate.startsWith('-')) return undefined;
		// A branch measured against itself says nothing
		if (candidate === branch || candidate === `refs/heads/${branch}`) return undefined;

		addRefDependencies(dependsOn, candidate);

		const upstreamName = this.provider.refs.getSymbolicReferenceName(
			repoPath,
			`${candidate}@{u}`,
			undefined,
			cancellation,
		);
		const getUpstreamFork = async (): Promise<{ ref: string; mergeBase: string | undefined } | undefined> => {
			const upstream = await upstreamName;
			if (!upstream || upstream.startsWith('-')) return undefined;

			addRefDependencies(dependsOn, upstream);
			return { ref: upstream, mergeBase: await this.getForkPoint(repoPath, upstream, cancellation) };
		};

		const contender = options?.contender;
		const getContenderMergeBase = async (): Promise<string | undefined> => {
			if (contender == null) return undefined;

			// At the candidate's or its tracking ref's tip it can only tie, and a tie isn't the contender's
			const records = await this.provider.refs.getRefs(repoPath, cancellation);
			const tip = findRefTip(records, contender);
			if (tip != null) {
				if (tip === findRefTip(records, candidate)) return undefined;

				const upstream = await upstreamName;
				if (upstream && tip === findRefTip(records, upstream)) return undefined;
			}
			return this.getForkPoint(repoPath, contender, cancellation);
		};

		const [candidateMergeBase, upstreamFork, contenderMergeBase] = await Promise.all([
			this.getForkPoint(repoPath, candidate, cancellation),
			getUpstreamFork(),
			getContenderMergeBase(),
		]);

		let nearest: { ref: string; mergeBase: string } | undefined;
		for (const fork of [{ ref: candidate, mergeBase: candidateMergeBase }, upstreamFork]) {
			if (fork?.mergeBase == null) continue;

			// A later ref wins only when it forked at or past the nearest so far
			if (
				nearest == null ||
				nearest.mergeBase === fork.mergeBase ||
				(await this.provider.commits.isAncestorOf(repoPath, nearest.mergeBase, fork.mergeBase, cancellation))
			) {
				nearest = { ref: fork.ref, mergeBase: fork.mergeBase };
			}
		}

		if (
			contender != null &&
			contender !== upstreamFork?.ref &&
			contenderMergeBase != null &&
			nearest != null &&
			nearest.mergeBase !== contenderMergeBase &&
			(await this.provider.commits.isAncestorOf(repoPath, nearest.mergeBase, contenderMergeBase, cancellation))
		) {
			nearest = { ref: contender, mergeBase: contenderMergeBase };
		}
		if (nearest != null) return { ref: nearest.ref, forkPoint: nearest.mergeBase };

		return (await this.provider.refs.validateReference(repoPath, candidate, undefined, cancellation))
			? { ref: candidate, forkPoint: undefined }
			: undefined;
	}

	/**
	 * The base for a branch that is itself the default branch, with its tip: its own upstream, `upstream/<branch>`
	 * when an `upstream` remote has it, else `<branch>@{u}`. Read from the cached ref and branch lists; only a
	 * `<branch>` that isn't checked out spawns, for its `@{u}`. `undefined` when there is neither, or its ref is gone.
	 */
	private async getSelfUpstreamTarget(
		repoPath: string,
		branch: string,
		dependsOn: Set<string>,
		cancellation: AbortSignal | undefined,
	): Promise<{ ref: string; sha: string } | undefined> {
		const records = await this.provider.refs.getRefs(repoPath, cancellation);

		let upstream: string | undefined;
		if ((await this.getRemoteNames(repoPath, cancellation)).includes('upstream')) {
			const remoteRef = `refs/remotes/upstream/${branch}`;
			dependsOn.add(remoteRef);
			if ((await this.getRefTip(repoPath, records, remoteRef, cancellation)) != null) {
				upstream = `upstream/${branch}`;
			}
		}

		if (upstream == null) {
			let tracking: string | undefined;
			const current = await this.getBranch(repoPath, undefined, undefined, cancellation);
			if (current?.name === branch && !current.detached && !current.remote) {
				tracking = current.upstream?.name;
				// A gone upstream is still depended on, so the fetch or push that recreates it brings the base back
				if (tracking && current.upstream?.missing) {
					addRefDependencies(dependsOn, tracking);
					return undefined;
				}
			} else {
				tracking = await this.provider.refs.getSymbolicReferenceName(
					repoPath,
					`${branch}@{u}`,
					undefined,
					cancellation,
				);
			}
			if (!tracking || tracking.startsWith('-')) return undefined;

			addRefDependencies(dependsOn, tracking);
			upstream = tracking;
		}

		const sha = await this.getRefTip(repoPath, records, upstream, cancellation);
		return sha != null ? { ref: upstream, sha: sha } : undefined;
	}

	/**
	 * {@link findRefTip} in `records`, the cached ref list. `getRefs` answers a failed enumeration with an empty list,
	 * so an empty one is asked of git instead, rather than read as every ref being absent.
	 */
	private async getRefTip(
		repoPath: string,
		records: readonly RefRecord[],
		name: string,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		if (records.length) return findRefTip(records, name);

		return this.provider.refs.validateReference(repoPath, name, undefined, cancellation);
	}

	/** The merge base of HEAD and `ref`, preferring git's fork-point reading of `ref`'s reflog when it has one */
	private async getForkPoint(
		repoPath: string,
		ref: string,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		const forkPoint = await this.provider.refs.getMergeBase(
			repoPath,
			ref,
			'HEAD',
			{ forkPoint: true },
			cancellation,
		);
		return forkPoint ?? this.provider.refs.getMergeBase(repoPath, 'HEAD', ref, undefined, cancellation);
	}

	/**
	 * The stored merge target — the user's pick, else the one detected from its PR — skipping any whose branch git
	 * confirms is gone so resolution falls through to the next source. A target that couldn't be checked is kept.
	 * The stored keys are never rewritten here: the user pick is the user's, and Kepler shares the file.
	 */
	@debug({ exit: true })
	async getStoredMergeTargetBranchName(
		repoPath: string,
		ref: string,
		options?: { detectedOnly?: boolean; priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		const priority = options?.priority;

		let goneUserTarget: string | undefined;
		if (!options?.detectedOnly) {
			const userTarget = await this.getStoredUserMergeTargetBranchName(repoPath, ref);
			if (userTarget) {
				const resolved = await this.resolveStoredMergeTarget(repoPath, userTarget, priority, cancellation);
				if (resolved) return resolved;

				goneUserTarget = userTarget;
			}
		}

		const detectedTarget = await this.getStoredDetectedMergeTargetBranchName(repoPath, ref);
		if (!detectedTarget || detectedTarget === goneUserTarget) return undefined;

		return this.resolveStoredMergeTarget(repoPath, detectedTarget, priority, cancellation);
	}

	private async resolveStoredMergeTarget(
		repoPath: string,
		target: string,
		priority: GitCommandPriority | undefined,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		const { name, missing } = await this.provider.refs.getSymbolicReferenceNameOrMissing(
			repoPath,
			target,
			priority != null ? { priority: priority } : undefined,
			cancellation,
		);
		return missing ? undefined : name || target;
	}

	@debug({ exit: true })
	async getStoredDetectedMergeTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const target =
			(await this.provider.config.getGkConfig(repoPath, `branch.${ref}.gk-merge-target`)) ??
			(await this.provider.config.getGkConfig(repoPath, `branch.${ref}.gk-target-base`)); // legacy key
		return target?.trim() || undefined;
	}

	@debug()
	async getStoredUserMergeTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const target = await this.provider.config.getGkConfig(repoPath, `branch.${ref}.gk-merge-target-user`);
		return target?.trim() || undefined;
	}

	@trace()
	onCurrentBranchAccessed(repoPath: string): Promise<void> {
		return this.recordBranchActivity(repoPath, ['gk-last-accessed']);
	}

	// Called on every working-tree change, and writes at most once per 5 minutes per stamp
	@trace()
	onCurrentBranchModified(repoPath: string): Promise<void> {
		return this.recordBranchActivity(repoPath, ['gk-last-accessed', 'gk-last-modified']);
	}

	@trace()
	onCurrentBranchAgentActivity(repoPath: string): Promise<void> {
		return this.recordBranchActivity(repoPath, ['gk-agent-last-activity']);
	}

	private getBranchActivityKey(repoPath: string, name: string): string {
		return `${this.cache.getCommonPath(repoPath)}\0${name}`;
	}

	private forgetBranchCreatedFrom(repoPath: string, name: string): void {
		const key = this.getBranchActivityKey(repoPath, name);
		this._branchCreatedFrom.delete(key);
		this._branchCreatedFromGenerations.set(key, (this._branchCreatedFromGenerations.get(key) ?? 0) + 1);
	}

	/** Forgets this process's throttle marks for `name`, so its next activity re-reads the stored stamps */
	private clearBranchActivityStamps(repoPath: string, name: string): void {
		const branchKey = this.getBranchActivityKey(repoPath, name);
		for (const key of branchActivityKeys) {
			this._branchActivityStamps.delete(`${branchKey}\0${key}`);
		}
	}

	/** Never rejects — activity stamps are bookkeeping and callers fire them without a catch */
	private async recordBranchActivity(repoPath: string, keys: readonly BranchActivityKey[]): Promise<void> {
		const scope = getScopedLogger();

		try {
			const branch = await this.getBranch(repoPath);
			if (branch == null || branch.remote || branch.detached) return;

			const branchKey = this.getBranchActivityKey(repoPath, branch.name);
			await this._branchActivityCalls.run(branchKey, undefined, async () => {
				const now = Date.now();

				// Kept if the write fails, so a failing write is retried after 5 minutes rather than on every call
				const due: BranchActivityKey[] = [];
				for (const key of keys) {
					const stampKey = `${branchKey}\0${key}`;
					const last = this._branchActivityStamps.get(stampKey);
					if (last != null && now - last < dateMetadataStaleThresholdMs) continue;

					this._branchActivityStamps.set(stampKey, now);
					due.push(key);
				}
				if (!due.length) return;

				// Every due key is read before any is written: a write drops the cached gk config, so a read after it
				// would re-read the whole file
				const stored = await Promise.allSettled(
					due.map(key => this.provider.config.getGkConfig(repoPath, `branch.${branch.name}.${key}`)),
				);

				const value = new Date(now).toISOString();
				for (const [i, key] of due.entries()) {
					// Another process sharing the file stamped it under 5 minutes ago: hold off until that stamp goes
					// stale, not for 5 minutes from now
					const stamp = getSettledValue(stored[i]);
					const last = stamp != null ? new Date(stamp).getTime() : NaN;
					if (now - last < dateMetadataStaleThresholdMs) {
						this._branchActivityStamps.set(`${branchKey}\0${key}`, last);
						continue;
					}

					await this.provider.config.setGkConfig(repoPath, `branch.${branch.name}.${key}`, value);
				}
			});
		} catch (ex) {
			scope?.error(ex, `Failed to record branch activity (${keys.join(', ')})`);
		}
	}

	@debug()
	async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
		const args = ['branch', '-m', oldName, newName];
		try {
			await this.git.run({ cwd: repoPath }, ...args);
			// The branch keeps its identity across a rename, so move its stored gk metadata with it —
			// otherwise the new name re-derives a base it already had, and the old name is left holding
			// metadata for a branch that no longer exists under it.
			await this.provider.config.renameGkConfigBranchSection(repoPath, oldName, newName);
			// Old name's entry is now orphaned; the new name must not inherit a predecessor's base
			this.cache.deleteBaseBranchName(repoPath, oldName);
			this.cache.deleteBaseBranchName(repoPath, newName);
			this.clearBranchActivityStamps(repoPath, oldName);
			this.clearBranchActivityStamps(repoPath, newName);
			this.forgetBranchCreatedFrom(repoPath, oldName);
			this.forgetBranchCreatedFrom(repoPath, newName);
		} catch (ex) {
			throw getGitCommandError(
				'branch',
				ex,
				reason =>
					new BranchError(
						{
							reason: reason ?? 'other',
							action: 'rename',
							branch: oldName,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex,
					),
			);
		} finally {
			// `git branch -m` can rename the ref and still fail on its config
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'heads']);
		}
	}

	@debug()
	async setUpstreamBranch(repoPath: string, name: string, upstream: string | undefined): Promise<void> {
		const args =
			upstream == null ? ['branch', '--unset-upstream', name] : ['branch', '--set-upstream-to', upstream, name];
		try {
			await this.git.run({ cwd: repoPath }, ...args);
		} catch (ex) {
			throw getGitCommandError(
				'branch',
				ex,
				reason =>
					new BranchError(
						{
							reason: reason ?? 'other',
							action: upstream == null ? 'unset upstream of' : `set upstream to '${upstream}' for`,
							branch: name,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex,
					),
			);
		} finally {
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'heads']);
		}
	}

	@debug()
	async storeBaseBranchName(
		repoPath: string,
		ref: string,
		base: string,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): Promise<void> {
		await this.provider.config.setGkConfig(repoPath, `branch.${ref}.gk-merge-base`, base, options);
	}

	@debug()
	async storeMergeTargetBranchName(
		repoPath: string,
		ref: string,
		target: string,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): Promise<void> {
		// An unchanged value isn't rewritten: the write would churn the file Kepler shares and drop the cached gk config
		if ((await this.provider.config.getGkConfig(repoPath, `branch.${ref}.gk-merge-target`)) === target) return;

		await this.provider.config.setGkConfig(repoPath, `branch.${ref}.gk-merge-target`, target, options);
	}

	@debug()
	async storeUserMergeTargetBranchName(repoPath: string, ref: string, target: string | undefined): Promise<void> {
		await this.provider.config.setGkConfig(repoPath, `branch.${ref}.gk-merge-target-user`, target);
	}

	/**
	 * Gets all branch metadata (dates and disposition) from git config in a single batch operation.
	 * @returns A map of branch name to metadata.
	 */
	private getBranchMetadataMap(repoPath: string): Promise<Map<string, BranchMetadata>> {
		return this.cache.getBranchMetadataMap(repoPath, async commonPath => {
			const scope = getScopedLogger();
			const metadataMap = new Map<string, BranchMetadata>();

			try {
				// Use git config --get-regexp to load all gk-* branch metadata in one call
				const configMap = await this.provider.config.getGkConfigRegex(
					commonPath,
					'^branch\\..*\\.gk-(last-(accessed|modified)|disposition|agent-last-activity)$',
				);
				if (!configMap.size) return metadataMap;

				for (const [key, value] of configMap) {
					const parsed = parseBranchMetadataGkConfigKey(key);
					if (parsed == null) continue;

					let metadata = metadataMap.get(parsed.branch);
					if (metadata == null) {
						metadata = {};
						metadataMap.set(parsed.branch, metadata);
					}

					// Shared with `Cache.patchBranchMetadata`, so a patched object matches a freshly read one
					setBranchMetadataValue(metadata, parsed.key, value);
				}
			} catch (ex) {
				debugger;
				scope?.error(ex);
			}

			return metadataMap;
		});
	}

	async setBranchDisposition(
		repoPath: string,
		branchName: string,
		disposition: BranchDisposition | undefined,
	): Promise<void> {
		await this.provider.config.setGkConfig(repoPath, `branch.${branchName}.gk-disposition`, disposition);
		this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['starred']);
	}
}

/** Reads `rev-parse --symbolic-full-name @ @{u}` output: the current branch, then its upstream when it has one */
function parseSymbolicFullNames(stdout: string): { name: string; upstream?: string } {
	const [head, upstream] = stdout.trim().split('\n');

	return { name: parseRefName(head).name, upstream: upstream || undefined };
}

/** Each ref list {@link findRefTip} searched, by full name: one base read looks up many names in the same cached list */
const refRecordsByName = new WeakMap<readonly RefRecord[], Map<string, RefRecord>>();

/**
 * The commit `name` resolves to among `records`, tried in git's own order for a short name (`refs/tags/` before
 * `refs/heads/` before `refs/remotes/`); annotated tags peel to their commit. `undefined` when no listed ref matches.
 */
function findRefTip(records: readonly RefRecord[], name: string): string | undefined {
	let byName = refRecordsByName.get(records);
	if (byName == null) {
		byName = new Map();
		for (const record of records) {
			if (!byName.has(record.name)) {
				byName.set(record.name, record);
			}
		}
		refRecordsByName.set(records, byName);
	}

	for (const candidate of [
		name,
		`refs/${name}`,
		`refs/tags/${name}`,
		`refs/heads/${name}`,
		`refs/remotes/${name}`,
		`refs/remotes/${name}/HEAD`,
	]) {
		const record = byName.get(candidate);
		if (record != null) return record.peeledObjectname || record.objectname;
	}

	return undefined;
}

/**
 * Adds the full ref names a `.git/refs` watcher would report for `name`. A short name can't be told tag from local
 * from remote without a spawn, so it adds every form, including the tag git resolves it to first; a spurious one
 * only costs a recompute.
 */
function addRefDependencies(dependsOn: Set<string>, name: string): void {
	if (name.startsWith('refs/')) {
		dependsOn.add(name);
		return;
	}

	dependsOn.add(`refs/tags/${name}`);
	dependsOn.add(`refs/heads/${name}`);
	dependsOn.add(`refs/remotes/${name}`);
}
