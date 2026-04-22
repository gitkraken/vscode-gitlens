/**
 * Actions for the Graph Details panel.
 *
 * Actions are methods that:
 * 1. Update local state (via signals from DetailsState)
 * 2. Make RPC calls to the backend (via resolved services)
 *
 * Follows the same resolve-once pattern as CommitDetailsActions:
 * resolved sub-services + state + resources are injected via constructor.
 *
 * Patterns used:
 * - Resources: commit, wip, compare, branchCompare, review, compose resources
 *   handle fetch/cancel/staleness (replaces manual AbortController management)
 * - enrichmentGuard: prevents stale enrichment callbacks from writing data
 *   for a commit/WIP that has since been replaced by a newer fetch
 */
import type { Remote } from '@eamodio/supertalk';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { areEqual } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { Autolink } from '../../../../../autolinks/models/autolinks.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type { TelemetryEvents } from '../../../../../constants.telemetry.js';
import type { CommitDetails, CommitSignatureShape, CompareDiff, Wip } from '../../../../plus/graph/detailsProtocol.js';
import type {
	BranchComparisonContributorsScope,
	BranchComparisonOptions,
	BranchComparisonSide,
	BranchComparisonSummary,
	ComposeResult,
	GraphServices,
	ReviewResult,
	ScopeSelection,
} from '../../../../plus/graph/graphService.js';
import type { BranchMergeTargetStatus } from '../../../../rpc/services/branches.js';
import type { OverviewBranchIssue } from '../../../../shared/overviewBranches.js';
import type { FileChangeListItemDetail } from '../../../commitDetails/components/gl-details-base.js';
import { fetchCommitEnrichment } from '../../../shared/actions/commitEnrichment.js';
import type { OpenMultipleChangesArgs } from '../../../shared/actions/file.js';
import * as fileActions from '../../../shared/actions/file.js';
import {
	enrichmentGuard,
	fireAndForget,
	guardedEnrich,
	isAbortError,
	noop,
	noopUnlessReal,
} from '../../../shared/actions/rpc.js';
import { subscribeAll } from '../../../shared/events/subscriptions.js';
import type { Resource } from '../../../shared/state/resource.js';
import type { DetailsState } from './detailsState.js';
import type { ScopeItem } from './gl-commits-scope-pane.js';

/** Structural equality for `ScopeSelection`. Used to avoid redundant signal sets and RPC fetches. */
export function scopeSelectionEqual(a: ScopeSelection | undefined, b: ScopeSelection | undefined): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (a.type !== b.type) return false;
	if (a.type === 'commit' && b.type === 'commit') return a.sha === b.sha;
	if (a.type === 'compare' && b.type === 'compare') {
		return a.fromSha === b.fromSha && a.toSha === b.toSha && areEqual(a.includeShas, b.includeShas);
	}
	if (a.type === 'wip' && b.type === 'wip') {
		return (
			a.includeStaged === b.includeStaged &&
			a.includeUnstaged === b.includeUnstaged &&
			areEqual(a.includeShas, b.includeShas)
		);
	}
	return false;
}

export function getReviewDiffEndpoints(scope: ScopeSelection | undefined): { lhs: string; rhs: string } | undefined {
	if (scope == null) return undefined;
	if (scope.type === 'commit') return { lhs: `${scope.sha}^`, rhs: scope.sha };
	if (scope.type === 'compare') return { lhs: scope.fromSha, rhs: scope.toSha };
	// wip — match scope inputs as closely as possible with a single range
	const hasShas = (scope.includeShas?.length ?? 0) > 0;
	if (scope.includeUnstaged && !scope.includeStaged && !hasShas) {
		return { lhs: uncommittedStaged, rhs: uncommitted };
	}
	if (!scope.includeUnstaged && scope.includeStaged && !hasShas) {
		return { lhs: 'HEAD', rhs: uncommittedStaged };
	}
	// Default wip → HEAD ↔ working tree (covers includeUnstaged+staged and includeShas variants)
	return { lhs: 'HEAD', rhs: uncommitted };
}

type ResolvedSubService<K extends keyof GraphServices> = Awaited<Remote<GraphServices>[K]>;

export interface ResolvedServices {
	readonly files: ResolvedSubService<'files'>;
	readonly graphInspect: ResolvedSubService<'graphInspect'>;
	readonly autolinks: ResolvedSubService<'autolinks'>;
	readonly branches: ResolvedSubService<'branches'>;
	readonly pullRequests: ResolvedSubService<'pullRequests'>;
	readonly repository: ResolvedSubService<'repository'>;
	readonly config: ResolvedSubService<'config'>;
	readonly storage: ResolvedSubService<'storage'>;
	readonly subscription: ResolvedSubService<'subscription'>;
	readonly integrations: ResolvedSubService<'integrations'>;
	readonly commands: ResolvedSubService<'commands'>;
	readonly ai: ResolvedSubService<'ai'>;
	readonly telemetry: ResolvedSubService<'telemetry'>;
}

export interface DetailsResources {
	readonly commit: Resource<CommitDetails | undefined, [string, string]>;
	readonly wip: Resource<Wip | undefined, [string]>;
	readonly compare: Resource<CompareDiff | undefined, [string, string, string]>;
	/** Phase 1 — counts + All Files. Keyed on `(repoPath, leftRef, rightRef, options)`. */
	readonly branchCompareSummary: Resource<
		BranchComparisonSummary | undefined,
		[string, string, string, BranchComparisonOptions]
	>;
	/** Phase 2 — that side's commits with per-commit files inline. Keyed on
	 *  `(repoPath, leftRef, rightRef, side, options)` so 'ahead' and 'behind' cache independently. */
	readonly branchCompareSide: Resource<
		BranchComparisonSide | undefined,
		[string, string, string, 'ahead' | 'behind', BranchComparisonOptions]
	>;
	readonly review: Resource<ReviewResult, [string, ScopeSelection, string | undefined, string[] | undefined]>;
	readonly compose: Resource<ComposeResult, [string, ScopeSelection, string | undefined, string[] | undefined]>;
	readonly scopeFiles: Resource<GitFileChangeShape[], [string, ScopeSelection]>;
}

interface WipBranchEnrichmentCacheEntry {
	autolinks?: OverviewBranchIssue[];
	issues?: OverviewBranchIssue[];
	mergeTarget?: BranchMergeTargetStatus;
	/** Sentinel: true once a `getMergeTargetStatus` call has actually resolved (even with
	 *  `mergeTarget: undefined`, which is a valid "no merge target configured" outcome).
	 *  Distinguishes "haven't fetched yet" from "fetched and got nothing", same convention
	 *  as `hasPullRequest` / `hasSignature` on the commit cache. */
	hasMergeTarget?: boolean;
}

interface CommitEnrichmentCacheEntry {
	commit?: CommitDetails;
	autolinks?: Autolink[];
	formattedMessage?: string;
	autolinkedIssues?: IssueOrPullRequest[];
	pullRequest?: PullRequestShape | undefined;
	signature?: CommitSignatureShape | undefined;
	hasPullRequest?: boolean;
	hasSignature?: boolean;
}

const wipEnrichmentCacheLimit = 8;
const commitEnrichmentCacheLimit = 32;

export class DetailsActions {
	private _lastFetchedKey?: string;
	private _pendingStagingOp?: Promise<void>;
	private _disposed = false;
	private _eventUnsubscribe?: () => void;

	private _branchCommitsController?: AbortController;
	private _branchCommitsLoadMoreController?: AbortController;
	private _enrichmentController?: AbortController;
	private _branchCompareEnrichmentControllers = new Map<BranchComparisonContributorsScope, AbortController>();
	private _branchCompareContributorsControllers = new Map<BranchComparisonContributorsScope, AbortController>();
	/** Per-(tab,sha) abort controllers for lazy commit-file fetches in branch-compare. New selection
	 *  on a tab aborts any in-flight fetch for the same tab so the latest click wins. */
	private _compareCommitFilesControllers = new Map<string, AbortController>();
	private _aiExcludedFilesGeneration = 0;

	/** Branch-keyed cache of WIP enrichment (autolinks/issues/mergeTarget). Populated on first
	 *  successful fetch; consulted on subsequent visits to hydrate state synchronously and avoid
	 *  the visible chip flash-out → flash-in (especially mergeTarget which costs ~250ms). */
	private _wipEnrichmentCache = new LruMap<string, WipBranchEnrichmentCacheEntry>(wipEnrichmentCacheLimit);
	/** SHA-keyed cache of commit enrichment (autolinks/PR/signature). Same purpose as wip cache. */
	private _commitEnrichmentCache = new LruMap<string, CommitEnrichmentCacheEntry>(commitEnrichmentCacheLimit);

	constructor(
		readonly state: DetailsState,
		readonly services: ResolvedServices,
		readonly resources: DetailsResources,
	) {}

	sendTelemetryEvent(
		name: keyof TelemetryEvents,
		data?: Record<string, string | number | boolean | undefined>,
	): void {
		fireAndForget(this.services.telemetry.sendEvent(name, data));
	}

	private clearCompareCore(): void {
		this.state.commitFrom.set(undefined);
		this.state.commitTo.set(undefined);
		this.state.compareFiles.set(undefined);
		this.state.compareStats.set(undefined);
		this.state.compareBetweenCount.set(undefined);
	}

	private clearBranchCompareData(): void {
		this.state.branchCompareAheadCount.set(0);
		this.state.branchCompareBehindCount.set(0);
		this.state.branchCompareAheadCommits.set([]);
		this.state.branchCompareBehindCommits.set([]);
		this.state.branchCompareAllFiles.set([]);
		this.state.branchCompareAllFilesCount.set(0);
		this.state.branchCompareAheadFiles.set([]);
		this.state.branchCompareBehindFiles.set([]);
		this.state.branchCompareAheadLoaded.set(false);
		this.state.branchCompareBehindLoaded.set(false);
	}

	private clearCompareEnrichment(): void {
		this.state.compareAutolinks.set(undefined);
		this.state.compareAutolinksLoading.set(false);
		this.state.compareEnrichedItems.set(undefined);
		this.state.compareEnrichmentLoading.set(false);
		this.state.signatureFrom.set(undefined);
		this.state.signatureTo.set(undefined);
	}

