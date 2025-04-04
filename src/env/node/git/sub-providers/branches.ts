import type { GitConfigKeys } from '../../../../constants';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
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
import { maybeStopWatch } from '../../../../system/stopwatch';
import type { Git } from '../git';
import { GitErrors, gitLogDefaultConfigs } from '../git';
import type { LocalGitProvider } from '../localGitProvider';
import { RunError } from '../shell';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@log()
	async getBranch(repoPath: string, name?: string): Promise<GitBranch | undefined> {
		if (name != null) {
			const {
				values: [branch],
			} = await this.getBranches(repoPath, { filter: b => b.name === name });
			return branch;
		}

		let branchPromise = this.cache.branch?.get(repoPath);
		if (branchPromise == null) {
			async function load(this: BranchesGitSubProvider): Promise<GitBranch | undefined> {
				const {
					values: [branch],
				} = await this.getBranches(repoPath, { filter: b => b.current });
				return branch ?? this.getCurrentBranch(repoPath);
			}

			branchPromise = load.call(this);
			this.cache.branch?.set(repoPath, branchPromise);
		}

		return branchPromise;
	}

	private async getCurrentBranch(repoPath: string): Promise<GitBranch | undefined> {
		const ref = await this.getCurrentBranchReferenceCore(repoPath);
		if (ref == null) return undefined;

		const commitOrdering = configuration.get('advanced.commitOrdering');

		const [pausedOpStatusResult, committerDateResult, defaultWorktreePathResult] = await Promise.allSettled([
			isDetachedHead(ref.name) ? this.provider.status?.getPausedOperationStatus(repoPath) : undefined,
			this.git
				.exec(
					{ cwd: repoPath, configs: gitLogDefaultConfigs, errors: GitErrorHandling.Ignore },
					'log',
					'-n1',
					'--format=%ct',
					commitOrdering ? `--${commitOrdering}-order` : undefined,
					'--',
				)
				.then(data => (!data.length ? undefined : data.trim())),
			this.provider.config.getDefaultWorktreePath?.(repoPath),
		]);

		const committerDate = getSettledValue(committerDateResult);
		const pausedOpStatus = getSettledValue(pausedOpStatusResult);
		const rebaseStatus = pausedOpStatus?.type === 'rebase' ? pausedOpStatus : undefined;
		const defaultWorktreePath = getSettledValue(defaultWorktreePathResult);

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
	): Promise<PagedResult<GitBranch>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getLogScope();

		let resultsPromise = this.cache.branches?.get(repoPath);
		if (resultsPromise == null) {
			async function load(this: BranchesGitSubProvider): Promise<PagedResult<GitBranch>> {
				try {
					const supportsWorktreePath = await this.git.supports('git:for-each-ref:worktreePath');
					const parser = getBranchParser(supportsWorktreePath);

					const data = await this.git.exec(
						{ cwd: repoPath },
						'for-each-ref',
						...parser.arguments,
						'refs/heads/',
						'refs/remotes/',
					);
					// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
					if (!data?.length) {
						const current = await this.getCurrentBranch(repoPath);
						return current != null ? { values: [current] } : emptyPagedResult;
					}

					const defaultWorktreePath = await this.provider.config.getDefaultWorktreePath?.(repoPath);

					using sw = maybeStopWatch(scope, { log: false, logLevel: 'debug' });

					const branches: GitBranch[] = [];

					let hasCurrent = false;

					for (const entry of parser.parse(data)) {
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
								supportsWorktreePath
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
						const current = await this.getCurrentBranch(repoPath);
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
				} catch (_ex) {
					this.cache.branches?.delete(repoPath);

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
	): Promise<BranchContributionsOverview | undefined> {
		const scope = getLogScope();

		try {
			let baseOrTargetBranch = await this.getBaseBranchName(repoPath, ref);
			// If the base looks like its remote branch, look for the target or default
			if (baseOrTargetBranch == null || baseOrTargetBranch.endsWith(`/${ref}`)) {
				baseOrTargetBranch = await this.getTargetBranchName(repoPath, ref);
				baseOrTargetBranch ??= await this.getDefaultBranchName(repoPath);
				if (baseOrTargetBranch == null) return undefined;
			}

			const mergeBase = await this.provider.refs.getMergeBase(repoPath, ref, baseOrTargetBranch);
			if (mergeBase == null) return undefined;

			const contributors = await this.provider.contributors.getContributors(
				repoPath,
				createRevisionRange(mergeBase, ref, '..'),
				{ stats: true },
			);

			sortContributors(contributors, { orderBy: 'score:desc' });

			let totalCommits = 0;
			let totalFiles = 0;
			let totalAdditions = 0;
			let totalDeletions = 0;
			let firstCommitTimestamp;
			let latestCommitTimestamp;

			for (const c of contributors) {
				totalCommits += c.commits;
				totalFiles += c.stats?.files ?? 0;
				totalAdditions += c.stats?.additions ?? 0;
				totalDeletions += c.stats?.deletions ?? 0;

				const firstTimestamp = c.firstCommitDate?.getTime();
				const latestTimestamp = c.latestCommitDate?.getTime();

				if (firstTimestamp != null || latestTimestamp != null) {
					firstCommitTimestamp =
						firstCommitTimestamp != null
							? Math.min(firstCommitTimestamp, firstTimestamp ?? Infinity, latestTimestamp ?? Infinity)
							: firstTimestamp ?? latestTimestamp;

					latestCommitTimestamp =
						latestCommitTimestamp != null
							? Math.max(latestCommitTimestamp, firstTimestamp ?? -Infinity, latestTimestamp ?? -Infinity)
							: latestTimestamp ?? firstTimestamp;
				}
			}

			return {
				repoPath: repoPath,
				branch: ref,
				baseOrTargetBranch: baseOrTargetBranch,
				mergeBase: mergeBase,

				commits: totalCommits,
				files: totalFiles,
				additions: totalAdditions,
				deletions: totalDeletions,

				latestCommitDate: latestCommitTimestamp != null ? new Date(latestCommitTimestamp) : undefined,
				firstCommitDate: firstCommitTimestamp != null ? new Date(firstCommitTimestamp) : undefined,

				contributors: contributors,
			};
		} catch (ex) {
			Logger.error(ex, scope);
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
	): Promise<string[]> {
		if (branch != null) {
			const data = await this.git.branchOrTag__containsOrPointsAt(repoPath, commits, {
				type: 'branch',
				mode: 'contains',
				name: branch,
			});
			return data ? [data?.trim()] : [];
		}

		const data = await this.git.branchOrTag__containsOrPointsAt(repoPath, commits, { type: 'branch', ...options });
		if (!data) return [];

		return filterMap(data.split('\n'), b => b.trim() || undefined);
	}

	@log()
	async getCurrentBranchReference(repoPath: string): Promise<GitBranchReference | undefined> {
		let ref = await this.getCurrentBranchReferenceCore(repoPath);
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

	private async getCurrentBranchReferenceCore(repoPath: string): Promise<GitBranchReference | undefined> {
		const commitOrdering = configuration.get('advanced.commitOrdering');

		const data = await this.git.rev_parse__currentBranch(repoPath, commitOrdering);
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
	async getDefaultBranchName(repoPath: string | undefined, remote?: string): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		remote ??= 'origin';

		const cacheByRemote = this.cache.defaultBranchName?.get(repoPath);
		let promise = cacheByRemote?.get(remote);
		if (promise == null) {
			async function load(this: BranchesGitSubProvider): Promise<string | undefined> {
				return this.git.symbolic_ref__HEAD(repoPath!, remote!);
			}

			promise = load.call(this);

			if (cacheByRemote == null) {
				this.cache.defaultBranchName?.set(repoPath, new Map([[remote, promise]]));
			} else {
				cacheByRemote.set(remote, promise);
			}
		}

		return promise;
	}

	@log()
	async createBranch(repoPath: string, name: string, sha: string): Promise<void> {
		await this.git.exec({ cwd: repoPath }, 'branch', name, sha);
	}

	@log()
	async getBranchMergedStatus(
		repoPath: string,
		branch: GitBranchReference,
		into: GitBranchReference,
	): Promise<GitBranchMergedStatus> {
		if (branch.name === into.name || branch.upstream?.name === into.name) {
			return { merged: false };
		}

		const result = await this.getBranchMergedStatusCore(repoPath, branch, into);
		if (result.merged) return result;

		// If the branch we are checking is a remote branch, check if it has been merged into its local branch (if there is one)
		if (into.remote) {
			const localIntoBranch = await this.getLocalBranchByUpstream(repoPath, into.name);
			// If there is a local branch and it is not the branch we are checking, check if it has been merged into it
			if (localIntoBranch != null && localIntoBranch.name !== branch.name) {
				const result = await this.getBranchMergedStatusCore(repoPath, branch, localIntoBranch);
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
	): Promise<Exclude<GitBranchMergedStatus, 'localBranchOnly'>> {
		const scope = getLogScope();

		try {
			// Check if branch is direct ancestor (handles FF merges)
			try {
				await this.git.exec(
					{ cwd: repoPath, errors: GitErrorHandling.Throw },
					'merge-base',
					'--is-ancestor',
					branch.name,
					into.name,
				);
				return { merged: true, confidence: 'highest' };
			} catch {}

			// Cherry-pick detection (handles cherry-picks, rebases, etc)
			let data = await this.git.exec({ cwd: repoPath }, 'cherry', '--abbrev', '-v', into.name, branch.name);
			// Check if there are no lines or all lines startwith a `-` (i.e. likely merged)
			if (
				!data ||
				data
					.trim()
					.split('\n')
					.every(l => l.startsWith('-'))
			) {
				return { merged: true, confidence: 'high' };
			}

			// Attempt to detect squash merges by checking if the diff of the branch can be cleanly removed from the target
			const mergeBase = await this.provider.refs.getMergeBase(repoPath, into.name, branch.name);
			data = await this.git.exec<string>({ cwd: repoPath }, 'diff', mergeBase, branch.name);
			if (data?.length) {
				// Create a temporary index file
				await using disposableIndex = await this.provider.staging!.createTemporaryIndex(repoPath, into.name);
				const { env } = disposableIndex;

				data = await this.git.exec<string>(
					{ cwd: repoPath, env: env, stdin: data },
					'apply',
					'--cached',
					'--reverse',
					'--check',
					'-',
				);
				if (!data?.trim().length) {
					return { merged: true, confidence: 'medium' };
				}
			}

			return { merged: false };
		} catch (ex) {
			if (Logger.enabled('debug')) {
				Logger.error(ex, scope);
			}
			return { merged: false };
		}
	}

	@log()
	async getLocalBranchByUpstream(repoPath: string, remoteBranchName: string): Promise<GitBranch | undefined> {
		const branches = new PageableResult<GitBranch>(p =>
			this.getBranches(repoPath, p != null ? { paging: p } : undefined),
		);
		return getLocalBranchByUpstream(remoteBranchName, branches);
	}

	@log()
	async getPotentialMergeOrRebaseConflict(
		repoPath: string,
		branch: string,
		targetBranch: string,
	): Promise<MergeConflict | undefined> {
		const scope = getLogScope();

		try {
			// If we have don't have Git v2.33+, just return
			if (!(await this.git.supports('git:merge-tree'))) {
				return undefined;
			}

			let data;
			try {
				data = await this.git.exec(
					{ cwd: repoPath, errors: GitErrorHandling.Throw },
					'merge-tree',
					'-z',
					'--name-only',
					'--no-messages',
					branch,
					targetBranch,
				);
			} catch (ex) {
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
				} else if (ex instanceof RunError) {
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
	async getBaseBranchName(repoPath: string, ref: string): Promise<string | undefined> {
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
							void this.setBaseBranchName(repoPath, ref, branch);
						}
						return branch;
					}
				}
			}
		} catch {}

		const branch = await this.getBaseBranchFromReflog(repoPath, ref, { upstream: true });
		if (branch != null) {
			void this.setBaseBranchName(repoPath, ref, branch);
			return branch;
		}

		return undefined;
	}

	@log()
	async setBaseBranchName(repoPath: string, ref: string, base: string): Promise<void> {
		const mergeBaseConfigKey: GitConfigKeys = `branch.${ref}.gk-merge-base`;

		await this.provider.config.setConfig(repoPath, mergeBaseConfigKey, base);
	}

	private async getBaseBranchFromReflog(
		repoPath: string,
		ref: string,
		options?: { upstream: true },
	): Promise<string | undefined> {
		try {
			let data = await this.git.exec({ cwd: repoPath }, 'reflog', ref, '--grep-reflog=branch: Created from *.');

			let entries = data.split('\n').filter(entry => Boolean(entry));
			if (entries.length !== 1) return undefined;

			// Check if branch created from an explicit branch
			let match = entries[0].match(/branch: Created from (.*)$/);
			if (match != null && match.length === 2) {
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
			data = await this.git.exec(
				{ cwd: repoPath },
				'reflog',
				'HEAD',
				`--grep-reflog=checkout: moving from .* to ${ref.replace('refs/heads/', '')}`,
			);

			entries = data.split('\n').filter(entry => Boolean(entry));
			if (!entries.length) return undefined;

			match = entries[entries.length - 1].match(/checkout: moving from ([^\s]+)\s/);
			if (match != null && match.length === 2) {
				let name: string | undefined = match[1];
				if (options?.upstream) {
					const upstream = await this.provider.refs.getSymbolicReferenceName(repoPath, `${name}@{u}`);
					if (upstream) return upstream;
				}

				name = await this.provider.refs.getSymbolicReferenceName(repoPath, name);
				if (name) return name;
			}
		} catch {}

		return undefined;
	}

	@log({ exit: true })
	async getTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const targetBaseConfigKey: GitConfigKeys = `branch.${ref}.gk-target-base`;

		let target = await this.provider.config.getConfig(repoPath, targetBaseConfigKey);
		if (target != null) {
			target = await this.provider.refs.getSymbolicReferenceName(repoPath, target);
		}
		return target?.trim() || undefined;
	}

	@log()
	async setTargetBranchName(repoPath: string, ref: string, target: string): Promise<void> {
		const targetBaseConfigKey: GitConfigKeys = `branch.${ref}.gk-target-base`;

		await this.provider.config.setConfig(repoPath, targetBaseConfigKey, target);
	}

	@log()
	async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
		await this.git.exec({ cwd: repoPath }, 'branch', '-m', oldName, newName);
	}
}
