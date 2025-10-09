import type { CancellationToken, Uri } from 'vscode';
import { getCachedAvatarUri } from '../../../../avatars';
import type { SearchQuery } from '../../../../constants.search';
import type { Container } from '../../../../container';
import { emojify } from '../../../../emojis';
import { isCancellationError } from '../../../../errors';
import type { GitCache } from '../../../../git/cache';
import { GitSearchError } from '../../../../git/errors';
import type { GitGraphSubProvider } from '../../../../git/gitProvider';
import type { GitBranch } from '../../../../git/models/branch';
import type { GitStashCommit } from '../../../../git/models/commit';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowContexts,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowsStats,
	GitGraphRowStats,
	GitGraphRowTag,
} from '../../../../git/models/graph';
import type { GitBranchReference } from '../../../../git/models/reference';
import type { GitRemote } from '../../../../git/models/remote';
import type { GitWorktree } from '../../../../git/models/worktree';
import {
	getGraphParser,
	getShaAndDatesLogParser,
	getShaAndStatsLogParser,
	getShaLogParser,
} from '../../../../git/parsers/logParser';
import type { GitGraphSearch, GitGraphSearchResultData, GitGraphSearchResults } from '../../../../git/search';
import { getSearchQueryComparisonKey, parseSearchQueryCommand } from '../../../../git/search';
import { isBranchStarred } from '../../../../git/utils/-webview/branch.utils';
import { getRemoteIconUri } from '../../../../git/utils/-webview/icons';
import { groupWorktreesByBranch } from '../../../../git/utils/-webview/worktree.utils';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getRemoteNameFromBranchName,
} from '../../../../git/utils/branch.utils';
import { getChangedFilesCount } from '../../../../git/utils/commit.utils';
import { createReference } from '../../../../git/utils/reference.utils';
import { isUncommittedStaged } from '../../../../git/utils/revision.utils';
import { getTagId } from '../../../../git/utils/tag.utils';
import { isUserMatch } from '../../../../git/utils/user.utils';
import { getWorktreeId } from '../../../../git/utils/worktree.utils';
import { configuration } from '../../../../system/-webview/configuration';
import { log } from '../../../../system/decorators/log';
import { find, first, join, last } from '../../../../system/iterable';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { getSettledValue } from '../../../../system/promise';
import { mixinDisposable } from '../../../../system/unifiedDisposable';
import { serializeWebviewItemContext } from '../../../../system/webview';
import type {
	GraphBranchContextValue,
	GraphItemContext,
	GraphItemRefContext,
	GraphItemRefGroupContext,
	GraphTagContextValue,
} from '../../../../webviews/plus/graph/protocol';
import type { Git } from '../git';
import { gitConfigsLog } from '../git';
import type { LocalGitProvider } from '../localGitProvider';
import { convertStashesToStdin } from './stash';

