import type { SearchQuery } from '../../../../constants.search';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import type { GitCommitsSubProvider } from '../../../../git/gitProvider';
import type { GitStashCommit } from '../../../../git/models/commit';
import type { GitLog } from '../../../../git/models/log';
import { LogType, parseGitLog } from '../../../../git/parsers/logParser';
import { getGitArgsFromSearchQuery } from '../../../../git/search';
import { configuration } from '../../../../system/-webview/configuration';
import { log } from '../../../../system/decorators/log';
import { skip } from '../../../../system/iterable';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class CommitsGitSubProvider implements GitCommitsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
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
