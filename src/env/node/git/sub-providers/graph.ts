import type { CancellationToken, Uri } from 'vscode';
import { getCachedAvatarUri } from '../../../../avatars.js';
import type { SearchQuery } from '../../../../constants.search.js';
import type { Container } from '../../../../container.js';
import { emojify } from '../../../../emojis.js';
import { isCancellationError } from '../../../../errors.js';
import type { GitCache } from '../../../../git/cache.js';
import { GitSearchError } from '../../../../git/errors.js';
import type { GitGraphSubProvider } from '../../../../git/gitProvider.js';
import type { GitBranch } from '../../../../git/models/branch.js';
import type { GitStashCommit } from '../../../../git/models/commit.js';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowContexts,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowsStats,
	GitGraphRowStats,
	GitGraphRowTag,
} from '../../../../git/models/graph.js';
import type { GitBranchReference } from '../../../../git/models/reference.js';
import type { GitRemote } from '../../../../git/models/remote.js';
import type { GitWorktree } from '../../../../git/models/worktree.js';
import {
	getGraphParser,
	getShaAndDatesLogParser,
	getShaAndDatesWithFilesLogParser,
	getShaAndStatsLogParser,
	getShaLogParser,
} from '../../../../git/parsers/logParser.js';
import type {
	GitGraphSearch,
	GitGraphSearchCursor,
	GitGraphSearchProgress,
	GitGraphSearchResultData,
	GitGraphSearchResults,
} from '../../../../git/search.js';
import { getSearchQueryComparisonKey, parseSearchQueryGitCommand } from '../../../../git/search.js';
import { isBranchStarred } from '../../../../git/utils/-webview/branch.utils.js';
import { getRemoteIconUri } from '../../../../git/utils/-webview/icons.js';
import { groupWorktreesByBranch } from '../../../../git/utils/-webview/worktree.utils.js';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getRemoteNameFromBranchName,
} from '../../../../git/utils/branch.utils.js';
import { getChangedFilesCount } from '../../../../git/utils/commit.utils.js';
import { createReference } from '../../../../git/utils/reference.utils.js';
import { isUncommitted } from '../../../../git/utils/revision.utils.js';
import { getTagId } from '../../../../git/utils/tag.utils.js';
import { isUserMatch } from '../../../../git/utils/user.utils.js';
import { getWorktreeId } from '../../../../git/utils/worktree.utils.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { debug } from '../../../../system/decorators/log.js';
import { find, first, join, last } from '../../../../system/iterable.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import { getSettledValue } from '../../../../system/promise.js';
import { createDisposable, mixinDisposable } from '../../../../system/unifiedDisposable.js';
import { serializeWebviewItemContext } from '../../../../system/webview.js';
import type {
	GraphBranchContextValue,
	GraphItemContext,
	GraphItemRefContext,
	GraphItemRefGroupContext,
	GraphTagContextValue,
} from '../../../../webviews/plus/graph/protocol.js';
import type { Git } from '../git.js';
import { gitConfigsLog } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';
import { convertStashesToStdin } from './stash.js';

const progressiveSearchResultsBatchTimeMs = 500; // Send updates every 500ms (2 updates/second)

