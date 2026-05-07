import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitStashCommit } from '@gitlens/git/models/commit.js';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowsStats,
	GitGraphRowStats,
	GitGraphRowTag,
	GraphContext,
	GraphRowProcessor,
} from '@gitlens/git/models/graph.js';
import type {
	GitGraphSearch,
	GitGraphSearchCursor,
	GitGraphSearchProgress,
	GitGraphSearchResultData,
	GitGraphSearchResults,
} from '@gitlens/git/models/graphSearch.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { GitGraphSubProvider } from '@gitlens/git/providers/graph.js';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getRemoteNameFromBranchName,
} from '@gitlens/git/utils/branch.utils.js';
import { getChangedFilesCount } from '@gitlens/git/utils/commit.utils.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { getSearchQueryComparisonKey, parseSearchQueryGitCommand } from '@gitlens/git/utils/search.utils.js';
import { compareReachableRefs } from '@gitlens/git/utils/sorting.js';
import { getTagId } from '@gitlens/git/utils/tag.utils.js';
import { isUserMatch } from '@gitlens/git/utils/user.utils.js';
import { getWorktreeId, groupWorktreesByBranch } from '@gitlens/git/utils/worktree.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { find, first, join, last } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git } from '../exec/git.js';
import { gitConfigsLog } from '../exec/git.js';
import {
	getGraphParser,
	getShaAndDatesLogParser,
	getShaAndDatesWithFilesLogParser,
	getShaAndStatsLogParser,
	getShaLogParser,
} from '../parsers/logParser.js';
import { convertStashesToStdin } from './stash.js';

const progressiveSearchResultsBatchTimeMs = 500; // Send updates every 500ms (2 updates/second)

type ReachableRef = GitCommitReachability['refs'][number];

