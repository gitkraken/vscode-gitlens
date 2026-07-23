import type { CancellationTokenSource, Disposable } from 'vscode';
import { env, ProgressLocation, Uri, window } from 'vscode';
import type { AIReviewResult } from '@gitlens/ai/models/results.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import { rootSha, uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { classifyConflictAction, getConflictKindLabel } from '@gitlens/git/utils/conflictResolution.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { createRevisionRange, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { uuid } from '@gitlens/utils/crypto.js';
import { annotateDiffWithNewLineNumbers } from '@gitlens/utils/diff.js';
import { lazy } from '@gitlens/utils/lazy.js';
import { Logger } from '@gitlens/utils/logger.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { pluralize } from '@gitlens/utils/string.js';
import { getAvatarUri } from '../../../avatars.js';
import { openExplainDocument } from '../../../commands/explainBase.js';
import type { ExplainCommitCommandArgs } from '../../../commands/explainCommit.js';
import { generateChangelogAndOpenMarkdownDocument } from '../../../commands/generateChangelog.js';
import type { RunPromptInAgentCommandArgs } from '../../../commands/runPromptInAgent.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getBranchMergeTargetName } from '../../../git/utils/-webview/branch.utils.js';
import { getConflictFileInfos } from '../../../git/utils/-webview/conflictKind.utils.js';
import { getChangesForChangelog } from '../../../git/utils/-webview/log.utils.js';
import { getSupportedAgents } from '../../../plus/agents/agentRegistry.js';
import type { AIGenerateChangelogChanges } from '../../../plus/ai/actions/generateChangelog.js';
import { shouldUseSinglePass } from '../../../plus/ai/actions/reviewChanges.js';
import { prepareCompareDataForAIRequest } from '../../../plus/ai/utils/-webview/ai.utils.js';
import type { ChangesContextCommit, ChangesContextInput } from '../../../plus/ai/utils/-webview/changesContext.js';
import {
	formatChangesContextForPrompt,
	gatherContextForChanges,
} from '../../../plus/ai/utils/-webview/changesContext.js';
import type { ConflictToolsIntegration } from '../../../plus/coretools/conflict/integration.js';
import type {
	ConflictProgressEvent,
	Resolution as ConflictToolsResolution,
	ResolutionContext,
	ResolutionRefs,
} from '../../../plus/coretools/conflict/types.js';
import { showContributorsPicker } from '../../../quickpicks/contributorsPicker.js';
import { showReferencePicker2 } from '../../../quickpicks/referencePicker.js';
import { showRevisionFilesPicker } from '../../../quickpicks/revisionFilesPicker.js';
import { cancelAndDispose, fromAbortSignal, toAbortSignal } from '../../../system/-webview/cancellation.js';
import { executeCommand } from '../../../system/-webview/command.js';
import { loadChunk } from '../../../system/-webview/loadChunk.js';
import type { ExplainResult } from '../../commitDetails/commitDetailsService.js';
import { getCoreCommitDetails } from '../../commitDetails/commitDetailsWebview.utils.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../../rpc/eventVisibilityBuffer.js';
import { createRpcEvent } from '../../rpc/eventVisibilityBuffer.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type { ChoosePathParams, DidChoosePathParams } from '../timeline/protocol.js';
import { buildTimelineDataset } from '../timeline/timelineDataset.js';
import type { GraphComposeIntegration } from './compose/integration.js';
import { isComposeSimulatorActive, runSimulatedComposeChanges } from './compose/simulator.js';
import { executeComposeCommit, isComposeCancelled, libraryPlanToProposedCommits } from './compose/utils.js';
import type { CommitDetails, CompareDiff, Wip } from './detailsProtocol.js';
import {
	GraphComposeVirtualContentProvider,
	GraphComposeVirtualNamespace,
} from './graphComposeVirtualContentProvider.js';
import {
	GraphResolveVirtualContentProvider,
	GraphResolveVirtualNamespace,
	ResolveVirtualSide,
} from './graphResolveVirtualContentProvider.js';
import { getScopeFiles } from './graphScopeService.js';
import type {
	BranchCommitEntry,
	BranchCommitsOptions,
	BranchCommitsResult,
	BranchComparisonCommit,
	BranchComparisonContributor,
	BranchComparisonFile,
	ComposeProgressUpdate,
	ConflictFallbackInfo,
	GraphServices,
	ProposedCommit,
	QueuedTakeSide,
	ResolvedFileSummary,
	ResolveFileError,
	ResolveProgressUpdate,
	ResolveSkippedFile,
	ScopeSelection,
	TakeConflictSideResult,
	VirtualRefShape,
} from './graphService.js';

/** Collaborators the inspect/compose/review/timeline/treemap cluster reaches for on the host provider,
 *  assembled by `GraphWebviewProvider.createGraphInspectContext()`. `getSession` reads live provider
 *  state; `getWipForRepoAndStats` forwards into the WIP service's cache (kept there); `getSearchContext`
 *  reads the provider's active graph search state (kept there). */
export type GraphInspectServicesContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getSession: () => GitGraphSession | undefined;
	getWipForRepoAndStats: (
		repo: GlRepository,
		signal?: AbortSignal,
		options?: { force?: boolean },
	) => Promise<{ wip: Wip } | undefined>;
	getSearchContext: (sha: string | undefined) => GitCommitSearchContext | undefined;
};

/** Host-side inspect/compose/review cluster for the graph, split out of `GraphWebviewProvider` (R3).
 *  Owns the commit-details / compare-diff / AI-review / changelog / compose / conflict-resolution logic
 *  behind the `graphInspect` RPC service (plus the small `graphTimeline`/`graphTreemap` services), the
 *  compose/resolve virtual-session machinery, the per-AI-request diff + review-history caches, and the
 *  in-flight AI-run cancellations. The provider keeps the decorated IPC forwarders and the RPC wiring
 *  and injects the collaborators via {@link GraphInspectServicesContext}. */
export class GraphInspectServices {
	constructor(private readonly context: GraphInspectServicesContext) {}

	private get container(): Container {
		return this.context.container;
	}
	private get host(): WebviewHost<'gitlens.views.graph' | 'gitlens.graph'> {
		return this.context.host;
	}
	private get session(): GitGraphSession | undefined {
		return this.context.getSession();
	}

	/** In-flight AI-run cancellation sources, so `dispose()` can cancel them when the webview is torn
	 *  down (their driving webview signal can't fire once its realm is gone). */
	private _aiCancellations = new Set<CancellationTokenSource>();
	/** Virtual FS session backing the compose panel's per-proposed-commit diffs. Lazy-initialized on first compose. */
	private _composeVirtual?: {
		readonly provider: GraphComposeVirtualContentProvider;
		readonly registration: Disposable;
		sessionId?: string;
	};
	private _composeToolsForGraph?: GraphComposeIntegration;
	private readonly _activeComposeCacheKeys = new Map<string, string>();
	/** Virtual FS session backing the resolve panel's per-file resolved-vs-conflicted diffs. Lazy-initialized on first resolve. */
	private _resolveVirtual?: {
		readonly provider: GraphResolveVirtualContentProvider;
		readonly registration: Disposable;
		sessionId?: string;
	};
	private _conflictToolsForGraph?: ConflictToolsIntegration;
	/** Cached full AI resolutions per repo (keyed by repoPath) — holds the resolved `content` for a
	 *  later `applyResolutions`, plus the virtual session id so it can be ended on discard/apply. */
	private readonly _activeResolveSessions = new Map<
		string,
		{ resolutions: readonly ConflictToolsResolution[]; sessionId: string }
	>();
	/** Per-repo AI conversation ID for the active resolve session — sent with every AI request so
	 *  the backend charges its flat per-feature fee once per session, across re-runs and per-file
	 *  retries. Kept separate from {@link _activeResolveSessions} because it must exist before the
	 *  first AI call and survive a cancelled/failed first run (so a re-run reuses it); cleared with
	 *  the session in {@link discardResolveSession}. */
	private readonly _resolveConversationIds = new Map<string, string>();
	private static readonly _diffCacheCap = 4;
	/** LRU-capped per-AI-request diff cache. Cap is small because only one review and one
	 *  compose can be active at a time — the only legitimate concurrent keys are (review, compose,
	 *  + a couple of variants from changing excludedFiles within a session). */
	private readonly _graphDetailsDiffCache = new LruMap<string, { diff: string; message: string; context: string }>(
		GraphInspectServices._diffCacheCap,
	);
	/** Completed exchanges of the active review conversation per diff-cache key (oldest first).
	 *  Replayed on `mode: 'refine'` requests so the AI sees the prior review as a conversation to
	 *  follow up on. Kept in lockstep with `_graphDetailsDiffCache` — same keying, same reset. */
	private readonly _reviewHistoryCache = new LruMap<string, { instructions?: string; result: AIReviewResult }[]>(
		GraphInspectServices._diffCacheCap,
	);
	private readonly _composeProgressEvent = createRpcEvent<ComposeProgressUpdate | undefined>(
		'composeProgress',
		'save-last',
	);
	private readonly _resolveProgressEvent = createRpcEvent<ResolveProgressUpdate | undefined>(
		'resolveProgress',
		'save-last',
	);

	dispose(): void {
		// AI runs (generate/review/compose) are driven by the webview's AbortController, which can't
		// fire once the webview is gone — cancel host-side so the AI call doesn't run for a discarded result.
		cancelAndDispose(this._aiCancellations);
		this._aiCancellations.clear();
		// Release any compose-tools library plans we still hold cache keys for — otherwise the
		// library-side cache leaks plans across extension reloads (the keys are this side's
		// only handle to them; once we drop the Map without a `discardCachedPlan` call, the
		// library has no way to know the plans are abandoned).
		if (this._composeToolsForGraph != null && this._activeComposeCacheKeys.size > 0) {
			for (const cacheKey of this._activeComposeCacheKeys.values()) {
				this._composeToolsForGraph.discardCachedPlan(cacheKey);
			}
		}
		this._activeComposeCacheKeys.clear();
		if (this._composeVirtual != null) {
			this._composeVirtual.provider.dispose();
			this._composeVirtual.registration.dispose();
			this._composeVirtual = undefined;
		}
		this._activeResolveSessions.clear();
		// Flush each conversation's aggregated BYOK usage report (one feature fee per session) so a
		// webview teardown mid-session doesn't drop it.
		for (const conversationId of this._resolveConversationIds.values()) {
			void this.container.ai.flushBYOKUsage(conversationId);
		}
		this._resolveConversationIds.clear();
		if (this._resolveVirtual != null) {
			this._resolveVirtual.provider.dispose();
			this._resolveVirtual.registration.dispose();
			this._resolveVirtual = undefined;
		}
	}

	/** Clears the per-AI-request diff + review-history caches — the repo-reset hook, mirroring
	 *  `resetRepositoryState`. */
	resetCaches(): void {
		this._graphDetailsDiffCache.clear();
		this._reviewHistoryCache.clear();
	}