	dispose(): void {
		this._disposed = true;
		this._branchCommitsController?.abort();
		this._branchCommitsLoadMoreController?.abort();
		this._enrichmentController?.abort();
		for (const c of this._branchCompareEnrichmentControllers.values()) {
			c.abort();
		}
		for (const c of this._branchCompareContributorsControllers.values()) {
			c.abort();
		}
		for (const c of this._compareCommitFilesControllers.values()) {
			c.abort();
		}
		this._branchCompareEnrichmentControllers.clear();
		this._branchCompareContributorsControllers.clear();
		this._compareCommitFilesControllers.clear();
		this._wipEnrichmentCache.clear();
		this._commitEnrichmentCache.clear();
		this.resources.commit.dispose();
		this.resources.wip.dispose();
		this.resources.compare.dispose();
		this.resources.branchCompareSummary.dispose();
		this.resources.branchCompareSide.dispose();
		this.resources.review.dispose();
		this.resources.compose.dispose();
		this._eventUnsubscribe?.();
		this._eventUnsubscribe = undefined;
	}

	/**
	 * Drops the webview-side enrichment caches and aborts in-flight branch-commits fetches
	 * keyed to the prior repo. Called by {@link DetailsWorkflowController} when the host's
	 * render target (`repoPath`) changes so cross-repo state doesn't linger.
	 *
	 * The cache LRU keys already include `repoPath`, so there is no value-collision risk —
	 * the clear is memory hygiene. The branch-commits aborts matter because those fetches
	 * have no post-resolve key gate, so a slow response from the prior repo could land and
	 * write into state for the new one.
	 *
	 * NOT aborting `_enrichmentController` here: WIP-row-to-WIP-row transitions can fire
	 * `hostUpdate` (which calls this) AFTER `willUpdate` has already triggered fetchDetails
	 * for the new selection — aborting then would kill the fresh enrichment controller before
	 * its fetch even runs. The WIP enrichment legs are protected against stale writes by
	 * {@link enrichmentGuard} (resource generation ID) plus inner `signal.aborted` checks,
	 * and {@link DetailsActions.fetchDetails} via {@link resetEnrichment} aborts the prior
	 * controller when a new selection's fetch starts.
	 */
	clearEnrichmentCaches(): void {
		this._wipEnrichmentCache.clear();
		this._commitEnrichmentCache.clear();
		this._branchCommitsController?.abort();
		this._branchCommitsLoadMoreController?.abort();
	}

	/**
	 * Aborts the previous enrichment batch (autolinks, PRs, signature, merge target, etc.) and
	 * returns a fresh signal that subsequent enrichment callbacks should check before writing
	 * state — so a slow merge-target lookup from a prior selection can't keep the loading flag
	 * stuck on or clobber the new selection's enrichment.
	 */
	private resetEnrichment(): AbortSignal {
		this._enrichmentController?.abort();
		const controller = new AbortController();
		this._enrichmentController = controller;
		return controller.signal;
	}

	isMultiCommit(shas?: string[]): boolean {
		return shas != null && shas.length >= 2;
	}

	isWip(sha?: string): boolean {
		return sha === uncommitted;
	}

	fromSha(shas: string[] | undefined, swapped: boolean): string | undefined {
		if (!shas?.length || shas.length < 2) return undefined;
		return swapped ? shas[0] : shas.at(-1);
	}

	toSha(shas: string[] | undefined, swapped: boolean): string | undefined {
		if (!shas?.length || shas.length < 2) return undefined;
		return swapped ? shas.at(-1) : shas[0];
	}

	async fetchCapabilities(): Promise<void> {
		const s = this.services;

		const [
			pullRequestExpanded,
			[avatars, currentUserNameStyle, dateFormat, dateStyle, files, showSignatureBadges],
			[indentGuides, indent, enableSmartCommit],
			aiEnabled,
			aiModel,
			autolinksEnabled,
			integrations,
			hasAccount,
			orgSettings,
		] = await Promise.all([
			s.storage.getWorkspace('views:commitDetails:pullRequestExpanded'),
			s.config.getMany(
				'views.commitDetails.avatars',
				'defaultCurrentUserNameStyle',
				'defaultDateFormat',
				'defaultDateStyle',
				'views.commitDetails.files',
				'signing.showSignatureBadges',
			),
			s.config.getManyCore('workbench.tree.renderIndentGuides', 'workbench.tree.indent', 'git.enableSmartCommit'),
			s.ai.isEnabled(),
			s.ai.getModel(),
			s.config.get('views.commitDetails.autolinks.enabled'),
			s.integrations.getIntegrationStates(),
			s.subscription.hasAccount(),
			s.subscription.getOrgSettings(),
		]);

		this.state.preferences.set({
			pullRequestExpanded: pullRequestExpanded ?? true,
			avatars: avatars,
			currentUserNameStyle: currentUserNameStyle ?? 'you',
			dateFormat: dateFormat ?? 'MMMM Do, YYYY h:mma',
			dateStyle: dateStyle ?? 'relative',
			files: files,
			indentGuides: indentGuides ?? 'onHover',
			indent: indent,
			aiEnabled: aiEnabled,
			enableSmartCommit: enableSmartCommit ?? false,
			showSignatureBadges: showSignatureBadges,
		});
		this.state.autolinksEnabled.set(autolinksEnabled ?? true);
		this.state.hasIntegrationsConnected.set(integrations?.some(i => i.connected) ?? false);
		this.state.hasAccount.set(hasAccount ?? false);
		this.state.orgSettings.set(orgSettings ?? { ai: false, drafts: false });
		this.state.aiModel.set(aiModel);

		// Subscribe to AI model so the picker chip stays in sync with native quickpick changes.
		void this.subscribeEvents();
	}

	private async subscribeEvents(): Promise<void> {
		const unsubscribe = await subscribeAll([
			() => this.services.ai.onModelChanged(model => this.state.aiModel.set(model)),
			() =>
				this.services.graphInspect.onComposeProgress(event => {
					this.state.composeProgressMessage.set(event?.message);
				}),
		]);
		if (this._disposed) {
			unsubscribe();
			return;
		}
		this._eventUnsubscribe = unsubscribe;
	}

	switchAIModel(): void {
		// Reuses VS Code's native AI provider quickpick — keeps a single point of truth for
		// model selection and avoids re-implementing the picker in the webview.
		void this.services.commands.execute('gitlens.ai.switchProvider', { source: 'graph-details' as const });
	}

	refreshWip(): void {
		this._lastFetchedKey = undefined;
		// Drop cached wip enrichment for the current branch so the next fetch is authoritative.
		const wip = this.state.wip.get();
		const branchName = wip?.branch?.name;
		const repoPath = wip?.repo?.path ?? wip?.branch?.repoPath;
		if (branchName != null && repoPath != null) {
			this._wipEnrichmentCache.delete(`${branchName}:${repoPath}`);
		}
	}

	async fetchDetails(
		sha: string | undefined,
		repoPath: string | undefined,
		graphReachability?: GitCommitReachability,
		options?: { searchActive?: boolean; commitLite?: CommitDetails },
	): Promise<void> {
		const s = this.services;

		const key = `${sha}:${repoPath}`;
		if (key === this._lastFetchedKey) return;

		// New selection — abort any in-flight enrichment so a stale merge-target / PR / autolink
		// fetch from a prior selection can't write state (or pin the loading flag) over the new one.
		const enrichSignal = this.resetEnrichment();

		// Clear compare state when switching back to single-commit mode
		this.clearCompareCore();
		this.clearCompareEnrichment();
		this.state.compareExplainBusy.set(false);

		if (!sha || !repoPath) {
			this._lastFetchedKey = undefined;
			return;
		}

		this._lastFetchedKey = key;

		// For commit selections, hydrate enrichment from cache if we've seen this sha before.
		// Misses (or WIP) get cleared to undefined so stale prior-selection chips don't linger.
		const commitCacheHit = sha !== uncommitted ? this._commitEnrichmentCache.get(`${sha}:${repoPath}`) : undefined;
		if (commitCacheHit != null) {
			// Hydrate the commit itself first so the displayed metadata + chips match the same sha.
			// Otherwise the await commit.fetch leaves _state.commit pointing at the prior selection
			// for ~30ms, mismatching the freshly-set enrichment.
			if (commitCacheHit.commit != null) {
				this.state.commit.set(commitCacheHit.commit);
			}
			this.state.autolinks.set(commitCacheHit.autolinks);
			this.state.formattedMessage.set(commitCacheHit.formattedMessage);
			this.state.autolinkedIssues.set(commitCacheHit.autolinkedIssues);
			if (commitCacheHit.hasPullRequest) {
				this.state.pullRequest.set(commitCacheHit.pullRequest);
			} else {
				this.state.pullRequest.set(undefined);
			}
			if (commitCacheHit.hasSignature) {
				this.state.signature.set(commitCacheHit.signature);
			} else {
				this.state.signature.set(undefined);
			}
		} else {
			// Cold-cache commit selection — paint the commit shell from the eager lite (built
			// from the graph row) so the metadata bar/header are visible at t≈0ms instead of
			// after the IPC roundtrip. WIP has no lite; multi-commit goes through fetchCompareDetails.
			// The subsequent `await commit.fetch` overwrites with the full payload (files/stats).
			if (sha !== uncommitted && options?.commitLite?.sha === sha) {
				this.state.commit.set(options.commitLite);
			}
			this.state.autolinks.set(undefined);
			this.state.formattedMessage.set(undefined);
			this.state.autolinkedIssues.set(undefined);
			this.state.pullRequest.set(undefined);
			this.state.signature.set(undefined);
		}
		this.state.reachability.set(graphReachability ?? { partial: true, refs: [] });
		this.state.reachabilityState.set('loaded');
		this.state.explain.set(undefined);
		this.state.searchContext.set(undefined);

		// Fire hasRemotes check in parallel with the main fetch
		void s.repository
			.hasRemotes(repoPath)
			.then(has => {
				if (this._lastFetchedKey === key) {
					this.state.hasRemotes.set(has);
				}
			})
			.catch(noop);

		// Fire search-context fetch in parallel — it drives match highlighting + filter button
		// in the embedded file trees. Skip for WIP (no graph SHA to look up) and skip when no
		// search is active in the graph (host would just return undefined — saves an RPC roundtrip
		// per click in the common no-search case).
		if (sha !== uncommitted && options?.searchActive) {
			void s.graphInspect.getSearchContext(sha).then(ctx => {
				if (this._lastFetchedKey === key) {
					this.state.searchContext.set(ctx);
				}
			}, noop);
		}

		try {
			if (sha === uncommitted) {
				// Don't eager-clear WIP enrichment — keep prior chips visible until either a cache
				// hit (in fetchWipBranchEnrichment) replaces them or the network fetch returns.
				// Avoids the flash-out → flash-in cycle on revisit. Loading flag is only set when
				// we know we don't have cached merge-target data (set in fetchWipBranchEnrichment).

				await this.resources.wip.fetch(repoPath);

				if (this._lastFetchedKey !== key) return;
				if (this.resources.wip.status.get() === 'success') {
					const wip = this.resources.wip.value.get();
					this.state.wip.set(wip);
					if (this.state.activeMode.get() != null) {
						this.state.wipStale.set(true);
					}

					const branchName = wip?.branch?.name;
					if (branchName != null) {
						this.fetchWipBranchEnrichment(repoPath, branchName, enrichSignal);
					} else {
						this.state.wipMergeTargetLoading.set(false);
					}
				} else {
					this.state.wipMergeTargetLoading.set(false);
				}
			} else {
				await this.resources.commit.fetch(repoPath, sha);

				if (this._lastFetchedKey !== key) return;
				if (this.resources.commit.status.get() === 'success') {
					const commit = this.resources.commit.value.get();
					this.state.commit.set(commit);
					if (commit != null) {
						this._commitEnrichmentCache.update(`${sha}:${repoPath}`, { commit: commit });
						this.fetchEnrichment(repoPath, sha, enrichSignal);
					}
				}
			}
		} catch {
			if (this._lastFetchedKey === key) {
				this.state.commit.set(undefined);
				this.state.wip.set(undefined);
				this.state.wipMergeTargetLoading.set(false);
			}
		}
	}

