import type { Uri } from 'vscode';
import { Range } from 'vscode';
import type { SearchQuery } from '../../../../constants.search';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import type { GitCommitsSubProvider, LeftRightCommitCountResult } from '../../../../git/gitProvider';
import { GitUri } from '../../../../git/gitUri';
import type { GitBlame } from '../../../../git/models/blame';
import type { GitCommit, GitStashCommit } from '../../../../git/models/commit';
import type { GitDiffFile } from '../../../../git/models/diff';
import type { GitFile } from '../../../../git/models/file';
import { GitFileChange } from '../../../../git/models/fileChange';
import type { GitFileStatus } from '../../../../git/models/fileStatus';
import type { GitLog } from '../../../../git/models/log';
import type { GitRevisionRange } from '../../../../git/models/revision';
import { deletedOrMissing } from '../../../../git/models/revision';
import type { GitUser } from '../../../../git/models/user';
import { parseGitDiffNameStatusFiles } from '../../../../git/parsers/diffParser';
import {
	createLogParserSingle,
	createLogParserWithFilesAndStats,
	LogType,
	parseGitLog,
	parseGitLogAllFormat,
	parseGitLogDefaultFormat,
} from '../../../../git/parsers/logParser';
import { getGitArgsFromSearchQuery } from '../../../../git/search';
import { isRevisionRange, isSha, isUncommitted } from '../../../../git/utils/revision.utils';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { log } from '../../../../system/decorators/log';
import { filterMap, find, first, join, last, map, skip, some } from '../../../../system/iterable';
import { Logger } from '../../../../system/logger';
import type { LogScope } from '../../../../system/logger.scope';
import { getLogScope } from '../../../../system/logger.scope';
import { isFolderGlob } from '../../../../system/path';
import type { CachedLog, TrackedGitDocument } from '../../../../trackers/trackedDocument';
import { GitDocumentState } from '../../../../trackers/trackedDocument';
import type { Git } from '../git';
import { gitLogDefaultConfigsWithFiles } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

const emptyPromise: Promise<GitBlame | GitDiffFile | GitLog | undefined> = Promise.resolve(undefined);

