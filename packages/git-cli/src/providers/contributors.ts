import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitContributorsStats } from '@gitlens/git/models/contributor.js';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitContributorsResult, GitContributorsSubProvider } from '@gitlens/git/providers/contributors.js';
import { calculateContributionScore } from '@gitlens/git/utils/contributor.utils.js';
import { isUncommittedStaged } from '@gitlens/git/utils/revision.utils.js';
import { isUserMatch } from '@gitlens/git/utils/user.utils.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import type { Mutable } from '@gitlens/utils/types.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git } from '../exec/git.js';
import { gitConfigsLog } from '../exec/git.js';
import { getContributorsLogParser } from '../parsers/logParser.js';
import { parseShortlog } from '../parsers/shortlogParser.js';

export class ContributorsGitSubProvider implements GitContributorsSubProvider {
	constructor(
		private readonly _context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async getContributors(
		repoPath: string,
		rev?: string,
		options?: {
			all?: boolean;
			merges?: boolean | 'first-parent';
			pathspec?: string;
			since?: string;
			stats?: boolean;
		},
		cancellation?: AbortSignal,
		timeout?: number,
	): Promise<GitContributorsResult> {
		if (!repoPath) return { contributors: [] };

		const scope = getScopedLogger();

		const getCore = async (
			commonPath: string,
			cacheable?: CacheController,
			signal?: AbortSignal,
		): Promise<GitContributorsResult> => {
			// Prefer the aggregate signal from the cache; fall back to the caller's cancellation.
			signal ??= cancellation;

			const contributors = new Map<string, Mutable<GitContributor>>();

			try {
				const currentUser = await this.provider.config.getCurrentUser(repoPath);
				if (signal?.aborted) throw new CancellationError();

				const parser = getContributorsLogParser(options?.stats);

				const args = [...parser.arguments, '--use-mailmap'];

				const merges = options?.merges ?? true;
				if (merges) {
					args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
				} else {
					args.push('--no-merges');
				}

				if (options?.all) {
					args.push('--all', '--single-worktree');
				}

				if (options?.since) {
					args.push(`--since="${options.since}"`);
				}

				if (rev && !isUncommittedStaged(rev)) {
					args.push(rev);
				}

				if (options?.pathspec) {
					args.push('--', options.pathspec);
				} else {
					args.push('--');
				}

				const timeoutSignal = timeout ? AbortSignal.timeout(timeout) : undefined;
				const combinedSignal =
					signal && timeoutSignal ? AbortSignal.any([signal, timeoutSignal]) : (signal ?? timeoutSignal);

				const stream = this.git.stream(
					{ cwd: repoPath, cancellation: combinedSignal, configs: gitConfigsLog },
					'log',
					...args,
				);
				using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

				for await (const c of parser.parseAsync(stream)) {
					if (combinedSignal?.aborted) {
						cacheable?.invalidate();
						break;
					}

					const key = `${c.author}|${c.email}`;
					const timestamp = Number(c.date) * 1000;
					const date = new Date(timestamp);

					let contributor: Mutable<GitContributor> | undefined = contributors.get(key);
					if (contributor == null) {
						contributor = new GitContributor(
							commonPath,
							c.author,
							c.email,
							isUserMatch(currentUser, c.author, c.email),
							1,
							[
								{
									sha: c.sha,
									date: date,
									message: c.message,
									files: c.stats?.files,
									additions: c.stats?.additions,
									deletions: c.stats?.deletions,
								},
							],
							date,
							date,
							c.stats
								? { ...c.stats, contributionScore: calculateContributionScore(c.stats, timestamp) }
								: undefined,
						);
						contributors.set(key, contributor);
					} else {
						contributor.contributionCount++;
						if (date > contributor.latestCommitDate!) {
							contributor.latestCommitDate = date;
						}
						if (date < contributor.firstCommitDate!) {
							contributor.firstCommitDate = date;
						}

						contributor.contributions ??= [];
						contributor.contributions.push({
							sha: c.sha,
							date: date,
							message: c.message,
							files: c.stats?.files,
							additions: c.stats?.additions,
							deletions: c.stats?.deletions,
						});

						if (options?.stats && c.stats != null) {
							if (contributor.stats == null) {
								contributor.stats = {
									...c.stats,
									contributionScore: calculateContributionScore(c.stats, timestamp),
								};
							} else {
								contributor.stats = {
									additions: contributor.stats.additions + c.stats.additions,
									deletions: contributor.stats.deletions + c.stats.deletions,
									files: contributor.stats.files + c.stats.files,
									contributionScore:
										contributor.stats.contributionScore +
										calculateContributionScore(c.stats, timestamp),
								};
							}
						}
					}
				}

				return {
					contributors: [...contributors.values()],
					cancelled: timeoutSignal?.aborted
						? { reason: 'timedout' }
						: signal?.aborted
							? { reason: 'cancelled' }
							: undefined,
				};
			} catch (ex) {
				cacheable?.invalidate();
				scope?.error(ex);

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
			cacheKey += `:merges=${String(options.merges)}`;
		}
		if (options?.since) {
			cacheKey += `:since=${options.since}`;
			customCacheTTL = 1000 * 60 * 5; // 5 minutes
		}
		if (options?.stats) {
			cacheKey += ':stats';
		}
		if (timeout) {
			cacheKey += `:timeout=${String(timeout)}`;
			customCacheTTL = timeout * 2;
		}

		return this.cache.getContributors(repoPath, cacheKey, getCore, {
			...(customCacheTTL ? { accessTTL: customCacheTTL } : undefined),
			cancellation: cancellation,
		});
	}

	@debug()
	getContributorsLite(
		repoPath: string,
		rev?: string,
		options?: { all?: boolean; merges?: boolean | 'first-parent'; since?: string },
		cancellation?: AbortSignal,
	): Promise<GitContributor[]> {
		if (!repoPath) return Promise.resolve([]);

		const scope = getScopedLogger();

		if (!rev || isUncommittedStaged(rev)) {
			rev = undefined;
			options = { ...options, all: true };
		}

		const getCore = async (commonPath: string, cacheable?: CacheController, signal?: AbortSignal) => {
			// Prefer the aggregate signal from the cache; fall back to the caller's cancellation.
			signal ??= cancellation;
			try {
				// eventually support `--group=author --group=trailer:co-authored-by`
				const args = ['shortlog', '-s', '-e', '-n'];

				if (options?.all) {
					args.push('--all');
				}
				const merges = options?.merges ?? true;
				if (merges) {
					args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
				} else {
					args.push('--no-merges');
				}
				if (options?.since) {
					args.push(`--since=${options.since}`);
				}
				if (rev) {
					args.push(rev);
				}

				const currentUserPromise = this.provider.config.getCurrentUser(repoPath).catch(() => undefined);
				const result = await this.git.exec({ cwd: repoPath, cancellation: signal }, ...args);
				if (!result.stdout) return [];

				const shortlog = parseShortlog(result.stdout, commonPath, await currentUserPromise);
				return shortlog.contributors;
			} catch (ex) {
				cacheable?.invalidate();
				scope?.error(ex);

				return [];
			}
		};

		let customCacheTTL;

		let cacheKey = `lite${rev ? `:${rev}` : ''}`;
		if (options?.merges) {
			cacheKey += `:merges=${String(options.merges)}`;
		}
		if (options?.since) {
			cacheKey += `:since=${options.since}`;
			customCacheTTL = 1000 * 60 * 5; // 5 minutes
		}

		return this.cache.getContributorsLite(repoPath, cacheKey, getCore, {
			...(customCacheTTL ? { accessTTL: customCacheTTL } : undefined),
			cancellation: cancellation,
		});
	}

	@debug()
	getContributorsStats(
		repoPath: string,
		options?: { merges?: boolean | 'first-parent'; since?: string },
		cancellation?: AbortSignal,
		timeout?: number,
	): Promise<GitContributorsStats | undefined> {
		if (!repoPath) return Promise.resolve(undefined);

		const scope = getScopedLogger();

		const getCore = async (commonPath: string): Promise<GitContributorsStats | undefined> => {
			try {
				const args = ['shortlog', '-s', '--all'];

				const merges = options?.merges ?? true;
				if (merges) {
					args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
				} else {
					args.push('--no-merges');
				}

				if (options?.since) {
					args.push(`--since=${options.since}`);
				}

				const result = await this.git.exec(
					{ cwd: commonPath, cancellation: cancellation, timeout: timeout },
					...args,
				);
				if (!result.stdout) return undefined;

				const contributions = result.stdout
					.split('\n')
					.map(line => parseInt(line.trim().split('\t', 1)[0], 10))
					.filter(c => !isNaN(c))
					.sort((a, b) => b - a);

				return { count: contributions.length, contributions: contributions } satisfies GitContributorsStats;
			} catch (ex) {
				scope?.error(ex);

				return undefined;
			}
		};

		let customCacheTTL;

		let cacheKey = 'stats';
		if (options?.merges) {
			cacheKey += `:merges=${String(options.merges)}`;
		}
		if (options?.since) {
			cacheKey += `:since=${options.since}`;
			customCacheTTL = 1000 * 60 * 5; // 5 minutes
		}
		if (timeout) {
			cacheKey += `:timeout=${String(timeout)}`;
			customCacheTTL = timeout * 2;
		}

		return this.cache.getContributorsStats(
			repoPath,
			cacheKey,
			getCore,
			customCacheTTL ? { accessTTL: customCacheTTL } : undefined,
		);
	}
}