	private fetchEnrichment(repoPath: string, sha: string, signal: AbortSignal): void {
		const cacheKey = `${sha}:${repoPath}`;
		const isStash = this.state.commit.get()?.stashNumber != null;

		fetchCommitEnrichment(
			this.services,
			this.resources.commit,
			signal,
			{ repoPath: repoPath, sha: sha, isStash: isStash, autolinksEnabled: this.state.autolinksEnabled.get() },
			{
				setBasicAutolinks: (autolinks, formattedMessage) => {
					this._commitEnrichmentCache.update(cacheKey, {
						autolinks: autolinks,
						formattedMessage: formattedMessage,
					});
					this.state.autolinks.set(autolinks);
					this.state.formattedMessage.set(formattedMessage);
				},
				setEnrichedAutolinks: (issues, formattedMessage) => {
					this._commitEnrichmentCache.update(cacheKey, {
						autolinkedIssues: issues,
						formattedMessage: formattedMessage,
					});
					this.state.autolinkedIssues.set(issues);
					this.state.formattedMessage.set(formattedMessage);
				},
				setPullRequest: pr => {
					this._commitEnrichmentCache.update(cacheKey, { pullRequest: pr, hasPullRequest: true });
					this.state.pullRequest.set(pr);
				},
				setSignature: sig => {
					this._commitEnrichmentCache.update(cacheKey, { signature: sig, hasSignature: true });
					this.state.signature.set(sig);
				},
			},
		);
	}

	private fetchWipBranchEnrichment(repoPath: string, branchName: string, signal: AbortSignal): void {
		const s = this.services;
		const cacheKey = `${branchName}:${repoPath}`;
		const cached = this._wipEnrichmentCache.get(cacheKey);

		// Hydrate from cache synchronously so chips are visible immediately. Partial-entry safety:
		// each field hydrates from cache *or* explicitly clears (arrays) / falls back to "loading"
		// (mergeTarget) — never leaves a prior-branch value visible because some fields happened
		// to be cached and others didn't. We still kick off the network refresh below to keep the
		// data fresh — the cache provides instant continuity, the fetch provides eventual consistency.
		if (cached != null) {
			// Arrays — undefined in cache means "haven't fetched / got cleared", so clear state too.
			this.state.wipAutolinks.set(cached.autolinks);
			this.state.wipIssues.set(cached.issues);
			// MergeTarget — undefined is a valid resolved value, so use the sentinel to distinguish.
			if (cached.hasMergeTarget) {
				this.state.wipMergeTarget.set(cached.mergeTarget);
				this.state.wipMergeTargetLoading.set(false);
			} else {
				this.state.wipMergeTarget.set(undefined);
				this.state.wipMergeTargetLoading.set(true);
			}
		} else {
			// First visit to this branch — clear any prior-branch values and show loading.
			this.state.wipAutolinks.set(undefined);
			this.state.wipIssues.set(undefined);
			this.state.wipMergeTarget.set(undefined);
			this.state.wipMergeTargetLoading.set(true);
		}

		// Single RPC, three deferred legs. The outer Promise resolves once the host has the
		// branch + worktree-aware shape (cheap); each leg below settles on its own roundtrip
		// so autolinks/issues don't wait on the slower mergeTargetStatus integration call.
		// Belt-and-suspenders: clear the spinner if the merge-target leg hasn't settled in 10s.
		// Set up before the outer .then so it covers the outer-rejection path too. The host
		// already times out the PR-based merge-target lookup at 5s — this is a final safety
		// net for transport stalls or future regressions in uncancellable subcalls.
		const maxWaitTimer = setTimeout(() => {
			if (signal.aborted) return;
			this.state.wipMergeTargetLoading.set(false);
		}, 10_000);

		void s.branches.getBranchEnrichment(repoPath, branchName, signal).then(
			enrichmentGuard(this.resources.wip, enrichment => {
				if (signal.aborted) return;
				if (enrichment == null) {
					clearTimeout(maxWaitTimer);
					this.state.wipMergeTargetLoading.set(false);
					return;
				}

				void enrichment.autolinks.then(
					enrichmentGuard(this.resources.wip, autolinks => {
						if (signal.aborted) return;
						this._wipEnrichmentCache.update(cacheKey, { autolinks: autolinks });
						this.state.wipAutolinks.set(autolinks);
					}),
					noopUnlessReal,
				);

				void enrichment.issues.then(
					enrichmentGuard(this.resources.wip, issues => {
						if (signal.aborted) return;
						this._wipEnrichmentCache.update(cacheKey, { issues: issues });
						this.state.wipIssues.set(issues);
					}),
					noopUnlessReal,
				);

				void enrichment.mergeTargetStatus
					.then(
						enrichmentGuard(this.resources.wip, mergeTarget => {
							if (signal.aborted) return;
							const status: BranchMergeTargetStatus = {
								branch: enrichment.branch,
								mergeTarget: mergeTarget,
							};
							this._wipEnrichmentCache.update(cacheKey, {
								mergeTarget: status,
								hasMergeTarget: true,
							});
							this.state.wipMergeTarget.set(status);
						}),
						noopUnlessReal,
					)
					.finally(() => {
						clearTimeout(maxWaitTimer);
						// Always clear the loading flag for THIS batch unless a newer batch has
						// taken over (signaled by abort). Without the abort gate, the prior
						// `guard()`-wrapped clear would skip on stale generations and leave the
						// flag stuck at `true`.
						if (signal.aborted) return;
						this.state.wipMergeTargetLoading.set(false);
					});
			}),
			(e: unknown) => {
				clearTimeout(maxWaitTimer);
				if (!signal.aborted) {
					this.state.wipMergeTargetLoading.set(false);
				}
				noopUnlessReal(e);
			},
		);
	}

	/** Re-fetch WIP branch enrichment in response to out-of-band git-config changes. */
	refreshWipBranchEnrichment(): void {
		const wip = this.state.wip.get();
		const branchName = wip?.branch?.name;
		const repoPath = wip?.repo?.path ?? wip?.branch?.repoPath;
		if (!branchName || !repoPath) return;

		// Force a real network fetch — drop cached values so fetchWipBranchEnrichment sees a miss
		// and goes through the loading-state path. Used in response to out-of-band git-config
		// writes where the cache is known to be stale.
		this._wipEnrichmentCache.delete(`${branchName}:${repoPath}`);
		this.fetchWipBranchEnrichment(repoPath, branchName, this.resetEnrichment());
	}

	async removeAssociatedIssue(entityId: string): Promise<void> {
		const wip = this.state.wip.get();
		const branchName = wip?.branch?.name;
		const repoPath = wip?.repo?.path ?? wip?.branch?.repoPath;
		if (!branchName || !repoPath) return;

		// Optimistic update — remove locally so the chip disappears immediately.
		// Real reconciliation happens via the onRepositoryChanged (gkConfig) subscription
		// that re-fires fetchWipBranchEnrichment when the git config write lands.
		const previous = this.state.wipIssues.get();
		const cacheKey = `${branchName}:${repoPath}`;
		const previousCache = this._wipEnrichmentCache.get(cacheKey);
		if (previous?.length) {
			const next = previous.filter(i => i.entityId !== entityId);
			this.state.wipIssues.set(next);
			this._wipEnrichmentCache.update(cacheKey, { issues: next });
		}

		try {
			await this.services.branches.removeAssociatedIssue(repoPath, branchName, entityId);
		} catch {
			// Revert the optimistic update on failure; the gkConfig event won't fire.
			this.state.wipIssues.set(previous);
			if (previousCache !== undefined) {
				this._wipEnrichmentCache.set(cacheKey, previousCache);
			}
		}
	}

	async loadReachability(): Promise<void> {
		const commit = this.state.commit.get();
		if (!commit) return;

		this.state.reachabilityState.set('loading');
		const start = performance.now();
		try {
			const result = await this.services.repository.getCommitReachability(commit.repoPath, commit.sha);
			this.state.reachability.set(result);
			this.state.reachabilityState.set('loaded');
			this.sendTelemetryEvent('graphDetails/reachability/loaded', {
				'refs.count': result?.refs?.length ?? 0,
				duration: performance.now() - start,
			});
		} catch (ex) {
			this.state.reachabilityState.set('error');
			this.sendTelemetryEvent('graphDetails/reachability/failed', {
				duration: performance.now() - start,
				'failed.reason': 'unknown',
				'failed.error': ex instanceof Error ? ex.message : String(ex),
			});
		}
	}

	refreshReachability(): void {
		this.state.reachability.set(undefined);
		this.state.reachabilityState.set('idle');
		void this.loadReachability();
	}

