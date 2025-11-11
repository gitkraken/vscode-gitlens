import type { CancellationToken, Range, Uri } from 'vscode';
import type { SearchQuery } from '../../../../constants.search';
import type { Source } from '../../../../constants.telemetry';
import type { Container } from '../../../../container';
import { CancellationError, isCancellationError } from '../../../../errors';
import type { GitCache } from '../../../../git/cache';
import type { GitCommandOptions } from '../../../../git/commandOptions';
import { GitErrorHandling } from '../../../../git/commandOptions';
import type {
	GitCommitReachability,
	GitCommitsSubProvider,
	GitLogForPathOptions,
	GitLogOptions,
	GitLogShasOptions,
	GitSearchCommitsOptions,
	IncomingActivityOptions,
	LeftRightCommitCountResult,
	SearchCommitsResult,
} from '../../../../git/gitProvider';
import { GitUri } from '../../../../git/gitUri';
import type { GitBlame } from '../../../../git/models/blame';
import type { GitCommitFileset, GitStashCommit } from '../../../../git/models/commit';
import { GitCommit, GitCommitIdentity } from '../../../../git/models/commit';
import type { GitDiffFilter, ParsedGitDiffHunks } from '../../../../git/models/diff';
import { GitFileChange } from '../../../../git/models/fileChange';
import type { GitFileStatus } from '../../../../git/models/fileStatus';
import type { GitLog } from '../../../../git/models/log';
import type { GitReflog } from '../../../../git/models/reflog';
import type { GitRevisionRange } from '../../../../git/models/revision';
import type { GitUser } from '../../../../git/models/user';
import type {
	CommitsInFileRangeLogParser,
	CommitsLogParser,
	CommitsWithFilesLogParser,
	ParsedCommit,
	ParsedStash,
} from '../../../../git/parsers/logParser';
import {
	getCommitsLogParser,
	getShaAndFilesAndStatsLogParser,
	getShaLogParser,
} from '../../../../git/parsers/logParser';
import { parseGitRefLog, parseGitRefLogDefaultFormat } from '../../../../git/parsers/reflogParser';
import type { SearchQueryFilters } from '../../../../git/search';
import { parseSearchQueryGitCommand } from '../../../../git/search';
import { processNaturalLanguageToSearchQuery } from '../../../../git/search.naturalLanguage';
import { createUncommittedChangesCommit } from '../../../../git/utils/-webview/commit.utils';
import { isRevisionRange, isSha, isUncommitted, isUncommittedStaged } from '../../../../git/utils/revision.utils';
import { isUserMatch } from '../../../../git/utils/user.utils';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { debug, log } from '../../../../system/decorators/log';
import { filterMap, first, join, last, some } from '../../../../system/iterable';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { isFolderGlob, stripFolderGlob } from '../../../../system/path';
import { wait } from '../../../../system/promise';
import type { Cancellable } from '../../../../system/promiseCache';
import { PromiseCache } from '../../../../system/promiseCache';
import { maybeStopWatch } from '../../../../system/stopwatch';
import { createDisposable } from '../../../../system/unifiedDisposable';
import type { CachedLog, TrackedGitDocument } from '../../../../trackers/trackedDocument';
import { GitDocumentState } from '../../../../trackers/trackedDocument';
import type { Git, GitResult } from '../git';
import { gitConfigsLog, gitConfigsLogWithFiles } from '../git';
import type { LocalGitProviderInternal } from '../localGitProvider';
import { convertStashesToStdin } from './stash';

const emptyPromise: Promise<GitBlame | ParsedGitDiffHunks | GitLog | undefined> = Promise.resolve(undefined);
const reflogCommands = ['merge', 'pull'];

