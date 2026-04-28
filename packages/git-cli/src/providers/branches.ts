import type { Cache, ConflictDetectionCacheKey } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { BranchError } from '@gitlens/git/errors.js';
import type { BranchDisposition, BranchMetadata } from '@gitlens/git/models/branch.js';
import { GitBranch } from '@gitlens/git/models/branch.js';
import type { ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type {
	BranchContributionsOverview,
	GitBranchesSubProvider,
	GitBranchMergedStatus,
} from '@gitlens/git/providers/branches.js';
import {
	formatDetachedHeadName,
	getBranchId,
	getLocalBranchByUpstream,
	isDetachedHead,
	isRemoteHEAD,
	parseRefName,
	parseUpstream,
} from '@gitlens/git/utils/branch.utils.js';
import { createConflictDetectionError } from '@gitlens/git/utils/mergeConflicts.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { createRevisionRange, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import type { BranchSortOptions } from '@gitlens/git/utils/sorting.js';
import { sortBranches, sortContributors } from '@gitlens/git/utils/sorting.js';
import { ensureArray, filterMap } from '@gitlens/utils/array.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { debounce } from '@gitlens/utils/decorators/debounce.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import { emptyPagedResult, PageableResult } from '@gitlens/utils/paging.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitResult } from '../exec/exec.types.js';
import type { Git } from '../exec/git.js';
import { getGitCommandError, gitConfigsBranch, gitConfigsLog, GitError, GitErrors, GitWarnings } from '../exec/git.js';
import { parseMergeTreeConflict } from '../parsers/mergeTreeParser.js';
import { getBranchParser } from '../parsers/refParser.js';

/** Minimum time between writes to the config for last accessed/modified dates */
const dateMetadataStaleThresholdMs = 5 * 60 * 1000; // 5 minutes

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async getBranch(repoPath: string, name?: string, cancellation?: AbortSignal): Promise<GitBranch | undefined> {
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
					? this.provider.pausedOps?.getPausedOperationStatus(repoPath, cancellation)
					: undefined,
				this.git
					.exec(
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
				const supported = await this.git.supported('git:for-each-ref');
				const parser = getBranchParser(supported);

				const [gitResult, defaultWorktreePathResult, metadataMapResult] = await Promise.allSettled([
					this.git.exec(
						{ cwd: commonPath, cancellation: signal },
						'for-each-ref',
						...parser.arguments,
						'refs/heads/',
						'refs/remotes/',
					),
					this.provider.config.getDefaultWorktreePath?.(commonPath),
					this.getBranchMetadataMap(commonPath),
				]);

				const result = getSettledValue(gitResult);
				const metadataMap = getSettledValue(metadataMapResult) ?? new Map<string, BranchMetadata>();
				const defaultWorktreePath = getSettledValue(defaultWorktreePathResult);

				// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
				if (!result?.stdout) {
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

				for (const entry of parser.parse(result.stdout)) {
					// Skip HEAD refs in remote branches
					if (isRemoteHEAD(entry.name)) continue;

					const upstream = parseUpstream(entry.upstream, entry.upstreamTracking);

					const metadata = metadataMap.get(parseRefName(entry.name).name);
					const worktreePath = entry.worktreePath ? normalizePath(entry.worktreePath) : undefined;

					branches.push(
						new GitBranch(
							commonPath,
							entry.name,
							false, // Don't trust %(HEAD) for current as it's per-worktree -- we will set it later
							entry.date ? new Date(entry.date) : undefined,
							metadata,
							entry.sha,
							upstream,
							supported.includes('git:for-each-ref:worktreePath')
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
					if (branch.worktree && branch.worktree.path) {
						const { name } = parseRefName(branch.refName);
						const reference = createReference(name, branch.worktree.path, {
							refType: 'branch',
							name: name,
							id: getBranchId(branch.worktree.path, false, name),
							remote: false,
							upstream: branch.upstream?.name
								? { name: branch.upstream.name, missing: branch.upstream.missing }
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
		options?: { associatedPullRequest?: Promise<{ refs?: { base?: { branch: string } } } | undefined> },
		cancellation?: AbortSignal,
	): Promise<BranchContributionsOverview | undefined> {
		const scope = getScopedLogger();

		try {
			const branch = await this.getBranch(repoPath, ref, cancellation);
			if (branch == null) return undefined;

			let mergeTarget: string | undefined;

			// Tier 1: Check stored merge target (user-set or previously detected from PR)
			const storedTarget = await this.getStoredMergeTargetBranchName(repoPath, ref);
			if (storedTarget) {
				const validated = await this.provider.refs.getSymbolicReferenceName(repoPath, storedTarget);
				mergeTarget = validated || storedTarget;
			}

			// Tier 2: PR-based lookup (caller provides the PR promise)
			if (mergeTarget == null && options?.associatedPullRequest != null) {
				const pr = await options.associatedPullRequest;
				if (pr?.refs?.base != null) {
					mergeTarget = `${branch.remoteName}/${pr.refs.base.branch}`;
					// Store for future reuse
					void this.storeMergeTargetBranchName(repoPath, ref, mergeTarget);
				}
			}

			// Tier 3: Base branch, then default branch
			mergeTarget ??= await this.getBaseBranchName(repoPath, ref, cancellation);
			mergeTarget ??= await this.getDefaultBranchName(repoPath, undefined, cancellation);

			if (mergeTarget == null) return undefined;

			const mergeBase = await this.provider.refs.getMergeBase(
				repoPath,
				ref,
				mergeTarget,
				undefined,
				cancellation,
			);
			if (mergeBase == null) return undefined;

			// Fetch the merge-base commit's dates in parallel with contributors so consumers
			// (e.g. the graph minimap scope window) don't pay a separate round-trip for them.
			const [contributorsResult, mergeBaseDates] = await Promise.all([
				this.provider.contributors.getContributors(
					repoPath,
					createRevisionRange(mergeBase, ref, '..'),
					{ stats: true },
					cancellation,
				),
				this.provider.commits.getCommitDates(repoPath, mergeBase, cancellation).catch(() => undefined),
			]);
			const result = contributorsResult;

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

		return this.git.exec(
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

				let data: [string, string | undefined] | undefined;
				let result;
				try {
					result = await this.git.exec(
						{ cwd: repoPath, cancellation: signal, errors: 'throw' },
						'rev-parse',
						'--abbrev-ref',
						'--symbolic-full-name',
						'@',
						'@{u}',
						'--',
					);
					data = [result.stdout, undefined];
				} catch (ex) {
					if (isCancellationError(ex)) throw ex;

					const msg: string = ex?.toString() ?? '';
					if (GitErrors.badRevision.test(msg) || GitWarnings.noUpstream.test(msg)) {
						if (ex.stdout != null && ex.stdout.length !== 0) {
							data = [ex.stdout, undefined];
						} else {
							try {
								result = await this.git.exec(
									{ cwd: repoPath, cancellation: signal },
									'symbolic-ref',
									'--short',
									'HEAD',
								);
								if (result.stdout) {
									data = [result.stdout.trim(), undefined];
								}
							} catch {
								if (isCancellationError(ex)) throw ex;
							}

							if (data == null) {
								const symbolicRef = await this.getDefaultBranchName(repoPath, 'origin', signal);
								if (symbolicRef != null) {
									data = [
										symbolicRef.startsWith('origin/')
											? symbolicRef.substring('origin/'.length)
											: symbolicRef,
										undefined,
									];
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

								data = [
									`${defaultBranch}${remote && remoteBranch ? `\n${remote}/${remoteBranch}` : ''}`,
									undefined,
								];
							}
						}
					} else if (GitWarnings.headNotABranch.test(msg)) {
						result = await this.git.exec(
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

						if (result.cancelled || signal?.aborted) {
							throw new CancellationError();
						}

						const sha = result.stdout.trim();
						if (sha) {
							data = [`(HEAD detached at ${shortenRevision(sha)})`, sha];
						}
					} else {
						Logger.warn(`[${repoPath}] Unable to get current branch: ${ex}`);
					}
				}

				if (data == null) return undefined;

				const [name, upstream] = data[0].split('\n');

				return createReference(name, repoPath, {
					refType: 'branch',
					name: name,
					id: getBranchId(repoPath, false, name),
					remote: false,
					upstream: upstream ? { name: upstream, missing: false } : undefined,
					sha: data[1],
				});
			},
			{ cancellation: cancellation },
		);
	}

	@debug({ exit: true })
	async getDefaultBranchName(
		repoPath: string | undefined,
		remote?: string,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		remote ??= 'origin';

		return this.cache.getDefaultBranchName(repoPath, remote, async commonPath => {
			let retried = false;
			while (true) {
				try {
					const result = await this.git.exec(
						{ cwd: commonPath, cancellation: cancellation },
						'symbolic-ref',
						'--short',
						`refs/remotes/${remote}/HEAD`,
					);
					return result.stdout.trim() || undefined;
				} catch (ex) {
					if (/is not a symbolic ref/.test(ex.stderr)) {
						try {
							if (!retried) {
								retried = true;
								await this.git.exec(
									{ cwd: commonPath, cancellation: cancellation },
									'remote',
									'set-head',
									'-a',
									remote,
								);
								continue;
							}

							const result = await this.git.exec(
								{ cwd: commonPath, cancellation: cancellation },
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
						} catch {
							if (isCancellationError(ex)) throw ex;
						}
					}

					return undefined;
				}
			}
		});
	}

	@debug()
	async createBranch(repoPath: string, name: string, ref: string, options?: { noTracking?: boolean }): Promise<void> {
		const args = ['branch', name, ref];
		if (options?.noTracking) {
			args.push('--no-track');
		}
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['heads']);
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
		}
	}

	@debug()
	async deleteLocalBranch(repoPath: string, names: string | string[], options?: { force?: boolean }): Promise<void> {
		const branches = ensureArray(names);
		const args = ['branch', options?.force ? '-D' : '-d', ...branches];
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['heads']);
		} catch (ex) {
			if (ex instanceof BranchError) {
				throw ex.update({
					action: options?.force ? 'force delete' : 'delete',
					branch: branches.join(', '),
					gitCommand: { repoPath: repoPath, args: args },
				});
			}

			throw new BranchError(
				{
					action: options?.force ? 'force delete' : 'delete',
					branch: branches.join(', '),
					gitCommand: { repoPath: repoPath, args: args },
				},
				ex,
			);
		}
	}

	@debug()
	async deleteRemoteBranch(repoPath: string, names: string | string[], remote: string): Promise<void> {
		const branches = ensureArray(names);
		const args = ['push', '-d', remote, ...branches];
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
		} catch (ex) {
			if (ex instanceof BranchError) {
				throw ex.update({
					action: 'delete',
					branch: branches.join(', '),
					gitCommand: { repoPath: repoPath, args: args },
				});
			}

			throw new BranchError(
				{ action: 'delete', branch: branches.join(', '), gitCommand: { repoPath: repoPath, args: args } },
				ex,
			);
		}
	}

	@debug()
	getBranchMergedStatus(
		repoPath: string,
		branch: GitBranchReference,
		into: GitBranchReference,
		cancellation?: AbortSignal,
	): Promise<GitBranchMergedStatus> {
		if (branch.name === into.name || branch.upstream?.name === into.name) {
			return Promise.resolve({ merged: false });
		}

		// Cache key omits repoPath so worktrees of the same common repo share the cached answer.
		// Branch refs (`refs/heads/*` / `refs/remotes/*`) are unique within a common repo, so
		// `name` + `remote` flag is the minimal stable identity.
		const cacheKey = `${branch.remote ? 'r' : 'l'}:${branch.name}|${into.remote ? 'r' : 'l'}:${into.name}`;

		return this.cache.getBranchMergedStatus(
			repoPath,
			cacheKey,
			async (commonPath, _cacheable, signal) => {
				const result = await this.getBranchMergedStatusCore(commonPath, branch, into, signal);
				if (result.merged) return result;

				// If the branch we are checking is a remote branch, check if it has been merged into its local branch (if there is one)
				if (into.remote) {
					const localIntoBranch = await this.getLocalBranchByUpstream(commonPath, into.name, signal);
					// If there is a local branch and it is not the branch we are checking, check if it has been merged into it
					if (localIntoBranch != null && localIntoBranch.name !== branch.name) {
						// Skip the second full merge-check cycle when the local branch points at the same commit as the remote —
						// the merge-base/cherry/diff/apply pipeline would produce the same answer we already got for `into` above
						if (localIntoBranch.sha != null && localIntoBranch.sha === into.sha) {
							return { merged: false };
						}

						const result = await this.getBranchMergedStatusCore(
							commonPath,
							branch,
							localIntoBranch,
							signal,
						);
						if (result.merged) {
							// `localBranchOnly` is built against `commonPath` here; the cache mapper rewrites
							// `repoPath`/`id` to the requesting worktree on retrieval.
							return {
								...result,
								localBranchOnly: createReference(localIntoBranch.ref, localIntoBranch.repoPath, {
									id: localIntoBranch.id,
									refType: 'branch',
									name: localIntoBranch.name,
									remote: localIntoBranch.remote,
									upstream: localIntoBranch.upstream,
									sha: localIntoBranch.sha,
								}),
							};
						}
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
				await this.git.exec(
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
			let result = await this.git.exec(
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
			result = await this.git.exec({ cwd: repoPath, cancellation: cancellation }, 'diff', mergeBase, branch.name);
			if (result.stdout) {
				// Create a temporary index file
				await using disposableIndex = await this.provider.staging.createTemporaryIndex(
					repoPath,
					'ref',
					into.name,
				);
				const { env } = disposableIndex;

				result = await this.git.exec(
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
					const result = await this.git.exec(
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
				// Requires Git v2.33+
				if (!(await this.git.supports('git:merge-tree'))) {
					return createConflictDetectionError('unsupported');
				}

				let data;
				try {
					const result = await this.git.exec(
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
				if (!mergeConflict.conflicts.length) return { status: 'clean' };

				return {
					status: 'conflicts',
					conflict: {
						repoPath: repoPath,
						branch: branch,
						target: targetBranch,
						files: mergeConflict.conflicts,
						shas: undefined, // Merge conflicts don't have a specific commit SHA
					},
				};
			},
			{ cancellation: cancellation },
		);
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
		if (!(await this.git.supports('git:merge-tree:write-tree'))) {
			return createConflictDetectionError('unsupported');
		}

		let currentTreeOid: string;
		try {
			// Get the initial target branch tree OID
			const treeResult = await this.git.exec(
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

			let data;
			try {
				// Use merge-tree --write-tree with --merge-base to simulate cherry-pick:
				// merge-tree --write-tree --merge-base=<commit-parent> <current-tree> <commit>
				// This performs a 3-way merge where:
				//   - base = commit.parent (where the commit started)
				//   - ours = currentTreeOid (current state of the target)
				//   - theirs = commit.sha (what we're cherry-picking)
				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
					'merge-tree',
					'--write-tree',
					'-z',
					'--name-only',
					'--no-messages',
					`--merge-base=${commit.parent}`,
					currentTreeOid,
					commit.sha,
				);
				data = result.stdout;
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				const msg: string = ex?.toString() ?? '';
				if (GitErrors.notAValidObjectName.test(msg)) {
					scope?.error(
						ex,
						`'${targetBranch}' or '${commit.sha}' not found - ensure the branches/commits exist`,
					);
					return createConflictDetectionError('refNotFound');
				} else if (GitErrors.badRevision.test(msg)) {
					scope?.error(ex, `Invalid revision: ${msg.slice(msg.indexOf("'"))}`);
					return createConflictDetectionError('refNotFound');
				} else if (GitErrors.noMergeBase.test(msg)) {
					scope?.error(
						ex,
						`Unable to merge '${commit.sha}' and '${targetBranch}' as they have no common ancestor`,
					);
					return createConflictDetectionError('noMergeBase');
				} else if (ex instanceof GitError) {
					data = ex.stdout;
				} else {
					scope?.error(ex, 'Failed to execute merge-tree for conflict check');
					return createConflictDetectionError('other');
				}
			}

			if (!data) continue;

			const mergeConflict = parseMergeTreeConflict(data);

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
			};
		}

		return { status: 'clean' };
	}

	@debug({ exit: true })
	getBaseBranchName(repoPath: string, ref: string, cancellation?: AbortSignal): Promise<string | undefined> {
		return this.cache.getBaseBranchName(
			repoPath,
			ref,
			async (commonPath, signal) => {
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
						const branch = await this.provider.refs.getSymbolicReferenceName(commonPath, mergeBase);
						if (branch != null) {
							if (update) {
								void this.storeBaseBranchName(commonPath, ref, branch);
							}
							return branch;
						}
					}
				} catch {}

				const branch = await this.getBaseBranchFromReflog(commonPath, ref, { upstream: true }, signal);
				if (branch != null) {
					void this.storeBaseBranchName(commonPath, ref, branch);
					return branch;
				}

				return undefined;
			},
			cancellation,
		);
	}

	private async getBaseBranchFromReflog(
		repoPath: string,
		ref: string,
		options?: { upstream: true },
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		try {
			let result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation },
				'reflog',
				ref,
				'--grep-reflog=branch: Created from *.',
			);

			let entries = result.stdout.split('\n').filter(entry => Boolean(entry));
			if (entries.length !== 1) return undefined;

			// Check if branch created from an explicit branch
			let match = entries[0].match(/branch: Created from (.*)$/);
			if (match?.length === 2) {
				let name: string | undefined = match[1];
				if (name !== 'HEAD') {
					if (options?.upstream) {
						const upstream = await this.provider.refs.getSymbolicReferenceName(repoPath, `${name}@{u}`);
						if (upstream) return upstream;
					}

					name = await this.provider.refs.getSymbolicReferenceName(repoPath, name);
					if (name) return name;
				}
			}

			// Check if branch was created from HEAD
			result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation },
				'reflog',
				'HEAD',
				`--grep-reflog=checkout: moving from .* to ${ref.replace('refs/heads/', '')}`,
			);

			entries = result.stdout.split('\n').filter(entry => Boolean(entry));
			if (!entries.length) return undefined;

			match = entries.at(-1)!.match(/checkout: moving from ([^\s]+)\s/);
			if (match?.length === 2) {
				let name: string | undefined = match[1];
				if (options?.upstream) {
					const upstream = await this.provider.refs.getSymbolicReferenceName(repoPath, `${name}@{u}`);
					if (upstream) return upstream;
				}

				name = await this.provider.refs.getSymbolicReferenceName(repoPath, name);
				if (name) return name;
			}
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
		}

		return undefined;
	}

	@debug({ exit: true })
	async getStoredMergeTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const target =
			(await this.getStoredUserMergeTargetBranchName?.(repoPath, ref)) ??
			(await this.getStoredDetectedMergeTargetBranchName?.(repoPath, ref));
		return target?.trim() || undefined;
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

	/** Updates the last accessed timestamp for the current branch */
	@debounce(2.5 * 60 * 1000)
	@debug()
	async onCurrentBranchAccessed(repoPath: string): Promise<void> {
		const branch = await this.getBranch(repoPath);
		if (branch == null || branch.remote || branch.detached) return;

		await this.storeBranchMetadata(repoPath, 'gk-last-accessed', branch.name, new Date());
	}

	/** Updates the last accessed and modified timestamp for the current branch */
	@debounce(2.5 * 60 * 1000)
	@debug()
	async onCurrentBranchModified(repoPath: string): Promise<void> {
		const branch = await this.getBranch(repoPath);
		if (branch == null || branch.remote || branch.detached) return;

		const now = new Date();
		await this.storeBranchMetadata(repoPath, 'gk-last-accessed', branch.name, now);
		await this.storeBranchMetadata(repoPath, 'gk-last-modified', branch.name, now);
	}

	/** Updates the agent last activity timestamp for the current branch */
	@debounce(2.5 * 60 * 1000)
	@debug()
	async onCurrentBranchAgentActivity(repoPath: string): Promise<void> {
		const branch = await this.getBranch(repoPath);
		if (branch == null || branch.remote || branch.detached) return;

		await this.storeBranchMetadata(repoPath, 'gk-agent-last-activity', branch.name, new Date());
	}

	@debug()
	async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
		const args = ['branch', '-m', oldName, newName];
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['heads']);
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
		}
	}

	@debug()
	async setUpstreamBranch(repoPath: string, name: string, upstream: string | undefined): Promise<void> {
		const args =
			upstream == null ? ['branch', '--unset-upstream', name] : ['branch', '--set-upstream-to', upstream, name];
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['heads']);
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
		}
	}

	@debug()
	async storeBaseBranchName(repoPath: string, ref: string, base: string): Promise<void> {
		await this.provider.config.setGkConfig(repoPath, `branch.${ref}.gk-merge-base`, base);
	}

	@debug()
	async storeMergeTargetBranchName(repoPath: string, ref: string, target: string): Promise<void> {
		await this.provider.config.setGkConfig(repoPath, `branch.${ref}.gk-merge-target`, target);
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
					// Extract branch name and metadata key from "branch.{name}.gk-{key}"
					if (!key.startsWith('branch.')) continue;

					const keyParts = key.split('.');
					if (keyParts.length < 3) continue;

					// Branch name is everything between "branch." and the last ".gk-*"
					const metaKey = keyParts.at(-1);
					const branchName = keyParts.slice(1, -1).join('.');

					let metadata = metadataMap.get(branchName);
					if (metadata == null) {
						metadata = {};
						metadataMap.set(branchName, metadata);
					}

					if (metaKey === 'gk-last-accessed') {
						metadata.lastAccessedAt = value;
					} else if (metaKey === 'gk-last-modified') {
						metadata.lastModifiedAt = value;
					} else if (metaKey === 'gk-agent-last-activity') {
						metadata.agentLastActivityAt = value;
					} else if (metaKey === 'gk-disposition') {
						if (value === 'starred' || value === 'archived') {
							metadata.disposition = value;
						}
					}
				}
			} catch (ex) {
				debugger;
				scope?.error(ex);
			}

			return metadataMap;
		});
	}

	private async storeBranchMetadata(
		repoPath: string,
		key: 'gk-last-accessed' | 'gk-last-modified' | 'gk-agent-last-activity',
		ref: string,
		date: Date,
	): Promise<void> {
		const value = await this.provider.config.getGkConfig(repoPath, `branch.${ref}.${key}`);
		// Skip if incoming date is not at least 5 minutes newer than stored date
		if (value != null && date.getTime() - new Date(value).getTime() < dateMetadataStaleThresholdMs) {
			return;
		}

		return this.provider.config.setGkConfig(repoPath, `branch.${ref}.${key}`, date.toISOString());
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