	async explainCommit(prompt?: string): Promise<void> {
		const commit = this.state.commit.get();
		if (!commit) return;

		try {
			const result = await this.services.graphInspect.explainCommit(commit.repoPath, commit.sha, prompt);
			if (this.state.commit.get()?.sha !== commit.sha) return;

			if ('error' in result && result.error) {
				this.state.explain.set({ error: result.error });
			} else if ('result' in result && result.result) {
				this.state.explain.set({ result: result.result });
			}
		} catch {
			if (this.state.commit.get()?.sha !== commit.sha) return;
			this.state.explain.set({ error: { message: 'Failed to explain commit' } });
		}
	}

	async fetchCompareDetails(
		shas: string[] | undefined,
		repoPath: string | undefined,
		commitLites?: Record<string, CommitDetails>,
	): Promise<void> {
		const swapped = this.state.swapped.get();
		const fromSha = this.fromSha(shas, swapped);
		const toSha = this.toSha(shas, swapped);

		const key = `compare:${fromSha}:${toSha}:${repoPath}`;
		if (key === this._lastFetchedKey) return;

		// New selection — abort any in-flight enrichment from a prior selection.
		const enrichSignal = this.resetEnrichment();

		if (!fromSha || !toSha || !repoPath) {
			this.clearCompareCore();
			this._lastFetchedKey = undefined;
			return;
		}

		this._lastFetchedKey = key;
		this.clearCompareEnrichment();
		// Search context only applies in single-commit selection — clear on entering compare.
		this.state.searchContext.set(undefined);

		try {
			const comparePromise = this.resources.compare.fetch(repoPath, fromSha, toSha);

			// Reuse cached commit shells (populated by single-commit visits) to skip the
			// two getCommit IPC roundtrips when we've seen these shas before. Saves ~30ms each
			// and avoids re-serializing two ~40KB payloads.
			const cachedFrom = this._commitEnrichmentCache.get(`${fromSha}:${repoPath}`)?.commit;
			const cachedTo = this._commitEnrichmentCache.get(`${toSha}:${repoPath}`)?.commit;

			// Cold-cache fallback: paint commit shells from the eager lites (built from graph row data)
			// so commitFrom/commitTo are visible at t≈0ms. The subsequent `await getCommit` IPCs still
			// fire to fetch the full data (files/stats) — but the synchronous set means the panel can
			// render the metadata immediately instead of waiting for the await to settle.
			const liteFrom = commitLites?.[fromSha];
			const liteTo = commitLites?.[toSha];
			if (cachedFrom == null && liteFrom?.sha === fromSha) {
				this.state.commitFrom.set(liteFrom);
			}
			if (cachedTo == null && liteTo?.sha === toSha) {
				this.state.commitTo.set(liteTo);
			}

			const fromPromise: Promise<CommitDetails | undefined> =
				cachedFrom != null
					? Promise.resolve(cachedFrom)
					: this.services.graphInspect.getCommit(repoPath, fromSha, enrichSignal);
			const toPromise: Promise<CommitDetails | undefined> =
				cachedTo != null
					? Promise.resolve(cachedTo)
					: this.services.graphInspect.getCommit(repoPath, toSha, enrichSignal);

			const [commitFrom, commitTo] = await Promise.all([fromPromise, toPromise, comparePromise]);

			if (this._lastFetchedKey !== key) return;

			this.state.commitFrom.set(commitFrom);
			this.state.commitTo.set(commitTo);

			// Write fresh shells back into the single-commit cache so future single-commit
			// visits (or repeat compare visits) skip the IPC.
			if (commitFrom != null && cachedFrom == null) {
				this._commitEnrichmentCache.update(`${fromSha}:${repoPath}`, { commit: commitFrom });
			}
			if (commitTo != null && cachedTo == null) {
				this._commitEnrichmentCache.update(`${toSha}:${repoPath}`, { commit: commitTo });
			}

			if (this.resources.compare.status.get() === 'success') {
				const diff = this.resources.compare.value.get();
				this.state.compareFiles.set(diff?.files);
				this.state.compareStats.set(diff?.stats);
				this.state.compareBetweenCount.set(diff?.commitCount);
			}

			this.fetchCompareEnrichment(repoPath, fromSha, toSha, enrichSignal);
		} catch {
			if (this._lastFetchedKey === key) {
				this.clearCompareCore();
			}
		}
	}

	private fetchCompareEnrichment(repoPath: string, fromSha: string, toSha: string, signal: AbortSignal): void {
		const s = this.services;

		// Reuse signatures from the single-commit cache when present (`hasSignature: true` means
		// we've previously resolved this sha's signature, even if the value is `undefined` —
		// signatures are immutable per-sha, so the cached value is authoritative).
		const cachedFromEntry = this._commitEnrichmentCache.get(`${fromSha}:${repoPath}`);
		const cachedToEntry = this._commitEnrichmentCache.get(`${toSha}:${repoPath}`);

		if (cachedFromEntry?.hasSignature) {
			this.state.signatureFrom.set(cachedFromEntry.signature);
		} else {
			guardedEnrich(
				this.resources.compare,
				signal,
				() => s.repository.getCommitSignature(repoPath, fromSha, signal),
				sig => {
					this._commitEnrichmentCache.update(`${fromSha}:${repoPath}`, {
						signature: sig,
						hasSignature: true,
					});
					this.state.signatureFrom.set(sig);
				},
			);
		}

		if (cachedToEntry?.hasSignature) {
			this.state.signatureTo.set(cachedToEntry.signature);
		} else {
			guardedEnrich(
				this.resources.compare,
				signal,
				() => s.repository.getCommitSignature(repoPath, toSha, signal),
				sig => {
					this._commitEnrichmentCache.update(`${toSha}:${repoPath}`, { signature: sig, hasSignature: true });
					this.state.signatureTo.set(sig);
				},
			);
		}

		if (!this.state.autolinksEnabled.get()) return;

		// Range-based — covers every commit in `from..to`, not just the user's explicit shas
		// (which can be a subset of the range when commits are picked individually with
		// cmd/ctrl-click rather than as a contiguous shift-click range).
		const gen = this.resources.compare.generationId.get();
		this.state.compareAutolinksLoading.set(true);
		void s.autolinks
			.getAutolinksForCompareRange(repoPath, fromSha, toSha, signal)
			.then(
				enrichmentGuard(this.resources.compare, autolinks => {
					if (signal.aborted) return;
					this.state.compareAutolinks.set(autolinks.length > 0 ? autolinks : undefined);
				}),
				noopUnlessReal,
			)
			.finally(() => {
				// Only clear the loading flag for THIS batch — a newer fetch (signaled via abort
				// or generation bump) has already taken over and reset the flag through
				// clearCompareEnrichment, so we'd otherwise stomp on its in-flight state.
				if (signal.aborted) return;
				if (this.resources.compare.generationId.get() !== gen) return;
				this.state.compareAutolinksLoading.set(false);
			});
	}

	async enrichAutolinks(repoPath: string, fromSha: string, toSha: string): Promise<void> {
		const gen = this.resources.compare.generationId.get();
		const signal = this._enrichmentController?.signal;
		this.state.compareEnrichmentLoading.set(true);

		try {
			const items = await this.services.autolinks.enrichAutolinksForCompareRange(
				repoPath,
				fromSha,
				toSha,
				signal,
			);
			if (this.resources.compare.generationId.get() !== gen) return;
			this.state.compareEnrichedItems.set(items);
		} catch (ex) {
			// Expected on navigation-away aborts — leave state alone for retry on real failures.
			if (!isAbortError(ex)) {
				// Leave undefined so the enrich button remains visible for retry
			}
		} finally {
			if (this.resources.compare.generationId.get() === gen) {
				this.state.compareEnrichmentLoading.set(false);
			}
		}
	}

	swap(shas: string[] | undefined): void {
		this.state.swapped.set(!this.state.swapped.get());

		// Swap cached commit/signature data in-place
		const tmpCommit = this.state.commitFrom.get();
		this.state.commitFrom.set(this.state.commitTo.get());
		this.state.commitTo.set(tmpCommit);

		const tmpSig = this.state.signatureFrom.get();
		this.state.signatureFrom.set(this.state.signatureTo.get());
		this.state.signatureTo.set(tmpSig);

		// Only re-fetch the diff (direction-dependent)
		void this.fetchSwappedDiff(shas);
	}

	private async fetchSwappedDiff(shas: string[] | undefined): Promise<void> {
		const swapped = this.state.swapped.get();
		const fromSha = this.fromSha(shas, swapped);
		const toSha = this.toSha(shas, swapped);
		const repoPath = this.state.commitFrom.get()?.repoPath;

		if (!fromSha || !toSha || !repoPath) return;

		const key = `compare:${fromSha}:${toSha}:${repoPath}`;
		this._lastFetchedKey = key;

		await this.resources.compare.fetch(repoPath, fromSha, toSha);

		if (this._lastFetchedKey !== key) return;
		if (this.resources.compare.status.get() === 'success') {
			const diff = this.resources.compare.value.get();
			this.state.compareFiles.set(diff?.files);
			this.state.compareStats.set(diff?.stats);
		}
	}

	compareExplain(shas: string[] | undefined, repoPath: string | undefined, prompt?: string): void {
		const swapped = this.state.swapped.get();
		const fromSha = this.fromSha(shas, swapped);
		const toSha = this.toSha(shas, swapped);
		if (!fromSha || !toSha || !repoPath) return;

		this.state.compareExplainBusy.set(true);
		void this.services.graphInspect.explainCompare(repoPath, fromSha, toSha, prompt).finally(() => {
			this.state.compareExplainBusy.set(false);
		});
	}

	async initCompareDefaults(repoPath: string | undefined, branchName?: string): Promise<void> {
		if (!repoPath) return;

		const defaultRef = await this.services.graphInspect.getMergeTargetComparisonRef(repoPath, branchName);
		this.state.branchCompareRightRef.set(defaultRef ?? 'main');
		this.clearBranchCompareEnrichmentCaches();
		void this.refreshCompare(repoPath);
	}

	/**
	 * Refresh on a comparison-identity change (refs / wip / initial entry). Triggers Phase 1
	 * (summary) immediately, and Phase 2 (active side's commits + files) only if the user is
	 * already sitting on Ahead or Behind. The 'all' tab has all the data it needs from Phase 1.
	 */
	async refreshCompare(repoPath: string | undefined): Promise<void> {
		this.state.branchCompareStale.set(false);
		await this.fetchCompareSummary(repoPath);
		const tab = this.state.branchCompareActiveTab.get();
		if (tab === 'ahead' || tab === 'behind') {
			void this.fetchCompareSide(repoPath, tab);
		}
	}