export class CommitsGitSubProvider implements GitCommitsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	private get useCaching() {
		return configuration.get('advanced.caching.enabled');
	}

	@log()
	async getCommit(repoPath: string, rev: string, cancellation?: CancellationToken): Promise<GitCommit | undefined> {
		if (isUncommitted(rev, true)) {
			return createUncommittedChangesCommit(
				this.container,
				repoPath,
				rev,
				new Date(),
				await this.provider.config.getCurrentUser(repoPath),
			);
		}

		const log = await this.getLogCore(repoPath, rev, { limit: 1 }, cancellation);
		if (log == null) return undefined;

		return log.commits.get(rev) ?? first(log.commits.values());
	}

	@log({ exit: true })
	async getCommitCount(repoPath: string, rev: string, cancellation?: CancellationToken): Promise<number | undefined> {
		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
			'rev-list',
			'--count',
			rev,
			'--',
		);
		if (result.cancelled || cancellation?.isCancellationRequested) throw new CancellationError();

		const data = result.stdout.trim();
		if (!data) return undefined;

		const count = parseInt(data, 10);
		return isNaN(count) ? undefined : count;
	}

	@log()
	async getCommitFiles(repoPath: string, rev: string, cancellation?: CancellationToken): Promise<GitFileChange[]> {
		const parser = getShaAndFilesAndStatsLogParser();
		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog },
			'log',
			...parser.arguments,
			'-n1',
			rev && !isUncommittedStaged(rev) ? rev : undefined,
			'--',
		);

		const files = first(parser.parse(result.stdout))?.files.map(
			f =>
				new GitFileChange(
					this.container,
					repoPath,
					f.path,
					f.status as GitFileStatus,
					f.originalPath,
					undefined,
					{ additions: f.additions, deletions: f.deletions, changes: 0 },
				),
		);

		return files ?? [];
	}

	@log()
	async getCommitForFile(
		repoPath: string | undefined,
		uri: Uri,
		rev?: string | undefined,
		options?: { firstIfNotFound?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitCommit | undefined> {
		const scope = getLogScope();

		const [relativePath, root] = splitPath(uri, repoPath);

		try {
			const log = await this.getLogForPath(root, relativePath, rev, { limit: 1 }, cancellation);
			if (log == null) return undefined;

			let commit;
			if (rev) {
				const commit = log.commits.get(rev);
				if (commit == null && !options?.firstIfNotFound) {
					// If the ref isn't a valid sha we will never find it, so let it fall through so we return the first
					if (isSha(rev) || isUncommitted(rev)) return undefined;
				}
			}

			return commit ?? first(log.commits.values());
		} catch (ex) {
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	@log()
	async getCommitReachability(
		repoPath: string,
		rev: string,
		cancellation?: CancellationToken,
	): Promise<GitCommitReachability | undefined> {
		if (repoPath == null || isUncommitted(rev)) return undefined;

		const scope = getLogScope();

		const getCore = async (cancellable?: Cancellable) => {
			try {
				// Use for-each-ref with %(HEAD) to mark current branch with *
				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
					'for-each-ref',
					'--contains',
					rev,
					'--format=%(HEAD)%(refname)',
					'--sort=-version:refname',
					'--sort=-committerdate',
					'--sort=-HEAD',
					'refs/heads/',
					'refs/remotes/',
					'refs/tags/',
				);
				if (cancellation?.isCancellationRequested) throw new CancellationError();

				const refs: GitCommitReachability['refs'] = [];

				// Parse branches from refs/heads/ and refs/remotes/
				if (result?.stdout) {
					const lines = result.stdout.split('\n');

					for (let line of lines) {
						line = line.trim();
						if (!line) continue;

						// %(HEAD) outputs '*' for current branch, ' ' for others
						const isCurrent = line.startsWith('*');
						const refname = isCurrent ? line.substring(1) : line; // Skip the HEAD marker

						// Skip HEADs
						if (refname.endsWith('/HEAD')) continue;

						if (refname.startsWith('refs/heads/')) {
							// Remove 'refs/heads/'
							const name = refname.substring(11);
							refs.push({
								refType: 'branch',
								name: name,
								remote: false,
								current: isCurrent,
							});
						} else if (refname.startsWith('refs/remotes/')) {
							// Remove 'refs/remotes/'
							refs.push({ refType: 'branch', name: refname.substring(13), remote: true });
						} else if (refname.startsWith('refs/tags/')) {
							// Remove 'refs/tags/'
							refs.push({ refType: 'tag', name: refname.substring(10) });
						}
					}
				}

				// Sort to move tags to the end, preserving order within each type
				refs.sort((a, b) => (a.refType !== b.refType ? (a.refType === 'tag' ? 1 : -1) : 0));

				await wait(20000);

				return { refs: refs };
			} catch (ex) {
				cancellable?.cancelled();
				debugger;
				if (isCancellationError(ex)) throw ex;

				Logger.error(ex, scope);

				return undefined;
			}
		};

		const cache = this.cache.reachability;
		if (cache == null) return getCore();

		let reachabilityCache = cache.get(repoPath);
		if (reachabilityCache == null) {
			cache.set(
				repoPath,
				(reachabilityCache = new PromiseCache<string, GitCommitReachability | undefined>({
					accessTTL: 1000 * 60 * 60, // 60 minutes
					capacity: 25, // Limit to 25 commits per repo
				})),
			);
		}

		return reachabilityCache.get(rev, getCore);
	}

	@log()
	async getIncomingActivity(
		repoPath: string,
		options?: IncomingActivityOptions,
		cancellation?: CancellationToken,
	): Promise<GitReflog | undefined> {
		const scope = getLogScope();

		const args = ['--walk-reflogs', `--format=${parseGitRefLogDefaultFormat}`, '--date=iso8601'];

		const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
		if (ordering) {
			args.push(`--${ordering}-order`);
		}

		if (options?.all) {
			args.push('--all');
		}

		// Pass a much larger limit to reflog, because we aggregate the data and we won't know how many lines we'll need
		const limit = (options?.limit ?? configuration.get('advanced.maxListItems') ?? 0) * 100;
		if (limit) {
			args.push(`-n${limit}`);
		}

		if (options?.skip) {
			args.push(`--skip=${options.skip}`);
		}

		try {
			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog },
				'log',
				...args,
			);

			const reflog = parseGitRefLog(this.container, result.stdout, repoPath, reflogCommands, limit, limit * 100);
			if (reflog?.hasMore) {
				reflog.more = this.getReflogMoreFn(reflog, options);
			}

			return reflog;
		} catch (ex) {
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	private getReflogMoreFn(
		reflog: GitReflog,
		options?: IncomingActivityOptions,
	): (limit: number) => Promise<GitReflog> {
		return async (limit: number | undefined) => {
			limit = limit ?? configuration.get('advanced.maxSearchItems') ?? 0;

			const moreLog = await this.getIncomingActivity(reflog.repoPath, {
				...options,
				limit: limit,
				skip: reflog.total,
			});
			if (moreLog == null) {
				// If we can't find any more, assume we have everything
				return { ...reflog, hasMore: false, more: undefined };
			}

			const mergedLog: GitReflog = {
				repoPath: reflog.repoPath,
				records: [...reflog.records, ...moreLog.records],
				count: reflog.count + moreLog.count,
				total: reflog.total + moreLog.total,
				limit: (reflog.limit ?? 0) + limit,
				hasMore: moreLog.hasMore,
			};
			if (mergedLog.hasMore) {
				mergedLog.more = this.getReflogMoreFn(mergedLog, options);
			}

			return mergedLog;
		};
	}

	@log({ exit: true })
	async getInitialCommitSha(repoPath: string, cancellation?: CancellationToken): Promise<string | undefined> {
		try {
			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
				'rev-list',
				`--max-parents=0`,
				'HEAD',
				'--',
			);
			if (result.cancelled || cancellation?.isCancellationRequested) throw new CancellationError();

			return result.stdout.trim().split('\n')?.[0];
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	@log()
	async getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		options?: { authors?: GitUser[]; excludeMerges?: boolean },
		cancellation?: CancellationToken,
	): Promise<LeftRightCommitCountResult | undefined> {
		const authors = options?.authors?.length ? options.authors.map(a => `--author=^${a.name} <${a.email}>$`) : [];

		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
			'rev-list',
			'--left-right',
			'--count',
			...authors,
			options?.excludeMerges ? '--no-merges' : undefined,
			range,
			'--',
		);
		if (result.cancelled || cancellation?.isCancellationRequested) throw new CancellationError();
		if (!result.stdout) return undefined;

		const parts = result.stdout.split('\t');
		if (parts.length !== 2) return undefined;

		const [left, right] = parts;
		const counts = {
			left: parseInt(left, 10),
			right: parseInt(right, 10),
		};

		if (isNaN(counts.left) || isNaN(counts.right)) return undefined;

		return counts;
	}

	@log()
	async getLog(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogOptions,
		cancellation?: CancellationToken,
	): Promise<GitLog | undefined> {
		return this.getLogCore(repoPath, rev, options, cancellation);
	}

	@debug({ args: { 2: false, 3: false, 4: false }, exit: true })
	private async getLogCore(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogOptions & {
			path?: { pathspec: string; filters?: GitDiffFilter[]; range?: Range; renames?: boolean };
		},
		cancellation?: CancellationToken,
		additionalArgs?: string[],
	): Promise<GitLog | undefined> {
		const scope = getLogScope();

		try {
			const currentUserPromise = this.provider.config.getCurrentUser(repoPath);

			const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;
			const isSingleCommit = limit === 1;

			const includeFiles =
				!configuration.get('advanced.commits.delayLoadingFileDetails') ||
				isSingleCommit ||
				Boolean(options?.path?.pathspec);

			const parser = getCommitsLogParser(includeFiles, Boolean(options?.path?.pathspec && options?.path?.range));
			const args = ['log', ...parser.arguments];

			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`, '--use-mailmap');

			if (options?.all) {
				args.push('--all');
				if (options?.path?.pathspec) {
					args.push('--single-worktree');
				}
			}

			const merges = options?.merges ?? true;
			if (merges) {
				// If we are are asking for a specific ref, ensure we return the merge commit files
				if (isSingleCommit) {
					args.push('-m');
				}
				args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
			} else {
				args.push('--no-merges');
			}

			const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			if (options?.authors?.length) {
				args.push(...options.authors.map(a => `--author=^${a.name} <${a.email}>$`));
			}

			let overrideHasMore;

			if (options?.since) {
				overrideHasMore = true;
				args.push(`--since="${options.since}"`);
			}

			if (options?.until) {
				overrideHasMore = true;
				args.push(`--until="${options.until}"`);
			}

			if (additionalArgs?.length) {
				args.push(...additionalArgs);
			}

			if (limit > 0) {
				overrideHasMore = isSingleCommit ? false : undefined;
				// Add 1 to the limit so we can check if there are more commits
				args.push(`-n${isSingleCommit ? 1 : limit + 1}`);
			}

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			if (!isSingleCommit) {
				if (options?.stashes) {
					// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
					({ stdin, stashes } = convertStashesToStdin(
						typeof options.stashes === 'boolean'
							? await this.provider.stash?.getStash(repoPath, { reachableFrom: rev }, cancellation)
							: options.stashes,
					));
					if (stashes.size) {
						rev ??= 'HEAD';
					}
				}

				if (stdin) {
					args.push('--stdin');
				}
			}

			if (rev && !isUncommittedStaged(rev)) {
				args.push(rev);
			}

			let pathspec: string | undefined;
			let pathspecRange: `${number},${number}` | undefined;

			if (options?.path?.pathspec) {
				pathspec = options.path.pathspec;
				const { filters, range, renames } = options.path;

				if (filters?.length) {
					args.push(`--diff-filter=${filters.join('')}`);
				}

				if (range != null) {
					// Git doesn't allow rename detection (`--follow`) if a range is used

					const [start, end] = getGitStartEnd(range);
					pathspecRange = `${start},${end}`;
					args.push(`-L ${pathspecRange}:${pathspec}`, '--');
				} else {
					if (renames !== false) {
						args.push('--follow');
					}
					args.push('--', pathspec);
				}
			} else {
				args.push('--');
			}

			const currentUser = await currentUserPromise.catch(() => undefined);
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			const cmdOpts: GitCommandOptions = {
				cwd: repoPath,
				cancellation: cancellation,
				configs: gitConfigsLogWithFiles,
				stdin: stdin,
			};
			let { commits, count, countStashChildCommits } = await parseCommits(
				this.container,
				parser,
				isSingleCommit ? this.git.exec(cmdOpts, ...args) : this.git.stream(cmdOpts, ...args),
				repoPath,
				pathspec,
				limit,
				stashes,
				currentUser,
			);

			// If we didn't find any history from the working tree, check to see if the file was renamed
			if (rev == null && pathspec && !commits.size) {
				const status = await this.provider.status?.getStatusForFile(
					repoPath,
					pathspec,
					undefined,
					cancellation,
				);
				if (status?.originalPath != null) {
					pathspec = status.originalPath;

					if (pathspecRange) {
						const index = args.findIndex(a => a.startsWith('-L '));
						args.splice(index, 1, `-L ${pathspecRange}:${pathspec}`);
					} else {
						args.splice(args.length - 1, 1, pathspec);
					}

					({ commits, count, countStashChildCommits } = await parseCommits(
						this.container,
						parser,
						isSingleCommit ? this.git.exec(cmdOpts, ...args) : this.git.stream(cmdOpts, ...args),
						repoPath,
						pathspec,
						limit,
						stashes,
						currentUser,
					));
				}
			}

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: isRevisionRange(rev) ? undefined : rev,
				count: commits.size,
				limit: limit,
				hasMore: overrideHasMore ?? count - countStashChildCommits > commits.size,
			};

			if (!isSingleCommit) {
				log.query = (limit: number | undefined) =>
					this.getLogCore(repoPath, rev, { ...options, limit: limit }, undefined, additionalArgs);
				if (log.hasMore) {
					log.more = this.getLogCoreMoreFn(log, rev, options);
				}
			}

			return log;
		} catch (ex) {
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;
			debugger;

			return undefined;
		}
	}

	private getLogCoreMoreFn(
		log: GitLog,
		rev: string | undefined,
		options?: GitLogOptions & {
			path?: { pathspec: string; filters?: GitDiffFilter[]; range?: Range; renames?: boolean };
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? configuration.get('advanced.maxSearchItems') ?? 0;

			// If the log is for a range, then just get everything prior + more
			if (isRevisionRange(log.sha)) {
				const moreLog = await this.getLogCore(log.repoPath, rev, {
					...options,
					limit: moreLimit === 0 ? 0 : (options?.limit ?? 0) + moreLimit,
				});
				// If we can't find any more, assume we have everything
				if (moreLog == null) return { ...log, hasMore: false, more: undefined };

				return moreLog;
			}

			const lastCommit = last(log.commits.values());
			const sha = lastCommit?.ref;

			// Check to make sure the filename hasn't changed and if it has use the previous
			if (options?.path?.pathspec && lastCommit?.file != null) {
				const path = lastCommit.file.originalPath ?? lastCommit.file.path;
				if (path !== options.path.pathspec) {
					options = { ...options, path: { ...options.path, pathspec: path } };
				}
			}

			// If we were asked for all refs, use the last commit timestamp (plus a second) as a cursor
			let timestamp: number | undefined;
			if (options?.all) {
				const date = lastCommit?.committer.date;
				// Git only allows 1-second precision, so round up to the nearest second
				timestamp = date != null ? Math.ceil(date.getTime() / 1000) + 1 : undefined;
			}

			let moreLogCount;
			let queryLimit = moreUntil == null ? moreLimit : 0;
			do {
				const moreLog = await this.getLogCore(
					log.repoPath,
					timestamp ? rev : moreUntil == null ? `${sha}^` : `${moreUntil}^..${sha}^`,
					{
						...options,
						limit: queryLimit,
						...(timestamp ? { until: timestamp } : undefined),
					},
					undefined,
					timestamp ? ['--boundary'] : undefined,
				);
				// If we can't find any more, assume we have everything
				if (moreLog == null) return { ...log, hasMore: false, more: undefined };

				const currentCount = log.commits.size;
				const commits = new Map([...log.commits, ...moreLog.commits]);

				if (currentCount === commits.size && queryLimit !== 0) {
					// If we didn't find any new commits, we must have them all so return that we have everything
					if (moreLogCount === moreLog.commits.size) {
						return { ...log, hasMore: false, more: undefined };
					}

					moreLogCount = moreLog.commits.size;
					queryLimit = queryLimit * 2;
					continue;
				}

				if (timestamp != null && sha != null && !moreLog.commits.has(sha)) {
					debugger;
				}

				const mergedLog: GitLog = {
					repoPath: log.repoPath,
					commits: commits,
					sha: log.sha,
					count: commits.size,
					limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
					hasMore: moreUntil == null ? moreLog.hasMore : true,
					startingCursor: last(log.commits)?.[0],
					endingCursor: moreLog.endingCursor,
					pagedCommits: () => {
						// Remove any duplicates
						for (const sha of log.commits.keys()) {
							moreLog.commits.delete(sha);
						}
						return moreLog.commits;
					},
					// eslint-disable-next-line no-loop-func
					query: (limit: number | undefined) =>
						this.getLogCore(log.repoPath, rev, { ...options, limit: limit }),
				};
				if (mergedLog.hasMore) {
					mergedLog.more = this.getLogCoreMoreFn(mergedLog, rev, options);
				}

				return mergedLog;
			} while (true);
		};
	}

	@log()
	async getLogForPath(
		repoPath: string | undefined,
		pathOrUri: string | Uri,
		rev?: string | undefined,
		options?: GitLogForPathOptions,
		cancellation?: CancellationToken,
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		let relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		if (repoPath != null && repoPath === relativePath) {
			throw new Error(`Path cannot match the repository path; path=${relativePath}`);
		}

		options = {
			...options,
			all: options?.all ?? configuration.get('advanced.fileHistoryShowAllBranches'),
			limit: options?.limit ?? configuration.get('advanced.maxListItems') ?? 0,
			merges: options?.merges
				? true
				: options?.merges == null
					? configuration.get('advanced.fileHistoryShowMergeCommits')
					: false,
			renames: options?.renames ?? configuration.get('advanced.fileHistoryFollowsRenames'),
		};

		if (isFolderGlob(relativePath)) {
			relativePath = stripFolderGlob(relativePath);
			options.isFolder = true;
		} else if (options.isFolder == null) {
			const tree = await this.provider.revision.getTreeEntryForRevision(repoPath, rev || 'HEAD', relativePath);
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			options.isFolder = tree?.type === 'tree';
		}

		let cacheKey: string | undefined;
		if (
			this.useCaching &&
			// Don't cache folders
			!options.isFolder &&
			options.authors == null &&
			options.cursor == null &&
			options.filters == null &&
			options.range == null &&
			options.since == null &&
			options.until == null
		) {
			cacheKey = 'log';
			if (rev != null) {
				cacheKey += `:${rev}`;
			}
			if (options.all) {
				cacheKey += ':all';
			}
			if (options.limit) {
				cacheKey += `:n${options.limit}`;
			}
			if (options.merges) {
				cacheKey += `:merges=${options.merges}`;
			}
			if (options.ordering) {
				cacheKey += `:ordering=${options.ordering}`;
			}
			if (options.renames) {
				cacheKey += ':follow';
			}
		}

		let doc: TrackedGitDocument | undefined;
		if (cacheKey) {
			doc = await this.container.documentTracker.getOrAdd(GitUri.fromFile(relativePath, repoPath, rev));
			if (doc.state != null) {
				const cachedLog = doc.state.getLog(cacheKey);
				if (cachedLog != null) {
					Logger.debug(scope, `Cache hit: '${cacheKey}'`);
					return cachedLog.item;
				}

				if (rev != null || (options.limit != null && options.limit !== 0)) {
					// Since we are looking for partial log, see if we have the log of the whole file
					const cachedLog = doc.state.getLog(`log${options.renames ? ':follow' : ''}`);
					if (cachedLog != null) {
						if (rev == null) {
							Logger.debug(scope, `Cache hit: ~'${cacheKey}'`);
							return cachedLog.item;
						}

						Logger.debug(scope, `Cache ?: '${cacheKey}'`);
						let log = await cachedLog.item;
						if (log != null && !log.hasMore && log.commits.has(rev)) {
							Logger.debug(scope, `Cache hit: '${cacheKey}'`);

							// Create a copy of the log starting at the requested commit
							let skip = true;
							let i = 0;
							const commits = new Map(
								filterMap<[string, GitCommit], [string, GitCommit]>(
									log.commits.entries(),
									([sha, c]) => {
										if (skip) {
											if (sha !== rev) return undefined;
											skip = false;
										}

										i++;
										if (options?.limit != null && i > options.limit) {
											return undefined;
										}

										return [sha, c];
									},
								),
							);

							const optsCopy = { ...options };
							log = {
								...log,
								limit: optsCopy.limit,
								count: commits.size,
								commits: commits,
								query: (limit: number | undefined) =>
									this.getLogForPath(repoPath, pathOrUri, rev, { ...optsCopy, limit: limit }),
							};

							return log;
						}
					}
				}
			}

			Logger.debug(scope, `Cache miss: '${cacheKey}'`);

			doc.state ??= new GitDocumentState();
		}

		const promise = this.getLogForPathCore(repoPath, relativePath, rev, options, cancellation).catch(
			(ex: unknown) => {
				// Trap and cache expected log errors
				if (cacheKey && doc?.state != null) {
					if (isCancellationError(ex)) {
						doc.state.clearLog(cacheKey);
						throw ex;
					}

					const msg: string = ex?.toString() ?? '';
					Logger.debug(scope, `Cache replace (with empty promise): '${cacheKey}'`);

					const value: CachedLog = {
						item: emptyPromise as Promise<GitLog>,
						errorMessage: msg,
					};
					doc.state.setLog(cacheKey, value);

					return emptyPromise as Promise<GitLog>;
				}

				if (isCancellationError(ex)) throw ex;

				return undefined;
			},
		);

		if (cacheKey && doc?.state != null) {
			Logger.debug(scope, `Cache add: '${cacheKey}'`);

			const value: CachedLog = {
				item: promise as Promise<GitLog>,
			};
			doc.state.setLog(cacheKey, value);
		}

		return promise;
	}

	private async getLogForPathCore(
		repoPath: string | undefined,
		path: string,
		rev: string | undefined,
		options: GitLogForPathOptions,
		cancellation?: CancellationToken,
	): Promise<GitLog | undefined> {
		const scope = getLogScope();

		const paths = await this.provider.isTrackedWithDetails(path, repoPath, rev);
		if (cancellation?.isCancellationRequested) throw new CancellationError();

		if (paths == null) {
			Logger.log(scope, `Skipping log; '${path}' is not tracked`);
			return emptyPromise as Promise<GitLog>;
		}

		const [relativePath, root] = paths;

		const log = await this.getLogCore(
			root,
			rev,
			{
				all: options.all,
				authors: options.authors,
				cursor: options.cursor,
				limit: options.limit,
				merges: options.merges,
				ordering: options.ordering,
				since: options.since,
				until: options.until,
				path: {
					pathspec: relativePath,
					filters: options.filters,
					range: options.range,
					renames: options.renames,
				},
			},
			cancellation,
		);

		return log;
	}

	@log()
	async getLogShas(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogShasOptions,
		cancellation?: CancellationToken,
	): Promise<Iterable<string>> {
		const scope = getLogScope();

		try {
			const parser = getShaLogParser();
			const args = [...parser.arguments];

			if (options?.all) {
				args.push(`--all`);
			}

			const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;
			if (limit) {
				args.push(`-n${limit}`);
			}

			if (options?.since) {
				args.push(`--since="${options.since}"`);
			}

			const merges = options?.merges ?? true;
			if (merges) {
				args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
			} else {
				args.push('--no-merges');
			}

			if (options?.authors?.length) {
				if (!args.includes('--use-mailmap')) {
					args.push('--use-mailmap');
				}
				args.push(...options.authors.map(a => `--author=^${a.name} <${a.email}>$`));
			}

			const pathspec =
				options?.pathOrUri != null ? this.provider.getRelativePath(options.pathOrUri, repoPath) : undefined;
			if (pathspec) {
				const similarityThreshold = configuration.get('advanced.similarityThreshold');
				args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`);
			}

			if (rev && !isUncommittedStaged(rev)) {
				args.push(rev);
			}

			args.push('--');

			if (pathspec) {
				args.push(pathspec);
			}

			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog },
				'log',
				...args,
			);
			return parser.parse(result.stdout);
		} catch (ex) {
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;
			debugger;

			return [];
		}
	}

	@log()
	async getOldestUnpushedShaForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		cancellation?: CancellationToken,
	): Promise<string | undefined> {
		const scope = getLogScope();

		try {
			const relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

			const parser = getShaLogParser();
			const args = [...parser.arguments];

			const ordering = /*options?.ordering ??*/ configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog },
				'log',
				...parser.arguments,
				'--follow',
				'--reverse',
				'@{u}..',
				'--',
				relativePath,
			);
			return first(parser.parse(result.stdout));
		} catch (ex) {
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;
			debugger;

			return undefined;
		}
	}

	@log()
	async hasCommitBeenPushed(repoPath: string, rev: string, cancellation?: CancellationToken): Promise<boolean> {
		if (repoPath == null) return false;

		return this.isAncestorOf(repoPath, rev, '@{u}', cancellation);
	}

	@log()
	async isAncestorOf(
		repoPath: string,
		rev1: string,
		rev2: string,
		cancellation?: CancellationToken,
	): Promise<boolean> {
		if (repoPath == null) return false;

		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation, exitCodeOnly: true },
			'merge-base',
			'--is-ancestor',
			rev1,
			rev2,
		);
		return result.exitCode === 0;
	}

	@log<CommitsGitSubProvider['searchCommits']>({
		args: {
			1: s =>
				`[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}${
					s.matchWholeWord ? 'W' : ''
				}]: ${s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query}`,
		},
	})
	async searchCommits(
		repoPath: string,
		search: SearchQuery,
		source: Source,
		options?: GitSearchCommitsOptions,
		cancellation?: CancellationToken,
	): Promise<SearchCommitsResult> {
		const scope = getLogScope();

		search = { matchAll: false, matchCase: false, matchRegex: true, matchWholeWord: false, ...search };
		if (
			search.naturalLanguage &&
			(typeof search.naturalLanguage !== 'object' || !search.naturalLanguage.processedQuery)
		) {
			search = await processNaturalLanguageToSearchQuery(this.container, search, source);
		}

		try {
			const currentUser = await this.provider.config.getCurrentUser(repoPath);
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			const parser = getCommitsLogParser(true);

			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			const args = [
				'log',
				...parser.arguments,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
				'--use-mailmap',
			];

			const { args: searchArgs, files, shas, filters } = parseSearchQueryGitCommand(search, currentUser);

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			if (shas?.size) {
				stdin = join(shas, '\n');
				args.push('--no-walk');
			} else if (!filters.refs) {
				// Don't include stashes when using ref: filter, as they would add unrelated commits
				// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
				({ stdin, stashes } = convertStashesToStdin(
					await this.provider.stash?.getStash(repoPath, undefined, cancellation),
				));
			}

			if (stdin) {
				args.push('--stdin');
			}

			const limit = options?.limit ?? configuration.get('advanced.maxSearchItems') ?? 0;
			if (limit && !shas?.size) {
				args.push(`-n${limit + 1}`);
			}

			const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			if (options?.skip) {
				args.push(`--skip=${options.skip}`);
			}

			// Add the search args, but skip any shas (as they are already included in the stdin)
			for (const arg of searchArgs) {
				if (shas?.has(arg) || args.includes(arg)) continue;

				args.push(arg);
			}

			const pathspec = files?.join(' ');
			const { commits, count, countStashChildCommits } = await parseCommits(
				this.container,
				parser,
				this.git.stream(
					{
						cwd: repoPath,
						cancellation: cancellation,
						configs: ['-C', repoPath, ...gitConfigsLog],
						stdin: stdin,
					},
					...args,
					'--',
					...files,
				),
				repoPath,
				pathspec,
				limit,
				stashes,
				currentUser,
				filters,
			);

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: undefined,
				searchFilters: filters,
				count: commits.size,
				limit: limit,
				hasMore: count - countStashChildCommits > commits.size,
				query: (limit: number | undefined) =>
					this.searchCommits(repoPath, search, source, { ...options, limit: limit }).then(r => r.log),
			};

			if (log.hasMore) {
				function searchCommitsCore(
					this: CommitsGitSubProvider,
					log: GitLog,
				): (limit: number | undefined) => Promise<GitLog> {
					return async (limit: number | undefined) => {
						limit = limit ?? configuration.get('advanced.maxSearchItems') ?? 0;

						const moreLog = (
							await this.searchCommits(log.repoPath, search, source, {
								...options,
								limit: limit,
								skip: log.count,
							})
						).log;
						// If we can't find any more, assume we have everything
						if (moreLog == null) return { ...log, hasMore: false, more: undefined };

						const commits = new Map([...log.commits, ...moreLog.commits]);

						const mergedLog: GitLog = {
							repoPath: log.repoPath,
							commits: commits,
							sha: log.sha,
							searchFilters: filters,
							count: commits.size,
							limit: (log.limit ?? 0) + limit,
							hasMore: moreLog.hasMore,
							query: (limit: number | undefined) =>
								this.searchCommits(log.repoPath, search, source, { ...options, limit: limit }).then(
									r => r.log,
								),
						};
						if (mergedLog.hasMore) {
							mergedLog.more = searchCommitsCore.call(this, mergedLog);
						}

						return mergedLog;
					};
				}

				log.more = searchCommitsCore.call(this, log);
			}

			return { search: search, log: log };
		} catch (ex) {
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;

			return { search: search, log: undefined };
		}
	}
}

