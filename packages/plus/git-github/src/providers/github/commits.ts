import type { Cache } from '@gitlens/git/cache.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GitRevisionRange } from '@gitlens/git/models/revision.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type {
	GitCommitsSubProvider,
	GitLogForPathOptions,
	GitLogOptions,
	GitLogShasOptions,
	GitSearchCommitsOptions,
	LeftRightCommitCountResult,
	SearchCommitsResult,
} from '@gitlens/git/providers/commits.js';
import { createUncommittedChangesCommit } from '@gitlens/git/utils/commit.utils.js';
import { createRevisionRange, isUncommitted, stripOrigin } from '@gitlens/git/utils/revision.utils.js';
import { parseSearchQueryGitHubCommand } from '@gitlens/git/utils/search.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { first, last, map, some } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { isFolderGlob, normalizePath, stripFolderGlob } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { coerceUri, joinUriPath } from '@gitlens/utils/uri.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import type { GitHubCommit } from '../../models.js';
import { fromCommitFileStatus } from '../../models.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

export class CommitsGitSubProvider implements GitCommitsSubProvider {
	constructor(
		private readonly cache: Cache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@debug()
	async getCommit(repoPath: string, rev: string, _cancellation?: AbortSignal): Promise<GitCommit | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		try {
			if (isUncommitted(rev, true)) {
				return createUncommittedChangesCommit(
					repoPath,
					rev,
					new Date(),
					await this.provider.config.getCurrentUser(repoPath),
				);
			}

			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const commit = await github.getCommit(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(rev),
			);
			if (commit == null) return undefined;

			const repoUri = coerceUri(repoPath);

			const { viewer = session.account.label } = commit;
			const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
			const committerName = viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

			return new GitCommit(
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
					files: commit.files?.map(f => toFileChange(repoUri, repoPath, f)),
				},
				{
					files: commit.changedFiles ?? 0,
					additions: commit.additions ?? 0,
					deletions: commit.deletions ?? 0,
				},
				[],
			);
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}

	@debug()
	async getCommitCount(repoPath: string, rev: string, _cancellation?: AbortSignal): Promise<number | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const count = await github.getCommitCount(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(rev),
			);