	refreshBranchCompare(repoPath: string | undefined): void {
		this.state.branchCompareStale.set(false);
		this.state.branchCompareAheadLoaded.set(false);
		this.state.branchCompareBehindLoaded.set(false);
		this.state.branchCompareSelectedCommitShaByTab.set(new Map());
		this.clearBranchCompareEnrichmentCaches();
		void this.refreshCompare(repoPath);
	}

	markBranchCompareStale(): void {
		if (this.state.activeMode.get() !== 'compare' || !this.state.branchCompareIncludeWorkingTree.get()) return;
		this.state.branchCompareStale.set(true);
	}

	/** Phase 1 — counts + the All Files diff. Cheap, runs on every comparison-identity change. */
	async fetchCompareSummary(repoPath: string | undefined): Promise<void> {
		const leftRef = this.state.branchCompareLeftRef.get();
		const rightRef = this.state.branchCompareRightRef.get();
		if (!repoPath || !leftRef || !rightRef) return;

		const options: BranchComparisonOptions = {
			includeWorkingTree: this.state.branchCompareIncludeWorkingTree.get(),
		};
		const identityKey = this.getBranchCompareIdentityKey(repoPath);

		await this.resources.branchCompareSummary.fetch(repoPath, leftRef, rightRef, options);
		if (identityKey == null || this.getBranchCompareIdentityKey(repoPath) !== identityKey) return;

		if (this.resources.branchCompareSummary.status.get() !== 'success') return;
		const result = this.resources.branchCompareSummary.value.get();
		if (!result) {
			this.clearBranchCompareData();
			return;
		}

		this.state.branchCompareAheadCount.set(result.aheadCount);
		this.state.branchCompareBehindCount.set(result.behindCount);
		this.state.branchCompareAllFiles.set(result.allFiles.slice());
		this.state.branchCompareAllFilesCount.set(result.allFilesCount);

		// Seed enrichment for the active scope. Both calls no-op on cache hit.
		void this.fetchBranchCompareAutolinks(repoPath);
		if (this.state.branchCompareActiveView.get() === 'contributors') {
			void this.fetchBranchCompareContributors(repoPath);
		}
	}

	/**
	 * Phase 2 — that side's commits with per-commit files inline. After this lands, *all*
	 * interactions on that side (tab switches, commit selection, deselect) are pure client-side.
	 */
	async fetchCompareSide(repoPath: string | undefined, side: 'ahead' | 'behind'): Promise<void> {
		const leftRef = this.state.branchCompareLeftRef.get();
		const rightRef = this.state.branchCompareRightRef.get();
		if (!repoPath || !leftRef || !rightRef) return;

		const options: BranchComparisonOptions = {
			includeWorkingTree: this.state.branchCompareIncludeWorkingTree.get(),
		};
		const identityKey = this.getBranchCompareIdentityKey(repoPath, side);

		await this.resources.branchCompareSide.fetch(repoPath, leftRef, rightRef, side, options);
		if (identityKey == null || this.getBranchCompareIdentityKey(repoPath, side) !== identityKey) return;

		if (this.resources.branchCompareSide.status.get() !== 'success') return;
		const result = this.resources.branchCompareSide.value.get();
		if (!result) return;

		if (side === 'ahead') {
			this.state.branchCompareAheadCommits.set(result.commits);
			this.state.branchCompareAheadFiles.set(result.files);
			this.state.branchCompareAheadLoaded.set(true);
		} else {
			this.state.branchCompareBehindCommits.set(result.commits);
			this.state.branchCompareBehindFiles.set(result.files);
			this.state.branchCompareBehindLoaded.set(true);
		}

		// Side commits arrived → re-seed enrichment for the active scope (autolinks may pick up
		// new shas, contributors view may need refresh).
		void this.fetchBranchCompareAutolinks(repoPath);
		if (this.state.branchCompareActiveView.get() === 'contributors') {
			void this.fetchBranchCompareContributors(repoPath);
		}
	}

	/** Phase 2 only if not already loaded for the current refs/wip. Cheap to call defensively. */
	async fetchCompareSideIfNeeded(repoPath: string | undefined, side: 'ahead' | 'behind'): Promise<void> {
		const loaded =
			side === 'ahead' ? this.state.branchCompareAheadLoaded.get() : this.state.branchCompareBehindLoaded.get();
		if (loaded) return;
		await this.fetchCompareSide(repoPath, side);
	}

	async changeCompareRef(side: 'left' | 'right', repoPath: string | undefined): Promise<void> {
		if (!repoPath) return;

		const currentRef =
			side === 'left' ? this.state.branchCompareLeftRef.get() : this.state.branchCompareRightRef.get();
		const result = await this.services.graphInspect.chooseRef(
			repoPath,
			'Choose a Reference to Compare',
			currentRef,
		);
		if (!result) return;

		if (side === 'left') {
			this.state.branchCompareLeftRef.set(result.name);
		} else {
			this.state.branchCompareRightRef.set(result.name);
		}
		// Comparison identity changed — clear side/all-file data immediately so stale commits
		// cannot seed enrichment while the new summary/side fetches are in flight.
		this.clearBranchCompareData();
		this.clearBranchCompareEnrichmentCaches();
		void this.refreshCompare(repoPath);
	}

	openCompareInSearchAndCompare(repoPath: string | undefined): void {
		if (repoPath == null) return;
		const leftRef = this.state.branchCompareLeftRef.get();
		const rightRef = this.state.branchCompareRightRef.get();
		if (!leftRef || !rightRef) return;
		void this.services.graphInspect.openComparisonInSearchAndCompare(repoPath, leftRef, rightRef);
	}

	swapCompareRefs(repoPath: string | undefined): void {
		const temp = this.state.branchCompareLeftRef.get();
		this.state.branchCompareLeftRef.set(this.state.branchCompareRightRef.get());
		this.state.branchCompareRightRef.set(temp);
		this.state.branchCompareActiveTab.set('all');
		// Comparison identity changed — old commit selections no longer apply to the new range.
		this.state.branchCompareSelectedCommitShaByTab.set(new Map());
		this.state.branchCompareAheadLoaded.set(false);
		this.state.branchCompareBehindLoaded.set(false);
		this.clearBranchCompareEnrichmentCaches();
		void this.refreshCompare(repoPath);
	}

	toggleCompareWorkingTree(repoPath: string | undefined): void {
		this.state.branchCompareIncludeWorkingTree.set(!this.state.branchCompareIncludeWorkingTree.get());
		this.state.branchCompareStale.set(false);
		this.state.branchCompareAheadLoaded.set(false);
		this.state.branchCompareBehindLoaded.set(false);
		this.state.branchCompareSelectedCommitShaByTab.set(new Map());
		this.clearBranchCompareEnrichmentCaches();
		void this.refreshCompare(repoPath);
	}

	switchCompareTab(tab: 'all' | 'ahead' | 'behind', repoPath: string | undefined): void {
		this.state.branchCompareActiveTab.set(tab);
		// 'all' tab is fully served by Phase 1; only Ahead/Behind require Phase 2. The IfNeeded
		// variant no-ops if already loaded for the current refs/wip — second switch into a side
		// is instant.
		if (tab === 'ahead' || tab === 'behind') {
			void this.fetchCompareSideIfNeeded(repoPath, tab);
		}
	}

	selectCompareCommit(sha: string | undefined, repoPath: string | undefined): void {
		const tab = this.state.branchCompareActiveTab.get();
		// 'all' tab has no commit list, so it has no per-commit selection to persist.
		if (tab === 'all') return;
		const next = new Map(this.state.branchCompareSelectedCommitShaByTab.get());
		if (sha) {
			next.set(tab, sha);
		} else {
			next.delete(tab);
		}
		this.state.branchCompareSelectedCommitShaByTab.set(next);

		if (sha && repoPath) {
			void this.fetchCompareCommitFilesIfNeeded(repoPath, tab, sha);
		}
	}

	private async fetchCompareCommitFilesIfNeeded(
		repoPath: string,
		tab: 'ahead' | 'behind',
		sha: string,
	): Promise<void> {
		const listState =
			tab === 'ahead' ? this.state.branchCompareAheadCommits : this.state.branchCompareBehindCommits;
		const commits = listState.get();
		if (!commits) return;

		const commit = commits.find(c => c.sha === sha);
		if (commit == null) return;
		if (commit.files != null) return; // Already fetched

		// One in-flight fetch per (tab, sha). New selection on the same tab cancels the prior one
		// so the latest click wins; same-sha re-clicks dedupe so we don't double-fetch.
		const controllerKey = `${tab}:${sha}`;
		if (this._compareCommitFilesControllers.has(controllerKey)) return;

		// Identity guard — refs/repo/worktree-toggle changes invalidate this fetch's target list.
		const identityKey = this.getBranchCompareIdentityKey(repoPath);
		if (identityKey == null) return;

		// Abort any other in-flight fetch on the same tab — only one selection can be active at a time.
		for (const [key, c] of this._compareCommitFilesControllers) {
			if (key.startsWith(`${tab}:`)) {
				c.abort();
				this._compareCommitFilesControllers.delete(key);
			}
		}

		const controller = new AbortController();
		this._compareCommitFilesControllers.set(controllerKey, controller);
		const signal = controller.signal;

		const setLoading = (loading: boolean): void => {
			const next = new Map(this.state.branchCompareCommitFilesLoading.get());
			if (loading) {
				next.set(sha, true);
			} else {
				next.delete(sha);
			}
			this.state.branchCompareCommitFilesLoading.set(next);
		};
		setLoading(true);

		try {
			const details = await this.services.graphInspect.getCommit(repoPath, sha, signal);
			if (this._disposed || signal.aborted) return;
			if (this.getBranchCompareIdentityKey(repoPath) !== identityKey) return;

			const currentCommits = listState.get();
			const currentCommitIndex = currentCommits.findIndex(c => c.sha === sha);
			if (currentCommitIndex === -1) return;

			// Cache an empty array on miss so re-clicks don't re-fetch the same dead sha.
			const files =
				details?.files?.map(f => ({
					...f,
					source: 'comparison' as const,
				})) ?? [];

			const nextCommits = [...currentCommits];
			nextCommits[currentCommitIndex] = {
				...currentCommits[currentCommitIndex],
				files: files,
			};
			listState.set(nextCommits);
		} catch (ex) {
			if (signal.aborted) return;
			Logger.error(ex, `Failed to fetch files for commit ${sha}`);
		} finally {
			if (this._compareCommitFilesControllers.get(controllerKey) === controller) {
				this._compareCommitFilesControllers.delete(controllerKey);
			}
			if (!this._disposed && !signal.aborted) {
				setLoading(false);
			}
		}
	}