export class CommitsGitSubProvider implements GitCommitsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	private get useCaching() {
		return configuration.get('advanced.caching.enabled');
	}

	@log()
	async getCommit(repoPath: string, rev: string): Promise<GitCommit | undefined> {
		const log = await this.getLog(repoPath, rev, { limit: 2 });
		if (log == null) return undefined;

		return log.commits.get(rev) ?? first(log.commits.values());
	}

	@log({ exit: true })
	getCommitCount(repoPath: string, rev: string): Promise<number | undefined> {
		return this.git.rev_list__count(repoPath, rev);
	}

	@log()
	async getCommitFilesStats(repoPath: string, rev: string): Promise<GitFileChange[] | undefined> {
		const parser = createLogParserWithFilesAndStats<{ sha: string }>({ sha: '%H' });

		const data = await this.git.log(repoPath, rev, undefined, '--max-count=1', ...parser.arguments);
		if (data == null) return undefined;

		let files: GitFileChange[] | undefined;

		for (const c of parser.parse(data)) {
			files = c.files.map(
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
			break;
		}

		return files;
	}

	@log()
	async getCommitFileStatus(repoPath: string, uri: Uri, rev: string): Promise<GitFile | undefined> {
		if (rev === deletedOrMissing || isUncommitted(rev)) return undefined;

		const [relativePath, root] = splitPath(uri, repoPath);

		// Don't include the filename, as renames won't be returned
		const data = await this.git.show(root, undefined, '--name-status', '--format=', '-z', rev, '--');
		if (!data) return undefined;

		const files = parseGitDiffNameStatusFiles(data, repoPath);
		if (files == null || files.length === 0) return undefined;

		const file = files.find(f => f.path === relativePath || f.originalPath === relativePath);
		return file;
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
			const log = await this.getLogForFile(root, relativePath, rev, { limit: 2 });
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

	@log({ exit: true })
	async getInitialCommitSha(repoPath: string): Promise<string | undefined> {
		try {
			const data = await this.git.rev_list(repoPath, 'HEAD', { maxParents: 0 });
			return data?.[0];
		} catch {
			return undefined;
		}
	}

	@log()
	getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		options?: { authors?: GitUser[] | undefined; excludeMerges?: boolean },
	): Promise<LeftRightCommitCountResult | undefined> {
		return this.git.rev_list__left_right(repoPath, range, options?.authors, options?.excludeMerges);
	}

	@log()
	async getLog(
		repoPath: string,
		rev?: string | undefined,
		options?: {
			all?: boolean;
			authors?: GitUser[];
			cursor?: string;
			limit?: number;
			merges?: boolean | 'first-parent';
			ordering?: 'date' | 'author-date' | 'topo' | null;
			since?: number | string;
			stashes?: boolean | Map<string, GitStashCommit>;
			status?: boolean;
			until?: number | string;
			extraArgs?: string[];
		},
	): Promise<GitLog | undefined> {
		const scope = getLogScope();

		try {
			const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;
			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			const args = [
				`--format=${options?.all ? parseGitLogAllFormat : parseGitLogDefaultFormat}`,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
			];

			if (options?.status !== false) {
				args.push('--name-status', '--full-history');
			}
			if (options?.all) {
				args.push('--all');
			}

			const merges = options?.merges ?? true;
			if (merges) {
				if (limit <= 2) {
					// Ensure we return the merge commit files when we are asking for a specific ref
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
				args.push('--use-mailmap', ...options.authors.map(a => `--author=^${a.name} <${a.email}>$`));
			}

			let hasMoreOverride;

			if (options?.since) {
				hasMoreOverride = true;
				args.push(`--since="${options.since}"`);
			}
			if (options?.until) {
				hasMoreOverride = true;
				args.push(`--until="${options.until}"`);
			}
			if (options?.extraArgs?.length) {
				if (
					options.extraArgs.some(
						arg => arg.startsWith('-n') || arg.startsWith('--until=') || arg.startsWith('--since='),
					)
				) {
					hasMoreOverride = true;
				}
				args.push(...options.extraArgs);
			}

			if (limit) {
				hasMoreOverride = undefined;
				args.push(`-n${limit + 1}`);
			}

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			if (options?.stashes) {
				if (typeof options.stashes === 'boolean') {
					// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
					const gitStash = await this.provider.stash?.getStash(repoPath, { reachableFrom: rev });
					stashes = new Map(gitStash?.stashes);
					if (gitStash?.stashes.size) {
						stdin = '';
						for (const stash of gitStash.stashes.values()) {
							stdin += `${stash.sha.substring(0, 9)}\n`;
							// Include the stash's 2nd (index files) and 3rd (untracked files) parents
							for (const p of skip(stash.parents, 1)) {
								stashes.set(p, stash);
								stdin += `${p.substring(0, 9)}\n`;
							}
						}
					}
					rev ??= 'HEAD';
				} else {
					stashes = options.stashes;
					stdin = join(
						map(stashes.values(), c => c.sha.substring(0, 9)),
						'\n',
					);
					rev ??= 'HEAD';
				}
			}

			const data = await this.git.log(
				repoPath,
				rev,
				{ configs: gitLogDefaultConfigsWithFiles, stdin: stdin },
				...args,
			);

			const log = parseGitLog(
				this.container,
				data,
				LogType.Log,
				repoPath,
				undefined,
				rev,
				await this.provider.getCurrentUser(repoPath),
				limit,
				false,
				undefined,
				stashes,
				undefined,
				hasMoreOverride,
			);

			if (log != null) {
				log.query = (limit: number | undefined) => this.getLog(repoPath, rev, { ...options, limit: limit });
				if (log.hasMore) {
					let opts;
					if (options != null) {
						let _;
						({ extraArgs: _, ...opts } = options);
					}
					log.more = this.getLogMoreFn(log, opts);
				}
			}

			return log;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getLogShasOnly(
		repoPath: string,
		rev?: string | undefined,
		options?: {
			authors?: GitUser[];
			cursor?: string;
			limit?: number;
			merges?: boolean | 'first-parent';
			ordering?: 'date' | 'author-date' | 'topo' | null;
			since?: string;
		},
	): Promise<Set<string> | undefined> {
		const scope = getLogScope();

		const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;

		try {
			const parser = createLogParserSingle('%H');
			const args = [...parser.arguments, '--full-history'];

			const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			if (limit) {
				args.push(`-n${limit + 1}`);
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

			const data = await this.git.log(repoPath, rev, undefined, ...args);

			const commits = new Set(parser.parse(data));
			return commits;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	private getLogMoreFn(
		log: GitLog,
		rev: string | undefined,
		options?: {
			all?: boolean;
			authors?: GitUser[];
			limit?: number;
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
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
				const moreLog = await this.getLog(log.repoPath, rev, {
					...options,
					limit: moreLimit === 0 ? 0 : (options?.limit ?? 0) + moreLimit,
				});
				// If we can't find any more, assume we have everything
				if (moreLog == null) return { ...log, hasMore: false, more: undefined };

				return moreLog;
			}

			const lastCommit = last(log.commits.values());
			const sha = lastCommit?.ref;

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
				const moreLog = await this.getLog(
					log.repoPath,
					timestamp ? rev : moreUntil == null ? `${sha}^` : `${moreUntil}^..${sha}^`,
					{
						...options,
						limit: queryLimit,
						...(timestamp ? { until: timestamp, extraArgs: ['--boundary'] } : undefined),
					},
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
					range: undefined,
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
					query: (limit: number | undefined) => this.getLog(log.repoPath, rev, { ...options, limit: limit }),
				};
				if (mergedLog.hasMore) {
					mergedLog.more = this.getLogMoreFn(mergedLog, rev, options);
				}

				return mergedLog;
			} while (true);
		};
	}

	@log()
	async getLogForFile(
		repoPath: string | undefined,
		pathOrUri: string | Uri,
		rev?: string | undefined,
		options?: {
			all?: boolean;
			cursor?: string;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		if (repoPath != null && repoPath === relativePath) {
			throw new Error(`File name cannot match the repository path; path=${relativePath}`);
		}

		const opts: typeof options & Parameters<CommitsGitSubProvider['getLogForFileCore']>[6] = {
			reverse: false,
			...options,
		};

		if (opts.renames == null) {
			opts.renames = configuration.get('advanced.fileHistoryFollowsRenames');
		}

		if (opts.merges == null) {
			opts.merges = configuration.get('advanced.fileHistoryShowMergeCommits');
		}

		let key = 'log';
		if (rev != null) {
			key += `:${rev}`;
		}

		if (opts.all == null) {
			opts.all = configuration.get('advanced.fileHistoryShowAllBranches');
		}
		if (opts.all) {
			key += ':all';
		}

		opts.limit = opts.limit ?? configuration.get('advanced.maxListItems') ?? 0;
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

		if (opts.reverse) {
			key += ':reverse';
		}

		if (opts.since) {
			key += `:since=${opts.since}`;
		}

		if (opts.skip) {
			key += `:skip${opts.skip}`;
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
					const cachedLog = doc.state.getLog(
						`log${opts.renames ? ':follow' : ''}${opts.reverse ? ':reverse' : ''}`,
					);
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
									this.getLogForFile(repoPath, pathOrUri, rev, { ...optsCopy, limit: limit }),
							};

							return log;
						}
					}
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			doc.state ??= new GitDocumentState();
		}

		const promise = this.getLogForFileCore(repoPath, relativePath, rev, doc, key, scope, opts);

		if (useCache && doc.state != null) {
			Logger.debug(scope, `Cache add: '${key}'`);

			const value: CachedLog = {
				item: promise as Promise<GitLog>,
			};
			doc.state.setLog(key, value);
		}

		return promise;
	}

	private async getLogForFileCore(
		repoPath: string | undefined,
		path: string,
		rev: string | undefined,
		document: TrackedGitDocument,
		key: string,
		scope: LogScope | undefined,
		{
			range,
			...options
		}: {
			all?: boolean;
			cursor?: string;
			limit?: number;
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
	): Promise<GitLog | undefined> {
		const paths = await (this.provider as any).isTrackedWithDetails(path, repoPath, rev);
		if (paths == null) {
			Logger.log(scope, `Skipping log; '${path}' is not tracked`);
			return emptyPromise as Promise<GitLog>;
		}

		const [relativePath, root] = paths;

		try {
			if (range != null && range.start.line > range.end.line) {
				range = new Range(range.end, range.start);
			}

			let data = await this.git.log__file(root, relativePath, rev, {
				ordering: configuration.get('advanced.commitOrdering'),
				...options,
				startLine: range == null ? undefined : range.start.line + 1,
				endLine: range == null ? undefined : range.end.line + 1,
			});

			// If we didn't find any history from the working tree, check to see if the file was renamed
			if (!data && rev == null) {
				const status = await this.provider.status?.getStatusForFile(root, relativePath);
				if (status?.originalPath != null) {
					data = await this.git.log__file(root, status.originalPath, rev, {
						ordering: configuration.get('advanced.commitOrdering'),
						...options,
						startLine: range == null ? undefined : range.start.line + 1,
						endLine: range == null ? undefined : range.end.line + 1,
					});
				}
			}

			const log = parseGitLog(
				this.container,
				data,
				// If this is the log of a folder, parse it as a normal log rather than a file log
				isFolderGlob(relativePath) ? LogType.Log : LogType.LogFile,
				root,
				relativePath,
				rev,
				await this.provider.getCurrentUser(root),
				options.limit,
				options.reverse ?? false,
				range,
			);

			if (log != null) {
				const opts = { ...options, range: range };
				log.query = (limit: number | undefined) =>
					this.getLogForFile(repoPath, path, rev, { ...opts, limit: limit });
				if (log.hasMore) {
					log.more = this.getLogForFileMoreFn(log, path, rev, opts);
				}
			}

			return log;
		} catch (ex) {
			// Trap and cache expected log errors
			if (document.state != null && range == null && !options.reverse) {
				const msg: string = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedLog = {
					item: emptyPromise as Promise<GitLog>,
					errorMessage: msg,
				};
				document.state.setLog(key, value);

				return emptyPromise as Promise<GitLog>;
			}

			return undefined;
		}
	}

	private getLogForFileMoreFn(
		log: GitLog,
		relativePath: string,
		rev: string | undefined,
		options: {
			all?: boolean;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			renames?: boolean;
			reverse?: boolean;
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? configuration.get('advanced.maxSearchItems') ?? 0;

			const commit = last(log.commits.values());
			let sha;
			if (commit != null) {
				sha = commit.ref;
				// Check to make sure the filename hasn't changed and if it has use the previous
				if (commit.file != null) {
					const path = commit.file.originalPath ?? commit.file.path;
					if (path !== relativePath) {
						relativePath = path;
					}
				}
			}
			const moreLog = await this.getLogForFile(
				log.repoPath,
				relativePath,
				options.all ? undefined : moreUntil == null ? `${sha}^` : `${moreUntil}^..${sha}^`,
				{
					...options,
					limit: moreUntil == null ? moreLimit : 0,
					skip: options.all ? log.count : undefined,
				},
			);
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				commits: commits,
				sha: log.sha,
				range: log.range,
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				query: (limit: number | undefined) =>
					this.getLogForFile(log.repoPath, relativePath, rev, { ...options, limit: limit }),
			};

			if (options.renames) {
				const renamed = find(
					moreLog.commits.values(),
					c => Boolean(c.file?.originalPath) && c.file?.originalPath !== relativePath,
				);
				relativePath = renamed?.file?.originalPath ?? relativePath;
			}

			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogForFileMoreFn(mergedLog, relativePath, rev, options);
			}

			return mergedLog;
		};
	}

	@log()
	async getOldestUnpushedShaForFile(repoPath: string, uri: Uri): Promise<string | undefined> {
		const [relativePath, root] = splitPath(uri, repoPath);

		const data = await this.git.log__file(root, relativePath, '@{u}..', {
			argsOrFormat: ['-z', '--format=%H'],
			fileMode: 'none',
			ordering: configuration.get('advanced.commitOrdering'),
			renames: true,
		});
		if (!data) return undefined;

		// -2 to skip the ending null
		const index = data.lastIndexOf('\0', data.length - 2);
		return index === -1 ? undefined : data.slice(index + 1, data.length - 2);
	}

	@log()
	async hasCommitBeenPushed(repoPath: string, rev: string): Promise<boolean> {
		if (repoPath == null) return false;

		return this.git.merge_base__is_ancestor(repoPath, rev, '@{u}');
	}

	@log()
	async isAncestorOf(repoPath: string, rev1: string, rev2: string): Promise<boolean> {
		if (repoPath == null) return false;

		return this.git.merge_base__is_ancestor(repoPath, rev1, rev2);
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
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' | null; skip?: number },
	): Promise<GitLog | undefined> {
		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		try {
			const limit = options?.limit ?? configuration.get('advanced.maxSearchItems') ?? 0;
			const similarityThreshold = configuration.get('advanced.similarityThreshold');

			const currentUser = await this.provider.getCurrentUser(repoPath);

			const { args, files, shas } = getGitArgsFromSearchQuery(search, currentUser);

			args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`, '--');
			if (files.length !== 0) {
				args.push(...files);
			}

			const includeOnlyStashes = args.includes('--no-walk');

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			if (shas == null) {
				// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
				const gitStash = await this.provider.stash?.getStash(repoPath);
				if (gitStash?.stashes.size) {
					stdin = '';
					stashes = new Map(gitStash.stashes);
					for (const stash of gitStash.stashes.values()) {
						stdin += `${stash.sha.substring(0, 9)}\n`;
						// Include the stash's 2nd (index files) and 3rd (untracked files) parents
						for (const p of skip(stash.parents, 1)) {
							stashes.set(p, stash);
							stdin += `${p.substring(0, 9)}\n`;
						}
					}
				}
			}

			const data = await this.git.log__search(repoPath, shas?.size ? undefined : args, {
				ordering: configuration.get('advanced.commitOrdering'),
				...options,
				limit: limit,
				shas: shas,
				stdin: stdin,
			});
			const log = parseGitLog(
				this.container,
				data,
				LogType.Log,
				repoPath,
				undefined,
				undefined,
				currentUser,
				limit,
				false,
				undefined,
				stashes,
				includeOnlyStashes,
			);

			if (log != null) {
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
							range: log.range,
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

				log.query = (limit: number | undefined) =>
					this.searchCommits(repoPath, search, { ...options, limit: limit });
				if (log.hasMore) {
					log.more = searchCommitsCore.call(this, log);
				}
			}

			return log;
		} catch (_ex) {
			return undefined;
		}
	}
}
