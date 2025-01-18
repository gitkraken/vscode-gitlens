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
import { getLocalBranchByUpstream, isDetachedHead } from '../../../../git/models/branch.utils';
import type { MergeConflict } from '../../../../git/models/mergeConflict';
import type { GitBranchReference } from '../../../../git/models/reference';
import { createRevisionRange } from '../../../../git/models/revision.utils';
import { parseGitBranches } from '../../../../git/parsers/branchParser';
import { parseMergeTreeConflict } from '../../../../git/parsers/mergeTreeParser';
import type { BranchSortOptions } from '../../../../git/utils/vscode/sorting';
import { sortBranches, sortContributors } from '../../../../git/utils/vscode/sorting';
import { filterMap } from '../../../../system/array';
import { gate } from '../../../../system/decorators/gate';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { PageableResult } from '../../../../system/paging';
import { getSettledValue } from '../../../../system/promise';
import { configuration } from '../../../../system/vscode/configuration';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@gate()
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
		const commitOrdering = configuration.get('advanced.commitOrdering');

		const data = await this.git.rev_parse__currentBranch(repoPath, commitOrdering);
		if (data == null) return undefined;

		const [name, upstream] = data[0].split('\n');

		const [pausedOpStatusResult, committerDateResult] = await Promise.allSettled([
			isDetachedHead(name) ? this.provider.status?.getPausedOperationStatus(repoPath) : undefined,
			this.git.log__recent_committerdate(repoPath, commitOrdering),
		]);

		const committerDate = getSettledValue(committerDateResult);
		const pausedOpStatus = getSettledValue(pausedOpStatusResult);
		const rebaseStatus = pausedOpStatus?.type === 'rebase' ? pausedOpStatus : undefined;

		return new GitBranch(
			this.container,
			repoPath,
			rebaseStatus?.incoming.name ?? name,
			false,
			true,
			committerDate != null ? new Date(Number(committerDate) * 1000) : undefined,
			data[1],
			upstream ? { name: upstream, missing: false } : undefined,
			undefined,
			undefined,
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

		let resultsPromise = this.cache.branches?.get(repoPath);
		if (resultsPromise == null) {
			async function load(this: BranchesGitSubProvider): Promise<PagedResult<GitBranch>> {
				try {
					const data = await this.git.for_each_ref__branch(repoPath, { all: true });
					// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
					if (!data?.length) {
						const current = await this.getCurrentBranch(repoPath);
						return current != null ? { values: [current] } : emptyPagedResult;
					}

					const branches = parseGitBranches(this.container, data, repoPath);
					if (!branches.length) return emptyPagedResult;

					// If we don't have a current branch, check if we can find it another way (likely detached head)
					if (!branches.some(b => b.current)) {
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

			const mergeBase = await this.getMergeBase(repoPath, ref, baseOrTargetBranch);
			if (mergeBase == null) return undefined;

			const contributors = await this.provider.contributors.getContributors(repoPath, {
				ref: createRevisionRange(mergeBase, ref, '..'),
				stats: true,
			});

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
	async getBranchesForCommit(
		repoPath: string,
		refs: string[],
		branch?: string | undefined,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
	): Promise<string[]> {
		if (branch != null) {
			const data = await this.git.branchOrTag__containsOrPointsAt(repoPath, refs, {
				type: 'branch',
				mode: 'contains',
				name: branch,
			});
			return data ? [data?.trim()] : [];
		}

		const data = await this.git.branchOrTag__containsOrPointsAt(repoPath, refs, { type: 'branch', ...options });
		if (!data) return [];

		return filterMap(data.split('\n'), b => b.trim() || undefined);
	}

	@log({ exit: true })
	async getDefaultBranchName(repoPath: string | undefined, remote?: string): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		if (remote) {
			try {
				const data = await this.git.ls_remote__HEAD(repoPath, remote);
				if (data == null) return undefined;

				const match = /ref:\s(\S+)\s+HEAD/m.exec(data);
				if (match == null) return undefined;

				const [, branch] = match;
				return `${remote}/${branch.substring('refs/heads/'.length)}`;
			} catch {}
		}

		try {
			const data = await this.git.symbolic_ref(repoPath, `refs/remotes/origin/HEAD`);
			return data?.trim() || undefined;
		} catch {}

		return undefined;
	}

	@log()
	async getMergeBase(repoPath: string, ref1: string, ref2: string, options?: { forkPoint?: boolean }) {
		const scope = getLogScope();

		try {
			const data = await this.git.merge_base(repoPath, ref1, ref2, options);
			if (data == null) return undefined;

			return data.split('\n')[0].trim() || undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@log()
	async createBranch(repoPath: string, name: string, ref: string): Promise<void> {
		await this.git.branch(repoPath, name, ref);
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
						localBranchOnly: { name: localIntoBranch.name },
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
			const data = await this.git.exec<string>(
				{ cwd: repoPath },
				'cherry',
				'--abbrev',
				'-v',
				into.name,
				branch.name,
			);
			// Check if there are no lines or all lines startwith a `-` (i.e. likely merged)
			if (!data || data.split('\n').every(l => l.startsWith('-'))) {
				return { merged: true, confidence: 'high' };
			}

			return { merged: false };
		} catch (ex) {
			Logger.error(ex, scope);
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
			if (!(await this.git.isAtLeastVersion('2.33'))) {
				return undefined;
			}

			let data;
			try {
				data = await this.git.merge_tree(repoPath, branch, targetBranch, '-z', '--name-only', '--no-messages');
			} catch (ex) {
				Logger.error(ex, scope);
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
					const branch = await this.getValidatedBranchName(repoPath, mergeBase);
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

		await this.provider.setConfig(repoPath, mergeBaseConfigKey, base);
	}

	private async getBaseBranchFromReflog(
		repoPath: string,
		ref: string,
		options?: { upstream: true },
	): Promise<string | undefined> {
		try {
			let data = await this.git.reflog(repoPath, undefined, ref, '--grep-reflog=branch: Created from *.');

			let entries = data.split('\n').filter(entry => Boolean(entry));
			if (entries.length !== 1) return undefined;

			// Check if branch created from an explicit branch
			let match = entries[0].match(/branch: Created from (.*)$/);
			if (match != null && match.length === 2) {
				let name: string | undefined = match[1];
				if (name !== 'HEAD') {
					if (options?.upstream) {
						const upstream = await this.getValidatedBranchName(repoPath, `${name}@{u}`);
						if (upstream) return upstream;
					}

					name = await this.getValidatedBranchName(repoPath, name);
					if (name) return name;
				}
			}

			// Check if branch was created from HEAD
			data = await this.git.reflog(
				repoPath,
				undefined,
				'HEAD',
				`--grep-reflog=checkout: moving from .* to ${ref.replace('refs/heads/', '')}`,
			);
			entries = data.split('\n').filter(entry => Boolean(entry));
			if (!entries.length) return undefined;

			match = entries[entries.length - 1].match(/checkout: moving from ([^\s]+)\s/);
			if (match != null && match.length === 2) {
				let name: string | undefined = match[1];
				if (options?.upstream) {
					const upstream = await this.getValidatedBranchName(repoPath, `${name}@{u}`);
					if (upstream) return upstream;
				}

				name = await this.getValidatedBranchName(repoPath, name);
				if (name) return name;
			}
		} catch {}

		return undefined;
	}

	@log({ exit: true })
	async getTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const targetBaseConfigKey: GitConfigKeys = `branch.${ref}.gk-target-base`;

		let target = await this.provider.getConfig(repoPath, targetBaseConfigKey);
		if (target != null) {
			target = await this.getValidatedBranchName(repoPath, target);
		}
		return target?.trim() || undefined;
	}

	@log()
	async setTargetBranchName(repoPath: string, ref: string, target: string): Promise<void> {
		const targetBaseConfigKey: GitConfigKeys = `branch.${ref}.gk-target-base`;

		await this.provider.setConfig(repoPath, targetBaseConfigKey, target);
	}

	@log()
	async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
		await this.git.branch(repoPath, '-m', oldName, newName);
	}

	private async getValidatedBranchName(repoPath: string, name: string): Promise<string | undefined> {
		const data = await this.git.exec<string>(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore },
			'rev-parse',
			'--verify',
			'--quiet',
			'--symbolic-full-name',
			'--abbrev-ref',
			name,
		);
		return data?.trim() || undefined;
	}
}