	private clearBranchCompareEnrichmentCaches(): void {
		for (const c of this._branchCompareEnrichmentControllers.values()) {
			c.abort();
		}
		for (const c of this._branchCompareContributorsControllers.values()) {
			c.abort();
		}
		for (const c of this._compareCommitFilesControllers.values()) {
			c.abort();
		}
		this._branchCompareEnrichmentControllers.clear();
		this._branchCompareContributorsControllers.clear();
		this._compareCommitFilesControllers.clear();

		this.state.branchCompareAutolinksByScope.set(new Map());
		this.state.branchCompareEnrichedAutolinksByScope.set(new Map());
		this.state.branchCompareContributorsByScope.set(new Map());
		this.state.branchCompareEnrichmentLoading.set(new Map());
		this.state.branchCompareContributorsLoading.set(new Map());
		this.state.branchCompareCommitFilesLoading.set(new Map());
		this.state.branchCompareEnrichmentRequested.set(false);
	}

	private getBranchCompareIdentityKey(
		repoPath: string | undefined,
		scope?: BranchComparisonContributorsScope,
	): string | undefined {
		const leftRef = this.state.branchCompareLeftRef.get();
		const rightRef = this.state.branchCompareRightRef.get();
		if (!repoPath || !leftRef || !rightRef) return undefined;

		const includeWorkingTree = this.state.branchCompareIncludeWorkingTree.get() ? '1' : '0';
		return `${repoPath}:${leftRef}:${rightRef}:${includeWorkingTree}:${scope ?? ''}`;
	}

	private getShasInScope(scope: BranchComparisonContributorsScope): string[] {
		const ahead = this.state.branchCompareAheadCommits.get();
		const behind = this.state.branchCompareBehindCommits.get();
		if (scope === 'ahead') return ahead.map(c => c.sha);
		if (scope === 'behind') return behind.map(c => c.sha);
		return [...ahead.map(c => c.sha), ...behind.map(c => c.sha)];
	}

	async fetchBranchCompareAutolinks(
		repoPath: string | undefined,
		scope?: BranchComparisonContributorsScope,
	): Promise<void> {
		if (!repoPath || !this.state.autolinksEnabled.get()) return;

		const activeScope = scope ?? this.state.branchCompareActiveTab.get();
		if (this.state.branchCompareAutolinksByScope.get().has(activeScope)) return;

		const shas = this.getShasInScope(activeScope);
		if (!shas.length) return;

		try {
			const identityKey = this.getBranchCompareIdentityKey(repoPath, activeScope);
			const autolinks = await this.services.autolinks.getAutolinksForCommits(repoPath, shas);
			if (identityKey == null || this.getBranchCompareIdentityKey(repoPath, activeScope) !== identityKey) return;

			const next = new Map(this.state.branchCompareAutolinksByScope.get());
			next.set(activeScope, autolinks);
			this.state.branchCompareAutolinksByScope.set(next);

			// If the user has already opted into enrichment for this comparison, fan it out for
			// the newly-fetched scope too — keeps the popover content consistent across tabs.
			if (this.state.branchCompareEnrichmentRequested.get()) {
				void this.fetchBranchCompareEnrichment(repoPath, activeScope);
			}
		} catch {
			// Leave the cache untouched; a future fetch can retry.
		}
	}

	async fetchBranchCompareEnrichment(
		repoPath: string | undefined,
		scope?: BranchComparisonContributorsScope,
	): Promise<void> {
		if (!repoPath || !this.state.autolinksEnabled.get()) return;

		const activeScope = scope ?? this.state.branchCompareActiveTab.get();
		if (this.state.branchCompareEnrichedAutolinksByScope.get().has(activeScope)) return;

		const shas = this.getShasInScope(activeScope);
		if (!shas.length) return;

		this._branchCompareEnrichmentControllers.get(activeScope)?.abort();
		const controller = new AbortController();
		this._branchCompareEnrichmentControllers.set(activeScope, controller);
		const signal = controller.signal;

		const nextLoading = new Map(this.state.branchCompareEnrichmentLoading.get());
		nextLoading.set(activeScope, true);
		this.state.branchCompareEnrichmentLoading.set(nextLoading);
		const identityKey = this.getBranchCompareIdentityKey(repoPath, activeScope);
		try {
			const items = await this.services.autolinks.enrichAutolinksForCommits(repoPath, shas, signal);
			if (signal.aborted) return;
			if (identityKey == null || this.getBranchCompareIdentityKey(repoPath, activeScope) !== identityKey) return;

			const next = new Map(this.state.branchCompareEnrichedAutolinksByScope.get());
			next.set(activeScope, items);
			this.state.branchCompareEnrichedAutolinksByScope.set(next);
		} catch {
			// Leave the cache without an entry so a future request can retry.
		} finally {
			if (!signal.aborted) {
				if (identityKey != null && this.getBranchCompareIdentityKey(repoPath, activeScope) === identityKey) {
					const nextLoading = new Map(this.state.branchCompareEnrichmentLoading.get());
					nextLoading.set(activeScope, false);
					this.state.branchCompareEnrichmentLoading.set(nextLoading);
				}
			}
		}
	}

	async fetchBranchCompareContributors(
		repoPath: string | undefined,
		scope?: BranchComparisonContributorsScope,
	): Promise<void> {
		if (!repoPath) return;

		const activeScope = scope ?? this.state.branchCompareActiveTab.get();
		if (this.state.branchCompareContributorsByScope.get().has(activeScope)) return;

		const leftRef = this.state.branchCompareLeftRef.get();
		const rightRef = this.state.branchCompareRightRef.get();
		if (!leftRef || !rightRef) return;

		this._branchCompareContributorsControllers.get(activeScope)?.abort();
		const controller = new AbortController();
		this._branchCompareContributorsControllers.set(activeScope, controller);
		const signal = controller.signal;

		const nextLoading = new Map(this.state.branchCompareContributorsLoading.get());
		nextLoading.set(activeScope, true);
		this.state.branchCompareContributorsLoading.set(nextLoading);
		const identityKey = this.getBranchCompareIdentityKey(repoPath, activeScope);
		try {
			const result = await this.services.graphInspect.getContributorsForBranchComparison(
				repoPath,
				leftRef,
				rightRef,
				activeScope,
				signal,
			);
			if (signal.aborted) return;
			if (identityKey == null || this.getBranchCompareIdentityKey(repoPath, activeScope) !== identityKey) return;

			const next = new Map(this.state.branchCompareContributorsByScope.get());
			next.set(activeScope, result?.contributors ?? []);
			this.state.branchCompareContributorsByScope.set(next);
		} catch {
			// Leave the cache without an entry so a future request can retry.
		} finally {
			if (!signal.aborted) {
				if (identityKey != null && this.getBranchCompareIdentityKey(repoPath, activeScope) === identityKey) {
					const nextLoading = new Map(this.state.branchCompareContributorsLoading.get());
					nextLoading.set(activeScope, false);
					this.state.branchCompareContributorsLoading.set(nextLoading);
				}
			}
		}
	}

	setBranchCompareActiveView(view: 'files' | 'contributors', repoPath: string | undefined): void {
		if (this.state.branchCompareActiveView.get() === view) return;

		this.state.branchCompareActiveView.set(view);
		if (view === 'contributors') {
			void this.fetchBranchCompareContributors(repoPath);
		}
	}

	requestBranchCompareEnrichment(repoPath: string | undefined): void {
		if (this.state.branchCompareEnrichmentRequested.get()) {
			void this.fetchBranchCompareEnrichment(repoPath);
			return;
		}
		this.state.branchCompareEnrichmentRequested.set(true);
		void this.fetchBranchCompareEnrichment(repoPath);
	}

	async fetchBranchCommits(repoPath: string | undefined): Promise<void> {
		if (!repoPath) return;

		this._branchCommitsController?.abort();
		const controller = new AbortController();
		this._branchCommitsController = controller;

		this.state.branchCommitsFetching.set(true);
		try {
			const result = await this.services.graphInspect.getBranchCommits(repoPath, undefined, controller.signal);
			if (controller.signal.aborted) return;

			this.state.branchCommits.set(result.commits);
			this.state.branchMergeBase.set(result.mergeBase);
			this.state.branchCommitsHasMore.set(result.hasMore);
		} finally {
			if (this._branchCommitsController === controller) {
				this._branchCommitsController = undefined;
				this.state.branchCommitsFetching.set(false);
			}
		}

		// Late-arriving branch commits: if we entered a WIP review/compose mode before commits
		// loaded, the default scope may have been computed without them. Re-derive only if the
		// current scope still looks like the "deferred" default — i.e. no working/staged files
		// were selected and includeShas is empty. Once the user drags or working changes are
		// included, we leave it alone.
		const activeMode = this.state.activeMode.get();
		const activeContext = this.state.activeModeContext.get();
		if (activeContext !== 'wip' || (activeMode !== 'review' && activeMode !== 'compose')) return;

		const currentScope = this.state.scope.get();
		if (currentScope?.type !== 'wip') return;
		if (currentScope.includeStaged || currentScope.includeUnstaged) return;
		if ((currentScope.includeShas?.length ?? 0) > 0) return;

		// Mirror buildDefaultScope's priority: unpushed commits → most recent commit (HEAD).
		const commits = this.state.branchCommits.get();
		const unpushedShas = commits?.filter(c => !c.pushed).map(c => c.sha) ?? [];
		const refreshedIncludeShas = unpushedShas.length > 0 ? unpushedShas : commits?.length ? [commits[0].sha] : [];
		if (refreshedIncludeShas.length === 0) return;
		const refreshedScope: ScopeSelection = {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: refreshedIncludeShas,
		};

		this.state.scope.set(refreshedScope);
		const wipRepoPath = this.state.wip.get()?.repo?.path ?? repoPath;
		void this.resources.scopeFiles.fetch(wipRepoPath, refreshedScope);
	}

