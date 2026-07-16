import type { CancellationToken, ColorTheme, ConfigurationChangeEvent, TextDocumentShowOptions } from 'vscode';
import { CancellationTokenSource, commands, Disposable, Uri, ViewColumn, window, workspace } from 'vscode';
import { isWeb } from '@env/platform.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitGraph, GitGraphRow, GitGraphRowType } from '@gitlens/git/models/graph.js';
import type { GitGraphSessionChangedChannels } from '@gitlens/git/models/graphSession.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitReference, GitRevisionReference, GitStashReference } from '@gitlens/git/models/reference.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchId, getBranchNameWithoutRemote, getLocalBranchByUpstream } from '@gitlens/git/utils/branch.utils.js';
import { getLastFetchedUpdateInterval } from '@gitlens/git/utils/fetch.utils.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import { serializePullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isSha, isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import type { IssuesCloudHostIntegrationId } from '@gitlens/integrations/constants.js';
import { supportedOrderedCloudIssuesIntegrationIds } from '@gitlens/integrations/constants.js';
import type { ConnectionStateChangeEvent } from '@gitlens/integrations/integrationService.js';
import { filterMap } from '@gitlens/utils/array.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { CoalescedRun } from '@gitlens/utils/coalescedRun.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { DedupedAsyncCache } from '@gitlens/utils/dedupedAsyncCache.js';
import { disposableInterval } from '@gitlens/utils/disposable.js';
import { find } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { filterMap as filterMapObject, flatten, hasKeys, updateRecordValue } from '@gitlens/utils/object.js';
import { normalizePath } from '@gitlens/utils/path.js';
import {
	getSettledValue,
	pauseOnCancelOrTimeout,
	pauseOnCancelOrTimeoutMapTuplePromise,
} from '@gitlens/utils/promise.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import { isActiveAgentPhase } from '../../../agents/provider.js';
import { fetchAvatarImageAsDataUri, getAvatarUri } from '../../../avatars.js';
import { parseCommandContext } from '../../../commands/commandContext.utils.js';
import type { OpenIssueOnRemoteCommandArgs } from '../../../commands/openIssueOnRemote.js';
import type {
	GraphBranchesVisibility,
	GraphMinimapMarkersAdditionalTypes,
	GraphScrollMarkersAdditionalTypes,
} from '../../../config.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { ContextKeys } from '../../../constants.context.js';
import type { StoredGraphFilters, StoredGraphRefType } from '../../../constants.storage.js';
import type {
	GraphShownTelemetryContext,
	GraphTelemetryContext,
	WebviewTelemetryEvents,
} from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { FeaturePreview } from '../../../features.js';
import { getFeaturePreviewStatus } from '../../../features.js';
import { openCommitChanges, openCommitChangesWithWorking, undoCommit } from '../../../git/actions/commit.js';
import * as RepoActions from '../../../git/actions/repository.js';
import * as StashActions from '../../../git/actions/stash.js';
import { CommitFormatter } from '../../../git/formatters/commitFormatter.js';
import { GlGraphRowProcessor } from '../../../git/graphRowProcessor.js';
import type { RepositoryChangeEvent, RepositoryWorkingTreeChangeEvent } from '../../../git/models/repository.js';
import { GlRepository } from '../../../git/models/repository.js';
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
import { getRemoteIconUri } from '../../../git/utils/-webview/icons.js';
import {
	getBestRemoteWithIntegration,
	getRemoteIntegration,
	getRemoteProviderUrl,
	remoteSupportsIntegration,
} from '../../../git/utils/-webview/remote.utils.js';
import { getSiblingWorktreeBranches, getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import type { OnboardingChangeEvent } from '../../../onboarding/onboardingService.js';
import type { UsageChangeEvent } from '../../../onboarding/usageTracker.js';
import type { Subscription } from '../../../plus/gk/models/subscription.js';
import type { FeaturePreviewChangeEvent, SubscriptionChangeEvent } from '../../../plus/gk/subscriptionService.js';
import { isHooksBannerEnabled, isMcpBannerEnabled } from '../../../plus/gk/utils/-webview/mcp.utils.js';
import { showComparisonPicker } from '../../../quickpicks/comparisonPicker.js';
import { showContributorsPicker } from '../../../quickpicks/contributorsPicker.js';
import { showReferencePicker2 } from '../../../quickpicks/referencePicker.js';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker } from '../../../quickpicks/repositoryPicker.js';
import { cancelAndDispose, toAbortSignal } from '../../../system/-webview/cancellation.js';
import { executeCommand, executeCoreCommand, registerCommand } from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext, onDidChangeContext } from '../../../system/-webview/context.js';
import type { StorageChangeEvent } from '../../../system/-webview/storage.js';
import { isDarkTheme, isLightTheme } from '../../../system/-webview/vscode.js';
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
import type { IpcParams, IpcResponse } from '../../ipc/handlerRegistry.js';
import { ipcCommand, ipcRequest } from '../../ipc/handlerRegistry.js';
import type { IpcNotification } from '../../ipc/models/ipc.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../../rpc/eventVisibilityBuffer.js';
import { createRpcEvent } from '../../rpc/eventVisibilityBuffer.js';
import { LaunchpadService } from '../../rpc/launchpadService.js';
import { createSharedServices, proxyServices } from '../../rpc/services/common.js';
import type { GetOverviewEnrichmentResponse, GetOverviewWipResponse } from '../../shared/overviewBranches.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider.js';
import type { WebviewPanelShowCommandArgs, WebviewShowOptions } from '../../webviewsController.js';
import { isSerializedState } from '../../webviewsController.js';
import type { TimelineCommandArgs } from '../timeline/registration.js';
import { checkForAbandonedComposeStashes } from './compose/utils.js';
import type { DetailsItemContext, DetailsItemTypedContext } from './detailsProtocol.js';
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
import type { GraphServices } from './graphService.js';
import { isSidebarOriginContext, resolveSidebarContextMenuAction } from './graphSidebarActionTelemetry.js';
import { GraphSyncPublisher } from './graphSyncPublisher.js';
import type { GraphSyncDataSource, GraphSyncHost } from './graphSyncPublisher.js';
import {
	activityDecayToMs,
	defaultGraphColumnsSettings,
	formatRepositories,
	hasGitReference,
	isGraphItemRefContext,
	isGraphItemTypedContext,
} from './graphWebview.utils.js';
import type { GraphWipServiceContext } from './graphWipService.js';
import { GraphWipService } from './graphWipService.js';
import type {
	BranchState,
	CloseGraphWalkthroughBannerParams,
	DidGetSidebarDataParams,
	DidRequestOpenTimelineScopeParams,
	DidRequestSearchParams,
	emptySetMarker,
	GetWipLineStatsResponse,
	GetWipStatsResponse,
	GraphActionTarget,
	GraphAutoFetchMode,
	GraphColumnConfig,
	GraphColumnName,
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphComponentConfig,
	GraphDisplayMode,
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphIncludeOnlyRef,
	GraphIncludeOnlyRefs,
	GraphItemContext,
	GraphMinimapMarkerTypes,
	GraphOverviewData,
	GraphPinnedRef,
	GraphRefOptData,
	GraphRefType,
	GraphRepository,
	GraphScrollMarkerTypes,
	GraphSelectedRows,
	GraphSelection,
	GraphShowAction,
	GraphSidebarPanel,
	GraphWalkthroughBannerState,
	SidebarWorktreeChange,
	State,
} from './protocol.js';
import {
	ChooseAuthorRequest,
	ChooseComparisonRequest,
	ChooseFileRequest,
	ChooseRefRequest,
	ChooseRepositoryCommand,
	CloseGraphWalkthroughBannerCommand,
	createSecondaryWipSha,
	createWipSha,
	DidChangeAgentSessionsNotification,
	DidChangeBranchStateNotification,
	DidChangeCanInstallClaudeHook,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeGraphWalkthroughBanner,
	DidChangeGraphWalkthroughComplete,
	DidChangeGraphWalkthroughStarted,
	DidChangeHooksBanner,
	DidChangeMcpBanner,
	DidChangeNotification,
	DidChangeOrgSettings,
	DidChangeOverviewNotification,
	DidChangePinnedRefNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeVisualizationsButtonCallout,
	DidChangeWipDraftsNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidInvalidateGraphTreemapNotification,
	DidInvalidateScopeAnchorsNotification,
	DidRequestActiveSidebarPanelNotification,
	DidRequestGraphActionNotification,
	DidRequestOpenTimelineScopeNotification,
	DidRequestSearchNotification,
	DidRequestWipRefetchNotification,
	DidStartFeaturePreviewNotification,
	DismissVisualizationsButtonCalloutCommand,
	DoubleClickedCommand,
	EnsureRowRequest,
	GetAgentSessionsRequest,
	GetCountsRequest,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	GetOverviewEnrichmentRequest,
	GetOverviewRequest,
	GetOverviewWipDetailedRequest,
	GetOverviewWipRequest,
	GetRowHoverRequest,
	getSecondaryWipPath,
	GetWipLineStatsRequest,
	GetWipStatsRequest,
	GraphSyncResyncCommand,
	isSecondaryWipSha,
	JumpToHeadRequest,
	OpenPullRequestDetailsCommand,
	ProxyAvatarsCommand,
	ResetGraphFiltersCommand,
	ResolveGraphScopeRequest,
	RowActionCommand,
	SearchCancelCommand,
	SearchHistoryDeleteRequest,
	SearchHistoryGetRequest,
	SearchHistoryStoreRequest,
	SearchOpenInViewCommand,
	SearchRequest,
	SyncWipWatchesCommand,
	TrackGraphDetailsCompareModeCommand,
	TrackGraphDetailsComposeModeCommand,
	TrackGraphDetailsResolveModeCommand,
	TrackGraphDetailsReviewModeCommand,
	TrackGraphDetailsWipShownCommand,
	TrackGraphOverviewShownCommand,
	TrackGraphScopeChangedCommand,
	TreemapFileActionCommand,
	UpdateColumnsCommand,
	UpdateExcludeTypesCommand,
	UpdateGraphConfigurationCommand,
	UpdateGraphDisplayModeCommand,
	UpdateGraphSearchModeCommand,
	UpdateIncludedRefsCommand,
	UpdatePinnedRefCommand,
	UpdateRefsVisibilityCommand,
	UpdateSelectionCommand,
	UpdateWipDraftCommand,
} from './protocol.js';
import type { GraphWebviewShowingArgs } from './registration.js';

export interface SelectedRowState {
	selected: boolean;
	hidden?: boolean;
}

/** Host-side shape returned by the scope-anchor resolver. `focalBranchTipSha` is set whenever
 *  the focal branch has a resolvable tip (almost always); `mergeBase` / `mergeTargetTipSha` are
 *  only set when there's a real merge target distinct from the focal branch. */
interface ResolvedScopeAnchor {
	focalBranchTipSha?: string;
	mergeBase?: { sha: string; date: number };
	mergeTargetTipSha?: string;
}

function hasRepository(arg: any): arg is { repository: GlRepository; search?: SearchQuery; selectSha?: string } {
	return arg?.repository != null;
}

function hasSearchQuery(arg: any): arg is { repository: GlRepository; search: SearchQuery; selectSha?: string } {
	return hasRepository(arg) && arg.search != null;
}

function hasSidebarPanel(arg: any): arg is { sidebarPanel: GraphSidebarPanel } {
	return typeof arg?.sidebarPanel === 'string';
}

function hasAction(arg: any): arg is { action: GraphShowAction; target?: GraphActionTarget } {
	return typeof arg?.action === 'string';
}