	createServices(
		buffer?: EventVisibilityBuffer,
		tracker?: SubscriptionTracker,
	): Pick<GraphServices, 'graphInspect' | 'graphTimeline' | 'graphTreemap'> {
		return {
			graphInspect: {
				getAiExcludedFiles: async (repoPath: string, filePaths: string[]) => {
					const { AIIgnoreCache } = await loadChunk(
						() => import(/* webpackChunkName: "ai" */ '../../../plus/ai/aiIgnoreCache.js'),
					);
					const aiIgnore = new AIIgnoreCache(this.container, repoPath);
					const included = await aiIgnore.excludeIgnored(filePaths);
					const includedSet = new Set(included);
					return filePaths.filter(p => !includedSet.has(p));
				},
				getScopeFiles: async (repoPath: string, scope: ScopeSelection, signal?: AbortSignal) =>
					getScopeFiles(this.container, repoPath, scope, signal),
				getBranchCommits: async (repoPath: string, options?: BranchCommitsOptions, signal?: AbortSignal) => {
					signal?.throwIfAborted();
					const branchCommitsPageSize = 100;
					const limit = options?.limit ?? branchCommitsPageSize;
					try {
						const svc = this.container.git.getRepositoryService(repoPath);
						const branch = await svc.branches.getBranch();
						if (!branch) return { commits: [], hasMore: false };

						const upstreamRef = branch.upstream?.name;
						const hasUpstream = upstreamRef != null && !branch.upstream?.missing;
						const aheadCount = hasUpstream ? (branch.upstream!.state.ahead ?? 0) : 0;

						// Always compute merge base against the base branch — even when an upstream
						// exists — so the picker can extend the scope into already-pushed commits.
						let mergeBaseSha: string | undefined;
						let baseBranch: string | undefined;
						try {
							baseBranch =
								(await svc.branches.getBaseBranchName?.(branch.name)) ??
								(await svc.branches.getDefaultBranchName?.());
						} catch {
							// APIs may not be available
						}

						const candidates = baseBranch ? [baseBranch] : ['main', 'master', 'develop'];
						for (const candidate of candidates) {
							if (candidate === branch.name) continue;

							try {
								const result = await svc.refs.getMergeBase(branch.ref, candidate);
								if (result) {
									mergeBaseSha = result;
									break;
								}
							} catch (ex) {
								Logger.debug(
									`getMergeBase(${branch.ref}, ${candidate}) failed: ${String(ex)}`,
									'graph.compose',
								);
							}
						}

						// Fallback: if no base branch matched but we have an upstream, use the
						// upstream tip — preserves prior behavior so we never regress.
						if (mergeBaseSha == null && hasUpstream && upstreamRef != null) {
							mergeBaseSha = upstreamRef;
						}

						// On Load more (`includePastMergeBase`) walk the full branch log so ancestor
						// history past the merge base is brought in. Otherwise scope to the
						// merge-base..branch range so the picker shows the branch-divergence window.
						let logRef: string;
						if (options?.includePastMergeBase) {
							mergeBaseSha = undefined;
							logRef = branch.ref;
						} else {
							logRef = mergeBaseSha ? `${mergeBaseSha}..${branch.ref}` : branch.ref;
						}
						// Request one extra so we can detect "more available" without a separate count.
						let log = await svc.commits.getLog(logRef, { limit: limit + 1 });
						signal?.throwIfAborted();

						// Merge base equals (or is reachable from) the branch tip — no commits in
						// scope. Fall back to a plain branch log so the picker shows a page of recent
						// commits scoped to this branch (not HEAD, which may be a different worktree).
						if (mergeBaseSha != null && !log?.commits?.size) {
							mergeBaseSha = undefined;
							logRef = branch.ref;
							log = await svc.commits.getLog(logRef, { limit: limit + 1 });
							signal?.throwIfAborted();
						}

						if (!log?.commits?.size) return { commits: [], hasMore: false };

						const total = log.commits.size;
						// Always offer Load more while in merge-base scope so the user can opt in to
						// ancestor history even when the page isn't full. Once we've extended past the
						// merge base, `hasMore` reflects the actual branch log size — when it returns
						// false on a subsequent Load more, the button disappears.
						const hasMore = mergeBaseSha != null || total > limit;

						const entries: BranchCommitEntry[] = [];
						let index = 0;
						for (const [sha, commit] of log.commits) {
							if (index >= limit) break;

							const fileCount =
								commit.stats?.files != null
									? typeof commit.stats.files === 'number'
										? commit.stats.files
										: commit.stats.files.added +
											commit.stats.files.deleted +
											commit.stats.files.changed
									: 0;

							// With upstream: commits within ahead count are unpushed, rest are pushed
							// Without upstream: all branch commits since merge base are unpushed
							const isPushed = hasUpstream ? index >= aheadCount : false;

							const entry: BranchCommitEntry = {
								sha: sha,
								message: commit.message ?? '',
								author: commit.author?.name ?? '',
								date: commit.author?.date != null ? String(commit.author.date) : '',
								fileCount: fileCount,
								additions: commit.stats?.additions,
								deletions: commit.stats?.deletions,
								pushed: isPushed,
							};
							entries.push(entry);

							this.setAvatarIfCached(entry, commit.author?.email, sha, repoPath);
							index++;
						}

						// Resolve the merge base commit message
						let mergeBase: BranchCommitsResult['mergeBase'];
						if (mergeBaseSha) {
							try {
								const mbCommit = await svc.commits.getCommit(mergeBaseSha);
								signal?.throwIfAborted();
								if (mbCommit) {
									const mbEntry: NonNullable<typeof mergeBase> = {
										sha: mbCommit.sha,
										message: mbCommit.message?.split('\n')[0] ?? '',
										author: mbCommit.author?.name,
										date: mbCommit.author?.date != null ? String(mbCommit.author.date) : undefined,
									};
									this.setAvatarIfCached(mbEntry, mbCommit.author?.email, mbCommit.sha, repoPath);
									mergeBase = mbEntry;
								}
							} catch {
								// If we can't resolve it, just use the SHA
								mergeBase = { sha: mergeBaseSha, message: '' };
							}
						}

						return { commits: entries, mergeBase: mergeBase, hasMore: hasMore };
					} catch {
						return { commits: [], hasMore: false };
					}
				},
				getCommit: async (
					repoPath: string,
					sha: string,
					signal?: AbortSignal,
				): Promise<CommitDetails | undefined> => {
					signal?.throwIfAborted();
					const commit =
						this.session?.current.stashes?.get(sha) ??
						(await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha, signal));
					if (commit == null) return undefined;

					signal?.throwIfAborted();
					return getCoreCommitDetails(commit, { knownAvatars: this.session?.current.avatars });
				},
				getSearchContext: (sha: string): Promise<GitCommitSearchContext | undefined> => {
					return Promise.resolve(this.context.getSearchContext(sha));
				},
				getCompareDiff: async (
					repoPath: string,
					from: string,
					to: string,
					signal?: AbortSignal,
				): Promise<CompareDiff | undefined> => {
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);
					const comparison = `${from}..${to}`;
					const [filesResult, countResult] = await Promise.allSettled([
						svc.diff.getDiffStatus(comparison),
						svc.commits.getCommitCount(comparison, signal),
					]);
					signal?.throwIfAborted();
					const files = getSettledValue(filesResult);
					let additions = 0;
					let deletions = 0;
					const changedFiles = { added: 0, deleted: 0, changed: 0 };
					const mappedFiles =
						files?.map(f => {
							if (f.stats != null) {
								additions += f.stats.additions;
								deletions += f.stats.deletions;
							}
							switch (f.status) {
								case 'A':
								case '?':
									changedFiles.added++;
									break;
								case 'D':
									changedFiles.deleted++;
									break;
								default:
									changedFiles.changed++;
									break;
							}
							return {
								repoPath: repoPath,
								path: f.path,
								status: f.status,
								originalPath: f.originalPath,
								staged: false,
								stats: f.stats,
							};
						}) ?? [];
					return {
						files: mappedFiles,
						stats:
							files != null
								? { files: changedFiles, additions: additions, deletions: deletions }
								: undefined,
						commitCount: getSettledValue(countResult),
					};
				},
				getWip: async (
					repoPath: string,
					signal?: AbortSignal,
					force?: boolean,
				): Promise<{ wip: Wip } | undefined> => {
					signal?.throwIfAborted();

					// Secondary worktrees (incl. ones nested in the main working tree) may not be pre-registered
					// as Repository instances; resolve the precise worktree, opening on demand — closed, so they
					// don't surface in the VS Code UI. `detectNested` avoids getRepository()'s nearest-ancestor fold.
					const repo = await this.container.git.getOrAddRepository(Uri.file(repoPath), {
						opened: false,
						detectNested: true,
					});
					if (repo == null) return undefined;

					// Returning `wip` (with stats embedded as `wip.stats`) lets the cold-load path
					// reseed the webview's `workingTreeStats` slot from the same `git status` the
					// panel uses — if a prior initial-state fetch landed with bad data and no FS event
					// has fired since, the header/row badges stay stuck on stale stats until the next
					// incidental tick.
					// `force` (user-initiated refresh) advances the repo's status generation so the button runs
					// a genuinely fresh `git status` — rather than joining one already in flight from before
					// the click, or re-serving a cached entry.
					return this.context.getWipForRepoAndStats(repo, signal, force ? { force: true } : undefined);
				},
				explainCommit: async (
					repoPath: string,
					sha: string,
					prompt?: string,
					signal?: AbortSignal,
				): Promise<ExplainResult> => {
					try {
						signal?.throwIfAborted();
						await executeCommand<ExplainCommitCommandArgs>('gitlens.ai.explainCommit', {
							repoPath: repoPath,
							rev: sha,
							prompt: prompt || undefined,
							source: { source: 'graph', context: { type: 'commit' } },
						});
						return { result: { summary: '', body: '' } };
					} catch (ex) {
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					}
				},
				generateChangelogCompare: async (
					repoPath: string,
					fromRef: string,
					toRef: string,
					signal?: AbortSignal,
				): Promise<void> => {
					// Call `generateChangelogAndOpenMarkdownDocument` directly rather than going
					// through `executeCommand('gitlens.ai.generateChangelog', …)`. The command
					// indirection breaks the await chain on the webview-side IPC — the proxy
					// resolves before `execute()`'s inner awaits settle, clearing the webview's
					// busy state in milliseconds even though the AI is still running. Calling the
					// markdown-generator directly keeps the host method pinned through the full AI
					// cycle, mirroring the `explainCompare` pattern below.
					try {
						signal?.throwIfAborted();
						const svc = this.container.git.getRepositoryService(repoPath);
						const baseRef = createReference(fromRef, repoPath, { refType: 'revision' });
						const headRef = createReference(toRef, repoPath, { refType: 'revision' });
						const mergeBase = await svc.refs.getMergeBase(headRef.ref, baseRef.ref);

						await generateChangelogAndOpenMarkdownDocument(
							this.container,
							lazy(async () => {
								const range: AIGenerateChangelogChanges['range'] = {
									base: mergeBase
										? {
												ref: mergeBase,
												label:
													mergeBase === baseRef.ref
														? `\`${shortenRevision(mergeBase)}\``
														: `\`${baseRef.ref}@${shortenRevision(mergeBase)}\``,
											}
										: { ref: baseRef.ref, label: `\`${shortenRevision(baseRef.ref)}\`` },
									head: {
										ref: headRef.ref,
										label: `\`${shortenRevision(headRef.ref)}\``,
									},
								};
								const log = await svc.commits.getLog(
									createRevisionRange(mergeBase ?? baseRef.ref, headRef.ref, '..'),
								);
								if (!log?.commits?.size) return { changes: [], range: range };
								return getChangesForChangelog(this.container, range, log);
							}),
							{ source: 'graph', detail: 'compare' },
							{ progress: { location: ProgressLocation.Notification } },
						);
					} catch (ex) {
						Logger.error(ex, 'GraphWebviewProvider', 'generateChangelogCompare');
					}
				},
				getPreviousTag: async (
					repoPath: string,
					tagName: string,
					tagSha: string,
					signal?: AbortSignal,
				): Promise<string | undefined> => {
					try {
						signal?.throwIfAborted();
						const svc = this.container.git.getRepositoryService(repoPath);
						const { values: tags } = await svc.tags.getTags({ sort: true }, signal);

						// Anchor on the current tag's date so only strictly-older tags are considered
						// (the reachability check below is the real guarantee; this just bounds cost).
						const currentDate = tags.find(t => t.name === tagName)?.date?.getTime();

						// `tags` is date-desc, so the first older tag that is an ancestor of the current
						// tag is the newest previous reachable tag.
						for (const tag of tags) {
							signal?.throwIfAborted();
							if (tag.sha === tagSha || tag.name === tagName) continue;
							if (currentDate != null && (tag.date?.getTime() ?? 0) >= currentDate) continue;

							const mergeBase = await svc.refs.getMergeBase(tag.sha, tagSha, undefined, signal);
							if (mergeBase === tag.sha) return tag.name;
						}
						return undefined;
					} catch (ex) {
						if (isCancellationError(ex)) throw ex;

						Logger.error(ex, 'GraphWebviewProvider', 'getPreviousTag');
						return undefined;
					}
				},
				explainCompare: async (
					repoPath: string,
					fromSha: string,
					toSha: string,
					prompt?: string,
					signal?: AbortSignal,
				): Promise<ExplainResult> => {
					try {
						signal?.throwIfAborted();
						const svc = this.container.git.getRepositoryService(repoPath);
						const data = await prepareCompareDataForAIRequest(svc, toSha, fromSha);
						if (data == null) {
							return { error: { message: 'No changes found between the selected commits' } };
						}

						const fromShort = shortenRevision(fromSha);
						const toShort = shortenRevision(toSha);
						const changes = {
							diff: data.diff,
							message: `Changes between ${fromShort} and ${toShort}:\n\n${data.logMessages}`,
							instructions: prompt || undefined,
						};

						const result = await this.container.ai.actions.explainChanges(
							changes,
							{ source: 'graph', context: { type: 'compare' } },
							{
								progress: {
									location: ProgressLocation.Notification,
									title: `Explaining changes between ${fromShort}..${toShort}...`,
								},
							},
						);

						if (result === 'cancelled' || result == null) {
							return { result: { summary: '', body: '' } };
						}

						const { promise, model } = result;

						openExplainDocument(
							this.container,
							promise,
							`/explain/compare/${fromSha}/${toSha}`,
							model,
							'explain-compare',
							{
								header: {
									title: 'Comparison Summary',
									subtitle: `${fromShort}..${toShort}`,
								},
								command: {
									label: 'Explain Comparison',
									name: 'gitlens.ai.explainCommit' as const,
									args: { repoPath: repoPath, rev: toSha, source: { source: 'graph' } },
								},
							},
						);

						// Keep the webview's busy state pinned for the full generation cycle —
						// `openExplainDocument` fire-and-forgets `promise` to stream content into the
						// already-opened placeholder doc, so without this await the busy signal would
						// clear as soon as the placeholder doc opens (not when the AI actually
						// finishes). Errors are already surfaced into the doc by openExplainDocument's
						// own .then handler, so we just swallow rejections here.
						await promise.catch(() => undefined);

						return { result: { summary: '', body: '' } };
					} catch (ex) {
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					}
				},
				reviewChanges: async (repoPath, scope, prompt, excludedFiles, signal, options) => {
					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(
						signal,
						this._aiCancellations,
					);
					try {
						signal?.throwIfAborted();

						const reviewType = this.getReviewTypeForScope(scope);
						const diffCacheKey = this.getDiffCacheKey(repoPath, scope, excludedFiles);

						// A follow-up (refine) continues the cached conversation against the same
						// diff; anything else — including a refine request whose conversation is no
						// longer cached — starts fresh
						const exchanges =
							options?.mode === 'refine' ? this._reviewHistoryCache.get(diffCacheKey) : undefined;
						const followUp = exchanges?.length ? { exchanges: exchanges } : undefined;
						if (followUp == null) {
							this._reviewHistoryCache.delete(diffCacheKey);
							this._graphDetailsDiffCache.delete(diffCacheKey);
						}

						const cachedData = followUp != null ? this._graphDetailsDiffCache.get(diffCacheKey) : undefined;
						const data = cachedData ?? (await this.getDiffForScope(repoPath, scope, signal));
						if (!data) return { error: { message: 'No changes found.' } };

						if (cachedData == null) {
							// Filter out user-excluded files before review (cached entries are already filtered)
							const excluded = excludedFiles?.length ? new Set(excludedFiles) : undefined;
							if (excluded?.size) {
								const { filterDiffFiles } = await loadChunk(
									() => import(/* webpackChunkName: "ai" */ '@gitlens/git/parsers/diffParser.js'),
								);
								data.diff = await filterDiffFiles(data.diff, paths =>
									paths.filter(p => !excluded.has(p)),
								);
								signal?.throwIfAborted();

								if (!data.diff?.trim()) return { error: { message: 'No changes found.' } };
							}

							this._graphDetailsDiffCache.set(diffCacheKey, {
								diff: data.diff,
								message: data.message,
								context: data.context,
							});
						} else {
							this._graphDetailsDiffCache.touch(diffCacheKey);
						}

						// Adaptive strategy: single-pass for small diffs, two-pass for large. The
						// threshold is scoped to the selected model's input-context budget — a 1M-
						// token model happily single-passes a 100KB diff that an 8k-context model
						// couldn't. `{ silent: true }` avoids prompting the user from a background
						// fetch; on an unset model the helper falls back to a conservative default.
						// Pass `scope: 'review'` so the threshold matches the model that the
						// downstream `reviewChanges` action will actually run.
						// A follow-up keeps the conversation's original strategy — its replayed
						// exchanges were produced under it — even if a model switch would now
						// decide differently.
						const aiModel = await this.container.ai.getModel({ silent: true, scope: 'review' });
						signal?.throwIfAborted();
						const useSinglePass =
							followUp != null
								? followUp.exchanges.at(-1)?.result.mode === 'single-pass'
								: shouldUseSinglePass(data.diff, aiModel);
						if (useSinglePass) {
							const result = await this.container.ai.actions.reviewChanges(
								{
									diff: data.diff,
									message: data.message,
									context: data.context,
									instructions: prompt || undefined,
								},
								{ source: 'graph', context: { type: reviewType, mode: 'single-pass' } },
								{ cancellation: cancellation, followUp: followUp },
							);

							if (result === 'cancelled' || result == null) {
								return { error: { message: 'Review was cancelled.' } };
							}

							const response = await result.promise;
							if (response === 'cancelled' || response == null) {
								return { error: { message: 'Review was cancelled.' } };
							}

							this.recordReviewExchange(diffCacheKey, prompt, response.result, followUp != null);
							return { result: response.result };
						}

						// Two-pass: build file manifest from the (already filtered) diff
						const { parseGitDiff, countDiffInsertionsAndDeletions } = await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/git/parsers/diffParser.js'),
						);
						signal?.throwIfAborted();
						const parsed = parseGitDiff(data.diff);
						const parsedFiles = parsed.files.map(f => {
							const { insertions, deletions } = countDiffInsertionsAndDeletions(f);
							return { path: f.path, status: 'M', additions: insertions, deletions: deletions };
						});
						const fileManifest = JSON.stringify(parsedFiles);

						const overviewResult = await this.container.ai.actions.reviewOverview(
							{
								files: fileManifest,
								message: data.message,
								context: data.context,
								instructions: prompt || undefined,
							},
							{ source: 'graph', context: { type: reviewType, mode: 'two-pass' } },
							{ cancellation: cancellation, followUp: followUp },
						);

						if (overviewResult === 'cancelled' || overviewResult == null) {
							return { error: { message: 'Review was cancelled.' } };
						}

						const overviewResponse = await overviewResult.promise;
						if (overviewResponse === 'cancelled' || overviewResponse == null) {
							return { error: { message: 'Review was cancelled.' } };
						}

						this.recordReviewExchange(diffCacheKey, prompt, overviewResponse.result, followUp != null);
						return { result: overviewResponse.result };
					} catch (ex) {
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					} finally {
						disposeCancellation();
					}
				},
				reviewFocusArea: async (
					repoPath,
					scope,
					focusAreaId,
					focusAreaFiles,
					overviewContext,
					prompt,
					excludedFiles,
					signal,
				) => {
					// Registry-tracked like every other AI run (see `reviewChanges`): a superseded focus-area
					// review must stop consuming the model when the webview aborts, and `dispose()` must be
					// able to cancel it on teardown.
					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(
						signal,
						this._aiCancellations,
					);
					try {
						signal?.throwIfAborted();

						const reviewType = this.getReviewTypeForScope(scope);
						const diffCacheKey = this.getDiffCacheKey(repoPath, scope, excludedFiles);
						const cachedData = this._graphDetailsDiffCache.get(diffCacheKey);
						const data = cachedData ?? (await this.getDiffForScope(repoPath, scope, signal));
						if (!data) return { error: { message: 'No changes found for this focus area.' } };

						if (cachedData == null) {
							this._graphDetailsDiffCache.set(diffCacheKey, data);
						} else {
							this._graphDetailsDiffCache.touch(diffCacheKey);
						}

						// Filter diff to only include focus area files, excluding user-excluded files
						const excluded = excludedFiles?.length ? new Set(excludedFiles) : undefined;
						const { filterDiffFiles } = await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/git/parsers/diffParser.js'),
						);
						const filteredDiff = await filterDiffFiles(data.diff, () =>
							excluded?.size ? focusAreaFiles.filter(f => !excluded.has(f)) : focusAreaFiles,
						);
						signal?.throwIfAborted();

						if (!filteredDiff?.trim()) {
							return { error: { message: 'No diff content found for the specified files.' } };
						}

						const result = await this.container.ai.actions.reviewFocusArea(
							{
								diff: filteredDiff,
								overview: overviewContext,
								message: data.message,
								focusArea: focusAreaFiles.join(', '),
								context: data.context,
								instructions: prompt || undefined,
							},
							focusAreaId,
							{ source: 'graph', context: { type: reviewType, mode: 'two-pass' } },
							{ cancellation: cancellation },
						);

						if (result === 'cancelled' || result == null) {
							return { error: { message: 'Review was cancelled.' } };
						}

						const response = await result.promise;
						if (response === 'cancelled' || response == null) {
							return { error: { message: 'Review was cancelled.' } };
						}

						return { result: response.result };
					} catch (ex) {
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					} finally {
						disposeCancellation();
					}
				},
				trackReviewAction: args => {
					if (args.action === 'copy') {
						void this.container.usage.track('action:gitlens.ai.review.copied:happened');
						const label =
							args.granularity === 'review'
								? 'Review findings copied to clipboard'
								: args.granularity === 'focusArea'
									? 'Focus area findings copied to clipboard'
									: 'Finding copied to clipboard';
						window.setStatusBarMessage(`$(check) ${label}`, 3000);
					}
					return Promise.resolve();
				},
				addressReviewFindingsInChat: async args => {
					try {
						if ((await getSupportedAgents(this.container)).length === 0) {
							void window.showWarningMessage(
								'No supported AI agent is available in this editor. The review has been copied to your clipboard so you can paste it elsewhere.',
							);
							await env.clipboard.writeText(args.reviewMarkdown);
							return { ok: false, reason: 'no-agents' };
						}

						// `{ silent: true }` avoids prompting from the RPC. The webview gates the
						// "Send to agent" button on `aiModel != null`, so this is a defensive check
						// for the race where the model was cleared between the gate and the call.
						// `scope: 'review'` matches the model the review action used to produce the
						// findings being forwarded to chat.
						const aiModel = await this.container.ai.getModel({ silent: true, scope: 'review' });
						if (aiModel == null) {
							void window.showWarningMessage(
								'An AI model must be selected before sending review findings to chat.',
							);
							return { ok: false, reason: 'no-ai-model' };
						}

						const { prompt } = await this.container.ai.getPrompt('address-review-findings', undefined, {
							reviewMarkdown: args.reviewMarkdown,
							scopeLabel: args.scopeLabel,
							granularity: args.granularity,
							instructions: args.instructions,
						});

						void this.container.usage.track('action:gitlens.ai.openInAgent:happened');

						// Review-level is a conversational opener; area/finding-level are self-contained
						// tasks that should auto-submit.
						await executeCommand('gitlens.runPromptInAgent', {
							prompt: prompt,
							cwd: args.repoPath,
							mode: 'agent',
							autoExecute: args.granularity !== 'review',
							source: 'graph',
						} as RunPromptInAgentCommandArgs);
						return { ok: true };
					} catch (ex) {
						const message = ex instanceof Error ? ex.message : String(ex);
						void window.showWarningMessage(`Unable to send review findings to chat: ${message}`);
						return { ok: false, reason: 'error', message: message };
					}
				},
				generateCommitMessage: async (repoPath, currentMessage, amend, signal) => {
					// Pass the Repository (not a raw diff) so the AI service applies its
					// staged-first → unstaged-fallback convention. The previous implementation
					// always grabbed the full uncommitted diff (staged + unstaged), which produced
					// messages that didn't match what the user was about to commit on a
					// staging-aware repo.
					// Omit `progress` so no VS Code notification is shown — the WIP panel drives
					// its own inline generating UI and exposes cancel via the sparkle button.
					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(
						signal,
						this._aiCancellations,
					);
					// Cancellable by both the webview signal and host `dispose()` (via the registry).
					const cancellationSignal = toAbortSignal(cancellation);
					try {
						const repo = this.container.git.getRepository(repoPath);
						if (repo == null) return undefined;

						// When amending, generate against what the amend will actually produce: the
						// existing commit's content plus the changes being folded in. Diff from the
						// amend target's parent (`sha^`) to the index (staged-only) or working tree
						// (`all`), matching the staged-vs-all decision the commit itself makes. If
						// that yields nothing (a message-only amend with no new changes), fall back
						// to the existing commit's own diff so the AI still has content to describe.
						let changesOrRepo: GlRepository | string = repo;
						if (amend != null) {
							const from = `${amend.sha}^`;
							let diff = await repo.git.diff.getDiff?.(
								amend.all ? uncommitted : uncommittedStaged,
								from,
								undefined,
								cancellationSignal,
							);
							if (!diff?.contents) {
								diff = await repo.git.diff.getDiff?.(
									amend.sha,
									undefined,
									undefined,
									cancellationSignal,
								);
							}
							if (diff?.contents) {
								changesOrRepo = diff.contents;
							}
						}

						const result = await this.container.ai.actions.generateCommitMessage(
							changesOrRepo,
							{ source: 'graph-details' },
							{ context: currentMessage, cancellation: cancellation },
						);
						if (result === 'cancelled' || result == null) return undefined;

						return result.result;
					} catch (ex) {
						// Surface the failure instead of silently returning so regressions are visible.
						Logger.error(ex, 'graph.generateCommitMessage');
						return undefined;
					} finally {
						disposeCancellation();
					}
				},
				pickCoauthors: async (repoPath, currentMessage) => {
					try {
						const repo = this.container.git.getRepository(repoPath);
						if (repo == null) return undefined;

						// Same multi-select contributor picker the SCM `Add Co-authors…` action uses;
						// pre-pick anyone already present in the message so re-opening it keeps them
						// selected (deselecting removes them when the trailer block is rewritten).
						const contributors = await showContributorsPicker(
							this.container,
							repo,
							'Add Co-authors',
							'Choose contributors to add as co-authors',
							{
								appendReposToTitle: true,
								clearButton: true,
								multiselect: true,
								picked: c => currentMessage?.includes(c.coauthor) ?? false,
							},
						);
						// Return the `Name <email>` strings — `GitContributor`'s `coauthor` getter
						// wouldn't survive RPC serialization, so compute it host-side.
						return contributors?.map(c => c.coauthor);
					} catch (ex) {
						// Match generateCommitMessage: surface the failure in logs rather than letting
						// it become an unhandled rejection in the webview's fire-and-forget caller.
						Logger.error(ex, 'graph.pickCoauthors');
						return undefined;
					}
				},
				composeChanges: async (
					repoPath,
					scope,
					instructions,
					excludedFiles,
					aiExcludedFiles,
					signal,
					options,
				) => {
					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(
						signal,
						this._aiCancellations,
					);
					// Hoisted so the catch block can `discardCachedPlan` if any step after the
					// library-side plan registration throws — otherwise an exception after the
					// `generatePlan...` cache write leaks the cached plan in the compose-tools
					// library with no path to discard it.
					let cacheKeyToRegister: string | undefined;
					try {
						signal?.throwIfAborted();

						if (scope.type !== 'wip') {
							return { error: { message: 'Compose is only supported for working changes.' } };
						}

						const svc = this.container.git.getRepositoryService(repoPath);

						// AI simulator bypass — `compose-tools`' validators reject synthetic AI
						// responses (they require real diff-hunk indices), so the simulator can't
						// drive a successful compose end-to-end through the real pipeline. When the
						// simulator is active we synthesize a `planResult` from the working tree
						// directly and reuse the same downstream conversion + virtual session wiring.
						// `commitCompose` is intentionally out of scope (no cache key is registered);
						// the bypass surfaces "No active compose plan" if the user tries to commit.
						// Gated on DEBUG so the bypass is unreachable in production builds even if a
						// user manually flips `gitlens.ai.model` to `simulator:*` in settings.json.
						const simulated = DEBUG && isComposeSimulatorActive();

						const composeTools = simulated ? undefined : await this.getOrCreateComposeToolsForGraph();
						if (!simulated && composeTools == null) {
							return { error: { message: 'Compose is not available in this environment.' } };
						}

						// Prior cache key threaded from the webview, falling back to our tracked active key per repo.
						const priorCacheKey = options?.priorCacheKey ?? this._activeComposeCacheKeys.get(repoPath);
						const isRefine = options?.mode === 'refine';
						if (!isRefine && priorCacheKey != null) {
							composeTools?.discardCachedPlan(priorCacheKey);
							this._activeComposeCacheKeys.delete(repoPath);
						}

						// Refine path: chat-style continuation against the cached plan. NO git
						// operations, NO re-analysis. Falls through to a fresh generate if the
						// prior cache is missing (e.g. the host restarted between turns).
						const useRefinePath = !simulated && isRefine && priorCacheKey != null && composeTools != null;

						this._composeProgressEvent.fire({
							phase: useRefinePath ? 'refining' : 'collecting',
							message: useRefinePath ? 'Refining commits…' : 'Preparing changes…',
						});

						const planResult = simulated
							? await runSimulatedComposeChanges({
									svc: svc,
									scope: scope,
									signal: signal,
									onProgress: event => {
										this._composeProgressEvent.fire({
											phase: event.phase,
											message: event.message,
										});
									},
								})
							: useRefinePath
								? await composeTools.refinePlanForGraphDetails({
										svc: svc,
										priorCacheKey: priorCacheKey,
										customInstructions: instructions,
										excludedCommitIds: options?.excludedCommitIds,
										cancellation: cancellation,
										telemetrySource: { source: 'graph' },
										onProgress: event => {
											this._composeProgressEvent.fire({
												phase: event.phase,
												message: event.message,
											});
										},
									})
								: await composeTools!.generatePlanForGraphDetails({
										svc: svc,
										scope: scope,
										customInstructions: instructions,
										excludedFiles: excludedFiles,
										aiExcludedFiles: aiExcludedFiles,
										cancellation: cancellation,
										telemetrySource: { source: 'graph' },
										onProgress: event => {
											this._composeProgressEvent.fire({
												phase: event.phase,
												message: event.message,
											});
										},
									});
						signal?.throwIfAborted();

						// The library cached the plan keyed by `planResult.cacheKey` once
						// `generatePlan...` resolved — we must `discardCachedPlan(key)` if the
						// downstream steps throw, otherwise the library-side plan leaks (the key is
						// our only handle to it). Tracked in the hoisted `cacheKeyToRegister`
						// until we know the full pipeline succeeded; only then do we register it
						// for `commitCompose` to apply.
						cacheKeyToRegister = simulated ? undefined : (planResult as { cacheKey: string }).cacheKey;

						// getCommit('HEAD') (optional base metadata) and deriveComposeCommits are independent — overlap them.
						const [headCommitResult, commitsResult] = await Promise.allSettled([
							svc.commits.getCommit('HEAD'),
							this.deriveComposeCommits(repoPath, planResult),
						]);
						signal?.throwIfAborted();
						if (commitsResult.status === 'rejected') throw commitsResult.reason;

						const headCommit = getSettledValue(headCommitResult);
						const commits = commitsResult.value;

						const baseAnchorSha =
							planResult.kind === 'wip-only' ? planResult.headSha : planResult.rewriteFromSha;
						const baseAnchorCommit =
							baseAnchorSha === planResult.headSha
								? headCommit
								: baseAnchorSha === rootSha
									? undefined
									: await svc.commits.getCommit(baseAnchorSha);
						signal?.throwIfAborted();

						// Register the cache key NOW that the full pipeline succeeded.
						// Anything that threw between `generatePlan...` and here lands in the
						// catch below, where we explicitly `discardCachedPlan` so the
						// library doesn't leak the abandoned plan.
						if (cacheKeyToRegister != null) {
							this._activeComposeCacheKeys.set(repoPath, cacheKeyToRegister);
						}

						return {
							result: {
								commits: commits.toReversed(),
								baseCommit: {
									sha: baseAnchorSha,
									message: baseAnchorCommit?.message?.split('\n')[0] ?? '',
									author: baseAnchorCommit?.author?.name,
									date: baseAnchorCommit?.author?.date?.toISOString(),
									rewriteFromSha: planResult.rewriteFromSha,
									kind: planResult.kind,
									selectedShas: planResult.selectedShas,
								},
								cacheKey: cacheKeyToRegister,
							},
						};
					} catch (ex) {
						// Discard the library-cached plan that `generatePlan...` registered —
						// this throw path leaves us with no way for the user to apply it.
						// `composeTools` is scoped to the try block; re-fetch the (cached) singleton
						// for the discard call here.
						if (cacheKeyToRegister != null) {
							this._composeToolsForGraph?.discardCachedPlan(cacheKeyToRegister);
						}
						if (isCancellationError(ex) || isComposeCancelled(ex)) {
							return { cancelled: true };
						}
						return {
							error: {
								message: ex instanceof Error ? ex.message : String(ex),
							},
						};
					} finally {
						this._composeProgressEvent.fire(undefined);
						disposeCancellation();
					}
				},
				onComposeProgress: this._composeProgressEvent.subscribe(buffer, tracker),
				commitCompose: async (repoPath, plan) => {
					const composeTools = await this.getOrCreateComposeToolsForGraph();
					if (composeTools == null) {
						return { error: { message: 'Compose is not available in this environment.' } };
					}

					const cacheKey = this._activeComposeCacheKeys.get(repoPath);
					if (cacheKey == null) {
						return { error: { message: 'No active compose plan; please regenerate.' } };
					}

					try {
						return await executeComposeCommit(this.container, repoPath, plan, composeTools, cacheKey);
					} finally {
						this._activeComposeCacheKeys.delete(repoPath);
						// `discardCachedPlan` is idempotent (Map.delete on missing key is a no-op).
						// Always call so a thrown `executeComposeCommit` can't leak the library
						// plan — once we drop our cache-key handle, the library has no other way
						// to discard it later. `dispose()` only iterates keys still in our map.
						composeTools.discardCachedPlan(cacheKey);
					}
				},
				regenerateProposedCommitMessage: async (repoPath, cacheKey, commitId, signal) => {
					const composeTools = await this.getOrCreateComposeToolsForGraph();
					if (composeTools == null) {
						return { error: { message: 'Compose is not available in this environment.' } };
					}

					// Defend against a stale cacheKey (refine swaps keys, panel close discards):
					// the panel must always send the active key from its workflow signal. A miss
					// surfaces a recoverable error so the user can simply re-run compose.
					const activeKey = this._activeComposeCacheKeys.get(repoPath);
					if (activeKey !== cacheKey) {
						return {
							error: { message: 'This compose plan is no longer active; please regenerate.' },
						};
					}

					const cached = composeTools.getMaskedHunksForCachedCommit(cacheKey, commitId);
					if (cached == null) {
						return {
							error: { message: 'Unable to find the selected commit in the current plan.' },
						};
					}

					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(
						signal,
						this._aiCancellations,
					);
					try {
						const { createCombinedDiffForCommit } = await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '../composer/utils/composer.utils.js'),
						);
						const { patch } = createCombinedDiffForCommit(cached.hunks);
						if (!patch) {
							return { error: { message: 'Unable to build a diff for the selected commit.' } };
						}

						const result = await this.container.ai.actions.generateCommitMessage(
							patch,
							{ source: 'graph-details', correlationId: this.host.instanceId },
							{ cancellation: cancellation },
						);

						if (result === 'cancelled') return { cancelled: true };
						if (result == null) {
							return { error: { message: 'AI did not return a message. Please try again.' } };
						}

						const message = result.result.body
							? `${result.result.summary}\n\n${result.result.body}`
							: result.result.summary;

						// Mutate the cached plan so subsequent refine sees the new message in
						// priorPlan (used for locked-commit substitution) and apply commits it.
						// If the cache entry was discarded between our earlier read and now (race
						// with a parallel refine or close), the mutation just no-ops and the
						// caller falls back to refreshing.
						composeTools.updateCachedPlanCommitMessage(cacheKey, commitId, message);

						return { result: { commitId: commitId, message: message } };
					} catch (ex) {
						if (isCancellationError(ex)) return { cancelled: true };

						Logger.error(ex, 'graph.regenerateProposedCommitMessage');
						return {
							error: { message: ex instanceof Error ? ex.message : String(ex) },
						};
					} finally {
						disposeCancellation();
					}
				},
				reorderProposedCommits: async (repoPath, cacheKey, orderedCommitIds) => {
					const composeTools = await this.getOrCreateComposeToolsForGraph();
					if (composeTools == null) {
						return { error: { message: 'Compose is not available in this environment.' } };
					}

					// Defend against a stale cacheKey (refine swaps keys, panel close discards): the
					// panel must always send the active key from its workflow signal. A miss surfaces
					// a recoverable error so the user can simply re-run compose.
					const activeKey = this._activeComposeCacheKeys.get(repoPath);
					if (activeKey !== cacheKey) {
						return { error: { message: 'This compose plan is no longer active; please regenerate.' } };
					}

					if (!composeTools.reorderCachedPlan(cacheKey, orderedCommitIds)) {
						return { error: { message: 'This compose plan is no longer active; please regenerate.' } };
					}

					return { result: true };
				},
				moveComposeFile: async (repoPath, cacheKey, fromCommitId, toCommitId, paths) => {
					const composeTools = await this.getOrCreateComposeToolsForGraph();
					if (composeTools == null) {
						return { error: { message: 'Compose is not available in this environment.' } };
					}

					const activeKey = this._activeComposeCacheKeys.get(repoPath);
					if (activeKey !== cacheKey) {
						return { error: { message: 'This compose plan is no longer active; please regenerate.' } };
					}

					if (!composeTools.moveFilesBetweenCommits(cacheKey, fromCommitId, toCommitId, paths)) {
						return {
							error: {
								message: `Unable to move ${paths.length === 1 ? 'that file' : 'those files'}; please regenerate the plan.`,
							},
						};
					}

					// Moving a file changes the affected commits' content (and may have dropped an
					// emptied commit), so re-derive the plan's display commits from the mutated cache.
					const planResult = composeTools.getCachedPlanResult(cacheKey);
					if (planResult == null) {
						return { error: { message: 'This compose plan is no longer active; please regenerate.' } };
					}

					const commits = await this.deriveComposeCommits(repoPath, planResult);
					return { result: { commits: commits.toReversed() } };
				},
				resolveConflicts: async (repoPath, focusedFilePaths, instructions, signal) => {
					const integration = await this.getOrCreateConflictToolsForGraph();
					if (integration == null) {
						return { error: { message: 'AI conflict resolution is not available in this environment.' } };
					}

					const svc = this.container.git.getRepositoryService(repoPath);
					// Conflicts can exist WITHOUT a paused operation (stash pop/apply, a `pull --rebase --autostash`
					// re-apply, or `merge --quit`) — refs are optional enrichment, so a missing status must not block
					// the run. The `targets.length === 0` check below handles the truly-nothing-to-resolve case.
					const refs = getResolutionRefs(await svc.pausedOps?.getPausedOperationStatus?.());

					// `instructions` (whole-run "Refine" feedback) rides conflict-tools' first-class
					// `ResolutionContext.userGuidance`, which 0.2.0 renders into the prompt.
					const context: ResolutionContext = {
						...(refs != null ? { refs: refs } : {}),
						...(instructions ? { userGuidance: instructions } : {}),
					};

					const { token, dispose: disposeCancellation } = fromAbortSignal(signal, this._aiCancellations);
					const resolveSignal = toAbortSignal(token);

					const onProgress = (event: ConflictProgressEvent) => {
						switch (event.type) {
							case 'conflict:found':
								this._resolveProgressEvent.fire({
									phase: event.type,
									message: `Analyzing ${event.filePath}…`,
								});
								break;
							case 'resolution:applied':
								this._resolveProgressEvent.fire({
									phase: event.type,
									message: `Resolved ${event.filePath}.`,
								});
								break;
							case 'resolution:failed':
								this._resolveProgressEvent.fire({
									phase: event.type,
									message: `Couldn't resolve ${event.filePath} — skipping.`,
								});
								break;
							case 'conflict:skipped':
								this._resolveProgressEvent.fire({
									phase: event.type,
									message: `Skipping ${event.filePath} — no conflict markers.`,
								});
								break;
							case 'resolver:tool-call':
								this._resolveProgressEvent.fire({
									phase: event.type,
									message: `${event.filePath}: inspecting ${event.tool}…`,
								});
								break;
						}
					};

					try {
						this._resolveProgressEvent.fire({ phase: 'collecting', message: 'Reading conflicts…' });

						// Entries carry each file's conflict reason (porcelain v2), which makes
						// delete/modify conflicts extractable instead of appearing marker-less.
						const entries = await integration.listUnmergedEntries(svc);

						// Scope to the requested files (per-file / multi-select entry points); undefined
						// means all conflicts. Requested files no longer unmerged just drop out.
						const focused = focusedFilePaths != null && focusedFilePaths.length > 0;
						const targets = focused ? entries.filter(e => focusedFilePaths.includes(e.path)) : entries;
						if (targets.length === 0) {
							return {
								error: {
									message: focused
										? focusedFilePaths.length === 1
											? `${focusedFilePaths[0]} is no longer conflicted.`
											: 'The selected files are no longer conflicted.'
										: 'No conflicted files to resolve.',
								},
							};
						}

						// One conversation ID per resolve session — re-runs ("Refine") and per-file
						// retries reuse it until apply/discard, so the backend's flat per-feature fee
						// is charged once for the whole session instead of once per AI request.
						const conversationId = this.getOrCreateResolveConversationId(repoPath);

						// Resolve the conflicted files in a bounded-concurrency pool so one file's failure
						// is isolated (recorded in `errors`) and the rest still resolve — and they run in
						// parallel rather than one-at-a-time.
						const result = await integration.resolveAllParallel(
							{
								svc: svc,
								entries: targets,
								context: context,
								signal: resolveSignal,
								onProgress: onProgress,
								conversationId: conversationId,
							},
							{
								source: 'graph',
								detail: focused
									? focusedFilePaths.length === 1
										? 'resolveFile'
										: 'resolveFiles'
									: 'resolveAll',
							},
						);
						const resolutions: ConflictToolsResolution[] = result.resolutions;

						// Enrich skipped/errored files with conflict-type info so the panel can label them and
						// offer the right manual take-side fallback. One cheap `ls-files --unmerged` (+ diff for
						// rename detection); only matters when there are files to enrich. Best-effort: an
						// enrichment failure must not throw away the AI resolutions we already computed — fall
						// back to unlabeled rows.
						const needInfos = result.errors.length > 0 || (result.skipped?.length ?? 0) > 0;
						const infos = needInfos ? await getConflictFileInfos(svc).catch(() => undefined) : undefined;
						const fallbackInfo = (filePath: string): ConflictFallbackInfo => {
							const info = infos?.get(filePath);
							if (info == null) return {};
							return {
								conflictStatus: info.conflictStatus,
								kind: info.kind,
								canStageCurrent: info.canStageCurrent,
								canStageIncoming: info.canStageIncoming,
								renameOf: info.renameOf,
							};
						};

						const errors: ResolveFileError[] = result.errors.map(e => ({
							filePath: e.filePath,
							message: e.error.message,
							...fallbackInfo(e.filePath),
						}));
						const skipped: ResolveSkippedFile[] = (result.skipped ?? []).map(s => {
							const info = fallbackInfo(s.filePath);
							// A skipped file that would otherwise classify as plain text is binary/unsupported by
							// inference (it was skipped precisely because no markers were parseable).
							const kind = info.kind == null || info.kind === 'text' ? 'binary' : info.kind;
							return {
								filePath: s.filePath,
								message: getConflictKindLabel(kind, info.renameOf).description,
								...info,
								kind: kind,
							};
						});

						if (resolveSignal?.aborted) return { cancelled: true };

						// Snapshot the conflicted (working-tree) content of every resolved file BEFORE anything
						// is applied, so "View diff" can show resolved-vs-conflicted. `applyResolutions` runs
						// later (and may never run if the user discards), so capture now while the markers are
						// still on disk.
						const previewable = resolutions.filter(r => r.strategy !== 'skipped');
						const conflictedContents = await integration.readWorkingFiles(
							svc,
							previewable.map(r => r.filePath),
						);

						const { provider } = this.getOrCreateResolveVirtual();
						const sessionId = provider.startSession(
							{
								repoPath: repoPath,
								files: previewable
									.filter(r => conflictedContents.has(r.filePath))
									.map(r => ({
										path: r.filePath,
										conflictedContent: conflictedContents.get(r.filePath)!,
										resolvedContent: r.content,
									})),
							},
							this._resolveVirtual!.sessionId,
						);
						this._resolveVirtual!.sessionId = sessionId;

						// Cache the full resolutions (with `content`) for a later `applyResolutions`.
						this._activeResolveSessions.set(repoPath, { resolutions: resolutions, sessionId: sessionId });

						logResolutionUsage(resolutions, 'graph.resolveConflicts');

						const summaries: ResolvedFileSummary[] = resolutions.map(r => ({
							filePath: r.filePath,
							strategy: r.strategy,
							reasoning: r.description,
							confidence: r.confidence,
							note: r.note,
							virtualRef:
								r.strategy !== 'skipped' && conflictedContents.has(r.filePath)
									? {
											namespace: GraphResolveVirtualNamespace,
											sessionId: sessionId,
											commitId: ResolveVirtualSide.resolved,
										}
									: undefined,
						}));

						return {
							result: {
								resolutions: summaries,
								errors: errors.length > 0 ? errors : undefined,
								skipped: skipped.length > 0 ? skipped : undefined,
							},
						};
					} catch (ex) {
						if (resolveSignal?.aborted || isCancellationError(ex)) return { cancelled: true };
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					} finally {
						disposeCancellation();
						this._resolveProgressEvent.fire(undefined);
					}
				},
				reresolveFile: async (repoPath, filePath, feedback, signal) => {
					const integration = await this.getOrCreateConflictToolsForGraph();
					if (integration == null) {
						return { error: { message: 'AI conflict resolution is not available in this environment.' } };
					}

					const session = this._activeResolveSessions.get(repoPath);
					if (session == null) {
						return { error: { message: 'No active resolutions to retry; please re-run.' } };
					}

					const svc = this.container.git.getRepositoryService(repoPath);
					// No paused-op requirement — see `resolveConflicts` above. Staleness is covered by the
					// session check above and the `entry == null` check below.
					const refs = getResolutionRefs(await svc.pausedOps?.getPausedOperationStatus?.());

					const { token, dispose: disposeCancellation } = fromAbortSignal(signal, this._aiCancellations);
					const resolveSignal = toAbortSignal(token);
					try {
						const entries = await integration.listUnmergedEntries(svc);
						const entry = entries.find(e => e.path === filePath);
						if (entry == null) {
							return { error: { message: `${filePath} is no longer conflicted.` } };
						}

						const conflict = await integration.extract({
							svc: svc,
							filePath: filePath,
							reason: entry.reason,
							signal: resolveSignal,
						});
						if (conflict == null) {
							return {
								error: {
									message: `No conflict markers were found in ${filePath} — it needs manual resolution.`,
								},
							};
						}

						// Feedback rides conflict-tools' first-class `ResolutionContext.userGuidance`.
						const resolution = await integration.resolveSingle(
							{
								svc: svc,
								conflict: conflict,
								context: { ...(refs != null ? { refs: refs } : {}), userGuidance: feedback },
								signal: resolveSignal,
								// Same conversation as the run being retried (an active session implies
								// the ID exists; minting here is just a defensive fallback).
								conversationId: this.getOrCreateResolveConversationId(repoPath),
							},
							{ source: 'graph', detail: 'resolveRetryFile' },
						);
						if (resolveSignal?.aborted) return { cancelled: true };

						// Re-read the cached session right before writing — the `session` snapshot above was
						// captured before the (long) resolveSingle await, so reusing it here would let a
						// concurrent retry/take-side that completed meanwhile get clobbered. Bail if it was
						// discarded mid-flight.
						const latest = this._activeResolveSessions.get(repoPath);
						if (latest == null) return { cancelled: true };

						// Replace this file's resolution in the cached session (others untouched).
						const exists = latest.resolutions.some(r => r.filePath === filePath);
						this._activeResolveSessions.set(repoPath, {
							...latest,
							resolutions: exists
								? latest.resolutions.map(r => (r.filePath === filePath ? resolution : r))
								: [...latest.resolutions, resolution],
						});

						// Refresh the file's virtual content in place so its existing `resolved` ref re-reads
						// the new content (the row's "View diff" stays valid — same sessionId).
						const conflictedContents = await integration.readWorkingFiles(svc, [filePath]);
						let virtualRef: VirtualRefShape | undefined;
						if (resolution.strategy !== 'skipped' && conflictedContents.has(filePath)) {
							this._resolveVirtual?.provider.updateFile(latest.sessionId, {
								path: filePath,
								conflictedContent: conflictedContents.get(filePath)!,
								resolvedContent: resolution.content,
							});
							virtualRef = {
								namespace: GraphResolveVirtualNamespace,
								sessionId: latest.sessionId,
								commitId: ResolveVirtualSide.resolved,
							};
						}

						logResolutionUsage([resolution], 'graph.reresolveFile');

						return {
							result: {
								filePath: resolution.filePath,
								strategy: resolution.strategy,
								reasoning: resolution.description,
								confidence: resolution.confidence,
								note: resolution.note,
								virtualRef: virtualRef,
							},
						};
					} catch (ex) {
						if (resolveSignal?.aborted || isCancellationError(ex)) return { cancelled: true };
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					} finally {
						disposeCancellation();
					}
				},
				applyResolutions: async (repoPath, includedFilePaths) => {
					const integration = await this.getOrCreateConflictToolsForGraph();
					if (integration == null) {
						return { error: { message: 'AI conflict resolution is not available in this environment.' } };
					}

					const session = this._activeResolveSessions.get(repoPath);
					if (session == null) {
						return { error: { message: 'No resolutions to apply; please re-run.' } };
					}

					const svc = this.container.git.getRepositoryService(repoPath);
					try {
						const included = includedFilePaths != null ? new Set(includedFilePaths) : undefined;
						// Never apply 'skipped' files — they were intentionally left conflicted.
						const selected = session.resolutions.filter(
							r => r.strategy !== 'skipped' && (included == null || included.has(r.filePath)),
						);
						if (selected.length === 0) {
							return { error: { message: 'No applicable resolutions were selected.' } };
						}

						// Per-file stale guard — the sole staleness defense: only apply files still unmerged.
						// A file resolved externally (manually, via another tool, or by an op ending — abort/
						// continue/reset all clear unmerged entries) since generation must not be clobbered
						// with stale AI content. Deliberately NOT gated on a paused operation existing:
						// op-less conflicts (stash pop, autostash) never have one, and `merge --quit` removes
						// the op while the files remain genuinely conflicted. Skipped files are surfaced in
						// the result.
						const stillConflicted = await integration.listUnmergedPaths(svc);
						const toApply = selected.filter(r => stillConflicted.has(r.filePath));
						const skipped = selected.length - toApply.length;
						if (toApply.length === 0) {
							this.discardResolveSession(repoPath);
							return {
								error: { message: 'These files are no longer conflicted — nothing was applied.' },
							};
						}

						await integration.applyBatch({ svc: svc, resolutions: toApply });
						// `applyBatch` stages ai/merged + take-ours/theirs but not deletions (its port only
						// unlinks). Stage every applied path once — idempotent for the rest, and it stages
						// deletions so the merge can be completed.
						const stagePaths = toApply.map(r => r.filePath);
						if (stagePaths.length > 0) {
							await svc.staging?.stageFiles?.(stagePaths);
						}

						this.discardResolveSession(repoPath);
						void window.showInformationMessage(
							skipped > 0
								? `Resolved ${pluralize('file', toApply.length)} — ${skipped} skipped (no longer conflicted).`
								: `Resolved ${pluralize('file', toApply.length)}.`,
						);
						return skipped > 0
							? { success: true, warning: `${skipped} file(s) were skipped (no longer conflicted).` }
							: { success: true };
					} catch (ex) {
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					}
				},
				discardResolutions: repoPath => {
					this.discardResolveSession(repoPath);
					return Promise.resolve();
				},
				takeConflictSide: async (repoPath, filePath, side): Promise<TakeConflictSideResult> => {
					const svc = this.container.git.getRepositoryService(repoPath);
					try {
						// Take-side rides the same cached session + Apply/Discard lifecycle as AI resolutions,
						// so it must not touch the working tree here — it queues a pending resolution that
						// `applyResolutions` writes (and `discardResolutions` drops).

						// Do all the IO (rename/kind classification) up front, before touching the cached
						// session — see the atomic read-modify-write note below.
						const infos = await getConflictFileInfos(svc);
						const info = infos.get(filePath);
						if (info == null) {
							return { error: { message: `${filePath} is no longer conflicted.` } };
						}

						// 'delete' is only offered for both-deleted (DD), where either side maps to a delete.
						const resolution: 'current' | 'incoming' = side === 'delete' ? 'current' : side;
						const action = classifyConflictAction(info.conflictStatus, resolution);
						if (action === 'unsupported') {
							return { error: { message: `Can't take the ${side} side for this conflict.` } };
						}

						const strategy =
							action === 'delete' ? 'deleted' : action === 'take-ours' ? 'take-ours' : 'take-theirs';

						// The library's `applyResolutions` applies take-ours/take-theirs/deleted via
						// checkout/remove with no content, so a content-less Resolution is all we queue.
						const queued: QueuedTakeSide[] = [{ filePath: filePath, strategy: strategy }];
						// rename/rename: keeping this name makes the other side's target the loser — queue its
						// deletion so applying resolves both and the tree isn't left carrying both names.
						if (info.kind === 'rename-rename' && info.renamePairPath != null) {
							queued.push({ filePath: info.renamePairPath, strategy: 'deleted' });
						}

						// Read-modify-write the cached session atomically (no `await` between the read and the
						// `set`) so two concurrent take-side clicks on different rows can't each derive from a
						// stale snapshot and clobber the other's queued resolution. A session always exists once
						// the panel is in its ready state (resolveConflicts caches one even when empty).
						const session = this._activeResolveSessions.get(repoPath);
						if (session == null) {
							return { error: { message: 'No active resolve session; please re-run.' } };
						}

						const queuedPaths = new Set(queued.map(q => q.filePath));
						const resolutions: ConflictToolsResolution[] = [
							...session.resolutions.filter(r => !queuedPaths.has(r.filePath)),
							...queued.map(q => ({
								filePath: q.filePath,
								content: '',
								strategy: q.strategy,
								confidence: 1,
								description: '',
							})),
						];
						this._activeResolveSessions.set(repoPath, { ...session, resolutions: resolutions });

						return { result: { resolved: queued } };
					} catch (ex) {
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					}
				},
				onResolveProgress: this._resolveProgressEvent.subscribe(buffer, tracker),
				getBranchComparisonSummary: async (repoPath, leftRef, rightRef, options, signal) => {
					// Phase 1 — counts + the unified All Files diff + the merge base. Smallest payload
					// to land the user on a useful panel; per-side commits + their files are fetched
					// on demand via `getBranchComparisonSide`.
					//
					// Convention: leftRef = Base (older / "from"), rightRef = Compare (newer / "to").
					// The working tree, when included, lives on the Compare side (rightRef).
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);

					// Always resolve rightRef's (Compare) worktree path — independent of the IWT
					// toggle's current state. This separates two concerns the old code conflated:
					//  (a) "does a worktree exist for rightRef?" — drives the IWT toggle's visibility.
					//  (b) "should the diff include working-tree changes?" — drives the data shape.
					// Conflating them caused the toggle to disappear after the user turned IWT off
					// (issue #5269 in the old left-anchored model; preserved here for the Compare side).
					// `useWorktree` below combines both concerns to gate only the data-shape branches.
					const rightRefWorktreePath = await this.resolveRightRefWorktreePath(repoPath, rightRef, signal);
					signal?.throwIfAborted();
					const useWorktree = options?.includeWorkingTree === true && rightRefWorktreePath != null;

					// Promise.allSettled per project convention — independent parallel awaits
					// shouldn't let one failure abort the rest of the comparison. Missing pieces
					// degrade gracefully into the partial-data path below (e.g. a diff-status
					// failure still shows the commit counts).
					//
					// `mergeBase` anchors the per-side file lists in `getBranchComparisonSide`. For
					// divergent branches, `mergeBase..rightRef` gives only the Compare side's
					// additions and `mergeBase..leftRef` only the Base side's additions — distinct
					// from the cumulative `leftRef..rightRef` which is shown on the All Files tab.
					// A null result (disjoint refs) lets the side fetch fall back to 2-dot ranges.
					const [countsResult, filesResult, mergeBaseResult] = await Promise.allSettled([
						svc.commits.getLeftRightCommitCount(`${leftRef}...${rightRef}`),
						useWorktree
							? this.container.git
									.getRepositoryService(rightRefWorktreePath)
									.diff.getDiffStatus(leftRef, undefined, { includeUntracked: true })
							: svc.diff.getDiffStatus(`${leftRef}..${rightRef}`),
						svc.refs.getMergeBase(leftRef, rightRef),
					]);
					signal?.throwIfAborted();
					const counts = getSettledValue(countsResult);
					const files = getSettledValue(filesResult);
					const mergeBase = getSettledValue(mergeBaseResult) ?? undefined;

					// Commit-count semantics from the Compare side's perspective:
					//  - `aheadCount` = commits the Compare branch has that Base doesn't
					//    (`git rev-list leftRef..rightRef`, returned as `.right` from --left-right).
					//  - `behindCount` = commits Base has that Compare doesn't
					//    (`git rev-list rightRef..leftRef`, returned as `.left`).
					// The "Working Changes" pseudo-commit row injected by `getBranchComparisonSide`
					// is still visible in the Ahead-tab commit list, but doesn't inflate the badge.
					const aheadCount = counts?.right ?? 0;
					const behindCount = counts?.left ?? 0;

					// File `repoPath` follows the worktree path ONLY when IWT is actively in use —
					// not just because a worktree exists. With the toggle off (or no worktree), file
					// URIs/multi-diff requests resolve against the panel's `repoPath`. The conditional
					// is on `useWorktree` (not `rightRefWorktreePath != null`) so toggle-off state
					// doesn't accidentally route through the worktree.
					const filesRepoPath = useWorktree ? rightRefWorktreePath : repoPath;
					const allFiles: BranchComparisonFile[] = (files ?? []).map(f => ({
						repoPath: filesRepoPath,
						path: f.path,
						status: f.status,
						originalPath: f.originalPath,
						staged: false,
						stats: f.stats,
					}));

					return {
						aheadCount: aheadCount,
						behindCount: behindCount,
						allFilesCount: allFiles.length,
						allFiles: allFiles,
						rightRefWorktreePath: rightRefWorktreePath,
						mergeBase: mergeBase,
					};
				},
				getBranchComparisonSide: async (repoPath, leftRef, rightRef, side, options, signal) => {
					// Phase 2: that side's commits, files fetched on demand. leftRef = Base, rightRef = Compare; the
					// Ahead side carries Compare's new commits (+ the working-tree pseudo-commit when IWT is on), so its
					// worktree path is resolved only for Ahead — Behind shows Base's commits and never has WT files.
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);

					const [worktreeResult, mergeBaseResult] = await Promise.allSettled([
						side === 'ahead' && options?.includeWorkingTree === true
							? this.resolveRightRefWorktreePath(repoPath, rightRef, signal)
							: Promise.resolve(undefined),
						options?.mergeBase != null
							? Promise.resolve(options.mergeBase)
							: svc.refs.getMergeBase(leftRef, rightRef),
					]);
					signal?.throwIfAborted();
					const rightRefWorktreePath = getSettledValue(worktreeResult);
					const mergeBase = getSettledValue(mergeBaseResult) ?? undefined;

					// Commit log uses the 2-dot range — commits reachable from one side but not the
					// other (equivalent to merge-base-anchored for divergent branches; no need to
					// resolve mergeBase first).
					const commitRange = side === 'ahead' ? `${leftRef}..${rightRef}` : `${rightRef}..${leftRef}`;
					// File diff is merge-base-anchored when available — Ahead shows `mergeBase..Compare`
					// (only what Compare contributed since divergence), Behind shows `mergeBase..Base`
					// (only what Base contributed). Falls back to the 2-dot symmetric form when there
					// is no merge base.
					const target = side === 'ahead' ? rightRef : leftRef;
					const diffRange = mergeBase != null ? `${mergeBase}..${target}` : commitRange;
					// Promise.allSettled per project convention — see the sibling
					// `getBranchComparisonSummary` for rationale.
					const limit = options?.limit ?? 100;
					const [logResult, comparisonFilesResult, workingTreeFilesResult] = await Promise.allSettled([
						svc.commits.getLog(commitRange, { limit: limit, includeFiles: false }, signal),
						svc.diff.getDiffStatus(diffRange),
						rightRefWorktreePath != null
							? this.getBranchComparisonWorkingTreeFiles(rightRefWorktreePath, true, signal)
							: Promise.resolve([]),
					]);
					signal?.throwIfAborted();
					const log = getSettledValue(logResult);
					const comparisonFiles = getSettledValue(comparisonFilesResult);
					const workingTreeFiles = getSettledValue(workingTreeFilesResult) ?? [];
					const hasMore = log?.hasMore ?? false;

					const mappedFiles: BranchComparisonFile[] = [];
					for (const f of comparisonFiles ?? []) {
						mappedFiles.push({
							repoPath: repoPath,
							path: f.path,
							status: f.status,
							originalPath: f.originalPath,
							staged: false,
							stats: f.stats,
						});
					}
					// Ahead-tab top-level shows the committed Ahead range only; WT files are
					// reachable by scoping to the WIP pseudo-commit injected below.
					const allFilesForSide = mappedFiles;

					const commits: BranchComparisonCommit[] = [];
					if (workingTreeFiles.length) {
						commits.push({
							sha: uncommitted,
							shortSha: 'Working',
							message: 'Working Changes',
							author: '',
							date: '',
							files: workingTreeFiles,
						});
					}

					for (const [sha, commit] of log?.commits ?? []) {
						const commitStats = commit.stats;
						const entry: BranchComparisonCommit = {
							sha: sha,
							shortSha: sha.substring(0, 7),
							message: commit.message ?? '',
							author: commit.author?.name ?? '',
							authorEmail: commit.author?.email,
							date: commit.author?.date != null ? String(commit.author.date) : '',
							additions: commitStats?.additions,
							deletions: commitStats?.deletions,
						};
						this.setAvatarIfCached(entry, commit.author?.email, sha, repoPath);
						// Committer identity only when the committer differs from the author (name OR email,
						// mirroring gl-commit-author.hasDistinctCommitter).
						const committerEmail = commit.committer?.email;
						if (
							(commit.committer?.name != null && commit.committer.name !== commit.author?.name) ||
							(committerEmail != null &&
								committerEmail.toLowerCase() !== commit.author?.email?.toLowerCase())
						) {
							entry.committerName = commit.committer?.name;
							entry.committerEmail = committerEmail;
							entry.committerDate =
								commit.committer?.date != null ? String(commit.committer.date) : undefined;
							this.setAvatarIfCached(entry, committerEmail, sha, repoPath, 'committerAvatarUrl');
						}
						commits.push(entry);
					}

					return { commits: commits, files: allFilesForSide, hasMore: hasMore };
				},
				getContributorsForBranchComparison: async (repoPath, leftRef, rightRef, scope, signal) => {
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);

					// Two-dot for ahead/behind (commits only on one side); three-dot for the
					// symmetric "all" union — matches the ranges used by `getBranchComparisonSide`.
					// Convention: leftRef = Base, rightRef = Compare.
					//  - Ahead = Base..Compare (commits Compare contributed)
					//  - Behind = Compare..Base (commits Base contributed)
					const rev =
						scope === 'ahead'
							? `${leftRef}..${rightRef}`
							: scope === 'behind'
								? `${rightRef}..${leftRef}`
								: `${leftRef}...${rightRef}`;

					const result = await svc.contributors.getContributors(rev, { stats: true }, signal);
					signal?.throwIfAborted();

					const contributors: BranchComparisonContributor[] = [];
					for (const c of result.contributors) {
						const stats = c.stats;
						const entry: BranchComparisonContributor = {
							name: c.name,
							email: c.email,
							avatarUrl: c.avatarUrl,
							commits: c.contributionCount,
							additions: stats?.additions ?? 0,
							deletions: stats?.deletions ?? 0,
							files: typeof stats?.files === 'number' ? stats.files : 0,
							current: c.current || undefined,
						};
						if (entry.avatarUrl == null) {
							this.setAvatarIfCached(entry, c.email, undefined, undefined);
						}
						contributors.push(entry);
					}

					return { contributors: contributors };
				},
				chooseRef: async (repoPath, title, picked) => {
					const result = await showReferencePicker2(repoPath, title, 'Choose a branch or tag', {
						include: ['branches', 'tags'],
						picked: picked,
					});
					const pick = result?.value;
					if (pick?.sha == null) return undefined;

					// Map GitReference.refType to the compare panel's narrower refType union.
					// Branches/tags map 1:1; anything else (commits via revision input) gets 'commit'
					// so the panel renders the commit icon.
					const refType: 'branch' | 'tag' | 'commit' =
						pick.refType === 'branch' || pick.refType === 'tag' ? pick.refType : 'commit';
					return { name: pick.name, sha: pick.sha, refType: refType };
				},
				getMergeTargetComparisonRef: async (repoPath, branchName) => {
					try {
						const svc = this.container.git.getRepositoryService(repoPath);
						const branch =
							branchName != null
								? await svc.branches.getBranch(branchName)
								: await svc.branches.getBranch();
						if (branch != null) {
							const result = await getBranchMergeTargetName(this.container, branch);
							if (!result.paused && result.value != null) return result.value;
						}

						const name = await svc.branches.getDefaultBranchName();
						return name ?? undefined;
					} catch {
						return undefined;
					}
				},
				openComparisonInSearchAndCompare: async (repoPath, leftRef, rightRef) => {
					await this.container.views.searchAndCompare.compare(repoPath, leftRef, rightRef);
				},
			},
			graphTimeline: {
				getDataset: async (scope, config, signal) => {
					const result = await buildTimelineDataset(this.container, scope, config, signal);
					return {
						dataset: result.dataset,
						scope: result.scope,
						repository: result.repository,
						access: result.access,
					};
				},
				getShasForPath: async (repoPath, path, signal) => {
					const repo = this.container.git.getRepository(repoPath);
					if (repo == null) return [];

					const shas = await repo.git.commits.getLogShas?.(
						undefined,
						{ all: true, pathOrUri: path, limit: 0 },
						signal,
					);
					if (signal?.aborted) return [];
					return shas != null ? [...shas] : [];
				},
				choosePath: params => this.onTimelineChoosePath(params),
			},
			graphTreemap: {
				getData: async (repoPath, mode, config, signal) => {
					const data = await this.container.treemapAggregator.getData(repoPath, mode, config, signal);
					return { root: data.root, frequencies: data.frequencies };
				},
			},
		};
	}

	/** Lazy-init the compose virtual content provider + register it with the virtual FS service. */
	private getOrCreateComposeVirtual(): { provider: GraphComposeVirtualContentProvider; sessionId?: string } {
		if (this._composeVirtual == null) {
			const provider = new GraphComposeVirtualContentProvider(this.container);
			const registration = this.container.virtualFs.registerProvider(provider);
			this._composeVirtual = { provider: provider, registration: registration };
		}
		return this._composeVirtual;
	}

	/**
	 * Derive the graph's `ProposedCommit[]` (library order) from a compose plan snapshot: builds the
	 * combined diffs, (re)starts the virtual content session, and stamps each commit's `virtualRef`.
	 * Shared by the initial compose derive and post-mutation re-derives (e.g. a file move). Callers
	 * reverse the result for display order.
	 */
	private async deriveComposeCommits(
		repoPath: string,
		planResult: Parameters<typeof libraryPlanToProposedCommits>[0] & { rewriteFromSha: string },
	): Promise<ProposedCommit[]> {
		const { createCombinedDiffForCommit } = await loadChunk(
			() => import(/* webpackChunkName: "ai" */ '../composer/utils/composer.utils.js'),
		);
		const { commits, commitHunksByIndex } = libraryPlanToProposedCommits(
			planResult,
			repoPath,
			createCombinedDiffForCommit,
		);

		if (commits.length > 0) {
			const { provider } = this.getOrCreateComposeVirtual();
			const sessionId = provider.startSession(
				{
					repoPath: repoPath,
					baseSha: planResult.rewriteFromSha,
					baseLabel: shortenRevision(planResult.rewriteFromSha),
					commits: commits.map((commit, i) => ({
						id: commit.id,
						message: commit.message,
						hunks: commitHunksByIndex[i] ?? [],
					})),
				},
				this._composeVirtual!.sessionId,
			);
			this._composeVirtual!.sessionId = sessionId;

			for (const commit of commits) {
				commit.virtualRef = {
					namespace: GraphComposeVirtualNamespace,
					sessionId: sessionId,
					commitId: commit.id,
				};
			}
		}

		return commits;
	}

	private async getOrCreateComposeToolsForGraph(): Promise<GraphComposeIntegration | undefined> {
		if (this._composeToolsForGraph == null) {
			// Lazily import the node-only compose-tools library on demand, keeping it (and its eager zod
			// schema/JIT setup that trips VS Code's `navigator` deprecation warning) off the graph init path.
			const { createGraphComposeIntegration } = await import('@env/coretools/composer.js');
			this._composeToolsForGraph ??= createGraphComposeIntegration(this.container);
		}
		return this._composeToolsForGraph;
	}

	/** Lazy-init the resolve virtual content provider + register it with the virtual FS service. */
	private getOrCreateResolveVirtual(): { provider: GraphResolveVirtualContentProvider; sessionId?: string } {
		if (this._resolveVirtual == null) {
			const provider = new GraphResolveVirtualContentProvider();
			const registration = this.container.virtualFs.registerProvider(provider);
			this._resolveVirtual = { provider: provider, registration: registration };
		}
		return this._resolveVirtual;
	}

	private async getOrCreateConflictToolsForGraph(): Promise<ConflictToolsIntegration | undefined> {
		if (this._conflictToolsForGraph == null) {
			// Lazily import the node-only conflict-tools integration on demand (browser resolves to a
			// stub returning `undefined`, so callers gate the feature off in VS Code Web).
			const { createConflictToolsIntegration } = await import('@env/coretools/conflict.js');
			this._conflictToolsForGraph ??= createConflictToolsIntegration(this.container);
		}
		return this._conflictToolsForGraph;
	}

	/** Gets the repo's resolve-session AI conversation ID, minting one for a new session. */
	private getOrCreateResolveConversationId(repoPath: string): string {
		let conversationId = this._resolveConversationIds.get(repoPath);
		if (conversationId == null) {
			conversationId = uuid();
			this._resolveConversationIds.set(repoPath, conversationId);
		}
		return conversationId;
	}

	/** Drops the cached resolve session for a repo and ends its virtual session (no disk writes). */
	private discardResolveSession(repoPath: string): void {
		// The conversation outlives the session entry (it exists from before the first AI call), so
		// end it before the `session == null` return — a run cancelled before any session entry was
		// created still needs its BYOK usage flushed (one aggregated report = one feature fee).
		const conversationId = this._resolveConversationIds.get(repoPath);
		if (conversationId != null) {
			this._resolveConversationIds.delete(repoPath);
			void this.container.ai.flushBYOKUsage(conversationId);
		}

		const session = this._activeResolveSessions.get(repoPath);
		if (session == null) return;

		this._activeResolveSessions.delete(repoPath);
		this._resolveVirtual?.provider.endSession(session.sessionId);
	}

	private async onTimelineChoosePath(params: ChoosePathParams): Promise<DidChoosePathParams> {
		const { repoUri: repoPath, ref, title, initialPath } = params;
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return { picked: undefined };

		const picked = await showRevisionFilesPicker(this.container, createReference(ref?.ref ?? 'HEAD', repo.path), {
			allowFolders: true,
			initialPath: initialPath,
			title: title,
		});

		return {
			picked:
				picked != null
					? { type: picked.type, relativePath: this.container.git.getRelativePath(picked.uri, repo.uri) }
					: undefined,
		};
	}

	private getReviewTypeForScope(scope: ScopeSelection): 'wip' | 'compare' | 'commit' {
		switch (scope.type) {
			case 'wip':
				return 'wip';
			case 'compare':
				return 'compare';
			default:
				return 'commit';
		}
	}

	private setAvatarIfCached(
		entry: { avatarUrl?: string; committerAvatarUrl?: string },
		email: string | undefined,
		ref: string | undefined,
		repoPath: string | undefined,
		field: 'avatarUrl' | 'committerAvatarUrl' = 'avatarUrl',
	): void {
		if (!email) return;

		const avatar =
			ref != null && repoPath != null
				? getAvatarUri(email, { ref: ref, repoPath: repoPath }, { size: 16 })
				: getAvatarUri(email, undefined, { size: 16 });
		if (!(avatar instanceof Promise)) {
			entry[field] = avatar.toString();
		} else {
			void avatar.catch(() => undefined);
		}
	}

	private async getBranchComparisonWorkingTreeFiles(
		worktreePath: string,
		includeWorkingTree: boolean,
		signal?: AbortSignal,
	): Promise<BranchComparisonFile[]> {
		if (!includeWorkingTree) return [];

		const svc = this.container.git.getRepositoryService(worktreePath);
		const status = await svc.status.getStatus(undefined, signal);
		signal?.throwIfAborted();

		const files: BranchComparisonFile[] = [];
		const seen = new Set<string>();
		for (const f of status?.files ?? []) {
			if (!seen.has(f.path)) {
				seen.add(f.path);
				files.push({
					repoPath: worktreePath,
					path: f.path,
					status: f.status,
					originalPath: f.originalPath,
					staged: f.staged,
				});
			}
		}

		return files;
	}

	/** Returns the worktree path currently checked out at `rightRef` (the Compare side), or
	 *  `undefined` when rightRef isn't checked out anywhere, when the worktree's HEAD has drifted
	 *  away from rightRef (e.g. external `git checkout` in that worktree), or when the branch
	 *  lookup fails. The left ref's (Base) worktree is intentionally not resolved — IWT only reads
	 *  the Compare side's working tree, so exposing the Base side's would invite asymmetric
	 *  comparisons we don't support. */
	private async resolveRightRefWorktreePath(
		repoPath: string,
		rightRef: string,
		signal?: AbortSignal,
	): Promise<string | undefined> {
		try {
			const svc = this.container.git.getRepositoryService(repoPath);
			const branch = await svc.branches.getBranch(rightRef);
			signal?.throwIfAborted();
			if (branch == null) return undefined;

			const worktree = branch.worktree;
			if (worktree == null || worktree === false) return undefined;

			// Validate the worktree's HEAD still matches rightRef — guards against drift from an
			// external `git checkout` in that worktree that we haven't observed yet.
			const candidatePath = worktree.path;
			const wtBranch = await this.container.git.getRepositoryService(candidatePath).branches.getBranch();
			signal?.throwIfAborted();
			if (wtBranch == null || (wtBranch.name !== rightRef && wtBranch.ref !== rightRef)) {
				console.warn(
					`[graph] resolveRightRefWorktreePath: worktree at ${candidatePath} no longer at ${rightRef}; falling back to no-worktree mode`,
				);
				return undefined;
			}
			return candidatePath;
		} catch (ex) {
			// Re-throw cancellation so the caller's `signal?.throwIfAborted()` after the await
			// propagates correctly; without this, an in-flight ref change that aborts mid-resolve
			// would be treated as a generic failure and the rest of the summary fetch would
			// continue with `undefined` instead of bailing out. Check `ex` itself (rather than
			// just `signal?.aborted`) so an unrelated git error that happens to coincide with
			// an abort isn't silently re-thrown as a cancellation — that masks real failures
			// behind the resource layer's cancel-swallowing guard.
			if (ex instanceof DOMException && ex.name === 'AbortError') throw ex;

			console.warn(`[graph] resolveRightRefWorktreePath failed for ${rightRef}: ${String(ex)}`);
			return undefined;
		}
	}

	private getDiffCacheKey(repoPath: string, scope: ScopeSelection, excludedFiles?: readonly string[]): string {
		return JSON.stringify({
			repoPath: repoPath,
			scope: scope,
			excludedFiles: excludedFiles?.toSorted(),
		});
	}

	/** Records a completed review exchange for follow-up (refine) replay — appending to the
	 *  conversation on a follow-up, starting a new one otherwise. */
	private recordReviewExchange(
		cacheKey: string,
		instructions: string | undefined,
		result: AIReviewResult,
		followUp: boolean,
	): void {
		const exchanges = (followUp ? this._reviewHistoryCache.get(cacheKey) : undefined) ?? [];
		exchanges.push({ instructions: instructions || undefined, result: result });
		this._reviewHistoryCache.set(cacheKey, exchanges);
	}

	private async getDiffForScope(
		repoPath: string,
		scope: ScopeSelection,
		signal?: AbortSignal,
	): Promise<{ diff: string; message: string; context: string } | undefined> {
		const svc = this.container.git.getRepositoryService(repoPath);

		if (scope.type === 'commit') {
			const diffResult = await svc.diff?.getDiff?.(scope.sha);
			signal?.throwIfAborted();
			if (!diffResult?.contents) return undefined;

			const commit = await svc.commits.getCommit(scope.sha);
			signal?.throwIfAborted();

			const context = await this.buildChangesContext(
				repoPath,
				{
					commits: [{ sha: scope.sha, message: commit?.message ?? '' }],
					changeKind: 'commit',
				},
				signal,
			);

			return {
				diff: annotateDiffWithNewLineNumbers(diffResult.contents),
				message: commit?.message ?? '',
				context: context,
			};
		}

		if (scope.type === 'compare') {
			if (scope.includeShas?.length) {
				const parts: string[] = [];
				const messages: string[] = [];
				const commits: ChangesContextCommit[] = [];
				// Per-sha getDiff+getCommit are independent; parallelize the pair and across shas. allSettled
				// preserves input order; the outer throwIfAborted re-propagates a mid-flight abort.
				const shaResults = await Promise.allSettled(
					scope.includeShas.map(async sha => {
						const [diffResult, commitResult] = await Promise.allSettled([
							svc.diff?.getDiff?.(sha),
							svc.commits.getCommit(sha),
						]);
						signal?.throwIfAborted();
						return { sha: sha, diff: getSettledValue(diffResult), commit: getSettledValue(commitResult) };
					}),
				);
				signal?.throwIfAborted();
				for (const result of shaResults) {
					const value = getSettledValue(result);
					if (value == null) continue;

					if (value.diff?.contents) {
						parts.push(value.diff.contents);
					}
					if (value.commit) {
						messages.push(`${shortenRevision(value.commit.sha)}: ${value.commit.message ?? ''}`);
						commits.push({ sha: value.sha, message: value.commit.message ?? '' });
					}
				}
				if (!parts.length) return undefined;

				const context = await this.buildChangesContext(
					repoPath,
					{ commits: commits, changeKind: 'commit-range' },
					signal,
				);

				return {
					diff: annotateDiffWithNewLineNumbers(parts.join('\n')),
					message: `Selected commits between ${shortenRevision(scope.fromSha)} and ${shortenRevision(scope.toSha)}:\n\n${messages.join('\n')}`,
					context: context,
				};
			}

			const data = await prepareCompareDataForAIRequest(svc, scope.toSha, scope.fromSha);
			signal?.throwIfAborted();
			if (!data) return undefined;

			const log = await svc.commits.getLog?.(`${scope.fromSha}..${scope.toSha}`);
			signal?.throwIfAborted();
			const commits: ChangesContextCommit[] = [];
			if (log?.commits) {
				for (const c of log.commits.values()) {
					commits.push({ sha: c.sha, message: c.message ?? c.summary ?? '' });
				}
			}

			const context = await this.buildChangesContext(
				repoPath,
				{ commits: commits, changeKind: 'commit-range' },
				signal,
			);

			return {
				diff: annotateDiffWithNewLineNumbers(data.diff),
				message: `Changes between ${shortenRevision(scope.fromSha)} and ${shortenRevision(scope.toSha)}:\n\n${data.logMessages}`,
				context: context,
			};
		}

		// WIP scope — gather parts based on selection
		const parts: string[] = [];
		const labels: string[] = [];

		if (scope.includeUnstaged) {
			const d = await svc.diff?.getDiff?.(uncommitted);
			signal?.throwIfAborted();
			if (d?.contents) {
				parts.push(d.contents);
			}
			labels.push('unstaged');
		}
		if (scope.includeStaged) {
			const d = await svc.diff?.getDiff?.(uncommittedStaged);
			signal?.throwIfAborted();
			if (d?.contents) {
				parts.push(d.contents);
			}
			labels.push('staged');
		}
		const commitMessages: string[] = [];
		// Per-sha getDiff+getCommit are independent; parallelize the pair and across shas. allSettled
		// preserves input order; the outer throwIfAborted re-propagates a mid-flight abort.
		const shaResults = await Promise.allSettled(
			scope.includeShas.map(async sha => {
				const [diffResult, commitResult] = await Promise.allSettled([
					svc.diff?.getDiff?.(sha),
					svc.commits.getCommit(sha),
				]);
				signal?.throwIfAborted();
				return { diff: getSettledValue(diffResult), commit: getSettledValue(commitResult) };
			}),
		);
		signal?.throwIfAborted();
		for (const result of shaResults) {
			const value = getSettledValue(result);
			if (value == null) continue;

			if (value.diff?.contents) {
				parts.push(value.diff.contents);
			}
			if (value.commit) {
				commitMessages.push(`${shortenRevision(value.commit.sha)}: ${value.commit.message ?? ''}`);
			}
		}

		if (!parts.length) return undefined;

		let message = labels.length ? `Working changes (${labels.join(' + ')})` : 'Working changes';
		if (scope.includeShas.length) {
			message += ` + ${scope.includeShas.length} commit(s)`;
			if (commitMessages.length) {
				message += `:\n\n${commitMessages.join('\n')}`;
			}
		}

		const wipBranch = await svc.branches.getBranch();
		signal?.throwIfAborted();
		const context = await this.buildChangesContext(
			repoPath,
			{ branch: wipBranch ?? undefined, changeKind: 'wip' },
			signal,
		);

		return {
			diff: annotateDiffWithNewLineNumbers(parts.join('\n')),
			message: message,
			context: context,
		};
	}

	private async buildChangesContext(
		repoPath: string,
		input: ChangesContextInput,
		signal?: AbortSignal,
	): Promise<string> {
		try {
			const payload = await gatherContextForChanges(this.container, repoPath, input, signal);
			return formatChangesContextForPrompt(payload);
		} catch {
			return '';
		}
	}
}