function createCommit(
	container: Container,
	c: ParsedCommit,
	repoPath: string,
	pathspec: string | undefined,
	currentUser: GitUser | undefined,
) {
	const message = c.message.trim();
	const index = message.indexOf('\n');

	return new GitCommit(
		container,
		repoPath,
		c.sha,
		new GitCommitIdentity(
			isUserMatch(currentUser, c.author, c.authorEmail) ? 'You' : c.author,
			c.authorEmail,
			new Date((c.authorDate as unknown as number) * 1000),
		),
		new GitCommitIdentity(
			isUserMatch(currentUser, c.committer, c.committerEmail) ? 'You' : c.committer,
			c.committerEmail,
			new Date((c.committerDate as unknown as number) * 1000),
		),
		index !== -1 ? message.substring(0, index) : message,
		c.parents?.split(' ') ?? [],
		message,
		createCommitFileset(container, c, repoPath, pathspec),
		c.stats,
		undefined,
		c.tips?.split(' '),
	);
}

export function createCommitFileset(
	container: Container,
	c: ParsedCommit | ParsedStash,
	repoPath: string,
	pathspec: string | undefined,
): GitCommitFileset {
	// If the files are missing or it's a merge commit without files or pathspec, then consider the files unloaded
	if (c.files == null || (!c.files.length && pathspec == null && c.parents.includes(' '))) {
		return {
			files: undefined,
			filtered: pathspec ? { files: undefined, pathspec: pathspec } : undefined,
		};
	}

	const files = c.files.map(
		f =>
			new GitFileChange(
				container,
				repoPath,
				f.path,
				f.status as GitFileStatus,
				f.originalPath,
				undefined,
				{ additions: f.additions ?? 0, deletions: f.deletions ?? 0, changes: 0 },
				undefined,
				f.range ? { startLine: f.range.startLine, endLine: f.range.endLine } : undefined,
			),
	);

	return pathspec ? { files: undefined, filtered: { files: files, pathspec: pathspec } } : { files: files };
}

