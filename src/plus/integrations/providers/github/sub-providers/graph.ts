import type { CancellationToken, Uri } from 'vscode';
import type { SearchQuery } from '../../../../../constants.search';
import type { Container } from '../../../../../container';
import { emojify } from '../../../../../emojis';
import type { GitCache } from '../../../../../git/cache';
import { GitSearchError } from '../../../../../git/errors';
import type { GitGraphSubProvider } from '../../../../../git/gitProvider';
import type { GitBranch } from '../../../../../git/models/branch';
import type { GitStashCommit } from '../../../../../git/models/commit';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowContexts,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowStats,
	GitGraphRowTag,
} from '../../../../../git/models/graph';
import type { GitLog } from '../../../../../git/models/log';
import type { GitRemote } from '../../../../../git/models/remote';
import type { GitUser } from '../../../../../git/models/user';
import type { GitWorktree } from '../../../../../git/models/worktree';
import type {
	GitGraphSearch,
	GitGraphSearchCursor,
	GitGraphSearchProgress,
	GitGraphSearchResultData,
	GitGraphSearchResults,
} from '../../../../../git/search';
import { getSearchQueryComparisonKey, parseSearchQueryGitHubCommand } from '../../../../../git/search';
import { isBranchStarred } from '../../../../../git/utils/-webview/branch.utils';
import { getRemoteIconUri } from '../../../../../git/utils/-webview/icons';
import { getBranchId, getBranchNameWithoutRemote } from '../../../../../git/utils/branch.utils';
import { getChangedFilesCount } from '../../../../../git/utils/commit.utils';
import { createReference } from '../../../../../git/utils/reference.utils';
import { isUncommitted } from '../../../../../git/utils/revision.utils';
import { getTagId } from '../../../../../git/utils/tag.utils';
import { configuration } from '../../../../../system/-webview/configuration';
import { log } from '../../../../../system/decorators/log';
import { first, map } from '../../../../../system/iterable';
import { getSettledValue } from '../../../../../system/promise';
import { serializeWebviewItemContext } from '../../../../../system/webview';
import type {
	GraphBranchContextValue,
	GraphItemContext,
	GraphItemRefContext,
	GraphTagContextValue,
} from '../../../../../webviews/plus/graph/protocol';
import type { GitHubGitProviderInternal } from '../githubGitProvider';

const doubleQuoteRegex = /"/g;

