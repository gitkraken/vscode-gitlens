import type {
	Cache,
	CachedMergeTarget,
	ConflictDetectionCacheKey,
	GkConfigInvalidationTarget,
} from '@gitlens/git/cache.js';
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
	GitPushTarget,
	GitPushTargetRef,
	MergeTarget,
	MergeTargetOptions,
	MergeTargetTier,
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
import { joinUriPath } from '@gitlens/utils/uri.js';
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
import { readHeadState } from '../exec/headState.js';
import { KeyedSequencer } from '../exec/indexLock.js';
import type { GitMergeConflict } from '../parsers/mergeTreeParser.js';
import { parseMergeTreeConflict } from '../parsers/mergeTreeParser.js';
import { resolveBranchRemote } from './branchRemote.js';
import { mayConfigDifferByCheckout, parseConfigListing } from './config.js';

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

/**
 * The most commits a base's reflog may reach off its new tip's history for a re-measure: every worktree's count
 * excludes each of them on its command line, and more come only from a long history force-pushed away, where a full
 * read costs less
 */
const maxOffHistoryCommits = 64;

/**
 * A base that moved only forward: the commits its reflog reaches off the new tip's history, and the commits
 * `--fork-point` reads from that reflog besides the new tip, the old tip among them
 */
type BaseMovedForward = { readonly offHistory: readonly string[]; readonly logged: ReadonlySet<string> };

/** Reads a `%(ahead-behind:<base>)` field, `<ahead> <behind>`; `undefined` when it isn't one */
function parseAheadBehindField(field: string | undefined): { ahead: number; behind: number } | undefined {
	const [ahead, behind] = (field ?? '').split(' ').map(n => parseInt(n, 10));
	if (isNaN(ahead) || isNaN(behind)) return undefined;

	return { ahead: ahead, behind: behind };
}

/** The named refs as `for-each-ref` patterns, or `undefined` when they're too many to fit one command line */
function toRefPatterns(refs: ReadonlySet<string>): string[] | undefined {
	return sum(refs, r => r.length + 1) < maxGitCliLength / 2 ? [...refs] : undefined;
}