	/**
	 * Load the next page of branch commits — extends the current commits list back toward the
	 * merge base. Re-runs the host `getBranchCommits` with a larger limit (idempotent: `git log
	 * -n` always returns from HEAD, so the larger response supersedes the smaller one).
	 */
	async loadMoreBranchCommits(repoPath: string | undefined): Promise<void> {
		if (!repoPath) return;
		if (this.state.branchCommitsLoadingMore.get()) return;
		if (!this.state.branchCommitsHasMore.get()) return;

		const currentCount = this.state.branchCommits.get()?.length ?? 0;
		const nextLimit = currentCount + 100;

		this._branchCommitsLoadMoreController?.abort();
		const controller = new AbortController();
		this._branchCommitsLoadMoreController = controller;

		this.state.branchCommitsLoadingMore.set(true);
		try {
			const result = await this.services.graphInspect.getBranchCommits(
				repoPath,
				{ limit: nextLimit },
				controller.signal,
			);
			if (this._disposed || controller.signal.aborted) return;

			this.state.branchCommits.set(result.commits);
			this.state.branchMergeBase.set(result.mergeBase);
			this.state.branchCommitsHasMore.set(result.hasMore);
		} finally {
			if (this._branchCommitsLoadMoreController === controller) {
				this._branchCommitsLoadMoreController = undefined;
				this.state.branchCommitsLoadingMore.set(false);
			}
		}
	}

	buildWipScopeItems(): ScopeItem[] | undefined {
		const wip = this.state.wip.get();
		if (!wip) return undefined;

		const items: ScopeItem[] = [];
		const files = wip.changes?.files ?? [];
		const unstaged = files.filter(f => !f.staged);
		const staged = files.filter(f => f.staged);

		if (unstaged.length > 0) {
			const added = unstaged.filter(f => f.status === 'A' || f.status === '?').length;
			const deleted = unstaged.filter(f => f.status === 'D').length;
			const modified = unstaged.length - added - deleted;
			items.push({
				id: 'unstaged',
				label: 'Unstaged changes',
				additions: added || undefined,
				deletions: deleted || undefined,
				modified: modified || undefined,
				fileCount: unstaged.length,
				state: 'uncommitted',
			});
		}
		if (staged.length > 0) {
			const added = staged.filter(f => f.status === 'A' || f.status === '?').length;
			const deleted = staged.filter(f => f.status === 'D').length;
			const modified = staged.length - added - deleted;
			items.push({
				id: 'staged',
				label: 'Staged changes',
				additions: added || undefined,
				deletions: deleted || undefined,
				modified: modified || undefined,
				fileCount: staged.length,
				state: 'uncommitted',
			});
		}

		const branchCommits = this.state.branchCommits.get();
		if (branchCommits?.length) {
			for (const commit of branchCommits) {
				items.push({
					id: commit.sha,
					label: commit.message.split('\n')[0],
					fileCount: commit.fileCount || undefined,
					additions: commit.additions || undefined,
					deletions: commit.deletions || undefined,
					state: commit.pushed ? 'pushed' : 'unpushed',
					author: commit.author,
					avatarUrl: commit.avatarUrl,
					date: commit.date ? new Date(commit.date).getTime() : undefined,
				});
			}
		} else {
			const ahead = wip.branch?.tracking?.ahead ?? 0;
			if (ahead > 0) {
				items.push({
					id: 'unpushed',
					label: pluralize('unpushed commit', ahead),
					state: 'unpushed',
				});
			}
		}

		// Load-more sits between the loaded commits and the merge-base footer when the host
		// indicates there are more commits to load.
		if (this.state.branchCommitsHasMore.get()) {
			items.push({
				id: 'load-more',
				label: this.state.branchCommitsLoadingMore.get() ? 'Loading…' : 'Load more commits',
				state: 'load-more',
			});
		}

		const mergeBase = this.state.branchMergeBase.get();
		if (mergeBase) {
			items.push({
				id: `merge-base:${mergeBase.sha}`,
				label: mergeBase.message || mergeBase.sha.substring(0, 7),
				state: 'merge-base',
				author: mergeBase.author,
				avatarUrl: mergeBase.avatarUrl,
				date: mergeBase.date ? new Date(mergeBase.date).getTime() : undefined,
			});
		}

		return items;
	}

	async fetchAiExcludedFiles(
		repoPath: string | undefined,
		sha: string | undefined,
		shas: string[] | undefined,
	): Promise<void> {
		const files = this.getReviewFiles(sha, shas);
		if (!repoPath || !files?.length) return;

		const generation = ++this._aiExcludedFilesGeneration;
		const paths = files.map(f => f.path);
		const excluded = await this.services.graphInspect.getAiExcludedFiles(repoPath, paths);
		if (this._aiExcludedFilesGeneration !== generation) return;

		this.state.aiExcludedFiles.set(excluded);
	}

	private getReviewFiles(sha: string | undefined, shas: string[] | undefined) {
		// Prefer the resolved scope file list (covers branch-commit files added via the scope picker)
		// over the context's static file list. Falls back to the context's files until scope resolves.
		const scoped = this.resources.scopeFiles.value.get();
		if (scoped?.length) return scoped;

		// Use activeModeContext when in a mode to avoid stale data from selection changes
		const ctx = this.state.activeModeContext.get();
		if (ctx === 'wip' || (!ctx && this.isWip(sha))) return this.state.wip.get()?.changes?.files;
		if (ctx === 'multicommit' || (!ctx && this.isMultiCommit(shas))) return this.state.compareFiles.get();
		return this.state.commit.get()?.files;
	}

	/**
	 * Translate a scope-picker selection into a `ScopeSelection`. Applied on scope-change.
	 *
	 * Takes the selected IDs directly (passed via the scope-change event detail) instead of
	 * walking back through the picker DOM, because the orchestrator's light-DOM `querySelector`
	 * can't reach into the review/compose panel's shadow root where the picker actually lives.
	 */
	buildScopeFromPicker(
		selectedIds: ReadonlySet<string> | undefined,
		scopeItems: ScopeItem[] | undefined,
	): ScopeSelection | undefined {
		const current = this.state.scope.get();
		if (!current || !selectedIds || !scopeItems) return current;

		const pickedShas = scopeItems
			.filter(
				i => (i.state === 'unpushed' || i.state === 'pushed') && selectedIds.has(i.id) && i.id !== 'unpushed',
			)
			.map(i => i.id);

		if (current.type === 'wip') {
			return {
				type: 'wip',
				includeStaged: selectedIds.has('staged'),
				includeUnstaged: selectedIds.has('unstaged'),
				includeShas: pickedShas,
			};
		}
		if (current.type === 'compare') {
			return {
				...current,
				includeShas: pickedShas.length > 0 ? pickedShas : undefined,
			};
		}
		return current;
	}

	openFileByPath(
		filePath: string,
		repoPath: string | undefined,
		options?: { lhs?: string; rhs?: string; line?: number; lineEnd?: number },
	): void {
		if (!repoPath || !options?.lhs || !options.rhs) return;
		void this.services.files.openFileChanges(repoPath, filePath, options.lhs, options.rhs, {
			line: options.line,
			lineEnd: options.lineEnd,
		});
	}

	async composeCommitAll(
		repoPath: string | undefined,
		sha: string | undefined,
		graphReachability?: GitCommitReachability,
	): Promise<void> {
		const composeValue = this.resources.compose.value.get();
		if (!repoPath || !composeValue || !('result' in composeValue)) return;

		this.state.composeApplying.set(true);
		try {
			const result = await this.services.graphInspect.commitCompose(repoPath, {
				commits: composeValue.result.commits,
				base: composeValue.result.baseCommit,
				mode: 'all',
			});
			if ('error' in result && result.error) {
				this.resources.compose.mutate({ error: { message: result.error.message } });
			} else {
				this.state.activeMode.set(null);
				this.state.activeModeContext.set(null);
				this.resources.compose.reset();
				this.state.composeForwardAvailable.set(false);
				this.refreshWip();
				void this.fetchDetails(sha, repoPath, graphReachability);
			}
		} catch {
			this.resources.compose.mutate({ error: { message: 'Failed to commit plan.' } });
		} finally {
			this.state.composeApplying.set(false);
		}
	}

	async composeCommitTo(
		repoPath: string | undefined,
		upToIndex: number,
		sha?: string,
		graphReachability?: GitCommitReachability,
	): Promise<void> {
		const composeValue = this.resources.compose.value.get();
		if (!repoPath || !composeValue || !('result' in composeValue)) return;

		this.state.composeApplying.set(true);
		try {
			const result = await this.services.graphInspect.commitCompose(repoPath, {
				commits: composeValue.result.commits,
				base: composeValue.result.baseCommit,
				mode: 'up-to',
				upToIndex: upToIndex,
			});
			if ('error' in result && result.error) {
				this.resources.compose.mutate({ error: { message: result.error.message } });
			} else {
				this.state.activeMode.set(null);
				this.state.activeModeContext.set(null);
				this.resources.compose.reset();
				this.state.composeForwardAvailable.set(false);
				this.refreshWip();
				void this.fetchDetails(sha, repoPath, graphReachability);
			}
		} catch {
			this.resources.compose.mutate({ error: { message: 'Failed to commit.' } });
		} finally {
			this.state.composeApplying.set(false);
		}
	}

	openComposer(repoPath: string | undefined): void {
		if (!repoPath) return;
		void this.services.commands.execute('gitlens.composeCommits', { repoPath: repoPath, source: 'graph' });
	}

	openFile(detail: FileChangeListItemDetail, ref?: string): void {
		fileActions.openFile(this.services.files, detail, detail.showOptions, ref);
	}

	openFileOnRemote(detail: FileChangeListItemDetail, ref?: string): void {
		fileActions.openFileOnRemote(this.services.files, detail, ref);
	}

	openFileCompareWorking(detail: FileChangeListItemDetail, ref?: string): void {
		fileActions.openFileCompareWorking(this.services.files, detail, detail.showOptions, ref);
	}

	openFileComparePrevious(detail: FileChangeListItemDetail, ref?: string): void {
		fileActions.openFileComparePrevious(this.services.files, detail, detail.showOptions, ref);
	}

	openFileCompareBetween(detail: FileChangeListItemDetail, fromRef?: string, toRef?: string): void {
		fileActions.openFileCompareBetween(this.services.files, detail, detail.showOptions, fromRef, toRef);
	}

