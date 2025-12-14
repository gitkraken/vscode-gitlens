import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../../container';
import { isCancellationError } from '../../../../../errors';
import type { GitCache } from '../../../../../git/cache';
import type { GitContributorsResult, GitContributorsSubProvider } from '../../../../../git/gitProvider';
import type { GitCommit } from '../../../../../git/models/commit';
import type { GitContributorsStats } from '../../../../../git/models/contributor';
import { GitContributor } from '../../../../../git/models/contributor';
import { getChangedFilesCount } from '../../../../../git/utils/commit.utils';
import { calculateContributionScore } from '../../../../../git/utils/contributor.utils';
import { isUserMatch } from '../../../../../git/utils/user.utils';
import { log } from '../../../../../system/decorators/log';
import { Logger } from '../../../../../system/logger';
import { getLogScope } from '../../../../../system/logger.scope';
import type { CacheController } from '../../../../../system/promiseCache';
import type { GitHubGitProviderInternal } from '../githubGitProvider';

export class ContributorsGitSubProvider implements GitContributorsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@log()
	async getContributors(
		repoPath: string,
		rev?: string | undefined,
		options?: {
			all?: boolean;
			merges?: boolean | 'first-parent';
			pathspec?: string;
			since?: string;
			stats?: boolean;
		},
		cancellation?: CancellationToken,
		_timeout?: number,
	): Promise<GitContributorsResult> {
		if (repoPath == null) return { contributors: [] };

		const scope = getLogScope();

		const getCore = async (cacheable?: CacheController): Promise<GitContributorsResult> => {
			const contributors: GitContributor[] = [];

			try {
				const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

				const currentUser = await this.provider.config.getCurrentUser(repoPath);

				if (options?.stats) {
					function aggregateContributors(
						commits: Iterable<GitCommit>,
						contributors: Map<string, GitContributor>,
					) {
						for (const c of commits) {
							const key = `${c.author.name}|${c.author.email}`;
							const timestamp = c.date.getTime();

							let contributor: Mutable<GitContributor> | undefined = contributors.get(key);
							if (contributor == null) {
								const isCurrentUser =
									c.author.name === 'You' || isUserMatch(currentUser, c.author.name, c.author.email);
								contributor = new GitContributor(
									repoPath,
									isCurrentUser ? (currentUser?.name ?? c.author.name) : c.author.name,
									c.author.email,
									isCurrentUser,
									1,
									[
										{
											sha: c.sha,
											date: c.date,
											message: c.message ?? c.summary,
											files: getChangedFilesCount(c.stats?.files),
											additions: c.stats?.additions,
											deletions: c.stats?.deletions,
										},
									],
									c.date,
									c.date,
									c.stats
										? {
												...c.stats,
												files: getChangedFilesCount(c.stats?.files),
												contributionScore: calculateContributionScore(c.stats, timestamp),
											}
										: undefined,
								);
								contributors.set(key, contributor);
							} else {
								contributor.contributionCount++;
								const date = new Date(timestamp);
								if (date > contributor.latestCommitDate!) {
									contributor.latestCommitDate = date;
								}
								if (date < contributor.firstCommitDate!) {
									contributor.firstCommitDate = date;
								}

								contributor.contributions ??= [];
								contributor.contributions.push({
									sha: c.sha,
									date: new Date(timestamp),
									message: c.message ?? c.summary,
									files: getChangedFilesCount(c.stats?.files),
									additions: c.stats?.additions,
									deletions: c.stats?.deletions,
								});

								if (options?.stats && c.stats != null) {
									if (contributor.stats == null) {
										contributor.stats = {
											...c.stats,
											files: getChangedFilesCount(c.stats?.files),
											contributionScore: calculateContributionScore(c.stats, timestamp),
										};
									} else {
										contributor.stats = {
											additions: contributor.stats.additions + c.stats.additions,
											deletions: contributor.stats.deletions + c.stats.deletions,
											files: contributor.stats.files + getChangedFilesCount(c.stats?.files),
											contributionScore:
												contributor.stats.contributionScore +
												calculateContributionScore(c.stats, timestamp),
										};
									}
								}
							}
						}
					}

					let log;
					if (options?.pathspec) {
						log = await this.provider.commits.getLogForPath(repoPath, options.pathspec, rev, {
							all: options?.all,
							since: options?.since,
						});
					} else {
						log = await this.provider.commits.getLog(repoPath, rev, {
							all: options?.all,
							merges: options?.merges,
							since: options?.since,
						});
					}

					if (log != null) {
						const contributors = new Map<string, GitContributor>();

						aggregateContributors(log.commits.values(), contributors);

						while (log.hasMore) {
							log = await log.more?.(undefined);
							if (log == null) break;

							aggregateContributors(log.pagedCommits?.().values() ?? [], contributors);
						}

						return {
							contributors: [...contributors.values()],
							cancelled: cancellation?.isCancellationRequested ? { reason: 'cancelled' } : undefined,
						};
					}
				}

				const results = await github.getContributors(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
				);

				for (const c of results) {
					if (c.type !== 'User') continue;

					contributors.push(
						new GitContributor(
							repoPath,
							c.name ?? c.login ?? '',
							c.email,
							isUserMatch(currentUser, c.name, c.email, c.login),
							c.contributions,
							undefined,
							undefined,
							undefined,
							undefined,
							c.login,
							c.avatar_url,
							c.node_id,
						),
					);
				}

				return {
					contributors: contributors,
					cancelled: cancellation?.isCancellationRequested ? { reason: 'cancelled' } : undefined,
				};
			} catch (ex) {
				cacheable?.invalidate();
				Logger.error(ex, scope);
				debugger;

				if (!isCancellationError(ex)) return { contributors: [] };
				return { contributors: [...contributors.values()], cancelled: { reason: 'cancelled' } };
			}
		};

		let customCacheTTL;

		let cacheKey = rev ?? '';
		if (options?.all) {
			cacheKey += ':all';
		}
		if (options?.pathspec) {
			cacheKey += `:pathspec=${options.pathspec}`;
			customCacheTTL = 1000 * 60 * 5; // 5 minutes
		}
		if (options?.merges) {
			cacheKey += `:merges=${options.merges}`;
		}
		if (options?.since) {
			cacheKey += `:since=${options.since}`;
			customCacheTTL = 1000 * 60 * 5; // 5 minutes
		}
		if (options?.stats) {
			cacheKey += ':stats';
		}

		return this.cache.contributors.getOrCreate(
			repoPath,
			cacheKey,
			getCore,
			customCacheTTL ? { accessTTL: customCacheTTL } : undefined,
		);
	}

	@log()
	async getContributorsLite(
		repoPath: string,
		_rev?: string | undefined,
		_options?: { all?: boolean; merges?: boolean | 'first-parent'; since?: string },
		_cancellation?: CancellationToken,
	): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);
			const currentUser = await this.provider.config.getCurrentUser(repoPath);

			const results = await github.getContributors(session.accessToken, metadata.repo.owner, metadata.repo.name);

			const contributors: GitContributor[] = [];
			for (const c of results) {
				if (c.type !== 'User') continue;

				contributors.push(
					new GitContributor(
						repoPath,
						c.name ?? c.login ?? '',
						c.email,
						isUserMatch(currentUser, c.name, c.email, c.login),
						c.contributions,
						undefined,
						undefined,
						undefined,
						undefined,
						c.login,
						c.avatar_url,
						c.node_id,
					),
				);
			}
			return contributors;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return [];
		}
	}

	@log()
	async getContributorsStats(
		repoPath: string,
		_options?: { merges?: boolean | 'first-parent'; since?: string },
		_cancellation?: CancellationToken,
		_timeout?: number,
	): Promise<GitContributorsStats | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const results = await github.getContributors(session.accessToken, metadata.repo.owner, metadata.repo.name);

			const contributions = results.map(c => c.contributions).sort((a, b) => b - a);

			const result: GitContributorsStats = {
				count: contributions.length,
				contributions: contributions,
			};
			return result;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}
}
