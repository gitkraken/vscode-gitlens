import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type { GitContributorsSubProvider } from '../../../../../git/gitProvider';
import type { GitCommit } from '../../../../../git/models/commit';
import type { GitContributorsStats } from '../../../../../git/models/contributor';
import { GitContributor } from '../../../../../git/models/contributor';
import { getChangedFilesCount } from '../../../../../git/utils/commit.utils';
import { calculateContributionScore } from '../../../../../git/utils/contributor.utils';
import { isUserMatch } from '../../../../../git/utils/user.utils';
import { log } from '../../../../../system/decorators/log';
import { Logger } from '../../../../../system/logger';
import { getLogScope } from '../../../../../system/logger.scope';
import type { Cancellable } from '../../../../../system/promiseCache';
import { PromiseCache } from '../../../../../system/promiseCache';
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
	): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		const scope = getLogScope();

		const getCore = async (cancellable?: Cancellable) => {
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
									isCurrentUser ? currentUser?.name ?? c.author.name : c.author.name,
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

						return [...contributors.values()];
					}
				}

				const results = await github.getContributors(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
				);

				const contributors = [];
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
				cancellable?.cancel();
				Logger.error(ex, scope);
				debugger;

				return [];
			}
		};

		const cache = this.cache.contributors;
		if (cache == null) return getCore();

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

		let contributorsCache = cache.get(repoPath);
		if (contributorsCache == null) {
			cache.set(
				repoPath,
				(contributorsCache = new PromiseCache<string, GitContributor[]>({
					accessTTL: 1000 * 60 * 60 /* 60 minutes */,
				})),
			);
		}

		const contributors = contributorsCache.get(
			cacheKey,
			getCore,
			customCacheTTL ? { accessTTL: customCacheTTL } : undefined,
		);
		return contributors;
	}

	@log()
	async getContributorsStats(
		repoPath: string,
		_options?: { merges?: boolean | 'first-parent'; since?: string; timeout?: number },
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
