import type { Handler } from '@eamodio/supertalk';
import { SequencedChannel } from '@eamodio/supertalk-core/handlers/channel.js';
import type { emptySetMarker } from '@gitkraken/commit-graph-ui/scope/filtering.js';
import { changesModeOrDefault, isChangesColumnMode } from '@gitkraken/commit-graph/stats.js';
import { createWipRowId, getWipRowWorktreePath, isWipRowId } from '@gitkraken/commit-graph/wip/identity.js';
import type { ColumnMode } from '@gitkraken/commit-graph/zones.js';
import type { CancellationToken, ColorTheme, ConfigurationChangeEvent, TextDocumentShowOptions } from 'vscode';
import {
	CancellationTokenSource,
	commands,
	ConfigurationTarget,
	Disposable,
	Uri,
	ViewColumn,
	window,
	workspace,
} from 'vscode';
import { isWeb } from '@env/platform.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitGraph, GitGraphRow, GitGraphRowKind } from '@gitlens/git/models/graph.js';
import type { GitGraphSessionChangedChannels } from '@gitlens/git/models/graphSession.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import type { GitReference, GitRevisionReference, GitStashReference } from '@gitlens/git/models/reference.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import { getLocalBranchByUpstream } from '@gitlens/git/utils/branch.utils.js';
import { getLastFetchedUpdateInterval } from '@gitlens/git/utils/fetch.utils.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import { serializePullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isSha, isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import type { IntegrationIds, IssuesCloudHostIntegrationId } from '@gitlens/integrations/constants.js';
import { supportedOrderedCloudIssuesIntegrationIds } from '@gitlens/integrations/constants.js';
import type { ConnectionStateChangeEvent } from '@gitlens/integrations/index.js';
import {
	isGitCloudHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
} from '@gitlens/integrations/utils/integration.utils.js';
import { ensureArray, filterMap } from '@gitlens/utils/array.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { CoalescedRun } from '@gitlens/utils/coalescedRun.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { DedupedAsyncCache } from '@gitlens/utils/dedupedAsyncCache.js';
import { disposableInterval } from '@gitlens/utils/disposable.js';
import { getBranchId, getBranchNameWithoutRemote } from '@gitlens/utils/gitRefs.js';
import { find } from '@gitlens/utils/iterable.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { filterMap as filterMapObject, flatten, hasKeys, updateRecordValue } from '@gitlens/utils/object.js';
import { normalizePath } from '@gitlens/utils/path.js';
import {
	getSettledValue,
	pauseOnCancelOrTimeout,
	pauseOnCancelOrTimeoutMapTuplePromise,
	wait,
} from '@gitlens/utils/promise.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import { satisfies } from '@gitlens/utils/version.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import { isActiveAgentPhase } from '../../../agents/provider.js';
import { fetchAvatarImageAsDataUri, getAvatarUri } from '../../../avatars.js';
import { parseCommandContext } from '../../../commands/commandContext.utils.js';
import type { OpenIssueOnRemoteCommandArgs } from '../../../commands/openIssueOnRemote.js';
import type { RunTaskOnWorktreeCommandArgs } from '../../../commands/runTaskOnWorktree.js';
import type {
	GraphBranchesVisibility,
	GraphMinimapMarkersAdditionalTypes,
	GraphScrollMarkersAdditionalTypes,
} from '../../../config.js';
import type { GlCommands } from '../../../constants.commands.js';
import type {
	StoredGraphColumn,
	StoredGraphExcludedRef,
	StoredGraphFilters,
	StoredGraphRefType,
	StoredGraphState,
	StoredGraphWipDraft,
	StoredGraphWorktreePerspective,
} from '../../../constants.storage.js';
import type {
	GraphShownTelemetryContext,
	GraphTelemetryContext,
	Source,
	WebviewTelemetryEvents,
} from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import { FeatureFlagKey, setFeatureFlagTelemetryGlobalAttributes } from '../../../featureFlags/featureFlagService.js';
import type { FeaturePreview } from '../../../features.js';
import { getFeaturePreviewStatus } from '../../../features.js';
import { openCommitChanges, openCommitChangesWithWorking, undoCommit } from '../../../git/actions/commit.js';
import { onDidChangeContinuingPausedOperation } from '../../../git/actions/pausedOperation.js';
import * as RepoActions from '../../../git/actions/repository.js';
import * as StashActions from '../../../git/actions/stash.js';
import { CommitFormatter } from '../../../git/formatters/commitFormatter.js';
import { GlGraphRowProcessor } from '../../../git/graphRowProcessor.js';
import type { RepositoryChangeEvent, RepositoryWorkingTreeChangeEvent } from '../../../git/models/repository.js';
import { GlRepository } from '../../../git/models/repository.js';
import { isSameRepoFamily } from '../../../git/models/repositoryShape.js';
import {
	getBranchAssociatedPullRequest,
	getBranchMergeTargetInfo,
	getBranchRemote,
} from '../../../git/utils/-webview/branch.utils.js';
import {
	getCommitAssociatedPullRequest,
	getCommitEnrichedAutolinks,
	isCommitSigned,
} from '../../../git/utils/-webview/commit.utils.js';
import { stageConflictResolution } from '../../../git/utils/-webview/conflictResolution.utils.js';
import { getRemoteProviderUrl, remoteSupportsIntegration } from '../../../git/utils/-webview/remote.utils.js';
import { sortRepositories } from '../../../git/utils/-webview/sorting.js';
import { getSiblingWorktreeBranches, getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { getFeedbackIssueUrl } from '../../../plus/gk/feedbackService.js';
import type { FeaturePreviewChangeEvent, SubscriptionChangeEvent } from '../../../plus/gk/subscriptionService.js';
import {
	isAccountAccessRequired,
	isSubscriptionTrialOrPaidFromState,
} from '../../../plus/gk/utils/subscription.utils.js';
import {
	confirmPullRequestMerge,
	mergePullRequestWithProgress,
} from '../../../plus/integrations/utils/-webview/pullRequest.merge.utils.js';
import { showComparisonPicker } from '../../../quickpicks/comparisonPicker.js';
import { showContributorsPicker } from '../../../quickpicks/contributorsPicker.js';
import type { ReferencesQuickPickOptions2 } from '../../../quickpicks/referencePicker.js';
import { showReferencePicker2 } from '../../../quickpicks/referencePicker.js';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker } from '../../../quickpicks/repositoryPicker.js';
import { cancelAndDispose, toAbortSignal } from '../../../system/-webview/cancellation.js';
import { executeCommand, executeCoreCommand, registerCommand } from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { onDidChangeContext, setContext } from '../../../system/-webview/context.js';
import { isFolderUri } from '../../../system/-webview/path.js';
import type { StorageChangeEvent } from '../../../system/-webview/storage.js';
import { isDarkTheme, isLightTheme } from '../../../system/-webview/vscode.js';
import { openUrl } from '../../../system/-webview/vscode/uris.js';
import { getWebviewCommand } from '../../../system/decorators/command.js';
import { gate } from '../../../system/decorators/gate.js';
import { serializeWebviewItemContext } from '../../../system/webview.js';
import { RepositoryFolderNode } from '../../../views/nodes/abstract/repositoryFolderNode.js';
import {
	getFileCommitFromContext,
	isDetailsFileContext,
	isDetailsFolderContext,
	resolveMultiFileContext,
} from '../../commitDetails/commitDetailsWebview.utils.js';
import {
	DetailsFileCommands,
	getDetailsFileCommands,
	getDetailsFileMultiCommands,
} from '../../commitDetails/detailsFileCommands.js';
import {
	DetailsFolderCommands,
	getDetailsFolderCommands,
	sharedDetailsFolderCommandRoutes,
} from '../../commitDetails/detailsFolderCommands.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../../rpc/eventVisibilityBuffer.js';
import { createRpcEvent } from '../../rpc/eventVisibilityBuffer.js';
import { LaunchpadService } from '../../rpc/launchpadService.js';
import { createSharedServices } from '../../rpc/services/common.js';
import { proxyServices } from '../../rpc/services/proxy.js';
import { WalkthroughService } from '../../rpc/walkthroughService.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider.js';
import type { WebviewPanelShowCommandArgs, WebviewShowOptions } from '../../webviewsController.js';
import { isSerializedState } from '../../webviewsController.js';
import type { TimelineCommandArgs } from '../timeline/registration.js';
import { checkForAbandonedComposeStashes } from './compose/utils.js';
import type { DetailsItemContext, DetailsItemTypedContext, Wip } from './detailsProtocol.js';
import type { GraphCommandsContext } from './graphCommands.js';
import { getGraphCommands, GraphCommands } from './graphCommands.js';
import type { GraphDataControllerContext } from './graphDataController.js';
import { GraphDataController } from './graphDataController.js';
import type { GraphInspectServicesContext } from './graphInspectServices.js';
import { GraphInspectServices } from './graphInspectServices.js';
import type { GraphPanelsServiceContext } from './graphPanelsService.js';
import { GraphPanelsService } from './graphPanelsService.js';
import type { GraphProducersServiceContext } from './graphProducersService.js';
import { GraphProducersService } from './graphProducersService.js';
import type { GraphSearchServiceContext } from './graphSearchService.js';
import { GraphSearchService } from './graphSearchService.js';
import type {
	DidRequestShowFeedbackParams,
	GraphAccessState,
	GraphColumnsState,
	GraphFeedbackInput,
	GraphFeedbackResult,
	GraphFiltersState,
	GraphRepoStatus,
	GraphServices,
	GraphWorkingTreeChange,
	GraphWorktreeEnrichment,
} from './graphService.js';
import { isSidebarOriginContext, resolveSidebarContextMenuAction } from './graphSidebarActionTelemetry.js';
import { GraphSyncPublisher } from './graphSyncPublisher.js';
import type { GraphSyncDataSource, GraphSyncHost } from './graphSyncPublisher.js';
import {
	activityDecayToMs,
	createDefaultLayoutSnapshot,
	defaultGraphColumnsSettings,
	formatRepositories,
	getDefaultLayoutSeeds,
	getExcludedRefName,
	hasGitReference,
	isGraphItemRefContext,
	isGraphItemTypedContext,
	restampFilterRefId,
} from './graphWebview.utils.js';
import type { GraphWipServiceContext } from './graphWipService.js';
import { GraphWipService } from './graphWipService.js';
import type {
	BranchState,
	DidChangeBranchStateParams,
	DidChangeParams,
	DidChangeRepoConnectionParams,
	DidChooseAuthorParams,
	DidChooseComparisonParams,
	DidChooseFileParams,
	DidChooseRefParams,
	DidFailRevealParams,
	DidGetRowHoverParams,
	DidGetSidebarDataParams,
	DidRebindGraphParams,
	DidRequestActiveSidebarPanelParams,
	DidRequestGraphActionParams,
	DidRequestOpenCompareModeParams,
	DidRequestOpenTimelineScopeParams,
	DidRequestSearchParams,
	DidRequestVisualizationParams,
	DidResolveGraphScopeParams,
	GetWipLineStatsResponse,
	GetWipStatsResponse,
	GraphActionTarget,
	GraphAutoFetchMode,
	GraphAvatars,
	GraphColumnConfig,
	GraphColumnModeFor,
	GraphColumnName,
	GraphColumnsConfig,
	GraphColumnSetting,
	GraphColumnsSettings,
	GraphCompareSeed,
	GraphComponentConfig,
	GraphComposeScopeSeed,
	GraphDisplayMode,
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphIncludeOnlyRef,
	GraphIncludeOnlyRefs,
	GraphItemContext,
	GraphMinimapMarkerTypes,
	GraphPinnedRef,
	GraphRef,
	GraphRefMetadataItem,
	GraphRefOptData,
	GraphRefsMetadata,
	GraphRefType,
	GraphRepository,
	GraphRowsPayload,
	GraphScope,
	GraphScopeBranch,
	GraphScopeOrigin,
	GraphScrollMarkerTypes,
	GraphSearchMode,
	GraphSelectedRows,
	GraphSelection,
	GraphShowAction,
	GraphSidebarPanel,
	MergePullRequestParams,
	MergePullRequestResult,
	RowActionParams,
	SidebarWorktreeChange,
	State,
	VisualizationMode,
} from './protocol.js';
import type { GraphWebviewShowingArgs } from './registration.js';

export interface SelectedRowState {
	selected: boolean;
	hidden?: boolean;
}

/** Host-side shape returned by the scope-anchor resolver. `focalBranchTipSha` is set whenever
 *  the focal branch has a resolvable tip (almost always); `mergeBase` / `mergeTargetTipSha` are
 *  only set when a merge target resolves to a tip (its own upstream counts — see
 *  `computeScopeAnchor`). */
interface ResolvedScopeAnchor {
	focalBranchTipSha?: string;
	mergeBase?: { sha: string; date: number };
	mergeTargetTipSha?: string;
	/** Merge-target branch name (e.g. `main`), paired with `mergeTargetTipSha`. Set whenever a real
	 *  merge target is resolved — lets row-marker label the target tip without a second lookup. */
	mergeTargetName?: string;
}

function hasRepository(arg: any): arg is { repository: GlRepository; search?: SearchQuery; selectSha?: string } {
	return arg?.repository != null;
}

function hasSearchQuery(arg: any): arg is { repository: GlRepository; search: SearchQuery; selectSha?: string } {
	return hasRepository(arg) && arg.search != null;
}

function hasCompare(arg: any): arg is { repository: GlRepository; compare: GraphCompareSeed; source?: Source } {
	return arg?.compare != null && arg?.repository != null;
}

function hasSidebarPanel(arg: any): arg is { sidebarPanel: GraphSidebarPanel } {
	return typeof arg?.sidebarPanel === 'string';
}

function hasFeedback(arg: any): arg is { feedback: true; source?: Source } {
	return arg?.feedback === true;
}

function hasVisualization(
	arg: any,
): arg is { visualization: VisualizationMode; repository?: GlRepository; source?: Source } {
	return typeof arg?.visualization === 'string';
}

function hasAction(arg: any): arg is {
	action: GraphShowAction;
	target?: GraphActionTarget;
	source?: Source;
	composeInstructions?: string;
	composeScope?: GraphComposeScopeSeed;
	agentSessionId?: string;
	revealOnly?: boolean;
	followed?: boolean;
	scopeBranch?: GraphScopeBranch;
	scopeOrigin?: GraphScopeOrigin;
} {
	return typeof arg?.action === 'string';
}

/** Maps the merge sheet's IPC literal onto the integration's enum. */
const mergeMethodsByName: Record<NonNullable<MergePullRequestParams['mergeMethod']>, PullRequestMergeMethod> = {
	merge: PullRequestMergeMethod.Merge,
	squash: PullRequestMergeMethod.Squash,
	rebase: PullRequestMergeMethod.Rebase,
};

type CancellableOperations =
	| 'branchState'
	| 'branchStateOnly'
	| 'hover'
	| 'computeIncludedRefs'
	| 'rebind'
	| 'state'
	| 'workingTree';

/** A/B (intro-video): latched on the first gated render, at module scope — a per-provider latch
 *  could show one user both arms (the panel and the sidebar each construct a provider).
 *  `unassigned` = no cohort: rendered as the default gate but kept out of both funnel arms. */
let signInGateVariant: 'default' | 'intro-video' | 'unassigned' | undefined;

/** Debug-only (see `__debug__signInGateDebug.ts`): forces the latch so the gate renders the given
 *  variant on the next (re)load; `undefined` re-resolves the real flag on the next bootstrap.
 *  Never persists or re-stamps telemetry — that happens only when the real flag resolves. */
export function setSignInGateVariantOverride(variant: 'default' | 'intro-video' | undefined): void {
	signInGateVariant = variant;
}

export class GraphWebviewProvider implements WebviewProvider<State, State, GraphWebviewShowingArgs> {
	private _repository?: GlRepository;
	private get repository(): GlRepository | undefined {
		return this._repository;
	}
	private set repository(value: GlRepository | undefined) {
		if (this._repository === value) {
			this.ensureRepositorySubscriptions();
			return;
		}

		// `resetRepositoryState` runs after `_repository` is reassigned, so its `invalidateScopeAnchors`
		// call fires for the new repoPath. The app sweeps every cached anchor on any invalidation
		// regardless of `repoPath` (see `GraphScopeService.onScopeAnchorsInvalidated`), so this is
		// belt-and-suspenders against a future consumer that scopes its sweep — fire for the previous
		// path too so the webview's cache can't strand entries keyed to it.
		const previous = this._repository;
		const previousPath = previous?.path;
		this._repository = value;
		// A CROSS-family switch ends any rebind — `_rebindHome` only makes sense relative to the binding it
		// was recorded against. Left set, filters would keep writing into the OLD home's
		// `graph:filtersByRepo` key, and `rebindRepository(undefined)` would rebind the new repo's session
		// onto the old home's path.
		//
		// A SAME-family switch (the repo picker landing directly on a sibling worktree, bypassing
		// `rebindRepository`) leaves `_rebindHome` untouched unless the pick IS home — it still names the
		// true family home, and clearing it would make the newly-selected worktree masquerade as home.
		const previousRebindHome = this._rebindHome;
		const sameFamily = previous != null && value != null && isSameRepoFamily(previous, value);
		if (!sameFamily) {
			this._rebindHome = undefined;
		} else if (value === this._rebindHome) {
			// Landed back on home — no longer rebound.
			this._rebindHome = undefined;
		}

		void this.syncPersistedPerspective(previousRebindHome);
		// An outright binding change supersedes any rebind still walking; without this the walk runs to
		// completion only to be discarded by `rebindRepositoryCore`'s post-walk identity check, holding the
		// graph busy for the user's switch. The cancelled call's `catch` can't clobber the assignment
		// above: it restores only when `this._repository` is still ITS target.
		this.cancelOperation('rebind');
		// Clear per-repo state that survived `resetRepositoryState` historically — `_selection` (last
		// clicked commit ref) and `_searchRequest` (queued search-from-show) both stored repoPath
		// implicitly. Done here in the setter — not in `resetRepositoryState`, which also runs on
		// force-refresh and should preserve them.
		this._selection = undefined;
		this._searchRequest = undefined;
		// Clear the auto-fetch attempt floor so the new repo gets a fresh schedule rather than
		// inheriting a recent attempt timestamp from the previous repo.
		this._lastAutoFetchAttemptAt = undefined;
		this.resetRepositoryState();
		this.ensureRepositorySubscriptions(true);
		void this.ensureAutoFetch();

		// Sidebar `Resource<T>` caches are panel-keyed, not repo-keyed — without a bump, the previous
		// repo's data stays visible until the next sidebar-relevant repo event.
		this._sidebarEventCounter.next();

		if (previousPath != null && previousPath !== value?.path) {
			this._scopeAnchorsInvalidatedEvent.fire({ repoPath: previousPath });
		}

		if (this.host.ready) {
			this._data.updateState();
		}
	}

	/** Set only by {@link rebindRepository}: the repo `this._repository` was bound to before the FIRST
	 *  rebind away from it — the family home to restore on an unscope. `undefined` means "no home to
	 *  restore". NOT the same as "the graph is bound to home": a SAME-family picker switch straight from a
	 *  worktree to home leaves this set while `this.repository` already IS home, which is harmless.
	 *  Rebinding back to home clears it; worktree→worktree leaves it untouched. Also cleared when the home
	 *  repo is removed while rebound, or on a cross-family switch through the `repository` setter, so the
	 *  current binding becomes permanent rather than dangling. */
	private _rebindHome?: GlRepository;

	private _selection: readonly GitRevisionReference[] | undefined;
	private get activeSelection(): GitRevisionReference | undefined {
		return this._selection?.[0];
	}

	private _cancellations = new Map<CancellableOperations, CancellationTokenSource>();
	/** In-flight `wip.getStats` batches. Unkeyed (see `onGetWipStats`) — batches must not cancel each
	 *  other, including when they overlap on a sha: ordering for those is settled per-sha on the client
	 *  (`claimWipStatsRequest`), not by killing a sibling. This exists only so dispose can cancel them all. */
	private readonly _wipStatsCancellations = new Set<CancellationTokenSource>();
	private _discovering: Promise<number | undefined> | undefined;
	private readonly _disposable: Disposable;
	private _etag?: number;
	private _etagSubscription?: number;
	private _etagRepository?: number;
	private _getBranchesAndTagsTips:
		| ((sha: string, options?: { compact?: boolean; icons?: boolean }) => string | undefined)
		| undefined;
	/** Tip shas of the current `includeOnlyRefs` set, newest-first by commit date (undated branches sort
	 *  last), de-duped. Kept apart from the wire-format refs map because {@link GraphIncludeOnlyRef}
	 *  carries no sha, and the data controller needs a concrete paging target — the next unloaded included
	 *  ref's tip — to steer a branches-visibility page toward. `undefined` means "no restriction" (`all`
	 *  visibility, or no repo/graph yet); `[]` means "restricted to nothing" (the empty-set-marker cases). */
	private _includedRefTipShas: string[] | undefined;
	// The graph session/window, loading promise, and restart-persistence store now live on `_data`
	// (GraphDataController); the provider reaches them via `this._data.session` / `.loading` / `.store`.
	// The load shape (ordering + stats inclusion) the session was built with — getState reuses the
	// loaded graph (reads `session.current` without a refresh) only when this AND the repo etag are unchanged.
	private _lastGraphLoadKey?: string;
	/**
	 * One-shot latch: the next getState must FULLY rebuild rows (skip both the graph-reuse gate and the
	 * incremental fast path) because a host-known input baked into row contexts changed without any repo
	 * change the session could observe — pinned ref (`+pinned` menu gating), integration connections
	 * (provider avatars). Consumed by the rebuild; rare events, so one full walk is acceptable.
	 */
	private _pendingContextsRebuild = false;
	private _graphRowProcessor?: GlGraphRowProcessor;
	/** Mirrors the webview's `displayMode` (session-only); Visualizations mode needs row stats. */
	private _displayMode: GraphDisplayMode = 'graph';
	private _hoverCache = new Map<string, Promise<string>>();
	// True while the webview shows only the account-access screen (signed out or unverified). In that
	// state `getState` skips the entire graph data pipeline, so the graph must be reloaded once the
	// account becomes usable — see `onSubscriptionChanged`.
	private _accountAccessRequired = false;
	/** True while the last rows walk's failure still stands — mirrors what the webview holds, so the
	 *  `save-last` slot can never replay a stale wedge over a graph that has since loaded. */
	private _rowsFailed = false;
	/** Git etag as of the BOOTSTRAP `getState` build — the state baked into the webview's HTML. Every
	 *  (re)booting client starts from that frozen snapshot: the first boot (where a build before repo
	 *  discovery completes bakes a no-repository State, and the `stateChanged` push discovery triggers
	 *  fires into a still-booting client's empty handler map, lost), an in-place iframe reload, and an
	 *  element remount (the app re-reads its cached one-shot bootstrap) all regress to it. Compared
	 *  against the live etag when the state service (re-)subscribes, so a client whose world moved past
	 *  its bootstrap gets a fresh build instead of wedging on "No repository open". Deliberately NOT
	 *  advanced by later push builds — those reached the PREVIOUS boot's handlers, not the one
	 *  subscribing now. */
	private _etagAtBootstrapBuild: number | undefined;
	/** State builds since the bootstrap build — the other staleness signal the etag can't see: a
	 *  bootstrap can be stale for non-git reasons (built account-gated before the subscription
	 *  landed, mid-discovery, etc.) and converged by a later push a reloaded client then loses.
	 *  Any build after the bootstrap means a (re-)subscribing client may hold older state than the
	 *  host last shipped, so the subscribe wrapper catches it up. */
	private _stateBuildsSinceBootstrap = 0;

	// Set instead of building the (expensive) full-state / branch-state-only payload while hidden or not
	// ready — building it would cost real work for a webview that can't receive it. Consumed on the next
	// visibility-restore (`onVisibilityChanged`), which RE-PRODUCES fresh data rather than replaying
	// anything: the RPC events' visibility buffer only replays what was actually produced, so an expensive
	// plane defers production itself instead of relying on that buffer.
	private _pendingStateRefresh = false;
	private _pendingBranchStateRefresh = false;
	private _defaultLayoutSeeded = false;
	private _selectedId?: string;
	private _selectedRows: Record<string, SelectedRowState> | undefined;
	private _theme: ColorTheme | undefined;
	private _repositoryEventsDisposable: Disposable | undefined;
	private _lastFetchedDisposable: Disposable | undefined;
	private _treemapInvalidateSubscription: Disposable | undefined;
	private _agentStatusSubscriptions: Disposable[] | undefined;

	// The state-notify coalescer (pending notify/op, last-sent watermark, freshness retry timer, dirty flag)
	// now lives on `_data` (GraphDataController); the provider drives it via `_data.resetStateNotify()`,
	// `_data.clearStateFreshnessRetryTimer()`, and `_data.trackBootstrapStateOp()`.
	/**
	 * Counter of sidebar-relevant repo events. `notifyDidChangeState` fires `notifySidebarInvalidated()`
	 * post-rebuild when `_firedSidebarEventSeq` lags the captured value. A counter (vs a boolean)
	 * preserves a delta when a second event lands mid-rebuild, so the trailing run still fires against
	 * a graph that reflects it.
	 */
	private _sidebarEventCounter = getScopedCounter();
	/** Watermark: counter values up to here have already fired their post-rebuild invalidation. */
	private _firedSidebarEventSeq = 0;

	// The rows plane's transport: a Supertalk SequencedChannel over the SAME RPC connection every other
	// graph service uses, so a rows emission and the RPC call that follows it are FIFO-ordered against each
	// other. `replay: 0` is deliberate — recovery here is the DOMAIN resync (a fresh snapshot), never a
	// historical replay, so every gap must reach `onGap` instead of being papered over with stale deltas.
	// Registered on both the initial and reconnect connections via `getRpcHandlers`; per-provider, so two
	// graph webviews get two independent channels.
	private readonly _rowsChannel = new SequencedChannel<GraphRowsPayload>('graph:rows', { replay: 0 });

	// Single writer for the rows-plane channels (rows/reachability/rowsStats/downstreams). Owns the
	// delivery cursors; ordering, gap detection, and generations belong to `_rowsChannel`.
	private readonly _graphSync: GraphSyncPublisher;

	// The eager Visualizations "stats loading" override now lives on `_data` (GraphDataController); the
	// provider flips it via `this._data.rowsStatsLoadingOverride` and the publisher reads it there.

	private isWindowFocused: boolean = true;

	private _autoFetchTimer: ReturnType<typeof setTimeout> | undefined;
	private _autoFetchInFlight: boolean = false;
	// Wall-clock timestamp of the last auto-fetch attempt (success or failure). Used as a floor
	// for the next-schedule calculation so a persistently failing fetch (no network, etc.) does
	// not hot-loop: `lastFetched` only advances on success, so without this a failed attempt
	// would compute elapsed ≥ interval again immediately.
	private _lastAutoFetchAttemptAt: number | undefined;
	// Safety floor for the auto-fetch interval (seconds) when GitLens drives the loop. The
	// user-facing source is `git.autofetchPeriod`; we clamp here so that a pathological value
	// (e.g. 1) can't turn into a fetch storm.
	private static readonly autoFetchMinSeconds = 60;

	// Idle window for the `agents` branches-visibility scope. Sessions whose last activity
	// is within this window (or whose status is not `idle`) qualify their worktree's branch
	// for inclusion in the graph.
	private static readonly agentBranchesIdleThresholdMs = 24 * 60 * 60 * 1000;

	private get graphRowProcessor(): GlGraphRowProcessor {
		// No pinned-ref callback: the row processor doesn't serialize ref contexts, so which ref is pinned is
		// not the host's business for graph rows — the webview reads it live when it builds the menu.
		// `getFiltersByRepo(...).pinnedRef` is consumed elsewhere (panels, WIP).
		return (this._graphRowProcessor ??= new GlGraphRowProcessor(this.container, uri =>
			this.host.asWebviewUri(uri),
		));
	}