export class GraphGitSubProvider implements GitGraphSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@debug()
	async getGraph(
		repoPath: string,
		rev: string | undefined,
		asWebviewUri: (uri: Uri) => Uri,
		options?: { include?: { stats?: boolean }; limit?: number },
		cancellation?: CancellationToken,
	): Promise<GitGraph> {
		const scope = getScopedLogger();

		const defaultLimit = options?.limit ?? configuration.get('graph.defaultItemLimit') ?? 5000;
		const ordering = configuration.get('graph.commitOrdering', undefined, 'date');
		const onlyFollowFirstParent = configuration.get('graph.onlyFollowFirstParent', undefined, false);

		const deferStats = options?.include?.stats;

		const parser = getGraphParser(options?.include?.stats && !deferStats);
		const shaParser = getShaLogParser();
		const statsParser = getShaAndStatsLogParser();

		const [shaResult, stashResult, branchesResult, remotesResult, currentUserResult, worktreesResult] =
			await Promise.allSettled([
				!isUncommitted(rev, true)
					? this.git.exec(
							{ cwd: repoPath, configs: gitConfigsLog },
							'log',
							...shaParser.arguments,
							'-n1',
							rev ?? 'HEAD',
							'--',
						)
					: undefined,
				this.provider.stash?.getStash(repoPath, undefined, cancellation),
				this.provider.branches.getBranches(repoPath, undefined, cancellation),
				this.provider.remotes.getRemotes(repoPath, undefined, cancellation),
				this.provider.config.getCurrentUser(repoPath),
				this.provider.worktrees
					?.getWorktrees(repoPath, cancellation)
					.then(w => [w, groupWorktreesByBranch(w, { includeDefault: true })]) satisfies Promise<
					[GitWorktree[], Map<string, GitWorktree>]
				>,
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

		// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
		const gitStash = getSettledValue(stashResult);
		const { stdin, remappedIds } = convertStashesToStdin(gitStash?.stashes);

		const useAvatars = configuration.get('graph.avatars', undefined, true);

		const avatars = new Map<string, string>();
		const ids = new Set<string>();
		const reachableFromHEAD = new Set<string>();
		const reachableFromBranches = new Map<string, Set<string>>();
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
			cancellation?: CancellationToken,
		): Promise<GitGraph> {
			try {
				iterations++;
				const startTotal = total;

				const aborter = new AbortController();
				using _disposable = mixinDisposable(cancellation?.onCancellationRequested(() => aborter.abort()));

				const stream = this.git.stream(
					{ cwd: repoPath, configs: gitConfigsLog, signal: aborter.signal, stdin: stdin },
					...args,
					cursor?.skip ? `--skip=${cursor.skip}` : undefined,
					'--',
				);
				using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

				const rows: GitGraphRow[] = [];

				let avatarUri: Uri | undefined;
				let avatarUrl: string | undefined;
				let branch: GitBranch | undefined;
				let branchId: string;
				let branchName: string;
				let context:
					| GraphItemRefContext<GraphBranchContextValue>
					| GraphItemRefContext<GraphTagContextValue>
					| undefined;
				let contexts: GitGraphRowContexts | undefined;
				let group;
				let groupName;
				const groupedRefs = new Map<
					string,
					{ head?: boolean; local?: GitBranchReference; remotes?: GitBranchReference[] }
				>();
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

				for await (const commit of parser.parseAsync(stream)) {
					// Stopping logic (check AFTER processing the commit):
					// - SHA + limit > 0: Find SHA, ensure at least `limit` commits loaded
					// - SHA + limit = 0: Find SHA, stop immediately
					// - No SHA + limit > 0: Load exactly `limit` commits
					// - No SHA + limit = 0: Load everything remaining
					if ((limit && count >= limit && (!sha || found)) || (!limit && sha && found)) {
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
					contexts = {};

					if (commit.tips) {
						groupedRefs.clear();

						for (tip of commit.tips.split(', ')) {
							head = false;
							if (tip === 'refs/stash') continue;

							if (tip.startsWith('tag: ')) {
								tagName = tip.substring(5);
								tagId = getTagId(repoPath, tagName);
								context = {
									webviewItem: 'gitlens:tag',
									webviewItemValue: {
										type: 'tag',
										ref: createReference(tagName, repoPath, {
											id: tagId,
											refType: 'tag',
											name: tagName,
										}),
									},
								};

								refTag = {
									id: tagId,
									name: tagName,
									// Not currently used, so don't bother looking it up
									annotated: true,
									context:
										serializeWebviewItemContext<GraphItemRefContext<GraphTagContextValue>>(context),
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
									avatarUrl = (
										(useAvatars ? remote.provider?.avatarUri : undefined) ??
										getRemoteIconUri(this.container, remote, asWebviewUri)
									)?.toString(true);
									context = {
										webviewItem: `gitlens:branch+remote${isBranchStarred(this.container, remoteBranchId) ? '+starred' : ''}`,
										webviewItemValue: {
											type: 'branch',
											ref: createReference(tip, repoPath, {
												id: remoteBranchId,
												refType: 'branch',
												name: tip,
												remote: true,
												upstream: { name: remote.name, missing: false },
											}),
										},
									};

									refRemoteHead = {
										id: remoteBranchId,
										name: branchName,
										owner: remote.name,
										url: remote.url,
										avatarUrl: avatarUrl,
										context:
											serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(
												context,
											),
										current: tip === headRefUpstreamName,
										hostingServiceType: remote.provider?.gkProviderId,
									};
									refRemoteHeads.push(refRemoteHead);

									group = groupedRefs.get(branchName);
									if (group == null) {
										group = { remotes: [] };
										groupedRefs.set(branchName, group);
									}
									group.remotes ??= [];
									group.remotes.push(context.webviewItemValue.ref);

									continue;
								}
							}

							branch = branchMap.get(tip);
							branchId = branch?.id ?? getBranchId(repoPath, false, tip);
							context = {
								webviewItem: `gitlens:branch${head ? '+current' : ''}${
									branch?.upstream != null ? '+tracking' : ''
								}${
									worktreesByBranch?.has(branchId)
										? '+worktree'
										: branchIdOfMainWorktree === branchId
											? '+checkedout'
											: ''
								}${branch?.starred ? '+starred' : ''}${branch?.upstream?.state.ahead ? '+ahead' : ''}${
									branch?.upstream?.state.behind ? '+behind' : ''
								}`,
								webviewItemValue: {
									type: 'branch',
									ref: createReference(tip, repoPath, {
										id: branchId,
										refType: 'branch',
										name: tip,
										remote: false,
										upstream: branch?.upstream,
									}),
								},
							};

							const worktree = worktreesByBranch?.get(branchId);
							refHead = {
								id: branchId,
								name: tip,
								isCurrentHead: head,
								context:
									serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(context),
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

							group = groupedRefs.get(tip);
							if (group == null) {
								group = {};
								groupedRefs.set(tip, group);
							}

							if (head) {
								group.head = true;
							}
							group.local = context.webviewItemValue.ref;
						}

						for ([groupName, group] of groupedRefs) {
							if (
								group.remotes != null &&
								((group.local != null && group.remotes.length > 0) || group.remotes.length > 1)
							) {
								contexts.refGroups ??= {};
								contexts.refGroups[groupName] = serializeWebviewItemContext<GraphItemRefGroupContext>({
									webviewItemGroup: `gitlens:refGroup${group.head ? '+current' : ''}`,
									webviewItemGroupValue: {
										type: 'refGroup',
										refs: group.local != null ? [group.local, ...group.remotes] : group.remotes,
									},
								});
							}
						}
					}

					parents = commit.parents ? commit.parents.split(' ') : [];
					if (reachableFromHEAD.has(shaOrRemapped)) {
						for (parent of parents) {
							reachableFromHEAD.add(parent);
						}
					}

					if (refHeads.length > 0) {
						let branches = reachableFromBranches.get(shaOrRemapped);
						if (branches == null) {
							branches = new Set<string>();
							reachableFromBranches.set(shaOrRemapped, branches);
						}
						for (const refHead of refHeads) {
							branches.add(refHead.name);
						}
					}

					const currentBranches = reachableFromBranches.get(shaOrRemapped);
					if (currentBranches != null && currentBranches.size > 0) {
						for (parent of parents) {
							let parentBranches = reachableFromBranches.get(parent);
							if (parentBranches == null) {
								parentBranches = new Set<string>();
								reachableFromBranches.set(parent, parentBranches);
							}
							for (const branchName of currentBranches) {
								parentBranches.add(branchName);
							}
						}
					}

					stash = gitStash?.stashes.get(shaOrRemapped);
					if (stash != null) {
						contexts.row = serializeWebviewItemContext<GraphItemRefContext>({
							webviewItem: 'gitlens:stash',
							webviewItemValue: {
								type: 'stash',
								ref: createReference(shaOrRemapped, repoPath, {
									refType: 'stash',
									name: stash.name,
									message: stash.message,
									number: stash.stashNumber,
								}),
							},
						});

						const branches = reachableFromBranches.get(shaOrRemapped);
						rows.push({
							sha: shaOrRemapped,
							// Always only return the first parent for stashes, as it is a Git implementation for the index and untracked files
							parents: parents.slice(0, 1),
							author: 'You',
							email: commit.authorEmail,
							date: Number(ordering === 'author-date' ? commit.authorDate : commit.committerDate) * 1000,
							message: emojify(stash.message ?? commit.message.trim()),
							type: 'stash-node',
							heads: refHeads,
							remotes: refRemoteHeads,
							tags: refTags,
							contexts: contexts,
							reachableFromBranches: branches ? [...branches] : undefined,
						});

						if (stash.stats != null) {
							rowStats.set(shaOrRemapped, {
								files: getChangedFilesCount(stash.stats.files),
								additions: stash.stats.additions,
								deletions: stash.stats.deletions,
							});
						}
					} else {
						isCurrentUser = isUserMatch(currentUser, commit.author, commit.authorEmail);

						if (!avatars.has(commit.authorEmail)) {
							avatarUri = getCachedAvatarUri(commit.authorEmail);
							if (avatarUri != null) {
								avatars.set(commit.authorEmail, avatarUri.toString(true));
							}
						}

						const branches = reachableFromBranches.get(shaOrRemapped);
						const isUniqueToBranch = branches?.size === 1;

						contexts.row = serializeWebviewItemContext<GraphItemRefContext>({
							webviewItem: `gitlens:commit${head ? '+HEAD' : ''}${
								reachableFromHEAD.has(shaOrRemapped) ? '+current' : ''
							}${isUniqueToBranch ? '+unique' : ''}`,
							webviewItemValue: {
								type: 'commit',
								ref: createReference(shaOrRemapped, repoPath, {
									refType: 'revision',
									message: commit.message,
								}),
							},
						});

						contexts.avatar = serializeWebviewItemContext<GraphItemContext>({
							webviewItem: `gitlens:contributor${isCurrentUser ? '+current' : ''}`,
							webviewItemValue: {
								type: 'contributor',
								repoPath: repoPath,
								name: commit.author,
								email: commit.authorEmail,
								current: isCurrentUser,
							},
						});

						rows.push({
							sha: shaOrRemapped,
							parents: onlyFollowFirstParent ? parents.slice(0, 1) : parents,
							author: isCurrentUser ? 'You' : commit.author,
							email: commit.authorEmail,
							date: Number(ordering === 'author-date' ? commit.authorDate : commit.committerDate) * 1000,
							message: emojify(commit.message.trim()),
							type: parents.length > 1 ? 'merge-node' : 'commit-node',
							heads: refHeads,
							remotes: refRemoteHeads,
							tags: refTags,
							contexts: contexts,
							reachableFromBranches: branches ? [...branches] : undefined,
						});

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

							const statsResult = await this.git.exec(
								{ cwd: repoPath, configs: gitConfigsLog, stdin: stdin },
								'log',
								stdin ? '--stdin' : undefined,
								...args,
								'--',
							);

							if (statsResult.stdout) {
								let statShaOrRemapped;
								for (const stat of statsParser.parse(statsResult.stdout)) {
									statShaOrRemapped = remappedIds.get(stat.sha) ?? stat.sha;

									// If we already have the stats for this sha, skip it (e.g. stashes)
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
						cancellation?: CancellationToken,
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
		cancellation?: CancellationToken,
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

			const similarityThreshold = configuration.get('advanced.similarityThreshold');
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
				// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
				({ stdin, stashes, remappedIds } = convertStashesToStdin(
					await this.provider.stash?.getStash(repoPath, undefined, cancellation),
				));
			} else {
				remappedIds = new Map();
			}

			if (stdin) {
				args.push('--stdin');
			}

			const limit = options?.limit ?? configuration.get('advanced.maxSearchItems') ?? 0;
			const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
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
				using _disposable = mixinDisposable(cancellation?.onCancellationRequested(() => aborter.abort()));

				const stream = this.git.stream(
					{
						cwd: repoPath,
						cancellation: cancellation,
						configs: ['-C', repoPath, ...gitConfigsLog],
						signal: aborter.signal,
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
					if (cancellation?.isCancellationRequested) {
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
				if (isCancellationError(ex) || cancellation?.isCancellationRequested) {
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
