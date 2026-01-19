import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container.js';
import { CancellationError, isCancellationError } from '../../../../errors.js';
import type { ConflictDetectionCacheKey, GitCache } from '../../../../git/cache.js';
import { GitErrorHandling } from '../../../../git/commandOptions.js';
import { BranchError } from '../../../../git/errors.js';
import type {
	BranchContributionsOverview,
	GitBranchesSubProvider,
	GitBranchMergedStatus,
	PagedResult,
	PagingOptions,
} from '../../../../git/gitProvider.js';
import { GitBranch } from '../../../../git/models/branch.js';
import type { ConflictDetectionResult } from '../../../../git/models/mergeConflicts.js';
import type { GitBranchReference } from '../../../../git/models/reference.js';
import { parseMergeTreeConflict } from '../../../../git/parsers/mergeTreeParser.js';
import { getBranchParser } from '../../../../git/parsers/refParser.js';
import { getBranchMergeTargetName } from '../../../../git/utils/-webview/branch.utils.js';
import { getReferenceFromBranch } from '../../../../git/utils/-webview/reference.utils.js';
import type { BranchSortOptions } from '../../../../git/utils/-webview/sorting.js';
import { sortBranches, sortContributors } from '../../../../git/utils/-webview/sorting.js';
import {
	formatDetachedHeadName,
	getBranchId,
	getLocalBranchByUpstream,
	isDetachedHead,
	isRemoteHEAD,
	parseUpstream,
} from '../../../../git/utils/branch.utils.js';
import { createConflictDetectionError } from '../../../../git/utils/mergeConflicts.utils.js';
import { createReference } from '../../../../git/utils/reference.utils.js';
import { createRevisionRange } from '../../../../git/utils/revision.utils.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { ensureArray, filterMap } from '../../../../system/array.js';
import { debounce } from '../../../../system/decorators/debounce.js';
import { log } from '../../../../system/decorators/log.js';
import { Logger } from '../../../../system/logger.js';
import { getLogScope } from '../../../../system/logger.scope.js';
import { PageableResult } from '../../../../system/paging.js';
import { normalizePath } from '../../../../system/path.js';
import { getSettledValue } from '../../../../system/promise.js';
import { maybeStopWatch } from '../../../../system/stopwatch.js';
import type { Git } from '../git.js';
import { getGitCommandError, gitConfigsLog, GitError, GitErrors } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });
/** Minimum time between writes to the config for last accessed/modified dates */
const dateMetadataStaleThresholdMs = 5 * 60 * 1000; // 5 minutes

