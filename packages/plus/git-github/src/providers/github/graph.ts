import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowStats,
	GitGraphRowTag,
	GraphRowProcessor,
} from '@gitlens/git/models/graph.js';
import type {
	GitGraphSearch,
	GitGraphSearchCursor,
	GitGraphSearchProgress,
	GitGraphSearchResultData,
	GitGraphSearchResults,
} from '@gitlens/git/models/graphSearch.js';
import type {
	GitGraphSession,
	GitGraphSessionChangedChannels,
	GitGraphSessionRefreshOptions,
	GitGraphSessionRefreshResult,
	GitGraphSessionSnapshot,
	GraphSessionRestoreResult,
} from '@gitlens/git/models/graphSession.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type { GitGraphSubProvider } from '@gitlens/git/providers/graph.js';
import { getBranchNameWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import { getChangedFilesCount } from '@gitlens/git/utils/commit.utils.js';
import { appendRowsAtCursor, mergeAvatarsForward } from '@gitlens/git/utils/graph.utils.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { getSearchQueryComparisonKey, parseSearchQueryGitHubCommand } from '@gitlens/git/utils/search.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { first, map } from '@gitlens/utils/iterable.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

const quoteRegex = /"/g;

export class GraphGitSubProvider implements GitGraphSubProvider {
	constructor(private readonly provider: GitHubGitProviderInternal) {}

	async openGraphSession(
		repoPath: string,
		options?: {
			rowProcessor?: GraphRowProcessor;
			rev?: string;
			limit?: number;
			include?: { stats?: boolean };
			restore?: GitGraphSessionSnapshot;
			onRestore?: (result: GraphSessionRestoreResult) => void;
		},
		cancellation?: AbortSignal,
	): Promise<GitGraphSession> {
		// GitHub-backed graphs have no incremental machinery (and `getGraph` takes no row processor); the
		// session is a thin window accumulator over full fetches. `rowProcessor` and `restore`/`onRestore`
		// (there's no incremental restore path) are accepted for interface parity and ignored — always a full walk.
		const session = new GraphSession(this, repoPath);
		await session.initialize(options, cancellation);
		return session;
	}

	@debug()
	async getGraph(
		repoPath: string,
		rev: string | undefined,
		options?: { include?: { stats?: boolean }; limit?: number },
		_cancellation?: AbortSignal,
	): Promise<GitGraph> {
		const defaultLimit = options?.limit ?? 5000;
		const ordering: 'date' | 'author-date' | 'topo' = 'date';

		const [logResult, headBranchResult, branchesResult, remotesResult, tagsResult, currentUserResult] =
			await Promise.allSettled([
				this.provider.commits.getLog(repoPath, !rev || isUncommitted(rev) ? 'HEAD' : rev, {
					all: true,
					ordering: ordering,
					limit: defaultLimit,
				}),
				this.provider.branches.getBranch(repoPath),
				this.provider.branches.getBranches(repoPath, { filter: b => b.remote }),
				this.provider.remotes.getRemotes(repoPath),
				this.provider.tags.getTags(repoPath),
				this.provider.config.getCurrentUser(repoPath),
			]);

		const avatars = new Map<string, string>();
		const headBranch = getSettledValue(headBranchResult)!;

		const branchMap = new Map<string, GitBranch>();
		const branchTips = new Map<string, string[]>();
		if (headBranch != null) {
			branchMap.set(headBranch.name, headBranch);
			if (headBranch.sha != null) {
				branchTips.set(headBranch.sha, [headBranch.name]);
			}
		}

		const branches = getSettledValue(branchesResult)?.values;
		if (branches != null) {
			for (const branch of branches) {
				branchMap.set(branch.name, branch);
				if (branch.sha == null) continue;

				const bts = branchTips.get(branch.sha);
				if (bts == null) {
					branchTips.set(branch.sha, [branch.name]);
				} else {
					bts.push(branch.name);
				}
			}
		}

		const ids = new Set<string>();
		const remote = getSettledValue(remotesResult)?.[0];
		const remoteMap = remote != null ? new Map([[remote.name, remote]]) : new Map<string, GitRemote>();
		const rowStats = new Map<string, GitGraphRowStats>();
		const tagTips = new Map<string, string[]>();
		const tags = getSettledValue(tagsResult)?.values;
		if (tags != null) {
			for (const tag of tags) {
				if (tag.sha == null) continue;

				const tts = tagTips.get(tag.sha);
				if (tts == null) {
					tagTips.set(tag.sha, [tag.name]);
				} else {
					tts.push(tag.name);
				}
			}
		}

		return this.getGraphCore(
			repoPath,
			getSettledValue(logResult),
			headBranch,
			branchMap,
			branchTips,
			remote,
			remoteMap,
			rowStats,
			tagTips,
			getSettledValue(currentUserResult),
			avatars,
			ids,
			undefined,
			undefined,
			undefined,
			options,
		);
	}

	private getGraphCore(
		repoPath: string,
		log: GitLog | undefined,
		headBranch: GitBranch,
		branchMap: Map<string, GitBranch>,
		branchTips: Map<string, string[]>,
		remote: GitRemote | undefined,
		remoteMap: Map<string, GitRemote>,
		rowStats: Map<string, GitGraphRowStats>,
		tagTips: Map<string, string[]>,
		currentUser: GitUser | undefined,
		avatars: Map<string, string>,
		ids: Set<string>,
		stashes: undefined,
		worktrees: undefined,
		worktreesByBranch: undefined,
		options?: {
			branch?: string;
			include?: { stats?: boolean };
			limit?: number;
			ref?: string;
		},
	): GitGraph {
		const includes = { ...options?.include, stats: true }; // stats are always available, so force it
		const downstreamMap = new Map<string, string[]>();

		if (log == null) {
			return {
				repoPath: repoPath,
				avatars: avatars,
				ids: ids,
				includes: includes,
				branches: branchMap,
				remotes: remoteMap,
				downstreams: downstreamMap,
				stashes: stashes,
				worktrees: worktrees,
				worktreesByBranch: worktreesByBranch,
				rows: [],
			};
		}

		const commits = (log.pagedCommits?.() ?? log.commits)?.values();
		if (commits == null) {
			return {
				repoPath: repoPath,
				avatars: avatars,
				ids: ids,
				includes: includes,
				branches: branchMap,
				remotes: remoteMap,
				downstreams: downstreamMap,
				stashes: stashes,
				worktrees: worktrees,
				worktreesByBranch: worktreesByBranch,
				rows: [],
			};
		}

		const rows: GitGraphRow[] = [];

		let head: boolean;
		let refHeads: GitGraphRowHead[];
		let refRemoteHeads: GitGraphRowRemoteHead[];
		let refTags: GitGraphRowTag[];

		const headRefUpstreamName = headBranch?.upstream?.name;

		for (const commit of commits) {
			ids.add(commit.sha);

			head = commit.sha === headBranch?.sha;
			if (head) {
				refHeads = [
					{
						name: headBranch.name,
						isCurrentHead: true,
					},
				];

				if (headBranch.upstream != null && remote != null) {
					refRemoteHeads = [
						{
							name: headBranch.name,
							owner: remote.name,
							url: remote.url,
						},
					];

					if (headRefUpstreamName != null) {
						let downstreams = downstreamMap.get(headRefUpstreamName);
						if (downstreams == null) {
							downstreams = [];
							downstreamMap.set(headRefUpstreamName, downstreams);
						}
						downstreams.push(headBranch.name);
					}
				} else {
					refRemoteHeads = [];
				}
			} else {
				refHeads = [];
				refRemoteHeads = [];

				const bts = branchTips.get(commit.sha);
				if (bts != null && remote != null) {
					for (const b of bts) {
						refRemoteHeads.push({
							name: getBranchNameWithoutRemote(b),
							owner: remote.name,
							url: remote.url,
						});
					}
				}
			}

			refTags = [];
			const tts = tagTips.get(commit.sha);
			if (tts != null) {
				for (const t of tts) {
					refTags.push({
						name: t,
						// Not currently used, so don't bother looking it up
						annotated: true,
					});
				}
			}

			if (commit.author.email && commit.author.avatarUrl && !avatars.has(commit.author.email)) {
				avatars.set(commit.author.email, commit.author.avatarUrl);
			}

			rows.push({
				sha: commit.sha,
				parents: commit.parents,
				author: commit.author.name,
				email: commit.author.email ?? '',
				date: commit.committer.date.getTime(),
				commitDate: commit.committer.date.getTime(),
				message: commit.message?.length ? commit.message : commit.summary,
				type: commit.parents.length > 1 ? 'merge-node' : 'commit-node',
				heads: refHeads,
				remotes: refRemoteHeads,
				tags: refTags,
			});

			if (commit.stats != null) {
				rowStats.set(commit.sha, {
					files: getChangedFilesCount(commit.stats.files),
					additions: commit.stats.additions,
					deletions: commit.stats.deletions,
				});
			}
		}

		const opts = { ...options };

		if (opts?.ref === 'HEAD') {
			opts.ref = first(log.commits.values())?.sha;
		} else if (opts?.ref != null) {
			opts.ref = undefined;
		}

		return {
			repoPath: repoPath,
			avatars: avatars,
			ids: ids,
			includes: includes,
			branches: branchMap,
			remotes: remoteMap,
			downstreams: downstreamMap,
			stashes: stashes,
			worktrees: worktrees,
			worktreesByBranch: worktreesByBranch,
			rows: rows,
			id: opts?.ref ?? first(log.commits.values())?.sha,

			rowsStats: rowStats.size > 0 ? rowStats : undefined,

			paging: {
				limit: log.limit,
				startingCursor: log.startingCursor,
				hasMore: log.hasMore,
			},
			more: async (limit: number, _id?: string, _cancellation?: AbortSignal): Promise<GitGraph | undefined> => {
				const moreLog = await log.more?.(limit);
				return this.getGraphCore(
					repoPath,
					moreLog,
					headBranch,
					branchMap,
					branchTips,
					remote,
					remoteMap,
					rowStats,
					tagTips,
					currentUser,
					avatars,
					ids,
					stashes,
					worktrees,
					worktreesByBranch,
					opts,
				);
			},
		};
	}

	@debug({
		args: (repoPath, s, o) => ({
			repoPath: repoPath,
			search: `[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}${
				s.matchWholeWord ? 'W' : ''
			}]: ${s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query}`,
			options: `limit=${o?.limit}, ordering=${o?.ordering}`,
		}),
	})
	async *searchGraph(
		repoPath: string,
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: AbortSignal,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		return yield* this.searchGraphCore(repoPath, search, undefined, undefined, options, cancellation);
	}

	@debug({
		args: (repoPath, c, r, o) => ({
			repoPath: repoPath,
			cursor: `[${c.search.matchAll ? 'A' : ''}${c.search.matchCase ? 'C' : ''}${c.search.matchRegex ? 'R' : ''}${
				c.search.matchWholeWord ? 'W' : ''
			}]: ${c.search.query.length > 500 ? `${c.search.query.substring(0, 500)}...` : c.search.query} (continue)`,
			existingResults: `results=${r.size}`,
			options: `limit=${o?.limit}`,
		}),
	})
	async *continueSearchGraph(
		repoPath: string,
		cursor: GitGraphSearchCursor,
		existingResults: GitGraphSearchResults,
		options?: { limit?: number },
		cancellation?: AbortSignal,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		return yield* this.searchGraphCore(repoPath, cursor.search, cursor, existingResults, options, cancellation);
	}

	private async *searchGraphCore(
		repoPath: string,
		search: SearchQuery,
		cursor: GitGraphSearchCursor | undefined,
		existingResults: GitGraphSearchResults | undefined,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: AbortSignal,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		search = { matchAll: false, matchCase: false, matchRegex: true, matchWholeWord: false, ...search };

		const comparisonKey = getSearchQueryComparisonKey(search);

		try {
			const currentUser = search.query.includes('@me')
				? await this.provider.config.getCurrentUser(repoPath)
				: undefined;

			const results: GitGraphSearchResults = existingResults ?? new Map<string, GitGraphSearchResultData>();
			const { args: queryArgs, filters, operations } = parseSearchQueryGitHubCommand(search, currentUser);

			const values = operations.get('commit:');
			if (values != null) {
				const commitsResults = await Promise.allSettled(
					map(values, v => this.provider.commits.getCommit(repoPath, v.replace(quoteRegex, ''))),
				);

				let i = 0;
				for (const commitResult of commitsResults) {
					const commit = getSettledValue(commitResult);
					if (commit == null) continue;

					results.set(commit.sha, {
						i: i++,
						date: Number(options?.ordering === 'author-date' ? commit.author.date : commit.committer.date),
						files: commit.fileset?.files,
					});
				}

				return {
					repoPath: repoPath,
					query: search,
					queryFilters: filters,
					comparisonKey: comparisonKey,
					results: results,
					hasMore: false,
				};
			}

			if (!queryArgs.length) {
				return {
					repoPath: repoPath,
					query: search,
					queryFilters: filters,
					comparisonKey: comparisonKey,
					results: results,
					hasMore: false,
				};
			}

			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const query = `repo:${metadata.repo.owner}/${metadata.repo.name}+${queryArgs.join('+').trim()}`;

			const limit = this.provider.getPagingLimit(options?.limit);
			// Use state from cursor, if provided
			let apiCursor = cursor?.state != null && typeof cursor.state === 'string' ? cursor.state : undefined;
			let hasMore = true;

			while (hasMore && !cancellation?.aborted) {
				const result = await github.searchCommitShas(
					toTokenInfo(this.provider.authenticationProviderId, session),
					query,
					{
						cursor: apiCursor,
						limit: limit,
						sort:
							options?.ordering === 'date'
								? 'committer-date'
								: options?.ordering === 'author-date'
									? 'author-date'
									: undefined,
					},
				);

				if (result == null || cancellation?.aborted) {
					break;
				}

				// Collect incremental results for this page
				const incrementalResults = new Map<string, GitGraphSearchResultData>();
				for (const commit of result.values) {
					const data: GitGraphSearchResultData = {
						i: results.size,
						date: options?.ordering === 'author-date' ? commit.authorDate : commit.committerDate,
						files: undefined,
					};
					results.set(commit.sha, data);
					incrementalResults.set(commit.sha, data);
				}

				hasMore = result.pageInfo?.hasNextPage ?? false;
				apiCursor = result.pageInfo?.endCursor ?? undefined;

				// Yield progress with incremental results from this page
				if (incrementalResults.size) {
					yield {
						repoPath: repoPath,
						query: search,
						queryFilters: filters,
						comparisonKey: comparisonKey,
						results: incrementalResults,
						runningTotal: results.size,
						hasMore: hasMore,
					};
				}
			}

			return {
				repoPath: repoPath,
				query: search,
				queryFilters: filters,
				comparisonKey: comparisonKey,
				results: results,
				hasMore: hasMore,
				paging: hasMore
					? {
							limit: limit,
							cursor: apiCursor ? { search: search, state: apiCursor } : undefined,
						}
					: undefined,
			};
		} catch (ex) {
			if (ex instanceof GitSearchError) throw ex;

			throw new GitSearchError(ex);
		}
	}
}

/**
 * GitHub-backed {@link GitGraphSession}: a thin window accumulator over {@link GraphGitSubProvider.getGraph}.
 * There's no incremental head-walk yet, so every {@link refresh} is a full fetch (`path: 'full'`); the
 * window accumulates across {@link more} via the shared cursor-anchored helper, and prior avatar URLs are
 * carried forward write-once — matching the CLI session's observable window/avatar behavior.
 */
class GraphSession implements GitGraphSession {
	// Assigned by `initialize` before the session is handed out; never read before then.
	private _current!: GitGraph;
	private _window: readonly GitGraphRow[] = [];

	constructor(
		private readonly provider: GraphGitSubProvider,
		readonly repoPath: string,
	) {}

	get window(): readonly GitGraphRow[] {
		return this._window;
	}

	get current(): GitGraph {
		return this._current;
	}

	async initialize(
		options?: { rev?: string; limit?: number; include?: { stats?: boolean } },
		cancellation?: AbortSignal,
	): Promise<void> {
		const graph = await this.provider.getGraph(
			this.repoPath,
			options?.rev,
			{ include: options?.include, limit: options?.limit },
			cancellation,
		);
		this.apply(graph);
	}

	async refresh(
		options?: GitGraphSessionRefreshOptions,
		cancellation?: AbortSignal,
	): Promise<GitGraphSessionRefreshResult> {
		const prior = this._current;
		let graph = await this.provider.getGraph(
			this.repoPath,
			options?.rev,
			{ include: options?.include, limit: options?.limit },
			cancellation,
		);

		// Host-serialization backstop: the host serializes refresh against more() per repo. Should a more() still
		// land mid-refresh (`_current` swapped out from under this await), the rebuild predates that appended page
		// — refresh carries newer repo truth so we still apply it, but when the accumulated window outran the
		// rebuild the dropped page must re-page, not vanish. `paging.hasMore` is readonly, so re-wrap it truthful.
		if (this._current !== prior && graph.paging != null && this._window.length > graph.rows.length) {
			graph = { ...graph, paging: { ...graph.paging, hasMore: true } };
		}

		mergeAvatarsForward(prior.avatars, graph.avatars);
		this.apply(graph);
		// The GitHub provider always does a full walk (no incremental fast path), so every channel changed.
		const changed: GitGraphSessionChangedChannels = {
			rows: true,
			reachability: true,
			rowsStats: true,
			avatars: true,
			downstreams: true,
		};
		return { path: 'full', changed: changed };
	}

	async more(limit?: number, targetId?: string, cancellation?: AbortSignal): Promise<boolean> {
		const prior = this._current;
		const updated = await prior.more?.(limit ?? 0, targetId, cancellation);
		if (this._current !== prior || updated == null) return false;
		// A more() past the end returns a degenerate empty graph (no rows, no paging) — nothing to add, so don't
		// let it REPLACE the accumulated window with empty.
		if (updated.rows.length === 0 && updated.paging == null) return false;

		mergeAvatarsForward(prior.avatars, updated.avatars);
		this.apply(updated);
		return true;
	}

	serialize(): GitGraphSessionSnapshot | undefined {
		// No incremental restore path (no ref-tip gate / reachability table), so nothing worth persisting.
		return undefined;
	}

	dispose(): void {
		// No-op — the window lives entirely in memory.
	}

	/** Cursor-less graph IS the full window; a paged graph appends at its cursor. */
	private apply(graph: GitGraph): void {
		this._current = graph;
		const startingCursor = graph.paging?.startingCursor;
		this._window =
			startingCursor == null ? graph.rows : appendRowsAtCursor(this._window, startingCursor, graph.rows);
	}
}