	/** Open the virtual revision of `detail` via the virtual FS provider (no real SHA needed). */
	openVirtualFile(detail: FileChangeListItemDetail, ref: fileActions.VirtualRefShape): void {
		fileActions.openVirtualFile(this.services.files, ref, detail, detail.showOptions);
	}

	/** Diff the virtual revision against its virtual (or real) parent via the virtual FS service. */
	openVirtualFileComparePrevious(detail: FileChangeListItemDetail, ref: fileActions.VirtualRefShape): void {
		fileActions.openVirtualFileComparePrevious(this.services.files, ref, detail, detail.showOptions);
	}

	/** Open all files in the proposed-commit's virtual ref in VS Code's multi-diff editor. */
	openVirtualMultipleChanges(ref: fileActions.VirtualRefShape, files: readonly FileChangeListItemDetail[]): void {
		fileActions.openVirtualMultipleChanges(this.services.files, ref, files);
	}

	executeFileAction(detail: FileChangeListItemDetail, ref?: string): void {
		fileActions.executeFileAction(this.services.files, detail, detail.showOptions, ref);
	}

	openMultipleChanges(args: OpenMultipleChangesArgs): void {
		fileActions.openMultipleChanges(this.services.files, args);
	}

	stageFile(detail: FileChangeListItemDetail): void {
		this.optimisticallyUpdateFileStaged(detail.path, true);
		this._pendingStagingOp = this.runStagingOp(this.services.repository.stageFile(detail));
	}

	openConflictChanges(detail: FileChangeListItemDetail, side: 'current' | 'incoming'): void {
		void this.services.repository.openConflictChanges(detail, side);
	}

	resolveAllConflicts(repoPath: string | undefined, resolution: 'current' | 'incoming'): void {
		if (!repoPath) return;
		this._pendingStagingOp = this.runStagingOp(this.services.repository.resolveAllConflicts(repoPath, resolution));
	}

	unstageFile(detail: FileChangeListItemDetail): void {
		this.optimisticallyUpdateFileStaged(detail.path, false);
		this._pendingStagingOp = this.runStagingOp(this.services.repository.unstageFile(detail));
	}

	stageAll(repoPath: string | undefined): void {
		if (!repoPath) return;
		this.optimisticallyUpdateAllFilesStaged(true);
		this._pendingStagingOp = this.runStagingOp(this.services.repository.stageAll(repoPath));
	}

	unstageAll(repoPath: string | undefined): void {
		if (!repoPath) return;
		this.optimisticallyUpdateAllFilesStaged(false);
		this._pendingStagingOp = this.runStagingOp(this.services.repository.unstageAll(repoPath));
	}

	/**
	 * After a stage/unstage RPC completes, force a WIP re-fetch from the host. The host's
	 * `notifyDidChangeWorkingTree` deduplicates by added/deleted/modified counts, so a pure
	 * staging change (same counts, different sides) gets dropped — the panel would keep showing
	 * stale duplicate entries for a mixed file until something else perturbs the watcher.
	 */
	private async runStagingOp(op: Promise<void>): Promise<void> {
		try {
			await op;
		} finally {
			const wipRepoPath = this.state.wip.get()?.repo?.path;
			if (wipRepoPath != null) {
				void this.refetchWipQuiet(wipRepoPath);
			}
		}
	}

	/**
	 * Re-fetch the WIP file list without clearing enrichment (autolinks, issues, merge target,
	 * etc.). The new payload's data replaces the old in-place — no transient empty state, no
	 * flicker of the merge-target badge or autolink chips. Used by the staging-op path and by
	 * the orchestrator's workingTreeStats-change handler — anywhere the file list may have
	 * shifted but the surrounding enrichment is still valid.
	 */
	async refetchWipQuiet(repoPath: string): Promise<void> {
		// Bypass the fetch dedup so we always re-query.
		this._lastFetchedKey = undefined;
		await this.resources.wip.fetch(repoPath);
		if (this.resources.wip.status.get() !== 'success') return;
		const wip = this.resources.wip.value.get();
		if (wip == null) return;
		// Replace WIP + only re-fire branch enrichment if the branch identity actually changed.
		const prev = this.state.wip.get();
		this.state.wip.set(wip);
		const branchName = wip.branch?.name;
		if (branchName != null && prev?.branch?.name !== branchName) {
			this.fetchWipBranchEnrichment(repoPath, branchName, this.resetEnrichment());
		}
	}

	private optimisticallyUpdateFileStaged(filePath: string, newStaged: boolean): void {
		const wip = this.state.wip.get();
		if (!wip?.changes?.files) return;

		// Direction-aware: only mutate the entry currently on the OPPOSITE side of `newStaged`.
		// For a mixed file (path appears twice — once staged, once unstaged), this collapses to
		// the correct single entry instead of flipping both, which would briefly show fully
		// staged/unstaged then flicker back to mixed when the next status fetch returns.
		const priorStaged = !newStaged;
		let changed = false;
		const nextFiles = wip.changes.files.map(f => {
			if (f.path !== filePath || f.staged !== priorStaged) return f;
			changed = true;
			return { ...f, staged: newStaged };
		});
		if (!changed) return;

		this.state.wip.set({ ...wip, changes: { ...wip.changes, files: nextFiles } });
	}

	private optimisticallyUpdateAllFilesStaged(staged: boolean): void {
		const wip = this.state.wip.get();
		if (!wip?.changes?.files) return;

		let changed = false;
		const nextFiles = wip.changes.files.map(f => {
			if (f.staged === staged) return f;
			changed = true;
			return { ...f, staged: staged };
		});
		if (!changed) return;

		this.state.wip.set({ ...wip, changes: { ...wip.changes, files: nextFiles } });
	}

	canCommit(): boolean {
		const message = this.state.commitMessage.get();
		const isAmend = this.state.amend.get();
		const wip = this.state.wip.get();
		const prefs = this.state.preferences.get();
		const hasStagedFiles = wip?.changes?.files?.some(f => f.staged) ?? false;
		const smartCommit = prefs?.enableSmartCommit ?? false;
		const hasChanges = (wip?.changes?.files?.length ?? 0) > 0;
		return (Boolean(message.trim()) && (hasStagedFiles || (smartCommit && hasChanges))) || isAmend;
	}

	async commit(repoPath: string | undefined, sha: string | undefined): Promise<void> {
		if (!repoPath || !this.canCommit()) return;

		const message = this.state.commitMessage.get();
		const isAmend = this.state.amend.get();
		const wip = this.state.wip.get();
		const hasStagedFiles = wip?.changes?.files?.some(f => f.staged) ?? false;
		const smartCommit = this.state.preferences.get()?.enableSmartCommit ?? false;

		// Wait for any in-flight staging operations
		if (this._pendingStagingOp != null) {
			await this._pendingStagingOp;
			this._pendingStagingOp = undefined;
		}

		const all = !hasStagedFiles && smartCommit;

		try {
			await this.services.repository.commit(repoPath, message, { amend: isAmend, all: all });
			this.state.commitMessage.set('');
			this.state.commitMessageDirty.set(false);
			this.state.amend.set(false);
			this.state.amendBaseSha.set(undefined);
			this.state.commitError.set(undefined);
			this.refreshWip();
			void this.fetchDetails(sha, repoPath);
		} catch (ex) {
			this.state.commitError.set(ex instanceof Error ? ex.message : 'Commit failed');
		}
	}

	async generateMessage(repoPath: string | undefined): Promise<void> {
		if (!repoPath) return;

		this.state.generating.set(true);
		try {
			const result = await this.services.graphInspect.generateCommitMessage(repoPath);
			if (result) {
				this.state.commitMessage.set(result.body ? `${result.summary}\n\n${result.body}` : result.summary);
				// AI output is the user's intentional generation against the current diff —
				// treat as user-authored so HEAD-move auto-clear preserves it.
				this.state.commitMessageDirty.set(true);
			}
		} finally {
			this.state.generating.set(false);
		}
	}

	async loadLastCommitMessage(repoPath: string | undefined): Promise<void> {
		// Skip entirely unless we'd actually use the result: amend must be on AND the box must
		// be empty. The caller already checks both, but keeping the guard here means new
		// callers can't accidentally clobber the user's work.
		if (!repoPath || !this.state.amend.get() || this.state.commitMessage.get() !== '') return;

		const message = await this.services.repository.getLastCommitMessage(repoPath);
		if (!message) return;
		// Re-check post-await: the user could have toggled amend off, or typed in the box,
		// while the RPC was in flight. Only land the message into a still-empty box with
		// amend still on. Leave `commitMessageDirty` false — this snapshot of HEAD's message
		// is exactly what the HEAD-move auto-clear in `gl-graph-details-panel.ts` needs to be
		// able to drop when HEAD moves.
		if (this.state.amend.get() && this.state.commitMessage.get() === '') {
			this.state.commitMessage.set(message);
		}
	}

	switchBranch(repoPath: string | undefined): void {
		if (!repoPath) return;
		void this.services.repository.switchBranch(repoPath);
	}

	createBranch(repoPath: string | undefined): void {
		if (!repoPath) return;
		void this.services.repository.createBranch(repoPath);
	}

	stashSave(repoPath: string | undefined): void {
		if (!repoPath) return;
		void this.services.commands.execute('gitlens.stashSave', { repoPath: repoPath });
	}

	applyStash(repoPath: string | undefined): void {
		if (!repoPath) return;
		void this.services.commands.execute('gitlens.stashesApply', { repoPath: repoPath });
	}

	createWorktree(): void {
		void this.services.commands.execute('gitlens.views.createWorktree');
	}

	startWork(): void {
		void this.services.commands.execute('gitlens.startWork', { source: 'graph-details' as const });
	}

	openOnRemote(repoPath: string | undefined, sha: string): void {
		if (!repoPath) return;
		void this.services.commands.execute('gitlens.openOnRemote', {
			repoPath: repoPath,
			resource: { type: 'commit' satisfies `${RemoteResourceType.Commit}`, sha: sha },
		});
	}

	changeFilesLayout(layout: ViewFilesLayout): void {
		const prefs = this.state.preferences.get();
		if (!prefs?.files) return;

		const files = { ...prefs.files, layout: layout };
		this.state.preferences.set({ ...prefs, files: files });
		void this.services.config.update('views.commitDetails.files.layout', layout);
	}
}