interface BranchDateMetadata {
	lastAccessedAt?: string;
	lastModifiedAt?: string;
}

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@log()
	async getBranch(repoPath: string, name?: string, cancellation?: CancellationToken): Promise<GitBranch | undefined> {
		if (name != null) {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.name === name }, cancellation);
			return branch;
		}

		const branchPromise = this.cache.branch.getOrCreate(repoPath, async () => {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.current }, cancellation);
			return branch ?? this.getCurrentBranch(repoPath, undefined, cancellation);
		});

		if (branchPromise == null) {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.current }, cancellation);
			return branch ?? this.getCurrentBranch(repoPath, undefined, cancellation);
		}

		return branchPromise;
	}

	private async getCurrentBranch(
		repoPath: string,
		dateMetadataMap: Map<string, BranchDateMetadata> | undefined,
		cancellation?: CancellationToken,
	): Promise<GitBranch | undefined> {
		const ref = await this.getCurrentBranchReferenceCore(repoPath, cancellation);
		if (ref == null) return undefined;

		const commitOrdering = configuration.get('advanced.commitOrdering');

		const [pausedOpStatusResult, committerDateResult, defaultWorktreePathResult, dateMetadataMapResult] =
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
							errors: GitErrorHandling.Ignore,
						},
						'log',
						'-n1',
						'--format=%ct',
						commitOrdering ? `--${commitOrdering}-order` : undefined,
						'--',
					)
					.then(result => (result.stdout ? result.stdout.trim() : undefined)),
				this.provider.config.getDefaultWorktreePath?.(repoPath),
				dateMetadataMap != null ? Promise.resolve(dateMetadataMap) : this.getBranchDateMetadataMap(repoPath),
			]);

		const committerDate = getSettledValue(committerDateResult);
		const pausedOpStatus = getSettledValue(pausedOpStatusResult);
		const rebaseStatus = pausedOpStatus?.type === 'rebase' ? pausedOpStatus : undefined;
		const defaultWorktreePath = getSettledValue(defaultWorktreePathResult);
		dateMetadataMap ??= getSettledValue(dateMetadataMapResult);
		const dates = dateMetadataMap?.get(ref.name);

		if (cancellation?.isCancellationRequested) throw new CancellationError();

		const branch = new GitBranch(
			this.container,
			repoPath,
			rebaseStatus?.incoming.name ?? `refs/heads/${ref.name}`,
			true,
			committerDate != null ? new Date(Number(committerDate) * 1000) : undefined,
			dates?.lastAccessedAt ? new Date(dates.lastAccessedAt) : undefined,
			dates?.lastModifiedAt ? new Date(dates.lastModifiedAt) : undefined,
			ref.sha,
			ref.upstream ? { ...ref.upstream, state: { ahead: 0, behind: 0 } } : undefined,
			{ path: repoPath, isDefault: repoPath === defaultWorktreePath },
			undefined,
			rebaseStatus != null,
		);

		return branch;
	}

	@log({ args: { 1: false } })
	async getBranches(
		repoPath: string,
		options?: {
			filter?: (b: GitBranch) => boolean;
			paging?: PagingOptions;
			sort?: boolean | BranchSortOptions;
		},
		cancellation?: CancellationToken,
	): Promise<PagedResult<GitBranch>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getLogScope();

		let resultsPromise = this.cache.branches.get(repoPath);
		if (resultsPromise == null) {
			async function load(this: BranchesGitSubProvider): Promise<PagedResult<GitBranch>> {
				try {
					const supported = await this.git.supported('git:for-each-ref');
					const parser = getBranchParser(supported);

					const [gitResult, defaultWorktreePathResult, dateMetadataMapResult] = await Promise.allSettled([
						this.git.exec(
							{ cwd: repoPath, cancellation: cancellation },
							'for-each-ref',
							...parser.arguments,
							'refs/heads/',
							'refs/remotes/',
						),
						this.provider.config.getDefaultWorktreePath?.(repoPath),
						this.getBranchDateMetadataMap(repoPath),
					]);

					const result = getSettledValue(gitResult);
					const dateMetadataMap =
						getSettledValue(dateMetadataMapResult) ?? new Map<string, BranchDateMetadata>();
					const defaultWorktreePath = getSettledValue(defaultWorktreePathResult);

					// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
					if (!result?.stdout) {
						const current = await this.getCurrentBranch(repoPath, dateMetadataMap, cancellation);
						return current != null ? { values: [current] } : emptyPagedResult;
					}

					using sw = maybeStopWatch(scope, { log: false, logLevel: 'debug' });

					const branches: GitBranch[] = [];

					let hasCurrent = false;

					for (const entry of parser.parse(result.stdout)) {
						// Skip HEAD refs in remote branches
						if (isRemoteHEAD(entry.name)) continue;

						const upstream = parseUpstream(entry.upstream, entry.upstreamTracking);

						const current = entry.current === '*';
						if (current) {
							hasCurrent = true;
						}

						const dates = dateMetadataMap.get(entry.name);
						const worktreePath = entry.worktreePath ? normalizePath(entry.worktreePath) : undefined;

						branches.push(
							new GitBranch(
								this.container,
								repoPath,
								entry.name,
								current,
								entry.date ? new Date(entry.date) : undefined,
								dates?.lastAccessedAt ? new Date(dates.lastAccessedAt) : undefined,
								dates?.lastModifiedAt ? new Date(dates.lastModifiedAt) : undefined,
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

					if (!branches.length) return emptyPagedResult;

					// If we don't have a current branch, check if we can find it another way (likely detached head)
					if (!hasCurrent) {
						const current = await this.getCurrentBranch(repoPath, dateMetadataMap, cancellation);
						if (current != null) {
							// replace the current branch if it already exists and add it first if not
							const index = branches.findIndex(b => b.id === current.id);
							if (index !== -1) {
								branches[index] = current;
							} else {
								branches.unshift(current);
							}
						}
					}

					return { values: branches };
				} catch (ex) {
					this.cache.branches.delete(repoPath);
					if (isCancellationError(ex)) throw ex;

					return emptyPagedResult;
				}
			}

			resultsPromise = load.call(this);

			if (options?.paging?.cursor == null) {
				this.cache.branches.set(repoPath, resultsPromise);
			}
		}

		let result = await resultsPromise;
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

	@log()
	async getBranchContributionsOverview(
		repoPath: string,
		ref: string,
		cancellation?: CancellationToken,
	): Promise<BranchContributionsOverview | undefined> {
		const scope = getLogScope();

		try {
			const branch = await this.getBranch(repoPath, ref, cancellation);
			if (branch == null) return undefined;

			const mergeTargetResult = await getBranchMergeTargetName(this.container, branch, {
				cancellation: cancellation,
			});
			if (mergeTargetResult.paused) return undefined;

			const mergeTarget = mergeTargetResult.value;
			if (mergeTarget == null) return undefined;

			const mergeBase = await this.provider.refs.getMergeBase(
				repoPath,
				ref,
				mergeTarget,
				undefined,
				cancellation,
			);
			if (mergeBase == null) return undefined;

			const result = await this.provider.contributors.getContributors(
				repoPath,
				createRevisionRange(mergeBase, ref, '..'),
				{ stats: true },
				cancellation,
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
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	@log()
	async getBranchesWithCommits(
		repoPath: string,
		commits: string[],
		branch?: string | undefined,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
		cancellation?: CancellationToken,
	): Promise<string[]> {
		if (branch != null) {
			const result = await this.git.branchOrTag__containsOrPointsAt(
				repoPath,
				commits,
				{ type: 'branch', mode: 'contains', name: branch },
				cancellation,
			);
			const data = result.stdout.trim();
			return data ? [data] : [];
		}

		const result = await this.git.branchOrTag__containsOrPointsAt(
			repoPath,
			commits,
			{ type: 'branch', ...options },
			cancellation,
		);
		if (!result.stdout) return [];

		return filterMap(result.stdout.split('\n'), b => b.trim() || undefined);
	}

	@log()
	async getCurrentBranchReference(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitBranchReference | undefined> {
		let ref = await this.getCurrentBranchReferenceCore(repoPath, cancellation);
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

	private async getCurrentBranchReferenceCore(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitBranchReference | undefined> {
		const commitOrdering = configuration.get('advanced.commitOrdering');

		const data = await this.git.rev_parse__currentBranch(repoPath, commitOrdering, cancellation);
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
	}

	@log({ exit: true })
	async getDefaultBranchName(
		repoPath: string | undefined,
		remote?: string,
		cancellation?: CancellationToken,
	): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		remote ??= 'origin';

		return this.cache.defaultBranchName.getOrCreate(repoPath, remote, async () => {
			return this.git.symbolic_ref__HEAD(repoPath, remote, cancellation);
		});
	}

	@log()
	async createBranch(repoPath: string, name: string, sha: string, options?: { noTracking?: boolean }): Promise<void> {
		const args = ['branch', name, sha];
		if (options?.noTracking) {
			args.push('--no-track');
		}
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
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

	@log()
	async deleteLocalBranch(repoPath: string, names: string | string[], options?: { force?: boolean }): Promise<void> {
		const branches = ensureArray(names);
		const args = ['branch', options?.force ? '-D' : '-d', ...branches];
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['branches'] });
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

	@log()
	async deleteRemoteBranch(repoPath: string, names: string | string[], remote: string): Promise<void> {
		const branches = ensureArray(names);
		const args = ['push', '-d', remote, ...branches];
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['branches'] });
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

	@log()
	async getBranchMergedStatus(
		repoPath: string,
		branch: GitBranchReference,
		into: GitBranchReference,
		cancellation?: CancellationToken,
	): Promise<GitBranchMergedStatus> {
		if (branch.name === into.name || branch.upstream?.name === into.name) {
			return { merged: false };
		}

		const result = await this.getBranchMergedStatusCore(repoPath, branch, into, cancellation);
		if (result.merged) return result;

		// If the branch we are checking is a remote branch, check if it has been merged into its local branch (if there is one)
		if (into.remote) {
			const localIntoBranch = await this.getLocalBranchByUpstream(repoPath, into.name, cancellation);
			// If there is a local branch and it is not the branch we are checking, check if it has been merged into it
			if (localIntoBranch != null && localIntoBranch.name !== branch.name) {
				const result = await this.getBranchMergedStatusCore(repoPath, branch, localIntoBranch, cancellation);
				if (result.merged) {
					return {
						...result,
						localBranchOnly: getReferenceFromBranch(localIntoBranch),
					};
				}
			}
		}

		return { merged: false };
	}

	private async getBranchMergedStatusCore(
		repoPath: string,
		branch: GitBranchReference,
		into: GitBranchReference,
		cancellation?: CancellationToken,
	): Promise<Exclude<GitBranchMergedStatus, 'localBranchOnly'>> {
		const scope = getLogScope();

		try {
			// Check if branch is direct ancestor (handles FF merges)
			try {
				await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Throw },
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
				await using disposableIndex = await this.provider.staging!.createTemporaryIndex(
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
						errors: GitErrorHandling.Ignore,
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
			if (Logger.enabled('debug')) {
				Logger.error(ex, scope);
			}
			if (isCancellationError(ex)) throw ex;

			return { merged: false };
		}
	}

	@log()
	async getLocalBranchByUpstream(
		repoPath: string,
		remoteBranchName: string,
		cancellation?: CancellationToken,
	): Promise<GitBranch | undefined> {
		const branches = new PageableResult<GitBranch>(p =>
			this.getBranches(repoPath, p != null ? { paging: p } : undefined, cancellation),
		);
		return getLocalBranchByUpstream(remoteBranchName, branches);
	}

	/** Detects potential conflicts when applying commits onto a target branch (git rebase and cherry-pick) */
	@log()
	async getPotentialApplyConflicts(
		repoPath: string,
		targetBranch: string,
		shas: string[],
		options?: { stopOnFirstConflict?: boolean },
		cancellation?: CancellationToken,
	): Promise<ConflictDetectionResult> {
		if (!shas.length) return { status: 'clean' };

		const cacheKey: ConflictDetectionCacheKey = `apply:${targetBranch}:${shas.join(',')}:${options?.stopOnFirstConflict ?? false}`;
		return this.cache.conflictDetection.getOrCreate(repoPath, cacheKey, async () => {
			// Resolve all parent refs in a single call - fails if any commit is a root commit (no parent)
			const parentRefs = shas.map(c => `${c}^`);
			let parentShas: string[];
			try {
				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Throw },
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
			return this.checkForPotentialConflicts(repoPath, commitsWithParents, targetBranch, cancellation, options);
		});
	}

	/** Detects potential conflict when merge a branch into a target branch (git merge) */
	@log()
	async getPotentialMergeConflicts(
		repoPath: string,
		branch: string,
		targetBranch: string,
		cancellation?: CancellationToken,
	): Promise<ConflictDetectionResult> {
		const scope = getLogScope();

		const cacheKey: ConflictDetectionCacheKey = `merge:${branch}:${targetBranch}`;
		return this.cache.conflictDetection.getOrCreate(repoPath, cacheKey, async () => {
			// Requires Git v2.33+
			if (!(await this.git.supports('git:merge-tree'))) {
				return createConflictDetectionError('unsupported');
			}

			let data;
			try {
				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Throw },
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
					Logger.error(
						ex,
						scope,
						`'${targetBranch}' or '${branch}' not found - ensure the branches exist and are fully qualified (e.g. 'refs/heads/main')`,
					);
					return createConflictDetectionError('refNotFound');
				} else if (GitErrors.badRevision.test(msg)) {
					Logger.error(ex, scope, `Invalid branch name: ${msg.slice(msg.indexOf("'"))}`);
					return createConflictDetectionError('refNotFound');
				} else if (GitErrors.noMergeBase.test(msg)) {
					Logger.error(
						ex,
						scope,
						`Unable to merge '${branch}' and '${targetBranch}' as they have no common ancestor`,
					);
					return createConflictDetectionError('noMergeBase');
				} else if (ex instanceof GitError) {
					data = ex.stdout;
				} else {
					Logger.error(ex, scope);
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
		});
	}

	private async checkForPotentialConflicts(
		repoPath: string,
		commits: Iterable<{ sha: string; parent: string }>,
		targetBranch: string,
		cancellation?: CancellationToken,
		options?: { stopOnFirstConflict?: boolean },
	): Promise<ConflictDetectionResult> {
		const scope = getLogScope();

		// Requires Git v2.38+ for --write-tree with 3-arg form
		if (!(await this.git.supports('git:merge-tree:write-tree'))) {
			return createConflictDetectionError('unsupported');
		}

		let currentTreeOid: string;
		try {
			// Get the initial target branch tree OID
			const treeResult = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Throw },
				'rev-parse',
				`${targetBranch}^{tree}`,
			);
			currentTreeOid = treeResult.stdout.trim();
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
			Logger.error(ex, scope, `Failed to resolve target branch '${targetBranch}'`);
			return createConflictDetectionError('refNotFound');
		}

		const conflictingShas: string[] = [];
		const conflictingFilePaths = new Set<string>();

		for (const commit of commits) {
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			let data;
			try {
				// Use merge-tree --write-tree with --merge-base to simulate cherry-pick:
				// merge-tree --write-tree --merge-base=<commit-parent> <current-tree> <commit>
				// This performs a 3-way merge where:
				//   - base = commit.parent (where the commit started)
				//   - ours = currentTreeOid (current state of the target)
				//   - theirs = commit.sha (what we're cherry-picking)
				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Throw },
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
					Logger.error(
						ex,
						scope,
						`'${targetBranch}' or '${commit.sha}' not found - ensure the branches/commits exist`,
					);
					return createConflictDetectionError('refNotFound');
				} else if (GitErrors.badRevision.test(msg)) {
					Logger.error(ex, scope, `Invalid revision: ${msg.slice(msg.indexOf("'"))}`);
					return createConflictDetectionError('refNotFound');
				} else if (GitErrors.noMergeBase.test(msg)) {
					Logger.error(
						ex,
						scope,
						`Unable to merge '${commit.sha}' and '${targetBranch}' as they have no common ancestor`,
					);
					return createConflictDetectionError('noMergeBase');
				} else if (ex instanceof GitError) {
					data = ex.stdout;
				} else {
					Logger.error(ex, scope, 'Failed to execute merge-tree for conflict check');
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
					files: [...conflictingFilePaths].map(path => ({ path: path })),
					shas: conflictingShas,
				},
				stoppedOnFirstConflict: false,
			};
		}

		return { status: 'clean' };
	}

	@log({ exit: true })
	async getBaseBranchName(
		repoPath: string,
		ref: string,
		cancellation?: CancellationToken,
	): Promise<string | undefined> {
		try {
			const pattern = `^branch\\.${ref}\\.`;
			const data = await this.git.config__get_regex(pattern, repoPath);
			if (data) {
				const regex = new RegExp(`${pattern}(.+) (.+)$`, 'gm');

				let mergeBase: string | undefined;
				let update = false;
				while (true) {
					const match = regex.exec(data);
					if (match == null) break;

					const [, key, value] = match;
					if (key === 'gk-merge-base') {
						mergeBase = value;
						update = false;
						break;
					} else if (key === 'vscode-merge-base') {
						mergeBase = value;
						update = true;
						continue;
					}
				}

				if (mergeBase != null) {
					const branch = await this.provider.refs.getSymbolicReferenceName(repoPath, mergeBase);
					if (branch != null) {
						if (update) {
							void this.storeBaseBranchName(repoPath, ref, branch);
						}
						return branch;
					}
				}
			}
		} catch {}

		const branch = await this.getBaseBranchFromReflog(repoPath, ref, { upstream: true }, cancellation);
		if (branch != null) {
			void this.storeBaseBranchName(repoPath, ref, branch);
			return branch;
		}

		return undefined;
	}

	private async getBaseBranchFromReflog(
		repoPath: string,
		ref: string,
		options?: { upstream: true },
		cancellation?: CancellationToken,
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

			match = entries[entries.length - 1].match(/checkout: moving from ([^\s]+)\s/);
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

	@log({ exit: true })
	async getStoredMergeTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const target =
			(await this.getStoredUserMergeTargetBranchName?.(repoPath, ref)) ??
			(await this.getStoredDetectedMergeTargetBranchName?.(repoPath, ref));
		return target?.trim() || undefined;
	}

	@log({ exit: true })
	async getStoredDetectedMergeTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const target =
			(await this.provider.config.getConfig(repoPath, `branch.${ref}.gk-merge-target`)) ??
			(await this.provider.config.getConfig(repoPath, `branch.${ref}.gk-target-base`));
		return target?.trim() || undefined;
	}

	@log()
	async getStoredUserMergeTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const target = await this.provider.config.getConfig(repoPath, `branch.${ref}.gk-merge-target-user`);
		return target?.trim() || undefined;
	}

	/** Updates the last accessed timestamp for the current branch */
	@debounce(2.5 * 60 * 1000)
	@log()
	async onCurrentBranchAccessed(repoPath: string): Promise<void> {
		const branch = await this.getBranch(repoPath);
		if (branch == null || branch.remote || branch.detached) return;

		await this.storeBranchDateMetadata(repoPath, 'gk-last-accessed', branch.name, new Date());
	}

	/** Updates the last accessed and modified timestamp for the current branch */
	@debounce(2.5 * 60 * 1000)
	@log()
	async onCurrentBranchModified(repoPath: string): Promise<void> {
		const branch = await this.getBranch(repoPath);
		if (branch == null || branch.remote || branch.detached) return;

		const now = new Date();
		await this.storeBranchDateMetadata(repoPath, 'gk-last-accessed', branch.name, now);
		await this.storeBranchDateMetadata(repoPath, 'gk-last-modified', branch.name, now);
	}

	@log()
	async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
		const args = ['branch', '-m', oldName, newName];
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
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

	@log()
	async setUpstreamBranch(repoPath: string, name: string, upstream: string | undefined): Promise<void> {
		const args =
			upstream == null ? ['branch', '--unset-upstream', name] : ['branch', '--set-upstream-to', upstream, name];
		try {
			await this.git.exec({ cwd: repoPath }, ...args);
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

	@log()
	async storeBaseBranchName(repoPath: string, ref: string, base: string): Promise<void> {
		await this.provider.config.setConfig(repoPath, `branch.${ref}.gk-merge-base`, base);
	}

	@log()
	async storeMergeTargetBranchName(repoPath: string, ref: string, target: string): Promise<void> {
		await this.provider.config.setConfig(repoPath, `branch.${ref}.gk-merge-target`, target);
	}

	@log()
	async storeUserMergeTargetBranchName(repoPath: string, ref: string, target: string | undefined): Promise<void> {
		await this.provider.config.setConfig(repoPath, `branch.${ref}.gk-merge-target-user`, target);
	}

	/**
	 * Gets all branch date metadata from git config in a single batch operation
	 * @returns A map of branch name to date metadata.
	 */
	private async getBranchDateMetadataMap(repoPath: string): Promise<Map<string, BranchDateMetadata>> {
		const scope = getLogScope();
		const dateMetadataMap = new Map<string, BranchDateMetadata>();

		try {
			// Use git config --get-regexp to load all gk-* branch date metadata in one call
			const data = await this.git.config__get_regex('^branch\\..*\\.gk-last-(accessed|modified)$', repoPath, {
				local: true,
			});
			if (!data) return dateMetadataMap;

			// Parse the output: "branch.{name}.gk-last-accessed {timestamp}"
			for (const line of data.split('\n')) {
				if (!line) continue;

				// Find the last space to split key from value
				const spaceIndex = line.lastIndexOf(' ');
				if (spaceIndex === -1) continue;

				const key = line.substring(0, spaceIndex);
				const value = line.substring(spaceIndex + 1);

				// Extract branch name and date metadata key from "branch.{name}.gk-{key}"
				if (!key.startsWith('branch.')) continue;

				const keyParts = key.split('.');
				if (keyParts.length < 3) continue;

				// Branch name is everything between "branch." and the last ".gk-*"
				const dateKey = keyParts[keyParts.length - 1];
				const branchName = keyParts.slice(1, -1).join('.');

				let dates = dateMetadataMap.get(branchName);
				if (dates == null) {
					dates = {};
					dateMetadataMap.set(branchName, dates);
				}

				if (dateKey === 'gk-last-accessed') {
					dates.lastAccessedAt = value;
				} else if (dateKey === 'gk-last-modified') {
					dates.lastModifiedAt = value;
				}
			}
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
		}

		return dateMetadataMap;
	}

	private async storeBranchDateMetadata(
		repoPath: string,
		key: 'gk-last-accessed' | 'gk-last-modified',
		ref: string,
		date: Date,
	): Promise<void> {
		const value = await this.provider.config.getConfig(repoPath, `branch.${ref}.${key}`);
		// Skip if incoming date is not at least 5 minutes newer than stored date
		if (value != null && date.getTime() - new Date(value).getTime() < dateMetadataStaleThresholdMs) {
			return;
		}

		return this.provider.config.setConfig(repoPath, `branch.${ref}.${key}`, date.toISOString());
	}
}
