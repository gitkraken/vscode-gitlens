import type { Range, Uri } from 'vscode';
import type { SearchQuery } from '../../../../constants.search';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import type { GitCommandOptions } from '../../../../git/commandOptions';
import { GitErrorHandling } from '../../../../git/commandOptions';
import { CherryPickError, CherryPickErrorReason } from '../../../../git/errors';
import type {
	GitCommitsSubProvider,
	GitLogForPathOptions,
	GitLogOptions,
	GitLogShasOptions,
	GitSearchCommitsOptions,
	IncomingActivityOptions,
	LeftRightCommitCountResult,
} from '../../../../git/gitProvider';
import { GitUri } from '../../../../git/gitUri';
import type { GitBlame } from '../../../../git/models/blame';
import type { GitStashCommit } from '../../../../git/models/commit';
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
} from '../../../../git/parsers/logParser';
import {
	getCommitsLogParser,
	getShaAndDatesLogParser,
	getShaAndFilesAndStatsLogParser,
	getShaLogParser,
} from '../../../../git/parsers/logParser';
import { parseGitRefLog, parseGitRefLogDefaultFormat } from '../../../../git/parsers/reflogParser';
import { getGitArgsFromSearchQuery } from '../../../../git/search';
import { createUncommittedChangesCommit } from '../../../../git/utils/-webview/commit.utils';
import { isRevisionRange, isSha, isUncommitted, isUncommittedStaged } from '../../../../git/utils/revision.utils';
import { isUserMatch } from '../../../../git/utils/user.utils';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { log } from '../../../../system/decorators/log';
import { filterMap, first, join, last, some } from '../../../../system/iterable';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { CachedLog } from '../../../../trackers/trackedDocument';
import { GitDocumentState } from '../../../../trackers/trackedDocument';
import type { Git, GitResult } from '../git';
import { GitErrors, gitLogDefaultConfigs, gitLogDefaultConfigsWithFiles } from '../git';
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
	async cherryPick(
		repoPath: string,
		revs: string[],
		options?: { edit?: boolean; noCommit?: boolean },
	): Promise<void> {
		const args = ['cherry-pick'];
		if (options?.edit) {
			args.push('-e');
		}
		if (options?.noCommit) {
			args.push('-n');
		}

		if (revs.length > 1) {
			const parser = getShaAndDatesLogParser();
			// Ensure the revs are in reverse committer date order
			const result = await this.git.exec(
				{ cwd: repoPath, stdin: join(revs, '\n') },
				'log',
				'--no-walk',
				'--stdin',
				...parser.arguments,
				'--',
			);
			const commits = [...parser.parse(result.stdout)].sort(
				(c1, c2) => Number(c1.committerDate) - Number(c2.committerDate),
			);
			revs = commits.map(c => c.sha);
		}

		args.push(...revs);

		try {
			await this.git.exec({ cwd: repoPath, errors: GitErrorHandling.Throw }, ...args);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';

			let reason: CherryPickErrorReason = CherryPickErrorReason.Other;
			if (
				GitErrors.changesWouldBeOverwritten.test(msg) ||
				GitErrors.changesWouldBeOverwritten.test(ex.stderr ?? '')
			) {
				reason = CherryPickErrorReason.AbortedWouldOverwrite;
			} else if (GitErrors.conflict.test(msg) || GitErrors.conflict.test(ex.stdout ?? '')) {
				reason = CherryPickErrorReason.Conflicts;
			} else if (GitErrors.emptyPreviousCherryPick.test(msg)) {
				reason = CherryPickErrorReason.EmptyCommit;
			}

			debugger;
			throw new CherryPickError(reason, ex, revs);
		}
	}

	@log()
	async getCommit(repoPath: string, rev: string): Promise<GitCommit | undefined> {
		if (isUncommitted(rev, true)) {
			return createUncommittedChangesCommit(
				this.container,
				repoPath,
				rev,
				new Date(),
				await this.provider.config.getCurrentUser(repoPath),
			);
		}

		const log = await this.getLogCore(repoPath, rev, { limit: 1 });
		if (log == null) return undefined;

		return log.commits.get(rev) ?? first(log.commits.values());
	}

	@log({ exit: true })
	async getCommitCount(repoPath: string, rev: string): Promise<number | undefined> {
		const result = await this.git.exec(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore },
			'rev-list',
			'--count',
			rev,
			'--',
		);
		const data = result.stdout.trim();
		if (!data) return undefined;

		const count = parseInt(data, 10);
		return isNaN(count) ? undefined : count;
	}

	@log()
	async getCommitFiles(repoPath: string, rev: string): Promise<GitFileChange[]> {
		const parser = getShaAndFilesAndStatsLogParser();
		const result = await this.git.exec(
			{ cwd: repoPath, configs: gitLogDefaultConfigs },
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
					{
						additions: f.additions,
						deletions: f.deletions,
						changes: 0,
					},
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
	): Promise<GitCommit | undefined> {
		const scope = getLogScope();

		const [relativePath, root] = splitPath(uri, repoPath);

		try {
			const log = await this.getLogForPath(root, relativePath, rev, { limit: 1 });
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
			return undefined;
		}
	}

	@log()
	async getIncomingActivity(repoPath: string, options?: IncomingActivityOptions): Promise<GitReflog | undefined> {
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
				{ cwd: repoPath, cancellation: options?.cancellation, configs: gitLogDefaultConfigs },
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
	async getInitialCommitSha(repoPath: string): Promise<string | undefined> {
		try {
			const result = await this.git.exec(
				{ cwd: repoPath, errors: GitErrorHandling.Ignore },
				'rev-list',
				`--max-parents=0`,
				'HEAD',
				'--',
			);
			return result.stdout.trim().split('\n')?.[0];
		} catch {
			return undefined;
		}
	}

	@log()
	async getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		options?: { authors?: GitUser[]; excludeMerges?: boolean },
	): Promise<LeftRightCommitCountResult | undefined> {
		const authors = options?.authors?.length ? options.authors.map(a => `--author=^${a.name} <${a.email}>$`) : [];

		const result = await this.git.exec(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore },
			'rev-list',
			'--left-right',
			'--count',
			...authors,
			options?.excludeMerges ? '--no-merges' : undefined,
			range,
			'--',
		);
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
	async getLog(repoPath: string, rev?: string | undefined, options?: GitLogOptions): Promise<GitLog | undefined> {
		return this.getLogCore(repoPath, rev, options);
	}

	private async getLogCore(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogOptions & {
			path?: { pathspec: string; filters?: GitDiffFilter[]; range?: Range; renames?: boolean };
		},
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
							? await this.provider.stash?.getStash(repoPath, { reachableFrom: rev })
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
			}

			const currentUser = await currentUserPromise.catch(() => undefined);

			const cmdOpts: GitCommandOptions = {
				cwd: repoPath,
				cancellation: options?.cancellation,
				configs: gitLogDefaultConfigsWithFiles,
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
				// TODO@eamodio this currently won't work because getStatusForFile won't return the original path
				const status = await this.provider.status?.getStatusForFile(repoPath, pathspec);
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
				sha: rev,
				count: commits.size,
				limit: limit,
				hasMore: overrideHasMore ?? count - countStashChildCommits > commits.size,
			};

			if (!isSingleCommit) {
				log.query = (limit: number | undefined) =>
					this.getLogCore(repoPath, rev, { ...options, limit: limit }, additionalArgs);
				if (log.hasMore) {
					log.more = this.getLogCoreMoreFn(log, rev, options);
				}
			}

			return log;
		} catch (ex) {
			Logger.error(ex, scope);
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
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		if (repoPath != null && repoPath === relativePath) {
			throw new Error(`Path cannot match the repository path; path=${relativePath}`);
		}

		const opts = {
			all: configuration.get('advanced.fileHistoryShowAllBranches'),
			renames: configuration.get('advanced.fileHistoryFollowsRenames'),
			...options,
			limit: options?.limit ?? configuration.get('advanced.maxListItems') ?? 0,
			merges: options?.merges
				? true
				: options?.merges == null
				  ? configuration.get('advanced.fileHistoryShowMergeCommits')
				  : false,
		};

		let key = 'log';
		if (rev != null) {
			key += `:${rev}`;
		}

		if (opts.all) {
			key += ':all';
		}

		if (opts.limit) {
			key += `:n${opts.limit}`;
		}

		if (opts.merges) {
			key += ':merges';
		}

		if (opts.ordering) {
			key += `:ordering=${opts.ordering}`;
		}

		if (opts.renames) {
			key += ':follow';
		}

		if (opts.since) {
			key += `:since=${opts.since}`;
		}

		const useCache = this.useCaching && opts.cursor == null && opts.range == null;

		const doc = await this.container.documentTracker.getOrAdd(GitUri.fromFile(relativePath, repoPath, rev));
		if (useCache) {
			if (doc.state != null) {
				const cachedLog = doc.state.getLog(key);
				if (cachedLog != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedLog.item;
				}

				if (rev != null || (opts.limit != null && opts.limit !== 0)) {
					// Since we are looking for partial log, see if we have the log of the whole file
					const cachedLog = doc.state.getLog(`log${opts.renames ? ':follow' : ''}`);
					if (cachedLog != null) {
						if (rev == null) {
							Logger.debug(scope, `Cache hit: ~'${key}'`);
							return cachedLog.item;
						}

						Logger.debug(scope, `Cache ?: '${key}'`);
						let log = await cachedLog.item;
						if (log != null && !log.hasMore && log.commits.has(rev)) {
							Logger.debug(scope, `Cache hit: '${key}'`);

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
										if (opts?.limit != null && i > opts.limit) {
											return undefined;
										}

										return [sha, c];
									},
								),
							);

							const optsCopy = { ...opts };
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

			Logger.debug(scope, `Cache miss: '${key}'`);

			doc.state ??= new GitDocumentState();
		}

		const promise = this.getLogForPathCore(repoPath, relativePath, rev, opts).catch((ex: unknown) => {
			// Trap and cache expected log errors
			if (doc.state != null && opts.range == null) {
				const msg: string = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedLog = {
					item: emptyPromise as Promise<GitLog>,
					errorMessage: msg,
				};
				doc.state.setLog(key, value);

				return emptyPromise as Promise<GitLog>;
			}

			return undefined;
		});

		if (useCache && doc.state != null) {
			Logger.debug(scope, `Cache add: '${key}'`);

			const value: CachedLog = {
				item: promise as Promise<GitLog>,
			};
			doc.state.setLog(key, value);
		}

		return promise;
	}

	private async getLogForPathCore(
		repoPath: string | undefined,
		path: string,
		rev: string | undefined,
		options?: GitLogForPathOptions,
	): Promise<GitLog | undefined> {
		const scope = getLogScope();

		const paths = await this.provider.isTrackedWithDetails(path, repoPath, rev);
		if (paths == null) {
			Logger.log(scope, `Skipping log; '${path}' is not tracked`);
			return emptyPromise as Promise<GitLog>;
		}

		const [relativePath, root] = paths;

		const log = await this.getLogCore(
			root,
			rev,
			options
				? {
						all: options.all,
						authors: options.authors,
						cancellation: options.cancellation,
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
				  }
				: { path: { pathspec: relativePath } },
		);

		return log;
	}

	@log()
	async getLogShas(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogShasOptions,
	): Promise<Iterable<string>> {
		const scope = getLogScope();

		try {
			const parser = getShaLogParser();
			const args = [...parser.arguments];

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
				{ cwd: repoPath, cancellation: options?.cancellation, configs: gitLogDefaultConfigs },
				'log',
				...args,
			);
			return parser.parse(result.stdout);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return [];
		}
	}

	@log()
	async getOldestUnpushedShaForPath(repoPath: string, pathOrUri: string | Uri): Promise<string | undefined> {
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
				{ cwd: repoPath, configs: gitLogDefaultConfigs },
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
			return undefined;
		}
	}

	@log()
	async hasCommitBeenPushed(repoPath: string, rev: string): Promise<boolean> {
		if (repoPath == null) return false;

		return this.isAncestorOf(repoPath, rev, '@{u}');
	}

	@log()
	async isAncestorOf(repoPath: string, rev1: string, rev2: string): Promise<boolean> {
		if (repoPath == null) return false;

		const result = await this.git.exec(
			{ cwd: repoPath, exitCodeOnly: true },
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
				`[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}]: ${
					s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query
				}`,
		},
	})
	async searchCommits(
		repoPath: string,
		search: SearchQuery,
		options?: GitSearchCommitsOptions,
	): Promise<GitLog | undefined> {
		const scope = getLogScope();

		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		try {
			const currentUser = await this.provider.config.getCurrentUser(repoPath);

			const parser = getCommitsLogParser(true);
			const args = [...parser.arguments];

			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`, '--use-mailmap');

			const { args: searchArgs, files, shas } = getGitArgsFromSearchQuery(search, currentUser);

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			if (shas == null) {
				// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
				({ stdin, stashes } = convertStashesToStdin(await this.provider.stash?.getStash(repoPath)));
			} else if (shas.size) {
				stdin = join(shas, '\n');

				if (!searchArgs.includes('--no-walk')) {
					args.push('--no-walk');
				}
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
				if (shas?.has(arg)) continue;

				args.push(arg);
			}

			const pathspec = files?.join(' ');
			const { commits, count, countStashChildCommits } = await parseCommits(
				this.container,
				parser,
				this.git.stream(
					{ cwd: repoPath, configs: ['-C', repoPath, ...gitLogDefaultConfigs], stdin: stdin },
					'log',
					...args,
					'--',
					...files,
				),
				repoPath,
				pathspec,
				limit,
				stashes,
				currentUser,
			);

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: undefined,
				count: commits.size,
				limit: limit,
				hasMore: count - countStashChildCommits > commits.size,
				query: (limit: number | undefined) =>
					this.searchCommits(repoPath, search, { ...options, limit: limit }),
			};

			if (log.hasMore) {
				function searchCommitsCore(
					this: CommitsGitSubProvider,
					log: GitLog,
				): (limit: number | undefined) => Promise<GitLog> {
					return async (limit: number | undefined) => {
						limit = limit ?? configuration.get('advanced.maxSearchItems') ?? 0;

						const moreLog = await this.searchCommits(log.repoPath, search, {
							...options,
							limit: limit,
							skip: log.count,
						});
						// If we can't find any more, assume we have everything
						if (moreLog == null) return { ...log, hasMore: false, more: undefined };

						const commits = new Map([...log.commits, ...moreLog.commits]);

						const mergedLog: GitLog = {
							repoPath: log.repoPath,
							commits: commits,
							sha: log.sha,
							count: commits.size,
							limit: (log.limit ?? 0) + limit,
							hasMore: moreLog.hasMore,
							query: (limit: number | undefined) =>
								this.searchCommits(log.repoPath, search, { ...options, limit: limit }),
						};
						if (mergedLog.hasMore) {
							mergedLog.more = searchCommitsCore.call(this, mergedLog);
						}

						return mergedLog;
					};
				}

				log.more = searchCommitsCore.call(this, log);
			}

			return log;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
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
		message.split('\n', 1)[0],
		c.parents ? c.parents.split(' ') : [],
		message,
		{
			files:
				c.files?.map(
					f =>
						new GitFileChange(
							container,
							repoPath,
							f.path,
							f.status as GitFileStatus,
							f.originalPath,
							undefined,
							{
								additions: f.additions ?? 0,
								deletions: f.deletions ?? 0,
								changes: 0,
							},
						),
				) ?? [],
			filtered: Boolean(pathspec),
			pathspec: pathspec,
		},
		c.stats,
		undefined,
		c.tips ? c.tips.split(' ') : undefined,
	);
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
): Promise<{ commits: Map<string, GitCommit>; count: number; countStashChildCommits: number }> {
	let count = 0;
	let countStashChildCommits = 0;
	const commits = new Map<string, GitCommit>();

	if (resultOrStream instanceof Promise) {
		const result = await resultOrStream;

		if (stashes?.size) {
			for (const c of parser.parse(result.stdout)) {
				count++;
				if (limit && count > limit) break;

				const stash = stashes?.get(c.sha);
				if (stash != null) {
					if (commits.has(stash.sha)) {
						countStashChildCommits++;
					} else {
						commits.set(stash.sha, stash.with({}));
					}
					continue;
				}

				commits.set(c.sha, createCommit(container, c, repoPath, pathspec, currentUser));
			}
		} else {
			for (const c of parser.parse(result.stdout)) {
				count++;
				if (limit && count > limit) break;

				commits.set(c.sha, createCommit(container, c, repoPath, pathspec, currentUser));
			}
		}

		return { commits: commits, count: count, countStashChildCommits: countStashChildCommits };
	}

	if (stashes?.size) {
		for await (const c of parser.parseAsync(resultOrStream)) {
			count++;
			if (limit && count > limit) break;

			const stash = stashes?.get(c.sha);
			if (stash != null) {
				if (commits.has(stash.sha)) {
					countStashChildCommits++;
				} else {
					commits.set(stash.sha, stash.with({}));
				}
				continue;
			}

			commits.set(c.sha, createCommit(container, c, repoPath, pathspec, currentUser));
		}
	} else {
		for await (const c of parser.parseAsync(resultOrStream)) {
			count++;
			if (limit && count > limit) break;

			commits.set(c.sha, createCommit(container, c, repoPath, pathspec, currentUser));
		}
	}

	return { commits: commits, count: count, countStashChildCommits: countStashChildCommits };
}
