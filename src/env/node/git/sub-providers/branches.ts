import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container';
import { CancellationError, isCancellationError } from '../../../../errors';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import { BranchError } from '../../../../git/errors';
import type {
	BranchContributionsOverview,
	GitBranchesSubProvider,
	GitBranchMergedStatus,
	PagedResult,
	PagingOptions,
} from '../../../../git/gitProvider';
import { GitBranch } from '../../../../git/models/branch';
import type { MergeConflict } from '../../../../git/models/mergeConflict';
import type { GitBranchReference } from '../../../../git/models/reference';
import { parseMergeTreeConflict } from '../../../../git/parsers/mergeTreeParser';
import { getBranchParser } from '../../../../git/parsers/refParser';
import { getBranchMergeTargetName } from '../../../../git/utils/-webview/branch.utils';
import { getReferenceFromBranch } from '../../../../git/utils/-webview/reference.utils';
import type { BranchSortOptions } from '../../../../git/utils/-webview/sorting';
import { sortBranches, sortContributors } from '../../../../git/utils/-webview/sorting';
import {
	formatDetachedHeadName,
	getBranchId,
	getLocalBranchByUpstream,
	isDetachedHead,
	isRemoteHEAD,
	parseUpstream,
} from '../../../../git/utils/branch.utils';
import { createReference } from '../../../../git/utils/reference.utils';
import { createRevisionRange } from '../../../../git/utils/revision.utils';
import { configuration } from '../../../../system/-webview/configuration';
import { filterMap } from '../../../../system/array';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { PageableResult } from '../../../../system/paging';
import { normalizePath } from '../../../../system/path';
import { getSettledValue } from '../../../../system/promise';
import { PromiseMap } from '../../../../system/promiseCache';
import { maybeStopWatch } from '../../../../system/stopwatch';
import type { Git } from '../git';
import { gitConfigsLog, GitError, GitErrors } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@log()
	async getBranch(repoPath: string, name?: string, cancellation?: CancellationToken): Promise<GitBranch | undefined> {
		if (name != null) {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.name === name }, cancellation);
			return branch;
		}

		const branchPromise = this.cache.branch?.getOrCreate(repoPath, async () => {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.current }, cancellation);
			return branch ?? this.getCurrentBranch(repoPath, cancellation);
		});

		if (branchPromise == null) {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.current }, cancellation);
			return branch ?? this.getCurrentBranch(repoPath, cancellation);
		}

		return branchPromise;
	}

	private async getCurrentBranch(repoPath: string, cancellation?: CancellationToken): Promise<GitBranch | undefined> {
		const ref = await this.getCurrentBranchReferenceCore(repoPath, cancellation);
		if (ref == null) return undefined;

		const commitOrdering = configuration.get('advanced.commitOrdering');

		const [pausedOpStatusResult, committerDateResult, defaultWorktreePathResult] = await Promise.allSettled([
			isDetachedHead(ref.name)
				? this.provider.pausedOps.getPausedOperationStatus(repoPath, cancellation)
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
		]);

		const committerDate = getSettledValue(committerDateResult);
		const pausedOpStatus = getSettledValue(pausedOpStatusResult);
		const rebaseStatus = pausedOpStatus?.type === 'rebase' ? pausedOpStatus : undefined;
		const defaultWorktreePath = getSettledValue(defaultWorktreePathResult);

		if (cancellation?.isCancellationRequested) throw new CancellationError();

		return new GitBranch(
			this.container,
			repoPath,
			rebaseStatus?.incoming.name ?? `refs/heads/${ref.name}`,
			true,
			committerDate != null ? new Date(Number(committerDate) * 1000) : undefined,
			ref.sha,
			ref.upstream ? { ...ref.upstream, state: { ahead: 0, behind: 0 } } : undefined,
			{ path: repoPath, isDefault: repoPath === defaultWorktreePath },
			undefined,
			rebaseStatus != null,
		);
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

		let resultsPromise = this.cache.branches?.get(repoPath);
		if (resultsPromise == null) {
			async function load(this: BranchesGitSubProvider): Promise<PagedResult<GitBranch>> {
				try {
					const supported = await this.git.supported('git:for-each-ref');
					const parser = getBranchParser(supported);

					const result = await this.git.exec(
						{ cwd: repoPath, cancellation: cancellation },
						'for-each-ref',
						...parser.arguments,
						'refs/heads/',
						'refs/remotes/',
					);
					// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
					if (!result.stdout) {
						const current = await this.getCurrentBranch(repoPath, cancellation);
						return current != null ? { values: [current] } : emptyPagedResult;
					}

					const defaultWorktreePath = await this.provider.config.getDefaultWorktreePath?.(repoPath);

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

						const worktreePath = entry.worktreePath ? normalizePath(entry.worktreePath) : undefined;

						branches.push(
							new GitBranch(
								this.container,
								repoPath,
								entry.name,
								current,
								entry.date ? new Date(entry.date) : undefined,
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
						const current = await this.getCurrentBranch(repoPath, cancellation);
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
					this.cache.branches?.delete(repoPath);
					if (isCancellationError(ex)) throw ex;

					return emptyPagedResult;
				}
			}

			resultsPromise = load.call(this);

			if (options?.paging?.cursor == null) {
				this.cache.branches?.set(repoPath, resultsPromise);
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

		let cacheByRemote = this.cache.defaultBranchName?.get(repoPath);
		if (cacheByRemote == null) {
			cacheByRemote = new PromiseMap<string, string | undefined>();
			this.cache.defaultBranchName?.set(repoPath, cacheByRemote);
		}

		const promise = cacheByRemote.getOrCreate(remote, async () => {
			return this.git.symbolic_ref__HEAD(repoPath, remote, cancellation);
		});

		return promise;
	}

	@log()
	async createBranch(repoPath: string, name: string, sha: string, options?: { noTracking?: boolean }): Promise<void> {
		try {
			const args = options?.noTracking ? ['--no-track'] : [];
			await this.git.branch(repoPath, name, sha, ...args);
		} catch (ex) {
			if (ex instanceof BranchError) {
				throw ex.update({ branch: name, action: 'create' });
			}

			throw ex;
		}
	}

	@log()
	async deleteLocalBranch(repoPath: string, name: string, options?: { force?: boolean }): Promise<void> {
		try {
			await this.git.branch(repoPath, options?.force ? '-D' : '-d', name);
		} catch (ex) {
			if (ex instanceof BranchError) {
				throw ex.update({ branch: name, action: 'delete' });
			}

			throw ex;
		}
	}

	@log()
	async deleteRemoteBranch(repoPath: string, name: string, remote: string): Promise<void> {
		try {
			await this.git.exec({ cwd: repoPath }, 'push', '-d', remote, name);
		} catch (ex) {
			if (ex instanceof BranchError) {
				throw ex.update({ branch: name, action: 'delete' });
			}

			throw ex;
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
				await using disposableIndex = await this.provider.staging!.createTemporaryIndex(repoPath, into.name);
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

	@log()
	async getPotentialMergeOrRebaseConflict(
		repoPath: string,
		branch: string,
		targetBranch: string,
		cancellation?: CancellationToken,
	): Promise<MergeConflict | undefined> {
		const scope = getLogScope();

		try {
			// If we have don't have Git v2.33+, just return
			if (!(await this.git.supports('git:merge-tree'))) {
				return undefined;
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
				} else if (GitErrors.badRevision.test(msg)) {
					Logger.error(ex, scope, `Invalid branch name: ${msg.slice(msg.indexOf("'"))}`);
				} else if (GitErrors.noMergeBase.test(msg)) {
					Logger.error(
						ex,
						scope,
						`Unable to merge '${branch}' and '${targetBranch}' as they have no common ancestor`,
					);
				} else if (ex instanceof GitError) {
					data = ex.stdout;
				} else {
					Logger.error(ex, scope);
					debugger;
				}
			}
			if (!data) return undefined;

			const mergeConflict = parseMergeTreeConflict(data);
			if (!mergeConflict.conflicts.length) return undefined;

			return {
				repoPath: repoPath,
				branch: branch,
				target: targetBranch,
				files: mergeConflict.conflicts,
			};
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
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

	@log()
	async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
		try {
			await this.git.branch(repoPath, '-m', oldName, newName);
		} catch (ex) {
			if (ex instanceof BranchError) {
				throw ex.update({ branch: oldName, action: 'rename' });
			}

			throw ex;
		}
	}

	@log()
	async setUpstreamBranch(repoPath: string, name: string, upstream: string | undefined): Promise<void> {
		try {
			if (upstream == null) {
				await this.git.branch(repoPath, '--unset-upstream', name);
			} else {
				await this.git.branch(repoPath, '--set-upstream-to', upstream, name);
			}
		} catch (ex) {
			if (ex instanceof BranchError) {
				throw ex.update({ branch: name, action: 'set-upstream' });
			}

			throw ex;
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
}
