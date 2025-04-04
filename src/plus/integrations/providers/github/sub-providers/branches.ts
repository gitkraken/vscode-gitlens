import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type {
	BranchContributionsOverview,
	GitBranchesSubProvider,
	PagedResult,
	PagingOptions,
} from '../../../../../git/gitProvider';
import { GitBranch } from '../../../../../git/models/branch';
import type { BranchSortOptions } from '../../../../../git/utils/-webview/sorting';
import { sortBranches, sortContributors } from '../../../../../git/utils/-webview/sorting';
import { createRevisionRange } from '../../../../../git/utils/revision.utils';
import { configuration } from '../../../../../system/-webview/configuration';
import { gate } from '../../../../../system/decorators/-webview/gate';
import { log } from '../../../../../system/decorators/log';
import { Logger } from '../../../../../system/logger';
import { getLogScope } from '../../../../../system/logger.scope';
import { HeadType } from '../../../../remotehub';
import type { GitHubGitProviderInternal } from '../githubGitProvider';
import { stripOrigin } from '../githubGitProvider';
import type { GitHubBranch } from '../models';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export class BranchesGitSubProvider implements GitBranchesSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
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
				if (branch != null) return branch;

				try {
					const { metadata } = await this.provider.ensureRepositoryContext(repoPath);

					const revision = await metadata.getRevision();
					switch (revision.type) {
						case HeadType.Tag:
						case HeadType.Commit:
							return new GitBranch(
								this.container,
								repoPath,
								`refs/heads/${revision.name}`,
								true,
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
					Logger.error(ex, getLogScope());
					return undefined;
				}
			}

			branchPromise = load.call(this);
			this.cache.branch?.set(repoPath, branchPromise);
		}

		return branchPromise;
	}

	@log({ args: { 1: false } })
	async getBranches(
		repoPath: string | undefined,
		options?: {
			filter?: (b: GitBranch) => boolean;
			paging?: PagingOptions;
			sort?: boolean | BranchSortOptions;
		},
	): Promise<PagedResult<GitBranch>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getLogScope();

		let branchesPromise = options?.paging?.cursor ? undefined : this.cache.branches?.get(repoPath);
		if (branchesPromise == null) {
			async function load(this: BranchesGitSubProvider): Promise<PagedResult<GitBranch>> {
				try {
					const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath!);

					const branches: GitBranch[] = [];

					function addBranches(container: Container, branch: GitHubBranch, current: boolean) {
						const date = new Date(
							configuration.get('advanced.commitOrdering') === 'author-date'
								? branch.target.authoredDate
								: branch.target.committedDate,
						);
						const ref = branch.target.oid;

						branches.push(
							new GitBranch(
								container,
								repoPath!,
								`refs/heads/${branch.name}`,
								current,
								date,
								ref,
								{
									name: `origin/${branch.name}`,
									missing: false,
									state: { ahead: 0, behind: 0 },
								},
								false,
							),
							new GitBranch(
								container,
								repoPath!,
								`refs/remotes/origin/${branch.name}`,
								false,
								date,
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
							session.accessToken,
							metadata.repo.owner,
							metadata.repo.name,
							{ cursor: cursor },
						);

						for (const branch of result.values) {
							addBranches(this.container, branch, branch.name === currentBranch);
						}

						if (!result.paging?.more || !loadAll) return { ...result, values: branches };

						cursor = result.paging.cursor;
					}
				} catch (ex) {
					Logger.error(ex, scope);
					debugger;

					this.cache.branches?.delete(repoPath!);
					return emptyPagedResult;
				}
			}

			branchesPromise = load.call(this);
			if (options?.paging?.cursor == null) {
				this.cache.branches?.set(repoPath, branchesPromise);
			}
		}

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

	@log()
	async getBranchContributionsOverview(
		repoPath: string,
		ref: string,
	): Promise<BranchContributionsOverview | undefined> {
		const scope = getLogScope();

		try {
			// let baseOrTargetBranch = await this.getBaseBranchName(repoPath, ref);
			// // If the base looks like its remote branch, look for the target or default
			// if (baseOrTargetBranch == null || baseOrTargetBranch.endsWith(`/${ref}`)) {
			// 	baseOrTargetBranch = await this.getTargetBranchName(repoPath, ref);
			// 	baseOrTargetBranch ??= await this.getDefaultBranchName(repoPath);
			// 	if (baseOrTargetBranch == null) return undefined;
			// }

			const baseOrTargetBranch = await this.getDefaultBranchName(repoPath);
			if (baseOrTargetBranch == null) return undefined;

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
		shas: string[],
		branch?: string | undefined,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
	): Promise<string[]> {
		if (repoPath == null || options?.commitDate == null) return [];

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			let branches;

			if (branch) {
				branches = await github.getBranchWithCommit(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
					branch,
					shas.map(stripOrigin),
					options?.mode ?? 'contains',
					options?.commitDate,
				);
			} else {
				branches = await github.getBranchesWithCommits(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
					shas.map(stripOrigin),
					options?.mode ?? 'contains',
					options?.commitDate,
				);
			}

			return branches;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return [];
		}
	}

	@log()
	async getDefaultBranchName(repoPath: string | undefined, _remote?: string): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);
			return await github.getDefaultBranchName(session.accessToken, metadata.repo.owner, metadata.repo.name);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}
}
