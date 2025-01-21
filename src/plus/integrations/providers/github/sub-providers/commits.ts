import type { SearchQuery } from '../../../../../constants.search';
import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type { GitCommitsSubProvider } from '../../../../../git/gitProvider';
import { GitCommit, GitCommitIdentity } from '../../../../../git/models/commit';
import { GitFileChange } from '../../../../../git/models/fileChange';
import { GitFileIndexStatus } from '../../../../../git/models/fileStatus';
import type { GitLog } from '../../../../../git/models/log';
import { parseSearchQuery } from '../../../../../git/search';
import { log } from '../../../../../system/decorators/log';
import { first } from '../../../../../system/iterable';
import { Logger } from '../../../../../system/logger';
import { getLogScope } from '../../../../../system/logger.scope';
import type { GitHubGitProviderInternal } from '../githubGitProvider';
import { fromCommitFileStatus } from '../models';
import { getQueryArgsFromSearchQuery } from '../utils/-webview/search.utils';

export class CommitsGitSubProvider implements GitCommitsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

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
			const commit = await this.provider.getCommit(repoPath, first(values)!);
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
						),
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
				query: (limit: number | undefined) => this.provider.getLog(repoPath, { ...options, limit: limit }),
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
