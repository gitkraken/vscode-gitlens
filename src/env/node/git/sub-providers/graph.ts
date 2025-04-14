import type { CancellationToken, Uri } from 'vscode';
import { getCachedAvatarUri } from '../../../../avatars';
import type { SearchQuery } from '../../../../constants.search';
import type { Container } from '../../../../container';
import { emojify } from '../../../../emojis';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
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
	getGraphStatsParser,
	getShaAndDatesLogParser,
	getShaLogParser,
} from '../../../../git/parsers/logParser';
import type { GitGraphSearch, GitGraphSearchResultData, GitGraphSearchResults } from '../../../../git/search';
import { getGitArgsFromSearchQuery, getSearchQueryComparisonKey } from '../../../../git/search';
import { getRemoteIconUri } from '../../../../git/utils/-webview/icons';
import { groupWorktreesByBranch } from '../../../../git/utils/-webview/worktree.utils';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getRemoteNameFromBranchName,
} from '../../../../git/utils/branch.utils';
import { createReference } from '../../../../git/utils/reference.utils';
import { getTagId } from '../../../../git/utils/tag.utils';
import { isUserMatch } from '../../../../git/utils/user.utils';
import { getWorktreeId } from '../../../../git/utils/worktree.utils';
import { configuration } from '../../../../system/-webview/configuration';
import { log } from '../../../../system/decorators/log';
import { find, first, join, last, map, skip } from '../../../../system/iterable';
import { getSettledValue } from '../../../../system/promise';
import { serializeWebviewItemContext } from '../../../../system/webview';
import type {
	GraphBranchContextValue,
	GraphItemContext,
	GraphItemRefContext,
	GraphItemRefGroupContext,
	GraphTagContextValue,
} from '../../../../webviews/plus/graph/protocol';
import type { Git } from '../git';
import { getShaInLogRegex, gitLogDefaultConfigs } from '../git';
import type { LocalGitProvider } from '../localGitProvider';
import { CancelledRunError } from '../shell';

