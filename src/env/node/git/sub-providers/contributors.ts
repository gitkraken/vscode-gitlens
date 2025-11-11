import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container';
import { CancellationError, isCancellationError } from '../../../../errors';
import type { GitCache } from '../../../../git/cache';
import type { GitContributorsResult, GitContributorsSubProvider } from '../../../../git/gitProvider';
import type { GitContributorsStats } from '../../../../git/models/contributor';
import { GitContributor } from '../../../../git/models/contributor';
import { getContributorsLogParser } from '../../../../git/parsers/logParser';
import { parseShortlog } from '../../../../git/parsers/shortlogParser';
import { calculateContributionScore } from '../../../../git/utils/contributor.utils';
import { isUncommittedStaged } from '../../../../git/utils/revision.utils';
import { isUserMatch } from '../../../../git/utils/user.utils';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { normalizePath } from '../../../../system/path';
import type { Cancellable } from '../../../../system/promiseCache';
import { PromiseCache } from '../../../../system/promiseCache';
import { createDisposable } from '../../../../system/unifiedDisposable';
import type { Git } from '../git';
import { gitConfigsLog } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class ContributorsGitSubProvider implements GitContributorsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
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
		timeout?: number,
	): Promise<GitContributorsResult> {
		if (repoPath == null) return { contributors: [] };

		const scope = getLogScope();

		const getCore = async (cancellable?: Cancellable): Promise<GitContributorsResult> => {
			const contributors = new Map<string, GitContributor>();

			try {
				repoPath = normalizePath(repoPath);

				const currentUser = await this.provider.config.getCurrentUser(repoPath);
				if (cancellation?.isCancellationRequested) throw new CancellationError();

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

				const signal = timeout ? AbortSignal.timeout(timeout) : undefined;

				const stream = this.git.stream(
					{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog, signal: signal },
					'log',
					...args,
				);
				using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

				for await (const c of parser.parseAsync(stream)) {
					if (signal?.aborted || cancellation?.isCancellationRequested) {
						cancellable?.cancelled();
						break;
					}

					const key = `${c.author}|${c.email}`;
					const timestamp = Number(c.date) * 1000;

					let contributor: Mutable<GitContributor> | undefined = contributors.get(key);
					if (contributor == null) {
						contributor = new GitContributor(
							repoPath,
							c.author,
							c.email,
							isUserMatch(currentUser, c.author, c.email),
							1,
							[
								{
									sha: c.sha,
									date: new Date(timestamp),
									message: c.message,
									files: c.stats?.files,
									additions: c.stats?.additions,
									deletions: c.stats?.deletions,
								},
							],
							new Date(timestamp),
							new Date(timestamp),
							c.stats
								? { ...c.stats, contributionScore: calculateContributionScore(c.stats, timestamp) }
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
					cancelled: signal?.aborted
						? { reason: 'timedout' }
						: cancellation?.isCancellationRequested
							? { reason: 'cancelled' }
							: undefined,
				};
			} catch (ex) {
				cancellable?.cancelled();
				Logger.error(ex, scope);
				debugger;

				if (!isCancellationError(ex)) return { contributors: [] };
				return { contributors: [...contributors.values()], cancelled: { reason: 'cancelled' } };
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
		if (timeout) {
			cacheKey += `:timeout=${timeout}`;
			customCacheTTL = timeout * 2;
		}

		let contributorsCache = cache.get(repoPath);
		if (contributorsCache == null) {
			cache.set(
				repoPath,
				(contributorsCache = new PromiseCache<string, GitContributorsResult>({
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
	async getContributorsLite(
		repoPath: string,
		rev?: string | undefined,
		options?: { all?: boolean; merges?: boolean | 'first-parent'; since?: string },
		cancellation?: CancellationToken,
	): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		const scope = getLogScope();

		if (!rev || isUncommittedStaged(rev)) {
			rev = undefined;
			options = { ...options, all: true };
		}

		const getCore = async (cancellable?: Cancellable) => {
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
				const result = await this.git.exec({ cwd: repoPath, cancellation: cancellation }, ...args);
				if (!result.stdout) return [];

				const shortlog = parseShortlog(result.stdout, repoPath, await currentUserPromise);
				return shortlog.contributors;
			} catch (ex) {
				cancellable?.cancelled();
				Logger.error(ex, scope);
				debugger;

				return [];
			}
		};

		const cache = this.cache.contributorsLite;
		if (cache == null) return getCore();

		let customCacheTTL;

		let cacheKey = `lite${rev ? `:${rev}` : ''}`;
		if (options?.merges) {
			cacheKey += `:merges=${options.merges}`;
		}
		if (options?.since) {
			cacheKey += `:since=${options.since}`;
			customCacheTTL = 1000 * 60 * 5; // 5 minutes
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
		options?: { merges?: boolean | 'first-parent'; since?: string },
		cancellation?: CancellationToken,
		timeout?: number,
	): Promise<GitContributorsStats | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

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
				{ cwd: repoPath, cancellation: cancellation, timeout: timeout },
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
			Logger.error(ex, scope);
			debugger;

			return undefined;
		}
	}
}