	private readonly _commands: GraphCommands;
	private readonly _wip: GraphWipService;
	private readonly _producers: GraphProducersService;
	private readonly _data: GraphDataController;
	private readonly _panels: GraphPanelsService;
	private readonly _inspect: GraphInspectServices;
	private readonly _searchService: GraphSearchService;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>,
	) {
		this._theme = window.activeColorTheme;
		this._graphSync = new GraphSyncPublisher(this.createGraphSyncHost(), this.createGraphSyncDataSource());
		this._commands = new GraphCommands(this.createGraphCommandsContext());
		this._wip = new GraphWipService(this.createGraphWipContext());
		this._producers = new GraphProducersService(this.createGraphProducersContext());
		this._data = new GraphDataController(this.createGraphDataContext());
		this._panels = new GraphPanelsService(this.createGraphPanelsContext());
		this._inspect = new GraphInspectServices(this.createGraphInspectContext());
		this._searchService = new GraphSearchService(this.createGraphSearchContext());
		this.ensureRepositorySubscriptions();

		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			workspace.onDidChangeConfiguration(this.onWorkspaceConfigurationChanged, this),
			this.container.storage.onDidChange(this.onStorageChanged, this),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			// Bridge the host-side health signal onto the RPC event, carrying the repo path so the
			// view can filter to the one it's showing instead of re-fetching on every repo's change.
			this.container.gitHealth.onDidChange(repoPath => this._gitHealthChangedEvent.fire({ repoPath: repoPath })),
			this.container.subscription.onDidChangeFeaturePreview(this.onFeaturePreviewChanged, this),
			// The bar's primary continue swaps between automatic/manual with the session
			this.container.autoRebase.onDidChange(e => {
				if (e.repoPath === this.repository?.path) {
					void this._wip.notifyDidChangeWorkingTree();
				}
			}),
			// A continue can block indefinitely on git's commit-message tab, so the bar's busy state comes
			// from here rather than a timer that could only guess when the command ended
			onDidChangeContinuingPausedOperation(repoPath => {
				// The event carries the repo path in `getRepositoryKey` form, so key ours too rather
				// than relying on `repository.path` already being in that form
				if (this.repository != null && repoPath === getRepositoryKey(this.repository.path)) {
					void this._wip.notifyDidChangeWorkingTree();
				}
			}),
			this.container.git.onDidChangeRepositories(async e => {
				if (this._etag !== this.container.git.etag) {
					if (this._discovering != null) {
						this._etag = await this._discovering;
						if (this._etag === this.container.git.etag) return;
					}

					// Skip full state refresh when the change is irrelevant to the graph view. The primary
					// trigger we need to avoid is worktree discovery during scroll (which bombards the graph
					// with $1MB state re-sends). Worktrees share their primary repo's remotes/branches/stash/
					// tags — nothing in the graph's state depends on them being in `openRepositories` beyond
					// the repositories selector list, which is recomputed on the next legitimate state refresh.
					const added = e.added ?? [];
					const removed = e.removed ?? [];
					if (removed.length > 0) {
						this._wip.pruneWipDraftsForRemovedRepos(removed.map(r => r.path));

						const rebindHome = this._rebindHome;
						// The home repo was disposed/closed while rebound onto one of its worktrees — there's
						// nothing left to restore, so the current (worktree) binding becomes permanent instead
						// of dangling on a repo that no longer exists.
						if (rebindHome != null && removed.some(r => r.id === rebindHome.id)) {
							this._rebindHome = undefined;
							// Passing the removed home along keeps its entry identifiable, so a repo later
							// reopened at that path can't resurrect the dead scope.
							void this.syncPersistedPerspective(rebindHome);
						}

						// The worktree the graph is CURRENTLY rebound to was itself removed — every action would
						// fail against a missing cwd, so rebind back home rather than leave the graph on a dead
						// binding. Keyed on the PRE-clear `rebindHome` so the both-removed batch below is still
						// recognized as "we were rebound".
						if (
							rebindHome != null &&
							this._repository != null &&
							removed.some(r => r.id === this._repository!.id)
						) {
							if (this._rebindHome != null) {
								// The only fire-and-forget rebind caller — `rebindRepositoryCore` reports domain
								// refusals in its result but can still THROW (its outer body has no catch), which
								// would surface as an unhandled rejection with nobody awaiting it.
								void this.rebindRepository(undefined).catch((ex: unknown) =>
									Logger.error(ex, 'GraphWebviewProvider', 'rebindRepository'),
								);
							} else {
								// Home went in the SAME batch, so there's nothing to restore and no rebind to run.
								// Drop the dead binding; the setter's teardown lets the next `getState` pick a
								// live repository.
								this.repository = undefined;
							}
						}
					}
					if (removed.length === 0 && (added.length === 0 || added.every(r => r.isWorktree))) {
						this._etag = this.container.git.etag;
						return;
					}

					this._data.updateState();
				}
			}),
			window.onDidChangeActiveColorTheme(this.onThemeChanged, this),
			// Restricted Mode blocked repo discovery, so the graph was stuck on the untrusted empty state.
			// Force a fresh discovery now that git ops are permitted and rebuild directly — don't depend on
			// the onDidChangeRepositories path, which only rebuilds when discovery reports added (non-worktree)
			// repos. `discoverRepositories` dedups concurrent callers, so overlapping with the container's own
			// trust re-discovery is safe.
			workspace.onDidGrantWorkspaceTrust(() => {
				this.repository = undefined;
				void this.container.git
					.discoverRepositories(workspace.workspaceFolders ?? [], { force: true })
					.finally(() => this._data.updateState());
			}),
			// GitLens-initiated git ops fire this synchronously before their RPC returns to the
			// webview, so invalidating here makes the post-op revalidate see fresh `git status`
			// data instead of the entry the FS-watcher-driven invalidator (`runNotifyDidChangeWorkingTree`)
			// won't drop until its 250ms debounce expires.
			this.container.events.on('git:cache:reset', e => {
				if (e.data.types != null && !e.data.types.includes('status')) return;

				if (e.data.repoPath == null) {
					this._wip.clearStatusCache();
				} else {
					// `delete` (hard-evict) rather than `invalidate` (soft) — invalidate keeps an
					// in-flight pre-op `git status` promise alive and lets the post-op revalidate
					// join it, flashing stale data into the panel.
					this._wip.deleteStatusCache(e.data.repoPath);
				}
			}),
			{
				dispose: () => {
					if (this._repositoryEventsDisposable == null) return;

					this._repositoryEventsDisposable.dispose();
					this._repositoryEventsDisposable = undefined;
				},
			},
			// Forward treemap aggregator invalidations to the webview so it drops its cached
			// treemap data and re-requests on next mode/scope read. The subscription is gated
			// behind `graph.experimental.visualizations.enabled` so we avoid both lazy-constructing
			// the aggregator service and firing IPC notifications when the treemap will never mount.
			{
				dispose: () => {
					this._treemapInvalidateSubscription?.dispose();
					this._treemapInvalidateSubscription = undefined;
				},
			},
			this.container.integrations.onDidChangeConnectionState(this.onIntegrationConnectionChanged, this),
			{
				dispose: () => {
					this._agentStatusSubscriptions?.forEach(d => {
						d.dispose();
					});
					this._agentStatusSubscriptions = undefined;
				},
			},
			this.container.onDidChangeAgentStatus(() => this.subscribeToAgentStatus(), this),
		);

		this.subscribeToTreemapInvalidations();
		this.subscribeToAgentStatus();
	}

	// `container.agentStatus` is created/disposed asynchronously by the container as the org/AI gate
	// flips; a one-shot subscription would either latch a no-op (constructed before the service exists)
	// or go stale (service disposed and recreated). Resubscribe on the container's healing signal instead.
	private subscribeToAgentStatus(): void {
		this._agentStatusSubscriptions?.forEach(d => {
			d.dispose();
		});
		this._agentStatusSubscriptions = undefined;

		if (this.container.agentStatus != null) {
			// Sessions reach webviews via the shared AgentsService RPC events (which do their own
			// healing resubscribe) — this host-side subscription exists ONLY for the agents-scope
			// refs-visibility recompute.
			this._agentStatusSubscriptions = [
				this.container.agentStatus.onDidChangeSessions(this.onAgentSessionsChanged, this),
			];
		}
	}

	private subscribeToTreemapInvalidations(): void {
		this._treemapInvalidateSubscription?.dispose();
		this._treemapInvalidateSubscription = undefined;

		// Avoid even constructing the aggregator service (its getter is lazy) when the experimental
		// flag is off — and skip the IPC notify path entirely since the treemap will never mount.
		if (configuration.get('graph.experimental.visualizations.enabled') !== true) return;

		this._treemapInvalidateSubscription = this.container.treemapAggregator.onDidInvalidate(repoPath => {
			this._treemapInvalidatedEvent.fire({ repoPath: repoPath });
		});
	}

	// `save-last`: a superseded invalidation is stale relative to whatever refetch the newest one
	// triggers, so latest-wins is fine — matches the legacy notification's semantics, where a hidden
	// webview only ever saw the newest queued postMessage on reveal.
	private readonly _treemapInvalidatedEvent = createRpcEvent<{ repoPath: string }>('treemapInvalidated', 'save-last');

	/** Shared collaborator members most service contexts declare — spread into the factories whose
	 *  context type includes all of these. */
	private createBaseServiceContext() {
		return {
			container: this.container,
			host: this.host,
			getRepository: () => this.repository,
			getSession: () => this._data.session,
			fireBranchStateChanged: (params: DidChangeBranchStateParams) => this._branchStateChangedEvent.fire(params),
			deferBranchStateRefresh: () => (this._pendingBranchStateRefresh = true),
		};
	}

	/** Collaborator surface {@link GraphCommands} reaches for. `getRepository`/`getSession`/
	 *  `getActiveSelection` read live provider state (it changes over the webview's life); the rest
	 *  forward to provider methods that stay here — column/scroll config, WIP drafts, selection,
	 *  conflict staging, undo. */
	private createGraphCommandsContext(): GraphCommandsContext {
		return {
			container: this.container,
			getRepository: () => this.repository,
			getSession: () => this._data.session,
			getActiveSelection: () => this.activeSelection,
			getFiltersRepoPath: () => this.filtersRepoPath,
			toggleColumn: (name, visible) => this.toggleColumn(name, visible),
			toggleColumnGrouping: (name, grouped) => this.toggleColumnGrouping(name, grouped),
			toggleScrollMarker: (type, enabled) => this.toggleScrollMarker(type, enabled),
			setColumnMode: (name, mode) => this.setColumnMode(name, mode),
			saveAsDefaultLayout: () => this.saveAsDefaultLayout(),
			applySavedLayout: () => this.applySavedLayout(),
			resetLayout: () => this.resetLayout(),
			setSelectedRows: (id, selection, state) => this.setSelectedRows(id, selection, state),
			notifyDidChangeSelection: () => this.notifyDidChangeSelection(),
			writeWipDraftToStorage: (worktreePath, draft) => this._wip.writeWipDraftToStorage(worktreePath, draft),
			pushUpToCommit: (repoPath, sha) => this.pushUpToCommit(repoPath, sha),
			getOpenEditorShowOptions: () => this.getOpenEditorShowOptions(),
			runStageConflictResolution: (item, resolution) => this.runStageConflictResolution(item, resolution),
			updateExcludedRefs: (repoPath, refs, visible) => this.updateExcludedRefs(repoPath, refs, visible),
			showRemoteRefs: (repoPath, remoteName) => this.showRemoteRefs(repoPath, remoteName),
			updatePinnedRef: (repoPath, ref) => this.updatePinnedRef(repoPath, ref),
			_undoCommit: (ref, worktreePath) => this._undoCommit(ref, worktreePath),
			fireRequestAction: params => this._requestActionEvent.fire(params),
			fireRequestOpenCompareMode: params => this._requestOpenCompareModeEvent.fire(params),
		};
	}

	/** Collaborator surface {@link GraphWipService} reaches for. `getRepository`/`getSession` read
	 *  live provider state; the rest forward to provider state/methods that stay here — revision
	 *  refs, pinned-ref lookup, the sidebar-worktree, WIP-drafts, and watches-closed RPC events. */
	private createGraphWipContext(): GraphWipServiceContext {
		return {
			...this.createBaseServiceContext(),
			getRevisionReference: (repoPath, id, type) => this.getRevisionReference(repoPath, id, type),
			getPinnedRefId: repoPath => this.getPinnedRefId(repoPath),
			fireSidebarWorktreeChanges: changes => this._sidebarWorktreeEvent.fire({ changes: changes }),
			fireDraftsChanged: drafts => this._wipDraftsChangedEvent.fire(drafts),
			fireWatchesClosed: shas => this._wipWatchesClosedEvent.fire({ shas: shas }),
			fireWorkingTreeChanged: change => this._workingTreeChangedEvent.fire(change),
			fireWorktreeEnrichment: enrichment => this._worktreeEnrichmentEvent.fire(enrichment),
			fireWipRefetched: refetch => this._wipRefetchedEvent.fire(refetch),
		};
	}

	/** Collaborator surface {@link GraphProducersService} reaches for. `getRepository`/`getSession` read
	 *  live provider state; `updateState` forwards to the data controller; the cancellation map, the
	 *  branch-state RPC event, and the deferred-refresh flag route through the provider, which stays here. */
	private createGraphProducersContext(): GraphProducersServiceContext {
		return {
			...this.createBaseServiceContext(),
			updateState: immediate => this._data.updateState(immediate),
			fireRefsMetadataChanged: metadata =>
				this._refsMetadataChangedEvent.fire({ metadata: metadata, reset: true }),
			createBranchStateOnlyCancellation: () => this.createCancellation('branchStateOnly'),
		};
	}

	/** Collaborator surface {@link GraphDataController} reaches for. The controller now OWNS the data-plane
	 *  state (session/window, loading, store, page-in, rows-stats override, state-notify coalescer) and its
	 *  logic; this surface only forwards the publisher (still provider-owned), selection/search/etag reads,
	 *  sidebar-seq bookkeeping, and the provider methods the moved bodies invoke (search, overview, WIP). */
	private createGraphDataContext(): GraphDataControllerContext {
		return {
			container: this.container,
			host: this.host,
			getRepository: () => this.repository,
			getSync: () => this._graphSync,
			getSelectedId: () => this._selectedId,
			getSearch: () => this._searchService.activeSearch,
			getEtagRepository: () => this._etagRepository,
			getConvertedSelectedRows: () => convertSelectedRows(this._selectedRows),
			getSidebarEventSeq: () => this._sidebarEventCounter.current,
			getFiredSidebarSeq: () => this._firedSidebarEventSeq,
			setFiredSidebarSeq: seq => (this._firedSidebarEventSeq = seq),
			isBranchStateRevisionCurrent: revision => this._producers.isBranchStateRevisionCurrent(revision),
			commitSentBranchState: (branchState, revision) =>
				this._producers.commitSentBranchState(branchState, revision),
			buildState: () => this.getState(),
			clearSearch: () => this._searchService.clear(),
			resetRefsMetadata: () => {
				// Repo swap / clear: wipe AND re-anchor the webview — nothing else replaces the outgoing
				// repo's map now that the full-state push no longer carries it.
				this._producers.resetRefsMetadata();
				this._producers.fireRefsMetadataChanged();
			},
			resetHoverCache: () => this.resetHoverCache(),
			clearAvatarProxyCaches: () => {
				this._avatarProxyCache.clear();
				this._avatarProxyFailed.clear();
			},
			clearLastSentOverview: () => this._panels.clearLastSentOverview(),
			cancelComputeIncludedRefs: () => this.cancelOperation('computeIncludedRefs'),
			getIncludedRefTipShas: () => this._includedRefTipShas,
			replayPendingRefMetadataForGraph: graph => this._producers.replayPendingRefMetadataForGraph(graph),
			continueSearchInBackground: query => this._searchService.continueInBackground(query),
			notifySearchError: (query, results) => this._searchService.notifySearchError(query, results),
			publishSearchState: () => this._searchService.publishState(),
			notifyDidChangeOverview: () => this._panels.notifyDidChangeOverview(),
			notifySidebarInvalidated: () => this._panels.notifySidebarInvalidated(),
			resetWipSendState: () => this._wip.resetSendState(),
			clearWipStatusCache: () => this._wip.clearStatusCache(),
			fireStateChanged: params => this._stateChangedEvent.fire(params),
			deferStateRefresh: () => (this._pendingStateRefresh = true),
		};
	}

	/** Collaborator surface {@link GraphPanelsService} reaches for. `getRepository`/`getSession`/
	 *  `getLoading` read live provider state; `getPinnedRefId`/`getExcludedRefsByRepo` read the provider's
	 *  stored filters through the same home-aware `filtersRepoPath` key used everywhere else, so ids come
	 *  back re-stamped onto the LIVE path the caller passes; `fetchWipStatus`/`computeWorktreeChanges`
	 *  forward into the WIP service's caches; `fireSidebarInvalidated` fires the provider's RPC event. */
	private createGraphPanelsContext(): GraphPanelsServiceContext {
		return {
			...this.createBaseServiceContext(),
			getLoading: () => this._data.loading,
			getPinnedRefId: repoPath => this.getPinnedRefId(repoPath),
			getExcludedRefsByRepo: () => this.getFiltersByRepo(this.filtersRepoPath)?.excludeRefs,
			fetchWipStatus: (path, signal) => this._wip.getStatusFromCache(path, signal),
			computeWorktreeChanges: worktrees => this._wip.computeWorktreeChanges(worktrees),
			getLastWorktreeChange: path => this._wip.getLastWorktreeChange(path),
			fireSidebarInvalidated: () => this._sidebarInvalidatedEvent.fire(undefined),
		};
	}

	/** Collaborator surface {@link GraphInspectServices} reaches for. `getSession` reads live provider
	 *  state; `getWipForRepoAndStats` forwards into the WIP service's cache (kept there); `getSearchContext`
	 *  forwards into the search service's active graph search state. */
	private createGraphInspectContext(): GraphInspectServicesContext {
		return {
			container: this.container,
			host: this.host,
			getSession: () => this._data.session,
			getWipForRepoAndStats: async (repo, signal, options) => {
				const result = await this._wip.getWipForRepoAndStats(repo, signal, options);
				// This response goes straight to the client, bypassing the push channel — so the push dedup's
				// record of what the client holds is now stale. Invalidate it, or a corrective push that happens
				// to be byte-identical to the last one we sent would be suppressed as a no-op.
				if (result != null) {
					this._wip.onWipServedOutOfBand(repo, result.wip.revision);
				}
				return result;
			},
			getSearchContext: sha => this._searchService.getSearchContext(sha),
		};
	}

	/** Collaborator surface {@link GraphSearchService} reaches for. `getRepository`/`getSession` read
	 *  live provider state; the selection reads/`setSelectedRows` route through the provider's selection
	 *  state; `updateState`/`updateGraphWithMoreRows`/`notifyDidChangeRows` forward into the data
	 *  controller; `getWipRows` forwards into the WIP service. */
	private createGraphSearchContext(): GraphSearchServiceContext {
		return {
			container: this.container,
			host: this.host,
			getRepository: () => this.repository,
			getSession: () => this._data.session,
			getSelectedId: () => this._selectedId,
			getSelectedRows: () => this._selectedRows,
			getEtagRepository: () => this._etagRepository,
			getFiltersRepoPath: () => this.filtersRepoPath,
			setSelectedRows: (id, selection, state) => this.setSelectedRows(id, selection, state),
			updateState: immediate => this._data.updateState(immediate),
			// This consumer only needs the rows to have landed, so the page's outcome is deliberately dropped.
			updateGraphWithMoreRows: async (id, limitOverride) => {
				await this._data.updateGraphWithMoreRows(id, undefined, limitOverride);
			},
			notifyDidChangeRows: sendSelectedRows => this._data.notifyDidChangeRows(sendSelectedRows),
			getWipRows: async () => (await this._wip.getWipRows()).rows,
		};
	}

	/** Transport surface for the rows-plane publisher — the `graph:rows` SequencedChannel. `send` is void:
	 *  the channel stamps `{generation, seq}` and the RECEIVER detects loss, so there is no delivery result
	 *  to act on here (see `GraphSyncPublisher`'s module header). */
	private createGraphSyncHost(): GraphSyncHost {
		return {
			isReady: () => this.host.ready,
			isVisible: () => this.host.visible,
			send: params => this._rowsChannel.send(params),
			newGeneration: () => {
				this._rowsChannel.newGeneration();
			},
		};
	}

	/** The `graph:rows` channel rides the same RPC connection as every other graph service — registered
	 *  here so `RpcHost` re-attaches it on reconnect too (its `disconnect()` bumps the epoch, which is what
	 *  makes a fresh iframe's first emission a gen-fresh seq 0). */
	getRpcHandlers(): Handler[] {
		return [this._rowsChannel];
	}

	/** Read-only view onto the graph session/`_refsMetadata` for the publisher — mirrors exactly what the
	 *  old `notifyDidChangeRows`/`getState` read when building each rows-plane field. */
	private createGraphSyncDataSource(): GraphSyncDataSource {
		return {
			getRows: () => this._data.session?.current.rows,
			// The FULL accumulated window for a recovery snapshot — `session.window`, never the page-scoped
			// `current.rows` pagination leaves behind. The session's window is a mutable array under the hood
			// (never frozen); the publisher only reads it.
			getSnapshotRows: () => this._data.session?.window as GitGraphRow[] | undefined,
			getDownstreams: () => this._data.session?.current.downstreams,
			getRowsStats: () => this._data.session?.current.rowsStats,
			isRowsStatsLoading: () =>
				this._data.rowsStatsLoadingOverride ||
				(this._data.session?.current.rowsStatsDeferred?.isLoaded != null
					? !this._data.session.current.rowsStatsDeferred.isLoaded()
					: false),
			isRowsStatsIncluded: () => this._data.session?.current.includes?.stats === true,
			getReachability: () => this._data.session?.current.reachability,
			getPaging: () => {
				const paging = this._data.session?.current.paging;
				return paging != null ? { startingCursor: paging.startingCursor, hasMore: paging.hasMore } : undefined;
			},
		};
	}

	/** A fresh iframe reached ready — first boot, or a hard refresh that replaced the HTML. Either way it
	 *  holds NO rows plane (the bootstrap `State` carries none), so force a snapshot: the RpcHost's
	 *  announce-driven reconnect already cycled the channel, so this ships as the new session's seq 0 and
	 *  the fresh receiver adopts it with no gap. On a first boot the publisher is snapshot-required
	 *  anyway, so this costs nothing. */
	onReady(): void {
		this._graphSync.requireSnapshot();
		void this._graphSync.flush();
		// Ready is the other edge a WIP tick can defer on (`runWipRefetch` / `runNotifyDidChangeWorkingTree`),
		// and unlike hidden it resolves without any visibility or focus transition — so nothing else would
		// ever flush it.
		this._wip.flushDeferredWorkingTree();
		this._wip.recoverDeferredSecondaryWip();
		// Same edge for the deferred state/branch-state refreshes: an event landing before ready sets
		// the flag, and an already-visible webview never gets the visibility transition that would
		// otherwise drain it (the legacy path drained its pending queue right here at ready).
		// `includeBootstrap` clears the flags when a fresh bootstrap supersedes them, so anything
		// still set here was deferred after that snapshot — re-produce it.
		if (this._pendingStateRefresh) {
			this._pendingStateRefresh = false;
			void this._data.notifyDidChangeState();
		}

		if (this._pendingBranchStateRefresh) {
			this._pendingBranchStateRefresh = false;
			void this._producers.notifyDidChangeBranchStateOnly();
		}
	}

	/** A soft-reconnected iframe re-boots from the ORIGINAL bootstrap, which carries NO rows plane — and
	 *  rows never rode the replay buffer, so the new iframe holds nothing. Re-seed via `resync` — a
	 *  generation bump plus a forced snapshot — NOT a bare snapshot: only a SERVED reconnect's
	 *  connection swap cycles the channel, while an IGNORED announcement (an element remount, or an
	 *  in-place iframe reload of a healthy webview) keeps the Connection, so the channel's generation
	 *  never moves there and a mid-generation snapshot is un-adoptable by the fresh receiver — a
	 *  guaranteed gap that drops the snapshot itself. The bump makes the snapshot the new
	 *  generation's seq 0 either way; on the served path it's one redundant generation, which the
	 *  receiver adopts cleanly. */
	onReconnect(): void {
		// Nothing to restore here: the host binding survives a reconnect untouched, and the fresh iframe
		// re-derives its own scoped chrome from the state this reconnect ships (`selectedRepository` vs
		// `homeRepositoryPath`), not from a webview-side perspective that died with the old one.
		void this._graphSync.resync();
		// See onReady — a reconnect crosses the same not-ready window.
		this._wip.flushDeferredWorkingTree();
		this._wip.recoverDeferredSecondaryWip();
	}

	private _disposed = false;

	dispose(): void {
		this._disposed = true;
		this.clearAutoFetchTimer();
		this._data.clearStateFreshnessRetryTimer();
		// Cancel + dispose every in-flight cancellation source, else the awaitee resolves and its
		// continuation runs against a torn-down host, leaking listeners for the extension's lifetime.
		cancelAndDispose(this._cancellations.values());
		this._cancellations.clear();
		cancelAndDispose(this._wipStatsCancellations.values());
		this._wipStatsCancellations.clear();
		// Cancel any in-flight load-more so its `graph.more()` resolution can't call setGraph on a
		// disposed instance.
		this._data.cancelPendingRowsQuery();
		// Cancels the pending refsMetadata debounced notify.
		this._producers.dispose();
		// Cancel the other debounced notifiers too — a trailing fire after dispose would push
		// events through a torn-down host (the exact class of bug this dispose pass exists to fix).
		this._data.cancelDebouncedNotifiers();
		this._data.disposeSession();
		this._graphSync.dispose();
		// The periodic interval set by `ensureLastFetchedSubscription` was previously not cleaned
		// up in dispose — the interval kept firing forever, holding the entire provider+host+repo
		// chain alive across every panel open/close cycle.
		this._lastFetchedDisposable?.dispose();
		this._lastFetchedDisposable = undefined;
		// Tears down the secondary-WIP watchers/timers/refetch entries and clears the status cache.
		this._wip.dispose();
		this._lastFetchedHandlerDebounced?.cancel();
		// Cancel in-flight AI runs and tear down the compose/resolve virtual sessions + cached plans.
		this._inspect.dispose();
		this._disposable.dispose();
	}

	private readonly _sidebarInvalidatedEvent = createRpcEvent<undefined>('sidebarInvalidated', 'signal');
	// `signal` (not `save-last`): the view re-fetches on receipt, so coalescing a burst of
	// probe/apply/revert changes for the same repo into one wake-up is exactly the desired behavior.
	private readonly _gitHealthChangedEvent = createRpcEvent<{ repoPath: string }>('gitHealthChanged', 'signal');
	// `signal`: the toolbar command that fires this is only reachable from a visible graph, so there is
	// no cold/hidden path to buffer for.
	private readonly _requestShowFeedbackEvent = createRpcEvent<DidRequestShowFeedbackParams>(
		'requestShowFeedback',
		'signal',
	);
	/** Visualization requested by a command during a cold show, replayed once the app is ready. */
	private _pendingVisualization: VisualizationMode | undefined;
	private readonly _sidebarWorktreeEvent = createRpcEvent<{
		changes: Record<string, SidebarWorktreeChange | undefined>;
	}>('sidebarWorktreeState', 'save-last');
	// `save-last`: the payload is a complete gating snapshot, so a hidden webview only ever needs the
	// newest one — and replaying it on show is exactly right.
	private readonly _accessChangedEvent = createRpcEvent<GraphAccessState>('accessChanged', 'save-last');
	// `save-last`: only the current repo's fetch matters to the app, so latest-wins is correct —
	// see `GraphRepoStatusService.onDidFetch`.
	private readonly _repoStatusEvent = createRpcEvent<GraphRepoStatus>('repoStatus', 'save-last');
	// `save-last`: the payload is always the complete `State` rebuild, so a hidden webview only ever
	// needs the newest one — see `GraphStateService.onStateChanged`.
	private readonly _stateChangedEvent = createRpcEvent<DidChangeParams>('stateChanged', 'save-last');
	// `save-last`: the flag is a complete statement of whether the graph is wedged on a failed walk —
	// see `GraphRowsService.onRowsFailed`.
	private readonly _rowsFailedEvent = createRpcEvent<{ error: boolean }>('rowsFailed', 'save-last');
	// `save-last`: each payload is a complete replacement and only the newest matters to a hidden
	// webview — see `GraphRepoStatusService.onBranchStateChanged`.
	private readonly _branchStateChangedEvent = createRpcEvent<DidChangeBranchStateParams>(
		'branchStateChanged',
		'save-last',
	);
	// `save-last`: the payload is always a complete repositories snapshot — see
	// `GraphRepoStatusService.onRepoConnectionChanged`.
	private readonly _repoConnectionChangedEvent = createRpcEvent<DidChangeRepoConnectionParams>(
		'repoConnectionChanged',
		'save-last',
	);
	// `save-last`: the payload is always the complete component config, so a hidden webview only
	// ever needs the newest one — see `GraphConfigurationService.onDidChange`.
	private readonly _configurationChangedEvent = createRpcEvent<GraphComponentConfig>(
		'configurationChanged',
		'save-last',
	);
	// `save-last`: the payload is always the complete columns + contexts snapshot, so a hidden webview
	// only ever needs the newest one — see `GraphColumnsService.onDidChange`.
	private readonly _columnsChangedEvent = createRpcEvent<GraphColumnsState>('columnsChanged', 'save-last');
	// `save-last`: the payload is always the complete filters snapshot, so a hidden webview only ever
	// needs the newest one — see `GraphFiltersService.onDidChange`.
	private readonly _filtersChangedEvent = createRpcEvent<GraphFiltersState>('filtersChanged', 'save-last');
	// `save-last`: the payload is always the complete per-panel WIP-drafts slice, so a hidden webview
	// only ever needs the newest one — see `GraphWipService.onDraftsChanged`.
	private readonly _wipDraftsChangedEvent = createRpcEvent<Record<string, StoredGraphWipDraft> | undefined>(
		'wipDraftsChanged',
		'save-last',
	);
	// `save-last`, but the payload is CUMULATIVE (every sha closed since the last `syncWatches`), not a
	// full-state snapshot — see `GraphWipService.onWatchesClosed` for why.
	private readonly _wipWatchesClosedEvent = createRpcEvent<{ shas: string[] }>('wipWatchesClosed', 'save-last');
	// The working-tree plane is split across TWO events keyed separately on purpose — the tick and the
	// background probe produce DISJOINT payloads, so one shared `save-last` slot would let a probe
	// swallow a tick's `wip` for good. See `GraphWipService.onWorkingTreeChanged` / `onWorktreeEnrichment`.
	private readonly _workingTreeChangedEvent = createRpcEvent<GraphWorkingTreeChange>(
		'workingTreeChanged',
		'save-last',
	);
	private readonly _worktreeEnrichmentEvent = createRpcEvent<GraphWorktreeEnrichment>(
		'worktreeEnrichment',
		'save-last',
	);
	// `save-last`: a superseded refetch is an older read of the same worktree, and the client orders by
	// `Wip.revision` regardless — see `GraphWipService.onWipRefetched`.
	private readonly _wipRefetchedEvent = createRpcEvent<{ repoPath: string; wip?: Wip }>('wipRefetched', 'save-last');
	// The five navigation events — all `save-last`, all keyed separately so a hidden webview keeps the
	// newest of EACH rather than letting one kind of request drop another. See `GraphNavigationService`.
	// Only WARM pushes fire these: a cold show (or one that switches repositories) routes through the
	// state bootstrap instead, so the request lands with the repo's state rather than racing it.
	private readonly _requestActionEvent = createRpcEvent<DidRequestGraphActionParams>('requestAction', 'save-last');
	private readonly _requestOpenCompareModeEvent = createRpcEvent<DidRequestOpenCompareModeParams>(
		'requestOpenCompareMode',
		'save-last',
	);
	private readonly _requestOpenTimelineScopeEvent = createRpcEvent<DidRequestOpenTimelineScopeParams>(
		'requestOpenTimelineScope',
		'save-last',
	);
	private readonly _requestVisualizationEvent = createRpcEvent<DidRequestVisualizationParams>(
		'requestVisualization',
		'save-last',
	);
	private readonly _requestActiveSidebarPanelEvent = createRpcEvent<DidRequestActiveSidebarPanelParams>(
		'requestActiveSidebarPanel',
		'save-last',
	);
	// `save-last`: the payload is the complete selection map, so a hidden webview only ever needs the
	// newest one — and `State.selectedRows` re-seeds it on the next bootstrap anyway. Only HOST-initiated
	// reveals fire this; a user's own click is never echoed back. See `GraphSelectionService`.
	private readonly _selectionChangedEvent = createRpcEvent<GraphSelectedRows>('selectionChanged', 'save-last');
	// `save-last`: each payload names the one ref the host gave up on, and only the newest failed jump is
	// worth surfacing on show. See `GraphSelectionService.onRevealFailed`.
	private readonly _revealFailedEvent = createRpcEvent<DidFailRevealParams>('revealFailed', 'save-last');
	// RESET-CLASS ONLY — every payload is a COMPLETE refsMetadata snapshot (`null` = feature off), so
	// `save-last` is safe: a hidden webview replays the newest one on show and holds exactly what the host
	// holds. Incremental enrichment never rides this; it returns from `getMissingRefsMetadata`.
	private readonly _refsMetadataChangedEvent = createRpcEvent<{
		metadata: GraphRefsMetadata | null;
		reset: true;
	}>('refsMetadataChanged', 'save-last');

	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): GraphServices {
		const base = createSharedServices(this.container, this.host, buffer, tracker);
		const { graphInspect, graphTimeline, graphTreemap } = this._inspect.createServices(buffer, tracker);

		return proxyServices({
			...base,
			access: {
				getAccess: () => this.getAccessState(),
				onAccessChanged: this._accessChangedEvent.subscribe(buffer, tracker),
			},
			avatars: {
				getMissingAvatars: emails => this.getMissingAvatars(emails),
				proxyAvatars: avatars => this.proxyAvatars(avatars),
			},
			refsMetadata: {
				getMissingRefsMetadata: (metadata, signal) => this._producers.getMissingRefsMetadata(metadata, signal),
				onRefsMetadataChanged: this._refsMetadataChangedEvent.subscribe(buffer, tracker),
			},
			columns: {
				setColumns: config => this.setColumns(config),
				setColumnMode: (name, mode) => this.updateColumnMode(name, mode),
				enableChangesColumn: () => this.enableChangesColumn(),
				onDidChange: this._columnsChangedEvent.subscribe(buffer, tracker),
			},
			configuration: {
				update: changes => this.updateGraphConfig(changes),
				setDisplayMode: mode => this.setDisplayMode(mode),
				onDidChange: this._configurationChangedEvent.subscribe(buffer, tracker),
			},
			filters: {
				setRefsVisibility: (refs, visible) => this.updateExcludedRefs(this.filtersRepoPath, refs, visible),
				setPinnedRef: ref => this.updatePinnedRef(this.filtersRepoPath, ref),
				setExcludeType: (key, value) => this.updateExcludedTypes(this.filtersRepoPath, key, value),
				setIncludedRefs: (branchesVisibility, refs) =>
					this.updateIncludeOnlyRefs(this.filtersRepoPath, branchesVisibility, refs),
				reset: () => this.resetFilters(this.filtersRepoPath),
				onDidChange: this._filtersChangedEvent.subscribe(buffer, tracker),
			},
			graphInspect: graphInspect,
			search: this._searchService.createServices(buffer, tracker).search,
			sidebar: {
				getSidebarData: (panel, options, signal) =>
					this.onGetSidebarData({ panel: panel, displayed: options?.displayed }, signal),
				getSidebarCounts: () => this.onGetCounts(),
				// Straight to the shared 10s status cache — see `getWorktreeWipStats` on the interface for why
				// this deliberately does NOT reuse `wip.getStats`.
				// `normalizePath` because the client sends `Uri.fsPath`: on Windows that would key the cache
				// with backslashes, which neither the graph's readers nor the FS-watcher evictor ever match.
				getWorktreeWipStats: async (path, signal) =>
					(await this._wip.getStatusFromCache(normalizePath(path), signal))?.diffStatus ?? null,
				findPullRequest: number => this._panels.onFindPullRequest({ number: number }),
				resolvePullRequestSheet: target => this._panels.onResolvePullRequestSheet(target),
				toggleLayout: panel => this.onSidebarToggleLayout({ panel: panel }),
				toggleShowRemoteBranches: () => this.onSidebarToggleShowRemoteBranches(),
				refresh: panel => this.onSidebarRefresh({ panel: panel }),
				executeAction: (command, context, args) =>
					this.onSidebarAction({ command: command, context: context, args: args }),
				onSidebarInvalidated: this._sidebarInvalidatedEvent.subscribe(buffer, tracker),
				onWorktreeStateChanged: this._sidebarWorktreeEvent.subscribe(buffer, tracker),
			},
			selection: {
				updateSelection: selection => {
					this.updateSelection(selection);
					return Promise.resolve();
				},
				onSelectionChanged: this._selectionChangedEvent.subscribe(buffer, tracker),
				onRevealFailed: this._revealFailedEvent.subscribe(buffer, tracker),
			},
			welcome: { continueToGraph: options => this.onWelcomeContinueToGraph(options) },
			graphHealth: {
				getReport: repoPath => this.container.gitHealth.getReport(repoPath),
				getLevers: repoPath => this.container.gitHealth.getLevers(repoPath),
				getDetails: (repoPath, signal) => this.container.gitHealth.getDetails(repoPath, signal),
				// Ask-tier: failures propagate to the view rather than being swallowed, so a person who
				// clicked Enable sees the actual git error instead of a silent no-op.
				applyFix: (repoPath, id, signal) => this.container.gitHealth.applyFix(repoPath, id, signal),
				revertFix: (repoPath, id, signal) => this.container.gitHealth.revertFix(repoPath, id, signal),
				runMaintenance: (repoPath, signal) => this.container.gitHealth.runMaintenanceNow(repoPath, signal),
				setCommitGraphEnabled: (repoPath, enabled, signal) =>
					this.container.gitHealth.setCommitGraphEnabled(repoPath, enabled, signal),
				getBannerState: repoPath => this.container.gitHealth.getBannerState(repoPath),
				dismissBanner: repoPath => this.container.gitHealth.dismissBanner(repoPath),
				markHealthViewVisited: repoPath => this.container.gitHealth.markHealthViewVisited(repoPath),
				onHealthChanged: this._gitHealthChangedEvent.subscribe(buffer, tracker),
			},
			feedback: {
				send: input => this.onSendFeedback(input),
				onRequestShow: this._requestShowFeedbackEvent.subscribe(buffer, tracker),
			},
			launchpad: new LaunchpadService(this.container, buffer, tracker),
			navigation: {
				onRequestAction: this._requestActionEvent.subscribe(buffer, tracker),
				onRequestOpenCompareMode: this._requestOpenCompareModeEvent.subscribe(buffer, tracker),
				onRequestOpenTimelineScope: this._requestOpenTimelineScopeEvent.subscribe(buffer, tracker),
				onRequestVisualization: this._requestVisualizationEvent.subscribe(buffer, tracker),
				onRequestActiveSidebarPanel: this._requestActiveSidebarPanelEvent.subscribe(buffer, tracker),
			},
			walkthrough: new WalkthroughService(this.container, buffer, tracker),
			graphTimeline: graphTimeline,
			graphTreemap: {
				...graphTreemap,
				onDidInvalidate: this._treemapInvalidatedEvent.subscribe(buffer, tracker),
			},
			repoStatus: {
				getLastFetched: () => this.getRepoStatus(),
				onDidFetch: this._repoStatusEvent.subscribe(buffer, tracker),
				onBranchStateChanged: this._branchStateChangedEvent.subscribe(buffer, tracker),
				onRepoConnectionChanged: this._repoConnectionChangedEvent.subscribe(buffer, tracker),
			},
			state: {
				// Catch-up on subscribe: every (re-)booting client starts from the frozen bootstrap State
				// baked into the HTML — the first boot (a state push during discovery fires into a
				// still-booting client's empty handler map, lost), an in-place iframe reload, and an
				// element remount alike — so a graph whose git world moved past its bootstrap otherwise
				// wedges on stale state ("No repository open" forever, in the shown-before-discovery
				// case). Two staleness signals, either sufficient: the git world moved past the
				// BOOTSTRAP-era etag (not the last push build's — later pushes reached the previous
				// boot, and a reloaded client has regressed behind them), or any state build shipped
				// since the bootstrap (staleness the etag can't see: subscription/discovery timing).
				onStateChanged: handler => {
					const unsubscribe = this._stateChangedEvent.subscribe(buffer, tracker)(handler);
					if (
						this._etagAtBootstrapBuild != null &&
						(this._stateBuildsSinceBootstrap > 0 || this._etagAtBootstrapBuild !== this.container.git.etag)
					) {
						queueMicrotask(() => this._data.updateState());
					}

					return unsubscribe;
				},
			},
			rows: {
				getMoreRows: (id, limit) => this._data.onGetMoreRows(id, limit),
				loadRow: (id, signal) => this._data.loadRow(id, signal),
				resyncRows: () => this._data.resyncRows(),
				retryRows: () => this.host.refresh(true),
				// Replayed on subscribe: a fast-failing walk fires before the app has subscribed (the
				// event lands in an empty handler map), so a standing failure is handed to each new
				// subscriber — without it, a cold-load failure leaves the spinner wedged forever.
				onRowsFailed: this._rowsFailedEvent.subscribe(buffer, tracker, () =>
					this._rowsFailed ? { error: true } : undefined,
				),
			},
			scope: {
				resolveScope: (repoPath, scope, signal) => this.resolveGraphScope(repoPath, scope, signal),
				rebind: params => this.rebindRepository(params.worktreePath),
				onScopeAnchorsInvalidated: this._scopeAnchorsInvalidatedEvent.subscribe(buffer, tracker),
			},
			...this._panels.createServices(buffer, tracker),
			wip: {
				getLineStats: (repoPath, signal) => this.onGetWipLineStats(repoPath, signal),
				getStats: (shas, options, signal) => this.onGetWipStats(shas, options, signal),
				updateDraft: (worktreePath, draft) => this._wip.writeWipDraftToStorage(worktreePath, draft),
				onDraftsChanged: this._wipDraftsChangedEvent.subscribe(buffer, tracker),
				syncWatches: shas => this._wip.syncWipWatches(shas),
				onWatchesClosed: this._wipWatchesClosedEvent.subscribe(buffer, tracker),
				// `replay`: the WIP push is standing state, and the producer's content dedup means a fire
				// lost to a subscribe gap (session re-validation, remount) is never naturally re-sent —
				// see `GraphWipService._lastFiredWorkingTreeChange`. The client's revision ordering drops
				// the replay when it already holds newer.
				onWorkingTreeChanged: this._workingTreeChangedEvent.subscribe(
					buffer,
					tracker,
					() => this._wip.lastWorkingTreeChange,
				),
				onWorktreeEnrichment: this._worktreeEnrichmentEvent.subscribe(buffer, tracker),
				onWipRefetched: this._wipRefetchedEvent.subscribe(buffer, tracker),
			},
			hover: {
				getRowHover: (type, id, signal) => this.getRowHover(type, id, signal),
			},
			pickers: {
				chooseRef: (title, placeholder, options) => this.chooseRef(title, placeholder, options),
				chooseComparison: title => this.chooseComparison(title),
				chooseAuthor: (title, placeholder, picked) => this.chooseAuthor(title, placeholder, picked),
				chooseFile: (title, type, options) => this.chooseFile(title, type, options),
				chooseRepository: () => this.chooseRepository(),
				chooseAccountOrg: () => this.chooseAccountOrg(),
			},
			pullRequest: {
				merge: (number, options) => this.mergePullRequest(number, options),
			},
			rowActions: {
				executeRowAction: params => this.executeRowAction(params),
				handleRefDoubleClick: (ref, metadata) => this.handleRefDoubleClick(ref, metadata),
				openTreemapFile: (action, repoPath, path) => this.openTreemapFile(action, repoPath, path),
			},
		} satisfies GraphServices);
	}

	canReuseInstance(...args: WebviewShowingArgs<GraphWebviewShowingArgs, State>): boolean | undefined {
		if (this.container.git.openRepositoryCount === 1) return true;

		const [arg] = args;

		let repository: GlRepository | undefined;
		if (GlRepository.is(arg)) {
			repository = arg;
		} else if (hasGitReference(arg)) {
			repository = this.container.git.getRepository(arg.ref.repoPath);
		} else if (hasRepository(arg)) {
			repository = arg.repository;
		} else if (isSerializedState<State>(arg) && arg.state.selectedRepository != null) {
			repository = this.container.git.openRepositories.find(r => r.id === arg.state.selectedRepository);
		}

		return repository?.uri.toString() === this.repository?.uri.toString() ? true : undefined;
	}

	getSplitArgs(): WebviewShowingArgs<GraphWebviewShowingArgs, State> {
		return this.repository != null ? [this.repository] : [];
	}

	getTelemetryContext(): GraphTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.repository.id': this.repository?.idHash,
			'context.repository.scheme': this.repository?.uri.scheme,
			'context.repository.closed': this.repository != null ? !this.repository.opened : undefined,
			'context.repository.folder.scheme': this.repository?.folder?.uri.scheme,
			'context.repository.provider.id': this.repository?.provider.id,
		};
	}

	getShownTelemetryContext(): GraphShownTelemetryContext {
		const columnContext: Partial<{
			[K in Extract<keyof GraphShownTelemetryContext, `context.column.${string}`>]: GraphShownTelemetryContext[K];
		}> = {};
		// Use getColumnSettings (not raw getColumns) so the Changes column's config-overlaid mode is reported,
		// not a possibly-stale stored mode.
		const columnSettings = this.getColumnSettings(this.getColumns());
		for (const [name, config] of Object.entries(columnSettings)) {
			if (!config.isHidden) {
				columnContext[`context.column.${name}.visible`] = true;
			}
			if (config.mode != null) {
				columnContext[`context.column.${name}.mode`] = config.mode;
			}
		}

		const cfg = flatten(configuration.get('graph'), 'context.config', { joinArrays: true });
		const context: GraphShownTelemetryContext = {
			...this.getTelemetryContext(),
			...columnContext,
			...cfg,
		};

		return context;
	}

	private _searchRequest: SearchQuery | undefined;
	private _pendingSidebarPanel: GraphSidebarPanel | undefined;
	private _pendingAction:
		| {
				action: GraphShowAction;
				target?: GraphActionTarget;
				composeInstructions?: string;
				composeScope?: GraphComposeScopeSeed;
				agentSessionId?: string;
				revealOnly?: boolean;
				followed?: boolean;
				onlyIfWipSelected?: boolean;
				scopeBranch?: GraphScopeBranch;
				scopeOrigin?: GraphScopeOrigin;
		  }
		| undefined;
	private _pendingCompare: DidRequestOpenCompareModeParams | undefined;

	async onShowing(
		loading: boolean,
		options?: WebviewShowOptions,
		...args: WebviewShowingArgs<GraphWebviewShowingArgs, State>
	): Promise<[boolean, GraphShownTelemetryContext]> {
		// Passive deliveries (e.g. a background follower) must never open/raise a hidden instance.
		if (options?.preserveVisibility && !this.host.visible) return [false, this.getShownTelemetryContext()];

		this._etag = this.container.git.etag;
		if (this.container.git.isDiscoveringRepositories) {
			this._discovering = this.container.git.isDiscoveringRepositories.then(r => {
				this._discovering = undefined;
				return r;
			});
			this._etag = await this._discovering;
		}

		const [arg] = args;
		if (GlRepository.is(arg)) {
			this.repository = arg;
		} else if (hasGitReference(arg)) {
			// A same-family target keeps the current binding: family rows (and every worktree's WIP row) are
			// already in the graph, so switching to the reveal's named repo would tear down the session,
			// selection, and any scope for a row that's already on screen.
			const revealRepo = this.container.git.getRepository(arg.ref.repoPath);
			const revealCurrent = this.repository;
			if (revealRepo == null || revealCurrent == null || !isSameRepoFamily(revealRepo, revealCurrent)) {
				this.repository = revealRepo;
			}

			let id = arg.ref.ref;
			let isWipRow = false;
			let unresolved = false;
			if (isUncommitted(id)) {
				// The uncommitted revision isn't a real commit — it maps to the synthetic WIP row of the
				// worktree it belongs to (the graph surfaces one WIP row per worktree, all keyed by path).
				// See `createWipRowId`.
				id = createWipRowId(arg.ref.repoPath);
				isWipRow = true;
			} else if (!isSha(id)) {
				// A sha is trusted as-is (left to the uncapped walk below); a non-sha ref is resolved
				// first — `resolveRevision` echoes `id` back unchanged when it couldn't find a matching
				// commit, so don't launch a doomed history walk for a ref that can never be found.
				const resolved = await this.container.git
					.getRepositoryService(arg.ref.repoPath)
					.revision.resolveRevision(id);
				if (resolved.sha === id) {
					unresolved = true;
				} else {
					id = resolved.sha;
				}
			}

			if (unresolved) {
				this._revealFailedEvent.fire({ id: id, reason: 'invalidRef' });
			} else {
				this.setSelectedRows(id);

				if (this._data.session != null) {
					// Synthetic WIP rows can't be paged in via `onGetMoreRows`; selecting + notifying is enough.
					if (isWipRow || this._data.session.current.ids.has(id)) {
						this.notifyDidChangeSelection();
						return [true, this.getShownTelemetryContext()];
					}

					void this.revealRow(id);
				}
			}
		} else if (hasFeedback(arg)) {
			// The panel's title-toolbar command, so the graph is already open and warm; there is no cold
			// path to buffer for — an app that isn't ready yet simply has nothing to open the dialog in.
			if (this.host.ready) {
				this.showFeedback();
			}
		} else if (hasVisualization(arg)) {
			// Checked ahead of `hasCompare`/`hasRepository` — both duck-type on `arg.repository` alone,
			// which a visualization request now carries too, and would otherwise steal this branch.
			//
			// Mirrors the compare-mode path below when a repository rides along: a repo switch must not
			// notify immediately (the webview would apply the visualization against the outgoing repo's
			// context) — deferring lets the switch's own state rebuild carry it, same as a cold show's
			// bootstrap.
			const repoChanged = arg.repository != null && this._repository !== arg.repository;
			if (arg.repository != null) {
				this.repository = arg.repository;
			}

			if (loading || repoChanged || !this.host.ready) {
				this._pendingVisualization = arg.visualization;
			} else {
				this._requestVisualizationEvent.fire({ visualization: arg.visualization });
			}
		} else if (hasCompare(arg)) {
			const repoChanged = this._repository !== arg.repository;
			this.repository = arg.repository;
			const params: DidRequestOpenCompareModeParams = { repoPath: arg.repository.path, ...arg.compare };
			// Cold show / repo swap / not-yet-ready must route through the state bootstrap so the compare
			// lands with the repo's own state instead of racing it; a warm same-repo show fires the
			// navigation event directly. Mirrors the search path below and the `pendingAction` mechanism.
			if (loading || repoChanged || !this.host.ready) {
				this._pendingCompare = params;
			} else {
				this._requestOpenCompareModeEvent.fire(params);
			}
		} else if (hasRepository(arg)) {
			const repoChanged = this._repository !== arg.repository;
			this.repository = arg.repository;
			// Repository-only args (e.g. the SCM "Show Commit Graph" button or a repo-folder node)
			// just switch repos; only run the search-specific work when a search is also present.
			if (hasSearchQuery(arg)) {
				// Callers can hand us the `uncommitted` REVISION (e.g. Open File History on a
				// working-changes file node) — no rendered row carries it, so map it to this
				// worktree's synthetic WIP row id or the selection never highlights.
				const selectSha =
					arg.selectSha != null && isUncommitted(arg.selectSha)
						? createWipRowId(arg.repository.path)
						: arg.selectSha;
				if (selectSha) {
					this.setSelectedRows(selectSha);

					if (this._data.session != null) {
						// Synthetic WIP rows can't be paged in; selecting + notifying is enough.
						if (isWipRowId(selectSha) || this._data.session.current.ids.has(selectSha)) {
							this.notifyDidChangeSelection();
						} else {
							void this.revealRow(selectSha);
						}
					}
				}
				// Three cases routed through the state-bootstrap path (`_searchRequest` → `getState`):
				//   1. Cold show (`loading`): the webview hasn't subscribed to the RPC services yet, so
				//      firing `onDidRequestSearch` now would reach no subscriber and be lost — the state
				//      bootstrap the client fetches on connect is the only channel guaranteed to reach it.
				//   2. Repo swap (`repoChanged`): the repository setter triggers a full `updateState`
				//      refetch anyway; pipe the search through it so it lands with the new repo's rows
				//      instead of racing against the just-cleared graph session.
				//   3. Force-refresh in flight (`!host.ready`): same no-subscriber risk as #1 — the
				//      reconnect hasn't re-subscribed the RPC services yet.
				// Otherwise (warm + same-repo + ready) use the lightweight RPC event — bypasses
				// the ~750ms `updateState` → `getState` pipeline since the only delta is the search.
				// Mirrors the `DidRequestOpenCompareMode` / `DidRequestOpenTimelineScope` pattern.
				if (loading || repoChanged || !this.host.ready) {
					this._searchRequest = arg.search;
				} else {
					this.notifyRequestSearch({ search: arg.search, selectSha: selectSha });
				}
			}
		} else if (hasSidebarPanel(arg)) {
			if (loading) {
				this._pendingSidebarPanel = arg.sidebarPanel;
			} else {
				this._requestActiveSidebarPanelEvent.fire({ panel: arg.sidebarPanel });
			}
		} else if (hasAction(arg)) {
			if (arg.action === 'scope-to-branch' && arg.target == null) {
				void this.warnIfScopeToCurrentBranchDetached();
			}

			const { target } = arg;
			// Switch to the target's repository only when it belongs to a DIFFERENT repo family, so a
			// cold show lands on the right repo (and the primary-vs-secondary WIP comparison below
			// resolves correctly). A worktree of the shown repo already has its own WIP row in the
			// graph, so switching to it would tear down the user's selection/search/scope (see the
			// `repository` setter) for a row that's already on screen. Reveals that would land on a
			// scoped-out row unscope client-side instead.
			let deferredForRepoSwitch = false;
			let gateOnWipSelected = false;
			if (target != null) {
				let repo = await this.container.git.getOrAddRepository(Uri.file(target.worktreePath), {
					opened: false,
					detectNested: true,
				});
				const current = this.repository;

				// COLD OPEN of a worktree SCOPE gesture. With no binding yet, the switch below would bind the
				// graph straight to the target worktree — which destroys what the gesture asks for:
				// `homeRepositoryPath` is `_rebindHome ?? repository`, so binding to the worktree DEFINES it
				// as home. There is then no scope to show and nothing to unscope back to, and the rebind that
				// would have produced both finds the graph already bound there and does nothing.
				//
				// So bind to the family HOME instead and let the ordinary rebind path move the graph onto the
				// worktree, exactly as the warm path does. Only when the default repo is same-family: a
				// cross-family target has no home to be scoped from, and binding to it is the right answer.
				if (current == null && arg.scopeOrigin?.kind === 'worktree' && repo != null) {
					const home = this.container.git.getBestRepositoryOrFirst();
					if (home != null && isSameRepoFamily(home, repo)) {
						repo = home;
					}
				}

				// A passive follow targeting the graph's OWN WIP row (target resolves to the shown
				// repository itself) is gated: the webview consumes it only while a WIP row is already
				// selected. `repo === current` also excludes every repo-switching delivery — a switch
				// rebuilds the graph, so its reveal is the only orientation the user gets.
				gateOnWipSelected = arg.followed === true && repo != null && repo === current;
				if (repo != null && repo !== current && (current == null || !isSameRepoFamily(repo, current))) {
					// Passive follow deliveries never yank the graph off the repository it's showing —
					// cross-family retargeting is opt-in; without it the delivery is ignored.
					if (
						options?.preserveVisibility &&
						current != null &&
						!configuration.get('graph.followTerminal.allowRepositorySwitching')
					) {
						return [false, this.getShownTelemetryContext()];
					}

					// A warm show that switches repositories must not notify immediately — the webview
					// would consume the action against the outgoing repo's context and the mode entry
					// no-ops. Stash the action BEFORE the switch so the setter's state rebuild delivers
					// it together with the new repo's state, same as a cold show.
					if (!loading) {
						this._pendingAction = {
							action: arg.action,
							target: arg.target,
							composeInstructions: arg.composeInstructions,
							composeScope: arg.composeScope,
							agentSessionId: arg.agentSessionId,
							revealOnly: arg.revealOnly,
							followed: arg.followed,
							onlyIfWipSelected: gateOnWipSelected ? true : undefined,
							scopeBranch: arg.scopeBranch,
							scopeOrigin: arg.scopeOrigin,
						};
						deferredForRepoSwitch = true;
					}
					this.repository = repo;
				}
			}
			let rowId: string | undefined;
			// `show-rebase-summary` opens a selection-decoupled sheet (it fetches by worktree path, not
			// the selected row), so don't move the user's selection when opening it.
			if (arg.action !== 'scope-to-branch' && arg.action !== 'show-rebase-summary') {
				// Select the row the action targets: an uncommitted target maps to its worktree's WIP
				// row, a real target selects its commit sha, and no target falls back to the shown
				// repo's own WIP row.
				if (target != null) {
					rowId = isUncommitted(target.sha) ? createWipRowId(target.worktreePath) : target.sha;
				} else {
					const graphRepoPath = this.repository?.path ?? this._data.session?.repoPath;
					rowId = graphRepoPath != null ? createWipRowId(graphRepoPath) : undefined;
				}

				// No same-row short-circuit here: `_selectedId` is only a paging hint that deliberately
				// goes stale (empty selection echoes, scope filter-outs keep the old value), so gating a
				// passive delivery on it can wrongly swallow the reveal. The webview owns selection truth
				// and `navigateToCommit` already coalesces true no-ops.
				if (!gateOnWipSelected) {
					this.setSelectedRows(rowId);
				}
			}
			if (loading) {
				this._pendingAction = {
					action: arg.action,
					target: arg.target,
					composeInstructions: arg.composeInstructions,
					composeScope: arg.composeScope,
					agentSessionId: arg.agentSessionId,
					revealOnly: arg.revealOnly,
					followed: arg.followed,
					onlyIfWipSelected: gateOnWipSelected ? true : undefined,
					scopeBranch: arg.scopeBranch,
					scopeOrigin: arg.scopeOrigin,
				};
			} else if (!deferredForRepoSwitch) {
				// Select the targeted row in the graph too (mirrors the ref path). The action
				// notification only enters the mode / reveals the details panel; without this the
				// graph row is never actually selected on a warm show. WIP rows + already-loaded
				// commits select via the lightweight selection notification; an unloaded commit pages
				// in (which carries the selection along).
				if (!gateOnWipSelected && rowId != null && this._data.session != null) {
					if (isWipRowId(rowId) || this._data.session.current.ids.has(rowId)) {
						this.notifyDidChangeSelection();
					} else {
						void this.revealRow(rowId);
					}
				}
				// While account-gated the app can only park the action for its sign-in messaging (the
				// graph DOM doesn't exist) — retain it here too, so gated rebuilds and the un-gating
				// full build re-deliver the LATEST task instead of a stale earlier one
				if (this._accountAccessRequired) {
					this._pendingAction = {
						action: arg.action,
						target: arg.target,
						composeInstructions: arg.composeInstructions,
						composeScope: arg.composeScope,
						agentSessionId: arg.agentSessionId,
						revealOnly: arg.revealOnly,
						followed: arg.followed,
						onlyIfWipSelected: gateOnWipSelected ? true : undefined,
						scopeBranch: arg.scopeBranch,
						scopeOrigin: arg.scopeOrigin,
					};
				}
				this._requestActionEvent.fire({
					action: arg.action,
					target: arg.target,
					composeInstructions: arg.composeInstructions,
					composeScope: arg.composeScope,
					agentSessionId: arg.agentSessionId,
					revealOnly: arg.revealOnly,
					followed: arg.followed,
					onlyIfWipSelected: gateOnWipSelected ? true : undefined,
					scopeBranch: arg.scopeBranch,
					scopeOrigin: arg.scopeOrigin,
				});
			}
		} else {
			if (isSerializedState<State>(arg) && arg.state.selectedRepository != null) {
				this.repository = this.container.git.openRepositories.find(r => r.id === arg.state.selectedRepository);
			}

			if (this.repository == null && this.container.git.repositoryCount > 1) {
				const [context] = parseCommandContext('gitlens.showGraph', undefined, ...args);

				if (context.type === 'scm' && context.scm.rootUri != null) {
					this.repository = this.container.git.getRepository(context.scm.rootUri);
				} else if (context.type === 'viewItem' && context.node instanceof RepositoryFolderNode) {
					this.repository = context.node.repo;
				}

				if (this.repository != null && !loading && this.host.ready) {
					this._data.updateState();
				}
			}
		}

		// Non-blocking: surface any compose stashes from interrupted runs so the user can
		// recover without digging through `git stash list`. Scoped to the current repo —
		// multi-repo users will see one notification per repo as they view each.
		const repoPathForScan = this.repository?.path;
		if (repoPathForScan != null) {
			void checkForAbandonedComposeStashes(this.container, repoPathForScan);
		}

		return [true, this.getShownTelemetryContext()];
	}

	private _detachedWarningInFlight = false;

	private async warnIfScopeToCurrentBranchDetached(options?: { skipAccessCheck?: boolean }): Promise<void> {
		const useLatch = options?.skipAccessCheck !== true;
		if (useLatch) {
			if (this._detachedWarningInFlight) return;

			this._detachedWarningInFlight = true;
		}

		try {
			const repo = this.repository ?? this.container.git.getBestRepositoryOrFirst();
			if (repo == null) return;

			const branch = await repo.git.branches.getBranch();
			if (!branch?.detached) return;

			if (
				options?.skipAccessCheck !== true &&
				isAccountAccessRequired(await this.container.subscription.getSubscription())
			) {
				return;
			}

			const switchToBranch = 'Switch to Branch...';
			const pick = await window.showWarningMessage(
				'Unable to focus the Commit Graph on the current branch because HEAD is detached. Switch to a branch and the graph will focus on it.',
				switchToBranch,
			);
			if (pick === switchToBranch) {
				await RepoActions.switchTo(repo);
			}
		} catch (ex) {
			if (!isCancellationError(ex)) {
				Logger.error(ex, 'GraphWebviewProvider', 'warnIfScopeToCurrentBranchDetached');
			}
		} finally {
			if (useLatch) {
				this._detachedWarningInFlight = false;
			}
		}
	}

	onRefresh(force?: boolean): void {
		if (force) {
			this.resetRepositoryState();
		}
	}

	async includeBootstrap(_deferrable?: boolean): Promise<State> {
		// Scope PERSISTS across a reload. A webview-only reload needs nothing here — the host never lost its
		// binding, so the client re-derives the same scoped chrome from the state below. A FULL WINDOW
		// reload starts a fresh extension host, so the rebind (session-only by construction) is gone with
		// it: re-establish it from persisted storage BEFORE the first walk runs, so that walk is the only
		// one this boot needs. (Not routed through `rebindRepository`, which needs a live `_data.session` —
		// nothing populates that until `getState` below runs, so it would only park waiting on us.) A full
		// window reload also arrives with no showing args, so bind the default `getState` would pick later,
		// giving the restore below a home to key its lookup on.
		if (this._repository == null) {
			const repo = this.container.git.getBestRepositoryOrFirst();
			if (repo != null) {
				this.repository = repo;
			}
		}

		await this.restorePersistedPerspective();

		// The fresh bootstrap carries the complete state (branchState included), superseding any
		// refresh deferred while hidden/not-ready — clear the flags so the next visibility restore
		// doesn't fire a redundant rebuild.
		this._pendingStateRefresh = false;
		this._pendingBranchStateRefresh = false;
		// Mark a state op as in-flight for the duration of the bootstrap so any `notifyDidChangeState`
		// triggered by repo-change events during the bootstrap window waits on this op, then finds the
		// state already fresh and skips the redundant getState/getGraph pipeline.
		const op = this._data.trackBootstrapStateOp(this.getState(true));
		// Capture the branchState that ships with bootstrap so a delayed PR resolve merges into it. Commit its
		// revision too — bootstrap delivers over the wire like any other push, so leaving the ordering
		// watermark at 0 would let a build superseded before the webview even loaded still out-rank it.
		void op
			.then(state => {
				if (state.branchState != null && state.branchStateRevision != null) {
					this._producers.commitSentBranchState(state.branchState, state.branchStateRevision);
				}
				// Host-internal — don't ship it in the bootstrap payload either.
				state.branchStateRevision = undefined;
			})
			.catch(() => undefined);
		return op;
	}

	/**
	 * Silently re-establishes a PERSISTED worktree perspective at boot, for the one case that actually lost
	 * it — a fresh extension host booting home-bound with no memory of the rebind. Any failure (the entry
	 * names home itself, a different family, or a worktree that's gone) drops the entry and leaves the graph
	 * on home, with no toast: a reload must never surface an error about something that happened while the
	 * window was away.
	 */
	private async restorePersistedPerspective(): Promise<void> {
		if (this._rebindHome != null || this._repository == null) return;

		const home = this._repository;
		const persisted = this.getPersistedPerspective(home.path);
		if (persisted == null) return;

		try {
			const target = await this.container.git.getOrAddRepository(Uri.file(persisted.path), {
				opened: false,
				detectNested: true,
			});
			const live =
				target != null &&
				target !== home &&
				isSameRepoFamily(target, home) &&
				(await this.isLiveFamilyWorktree(home, persisted.path));

			// Re-check after the awaits above — a concurrent switch (or another restore) may already own
			// the binding now; leave the persisted entry alone rather than clear or swap against it.
			if (this._repository !== home || this._rebindHome != null) return;

			if (!live) {
				void this.syncPersistedPerspective(home);
				return;
			}

			this._rebindHome = home;
			this._repository = target;
			this.ensureRepositorySubscriptions(true);
			void this.syncPersistedPerspective();
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'restorePersistedPerspective');
			void this.syncPersistedPerspective(home);
		}
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.is('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
				registerCommand(`${this.host.id}.sendFeedback`, () => this.showFeedback()),
				registerCommand(`${this.host.id}.openInNewWindow`, async () => {
					this.host.sendTelemetryEvent('graph/command', {
						command: `${this.host.id}.openInNewWindow`,
					});
					await executeCommand<WebviewPanelShowCommandArgs<GraphWebviewShowingArgs>>(
						'gitlens.showGraphPage',
						undefined,
						this.repository,
					);
					void executeCoreCommand('workbench.action.moveEditorToNewWindow');
				}),
				registerCommand(`${this.host.id}.openInTab`, () => {
					this.host.sendTelemetryEvent('graph/command', {
						command: `${this.host.id}.openInTab`,
					});
					void executeCommand<WebviewPanelShowCommandArgs<GraphWebviewShowingArgs>>(
						'gitlens.showGraphPage',
						undefined,
						this.repository,
					);
				}),
				// Opens the standalone Visual History editor at the current repo from the in-graph
				// timeline mode's "Open in Editor" toolbox button. Plain `registerCommand` (not the
				// webview-context-aware decorator path) because the button click has no row context
				// to provide.
				registerCommand(
					`${this.host.id}.openTimelineInTab`,
					() =>
						void executeCommand<TimelineCommandArgs | undefined>(
							'gitlens.visualizeHistory',
							this.repository != null ? { type: 'repo', uri: this.repository.uri } : undefined,
						),
				),
			);
		}

		// Register commands from the extracted `GraphCommands` @command decorators, bound to that instance.
		for (const c of getGraphCommands()) {
			const id = getWebviewCommand(c.command, this.host.type);
			const handler = c.handler.bind(this._commands) as (...args: unknown[]) => unknown;
			commands.push(
				this.host.registerWebviewCommand(id, (...args: unknown[]) => {
					// Context-menu actions dispatch straight here; emit sidebar action telemetry for the
					// right-click path (inline invocations are re-stamped and already emitted by the
					// webview). Guarded: a telemetry failure must never gate command execution.
					try {
						this.emitSidebarContextMenuActionTelemetry(id, args[0]);
					} catch (ex) {
						Logger.error(ex, 'GraphWebviewProvider.sidebarContextMenuActionTelemetry');
					}
					return handler(...args);
				}),
			);
		}

		// Register file/folder action commands for the integrated details panel
		this.registerDetailsFileAndFolderCommands(commands);

		return commands;
	}

	private registerDetailsFileAndFolderCommands(commands: Disposable[]): void {
		const fileCommands = new DetailsFileCommands(this.container);
		const folderCommands = new DetailsFolderCommands(this.container);

		// Shared file commands. `gitlens.views.copy:` and `gitlens.copyRelativePathToClipboard:` are
		// also wired to folder context — when the menu fires them on a folder row, route to the
		// folder commands instance instead of running the file lookup (which would no-op).
		for (const { command: cmd, handler } of getDetailsFileCommands()) {
			// Visual File History is graph-specific — registered separately below to open the
			// embedded timeline instead of the standalone Visual History editor.
			if (cmd === 'gitlens.visualizeHistory.file:') continue;

			const folderRoute = sharedDetailsFolderCommandRoutes[cmd];
			commands.push(
				this.host.registerWebviewCommandForId(
					this.host.id,
					getWebviewCommand(cmd, 'graphDetails'),
					async (item?: DetailsItemContext) => {
						if (folderRoute != null && isDetailsFolderContext(item)) {
							folderCommands[folderRoute](item.webviewItemValue);
							return;
						}

						if (!isDetailsFileContext(item)) return;

						const [commit, file, comparison] = await getFileCommitFromContext(
							this.container,
							item.webviewItemValue,
						);
						if (commit == null) {
							Logger.warn(
								`${cmd}: unable to resolve commit for "${item.webviewItemValue.path}" — command aborted`,
							);
							return;
						}

						return void handler.call(fileCommands, commit, file, undefined, comparison);
					},
				),
			);
		}

		// Multi-file commands. The right-clicked row carries `webviewItemsValues` (all selected files);
		// resolve each to its commit+file and hand the whole set to the multi handler.
		for (const { command: cmd, handler } of getDetailsFileMultiCommands()) {
			commands.push(
				this.host.registerWebviewCommandForId(
					this.host.id,
					getWebviewCommand(cmd, 'graphDetails'),
					async (item?: DetailsItemContext) => {
						const resolved = await resolveMultiFileContext(this.container, item);
						// Mirror resolveMultiFileContext's own count: webviewItemsValues length, falling
						// back to the single anchor row when the multi-selection field is absent.
						const offered = item?.webviewItemsValues?.length ?? (item?.webviewItemValue != null ? 1 : 0);
						if (!resolved.length) {
							Logger.warn(`${cmd}: unable to resolve any files from the selection — command aborted`);
							return;
						}

						if (resolved.length < offered) {
							Logger.warn(
								`${cmd}: resolved ${resolved.length} of ${offered} selected files — running on the resolved subset`,
							);
						}

						await handler.call(fileCommands, resolved);
					},
				),
			);
		}

		// Folder-only commands (Folder History submenu).
		for (const { command: cmd, handler } of getDetailsFolderCommands()) {
			if (cmd in sharedDetailsFolderCommandRoutes) continue;
			// Visual Folder History is graph-specific — registered separately below.
			if (cmd === 'gitlens.visualizeHistory.folder:') continue;

			commands.push(
				this.host.registerWebviewCommandForId(
					this.host.id,
					getWebviewCommand(cmd, 'graphDetails'),
					(item?: DetailsItemContext) => {
						if (!isDetailsFolderContext(item)) return;

						handler.call(folderCommands, item.webviewItemValue);
					},
				),
			);
		}

		// Visual File/Folder History open the graph's own embedded timeline (Visual History)
		// instead of the standalone Visual History editor that the shared Details handlers invoke.
		commands.push(
			this.host.registerWebviewCommandForId(
				this.host.id,
				getWebviewCommand('gitlens.visualizeHistory.file:', 'graphDetails'),
				(item?: DetailsItemContext) => {
					if (!isDetailsFileContext(item)) return;

					this.notifyOpenTimelineScope({
						type: 'file',
						relativePath: item.webviewItemValue.path,
						repoPath: item.webviewItemValue.repoPath,
					});
				},
			),
			this.host.registerWebviewCommandForId(
				this.host.id,
				getWebviewCommand('gitlens.visualizeHistory.folder:', 'graphDetails'),
				(item?: DetailsItemContext) => {
					if (!isDetailsFolderContext(item)) return;

					this.notifyOpenTimelineScope({
						type: 'folder',
						relativePath: item.webviewItemValue.path,
						repoPath: item.webviewItemValue.repoPath,
					});
				},
			),
		);
	}

	onWindowFocusChanged(focused: boolean): void {
		this.isWindowFocused = focused;
		void this.ensureAutoFetch();
		if (focused) {
			this._wip.recoverWorkingTreeStatsIfStuck();
			// Regaining window focus is one of the edges a working-tree tick can have been deferred on —
			// see `flushDeferredWorkingTree`. Nothing touches the RPC event buffer here (it tracks webview
			// visibility, not window focus), so this re-produce is the only thing that lands.
			this._wip.flushDeferredWorkingTree();
			this._wip.recoverDeferredSecondaryWip();
		}
	}

	onVisibilityChanged(visible: boolean): void {
		const repositoryChanged = this.repository != null && this.repository.etag !== this._etagRepository;
		if (visible && (repositoryChanged || this.container.subscription.etag !== this._etagSubscription)) {
			if (this.host.ready) {
				this._data.updateState(true);
				// Re-push fresh WIP through the dedicated channel, which has the freshness (cache-invalidate),
				// dedup, and commit/optimistic-edit guards `getState` lacks. Gated on `repositoryChanged`
				// (working-tree edits bump the repo etag); the dedup gate no-ops this when nothing changed.
				// (`flushDeferredWorkingTree` below re-produces for the same reason when a tick was owed;
				// the `_wipNotify` coalescer collapses the two into one read.)
				if (repositoryChanged) {
					void this._wip.notifyDidChangeWorkingTree();
				}
				// The rebuild above supersedes a deferred full-state refresh — drop it rather than also
				// firing a now-redundant notify that would join the in-flight state notify and cost a
				// second rebuild.
				this._pendingStateRefresh = false;
				// A deferred branch-state-only refresh is NOT superseded by the rebuild: the rebuild's own
				// branchState can go stale between its build and its send (see `runStateNotify`'s
				// revision-ordering strip), so the fast path still needs to run to land it.
				if (this._pendingBranchStateRefresh) {
					this._pendingBranchStateRefresh = false;
					void this._producers.notifyDidChangeBranchStateOnly();
				}
			}
		} else if (visible) {
			if (this._pendingStateRefresh) {
				this._pendingStateRefresh = false;
				void this._data.notifyDidChangeState();
			}
			if (this._pendingBranchStateRefresh) {
				this._pendingBranchStateRefresh = false;
				void this._producers.notifyDidChangeBranchStateOnly();
			}
		}

		// Flush any rows-plane state the publisher accumulated while hidden/not-ready. Nothing was ever
		// buffered — the flush gate kept every send off the wire, so the channel consumed no seq and the
		// receiver sees no gap; this ships one up-to-date delta (or snapshot) for the whole hidden window.
		if (visible) {
			void this._graphSync.flush();
		}

		void this.ensureAutoFetch();
		if (visible) {
			this._wip.recoverWorkingTreeStatsIfStuck();
			// Re-run the working-tree producer if a tick was owed while hidden. Deliberately a re-produce,
			// not a replay: the `workingTreeChanged` event's buffer only holds the last PRE-hide read, which
			// the user may have edited well past. Ordering is safe by construction — the controller flushes
			// the event buffer BEFORE calling this hook (`onParentVisibilityChanged`), and this re-produce
			// is a `git status` behind, so the fresh payload always lands last.
			this._wip.flushDeferredWorkingTree();
			this._wip.recoverDeferredSecondaryWip();
		}
	}

	private onGetCounts() {
		return this._data.onGetCounts();
	}

	private onAgentSessionsChanged(_sessions: AgentSessionState[]): void {
		// Agent membership drives the `agents` branches-visibility ref set, so any change to
		// the live session list needs to recompute the included refs and push a fresh
		// filters snapshot to the webview.
		if (this.repository == null) return;

		if (this.getBranchesVisibility(this.getFiltersByRepo(this.filtersRepoPath)) === 'agents') {
			void this.fireFiltersChanged();
		}
	}

	private async onGetWipStats(
		shas: string[],
		options?: { force?: boolean },
		signal?: AbortSignal,
	): Promise<GetWipStatsResponse> {
		const response: GetWipStatsResponse = {};
		if (shas.length === 0) return response;

		let cancellation: CancellationTokenSource | undefined;
		let onAbort: (() => void) | undefined;
		try {
			// When the user has disabled per-worktree WIP stats, short-circuit the graph-triggered
			// missing-stats calls. The graph's visible-scan dedup never re-asks for an unchanged
			// missing set, so leaving `workDirStats` undefined keeps the stats pill hidden.
			// Selection-driven fetches pass `force: true` to bypass the gate.
			if (!options?.force && !configuration.get('graph.showWorktreeWipStats')) {
				return response;
			}

			// Deliberately NOT keyed through `_cancellations`: these batches are siblings, not supersedes —
			// a scroll-driven scan, a hover force-fetch, and a selection force-fetch all land here. A shared
			// key made a later batch cancel an earlier one, and a cancelled batch returns below before
			// writing `response[sha]`, so the client saw missing entries for shas nobody ever re-asked about.
			// Each batch owns its token; where two of them overlap on a sha, the client orders that sha's
			// answers (`claimWipStatsRequest`) rather than either killing the other. Dispose cancels all.
			const source = (cancellation = new CancellationTokenSource());
			this._wipStatsCancellations.add(source);

			onAbort = () => source.cancel();
			if (signal?.aborted) {
				// Already aborted (e.g. a signal born aborted from wire deserialization) never fires
				// its own `abort` event — `addEventListener` alone would miss it.
				onAbort();
			} else {
				signal?.addEventListener('abort', onAbort, { once: true });
			}

			const batchSignal = toAbortSignal(source.token);
			const primaryRepoPath = this.repository?.path ?? this._data.session?.repoPath;

			await Promise.allSettled(
				shas.map(async sha => {
					// Peer worktrees only — the graph's own worktree's status group rides the working-tree
					// push channel, which is authoritative and would be clobbered by an on-demand read.
					const path = getWipRowWorktreePath(sha);
					if (path == null || path === primaryRepoPath) return;

					const svc = this.container.git.getRepositoryService(path);

					// Fetch the paused-op status in parallel with the cached status read so the
					// secondary WIP row can render the same in-progress indicator (rebase/merge/
					// cherry-pick) the primary's action bar does. `pausedOps` is optional on the
					// service surface; older providers may not implement it.
					const [statusResult, pausedOpResult] = await Promise.allSettled([
						this._wip.getStatusFromCache(path, batchSignal),
						// `force` so a missed `'pausedOp'` FS-watcher tick on this secondary worktree
						// can't leave the WIP row stuck on a stale in-progress indicator.
						svc.pausedOps?.getPausedOperationStatus?.({ force: true }, batchSignal),
					]);
					if (source.token.isCancellationRequested) return;

					const status = getSettledValue(statusResult);
					// No status at all means the read FAILED (rejected, or unparseable output) — not that the
					// worktree is clean: a clean one still parses to a status with no files. Omitting the sha
					// leaves the row's prior counts in place and stale, so it re-asks; zero-filling here
					// instead published "verified clean" for a worktree nobody managed to read, which draws a
					// confident clean glyph and hides the pill — the phantom-clean twin of a phantom-dirty row.
					if (status == null) return;

					const diff = status.diffStatus;
					const pausedOpStatus = getSettledValue(pausedOpResult);
					response[sha] = {
						workDirStats: {
							added: diff?.added ?? 0,
							deleted: diff?.deleted ?? 0,
							modified: diff?.changed ?? 0,
						},
						pausedOpStatus: pausedOpStatus,
						hasConflicts: status.hasConflicts,
					};
				}),
			);

			return response;
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetWipStats');
			// Record-shaped response — partial successes are preserved; missing keys read as undefined frontend-side.
			return response;
		} finally {
			if (cancellation != null) {
				this._wipStatsCancellations.delete(cancellation);
				cancellation.dispose();
			}
			if (onAbort != null) {
				signal?.removeEventListener('abort', onAbort);
			}
		}
	}

	private async onGetWipLineStats(
		repoPath: string,
		signal?: AbortSignal,
	): Promise<GetWipLineStatsResponse | undefined> {
		// Per-file line stats aren't carried by the every-tick `wip` push (`git status` can't emit
		// them); the webview requests them lazily only while the WIP file list is visible, so one
		// `git diff HEAD --numstat` (incl. untracked) here is the sole extra cost.
		// TODO(revisit): because the webview only re-requests on a `wip` change and pushes are deduped
		// by status content, pure line edits (same status) don't refresh these until a status change /
		// re-select / refresh — see `updateWipFileStats`. Per-save freshness would need host-driven
		// pushes on each working-tree tick while the panel is open.
		signal?.throwIfAborted();
		try {
			const svc = this.container.git.getRepositoryService(repoPath);
			const files = await svc.diff.getDiffStatus('HEAD', undefined, { includeUntracked: true });
			signal?.throwIfAborted();
			if (files == null) return undefined;

			// Key by normalized repo-relative path so the webview can match its `wip.changes.files`
			// entries regardless of separator/encoding differences. Untracked files carry no numstat
			// (`git diff` can't stat them) and are simply omitted.
			const response: GetWipLineStatsResponse = {};
			for (const file of files) {
				if (file.stats == null) continue;

				response[normalizePath(file.path)] = {
					additions: file.stats.additions,
					deletions: file.stats.deletions,
				};
			}
			return response;
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			Logger.error(ex, 'GraphWebviewProvider', 'onGetWipLineStats');
			return undefined;
		}
	}

	private onGetSidebarData(
		params: { panel: GraphSidebarPanel; displayed?: boolean },
		signal?: AbortSignal,
	): Promise<DidGetSidebarDataParams> {
		return this._panels.onGetSidebarData(params, signal);
	}

	private onSidebarToggleLayout(params: { panel: GraphSidebarPanel }): void {
		this._panels.onSidebarToggleLayout(params);
	}

	private onSidebarToggleShowRemoteBranches(): void {
		this._panels.onSidebarToggleShowRemoteBranches();
	}

	private onSidebarRefresh(params: { panel: GraphSidebarPanel }): void {
		this._panels.onSidebarRefresh(params);
	}

	private onSidebarAction(params: { command: GlCommands; context?: string; args?: unknown[] }): void {
		this._panels.onSidebarAction(params);
	}

	/**
	 * Emits `graph/{panel}/{item}Action` with `location: 'contextMenu'` for a sidebar right-click
	 * command. The origin gate covers both exclusions: inline (hover-icon) invocations are
	 * re-stamped 'sidebar-inline' in `onSidebarAction` (the webview already emitted
	 * `location: 'inline'`, so emitting here too would double-count dual-surface commands like
	 * fetch), and graph-canvas ref pills / the WIP header kebab produce the same `webviewItem`
	 * types but never carry the sidebar origin at all. The panel is resolved from the item's
	 * `webviewItem` context, so shared command ids attribute to the right panel.
	 */
	private emitSidebarContextMenuActionTelemetry(command: string, context: unknown): void {
		if (!isSidebarOriginContext(context)) return;

		const webviewItem = (context as { webviewItem?: string }).webviewItem;
		const resolved = resolveSidebarContextMenuAction(command, webviewItem);
		if (resolved == null) return;

		switch (resolved.type) {
			case 'branch':
				this.host.sendTelemetryEvent('graph/branches/branchAction', {
					action: resolved.action,
					alt: false,
					location: 'contextMenu',
				});
				break;
			case 'remote':
				this.host.sendTelemetryEvent('graph/remotes/remoteAction', {
					action: resolved.action,
					alt: false,
					location: 'contextMenu',
				});
				break;
			case 'worktree':
				this.host.sendTelemetryEvent('graph/worktrees/worktreeAction', {
					action: resolved.action,
					alt: false,
					location: 'contextMenu',
				});
				break;
			case 'tag':
				this.host.sendTelemetryEvent('graph/tags/tagAction', {
					action: resolved.action,
					alt: false,
					location: 'contextMenu',
				});
				break;
			case 'stash':
				this.host.sendTelemetryEvent('graph/stashes/stashAction', {
					action: resolved.action,
					alt: false,
					location: 'contextMenu',
				});
				break;
			case 'pullRequest':
				this.host.sendTelemetryEvent('graph/pullRequests/pullRequestAction', {
					action: resolved.action,
					alt: false,
					location: 'contextMenu',
				});
				break;
		}
	}

	/** Persists `changes` to the underlying settings and resolves once every write has landed —
	 *  the RPC promise's completion signal. The new config itself arrives separately, via the
	 *  config watcher (`onConfigurationChanged`) firing `notifyDidChangeConfiguration` once it
	 *  observes the write. */
	private async updateGraphConfig(changes: Partial<GraphComponentConfig>): Promise<void> {
		const config = this.getComponentConfig();

		const pending: Thenable<void>[] = [];

		let key: keyof Partial<GraphComponentConfig>;
		for (key in changes) {
			if (config[key] !== changes[key]) {
				switch (key) {
					case 'autoFetchEnabled':
						pending.push(configuration.updateEffective('graph.autoFetch.enabled', changes[key]));
						break;
					case 'minimapDataType':
						pending.push(configuration.updateEffective('graph.minimap.dataType', changes[key]));
						break;
					case 'minimapReversed':
						pending.push(configuration.updateEffective('graph.minimap.reversed', changes[key]));
						break;
					case 'minimapMarkerTypes': {
						const additionalTypes: GraphMinimapMarkersAdditionalTypes[] = [];

						const markers = changes[key] ?? [];
						for (const marker of markers) {
							switch (marker) {
								case 'localBranches':
								case 'remoteBranches':
								case 'stashes':
								case 'tags':
								case 'pullRequests':
								case 'worktree':
									additionalTypes.push(marker);
									break;
							}
						}
						pending.push(configuration.updateEffective('graph.minimap.additionalTypes', additionalTypes));
						break;
					}
					case 'dimMergeCommits':
						pending.push(configuration.updateEffective('graph.dimMergeCommits', changes[key]));
						break;
					case 'onlyFollowFirstParent':
						pending.push(configuration.updateEffective('graph.onlyFollowFirstParent', changes[key]));
						break;
					case 'detailsLocation': {
						// Persist 'auto' explicitly — `updateEffective` clears a value equal to the
						// default, and an unset `graph.details.location` re-triggers the first-time
						// (hidden details) experience. Window-scoped setting, so only user/workspace
						// can hold a value.
						const value = changes[key];
						if (value === 'auto') {
							pending.push(
								configuration.update(
									'graph.details.location',
									value,
									configuration.inspect('graph.details.location')?.workspaceValue !== undefined
										? ConfigurationTarget.Workspace
										: ConfigurationTarget.Global,
								),
							);
						} else {
							pending.push(configuration.updateEffective('graph.details.location', value));
						}
						break;
					}
					case 'sidebarPinned':
						pending.push(configuration.updateEffective('graph.sidebar.pinned', changes[key]));
						break;
					case 'style':
						pending.push(configuration.updateEffective('graph.style', changes[key]));
						break;
					case 'activityDecay':
						pending.push(
							configuration.updateEffective(
								'graph.experimental.visualizations.activityDecay',
								changes[key],
							),
						);
						break;
					default:
						// TODO:@eamodio add more config options as needed
						debugger;
						break;
				}
			}
		}

		if (pending.length) {
			await Promise.all(pending);
		}
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		// The catch-all `graph` block below already pushes the new component config to the webview;
		// here we only need to re-arm the auto-fetch loop when the toggle flips.
		if (configuration.changed(e, 'graph.autoFetch.enabled')) {
			void this.ensureAutoFetch();
		}

		if (configuration.changed(e, 'graph.experimental.visualizations.enabled')) {
			this.subscribeToTreemapInvalidations();
		}

		if (configuration.changed(e, 'graph.showWorkingTreeBadge')) {
			this._wip.resetBadgeCount();
			if (configuration.get('graph.showWorkingTreeBadge')) {
				void this._wip.notifyDidChangeWorkingTree();
			} else {
				this._wip.clearWorkingTreeBadge();
			}
		}

		// Settings that feed the columns plane's snapshot rather than (or as well as) the component config:
		// - `graph.lanes.density` drives BOTH the lane spacing (via the config re-send in the `graph`
		//   catch-all below) AND the column-menu context (`lanes:density:*`, which the Expanded/Compact menu
		//   items toggle on). Without the columns push the menu item is one-way: the spacing changes but the
		//   item's `when` clause never flips to offer the opposite.
		// - The Changes column mode is a real setting overlaid into column config (see `getColumnSettings`) —
		//   a settings.json edit isn't part of the component-config catch-all, so the column (and the picker's
		//   current-mode highlight) would only re-render on the next reload.
		// - `graph.scrollMarkers.enabled`: the marker-toggle context items are only emitted while it's on, so
		//   flipping it from the settings page (not via a toggle command, which refreshes on its own) would
		//   leave the gear submenu and the rail menu empty.
		if (
			configuration.changed(e, ['graph.lanes.density', 'graph.changesColumn.mode', 'graph.scrollMarkers.enabled'])
		) {
			this.fireColumnsChanged();
		}

		// The worktree clean/dirty probe only feeds the overview bar, so it's skipped while the bar is
		// hidden (see `probeSecondaryWipInBackground`). Run it now that the bar can appear again —
		// otherwise its secondary pills would stay unprobed until the next graph load.
		if (
			configuration.changed(e, 'graph.overviewBar.visibility') &&
			configuration.get('graph.overviewBar.visibility') !== 'never'
		) {
			this._wip.probeSecondaryWipInBackground();
		}

		// Enabling the Changes column's stats consent starts the stats-bearing rebuild with the same eager
		// spinner flow as un-hiding the column; the component-config re-send (catch-all below) flips the
		// webview out of its dormant overlay. Disabling needs no rebuild — already-loaded stats just go unused.
		if (
			configuration.changed(e, 'graph.changesColumn.enabled') &&
			configuration.get('graph.changesColumn.enabled') &&
			!this._data.session?.current.includes?.stats &&
			!this.getColumnSettings(this.getColumns()).changes.isHidden
		) {
			this._data.rowsStatsLoadingOverride = true;
			this._graphSync.mark('rowsStats');
			void this._graphSync.flush();
			this._data.updateState();
		}

		// `graph.showUpstreamStatus` feeds `resetRefsMetadata`'s feature-on/off decision (upstream is
		// local-git data, so it keeps metadata populatable even with no integration). The catch-all `graph`
		// block below only re-sends the component config — re-evaluate the gate here too, but only when the
		// feature is currently off/unpopulated (`null`/`undefined`) so connected repos with populated
		// metadata don't needlessly re-fetch and flicker on the toggle.
		if (configuration.changed(e, 'graph.showUpstreamStatus') && this._producers.refsMetadata == null) {
			this._producers.resetRefsMetadata();
			// REPLACE the webview's refsMetadata map over the reset event — a same-enabled wipe/enable.
			// Keep `updateState(true)` for the rest of the config-derived state; it reuses the loaded graph
			// (etag unchanged), so no re-walk.
			this._producers.fireRefsMetadataChanged();
			this._data.updateState(true);
		}

		if (configuration.changed(e, 'graph.commitOrdering')) {
			this._data.updateState();

			return;
		}

		if (
			configuration.changed(e, 'views.branches.branches') ||
			configuration.changed(e, 'views.branches.showRemoteBranches') ||
			configuration.changed(e, 'views.remotes.branches') ||
			configuration.changed(e, 'views.tags.branches') ||
			configuration.changed(e, 'views.worktrees.branches') ||
			configuration.changed(e, 'sortBranchesBy') ||
			configuration.changed(e, 'sortTagsBy') ||
			configuration.changed(e, 'sortWorktreesBy')
		) {
			this._panels.notifySidebarInvalidated();
		}

		if (
			configuration.changed(e, 'advanced.abbreviatedShaLength') ||
			configuration.changed(e, 'ai.enabled') ||
			configuration.changed(e, 'defaultCurrentUserNameStyle') ||
			configuration.changed(e, 'defaultDateFormat') ||
			configuration.changed(e, 'defaultDateStyle') ||
			// Feeds the component config's `gitHealthAvailable`. Without a re-push, enabling it with a graph
			// already open (exactly what `gitlens.showGitHealth`'s prompt does) leaves the Health tab hidden
			// and routes the requested visualization to the timeline until the webview reloads.
			configuration.changed(e, 'gitOptimizations.enabled') ||
			configuration.changed(e, 'graph')
		) {
			this.notifyDidChangeConfiguration();

			if (
				configuration.changed(e, 'defaultCurrentUserNameStyle') ||
				configuration.changed(e, 'graph.onlyFollowFirstParent') ||
				((configuration.changed(e, 'graph.minimap.enabled') ||
					configuration.changed(e, 'graph.minimap.defaultVisibility') ||
					configuration.changed(e, 'graph.minimap.dataType')) &&
					this.minimapNeedsStats() &&
					!this._data.session?.current.includes?.stats)
			) {
				this._data.updateState();
			}
		}
	}

	private onWorkspaceConfigurationChanged(e: ConfigurationChangeEvent) {
		// The host signing override feeds `wip.signing` (the commit box's "will be signed"
		// indicator) via `getSigningConfig`, which reads the setting through a live getter — a
		// WIP re-push is enough to refresh it. Secondary-worktree panels refresh on their next
		// watcher tick instead; acceptable for a rare settings change.
		if (e.affectsConfiguration('git.enableCommitSigning')) {
			void this._wip.notifyDidChangeWorkingTree();
		}

		if (!e.affectsConfiguration('git.autofetch') && !e.affectsConfiguration('git.autofetchPeriod')) return;

		this.notifyDidChangeConfiguration();
		void this.ensureAutoFetch();
	}

	@trace({ args: false })
	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.type !== 'workspace') return;

		if (e.keys.includes('graph:state')) {
			// If the minimap just became visible and we skipped stats on the last fetch, refetch now
			if (this.minimapNeedsStats() && !this._data.session?.current.includes?.stats) {
				this._data.updateState();
			}
		}

		if (e.keys.includes('graph:wipDrafts') && this.repository != null) {
			// Push the latest scoped draft map to this webview so a concurrent provider's write
			// (other graph instance, host-initiated undo from a different webview) lands here
			// without waiting for the next full state push.
			this._wip.notifyDidChangeWipDrafts();
		}

		if (e.keys.includes('graph:filtersByRepo')) {
			// Filters are per-repo but each provider only pushed its OWN writes — so a second graph (editor
			// tab + sidebar view) never learned about the other's hide/pin/visibility change. Storage fires
			// in-process for every provider, including the writer, whose own write also fires: the extra
			// emission is a duplicate of the identical complete snapshot, so it's idempotent.
			void this.fireFiltersChanged();
		}

		if (e.keys.includes('graph:columns')) {
			// Columns are workspace-wide, but each provider only pushed its OWN writes — so a second graph
			// (editor tab + sidebar view) never learned about the other's resize/hide/group. Storage fires
			// in-process for every provider, including the writer, whose own `updateColumns` also fires:
			// the extra emission is a duplicate of the identical complete snapshot, so it's idempotent.
			this.fireColumnsChanged();
		}
	}

	private isMinimapVisible(): boolean {
		if (!configuration.get('graph.minimap.enabled')) return false;

		const visibility = configuration.get('graph.minimap.defaultVisibility');
		// `onSearch` can surface the minimap on any search and we can't re-walk history mid-search, so
		// treat it as always visible. `hidden` has no such trigger — it can only be surfaced by the
		// header toggle, which writes storage and lands in `onStorageChanged` to refetch on demand.
		if (visibility === 'onSearch') return true;

		return this.container.storage.getWorkspace('graph:state')?.panels?.minimap?.visible ?? visibility === 'always';
	}

	/** Whether the minimap needs per-row line stats included in the graph walk. */
	private minimapNeedsStats(): boolean {
		return configuration.get('graph.minimap.dataType') === 'lines' && this.isMinimapVisible();
	}

	@trace({ args: false })
	private onFeaturePreviewChanged(e: FeaturePreviewChangeEvent) {
		if (e.feature !== 'graph') return;

		void this.fireAccessChanged(e);
	}

	private getFeaturePreview(): FeaturePreview {
		return this.container.subscription.getFeaturePreview('graph');
	}

	@trace()
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		// Filter out queued events from a previous repo. `_repository` swaps before the prior
		// subscription is disposed, so a queued `onDidChange` from the old repo can dispatch in
		// the window and drive notifications against the new one. Same guard as
		// `onRepositoryWorkingTreeChanged`.
		if (e.repository.id !== this.repository?.id) return;

		// While only the account-access screen is shown, the graph data is neither loaded nor displayed —
		// skip all repo-driven WIP/branch/state work (mirrors the guard in `onRepositoryWorkingTreeChanged`).
		if (this._accountAccessRequired) return;

		// A `worktrees` change reaches every session sharing the physical `.git` directory, including the
		// session for a worktree deleted out from under it — so an EXTERNAL `git worktree remove` of the
		// currently rebound worktree lands here. `onDidChangeRepositories`'s `removed`-keyed recovery can't
		// catch that: a rebound worktree is never added to `openRepositories` (it's resolved with
		// `opened: false`), so external deletion never fires a `removed` batch for it.
		if (e.changed('worktrees')) {
			void this.recoverFromDeletedRebindWorktree().catch((ex: unknown) =>
				Logger.error(ex, 'GraphWebviewProvider', 'recoverFromDeletedRebindWorktree'),
			);
		}

		// Lightweight WIP refresh — covers staging/unstaging (`index` → stats), `.gitignore` edits
		// (`ignores` → which untracked files appear in `git status`), secondary-worktree add/remove
		// (`worktrees` → wipRowsById; also falls through to the structural gate below as a
		// backstop full-state push), tracking changes (`head|heads|remotes` → wip.branch.upstream,
		// which drives the "Publish" ↔ "Create PR" next-step row in the details panel), and
		// `.git/config` edits (`config` → wip.signing; the watcher currently always pairs `config`
		// with `remotes`, but don't rely on that classifier detail). Unioned so the in-flight
		// coalescer can't double-fire on a single multi-flag event (e.g. Pull's
		// `head, heads, remotes, index`).
		if (e.changed('head', 'heads', 'index', 'ignores', 'remotes', 'worktrees', 'config')) {
			void this._wip.notifyDidChangeWorkingTree();
		}

		// FETCH_HEAD-only signal: refresh just the displayed fetch time, no need to rebuild
		// the full state. Force re-arm the periodic interval so it picks up the fresh value
		// (and starts running if there was no FETCH_HEAD before this fetch). Debounced because
		// real-world startup logs showed 4 `lastFetched` events firing in a 350ms burst (FS watcher
		// observing serial git internal writes to `.git/FETCH_HEAD`) — collapsing them into one
		// downstream call avoids 4× the IPC + 4× re-arming of the periodic interval.
		if (e.changed('lastFetched')) {
			this._lastFetchedHandlerDebounced ??= debounce(() => {
				void this.notifyDidFetch();
				void this.ensureLastFetchedSubscription(true);
				void this.ensureAutoFetch();
			}, 100);
			this._lastFetchedHandlerDebounced();
		}

		// Drop stale refsMetadata.issue cache entries on any `config` event. In practice `.git/config`
		// writes are classified as `[config, remotes]` (the classifier can't cheaply tell a remote.*
		// write from any other key change), so this is always paired with the `remotes` flag in the
		// structural gate below, which runs `getState` → re-fetches fresh refsMetadata. There's no
		// dedicated config-exclusive fast path because `e.changedExclusive('config')` would never
		// match in the wild.
		if (e.changed('config')) {
			this._producers.clearRefsMetadataIssues();
		}

		if (
			!e.changed(
				'head',
				'heads',
				// 'index',
				'remotes',
				// 'remoteProviders',
				'starred',
				'stash',
				'pausedOp',
				'tags',
				'unknown',
				'worktrees',
			)
		) {
			this._etagRepository = e.repository.etag;
			return;
		}

		// Branch tips, stored merge targets, and remote tracking can all move the merge-base anchor
		// scope relies on. Drop the host-side overview cache and signal the webview to drop its
		// mirrored merge-base cache so the next scope resolve recomputes against fresh refs.
		// (config-only events are handled above; this branch covers heads/remotes mixed with anything.)
		if (e.changed('heads', 'remotes')) {
			this.invalidateScopeAnchors();
			// Local/remote tips moved → cached ahead/behind is stale. Re-fetch the tracked branches in place
			// (delta), the one event that actually changes upstream counts — NOT every state push.
			this._producers.invalidateUpstreamRefsMetadata();
		}

		// Invalidate sidebar panels only for changes that actually affect their data. Skipping this for
		// config/unknown/pausedOp changes prevents the sidebar from showing a spinner during unrelated
		// repo activity (e.g. worktrees discovered during graph scroll fire `unknown` repo events).
		// Deferred to post-rebuild (see consumer in `notifyDidChangeState`) so the webview's refetch
		// reads the updated graph session.
		if (e.changed('heads', 'remotes', 'stash', 'tags', 'worktrees')) {
			this._sidebarEventCounter.next();
		}

		// Fast-path: refresh branchState immediately so push/pull/fetch ahead/behind land in the
		// header without waiting for the full graph rebuild. The full state pipeline re-sends
		// branchState; the webview dedups equal values (see the `branchState` guard in
		// stateProvider.ts's `state.onStateChanged` handler), so the worst case is a redundant push
		// discarded on receipt.
		if (e.changed('head', 'heads', 'remotes')) {
			void this._producers.notifyDidChangeBranchStateOnly();
		}

		// Unless we don't know what changed, update the state immediately
		this._data.updateState(!e.changedExclusive('unknown'));
	}

	/**
	 * Recovery for a rebound worktree deleted EXTERNALLY (a terminal `git worktree remove`) — see the call
	 * site in {@link onRepositoryChanged} for why the `onDidChangeRepositories`-keyed recovery can't cover
	 * it. Confirms the bound worktree is actually gone before recovering: a `worktrees` event fires for ANY
	 * worktree add/remove in the family, not just this one's.
	 */
	private async recoverFromDeletedRebindWorktree(): Promise<void> {
		if (this._rebindHome == null || this._repository == null) return;

		const bound = this._repository;
		const stillExists = await this.isLiveFamilyWorktree(this._rebindHome, bound.path);
		if (stillExists) return;

		// Defense-in-depth: re-check after the await — a same-family repo switch or an unrelated rebind
		// could have landed while `getWorktrees` was in flight.
		if (this._rebindHome == null || this._repository !== bound) return;

		void this.rebindRepository(undefined).catch((ex: unknown) =>
			Logger.error(ex, 'GraphWebviewProvider', 'recoverFromDeletedRebindWorktree'),
		);
	}

	/**
	 * Whether `targetPath` is still a live worktree of `homeRepo`'s family. Always queried from HOME, never
	 * from `targetPath` itself: a git spawn whose cwd IS the possibly-already-gone worktree fails with
	 * ENOENT, which isn't a reliable "is it gone" signal on its own — home's cwd is guaranteed valid.
	 */
	private async isLiveFamilyWorktree(homeRepo: GlRepository, targetPath: string): Promise<boolean> {
		const worktrees = await homeRepo.git.worktrees?.getWorktrees();
		if (worktrees != null) {
			return worktrees.some(w => getRepositoryKey(w.path) === getRepositoryKey(targetPath));
		}

		return isFolderUri(Uri.file(targetPath));
	}

	@trace({ args: false })
	private onRepositoryWorkingTreeChanged(e: RepositoryWorkingTreeChangeEvent) {
		if (e.repository.id !== this.repository?.id) return;
		// Skip WIP git-status work while only the account-access screen is shown.
		if (this._accountAccessRequired) return;

		void this._wip.notifyDidChangeWorkingTree();
	}

	@trace({ args: false })
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;

		const wasAccountAccessRequired = this._accountAccessRequired;
		this._accountAccessRequired = isAccountAccessRequired(e.current);

		// When the account-access state flips in either direction, reload the full state rather than
		// sending a subscription-only push. The full `getState` push carries subscription + repositories
		// (+ rows) atomically and clears the working-tree badge on the access path, which:
		//  - keeps the access screen up until the graph data is ready when entering a usable account (a
		//    subscription-only push would un-gate the screen while `repositories` is still `[]`, flashing
		//    the "no repository" empty state), and
		//  - on entering the access screen, cancels any in-flight full-path `getState` (whose stale
		//    signed-in state would otherwise overwrite the signed-out one) and clears a stale badge.
		if (wasAccountAccessRequired !== this._accountAccessRequired && this.host.ready) {
			if (
				!this._accountAccessRequired &&
				this._pendingAction?.action === 'scope-to-branch' &&
				this._pendingAction.target == null
			) {
				void this.warnIfScopeToCurrentBranchDetached({ skipAccessCheck: true });
			}

			this._data.updateState(true);
			return;
		}

		// A Pro-access flip (upgrade, manual reactivation, or the trial auto-reset — which is kicked
		// off from `getState` itself) makes any in-flight state build stale: its `allowed`/
		// `subscription` snapshot would re-gate the Graph when it ships, so a full rebuild follows
		// (superseding it via the coalesced-run refire, not cancelling it). Deliberately fires in
		// both directions, even with no build in flight — a re-gate needs fresh state too.
		if (
			isSubscriptionTrialOrPaidFromState(e.previous.state) !==
				isSubscriptionTrialOrPaidFromState(e.current.state) &&
			this.host.ready
		) {
			this._data.updateState(true);
			return;
		}

		void this.fireAccessChanged();
	}

	/** One-time nudge for the #5545 move of the Graph into the side bar — assumes the side bar stays
	 *  the Graph's default container (constants.views.ts). It only applies to the Graph *view* (side
	 *  bar/panel host) — the editor tab has no side-vs-bottom placement to choose. */
	private getLayoutPromptNeeded(): boolean {
		return this.host.is('view') && !this.container.onboarding.isDismissed('graph:layoutPrompt');
	}

	/** Fires the toolbar's "open the Send Feedback dialog" push — see {@link GraphFeedbackService}. */
	showFeedback(): void {
		this._requestShowFeedbackEvent.fire({ source: 'toolbar' });
	}

	/** RPC handler for the Send Feedback dialog's submit — sends the record, opens a prefilled GitHub
	 *  issue for bug reports (whether or not the send itself succeeded), offers one from the toast for
	 *  feature requests, and reports the outcome via telemetry and an info toast. */
	private async onSendFeedback(input: GraphFeedbackInput): Promise<GraphFeedbackResult> {
		const isBug = input.type === 'bug_report';

		let sent = false;
		try {
			await this.container.feedback.send({ ...input, surface: 'graph', githubIssueOpened: isBug });
			sent = true;
		} catch {
			// Already logged by the service; the outcome rides the result (and telemetry) below.
		}

		let issueOpened = false;
		if (isBug) {
			void openUrl(getFeedbackIssueUrl(this.container, 'bug_report', input.message));
			issueOpened = true;
		}

		this.host.sendTelemetryEvent('graph/feedback/submitted', {
			type: input.type,
			outcome: sent ? 'success' : 'failed',
			issueOpened: issueOpened,
		});

		if (isBug) {
			void window.showInformationMessage("Thanks. We've opened a GitHub issue so you can add more details.");
		} else if (sent && input.type === 'feature_request') {
			// Opt-in, unlike bugs: a one-line "would be nice" shouldn't force a public issue, but a real
			// ask belongs where enhancements are actually tracked and discussed.
			void this.offerFeatureRequestIssue(input.message);
		} else if (sent) {
			void window.showInformationMessage('Thanks for the feedback. The team will use it to improve GitLens.');
		}

		return { sent: sent, issueOpened: issueOpened };
	}

	private async offerFeatureRequestIssue(message: string): Promise<void> {
		const file = { title: 'File on GitHub' };
		const result = await window.showInformationMessage(
			'Thanks for the feedback. The team will use it to improve GitLens.',
			file,
		);
		if (result !== file) return;

		void openUrl(getFeedbackIssueUrl(this.container, 'feature_request', message));
	}

	/** RPC handler for the whole welcome-continue interaction — see docs/webview-architecture.md
	 *  ("cross-transport ordering") for why this rides one supertalk message instead of the two
	 *  legacy IPC commands it replaces. */
	private async onWelcomeContinueToGraph(options: { layoutChoice: 'sidebar' | 'panel' | 'dismissed' }) {
		// Persist BOTH welcome dismissals FIRST — opening the welcome view or moving the graph churns
		// the workbench, which can revert an in-flight global-memento write. Settled independently so
		// one failing write can't skip the other; a failed write is logged but doesn't block the user's
		// explicit layout choice. One-shot prompt: any answer, including closing without choosing,
		// dismisses it for good.
		const results = await Promise.allSettled([
			this.container.onboarding.dismiss('graph:intro'),
			this.container.onboarding.dismiss('graph:layoutPrompt'),
		]);
		for (const result of results) {
			if (result.status === 'rejected') {
				Logger.error(result.reason, 'GraphWebviewProvider', 'Failed to persist a welcome dismissal');
			}
		}

		void this.container.usage.track('action:gitlens.graph.walkthrough.started:happened');
		void commands.executeCommand('gitlens.showWelcomeView', { mode: 'graph' });

		// Resolve before the moves — the ack means "dismissals persisted", and a response still
		// pending when the move destroys the calling webview is dropped with a logged error.
		void this.applyWelcomeLayoutChoice(options.layoutChoice);
	}

	private async applyWelcomeLayoutChoice(choice: 'sidebar' | 'panel' | 'dismissed'): Promise<void> {
		if (choice === 'dismissed') return;

		if (choice === 'sidebar') {
			// An explicit move, not `resetViewLocation`: "reset to default" resolves the default from the
			// window's live view registry, which still holds the OLD (bottom panel) default when the
			// upgrade landed via an extension-host-only restart — the button would silently no-op until
			// the window reloads. The GitLens container itself is never re-located: wherever the user
			// keeps it is a real preference.
			try {
				await executeCoreCommand('vscode.moveViews', {
					viewIds: [this.host.id],
					destinationId: 'workbench.view.extension.gitlens',
				});
			} catch {}
		} else {
			try {
				await executeCoreCommand('vscode.moveViews', {
					viewIds: [this.host.id],
					destinationId: 'workbench.view.extension.gitlensPanel',
				});
			} catch {}
			try {
				await executeCoreCommand('workbench.view.extension.gitlensPanel.resetViewContainerLocation');
			} catch {}
		}
		// Re-reveal — the move leaves the view collapsed/unfocused. The prompt only exists on the
		// view host (see getLayoutPromptNeeded), so the view id is the right target here.
		void executeCoreCommand('gitlens.views.graph.focus');
	}

	private onThemeChanged(theme: ColorTheme) {
		if (
			this._theme != null &&
			((isDarkTheme(theme) && isDarkTheme(this._theme)) || (isLightTheme(theme) && isLightTheme(this._theme)))
		) {
			return;
		}

		this._theme = theme;
		this._data.updateState();
	}

	/** The webview's columns write. Resolves only once the storage write has landed and the columns
	 *  event has fired, so the caller can treat resolution as "my write is no longer outstanding". */
	private async setColumns(config: GraphColumnsConfig): Promise<void> {
		await this.updateColumns(config, { keepStoredModes: true });

		const eventData: WebviewTelemetryEvents['graph/columns/changed'] = {};
		for (const [name, cfg] of Object.entries(config)) {
			for (const [prop, value] of Object.entries(cfg)) {
				eventData[`column.${name}.${prop as keyof GraphColumnConfig}`] = value;
			}
		}
		this.host.sendTelemetryEvent('graph/columns/changed', eventData);
	}

	// The Changes mode picker's pick. Changes' mode is a real setting (single source of truth): write it
	// effectively so a settings.json round-trip works both directions. Other columns' modes stay in storage
	// (only the graph column's compact toggle uses that path). Mode is still never webview-authored via
	// `updateColumns` — this is the only mode write path from the webview. The new mode echoes back through
	// the settings watcher (`onConfigurationChanged` → `fireColumnsChanged`), not from here.
	private async updateColumnMode(name: GraphColumnName, mode: ColumnMode | undefined): Promise<void> {
		if (name !== 'changes') return;

		await configuration.updateEffective('graph.changesColumn.mode', changesModeOrDefault(mode));
	}

	/** The dormant Changes column's one-time stats consent. The echo is cross-plane: `graph.changesColumn.enabled`
	 *  feeds the component config, so it arrives over `configuration.onDidChange`, not the columns event. */
	private async enableChangesColumn(): Promise<void> {
		await configuration.updateEffective('graph.changesColumn.enabled', true);
	}

	private async setDisplayMode(mode: GraphDisplayMode): Promise<void> {
		if (this._displayMode === mode) return;

		this._displayMode = mode;

		// Visualizations (Visual History) needs row stats — refetch if the current graph was loaded without them.
		if (mode === 'visualizations' && !this._data.session?.current.includes?.stats) {
			// Flip the loading flag eagerly so the timeline shows its overlay during the refetch (the
			// stats-including rebuild hasn't landed, so `rowsStatsDeferred` can't report loading yet). Cleared
			// in `setGraph` when the stats graph lands; shipped over the rowsStats channel (no dual writer).
			this._data.rowsStatsLoadingOverride = true;
			this._graphSync.mark('rowsStats');
			await this._graphSync.flush();
			this._data.updateState();
		} else if (mode !== 'visualizations' && this._data.rowsStatsLoadingOverride) {
			// Left Visualizations before the stats rebuild landed — clear the eager override (else the
			// stats-loading spinner sticks forever) and ship the cleared flag over the rowsStats channel.
			this._data.rowsStatsLoadingOverride = false;
			this._graphSync.mark('rowsStats');
			await this._graphSync.flush();
		}
	}

	/** Ref pill double-click (row double-click is a no-op — the app handles it locally). */
	private async handleRefDoubleClick(ref: GraphRef, metadata?: GraphRefMetadataItem): Promise<void> {
		if (!ref.context) return;

		let item = this.getGraphItemContext(ref.context);
		if (!isGraphItemRefContext(item)) return;

		if (metadata != null) {
			item = this.getGraphItemContext(metadata.data.context);
			if (metadata.type === 'upstream' && isGraphItemTypedContext(item, 'upstreamStatus')) {
				const { ahead, behind, ref: itemRef } = item.webviewItemValue;
				if (behind > 0) {
					await RepoActions.pull(itemRef.repoPath, itemRef);
					return;
				}
				if (ahead > 0) {
					await RepoActions.push(itemRef.repoPath, false, itemRef);
					return;
				}
			} else if (metadata.type === 'pullRequest' && isGraphItemTypedContext(item, 'pullrequest')) {
				await this._commands.openPullRequestOnRemote(item);
				return;
			} else if (metadata.type === 'issue' && isGraphItemTypedContext(item, 'issue')) {
				await this.openIssueOnRemote(item);
				return;
			}

			return;
		}

		const { ref: itemRef } = item.webviewItemValue;
		if (ref.refType === 'head' && ref.isCurrentHead) {
			await RepoActions.switchTo(itemRef.repoPath);
			return;
		}

		// Override the default confirmation if the setting is unset
		await RepoActions.switchTo(
			itemRef.repoPath,
			itemRef,
			configuration.isUnset('gitCommands.skipConfirmations') ? true : undefined,
		);
	}

	private async mergePullRequest(
		number: string,
		options?: { confirmed?: boolean; mergeMethod?: 'merge' | 'squash' | 'rebase' },
	): Promise<MergePullRequestResult> {
		const resolved = await this._panels.resolvePullRequestForMerge(number);
		if (resolved == null) {
			void window.showErrorMessage(`Unable to resolve pull request #${number}`);
			return { merged: false };
		}

		const { integration, pr } = resolved;
		// A sheet-side confirmation already named the blast radius in place; only unconfirmed callers
		// (e.g. the branch sheet's chip) get the quick pick.
		if (!options?.confirmed && !(await confirmPullRequestMerge(pr))) return { merged: false };

		const mergeMethod = options?.mergeMethod != null ? mergeMethodsByName[options.mergeMethod] : undefined;

		const result = await mergePullRequestWithProgress(
			integration,
			pr,
			mergeMethod != null ? { mergeMethod: mergeMethod } : undefined,
		);
		if (result !== 'merged') {
			if (result === 'cancelled') {
				// The merge can still land after we stop waiting for it, so refresh the same PR-affected
				// state a successful merge does.
				this._panels.resetPullRequests();
				this.container.launchpad.refresh();
				this.refreshAfterPullRequestMerge();
			}

			return { merged: false };
		}

		this._panels.resetPullRequests();
		// Launchpad holds its own 30-minute PR cache; a merge from the graph must not leave it serving the merged PR.
		this.container.launchpad.refresh();
		this.refreshAfterPullRequestMerge();

		return { merged: true };
	}

	/** Re-pulls PR-affected state after a merge (attempted or confirmed) without tearing down the
	 *  webview's iframe — `host.refresh(true)` re-mounts it and destroys the sheet stack the user is
	 *  looking at. Mirrors the `graph.showUpstreamStatus` toggle's refsMetadata reset (see the
	 *  `onConfigurationChanged` handler) plus a full state repush, so ref pills, the sidebar pull-requests
	 *  panel, and branch overview chips all re-fetch in place. */
	private refreshAfterPullRequestMerge(): void {
		this._producers.resetRefsMetadata();
		this._producers.fireRefsMetadataChanged();
		this._panels.notifySidebarInvalidated();
		this._panels.notifyDidChangeOverview();
		this._data.updateState(true);
	}

	// Not a registered command — invoked only by `handleRefDoubleClick` for issue ref-metadata badges.
	@debug()
	private openIssueOnRemote(item?: GraphItemContext): Promise<void> {
		if (isGraphItemTypedContext(item, 'issue')) {
			const { url } = item.webviewItemValue;
			void executeCommand<OpenIssueOnRemoteCommandArgs>('gitlens.openIssueOnRemote', {
				issue: { url: url },
			});
		}

		return Promise.resolve();
	}

	/**
	 * Row hover markdown. Single-flight via `cancelOperation('hover')`/`createCancellation('hover')` —
	 * a newer call always supersedes an outstanding one. `signal` bridges a superseded/torn-down RPC
	 * call into the same per-call cancellation token; `cancelOperation('hover')` above is the fallback
	 * for two concurrent hovers that arrive without a signal. Never rejects — a rejected RPC promise
	 * would leave the hover card waiting instead of falling back (see the outer catch).
	 */
	private async getRowHover(type: GitGraphRowKind, id: string, signal?: AbortSignal): Promise<DidGetRowHoverParams> {
		const hover: DidGetRowHoverParams = {
			id: id,
			markdown: undefined!,
		};

		this.cancelOperation('hover');

		let onAbort: (() => void) | undefined;

		try {
			if (this._data.session != null) {
				let markdown = this._hoverCache.get(id);
				if (markdown == null) {
					const cancellation = this.createCancellation('hover');
					onAbort = () => cancellation.cancel();
					if (signal?.aborted) {
						// Already aborted (e.g. a signal born aborted from wire deserialization) never fires
						// its own `abort` event — `addEventListener` alone would miss it.
						onAbort();
					} else {
						signal?.addEventListener('abort', onAbort, { once: true });
					}

					let cache = true;
					let commit;
					try {
						const wipWorktreePath = type === 'workdir' ? getWipRowWorktreePath(id) : undefined;
						const isSecondaryWip =
							wipWorktreePath != null && wipWorktreePath !== this._data.session.repoPath;
						const hoverRepoPath = isSecondaryWip ? wipWorktreePath : this._data.session.repoPath;
						const svc = this.container.git.getRepositoryService(hoverRepoPath);
						switch (type) {
							case 'workdir':
								cache = false;
								// The uncommitted pseudo-commit's `repoPath` carries the worktree path the
								// WIP tooltip shows — no worktree lookup needed.
								commit = await svc.commits.getCommit(uncommitted, toAbortSignal(cancellation.token));
								break;
							case 'stash': {
								const stash = await svc.stash?.getStash(undefined, toAbortSignal(cancellation.token));
								commit = stash?.stashes.get(id);
								break;
							}
							default: {
								commit = await svc.commits.getCommit(id, toAbortSignal(cancellation.token));
								break;
							}
						}
					} catch (ex) {
						if (!isCancellationError(ex)) throw ex;
					}

					if (commit != null && !cancellation.token.isCancellationRequested) {
						// Check if we have calculated stats for the row and if so apply it to the commit
						const stats = this._data.session.current.rowsStats?.get(commit.sha);
						if (stats != null) {
							commit = commit.with({
								stats: {
									...commit.stats,
									additions: stats.additions,
									deletions: stats.deletions,
									// If `changedFiles` already exists, then use it, otherwise use the files count
									files: commit.stats?.files ? commit.stats.files : stats.files,
								},
							});
						}

						markdown = this.getCommitTooltip(commit, cancellation.token).catch((ex: unknown) => {
							this._hoverCache.delete(id);
							throw ex;
						});
						if (cache) {
							this._hoverCache.set(id, markdown);
						}
					}
				}

				if (markdown != null) {
					try {
						hover.markdown = {
							status: 'fulfilled' as const,
							value: await markdown,
						};
					} catch (ex) {
						hover.markdown = { status: 'rejected' as const, reason: ex };
					}
				}
			}

			hover.markdown ??= { status: 'rejected' as const, reason: new CancellationError() };
			return hover;
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'getRowHover');
			// Return a structurally-valid response so the app's RPC call resolves
			// quickly (not a timeout) and the hover render can show a fallback.
			return {
				id: id,
				markdown: { status: 'rejected' as const, reason: ex },
				error: ex instanceof Error ? ex.message : String(ex),
			};
		} finally {
			if (onAbort != null) {
				signal?.removeEventListener('abort', onAbort);
			}
		}
	}

	private async getCommitTooltip(commit: GitCommit, cancellation: CancellationToken) {
		if (commit.isUncommitted) {
			return this._wip.getWipTooltip(commit, cancellation);
		}

		const template = configuration.get(
			`views.formats.${GitCommit.isStash(commit) ? 'stashes' : 'commits'}.tooltip`,
		);

		const showSignature =
			configuration.get('signing.showSignatureBadges') && CommitFormatter.has(template, 'signature');

		const svc = this.container.git.getRepositoryService(commit.repoPath);
		const [remotesResult, _, signedResult] = await Promise.allSettled([
			svc.remotes.getBestRemotesWithProviders(),
			GitCommit.ensureFullDetails(commit, { include: { stats: true } }),
			showSignature ? isCommitSigned(commit.repoPath, commit.sha) : undefined,
		]);

		if (cancellation.isCancellationRequested) throw new CancellationError();

		const remotes = getSettledValue(remotesResult, []);
		const [remote] = remotes;
		const signed = getSettledValue(signedResult);

		let enrichedAutolinks;
		let pr;

		if (remote != null && remoteSupportsIntegration(remote)) {
			const [enrichedAutolinksResult, prResult] = await Promise.allSettled([
				pauseOnCancelOrTimeoutMapTuplePromise(
					getCommitEnrichedAutolinks(commit.repoPath, commit.message, commit.summary, remote),
					toAbortSignal(cancellation),
				),
				getCommitAssociatedPullRequest(commit.repoPath, commit.sha, remote),
			]);

			if (cancellation.isCancellationRequested) throw new CancellationError();

			const enrichedAutolinksMaybeResult = getSettledValue(enrichedAutolinksResult);
			if (!enrichedAutolinksMaybeResult?.paused) {
				enrichedAutolinks = enrichedAutolinksMaybeResult?.value;
			}
			pr = getSettledValue(prResult);
		}

		this._getBranchesAndTagsTips ??= await svc.getBranchesAndTagsTipsLookup();

		return CommitFormatter.fromTemplateAsync(
			template,
			commit,
			{ source: 'graph' },
			{
				enrichedAutolinks: enrichedAutolinks,
				dateFormat: configuration.get('defaultDateFormat'),
				getBranchAndTagTips: this._getBranchesAndTagsTips,
				messageAutolinks: true,
				messageIndent: 4,
				pullRequest: pr,
				outputFormat: 'markdown',
				remotes: remotes,
				signed: signed,
				// unpublished: this.unpublished,
			},
		);
	}

	/** Resolves avatar URIs for the asked emails and RETURNS them — the session's map is the cache, so an
	 *  email already in it costs nothing. Nothing is pushed: the app merges the response into its own map. */
	private async getMissingAvatars(emails: GraphAvatars): Promise<Record<string, string>> {
		const session = this._data.session;
		if (session == null) return {};

		const repoPath = session.repoPath;

		const getAvatar = async (email: string, id: string): Promise<void> => {
			const uri = await getAvatarUri(email, { ref: id, repoPath: repoPath });
			session.current.avatars.set(email, uri.toString(true));
		};

		const promises: Promise<void>[] = [];

		for (const [email, id] of Object.entries(emails)) {
			if (session.current.avatars.has(email)) continue;

			promises.push(getAvatar(email, id));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
		}

		const resolved: Record<string, string> = {};
		for (const email of Object.keys(emails)) {
			const url = session.current.avatars.get(email);
			if (url == null) continue;

			resolved[email] = url;
		}

		return resolved;
	}

	private readonly _avatarProxyCache = new DedupedAsyncCache<string, Uri | undefined>();
	private readonly _avatarProxyFailed = new Set<string>();

	/** Re-fetches avatars the webview couldn't load (CSP/CORS) as data URIs and RETURNS them. Only the
	 *  entries that actually proxied come back — the rest keep whatever the app already holds. */
	private async proxyAvatars(avatars: Record<string, string>): Promise<Record<string, string>> {
		const session = this._data.session;
		if (session == null) return {};

		const entries = Object.entries(avatars);
		if (entries.length === 0) return {};

		const proxied: Record<string, string> = {};
		await Promise.allSettled(
			entries.map(([email, url]) => {
				if (url.startsWith('data:') || this._avatarProxyFailed.has(url)) return Promise.resolve();

				return this._avatarProxyCache
					.getOrResolve(url, () => fetchAvatarImageAsDataUri(url))
					.then(uri => {
						if (uri != null) {
							if (this._data.session?.current.avatars.get(email) !== url) return;

							const dataUri = uri.toString(true);
							this._data.session.current.avatars.set(email, dataUri);
							proxied[email] = dataUri;
						} else {
							this._avatarProxyFailed.add(url);
						}
					});
			}),
		);

		return proxied;
	}

	/** Pages rows in until a host-initiated reveal/select target `id` is loaded, then ships the selection.
	 *  Uses `limit: 0` for an UNCAPPED targeted walk: the default page size caps the walk at
	 *  `pageItemLimit*10` (~2000) and would never reach a commit deeper than that (e.g. "Open in Commit
	 *  Graph" on an old commit). The scroll/scope-anchor paging keeps the cap — see `onGetMoreRows`. */
	private async revealRow(id: string): Promise<void> {
		await this._data.onGetMoreRows(id, 0, true);

		// The rows push above only ever projects a HIGHLIGHT; the selection push is what drives
		// `ensureRowVisible` → `navigateToCommit`, so the row also scrolls and adopts the anchor. Re-check
		// `_selectedId`: this walk is uncapped and nothing cancels it, so a click mid-walk would otherwise
		// make us ship that newer selection and scroll the user back to it.
		if (this._selectedId === id && this._data.session?.current.ids.has(id)) {
			this.notifyDidChangeSelection();
		}
	}

	private async executeRowAction(params: RowActionParams): Promise<void> {
		const primaryRepoPath = this._data.session?.repoPath;
		if (primaryRepoPath == null) return;

		// A WIP row's synthetic id encodes its own worktree path (the primary's resolves back to
		// `primaryRepoPath`); every other row type acts on the graph's repo.
		const rowRepoPath =
			(params.row.type === 'workdir' ? getWipRowWorktreePath(params.row.id) : undefined) ?? primaryRepoPath;

		switch (params.action) {
			case 'undo-commit': {
				// Build the revision ref directly and delegate to the shared core. Skipping the
				// `GraphItemContext` round-trip avoids both (a) a fragile synthetic context (the
				// runtime `isWebviewItemContext` guard requires a `webview` field the IPC payload
				// has no business knowing about) and (b) the redundant unwrap inside `undoCommit`.
				// The dialog/WIP message is resolved from the actual commit inside `CommitActions.undoCommit`,
				// so we don't thread a (display-emojified) message through the webview.
				const ref = createReference(params.row.id, primaryRepoPath, { refType: 'revision' });
				await this._undoCommit(ref, params.worktreePath);
				break;
			}
			case 'stash-save':
				await StashActions.push(rowRepoPath);
				break;
			case 'stash-apply':
			case 'stash-pop':
			case 'stash-drop': {
				// Look up the real stash so we pass the proper `stashName`/`stashNumber`. The wizards
				// build `stash@{N}` from these, and a missing number produces an invalid `stash@{undefined}`
				// that fails the deleteStash/pop identity check and silently throws.
				const stash = this._data.session?.current.stashes?.get(params.row.id);
				if (stash == null) break;

				const ref = createReference(params.row.id, rowRepoPath, {
					refType: 'stash',
					name: stash.stashName ?? params.row.id,
					number: stash.stashNumber,
					message: stash.message,
				});

				if (params.action === 'stash-apply') {
					await StashActions.apply(rowRepoPath, ref);
				} else if (params.action === 'stash-pop') {
					await StashActions.pop(rowRepoPath, ref);
				} else {
					await StashActions.drop(rowRepoPath, [ref]);
				}
				break;
			}
			case 'open-changes':
			case 'open-changes-with-working': {
				const commit = await this.container.git
					.getRepositoryService(rowRepoPath)
					.commits.getCommit(params.row.id);
				if (commit == null) break;

				if (params.action === 'open-changes-with-working') {
					await openCommitChangesWithWorking(this.container, commit, false, this.getOpenEditorShowOptions());
				} else {
					await openCommitChanges(this.container, commit, false, this.getOpenEditorShowOptions());
				}
				break;
			}
			case 'push-to-commit':
				await this.pushUpToCommit(rowRepoPath, params.row.id);
				break;
			case 'run-task':
			case 'run-task-pick':
				void executeCommand<RunTaskOnWorktreeCommandArgs>('gitlens.runTaskOnWorktree', {
					worktreePath: rowRepoPath,
					useDefault: params.action === 'run-task',
				});
				break;
		}
	}

	private async openTreemapFile(action: 'open' | 'history', repoPath: string, path: string): Promise<void> {
		// Rehydrate the file URI through the repo's own URI so the original scheme survives —
		// `Uri.file()` would coerce virtual-workspace paths (vscode-vfs://, GitHub virtual provider)
		// to a non-resolving file:// URI.
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return;

		const uri = Uri.joinPath(repo.uri, path);
		switch (action) {
			case 'open':
				await commands.executeCommand('vscode.open', uri);
				return;
			case 'history':
				await commands.executeCommand('gitlens.openFileHistory', uri);
		}
	}

	private async chooseRepository(): Promise<void> {
		// // Ensure that the current repository is always last
		// const repositories = this.container.git.openRepositories.sort(
		// 	(a, b) =>
		// 		(a === this.repository ? 1 : -1) - (b === this.repository ? 1 : -1) ||
		// 		(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
		// 		a.index - b.index,
		// );

		const { title, placeholder } = getRepositoryPickerTitleAndPlaceholder(
			this.container.git.openRepositories,
			'Switch',
			this.repository?.name,
		);
		const pick = await showRepositoryPicker(
			this.container,
			title,
			placeholder,
			this.container.git.openRepositories,
			{ picked: this.repository },
		);
		if (pick == null) return;

		this.repository = pick;
		this.host.sendTelemetryEvent('graph/repository/changed', {
			'repository.id': this.repository?.idHash,
			'repository.scheme': this.repository?.uri.scheme,
			'repository.closed': !this.repository?.opened,
			'repository.folder.scheme': this.repository?.folder?.uri.scheme,
			'repository.provider.id': this.repository?.provider.id,
		});
	}

	private async chooseAccountOrg(): Promise<void> {
		await executeCommand<Source>('gitlens.gk.switchOrganization', { source: 'graph' });
	}

	private async chooseRef(
		title: string,
		placeholder: string,
		options?: {
			allowedAdditionalInput?: ReferencesQuickPickOptions2['allowedAdditionalInput'];
			include?: ReferencesQuickPickOptions2['include'];
			picked?: string;
		},
	): Promise<DidChooseRefParams> {
		if (this.repository == null) return undefined;

		try {
			const result = await showReferencePicker2(this.repository.path, title, placeholder, {
				allowedAdditionalInput: options?.allowedAdditionalInput,
				include: options?.include ?? ['branches', 'tags'],
				picked: options?.picked,
			});
			const pick = result?.value;

			return pick?.sha != null
				? {
						id: pick.id,
						name: pick.name,
						sha: pick.sha,
						refType: pick.refType,
						graphRefType: convertRefToGraphRefType(pick),
					}
				: undefined;
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'chooseRef');
			// The response type is `DidChooseRefParams | undefined`; `undefined` is the existing
			// no-pick semantics so the frontend treats it as "user cancelled" rather than crashing.
			return undefined;
		}
	}

	// `placeholder` isn't part of the signature — `showComparisonPicker` supplies its own per-step
	// placeholder text; only `title` carries through from the caller (matches the pre-RPC behavior).
	private async chooseComparison(title: string): Promise<DidChooseComparisonParams> {
		if (this.repository == null) return { range: undefined };

		const result = await showComparisonPicker(this.container, this.repository.path, {
			getTitleAndPlaceholder: step => {
				switch (step) {
					case 1:
						return {
							title: title,
							placeholder: 'Choose a branch or tag to show commits from',
						};
					case 2:
						return {
							title: title,
							placeholder: 'Choose a base to compare against (e.g., main)',
						};
				}
			},
		});

		return { range: result != null ? `${result.base.ref}..${result.head.ref}` : undefined };
	}

	private async chooseAuthor(title: string, placeholder: string, picked?: string[]): Promise<DidChooseAuthorParams> {
		if (this.repository == null) return { authors: undefined };

		const authorsPicked = picked != null ? new Set(picked) : undefined;
		const contributors = await showContributorsPicker(this.container, this.repository, title, placeholder, {
			appendReposToTitle: true,
			clearButton: true,
			multiselect: true,
			picked: c =>
				authorsPicked != null &&
				((c.email != null && authorsPicked.has(c.email)) ||
					(c.name != null && authorsPicked.has(c.name)) ||
					(c.username != null && authorsPicked.has(c.username))),
		});

		return { authors: contributors != null ? filterMap(contributors, c => c.email) : undefined };
	}

	private async chooseFile(
		title: string,
		type: 'file' | 'folder',
		options?: { openLabel?: string; picked?: string[] },
	): Promise<DidChooseFileParams> {
		if (this.repository == null) return { files: undefined };

		const uris = await window.showOpenDialog({
			canSelectFiles: type === 'file',
			canSelectFolders: type === 'folder',
			canSelectMany: type === 'file',
			title: title,
			openLabel: options?.openLabel,
			defaultUri: this.repository.folder?.uri,
		});

		if (!uris?.length) return { files: undefined };

		// Convert URIs to relative paths from the repository root
		const files = uris.map(uri => this.container.git.getRelativePath(uri, this.repository!.path));
		return { files: files };
	}

	private async resolveGraphScope(
		repoPath: string,
		scope: GraphScope,
		signal?: AbortSignal,
	): Promise<DidResolveGraphScopeParams> {
		try {
			const anchor = await this.resolveScopeAnchor(repoPath, scope.branchName, signal);
			return {
				scope: {
					...scope,
					mergeBase: anchor?.mergeBase,
					resolvedMergeTargetTipSha: anchor?.mergeTargetTipSha,
					resolvedMergeTargetName: anchor?.mergeTargetName,
					resolvedFocalBranchTipSha: anchor?.focalBranchTipSha,
				},
			};
		} catch (ex) {
			if (!isCancellationError(ex)) {
				Logger.error(ex, 'GraphWebviewProvider', 'resolveGraphScope');
			}
			// Return the caller-supplied scope as a fallback so consumers reading `scope.mergeBase`,
			// `scope.resolvedMergeTargetTipSha`, etc. don't crash on undefined property access.
			return { scope: scope, error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	/** Serializes {@link rebindRepository} calls — see there for why. `undefined` once no rebind is
	 *  running. */
	private _rebindPromise: Promise<DidRebindGraphParams> | undefined;

	/** True for exactly the span of `session.rebind()`'s own walk inside {@link rebindRepositoryCore} —
	 *  touched ONLY there, so nothing else can turn it off early.
	 *
	 *  ONE consumer, and it is correctness: `getState`'s `reuseGraph` gate. Reuse is an unsynchronized READ
	 *  of `session.current` that never enters the session's write queue, and a rebind's fast path re-stamps
	 *  REUSED window rows IN PLACE as it walks, so an ungated reuse landing mid-walk ships a window with
	 *  some ids at the old path and some at the new. The session can't gate that for us — `current` is a
	 *  plain getter with no notion of who is reading — so the reader gates itself. */
	private _rebindInFlight = false;

	/**
	 * Re-perspectives the live graph session onto `worktreePath` — a worktree of the SAME repo family as
	 * the currently bound repository — without the `repository` setter's full teardown (which disposes the
	 * session and clears `_selection`/`_searchRequest`; a same-family rebind must keep all three).
	 * `worktreePath === undefined` restores the recorded {@link _rebindHome} binding.
	 *
	 * Two rebinds are NOT allowed to run concurrently. The session serializes its own walks, but the HOST
	 * state each call mutates around the walk (`_repository`, `_etagRepository`, `_rebindHome`, the
	 * optimistic cache invalidations, and the restore its `catch` performs) is not covered by that, and two
	 * overlapping calls would interleave it. Calls queue onto {@link _rebindPromise} and run one at a time
	 * in {@link rebindRepositoryCore}; a queued call first reserves its own cancellation slot, which cancels
	 * a still-running prior rebind so its walk aborts instead of running to completion to be discarded.
	 */
	private rebindRepository(worktreePath: string | undefined): Promise<DidRebindGraphParams> {
		const cancellation = this.createCancellation('rebind');
		const prior = this._rebindPromise;
		// The `_rebindPromise` clear lives INSIDE this IIFE (not a `run.finally(...)` chained onto the
		// returned promise) so there's no second, unobserved promise: `.finally()`/`.then()` derive a NEW
		// promise, and a rejection the caller correctly catches would still surface as an unhandled
		// rejection on that discarded derivative. Boxed because a bare self-reference inside the IIFE trips
		// TS's definite-assignment check.
		const ref: { promise?: Promise<DidRebindGraphParams> } = {};
		ref.promise = (async (): Promise<DidRebindGraphParams> => {
			// Only for ordering — a prior call's own failure already resolved (not rejected) per this
			// method's contract, so this `catch` only guards against an unexpected throw escaping it.
			if (prior != null) {
				await prior.catch(() => undefined);
			}

			try {
				return await this.rebindRepositoryCore(worktreePath, cancellation);
			} finally {
				if (this._rebindPromise === ref.promise) {
					this._rebindPromise = undefined;
				}
			}
		})();

		this._rebindPromise = ref.promise;
		return ref.promise;
	}

	/**
	 * Refuses (a `refused` result, never a rejection) when there's nothing to rebind onto, the target
	 * isn't a same-family worktree, there's no live session to rebind, or the repository/session moved
	 * out from under a drained concurrent load before this call could apply its swap. Runs only inside
	 * {@link rebindRepository}'s serialized section — no two calls execute this body concurrently.
	 *
	 * The refusal REASON is part of the contract, not diagnostics: `superseded` means something NEWER
	 * already owns the UI, so the webview rolls back NOTHING; every other reason is terminal and rolls the
	 * optimistic perspective back immediately.
	 */
	private async rebindRepositoryCore(
		worktreePath: string | undefined,
		cancellation: CancellationTokenSource,
	): Promise<DidRebindGraphParams> {
		// Not `@debug()`/`@trace()`-decorated, so there is no ambient scope for `getScopedLogger()` to read —
		// it would silently return `undefined` and the walk-outcome log below would never fire.
		// `maybeStartScopedLogger` creates its own scope; grabbed here, before any `await`, per the same
		// "stale after await" rule the decorator has.
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.rebindRepositoryCore`);
		try {
			// Already superseded before we ever started — a later `rebindRepository` took the `'rebind'`
			// cancellation slot while this call sat queued. Bail BEFORE the optimistic mutations below:
			// running the body would swap the binding, invalidate the caches, then have `session.rebind`
			// abort on the dead token and report `failed` — a "couldn't scope" toast for a request the very
			// next one in the queue is about to satisfy.
			if (cancellation.token.isCancellationRequested) return { refused: 'superseded' };

			// COLD OPEN: `showWorktreeInGraph` can open the graph and fire this before the host has bound a
			// repository or adopted a session. Park on the first load rather than refusing — the webview has
			// no retry latch, so a refusal here would drop the gesture on the floor.
			if (this._repository == null || this._data.session == null) {
				await this._data.loading?.catch(() => undefined);

				if (this._data.session == null) {
					await this._data.whenSessionReady(cancellation.token);
				}

				if (cancellation.token.isCancellationRequested) return { refused: 'superseded' };
			}

			const current = this._repository;
			if (current == null) return { refused: 'unavailable' };

			let target: GlRepository | undefined;
			if (worktreePath === undefined) {
				target = this._rebindHome;
				// No recorded home means the graph is not rebound, so a clear is already satisfied. Succeed
				// as a no-op rather than refuse: a refusal would make the webview revert its perspective and
				// re-show a "scoped" state it can then never clear, since every unscope would repeat it.
				if (target == null) return { repoPath: current.path, previousRepoPath: current.path };

				// Defense-in-depth: the `repository` setter clears `_rebindHome` on any unrelated switch,
				// so this should always be same-family already — but refuse rather than silently rebind
				// the CLI session onto an unrelated path if that invariant is ever violated.
				if (!isSameRepoFamily(target, current)) {
					return { refused: 'unavailable' };
				}
			} else {
				target = await this.container.git.getOrAddRepository(Uri.file(worktreePath), {
					opened: false,
					detectNested: true,
				});
				if (target == null) return { refused: 'unavailable' };
				// Already showing exactly what was asked for, so the request is satisfied. Succeed as a no-op
				// rather than refuse: a refusal would make the webview revert a perspective that is correct.
				if (target === current) return { repoPath: current.path, previousRepoPath: current.path };

				// Same-family only — mirrors the family guard in `onShowing`'s repo-switch path above.
				if (!isSameRepoFamily(target, current)) {
					return { refused: 'unavailable' };
				}
			}

			// The park above already gave the cold open its chance; still no session means there is nothing
			// to rebind.
			if (this._data.session == null) return { refused: 'unavailable' };

			// This drain protects HOST state, not the walks — the session's own write queue keeps those
			// apart. The block below mutates `_repository` and a batch of caches BEFORE any walk starts,
			// while an in-flight `getState` reads `this.repository` repeatedly as it assembles ONE state
			// object; swapping the binding underneath that build pushes a state assembled half from one repo
			// and half from the other. Draining puts the swap BETWEEN state builds, and it is what makes the
			// identity re-check below meaningful. (`_data.loading` is always the LAST getState promise and is
			// never reset to `undefined`, so awaiting it is a no-op unless a walk is genuinely in flight.)
			await this._data.loading?.catch(() => undefined);

			// Re-check after the await: a repo swap or a teardown could have landed while draining (a
			// superseding rebind cannot have — we're already inside the serialized section): the request was
			// for a binding the user has since moved off.
			if (this._repository !== current || this._data.session == null) return { refused: 'superseded' };

			// Pinned so the post-walk commit can prove it's still writing into the SAME session it walked —
			// see the revalidation below.
			const session = this._data.session;
			const previous = current;
			const previousEtagRepository = this._etagRepository;
			const previousRebindHome = this._rebindHome;
			// True when THIS call is an unscope. If a `repository` setter switch lands mid-walk and supersedes
			// this call, nothing else clears the persisted `home → worktree` entry — without this, the
			// dismissed scope would resurrect on the next window reload.
			const isUnscope = previousRebindHome != null && target === previousRebindHome;
			// Narrows `previousRebindHome` for the superseded-unscope branches below — `isUnscope` is a
			// separately-computed boolean and narrows nothing.
			const unscopedHome = isUnscope ? previousRebindHome : undefined;

			if (target === previousRebindHome) {
				// Rebinding back to home — the `undefined` path, or a worktree path resolving to it.
				this._rebindHome = undefined;
			} else {
				this._rebindHome ??= previous;
			}

			// Bypass the `repository` setter — its full teardown is for switching to an UNRELATED repo. A
			// same-family rebind keeps the session, `_selection`, `_searchRequest`, and selected rows; only
			// the light side effects below (mirroring the setter's non-teardown lines) apply.
			this._repository = target;
			this.ensureRepositorySubscriptions(true);
			void this.ensureAutoFetch();
			this._sidebarEventCounter.next();
			this.resetHoverCache();
			// The hover-formatter's memoized branch/tag-tips lookup bakes the current-branch marker in at
			// build time, so without this the hovers rebuilt above would mark the OLD binding's branch as
			// current. (`resetRepositoryState` clears it on a plain switch.)
			this._getBranchesAndTagsTips = undefined;
			this._producers.setLastSentBranchState(undefined);
			this._producers.invalidateUpstreamRefsMetadata();
			this._wip.resetSendState();
			this.invalidateScopeAnchors();

			// Sticky for the whole walk regardless of what `getState` does concurrently — the load key can't
			// carry this, since `getState` reassigns `_lastGraphLoadKey` on EVERY call, so a racing getState
			// would un-poison it for the next. See its field doc for the one thing it gates.
			this._rebindInFlight = true;
			try {
				const result = await session.rebind(target.path, toAbortSignal(cancellation.token));
				// Still correct, just slower — the session already fell back to a full walk at the new path.
				if (result.path === 'fast') {
					scope?.info(`[graph] incremental walk: fast (+${result.added ?? 0} new rows)`);
				} else {
					scope?.info(`[graph] incremental walk: fallback (${result.reason ?? 'rebind'})`);
				}
			} catch (ex) {
				// The panel closed while we walked — `dispose` cancelled this token, then tore down the
				// repository subscriptions, the `lastFetched` interval, and the session. Restoring here would
				// RE-CREATE a repo watcher and a fetch interval whose owners are already gone, leaving them
				// firing for the rest of the extension's life. Nothing is left to restore into.
				if (this._disposed) {
					// The optimistic swap never landed and nothing will restore `_rebindHome`, so only an
					// unscope has an entry left to drop — syncing a scope here would persist a perspective
					// the walk never reached.
					if (unscopedHome != null) {
						void this.syncPersistedPerspective(unscopedHome);
					}

					return { refused: 'superseded' };
				}

				// Only restore if nothing superseded us while we awaited — a repo switch through the
				// `repository` setter (which cancels this token; see there) or the CATCH path of a QUEUED
				// successor. Restoring then would drag the binding back off whatever the user just chose.
				if (this._repository === target) {
					this._repository = previous;
					this._etagRepository = previousEtagRepository;
					this._rebindHome = previousRebindHome;
					this.ensureRepositorySubscriptions(true);
					void this.syncPersistedPerspective();
					// The optimistic invalidations above (hover cache, refsMetadata, WIP dedup, scope
					// anchors) already fired against the now-abandoned target — push a rebuild so the
					// webview lands on the RESTORED repo's data instead of stalling on stale invalidations.
					this._data.updateState(true);
				} else if (unscopedHome != null) {
					// Superseded, and the binding was NOT restored (something else now owns `_repository`) —
					// an unscope's entry must not outlive it. Nothing else to sync here: whoever owns the
					// binding now has already persisted its own perspective.
					void this.syncPersistedPerspective(unscopedHome);
				}

				// Cancelled, not broken: a queued successor took the `'rebind'` slot, or the `repository`
				// setter superseded us. The user is about to get the state THEY asked for, so reporting a
				// scope failure would toast about an attempt that was correctly abandoned.
				if (cancellation.token.isCancellationRequested || isCancellationError(ex)) {
					return { refused: 'superseded' };
				}

				Logger.error(ex, 'GraphWebviewProvider', 'rebindRepository');
				return { refused: 'failed' };
			} finally {
				this._rebindInFlight = false;
			}

			// NONE of the identity checks above survive the walk: a repo-picker switch, a repo removal, or a
			// panel dispose can replace `_repository` and the session while we're parked. Committing below
			// against a binding nobody is looking at any more would pin the WRONG repo's etag, re-stamp the
			// new binding's selection onto stale paths, and hand the webview a `repoPath` it must display as
			// scoped. Quietly superseded instead — the switch was the user's own doing.
			if (this._disposed || this._repository !== target || this._data.session !== session) {
				// Same rule as the catch path above: an overtaken unscope must not leave its entry behind,
				// and a scope the panel closed on stays unpersisted — its walk landed for nobody.
				if (unscopedHome != null) {
					void this.syncPersistedPerspective(unscopedHome);
				}

				return { refused: 'superseded' };
			}

			// Pinned here because this is the first point at which pinning it is TRUE — the walk landed, on
			// the binding we still hold. It is NOT a second gate on the reuse path: `_rebindInFlight` covers
			// that, which the etag never could, since `this._repository` and `session.repoPath` both read as
			// `target.path` from the moment this method begins.
			this._etagRepository = target.etag;
			this.restampSelectionRepoPath(previous.path, target.path);
			// Mirrors the `repository` setter's belt-and-suspenders: sweep any scope-anchor cache keyed to
			// the OLD path too (`invalidateScopeAnchors` above only fired for the new one).
			this._scopeAnchorsInvalidatedEvent.fire({ repoPath: previous.path });

			void this.syncPersistedPerspective(previousRebindHome);

			this._data.updateState(true);
			return { repoPath: target.path, previousRepoPath: previous.path };
		} finally {
			// Only clear/dispose OUR OWN cancellation-map entry — a queued successor may already have replaced
			// it with ITS token, and `cancelOperation` here would cancel+dispose that one instead.
			if (this._cancellations.get('rebind') === cancellation) {
				this._cancellations.delete('rebind');
			}
			cancellation.dispose();
		}
	}

	/** Re-stamps host-held repoPath-embedded refs after a successful rebind. A commit ref is family-wide, so
	 *  its `repoPath` follows the binding. A WIP/uncommitted ref IS a specific worktree (every family
	 *  worktree keeps its own WIP row after a rebind), so it must stay put — re-stamping it would move the
	 *  user's selection off the row they clicked and onto the rebound worktree's row. */
	private restampSelectionRepoPath(fromPath: string, toPath: string): void {
		if (fromPath === toPath) return;

		if (this._selection != null) {
			this._selection = this._selection.map(ref =>
				ref.repoPath === fromPath && !isUncommitted(ref.ref) ? { ...ref, repoPath: toPath } : ref,
			);
		}
	}

	// `signal` (not `save-last`): consumers sweep every cached anchor on receipt regardless of
	// `repoPath` (see `GraphScopeService.onScopeAnchorsInvalidated`) — over-invalidating is cheap, and a
	// hidden webview only needs to know that SOMETHING invalidated, not which repo, most recently.
	private readonly _scopeAnchorsInvalidatedEvent = createRpcEvent<{ repoPath: string }>(
		'scopeAnchorsInvalidated',
		'signal',
		{ repoPath: '' },
	);

	private invalidateScopeAnchors(): void {
		this._scopeAnchorCache.clear();

		const repoPath = this.repository?.path ?? this._data.session?.repoPath;
		if (repoPath == null) return;

		this._scopeAnchorsInvalidatedEvent.fire({ repoPath: repoPath });
	}

	/**
	 * Per-branch cache of resolved scope anchors. Cleared by `invalidateScopeAnchors` whenever
	 * heads/remotes/config move so a stale anchor can't survive a rebase. Holds promises so
	 * concurrent scope-resolves dedupe naturally.
	 *
	 * `focalBranchTipSha` is always set when the focal branch resolves; `mergeBase` /
	 * `mergeTargetTipSha` may be undefined when no merge target resolves to a tip — see
	 * `computeScopeAnchor`.
	 */
	private readonly _scopeAnchorCache = new Map<string, Promise<ResolvedScopeAnchor | undefined>>();

	/**
	 * Lightweight scope-anchor resolver: returns just `{focalBranchTipSha, mergeBase?, mergeTargetTipSha?}`
	 * without paying for `getContributors --shortstat` that `getBranchContributionsOverview` runs
	 * for the overview/sidebar contributors panel. The expensive overview path is still used by
	 * enrichment — this just stops scope from triggering it on cold branches that aren't already
	 * covered by the package-level `branchOverviews` cache.
	 */
	private async resolveScopeAnchor(
		repoPath: string,
		branchName: string,
		signal?: AbortSignal,
	): Promise<ResolvedScopeAnchor | undefined> {
		signal?.throwIfAborted();

		// Prefer the already-loaded branch from the in-memory graph snapshot — `session.current.branches`
		// is the same data `getBranches()` would return (same underlying cache), so this is a
		// synchronous shortcut on the hot path, not a different source of truth.
		const branch =
			this._data.session?.current.branches.get(branchName) ??
			(await this.container.git.getRepositoryService(repoPath).branches.getBranch(branchName));
		signal?.throwIfAborted();
		if (branch == null) return undefined;

		const cacheKey = branch.id;
		const cached = this._scopeAnchorCache.get(cacheKey);
		if (cached != null) return cached;

		const promise = this.computeScopeAnchor(branch);
		this._scopeAnchorCache.set(cacheKey, promise);
		// Don't poison the cache with a rejection — refresh paths invalidate explicitly anyway, but
		// a transient failure should be retryable on the next scope action.
		promise.catch(() => {
			if (this._scopeAnchorCache.get(cacheKey) === promise) {
				this._scopeAnchorCache.delete(cacheKey);
			}
		});
		return promise;
	}

	private async computeScopeAnchor(branch: GitBranch): Promise<ResolvedScopeAnchor> {
		const focalBranchTipSha = branch.sha;
		const svc = this.container.git.getRepositoryService(branch.repoPath);

		// Resolve target name — `getBranchMergeTargetInfo` already shares the underlying caches
		// with `getBranchContributionsOverview` (`getStoredMergeTargetBranchName`/`getBaseBranchName`/
		// `getDefaultBranchName`), so this doesn't add new git calls when the overview path also
		// fires for the same branch.
		const targetInfo = await getBranchMergeTargetInfo(this.container, branch, { timeout: 100 });
		// Use the immediate value; ignore the paused PR-resolution continuation. Scope doesn't need
		// to wait on PR API — base/default fall back covers the cold path while the eventual PR
		// answer (if any) reaches the scope via overview enrichment, where `reconcileScopeMergeTarget`
		// re-anchors live.
		const targetName =
			(targetInfo.mergeTargetBranch.paused ? undefined : targetInfo.mergeTargetBranch.value) ??
			targetInfo.baseBranch ??
			targetInfo.defaultBranch;
		if (targetName == null) return { focalBranchTipSha: focalBranchTipSha };

		// Prefer the in-memory branch list for the target tip, just like the focal branch above.
		const targetBranch =
			this._data.session?.current.branches.get(targetName) ?? (await svc.branches.getBranch(targetName));
		const mergeTargetTipSha = targetBranch?.sha;

		// A resolvable target ALWAYS anchors — even the branch's own upstream with equal tips (the default
		// branch up to date with its remote), where base == tip re-roots to a one-commit spine plus the
		// older-history fold. Bailing there would leave the scope bare, and a bare scope dims everything off
		// the focal first-parent line instead of scoping — for the default branch that line is the whole
		// trunk, so almost nothing dims. Note `getBranchMergeTargetStatusInfo` (overviewEnrichment.utils.ts)
		// still skips self-target status for the sidebars; that's safe because `reconcileScopeMergeTarget`
		// only backfills anchors from enrichment, never strips them.
		if (mergeTargetTipSha == null) return { focalBranchTipSha: focalBranchTipSha };

		const mergeBaseSha = await svc.refs.getMergeBase(branch.ref, targetName);
		if (mergeBaseSha == null) return { focalBranchTipSha: focalBranchTipSha };

		// Prefer the cheap dates-only lookup on desktop (git-cli); fall back to a full commit fetch
		// for providers that don't implement it (e.g. the GitHub provider used in vscode.dev).
		const dates = await svc.commits.getCommitDates?.(mergeBaseSha);
		const committerDate = dates?.committerDate ?? (await svc.commits.getCommit(mergeBaseSha))?.committer.date;
		if (committerDate == null) return { focalBranchTipSha: focalBranchTipSha };

		return {
			focalBranchTipSha: focalBranchTipSha,
			mergeBase: { sha: mergeBaseSha, date: committerDate.getTime() },
			mergeTargetTipSha: mergeTargetTipSha,
			mergeTargetName: targetName,
		};
	}

	/** `GraphSelectionService.updateSelection` — the app's report of what the user selected. Runs
	 *  undebounced: the coalescing now lives on the APP side of the wire (see the wrapper's
	 *  `sendSelectionDebounced`), so an arrow-key scrub arrives here already collapsed to its final row. */
	private updateSelection(selection: GraphSelection[]): void {
		// An empty selection echo must never clear the selection hint we already hold. The webview only
		// sends a real (non-empty) selection on user intent; an empty report is transient (the GK can't
		// resolve a synthetic WIP row yet) or a scope/visibility filter-out, both of which the webview
		// handles by keeping its inspection anchor and deriving an empty highlight. The host's
		// `_selectedId`/`_selection` are now only a getGraph paging hint + command-target fallback, so
		// leave them intact on an empty echo.
		if (!selection.length && this._selectedId != null) return;

		const item = selection.find(r => r.active) ?? selection[0];
		this.setSelectedRows(item?.id, selection, { selected: true, hidden: item?.hidden });
		this.fireSelectionChanged(item?.id, item?.type);
	}

	private fireSelectionChanged(id: string | undefined, type: GitGraphRowKind | undefined) {
		if (this.repository == null) return;

		// A WIP row's synthetic id encodes its own worktree path — use it (not the graph's repo path)
		// so fallback-to-activeSelection commands operate on the worktree the user actually clicked.
		const repoPath = (type === 'workdir' ? getWipRowWorktreePath(id) : undefined) ?? this.repository.path;
		const commit = this.getRevisionReference(repoPath, id, type);
		this._selection = commit != null ? [commit] : undefined;
	}

	private getRevisionReference(
		repoPath: string | undefined,
		id: string | undefined,
		type: GitGraphRowKind | undefined,
	): GitStashReference | GitRevisionReference | undefined {
		if (repoPath == null || id == null) return undefined;

		switch (type) {
			case 'stash':
				return createReference(id, repoPath, {
					refType: 'stash',
					name: id,
					number: undefined,
				});

			case 'workdir':
				return createReference(uncommitted, repoPath, { refType: 'revision' });

			default:
				return createReference(id, repoPath, { refType: 'revision' });
		}
	}

	/**
	 * Coalesces `DidFetch` pushes into a single in-flight `getLastFetched()` read with one trailing
	 * re-fire, rather than one read + `_repoStatusEvent.fire()` per trigger. Bursts are routine:
	 * `.git/FETCH_HEAD` force-fires `lastFetched` on any FS touch (see `Repository.onFetchHeadChanged`),
	 * and real-world startup logs showed 4 events in a 350ms window.
	 */
	private readonly _didFetchNotify = new CoalescedRun<boolean>(
		() => this.runNotifyDidFetch(),
		() => void this.notifyDidFetch(),
	);
	/** Last-sent fetch time — skips pushes when `lastFetched` didn't actually advance. */
	private _lastSentFetchedAt: number | undefined;

	// Debounced handler for repository `lastFetched` events. Coalesces 100ms bursts of FETCH_HEAD
	// FS-watcher events that real-world git operations produce (`git fetch` writes the file in
	// multiple steps, the watcher sees each one) into a single downstream refresh.
	private _lastFetchedHandlerDebounced: Deferrable<() => void> | undefined = undefined;

	/** The complete columns + contexts snapshot. Both planes build it: `settingsContext` (the gear menu)
	 *  is derived from the column settings AND the scroll-marker settings, so neither can push alone. */
	private getColumnsState(): GraphColumnsState {
		const columnSettings = this.getColumnSettings(this.getColumns());
		return {
			columns: columnSettings,
			headerContext: this.getColumnHeaderContext(columnSettings),
			settingsContext: this.getGraphSettingsIconContext(columnSettings),
			scrollMarkersContext: this.getScrollMarkersContext(),
		};
	}

	private fireColumnsChanged(): void {
		this._columnsChangedEvent.fire(this.getColumnsState());
	}

	/**
	 * The complete filters snapshot — branch visibility, hidden refs/types, included refs, and the pinned
	 * ref. All five are rebuilt from the same `graph:filtersByRepo` record, so one snapshot carries them all.
	 *
	 * `includeOnlyRefs` is two-phase: pass it in to build a snapshot around already-resolved refs; otherwise
	 * this resolves them under a 100ms budget and, when the resolve is still pending, lets it continue in the
	 * background — landing fires a SECOND complete snapshot rather than making the first paint wait.
	 *
	 * NOT safe to run concurrently with itself on the resolving path: `getIncludedRefs` supersedes through
	 * one shared cancellation key, so the older build resolves to an empty ref set. Pushes go through
	 * {@link fireFiltersChanged}, which coalesces for exactly that reason.
	 */
	@trace()
	private async getFiltersState(includeOnlyRefs?: GraphIncludeOnlyRefs): Promise<GraphFiltersState> {
		const graph = this._data.session?.current;
		const filters = this.getFiltersByRepo(this.filtersRepoPath);
		const state: GraphFiltersState = {
			branchesVisibility: this.getBranchesVisibility(filters),
			excludeRefs: this.getExcludedRefs(filters, graph) ?? {},
			excludeTypes: this.getExcludedTypes(filters) ?? {},
			includeOnlyRefs: includeOnlyRefs,
			pinnedRef: this.getPinnedRef(filters, graph),
		};

		if (includeOnlyRefs == null) {
			const includedRefsResult = await this.getIncludedRefs(filters, graph, { timeout: 100 });
			state.includeOnlyRefs = includedRefsResult.refs;
			void includedRefsResult.continuation?.then(refs => {
				if (refs == null) return;

				void this.fireFiltersChanged(refs);
			});
		}

		return state;
	}

	/**
	 * Coalesces filters pushes into a single in-flight build with one trailing re-fire. Overlapping builds
	 * would be worse than wasteful — see {@link getFiltersState} — and bursts are routine: every write fires
	 * once through the `graph:filtersByRepo` storage echo and once from the writer's own await. The trailing
	 * re-fire is an identical complete snapshot, so the duplicate push is idempotent.
	 */
	private readonly _filtersChangedNotify = new CoalescedRun<void>(
		() => this.runFireFiltersChanged(),
		() => void this.fireFiltersChanged(),
	);

	/** Fires the complete filters snapshot. Passing `includeOnlyRefs` skips the resolve (and the coalescer
	 *  with it) — that's the two-phase continuation publishing refs it already has in hand. */
	private async fireFiltersChanged(includeOnlyRefs?: GraphIncludeOnlyRefs): Promise<void> {
		if (includeOnlyRefs != null) {
			this._filtersChangedEvent.fire(await this.getFiltersState(includeOnlyRefs));
			return;
		}

		await this._filtersChangedNotify.run();
	}

	private async runFireFiltersChanged(): Promise<void> {
		this._filtersChangedEvent.fire(await this.getFiltersState());
	}

	@trace()
	private notifyDidChangeConfiguration(): void {
		this._configurationChangedEvent.fire(this.getComponentConfig());
	}

	private notifyDidFetch(): Promise<boolean> {
		return this._didFetchNotify.run();
	}

	@trace()
	private async runNotifyDidFetch(): Promise<boolean> {
		const repo = this.repository;
		if (repo == null) return false;

		const lastFetched = await repo.getLastFetched();
		// Re-validate after the await — a repo swap mid-read would fire the old repo's fetch time.
		if (this._repository !== repo) return false;
		// FETCH_HEAD force-fires `lastFetched` even when the time didn't advance, so most triggers
		// carry nothing new; skip those rather than fire an identical event.
		if (lastFetched === this._lastSentFetchedAt) return true;

		this._repoStatusEvent.fire({ repoPath: repo.path, lastFetched: lastFetched });
		this._lastSentFetchedAt = lastFetched;
		return true;
	}

	/** Pull-based counterpart to `_repoStatusEvent` — seeds a freshly connected app. */
	private async getRepoStatus(): Promise<GraphRepoStatus | undefined> {
		const repo = this.repository;
		if (repo == null) return undefined;

		const lastFetched = await repo.getLastFetched();
		if (this._repository !== repo) return undefined;

		return { repoPath: repo.path, lastFetched: lastFetched };
	}

	/** Complete gating snapshot — `getGraphAccess()` restamps `_etagSubscription`, so the dedupe in
	 *  `onSubscriptionChanged` stays keyed off the last snapshot the app was told about. */
	private async getAccessState(featurePreview?: FeaturePreview): Promise<GraphAccessState> {
		featurePreview ??= this.getFeaturePreview();
		const [access] = await this.getGraphAccess();
		return {
			subscription: access.subscription.current,
			allowed: this.isGraphAccessAllowed(access, featurePreview),
			featurePreview: featurePreview,
		};
	}

	@trace()
	private async fireAccessChanged(featurePreview?: FeaturePreview): Promise<void> {
		this._accessChangedEvent.fire(await this.getAccessState(featurePreview));
	}

	/** Pushes the current selection map to the app. Only HOST-initiated reveals call this — a user's own
	 *  click is never echoed back. The event is `save-last`, so a hidden webview replays the newest
	 *  payload on show and needs no re-produce entry of its own. */
	@trace()
	private notifyDidChangeSelection(): void {
		this._selectionChangedEvent.fire(convertSelectedRows(this._selectedRows));
	}

	private ensureRepositorySubscriptions(force?: boolean) {
		void this.ensureLastFetchedSubscription(force);
		if (!force && this._repositoryEventsDisposable != null) return;

		if (this._repositoryEventsDisposable != null) {
			this._repositoryEventsDisposable.dispose();
			this._repositoryEventsDisposable = undefined;
		}

		const repo = this.repository;
		if (repo == null) return;

		// Seed the membership baseline so the first genuine flip (connect/disconnect) is detected, and a
		// no-op re-publish of the context is a no-op here.
		this._producers.seedHostingIntegrationConnected(repo.path);

		this._repositoryEventsDisposable = Disposable.from(
			// `onDidChange` only subscribes to the emitter — it does NOT drive it. The `.git`-directory watch
			// those events ride is inert until something holds a `.watch()` lease. An ordinarily-opened repo
			// has one held elsewhere, but a rebound worktree is never independently opened, so without this
			// lease its events (an external `git worktree remove`, among others) never reach the graph.
			repo.watch(),
			repo.onDidChange(this.onRepositoryChanged, this),
			repo.watchWorkingTree(500),
			repo.onDidChangeWorkingTree(this.onRepositoryWorkingTreeChanged, this),
			onDidChangeContext(key => {
				if (key !== 'gitlens:repos:withHostingIntegrationsConnected') return;

				this._producers.onHostingIntegrationsConnectedContextChanged(repo.path);
			}),
		);
	}

	private onIntegrationConnectionChanged(e: ConnectionStateChangeEvent) {
		// If we're still discovering repositories, we'll update the view once discovery is complete
		if (this._discovering) return;

		// A connection change can swap remote-head provider avatars (`remoteHead.avatarUrl`), which live
		// on the rows — reused rows keep theirs, so the next rebuild must be a full walk. Latched (not an
		// immediate refresh): cosmetic, corrects on the next natural rebuild.
		this._pendingContextsRebuild = true;

		void this.notifyDidChangeRepoConnection();

		// If an issue integration connected/disconnected, update metadata state
		if (supportedOrderedCloudIssuesIntegrationIds.includes(e.key as IssuesCloudHostIntegrationId)) {
			void this._producers.onIssueIntegrationConnectionChanged(e.reason === 'connected');
			return;
		}

		// A git host integration connect/disconnect is the pull-requests panel's whole story — it decides
		// both whether there's a list to fetch and whether the panel pitches Connect. Self-managed keys
		// carry their domain (`<id>:<domain>`), so match on the id half.
		const integrationId = e.key.split(':', 1)[0] as IntegrationIds;
		if (isGitCloudHostIntegrationId(integrationId) || isGitSelfManagedHostIntegrationId(integrationId)) {
			this._panels.onIntegrationConnectionChanged();
		}
	}

	private async notifyDidChangeRepoConnection() {
		this._repoConnectionChangedEvent.fire({ repositories: await this.getGraphRepositories() });
	}

	/**
	 * The picker's repository list: `openRepositories` plus the currently-bound repo when it's closed —
	 * reached via `getOrAddRepository` with `opened: false` during a rebind onto a worktree that was never
	 * separately opened. Without the append, the list a rebound client sees wouldn't include the repo
	 * `state.selectedRepository` names.
	 *
	 * That appended entry is a switch target but NOT an open repository, so it's stamped `closed: true` —
	 * the only place that flag is set. Clients counting open repositories exclude it; without the flag the
	 * webview can't tell it apart from a worktree the user genuinely opened, which DOES count.
	 */
	private async getGraphRepositories(): Promise<GraphRepository[]> {
		const openRepositories = this.container.git.openRepositories;
		const bound = this._repository;
		if (bound == null || openRepositories.some(r => r.id === bound.id)) {
			return formatRepositories(openRepositories);
		}

		// `openRepositories` is already `sortRepositories`-ordered; route the append through the same sort
		// rather than tacking it onto the end unsorted.
		const repositories = await formatRepositories(sortRepositories([...openRepositories, bound]));
		return repositories.map(r => (r.id === bound.id ? { ...r, closed: true } : r));
	}

	private getAutoFetchMode(): GraphAutoFetchMode {
		// `git.autofetch` is `boolean | "all"` — "all" fetches from all configured remotes; both `true`
		// and "all" mean VS Code Git is auto-fetching, so we yield to it.
		const vscodeAutofetch = workspace.getConfiguration('git').get<boolean | 'all'>('autofetch');
		if (vscodeAutofetch === true || vscodeAutofetch === 'all') return 'vscode';
		if (configuration.get('graph.autoFetch.enabled')) return 'gitlens';
		return 'off';
	}

	private getAutoFetchIntervalSeconds(): number {
		return workspace.getConfiguration('git').get<number>('autofetchPeriod') ?? 180;
	}

	private clearAutoFetchTimer(): void {
		if (this._autoFetchTimer != null) {
			clearTimeout(this._autoFetchTimer);
			this._autoFetchTimer = undefined;
		}
	}

	private async ensureAutoFetch(): Promise<void> {
		// `triggerAutoFetch`'s `finally { void this.ensureAutoFetch() }` re-arms a fresh timer if
		// the fetch happened to land just before dispose — gate here so a post-dispose schedule
		// can't survive.
		if (this._disposed) return;
		// Short-circuit cheaply before clearing the existing timer, so rapid signals (visibility +
		// focus + repo change firing within a tick) don't repeatedly tear down and re-arm an
		// already-correct schedule.
		if (this.getAutoFetchMode() !== 'gitlens') {
			this.clearAutoFetchTimer();
			return;
		}

		const repo = this._repository;
		if (repo == null || !this.host.visible || !this.isWindowFocused) {
			this.clearAutoFetchTimer();
			return;
		}
		if (this._autoFetchInFlight) return;

		this.clearAutoFetchTimer();

		// Clamp the scheduling cadence so a pathological `git.autofetchPeriod` (e.g. 1) can't turn
		// into a fetch storm. The raw value is still surfaced to the webview for accurate hints —
		// in `vscode` mode the popover shows VS Code Git's actual cadence, not our clamped one.
		const intervalMs =
			Math.max(GraphWebviewProvider.autoFetchMinSeconds, this.getAutoFetchIntervalSeconds()) * 1000;
		const lastFetched = (await repo.getLastFetched()) ?? 0;

		// Re-check after the async gap; state may have changed (hidden, repo swap, mode flip).
		if (this.getAutoFetchMode() !== 'gitlens') return;
		if (this._repository !== repo) return;
		if (!this.host.visible || !this.isWindowFocused) return;
		if (this._autoFetchInFlight) return;

		const baseline = Math.max(lastFetched, this._lastAutoFetchAttemptAt ?? 0);
		const elapsed = baseline > 0 ? Date.now() - baseline : intervalMs;
		if (elapsed >= intervalMs) {
			void this.triggerAutoFetch();
			return;
		}

		// Clear once more in case a concurrent `ensureAutoFetch` armed a timer while we were awaiting
		// `getLastFetched()` — without this, the reassignment below would orphan their setTimeout id.
		this.clearAutoFetchTimer();
		this._autoFetchTimer = setTimeout(() => {
			this._autoFetchTimer = undefined;
			void this.triggerAutoFetch();
		}, intervalMs - elapsed);
	}

	@debug()
	private async triggerAutoFetch(): Promise<void> {
		if (this._autoFetchInFlight) return;
		if (this.getAutoFetchMode() !== 'gitlens') return;

		const repo = this._repository;
		if (repo == null) return;
		if (!this.host.visible || !this.isWindowFocused) return;

		// Set the flag BEFORE any awaits so a concurrent caller (e.g. a manual fetch event firing
		// while this one is mid-`getLastFetched`) can't also pass the gate at line 5804.
		this._autoFetchInFlight = true;
		try {
			const intervalSeconds = this.getAutoFetchIntervalSeconds();
			const lastFetched = (await repo.getLastFetched()) ?? 0;
			const sinceLastFetchedMs = lastFetched > 0 ? Date.now() - lastFetched : 0;

			// Re-validate after the await — if the repo swapped during `getLastFetched`, bail
			// rather than auto-fetch a repo the user no longer has open. The `finally` will reset
			// the in-flight flag and re-arm via `ensureAutoFetch` which targets the current repo.
			if (this._repository !== repo) return;

			this._lastAutoFetchAttemptAt = Date.now();
			// Skip the interactive Fetch wizard (and its progress notification) — auto-fetch is silent
			// by design; the live "Fetch (now)" label will reflect completion via the lastFetched event.
			await repo.git.fetch({ progress: false });
			this.host.sendTelemetryEvent('graph/autoFetch', {
				intervalSeconds: intervalSeconds,
				sinceLastFetchedMs: sinceLastFetchedMs,
			});
		} catch {
			// Swallow — transient fetch failures shouldn't break the loop. `_lastAutoFetchAttemptAt`
			// keeps `ensureAutoFetch` from immediately re-firing when `lastFetched` did not advance.
		} finally {
			this._autoFetchInFlight = false;
			// Re-arm directly as a safety net; the natural `'lastFetched'` event will also trigger
			// `ensureAutoFetch`, but on failure there's no `lastFetched` change. The `_disposed`
			// gate inside `ensureAutoFetch` guards against re-arming after panel close.
			void this.ensureAutoFetch();
		}
	}

	private async ensureLastFetchedSubscription(force?: boolean) {
		if (!force && this._lastFetchedDisposable != null) return;

		if (this._lastFetchedDisposable != null) {
			this._lastFetchedDisposable.dispose();
			this._lastFetchedDisposable = undefined;
		}

		const repo = this.repository;
		if (repo == null) return;

		const lastFetched = (await repo.getLastFetched()) ?? 0;

		const interval = getLastFetchedUpdateInterval(lastFetched);
		if (lastFetched !== 0 && interval > 0) {
			this._lastFetchedDisposable = disposableInterval(() => {
				// Skip update if webview is not visible to reduce unnecessary work
				if (!this.host.visible) return;

				// Check if the interval should change, and if so, reset it
				if (interval !== getLastFetchedUpdateInterval(lastFetched)) {
					void this.ensureLastFetchedSubscription(true);
					return;
				}

				void this.notifyDidFetch();
			}, interval);
		}
	}

	private getColumns(): Record<GraphColumnName, GraphColumnConfig> | undefined {
		return this.container.storage.getWorkspace('graph:columns');
	}

	/** Seed-once: on the first bootstrap in this provider, copy the user's saved default layout into
	 *  workspace storage — but only into voids (no stored columns / no stored panels). Runs before
	 *  `getState` reads either key so the seeded values flow into the very first bootstrap. Also keeps
	 *  the `hasSavedDefaultLayout` context key fresh for the reset-to-saved menu item. */
	private async ensureDefaultLayoutSeeded(): Promise<void> {
		if (this._defaultLayoutSeeded) return;

		this._defaultLayoutSeeded = true;

		const layout = this.container.storage.get('graph:defaultLayout');
		void setContext('gitlens:graph:hasSavedDefaultLayout', layout != null);
		if (layout == null) return;

		const seeds = getDefaultLayoutSeeds(
			layout,
			this.container.storage.getWorkspace('graph:columns'),
			this.container.storage.getWorkspace('graph:state'),
		);

		try {
			if (seeds.columns != null) {
				await this.container.storage.storeWorkspace('graph:columns', seeds.columns);
			}

			if (seeds.state != null) {
				await this.container.storage.storeWorkspace('graph:state', seeds.state);
			}
		} catch (ex) {
			Logger.error(ex, 'graph: failed to seed default layout');
		}
	}

	private getExcludedTypes(filters: StoredGraphFilters | undefined): GraphExcludeTypes | undefined {
		return filters?.excludeTypes;
	}

	private getExcludedRefs(
		filters: StoredGraphFilters | undefined,
		graph: GitGraph | undefined,
	): Record<string, GraphExcludedRef> | undefined {
		if (graph == null) return undefined;

		const storedExcludeRefs = filters?.excludeRefs;
		if (!hasKeys(storedExcludeRefs)) return undefined;

		// Refs that no longer exist would otherwise stay hidden — and keep inflating the chip's count —
		// forever. `refTips` is the complete `for-each-ref` listing the walk already captured off its
		// critical path, so validating against it costs no extra git call (the reason the original v13
		// validation was dropped — see https://github.com/gitkraken/vscode-gitlens/pull/2211#discussion_r990117432).
		// An EMPTY map means that listing failed (`errors: 'ignore'`), so only prune against a populated one;
		// the GitHub provider never populates it at all, leaving virtual repos untouched.
		const refTips = graph.refTips?.size ? graph.refTips : undefined;

		const excludeRefs: GraphExcludeRefs = {};

		for (const id in storedExcludeRefs) {
			const stored = storedExcludeRefs[id];
			// Existence is checked on the STORED shape, which keys off `type`/`name`/`owner` and never `id`,
			// so this doesn't need the live path.
			if (refTips != null && !this.excludedRefExists(stored, refTips, graph)) continue;

			// See `restampFilterRefId`'s doc — the map KEY, `.id`, and every `except[]` entry (a whole-
			// remote wildcard's per-branch exemptions, matched the same way) all need the live path.
			const liveId = restampFilterRefId(id, graph.repoPath);
			const ref: GraphExcludedRef = {
				...stored,
				id: liveId,
				except: stored.except?.map(exceptId => restampFilterRefId(exceptId, graph.repoPath)),
			};
			if (ref.type === 'remote' && ref.owner) {
				// The provider's glyph name, not an avatar image — the hidden-refs list renders the same
				// font glyph the side bar's remotes panel uses, so the two stay visually consistent.
				ref.providerIcon = graph.remotes.get(ref.owner)?.provider?.icon;
			}

			excludeRefs[liveId] = ref;
		}

		// Filtered for display only — deliberately NOT written back to storage. `for-each-ref` runs with
		// `errors: 'ignore'`, so a truncated read yields a non-empty but PARTIAL map, and persisting on that
		// would destroy hidden state the user can't recover. `resetFilters` still clears the stored keys.
		return hasKeys(excludeRefs) ? excludeRefs : undefined;
	}

	/** Whether a stored hidden ref still exists per the walk's ref listing. A remote-wide hide has no
	 *  refname of its own, so it lives or dies with its remote; anything unresolvable is kept. */
	private excludedRefExists(
		ref: StoredGraphExcludedRef,
		refTips: NonNullable<GitGraph['refTips']>,
		graph: GitGraph,
	): boolean {
		if (ref.type === 'remote' && ref.name === '*') {
			return ref.owner ? graph.remotes.has(ref.owner) : true;
		}

		const refName = getExcludedRefName(ref);
		return refName == null || refTips.has(refName);
	}

	private getPinnedRef(
		filters: StoredGraphFilters | undefined,
		graph: GitGraph | undefined,
	): GraphPinnedRef | undefined {
		const stored = filters?.pinnedRef;
		if (stored == null) return undefined;

		const pinned: GraphPinnedRef = { ...stored };
		if (graph != null) {
			// See `restampFilterRefId`'s doc — ship the id the webview's live rows actually carry, not
			// whatever path was live when the ref was pinned.
			const liveId = restampFilterRefId(stored.id, graph.repoPath);
			pinned.id = liveId;
			for (const branch of graph.branches.values()) {
				if (branch.id === liveId) {
					pinned.sha = branch.sha;
					break;
				}
			}
		}
		return pinned;
	}

	private async getIncludedRefs(
		filters: StoredGraphFilters | undefined,
		graph: GitGraph | undefined,
		options?: { timeout?: number },
	): Promise<{ refs: GraphIncludeOnlyRefs; continuation?: Promise<GraphIncludeOnlyRefs | undefined> }> {
		this.cancelOperation('computeIncludedRefs');

		if (graph == null) {
			this._includedRefTipShas = undefined;
			return { refs: {} };
		}

		const branchesVisibility = this.getBranchesVisibility(filters);

		let refs: Map<string, GraphIncludeOnlyRef> | undefined;
		let continuation: Promise<GraphIncludeOnlyRefs | undefined> | undefined;

		switch (branchesVisibility) {
			case 'smart': {
				// Add the default branch and if the current branch has a PR associated with it then add the base of the PR
				const current = find(graph.branches.values(), b => b.current);
				if (current == null) {
					this._includedRefTipShas = undefined;
					return { refs: {}, continuation: continuation };
				}

				const cancellation = this.createCancellation('computeIncludedRefs');

				const result = await getBranchMergeTargetInfo(this.container, current, {
					cancellation: toAbortSignal(cancellation.token),
					timeout: options?.timeout,
				});

				// A newer call to `getIncludedRefs` has already superseded this one and will set
				// `_includedRefTipShas` itself — leave it alone here.
				if (cancellation.token.isCancellationRequested) return { refs: {}, continuation: continuation };

				let targetBranchName: string | undefined;
				if (result.mergeTargetBranch?.paused) {
					continuation = result.mergeTargetBranch.value.then(async target => {
						if (target == null || cancellation?.token.isCancellationRequested) return undefined;

						const refs = await this.getVisibleRefs(graph, current, {
							baseOrTargetBranchName: target,
							defaultBranchName: result.defaultBranch,
						});
						// The continuation replaces the ref set resolved above, so it must replace the
						// tip shas derived from it too — but only if a newer `getIncludedRefs` hasn't
						// claimed them while `getVisibleRefs` was in flight. Re-checked AFTER the await,
						// not just before it: the guard above can pass and the token cancel during it,
						// which would otherwise strand a superseded ref set's tips as the paging target.
						if (!cancellation.token.isCancellationRequested) {
							this._includedRefTipShas = this.computeIncludedRefTipShas(refs, graph);
						}
						return Object.fromEntries(refs);
					});
				} else {
					targetBranchName = result.mergeTargetBranch?.value;
				}

				refs = await this.getVisibleRefs(graph, current, {
					baseOrTargetBranchName: targetBranchName ?? result.baseBranch,
					defaultBranchName: result.defaultBranch,
				});

				break;
			}
			case 'current': {
				const current = find(graph.branches.values(), b => b.current);
				if (current == null) {
					this._includedRefTipShas = undefined;
					return { refs: {}, continuation: continuation };
				}

				refs = await this.getVisibleRefs(graph, current);
				break;
			}
			case 'favorited': {
				refs = new Map();
				for (const branch of graph.branches.values()) {
					if (branch.starred) {
						refs.set(branch.id, convertBranchToIncludeOnlyRef(branch));
					}
				}

				if (!refs?.size) {
					this._includedRefTipShas = [];
					return {
						// Create an empty set to say we want to include nothing
						refs: {
							['gk.empty-set-marker' satisfies typeof emptySetMarker]: {} as unknown as GraphRefOptData,
						},
						continuation: continuation,
					};
				}
				break;
			}
			case 'agents': {
				refs = this.getAgentBranchRefs(graph);
				if (!refs.size) {
					this._includedRefTipShas = [];
					return {
						// Create an empty set to say we want to include nothing
						refs: {
							['gk.empty-set-marker' satisfies typeof emptySetMarker]: {} as unknown as GraphRefOptData,
						},
						continuation: continuation,
					};
				}
				break;
			}
			default:
				break;
		}

		this._includedRefTipShas = this.computeIncludedRefTipShas(refs, graph);
		return { refs: refs == null ? {} : Object.fromEntries(refs), continuation: continuation };
	}

	/** Sorts the included refs' branch tips newest-first by commit date (undated branches sort last) and
	 *  de-dupes by sha, for {@link _includedRefTipShas} — see that field's comment for why this is kept
	 *  separate from the wire-format refs map. `undefined` means "no restriction"; a non-empty `refs` whose
	 *  branches carry no resolvable sha yields `[]`. */
	private computeIncludedRefTipShas(
		refs: Map<string, GraphIncludeOnlyRef> | undefined,
		graph: GitGraph,
	): string[] | undefined {
		if (refs == null) return undefined;
		if (!refs.size) return [];

		const dated: { sha: string; time: number }[] = [];
		for (const branch of graph.branches.values()) {
			if (branch.sha == null || !refs.has(branch.id)) continue;

			dated.push({ sha: branch.sha, time: branch.date?.getTime() ?? -1 });
		}

		dated.sort((a, b) => b.time - a.time);

		const shas = new Set<string>();
		for (const { sha } of dated) {
			shas.add(sha);
		}

		return [...shas];
	}

	/** The `graph:filtersByRepo` key for the CURRENT binding — home while rebound, so filters don't fork per
	 *  worktree or vanish for the duration of a rebind. `undefined` when no repository is bound, which is
	 *  reachable: a storage write fires `getFiltersState` for EVERY provider in-process, including one with
	 *  no repo yet. The read/write helpers null-guard, so callers can pass this straight through. */
	private get filtersRepoPath(): string | undefined {
		return this._rebindHome?.path ?? this.repository?.path;
	}

	private getFiltersByRepo(repoPath: string | undefined): StoredGraphFilters | undefined {
		if (repoPath == null) return undefined;

		const filters = this.container.storage.getWorkspace('graph:filtersByRepo');
		return filters?.[repoPath];
	}

	/** The pinned ref's id, re-stamped onto `livePath`. Pins live in the home-keyed {@link filtersRepoPath}
	 *  bucket, so while rebound the stored id carries a different path than the live `.id`s callers compare
	 *  it against — an un-stamped id silently drops `+pinned` from every decoration. */
	private getPinnedRefId(livePath: string | undefined): string | undefined {
		const stored = this.getFiltersByRepo(this.filtersRepoPath)?.pinnedRef?.id;
		return stored != null && livePath != null ? restampFilterRefId(stored, livePath) : stored;
	}

	/** The `graph:perspectiveByRepo` key for `homeRepoPath` under THIS surface. Namespaced by `host.id`
	 *  because the sidebar view and the editor panel are independent providers with independent bindings —
	 *  a bare repo-path key would have the two clobber each other's persisted perspective. Multiple editor
	 *  panel instances (`preserveInstance`) share one `host.id` and so legitimately share one entry: they
	 *  are the same logical surface. */
	private persistedPerspectiveKey(homeRepoPath: string): string {
		return `${this.host.id}|${homeRepoPath}`;
	}

	private getPersistedPerspective(homeRepoPath: string): StoredGraphWorktreePerspective | undefined {
		return this.container.storage.getWorkspace('graph:perspectiveByRepo')?.[
			this.persistedPerspectiveKey(homeRepoPath)
		];
	}

	/**
	 * The one writer of `graph:perspectiveByRepo`, keeping the stored entry a function of the two host
	 * fields: present under {@link _rebindHome} while rebound onto one of its worktrees, absent otherwise.
	 * `previousHome` is the home an entry may have been written under before this transition, so a home
	 * that changed (or was removed, or was never rebound onto in the first place) drops its stale entry.
	 *
	 * Call at the END of every transition of `_rebindHome`/`_repository`, after both are settled.
	 */
	private async syncPersistedPerspective(previousHome?: GlRepository): Promise<void> {
		const home = this._rebindHome;
		const bound = this._repository;

		// Sequenced, not concurrent: each write is a read-modify-write of the whole record, so two in
		// flight at once would lose one.
		if (previousHome != null && previousHome !== home) {
			await this.updatePersistedPerspective(previousHome.path, undefined);
		}
		if (home != null && bound != null && bound !== home) {
			await this.updatePersistedPerspective(home.path, bound.path);
		}
	}

	/** `worktreePath: undefined` clears the entry — same `updateRecordValue` shape as `graph:filtersByRepo`. */
	private updatePersistedPerspective(homeRepoPath: string, worktreePath: string | undefined): Promise<void> {
		const key = this.persistedPerspectiveKey(homeRepoPath);
		const perspectiveByRepo = this.container.storage.getWorkspace('graph:perspectiveByRepo');
		// Every store fires a workspace-storage change for every provider in-process, so skip no-op writes —
		// the sync above is deliberately called on transitions that often leave the entry unchanged.
		if (perspectiveByRepo?.[key]?.path === worktreePath) return Promise.resolve();

		return this.container.storage.storeWorkspace(
			'graph:perspectiveByRepo',
			updateRecordValue(perspectiveByRepo, key, worktreePath != null ? { path: worktreePath } : undefined),
		);
	}

	/** The mode a given column will accept, or `undefined` when the value belongs to a different column
	 *  (or no column takes a mode). Keeps the flat persisted vocabulary from leaking across columns. */
	private static narrowColumnModeFor<T extends GraphColumnName>(
		name: T,
		mode: ColumnMode | undefined,
	): GraphColumnModeFor<T> {
		if (mode == null) return undefined;
		if (name === 'graph') return mode === 'compact' ? mode : undefined;
		if (name === 'changes') return isChangesColumnMode(mode) ? mode : undefined;

		return undefined;
	}

	private getColumnSettings(columns: Record<GraphColumnName, GraphColumnConfig> | undefined): GraphColumnsSettings {
		const columnsSettings: GraphColumnsSettings = {
			...defaultGraphColumnsSettings,
		};
		if (columns != null) {
			for (const [column, columnCfg] of Object.entries(columns) as [GraphColumnName, GraphColumnConfig][]) {
				// Storage and config carry the FLAT mode vocabulary; each column accepts only its own. This is
				// the one place a stale or hand-edited stored mode is checked — the discriminated type can't
				// validate data coming off disk, so anything foreign drops to `undefined` (the column default).
				const merged = {
					...defaultGraphColumnsSettings[column],
					...columnCfg,
					mode: GraphWebviewProvider.narrowColumnModeFor(column, columnCfg.mode),
				};
				// Writing through a dynamic key would demand the intersection of every column's setting type;
				// widen the TARGET here only. `merged` is already narrowed per column above, and every read of
				// `columnsSettings` stays discriminated.
				(columnsSettings as Record<GraphColumnName, GraphColumnSetting>)[column] = merged;
			}
		}

		// The Changes column's mode is config-driven (single source of truth) — overlay the setting over any
		// stale/echoed storage mode so a settings.json edit drives the column and the picker stays in sync.
		columnsSettings.changes = {
			...columnsSettings.changes,
			mode: configuration.get('graph.changesColumn.mode'),
		};

		return columnsSettings;
	}

	private getColumnHeaderContext(columnSettings: GraphColumnsSettings): string {
		return serializeWebviewItemContext<GraphItemContext>({
			webviewItem: 'gitlens:graph:columns',
			webviewItemValue: this.getColumnContextItems(columnSettings).join(','),
		});
	}

	private getGraphSettingsIconContext(columnsSettings?: GraphColumnsSettings): string {
		return serializeWebviewItemContext<GraphItemContext>({
			webviewItem: 'gitlens:graph:settings',
			webviewItemValue: this.getSettingsIconContextItems(columnsSettings).join(','),
		});
	}

	// The marker rail's own right-click menu — the SAME toggle commands the gear's "Scroll Markers"
	// submenu carries, but flattened (no column items, so no submenu to nest them under).
	private getScrollMarkersContext(): string {
		return serializeWebviewItemContext<GraphItemContext>({
			webviewItem: 'gitlens:graph:scrollMarkers',
			webviewItemValue: this.getScrollMarkerContextItems().join(','),
		});
	}

	private getColumnContextItems(columnSettings: GraphColumnsSettings): string[] {
		const contextItems: string[] = [];
		// Old column settings that didn't get cleaned up can mess with calculation of only visible column.
		// All currently used ones are listed here.
		const validColumns = ['author', 'changes', 'datetime', 'graph', 'message', 'ref', 'sha'];

		let visibleColumns = 0;
		for (const [name, settings] of Object.entries(columnSettings)) {
			if (!validColumns.includes(name)) continue;

			if (!settings.isHidden) {
				visibleColumns++;
			}
			contextItems.push(
				`column:${name}:${settings.isHidden ? 'hidden' : 'visible'}${settings.mode ? `+${settings.mode}` : ''}`,
			);
		}

		if (visibleColumns > 1) {
			contextItems.push('columns:canHide');
		}

		// Surface the graph/ref columns' grouped placement so the Group/Ungroup menu items can toggle
		for (const name of ['graph', 'ref'] as const) {
			const settings = columnSettings[name];
			if (settings?.isHidden) continue;

			contextItems.push(`grouping:${name}:${settings.grouped !== false ? 'grouped' : 'ungrouped'}`);
		}

		// Surface the current lane-spacing density so the context-menu `when` clauses can toggle it
		contextItems.push(`lanes:density:${configuration.get('graph.lanes.density') ?? 'compact'}`);

		return contextItems;
	}

	private getSettingsIconContextItems(columnSettings?: GraphColumnsSettings): string[] {
		const contextItems: string[] = columnSettings != null ? this.getColumnContextItems(columnSettings) : [];
		contextItems.push(...this.getScrollMarkerContextItems());
		return contextItems;
	}

	// Shared by the gear's submenu and the rail's flattened menu, so both read the same state.
	private getScrollMarkerContextItems(): string[] {
		if (!configuration.get('graph.scrollMarkers.enabled')) return [];

		const configurableScrollMarkerTypes: GraphScrollMarkersAdditionalTypes[] = [
			'localBranches',
			'remoteBranches',
			'stashes',
			'tags',
			'pullRequests',
			'wip',
		];
		const enabledScrollMarkerTypes = configuration.get('graph.scrollMarkers.additionalTypes');
		return configurableScrollMarkerTypes.map(
			type => `scrollMarker:${type}:${enabledScrollMarkerTypes.includes(type) ? 'enabled' : 'disabled'}`,
		);
	}

	private getBranchesVisibility(filters: StoredGraphFilters | undefined): GraphBranchesVisibility {
		// We can't currently support all, smart, or favorited branches on virtual repos
		if (this.repository?.virtual) return 'current';
		if (filters == null) return configuration.get('graph.branchesVisibility');

		let branchesVisibility: GraphBranchesVisibility;

		// Migrate `current` visibility from before `branchesVisibility` existed by looking to see if there is only one ref included
		if (
			filters != null &&
			filters.branchesVisibility == null &&
			filters.includeOnlyRefs != null &&
			Object.keys(filters.includeOnlyRefs).length === 1 &&
			Object.values(filters.includeOnlyRefs)[0].name === 'HEAD'
		) {
			branchesVisibility = 'current';
			if (this.repository != null) {
				void this.updateFiltersByRepo(this.filtersRepoPath, {
					branchesVisibility: branchesVisibility,
					includeOnlyRefs: undefined,
				});
			}
		} else {
			branchesVisibility = filters?.branchesVisibility ?? configuration.get('graph.branchesVisibility');
		}

		return branchesVisibility;
	}

	private getComponentConfig(): GraphComponentConfig {
		// The master switch folds into the overrides here — `{ '*': false }` disables every
		// customizable shortcut — so the webview only ever applies one thing (`shortcuts`).
		const shortcutsEnabled = configuration.get('graph.shortcuts.enabled') ?? true;
		const shortcutOverrides = normalizeShortcutOverrides(configuration.get('graph.shortcuts.overrides') ?? {});

		const config: GraphComponentConfig = {
			aiEnabled: this.container.ai.enabled,
			autoFetchIntervalSeconds: this.getAutoFetchIntervalSeconds(),
			autoFetchMode: this.getAutoFetchMode(),
			avatars: configuration.get('graph.avatars'),
			changesColumnEnabled: configuration.get('graph.changesColumn.enabled'),
			dateFormat:
				configuration.get('graph.dateFormat') ?? configuration.get('defaultDateFormat') ?? 'short+short',
			dateStyle: configuration.get('graph.dateStyle') ?? configuration.get('defaultDateStyle'),
			// `undefined` = no saved value — signals the webview's first-time (hidden details) experience
			detailsLocation: configuration.isUnset('graph.details.location')
				? undefined
				: (configuration.get('graph.details.location') ?? 'auto'),
			detailsMaximizeOnMode: configuration.get('graph.details.maximizeOnMode') ?? true,
			dimMergeCommits: configuration.get('graph.dimMergeCommits'),
			doubleClickWorktreeAction: configuration.get('graph.doubleClickWorktreeAction') ?? 'scope',
			enabledRefMetadataTypes: this._producers.getEnabledRefMetadataTypes(),
			experimentalKanbanEnabled: configuration.get('graph.experimental.kanban.enabled') ?? false,
			experimentalVisualizationsEnabled: configuration.get('graph.experimental.visualizations.enabled') ?? false,
			// Per-repo capability AND the master switch. The sub-provider is absent on web builds, virtual
			// repos, and Live Share; and with `gitOptimizations.enabled` off every probe short-circuits, so
			// the view would render an all-clear for a repository it never actually examined.
			gitHealthAvailable:
				this.repository?.git.maintenance != null && configuration.get('gitOptimizations.enabled') === true,
			activityDecay: configuration.get('graph.experimental.visualizations.activityDecay') ?? '5m',
			activityDecayMs: activityDecayToMs(
				configuration.get('graph.experimental.visualizations.activityDecay') ?? '5m',
			),
			idLength: configuration.get('advanced.abbreviatedShaLength'),
			lanesFoldingEnabled: configuration.get('graph.lanes.folding.enabled'),
			lanesFoldingDefault: configuration.get('graph.lanes.folding.default'),
			lanesDensity: configuration.get('graph.lanes.density'),
			lanesGroupedMin: configuration.get('graph.lanes.grouped.min'),
			lanesGroupedMax: configuration.get('graph.lanes.grouped.max'),
			maxInlineRefs: configuration.get('graph.refs.maxInline'),
			maxStackedRefs: configuration.get('graph.refs.maxStacked'),
			refsLayout: configuration.get('graph.refs.layout'),
			minimap: configuration.get('graph.minimap.enabled'),
			minimapDefaultVisibility: configuration.get('graph.minimap.defaultVisibility'),
			minimapDataType: configuration.get('graph.minimap.dataType'),
			minimapMarkerTypes: this.getMinimapMarkerTypes(),
			minimapReversed: configuration.get('graph.minimap.reversed'),
			multiSelectionMode: configuration.get('graph.multiselect'),
			onlyFollowFirstParent: configuration.get('graph.onlyFollowFirstParent'),
			overviewBarVisibility: configuration.get('graph.overviewBar.visibility'),
			refFindAutoHide: configuration.get('graph.refFindAutoHide'),
			scopeBehavior: configuration.get('graph.scopeBehavior') ?? 'scopeAndFocus',
			scrollRowPadding: configuration.get('graph.scrollRowPadding'),
			scrollMarkerTypes: this.getScrollMarkerTypes(),
			searchAutocompleteOnFocus: configuration.get('graph.searchAutocompleteOnFocus'),
			shortcuts: shortcutsEnabled ? shortcutOverrides : { '*': false },
			showGhostRefsOnRowHover: configuration.get('graph.showGhostRefsOnRowHover'),
			showRemoteNamesOnRefs: configuration.get('graph.showRemoteNames'),
			showWorktreeWipStats: configuration.get('graph.showWorktreeWipStats'),
			sidebar: configuration.get('graph.sidebar.enabled') ?? true,
			sidebarPinned: configuration.get('graph.sidebar.pinned') ?? false,
			stickyTimeline: configuration.get('graph.stickyTimeline'),
			style: configuration.get('graph.style'),
			timelineSeparators: configuration.get('graph.timelineSeparators'),
		};
		return config;
	}

	private getScrollMarkerTypes(): GraphScrollMarkerTypes[] {
		if (!configuration.get('graph.scrollMarkers.enabled')) return [];

		// `pinned` joins the always-on ROLE markers (not `additionalTypes`, the opt-in ref-TYPE list): a pin
		// is an explicit, singular user action, so its marker shouldn't need a second opt-in to appear.
		const markers: GraphScrollMarkerTypes[] = [
			'selection',
			'highlights',
			'head',
			'upstream',
			'mergeTarget',
			'pinned',
			...configuration.get('graph.scrollMarkers.additionalTypes'),
		];

		return markers;
	}

	private getMinimapMarkerTypes(): GraphMinimapMarkerTypes[] {
		// Gated on availability, never on `defaultVisibility` — an available minimap can be surfaced by a
		// search or the header toggle at any time, and must have its markers ready when it is
		if (!configuration.get('graph.minimap.enabled')) return [];

		const markers: GraphMinimapMarkerTypes[] = [
			'selection',
			'highlights',
			'head',
			'upstream',
			...configuration.get('graph.minimap.additionalTypes'),
		];

		return markers;
	}

	private async getGraphAccess() {
		const access = await this.container.git.access('graph', this.repository?.path);
		this._etagSubscription = this.container.subscription.etag;

		let visibility = access?.visibility;
		if (visibility == null && this.repository != null) {
			visibility = await this.container.git.visibility(this.repository?.path);
		}

		return [access, visibility] as const;
	}

	private isGraphAccessAllowed(
		access: Awaited<ReturnType<GraphWebviewProvider['getGraphAccess']>>[0] | undefined,
		featurePreview: FeaturePreview,
	) {
		return (access?.allowed ?? false) !== false || getFeaturePreviewStatus(featurePreview) === 'active';
	}

	private getGraphItemContext(context: unknown): unknown | undefined {
		const item = typeof context === 'string' ? JSON.parse(context) : context;
		// Add the `webview` prop to the context if its missing (e.g. when this context doesn't come through via the context menus)
		if (item != null && !('webview' in item)) {
			item.webview = this.host.id;
		}
		return item;
	}

	/** Ships the rows-plane failure flag. Fires only on a change, so a load that succeeds after another
	 *  load already cleared the flag costs nothing. */
	private setRowsFailed(failed: boolean): void {
		if (this._rowsFailed === failed) return;

		this._rowsFailed = failed;
		this._rowsFailedEvent.fire({ error: failed });
	}

	/** `bootstrap` marks the initial state build for a (re)loading webview: rows are deferred, `loading`
	 *  is reported, and the app-owned persisted UI state is seeded (see the side bar slice below). */
	private async getState(bootstrap?: boolean): Promise<State> {
		if (bootstrap) {
			await this.ensureDefaultLayoutSeeded();
		}

		this.cancelOperation('branchState');
		this.cancelOperation('state');

		// Stamp BEFORE the early returns below — the no-repository builds are exactly the ones a
		// post-build discovery has to catch up (see the state service's subscribe wrapper). The
		// bootstrap build resets the baseline every (re)booting client regresses to; every other
		// build counts against it (early-return builds included — they ship as pushes too).
		if (bootstrap === true) {
			this._etagAtBootstrapBuild = this.container.git.etag;
			this._stateBuildsSinceBootstrap = 0;
		} else {
			this._stateBuildsSinceBootstrap++;
		}

		if (!workspace.isTrusted) {
			this._wip.updateWorkingTreeBadge(undefined);
			return {
				...this.host.baseWebviewState,
				allowed: true,
				trusted: false,
				repositories: [],
				isWeb: isWeb,
			};
		}

		const searchRequest = this._searchRequest;
		this._searchRequest = undefined;

		const subscription = await this.container.subscription.getSubscription();
		this._accountAccessRequired = isAccountAccessRequired(subscription);
		if (this._accountAccessRequired) {
			// Signed out or unverified: the webview renders only the account-access screen, so skip the
			// entire graph data pipeline (git walk, WIP, branch/PR/remote/worktree lookups). A full reload
			// is forced from `onSubscriptionChanged` once the account becomes usable.
			this._wip.updateWorkingTreeBadge(undefined);

			// Unverified accounts render the VERIFY screen, not the gate — don't label them with an arm
			if (signInGateVariant == null && subscription.account == null) {
				// The await sits on the bootstrap path and holds the whole panel blank, so pay it
				// (bounded) only on a genuine first run — later activations resolve synchronously from
				// the previous session's cache (ConfigCat targets the stable machineId, so the cohort
				// is stable too). A cache predating this key resolves that session as `unassigned`.
				if (!this.container.featureFlags.hasEverFetched) {
					await Promise.race([this.container.featureFlags.whenReady, wait(3000)]);
				}

				// Re-check after the await: a concurrent bootstrap (editor panel + sidebar view) may
				// have latched meanwhile — reuse its value so one window stays on one arm
				if (signInGateVariant == null) {
					// Key PRESENCE separates an assigned cohort from cohort-less — `getFlag`'s default would
					// fold the cohort-less into the control arm and bias the experiment (they convert differently)
					const value = this.container.featureFlags.getAllFlags()[FeatureFlagKey.GraphGateIntroVideo];
					signInGateVariant = value == null ? 'unassigned' : value === true ? 'intro-video' : 'default';

					// Persist the SEEN variant and re-stamp the `featureFlags` telemetry attribute; an
					// unassigned render isn't in the experiment and never overwrites a previously seen arm
					if (value != null) {
						const introVideo = signInGateVariant === 'intro-video';
						if (this.container.storage.get('graph:signInGate:introVideoShown') !== introVideo) {
							await this.container.storage.store('graph:signInGate:introVideoShown', introVideo);
							setFeatureFlagTelemetryGlobalAttributes(this.container);
						}
					}
				}
			}

			return {
				...this.host.baseWebviewState,
				// The account-access screen loads the intro-video thumbnail from here
				webroot: this.host.getWebRoot(),
				allowed: false,
				trusted: true,
				repositories: [],
				isWeb: isWeb,
				subscription: subscription,
				signInGateVariant: signInGateVariant,
				// Sent but NOT cleared (unlike the full build below): the app can't act on it while the
				// account screen is up, but uses it to pick task-specific sign-in messaging (#5534); the
				// un-gating full rebuild re-delivers it for actual consumption.
				pendingAction: this._pendingAction,
			};
		}

		// Runs on every state build, not just opens — its own guards make repeats cheap no-ops
		void this.container.subscription.autoResetTrialIfEligible({ source: 'graph' });

		if (this.container.git.repositoryCount === 0) {
			this._wip.updateWorkingTreeBadge(undefined);
			return {
				...this.host.baseWebviewState,
				allowed: true,
				trusted: true,
				repositories: [],
				isWeb: isWeb,
				subscription: subscription,
			};
		}

		if (this.repository == null) {
			this.repository = this.container.git.getBestRepositoryOrFirst();
			if (this.repository == null) {
				this._wip.updateWorkingTreeBadge(undefined);
				return {
					...this.host.baseWebviewState,
					allowed: true,
					trusted: true,
					repositories: [],
					isWeb: isWeb,
					subscription: subscription,
				};
			}
		}

		const cancellation = this.createCancellation('state');

		// Capture BEFORE the etag advances below: unchanged etag means no repo activity since the
		// loaded graph was built, so it can be reused verbatim (see `reuseGraph`).
		const repositoryUnchanged = this.repository.etag === this._etagRepository;
		this._etagRepository = this.repository?.etag;
		// Repo name only in the editor tab's title — the view keeps its bare title (the header's repo
		// picker already names the repo there).
		this.host.title = this.host.is('editor')
			? `${this.host.originalTitle}: ${this.repository.name}`
			: this.host.originalTitle;

		let selectionChanged = false;

		// Cold-start default: seed the WIP selection only on a FRESH webview/repo (`_selectedId == null`).
		// Once any intent sets the anchor, getState never re-asserts WIP — the webview owns the anchor and
		// there is no reconciliation to pull a default row back in. The seed rides the `selectedRows` prop,
		// which the webview echoes into its anchor.
		if (
			searchRequest == null &&
			this._selectedId == null &&
			configuration.get('graph.initialRowSelection') === 'wip'
		) {
			selectionChanged = true;
			this.setSelectedRows(createWipRowId(this.repository.path));
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);

		const includeStats =
			this.minimapNeedsStats() ||
			(this.isChangesColumnStatsEnabled() && !columnSettings.changes.isHidden) ||
			this._displayMode === 'visualizations';

		// Reuse the loaded graph when NOTHING that feeds it changed — the repo etag is untouched and
		// the load shape (ordering + stats inclusion) matches. A webview re-resolve (sidebar
		// hide/show, tab restore) re-runs getState; re-walking + re-processing identical history
		// costs seconds on large/multi-worktree repos for byte-identical output.
		const ordering =
			configuration.get('graph.commitOrdering') ?? configuration.get('advanced.commitOrdering') ?? 'date';
		const graphLoadKey = `${ordering}|${includeStats}`;
		// `startingCursor == null` restricts reuse to a WHOLE-window graph (a fresh walk): after
		// paging, `session.current` is the last `more()` result whose `rows` hold ONLY that page — a
		// reuse-path state push would ship those page rows as a cursor-less REPLACE and truncate the
		// webview's accumulated graph the moment the fingerprint stops matching.
		// Consumed here even if this getState is later superseded/cancelled: the refresh below still runs
		// and freshens the SESSION, so any subsequent getState (reuse or refresh) ships rebuilt contexts.
		const rebuildContexts = this._pendingContextsRebuild;
		this._pendingContextsRebuild = false;
		const reuseGraph =
			!rebuildContexts &&
			this._data.session != null &&
			repositoryUnchanged &&
			this._lastGraphLoadKey === graphLoadKey &&
			this._data.session.repoPath === this.repository.path &&
			this._data.session.current.paging?.startingCursor == null &&
			// A `rebindRepositoryCore` walk is in flight — `session.current` may be mid-mutation, since a
			// rebind re-stamps reused rows in place. CORRECTNESS, not sequencing: reuse READS
			// `session.current` without going through the session's write queue, so nothing else stops it
			// seeing a half-rebuilt window. See the field's doc for why the etag can't stand in for it.
			!this._rebindInFlight &&
			// The same hazard after the fact: a rebind that FAILED part-way through its re-stamp leaves the
			// window half-stamped, and by then `_rebindInFlight` has cleared and the etag has been restored,
			// so every other condition above reads "nothing changed, reuse it". Refusing reuse routes this
			// getState down the refresh branch, whose walk is the repair.
			!this._data.session.tainted;
		this._lastGraphLoadKey = graphLoadKey;

		// The (re)walk anchor (bottom-commit `rev` + `limit`) from the current window — see computeRebuildAnchor.
		// Computed post-WIP-seed so `rev`'s `_selectedId` fallback matches. The refresh branch recomputes after
		// serializing against a pending page-in.
		const { rev, limit } = this._data.computeRebuildAnchor();
		const refreshSignal = toAbortSignal(cancellation.token);

		// Reuse = read `session.current` without a refresh. Otherwise the session (re)walks and owns all the
		// seed construction (accumulated window, tips, walk shape, reachability/stats) the host used to
		// hand-assemble — it can't be handed a lying seed because it owns its shape. A repo swap routes
		// through `resetRepositoryState` → `setGraph(undefined)`, which disposes the session, so a live
		// same-repo `_data.session` here is a same-repo rebuild; a null (or stale-repo) session is the
		// initial walk for this repo.
		// The refresh's per-channel change report, threaded to `setGraph` so it marks the publisher precisely.
		// Only a same-repo refresh sets it; reuse (nothing changed) and the initial walk (everything new) leave
		// it undefined → `setGraph` marks all channels. Set inside the refresh `.then`, which is part of
		// `dataPromise`'s chain, so it's populated by the time either `setGraph` call awaits `dataPromise`.
		let refreshChanged: GitGraphSessionChangedChannels | undefined;
		let dataPromise: Promise<GitGraph>;
		if (reuseGraph) {
			dataPromise = Promise.resolve(this._data.session!.current);
		} else if (this._data.session != null && this._data.session.repoPath === this.repository.path) {
			// Capture the session identity so a repo swap that disposes+replaces it mid-refresh aborts the commit.
			const session = this._data.session;
			dataPromise = (async () => {
				// `getState` itself isn't `@debug()`/`@trace()`-decorated, so there is no ambient scope for
				// `getScopedLogger()` to read here — `maybeStartScopedLogger` creates its own instead. Grabbed
				// as the very first statement of this IIFE, before any of ITS OWN awaits below, per the same
				// "stale after await" rule the decorator has.
				using scope = maybeStartScopedLogger(`${getLoggableName(this)}.getState.refresh`);

				// ANCHOR FRESHNESS: the anchor re-read below is depth-sensitive (`computeRebuildAnchor`
				// derives `limit` from the loaded count and `rev` from the window's bottom row), and a page
				// CHANGES both. Refresh first and it re-walks to the pre-page depth, dropping the rows the
				// user just paged in; let the page land and the refresh spans it. Cancellation resolves,
				// never rejects; this await and Core's symmetric await form a creation-ordered DAG.
				const pending = this._data.pendingRowsQuery?.promise;
				if (pending != null) {
					await pending.catch(() => {});
				}
				// Re-read the anchor AFTER the await — rev/limit derive from the (now possibly larger) window's bottom.
				const { rev: refreshRev, limit: refreshLimit } = this._data.computeRebuildAnchor();

				let result;
				try {
					result = await session.refresh(
						{
							rev: refreshRev,
							limit: refreshLimit,
							include: { stats: includeStats },
							rebuild: rebuildContexts,
						},
						refreshSignal,
					);
				} catch (ex) {
					// The latch was consumed at getState entry, but the rebuild it paid for never applied — a
					// cancelled/failed refresh here would strand stale baked data (provider avatars) behind
					// the reuse gate. Re-arm so the next getState rebuilds.
					if (rebuildContexts) {
						this._pendingContextsRebuild = true;
					}
					throw ex;
				}
				// A repo swap/clear disposed+replaced the session mid-refresh — abort rather than committing a
				// stale graph over the new repo's session (mirrors Core's `_graphSession !== session` guard).
				if (this._data.session !== session) throw new CancellationError();

				refreshChanged = result.changed;
				// One INFO line per SEEDED rebuild (persisted logs filter debug): the fast head-walk (with
				// how many new rows) or a full fallback (with its reason). An unseeded full walk carries no
				// reason and stays silent — exactly as before (`onIncrementalResult` fired only when seeded).
				if (result.path === 'fast') {
					scope?.info(`[graph] incremental walk: fast (+${result.added ?? 0} new rows)`);
				} else if (result.reason != null) {
					scope?.info(`[graph] incremental walk: fallback (${result.reason})`);
				}
				return session.current;
			})();
		} else {
			// Initial walk for this repo — open a fresh session. Defensively dispose any lingering session for a
			// different repo (a repo swap should already have via reset).
			this._data.session?.dispose();
			this._data.session = undefined;
			// The session is nulled here outside `setGraph(undefined)`, so the overview dedup gate must
			// reset too — otherwise the post-walk push can be suppressed against a snapshot the webview
			// never actually received (it may have been wiped by a bootstrap that raced this walk).
			this._panels.clearLastSentOverview();
			const repository = this.repository;
			// Boxed so the walk can compare `_data.loading` against its OWN promise for the liveness guard below
			// (a bare self-reference inside the IIFE trips TS's definite-assignment check).
			const ref: { promise?: Promise<GitGraph> } = {};
			ref.promise = (async (): Promise<GitGraph> => {
				const session = await repository.git.graph.openGraphSession(
					{
						rowProcessor: this.graphRowProcessor,
						rev: rev,
						limit: limit,
						include: { stats: includeStats },
					},
					refreshSignal,
				);
				// Adopt the freshly-walked session only if THIS load is still the active one for THIS repo — a
				// newer getState (repo swap / re-resolve) may have superseded us. On mismatch, dispose the orphan
				// and return its graph WITHOUT clobbering the current session.
				if (this._data.loading === ref.promise && this.repository?.path === repository.path) {
					this._data.session = session;
				} else {
					session.dispose();
				}
				return session.current;
			})();
			dataPromise = ref.promise;
		}
		this._data.loading = dataPromise;
		// A load is underway, so any previous failure no longer stands — clear it before the walk so the
		// webview's Retry overlay can't outlive the load it belongs to.
		this.setRowsFailed(false);

		// Check for access and working tree stats
		const promises = Promise.allSettled([
			this.getGraphAccess(),
			this._wip.getWorkingTreeStatsAndPausedOperations(undefined, cancellation.token),
			this.repository.git.branches.getBranch(undefined, toAbortSignal(cancellation.token)),
			this.repository.getLastFetched(),
			// Anchor/label topology only — NO clean/dirty probing here. The probe fans `git diff`/
			// `ls-files` out across every worktree; awaiting it gated the ENTIRE initial state on the
			// slowest worktree (multi-second stalls, and a wedged mount stuck the loading spinner
			// forever) while the concurrent spawns starved the rows walk. The probed build runs in
			// the background below and merges in via the working-tree channel when it lands.
			this._wip.getWipRows(cancellation.token),
			// Worktree registry for the webview — the Agent Activity treemap maps agent file activity
			// to repo-relative keys against these. Fetched directly (not via the graph session, which isn't
			// loaded yet on the deferred-rows build).
			this.repository.git.worktrees?.getWorktrees(toAbortSignal(cancellation.token)),
		]);
		// Deferred worktree clean/dirty probe (see above) — surfaces changed worktrees in the WIP bar
		// shortly after load without blocking or competing with the rows walk.
		this._wip.probeSecondaryWipInBackground();

		let data;
		if (bootstrap) {
			queueMicrotask(async () => {
				// Hold the publisher across the whole deferred build so setGraph's channel marks + the
				// `ensureSelectedTargetLoaded` await don't leak a premature rows flush ahead of the atomic
				// rows+riders emission at `notifyDidChangeRows` below. `release` (finally) flushes once.
				this._graphSync.hold();
				try {
					const data = await dataPromise;
					if (cancellation.token.isCancellationRequested || this._data.loading !== dataPromise) return;

					this._data.setGraph(data, refreshChanged);

					// Cold-start seed for non-WIP `initialRowSelection` (e.g. 'head'): when nothing has
					// been selected yet (`_selectedId == null`), select the resolved tip/HEAD (`data.id`).
					// Gated on `_selectedId == null` so it ONLY seeds a fresh webview/repo — it never
					// reconciles away (clobbers) a selection the user/anchor already holds.
					if (this._selectedId == null && data.id != null) {
						selectionChanged = true;
						this.setSelectedRows(data.id);
					}

					// Page in an explicit deep target (e.g. "Open in Commit Graph" on an old commit against a
					// closed graph) that the capped cold-start walk didn't reach.
					if (await this._data.ensureSelectedTargetLoaded()) {
						selectionChanged = true;
					}
					if (cancellation.token.isCancellationRequested || this._data.loading !== dataPromise) return;

					void this.fireFiltersChanged();
					this._data.notifyDidChangeRows(selectionChanged);
					// Commit so the next `notifyDidChangeState` doesn't double-fire for events covered
					// by this rebuild's invalidation.
					this._firedSidebarEventSeq = this._sidebarEventCounter.current;
					this._panels.notifySidebarInvalidated();
				} catch (ex) {
					// Cancellation/session-swap aborts are routine; anything else means the deferred bootstrap
					// died BEFORE setGraph — nothing ships, so tell the webview to swap its spinner for a
					// Retry affordance. Same liveness guards as the try block: a superseded load's failure
					// says nothing about the one that replaced it.
					if (isCancellationError(ex)) return;

					Logger.error(ex, `GraphWebviewProvider(${this.host.id}): deferred rows bootstrap failed`);
					if (cancellation.token.isCancellationRequested || this._data.loading !== dataPromise) return;

					this.setRowsFailed(true);
				} finally {
					this._graphSync.release();
				}
			});
		} else {
			// A session-swap mid-refresh rejects `dataPromise` with CancellationError (FIX 4a) — it throws here
			// BEFORE setGraph, so stale data is never committed and getState aborts cleanly (same clean-abort
			// convention as the token check below). The deferred path's `catch {}` covers the deferred case.
			data = await dataPromise;
			this._data.setGraph(data, refreshChanged);

			// Cold-start seed for non-WIP `initialRowSelection` (see the deferred path above).
			if (this._selectedId == null && data.id != null) {
				this.setSelectedRows(data.id);
			}

			// Page in an explicit deep target the capped cold-start walk didn't reach (see deferred path).
			// Re-read the (possibly paged) session so the State built below ships the paged-in rows —
			// `ensureSelectedTargetLoaded` advances the session's `current` via `more()`, leaving `data` stale.
			await this._data.ensureSelectedTargetLoaded();
			data = this._data.session?.current ?? data;
		}

		const [accessResult, workingStatsResult, branchResult, lastFetchedResult, wipRowsResult, worktreesResult] =
			await promises;
		if (cancellation.token.isCancellationRequested) throw new CancellationError();

		const [access, visibility] = getSettledValue(accessResult) ?? [];

		let branchState: BranchState | undefined;

		// Re-read the branch AFTER the walk, and stamp at THIS read. The bundled read above happened before a
		// walk that can run for seconds, so on a big repo it describes the branch as it was before whatever
		// the user just did (a pull writes refs mid-walk). Shipping that snapshot is what put the pre-pull
		// counts back after the fast path had already cleared them. `cache.branch` has no TTL, so this is a
		// warm hit unless an event invalidated it — i.e. it only costs a read in exactly the case that needs
		// one. `branch` (not just `branchState`) comes from it too, so `State.branch` can't describe one
		// branch while the counts beside it describe another.
		let branch = getSettledValue(branchResult);
		// Stamp only on a SUCCESSFUL re-read, and only after it resolves — the revision has to describe the
		// read it ships. If the re-read fails we fall back to the pre-walk value, which is exactly the stale
		// snapshot this re-read exists to replace; stamping it would let it out-rank a genuinely fresher
		// fast-path read and pass the strip check below. Unstamped instead: no false ranking, no commit to
		// the gate, and the next build supplies a stamped value.
		let branchStateRevision: number | undefined;
		try {
			const reread = await this.repository.git.branches.getBranch(undefined, toAbortSignal(cancellation.token));
			if (reread != null) {
				branch = reread;
				branchStateRevision = this._producers.nextBranchStateRevision();
			}
		} catch {
			/* swallow — keep the pre-walk read; cancellation is caught by the check below */
		}
		if (cancellation.token.isCancellationRequested) throw new CancellationError();

		if (branch != null) {
			branchState = { ...(branch.upstream?.state ?? { ahead: 0, behind: 0 }) };

			const worktreesByBranch =
				data?.worktreesByBranch ??
				(await getWorktreesByBranch(this.repository, undefined, toAbortSignal(cancellation.token)));
			branchState.worktree = worktreesByBranch?.has(branch.id) ?? false;

			if (branch.upstream != null) {
				branchState.upstream = branch.upstream.name;

				const branchStateCancellation = this.createCancellation('branchState');

				const [remoteResult, prResult] = await Promise.allSettled([
					getBranchRemote(this.container, branch),
					pauseOnCancelOrTimeout(
						getBranchAssociatedPullRequest(this.container, branch),
						toAbortSignal(branchStateCancellation.token),
						100,
					),
				]);

				const remote = getSettledValue(remoteResult);
				if (remote?.provider != null) {
					branchState.provider = {
						name: remote.provider.name,
						icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
						url: await getRemoteProviderUrl(remote.provider, { type: RemoteResourceType.Repo }),
					};
				}

				const maybePr = getSettledValue(prResult);
				if (maybePr?.paused) {
					const fallbackBranchState: BranchState = branchState;
					void maybePr.value.then(pr => {
						if (branchStateCancellation?.token.isCancellationRequested) return;

						if (pr != null) {
							// Merge `pr` into the most recently sent branchState so we don't clobber
							// fresher ahead/behind/upstream values shipped by a later state notify.
							const base = this._producers.lastSentBranchState ?? fallbackBranchState;
							// Fresh stamp, because the merge base is the newest ACCEPTED branchState, not this
							// build's snapshot — the gate only ever holds values that were both current and
							// delivered, so this payload really is the current counts plus `pr`. (When the gate
							// is still empty the fallback is this build's own post-walk read, also current.)
							// Caveat: this stamp describes the GATE, not a read of its own, so it inherits the
							// [post, ack] residual noted on `State.branchStateRevision` — if a fast path is
							// mid-flight here, this out-ranks it. The fast path carries `pr` forward
							// (`pr ??=`), so the pill survives the correcting build.
							void this._producers.notifyDidChangeBranchState(
								{ ...base, pr: serializePullRequest(pr) },
								this._producers.nextBranchStateRevision(),
							);
						}
					});
				} else {
					const pr = maybePr?.value;
					if (pr != null) {
						branchState.pr = serializePullRequest(pr);
					}
				}
			}

			// RowMarker: the current branch's upstream tip sha, for the overview bar's upstream jump leg.
			// In-memory branch-map lookup (the same source `computeScopeAnchor` uses), falling back to a
			// cheap single-branch fetch — no merge-target work here (that's pulled client-side via the
			// scope-anchor pipeline). Absent for detached / local-only / missing upstream.
			const upstreamName = branch.upstream != null && !branch.upstream.missing ? branch.upstream.name : undefined;
			if (upstreamName != null) {
				branchState.upstreamSha =
					this._data.session?.current.branches.get(upstreamName)?.sha ??
					(
						await this.container.git
							.getRepositoryService(branch.repoPath)
							.branches.getBranch(upstreamName, toAbortSignal(cancellation.token))
					)?.sha;
			}
		}

		const filters = this.getFiltersByRepo(this.filtersRepoPath);
		// The bootstrap State's own copy of the filters — the first render reads these fields directly,
		// before any RPC subscription exists.
		const refsVisibility: Omit<GraphFiltersState, 'pinnedRef'> = {
			branchesVisibility: this.getBranchesVisibility(filters),
			excludeRefs: this.getExcludedRefs(filters, data) ?? {},
			excludeTypes: this.getExcludedTypes(filters) ?? {},
			includeOnlyRefs: undefined,
		};
		if (data != null) {
			const includedRefsResult = await this.getIncludedRefs(filters, data, { timeout: 100 });
			refsVisibility.includeOnlyRefs = includedRefsResult.refs;
			// Two-phase: the bootstrap ships whatever resolved inside the budget; the slow merge-target
			// resolve lands later and pushes a SECOND complete snapshot over the filters event.
			void includedRefsResult.continuation?.then(refs => {
				if (refs == null) return;

				void this.fireFiltersChanged(refs);
			});
		}

		// The active search's mode wins over the stored preference — an NL search can force filter mode
		// for its own lifetime without persisting it, and a state refresh must not revert the toggle
		// while that search is still active
		const activeSearchQuery = this._searchService.activeSearch?.query;
		const searchMode: GraphSearchMode =
			activeSearchQuery != null
				? activeSearchQuery.filter
					? 'filter'
					: 'normal'
				: this.container.storage.get('graph:searchMode', 'normal');
		const useNaturalLanguageSearch = this.container.storage.get('graph:useNaturalLanguageSearch', true);
		const featurePreview = this.getFeaturePreview();

		const storedGraphState = this.container.storage.getWorkspace('graph:state');
		const storedPanels = storedGraphState?.panels;
		// A memento written before `maximized` was dropped from the persisted shape (now transient/
		// derived — see `graph-app.ts`'s `persistStateNow`) may still carry the leaked key; strip it so
		// it never round-trips back into a fresh bootstrap.
		type StoredGraphDetails = NonNullable<NonNullable<StoredGraphState['panels']>['details']>;
		const { maximized: _leakedMaximized, ...storedDetails } = (storedPanels?.details ?? {}) as StoredGraphDetails &
			Record<'maximized', boolean | undefined>;

		// Seed the Overview "Recent" timeframe from the memento before `getOverviewData()` runs
		// below — keeps host-pushed overview updates in sync with the persisted choice on reload.
		// A dev build may have persisted a now-removed value (e.g. the retired `All` timeframe) —
		// coerce anything unrecognized back to the default rather than passing it through.
		const storedRecentThreshold = storedGraphState?.overview?.recentThreshold;
		this._panels.setOverviewRecentThreshold(
			storedRecentThreshold === 'OneDay' ||
				storedRecentThreshold === 'OneWeek' ||
				storedRecentThreshold === 'OneMonth'
				? storedRecentThreshold
				: 'OneWeek',
		);

		// If the underlying fetch returned undefined (cancelled/failed), leave the graph's own worktree
		// out of `wipStateById` rather than fabricating a confident `{0,0,0}` — `gl-wip-stats` renders
		// `nothing` for an all-undefined state, which is honest. A misleading clean ✓ would stick
		// until the next FS event landed, and there's no guarantee one will: if the user already
		// had changes when the webview loaded, the working tree won't change of its own accord.
		// The one-shot retry below also seeds an authoritative push shortly after init to recover
		// from transient cancellations during ready-up.
		const primaryWipState = getSettledValue(workingStatsResult);
		if (primaryWipState == null) {
			this._wip.scheduleInitialWorkingTreeStatsRetry();
		} else {
			// Seed the panel-tab badge on initial load. A null here is a transient fetch failure (the
			// retry above re-pushes), not a real zero — don't fabricate a zero and clear the badge.
			this._wip.updateWorkingTreeBadge(primaryWipState.workDirStats);
		}

		// Fold the graph's own worktree's status group into the uniform hot plane — the enumeration
		// walk deliberately runs no `git status`, so it only ever supplies the peers' free fields.
		const wipRows = getSettledValue(wipRowsResult);
		const wipStateById =
			primaryWipState != null
				? { ...wipRows?.state, [createWipRowId(this.repository.path)]: primaryWipState }
				: wipRows?.state;

		// `mixed` means the workspace has both public and private repos — so a gated (private) repo can
		// offer switching to a public one. Only computed when access is denied (the only time the gate, and
		// thus the switch affordance, is shown) to avoid an aggregate visibility() scan on the common
		// allowed path. The result is cached on the provider.
		const allowed = this.isGraphAccessAllowed(access, featurePreview);
		const allowRepoSwitch = allowed === false ? (await this.container.git.visibility()) === 'mixed' : false;

		const overviewData = this._panels.getOverviewData();

		const result: State = {
			...this.host.baseWebviewState,
			webroot: this.host.getWebRoot(),
			windowFocused: this.isWindowFocused,
			repositories: await this.getGraphRepositories(),
			worktreePaths: getSettledValue(worktreesResult)?.map(w => w.path),
			worktreeBranches: getSiblingWorktreeBranches(getSettledValue(worktreesResult), this.repository.path),
			selectedRepository: this.repository.id,
			// What an unscope would rebind onto — see `State.homeRepositoryPath` for why the webview can't
			// derive this itself.
			homeRepositoryPath: (this._rebindHome ?? this.repository).path,
			selectedRepositoryVisibility: visibility,
			branchesVisibility: refsVisibility.branchesVisibility,
			branch: branch && {
				name: branch.name,
				ref: branch.ref,
				refType: branch.refType,
				remote: branch.remote,
				repoPath: branch.repoPath,
				sha: branch.sha,
				id: branch.id,
				upstream: branch.upstream,
				detached: branch.detached,
			},
			branchState: branchState,
			branchStateRevision: branchStateRevision,
			lastFetched: getSettledValue(lastFetchedResult)!,
			selectedRows: convertSelectedRows(this._selectedRows),
			subscription: access?.subscription.current,
			allowed: allowed,
			trusted: true,
			allowRepoSwitch: allowRepoSwitch,
			// Rows-plane fields are owned by the `graph:rows` channel now — they never travel on this State.
			// The webview keeps whatever the channel last delivered (the current reducer sees exactly the
			// old "skipRows" shape).
			avatars: undefined,
			// BOOTSTRAP ONLY: a fresh webview needs the feature-off `null` (or the already-resolved map)
			// before its first request. A live push must ship NOTHING here — `refsMetadata` is owned by
			// `GraphRefsMetadataService` (request/response + the reset event), and a full-state REPLACE on
			// every push is exactly the dual-writer clobber this migration removes.
			refsMetadata: bootstrap ? this._producers.serializeRefsMetadata() : undefined,
			loading: bootstrap === true,
			rowsStatsLoading: undefined,
			rowsStatsIncluded: undefined,
			rows: undefined,
			reachabilityTable: undefined,
			downstreams: undefined,
			paging: undefined,
			columns: columnSettings,
			config: this.getComponentConfig(),
			context: {
				header: this.getColumnHeaderContext(columnSettings),
				settings: this.getGraphSettingsIconContext(columnSettings),
				scrollMarkers: this.getScrollMarkersContext(),
			},
			excludeRefs: refsVisibility.excludeRefs,
			excludeTypes: refsVisibility.excludeTypes,
			includeOnlyRefs: refsVisibility.includeOnlyRefs,
			pinnedRef: this.getPinnedRef(filters, data),
			nonce: this.host.cspNonce,
			wipRowsById: wipRows?.rows,
			wipStateById: wipStateById,
			searchMode: searchMode,
			useNaturalLanguageSearch: useNaturalLanguageSearch,
			featurePreview: featurePreview,
			...(overviewData != null ? { overview: overviewData } : undefined),
			mcpCanAutoRegister: this.container.gkMcp?.isRegistrationAllowed ?? false,
			layoutPromptNeeded: this.getLayoutPromptNeeded(),
			upgradedFromPreV19: satisfies(this.container.previousVersion, '< 19'),
			searchRequest: searchRequest,
			details: {
				...storedDetails,
				// Until a details location has been saved (the first-time experience), the panel starts
				// hidden — the first interaction that shows it saves the location as 'auto' (see the
				// webview's details-visibility transition), ending the first-time state.
				visible:
					this._pendingAction != null && this._pendingAction.action !== 'scope-to-branch'
						? true
						: configuration.isUnset('graph.details.location')
							? false
							: (storedPanels?.details?.visible ?? true),
			},
			// Bootstrap-only: the side bar's open state is app-owned once the app is running (it persists
			// to the memento we read here), so re-sending it on every rebuild would clobber live state
			// with a value the app hasn't written yet — the persist is debounced 200ms — reopening a
			// just-collapsed overlay, or slamming an open one shut. Omit the key entirely rather than
			// send `undefined`, which `updateState` would enumerate and apply.
			//
			// An unpinned side bar is a transient overlay — it floats over the graph and auto-collapses
			// on focus loss — so its open state must not survive into the next show. Only a pinned one,
			// which shares space with the graph, restores open.
			...(bootstrap
				? {
						sidebar: {
							...storedPanels?.sidebar,
							visible:
								this._pendingSidebarPanel != null ||
								((configuration.get('graph.sidebar.pinned') ?? false) &&
									(storedPanels?.sidebar?.visible ?? true)),
							activePanel: this._pendingSidebarPanel ?? storedPanels?.sidebar?.activePanel,
						},
					}
				: undefined),
			// Pass the stored panel state through untouched — `visible` stays `undefined` until the
			// user actually shows/hides the minimap, so the `graph.minimap.defaultVisibility` policy
			// governs instead of a value we fabricated (which the app would then persist back).
			minimap: { ...storedPanels?.minimap },
			pendingAction: this._pendingAction,
			pendingCompare: this._pendingCompare,
			wipDrafts: this._wip.sliceWipDraftsForPanel(),
			timeline: {
				period: storedGraphState?.timeline?.period,
				sliceBy: storedGraphState?.timeline?.sliceBy,
				showAllBranches: storedGraphState?.timeline?.showAllBranches,
			},
			overviewRecentThreshold: this._panels.overviewRecentThreshold,
			// A command that asked for a specific visualization seeds the cold show. This DOES become the
			// user's persisted choice on the next `persistState` — same as clicking the tab — because
			// running "Show Repository Health" is itself a choice of visualization.
			//
			// `displayMode` must be seeded alongside it: picking a visualization is meaningless while the
			// pane showing visualizations isn't the one rendered. Left undefined otherwise so a normal show
			// keeps whatever the app decides.
			displayMode: this._pendingVisualization != null ? 'visualizations' : undefined,
			visualizationMode: this._pendingVisualization ?? storedGraphState?.visualizationMode,
			treemapMode: storedGraphState?.treemap?.mode,
		};
		// Only the bootstrap build emits the side bar slice, so only it may consume the pending panel —
		// clearing it on a refresh would drop the request. It's set only while `loading`, so a bootstrap
		// is always imminent.
		if (bootstrap) {
			this._pendingSidebarPanel = undefined;
		}
		// `displayMode`/`visualizationMode` above are unconditional fields on every build, bootstrap or
		// not — a repo-switch-triggered rebuild (see `hasVisualization`'s `onShowing` branch) delivers
		// this outside bootstrap too, so it must clear alike or the next unrelated rebuild would re-force
		// visualizations mode. Mirrors `_pendingAction`/`_pendingCompare` below.
		this._pendingVisualization = undefined;
		this._pendingAction = undefined;
		this._pendingCompare = undefined;
		return result;
	}

	/** Awaitable: callers (the webview's `setColumns`) use resolution as the happens-after edge for their
	 *  own write, so the storage write must land before it settles. */
	private async updateColumns(
		columnsCfg: GraphColumnsConfig,
		options?: { keepStoredModes?: boolean },
	): Promise<void> {
		let columns = this.container.storage.getWorkspace('graph:columns');
		for (const [key, value] of Object.entries(columnsCfg)) {
			// `mode` is host-owned — webviews only echo it, and a stale echo (second panel / pre-command
			// persist) must not clobber a just-set value. Host callers (the column resets) author it for real.
			const mode = options?.keepStoredModes ? columns?.[key]?.mode : value.mode;
			columns = updateRecordValue(columns, key, { ...value, mode: mode });
		}

		try {
			await this.container.storage.storeWorkspace('graph:columns', columns);
		} catch (ex) {
			Logger.error(ex, 'graph: failed to persist columns');
		}

		this.fireColumnsChanged();
	}

	/** Restores the shipped layout: writes the built-in column preset and an explicitly EMPTY panels
	 *  record — not voids, since a cleared key would look unseeded and {@link ensureDefaultLayoutSeeded}
	 *  would quietly re-apply the saved default over the reset on the next reload — then remounts to
	 *  re-bootstrap from it. The saved default itself is left untouched. */
	private async resetLayout(): Promise<void> {
		const columns: Record<string, StoredGraphColumn> = {};
		for (const [name, cfg] of Object.entries(defaultGraphColumnsSettings)) {
			columns[name] = { isHidden: cfg.isHidden, mode: cfg.mode, width: cfg.width, order: cfg.order };
		}

		try {
			await this.container.storage.storeWorkspace('graph:columns', columns);

			const state = this.container.storage.getWorkspace('graph:state');
			await this.container.storage.storeWorkspace('graph:state', { ...state, panels: {} });
		} catch (ex) {
			Logger.error(ex, 'graph: failed to reset layout');
			return;
		}

		await this.host.refresh(true);
	}

	/** Overwrites this workspace's layout with the saved default and remounts the webview so both the
	 *  columns and the panel arrangement re-bootstrap from the freshly written storage. A direct
	 *  store (not {@link updateColumns}) so columns absent from the snapshot reset too, instead of
	 *  surviving the merge. */
	private async applySavedLayout(): Promise<void> {
		const layout = this.container.storage.get('graph:defaultLayout');
		if (layout == null) return;

		try {
			await this.container.storage.storeWorkspace('graph:columns', layout.columns);

			const state = this.container.storage.getWorkspace('graph:state');
			await this.container.storage.storeWorkspace('graph:state', { ...state, panels: layout.panels });
		} catch (ex) {
			Logger.error(ex, 'graph: failed to apply saved default layout');
			return;
		}

		await this.host.refresh(true);
	}

	/** Snapshots the current workspace layout (columns + panels) into the global saved default that
	 *  seeds new workspaces (see {@link ensureDefaultLayoutSeeded}). */
	private async saveAsDefaultLayout(): Promise<void> {
		const snapshot = createDefaultLayoutSnapshot(
			this.container.storage.getWorkspace('graph:columns'),
			this.container.storage.getWorkspace('graph:state'),
		);

		try {
			await this.container.storage.store('graph:defaultLayout', snapshot);
		} catch (ex) {
			Logger.error(ex, 'graph: failed to save default layout');
			return;
		}

		void setContext('gitlens:graph:hasSavedDefaultLayout', true);
		void window.showInformationMessage(
			'Saved the current Commit Graph layout as your default. New workspaces will open with it.',
		);
	}

	/** The id of the whole-remote "Hide Remote" wildcard entry (`type: 'remote'`, `name: '*'`) covering
	 *  `owner`, if one is currently stored. */
	private findWildcardExcludeId(
		storedExcludeRefs: StoredGraphFilters['excludeRefs'],
		owner: string,
	): string | undefined {
		for (const id in storedExcludeRefs) {
			const stored = storedExcludeRefs[id];
			if (stored.type === 'remote' && stored.name === '*' && stored.owner === owner) return id;
		}
		return undefined;
	}

	/** Hides/un-hides refs. Resolves only once the storage write has landed and the filters event has
	 *  fired, so the caller can treat resolution as "my write is no longer outstanding". */
	private async updateExcludedRefs(
		repoPath: string | undefined,
		refs: GraphExcludedRef[],
		visible: boolean,
	): Promise<void> {
		if (repoPath == null || !refs?.length) return;

		let storedExcludeRefs: StoredGraphFilters['excludeRefs'] = this.getFiltersByRepo(repoPath)?.excludeRefs ?? {};
		for (const ref of refs) {
			// `ref.id` arrives in the CALLER's live perspective, but `repoPath` here is always the home-keyed
			// bucket — so canonicalize to THAT before using the id as a map key or an `except[]` membership
			// check. The read boundary re-stamps in the opposite direction. Without this, un-hiding while
			// rebound deletes a key that was never the one stored, leaving the ref hidden forever. Idempotent
			// when the id already carries the home prefix.
			const storageId = restampFilterRefId(ref.id, repoPath);

			if (!visible) {
				if (ref.name === '*') {
					// A remote can be hidden from more than one row (each branch leaf, or the remote row itself),
					// each keyed by a different id — drop any existing wildcard for the same owner first, or every
					// hide leaves behind a stale duplicate entry. The fresh wildcard carries no `except` — re-hiding
					// a remote clears any exceptions it previously had.
					for (const id in storedExcludeRefs) {
						const stored = storedExcludeRefs[id];
						if (stored.type === 'remote' && stored.name === '*' && stored.owner === ref.owner) {
							storedExcludeRefs = updateRecordValue(storedExcludeRefs, id, undefined);
						}
					}

					storedExcludeRefs = updateRecordValue(storedExcludeRefs, storageId, {
						id: storageId,
						type: ref.type as StoredGraphRefType,
						name: ref.name,
						owner: ref.owner,
					});
					continue;
				}

				// A remote branch already exempted from an active whole-remote wildcard is "hidden" by
				// clearing the exception rather than adding a redundant direct entry — the wildcard already
				// covers it.
				if (ref.type === 'remote' && ref.owner != null) {
					const wildcardId = this.findWildcardExcludeId(storedExcludeRefs, ref.owner);
					if (wildcardId != null) {
						const wildcard: StoredGraphExcludedRef = storedExcludeRefs[wildcardId];
						if (wildcard.except?.includes(storageId)) {
							const except: string[] = wildcard.except.filter((id: string) => id !== storageId);
							const { except: _except, ...rest } = wildcard;
							storedExcludeRefs = updateRecordValue(
								storedExcludeRefs,
								wildcardId,
								except.length ? { ...wildcard, except: except } : rest,
							);
							continue;
						}
					}
				}

				storedExcludeRefs = updateRecordValue(storedExcludeRefs, storageId, {
					id: storageId,
					type: ref.type as StoredGraphRefType,
					name: ref.name,
					owner: ref.owner,
				});
				continue;
			}

			// visible === true — un-hide. A wildcard ref removes itself here (its exceptions die with it);
			// anything else just drops its own direct entry.
			storedExcludeRefs = updateRecordValue(storedExcludeRefs, storageId, undefined);

			// Un-hiding a single remote branch that's still covered by an active whole-remote wildcard
			// excepts it from that wildcard instead of leaving it unreachable.
			if (ref.name !== '*' && ref.type === 'remote' && ref.owner != null) {
				const wildcardId = this.findWildcardExcludeId(storedExcludeRefs, ref.owner);
				if (wildcardId != null) {
					const wildcard: StoredGraphExcludedRef = storedExcludeRefs[wildcardId];
					if (!wildcard.except?.includes(storageId)) {
						storedExcludeRefs = updateRecordValue(storedExcludeRefs, wildcardId, {
							...wildcard,
							except: [...(wildcard.except ?? []), storageId],
						});
					}
				}
			}
		}

		await this.updateFiltersByRepo(repoPath, { excludeRefs: storedExcludeRefs });
		await this.fireFiltersChanged();
		// Hidden state is baked into the side bar's row contexts (`+hidden`/`+hiddenbyremote`), so a visibility
		// change has to rebuild them the same way a pin change does (`updatePinnedRef` below).
		this._panels.notifySidebarInvalidated();
	}

	/** Clears every stored exclusion owned by a remote — the wildcard entry hiding the whole remote plus any
	 *  individually hidden branches under it — in one write. Reuses {@link updateExcludedRefs}'s removal path
	 *  (visible=true removes by entry id) rather than duplicating the storage/notify/invalidate flow. */
	private async showRemoteRefs(repoPath: string | undefined, remoteName: string): Promise<void> {
		const storedExcludeRefs = this.getFiltersByRepo(repoPath)?.excludeRefs;
		if (!hasKeys(storedExcludeRefs)) return;

		const refs: GraphExcludedRef[] = [];
		for (const id in storedExcludeRefs) {
			const stored = storedExcludeRefs[id];
			if (stored.owner === remoteName) {
				refs.push({ id: stored.id, type: stored.type, name: stored.name, owner: stored.owner });
			}
		}

		await this.updateExcludedRefs(repoPath, refs, true);
	}

	/** Pins/unpins a ref. Resolves once the storage write has landed and the filters event has fired. */
	private async updatePinnedRef(repoPath: string | undefined, ref: GraphPinnedRef | null): Promise<void> {
		if (repoPath == null) return;

		// Canonicalize to the home-keyed bucket's path before storing — same as `updateExcludedRefs`. A raw
		// store leaves an id the read boundaries' exact-equality compares never match after unscoping.
		const storedPinnedRef =
			ref != null
				? {
						id: restampFilterRefId(ref.id, repoPath),
						type: ref.type as StoredGraphRefType,
						name: ref.name,
						owner: ref.owner,
					}
				: undefined;

		await this.updateFiltersByRepo(repoPath, { pinnedRef: storedPinnedRef });
		// Re-read rather than passing the new pin through: the snapshot is complete, and the write above is
		// awaited, so storage is authoritative here.
		await this.fireFiltersChanged();
		this._panels.notifySidebarInvalidated();
		// Every HOST-serialized context bakes `+pinned` in when it's built, so each one has to be rebuilt on a
		// pin change: the side bar above, and the WIP header's branch kebab here (`wip.stats.branchContext`).
		// The push survives the send dedupe — that compares payload CONTENT, which the changed context is part of.
		void this._wip.notifyDidChangeWorkingTree();
		// No graph rebuild: row pills build their contexts WEBVIEW-side and see the pin live, so nothing has to
		// walk to refresh `+pinned` there. The lane pin needs no walk either — a changed `pinnedShas` already
		// fails the engine session's `engineOptionsUnchanged` check, so the layout re-runs webview-side.
	}

	private updateFiltersByRepo(repoPath: string | undefined, updates: Partial<StoredGraphFilters>) {
		if (repoPath == null) return;

		const filtersByRepo = this.container.storage.getWorkspace('graph:filtersByRepo');
		return this.container.storage.storeWorkspace(
			'graph:filtersByRepo',
			updateRecordValue(filtersByRepo, repoPath, { ...filtersByRepo?.[repoPath], ...updates }),
		);
	}

	/**
	 * Resolves the include-only ref set for the `agents` branches-visibility scope. Qualifying
	 * agents are those whose `phase` is active (working or waiting) OR whose last activity is
	 * within the `agentBranchesIdleThresholdMs` window. Sessions are scoped to this graph's repo
	 * via worktree path; the matching branch comes from the session's own `worktree.branch.name`
	 * (host-resolved), so the default-worktree case works without depending on `branch.worktree`
	 * being populated on graph branches. `graph.branches` is keyed by branch name (see
	 * `graphRowProcessor.ts`'s `context.branches.get(head.name)`), so we look up by name.
	 */
	private getAgentBranchRefs(graph: GitGraph): Map<string, GraphIncludeOnlyRef> {
		const refs = new Map<string, GraphIncludeOnlyRef>();
		const sessions = this.container.agentStatus?.getSerializedSessions();
		if (!sessions?.length) return refs;

		// Worktree paths belonging to this graph's repo (default + named). Used to scope
		// cross-repo sessions out before name-matching, since branch names alone aren't
		// repo-unique. Iterate `graph.worktrees` (full list) rather than `worktreesByBranch`,
		// which has the default worktree entry stripped during graph construction.
		const repoWorktreePaths = new Set<string>([graph.repoPath]);
		if (graph.worktrees != null) {
			for (const wt of graph.worktrees) {
				repoWorktreePaths.add(wt.path);
			}
		}

		const now = Date.now();
		for (const s of sessions) {
			if (s.worktreePath == null || s.worktree?.branch?.name == null) continue;
			if (!repoWorktreePaths.has(s.worktreePath)) continue;

			// `Math.max(0, …)` clamps clock-skew (future-dated timestamps) so a stale clock
			// can't pin a session as permanently "recent".
			const recent = Math.max(0, now - s.lastActivity) < GraphWebviewProvider.agentBranchesIdleThresholdMs;
			if (!isActiveAgentPhase(s.phase) && !recent) continue;

			const branch = graph.branches.get(s.worktree.branch.name);
			if (branch == null) continue;

			if (!refs.has(branch.id)) {
				refs.set(branch.id, convertBranchToIncludeOnlyRef(branch));
			}
			// Mirror `getVisibleRefs`: pull in the upstream so the remote tracking branch is
			// kept in the include set alongside its local. Without this the graph drops the
			// `origin/<branch>` label and any commits only reachable from the upstream side.
			const upstreamRef = convertBranchUpstreamToIncludeOnlyRef(branch);
			if (upstreamRef != null && !refs.has(upstreamRef.id)) {
				refs.set(upstreamRef.id, upstreamRef);
			}
		}
		return refs;
	}

	private async getVisibleRefs(
		graph: GitGraph,
		currentBranch: GitBranch,
		options?: {
			defaultBranchName: string | undefined;
			baseOrTargetBranchName?: string | undefined;
			associatedPullRequest?: PullRequest | undefined;
		},
	): Promise<Map<string, GraphIncludeOnlyRef>> {
		const refs = new Map<string, GraphIncludeOnlyRef>([
			[currentBranch.id, convertBranchToIncludeOnlyRef(currentBranch)],
		]);

		const upstreamRef = convertBranchUpstreamToIncludeOnlyRef(currentBranch);
		if (upstreamRef != null && !refs.has(upstreamRef.id)) {
			refs.set(upstreamRef.id, upstreamRef);
		}

		let includeDefault = true;

		const baseBranchName = options?.baseOrTargetBranchName;
		if (baseBranchName != null && baseBranchName !== currentBranch?.name) {
			const baseBranch = graph.branches.get(baseBranchName);
			if (baseBranch != null) {
				includeDefault = false;

				if (baseBranch.remote) {
					if (!refs.has(baseBranch.id)) {
						refs.set(baseBranch.id, convertBranchToIncludeOnlyRef(baseBranch, true));
					}
				} else {
					const upstreamRef = convertBranchUpstreamToIncludeOnlyRef(baseBranch);
					if (upstreamRef != null && !refs.has(upstreamRef.id)) {
						refs.set(upstreamRef.id, upstreamRef);
					}
				}
			}
		}

		const pr = options?.associatedPullRequest;
		if (pr?.refs != null) {
			let prBranch;

			const remote = find(graph.remotes.values(), r => r.matches(pr.refs!.base.url));
			if (remote != null) {
				prBranch = graph.branches.get(`${remote.name}/${pr.refs.base.branch}`);
			}

			if (prBranch != null) {
				includeDefault = false;

				if (!refs.has(prBranch.id)) {
					refs.set(prBranch.id, convertBranchToIncludeOnlyRef(prBranch, true));
				}
			}
		}

		if (includeDefault) {
			const defaultBranchName = options?.defaultBranchName;
			if (defaultBranchName != null && defaultBranchName !== currentBranch?.name) {
				const defaultBranch = graph.branches.get(defaultBranchName);
				if (defaultBranch != null) {
					if (defaultBranch.remote) {
						if (!refs.has(defaultBranch.id)) {
							refs.set(defaultBranch.id, convertBranchToIncludeOnlyRef(defaultBranch, true));
						}

						const localDefault = await getLocalBranchByUpstream(defaultBranchName, graph.branches);
						if (localDefault != null) {
							if (!refs.has(localDefault.id)) {
								refs.set(localDefault.id, convertBranchToIncludeOnlyRef(localDefault, false));
							}
						}
					} else {
						if (!refs.has(defaultBranch.id)) {
							refs.set(defaultBranch.id, convertBranchToIncludeOnlyRef(defaultBranch, false));
						}

						const upstreamRef = convertBranchUpstreamToIncludeOnlyRef(defaultBranch);
						if (upstreamRef != null && !refs.has(upstreamRef.id)) {
							refs.set(upstreamRef.id, upstreamRef);
						}
					}
				}
			}
		}

		return refs;
	}

	/** Sets the branches-visibility mode and/or the include-only ref set. Resolves once the storage write
	 *  has landed and the filters event has fired. */
	private async updateIncludeOnlyRefs(
		repoPath: string | undefined,
		branchesVisibility: GraphBranchesVisibility | undefined,
		refs: GraphIncludeOnlyRef[] | undefined,
	): Promise<void> {
		if (repoPath == null) return;

		let storedIncludeOnlyRefs: StoredGraphFilters['includeOnlyRefs'];

		if (!refs?.length) {
			storedIncludeOnlyRefs = undefined;
		} else {
			storedIncludeOnlyRefs = {};
			for (const ref of refs) {
				storedIncludeOnlyRefs[ref.id] = {
					id: ref.id,
					type: ref.type as StoredGraphRefType,
					name: ref.name,
					owner: ref.owner,
				};
			}
		}

		if (branchesVisibility != null) {
			const currentBranchesVisibility = this.getBranchesVisibility(this.getFiltersByRepo(repoPath));

			this.host.sendTelemetryEvent('graph/branchesVisibility/changed', {
				'branchesVisibility.old': currentBranchesVisibility,
				'branchesVisibility.new': branchesVisibility,
			});
		}

		await this.updateFiltersByRepo(repoPath, {
			branchesVisibility: branchesVisibility,
			includeOnlyRefs: storedIncludeOnlyRefs,
		});
		await this.fireFiltersChanged();
	}

	/** Toggles a hidden ref TYPE (remotes/stashes/tags). Resolves once the storage write has landed and
	 *  the filters event has fired. */
	private async updateExcludedTypes(
		repoPath: string | undefined,
		key: keyof GraphExcludeTypes,
		value: boolean,
	): Promise<void> {
		if (repoPath == null) return;

		let excludeTypes = this.getFiltersByRepo(repoPath)?.excludeTypes;
		if (!hasKeys(excludeTypes) && value === false) {
			return;
		}

		excludeTypes = updateRecordValue(excludeTypes, key, value);

		this.host.sendTelemetryEvent('graph/filters/changed', {
			key: key,
			value: value,
		});

		await this.updateFiltersByRepo(repoPath, { excludeTypes: excludeTypes });
		await this.fireFiltersChanged();
	}

	/** Clears every stored filter for the repo. Resolves once the storage write (when there was anything
	 *  to clear) has landed and the filters event has fired. */
	private async resetFilters(repoPath: string | undefined): Promise<void> {
		if (repoPath == null) return;

		const filters = this.getFiltersByRepo(repoPath);
		const cleared = {
			'cleared.branchesVisibility': filters?.branchesVisibility != null,
			'cleared.excludeTypes': hasKeys(filters?.excludeTypes),
			'cleared.includeOnlyRefs': hasKeys(filters?.includeOnlyRefs),
			'cleared.excludeRefs': hasKeys(filters?.excludeRefs),
		};

		if (
			cleared['cleared.branchesVisibility'] ||
			cleared['cleared.excludeTypes'] ||
			cleared['cleared.includeOnlyRefs'] ||
			cleared['cleared.excludeRefs']
		) {
			this.host.sendTelemetryEvent('graph/filters/cleared', cleared);

			const filtersByRepo = this.container.storage.getWorkspace('graph:filtersByRepo');
			await this.container.storage.storeWorkspace(
				'graph:filtersByRepo',
				updateRecordValue(filtersByRepo, repoPath, undefined),
			);
		}

		// Always fire, even when nothing changed: the snapshot is complete so a redundant push is harmless,
		// and the app consumes its deferred scope clear (set by `handleModeClear`) off this push.
		await this.fireFiltersChanged();
	}

	private resetHoverCache() {
		this._hoverCache.clear();
		this.cancelOperation('hover');
	}

	private resetRepositoryState() {
		this._getBranchesAndTagsTips = undefined;
		this._includedRefTipShas = undefined;
		this._data.resetStateNotify();
		this._producers.setLastSentBranchState(undefined);
		// The publisher's cursors are reset by `setGraph(undefined)` → `onGraphIdentityChanged` below.
		// Not resetting `_sidebarEventCounter` / `_firedSidebarEventSeq`: an in-flight rebuild has
		// already captured its `seqAtRebuildStart` and will commit it as the fired watermark — zeroing
		// here would strand the next repo's events below it. Monotonic growth is safe; only deltas matter.
		this._lastFetchedHandlerDebounced?.cancel();
		this._lastSentFetchedAt = undefined;
		this._inspect.resetCaches();
		this.invalidateScopeAnchors();
		this._data.clearStateFreshnessRetryTimer();
		this._data.setGraph(undefined);
		this.setSelectedRows(undefined);
	}

	/** Records the anchor row + the highlight map. `id` is always a ROW id — a commit/stash sha or a
	 *  synthetic WIP row id (`createWipRowId`); the `uncommitted` revision never gets this far. */
	private setSelectedRows(id: string | undefined, selection?: GraphSelection[], state?: SelectedRowState) {
		this._selectedId = id;

		if (selection != null) {
			this._selectedRows = Object.fromEntries(selection.map(r => [r.id, { selected: true, hidden: r.hidden }]));
			if (id != null && !selection.some(r => r.id === id)) {
				this._selectedRows[id] = state ?? { selected: true };
			}
		} else {
			this._selectedRows = id != null ? { [id]: state ?? { selected: true } } : undefined;
		}
	}

	// `@gate` keyed by repoPath+sha so a user double-clicking the row button (or invoking via
	// menu while another push is still resolving) doesn't fire two concurrent
	// `git push <sha>:<upstream>` operations. The IPC surface bypasses the menu's
	// `!operationInProgress` `enablement` gate, so the dedup lives here. The second call
	// awaits the same in-flight promise — both resolve/reject together, so the row button
	// surfaces the same outcome to both invocations.
	@gate((repoPath: string, sha: string) => `${repoPath}:${sha}`)
	private async pushUpToCommit(repoPath: string, sha: string) {
		await RepoActions.pushToCommit(repoPath, sha);
	}

	/**
	 * Guards a history-rewriting rebase against commits that aren't safely rewriteable — i.e. not on the
	 * first-parent chain from HEAD up to (excluding) the first merge (notably when HEAD itself is a merge,
	 * or the selection is an ancestor of one). A plain interactive rebase (no `--rebase-merges`) would
	 * flatten the merge. Uses the chain computed by the graph provider; when that set is unavailable,
	 * returns `true` so the caller's per-commit parent checks still apply. Surfaces a warning and returns
	 * `false` when the selection leaves the chain.
	 */
	/**
	 * Validates a multi-commit selection for a history-rewriting rebase (squash/fixup/drop): every commit
	 * must be loaded in the graph, none may be a merge commit, and the oldest must have a parent to rebase
	 * onto. Returns the selection ordered oldest-last plus whether any commit is already published, or
	 * `undefined` (after surfacing a warning) when the selection can't be rewritten.
	 */
	/**
	 * Runs a headless interactive rebase that applies {@link action} to the selected commits, using the
	 * sequence-editor shim to rewrite the todo and (for squash/reword) VS Code as the commit-message editor.
	 */
	private async runStageConflictResolution(
		item: DetailsItemTypedContext | undefined,
		resolution: 'current' | 'incoming',
	): Promise<void> {
		const value = item?.webviewItemValue;
		if (value?.type !== 'file' || !value.path || !value.repoPath) return;

		const status = value.status;
		// Conflict actions only apply to two-char `XY` conflict statuses (UU/AA/UD/DU/AU/UA/DD).
		// The generic single-char 'U' from `isConflictStatus` doesn't carry the side semantics
		// needed to take ours/theirs.
		if (status == null || !isConflictStatus(status) || status === 'U') return;

		await stageConflictResolution(
			this.container,
			{ path: value.path, repoPath: value.repoPath, status: status },
			resolution,
		);

		// For non-active worktrees, the active-repo working-tree watcher won't fire, so the host's
		// regular `workingTreeChanged` event won't reach the panel. Fetch the updated WIP for this
		// specific repo and push it directly — one `git status`, no round-trip from the panel.
		const repo = await this.container.git.getOrAddRepository(Uri.file(value.repoPath), {
			opened: false,
			detectNested: true,
		});
		const result = repo != null ? await this._wip.getWipForRepoAndStats(repo) : undefined;
		// Serves the client directly, and `value.repoPath` can be the primary — so this is an out-of-band serve and
		// must invalidate the push dedup like any other, or a later push carrying this same content is deduped away.
		if (repo != null && result != null) {
			this._wip.onWipServedOutOfBand(repo, result.wip.revision);
		}
		// Ship `wip` (with stats embedded as `wip.stats`) so the webview never has to re-derive
		// them — the host just did the work, the webview's classifier wouldn't match
		// `git diff --shortstat` semantics for renames/conflicts, and the derived value would drop
		// `pausedOpStatus` / `context` (real visible regressions during a paused op).
		this._wipRefetchedEvent.fire({ repoPath: value.repoPath, wip: result?.wip });
	}

	/** Solo the WIP row's worktree onto its current branch. The WIP context carries only an
	 *  uncommitted revision + `worktreePath`, so resolve that worktree's branch and filter the
	 *  graph (on its own repo) to it. */
	/** Resolves the branch to focus from a Focus context item. Branch leaves/rows and worktree
	 *  leaves carry a branch ref directly; WIP rows carry only `worktreePath`, so resolve its
	 *  current branch. */
	@gate()
	private async _undoCommit(ref: GitRevisionReference, worktreePath: string | undefined): Promise<void> {
		// Only the repoPath changes when routing to a secondary worktree — preserve every other field
		// (name, message, sha) by spreading rather than rebuilding. Avoids fragile string-equality on
		// filesystem paths (Windows casing, trailing-slash variants) and can't silently drop fields.
		const targetRepoPath = worktreePath ?? ref.repoPath;
		const targetRef: GitRevisionReference = { ...ref, repoPath: targetRepoPath };

		const wipRowId = createWipRowId(targetRepoPath);

		await undoCommit(this.container, targetRef, {
			onBeforeReset: message => {
				// Batch the selection move, draft seed, and details-panel open before the reset
				// fires its file-watcher event, so the webview sees one coherent transition rather
				// than three across the refresh boundary. The WIP selection rides the `selectedRows`
				// prop, which the webview echoes into its anchor. `writeWipDraftToStorage` is the
				// durable mirror of the webview-side flush so the message persists across sessions
				// even if the user never edits.
				void this._wip.writeWipDraftToStorage(targetRepoPath, { message: message, messageDirty: true });
				this.setSelectedRows(wipRowId);
				this.notifyDidChangeSelection();
				this._requestActionEvent.fire({
					action: 'show-wip',
					target: { sha: wipRowId, worktreePath: targetRepoPath },
					commitMessage: message,
				});
			},
		});
	}

	private getOpenEditorShowOptions(): (TextDocumentShowOptions & { sourceViewColumn?: ViewColumn }) | undefined {
		if (this.host.is('view')) return undefined;

		const mode = configuration.get('graph.editorOpeningBehavior') ?? 'auto';
		if (mode !== 'auto' || !this.host.active) return undefined;

		return { viewColumn: ViewColumn.Beside, sourceViewColumn: this.host.viewColumn };
	}

	/** Stats for the Changes column are consent-gated: a visible-but-dormant column ships no stats. */
	private isChangesColumnStatsEnabled(): boolean {
		return configuration.get('graph.changesColumn.enabled');
	}

	@debug()
	private async toggleColumn(name: GraphColumnName, visible: boolean) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		let column = columns?.[name];
		if (column != null) {
			column.isHidden = !visible;
		} else {
			column = { isHidden: !visible };
		}

		columns = updateRecordValue(columns, name, column);
		await this.container.storage.storeWorkspace('graph:columns', columns);

		this.fireColumnsChanged();

		if (
			name === 'changes' &&
			this.isChangesColumnStatsEnabled() &&
			!column.isHidden &&
			!this._data.session?.current.includes?.stats
		) {
			// Eager override + flush so the Changes column shows its spinner during the stats-including rebuild.
			this._data.rowsStatsLoadingOverride = true;
			this._graphSync.mark('rowsStats');
			void this._graphSync.flush();
			this._data.updateState();
		}
	}

	@debug()
	private async toggleColumnGrouping(name: 'graph' | 'ref', grouped: boolean) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		const column = { ...columns?.[name], grouped: grouped };

		columns = updateRecordValue(columns, name, column);
		await this.container.storage.storeWorkspace('graph:columns', columns);

		this.fireColumnsChanged();
	}

	@debug()
	private async toggleScrollMarker(type: GraphScrollMarkersAdditionalTypes, enabled: boolean) {
		let scrollMarkers = configuration.get('graph.scrollMarkers.additionalTypes');
		let updated = false;
		if (enabled && !scrollMarkers.includes(type)) {
			scrollMarkers = [...scrollMarkers, type];
			updated = true;
		} else if (!enabled && scrollMarkers.includes(type)) {
			scrollMarkers = scrollMarkers.filter(marker => marker !== type);
			updated = true;
		}

		if (updated) {
			await configuration.updateEffective('graph.scrollMarkers.additionalTypes', scrollMarkers);
			this.fireColumnsChanged();
		}
	}

	@debug()
	private async setColumnMode<T extends GraphColumnName>(name: T, mode?: GraphColumnModeFor<T>) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		let column = columns?.[name];
		if (column != null) {
			column.mode = mode;
		} else {
			column = { mode: mode };
		}

		columns = updateRecordValue(columns, name, column);
		await this.container.storage.storeWorkspace('graph:columns', columns);

		this.fireColumnsChanged();
	}

	/** The user's current/active worktree path — anchors compare actions whose intent is "from
	 *  where I'm working" (compare-with-HEAD/Working/MergeBase). The graph's `this.repository`
	 *  follows the user's selected repo in the graph header; its `.path` is the worktree the
	 *  user is currently focused on. Falls back to the clicked ref's repoPath if `this.repository`
	 *  is unset (rare — preserves prior behavior rather than dropping the action). */
	/** Maps a {@link GitReference}'s `refType` to the narrower compare-mode triple the graph
	 *  details panel uses ({@link DidRequestOpenCompareModeParams}). `revision` and `stash`
	 *  collapse to `commit`; the panel doesn't distinguish stashes here (they're reachable as
	 *  commit shas). */
	/** Pushes the request to the graph webview to enter compare mode with the supplied refs.
	 *  Fire-and-forget; the webview applies it on next render. Replaces the prior pattern of
	 *  routing graph compare actions through the Search & Compare sidebar view. */
	/** Pushes the request to the graph webview to switch into its embedded Visual History
	 *  (timeline) display mode, scoped to the given file/folder. Fire-and-forget. */
	private notifyOpenTimelineScope(params: DidRequestOpenTimelineScopeParams): void {
		this._requestOpenTimelineScopeEvent.fire(params);
	}

	/** Pushes a search query to the graph webview without triggering a full state refresh — the
	 *  webview applies it directly via `graphHeader.setExternalSearchQuery`. Used by callers like
	 *  "Open File History" that want to filter the graph without re-fetching rows/refs/stats. */
	private notifyRequestSearch(params: DidRequestSearchParams): void {
		this._searchService.requestSearch(params);
	}

	/**
	 * Resolves a branch ref from either a {@link GraphItemContext} (graph row context-menu / inline
	 * action path) or a {@link BranchRef} (webview action-link path used by the graph overview
	 * card and other panels). The latter only carries identity (repoPath / branchName), so we
	 * rehydrate the full {@link GitBranchReference} via the repository service.
	 */
	private createCancellation(op: CancellableOperations) {
		this.cancelOperation(op);

		const cancellation = new CancellationTokenSource();
		this._cancellations.set(op, cancellation);
		return cancellation;
	}

	private cancelOperation(op: CancellableOperations) {
		const source = this._cancellations.get(op);
		if (source != null) {
			source.cancel();
			// `CancellationTokenSource` holds internal event-emitter listeners. Without `.dispose()`
			// every supersede leaks those listeners — bounded by the number of distinct `op` keys
			// in flight, but still observable across long sessions.
			source.dispose();
			this._cancellations.delete(op);
		}
	}
}

function convertBranchToIncludeOnlyRef(branch: GitBranch, remote?: boolean): GraphIncludeOnlyRef {
	return (remote ?? branch.remote)
		? { id: branch.id, type: 'remote', name: branch.nameWithoutRemote, owner: branch.remoteName }
		: { id: branch.id, type: 'head', name: branch.name };
}

function convertBranchUpstreamToIncludeOnlyRef(branch: GitBranch): GraphIncludeOnlyRef | undefined {
	if (branch.upstream == null || branch.upstream.missing) return undefined;

	const id = getBranchId(branch.repoPath, true, branch.upstream.name);
	return {
		id: id,
		type: 'remote',
		name: getBranchNameWithoutRemote(branch.upstream.name),
		owner: branch.remoteName,
	};
}

function convertRefToGraphRefType(ref: GitReference): GraphRefType | undefined {
	switch (ref.refType) {
		case 'branch':
			if (ref.remote) return 'remote';
			if (ref.worktree) return 'worktree';
			return 'head';
		case 'tag':
			return 'tag';
		default:
			return undefined;
	}
}

function convertSelectedRows(selectedRows: Record<string, SelectedRowState> | undefined): GraphSelectedRows {
	return filterMapObject(selectedRows, (_, v) => (v.selected ? true : undefined));
}

/** Normalizes `gitlens.graph.shortcuts.overrides` values for the component config: a single key
 *  combination becomes a one-element list, lists and `false` pass through unchanged, and any other
 *  (malformed, since settings.json is freeform) value is dropped. */
function normalizeShortcutOverrides(
	overrides: Record<string, string | string[] | false>,
): Record<string, readonly string[] | false> {
	return filterMapObject(overrides, (_, value) => {
		if (value === false) return false;
		if (Array.isArray(value) || typeof value === 'string') return ensureArray(value);

		return undefined;
	});
}