/** Derives the AI conflict resolver's ours/theirs/base refs from a paused operation's status.
 *  Returns `undefined` when no operation is active — conflicts can exist without one (stash
 *  pop/apply, `pull --rebase --autostash` re-apply, `merge --quit`), and there is no reliable
 *  ref to name for `theirs` (e.g. `stash@{0}` may be the wrong stash). Guessing would feed the
 *  resolver a misleading three-way diff; without refs, conflict-tools skips that diff and
 *  resolves from the conflict markers, which is the safe degradation. */
function getResolutionRefs(status: GitPausedOperationStatus | undefined): ResolutionRefs | undefined {
	if (status == null) return undefined;
	return {
		ours: status.HEAD?.ref ?? 'HEAD',
		theirs: status.incoming?.ref ?? 'MERGE_HEAD',
		...(status.mergeBase != null ? { base: status.mergeBase } : {}),
	};
}

/** Logs each resolution's AI token usage (when the provider reported it) plus a run total to the
 *  debug logs — usage is diagnostic detail, so it stays out of the resolve results UI. */
function logResolutionUsage(resolutions: readonly ConflictToolsResolution[], scope: string): void {
	let input = 0;
	let output = 0;
	for (const r of resolutions) {
		const m = r.metrics;
		if (m == null) continue;

		input += m.inputTokens;
		output += m.outputTokens;
		Logger.debug(
			`resolved ${r.filePath}: tokens=${m.inputTokens} in / ${m.outputTokens} out${
				m.stepCount != null ? `, steps=${m.stepCount}` : ''
			}${m.durationMs != null ? `, duration=${m.durationMs}ms` : ''}`,
			scope,
		);
	}
	if (resolutions.length > 1 && (input > 0 || output > 0)) {
		Logger.debug(`run total: tokens=${input} in / ${output} out`, scope);
	}
}