export class GraphGitSubProvider implements GitGraphSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@log()
	async getGraph(
		repoPath: string,
		rev: string | undefined,
		asWebviewUri: (uri: Uri) => Uri,
		options?: { include?: { stats?: boolean }; limit?: number },
		cancellation?: CancellationToken,
	): Promise<GitGraph> {
		const scope = getLogScope();

		const defaultLimit = options?.limit ?? configuration.get('graph.defaultItemLimit') ?? 5000;
		const ordering = configuration.get('graph.commitOrdering', undefined, 'date');
		const onlyFollowFirstParent = configuration.get('graph.onlyFollowFirstParent', undefined, false);

		const deferStats = options?.include?.stats;

		const parser = getGraphParser(options?.include?.stats && !deferStats);
		const shaParser = getShaLogParser();
		const statsParser = getShaAndStatsLogParser();

		const [shaResult, stashResult, branchesResult, remotesResult, currentUserResult, worktreesResult] =
			await Promise.allSettled([
				this.git.exec(
					{ cwd: repoPath, configs: gitConfigsLog },
					'log',
					...shaParser.arguments,
					'-n1',
					rev && !isUncommittedStaged(rev) ? rev : 'HEAD',
					'--',
				),
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
		const selectSha = first(shaParser.parse(getSettledValue(shaResult)?.stdout));

		const downstreamMap = new Map<string, string[]>();

		// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
		const gitStash = getSettledValue(stashResult);
		const { stdin, remappedIds } = convertStashesToStdin(gitStash?.stashes);

		const useAvatars = configuration.get('graph.avatars', undefined, true);

		const avatars = new Map<string, string>();
		const ids = new Set<string>();
		const reachableFromHEAD = new Set<string>();
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
					if (count > limit && (!sha || (sha && found))) {
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
									if (group.remotes == null) {
										group.remotes = [];
									}
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
								if (contexts.refGroups == null) {
									contexts.refGroups = {};
								}
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

						contexts.row = serializeWebviewItemContext<GraphItemRefContext>({
							webviewItem: `gitlens:commit${head ? '+HEAD' : ''}${
								reachableFromHEAD.has(shaOrRemapped) ? '+current' : ''
							}`,
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
					id: sha,
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
				Logger.error(ex, scope);
				debugger;

				throw ex;
			}
		}

		return getCommitsForGraphCore.call(this, defaultLimit, selectSha, undefined, cancellation);
	}

	@log<GraphGitSubProvider['searchGraph']>({
		args: {
			1: s =>
				`[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}${s.matchWholeWord ? 'W' : ''}]: ${
					s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query
				}`,
			2: o => `limit=${o?.limit}, ordering=${o?.ordering}`,
		},
	})
	async searchGraph(
		repoPath: string,
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: CancellationToken,
	): Promise<GitGraphSearch> {
		search = { matchAll: false, matchCase: false, matchRegex: true, matchWholeWord: false, ...search };

		const comparisonKey = getSearchQueryComparisonKey(search);
		try {
			const parser = getShaAndDatesLogParser();

			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			const args = [
				'log',

				...parser.arguments,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
				'--use-mailmap',
			];

			const currentUser = search.query.includes('@me')
				? await this.provider.config.getCurrentUser(repoPath)
				: undefined;

			const { args: searchArgs, files, shas, filters } = parseSearchQueryCommand(search, currentUser);

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;
			let remappedIds: Map<string, string>;

			if (shas?.size) {
				stdin = join(shas, '\n');
				args.push('--no-walk');

				remappedIds = new Map();
			} else {
				// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
				({ stdin, stashes, remappedIds } = convertStashesToStdin(
					await this.provider.stash?.getStash(repoPath, undefined, cancellation),
				));
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

			const results: GitGraphSearchResults = new Map<string, GitGraphSearchResultData>();
			let iterations = 0;
			/** Total seen, not results */
			let totalSeen = 0;

			async function searchForCommitsCore(
				this: GraphGitSubProvider,
				limit: number,
				cursor?: { sha: string; skip: number },
				cancellation?: CancellationToken,
			): Promise<GitGraphSearch> {
				iterations++;

				try {
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
						cursor?.skip ? `--skip=${cursor.skip}` : undefined,
						'--',
						...files,
					);

					let count = 0;
					let hasMore = false;
					let sha;
					const stashesOnly = filters.type === 'stash';

					for await (const r of parser.parseAsync(stream)) {
						if (count > limit) {
							hasMore = true;

							aborter.abort();
							break;
						}

						count++;
						sha = remappedIds.get(r.sha) ?? r.sha;
						if (results.has(sha) || (stashesOnly && !stashes?.has(sha))) {
							continue;
						}

						results.set(sha, {
							i: results.size,
							date: Number(options?.ordering === 'author-date' ? r.authorDate : r.committerDate) * 1000,
						});
					}

					totalSeen += count;
					const lastSha = last(results)?.[0];
					cursor = lastSha != null ? { sha: lastSha, skip: totalSeen - iterations } : undefined;

					return {
						repoPath: repoPath,
						query: search,
						comparisonKey: comparisonKey,
						results: results,
						paging: limit ? { limit: limit, hasMore: hasMore } : undefined,
						more: async (limit: number): Promise<GitGraphSearch> =>
							searchForCommitsCore.call(this, limit, cursor),
					};
				} catch (ex) {
					if (isCancellationError(ex) || cancellation?.isCancellationRequested) {
						return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
					}

					throw new GitSearchError(ex);
				}
			}

			return await searchForCommitsCore.call(this, limit, undefined, cancellation);
		} catch (ex) {
			if (ex instanceof GitSearchError) throw ex;

			throw new GitSearchError(ex);
		}
	}
}