const emptyArray = Object.freeze([]) as unknown as any[];

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
		options?: {
			include?: { stats?: boolean };
			limit?: number;
		},
	): Promise<GitGraph> {
		const defaultLimit = options?.limit ?? configuration.get('graph.defaultItemLimit') ?? 5000;
		const defaultPageLimit = configuration.get('graph.pageItemLimit') ?? 1000;
		const ordering = configuration.get('graph.commitOrdering', undefined, 'date');
		const onlyFollowFirstParent = configuration.get('graph.onlyFollowFirstParent', undefined, false);

		const deferStats = options?.include?.stats; // && defaultLimit > 1000;

		const parser = getGraphParser(options?.include?.stats && !deferStats);
		const shaParser = getShaLogParser();
		const statsParser = getGraphStatsParser();

		const [shaResult, stashResult, branchesResult, remotesResult, currentUserResult, worktreesResult] =
			await Promise.allSettled([
				this.git.log(repoPath, undefined, undefined, ...shaParser.arguments, '-n1', rev ?? 'HEAD'),
				this.provider.stash?.getStash(repoPath),
				this.provider.branches.getBranches(repoPath),
				this.provider.remotes.getRemotes(repoPath),
				this.provider.config.getCurrentUser(repoPath),
				this.provider.worktrees
					?.getWorktrees(repoPath)
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
		const selectSha = first(shaParser.parse(getSettledValue(shaResult) ?? ''));

		const downstreamMap = new Map<string, string[]>();

		let stashes: Map<string, GitStashCommit> | undefined;
		let stdin: string | undefined;

		// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
		const gitStash = getSettledValue(stashResult);
		if (gitStash?.stashes.size) {
			stashes = new Map(gitStash.stashes);
			stdin = join(
				map(stashes.values(), c => c.sha.substring(0, 9)),
				'\n',
			);
		}

		const useAvatars = configuration.get('graph.avatars', undefined, true);

		const avatars = new Map<string, string>();
		const ids = new Set<string>();
		const reachableFromHEAD = new Set<string>();
		const remappedIds = new Map<string, string>();
		const rowStats: GitGraphRowsStats = new Map<string, GitGraphRowStats>();
		let total = 0;
		let iterations = 0;
		let pendingRowsStatsCount = 0;

		async function getCommitsForGraphCore(
			this: GraphGitSubProvider,
			limit: number,
			sha?: string,
			cursor?: { sha: string; skip: number },
		): Promise<GitGraph> {
			const startTotal = total;

			iterations++;

			let log: string | string[] | undefined;
			let nextPageLimit = limit;
			let size;

			do {
				const args = [...parser.arguments, `--${ordering}-order`, '--all'];
				if (onlyFollowFirstParent) {
					args.push('--first-parent');
				}
				if (cursor?.skip) {
					args.push(`--skip=${cursor.skip}`);
				}

				let data;
				if (sha) {
					[data, limit] = await this.git.logStreamTo(
						repoPath,
						sha,
						limit,
						stdin ? { stdin: stdin } : undefined,
						...args,
					);
				} else {
					args.push(`-n${nextPageLimit + 1}`);

					data = await this.git.log(repoPath, undefined, stdin ? { stdin: stdin } : undefined, ...args);

					if (cursor) {
						if (!getShaInLogRegex(cursor.sha).test(data)) {
							// If we didn't find any new commits, we must have them all so return that we have everything
							if (size === data.length) {
								return {
									repoPath: repoPath,
									avatars: avatars,
									ids: ids,
									includes: options?.include,
									branches: branchMap,
									remotes: remoteMap,
									downstreams: downstreamMap,
									stashes: stashes,
									worktrees: worktrees,
									worktreesByBranch: worktreesByBranch,
									rows: [],
								};
							}

							size = data.length;
							nextPageLimit = (nextPageLimit === 0 ? defaultPageLimit : nextPageLimit) * 2;
							cursor.skip -= Math.floor(cursor.skip * 0.1);

							continue;
						}
					}
				}

				if (!data) {
					return {
						repoPath: repoPath,
						avatars: avatars,
						ids: ids,
						includes: options?.include,
						branches: branchMap,
						remotes: remoteMap,
						downstreams: downstreamMap,
						stashes: stashes,
						worktrees: worktrees,
						worktreesByBranch: worktreesByBranch,
						rows: [],
					};
				}

				log = data;
				if (limit !== 0) {
					limit = nextPageLimit;
				}

				break;
			} while (true);

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
			let stash: GitStashCommit | undefined;
			let tagId: string;
			let tagName: string;
			let tip: string;

			let count = 0;

			const commits = parser.parse(log);
			for (const commit of commits) {
				count++;
				if (ids.has(commit.sha)) continue;

				total++;
				if (remappedIds.has(commit.sha)) continue;

				ids.add(commit.sha);

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
							reachableFromHEAD.add(commit.sha);

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
									webviewItem: 'gitlens:branch+remote',
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
							context: serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(context),
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

				stash = gitStash?.stashes.get(commit.sha);

				parents = commit.parents ? commit.parents.split(' ') : [];
				if (reachableFromHEAD.has(commit.sha)) {
					for (parent of parents) {
						reachableFromHEAD.add(parent);
					}
				}

				// Remove the second & third parent, if exists, from each stash commit as it is a Git implementation for the index and untracked files
				if (stash != null && parents.length > 1) {
					// Remap the "index commit" (e.g. contains staged files) of the stash
					remappedIds.set(parents[1], commit.sha);
					// Remap the "untracked commit" (e.g. contains untracked files) of the stash
					remappedIds.set(parents[2], commit.sha);
					parents.splice(1, 2);
				}

				if (stash == null && !avatars.has(commit.authorEmail)) {
					avatarUri = getCachedAvatarUri(commit.authorEmail);
					if (avatarUri != null) {
						avatars.set(commit.authorEmail, avatarUri.toString(true));
					}
				}

				isCurrentUser = isUserMatch(currentUser, commit.author, commit.authorEmail);

				if (stash != null) {
					contexts.row = serializeWebviewItemContext<GraphItemRefContext>({
						webviewItem: 'gitlens:stash',
						webviewItemValue: {
							type: 'stash',
							ref: createReference(commit.sha, repoPath, {
								refType: 'stash',
								name: stash.name,
								message: stash.message,
								number: stash.stashNumber,
							}),
						},
					});
				} else {
					contexts.row = serializeWebviewItemContext<GraphItemRefContext>({
						webviewItem: `gitlens:commit${head ? '+HEAD' : ''}${
							reachableFromHEAD.has(commit.sha) ? '+current' : ''
						}`,
						webviewItemValue: {
							type: 'commit',
							ref: createReference(commit.sha, repoPath, {
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
				}

				rows.push({
					sha: commit.sha,
					parents: onlyFollowFirstParent ? [parents[0]] : parents,
					author: isCurrentUser ? 'You' : commit.author,
					email: commit.authorEmail,
					date: Number(ordering === 'author-date' ? commit.authorDate : commit.committerDate) * 1000,
					message: emojify(commit.message.trim()),
					// TODO: review logic for stash, wip, etc
					type: stash != null ? 'stash-node' : parents.length > 1 ? 'merge-node' : 'commit-node',
					heads: refHeads,
					remotes: refRemoteHeads,
					tags: refTags,
					contexts: contexts,
				});

				if (commit.stats != null) {
					rowStats.set(commit.sha, commit.stats);
				}
			}

			const startingCursor = cursor?.sha;
			const lastSha = last(ids);
			cursor =
				lastSha != null
					? {
							sha: lastSha,
							skip: total - iterations,
					  }
					: undefined;

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

						const statsData = await this.git.log(
							repoPath,
							undefined,
							stdin ? { stdin: stdin } : undefined,
							...args,
						);
						if (statsData) {
							const commitStats = statsParser.parse(statsData);
							for (const stat of commitStats) {
								rowStats.set(stat.sha, stat.stats);
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
				remappedIds: remappedIds,
				branches: branchMap,
				remotes: remoteMap,
				downstreams: downstreamMap,
				stashes: stashes,
				worktrees: worktrees,
				worktreesByBranch: worktreesByBranch,
				rows: rows,
				id: sha,
				rowsStats: rowStats,
				rowsStatsDeferred: rowsStatsDeferred,

				paging: {
					limit: limit === 0 ? count : limit,
					startingCursor: startingCursor,
					hasMore: limit !== 0 && count > limit,
				},
				more: async (limit: number, sha?: string): Promise<GitGraph | undefined> =>
					getCommitsForGraphCore.call(this, limit, sha, cursor),
			};
		}

		return getCommitsForGraphCore.call(this, defaultLimit, selectSha);
	}

	@log<GraphGitSubProvider['searchGraph']>({
		args: {
			1: s =>
				`[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}]: ${
					s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query
				}`,
			2: o => `limit=${o?.limit}, ordering=${o?.ordering}`,
		},
	})
	async searchGraph(
		repoPath: string,
		search: SearchQuery,
		options?: {
			cancellation?: CancellationToken;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo';
		},
	): Promise<GitGraphSearch> {
		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		const comparisonKey = getSearchQueryComparisonKey(search);
		try {
			const parser = getShaAndDatesLogParser();

			const currentUser = search.query.includes('@me')
				? await this.provider.config.getCurrentUser(repoPath)
				: undefined;

			const { args: searchArgs, files, shas } = getGitArgsFromSearchQuery(search, currentUser);
			if (shas?.size) {
				const data = await this.git.exec(
					{ cwd: repoPath, cancellation: options?.cancellation, configs: gitLogDefaultConfigs },
					'show',
					'-s',
					...parser.arguments,
					...shas.values(),
					...searchArgs,
					'--',
				);

				let i = 0;
				const results: GitGraphSearchResults = new Map<string, GitGraphSearchResultData>(
					map(parser.parse(data), c => [
						c.sha,
						{
							i: i++,
							date: Number(options?.ordering === 'author-date' ? c.authorDate : c.committerDate) * 1000,
						},
					]),
				);

				return {
					repoPath: repoPath,
					query: search,
					comparisonKey: comparisonKey,
					results: results,
				};
			}

			const limit = options?.limit ?? configuration.get('advanced.maxSearchItems') ?? 0;
			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			const includeOnlyStashes = searchArgs.includes('--no-walk');

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

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

			const args = [
				...parser.arguments,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
				'--use-mailmap',
			];

			const results: GitGraphSearchResults = new Map<string, GitGraphSearchResultData>();
			let total = 0;

			async function searchForCommitsCore(
				this: GraphGitSubProvider,
				limit: number,
				cursor?: { sha: string; skip: number },
			): Promise<GitGraphSearch> {
				if (options?.cancellation?.isCancellationRequested) {
					return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
				}

				let data;
				try {
					data = await this.git.log(
						repoPath,
						undefined,
						{
							cancellation: options?.cancellation,
							configs: ['-C', repoPath, ...gitLogDefaultConfigs],
							errors: GitErrorHandling.Throw,
							stdin: stdin,
						},
						...args,
						...searchArgs,
						...(options?.ordering ? [`--${options.ordering}-order`] : emptyArray),
						...(limit ? [`-n${limit + 1}`] : emptyArray),
						...(cursor?.skip ? [`--skip=${cursor.skip}`] : emptyArray),
						'--',
						...files,
					);
				} catch (ex) {
					if (ex instanceof CancelledRunError || options?.cancellation?.isCancellationRequested) {
						return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
					}

					throw new GitSearchError(ex);
				}

				if (options?.cancellation?.isCancellationRequested) {
					return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
				}

				let count = total;

				for (const r of parser.parse(data)) {
					if (includeOnlyStashes && !stashes?.has(r.sha)) continue;

					if (results.has(r.sha)) {
						limit--;
						continue;
					}
					results.set(r.sha, {
						i: total++,
						date: Number(options?.ordering === 'author-date' ? r.authorDate : r.committerDate) * 1000,
					});
				}

				count = total - count;
				const lastSha = last(results)?.[0];
				cursor =
					lastSha != null
						? {
								sha: lastSha,
								skip: total,
						  }
						: undefined;

				return {
					repoPath: repoPath,
					query: search,
					comparisonKey: comparisonKey,
					results: results,
					paging:
						limit !== 0 && count > limit
							? {
									limit: limit,
									hasMore: true,
							  }
							: undefined,
					more: async (limit: number): Promise<GitGraphSearch> =>
						searchForCommitsCore.call(this, limit, cursor),
				};
			}

			return await searchForCommitsCore.call(this, limit);
		} catch (ex) {
			if (ex instanceof GitSearchError) throw ex;

			throw new GitSearchError(ex);
		}
	}
}