/** The stored keys a merge target is read from: the user's pick, the detected target and its legacy key, and the recorded base */
const storedMergeKeys = ['gk-merge-target-user', 'gk-merge-target', 'gk-target-base', 'gk-merge-base'] as const;

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	/** Ahead/behind counts by `<baseSha>...<tipSha>` range, from the per-tip fallback; a pair of commits always counts the same */
	private readonly aheadBehindBySha = new LruMap<string, { ahead: number; behind: number }>(4096);
	/**
	 * For a base that moved only forward, what its reflog reaches (else `false`), by `<commonPath>\0<ref>`, then by the
	 * tip it moved from. A fetch moves one base under every worktree at once, so they share the one check, joining it
	 * while it runs. The reads hold for the tip the ref moved to, the reflog they read, stamped by its file's size and
	 * mtime (else by the cached ref list, through what it derives so the list itself isn't held, when there's no file
	 * to stamp), and the replace refs, which change what's reachable; a change to any of them starts the ref over. Every
	 * move appends to the reflog, so a ref moved away and back to the same tip between reads doesn't find the answer
	 * taken before
	 */
	private readonly baseMovedForward = new LruMap<
		string,
		{
			readonly newTip: string;
			readonly reflog: string | BaseMoveReadInputs;
			readonly replaced: string;
			readonly reads: Map<string, Promise<BaseMovedForward | false | undefined>>;
		}
	>(64);
	/**
	 * For a base that moved, the count of the commits its new tip lacks for each local branch a worktree has checked
	 * out, by tip sha, by `<commonPath>\0<newTip>`, with the replace refs it was counted under and the tips it counted.
	 * The counts don't depend on the ref or where it moved from, so each worktree the move reached finds its HEAD's
	 * count in the one read, even one whose previous answer was taken at another old tip
	 */
	private readonly aheadOfMovedBase = new LruMap<
		string,
		{
			readonly replaced: string;
			readonly tips: ReadonlySet<string>;
			readonly read: Promise<ReadonlyMap<string, number> | undefined>;
		}
	>(64);
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
	/**
	 * The branch HEAD was on when each `commonPath\0branch` was first checked out, as git wrote it, for a branch
	 * created from `HEAD`; only found ones, since a later checkout can write one
	 */
	private readonly _branchCheckedOutFrom = new LruMap<string, string>(1024);
	/** Bumped each time a key's created-from is forgotten, so a reflog read in flight across that doesn't store it */
	private readonly _branchCreatedFromGenerations = new LruMap<string, number>(1024);
	/**
	 * The repositories (by common path) whose last config listing showed config that can differ by checkout, so a linked
	 * checkout reads its own listing without first waiting on the main checkout's. Only a shortcut: a listing that shows
	 * otherwise drops the repository again
	 */
	private readonly _configDiffersByCheckout = new Set<string>();

	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug({ quiet: true })
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

	@debug({ quiet: true, args: repoPath => ({ repoPath: repoPath }) })
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

	@debug({ quiet: true })
	async getBranchContributionsOverview(
		repoPath: string,
		ref: string,
		options?: {
			associatedPullRequest?: Promise<
				{ refs?: { base?: { branch: string } }; stack?: { position: number } } | undefined
			>;
			getFallbackDefaultBranch?: () => Promise<string | undefined>;
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
			// `getMergeTarget` caches its own answer and confirms it against what it read. Only the expensive body
			// (`getMergeBase` + `getContributors` w/ stats + `getCommitDates`) is cached here, keyed on the resolved
			// target so callers resolving to the same one share it
			const associatedPullRequest = options?.associatedPullRequest;
			const target = await this.getMergeTarget(
				repoPath,
				ref,
				{
					getAssociatedPullRequest: associatedPullRequest != null ? () => associatedPullRequest : undefined,
					inferBase: true,
					defaultBranch: 'remote',
					getFallbackDefaultBranch: options?.getFallbackDefaultBranch,
					keepSelfAtTip: true,
					priority: priority,
				},
				cancellation,
			);
			if (target == null) return undefined;

			const resolvedTarget = target.ref;
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

	@debug({ quiet: true })
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

	@debug({ quiet: true })
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

	@debug({ quiet: true, exit: true })
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
			// Tracking is written to the new branch's own config section, and nowhere else
			if (mayWriteTracking(ref, options?.noTracking)) {
				this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'heads'], [`refs/heads/${name}`], {
					configConfinedToRefs: true,
				});
			} else {
				this.context.hooks?.repository?.onChanged?.(repoPath, ['heads'], [`refs/heads/${name}`]);
			}
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
			// A delete drops the branches' own config sections, and nothing else
			this.context.hooks?.repository?.onChanged?.(
				repoPath,
				['config', 'heads'],
				branches.map(b => `refs/heads/${b}`),
				{ configConfinedToRefs: true },
			);
		} catch (ex) {
			// A multi-name delete partially succeeds: `git branch -d a bad c` removes `a` and `c`, refuses
			// `bad`, and still exits non-zero — so the loop above never ran for the branches that did go.
			// Clean those up here rather than leave persisted gk metadata behind for a name a later branch
			// can reuse.
			const deleted = await this.cleanupDeletedBranchMetadata(repoPath, branches);

			// The success path's notifications never ran, but some branches DID go — without these the
			// branch caches stay stale and consumers wait on the filesystem watcher (which never fires
			// for a packed ref).
			if (deleted.length) {
				this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
				// Names only the branches that went: the watcher takes a report of a named ref for the write's own,
				// so naming one that stayed would pass off an outside change to it as this delete's
				this.context.hooks?.repository?.onChanged?.(
					repoPath,
					['config', 'heads'],
					deleted.map(b => `refs/heads/${b}`),
					{ configConfinedToRefs: true },
				);
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
	 * Returns those of `names` confirmed gone; none when the probe couldn't answer, so a spurious
	 * notification is never fired on an unrelated failure.
	 */
	private async cleanupDeletedBranchMetadata(repoPath: string, names: string[]): Promise<string[]> {
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
			if (result.completion.status !== 'exited' || result.exitCode !== 0) return [];

			const prefix = 'refs/heads/';
			const surviving = new Set(
				result.stdout
					.split('\n')
					.map(l => l.trim())
					.filter(l => l.startsWith(prefix))
					.map(l => l.substring(prefix.length)),
			);

			const deleted: string[] = [];
			for (const name of names) {
				if (surviving.has(name)) continue;

				deleted.push(name);
				await this.forgetDeletedBranch(repoPath, name);
			}

			return deleted;
		} catch {
			// Best-effort bookkeeping while already unwinding a failure — never mask the original error.
			return [];
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

	@debug({ quiet: true })
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

	@debug({ quiet: true })
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

	@trace({ quiet: true, exit: true })
	async getPushTarget(repoPath: string, branch?: string, cancellation?: AbortSignal): Promise<GitPushTarget> {
		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		// `getRefs` answers a failed enumeration with an empty list, which says nothing about any branch
		if (!records.length) return { known: false };

		if (branch == null) {
			// The worktree's own HEAD file names its branch with no git process, and is as current as the file. What
			// it can't answer (a reftable repository, a branch that is a symbolic ref to another, or a HEAD kept as a
			// symlink to its branch) falls back to resolving the reference
			const head = await readHeadState(repoPath, this.context.fs, this.cache);
			if (head === 'detached') return { known: true, push: undefined, upstream: undefined };

			if (head != null) {
				branch = head.branch;
			} else {
				const current = await this.getCurrentBranchReference(repoPath, cancellation);
				if (current == null) return { known: false };
				if (current.remote || isDetachedHead(current.name)) {
					return { known: true, push: undefined, upstream: undefined };
				}

				branch = current.name;
			}
		}

		const record = findRefRecord(records, branch.startsWith('refs/heads/') ? branch : `refs/heads/${branch}`);
		return {
			known: true,
			push: record?.push ? toPushTargetRef(records, record.push) : undefined,
			upstream: record?.upstream ? toPushTargetRef(records, record.upstream) : undefined,
		};
	}

	/** Detects potential conflicts when applying commits onto a target branch (git rebase and cherry-pick) */
	@debug({ quiet: true })
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
	@debug({ quiet: true })
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
					} else if (ex instanceof GitError && ex.stdout) {
						// A conflicted merge exits non-zero but still writes its result (at least the tree OID); a
						// failure with no output is an error, not a clean merge
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
	@debug({ quiet: true })
	async getPotentialStashReapplyConflicts(
		repoPath: string,
		ontoTreeOid: string,
		cancellation?: AbortSignal,
	): Promise<ConflictDetectionResult> {
		// `runMergeTreeStep` passes a tree as `ours`, which needs Git v2.45+
		if (!(await this.git.supports('git:merge-tree:trees'))) {
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
			} else if (ex instanceof GitError && ex.stdout) {
				// A conflicted merge exits non-zero but still writes its result (at least the tree OID); a failure
				// with no output is an error, not a clean merge
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

		// `runMergeTreeStep` passes a tree as `ours`, which needs Git v2.45+
		if (!(await this.git.supports('git:merge-tree:trees'))) {
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

	@debug({ quiet: true, exit: true })
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
						// Only a base git confirms is gone falls through to the reflog guess. One that couldn't be checked
						// is answered as stored, but not cached
						const { name, missing } = await this.provider.refs.getSymbolicReferenceNameOrMissing(
							commonPath,
							mergeBase,
							priorityOpts,
							signal,
						);
						if (!missing) {
							if (!name) {
								cacheable.invalidate();
								return mergeBase;
							}

							if (update) {
								// Self-write: the value we're storing is exactly what this factory is
								// returning, so any in-flight `branchOverviews` or `baseBranchName` entry
								// being populated against this resolution should NOT be evicted.
								void this.storeBaseBranchName(commonPath, ref, name, {
									skipInvalidation: ['branchOverviews', 'baseBranchName'],
								});
							}
							return name;
						}
					}
				} catch {}

				// Never stored: Kepler shares the file, and takes a stored base for one that was recorded
				const reflog = await this.getBaseBranchFromReflog(repoPath, commonPath, ref, priority, signal);
				if (reflog.branch != null) return reflog.branch;

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
	 * The branch `ref` was created from, else the branch HEAD was on when it was first checked out, each as its
	 * upstream when it has one. `failed` separates "the reflog ran and had no answer" from "the read never happened" —
	 * the caller caches the former forever and must not cache the latter.
	 */
	private async getBaseBranchFromReflog(
		repoPath: string,
		commonPath: string,
		ref: string,
		priority: GitCommandPriority | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<{ branch: string | undefined; failed: boolean }> {
		const priorityOpts = priority != null ? { priority: priority } : undefined;

		try {
			const createdFrom = await this.getReflogCreatedFrom(commonPath, ref, priority, cancellation);
			if (createdFrom == null) return { branch: undefined, failed: false };

			// Check if branch created from an explicit branch
			if (createdFrom !== 'HEAD') {
				const upstream = await this.getUpstreamName(commonPath, createdFrom, priorityOpts, cancellation);
				if (upstream) return { branch: upstream, failed: false };

				const name = await this.provider.refs.getSymbolicReferenceName(commonPath, createdFrom, priorityOpts);
				if (name) return { branch: name, failed: false };
			}

			// Check if branch was created from HEAD
			const branch = ref.replace(/^refs\/heads\//, '');
			const source = await this.getCheckoutSource(
				await this.getCheckoutPath(repoPath, branch, cancellation),
				branch,
				priority,
				cancellation,
			);
			if (source == null) return { branch: undefined, failed: false };

			const upstream = await this.getUpstreamName(commonPath, source, priorityOpts, cancellation);
			if (upstream) return { branch: upstream, failed: false };

			const name = await this.provider.refs.getSymbolicReferenceName(commonPath, source, priorityOpts);
			if (name) return { branch: name, failed: false };
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
	 * The worktree `branch` is checked out in, whose HEAD reflog holds its checkouts; else the main worktree, never the
	 * caller's, since every worktree of the repository shares the answer
	 */
	private async getCheckoutPath(
		repoPath: string,
		branch: string,
		cancellation: AbortSignal | undefined,
	): Promise<string> {
		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		const worktreePath = findRefRecord(records, `refs/heads/${branch}`)?.worktreePath;
		return worktreePath ? normalizePath(worktreePath) : this.cache.getCommonPath(repoPath);
	}

	/**
	 * The branch HEAD was on when `branch` was first checked out at `repoPath` (the oldest `checkout: moving from
	 * <name> to <branch>` in its HEAD reflog), as git wrote it. `undefined` when there is no such entry. Rejects when the
	 * reflog can't be read.
	 */
	private async getCheckoutSource(
		repoPath: string,
		branch: string,
		priority: GitCommandPriority | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		const entries = await this.provider.refs.getReflogEntries(
			repoPath,
			'HEAD',
			{ grep: `checkout: moving from .* to ${toReflogGrepLiteral(branch)}$`, priority: priority },
			cancellation,
		);

		for (let i = entries.length - 1; i >= 0; i--) {
			const match = /^checkout: moving from (\S+) to (.+)$/.exec(entries[i].message);
			if (match?.[2] === branch) return match[1];
		}
		return undefined;
	}

	/**
	 * The branch `branch` was created from, as a base for {@link resolveBase}: the name its own reflog gives, when that
	 * is a local or remote-tracking branch in the cached ref list and not `branch` itself or its copy on a remote
	 * (`git switch <branch>` creates it from `<remote>/<branch>`). Never the checkout history in HEAD's reflog, which
	 * on a long-lived checkout names whatever was checked out last. `fromHead` when the reflog says it was created
	 * from `HEAD`.
	 */
	private async getCreatedFromTarget(
		repoPath: string,
		branch: string,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<{ name: string | undefined; fromHead: boolean }> {
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
				reads.pinnable = false;
				return { name: undefined, fromHead: false };
			}
			if (cancellation?.aborted) throw new CancellationError();

			if (this._branchCreatedFromGenerations.get(key) === generation) {
				this._branchCreatedFrom.set(key, name);
			}
		}

		if (name === 'HEAD') return { name: undefined, fromHead: true };

		return { name: await this.getListedBaseName(repoPath, name, branch, reads, cancellation), fromHead: false };
	}

	/**
	 * For a branch its reflog says was created from `HEAD`, the branch HEAD was on when it was first checked out (see
	 * {@link getCheckoutSource}), read in the worktree it is checked out in, else the main worktree, and kept as a base
	 * like {@link getCreatedFromTarget}'s. Remembered once found, as the created-from name is; a reflog with no such
	 * entry yet marks the answer for eviction on the next checkout, which may write one.
	 */
	private async getInferredCreatedFrom(
		repoPath: string,
		branch: string,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		const key = this.getBranchActivityKey(repoPath, branch);

		let source = this._branchCheckedOutFrom.get(key);
		if (source == null) {
			const generation = this._branchCreatedFromGenerations.get(key);
			try {
				source = await this.getCheckoutSource(
					await this.getCheckoutPath(repoPath, branch, cancellation),
					branch,
					reads.priority,
					cancellation,
				);
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				reads.pinnable = false;
				return undefined;
			}
			if (cancellation?.aborted) throw new CancellationError();

			if (source == null) {
				reads.evictOnCheckout = true;
				return undefined;
			}

			if (this._branchCreatedFromGenerations.get(key) === generation) {
				this._branchCheckedOutFrom.set(key, source);
			}
		}

		return this.getListedBaseName(repoPath, source, branch, reads, cancellation);
	}

	/**
	 * `name` as a base for `branch`: only a local or remote-tracking branch in the cached ref list — a sha, a tag or a
	 * revision expression (`main~2`) names no `refs/heads/` or `refs/remotes/` ref — and not `branch` itself or its
	 * copy on a remote.
	 */
	private async getListedBaseName(
		repoPath: string,
		name: string | undefined,
		branch: string,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		// A ref starting with `-` would be parsed as a git flag
		if (!name || name === 'HEAD' || name.startsWith('-')) return undefined;

		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		const fullNames =
			name.startsWith('refs/heads/') || name.startsWith('refs/remotes/')
				? [name]
				: [`refs/heads/${name}`, `refs/remotes/${name}`];
		let listed = false;
		for (const fullName of fullNames) {
			// Its appearance would change the answer, so it is depended on while absent too
			reads.tipRefs.add(fullName);
			if ((await this.getRefTip(repoPath, records, fullName, cancellation)) != null) {
				listed = true;
				break;
			}
		}
		if (!listed) return undefined;

		// The reflog keeps a start point as typed. A full ref is answered by its short name, as `--abbrev-ref` would,
		// when that names the same ref: only a short name has an `@{u}` to defer to, and hosts look branches up by it
		if (fullNames.length === 1 && records.length) {
			const short = name.slice(name.startsWith('refs/heads/') ? 'refs/heads/'.length : 'refs/remotes/'.length);
			if (resolveRefRecord(records, short)?.name === name) {
				name = short;
			}
		}

		if (await this.isSelfRef(repoPath, name, branch, cancellation)) return undefined;

		return name;
	}

	@trace({ quiet: true })
	getAheadOfBaseConfigKey(repoPath: string, cancellation?: AbortSignal): Promise<string | undefined> {
		return this.getAheadOfBaseConfigListing(repoPath, cancellation);
	}

	@trace({ quiet: true })
	async getAheadOfBaseConfigEntries(
		repoPath: string,
		cancellation?: AbortSignal,
	): Promise<readonly (readonly [key: string, value: string | undefined])[] | undefined> {
		const listing = await this.getAheadOfBaseConfigListing(repoPath, cancellation);
		return listing != null ? parseConfigListing(listing) : undefined;
	}

	/**
	 * A checkout's listing of the config inputs to {@link getAheadOfBase}. Every checkout of a repository shares the main
	 * checkout's, unless it shows config that can differ by checkout (see `mayConfigDifferByCheckout`); then
	 * each linked checkout reads its own, and keeps doing so until one of its own reads shows config no longer can.
	 */
	private getAheadOfBaseConfigListing(
		repoPath: string,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		return this.cache.getAheadOfBaseConfigKey(
			repoPath,
			async (checkoutPath, cacheable, signal) => {
				const commonPath = this.cache.getCommonPath(checkoutPath);
				const isMain = checkoutPath === commonPath;
				if (isMain || !this._configDiffersByCheckout.has(commonPath)) {
					const shared = await this.cache.getAheadOfBaseConfigListing(
						checkoutPath,
						(path, sharedCacheable, sharedSignal) =>
							this.readAheadOfBaseConfigListing(path, sharedCacheable, sharedSignal),
						signal,
					);
					// Read in the main checkout, so it is that checkout's own
					if (isMain) {
						if (shared == null) {
							cacheable.invalidate();
						}

						return shared;
					}

					if (shared != null) {
						if (!mayConfigDifferByCheckout(shared)) return shared;

						this._configDiffersByCheckout.add(commonPath);
					}
				}

				const own = await this.readAheadOfBaseConfigListing(checkoutPath, cacheable, signal);
				if (own != null && !mayConfigDifferByCheckout(own)) {
					this._configDiffersByCheckout.delete(commonPath);
				}
				return own;
			},
			cancellation,
		);
	}

	private async readAheadOfBaseConfigListing(
		cwd: string,
		cacheable: CacheController,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		// Include every branch's tracking mapping: a recorded candidate can resolve through its own upstream.
		// Preserve repeated values and order, since multiple fetch refspecs can change that resolution. Conditional
		// includes and `extensions.worktreeConfig` tell whether one checkout's listing holds for the others.
		const result = await this.git.run(
			{ cwd: cwd, cancellation: cancellation, expectedExitCodes: [1] },
			'config',
			'--null',
			'--get-regexp',
			'^(branch\\..*\\.(remote|merge)|remote\\..*|init\\.defaultbranch|includeif\\..*|extensions\\.worktreeconfig)$',
		);
		if (cancellation?.aborted) throw new CancellationError();

		if (result.completion.status !== 'exited') {
			cacheable.invalidate();
			return undefined;
		}
		return result.stdout;
	}

	@debug({ quiet: true, exit: true })
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

		const reads = createBaseReads('HEAD', branch != null ? [`refs/heads/${branch}`] : [], undefined);
		const { dependsOn } = reads;

		const resolved = await this.resolveBase(repoPath, branch, branch, false, options, reads, cancellation);
		if (resolved.kind === 'upstream') {
			return withDefaultBranch(
				await this.measureAheadOfSelfUpstream(repoPath, resolved.upstream, reads, cancellation),
				reads.localDefault,
			);
		}

		if (resolved.kind === 'none') {
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

			return withDefaultBranch(
				{ base: undefined, reason: unborn ? 'unborn' : 'none', dependsOn: [...dependsOn] },
				reads.localDefault,
			);
		}

		// A base that is the branch itself, locally or as its copy on one of the repo's remotes, at HEAD's own commit has
		// nothing to measure against: no base, not "0 ahead" (an up-to-date `main` targeting `origin/main`). At a different
		// commit it stays the base, since the work ahead of it is work not yet pushed
		if (
			resolved.tier !== 'preferred' &&
			branch != null &&
			(await this.isSelfAtTip(repoPath, resolved.target.ref, branch, reads, cancellation))
		) {
			return withDefaultBranch(
				{ base: undefined, reason: 'self', dependsOn: [...dependsOn] },
				reads.localDefault,
			);
		}

		// Only `getMergeTarget`'s options reach the pull request and the reflog guess
		const tier = resolved.tier as AheadOfBaseTier;
		return withDefaultBranch(
			await this.measureAheadOfBase(repoPath, resolved.target, tier, dependsOn, cancellation),
			reads.localDefault,
		);
	}

	@debug({ quiet: true, exit: true })
	async getAheadOfBaseAfterBaseMove(
		repoPath: string,
		branch: string | undefined,
		previous: {
			readonly head: string;
			readonly base: NonNullable<AheadOfBase['base']>;
			readonly dependsOn: readonly string[];
			readonly defaultBranch?: string | null;
		},
		moved: readonly string[],
		cancellation?: AbortSignal,
	): Promise<AheadOfBase | undefined> {
		const { head, base } = previous;
		const oldTip = base.sha;
		if (oldTip == null || !moved.length) return undefined;
		// A preferred target comes only from an option this re-measure doesn't take. And the default branch takes an
		// upstream HEAD already contains as its own fork point, which no longer holds once the upstream moves past
		// HEAD's history; a fresh read then asks git for the fork point instead.
		if (base.tier === 'preferred' || (base.tier === 'upstream' && base.forkPoint === oldTip)) return undefined;

		try {
			const records = await this.provider.refs.getRefs(repoPath, cancellation);
			const record = records.length ? resolveRefRecord(records, base.ref) : undefined;
			if (record == null || !moved.includes(record.name)) return undefined;
			// A name more than one listed ref answers to may now resolve to another ref than the one measured (a tag
			// created over a branch's name), and `--fork-point` refuses it outright, falling back to the merge base
			if (isAmbiguousRefName(records, base.ref)) return undefined;

			const newTip = record.peeledObjectname || record.objectname;
			// Back at the old tip, a move in between may still have left the reflog `--fork-point` reads changed
			if (!newTip || newTip === oldTip) return undefined;
			if (branch != null && !isDetachedHead(branch) && findRefTip(records, `refs/heads/${branch}`) !== head) {
				return undefined;
			}

			let remoteHeadMoved = false;
			for (const ref of moved) {
				if (ref === record.name) continue;
				// A fetch lists a remote's `HEAD` along with the branch it points at; pointing anywhere else, it was
				// retargeted, which can change the default branch. The listed tip corroborates the cached symref.
				if (
					findRefTip(records, ref) !== newTip ||
					!(await this.isRemoteHeadOf(repoPath, ref, record.name, cancellation))
				) {
					return undefined;
				}

				remoteHeadMoved = true;
			}
			// One retargeted onto the base (from `origin/release` to `origin/main`, say) points at it just the same, but
			// can make another branch the default, and one retargeted to a ref at the same commit isn't named at all, so
			// whenever the previous read consulted the default it is resolved again, from the cached refs and symrefs, and
			// must be the one that read resolved
			if (remoteHeadMoved && previous.defaultBranch === undefined) return undefined;
			if (previous.defaultBranch !== undefined) {
				const defaultBranch = await this.getLocalDefaultBranchName(repoPath, new Set(), cancellation);
				if (cancellation?.aborted) throw new CancellationError();
				if ((defaultBranch ?? null) !== previous.defaultBranch) return undefined;
			}

			// The `upstream` remote's copy of a base is measured against it only while their tips differ, so a ref at
			// the old or the new tip may now be compared where it wasn't, or the other way round
			if (previous.dependsOn.some(r => r.startsWith('refs/remotes/upstream/') && !r.endsWith('/HEAD'))) {
				for (const ref of previous.dependsOn) {
					if (ref === record.name || ref.endsWith('/HEAD')) continue;

					const tip = findRefTip(records, ref);
					if (tip === oldTip || tip === newTip) return undefined;
				}
			}

			// The reasoning below compares counts taken over one history. A shallow fetch cuts the history the previous
			// answer counted (or a deepening one extends it), so the same commits count differently, and git's fork
			// point can change with them; in a shallow repository it's read in full
			if ((await this.isShallowRepository(repoPath)) !== false) return undefined;

			const movedForward = await this.getMovedForward(repoPath, records, record.name, oldTip, newTip);
			if (cancellation?.aborted) throw new CancellationError();
			if (!movedForward) return undefined;

			const { offHistory, logged } = movedForward;

			// HEAD's commits the new tip lacks are a subset of those the old one lacked, so the previous count, taken
			// past the new tip, the previous fork point and the commits the reflog reaches off the new tip's history,
			// means the same commits, none of them reachable from that fork point or the reflog: none reached the base,
			// and HEAD shares no more history with the base's whole reflog than with its tip, so its merge base and its
			// `--fork-point` are one commit, which didn't move. The fork point is that commit too, being in the new tip's
			// history, where a fork point the reflog supplied (a commit of HEAD's the base once held, its entry expired
			// since) isn't.
			//
			// Every worktree the move reached shares one count of each local branch's commits past the new tip alone, for
			// the branches worktrees have checked out: one old or orphan branch no worktree uses would make the shared
			// walk reach deeper than any worktree's own count. The old tip is in the new tip's history, so for HEAD that
			// count is at most the previous one and at least the count above, which leaves out more: one that differs
			// from the previous count means the count above does too. An equal one is the count above when leaving out
			// more takes nothing more: with nothing off the new tip's history, everything the reflog holds is in it, so a
			// fork point the reflog supplied is too, as are the old and new tips. With any other fork point (a merge base,
			// or a commit whose reflog entry expired since), commits off the new tip's history, or a HEAD no checked-out
			// branch points at (a detached one included), this worktree counts its own.
			const aheadOfNewTip = await this.getAheadOfMovedBase(repoPath, records, newTip, head);
			if (cancellation?.aborted) throw new CancellationError();
			if (aheadOfNewTip != null && aheadOfNewTip !== base.ahead) return undefined;

			const forkPoint = base.forkPoint;
			if (
				aheadOfNewTip == null ||
				offHistory.length !== 0 ||
				(forkPoint != null && forkPoint !== oldTip && forkPoint !== newTip && !logged.has(forkPoint))
			) {
				const result = await this.git.run(
					{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
					'rev-list',
					'--count',
					head,
					'--not',
					newTip,
					...(forkPoint != null ? [forkPoint] : []),
					...offHistory,
					'--',
				);
				if (cancellation?.aborted) throw new CancellationError();
				if (result.completion.status !== 'exited' || result.exitCode !== 0) return undefined;
				if (parseInt(result.stdout.trim(), 10) !== base.ahead) return undefined;
			}

			return withDefaultBranch(
				{ base: { ...base, sha: newTip }, dependsOn: [...previous.dependsOn] },
				previous.defaultBranch,
			);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	/**
	 * Whether the repository is shallow, by its common git directory's `shallow` file, which spawns nothing; `undefined`
	 * when it can't be read
	 */
	private async isShallowRepository(repoPath: string): Promise<boolean | undefined> {
		try {
			const gitDir = await this.provider.config.getGitDir(repoPath);
			return (await this.context.fs.stat(joinUriPath(gitDir.commonUri ?? gitDir.uri, 'shallow'))) != null;
		} catch {
			return undefined;
		}
	}

	/** Whether `ref` is a `refs/remotes/<remote>/HEAD` symref pointing at `target`, from the cached local symref */
	private async isRemoteHeadOf(
		repoPath: string,
		ref: string,
		target: string,
		cancellation: AbortSignal | undefined,
	): Promise<boolean> {
		if (!ref.startsWith('refs/remotes/') || !ref.endsWith('/HEAD')) return false;

		const remote = ref.slice('refs/remotes/'.length, -'/HEAD'.length);
		if (!remote) return false;

		const symref = await this.getDefaultBranchName(repoPath, remote, { local: true }, cancellation);
		return symref != null && `refs/remotes/${symref}` === target;
	}

	/**
	 * For `ref` (a full name in `records`, the cached ref list) moving from `oldTip` to `newTip`, the commits its reflog
	 * holds and those it reaches off `newTip`'s history, when it moved only forward: `oldTip` and every value its reflog
	 * took after it are in `newTip`'s history. `--fork-point` reads every reflog entry, so one in between that shares
	 * more of HEAD's history than `newTip` does (a branch's commit that landed and was force-pushed away) moves the fork
	 * point while the count stands; an older one off `newTip`'s history may hold such a commit too, which each
	 * worktree's count checks for. Without a reflog it reads only the tip. `undefined` when it didn't move only forward,
	 * or git can't say.
	 */
	private async getMovedForward(
		repoPath: string,
		records: readonly RefRecord[],
		ref: string,
		oldTip: string,
		newTip: string,
	): Promise<BaseMovedForward | undefined> {
		const commonPath = this.cache.getCommonPath(repoPath);
		const key = `${commonPath}\0${ref}`;
		const inputs = getBaseMoveReadInputs(records);
		const reflog = (await this.getReflogStamp(repoPath, ref)) ?? inputs;
		const { replaced } = inputs;

		let slot = this.baseMovedForward.get(key);
		if (slot == null || slot.newTip !== newTip || slot.reflog !== reflog || slot.replaced !== replaced) {
			slot = { newTip: newTip, reflog: reflog, replaced: replaced, reads: new Map() };
			this.baseMovedForward.set(key, slot);
		} else {
			this.baseMovedForward.touch(key);
		}

		const { reads } = slot;
		let pending = reads.get(oldTip);
		if (pending == null) {
			pending = this.readMovedForward(commonPath, ref, oldTip, newTip);
			reads.set(oldTip, pending);
		}

		// `undefined`, when git couldn't say, isn't kept
		const movedForward = await pending;
		if (movedForward === undefined && reads.get(oldTip) === pending) {
			reads.delete(oldTip);
		}
		return movedForward || undefined;
	}

	/**
	 * A stamp of `ref`'s reflog file in the common git directory, by its size and mtime; `undefined` when there's no
	 * file to stat (a reftable repository, or a ref without a reflog)
	 */
	private async getReflogStamp(repoPath: string, ref: string): Promise<string | undefined> {
		try {
			const gitDir = await this.provider.config.getGitDir(repoPath);
			const stat = await this.context.fs.stat(joinUriPath(gitDir.commonUri ?? gitDir.uri, 'logs', ref));
			return stat != null ? `${stat.size}\0${stat.mtime}` : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * A stamp of the common git directory's `shallow` file, by its size and mtime; `null` when the repository isn't
	 * shallow, `undefined` when that can't be read
	 */
	private async getShallowStamp(repoPath: string): Promise<string | null | undefined> {
		try {
			const gitDir = await this.provider.config.getGitDir(repoPath);
			const stat = await this.context.fs.stat(joinUriPath(gitDir.commonUri ?? gitDir.uri, 'shallow'));
			return stat != null ? `${stat.size}\0${stat.mtime}` : null;
		} catch {
			return undefined;
		}
	}

	/**
	 * Reads {@link getMovedForward} from git, in `commonPath`, which holds the refs, their reflogs and the objects for
	 * every worktree. Not bound to one caller's cancellation, since every worktree the move reached rides this one
	 * read. `false` when the ref didn't move only forward, or reaches too much history off `newTip`'s to tell;
	 * `undefined` when git couldn't say.
	 */
	private async readMovedForward(
		commonPath: string,
		ref: string,
		oldTip: string,
		newTip: string,
	): Promise<BaseMovedForward | false | undefined> {
		let since = new Set([oldTip]);
		let logged = new Set([oldTip]);
		try {
			// Newest first. The previous read may have been taken at any entry at the old tip, so everything since its
			// oldest is checked; a ref at the same commit twice was moved back, which a fast-forward never does
			const entries = await this.provider.refs.getReflogEntries(commonPath, ref);
			if (entries.length) {
				// A reflog that moved on since the ref list was read describes another move
				if (entries[0].sha !== newTip) return false;

				// No entry at the old tip can still mean the ref held it before its oldest entry, as after a clone, which
				// logs nothing for a remote-tracking ref; that is checked against the value read below
				const oldest = entries.findLastIndex(e => e.sha === oldTip);
				since = new Set(entries.slice(1, oldest < 0 ? undefined : oldest + 1).map(e => e.sha));
				logged = new Set(entries.map(e => e.sha));
				if (oldest < 0) {
					since.add(oldTip);
					logged.add(oldTip);
				}

				// `--fork-point` also reads the value the ref held before its oldest entry, which no entry lists once the
				// entries before it expired. `<ref>@{<count>}` names it; git refuses it when the oldest entry created the
				// ref, and before 2.31 refuses it either way, which leaves it unknown for good
				const before = await this.git.run(
					{ cwd: commonPath, errors: 'ignore' },
					'rev-parse',
					'--verify',
					`${ref}@{${entries.length}}`,
				);
				if (before.completion.status !== 'exited') return undefined;

				if (before.exitCode === 0) {
					const sha = before.stdout.trim();
					if (!sha) return undefined;
					if (oldest < 0 && sha !== oldTip) return false;

					logged.add(sha);
				} else if (!before.stderr?.includes(' only has ')) {
					return undefined;
				} else if (oldest < 0 || !(await this.git.supports('git:rev-parse:reflog-oldest-old-value'))) {
					return false;
				}
				logged.delete(newTip);
			}
		} catch {
			return undefined;
		}

		try {
			// The commits the reflog reaches that `newTip` doesn't; the reflog can be long, so on stdin
			const result = await this.git.run(
				{ cwd: commonPath, errors: 'ignore', stdin: `${[...logged, `^${newTip}`].join('\n')}\n` },
				'rev-list',
				`--max-count=${maxOffHistoryCommits + 1}`,
				'--stdin',
			);
			if (result.completion.status !== 'exited' || result.exitCode !== 0) return undefined;

			const off = result.stdout.split('\n').filter(sha => sha.length > 0);
			if (off.length > maxOffHistoryCommits) return false;
			if (off.some(sha => since.has(sha))) return false;

			// Excluding these excludes everything the reflog reaches, with no more than these on a command line
			return { offHistory: off, logged: logged };
		} catch {
			return undefined;
		}
	}

	/**
	 * For a base moved to `newTip`, the count of the commits `newTip` lacks for `head`, from one count of each local
	 * branch a worktree has checked out in `records` (the cached ref list), by tip sha, so a detached HEAD at one of
	 * those tips finds its count too. Only those branches are counted: the one walk runs until every counted branch
	 * meets `newTip`, so an unrelated old or orphan branch would make it deeper than any worktree's own count. Which
	 * branches it counts only bounds that walk, since a commit's count past `newTip` doesn't depend on what else is
	 * counted, so a read that counted `head` answers it for a later list (one with a branch created at `newTip` since,
	 * say) while the replace refs match; a `head` it didn't count starts a read over the current list's checked-out
	 * branches. `undefined` when no checked-out branch is at `head` or `records` can't tell which are checked out, git
	 * can't count them in one pass (before 2.41), or git couldn't say.
	 */
	private async getAheadOfMovedBase(
		repoPath: string,
		records: readonly RefRecord[],
		newTip: string,
		head: string,
	): Promise<number | undefined> {
		const { checkedOut, checkedOutTips, replaced } = getBaseMoveReadInputs(records);
		if (!checkedOut?.size || !checkedOutTips.has(head)) return undefined;

		const commonPath = this.cache.getCommonPath(repoPath);
		const key = `${commonPath}\0${newTip}`;
		let slot = this.aheadOfMovedBase.get(key);
		if (slot == null || slot.replaced !== replaced || !slot.tips.has(head)) {
			slot = {
				replaced: replaced,
				tips: checkedOutTips,
				read: this.readAheadOfMovedBase(commonPath, checkedOut, newTip),
			};
			this.aheadOfMovedBase.set(key, slot);
		} else {
			this.aheadOfMovedBase.touch(key);
		}

		// `undefined`, when git couldn't say, isn't kept
		const { read } = slot;
		const aheadByTip = await read;
		if (aheadByTip === undefined && this.aheadOfMovedBase.get(key)?.read === read) {
			this.aheadOfMovedBase.delete(key);
		}
		return aheadByTip?.get(head);
	}

	/**
	 * Reads {@link getAheadOfMovedBase} for the `checkedOut` branches from git, in `commonPath`, which holds every
	 * worktree's branches. Not bound to one caller's cancellation, since every worktree the move reached rides this one
	 * read.
	 */
	private async readAheadOfMovedBase(
		commonPath: string,
		checkedOut: ReadonlySet<string>,
		newTip: string,
	): Promise<ReadonlyMap<string, number> | undefined> {
		try {
			if (!(await this.git.supports('git:for-each-ref:ahead-behind'))) return undefined;

			// A list too long for the command line is read whole and filtered
			const patterns = toRefPatterns(checkedOut) ?? ['refs/heads'];

			// `newTip` is a full sha, so no `)` can end the format atom early. for-each-ref also matches below a
			// pattern (`refs/heads/a` matches `refs/heads/a/b`), so only the exact names are kept.
			const result = await this.git.run(
				{ cwd: commonPath, errors: 'ignore' },
				'for-each-ref',
				`--format=%(refname)%09%(objectname)%09%(ahead-behind:${newTip})`,
				...patterns,
			);
			// One walk counts every checked-out branch, which a commit-graph speeds up most
			void this.provider.maintenance?.request(commonPath, 'commit-graph');
			if (result.completion.status !== 'exited' || result.exitCode !== 0) return undefined;

			const aheadByTip = new Map<string, number>();
			for (const line of result.stdout.split('\n')) {
				if (!line) continue;

				const [ref, sha, field] = line.split('\t');
				if (!ref || !sha) return undefined;
				if (!checkedOut.has(ref)) continue;

				// git leaves the field empty for a ref that isn't at a commit, which no HEAD can be at, so it's skipped
				// rather than costing every worktree the shared read
				const counted = parseAheadBehindField(field);
				if (counted == null) continue;

				aheadByTip.set(sha, counted.ahead);
			}
			return aheadByTip;
		} catch {
			return undefined;
		}
	}

	@debug({ quiet: true, exit: true })
	async getMergeTarget(
		repoPath: string,
		branch: string,
		options?: MergeTargetOptions,
		cancellation?: AbortSignal,
	): Promise<MergeTarget | undefined> {
		// A name that stands for a detached HEAD has no branch to be recorded against or to be its own target
		if (!branch || isDetachedHead(branch)) return undefined;

		const cacheKey = getMergeTargetCacheKey(branch, options);
		let resolved = false;
		const factory = async (
			_commonPath: string,
			cacheable: CacheController,
			signal?: AbortSignal,
		): Promise<CachedMergeTarget> => {
			resolved = true;

			const { entry, pinnable } = await this.resolveMergeTarget(
				repoPath,
				branch,
				options,
				signal ?? cancellation,
			);
			if (!pinnable) {
				cacheable.invalidate();
			}
			return entry;
		};

		let entry = await this.cache.getMergeTarget(repoPath, cacheKey, factory, cancellation);
		if (!resolved && !(await this.isMergeTargetCurrent(repoPath, branch, entry, options, cancellation))) {
			this.cache.deleteMergeTarget(repoPath, cacheKey, entry);
			entry = await this.cache.getMergeTarget(repoPath, cacheKey, factory, cancellation);
		}
		if (cancellation?.aborted) throw new CancellationError();

		return entry.selfAtTip && !options?.keepSelfAtTip ? undefined : entry.result;
	}

	/**
	 * Where {@link getMergeTarget} measures `branch` from: its local branch's ref, or — for a remote-tracking branch given
	 * by its short name (`origin/feature`) — that ref, with `selfName` its name on the remote
	 */
	private async getMergeTargetSource(
		repoPath: string,
		branch: string,
		records: readonly RefRecord[],
		cancellation: AbortSignal | undefined,
	): Promise<{ from: string; selfName: string; remoteBranch: boolean }> {
		if (
			findRefRecord(records, `refs/heads/${branch}`) != null ||
			findRefRecord(records, `refs/remotes/${branch}`) == null
		) {
			return { from: `refs/heads/${branch}`, selfName: branch, remoteBranch: false };
		}

		const split = splitRemoteBranchName(branch, await this.getRemoteNames(repoPath, cancellation));
		return { from: `refs/remotes/${branch}`, selfName: split?.[1] ?? branch, remoteBranch: true };
	}

	/** Resolves {@link getMergeTarget}'s answer with what it was read from; `pinnable` is false when it can't be confirmed later */
	private async resolveMergeTarget(
		repoPath: string,
		branch: string,
		options: MergeTargetOptions | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<{ entry: CachedMergeTarget; pinnable: boolean }> {
		// Stamped before any merge base is read, so a deepening fetch landing in between leaves the answer stale
		const [records, configKey, shallow] = await Promise.all([
			this.provider.refs.getRefs(repoPath, cancellation),
			tolerateRead(() => this.getAheadOfBaseConfigKey(repoPath, cancellation)),
			this.getShallowStamp(repoPath),
		]);
		const { replaced } = getBaseMoveReadInputs(records);
		const { from, selfName, remoteBranch } = await this.getMergeTargetSource(
			repoPath,
			branch,
			records,
			cancellation,
		);

		// A branch with no commit yet, or none by that name, has nothing to measure from until one of these appears
		if (records.length && getListedTip(records, from) == null) {
			return {
				entry: {
					result: undefined,
					selfAtTip: false,
					tips: [
						[from, undefined],
						[`refs/remotes/${branch}`, undefined],
					],
					replaced: replaced,
					shallow: shallow ?? null,
					configKey: configKey,
					stored: undefined,
					evictOnCheckout: false,
				},
				pinnable: configKey != null && shallow !== undefined,
			};
		}

		const reads = createBaseReads(from, [from], options?.priority);
		// An empty list is a failed enumeration (see `getRefTip`), with no tips to confirm the answer against later
		reads.pinnable = records.length !== 0 && configKey != null && shallow !== undefined;

		const resolved = await this.resolveBase(repoPath, branch, selfName, remoteBranch, options, reads, cancellation);

		let result: MergeTarget | undefined;
		let selfAtTip = false;
		if (resolved.kind === 'upstream') {
			const upstream = resolved.upstream;
			if (upstream != null) {
				selfAtTip = upstream.sha === (await this.getRefTip(repoPath, records, from, cancellation));
				result = {
					ref: upstream.ref,
					forkPoint: selfAtTip
						? upstream.sha
						: await this.getForkPoint(repoPath, upstream.ref, reads, cancellation),
					tier: 'upstream',
				};
			}
		} else if (resolved.kind === 'target') {
			result = { ref: resolved.target.ref, forkPoint: resolved.target.forkPoint, tier: resolved.tier };
			selfAtTip =
				resolved.tier !== 'preferred' &&
				(await this.isSelfAtTip(repoPath, result.ref, selfName, reads, cancellation));
		}

		// The tolerant reads above answer a cancelled run as "nothing there"; that is no answer, and must not be cached
		if (cancellation?.aborted) throw new CancellationError();

		const tips: [string, string | undefined][] = [];
		for (const ref of new Set([...reads.dependsOn, ...reads.tipRefs])) {
			tips.push([ref, getListedTip(records, ref)]);
		}

		return {
			entry: {
				result: result,
				selfAtTip: selfAtTip,
				tips: tips,
				replaced: replaced,
				shallow: shallow ?? null,
				configKey: configKey,
				stored: reads.stored,
				pullRequest: reads.pullRequest,
				localDefault: reads.localDefault,
				remoteDefault: reads.remoteDefault,
				fallbackDefault: reads.fallbackDefault,
				evictOnCheckout: reads.evictOnCheckout,
			},
			pinnable: reads.pinnable,
		};
	}

	/** Whether everything `entry` was read from still reads the same; while nothing changed, every read here is cached */
	private async isMergeTargetCurrent(
		repoPath: string,
		branch: string,
		entry: CachedMergeTarget,
		options: MergeTargetOptions | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<boolean> {
		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		if (!records.length) return false;

		for (const [ref, tip] of entry.tips) {
			if (getListedTip(records, ref) !== tip) return false;
		}

		if (getBaseMoveReadInputs(records).replaced !== entry.replaced) return false;
		if (entry.shallow != null && (await this.getShallowStamp(repoPath)) !== entry.shallow) return false;

		if ((await tolerateRead(() => this.getAheadOfBaseConfigKey(repoPath, cancellation))) !== entry.configKey) {
			return false;
		}

		// Compared here rather than left to the gk config reconcile, which reaches a watcher-reported change only
		// asynchronously; the gk config map itself is dropped at once
		if (entry.stored != null) {
			const stored = await this.readStoredMergeKeys(repoPath, branch, options?.inferBase, undefined);
			if (stored.some((value, i) => value !== entry.stored![i])) return false;
		}

		if (entry.localDefault !== undefined) {
			const name = await this.getLocalDefaultBranchName(repoPath, new Set(), cancellation);
			if ((name ?? null) !== entry.localDefault) return false;
		}

		if (entry.remoteDefault != null) {
			// Never asks the remote: once the cached answer is gone, the target is resolved again
			const cached = this.cache.peekDefaultBranchName(repoPath, entry.remoteDefault.remote);
			if (cached == null) return false;
			if (((await tolerateRead(() => cached)) ?? null) !== entry.remoteDefault.name) return false;
		}

		if (entry.fallbackDefault !== undefined) {
			const fallback = (await tolerateRead(options?.getFallbackDefaultBranch))?.trim() || undefined;
			if ((fallback ?? null) !== entry.fallbackDefault) return false;
		}

		if (entry.pullRequest !== undefined) {
			const getAssociatedPullRequest = options?.getAssociatedPullRequest;
			if (getAssociatedPullRequest == null) return false;

			const pr = await this.getPullRequestBaseCandidate(
				repoPath,
				branch,
				getAssociatedPullRequest,
				undefined,
				cancellation,
			);
			if ((pr?.ref ?? null) !== entry.pullRequest) return false;
		}

		return true;
	}

	/**
	 * The base `branch` is measured against from `reads.from`, in {@link getMergeTarget}'s order; `getAheadOfBase`'s
	 * options never reach the pull request, the reflog guess or the remote. `selfName` is the name a self check
	 * compares with: `branch`, or a remote-tracking branch's name on its remote, which has no stored targets, reflog or
	 * upstream of its own. A `'preferred'` target is already known not to be the branch itself at `from`'s commit; any
	 * other target isn't checked here.
	 */
	private async resolveBase(
		repoPath: string,
		branch: string | undefined,
		selfName: string | undefined,
		remoteBranch: boolean,
		options: MergeTargetOptions | undefined,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<ResolvedBase> {
		const preferredTarget = options?.preferredTarget?.trim() || undefined;
		if (preferredTarget != null) {
			let target = await this.getNearestForkTarget(repoPath, branch, preferredTarget, reads, cancellation);
			if (
				target != null &&
				selfName != null &&
				(await this.isSelfAtTip(repoPath, target.ref, selfName, reads, cancellation))
			) {
				target = undefined;
			}

			// The tolerant reads above answer a cancelled run as "nothing there"; that is no answer
			if (cancellation?.aborted) throw new CancellationError();
			if (target != null) return { kind: 'target', target: target, tier: 'preferred' };
		}

		let target: ForkTarget | undefined;
		let tier: MergeTargetTier = 'default';
		if (branch != null) {
			const stored = await this.getStoredBaseTarget(repoPath, branch, remoteBranch, options, reads, cancellation);
			if (stored != null) {
				({ target, tier } = stored);
			}
		}

		if (target == null) {
			const defaultBranch = await this.getDefaultBranchForBase(repoPath, options, reads, cancellation);
			if (branch != null && defaultBranch === branch) {
				// A remote-tracking default branch, with no local branch of its name, is its own base at its own commit
				if (remoteBranch) {
					addRefDependencies(reads.dependsOn, branch);
					const records = await this.provider.refs.getRefs(repoPath, cancellation);
					const tip = await this.getRefTip(repoPath, records, reads.from, cancellation);
					if (cancellation?.aborted) throw new CancellationError();

					return tip != null
						? { kind: 'target', target: { ref: branch, forkPoint: tip }, tier: 'default' }
						: { kind: 'none' };
				}

				// Before the reflog read: the default branch measures against its own upstream, even a gitflow
				// `develop` created from `main`
				return {
					kind: 'upstream',
					upstream: await this.getSelfUpstreamTarget(repoPath, branch, reads, cancellation),
				};
			}

			const createdFrom =
				branch != null && !remoteBranch
					? await this.getCreatedFromSource(repoPath, branch, options, reads, cancellation)
					: undefined;
			if (createdFrom != null) {
				const created = await this.getCreatedFromForkTarget(
					repoPath,
					branch,
					createdFrom,
					defaultBranch,
					reads,
					cancellation,
				);
				if (created != null) {
					({ target, tier } = created);
				}
			} else {
				target = await this.getUpstreamNearestForkTarget(repoPath, branch, defaultBranch, reads, cancellation);
			}
		}

		// The tolerant reads above answer a cancelled run as "nothing there"; that is no answer
		if (cancellation?.aborted) throw new CancellationError();

		return target != null ? { kind: 'target', target: target, tier: tier } : { kind: 'none' };
	}

	/**
	 * The first usable stored candidate, most trusted first: the user's merge target (unless `skipUserTarget`), the
	 * detected one, the pull request's base (`getAssociatedPullRequest`, read only when neither is usable), then the
	 * recorded base — only its stored value (and with `inferBase`, VS Code's), never `getBaseBranchName`'s reflog
	 * guess, which on a long-lived checkout names whatever branch was last checked out from. A remote-tracking branch
	 * has no stored keys of its own, so only its pull request's base is tried, and never recorded.
	 */
	private async getStoredBaseTarget(
		repoPath: string,
		branch: string,
		remoteBranch: boolean,
		options: MergeTargetOptions | undefined,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<{ target: ForkTarget; tier: MergeTargetTier } | undefined> {
		let stored: readonly (string | undefined)[] = [];
		if (!remoteBranch) {
			stored = await this.readStoredMergeKeys(repoPath, branch, options?.inferBase, reads);
			reads.stored = stored;
		}
		const [user, detected, legacyDetected, recorded, vscodeRecorded] = stored;

		const tried = new Set<string>();
		const measure = async (candidate: string | undefined): Promise<ForkTarget | undefined> => {
			candidate = candidate?.trim();
			if (!candidate || tried.has(candidate)) return undefined;

			tried.add(candidate);
			return this.getNearestForkTarget(repoPath, branch, candidate, reads, cancellation);
		};

		let target: ForkTarget | undefined;
		if (!options?.skipUserTarget) {
			target = await measure(user);
			if (target != null) return { target: target, tier: 'user' };
		}

		target = await measure(detected ?? legacyDetected);
		if (target != null) return { target: target, tier: 'detected' };

		if (options?.getAssociatedPullRequest != null) {
			const pr = await this.getPullRequestBaseCandidate(
				repoPath,
				branch,
				options.getAssociatedPullRequest,
				reads,
				cancellation,
			);
			target = await measure(pr?.ref);
			if (pr != null && target != null) {
				// A stacked pull request's base is the layer below it, deleted when the stack merges, and a stored
				// target outranks every later source for as long as its branch lingers (an unpruned remote-tracking
				// ref). Use it for this lookup, but don't record it — nor for a remote-tracking branch, which has no keys
				if (pr.stacked || remoteBranch) {
					reads.pullRequest = pr.ref;
				} else {
					// Skips the overview's invalidation: it is about to cache its body against this same target
					void this.storeMergeTargetBranchName(repoPath, branch, pr.ref, {
						skipInvalidation: ['branchOverviews'],
					});
					// The next read finds it stored, as the detected target
					reads.pinnable = false;
				}
				return { target: target, tier: 'pr' };
			}

			reads.pullRequest = pr?.ref ?? null;
		}

		target = await measure(recorded);
		if (target != null) return { target: target, tier: 'recorded' };

		if (!recorded?.trim() && vscodeRecorded?.trim()) {
			target = await measure(vscodeRecorded);
			if (target != null) {
				// Self-write: VS Code's recorded base, kept as GitLens's
				void this.storeBaseBranchName(repoPath, branch, vscodeRecorded.trim(), {
					skipInvalidation: ['branchOverviews', 'baseBranchName'],
				});
				// The next read finds it stored
				reads.pinnable = false;
				return { target: target, tier: 'recorded' };
			}
		}

		return undefined;
	}

	/**
	 * The branch's stored merge keys as read, in {@link storedMergeKeys} order, then VS Code's recorded base when
	 * `inferBase`. A failed read is absent, and leaves `reads`' answer unpinned.
	 */
	private readStoredMergeKeys(
		repoPath: string,
		branch: string,
		inferBase: boolean | undefined,
		reads: BaseReads | undefined,
	): Promise<(string | undefined)[]> {
		const read = async (get: () => Promise<string | undefined>): Promise<string | undefined> => {
			try {
				return await get();
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				if (reads != null) {
					reads.pinnable = false;
				}
				return undefined;
			}
		};

		return Promise.all([
			...storedMergeKeys.map(key =>
				read(() => this.provider.config.getGkConfig(repoPath, `branch.${branch}.${key}`)),
			),
			inferBase
				? read(() => this.provider.config.getConfig(repoPath, `branch.${branch}.vscode-merge-base`))
				: undefined,
		]);
	}

	/**
	 * The pull request's base as a candidate on the branch's remote; `undefined` when there is none, the branch has no
	 * remote, or either can't be read (which leaves `reads`' answer unpinned)
	 */
	private async getPullRequestBaseCandidate(
		repoPath: string,
		branch: string,
		getAssociatedPullRequest: NonNullable<MergeTargetOptions['getAssociatedPullRequest']>,
		reads: BaseReads | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<{ ref: string; stacked: boolean } | undefined> {
		try {
			const pr = await getAssociatedPullRequest();
			const base = pr?.refs?.base?.branch?.trim();
			if (!base) return undefined;

			const ref = await this.getBranch(repoPath, branch, undefined, cancellation);
			if (ref == null) return undefined;

			// A branch with no remote upstream has no remote to find the pull request's base on
			const { remote } = await resolveBranchRemote(this.provider, repoPath, ref, cancellation);
			if (remote == null) return undefined;

			return { ref: `${remote}/${base}`, stacked: pr?.stack != null };
		} catch (ex) {
			// The callback is the first caller's, so its cancellation is a failed read for a shared lookup still wanted
			if (isCancellationError(ex) && (cancellation?.aborted ?? true)) throw ex;

			if (reads != null) {
				reads.pinnable = false;
			}
			return undefined;
		}
	}

	/**
	 * The default branch for {@link resolveBase}: {@link getLocalDefaultBranchName}; when that names none, with
	 * `defaultBranch: 'remote'`, the default the first of those remotes reports; then `getFallbackDefaultBranch`. A
	 * remote-qualified answer is taken as its local branch when there is one
	 */
	private async getDefaultBranchForBase(
		repoPath: string,
		options: MergeTargetOptions | undefined,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		let name = await this.getLocalDefaultBranchName(repoPath, reads.dependsOn, cancellation);
		reads.localDefault = name ?? null;
		if (name != null) return name;

		if (options?.defaultBranch === 'remote') {
			const [remote] = await this.getPreferredRemotes(repoPath, cancellation);
			if (remote != null) {
				let symref: string | undefined;
				try {
					symref = await this.getDefaultBranchName(
						repoPath,
						remote,
						reads.priority != null ? { priority: reads.priority } : undefined,
						cancellation,
					);
				} catch (ex) {
					if (isCancellationError(ex)) throw ex;

					reads.pinnable = false;
				}
				reads.remoteDefault = { remote: remote, name: symref ?? null };

				// A remote name can hold a slash, so strip exactly the remote's own prefix
				const local = symref?.startsWith(`${remote}/`) ? symref.slice(remote.length + 1) : undefined;
				if (symref && local) {
					name = await this.preferListedLocalBranch(repoPath, symref, local, reads, cancellation);
				}
			}
		}

		if (name == null && options?.getFallbackDefaultBranch != null) {
			let fallback: string | undefined;
			try {
				fallback = (await options.getFallbackDefaultBranch())?.trim() || undefined;
			} catch (ex) {
				// As the pull request's callback (see `getPullRequestBaseCandidate`)
				if (isCancellationError(ex) && (cancellation?.aborted ?? true)) throw ex;

				reads.pinnable = false;
			}
			reads.fallbackDefault = fallback ?? null;
			name = fallback;

			// Named remote-qualified (`origin/main`) like the remote's own answer, so it too is its local branch when
			// there is one — else the default branch itself is never recognized as such
			const local =
				fallback != null
					? splitRemoteBranchName(fallback, await this.getRemoteNames(repoPath, cancellation))?.[1]
					: undefined;
			if (fallback != null && local) {
				name = await this.preferListedLocalBranch(repoPath, fallback, local, reads, cancellation);
			}
		}

		return name;
	}

	/** `local` when the cached ref list names that branch (depended on either way), else `remoteName` */
	private async preferListedLocalBranch(
		repoPath: string,
		remoteName: string,
		local: string,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<string> {
		addRefDependencies(reads.dependsOn, local);
		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		return (await this.getRefTip(repoPath, records, local, cancellation)) != null ? local : remoteName;
	}

	/**
	 * The branch `branch` was created from (tier `'created'`); with `inferBase`, for one created from `HEAD`, the
	 * branch HEAD was on when it was first checked out (tier `'inferred'`)
	 */
	private async getCreatedFromSource(
		repoPath: string,
		branch: string,
		options: MergeTargetOptions | undefined,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<{ name: string; tier: 'created' | 'inferred' } | undefined> {
		const createdFrom = await this.getCreatedFromTarget(repoPath, branch, reads, cancellation);
		if (createdFrom.name != null) return { name: createdFrom.name, tier: 'created' };
		if (!createdFrom.fromHead || !options?.inferBase) return undefined;

		const inferred = await this.getInferredCreatedFrom(repoPath, branch, reads, cancellation);
		return inferred != null ? { name: inferred, tier: 'inferred' } : undefined;
	}

	/**
	 * The base for a branch created from `createdFrom`: that branch, unless the default branch forked strictly nearer
	 * HEAD, as it does once `createdFrom` merged into it and the branch was rebased onto it. A stacked branch's
	 * unmerged parent forked nearer, and stays its base. `undefined` when neither is usable.
	 */
	private async getCreatedFromForkTarget(
		repoPath: string,
		branch: string | undefined,
		createdFrom: { name: string; tier: 'created' | 'inferred' },
		defaultBranch: string | undefined,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<{ target: ForkTarget; tier: MergeTargetTier } | undefined> {
		const { name } = createdFrom;
		const skipDefault =
			defaultBranch == null ||
			name === defaultBranch ||
			name === `refs/heads/${defaultBranch}` ||
			name === `refs/remotes/${defaultBranch}`;
		const [created, fallback] = await Promise.all([
			this.getUpstreamNearestForkTarget(repoPath, branch, name, reads, cancellation),
			skipDefault
				? undefined
				: this.getUpstreamNearestForkTarget(repoPath, branch, defaultBranch, reads, cancellation),
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
		return { target: created, tier: createdFrom.tier };
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
		upstream: { ref: string; sha: string } | undefined,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<AheadOfBase> {
		const { dependsOn } = reads;
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
			counts.left === 0 ? upstream.sha : await this.getForkPoint(repoPath, upstream.ref, reads, cancellation);
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

	@debug({ quiet: true, exit: true })
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
		} else {
			patterns = toRefPatterns(refs) ?? ['refs/heads', 'refs/remotes'];
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

				const aheadBehind = parseAheadBehindField(counted);
				if (aheadBehind == null) {
					throw new Error(`Unexpected output counting the commits ahead of and behind '${base}': ${line}`);
				}

				counts.set(ref, aheadBehind);
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

	@debug({ quiet: true, exit: true })
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

	/**
	 * Whether `ref` names `selfName` itself (see {@link isSelfRef}) and sits at `reads.from`'s commit; tips are read
	 * only after the name matched. HEAD's commit is asked of git, a branch's read from the cached ref list
	 */
	private async isSelfAtTip(
		repoPath: string,
		ref: string,
		selfName: string,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<boolean> {
		if (!(await this.isSelfRef(repoPath, ref, selfName, cancellation))) return false;

		if (reads.from === 'HEAD') {
			const [refSha, headSha] = await Promise.all([
				this.provider.refs.validateReference(repoPath, ref, undefined, cancellation),
				this.provider.refs.validateReference(repoPath, 'HEAD', undefined, cancellation),
			]);
			return refSha != null && refSha === headSha;
		}

		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		const [refSha, fromSha] = await Promise.all([
			this.getRefTip(repoPath, records, ref, cancellation),
			this.getRefTip(repoPath, records, reads.from, cancellation),
		]);
		return refSha != null && refSha === fromSha;
	}

	/** The remotes a default branch is read from, in order: `upstream`, `origin`, then the first remote */
	private async getPreferredRemotes(repoPath: string, cancellation: AbortSignal | undefined): Promise<string[]> {
		const remotes = await this.getRemoteNames(repoPath, cancellation);
		// Each in turn: a remote added after the clone (`upstream`, typically) has no `HEAD` symref until
		// `remote set-head` writes one, and must not hide `origin`'s
		return [
			...new Set(
				[remotes.find(r => r === 'upstream'), remotes.find(r => r === 'origin'), remotes.at(0)].filter(
					r => r != null,
				),
			),
		];
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

		const preferred = await this.getPreferredRemotes(repoPath, cancellation);
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
		reads: BaseReads,
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
		if (contender === base || remoteRef === base) return undefined;

		if (findRefTip(records, remoteRef) == null) {
			// A fetch that brings it would change the answer
			reads.tipRefs.add(remoteRef);
			return undefined;
		}

		reads.dependsOn.add(remoteRef);
		return contender;
	}

	/** {@link getNearestForkTarget} with the `upstream` remote's copy of `candidate` as its contender */
	private async getUpstreamNearestForkTarget(
		repoPath: string,
		branch: string | undefined,
		candidate: string | undefined,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<ForkTarget | undefined> {
		return this.getNearestForkTarget(repoPath, branch, candidate, reads, cancellation, {
			contender: await this.getUpstreamContender(repoPath, candidate, reads, cancellation),
		});
	}

	/**
	 * A candidate base as the ref `reads.from` is measured against: the candidate or its tracking ref, whichever forked
	 * nearer, so a stale local base defers to its upstream while one carrying unpushed work wins over it. A
	 * `contender` other than the tracking ref is taken only when it forked strictly nearer than both, so a tie keeps
	 * the candidate's own pick. A candidate none forks from is used as-is unless git confirms it names no ref: one the
	 * cached ref list names is kept, and so is one whose check fails. `undefined` when the candidate is unusable.
	 */
	private async getNearestForkTarget(
		repoPath: string,
		branch: string | undefined,
		candidate: string | undefined,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
		options?: { contender?: string },
	): Promise<ForkTarget | undefined> {
		// A ref starting with `-` would be parsed as a git flag
		if (!candidate || candidate.startsWith('-')) return undefined;
		// A branch measured against itself says nothing
		if (candidate === branch || candidate === `refs/heads/${branch}`) return undefined;

		addRefDependencies(reads.dependsOn, candidate);

		const upstreamName = this.getUpstreamName(repoPath, candidate, undefined, cancellation);
		const getUpstreamFork = async (): Promise<{ ref: string; mergeBase: string | undefined } | undefined> => {
			const upstream = await upstreamName;
			if (!upstream || upstream.startsWith('-')) return undefined;

			addRefDependencies(reads.dependsOn, upstream);
			return { ref: upstream, mergeBase: await this.getForkPoint(repoPath, upstream, reads, cancellation) };
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
			return this.getForkPoint(repoPath, contender, reads, cancellation);
		};

		// A candidate that names no ref fails its merge-base read too, which only git's word that it's missing excuses
		const candidateReads = { from: reads.from, priority: reads.priority, pinnable: true };
		const [candidateMergeBase, upstreamFork, contenderMergeBase] = await Promise.all([
			this.getForkPoint(repoPath, candidate, candidateReads, cancellation),
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
		if (nearest != null) {
			if (!candidateReads.pinnable) {
				reads.pinnable = false;
			}
			return { ref: nearest.ref, forkPoint: nearest.mergeBase };
		}

		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		if (records.length && findRefTip(records, candidate) != null) {
			if (!candidateReads.pinnable) {
				reads.pinnable = false;
			}
			return { ref: candidate, forkPoint: undefined };
		}

		// Only `missing` is git's word that it names no ref; a check that failed or timed out says nothing either way
		const { missing } = await this.provider.refs.getSymbolicReferenceNameOrMissing(
			repoPath,
			candidate,
			reads.priority != null ? { priority: reads.priority } : undefined,
			cancellation,
		);
		if (missing) return undefined;

		reads.pinnable = false;
		return { ref: candidate, forkPoint: undefined };
	}

	/**
	 * `<name>@{u}`, without asking git when the cached ref list shows `name` can't have one: a failed lookup isn't
	 * cached, so asking it of a remote-tracking ref (`origin/main`, the usual default) re-spawns on every read. The
	 * list's own upstream isn't used: a config-only change (`git branch -u`) doesn't refresh it.
	 */
	private async getUpstreamName(
		repoPath: string,
		name: string,
		options: { priority?: GitCommandPriority } | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		const records = await this.provider.refs.getRefs(repoPath, cancellation);
		if (!mayHaveUpstream(records, name)) return undefined;

		return this.provider.refs.getSymbolicReferenceName(repoPath, `${name}@{u}`, options, cancellation);
	}

	/**
	 * The base for a branch that is itself the default branch, with its tip: its own upstream, `upstream/<branch>`
	 * when an `upstream` remote has it, else `<branch>@{u}`. Read from the cached ref and branch lists; only a
	 * `<branch>` that isn't checked out spawns, for its `@{u}`. `undefined` when there is neither, or its ref is gone.
	 */
	private async getSelfUpstreamTarget(
		repoPath: string,
		branch: string,
		reads: BaseReads,
		cancellation: AbortSignal | undefined,
	): Promise<{ ref: string; sha: string } | undefined> {
		const { dependsOn } = reads;
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

	/** Where `reads.from` forked from `ref`: git's fork-point reading of `ref`'s reflog when it has one, else their merge base */
	private async getForkPoint(
		repoPath: string,
		ref: string,
		reads: Pick<BaseReads, 'from' | 'priority' | 'pinnable'>,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		const forkPoint = await this.readMergeBase(repoPath, ref, reads.from, true, reads, cancellation);
		return forkPoint ?? this.readMergeBase(repoPath, reads.from, ref, false, reads, cancellation);
	}

	/**
	 * `getMergeBase`, sharing its cached and in-flight reads, but telling git's exit 1 (no common ancestor, or no fork
	 * point) from a read that failed. Both answer `undefined`; a failed one also clears `reads.pinnable`.
	 */
	private async readMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		forkPoint: boolean,
		reads: Pick<BaseReads, 'priority' | 'pinnable'>,
		cancellation: AbortSignal | undefined,
	): Promise<string | undefined> {
		try {
			const result = await this.git.run(
				{
					cwd: repoPath,
					cancellation: cancellation,
					errors: 'throw',
					expectedExitCodes: [1],
					caching: { cache: this.cache.gitResults, options: { accessTTL: 5 * 60 * 1000 } },
					...(reads.priority != null ? { priority: reads.priority } : undefined),
				},
				'merge-base',
				forkPoint ? '--fork-point' : undefined,
				ref1,
				ref2,
			);
			// A run joined in flight comes back as its starter's `errors` handling made it: from `getMergeBase`, a
			// swallowed warning resolves (and git's exit 1 rejects), so only an exit here is git's answer
			if (result.completion.status === 'exited') {
				if (result.exitCode === 1) return undefined;

				const sha = result.stdout.split('\n')[0].trim();
				if (sha) return sha;
			}
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
		}

		reads.pinnable = false;
		return undefined;
	}

	/**
	 * The stored merge target — the user's pick, else the one detected from its PR — skipping any whose branch git
	 * confirms is gone so resolution falls through to the next source. A target that couldn't be checked is kept.
	 * The stored keys are never rewritten here: the user pick is the user's, and Kepler shares the file.
	 */
	@debug({ quiet: true, exit: true })
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

	@trace({ quiet: true, exit: true })
	async getStoredDetectedMergeTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const target =
			(await this.provider.config.getGkConfig(repoPath, `branch.${ref}.gk-merge-target`)) ??
			(await this.provider.config.getGkConfig(repoPath, `branch.${ref}.gk-target-base`)); // legacy key
		return target?.trim() || undefined;
	}

	@trace({ quiet: true })
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
		this._branchCheckedOutFrom.delete(key);
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
			// `git branch -m` can rename the ref and still fail on its config, which it moves from the old name's section
			// to the new one's
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(
				repoPath,
				['config', 'heads'],
				[`refs/heads/${oldName}`, `refs/heads/${newName}`],
				{ configConfinedToRefs: true },
			);
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
			// The upstream is the branch's own config section; the branch is named for its tracking, not a move
			this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'heads'], [`refs/heads/${name}`], {
				configConfinedToRefs: true,
			});
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

/** Each ref list {@link findRefTip} and {@link findRefRecord} searched, by full name: one base read looks up many names in the same cached list */
const refRecordsByName = new WeakMap<readonly RefRecord[], Map<string, RefRecord>>();

/**
 * The commit `name` resolves to among `records`, tried in git's own order for a short name (`refs/tags/` before
 * `refs/heads/` before `refs/remotes/`); annotated tags peel to their commit. `undefined` when no listed ref matches.
 */
function findRefTip(records: readonly RefRecord[], name: string): string | undefined {
	const record = resolveRefRecord(records, name);
	return record != null ? record.peeledObjectname || record.objectname : undefined;
}

/** The listed ref `name` resolves to, in {@link findRefTip}'s order */
function resolveRefRecord(records: readonly RefRecord[], name: string): RefRecord | undefined {
	const byName = getRefRecordsByName(records);
	for (const candidate of getRefNameCandidates(name)) {
		const record = byName.get(candidate);
		if (record != null) return record;
	}

	return undefined;
}

/** Whether more than one listed ref answers to `name`, which git calls ambiguous and resolves in {@link findRefTip}'s order */
function isAmbiguousRefName(records: readonly RefRecord[], name: string): boolean {
	const byName = getRefRecordsByName(records);
	let found = false;
	for (const candidate of getRefNameCandidates(name)) {
		if (!byName.has(candidate)) continue;
		if (found) return true;

		found = true;
	}

	return false;
}

/** The full ref names `name` may stand for, in git's own order for a short name */
function getRefNameCandidates(name: string): string[] {
	return [
		name,
		`refs/${name}`,
		`refs/tags/${name}`,
		`refs/heads/${name}`,
		`refs/remotes/${name}`,
		`refs/remotes/${name}/HEAD`,
	];
}

function getRefRecordsByName(records: readonly RefRecord[]): Map<string, RefRecord> {
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
	return byName;
}

/**
 * What the reads a base move shares across worktrees take from a ref list: the local branches worktrees have checked
 * out and their tips, and the replace refs as sorted `<name>\0<sha>` lines ('' when there are none), which change what
 * `rev-list` and `%(ahead-behind)` count. `checkedOut` is `undefined` (and `checkedOutTips` empty) when the list can't
 * say which branches are checked out, without git's `%(worktreepath)` (before 2.23): counting all of them is the walk
 * the shared count avoids, so each worktree counts its own
 */
type BaseMoveReadInputs = {
	readonly checkedOut: ReadonlySet<string> | undefined;
	readonly checkedOutTips: ReadonlySet<string>;
	readonly replaced: string;
};

/** Each ref list's {@link BaseMoveReadInputs}: every worktree a base move reached derives them from the same cached list */
const baseMoveReadInputs = new WeakMap<readonly RefRecord[], BaseMoveReadInputs>();

function getBaseMoveReadInputs(records: readonly RefRecord[]): BaseMoveReadInputs {
	let inputs = baseMoveReadInputs.get(records);
	if (inputs != null) return inputs;

	let checkedOut: Set<string> | undefined = new Set<string>();
	const checkedOutTips = new Set<string>();
	const replaced: string[] = [];
	for (const record of records) {
		if (record.name.startsWith('refs/replace/')) {
			replaced.push(`${record.name}\0${record.objectname}`);
			continue;
		}

		if (checkedOut == null || !record.name.startsWith('refs/heads/')) continue;

		if (record.worktreePath == null) {
			checkedOut = undefined;
			checkedOutTips.clear();
			continue;
		}

		if (record.worktreePath) {
			checkedOut.add(record.name);
			checkedOutTips.add(record.objectname);
		}
	}

	inputs = { checkedOut: checkedOut, checkedOutTips: checkedOutTips, replaced: replaced.sort().join('\n') };
	baseMoveReadInputs.set(records, inputs);
	return inputs;
}

/** The record for the full ref name `fullName` in `records`, the cached ref list; no short-name resolution */
function findRefRecord(records: readonly RefRecord[], fullName: string): RefRecord | undefined {
	return getRefRecordsByName(records).get(fullName);
}

function toPushTargetRef(records: readonly RefRecord[], ref: string): GitPushTargetRef {
	return { ref: ref, sha: getListedTip(records, ref) };
}

/**
 * Whether `<name>@{u}` can resolve, judged from `records`, the cached ref list. git follows `@{u}` only from the
 * upstream configured for a branch of that short name (`branch.<name>.merge`), so a remote-tracking ref, a tag or a
 * full ref name (`refs/heads/main@{u}` is "no such branch") has none. A name that names a local branch, or no ref at
 * all (a deleted branch's leftover config still answers), is asked. An empty list is a failed enumeration (see
 * `getRefTip`), which says nothing either way.
 */
function mayHaveUpstream(records: readonly RefRecord[], name: string): boolean {
	if (!records.length || name === 'HEAD') return true;
	if (findRefTip(records, `refs/heads/${name}`) != null) return true;

	return findRefTip(records, name) == null;
}

/** `answer` with the default branch its read resolved, when it consulted one (see `AheadOfBase.defaultBranch`) */
function withDefaultBranch(answer: AheadOfBase, defaultBranch: string | null | undefined): AheadOfBase {
	return defaultBranch !== undefined ? { ...answer, defaultBranch: defaultBranch } : answer;
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

/** A candidate base as the ref it is measured against, with where the branch forked from it */
interface ForkTarget {
	readonly ref: string;
	readonly forkPoint: string | undefined;
}

/**
 * What `resolveBase` answered: a target and the source that decided it; or, for the default branch itself, its own
 * upstream with that upstream's tip (`undefined` when it has none), not yet measured; or nothing
 */
type ResolvedBase =
	| { readonly kind: 'target'; readonly target: ForkTarget; readonly tier: MergeTargetTier }
	| { readonly kind: 'upstream'; readonly upstream: { readonly ref: string; readonly sha: string } | undefined }
	| { readonly kind: 'none' };

/** Where a base resolution measures from, and what it read, which `getMergeTarget` keeps to confirm its answer later */
interface BaseReads {
	/** The ref the base is measured from: `HEAD`, or the branch's own full ref */
	readonly from: string;
	readonly priority: GitCommandPriority | undefined;
	/** As `AheadOfBase.dependsOn` */
	readonly dependsOn: Set<string>;
	/** Further full ref names the answer depends on, which `dependsOn` leaves out because they were absent */
	readonly tipRefs: Set<string>;
	/** Cleared when the answer rests on a read that failed, or on rev-parse's word for a ref the ref list doesn't name */
	pinnable: boolean;
	/** The stored merge keys as read (see `readStoredMergeKeys`) */
	stored?: readonly (string | undefined)[];
	/** As `CachedMergeTarget.pullRequest` */
	pullRequest?: string | null;
	/** As `CachedMergeTarget.localDefault`; also `AheadOfBase.defaultBranch` */
	localDefault?: string | null;
	/** As `CachedMergeTarget.remoteDefault` */
	remoteDefault?: { remote: string; name: string | null };
	/** As `CachedMergeTarget.fallbackDefault` */
	fallbackDefault?: string | null;
	/** As `CachedMergeTarget.evictOnCheckout` */
	evictOnCheckout: boolean;
}

function createBaseReads(
	from: string,
	dependsOn: Iterable<string>,
	priority: GitCommandPriority | undefined,
): BaseReads {
	return {
		from: from,
		priority: priority,
		dependsOn: new Set(dependsOn),
		tipRefs: new Set(),
		pinnable: true,
		evictOnCheckout: false,
	};
}

/**
 * Keys a merge target by `branch` and every option that shapes the answer. `keepSelfAtTip` is applied to the cached
 * answer instead, and `priority` doesn't change it
 */
function getMergeTargetCacheKey(branch: string, options: MergeTargetOptions | undefined): string {
	const flags = [
		options?.skipUserTarget ? 'u' : '',
		options?.getAssociatedPullRequest != null ? 'p' : '',
		options?.inferBase ? 'i' : '',
		options?.defaultBranch === 'remote' ? 'r' : '',
		options?.getFallbackDefaultBranch != null ? 'f' : '',
	].join('');
	return `${branch}\0${flags}\0${options?.preferredTarget?.trim() ?? ''}`;
}

/** `read`'s answer, with a failure read as none; cancellation still rejects */
async function tolerateRead<T>(read: (() => Promise<T>) | undefined): Promise<T | undefined> {
	if (read == null) return undefined;

	try {
		return await read();
	} catch (ex) {
		if (isCancellationError(ex)) throw ex;

		return undefined;
	}
}

/** `value` as a literal in `getReflogEntries`' `grep`, a basic regular expression */
function toReflogGrepLiteral(value: string): string {
	return value.replace(/[\\.*[\]^$]/g, '\\$&');
}

/** The tip of the full ref name `fullName` in `records`, the cached ref list; `undefined` when it isn't listed */
function getListedTip(records: readonly RefRecord[], fullName: string): string | undefined {
	const record = findRefRecord(records, fullName);
	return record != null ? record.peeledObjectname || record.objectname : undefined;
}