export class GraphGitSubProvider implements GitGraphSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@log()
	async getGraph(
		repoPath: string,
		rev: string | undefined,
		asWebviewUri: (uri: Uri) => Uri,
		options?: { include?: { stats?: boolean }; limit?: number },
		_cancellation?: CancellationToken,
	): Promise<GitGraph> {
		const defaultLimit = options?.limit ?? configuration.get('graph.defaultItemLimit') ?? 5000;
		// const defaultPageLimit = configuration.get('graph.pageItemLimit') ?? 1000;
		const ordering = configuration.get('graph.commitOrdering', undefined, 'date');
		const useAvatars = configuration.get('graph.avatars', undefined, true);

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
		const remote = getSettledValue(remotesResult)![0];
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
			asWebviewUri,
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
			{ ...options, useAvatars: useAvatars },
		);
	}

	private getGraphCore(
		repoPath: string,
		asWebviewUri: (uri: Uri) => Uri,
		log: GitLog | undefined,
		headBranch: GitBranch,
		branchMap: Map<string, GitBranch>,
		branchTips: Map<string, string[]>,
		remote: GitRemote,
		remoteMap: Map<string, GitRemote>,
		rowStats: Map<string, GitGraphRowStats>,
		tagTips: Map<string, string[]>,
		currentUser: GitUser | undefined,
		avatars: Map<string, string>,
		ids: Set<string>,
		stashes: Map<string, GitStashCommit> | undefined,
		worktrees: GitWorktree[] | undefined,
		worktreesByBranch: Map<string, GitWorktree> | undefined,
		options?: {
			branch?: string;
			include?: { stats?: boolean };
			limit?: number;
			ref?: string;
			useAvatars?: boolean;
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

		let avatarUrl: string | undefined;
		let branchName: string;
		let context:
			| GraphItemRefContext<GraphBranchContextValue>
			| GraphItemRefContext<GraphTagContextValue>
			| undefined;
		let contexts: GitGraphRowContexts | undefined;
		let head = false;
		let isCurrentUser = false;
		let refHeads: GitGraphRowHead[];
		let refRemoteHeads: GitGraphRowRemoteHead[];
		let refTags: GitGraphRowTag[];
		let remoteBranchId: string;
		let tagId: string;

		const headRefUpstreamName = headBranch.upstream?.name;

		for (const commit of commits) {
			ids.add(commit.sha);

			head = commit.sha === headBranch.sha;
			if (head) {
				context = {
					webviewItem: `gitlens:branch${head ? '+current' : ''}${
						headBranch?.upstream != null ? '+tracking' : ''
					}${headBranch?.starred ? '+starred' : ''}`,
					webviewItemValue: {
						type: 'branch',
						ref: createReference(headBranch.name, repoPath, {
							id: headBranch.id,
							refType: 'branch',
							name: headBranch.name,
							remote: false,
							upstream: headBranch.upstream,
						}),
					},
				};

				refHeads = [
					{
						id: headBranch.id,
						name: headBranch.name,
						isCurrentHead: true,
						context: serializeWebviewItemContext<GraphItemRefContext>(context),
						upstream:
							headBranch.upstream != null
								? {
										name: headBranch.upstream.name,
										id: getBranchId(repoPath, true, headBranch.upstream.name),
									}
								: undefined,
					},
				];

				if (headBranch.upstream != null) {
					remoteBranchId = getBranchId(repoPath, true, headBranch.name);
					avatarUrl = (
						(options?.useAvatars ? remote.provider?.avatarUri : undefined) ??
						getRemoteIconUri(this.container, remote, asWebviewUri)
					)?.toString(true);
					context = {
						webviewItem: `gitlens:branch+remote${
							isBranchStarred(this.container, remoteBranchId) ? '+starred' : ''
						}`,
						webviewItemValue: {
							type: 'branch',
							ref: createReference(headBranch.name, repoPath, {
								id: remoteBranchId,
								refType: 'branch',
								name: headBranch.name,
								remote: true,
								upstream: { name: remote.name, missing: false },
							}),
						},
					};

					refRemoteHeads = [
						{
							id: remoteBranchId,
							name: headBranch.name,
							owner: remote.name,
							url: remote.url,
							avatarUrl: avatarUrl,
							context: serializeWebviewItemContext<GraphItemRefContext>(context),
							current: true,
							hostingServiceType: remote.provider?.gkProviderId,
						},
					];

					if (headRefUpstreamName != null) {
						// Add the branch name (tip) to the upstream name entry in the downstreams map
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
				if (bts != null) {
					for (const b of bts) {
						remoteBranchId = getBranchId(repoPath, true, b);
						branchName = getBranchNameWithoutRemote(b);

						avatarUrl = (
							(options?.useAvatars ? remote.provider?.avatarUri : undefined) ??
							getRemoteIconUri(this.container, remote, asWebviewUri)
						)?.toString(true);
						context = {
							webviewItem: `gitlens:branch+remote${
								isBranchStarred(this.container, remoteBranchId) ? '+starred' : ''
							}`,
							webviewItemValue: {
								type: 'branch',
								ref: createReference(b, repoPath, {
									id: remoteBranchId,
									refType: 'branch',
									name: b,
									remote: true,
									upstream: { name: remote.name, missing: false },
								}),
							},
						};

						refRemoteHeads.push({
							id: remoteBranchId,
							name: branchName,
							owner: remote.name,
							url: remote.url,
							avatarUrl: avatarUrl,
							context: serializeWebviewItemContext<GraphItemRefContext>(context),
							hostingServiceType: remote.provider?.gkProviderId,
						});
					}
				}
			}

			refTags = [];

			const tts = tagTips.get(commit.sha);
			if (tts != null) {
				for (const t of tts) {
					tagId = getTagId(repoPath, t);
					context = {
						webviewItem: 'gitlens:tag',
						webviewItemValue: {
							type: 'tag',
							ref: createReference(t, repoPath, {
								id: tagId,
								refType: 'tag',
								name: t,
							}),
						},
					};

					refTags.push({
						id: tagId,
						name: t,
						// Not currently used, so don't bother looking it up
						annotated: true,
						context: serializeWebviewItemContext<GraphItemRefContext>(context),
					});
				}
			}

			if (commit.author.email && !avatars.has(commit.author.email)) {
				const uri = commit.getCachedAvatarUri();
				if (uri != null) {
					avatars.set(commit.author.email, uri.toString(true));
				}
			}

			isCurrentUser = commit.author.name === 'You';
			contexts = {
				row: serializeWebviewItemContext<GraphItemRefContext>({
					webviewItem: `gitlens:commit${head ? '+HEAD' : ''}+current`,
					webviewItemValue: {
						type: 'commit',
						ref: createReference(commit.sha, repoPath, {
							refType: 'revision',
							message: commit.message,
						}),
					},
				}),
				avatar: serializeWebviewItemContext<GraphItemContext>({
					webviewItem: `gitlens:contributor${isCurrentUser ? '+current' : ''}`,
					webviewItemValue: {
						type: 'contributor',
						repoPath: repoPath,
						name: isCurrentUser && currentUser?.name != null ? currentUser.name : commit.author.name,
						email: commit.author.email,
						current: isCurrentUser,
					},
				}),
			};

			rows.push({
				sha: commit.sha,
				parents: commit.parents,
				author: commit.author.name,
				email: commit.author.email ?? '',
				date: commit.committer.date.getTime(),
				message: emojify(commit.message && String(commit.message).length ? commit.message : commit.summary),
				// TODO: review logic for stash, wip, etc
				type: commit.parents.length > 1 ? 'merge-node' : 'commit-node',
				heads: refHeads,
				remotes: refRemoteHeads,
				tags: refTags,
				contexts: contexts,
			});

			if (commit.stats != null) {
				rowStats.set(commit.sha, {
					files: getChangedFilesCount(commit.stats.files),
					additions: commit.stats.additions,
					deletions: commit.stats.deletions,
				});
			}
		}

		if (options?.ref === 'HEAD') {
			options.ref = first(log.commits.values())?.sha;
		} else if (options?.ref != null) {
			options.ref = undefined;
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
			id: options?.ref ?? first(log.commits.values())?.sha,

			paging: {
				limit: log.limit,
				startingCursor: log.startingCursor,
				hasMore: log.hasMore,
			},
			more: async (
				limit: number | undefined,
				_sha?: string,
				_cancellation?: CancellationToken,
			): Promise<GitGraph | undefined> => {
				// Note: GitHub provider uses API-based pagination via cursors, not SHA-based searching.
				// The `_sha` parameter is ignored because the GitHub API handles pagination differently
				// than the local Git provider. The API returns a cursor for the next page, and we
				// continue from that cursor rather than searching for specific commits.
				const moreLog = await log.more?.(limit);
				return this.getGraphCore(
					repoPath,
					asWebviewUri,
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
					options,
				);
			},
		};
	}

	@log<GraphGitSubProvider['searchGraph']>({
		args: {
			1: s =>
				`[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}${
					s.matchWholeWord ? 'W' : ''
				}]: ${s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query}`,
			2: o => `limit=${o?.limit}, ordering=${o?.ordering}`,
		},
	})
	async *searchGraph(
		repoPath: string,
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: CancellationToken,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		return yield* this.searchGraphCore(repoPath, search, undefined, undefined, options, cancellation);
	}

	@log<GraphGitSubProvider['continueSearchGraph']>({
		args: {
			1: c =>
				`[${c.search.matchAll ? 'A' : ''}${c.search.matchCase ? 'C' : ''}${c.search.matchRegex ? 'R' : ''}${
					c.search.matchWholeWord ? 'W' : ''
				}]: ${c.search.query.length > 500 ? `${c.search.query.substring(0, 500)}...` : c.search.query} (continue)`,
			2: r => `results=${r.size}`,
			3: o => `limit=${o?.limit}`,
		},
	})
	async *continueSearchGraph(
		repoPath: string,
		cursor: GitGraphSearchCursor,
		existingResults: GitGraphSearchResults,
		options?: {
			limit?: number;
		},
		cancellation?: CancellationToken,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		return yield* this.searchGraphCore(repoPath, cursor.search, cursor, existingResults, options, cancellation);
	}

	private async *searchGraphCore(
		repoPath: string,
		search: SearchQuery,
		cursor: GitGraphSearchCursor | undefined,
		existingResults: GitGraphSearchResults | undefined,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: CancellationToken,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		// const scope = getLogScope();
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
					map(values, v => this.provider.commits.getCommit(repoPath, v.replace(doubleQuoteRegex, ''))),
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

			const limit = this.provider.getPagingLimit(options?.limit ?? configuration.get('advanced.maxSearchItems'));
			// Use state from cursor, if provided
			let apiCursor = cursor?.state != null && typeof cursor.state === 'string' ? cursor.state : undefined;
			let hasMore = true;

			while (hasMore && !cancellation?.isCancellationRequested) {
				const result = await github.searchCommitShas(session.accessToken, query, {
					cursor: apiCursor,
					limit: limit,
					sort:
						options?.ordering === 'date'
							? 'committer-date'
							: options?.ordering === 'author-date'
								? 'author-date'
								: undefined,
				});

				if (result == null || cancellation?.isCancellationRequested) {
					break;
				}

				// Collect incremental results for this page
				const incrementalResults = new Map<string, GitGraphSearchResultData>();
				for (const commit of result.values) {
					const data: GitGraphSearchResultData = {
						i: results.size,
						date: Number(options?.ordering === 'author-date' ? commit.authorDate : commit.committerDate),
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