function getGitStartEnd(range: Range): [number, number] {
	// Ensure that the start is always before the end (VS Code ranges can be reversed)
	// NOTE: Git is 1-based, VS Code ranges are 0-based
	if (range.start.line > range.end.line) {
		return [range.end.line + 1, range.start.line + 1];
	}
	return [range.start.line + 1, range.end.line + 1];
}

async function parseCommits(
	container: Container,
	parser: CommitsLogParser | CommitsWithFilesLogParser | CommitsInFileRangeLogParser,
	resultOrStream: Promise<GitResult<string>> | AsyncGenerator<string>,
	repoPath: string,
	pathspec: string | undefined,
	limit: number | undefined,
	stashes: Map<string, GitStashCommit> | undefined,
	currentUser: GitUser | undefined,
	searchFilters?: SearchQueryFilters,
): Promise<{ commits: Map<string, GitCommit>; count: number; countStashChildCommits: number }> {
	let count = 0;
	let countStashChildCommits = 0;
	const commits = new Map<string, GitCommit>();

	const tipsOnly = searchFilters?.type === 'tip';

	if (resultOrStream instanceof Promise) {
		const result = await resultOrStream;

		const scope = getLogScope();
		using sw = maybeStopWatch(scope, { log: false, logLevel: 'debug' });

		if (stashes?.size) {
			const allowFilteredFiles = searchFilters?.files ?? false;
			const stashesOnly = searchFilters?.type === 'stash';

			for (const c of parser.parse(result.stdout)) {
				if (stashesOnly && !stashes?.has(c.sha)) continue;
				if (tipsOnly && !c.tips) continue;

				count++;
				if (limit && count > limit) break;

				const stash = stashes?.get(c.sha);
				if (stash != null) {
					if (commits.has(stash.sha)) {
						countStashChildCommits++;
					} else if (allowFilteredFiles) {
						commits.set(
							stash.sha,
							stash.with({
								fileset: {
									...createCommitFileset(container, c, repoPath, pathspec),
									// Add the full stash files back into the fileset
									files: stash.fileset?.files,
								},
							}),
						);
					} else {
						commits.set(stash.sha, stash);
					}
					continue;
				}

				commits.set(c.sha, createCommit(container, c, repoPath, pathspec, currentUser));
			}
		} else {
			for (const c of parser.parse(result.stdout)) {
				if (tipsOnly && !c.tips) continue;

				count++;
				if (limit && count > limit) break;

				commits.set(c.sha, createCommit(container, c, repoPath, pathspec, currentUser));
			}
		}

		sw?.stop({ suffix: ` created ${count} commits` });

		return { commits: commits, count: count, countStashChildCommits: countStashChildCommits };
	}

	using _streamDisposer = createDisposable(() => void resultOrStream.return?.(undefined));

	if (stashes?.size) {
		const allowFilteredFiles = searchFilters?.files ?? false;
		const stashesOnly = searchFilters?.type === 'stash';

		for await (const c of parser.parseAsync(resultOrStream)) {
			if (stashesOnly && !stashes?.has(c.sha)) continue;
			if (tipsOnly && !c.tips) continue;

			count++;
			if (limit && count > limit) break;

			const stash = stashes?.get(c.sha);
			if (stash != null) {
				if (commits.has(stash.sha)) {
					countStashChildCommits++;
				} else if (allowFilteredFiles) {
					commits.set(
						stash.sha,
						stash.with({
							fileset: {
								...createCommitFileset(container, c, repoPath, pathspec),
								// Add the full stash files back into the fileset
								files: stash.fileset?.files,
							},
						}),
					);
				} else {
					commits.set(stash.sha, stash);
				}
				continue;
			}

			commits.set(c.sha, createCommit(container, c, repoPath, pathspec, currentUser));
		}
	} else {
		for await (const c of parser.parseAsync(resultOrStream)) {
			if (tipsOnly && !c.tips) continue;

			count++;
			if (limit && count > limit) break;

			commits.set(c.sha, createCommit(container, c, repoPath, pathspec, currentUser));
		}
	}

	return { commits: commits, count: count, countStashChildCommits: countStashChildCommits };
}