export class GraphGitSubProvider implements GitGraphSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async getGraph(
		repoPath: string,
		rev: string | undefined,
		options?: { include?: { stats?: boolean }; limit?: number; rowProcessor?: GraphRowProcessor },
		cancellation?: AbortSignal,
	): Promise<GitGraph> {
		const scope = getScopedLogger();

		const cfg = this.context.config;
		const defaultLimit = options?.limit ?? 5000;
		const ordering: 'date' | 'author-date' | 'topo' = cfg?.graph?.commitOrdering ?? cfg?.commits.ordering ?? 'date';
		const onlyFollowFirstParent = cfg?.graph?.onlyFollowFirstParent ?? false;

		const deferStats = options?.include?.stats;

		const parser = getGraphParser(options?.include?.stats && !deferStats);
		const shaParser = getShaLogParser();
		const statsParser = getShaAndStatsLogParser();

		const [shaResult, stashResult, branchesResult, remotesResult, currentUserResult, worktreesResult] =
			await Promise.allSettled([
				!isUncommitted(rev, true)
					? this.git.run(
							{ cwd: repoPath, configs: gitConfigsLog },
							'log',
							...shaParser.arguments,
							'-n1',
							rev ?? 'HEAD',
							'--',
						)
					: undefined,
				this.provider.stash?.getStash(repoPath, { includeFiles: false }, cancellation),
				this.provider.branches.getBranches(repoPath, undefined, cancellation),
				this.provider.remotes.getRemotes(repoPath, undefined, cancellation),
				this.provider.config.getCurrentUser(repoPath),
				this.provider.worktrees
					?.getWorktrees(repoPath, cancellation)
					.then((w): [GitWorktree[], Map<string, GitWorktree>] => [
						w,
						groupWorktreesByBranch(w, { includeDefault: true }),
					]),
			]);

		const branches = getSettledValue(branchesResult)?.values;
		const branchMap = branches != null ? new Map(branches.map(r => [r.name, r])) : new Map<string, GitBranch>();
		const headBranch = branches?.find(b => b.current);
		const headRefUpstreamName = headBranch?.upstream?.name;
		const [worktrees, worktreesByBranch] = getSettledValue(worktreesResult) ?? [[], new Map<string, GitWorktree>()];

		let branchIdOfMainWorktree: string | undefined;
		if (worktreesByBranch != null) {
			branchIdOfMainWorktree = find(worktreesByBranch, ([, wt]) => wt.isDefault)?.[0];
			if (branchIdOfMainWorktree != null) {
				worktreesByBranch.delete(branchIdOfMainWorktree);
			}
		}

		const currentUser = getSettledValue(currentUserResult);

		const remotes = getSettledValue(remotesResult);
		const remoteMap = remotes != null ? new Map(remotes.map(r => [r.name, r])) : new Map<string, GitRemote>();
		const shas = getSettledValue(shaResult)?.stdout;
		const selectSha = shas != null ? first(shaParser.parse(shas)) : undefined;

		const downstreamMap = new Map<string, string[]>();

		// There *HAS* to be a better way to get git log to return stashes, but this is the best we've found
		const gitStash = getSettledValue(stashResult);
		const { stdin, remappedIds } = convertStashesToStdin(gitStash?.stashes);

		const avatars = new Map<string, string>();
		const ids = new Set<string>();
		const reachableFromHEAD = new Set<string>();

		// Map<sha, Map<refKey, ref>> — inner map deduplicates refs during propagation
		const reachableRefs = new Map<string, Map<string, ReachableRef>>();
		const rowStats: GitGraphRowsStats = new Map<string, GitGraphRowStats>();
		let pendingRowsStatsCount = 0;
		let iterations = 0;
		let total = 0;

		const args = ['log', ...parser.arguments, `--${ordering}-order`, '--all'];
		if (stdin) {
			args.push('--stdin');
		}
		if (onlyFollowFirstParent) {
			args.push('--first-parent');
		}

		async function getCommitsForGraphCore(
			this: GraphGitSubProvider,
			limit: number,
			sha?: string,
			cursor?: { sha: string; skip: number },
			cancellation?: AbortSignal,
		): Promise<GitGraph> {
			try {
				iterations++;
				const startTotal = total;

				const aborter = new AbortController();
				const onAbort = () => {
					aborter.abort();
				};
				cancellation?.addEventListener('abort', onAbort, { once: true });
				using _disposable = createDisposable(() => cancellation?.removeEventListener('abort', onAbort));

				const stream = this.git.stream(
					{ cwd: repoPath, configs: gitConfigsLog, cancellation: aborter.signal, stdin: stdin },
					...args,
					cursor?.skip ? `--skip=${cursor.skip}` : undefined,
					'--',
				);
				using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

				const rows: GitGraphRow[] = [];

				let branch: GitBranch | undefined;
				let branchId: string;
				let branchName: string;
				let head = false;
				let isCurrentUser = false;
				let refHead: GitGraphRowHead;
				let refHeads: GitGraphRowHead[];
				let refRemoteHead: GitGraphRowRemoteHead;
				let refRemoteHeads: GitGraphRowRemoteHead[];
				let refTag: GitGraphRowTag;
				let refTags: GitGraphRowTag[];
				let parent: string;
				let parents: string[];
				let remote: GitRemote | undefined;
				let remoteBranchId: string;
				let remoteName: string;
				let shaOrRemapped: string | undefined;
				let stash: GitStashCommit | undefined;
				let tagId: string;
				let tagName: string;
				let tip: string;

				let count = 0;
				let found = false;
				let hasMore = false;

				const rowProcessor = options?.rowProcessor;
				const graphCtx: GraphContext | undefined =
					rowProcessor != null
						? {
								repoPath: repoPath,
								useAvatars: cfg?.graph?.avatars ?? true,
								branches: branchMap,
								remotes: remoteMap,
								worktreesByBranch: worktreesByBranch,
								branchIdOfMainWorktree: branchIdOfMainWorktree,
								stashes: gitStash?.stashes,
								reachableFromHEAD: reachableFromHEAD,
								avatars: avatars,
							}
						: undefined;

				for await (const commit of parser.parseAsync(stream)) {
					// Stopping logic (check AFTER processing the commit):
					// - SHA + limit > 0: Find SHA, ensure at least `limit` commits loaded
					// - SHA + limit = 0: Find SHA, stop immediately
					// - No SHA + limit > 0: Load exactly `limit` commits
					// - No SHA + limit = 0: Load everything remaining
					// - SHA + limit > 0 + still unfound past 10× limit: defensive cap so an unreachable
					//   SHA (e.g. a stale merge-base the webview hasn't yet seen invalidated) can't
					//   walk the entire history. `hasMore=true` lets callers retry; the graph-wrapper
					//   side deduplicates re-requests so the cap doesn't loop.
					if (
						(limit && count >= limit && (!sha || found || count >= limit * 10)) ||
						(!limit && sha && found)
					) {
						hasMore = true;
						aborter.abort();
						break;
					}

					if (sha && !found && commit.sha === sha) {
						found = true;
					}

					count++;
					if (ids.has(commit.sha)) continue;

					total++;
					shaOrRemapped = remappedIds.get(commit.sha);
					if (shaOrRemapped && ids.has(shaOrRemapped)) continue;
					shaOrRemapped ??= commit.sha;

					ids.add(shaOrRemapped);

					refHeads = [];
					refRemoteHeads = [];
					refTags = [];

					if (commit.tips) {
						for (tip of commit.tips.split(', ')) {
							head = false;
							if (tip === 'refs/stash') continue;

							if (tip.startsWith('tag: ')) {
								tagName = tip.substring(5);
								tagId = getTagId(repoPath, tagName);
								refTag = {
									id: tagId,
									name: tagName,
									// Not currently used, so don't bother looking it up
									annotated: true,
								};
								refTags.push(refTag);

								continue;
							}

							if (tip.startsWith('HEAD')) {
								head = true;
								reachableFromHEAD.add(shaOrRemapped);

								if (tip !== 'HEAD') {
									tip = tip.substring(8);
								}
							}

							remoteName = getRemoteNameFromBranchName(tip);
							if (remoteName) {
								remote = remoteMap.get(remoteName);
								if (remote != null) {
									branchName = getBranchNameWithoutRemote(tip);
									if (branchName === 'HEAD') continue;

									remoteBranchId = getBranchId(repoPath, true, tip);
									refRemoteHead = {
										id: remoteBranchId,
										name: branchName,
										owner: remote.name,
										url: remote.url,
										current: tip === headRefUpstreamName,
										hostingServiceType: remote.provider?.gkProviderId,
									};
									refRemoteHeads.push(refRemoteHead);

									continue;
								}
							}

							branch = branchMap.get(tip);
							branchId = branch?.id ?? getBranchId(repoPath, false, tip);
							const worktree = worktreesByBranch?.get(branchId);
							refHead = {
								id: branchId,
								name: tip,
								isCurrentHead: head,
								upstream:
									branch?.upstream != null
										? {
												name: branch.upstream.name,
												id: getBranchId(repoPath, true, branch.upstream.name),
											}
										: undefined,
								worktreeId: worktree != null ? getWorktreeId(repoPath, worktree.name) : undefined,
							};
							refHeads.push(refHead);
							if (branch?.upstream?.name != null) {
								// Add the branch name (tip) to the upstream name entry in the downstreams map
								let downstreams = downstreamMap.get(branch.upstream.name);
								if (downstreams == null) {
									downstreams = [];
									downstreamMap.set(branch.upstream.name, downstreams);
								}

								downstreams.push(tip);
							}
						}
					}

					parents = commit.parents ? commit.parents.split(' ') : [];
					if (reachableFromHEAD.has(shaOrRemapped)) {
						for (parent of parents) {
							reachableFromHEAD.add(parent);
						}
					}

					// Seed reachability from all ref types on this commit
					if (refHeads.length > 0 || refRemoteHeads.length > 0 || refTags.length > 0) {
						let refs = reachableRefs.get(shaOrRemapped);
						if (refs == null) {
							refs = new Map<string, ReachableRef>();
							reachableRefs.set(shaOrRemapped, refs);
						}
						for (const h of refHeads) {
							const key = `b:${h.name}`;
							refs.set(key, { refType: 'branch', name: h.name, remote: false, current: h.isCurrentHead });
						}
						for (const r of refRemoteHeads) {
							const name = `${r.owner}/${r.name}`;
							refs.set(`r:${name}`, { refType: 'branch', name: name, remote: true });
						}
						for (const t of refTags) {
							refs.set(`t:${t.name}`, { refType: 'tag', name: t.name });
						}
					}

					// Propagate reachability to parents
					const currentRefs = reachableRefs.get(shaOrRemapped);
					if (currentRefs != null && currentRefs.size > 0) {
						for (parent of parents) {
							let parentRefs = reachableRefs.get(parent);
							if (parentRefs == null) {
								parentRefs = new Map<string, ReachableRef>();
								reachableRefs.set(parent, parentRefs);
							}
							for (const [key, ref] of currentRefs) {
								if (!parentRefs.has(key)) {
									parentRefs.set(key, ref);
								}
							}
						}
					}

					stash = gitStash?.stashes.get(shaOrRemapped);
					if (stash != null) {
						const refs = reachableRefs.get(shaOrRemapped);
						const row: GitGraphRow = {
							sha: shaOrRemapped,
							// Always only return the first parent for stashes, as it is a Git implementation for the index and untracked files
							parents: parents.slice(0, 1),
							author: currentUser?.name ?? commit.author,
							email: commit.authorEmail,
							date: Number(ordering === 'author-date' ? commit.authorDate : commit.committerDate) * 1000,
							commitDate: Number(commit.committerDate) * 1000,
							message: (stash.message ?? commit.message).trim(),
							type: 'stash-node',
							heads: refHeads,
							remotes: refRemoteHeads,
							tags: refTags,
							reachability: refs?.size
								? { partial: true, refs: [...refs.values()].sort(compareReachableRefs) }
								: undefined,
							isCurrentUser: true,
						};
						rowProcessor?.processRow(row, graphCtx!);
						rows.push(row);

						if (stash.stats != null) {
							rowStats.set(shaOrRemapped, {
								files: getChangedFilesCount(stash.stats.files),
								additions: stash.stats.additions,
								deletions: stash.stats.deletions,
							});
						}
					} else {
						isCurrentUser = isUserMatch(currentUser, commit.author, commit.authorEmail);

						const refs = reachableRefs.get(shaOrRemapped);
						const row: GitGraphRow = {
							sha: shaOrRemapped,
							parents: onlyFollowFirstParent ? parents.slice(0, 1) : parents,
							author: commit.author,
							email: commit.authorEmail,
							date: Number(ordering === 'author-date' ? commit.authorDate : commit.committerDate) * 1000,
							commitDate: Number(commit.committerDate) * 1000,
							message: commit.message.trim(),
							type: parents.length > 1 ? 'merge-node' : 'commit-node',
							heads: refHeads,
							remotes: refRemoteHeads,
							tags: refTags,
							reachability: refs?.size
								? { partial: true, refs: [...refs.values()].sort(compareReachableRefs) }
								: undefined,
							isCurrentUser: isCurrentUser || undefined,
						};
						rowProcessor?.processRow(row, graphCtx!);
						rows.push(row);

						if (commit.stats != null) {
							rowStats.set(shaOrRemapped, commit.stats);
						}
					}
				}

				const startingCursor = cursor?.sha;
				const lastSha = last(ids);
				cursor = lastSha != null ? { sha: lastSha, skip: total - iterations } : undefined;

				let rowsStatsDeferred: GitGraph['rowsStatsDeferred'];

				if (deferStats) {
					pendingRowsStatsCount++;

					// eslint-disable-next-line no-async-promise-executor
					const promise = new Promise<void>(async resolve => {
						try {
							const args = [...statsParser.arguments];
							if (startTotal === 0) {
								args.push(`-n${total}`);
							} else {
								args.push(`-n${total - startTotal}`, `--skip=${startTotal}`);
							}
							args.push(`--${ordering}-order`, '--all');

							const statsResult = await this.git.run(
								{ cwd: repoPath, configs: gitConfigsLog, stdin: stdin, priority: 'background' },
								'log',
								stdin ? '--stdin' : undefined,
								...args,
								'--',
							);

							if (statsResult.stdout) {
								let statShaOrRemapped;
								for (const stat of statsParser.parse(statsResult.stdout)) {
									statShaOrRemapped = remappedIds.get(stat.sha) ?? stat.sha;

									// Don't overwrite stats already populated for this sha
									if (rowStats.has(statShaOrRemapped)) continue;

									rowStats.set(statShaOrRemapped, stat.stats);
								}
							}
						} finally {
							pendingRowsStatsCount--;
							resolve();
						}
					});

					rowsStatsDeferred = {
						isLoaded: () => pendingRowsStatsCount === 0,
						promise: promise,
					};
				}

				return {
					repoPath: repoPath,
					avatars: avatars,
					ids: ids,
					includes: options?.include,
					branches: branchMap,
					remotes: remoteMap,
					downstreams: downstreamMap,
					stashes: gitStash?.stashes,
					worktrees: worktrees,
					worktreesByBranch: worktreesByBranch,
					reachableFromHEAD: reachableFromHEAD,
					rows: rows,
					id: sha ?? rev,
					rowsStats: rowStats,
					rowsStatsDeferred: rowsStatsDeferred,
					paging: {
						limit: limit === 0 ? count : limit,
						startingCursor: startingCursor,
						hasMore: hasMore,
					},
					more: async (
						limit: number,
						sha?: string,
						cancellation?: AbortSignal,
					): Promise<GitGraph | undefined> =>
						getCommitsForGraphCore.call(this, limit, sha, cursor, cancellation),
				};
			} catch (ex) {
				scope?.error(ex);
				debugger;

				throw ex;
			}
		}

		return getCommitsForGraphCore.call(this, defaultLimit, selectSha, undefined, cancellation);
	}

	@debug({
		args: (repoPath, s, o) => ({
			repoPath: repoPath,
			search: `[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}${s.matchWholeWord ? 'W' : ''}]: ${
				s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query
			}`,
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
			cursor: `[${c.search.matchAll ? 'A' : ''}${c.search.matchCase ? 'C' : ''}${c.search.matchRegex ? 'R' : ''}${c.search.matchWholeWord ? 'W' : ''}]: ${
				c.search.query.length > 500 ? `${c.search.query.substring(0, 500)}...` : c.search.query
			} (continue)`,
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

			const { args: searchArgs, files, shas, filters } = parseSearchQueryGitCommand(search, currentUser);

			const tipsOnly = filters.type === 'tip';
			const parser = filters.files
				? getShaAndDatesWithFilesLogParser(tipsOnly)
				: getShaAndDatesLogParser(tipsOnly);

			const similarityThreshold = this.context.config?.commits.similarityThreshold ?? undefined;
			const args = [
				'log',
				...parser.arguments,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
				'--use-mailmap',
			];

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;
			let remappedIds: Map<string, string>;

			if (shas?.size) {
				stdin = join(shas, '\n');
				args.push('--no-walk');

				remappedIds = new Map();
			} else if (!filters.refs) {
				// Don't include stashes when using ref: filter, as they would add unrelated commits
				// There *HAS* to be a better way to get git log to return stashes, but this is the best we've found
				({ stdin, stashes, remappedIds } = convertStashesToStdin(
					await this.provider.stash?.getStash(repoPath, { includeFiles: false }, cancellation),
				));
			} else {
				remappedIds = new Map();
			}

			if (stdin) {
				args.push('--stdin');
			}

			const limit = options?.limit ?? this.context.config?.graph?.maxSearchItems ?? 0;
			const ordering = options?.ordering ?? this.context.config?.commits.ordering ?? undefined;
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			// Add the search args, but skip any shas (as they are already included in the stdin)
			for (const arg of searchArgs) {
				if (shas?.has(arg) || args.includes(arg)) continue;

				args.push(arg);
			}

			const results: GitGraphSearchResults = existingResults ?? new Map<string, GitGraphSearchResultData>();

			// Use state from cursor, if provided
			const cursorState = cursor?.state != null && typeof cursor.state === 'object' ? cursor.state : undefined;
			let iterations = cursorState?.iterations ?? 0;
			let totalSeen = cursorState?.totalSeen ?? 0;
			let skipCursor = cursorState ? { sha: cursorState.sha, skip: cursorState.skip } : undefined;

			let count = 0;
			try {
				iterations++;

				const aborter = new AbortController();
				const onAbort = () => {
					aborter.abort();
				};
				cancellation?.addEventListener('abort', onAbort, { once: true });
				using _disposable = createDisposable(() => cancellation?.removeEventListener('abort', onAbort));

				const stream = this.git.stream(
					{
						cwd: repoPath,
						cancellation: aborter.signal,
						configs: ['-C', repoPath, ...gitConfigsLog],
						stdin: stdin,
					},
					...args,
					skipCursor?.skip ? `--skip=${skipCursor.skip}` : undefined,
					'--',
					...files,
				);
				using _streamDisposer = createDisposable(() => void stream.return?.(undefined));
				let hasMore = false;
				let sha;
				const stashesOnly = filters.type === 'stash';

				// Progressive results support - time-based batching for consistent UI updates
				const batch: [string, GitGraphSearchResultData][] = [];
				let lastProgressTime = Date.now();

				for await (const r of parser.parseAsync(stream)) {
					// Check for cancellation early in each iteration
					if (cancellation?.aborted) {
						// When paused/cancelled, assume there are more results
						hasMore = true;
						break;
					}

					count++;
					if (limit && count > limit) {
						hasMore = true;

						aborter.abort();
						break;
					}

					sha = remappedIds.get(r.sha) ?? r.sha;
					if (results.has(sha) || (stashesOnly && !stashes?.has(sha)) || (tipsOnly && !r.tips)) {
						continue;
					}

					const resultData: GitGraphSearchResultData = {
						i: results.size,
						date: Number(options?.ordering === 'author-date' ? r.authorDate : r.committerDate) * 1000,
						files: r.files,
					};
					results.set(sha, resultData);
					batch.push([sha, resultData]);

					// Send progress updates with incremental results
					const timeSinceLastProgress = Date.now() - lastProgressTime;

					// Send batch when enough time has passed and we have new results
					const shouldSendBatch =
						timeSinceLastProgress >= progressiveSearchResultsBatchTimeMs && batch.length > 0;

					if (shouldSendBatch) {
						// Send only the NEW results since last batch (incremental)
						yield {
							repoPath: repoPath,
							query: search,
							queryFilters: filters,
							comparisonKey: comparisonKey,
							results: new Map(batch),
							runningTotal: results.size,
							hasMore: true,
						};
						batch.length = 0;
						lastProgressTime = Date.now();
					}
				}

				// Send final progress update if there are remaining results
				if (batch.length) {
					yield {
						repoPath: repoPath,
						query: search,
						queryFilters: filters,
						comparisonKey: comparisonKey,
						results: new Map(batch),
						runningTotal: results.size,
						hasMore: hasMore,
					};
				}

				totalSeen += count;
				const lastSha = last(results)?.[0];
				skipCursor = lastSha != null ? { sha: lastSha, skip: totalSeen - iterations } : undefined;

				return {
					repoPath: repoPath,
					query: search,
					queryFilters: filters,
					comparisonKey: comparisonKey,
					results: results,
					hasMore: hasMore,
					paging:
						limit || hasMore
							? {
									limit: limit || count,
									cursor:
										hasMore && skipCursor
											? {
													search: search,
													state: {
														iterations: iterations,
														totalSeen: totalSeen,
														sha: skipCursor.sha,
														skip: skipCursor.skip,
													},
												}
											: undefined,
								}
							: undefined,
				};
			} catch (ex) {
				if (isCancellationError(ex) || cancellation?.aborted) {
					// When cancelled, preserve cursor so search can be resumed
					// Update totalSeen with the count from this iteration
					totalSeen += count;
					const lastSha = last(results)?.[0];
					const skipCursor = lastSha != null ? { sha: lastSha, skip: totalSeen - iterations } : undefined;

					return {
						repoPath: repoPath,
						query: search,
						queryFilters: filters,
						comparisonKey: comparisonKey,
						results: results,
						hasMore: true, // Assume there are more results since we were cancelled mid-search
						paging:
							limit || skipCursor
								? {
										limit: limit || count,
										cursor: skipCursor
											? {
													search: search,
													state: {
														iterations: iterations,
														totalSeen: totalSeen,
														sha: skipCursor.sha,
														skip: skipCursor.skip,
													},
												}
											: undefined,
									}
								: undefined,
					};
				}

				throw new GitSearchError(ex);
			}
		} catch (ex) {
			if (ex instanceof GitSearchError) throw ex;

			throw new GitSearchError(ex);
		}
	}
}