type CancellableOperations =
	| 'branchState'
	| 'branchStateOnly'
	| 'hover'
	| 'computeIncludedRefs'
	| 'search'
	| 'state'
	| 'wipStats'
	| 'workingTree';

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
		// call notifies for the new repoPath — leaving the webview's `_mergeBaseCache` entries keyed by
		// the previous path stranded. Notify for the previous path explicitly to drop them.
		const previousPath = this._repository?.path;
		this._repository = value;
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
			void this.host.notify(DidInvalidateScopeAnchorsNotification, { repoPath: previousPath });
		}

		if (this.host.ready) {
			this._data.updateState();
		}
	}

	private _selection: readonly GitRevisionReference[] | undefined;
	private get activeSelection(): GitRevisionReference | undefined {
		return this._selection?.[0];
	}

	private _cancellations = new Map<CancellableOperations, CancellationTokenSource>();
	private _discovering: Promise<number | undefined> | undefined;
	private readonly _disposable: Disposable;
	private _etag?: number;
	private _etagSubscription?: number;
	private _etagRepository?: number;
	private _getBranchesAndTagsTips:
		| ((sha: string, options?: { compact?: boolean; icons?: boolean }) => string | undefined)
		| undefined;
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

	// Map value type is `() => Promise<boolean | void>` so we can include notify methods that don't
	// return whether they sent (e.g. `notifyDidChangeBranchStateOnly`, `notifyDidChangeOverview`).
	// The consumer in `sendPendingIpcNotifications` `void`s the call so the boolean is unused.
	private readonly _ipcNotificationMap = new Map<IpcNotification<any>, () => Promise<boolean | void>>([
		[DidChangeBranchStateNotification, () => this._producers.notifyDidChangeBranchStateOnly()],
		[DidChangeColumnsNotification, this.notifyDidChangeColumns],
		[DidChangeGraphConfigurationNotification, this.notifyDidChangeConfiguration],
		[DidChangeNotification, () => this._data.notifyDidChangeState()],
		[DidChangeOverviewNotification, () => this._panels.notifyDidChangeOverview()],
		[DidChangePinnedRefNotification, this.notifyDidChangePinnedRef],
		[DidChangeRefsVisibilityNotification, this.notifyDidChangeRefsVisibility],
		[DidChangeScrollMarkersNotification, this.notifyDidChangeScrollMarkers],
		[DidChangeSelectionNotification, this.notifyDidChangeSelection],
		[DidChangeSubscriptionNotification, this.notifyDidChangeSubscription],
		[DidChangeWipDraftsNotification, () => this._wip.notifyDidChangeWipDrafts()],
		[DidChangeWorkingTreeNotification, () => this._wip.notifyDidChangeWorkingTree()],
		[DidFetchNotification, this.notifyDidFetch],
		[DidStartFeaturePreviewNotification, this.notifyDidStartFeaturePreview],
	]);
	private _selectedId?: string;
	private _selectedRows: Record<string, SelectedRowState> | undefined;
	private _theme: ColorTheme | undefined;
	private _repositoryEventsDisposable: Disposable | undefined;
	private _lastFetchedDisposable: Disposable | undefined;
	private _treemapInvalidateSubscription: Disposable | undefined;

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

	// Single writer for the rows-plane channels (rows/reachability/rowsStats/avatars/downstreams/
	// refsMetadata). Owns the delivery cursors and `{generation, seq}` stamping; its sends go over the
	// `queueable: false` `DidChangeRowsNotification` so a failed send is recovered ONLY by the publisher's
	// own snapshot — never double-applied via a controller requeue.
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
		return (this._graphRowProcessor ??= new GlGraphRowProcessor(
			this.container,
			uri => this.host.asWebviewUri(uri),
			() => this.getFiltersByRepo(this.repository?.path ?? this._data.session?.repoPath)?.pinnedRef?.id,
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
			this.container.onboarding.onDidChange(this.onOnboardingChanged, this),
			this.container.walkthrough.onDidChangeProgress(this.onGraphWalkthroughProgressChanged, this),
			this.container.usage.onDidChange(this.onUsageChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.subscription.onDidChangeFeaturePreview(this.onFeaturePreviewChanged, this),
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
					}
					if (removed.length === 0 && (added.length === 0 || added.every(r => r.isWorktree))) {
						this._etag = this.container.git.etag;
						return;
					}

					this._data.updateState();
				}
			}),
			window.onDidChangeActiveColorTheme(this.onThemeChanged, this),
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
			this.container.agentStatus?.onDidChangeSessions(this.onAgentSessionsChanged, this) ?? {
				dispose: () => {},
			},
			this.container.agentStatus?.onDidChangeHooksInstallState(
				() => void this.notifyDidChangeCanInstallClaudeHook(),
				this,
			) ?? { dispose: () => {} },
		);

		this.subscribeToTreemapInvalidations();
	}

	private subscribeToTreemapInvalidations(): void {
		this._treemapInvalidateSubscription?.dispose();
		this._treemapInvalidateSubscription = undefined;

		// Avoid even constructing the aggregator service (its getter is lazy) when the experimental
		// flag is off — and skip the IPC notify path entirely since the treemap will never mount.
		if (configuration.get('graph.experimental.visualizations.enabled') !== true) return;

		this._treemapInvalidateSubscription = this.container.treemapAggregator.onDidInvalidate(repoPath => {
			void this.host.notify(DidInvalidateGraphTreemapNotification, { repoPath: repoPath });
		});
	}

	/** Shared collaborator members most service contexts declare — spread into the factories whose
	 *  context type includes all of these. */
	private createBaseServiceContext() {
		return {
			container: this.container,
			host: this.host,
			getRepository: () => this.repository,
			getSession: () => this._data.session,
			addPendingNotification: (notification: IpcNotification<any>) =>
				this.host.addPendingIpcNotification(notification, this._ipcNotificationMap, this),
		};
	}

	/** Collaborator surface {@link GraphCommands} reaches for. `getRepository`/`getSession`/
	 *  `getActiveSelection` read live provider state (it changes over the webview's life); the rest
	 *  forward to provider methods that stay here — column/scroll config, WIP drafts, selection,
	 *  conflict staging, undo. */
	private createGraphCommandsContext(): GraphCommandsContext {
		return {
			container: this.container,
			host: this.host,
			getRepository: () => this.repository,
			getSession: () => this._data.session,
			getActiveSelection: () => this.activeSelection,
			toggleColumn: (name, visible) => this.toggleColumn(name, visible),
			toggleScrollMarker: (type, enabled) => this.toggleScrollMarker(type, enabled),
			setColumnMode: (name, mode) => this.setColumnMode(name, mode),
			updateColumns: columnsCfg => this.updateColumns(columnsCfg),
			setSelectedRows: (id, selection, state) => this.setSelectedRows(id, selection, state),
			notifyDidChangeSelection: () => this.notifyDidChangeSelection(),
			writeWipDraftToStorage: (worktreePath, draft) => this._wip.writeWipDraftToStorage(worktreePath, draft),
			pushUpToCommit: (repoPath, sha) => this.pushUpToCommit(repoPath, sha),
			getOpenEditorShowOptions: () => this.getOpenEditorShowOptions(),
			runStageConflictResolution: (item, resolution) => this.runStageConflictResolution(item, resolution),
			updateExcludedRefs: (repoPath, refs, visible) => this.updateExcludedRefs(repoPath, refs, visible),
			updatePinnedRef: (repoPath, ref) => this.updatePinnedRef(repoPath, ref),
			_undoCommit: (ref, worktreePath) => this._undoCommit(ref, worktreePath),
		};
	}

	/** Collaborator surface {@link GraphWipService} reaches for. `getRepository`/`getSession` read
	 *  live provider state; the rest forward to provider state/methods that stay here — revision
	 *  refs, pinned-ref lookup, the sidebar-worktree RPC event, and the pending-notification queue. */
	private createGraphWipContext(): GraphWipServiceContext {
		return {
			...this.createBaseServiceContext(),
			getRevisionReference: (repoPath, id, type) => this.getRevisionReference(repoPath, id, type),
			getPinnedRefId: repoPath => this.getFiltersByRepo(repoPath)?.pinnedRef?.id,
			fireSidebarWorktreeChanges: changes => this._sidebarWorktreeEvent.fire({ changes: changes }),
		};
	}

	/** Collaborator surface {@link GraphProducersService} reaches for. `getRepository`/`getSession`/
	 *  `getSync` read live provider state; `updateState` forwards to the data controller; cancellation
	 *  and the pending-notification queue route through the provider's shared maps, which stay here. */
	private createGraphProducersContext(): GraphProducersServiceContext {
		return {
			...this.createBaseServiceContext(),
			getSync: () => this._graphSync,
			updateState: immediate => this._data.updateState(immediate),
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
			getSearch: () => this._searchService.search,
			getSearchIdCounterCurrent: () => this._searchService.searchIdCounterCurrent,
			getEtagRepository: () => this._etagRepository,
			getConvertedSelectedRows: () => convertSelectedRows(this._selectedRows),
			getSidebarEventSeq: () => this._sidebarEventCounter.current,
			getFiredSidebarSeq: () => this._firedSidebarEventSeq,
			setFiredSidebarSeq: seq => (this._firedSidebarEventSeq = seq),
			setLastSentBranchState: branchState => this._producers.setLastSentBranchState(branchState),
			setSelectedRows: (id, selection, state) => this.setSelectedRows(id, selection, state),
			buildSearchRider: () => this._searchService.buildSearchRider(),
			buildState: () => this.getState(),
			resetSearchState: () => this._searchService.resetSearchState(),
			resetRefsMetadata: () => void this._producers.resetRefsMetadata(),
			resetHoverCache: () => this.resetHoverCache(),
			clearAvatarProxyCaches: () => {
				this._avatarProxyCache.clear();
				this._avatarProxyFailed.clear();
			},
			clearLastSentOverview: () => this._panels.clearLastSentOverview(),
			cancelComputeIncludedRefs: () => this.cancelOperation('computeIncludedRefs'),
			replayPendingRefMetadataForGraph: graph => this._producers.replayPendingRefMetadataForGraph(graph),
			searchGraphOrContinue: (e, progressive) => this._searchService.searchGraphOrContinue(e, progressive),
			notifyDidChangeOverview: () => void this._panels.notifyDidChangeOverview(),
			notifySidebarInvalidated: () => this._panels.notifySidebarInvalidated(),
			notifyDidChangeSelection: () => void this.notifyDidChangeSelection(),
			notifyDidChangeCanInstallClaudeHook: () => void this.notifyDidChangeCanInstallClaudeHook(),
			resetWipSendState: () => this._wip.resetSendState(),
			clearWipStatusCache: () => this._wip.clearStatusCache(),
			addPendingNotification: notification =>
				this.host.addPendingIpcNotification(notification, this._ipcNotificationMap, this),
		};
	}

	/** Collaborator surface {@link GraphPanelsService} reaches for. `getRepository`/`getSession`/
	 *  `getLoading` read live provider state; `getPinnedRefId`/`fetchWipStatus`/`computeWorktreeChanges`
	 *  forward into the WIP service's caches; `fireSidebarInvalidated` fires the provider's RPC event
	 *  (subscribed in `getRpcServices`); the pending-notification queue routes through the provider's
	 *  shared `_ipcNotificationMap`, which stays here. */
	private createGraphPanelsContext(): GraphPanelsServiceContext {
		return {
			...this.createBaseServiceContext(),
			getLoading: () => this._data.loading,
			getPinnedRefId: repoPath => this.getFiltersByRepo(repoPath)?.pinnedRef?.id,
			fetchWipStatus: (path, signal) => this._wip.getStatusFromCache(path, signal),
			computeWorktreeChanges: worktrees => this._wip.computeWorktreeChanges(worktrees),
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
	 *  controller; `getWipMetadataBySha` forwards into the WIP service; the search cancellation callbacks
	 *  route through the provider's shared `_cancellations` map, which stays here. */
	private createGraphSearchContext(): GraphSearchServiceContext {
		return {
			container: this.container,
			host: this.host,
			getRepository: () => this.repository,
			getSession: () => this._data.session,
			getSelectedId: () => this._selectedId,
			getSelectedRows: () => this._selectedRows,
			getConvertedSelectedRows: () => convertSelectedRows(this._selectedRows),
			getEtagRepository: () => this._etagRepository,
			setSelectedRows: (id, selection, state) => this.setSelectedRows(id, selection, state),
			updateState: immediate => this._data.updateState(immediate),
			updateGraphWithMoreRows: id => this._data.updateGraphWithMoreRows(id),
			notifyDidChangeRows: () => this._data.notifyDidChangeRows(),
			getWipMetadataBySha: () => this._wip.getWipMetadataBySha(),
			createSearchCancellation: () => this.createCancellation('search'),
			cancelSearchOperation: () => this.cancelOperation('search'),
		};
	}

	/** Transport surface for the rows-plane publisher — `DidChangeRowsNotification` is `queueable: false`,
	 *  so a failed send bypasses the controller's pending-notification queue and is recovered only by the
	 *  publisher's own snapshot (no double-apply). */
	private createGraphSyncHost(): GraphSyncHost {
		return {
			isReady: () => this.host.ready,
			isVisible: () => this.host.visible,
			notify: async params => {
				const ok = await this.host.notify(DidChangeRowsNotification, params, undefined);
				if (!ok) {
					// The publisher recovers with a snapshot on the next trigger; warn so storms/soaks can
					// assert on delivery health from the persisted log.
					Logger.warn(
						`GraphSyncPublisher: rows-plane send failed (gen=${params.sync?.generation}, seq=${params.sync?.seq}, snapshot=${params.sync?.snapshot === true}); will recover via snapshot`,
					);
				}
				return ok;
			},
		};
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
			getAvatars: () => this._data.session?.current.avatars,
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
			getRefsMetadata: () => this._producers.refsMetadata,
			isRefsMetadataEnabled: () => this._producers.isRefsMetadataEnabled,
		};
	}

	/** Flush any pending rows-plane state to the webview (delivers marks accumulated while hidden/not-ready,
	 *  or recovers a previously-broken send with a snapshot). Records the connection-ready seq watermark
	 *  first so the webview's post-bootstrap sync-hello can be satisfied by this connection's emissions
	 *  instead of forcing a redundant second snapshot of the initial page. */
	onReady(): void {
		// A (re)booted iframe rebuilt its app state WITHOUT search results (bootstrap State doesn't carry
		// them) — un-gate the search rider AND attach it to THIS flush: invalidation alone leaves the
		// restore waiting for the next rows emission, which on an idle repo may be arbitrarily far away.
		this._searchService.invalidateRider();
		this._graphSync.attachRiders({ search: this._searchService.buildSearchRider() });
		this._graphSync.onConnectionReady();
		void this._graphSync.flush();
	}

	/** A soft-reconnected iframe re-boots from the ORIGINAL bootstrap plus the replay buffer — anything
	 *  the buffer no longer holds (pruned by a State reset, or an expired window) is invisible to it.
	 *  Re-record the connection watermark so the reconnect's sync-hello can only be satisfied by
	 *  emissions made from this point on: a hello reporting an older baseline forces a fresh snapshot
	 *  instead of trusting a possibly-pruned replay. (Within-window reloads pay one redundant snapshot —
	 *  rare path, correctness over bytes.) */
	onReconnect(): void {
		// See onReady — a soft-reconnected iframe also reboots without search results, and must get the
		// search envelope on THIS flush, not whenever the next rows emission happens to occur.
		this._searchService.invalidateRider();
		this._graphSync.attachRiders({ search: this._searchService.buildSearchRider() });
		this._graphSync.onConnectionReady();
		void this._graphSync.flush();
	}

	private _disposed = false;

	dispose(): void {
		this._disposed = true;
		this.clearAutoFetchTimer();
		this._data.clearStateFreshnessRetryTimer();
		// Cancel + dispose every in-flight cancellation source, else the awaitee resolves and calls
		// `host.notify` on a torn-down host and its listeners leak for the extension's lifetime.
		cancelAndDispose(this._cancellations.values());
		this._cancellations.clear();
		// Cancel any in-flight load-more so its `graph.more()` resolution can't call setGraph on a
		// disposed instance.
		this._data.cancelPendingRowsQuery();
		// Cancels the pending refsMetadata debounced notify.
		this._producers.dispose();
		// Cancel the other debounced notifiers too — a trailing fire after dispose would call
		// `host.notify()` on a torn-down host (the exact class of bug this dispose pass exists
		// to fix). `_fireSelectionChangedDebounced` is technically host-I/O-free but cancelling
		// it still clears its pending timer.
		this._data.cancelDebouncedNotifiers();
		this._fireSelectionChangedDebounced?.cancel();
		// Flush any pending session snapshot (reads the session) BEFORE disposing the session below.
		this._data.disposeStoreAndSession();
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
	private readonly _sidebarWorktreeEvent = createRpcEvent<{
		changes: Record<string, SidebarWorktreeChange | undefined>;
	}>('sidebarWorktreeState', 'save-last');

	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): GraphServices {
		const base = createSharedServices(this.container, this.host, () => {}, buffer, tracker);
		const { graphInspect, graphTimeline, graphTreemap } = this._inspect.createServices(buffer, tracker);

		return proxyServices({
			...base,
			graphInspect: graphInspect,
			sidebar: {
				getSidebarData: (panel, signal) => this.onGetSidebarData({ panel: panel }, signal),
				getSidebarCounts: () => this.onGetCounts(),
				toggleLayout: panel => this.onSidebarToggleLayout({ panel: panel }),
				refresh: panel => this.onSidebarRefresh({ panel: panel }),
				executeAction: (command, context, args) =>
					this.onSidebarAction({ command: command, context: context, args: args }),
				onSidebarInvalidated: this._sidebarInvalidatedEvent.subscribe(buffer, tracker),
				onWorktreeStateChanged: this._sidebarWorktreeEvent.subscribe(buffer, tracker),
			},
			launchpad: new LaunchpadService(this.container, buffer, tracker),
			graphTimeline: graphTimeline,
			graphTreemap: graphTreemap,
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
		const columns = this.getColumns();
		if (columns != null) {
			for (const [name, config] of Object.entries(columns)) {
				if (!config.isHidden) {
					columnContext[`context.column.${name}.visible`] = true;
				}
				if (config.mode != null) {
					columnContext[`context.column.${name}.mode`] = config.mode;
				}
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
	private _pendingAction: { action: GraphShowAction; target?: GraphActionTarget } | undefined;

	async onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<GraphWebviewShowingArgs, State>
	): Promise<[boolean, GraphShownTelemetryContext]> {
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
			this.repository = this.container.git.getRepository(arg.ref.repoPath);

			let id = arg.ref.ref;
			let isWipRow = false;
			if (isUncommitted(id)) {
				// The uncommitted revision isn't a real commit — it maps to a synthetic WIP row. Select
				// the row for the matching worktree: the shown repo's own working tree is the primary
				// 'work-dir-changes' row; any other worktree path uses its per-path secondary WIP sha
				// (the graph surfaces one WIP row per worktree). See createSecondaryWipSha.
				id =
					arg.ref.repoPath === this.repository?.path
						? 'work-dir-changes'
						: createSecondaryWipSha(arg.ref.repoPath);
				isWipRow = true;
			} else if (!isSha(id)) {
				id = (await this.container.git.getRepositoryService(arg.ref.repoPath).revision.resolveRevision(id)).sha;
			}

			this.setSelectedRows(id);

			if (this._data.session != null) {
				// Synthetic WIP rows can't be paged in via `onGetMoreRows`; selecting + notifying is enough.
				if (isWipRow || this._data.session.current.ids.has(id)) {
					void this.notifyDidChangeSelection();
					return [true, this.getShownTelemetryContext()];
				}

				this.revealRow(id);
			}
		} else if (hasRepository(arg)) {
			const repoChanged = this._repository !== arg.repository;
			this.repository = arg.repository;
			// Repository-only args (e.g. the SCM "Show Commit Graph" button or a repo-folder node)
			// just switch repos; only run the search-specific work when a search is also present.
			if (hasSearchQuery(arg)) {
				if (arg.selectSha) {
					this.setSelectedRows(arg.selectSha);

					if (this._data.session != null) {
						if (this._data.session.current.ids.has(arg.selectSha)) {
							void this.notifyDidChangeSelection();
						} else {
							this.revealRow(arg.selectSha);
						}
					}
				}
				// Three cases routed through the state-bootstrap path (`_searchRequest` → `getState`):
				//   1. Cold show (`loading`): webview isn't ready, a standalone notification would
				//      queue in `_pendingIpcNotifications` and get wiped by the bootstrap
				//      `clearPendingIpcNotifications()`.
				//   2. Repo swap (`repoChanged`): the repository setter triggers a full `updateState`
				//      refetch anyway; pipe the search through it so it lands with the new repo's rows
				//      instead of racing against the just-cleared graph session.
				//   3. Force-refresh in flight (`!host.ready`): same wipe risk as #1 — the reconnect
				//      handler clears pending notifications before flushing them.
				// Otherwise (warm + same-repo + ready) use the lightweight notification — bypasses
				// the ~750ms `updateState` → `getState` pipeline since the only delta is the search.
				// Mirrors the `DidRequestOpenCompareMode` / `DidRequestOpenTimelineScope` pattern.
				if (loading || repoChanged || !this.host.ready) {
					this._searchRequest = arg.search;
				} else {
					this.notifyRequestSearch({ search: arg.search, selectSha: arg.selectSha });
				}
			}
		} else if (hasSidebarPanel(arg)) {
			if (loading) {
				this._pendingSidebarPanel = arg.sidebarPanel;
			} else {
				void this.host.notify(DidRequestActiveSidebarPanelNotification, { panel: arg.sidebarPanel });
			}
		} else if (hasAction(arg)) {
			const { target } = arg;
			// Switch to the target's repository so a cold show lands on the right repo (and the
			// primary-vs-secondary WIP comparison below resolves correctly). Mirrors the ref path.
			if (target != null) {
				this.repository =
					(await this.container.git.getOrAddRepository(Uri.file(target.worktreePath), {
						opened: false,
						detectNested: true,
					})) ?? this.repository;
			}
			let rowId: string | undefined;
			if (arg.action !== 'scope-to-branch') {
				// Select the row the action targets: an uncommitted target maps to its worktree's WIP
				// row (primary 'work-dir-changes' or a secondary worktree's synthetic sha), a real
				// target selects its commit sha, and no target falls back to the primary WIP row.
				rowId = 'work-dir-changes';
				if (target != null) {
					rowId = isUncommitted(target.sha)
						? target.worktreePath === this.repository?.path
							? 'work-dir-changes'
							: createSecondaryWipSha(target.worktreePath)
						: target.sha;
				}
				this.setSelectedRows(rowId);
			}
			if (loading) {
				this._pendingAction = { action: arg.action, target: arg.target };
			} else {
				// Select the targeted row in the graph too (mirrors the ref path). The action
				// notification only enters the mode / reveals the details panel; without this the
				// graph row is never actually selected on a warm show. WIP rows + already-loaded
				// commits select via the lightweight selection notification; an unloaded commit pages
				// in (which carries the selection along).
				if (rowId != null && this._data.session != null) {
					if (
						rowId === 'work-dir-changes' ||
						isSecondaryWipSha(rowId) ||
						this._data.session.current.ids.has(rowId)
					) {
						void this.notifyDidChangeSelection();
					} else {
						this.revealRow(rowId);
					}
				}
				void this.host.notify(DidRequestGraphActionNotification, {
					action: arg.action,
					target: arg.target,
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

	onRefresh(force?: boolean): void {
		if (force) {
			this.resetRepositoryState();
		}
	}

	async includeBootstrap(_deferrable?: boolean): Promise<State> {
		// Mark a state op as in-flight for the duration of the bootstrap so any `notifyDidChangeState`
		// triggered by repo-change events during the bootstrap window waits on this op, then finds the
		// state already fresh and skips the redundant getState/getGraph pipeline.
		const op = this._data.trackBootstrapStateOp(this.getState(true));
		// Capture the branchState that ships with bootstrap so a delayed PR resolve merges into it.
		void op.then(state => this._producers.setLastSentBranchState(state.branchState)).catch(() => undefined);
		return op;
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.is('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
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
						if (commit == null) return;

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
						if (resolved.length) {
							await handler.call(fileCommands, resolved);
						}
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
				// (`updateState` no longer wipes the pending queue, but this fresher WIP still supersedes any
				// stale queued push on success.)
				if (repositoryChanged) {
					void this._wip.notifyDidChangeWorkingTree();
				}
			}
		} else if (visible) {
			this.host.sendPendingIpcNotifications();
		}

		// Flush any rows-plane state the publisher accumulated while hidden/not-ready (and recover a
		// previously-broken send with a snapshot). Nothing is buffered, so nothing was lost.
		if (visible) {
			void this._graphSync.flush();
		}

		void this.ensureAutoFetch();
		if (visible) {
			this._wip.recoverWorkingTreeStatsIfStuck();
			this._wip.recoverDeferredSecondaryWip();
		}
	}

	@ipcRequest(GetCountsRequest)
	private onGetCounts() {
		return this._data.onGetCounts();
	}

	@ipcRequest(GetOverviewRequest)
	private onGetOverview(params: IpcParams<typeof GetOverviewRequest>): GraphOverviewData {
		return this._panels.onGetOverview(params);
	}

	@ipcRequest(GetOverviewWipRequest)
	private onGetOverviewWip(params: IpcParams<typeof GetOverviewWipRequest>): Promise<GetOverviewWipResponse> {
		return this._panels.onGetOverviewWip(params);
	}

	@ipcRequest(GetOverviewWipDetailedRequest)
	private onGetOverviewWipDetailed(
		params: IpcParams<typeof GetOverviewWipDetailedRequest>,
	): Promise<GetOverviewWipResponse> {
		return this._panels.onGetOverviewWipDetailed(params);
	}

	@ipcRequest(GetOverviewEnrichmentRequest)
	private onGetOverviewEnrichment(
		params: IpcParams<typeof GetOverviewEnrichmentRequest>,
	): Promise<GetOverviewEnrichmentResponse> {
		return this._panels.onGetOverviewEnrichment(params);
	}

	@ipcRequest(GetAgentSessionsRequest)
	private onGetAgentSessions(): AgentSessionState[] {
		return this._panels.onGetAgentSessions();
	}

	private onAgentSessionsChanged(sessions: AgentSessionState[]): void {
		void this.host.notify(DidChangeAgentSessionsNotification, { sessions: sessions });

		// Agent membership drives the `agents` branches-visibility ref set, so any change to
		// the live session list needs to recompute the included refs and push a fresh
		// visibility notification to the webview.
		const repoPath = this.repository?.path ?? this._data.session?.repoPath;
		if (this.getBranchesVisibility(this.getFiltersByRepo(repoPath)) === 'agents') {
			void this.notifyDidChangeRefsVisibility();
		}
	}

	@ipcRequest(GetWipStatsRequest)
	private async onGetWipStats(params: IpcParams<typeof GetWipStatsRequest>): Promise<GetWipStatsResponse> {
		const response: GetWipStatsResponse = {};
		if (params.shas.length === 0) return response;

		try {
			// When the user has disabled per-worktree WIP stats, short-circuit the library-triggered
			// missing-stats calls. The GK component's `requestedMissingWipStats` dedup marks each sha
			// as "asked" on first request and never re-asks, so leaving `workDirStats` undefined keeps
			// the stats pill hidden. Selection-driven fetches pass `force: true` to bypass the gate.
			if (!params.force && !configuration.get('graph.showWorktreeWipStats')) {
				return response;
			}

			const cancellation = this.createCancellation('wipStats');
			const signal = toAbortSignal(cancellation.token);

			await Promise.allSettled(
				params.shas.map(async sha => {
					if (!isSecondaryWipSha(sha)) return;

					const path = getSecondaryWipPath(sha);
					const svc = this.container.git.getRepositoryService(path);

					// Fetch the paused-op status in parallel with the cached status read so the
					// secondary WIP row can render the same in-progress indicator (rebase/merge/
					// cherry-pick) the primary's action bar does. `pausedOps` is optional on the
					// service surface; older providers may not implement it.
					const [statusResult, pausedOpResult] = await Promise.allSettled([
						this._wip.getStatusFromCache(path, signal),
						// `force` so a missed `'pausedOp'` FS-watcher tick on this secondary worktree
						// can't leave the WIP row stuck on a stale in-progress indicator.
						svc.pausedOps?.getPausedOperationStatus?.({ force: true }, signal),
					]);
					if (cancellation.token.isCancellationRequested) return;

					const status = getSettledValue(statusResult);
					const diff = status?.diffStatus;
					const pausedOpStatus = getSettledValue(pausedOpResult);
					response[sha] = {
						workDirStats: {
							added: diff?.added ?? 0,
							deleted: diff?.deleted ?? 0,
							modified: diff?.changed ?? 0,
						},
						pausedOpStatus: pausedOpStatus,
						hasConflicts: status?.hasConflicts,
					};
				}),
			);

			return response;
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetWipStats');
			// Record-shaped response — partial successes are preserved; missing keys read as undefined frontend-side.
			return response;
		}
	}

	@ipcRequest(GetWipLineStatsRequest)
	private async onGetWipLineStats(
		params: IpcParams<typeof GetWipLineStatsRequest>,
	): Promise<GetWipLineStatsResponse | undefined> {
		// Per-file line stats aren't carried by the every-tick `wip` push (`git status` can't emit
		// them); the webview requests them lazily only while the WIP file list is visible, so one
		// `git diff HEAD --numstat` (incl. untracked) here is the sole extra cost.
		// TODO(revisit): because the webview only re-requests on a `wip` change and pushes are deduped
		// by status content, pure line edits (same status) don't refresh these until a status change /
		// re-select / refresh — see `updateWipFileStats`. Per-save freshness would need host-driven
		// pushes on each working-tree tick while the panel is open.
		try {
			const svc = this.container.git.getRepositoryService(params.repoPath);
			const files = await svc.diff.getDiffStatus('HEAD', undefined, { includeUntracked: true });
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
			Logger.error(ex, 'GraphWebviewProvider', 'onGetWipLineStats');
			return undefined;
		}
	}

	private onGetSidebarData(
		params: { panel: GraphSidebarPanel },
		signal?: AbortSignal,
	): Promise<DidGetSidebarDataParams> {
		return this._panels.onGetSidebarData(params, signal);
	}

	private onSidebarToggleLayout(params: { panel: GraphSidebarPanel }): void {
		this._panels.onSidebarToggleLayout(params);
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
		}
	}

	@ipcCommand(UpdateGraphConfigurationCommand)
	private onUpdateGraphConfig(params: IpcParams<typeof UpdateGraphConfigurationCommand>) {
		const config = this.getComponentConfig();

		let key: keyof IpcParams<typeof UpdateGraphConfigurationCommand>['changes'];
		for (key in params.changes) {
			if (config[key] !== params.changes[key]) {
				switch (key) {
					case 'autoFetchEnabled':
						void configuration.updateEffective('graph.autoFetch.enabled', params.changes[key]);
						break;
					case 'minimap':
						void configuration.updateEffective('graph.minimap.enabled', params.changes[key]);
						break;
					case 'minimapDataType':
						void configuration.updateEffective('graph.minimap.dataType', params.changes[key]);
						break;
					case 'minimapReversed':
						void configuration.updateEffective('graph.minimap.reversed', params.changes[key]);
						break;
					case 'minimapMarkerTypes': {
						const additionalTypes: GraphMinimapMarkersAdditionalTypes[] = [];

						const markers = params.changes[key] ?? [];
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
						void configuration.updateEffective('graph.minimap.additionalTypes', additionalTypes);
						break;
					}
					case 'dimMergeCommits':
						void configuration.updateEffective('graph.dimMergeCommits', params.changes[key]);
						break;
					case 'onlyFollowFirstParent':
						void configuration.updateEffective('graph.onlyFollowFirstParent', params.changes[key]);
						break;
					case 'detailsLocation':
						void configuration.updateEffective('graph.details.location', params.changes[key]);
						break;
					case 'sidebarPinned':
						void configuration.updateEffective('graph.sidebar.pinned', params.changes[key]);
						break;
					case 'style':
						void configuration.updateEffective('graph.style', params.changes[key]);
						break;
					case 'activityDecay':
						void configuration.updateEffective(
							'graph.experimental.visualizations.activityDecay',
							params.changes[key],
						);
						break;
					default:
						// TODO:@eamodio add more config options as needed
						debugger;
						break;
				}
			}
		}
	}

	@ipcCommand(UpdateGraphSearchModeCommand)
	private onUpdateGraphSearchMode(params: IpcParams<typeof UpdateGraphSearchModeCommand>): void {
		this._searchService.onUpdateGraphSearchMode(params);
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

		// `computeScopeAnchor` branches on this setting, but `_scopeAnchorCache` is keyed per-branch
		// only — toggling it without invalidating would keep serving anchors computed under the old engine.
		if (configuration.changed(e, 'graph.experimental.useNewEngine')) {
			this.invalidateScopeAnchors();
		}

		if (configuration.changed(e, 'graph.showWorkingTreeBadge')) {
			this._wip.resetBadgeCount();
			if (configuration.get('graph.showWorkingTreeBadge')) {
				void this._wip.notifyDidChangeWorkingTree();
			} else {
				this._wip.clearWorkingTreeBadge();
			}
		}

		// `graph.lanes.density` drives BOTH the lane spacing (via the config re-send in the `graph`
		// catch-all below) AND the column-menu context (`lanes:density:*`, which the Expanded/Compact
		// menu items toggle on). Refresh the column context too — otherwise the menu item is one-way: the
		// spacing changes but the item's `when` clause never flips to offer the opposite.
		if (configuration.changed(e, 'graph.lanes.density')) {
			void this.notifyDidChangeColumns();
		}

		// `graph.showUpstreamStatus` feeds `resetRefsMetadata`'s feature-on/off decision (upstream is
		// local-git data, so it keeps metadata populatable even with no integration). The catch-all `graph`
		// block below only re-sends the component config — re-evaluate the gate here too, but only when the
		// feature is currently off/unpopulated (`null`/`undefined`) so connected repos with populated
		// metadata don't needlessly re-fetch and flicker on the toggle.
		if (configuration.changed(e, 'graph.showUpstreamStatus') && this._producers.refsMetadata == null) {
			this._producers.resetRefsMetadata();
			// REPLACE the webview's refsMetadata map (the reset-anchor) over the sequenced channel — a
			// same-enabled wipe/enable the spread-merge delta can't express. Keep `updateState(true)` too:
			// the State push carries the map as reset-anchor. Reuses the loaded graph (etag unchanged), no re-walk.
			this._graphSync.markRefsMetadataReset();
			void this._graphSync.flush();
			this._data.updateState(true);
		}

		if (configuration.changed(e, 'graph.commitOrdering')) {
			this._data.updateState();

			return;
		}

		if (
			configuration.changed(e, 'views.branches.branches') ||
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
			configuration.changed(e, 'graph')
		) {
			void this.notifyDidChangeConfiguration();

			if (
				configuration.changed(e, 'defaultCurrentUserNameStyle') ||
				configuration.changed(e, 'graph.onlyFollowFirstParent') ||
				((configuration.changed(e, 'graph.minimap.enabled') ||
					configuration.changed(e, 'graph.minimap.dataType')) &&
					configuration.get('graph.minimap.enabled') &&
					configuration.get('graph.minimap.dataType') === 'lines' &&
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

		void this.notifyDidChangeConfiguration();
		void this.ensureAutoFetch();
	}

	@trace({ args: false })
	private onContextChanged(key: keyof ContextKeys) {
		if (['gitlens:gk:organization:ai:enabled', 'gitlens:gk:organization:drafts:enabled'].includes(key)) {
			this.notifyDidChangeOrgSettings();
		}
		if (key === 'gitlens:agents:enabled') {
			void this.notifyDidChangeCanInstallClaudeHook();
		}
	}

	@trace({ args: false })
	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.type !== 'workspace') return;

		if (e.keys.includes('graph:state')) {
			// If the minimap just became visible and we skipped stats on the last fetch, refetch now
			if (
				this.isMinimapVisible() &&
				configuration.get('graph.minimap.enabled') &&
				configuration.get('graph.minimap.dataType') === 'lines' &&
				!this._data.session?.current.includes?.stats
			) {
				this._data.updateState();
			}
		}

		if (e.keys.includes('graph:wipDrafts') && this.repository != null) {
			// Push the latest scoped draft map to this webview so a concurrent provider's write
			// (other graph instance, host-initiated undo from a different webview) lands here
			// without waiting for the next full state push.
			void this._wip.notifyDidChangeWipDrafts();
		}
	}

	private isMinimapVisible(): boolean {
		return this.container.storage.getWorkspace('graph:state')?.panels?.minimap?.visible ?? true;
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			ai: getContext('gitlens:gk:organization:ai:enabled', true),
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
		};
	}

	private isAccountAccessRequired(subscription: Subscription): boolean {
		return subscription.account == null || subscription.account.verified === false;
	}

	@trace({ args: false })
	private onFeaturePreviewChanged(e: FeaturePreviewChangeEvent) {
		if (e.feature !== 'graph') return;

		void this.notifyDidStartFeaturePreview(e);
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

		// Lightweight WIP refresh — covers staging/unstaging (`index` → stats), `.gitignore` edits
		// (`ignores` → which untracked files appear in `git status`), secondary-worktree add/remove
		// (`worktrees` → wipMetadataBySha; also falls through to the structural gate below as a
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
		if (e.changed('heads', 'remotes', 'stash', 'tags')) {
			this._sidebarEventCounter.next();
		}

		// Fast-path: refresh branchState immediately so push/pull/fetch ahead/behind land in the
		// header without waiting for the full graph rebuild. The full state pipeline re-sends
		// branchState; the webview dedups equal values (see `DidChangeNotification` in
		// stateProvider.ts), so the worst case is a redundant IPC discarded on receipt.
		if (e.changed('head', 'heads', 'remotes')) {
			void this._producers.notifyDidChangeBranchStateOnly();
		}

		// Unless we don't know what changed, update the state immediately
		this._data.updateState(!e.changedExclusive('unknown'));
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
		this._accountAccessRequired = this.isAccountAccessRequired(e.current);

		void this.notifyDidChangeSubscription();

		// While the access screen is shown, `getState` short-circuits the data pipeline; when the
		// account becomes usable, `notifyDidChangeSubscription` alone won't reload it, so force a full
		// state refresh to populate the graph.
		if (wasAccountAccessRequired && !this._accountAccessRequired && this.host.ready) {
			this._data.updateState(true);
		}
	}

	private onOnboardingChanged(e: OnboardingChangeEvent) {
		if (e.key === 'mcp:banner') {
			this.onMcpBannerChanged();
			// Dismissing the MCP banner can newly enable the hooks banner — refresh both.
			this.onHooksBannerChanged();
		} else if (e.key === 'hooks:banner') {
			this.onHooksBannerChanged();
		} else if (e.key === 'graph-walkthrough:banner') {
			this.onGraphWalkthroughBannerChanged();
		} else if (e.key === 'graph:visualizations:buttonCallout') {
			this.onVisualizationsButtonCalloutChanged();
		}
	}

	private onMcpBannerChanged() {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeMcpBanner, this.getMcpBannerCollapsed());
	}

	private onHooksBannerChanged() {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeHooksBanner, this.getHooksBannerCollapsed());
	}

	private getMcpBannerCollapsed() {
		return !isMcpBannerEnabled(this.container);
	}

	private getHooksBannerCollapsed() {
		return !isHooksBannerEnabled(this.container);
	}

	@ipcCommand(CloseGraphWalkthroughBannerCommand)
	private onCloseGraphWalkthroughBanner(params: CloseGraphWalkthroughBannerParams) {
		if (params.openWelcome) {
			void this.container.usage.track('action:gitlens.graph.walkthrough.started:happened');
			void commands.executeCommand('gitlens.showWelcomeView', { mode: 'graph' });
		} else {
			void this.container.onboarding.dismiss('graph-walkthrough:banner');
		}
	}

	@ipcCommand(TrackGraphOverviewShownCommand)
	private onTrackGraphOverviewShown() {
		void this.container.usage.track('action:gitlens.graph.overview.shown:happened');
	}

	@ipcCommand(TrackGraphScopeChangedCommand)
	private onTrackGraphScopeChanged() {
		void this.container.usage.track('action:gitlens.graph.scope.changed:happened');
	}

	@ipcCommand(TrackGraphDetailsReviewModeCommand)
	private onTrackGraphDetailsReviewMode() {
		void this.container.usage.track('action:gitlens.graph.details.reviewMode:happened');
	}

	@ipcCommand(TrackGraphDetailsComposeModeCommand)
	private onTrackGraphDetailsComposeMode() {
		void this.container.usage.track('action:gitlens.graph.details.composeMode:happened');
	}

	@ipcCommand(TrackGraphDetailsResolveModeCommand)
	private onTrackGraphDetailsResolveMode() {
		void this.container.usage.track('action:gitlens.graph.details.resolveMode:happened');
	}

	@ipcCommand(TrackGraphDetailsCompareModeCommand)
	private onTrackGraphDetailsCompareMode() {
		void this.container.usage.track('action:gitlens.graph.details.compareMode:happened');
	}

	@ipcCommand(TrackGraphDetailsWipShownCommand)
	private onTrackGraphDetailsWipShown() {
		void this.container.usage.track('action:gitlens.graph.details.wipShown:happened');
	}

	private onGraphWalkthroughBannerChanged() {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeGraphWalkthroughBanner, this.getGraphWalkthroughBannerState());
	}

	private onVisualizationsButtonCalloutChanged() {
		if (!this.host.visible) return;

		void this.host.notify(
			DidChangeVisualizationsButtonCallout,
			this.container.onboarding.isDismissed('graph:visualizations:buttonCallout'),
		);
	}

	@ipcCommand(DismissVisualizationsButtonCalloutCommand)
	private onDismissVisualizationsButtonCallout() {
		void this.container.onboarding.dismiss('graph:visualizations:buttonCallout').catch();
	}

	private onGraphWalkthroughProgressChanged() {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeGraphWalkthroughComplete, this.getGraphWalkthroughComplete());
	}

	private onUsageChanged(e: UsageChangeEvent | undefined) {
		if (e?.key === 'action:gitlens.graph.walkthrough.started:happened') {
			this.onGraphWalkthroughStartedChanged();
		}
	}

	private onGraphWalkthroughStartedChanged() {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeGraphWalkthroughStarted, this.getGraphWalkthroughStarted());
	}

	private getGraphWalkthroughBannerState(): GraphWalkthroughBannerState {
		return {
			dismissed: this.container.onboarding.isDismissed('graph-walkthrough:banner'),
		};
	}

	private getGraphWalkthroughComplete() {
		return this.container.walkthrough.graphDoneCount >= this.container.walkthrough.graphWalkthroughSize;
	}

	private getGraphWalkthroughStarted() {
		return this.container.usage.isUsed('action:gitlens.graph.walkthrough.started:happened');
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

	@ipcCommand(UpdateColumnsCommand)
	private onColumnsChanged(params: IpcParams<typeof UpdateColumnsCommand>) {
		this.updateColumns(params.config);

		const eventData: WebviewTelemetryEvents['graph/columns/changed'] = {};
		for (const [name, config] of Object.entries(params.config)) {
			for (const [prop, value] of Object.entries(config)) {
				eventData[`column.${name}.${prop as keyof GraphColumnConfig}`] = value;
			}
		}
		this.host.sendTelemetryEvent('graph/columns/changed', eventData);
	}

	@ipcCommand(UpdateGraphDisplayModeCommand)
	private onDisplayModeChanged(params: IpcParams<typeof UpdateGraphDisplayModeCommand>) {
		if (this._displayMode === params.mode) return;

		this._displayMode = params.mode;

		// Visualizations (Visual History) needs row stats — refetch if the current graph was loaded without them.
		if (params.mode === 'visualizations' && !this._data.session?.current.includes?.stats) {
			// Flip the loading flag eagerly so the timeline shows its overlay during the refetch (the
			// stats-including rebuild hasn't landed, so `rowsStatsDeferred` can't report loading yet). Cleared
			// in `setGraph` when the stats graph lands; shipped over the rowsStats channel (no dual writer).
			this._data.rowsStatsLoadingOverride = true;
			this._graphSync.mark('rowsStats');
			void this._graphSync.flush();
			this._data.updateState();
		} else if (params.mode !== 'visualizations' && this._data.rowsStatsLoadingOverride) {
			// Left Visualizations before the stats rebuild landed — clear the eager override (else the
			// stats-loading spinner sticks forever) and ship the cleared flag over the rowsStats channel.
			this._data.rowsStatsLoadingOverride = false;
			this._graphSync.mark('rowsStats');
			void this._graphSync.flush();
		}
	}

	@ipcCommand(UpdateRefsVisibilityCommand)
	private onRefsVisibilityChanged(params: IpcParams<typeof UpdateRefsVisibilityCommand>) {
		this.updateExcludedRefs(this._data.session?.repoPath, params.refs, params.visible);
	}

	@ipcCommand(UpdatePinnedRefCommand)
	private onPinnedRefChanged(params: IpcParams<typeof UpdatePinnedRefCommand>) {
		this.updatePinnedRef(this._data.session?.repoPath, params.ref);
	}

	@ipcCommand(DoubleClickedCommand)
	private onDoubleClick(params: IpcParams<typeof DoubleClickedCommand>) {
		if (params.type === 'ref' && params.ref.context) {
			let item = this.getGraphItemContext(params.ref.context);
			if (isGraphItemRefContext(item)) {
				if (params.metadata != null) {
					item = this.getGraphItemContext(params.metadata.data.context);
					if (params.metadata.type === 'upstream' && isGraphItemTypedContext(item, 'upstreamStatus')) {
						const { ahead, behind, ref } = item.webviewItemValue;
						if (behind > 0) {
							return void RepoActions.pull(ref.repoPath, ref);
						}
						if (ahead > 0) {
							return void RepoActions.push(ref.repoPath, false, ref);
						}
					} else if (params.metadata.type === 'pullRequest' && isGraphItemTypedContext(item, 'pullrequest')) {
						return void this._commands.openPullRequestOnRemote(item);
					} else if (params.metadata.type === 'issue' && isGraphItemTypedContext(item, 'issue')) {
						return void this.openIssueOnRemote(item);
					}

					return;
				}

				const { ref } = item.webviewItemValue;
				if (params.ref.refType === 'head' && params.ref.isCurrentHead) {
					return RepoActions.switchTo(ref.repoPath);
				}

				// Override the default confirmation if the setting is unset
				return RepoActions.switchTo(
					ref.repoPath,
					ref,
					configuration.isUnset('gitCommands.skipConfirmations') ? true : undefined,
				);
			}
		}

		return Promise.resolve();
	}

	// Not a registered command — invoked only by `onDoubleClick` for issue ref-metadata badges.
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

	@ipcRequest(GetRowHoverRequest)
	private async onHoverRowRequest(params: IpcParams<typeof GetRowHoverRequest>) {
		const hover: IpcResponse<typeof GetRowHoverRequest> = {
			id: params.id,
			markdown: undefined!,
		};

		this.cancelOperation('hover');

		try {
			if (this._data.session != null) {
				const id = params.id;

				let markdown = this._hoverCache.get(id);
				if (markdown == null) {
					const cancellation = this.createCancellation('hover');

					let cache = true;
					let commit;
					let secondaryWorktree;
					try {
						const isSecondaryWip = params.type === 'work-dir-changes' && isSecondaryWipSha(id);
						const hoverRepoPath = isSecondaryWip ? getSecondaryWipPath(id) : this._data.session.repoPath;
						const svc = this.container.git.getRepositoryService(hoverRepoPath);
						switch (params.type) {
							case 'work-dir-changes':
								cache = false;
								[commit, secondaryWorktree] = await Promise.all([
									svc.commits.getCommit(uncommitted, toAbortSignal(cancellation.token)),
									isSecondaryWip
										? svc.worktrees?.getWorktree(
												wt => wt.path === hoverRepoPath,
												toAbortSignal(cancellation.token),
											)
										: undefined,
								]);
								break;
							case 'stash-node': {
								const stash = await svc.stash?.getStash(undefined, toAbortSignal(cancellation.token));
								commit = stash?.stashes.get(params.id);
								break;
							}
							default: {
								commit = await svc.commits.getCommit(params.id, toAbortSignal(cancellation.token));
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

						markdown = this.getCommitTooltip(commit, cancellation.token, secondaryWorktree).catch(
							(ex: unknown) => {
								this._hoverCache.delete(id);
								throw ex;
							},
						);
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
			Logger.error(ex, 'GraphWebviewProvider', 'onHoverRowRequest');
			// Return a structurally-valid response so the webview's `getResponsePromise` resolves
			// in milliseconds (not the 5-min timeout) and the hover render can show a fallback.
			return {
				id: params.id,
				markdown: { status: 'rejected' as const, reason: ex },
				error: ex instanceof Error ? ex.message : String(ex),
			};
		}
	}

	private async getCommitTooltip(
		commit: GitCommit,
		cancellation: CancellationToken,
		worktree?: GitWorktree | undefined,
	) {
		if (commit.isUncommitted) {
			return this._wip.getWipTooltip(commit, cancellation, worktree);
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

	@ipcRequest(EnsureRowRequest)
	@trace()
	private onEnsureRowRequest(
		params: IpcParams<typeof EnsureRowRequest>,
	): Promise<{ id: string | undefined; error?: string }> {
		return this._data.onEnsureRowRequest(params);
	}

	@ipcCommand(GetMissingAvatarsCommand)
	private async onGetMissingAvatars(params: IpcParams<typeof GetMissingAvatarsCommand>) {
		if (this._data.session == null) return;

		const repoPath = this._data.session.repoPath;

		async function getAvatar(this: GraphWebviewProvider, email: string, id: string) {
			const uri = await getAvatarUri(email, { ref: id, repoPath: repoPath });
			this._data.session!.current.avatars.set(email, uri.toString(true));
		}

		const promises: Promise<void>[] = [];

		for (const [email, id] of Object.entries(params.emails)) {
			if (this._data.session.current.avatars.has(email)) continue;

			promises.push(getAvatar.call(this, email, id));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
			this._data.updateAvatars();
		}
	}

	private readonly _avatarProxyCache = new DedupedAsyncCache<string, Uri | undefined>();
	private readonly _avatarProxyFailed = new Set<string>();

	@ipcCommand(ProxyAvatarsCommand)
	private async onProxyAvatars(params: IpcParams<typeof ProxyAvatarsCommand>) {
		if (this._data.session == null) return;

		const entries = Object.entries(params.avatars);
		if (entries.length === 0) return;

		let changed = false;
		await Promise.allSettled(
			entries.map(([email, url]) => {
				if (url.startsWith('data:') || this._avatarProxyFailed.has(url)) return Promise.resolve();

				return this._avatarProxyCache
					.getOrResolve(url, () => fetchAvatarImageAsDataUri(url))
					.then(uri => {
						if (uri != null) {
							if (this._data.session?.current.avatars.get(email) !== url) return;

							this._data.session.current.avatars.set(email, uri.toString(true));
							changed = true;
						} else {
							this._avatarProxyFailed.add(url);
						}
					});
			}),
		);

		if (changed) {
			// Proxy replaces values for existing keys (same email, new data URI), so the map size doesn't
			// change. Force the publisher's next avatars emission to ship the full map anyway.
			this._graphSync.invalidateAvatars();
			this._data.updateAvatars();
		}
	}

	@ipcCommand(GetMissingRefsMetadataCommand)
	private onGetMissingRefMetadata(params: IpcParams<typeof GetMissingRefsMetadataCommand>): Promise<void> {
		return this._producers.onGetMissingRefMetadata(params);
	}

	@ipcCommand(SyncWipWatchesCommand)
	@debug()
	private onSyncWipWatches(params: IpcParams<typeof SyncWipWatchesCommand>): Promise<void> {
		return this._wip.syncWipWatches(params);
	}

	@ipcCommand(GetMoreRowsCommand)
	@trace()
	private onGetMoreRows(
		params: IpcParams<typeof GetMoreRowsCommand>,
		sendSelectedRows: boolean = false,
	): Promise<void> {
		return this._data.onGetMoreRows(params, sendSelectedRows);
	}

	@ipcCommand(GraphSyncResyncCommand)
	@debug()
	private onSyncResync(params: IpcParams<typeof GraphSyncResyncCommand>): void {
		this._data.onSyncResync(params);
	}

	/** Pages rows in until a host-initiated reveal/select target `id` is loaded, then ships the selection.
	 *  Uses `limit: 0` for an UNCAPPED targeted walk: the default page size caps the walk at
	 *  `pageItemLimit*10` (~2000) and would never reach a commit deeper than that (e.g. "Open in Commit
	 *  Graph" on an old commit). The IPC scroll/scope-anchor paging keeps the cap — see `onGetMoreRows`. */
	private revealRow(id: string): void {
		void this.onGetMoreRows({ id: id, limit: 0 }, true);
	}

	@ipcCommand(OpenPullRequestDetailsCommand)
	@debug()
	private async onOpenPullRequestDetails(params: IpcParams<typeof OpenPullRequestDetailsCommand>) {
		const repo = this.repository;
		if (repo == null) return undefined;

		// id+providerId path: resolve the PR by id via the matching integration so the chip's
		// actual PR opens — regardless of which branch is currently checked out.
		if (params.id && params.providerId) {
			const remote = await getBestRemoteWithIntegration(repo.path, {
				filter: r => r.provider.id === params.providerId,
			});
			if (remote != null) {
				const integration = await getRemoteIntegration(remote);
				const pr = await integration?.getPullRequest(remote.provider.repoDesc, params.id);
				if (pr != null) {
					return this.container.views.pullRequest.showPullRequest(pr, repo.path);
				}
			}
		}

		// Fallback: resolve via the repo's current branch (legacy callers without id/provider).
		const branch = await repo.git.branches.getBranch();
		if (branch == null) return undefined;

		const pr = await getBranchAssociatedPullRequest(this.container, branch);
		if (pr == null) return undefined;

		return this.container.views.pullRequest.showPullRequest(pr, branch);
	}

	@ipcCommand(RowActionCommand)
	@debug()
	private async onRowAction(params: IpcParams<typeof RowActionCommand>) {
		const primaryRepoPath = this._data.session?.repoPath;
		if (primaryRepoPath == null) return;

		const rowRepoPath =
			params.row.type === 'work-dir-changes' && isSecondaryWipSha(params.row.id)
				? getSecondaryWipPath(params.row.id)
				: primaryRepoPath;

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
		}
	}

	@ipcCommand(TreemapFileActionCommand)
	@debug()
	private async onTreemapFileAction(params: IpcParams<typeof TreemapFileActionCommand>): Promise<void> {
		// Rehydrate the file URI through the repo's own URI so the original scheme survives —
		// `Uri.file()` would coerce virtual-workspace paths (vscode-vfs://, GitHub virtual provider)
		// to a non-resolving file:// URI.
		const repo = this.container.git.getRepository(params.repoPath);
		if (repo == null) return;

		const uri = Uri.joinPath(repo.uri, params.path);
		switch (params.action) {
			case 'open':
				await commands.executeCommand('vscode.open', uri);
				return;
			case 'history':
				await commands.executeCommand('gitlens.openFileHistory', uri);
		}
	}

	@ipcRequest(SearchHistoryGetRequest)
	@trace()
	private onSearchHistoryGetRequest(): IpcResponse<typeof SearchHistoryGetRequest> {
		return this._searchService.onSearchHistoryGetRequest();
	}

	@ipcRequest(SearchHistoryStoreRequest)
	@trace()
	private onSearchHistoryStoreRequest(
		params: IpcParams<typeof SearchHistoryStoreRequest>,
	): Promise<IpcResponse<typeof SearchHistoryStoreRequest>> {
		return this._searchService.onSearchHistoryStoreRequest(params);
	}

	@ipcRequest(SearchHistoryDeleteRequest)
	@trace()
	private onSearchHistoryDeleteRequest(
		params: IpcParams<typeof SearchHistoryDeleteRequest>,
	): Promise<IpcResponse<typeof SearchHistoryDeleteRequest>> {
		return this._searchService.onSearchHistoryDeleteRequest(params);
	}

	@ipcCommand(SearchCancelCommand)
	@trace()
	private onSearchCancel(params: { preserveResults: boolean }): void {
		this._searchService.onSearchCancel(params);
	}

	@ipcRequest(SearchRequest)
	@trace()
	private onSearchRequest(params: IpcParams<typeof SearchRequest>): Promise<IpcResponse<typeof SearchRequest>> {
		return this._searchService.onSearchRequest(params);
	}

	@ipcCommand(SearchOpenInViewCommand)
	private onSearchOpenInView(params: IpcParams<typeof SearchOpenInViewCommand>): void {
		this._searchService.onSearchOpenInView(params);
	}

	@ipcCommand(ChooseRepositoryCommand)
	private async onChooseRepository() {
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

	@ipcRequest(ChooseRefRequest)
	private async onChooseRef(params: IpcParams<typeof ChooseRefRequest>) {
		if (this.repository == null) return undefined;

		try {
			const result = await showReferencePicker2(this.repository.path, params.title, params.placeholder, {
				allowedAdditionalInput: params.allowedAdditionalInput,
				include: params.include ?? ['branches', 'tags'],
				picked: params.picked,
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
			Logger.error(ex, 'GraphWebviewProvider', 'onChooseRef');
			// The response type is `DidChooseRefParams | undefined`; `undefined` is the existing
			// no-pick semantics so the frontend treats it as "user cancelled" rather than crashing.
			return undefined;
		}
	}

	@ipcRequest(ChooseComparisonRequest)
	private async onChooseComparison(params: IpcParams<typeof ChooseComparisonRequest>) {
		if (this.repository == null) return { range: undefined };

		const result = await showComparisonPicker(this.container, this.repository.path, {
			getTitleAndPlaceholder: step => {
				switch (step) {
					case 1:
						return {
							title: params.title,
							placeholder: 'Choose a branch or tag to show commits from',
						};
					case 2:
						return {
							title: params.title,
							placeholder: 'Choose a base to compare against (e.g., main)',
						};
				}
			},
		});

		return { range: result != null ? `${result.base.ref}..${result.head.ref}` : undefined };
	}

	@ipcRequest(ChooseAuthorRequest)
	private async onChooseAuthor(params: IpcParams<typeof ChooseAuthorRequest>) {
		if (this.repository == null) return { authors: undefined };

		const authors = params.picked != null ? new Set(params.picked) : undefined;
		const contributors = await showContributorsPicker(
			this.container,
			this.repository,
			params.title,
			params.placeholder,
			{
				appendReposToTitle: true,
				clearButton: true,
				multiselect: true,
				picked: c =>
					authors != null &&
					((c.email != null && authors.has(c.email)) ||
						(c.name != null && authors.has(c.name)) ||
						(c.username != null && authors.has(c.username))),
			},
		);

		return { authors: contributors != null ? filterMap(contributors, c => c.email) : undefined };
	}

	@ipcRequest(ChooseFileRequest)
	private async onChooseFile(params: IpcParams<typeof ChooseFileRequest>) {
		if (this.repository == null) return { files: undefined };

		const uris = await window.showOpenDialog({
			canSelectFiles: params.type === 'file',
			canSelectFolders: params.type === 'folder',
			canSelectMany: params.type === 'file',
			title: params.title,
			openLabel: params.openLabel,
			defaultUri: this.repository.folder?.uri,
		});

		if (!uris?.length) return { files: undefined };

		// Convert URIs to relative paths from the repository root
		const files = uris.map(uri => this.container.git.getRelativePath(uri, this.repository!.path));
		return { files: files };
	}

	@ipcRequest(JumpToHeadRequest)
	private async onJumpToHead(): Promise<IpcResponse<typeof JumpToHeadRequest>> {
		if (this.repository == null) return undefined;

		let branch = find(this._data.session!.current.branches.values(), b => b.current);
		branch ??= await this.repository.git.branches.getBranch();

		return branch?.sha != null
			? {
					id: branch.id,
					name: branch.name,
					sha: branch.sha,
					refType: branch.refType as 'branch',
					graphRefType: convertRefToGraphRefType(branch),
				}
			: undefined;
	}

	@ipcRequest(ResolveGraphScopeRequest)
	private async onResolveGraphScope(
		params: IpcParams<typeof ResolveGraphScopeRequest>,
	): Promise<IpcResponse<typeof ResolveGraphScopeRequest>> {
		try {
			const anchor = await this.resolveScopeAnchor(params.repoPath, params.scope.branchName);
			return {
				scope: {
					...params.scope,
					mergeBase: anchor?.mergeBase,
					resolvedMergeTargetTipSha: anchor?.mergeTargetTipSha,
					resolvedFocalBranchTipSha: anchor?.focalBranchTipSha,
				},
			};
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onResolveGraphScope');
			// Return the caller-supplied scope as a fallback so consumers reading `scope.mergeBase`,
			// `scope.resolvedMergeTargetTipSha`, etc. don't crash on undefined property access.
			return { scope: params.scope, error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	private invalidateScopeAnchors(): void {
		this._scopeAnchorCache.clear();

		const repoPath = this.repository?.path ?? this._data.session?.repoPath;
		if (repoPath == null) return;

		void this.host.notify(DidInvalidateScopeAnchorsNotification, { repoPath: repoPath });
	}

	/**
	 * Per-branch cache of resolved scope anchors. Cleared by `invalidateScopeAnchors` whenever
	 * heads/remotes/config move so a stale anchor can't survive a rebase. Holds promises so
	 * concurrent scope-resolves dedupe naturally.
	 *
	 * `focalBranchTipSha` is always set when the focal branch resolves; `mergeBase` /
	 * `mergeTargetTipSha` may be undefined when there's no real merge target (default branch,
	 * or focal branch transiently equal to its target — see `computeScopeAnchor`).
	 */
	private readonly _scopeAnchorCache = new Map<string, Promise<ResolvedScopeAnchor | undefined>>();

	/**
	 * Lightweight scope-anchor resolver: returns just `{focalBranchTipSha, mergeBase?, mergeTargetTipSha?}`
	 * without paying for `getContributors --shortstat` that `getBranchContributionsOverview` runs
	 * for the overview/sidebar contributors panel. The expensive overview path is still used by
	 * enrichment — this just stops scope from triggering it on cold branches that aren't already
	 * covered by the package-level `branchOverviews` cache.
	 */
	private async resolveScopeAnchor(repoPath: string, branchName: string): Promise<ResolvedScopeAnchor | undefined> {
		// Prefer the already-loaded branch from the in-memory graph snapshot — `session.current.branches`
		// is the same data `getBranches()` would return (same underlying cache), so this is a
		// synchronous shortcut on the hot path, not a different source of truth.
		const branch =
			this._data.session?.current.branches.get(branchName) ??
			(await this.container.git.getRepositoryService(repoPath).branches.getBranch(branchName));
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

		// Bail when the resolved target tip is the same commit as the focal branch's tip —
		// there's no real merge to anchor, so the merge-target concept doesn't apply. This
		// happens for the default branch (the fallback chain has no other branch to land on
		// and returns the focal branch itself) and for any feature branch transiently equal
		// to its merge target. If we let it through, two things break: `mergeBase` collapses
		// to the same sha and pins the visible window to a single row, and the GK component's
		// `shouldHideWipRowForScope` treats that sha as a merge-target boundary and hides the
		// WIP row of every worktree on the scoped branch. Returning just the focal tip drops the
		// merge-target overlay and lets the scope walk all ancestors of `branchRef` /
		// `upstreamRef` as if no target was configured.
		if (mergeTargetTipSha == null || mergeTargetTipSha === focalBranchTipSha) {
			return { focalBranchTipSha: focalBranchTipSha };
		}

		const mergeBaseSha = await svc.refs.getMergeBase(branch.ref, targetName);
		if (mergeBaseSha == null) return { focalBranchTipSha: focalBranchTipSha };

		// Target tip is already an ancestor of the focal branch — focal merely descends from target,
		// with no real divergence; the merge-base equals the target tip. Common when scoping to a
		// feature branch that's 1+ commits ahead of its merge target with no merges-back.
		//
		// This bail exists ONLY for the LEGACY GK component: letting it through trips its
		// `shouldHideWipRowForScope` into hiding every worktree's WIP on the scoped branch. The NEW Lit
		// engine doesn't have that bug, and its scope re-root projection REQUIRES the merge-base to fire
		// — without it, the most common scoped-branch case silently degrades to dim-only with no
		// re-root. So keep the merge-base for the new engine (the merge-target fold simply collapses to
		// nothing and the focal spine = the branch's ahead-of-target commits).
		if (mergeBaseSha === mergeTargetTipSha && configuration.get('graph.experimental.useNewEngine') !== true) {
			return { focalBranchTipSha: focalBranchTipSha };
		}

		// Prefer the cheap dates-only lookup on desktop (git-cli); fall back to a full commit fetch
		// for providers that don't implement it (e.g. the GitHub provider used in vscode.dev).
		const dates = await svc.commits.getCommitDates?.(mergeBaseSha);
		const committerDate = dates?.committerDate ?? (await svc.commits.getCommit(mergeBaseSha))?.committer.date;
		if (committerDate == null) return { focalBranchTipSha: focalBranchTipSha };

		return {
			focalBranchTipSha: focalBranchTipSha,
			mergeBase: { sha: mergeBaseSha, date: committerDate.getTime() },
			mergeTargetTipSha: mergeTargetTipSha,
		};
	}

	private _fireSelectionChangedDebounced: Deferrable<GraphWebviewProvider['fireSelectionChanged']> | undefined =
		undefined;

	@ipcCommand(UpdateSelectionCommand)
	private onSelectionChanged(params: IpcParams<typeof UpdateSelectionCommand>) {
		// An empty selection echo must never clear the selection hint we already hold. The webview only
		// sends a real (non-empty) selection on user intent; an empty report is transient (the GK can't
		// resolve a synthetic WIP row yet) or a scope/visibility filter-out, both of which the webview
		// handles by keeping its inspection anchor and deriving an empty highlight. The host's
		// `_selectedId`/`_selection` are now only a getGraph paging hint + command-target fallback, so
		// leave them intact on an empty echo.
		if (!params.selection.length && this._selectedId != null) return;

		const item = params.selection.find(r => r.active) ?? params.selection[0];
		this.setSelectedRows(item?.id, params.selection, { selected: true, hidden: item?.hidden });

		this._fireSelectionChangedDebounced ??= debounce(this.fireSelectionChanged.bind(this), 50);
		this._fireSelectionChangedDebounced(item?.id, item?.type);
	}

	private fireSelectionChanged(id: string | undefined, type: GitGraphRowType | undefined) {
		if (this.repository == null) return;

		// Secondary-WIP rows live in peer worktrees; the synthetic id encodes the worktree path.
		// Use it (not the primary repo path) so fallback-to-activeSelection commands operate on
		// the worktree the user actually clicked.
		const repoPath =
			type === 'work-dir-changes' && id != null && isSecondaryWipSha(id)
				? getSecondaryWipPath(id)
				: this.repository.path;
		const commit = this.getRevisionReference(repoPath, id, type);
		this._selection = commit != null ? [commit] : undefined;
	}

	private getRevisionReference(
		repoPath: string | undefined,
		id: string | undefined,
		type: GitGraphRowType | undefined,
	): GitStashReference | GitRevisionReference | undefined {
		if (repoPath == null || id == null) return undefined;

		switch (type) {
			case 'stash-node':
				return createReference(id, repoPath, {
					refType: 'stash',
					name: id,
					number: undefined,
				});

			case 'work-dir-changes':
				return createReference(uncommitted, repoPath, { refType: 'revision' });

			default:
				return createReference(id, repoPath, { refType: 'revision' });
		}
	}

	/**
	 * Coalesces `DidFetch` pushes into a single in-flight notify with one trailing re-fire. The payload is
	 * idempotent (just the latest fetch time), but `postMessage` is sequentialized by unique message id, so
	 * an un-coalesced burst enqueues one post per trigger. When the queue drains slower than it fills — the
	 * webview is throttled while the window is unfocused, or the host is busy — the backlog grows unbounded,
	 * and since every slow post to a *view* is wrapped in `withProgress({ viewId })`, each drained post
	 * re-shows the view's progress indicator, strobing it for the life of the drain. Bursts are routine:
	 * `.git/FETCH_HEAD` force-fires `lastFetched` on any FS touch (see `Repository.onFetchHeadChanged`).
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

	@trace()
	private async notifyDidChangeColumns() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeColumnsNotification, this._ipcNotificationMap, this);
			return false;
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);
		return this.host.notify(DidChangeColumnsNotification, {
			columns: columnSettings,
			context: this.getColumnHeaderContext(columnSettings),
			settingsContext: this.getGraphSettingsIconContext(columnSettings),
		});
	}

	@trace()
	private async notifyDidChangeScrollMarkers() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeScrollMarkersNotification, this._ipcNotificationMap, this);
			return false;
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);
		return this.host.notify(DidChangeScrollMarkersNotification, {
			context: this.getGraphSettingsIconContext(columnSettings),
		});
	}

	@trace()
	private async notifyDidChangePinnedRef(params?: IpcParams<typeof DidChangePinnedRefNotification>) {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangePinnedRefNotification, this._ipcNotificationMap, this);
			return false;
		}

		if (params == null) {
			const filters = this.getFiltersByRepo(this._data.session?.repoPath);
			params = { pinnedRef: this.getPinnedRef(filters, this._data.session?.current) };
		}

		return this.host.notify(DidChangePinnedRefNotification, params);
	}

	@trace()
	private async notifyDidChangeRefsVisibility(params?: IpcParams<typeof DidChangeRefsVisibilityNotification>) {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeRefsVisibilityNotification, this._ipcNotificationMap, this);
			return false;
		}

		if (params == null) {
			const filters = this.getFiltersByRepo(this._data.session?.repoPath);
			params = {
				branchesVisibility: this.getBranchesVisibility(filters),
				excludeRefs: this.getExcludedRefs(filters, this._data.session?.current) ?? {},
				excludeTypes: this.getExcludedTypes(filters) ?? {},
				includeOnlyRefs: undefined,
			};

			if (params?.includeOnlyRefs == null) {
				const includedRefsResult = await this.getIncludedRefs(filters, this._data.session?.current, {
					timeout: 100,
				});
				params.includeOnlyRefs = includedRefsResult.refs;
				void includedRefsResult.continuation?.then(refs => {
					if (refs == null) return;

					void this.notifyDidChangeRefsVisibility({ ...params!, includeOnlyRefs: refs });
				});
			}
		}

		return this.host.notify(DidChangeRefsVisibilityNotification, params);
	}

	@trace()
	private async notifyDidChangeConfiguration() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(
				DidChangeGraphConfigurationNotification,
				this._ipcNotificationMap,
				this,
			);
			return false;
		}

		return this.host.notify(DidChangeGraphConfigurationNotification, {
			config: this.getComponentConfig(),
		});
	}

	private notifyDidFetch(): Promise<boolean> {
		return this._didFetchNotify.run();
	}

	@trace()
	private async runNotifyDidFetch(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidFetchNotification, this._ipcNotificationMap, this);
			return false;
		}

		const repo = this.repository;
		if (repo == null) return false;

		const lastFetched = await repo.getLastFetched();
		// Re-validate after the await — a repo swap mid-read would push the old repo's fetch time.
		if (this._repository !== repo) return false;
		// FETCH_HEAD force-fires `lastFetched` even when the time didn't advance, so most triggers
		// carry nothing new; skip those rather than spend a post on an identical payload.
		if (lastFetched === this._lastSentFetchedAt) return true;

		const success = await this.host.notify(DidFetchNotification, { lastFetched: new Date(lastFetched) });
		// Stamp only after a successful send, and only if the repo still matches, so a failed
		// transport or a mid-await swap can't poison the dedupe.
		if (success && this._repository === repo) {
			this._lastSentFetchedAt = lastFetched;
		}
		return success;
	}

	@trace()
	private async notifyDidStartFeaturePreview(featurePreview?: FeaturePreview) {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidStartFeaturePreviewNotification, this._ipcNotificationMap, this);
			return false;
		}

		featurePreview ??= this.getFeaturePreview();
		const [access] = await this.getGraphAccess();
		return this.host.notify(DidStartFeaturePreviewNotification, {
			featurePreview: featurePreview,
			allowed: this.isGraphAccessAllowed(access, featurePreview),
		});
	}

	@trace()
	private async notifyDidChangeSelection() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeSelectionNotification, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeSelectionNotification, {
			selection: convertSelectedRows(this._selectedRows) ?? {},
		});
	}

	@trace()
	private async notifyDidChangeSubscription() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeSubscriptionNotification, this._ipcNotificationMap, this);
			return false;
		}

		const [access] = await this.getGraphAccess();
		return this.host.notify(DidChangeSubscriptionNotification, {
			subscription: access.subscription.current,
			allowed: this.isGraphAccessAllowed(access, this.getFeaturePreview()),
		});
	}

	@trace()
	private notifyDidChangeOrgSettings() {
		void this.host.notify(DidChangeOrgSettings, { orgSettings: this.getOrgSettings() });
	}

	/** Last value sent to the webview — seeds bulk state pushes without awaiting `gk`, and
	 *  doubles as a dedup sentinel for `notifyDidChangeCanInstallClaudeHook`. */
	private _lastCanInstallClaudeHook: boolean | undefined;

	@trace()
	private async notifyDidChangeCanInstallClaudeHook() {
		if (!this.host.visible) return;

		const claude = getContext('gitlens:agents:enabled', false)
			? await this.container.agents.getClaude()
			: undefined;
		const canInstall = claude?.detected === true && claude.hooksSupported && !claude.hooksInstalled;
		if (canInstall === this._lastCanInstallClaudeHook) return;

		this._lastCanInstallClaudeHook = canInstall;
		void this.host.notify(DidChangeCanInstallClaudeHook, canInstall);
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
		}
	}

	private async notifyDidChangeRepoConnection() {
		void this.host.notify(DidChangeRepoConnectionNotification, {
			repositories: await this.getRepositoriesState(),
		});
	}

	private async getRepositoriesState(): Promise<GraphRepository[]> {
		return formatRepositories(this.container.git.openRepositories);
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

		const asWebviewUri = (uri: Uri) => this.host.asWebviewUri(uri);
		const useAvatars = configuration.get('graph.avatars', undefined, true);

		const excludeRefs: GraphExcludeRefs = {};

		for (const id in storedExcludeRefs) {
			const ref: GraphExcludedRef = { ...storedExcludeRefs[id] };
			if (ref.type === 'remote' && ref.owner) {
				const remote = graph.remotes.get(ref.owner);
				if (remote != null) {
					ref.avatarUrl = (
						(useAvatars ? remote.provider?.avatarUri : undefined) ??
						getRemoteIconUri(this.container, remote, asWebviewUri)
					)?.toString(true);
				}
			}

			excludeRefs[id] = ref;
		}

		// For v13, we return directly the hidden refs without validating them

		// This validation has too much performance impact. So we decided to comment those lines
		// for v13 and have it as tech debt to solve after we launch.
		// See: https://github.com/gitkraken/vscode-gitlens/pull/2211#discussion_r990117432
		// if (this.repository == null) {
		// 	this.repository = this.container.git2.getBestRepositoryOrFirst;
		// 	if (this.repository == null) return undefined;
		// }

		// const [hiddenBranches, hiddenTags] = await Promise.all([
		// 	this.repository.getBranches({
		// 		filter: b => !b.current && excludeRefs[b.id] != undefined,
		// 	}),
		// 	this.repository.getTags({
		// 		filter: t => excludeRefs[t.id] != undefined,
		// 	}),
		// ]);

		// const filteredHiddenRefsById: GraphHiddenRefs = {};

		// for (const hiddenBranch of hiddenBranches.values) {
		// 	filteredHiddenRefsById[hiddenBranch.id] = excludeRefs[hiddenBranch.id];
		// }

		// for (const hiddenTag of hiddenTags.values) {
		// 	filteredHiddenRefsById[hiddenTag.id] = excludeRefs[hiddenTag.id];
		// }

		// return filteredHiddenRefsById;

		return excludeRefs;
	}

	private getPinnedRef(
		filters: StoredGraphFilters | undefined,
		graph: GitGraph | undefined,
	): GraphPinnedRef | undefined {
		const stored = filters?.pinnedRef;
		if (stored == null) return undefined;

		const pinned: GraphPinnedRef = { ...stored };
		if (graph != null) {
			for (const branch of graph.branches.values()) {
				if (branch.id === stored.id) {
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

		if (graph == null) return { refs: {} };

		const branchesVisibility = this.getBranchesVisibility(filters);

		let refs: Map<string, GraphIncludeOnlyRef> | undefined;
		let continuation: Promise<GraphIncludeOnlyRefs | undefined> | undefined;

		switch (branchesVisibility) {
			case 'smart': {
				// Add the default branch and if the current branch has a PR associated with it then add the base of the PR
				const current = find(graph.branches.values(), b => b.current);
				if (current == null) return { refs: {}, continuation: continuation };

				const cancellation = this.createCancellation('computeIncludedRefs');

				const result = await getBranchMergeTargetInfo(this.container, current, {
					cancellation: toAbortSignal(cancellation.token),
					timeout: options?.timeout,
				});

				if (cancellation.token.isCancellationRequested) return { refs: {}, continuation: continuation };

				let targetBranchName: string | undefined;
				if (result.mergeTargetBranch?.paused) {
					continuation = result.mergeTargetBranch.value.then(async target => {
						if (target == null || cancellation?.token.isCancellationRequested) return undefined;

						const refs = await this.getVisibleRefs(graph, current, {
							baseOrTargetBranchName: target,
							defaultBranchName: result.defaultBranch,
						});
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
				if (current == null) return { refs: {}, continuation: continuation };

				refs = await this.getVisibleRefs(graph, current);
				break;
			}
			case 'favorited': {
				refs = new Map();
				for (const branch of graph.branches.values()) {
					if (branch.current || branch.starred) {
						refs.set(branch.id, convertBranchToIncludeOnlyRef(branch));
					}
				}

				if (!refs?.size) {
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

		return { refs: refs == null ? {} : Object.fromEntries(refs), continuation: continuation };
	}

	private getFiltersByRepo(repoPath: string | undefined): StoredGraphFilters | undefined {
		if (repoPath == null) return undefined;

		const filters = this.container.storage.getWorkspace('graph:filtersByRepo');
		return filters?.[repoPath];
	}

	private getColumnSettings(columns: Record<GraphColumnName, GraphColumnConfig> | undefined): GraphColumnsSettings {
		const columnsSettings: GraphColumnsSettings = {
			...defaultGraphColumnsSettings,
		};
		if (columns != null) {
			for (const [column, columnCfg] of Object.entries(columns) as [GraphColumnName, GraphColumnConfig][]) {
				columnsSettings[column] = {
					...defaultGraphColumnsSettings[column],
					...columnCfg,
				};
			}
		}

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

		// Surface the current lane-spacing density so the context-menu `when` clauses can toggle it
		contextItems.push(`lanes:density:${configuration.get('graph.lanes.density') ?? 'expanded'}`);

		return contextItems;
	}

	private getSettingsIconContextItems(columnSettings?: GraphColumnsSettings): string[] {
		const contextItems: string[] = columnSettings != null ? this.getColumnContextItems(columnSettings) : [];

		if (configuration.get('graph.scrollMarkers.enabled')) {
			const configurableScrollMarkerTypes: GraphScrollMarkersAdditionalTypes[] = [
				'localBranches',
				'remoteBranches',
				'stashes',
				'tags',
				'pullRequests',
				'wip',
			];
			const enabledScrollMarkerTypes = configuration.get('graph.scrollMarkers.additionalTypes');
			for (const type of configurableScrollMarkerTypes) {
				contextItems.push(
					`scrollMarker:${type}:${enabledScrollMarkerTypes.includes(type) ? 'enabled' : 'disabled'}`,
				);
			}
		}

		return contextItems;
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
				void this.updateFiltersByRepo(this.repository.path, {
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
		const config: GraphComponentConfig = {
			aiEnabled: this.container.ai.enabled,
			autoFetchIntervalSeconds: this.getAutoFetchIntervalSeconds(),
			autoFetchMode: this.getAutoFetchMode(),
			avatars: configuration.get('graph.avatars'),
			dateFormat:
				configuration.get('graph.dateFormat') ?? configuration.get('defaultDateFormat') ?? 'short+short',
			dateStyle: configuration.get('graph.dateStyle') ?? configuration.get('defaultDateStyle'),
			detailsLocation: configuration.get('graph.details.location') ?? 'auto',
			enabledRefMetadataTypes: this._producers.getEnabledRefMetadataTypes(),
			dimMergeCommits: configuration.get('graph.dimMergeCommits'),
			experimentalHomeHeaderEnabled: configuration.get('graph.experimental.homeHeader.enabled') ?? false,
			experimentalKanbanEnabled: configuration.get('graph.experimental.kanban.enabled') ?? false,
			experimentalVisualizationsEnabled: configuration.get('graph.experimental.visualizations.enabled') ?? false,
			activityDecay: configuration.get('graph.experimental.visualizations.activityDecay') ?? '5m',
			activityDecayMs: activityDecayToMs(
				configuration.get('graph.experimental.visualizations.activityDecay') ?? '5m',
			),
			useNewEngine: configuration.get('graph.experimental.useNewEngine'),
			highlightRowsOnRefHover: configuration.get('graph.highlightRowsOnRefHover'),
			idLength: configuration.get('advanced.abbreviatedShaLength'),
			lanesFoldingEnabled: configuration.get('graph.lanes.folding.enabled'),
			lanesFoldingDefault: configuration.get('graph.lanes.folding.default'),
			lanesDensity: configuration.get('graph.lanes.density'),
			lanesGroupedMin: configuration.get('graph.lanes.grouped.min'),
			lanesGroupedMax: configuration.get('graph.lanes.grouped.max'),
			minimap: configuration.get('graph.minimap.enabled'),
			minimapDataType: configuration.get('graph.minimap.dataType'),
			minimapMarkerTypes: this.getMinimapMarkerTypes(),
			minimapReversed: configuration.get('graph.minimap.reversed'),
			multiSelectionMode: configuration.get('graph.multiselect'),
			onlyFollowFirstParent: configuration.get('graph.onlyFollowFirstParent'),
			scrollRowPadding: configuration.get('graph.scrollRowPadding'),
			scrollMarkerTypes: this.getScrollMarkerTypes(),
			searchAutocompleteOnFocus: configuration.get('graph.searchAutocompleteOnFocus'),
			showGhostRefsOnRowHover: configuration.get('graph.showGhostRefsOnRowHover'),
			showRemoteNamesOnRefs: configuration.get('graph.showRemoteNames'),
			showWorktreeWipStats: configuration.get('graph.showWorktreeWipStats'),
			sidebar: configuration.get('graph.sidebar.enabled') ?? true,
			sidebarPinned: configuration.get('graph.sidebar.pinned') ?? false,
			stickyTimeline: configuration.get('graph.stickyTimeline'),
			style: configuration.get('graph.style'),
		};
		return config;
	}

	private getScrollMarkerTypes(): GraphScrollMarkerTypes[] {
		if (!configuration.get('graph.scrollMarkers.enabled')) return [];

		const markers: GraphScrollMarkerTypes[] = [
			'selection',
			'highlights',
			'head',
			'upstream',
			...configuration.get('graph.scrollMarkers.additionalTypes'),
		];

		return markers;
	}

	private getMinimapMarkerTypes(): GraphMinimapMarkerTypes[] {
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

	private async getState(deferRows?: boolean): Promise<State> {
		this.cancelOperation('branchState');
		this.cancelOperation('state');

		const searchRequest = this._searchRequest;
		this._searchRequest = undefined;

		const subscription = await this.container.subscription.getSubscription();
		this._accountAccessRequired = this.isAccountAccessRequired(subscription);
		if (this._accountAccessRequired) {
			// Signed out or unverified: the webview renders only the account-access screen, so skip the
			// entire graph data pipeline (git walk, WIP, branch/PR/remote/worktree lookups). A full reload
			// is forced from `onSubscriptionChanged` once the account becomes usable.
			this._wip.updateWorkingTreeBadge(undefined);
			return {
				...this.host.baseWebviewState,
				allowed: false,
				repositories: [],
				isWeb: isWeb,
				subscription: subscription,
			};
		}

		if (this.container.git.repositoryCount === 0) {
			this._wip.updateWorkingTreeBadge(undefined);
			return {
				...this.host.baseWebviewState,
				allowed: true,
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
		this.host.title = `${this.host.originalTitle}: ${this.repository.name}`;

		let selectionChanged = false;

		// Cold-start default: seed the WIP selection only on a FRESH webview/repo (`_selectedId == null`).
		// Once any intent sets the anchor, getState never re-asserts WIP — the webview owns the anchor and
		// there is no reconciliation to pull a default row back in. The seed rides the `selectedRows` prop
		// and the GK echoes it into the webview anchor.
		if (
			searchRequest == null &&
			this._selectedId == null &&
			configuration.get('graph.initialRowSelection') === 'wip'
		) {
			selectionChanged = true;
			this.setSelectedRows(uncommitted);
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);

		const includeStats =
			(configuration.get('graph.minimap.enabled') &&
				configuration.get('graph.minimap.dataType') === 'lines' &&
				this.isMinimapVisible()) ||
			!columnSettings.changes.isHidden ||
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
			this._data.session.current.paging?.startingCursor == null;
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
				// Serialize against an in-flight page-in so the refresh spans the freshly-paged window — a refresh
				// racing `more()` would splice the just-loaded page away. Cancellation resolves, never rejects;
				// this await and Core's symmetric await of `_graphLoading` form a creation-ordered DAG (no cycle).
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
					// cancelled/failed refresh here would strand stale baked contexts (`+pinned`, provider
					// avatars) behind the reuse gate. Re-arm so the next getState rebuilds.
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
					Logger.info(`[graph] incremental walk: fast (+${result.added ?? 0} new rows)`);
				} else if (result.reason != null) {
					Logger.info(`[graph] incremental walk: fallback (${result.reason})`);
				}
				return session.current;
			})();
		} else {
			// Initial walk for this repo — open a fresh session. Defensively dispose any lingering session for a
			// different repo (a repo swap should already have via reset). Flush its pending snapshot first
			// (mirrors setGraph(undefined)'s flush-then-dispose) so the outgoing window is persisted.
			this._data.store.flush();
			this._data.session?.dispose();
			this._data.session = undefined;
			const repository = this.repository;
			// Boxed so the walk can compare `_data.loading` against its OWN promise for the liveness guard below
			// (a bare self-reference inside the IIFE trips TS's definite-assignment check).
			const ref: { promise?: Promise<GitGraph> } = {};
			ref.promise = (async (): Promise<GitGraph> => {
				// R7c restart persistence: try this repo's persisted window so a cold open is ≈ deserialize + one
				// enumeration instead of a full walk. Skipped for virtual repos (no CLI incremental restore path).
				// The snapshot is UNTRUSTED — the session validates it structurally and ALWAYS refreshes against
				// git, so a stale/corrupt cache degrades cleanly to a normal walk.
				const read = repository.virtual ? undefined : await this._data.store.read(repository.path);
				if (read === 'corrupt') {
					Logger.info(`[graph] session restore: miss (unreadable)`);
				}
				const snapshot = read != null && read !== 'corrupt' ? read.snapshot : undefined;

				const session = await repository.git.graph.openGraphSession(
					{
						rowProcessor: this.graphRowProcessor,
						rev: rev,
						limit: limit,
						include: { stats: includeStats },
						restore: snapshot,
						onRestore: snapshot != null ? r => this._data.logSessionRestore(r) : undefined,
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

		// Check for access and working tree stats
		const promises = Promise.allSettled([
			this.getGraphAccess(),
			this._wip.getWorkingTreeStatsAndPausedOperations(undefined, cancellation.token),
			this.repository.git.branches.getBranch(undefined, toAbortSignal(cancellation.token)),
			this.repository.getLastFetched(),
			// Anchor/label metadata only — NO clean/dirty probing here. The probe fans `git diff`/
			// `ls-files` out across every worktree; awaiting it gated the ENTIRE initial state on the
			// slowest worktree (multi-second stalls, and a wedged mount stuck the loading spinner
			// forever) while the concurrent spawns starved the rows walk. The probed build runs in
			// the background below and merges in via the working-tree channel when it lands.
			this._wip.getWipMetadataBySha(cancellation.token),
			// Worktree registry for the webview — the Agent Activity treemap maps agent file activity
			// to repo-relative keys against these. Fetched directly (not via the graph session, which isn't
			// loaded yet on the deferred-rows build).
			this.repository.git.worktrees?.getWorktrees(toAbortSignal(cancellation.token)),
		]);
		// Deferred worktree clean/dirty probe (see above) — surfaces changed worktrees in the WIP bar
		// shortly after load without blocking or competing with the rows walk.
		this._wip.probeSecondaryWipInBackground();

		let data;
		if (deferRows) {
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

					void this.notifyDidChangeRefsVisibility();
					void this.notifyDidChangePinnedRef();
					this._data.notifyDidChangeRows(selectionChanged);
					// Commit so the next `notifyDidChangeState` doesn't double-fire for events covered
					// by this rebuild's invalidation.
					this._firedSidebarEventSeq = this._sidebarEventCounter.current;
					this._panels.notifySidebarInvalidated();
				} catch (ex) {
					// Cancellation/session-swap aborts are routine; anything else means the deferred bootstrap
					// died BEFORE setGraph — nothing ships and the webview's `loading` spinner never resolves,
					// so at minimum leave a trace (this was previously a fully silent wedge).
					if (!isCancellationError(ex)) {
						Logger.error(ex, `GraphWebviewProvider(${this.host.id}): deferred rows bootstrap failed`);
					}
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

		const [accessResult, workingStatsResult, branchResult, lastFetchedResult, wipMetadataResult, worktreesResult] =
			await promises;
		if (cancellation.token.isCancellationRequested) throw new CancellationError();

		const [access, visibility] = getSettledValue(accessResult) ?? [];

		let branchState: BranchState | undefined;

		const branch = getSettledValue(branchResult);
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
							void this._producers.notifyDidChangeBranchState({ ...base, pr: serializePullRequest(pr) });
						}
					});
				} else {
					const pr = maybePr?.value;
					if (pr != null) {
						branchState.pr = serializePullRequest(pr);
					}
				}
			}
		}

		const filters = this.getFiltersByRepo(this.repository.path);
		const refsVisibility: IpcParams<typeof DidChangeRefsVisibilityNotification> = {
			branchesVisibility: this.getBranchesVisibility(filters),
			excludeRefs: this.getExcludedRefs(filters, data) ?? {},
			excludeTypes: this.getExcludedTypes(filters) ?? {},
			includeOnlyRefs: undefined,
		};
		if (data != null) {
			const includedRefsResult = await this.getIncludedRefs(filters, data, { timeout: 100 });
			refsVisibility.includeOnlyRefs = includedRefsResult.refs;
			void includedRefsResult.continuation?.then(refs => {
				if (refs == null) return;

				void this.notifyDidChangeRefsVisibility({ ...refsVisibility, includeOnlyRefs: refs });
			});
		}

		const searchMode = this.container.storage.get('graph:searchMode', 'normal');
		const useNaturalLanguageSearch = this.container.storage.get('graph:useNaturalLanguageSearch', true);
		const featurePreview = this.getFeaturePreview();

		const storedGraphState = this.container.storage.getWorkspace('graph:state');
		const storedPanels = storedGraphState?.panels;

		// Seed the Overview "Recent" timeframe from the memento before `getOverviewData()` runs
		// below — keeps host-pushed overview updates in sync with the persisted choice on reload.
		this._panels.setOverviewRecentThreshold(storedGraphState?.overview?.recentThreshold ?? 'OneWeek');

		// If the underlying fetch returned undefined (cancelled/failed), leave `workingTreeStats`
		// undefined rather than fabricating a confident `{0,0,0}` — `gl-wip-stats` renders
		// `nothing` for an all-undefined state, which is honest. A misleading clean ✓ would stick
		// until the next FS event landed, and there's no guarantee one will: if the user already
		// had changes when the webview loaded, the working tree won't change of its own accord.
		// The one-shot retry below also seeds an authoritative push shortly after init to recover
		// from transient cancellations during ready-up.
		const resolvedWorkingTreeStats = getSettledValue(workingStatsResult);
		if (resolvedWorkingTreeStats == null) {
			this._wip.scheduleInitialWorkingTreeStatsRetry();
		} else {
			// Seed the panel-tab badge on initial load. A null here is a transient fetch failure (the
			// retry above re-pushes), not a real zero — don't fabricate a zero and clear the badge.
			this._wip.updateWorkingTreeBadge(resolvedWorkingTreeStats);
		}

		const graphWalkthroughBanner = this.getGraphWalkthroughBannerState();

		// `mixed` means the workspace has both public and private repos — so a gated (private) repo can
		// offer switching to a public one. Only computed when access is denied (the only time the gate, and
		// thus the switch affordance, is shown) to avoid an aggregate visibility() scan on the common
		// allowed path. The result is cached on the provider.
		const allowed = this.isGraphAccessAllowed(access, featurePreview);
		const allowRepoSwitch = allowed === false ? (await this.container.git.visibility()) === 'mixed' : false;

		const result: State = {
			...this.host.baseWebviewState,
			webroot: this.host.getWebRoot(),
			windowFocused: this.isWindowFocused,
			repositories: await formatRepositories(this.container.git.openRepositories),
			worktreePaths: getSettledValue(worktreesResult)?.map(w => w.path),
			worktreeBranches: getSiblingWorktreeBranches(getSettledValue(worktreesResult), this.repository.path),
			selectedRepository: this.repository.id,
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
			},
			branchState: branchState,
			lastFetched: new Date(getSettledValue(lastFetchedResult)!),
			selectedRows: convertSelectedRows(this._selectedRows),
			subscription: access?.subscription.current,
			allowed: allowed,
			allowRepoSwitch: allowRepoSwitch,
			// Rows-plane fields are owned by the publisher's channel now — they never travel on this State.
			// The webview keeps whatever the publisher last delivered (the current reducer sees exactly the
			// old "skipRows" shape); `refsMetadata` stays here as the authoritative full-map reset-anchor
			// (its wholesale REPLACE can't be expressed by the publisher's spread-merge delta). `sync`
			// carries the publisher's baseline stamp so R1c can initialize the webview's `{generation, seq}`.
			avatars: undefined,
			refsMetadata: this._producers.serializeRefsMetadata(),
			loading: deferRows === true,
			rowsStatsLoading: undefined,
			rowsStatsIncluded: undefined,
			rows: undefined,
			reachabilityTable: undefined,
			downstreams: undefined,
			paging: undefined,
			// The bootstrap delivers NO rows-plane state, so the webview's baseline must start "empty"
			// (`seq: -1`), never the publisher's current seq — a hard reconnect (fresh HTML) stamping the
			// live seq would tell an empty webview it already holds everything, and its sync-hello would
			// no-op, leaving the graph blank until the next rows change tripped the splice guard. With -1
			// the hello forces a fresh snapshot on hard reconnects, while a first boot's hello is satisfied
			// by the onReady snapshot (the publisher's this-connection watermark) at no extra cost.
			sync: { generation: this._graphSync.generation, seq: -1 },
			columns: columnSettings,
			config: this.getComponentConfig(),
			context: {
				header: this.getColumnHeaderContext(columnSettings),
				settings: this.getGraphSettingsIconContext(columnSettings),
			},
			excludeRefs: refsVisibility.excludeRefs,
			excludeTypes: refsVisibility.excludeTypes,
			includeOnlyRefs: refsVisibility.includeOnlyRefs,
			pinnedRef: this.getPinnedRef(filters, data),
			nonce: this.host.cspNonce,
			workingTreeStats: resolvedWorkingTreeStats,
			wipMetadataBySha: getSettledValue(wipMetadataResult),
			searchMode: searchMode,
			useNaturalLanguageSearch: useNaturalLanguageSearch,
			featurePreview: featurePreview,
			orgSettings: this.getOrgSettings(),
			overview: this._panels.getOverviewData(),
			mcpBannerCollapsed: this.getMcpBannerCollapsed(),
			hooksBannerCollapsed: this.getHooksBannerCollapsed(),
			canInstallClaudeHook: this._lastCanInstallClaudeHook ?? false,
			graphWalkthroughBannerCollapsed: graphWalkthroughBanner.dismissed,
			graphWalkthroughComplete: this.getGraphWalkthroughComplete(),
			graphWalkthroughStarted: this.getGraphWalkthroughStarted(),
			visualizationsButtonCalloutDismissed: this.container.onboarding.isDismissed(
				'graph:visualizations:buttonCallout',
			),
			searchRequest: searchRequest,
			details: {
				...storedPanels?.details,
				visible:
					this._pendingAction != null && this._pendingAction.action !== 'scope-to-branch'
						? true
						: (storedPanels?.details?.visible ?? true),
			},
			sidebar: {
				...storedPanels?.sidebar,
				visible: this._pendingSidebarPanel != null || (storedPanels?.sidebar?.visible ?? true),
				activePanel: this._pendingSidebarPanel ?? storedPanels?.sidebar?.activePanel,
			},
			minimap: {
				...storedPanels?.minimap,
				visible: storedPanels?.minimap?.visible ?? true,
			},
			pendingAction: this._pendingAction,
			wipDrafts: this._wip.sliceWipDraftsForPanel(),
			timeline: {
				period: storedGraphState?.timeline?.period,
				sliceBy: storedGraphState?.timeline?.sliceBy,
				showAllBranches: storedGraphState?.timeline?.showAllBranches,
			},
			overviewRecentThreshold: this._panels.overviewRecentThreshold,
			visualizationMode: storedGraphState?.visualizationMode,
			treemapMode: storedGraphState?.treemap?.mode,
		};
		this._pendingSidebarPanel = undefined;
		this._pendingAction = undefined;
		return result;
	}

	private updateColumns(columnsCfg: GraphColumnsConfig) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		for (const [key, value] of Object.entries(columnsCfg)) {
			columns = updateRecordValue(columns, key, value);
		}
		void this.container.storage
			.storeWorkspace('graph:columns', columns)
			.catch((ex: unknown) => Logger.error(ex, 'graph: failed to persist columns'));
		void this.notifyDidChangeColumns();
	}

	@ipcCommand(UpdateWipDraftCommand)
	private onWipDraftUpdate(params: IpcParams<typeof UpdateWipDraftCommand>) {
		this._wip.writeWipDraftToStorage(params.worktreePath, params.draft);
	}

	private updateExcludedRefs(repoPath: string | undefined, refs: GraphExcludedRef[], visible: boolean) {
		if (repoPath == null || !refs?.length) return;

		let storedExcludeRefs: StoredGraphFilters['excludeRefs'] = this.getFiltersByRepo(repoPath)?.excludeRefs ?? {};
		for (const ref of refs) {
			storedExcludeRefs = updateRecordValue(
				storedExcludeRefs,
				ref.id,
				visible
					? undefined
					: { id: ref.id, type: ref.type as StoredGraphRefType, name: ref.name, owner: ref.owner },
			);
		}

		void this.updateFiltersByRepo(repoPath, { excludeRefs: storedExcludeRefs });
		void this.notifyDidChangeRefsVisibility();
	}

	private updatePinnedRef(repoPath: string | undefined, ref: GraphPinnedRef | null) {
		if (repoPath == null) return;

		const storedPinnedRef =
			ref != null
				? { id: ref.id, type: ref.type as StoredGraphRefType, name: ref.name, owner: ref.owner }
				: undefined;

		void this.updateFiltersByRepo(repoPath, { pinnedRef: storedPinnedRef });
		void this.notifyDidChangePinnedRef();
		this._panels.notifySidebarInvalidated();
		// `+pinned` is baked into ref pills' serialized contexts at row-processing time — neither the
		// graph-reuse gate (the repo didn't change) nor the incremental fast path (no tip moved) rebuilds
		// them, so the pin/unpin menu toggle would go stale. Force one full rebuild; pinning is rare.
		this._pendingContextsRebuild = true;
		this._data.updateState(true);
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
			const recent =
				Math.max(0, now - s.lastActivity.getTime()) < GraphWebviewProvider.agentBranchesIdleThresholdMs;
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

	@ipcCommand(UpdateIncludedRefsCommand)
	private onUpdateIncludeOnlyRefs(params: IpcParams<typeof UpdateIncludedRefsCommand>) {
		this.updateIncludeOnlyRefs(this._data.session?.repoPath, params);
	}

	private updateIncludeOnlyRefs(
		repoPath: string | undefined,
		{ branchesVisibility, refs }: IpcParams<typeof UpdateIncludedRefsCommand>,
	) {
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

		void this.updateFiltersByRepo(repoPath, {
			branchesVisibility: branchesVisibility,
			includeOnlyRefs: storedIncludeOnlyRefs,
		});
		void this.notifyDidChangeRefsVisibility();
	}

	@ipcCommand(UpdateExcludeTypesCommand)
	private onUpdateExcludedTypes(params: IpcParams<typeof UpdateExcludeTypesCommand>) {
		this.updateExcludedTypes(this._data.session?.repoPath, params);
	}

	private updateExcludedTypes(
		repoPath: string | undefined,
		{ key, value }: IpcParams<typeof UpdateExcludeTypesCommand>,
	) {
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

		void this.updateFiltersByRepo(repoPath, { excludeTypes: excludeTypes });
		void this.notifyDidChangeRefsVisibility();
	}

	@ipcCommand(ResetGraphFiltersCommand)
	private onResetFilters() {
		this.resetFilters(this._data.session?.repoPath);
	}

	private resetFilters(repoPath: string | undefined) {
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
			void this.container.storage.storeWorkspace(
				'graph:filtersByRepo',
				updateRecordValue(filtersByRepo, repoPath, undefined),
			);
		}

		// Always notify so the webview-side deferred scope clear (set by handleModeClear) runs.
		void this.notifyDidChangeRefsVisibility();
	}

	private resetHoverCache() {
		this._hoverCache.clear();
		this.cancelOperation('hover');
	}

	private resetRepositoryState() {
		this._getBranchesAndTagsTips = undefined;
		this._searchService.resetHistory();
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

	private setSelectedRows(id: string | undefined, selection?: GraphSelection[], state?: SelectedRowState) {
		// _selectedId should always be a "real" SHA
		let selectedId = id;
		if (id === ('work-dir-changes' satisfies GitGraphRowType)) {
			selectedId = uncommitted;
		}
		if (this._selectedId !== selectedId) {
			this._selectedId = selectedId;
		}

		// _selectedRows should always be a "virtual" row type
		if (id === uncommitted) {
			id = 'work-dir-changes' satisfies GitGraphRowType;
		}

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

		// For non-active worktrees, the active-repo working-tree watcher won't fire, so the
		// host's regular `DidChangeWorkingTreeNotification` won't reach the panel. Fetch the
		// updated WIP for this specific repo and push it directly — one `git status`, no
		// round-trip from the panel.
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
		void this.host.notify(DidRequestWipRefetchNotification, {
			repoPath: value.repoPath,
			wip: result?.wip,
		});
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

		// `createWipSha` needs the graph's anchor repo path to distinguish the primary
		// 'work-dir-changes' sha from a secondary `worktree-wip::<path>` sha. NEVER coalesce the
		// second arg to `targetRepoPath` — `createWipSha(p, p)` collapses to `uncommitted` and we'd
		// emit a primary-WIP sha for what is actually a secondary worktree. Use the bound
		// repository's path rather than the graph session's — the Repository is set when the
		// webview activates, well before graph data loads, and is always present by the time the
		// context-menu reaches this command.
		const wipSha = createWipSha(targetRepoPath, this.repository?.path);

		await undoCommit(this.container, targetRef, {
			onBeforeReset: message => {
				// Batch the selection move, draft seed, and details-panel open before the reset
				// fires its file-watcher event, so the webview sees one coherent transition rather
				// than three across the refresh boundary. The WIP selection rides the `selectedRows`
				// prop and the GK echoes it into the webview anchor. `writeWipDraftToStorage` is the
				// durable mirror of the webview-side flush so the message persists across sessions
				// even if the user never edits.
				this._wip.writeWipDraftToStorage(targetRepoPath, { message: message, messageDirty: true });
				this.setSelectedRows(wipSha);
				void this.notifyDidChangeSelection();
				void this.host.notify(DidRequestGraphActionNotification, {
					action: 'show-wip',
					target: { sha: wipSha, worktreePath: targetRepoPath },
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

		void this.notifyDidChangeColumns();

		if (name === 'changes' && !column.isHidden && !this._data.session?.current.includes?.stats) {
			this._data.updateState();
		}
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
			void this.notifyDidChangeScrollMarkers();
		}
	}

	@debug()
	private async setColumnMode(name: GraphColumnName, mode?: string) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		let column = columns?.[name];
		if (column != null) {
			column.mode = mode;
		} else {
			column = { mode: mode };
		}

		columns = updateRecordValue(columns, name, column);
		await this.container.storage.storeWorkspace('graph:columns', columns);

		void this.notifyDidChangeColumns();
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
		void this.host.notify(DidRequestOpenTimelineScopeNotification, params);
	}

	/** Pushes a search query to the graph webview without triggering a full state refresh — the
	 *  webview applies it directly via `graphHeader.setExternalSearchQuery`. Used by callers like
	 *  "Open File History" that want to filter the graph without re-fetching rows/refs/stats. */
	private notifyRequestSearch(params: DidRequestSearchParams): void {
		void this.host.notify(DidRequestSearchNotification, params);
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
