import type { GitBlame } from '@gitkraken/provider-apis/providers';
import type { Range, Uri } from 'vscode';
import type { SearchQuery } from '../../../../../constants.search';
import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type { GitCommitsSubProvider, LeftRightCommitCountResult } from '../../../../../git/gitProvider';
import { GitUri } from '../../../../../git/gitUri';
import { GitCommit, GitCommitIdentity } from '../../../../../git/models/commit';
import type { ParsedGitDiffHunks } from '../../../../../git/models/diff';
import type { GitFile } from '../../../../../git/models/file';
import { GitFileChange } from '../../../../../git/models/fileChange';
import { GitFileIndexStatus } from '../../../../../git/models/fileStatus';
import type { GitLog } from '../../../../../git/models/log';
import type { GitRevisionRange } from '../../../../../git/models/revision';
import { deletedOrMissing } from '../../../../../git/models/revision';
import type { GitUser } from '../../../../../git/models/user';
import { parseSearchQuery } from '../../../../../git/search';
import { createUncommittedChangesCommit } from '../../../../../git/utils/-webview/commit.utils';
import { createRevisionRange, isUncommitted } from '../../../../../git/utils/revision.utils';
import { log } from '../../../../../system/decorators/log';
import { filterMap, first, last, some } from '../../../../../system/iterable';
import { Logger } from '../../../../../system/logger';
import type { LogScope } from '../../../../../system/logger.scope';
import { getLogScope } from '../../../../../system/logger.scope';
import { isFolderGlob } from '../../../../../system/path';
import type { CachedLog, TrackedGitDocument } from '../../../../../trackers/trackedDocument';
import { GitDocumentState } from '../../../../../trackers/trackedDocument';
import type { GitHubGitProviderInternal } from '../githubGitProvider';
import { stripOrigin } from '../githubGitProvider';
import { fromCommitFileStatus } from '../models';
import { getQueryArgsFromSearchQuery } from '../utils/-webview/search.utils';

const emptyPromise: Promise<GitBlame | ParsedGitDiffHunks | GitLog | undefined> = Promise.resolve(undefined);