			return count;
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}

	@debug()
	async getCommitFiles(repoPath: string, rev: string, _cancellation?: AbortSignal): Promise<GitFileChange[]> {
		if (rev === deletedOrMissing || isUncommitted(rev)) return [];

		const commit = await this.getCommit(repoPath, rev);
		return [...(commit?.fileset?.files ?? [])];
	}

	@debug()
	async getCommitForFile(
		repoPath: string,
		pathOrUri: string | Uri,
		rev?: string | undefined,
		_options?: { firstIfNotFound?: boolean },
		_cancellation?: AbortSignal,
	): Promise<GitCommit | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const rootUri = this.provider.getProviderRootUri(this.provider.getAbsoluteUri(pathOrUri, repoPath));
			const file = this.provider.getRelativePath(this.provider.getAbsoluteUri(pathOrUri, repoPath), rootUri);

			rev = !rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev;
			const commit = await github.getCommitForFile(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(rev),
				file,
			);
			if (commit == null) return undefined;

			const repoUri = coerceUri(repoPath);
			const { viewer = session.account.label } = commit;
			const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
			const committerName = viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

			return new GitCommit(
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
							files: undefined,
							filtered: {
								files: commit.files?.map(f => toFileChange(repoUri, repoPath, f)),
								pathspec: file,
							},
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
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}

	@debug()
	async getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		_options?: { authors?: GitUser[]; excludeMerges?: boolean },
		_cancellation?: AbortSignal,
	): Promise<LeftRightCommitCountResult | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				toTokenInfo(this.provider.authenticationProviderId, session),
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
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}

	@debug()
	async getLog(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogOptions,
		_cancellation?: AbortSignal,
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		const limit = this.provider.getPagingLimit(options?.limit);

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			rev = !rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev;
			const result = await github.getCommits(
				toTokenInfo(this.provider.authenticationProviderId, session),
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
			const repoUri = coerceUri(repoPath);

			const { viewer = session.account.label } = result;
			for (const commit of result.values) {
				const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
				const committerName =
					viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

				let c = commits.get(commit.oid);
				if (c == null) {
					c = new GitCommit(
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
									files: commit.files.map(f => toFileChange(repoUri, repoPath, f)),
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
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}

	private getLogMoreFn(
		log: GitLog,
		rev: string | undefined,
		options?: GitLogOptions,
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = this.provider.getPagingLimit(moreLimit);

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
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				// The oldest commit SHA of the previous page — the graph webview compares this
				// against its last displayed row to determine the merge point for appending new rows
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

	@debug()
	async getLogForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		rev?: string | undefined,
		options?: GitLogForPathOptions,
		_cancellation?: AbortSignal,
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		let relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		if (repoPath != null && repoPath === relativePath) {
			throw new Error(`Path cannot match the repository path; path=${relativePath}`);
		}

		options = {
			...options,
			all: false /* not supported */,
			limit: this.provider.getPagingLimit(options?.limit),
			renames: false /* not supported */,
		};

		if (isFolderGlob(relativePath)) {
			relativePath = stripFolderGlob(relativePath);
			options.isFolder = true;
		} else if (options.isFolder == null) {
			const tree = await this.provider.revision.getTreeEntryForRevision(repoPath, rev || 'HEAD', relativePath);
			options.isFolder = tree?.type === 'tree';
		}

		// Note: document caching (TrackedGitDocument) is handled by the extension wrapper.
		// The library implementation always fetches fresh data.
		return this.getLogForPathCore(repoPath, relativePath, rev, options);
	}

	private async getLogForPathCore(
		repoPath: string,
		path: string,
		rev: string | undefined,
		options: GitLogForPathOptions,
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const limit = this.provider.getPagingLimit(options.limit);

		const context = await this.provider.ensureRepositoryContext(repoPath);
		if (context == null) return undefined;
		const { metadata, github, session } = context;

		const uri = this.provider.getAbsoluteUri(path, repoPath);
		const relativePath = this.provider.getRelativePath(uri, this.provider.getProviderRootUri(uri));

		rev = !rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev;
		const result = await github.getCommits(
			toTokenInfo(this.provider.authenticationProviderId, session),
			metadata.repo.owner,
			metadata.repo.name,
			stripOrigin(rev),
			{
				all: options.all,
				after: options.cursor,
				path: relativePath,
				limit: limit,
				since: options.since ? new Date(options.since) : undefined,
			},
		);

		const repoUri = coerceUri(repoPath);
		const commits = new Map<string, GitCommit>();

		const { viewer = session.account.label } = result;
		for (const commit of result.values) {
			const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
			const committerName = viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

			let c = commits.get(commit.oid);
			if (c == null) {
				const files = commit.files?.map(f => toFileChange(repoUri, repoPath, f));

				if (files != null && !options.isFolder && commit.changedFiles === 1) {
					const index = files.findIndex(f => f.path === relativePath);
					if (index !== -1) {
						files.splice(
							index,
							1,
							new GitFileChange(
								repoPath,
								relativePath,
								GitFileIndexStatus.Modified,
								joinUriPath(repoUri, normalizePath(relativePath)),
								undefined,
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
					{ files: undefined, filtered: { files: files, pathspec: relativePath } },
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
			count: commits.size,
			limit: limit,
			hasMore: result.paging?.more ?? false,
			endingCursor: result.paging?.cursor,
			query: (limit: number | undefined) => this.getLogForPath(repoPath, path, rev, { ...options, limit: limit }),
		};
		if (log.hasMore) {
			log.more = this.getLogForPathMoreFn(log, path, rev, options);
		}

		return log;
	}

	private getLogForPathMoreFn(
		log: GitLog,
		relativePath: string,
		rev: string | undefined,
		options: GitLogForPathOptions,
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = this.provider.getPagingLimit(moreLimit);

			const moreLog = await this.getLogForPath(log.repoPath, relativePath, rev, {
				...options,
				limit: moreUntil == null ? moreLimit : 0,
				cursor: log.endingCursor,
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				commits: commits,
				sha: log.sha,
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				endingCursor: moreLog.endingCursor,
				query: log.query,
			};

			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogForPathMoreFn(mergedLog, relativePath, rev, options);
			}

			return mergedLog;
		};
	}

	@debug()
	async getLogShas(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogShasOptions,
		cancellation?: AbortSignal,
	): Promise<Iterable<string>> {
		// TODO@eamodio optimize this

		let log: GitLog | undefined;
		if (options?.pathOrUri != null) {
			log = await this.getLogForPath(repoPath, options.pathOrUri, rev, options, cancellation);
		} else {
			log = await this.getLog(repoPath, rev, options, cancellation);
		}
		if (log == null) return [];

		const shas = map(log.commits.values(), c => c.ref);
		// Note: reversal only applies to the first page — subsequent pages loaded via pagination are not reversed
		return options?.reverse ? [...shas].reverse() : shas;
	}

	@debug()
	getOldestUnpushedShaForPath(
		_repoPath: string,
		_pathOrUri: string | Uri,
		_cancellation?: AbortSignal,
	): Promise<string | undefined> {
		// TODO@eamodio until we have access to the RemoteHub change store there isn't anything we can do here
		return Promise.resolve(undefined);
	}

	@debug()
	hasCommitBeenPushed(_repoPath: string, _rev: string, _cancellation?: AbortSignal): Promise<boolean> {
		// In this env we can't have unpushed commits
		return Promise.resolve(true);
	}

	@debug()
	async isAncestorOf(repoPath: string, rev1: string, rev2: string, _cancellation?: AbortSignal): Promise<boolean> {
		if (repoPath == null) return false;

		const scope = getScopedLogger();

		const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				toTokenInfo(this.provider.authenticationProviderId, session),
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
			scope?.error(ex);
			debugger;
			return false;
		}
	}

	@debug({
		args: (repoPath, s) => ({
			repoPath: repoPath,
			search: `[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}${
				s.matchWholeWord ? 'W' : ''
			}]: ${s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query}`,
		}),
	})
	async searchCommits(
		repoPath: string,
		search: SearchQuery,
		options?: GitSearchCommitsOptions,
		cancellation?: AbortSignal,
	): Promise<SearchCommitsResult> {
		if (repoPath == null) return { search: search, log: undefined };

		const scope = getScopedLogger();

		search = { matchAll: false, matchCase: false, matchRegex: true, matchWholeWord: false, ...search };
		// Note: Natural language processing is handled by the extension wrapper.

		const currentUser = search.query.includes('@me')
			? await this.provider.config.getCurrentUser(repoPath)
			: undefined;
		if (cancellation?.aborted) return { search: search, log: undefined };

		const { args: queryArgs, operations } = parseSearchQueryGitHubCommand(search, currentUser);

		const values = operations.get('commit:');
		if (values?.size) {
			const commit = await this.getCommit(repoPath, first(values)!);
			if (commit == null) return { search: search, log: undefined };

			return {
				search: search,
				log: {
					repoPath: repoPath,
					commits: new Map([[commit.sha, commit]]),
					sha: commit.sha,
					count: 1,
					limit: 1,
					hasMore: false,
				},
			};
		}

		if (!queryArgs.length) return { search: search, log: undefined };

		const limit = this.provider.getPagingLimit(options?.limit);

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const query = `repo:${metadata.repo.owner}/${metadata.repo.name}+${queryArgs.join('+').trim()}`;

			const result = await github.searchCommits(
				toTokenInfo(this.provider.authenticationProviderId, session),
				query,
				{
					cursor: options?.cursor,
					limit: limit,
					sort:
						options?.ordering === 'date'
							? 'committer-date'
							: options?.ordering === 'author-date'
								? 'author-date'
								: undefined,
				},
			);
			if (result == null) return { search: search, log: undefined };

			const commits = new Map<string, GitCommit>();
			const repoUri = coerceUri(repoPath);

			const viewer = session.account.label;
			for (const commit of result.values) {
				const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
				const committerName =
					viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

				let c = commits.get(commit.oid);
				if (c == null) {
					c = new GitCommit(
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
									files: commit.files.map(f => toFileChange(repoUri, repoPath, f)),
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
				count: commits.size,
				limit: limit,
				hasMore: result.pageInfo?.hasNextPage ?? false,
				endingCursor: result.pageInfo?.endCursor ?? undefined,
				query: (limit: number | undefined) =>
					this.searchCommits(repoPath, search, { ...options, limit: limit }).then(r => r.log!),
			};

			if (log.hasMore) {
				const searchCommitsCore = (log: GitLog): ((limit: number | undefined) => Promise<GitLog>) => {
					return async (limit: number | undefined) => {
						limit = this.provider.getPagingLimit(limit);

						const moreLog = (
							await this.searchCommits(log.repoPath, search, {
								...options,
								limit: limit,
								cursor: log.endingCursor,
							})
						).log;
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
							endingCursor: moreLog.endingCursor,
							query: log.query,
						};
						if (mergedLog.hasMore) {
							mergedLog.more = searchCommitsCore(mergedLog);
						}

						return mergedLog;
					};
				};

				log.more = searchCommitsCore(log);
			}

			return { search: search, log: log };
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return { search: search, log: undefined };
		}
	}
}

/** Converts a GitHub API file entry to a library GitFileChange */
function toFileChange(repoUri: Uri, repoPath: string, f: NonNullable<GitHubCommit['files']>[0]): GitFileChange {
	const path = f.filename ?? '';
	return new GitFileChange(
		repoPath,
		path,
		fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
		joinUriPath(repoUri, normalizePath(path)),
		f.previous_filename,
		f.previous_filename != null ? joinUriPath(repoUri, normalizePath(f.previous_filename)) : undefined,
		undefined,
		{
			additions: f.additions ?? 0,
			deletions: f.deletions ?? 0,
			changes: f.changes ?? 0,
		},
	);
}