export class CommitsGitSubProvider implements GitCommitsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@log()
	async getCommit(repoPath: string, rev: string): Promise<GitCommit | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			if (isUncommitted(rev, true)) {
				return createUncommittedChangesCommit(
					this.container,
					repoPath,
					rev,
					new Date(),
					await this.provider.config.getCurrentUser(repoPath),
				);
			}

			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const commit = await github.getCommit(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(rev),
			);
			if (commit == null) return undefined;

			const { viewer = session.account.label } = commit;
			const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
			const committerName = viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

			return new GitCommit(
				this.container,
				repoPath,
				commit.oid,
				new GitCommitIdentity(
					authorName,
					commit.author.email,
					new Date(commit.author.date),
					commit.author.avatarUrl,
				),
				new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
				commit.message.split('\n', 1)[0],
				commit.parents.nodes.map(p => p.oid),
				commit.message,
				{
					files:
						commit.files?.map(
							f =>
								new GitFileChange(
									this.container,
									repoPath,
									f.filename ?? '',
									fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
									f.previous_filename,
									undefined,
									{
										additions: f.additions ?? 0,
										deletions: f.deletions ?? 0,
										changes: f.changes ?? 0,
									},
								),
						) ?? [],
					filtered: false,
				},
				{
					files: commit.changedFiles ?? 0,
					additions: commit.additions ?? 0,
					deletions: commit.deletions ?? 0,
				},
				[],
			);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getCommitCount(repoPath: string, rev: string): Promise<number | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const count = await github.getCommitCount(
				session?.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(rev),
			);

			return count;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getCommitForFile(
		repoPath: string | undefined,
		uri: Uri,
		rev?: string | undefined,
		_options?: { firstIfNotFound?: boolean },
	): Promise<GitCommit | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, remotehub, session } = await this.provider.ensureRepositoryContext(repoPath);

			const file = this.provider.getRelativePath(uri, remotehub.getProviderRootUri(uri));

			rev = !rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev;
			const commit = await github.getCommitForFile(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(rev),
				file,
			);
			if (commit == null) return undefined;

			const { viewer = session.account.label } = commit;
			const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
			const committerName = viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

			return new GitCommit(
				this.container,
				repoPath,
				commit.oid,
				new GitCommitIdentity(
					authorName,
					commit.author.email,
					new Date(commit.author.date),
					commit.author.avatarUrl,
				),
				new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
				commit.message.split('\n', 1)[0],
				commit.parents.nodes.map(p => p.oid),
				commit.message,
				commit.files != null
					? {
							files: commit.files?.map(
								f =>
									new GitFileChange(
										this.container,
										repoPath,
										f.filename ?? '',
										fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
										f.previous_filename,
										undefined,
										{
											additions: f.additions ?? 0,
											deletions: f.deletions ?? 0,
											changes: f.changes ?? 0,
										},
									),
							),
							filtered: true,
							pathspec: file,
					  }
					: undefined,
				{
					files: commit.changedFiles ?? 0,
					additions: commit.additions ?? 0,
					deletions: commit.deletions ?? 0,
				},
				[],
			);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getCommitFileStatus(repoPath: string, uri: Uri, rev: string): Promise<GitFile | undefined> {
		if (rev === deletedOrMissing || isUncommitted(rev)) return undefined;

		const commit = await this.getCommitForFile(repoPath, uri, rev);
		if (commit == null) return undefined;

		return commit.findFile(uri);
	}

	@log()
	async getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		_options?: { authors?: GitUser[] | undefined; excludeMerges?: boolean },
	): Promise<LeftRightCommitCountResult | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(range),
			);

			if (result == null) return undefined;

			return {
				left: result.behind_by,
				right: result.ahead_by,
			};
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
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
			since?: string;
		},
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const limit = this.provider.getPagingLimit(options?.limit);

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			rev = !rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev;
			const result = await github.getCommits(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(rev),
				{
					all: options?.all,
					authors: options?.authors,
					after: options?.cursor,
					limit: limit,
					since: options?.since ? new Date(options.since) : undefined,
				},
			);

			const commits = new Map<string, GitCommit>();

			const { viewer = session.account.label } = result;
			for (const commit of result.values) {
				const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
				const committerName =
					viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

				let c = commits.get(commit.oid);
				if (c == null) {
					c = new GitCommit(
						this.container,
						repoPath,
						commit.oid,
						new GitCommitIdentity(
							authorName,
							commit.author.email,
							new Date(commit.author.date),
							commit.author.avatarUrl,
						),
						new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
						commit.message.split('\n', 1)[0],
						commit.parents.nodes.map(p => p.oid),
						commit.message,
						commit.files != null
							? {
									files: commit.files.map(
										f =>
											new GitFileChange(
												this.container,
												repoPath,
												f.filename ?? '',
												fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
												f.previous_filename,
												undefined,
												{
													additions: f.additions ?? 0,
													deletions: f.deletions ?? 0,
													changes: f.changes ?? 0,
												},
											),
									),
									filtered: false,
							  }
							: undefined,
						{
							files: commit.changedFiles ?? 0,
							additions: commit.additions ?? 0,
							deletions: commit.deletions ?? 0,
						},
						[],
					);
					commits.set(commit.oid, c);
				}
			}

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: rev,
				range: undefined,
				count: commits.size,
				limit: limit,
				hasMore: result.paging?.more ?? false,
				endingCursor: result.paging?.cursor,
				query: (limit: number | undefined) => this.getLog(repoPath, rev, { ...options, limit: limit }),
			};

			if (log.hasMore) {
				log.more = this.getLogMoreFn(log, rev, options);
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
		// TODO@eamodio optimize this
		const result = await this.getLog(repoPath, rev, options);
		if (result == null) return undefined;

		return new Set([...result.commits.values()].map(c => c.ref));
	}

	private getLogMoreFn(
		log: GitLog,
		rev: string | undefined,
		options?: {
			authors?: GitUser[];
			limit?: number;
			merges?: boolean | 'first-parent';
			ordering?: 'date' | 'author-date' | 'topo' | null;
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = this.provider.getPagingLimit(moreLimit);

			// // If the log is for a range, then just get everything prior + more
			// if (isRange(log.sha)) {
			// 	const moreLog = await this.getLog(log.repoPath, {
			// 		...options,
			// 		limit: moreLimit === 0 ? 0 : (options?.limit ?? 0) + moreLimit,
			// 	});
			// 	// If we can't find any more, assume we have everything
			// 	if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			// 	return moreLog;
			// }

			// const ref = Iterables.last(log.commits.values())?.ref;
			// const moreLog = await this.getLog(log.repoPath, {
			// 	...options,
			// 	limit: moreUntil == null ? moreLimit : 0,
			// 	ref: moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^`,
			// });
			// // If we can't find any more, assume we have everything
			// if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const moreLog = await this.getLog(log.repoPath, rev, {
				...options,
				limit: moreLimit,
				cursor: log.endingCursor,
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const commits = new Map([...log.commits, ...moreLog.commits]);

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
				query: log.query,
			};
			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogMoreFn(mergedLog, rev, options);
			}

			return mergedLog;
		};
	}

	@log()
	async getLogForPath(
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

		options = { reverse: false, ...options };

		// Not currently supported
		options.renames = false;
		options.all = false;

		// if (options.renames == null) {
		// 	options.renames = configuration.get('advanced.fileHistoryFollowsRenames');
		// }

		let key = 'log';
		if (rev != null) {
			key += `:${rev}`;
		}

		// if (options.all == null) {
		// 	options.all = configuration.get('advanced.fileHistoryShowAllBranches');
		// }
		// if (options.all) {
		// 	key += ':all';
		// }

		options.limit = this.provider.getPagingLimit(options?.limit);
		if (options.limit) {
			key += `:n${options.limit}`;
		}

		if (options.ordering) {
			key += `:ordering=${options.ordering}`;
		}

		if (options.renames) {
			key += ':follow';
		}

		if (options.reverse) {
			key += ':reverse';
		}

		if (options.since) {
			key += `:since=${options.since}`;
		}

		if (options.skip) {
			key += `:skip${options.skip}`;
		}

		const useCache = options.cursor == null && options.range == null;

		const doc = await this.container.documentTracker.getOrAdd(GitUri.fromFile(relativePath, repoPath, rev));
		if (useCache) {
			if (doc.state != null) {
				const cachedLog = doc.state.getLog(key);
				if (cachedLog != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedLog.item;
				}

				if (rev != null || options.limit != null) {
					// Since we are looking for partial log, see if we have the log of the whole file
					const cachedLog = doc.state.getLog(
						`log${options.renames ? ':follow' : ''}${options.reverse ? ':reverse' : ''}`,
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
										if (options?.limit != null && i > options.limit) {
											return undefined;
										}

										return [sha, c];
									},
								),
							);

							const opts = { ...options };
							log = {
								...log,
								limit: options.limit,
								count: commits.size,
								commits: commits,
								query: (limit: number | undefined) =>
									this.getLogForPath(repoPath, pathOrUri, rev, { ...opts, limit: limit }),
							};

							return log;
						}
					}
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			doc.state ??= new GitDocumentState();
		}

		const promise = this.getLogForPathCore(repoPath, relativePath, rev, doc, key, scope, options);

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
		document: TrackedGitDocument,
		key: string,
		scope: LogScope | undefined,
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

		const limit = this.provider.getPagingLimit(options?.limit);

		try {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;
			const { metadata, github, remotehub, session } = context;

			const uri = this.provider.getAbsoluteUri(path, repoPath);
			const relativePath = this.provider.getRelativePath(uri, remotehub.getProviderRootUri(uri));

			// if (range != null && range.start.line > range.end.line) {
			// 	range = new Range(range.end, range.start);
			// }

			rev = !rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev;
			const result = await github.getCommits(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(rev),
				{
					all: options?.all,
					after: options?.cursor,
					path: relativePath,
					limit: limit,
					since: options?.since ? new Date(options.since) : undefined,
				},
			);

			const commits = new Map<string, GitCommit>();

			const { viewer = session.account.label } = result;
			for (const commit of result.values) {
				const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
				const committerName =
					viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

				let c = commits.get(commit.oid);
				if (c == null) {
					const files = commit.files?.map(
						f =>
							new GitFileChange(
								this.container,
								repoPath,
								f.filename ?? '',
								fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
								f.previous_filename,
								undefined,
								{ additions: f.additions ?? 0, deletions: f.deletions ?? 0, changes: f.changes ?? 0 },
							),
					);

					if (files != null && !isFolderGlob(relativePath) && commit.changedFiles === 1) {
						const index = files.findIndex(f => f.path === relativePath);
						if (index !== -1) {
							files.splice(
								index,
								1,
								new GitFileChange(
									this.container,
									repoPath,
									relativePath,
									GitFileIndexStatus.Modified,
									undefined,
									undefined,
									commit.changedFiles === 1
										? {
												additions: commit.additions ?? 0,
												deletions: commit.deletions ?? 0,
												changes: 0,
										  }
										: undefined,
								),
							);
						}
					}

					c = new GitCommit(
						this.container,
						repoPath,
						commit.oid,
						new GitCommitIdentity(
							authorName,
							commit.author.email,
							new Date(commit.author.date),
							commit.author.avatarUrl,
						),
						new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
						commit.message.split('\n', 1)[0],
						commit.parents.nodes.map(p => p.oid),
						commit.message,
						files != null ? { files: files, filtered: true, pathspec: relativePath } : undefined,
						{
							files: commit.changedFiles ?? 0,
							additions: commit.additions ?? 0,
							deletions: commit.deletions ?? 0,
						},
						[],
					);
					commits.set(commit.oid, c);
				}
			}

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: rev,
				range: undefined,
				count: commits.size,
				limit: limit,
				hasMore: result.paging?.more ?? false,
				endingCursor: result.paging?.cursor,
				query: (limit: number | undefined) =>
					this.getLogForPath(repoPath, path, rev, { ...options, limit: limit }),
			};
			if (log.hasMore) {
				log.more = this.getLogForPathMoreFn(log, path, rev, options);
			}

			return log;
		} catch (ex) {
			debugger;
			// Trap and cache expected log errors
			if (document.state != null && options?.range == null && !options?.reverse) {
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

	private getLogForPathMoreFn(
		log: GitLog,
		relativePath: string,
		rev: string | undefined,
		options?: {
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

			moreLimit = this.provider.getPagingLimit(moreLimit);

			// const sha = Iterables.last(log.commits.values())?.ref;
			const moreLog = await this.getLogForPath(
				log.repoPath,
				relativePath,
				rev /* options.all ? undefined : moreUntil == null ? `${sha}^` : `${moreUntil}^..${sha}^ */,
				{
					...options,
					limit: moreUntil == null ? moreLimit : 0,
					cursor: log.endingCursor,
					// skip: options.all ? log.count : undefined,
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
				endingCursor: moreLog.endingCursor,
				query: log.query,
			};

			// if (options.renames) {
			// 	const renamed = find(
			// 		moreLog.commits.values(),
			// 		c => Boolean(c.file?.originalPath) && c.file?.originalPath !== fileName,
			// 	);
			// 	fileName = renamed?.file?.originalPath ?? fileName;
			// }

			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogForPathMoreFn(mergedLog, relativePath, rev, options);
			}

			return mergedLog;
		};
	}

	@log()
	getOldestUnpushedShaForPath(_repoPath: string, _pathOrUri: string | Uri): Promise<string | undefined> {
		// TODO@eamodio until we have access to the RemoteHub change store there isn't anything we can do here
		return Promise.resolve(undefined);
	}

	@log()
	hasCommitBeenPushed(_repoPath: string, _rev: string): Promise<boolean> {
		// In this env we can't have unpushed commits
		return Promise.resolve(true);
	}

	@log()
	async isAncestorOf(repoPath: string, rev1: string, rev2: string): Promise<boolean> {
		if (repoPath == null) return false;

		const scope = getLogScope();

		const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				createRevisionRange(stripOrigin(rev1), stripOrigin(rev2), '...'),
			);

			switch (result?.status) {
				case 'ahead':
				case 'diverged':
					return false;
				case 'identical':
				case 'behind':
					return true;
				default:
					return false;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return false;
		}
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
		options?: { cursor?: string; limit?: number; ordering?: 'date' | 'author-date' | 'topo' | null; skip?: number },
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const operations = parseSearchQuery(search);

		const values = operations.get('commit:');
		if (values?.size) {
			const commit = await this.getCommit(repoPath, first(values)!);
			if (commit == null) return undefined;

			return {
				repoPath: repoPath,
				commits: new Map([[commit.sha, commit]]),
				sha: commit.sha,
				range: undefined,
				count: 1,
				limit: 1,
				hasMore: false,
			};
		}

		const queryArgs = await getQueryArgsFromSearchQuery(this.provider, search, operations, repoPath);
		if (queryArgs.length === 0) return undefined;

		const limit = this.provider.getPagingLimit(options?.limit);

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const query = `repo:${metadata.repo.owner}/${metadata.repo.name}+${queryArgs.join('+').trim()}`;

			const result = await github.searchCommits(session.accessToken, query, {
				cursor: options?.cursor,
				limit: limit,
				sort:
					options?.ordering === 'date'
						? 'committer-date'
						: options?.ordering === 'author-date'
						  ? 'author-date'
						  : undefined,
			});
			if (result == null) return undefined;

			const commits = new Map<string, GitCommit>();

			const viewer = session.account.label;
			for (const commit of result.values) {
				const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
				const committerName =
					viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

				let c = commits.get(commit.oid);
				if (c == null) {
					c = new GitCommit(
						this.container,
						repoPath,
						commit.oid,
						new GitCommitIdentity(
							authorName,
							commit.author.email,
							new Date(commit.author.date),
							commit.author.avatarUrl,
						),
						new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
						commit.message.split('\n', 1)[0],
						commit.parents.nodes.map(p => p.oid),
						commit.message,
						commit.files != null
							? {
									files: commit.files.map(
										f =>
											new GitFileChange(
												this.container,
												repoPath,
												f.filename ?? '',
												fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
												f.previous_filename,
												undefined,
												{
													additions: f.additions ?? 0,
													deletions: f.deletions ?? 0,
													changes: f.changes ?? 0,
												},
											),
									),
									filtered: false,
							  }
							: undefined,
						{
							files: commit.changedFiles ?? 0,
							additions: commit.additions ?? 0,
							deletions: commit.deletions ?? 0,
						},
						[],
					);
					commits.set(commit.oid, c);
				}
			}

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: undefined,
				range: undefined,
				count: commits.size,
				limit: limit,
				hasMore: result.pageInfo?.hasNextPage ?? false,
				endingCursor: result.pageInfo?.endCursor ?? undefined,
				query: (limit: number | undefined) => this.getLog(repoPath, undefined, { ...options, limit: limit }),
			};

			if (log.hasMore) {
				function searchCommitsCore(
					this: CommitsGitSubProvider,
					log: GitLog,
				): (limit: number | undefined) => Promise<GitLog> {
					return async (limit: number | undefined) => {
						limit = this.provider.getPagingLimit(limit);

						const moreLog = await this.searchCommits(log.repoPath, search, {
							...options,
							limit: limit,
							cursor: log.endingCursor,
						});
						// If we can't find any more, assume we have everything
						if (moreLog == null) return { ...log, hasMore: false, more: undefined };

						const commits = new Map([...log.commits, ...moreLog.commits]);

						const mergedLog: GitLog = {
							repoPath: log.repoPath,
							commits: commits,
							sha: log.sha,
							range: undefined,
							count: commits.size,
							limit: (log.limit ?? 0) + limit,
							hasMore: moreLog.hasMore,
							endingCursor: moreLog.endingCursor,
							query: log.query,
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
			debugger;
			return undefined;
		}

		return undefined;
	}
}
