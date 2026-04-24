import type { emptySetMarker, GraphRefOptData, GraphSearchMode } from '@gitkraken/gitkraken-components';
import type { CancellationToken, ColorTheme, ConfigurationChangeEvent, TextDocumentShowOptions } from 'vscode';
import { CancellationTokenSource, Disposable, env, ProgressLocation, Uri, ViewColumn, window } from 'vscode';
import { createGraphComposeIntegration } from '@env/coretools/composer.js';
import { isClaudeAvailable } from '@env/providers.js';
import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitGraph, GitGraphRowType } from '@gitlens/git/models/graph.js';
import type { GitGraphSearch, GitGraphSearchProgress, GitGraphSearchResults } from '@gitlens/git/models/graphSearch.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '@gitlens/git/models/reference.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { rootSha, uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { GitCommitSearchContext, SearchQuery } from '@gitlens/git/models/search.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getLocalBranchByUpstream,
	getRemoteNameFromBranchName,
} from '@gitlens/git/utils/branch.utils.js';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import { getLastFetchedUpdateInterval } from '@gitlens/git/utils/fetch.utils.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import {
	getComparisonRefsForPullRequest,
	getRepositoryIdentityForPullRequest,
	serializePullRequest,
} from '@gitlens/git/utils/pullRequest.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isSha, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { getSearchQueryComparisonKey, parseSearchQuery } from '@gitlens/git/utils/search.utils.js';
import { sortBranches, sortRemotes, sortTags, sortWorktrees } from '@gitlens/git/utils/sorting.js';
import { filterMap } from '@gitlens/utils/array.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { annotateDiffWithNewLineNumbers } from '@gitlens/utils/diff.js';
import { createDisposable, disposableInterval } from '@gitlens/utils/disposable.js';
import { count, find, join, last } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { areEqual, filterMap as filterMapObject, flatten, hasKeys, updateRecordValue } from '@gitlens/utils/object.js';
import {
	getSettledValue,
	pauseOnCancelOrTimeout,
	pauseOnCancelOrTimeoutMapTuplePromise,
} from '@gitlens/utils/promise.js';
import { Stopwatch } from '@gitlens/utils/stopwatch.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../../../api/gitlens.d.js';
import { getAvatarUri } from '../../../avatars.js';
import { parseCommandContext } from '../../../commands/commandContext.utils.js';
import type { CopyDeepLinkCommandArgs } from '../../../commands/copyDeepLink.js';
import type { CopyMessageToClipboardCommandArgs } from '../../../commands/copyMessageToClipboard.js';
import type { CopyShaToClipboardCommandArgs } from '../../../commands/copyShaToClipboard.js';
import { openExplainDocument } from '../../../commands/explainBase.js';
import type { ExplainBranchCommandArgs } from '../../../commands/explainBranch.js';
import type { ExplainCommitCommandArgs } from '../../../commands/explainCommit.js';
import type { ExplainStashCommandArgs } from '../../../commands/explainStash.js';
import type { ExplainWipCommandArgs } from '../../../commands/explainWip.js';
import type { GenerateChangelogCommandArgs } from '../../../commands/generateChangelog.js';
import type { GenerateCommitMessageCommandArgs } from '../../../commands/generateCommitMessage.js';
import type { OpenIssueOnRemoteCommandArgs } from '../../../commands/openIssueOnRemote.js';
import type { OpenOnRemoteCommandArgs } from '../../../commands/openOnRemote.js';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../../commands/openPullRequestOnRemote.js';
import type { CreatePatchCommandArgs } from '../../../commands/patches.js';
import type { RecomposeBranchCommandArgs } from '../../../commands/recomposeBranch.js';
import type { RecomposeFromCommitCommandArgs } from '../../../commands/recomposeFromCommit.js';
import type {
	GraphBranchesVisibility,
	GraphMinimapMarkersAdditionalTypes,
	GraphScrollMarkersAdditionalTypes,
} from '../../../config.js';
import type { GlCommands, GlWebviewCommandsOrCommandsWithSuffix } from '../../../constants.commands.js';
import type { ContextKeys } from '../../../constants.context.js';
import type { IssuesCloudHostIntegrationId } from '../../../constants.integrations.js';
import { supportedOrderedCloudIssuesIntegrationIds } from '../../../constants.integrations.js';
import { GlyphChars } from '../../../constants.js';
import type { StoredGraphFilters, StoredGraphRefType } from '../../../constants.storage.js';
import type {
	GraphShownTelemetryContext,
	GraphTelemetryContext,
	WebviewTelemetryEvents,
} from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { FeaturePreview } from '../../../features.js';
import { getFeaturePreviewStatus } from '../../../features.js';
import * as BranchActions from '../../../git/actions/branch.js';
import {
	getOrderedComparisonRefs,
	openCommitChanges,
	openCommitChangesWithWorking,
	openComparisonChanges,
	openFiles,
	openFilesAtRevision,
	openOnlyChangedFiles,
	undoCommit,
} from '../../../git/actions/commit.js';
import * as ContributorActions from '../../../git/actions/contributor.js';
import {
	abortPausedOperation,
	continuePausedOperation,
	showPausedOperationStatus,
	skipPausedOperation,
} from '../../../git/actions/pausedOperation.js';
import * as RemoteActions from '../../../git/actions/remote.js';
import * as RepoActions from '../../../git/actions/repository.js';
import * as StashActions from '../../../git/actions/stash.js';
import * as TagActions from '../../../git/actions/tag.js';
import * as WorktreeActions from '../../../git/actions/worktree.js';
import { executeGitCommand } from '../../../git/actions.js';
import { CommitFormatter } from '../../../git/formatters/commitFormatter.js';
import { GlGraphRowProcessor } from '../../../git/graphRowProcessor.js';
import type { RepositoryChangeEvent, RepositoryWorkingTreeChangeEvent } from '../../../git/models/repository.js';
import { GlRepository } from '../../../git/models/repository.js';
import { processNaturalLanguageToSearchQuery } from '../../../git/search.naturalLanguage.js';
import { getAssociatedIssuesForBranch } from '../../../git/utils/-webview/branch.issue.utils.js';
import {
	getBranchAssociatedPullRequest,
	getBranchEnrichedAutolinks,
	getBranchMergeTargetInfo,
	getBranchMergeTargetName,
	getBranchRemote,
	setBranchDisposition,
} from '../../../git/utils/-webview/branch.utils.js';
import {
	formatCommitStats,
	getCommitAssociatedPullRequest,
	getCommitEnrichedAutolinks,
	isCommitSigned,
} from '../../../git/utils/-webview/commit.utils.js';
import { stageConflictResolution } from '../../../git/utils/-webview/conflictResolution.utils.js';
import { getRemoteIconUri } from '../../../git/utils/-webview/icons.js';
import { countConflictMarkers } from '../../../git/utils/-webview/mergeConflicts.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import {
	getBestRemoteWithIntegration,
	getRemoteIntegration,
	getRemoteProviderUrl,
	remoteSupportsIntegration,
} from '../../../git/utils/-webview/remote.utils.js';
import {
	getOpenedWorktreesByBranch,
	getWorktreeHasWorkingChanges,
	getWorktreesByBranch,
} from '../../../git/utils/-webview/worktree.utils.js';
import type { OnboardingChangeEvent } from '../../../onboarding/onboardingService.js';
import { shouldUseSinglePass } from '../../../plus/ai/actions/reviewChanges.js';
import { prepareCompareDataForAIRequest } from '../../../plus/ai/utils/-webview/ai.utils.js';
import type { FeaturePreviewChangeEvent, SubscriptionChangeEvent } from '../../../plus/gk/subscriptionService.js';
import { isHooksBannerEnabled, isMcpBannerEnabled } from '../../../plus/gk/utils/-webview/mcp.utils.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../plus/gk/utils/subscription.utils.js';
import type { ConnectionStateChangeEvent } from '../../../plus/integrations/integrationService.js';
import { getPullRequestBranchDeepLink } from '../../../plus/launchpad/launchpadProvider.js';
import type { AssociateIssueWithBranchCommandArgs } from '../../../plus/startWork/associateIssueWithBranch.js';
import { showComparisonPicker } from '../../../quickpicks/comparisonPicker.js';
import { showContributorsPicker } from '../../../quickpicks/contributorsPicker.js';
import { showReferencePicker2 } from '../../../quickpicks/referencePicker.js';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker } from '../../../quickpicks/repositoryPicker.js';
import { showRevisionFilesPicker } from '../../../quickpicks/revisionFilesPicker.js';
import { fromAbortSignal, toAbortSignal } from '../../../system/-webview/cancellation.js';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	registerCommand,
} from '../../../system/-webview/command.js';
import type { ConfigPath } from '../../../system/-webview/configuration.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext, onDidChangeContext, setContext } from '../../../system/-webview/context.js';
import type { StorageChangeEvent } from '../../../system/-webview/storage.js';
import type { OpenWorkspaceLocation } from '../../../system/-webview/vscode/workspaces.js';
import { openWorkspace } from '../../../system/-webview/vscode/workspaces.js';
import { isDarkTheme, isLightTheme, revealInFileExplorer } from '../../../system/-webview/vscode.js';
import { createCommandDecorator, getWebviewCommand } from '../../../system/decorators/command.js';
import { serializeWebviewItemContext } from '../../../system/webview.js';
import { DeepLinkActionType } from '../../../uris/deepLinks/deepLink.js';
import { RepositoryFolderNode } from '../../../views/nodes/abstract/repositoryFolderNode.js';
import type { ExplainResult } from '../../commitDetails/commitDetailsService.js';
import {
	getFileCommitFromContext,
	isDetailsFileContext,
	isDetailsFolderContext,
} from '../../commitDetails/commitDetailsWebview.utils.js';
import { DetailsFileCommands, getDetailsFileCommands } from '../../commitDetails/detailsFileCommands.js';
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
import { createSharedServices, proxyServices } from '../../rpc/services/common.js';
import type { BranchAndTargetRefs, BranchRef } from '../../shared/branchRefs.js';
import type { GetOverviewEnrichmentResponse, GetOverviewWipResponse } from '../../shared/overviewBranches.js';
import { getBranchOverviewType, toOverviewBranch } from '../../shared/overviewBranches.js';
import { getOverviewEnrichment, getOverviewWip, getOverviewWipBasic } from '../../shared/overviewEnrichment.utils.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider.js';
import type { WebviewPanelShowCommandArgs, WebviewShowOptions } from '../../webviewsController.js';
import { isSerializedState } from '../../webviewsController.js';
import type { ComposerCommandArgs } from '../composer/registration.js';
import * as branchRefCommands from '../shared/branchRefCommands.js';
import type { ChoosePathParams, DidChoosePathParams } from '../timeline/protocol.js';
import type { TimelineCommandArgs } from '../timeline/registration.js';
import { buildTimelineDataset } from '../timeline/timelineDataset.js';
import type { GraphComposeIntegration } from './compose/integration.js';
import {
	checkForAbandonedComposeStashes,
	executeComposeCommit,
	isComposeCancelled,
	libraryPlanToProposedCommits,
} from './compose/utils.js';
import type {
	CommitDetails,
	CompareDiff,
	DetailsItemContext,
	DetailsItemTypedContext,
	GitBranchShape,
	Wip,
} from './detailsProtocol.js';
import { messageHeadlineSplitterToken } from './detailsProtocol.js';
import {
	GraphComposeVirtualContentProvider,
	GraphComposeVirtualNamespace,
} from './graphComposeVirtualContentProvider.js';
import { getScopeFiles } from './graphScopeService.js';
import type {
	BranchCommitEntry,
	BranchCommitsOptions,
	BranchCommitsResult,
	BranchComparisonCommit,
	BranchComparisonContributor,
	BranchComparisonFile,
	ComposeProgressUpdate,
	GraphServices,
	ScopeSelection,
} from './graphService.js';
import {
	formatRepositories,
	hasGitReference,
	isGraphItemRefContext,
	isGraphItemRefGroupContext,
	isGraphItemTypedContext,
	toGraphHostingServiceType,
	toGraphIssueTrackerType,
} from './graphWebview.utils.js';
import type {
	BranchState,
	DidGetSidebarDataParams,
	DidRequestOpenCompareModeParams,
	GetWipStatsResponse,
	GraphBranchContextValue,
	GraphColumnConfig,
	GraphColumnName,
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphComponentConfig,
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphIncludeOnlyRef,
	GraphIncludeOnlyRefs,
	GraphItemContext,
	GraphItemRefContext,
	GraphItemTypedContext,
	GraphMinimapMarkerTypes,
	GraphMissingRefsMetadataType,
	GraphOverviewData,
	GraphPinnedRef,
	GraphRefMetadata,
	GraphRefMetadataType,
	GraphRefType,
	GraphRemoteContextValue,
	GraphRepository,
	GraphScrollMarkerTypes,
	GraphSearchResults,
	GraphSelectedRows,
	GraphSelection,
	GraphSidebarPanel,
	GraphSidebarWorktree,
	GraphStashContextValue,
	GraphTagContextValue,
	GraphWipMetadataBySha,
	GraphWorkingTreeStats,
	State,
} from './protocol.js';
import {
	ChooseAuthorRequest,
	ChooseComparisonRequest,
	ChooseFileRequest,
	ChooseRefRequest,
	ChooseRepositoryCommand,
	DidChangeAgentSessionsNotification,
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeCanInstallClaudeHook,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeHooksBanner,
	DidChangeMcpBanner,
	DidChangeNotification,
	DidChangeOrgSettings,
	DidChangeOverviewNotification,
	DidChangeOverviewWipNotification,
	DidChangePinnedRefNotification,
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeWipStaleNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidRequestOpenCompareModeNotification,
	DidRequestWipRefetchNotification,
	DidSearchNotification,
	DidStartFeaturePreviewNotification,
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
	GetWipStatsRequest,
	isSecondaryWipSha,
	JumpToHeadRequest,
	makeSecondaryWipSha,
	OpenPullRequestDetailsCommand,
	ResetGraphFiltersCommand,
	ResolveGraphScopeRequest,
	RowActionCommand,
	SearchCancelCommand,
	SearchHistoryDeleteRequest,
	SearchHistoryGetRequest,
	SearchHistoryStoreRequest,
	SearchOpenInViewCommand,
	SearchRequest,
	supportedRefMetadataTypes,
	SyncWipWatchesCommand,
	UpdateColumnsCommand,
	UpdateExcludeTypesCommand,
	UpdateGraphConfigurationCommand,
	UpdateGraphSearchModeCommand,
	UpdateIncludedRefsCommand,
	UpdatePinnedRefCommand,
	UpdateRefsVisibilityCommand,
	UpdateSelectionCommand,
} from './protocol.js';
import type { GraphWebviewShowingArgs, ShowInCommitGraphCommandArgs } from './registration.js';
import { SearchHistory } from './searchHistory.js';

interface SelectedRowState {
	selected: boolean;
	hidden?: boolean;
}

function hasSearchQuery(arg: any): arg is { repository: GlRepository; search: SearchQuery } {
	return arg?.repository != null && arg?.search != null;
}

const defaultGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 130, isHidden: false, order: 0 },
	graph: { width: 150, mode: undefined, isHidden: false, order: 1 },
	message: { width: 300, isHidden: false, order: 2 },
	author: { width: 130, isHidden: false, order: 3 },
	changes: { width: 200, isHidden: false, order: 4 },
	datetime: { width: 130, isHidden: false, order: 5 },
	sha: { width: 130, isHidden: false, order: 6 },
};

const compactGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 32, isHidden: false },
	graph: { width: 150, mode: 'compact', isHidden: false },
	author: { width: 32, isHidden: false, order: 2 },
	message: { width: 500, isHidden: false, order: 3 },
	changes: { width: 200, isHidden: false, order: 4 },
	datetime: { width: 130, isHidden: true, order: 5 },
	sha: { width: 130, isHidden: false, order: 6 },
};

/**
 * Grace period before a secondary-WIP filesystem watcher is disposed after its row leaves the
 * viewport. Lets scroll-past-then-back reuse the live watcher instead of thrashing.
 */
const wipWatchGracePeriodMs = 30_000;

// Minimal template used for the first line of the WIP row hover (avatar + author). The rest of the WIP
// tooltip is built directly in `getWipTooltip` to accommodate the optional worktree path and the
// "No working changes" fallback, neither of which is representable via formatter tokens.
const wipAuthorTemplate =
	// eslint-disable-next-line no-template-curly-in-string
	'${avatar} &nbsp;__${author}__';

type CancellableOperations =
	| 'branchState'
	| 'hover'
	| 'computeIncludedRefs'
	| 'search'
	| 'state'
	| 'wipStats'
	| 'workingTree';

const { command, getCommands } = createCommandDecorator<GlWebviewCommandsOrCommandsWithSuffix<'graph'>>();

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

		this._repository = value;
		this.resetRepositoryState();
		this.ensureRepositorySubscriptions(true);

		if (this.host.ready) {
			this.updateState();
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
	private _graph?: GitGraph;
	private _graphLoading?: Promise<GitGraph>;
	private _graphRowProcessor?: GlGraphRowProcessor;
	/** Virtual FS session backing the compose panel's per-proposed-commit diffs. Lazy-initialized on first compose. */
	private _composeVirtual?: {
		readonly provider: GraphComposeVirtualContentProvider;
		readonly registration: Disposable;
		sessionId?: string;
	};
	private _composeToolsForGraph?: GraphComposeIntegration;
	private readonly _activeComposeCacheKeys = new Map<string, string>();
	private _computeWorktreeChangesPromise?: Promise<void>;
	private _pendingWorktreeChanges?: Parameters<typeof getWorktreeHasWorkingChanges>[1][];
	private _hoverCache = new Map<string, Promise<string>>();
	private static readonly _diffCacheCap = 4;
	/** LRU-capped per-AI-request diff cache. Cap is small because only one review and one
	 *  compose can be active at a time — the only legitimate concurrent keys are (review, compose,
	 *  + a couple of variants from changing excludedFiles within a session). */
	private readonly _graphDetailsDiffCache = new LruMap<string, { diff: string; message: string }>(
		GraphWebviewProvider._diffCacheCap,
	);

	private readonly _ipcNotificationMap = new Map<IpcNotification<any>, () => Promise<boolean>>([
		[DidChangeColumnsNotification, this.notifyDidChangeColumns],
		[DidChangeGraphConfigurationNotification, this.notifyDidChangeConfiguration],
		[DidChangeNotification, this.notifyDidChangeState],
		[DidChangeOverviewNotification, this.notifyDidChangeOverview],
		[DidChangeRefsVisibilityNotification, this.notifyDidChangeRefsVisibility],
		[DidChangeScrollMarkersNotification, this.notifyDidChangeScrollMarkers],
		[DidChangeSelectionNotification, this.notifyDidChangeSelection],
		[DidChangeSubscriptionNotification, this.notifyDidChangeSubscription],
		[DidChangeWorkingTreeNotification, this.notifyDidChangeWorkingTree],
		[DidFetchNotification, this.notifyDidFetch],
		[DidStartFeaturePreviewNotification, this.notifyDidStartFeaturePreview],
	]);
	private _issueIntegrationConnectionState: 'connected' | 'not-connected' | 'not-checked' = 'not-checked';
	private _refsMetadata: Map<string, GraphRefMetadata | null> | null | undefined;
	private _search: GitGraphSearch | undefined;
	private _searchIdCounter = getScopedCounter();
	private _selectedId?: string;
	private _honorSelectedId = false;
	private _selectedRows: Record<string, SelectedRowState> | undefined;
	private _theme: ColorTheme | undefined;
	private _repositoryEventsDisposable: Disposable | undefined;
	private _lastFetchedDisposable: Disposable | undefined;
	private _searchHistory: SearchHistory | undefined;

	// Tracked across `notifyDidChangeWorkingTree` calls so we can skip redundant sends when
	// git emits a change event but the resolved stats/metadata are identical to what the webview already has.
	private _lastSentWorkingTreeStats:
		| GraphWorkingTreeStats
		| { added: number; deleted: number; modified: number }
		| undefined;
	private _lastSentWipMetadataBySha: GraphWipMetadataBySha | undefined;
	// Count of staged files included in the last sent stats. Stats counts (added/deleted/
	// modified) DON'T change when a file moves from unstaged → staged via SCM, so the dedup
	// would otherwise drop those notifications and the WIP file list would go stale.
	private _lastSentStagedCount: number | undefined;

	// Coalesce concurrent `notifyDidChangeState` calls; skip when a fresh full-state send just happened
	// (via bootstrap or a prior notify). This prevents the second `getState`/`getGraph` pipeline run
	// that otherwise fires when `onRepositoryChanged` trips during the repo-subscription wiring right after bootstrap.
	private _pendingStateNotify: Promise<boolean> | undefined;
	/** In-flight state build (from bootstrap or a notify); shared so concurrent callers coalesce. */
	private _pendingStateOp: Promise<unknown> | undefined;
	private _lastStateSentAt: number | undefined;
	/** Trailing flush scheduled when notify was skipped inside the freshness window. */
	private _stateFreshnessRetryTimer: ReturnType<typeof setTimeout> | undefined;
	private static readonly stateFreshnessMs = 500;

	private isWindowFocused: boolean = true;

	private get graphRowProcessor(): GlGraphRowProcessor {
		return (this._graphRowProcessor ??= new GlGraphRowProcessor(
			this.container,
			uri => this.host.asWebviewUri(uri),
			() => this.getFiltersByRepo(this._graph?.repoPath)?.pinnedRef?.id,
		));
	}

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>,
	) {
		this._theme = window.activeColorTheme;
		this.ensureRepositorySubscriptions();

		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.storage.onDidChange(this.onStorageChanged, this),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this.container.onboarding.onDidChange(this.onOnboardingChanged, this),
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
					if (removed.length === 0 && (added.length === 0 || added.every(r => r.isWorktree))) {
						this._etag = this.container.git.etag;
						return;
					}

					this.updateState();
				}
			}),
			window.onDidChangeActiveColorTheme(this.onThemeChanged, this),
			{
				dispose: () => {
					if (this._repositoryEventsDisposable == null) return;
					this._repositoryEventsDisposable.dispose();
					this._repositoryEventsDisposable = undefined;
				},
			},
			this.container.integrations.onDidChangeConnectionState(this.onIntegrationConnectionChanged, this),
			this.container.agentStatus?.onDidChangeSerializedSessions(this.onAgentSessionsChanged, this) ?? {
				dispose: () => {},
			},
		);
	}

	dispose(): void {
		for (const t of this._wipWatchRemoveTimers.values()) {
			clearTimeout(t);
		}
		this._wipWatchRemoveTimers.clear();
		for (const d of this._wipWatches.values()) {
			d.dispose();
		}
		this._wipWatches.clear();
		this._flushWipStaleDebounced?.cancel();
		this._pendingStaleShas.clear();
		if (this._composeVirtual != null) {
			this._composeVirtual.provider.dispose();
			this._composeVirtual.registration.dispose();
			this._composeVirtual = undefined;
		}
		this._disposable.dispose();
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

	private getOrCreateComposeToolsForGraph(): GraphComposeIntegration | undefined {
		this._composeToolsForGraph ??= createGraphComposeIntegration(this.container);
		return this._composeToolsForGraph;
	}

	/** Per-secondary-WIP filesystem watchers, keyed by synthetic `worktree-wip::<path>` sha. */
	private readonly _wipWatches = new Map<string, Disposable>();

	/** Pending watcher-disposal timers; entries here mean "watcher is lingering past viewport exit". */
	private readonly _wipWatchRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Pending WIP stale shas waiting to be flushed as a single notification. */
	private readonly _pendingStaleShas = new Set<string>();
	private _flushWipStaleDebounced: Deferrable<() => void> | undefined;

	private readonly _sidebarInvalidatedEvent = createRpcEvent<undefined>('sidebarInvalidated', 'signal');
	private readonly _sidebarWorktreeEvent = createRpcEvent<{
		changes: Record<string, boolean | undefined>;
	}>('sidebarWorktreeState', 'save-last');
	private readonly _composeProgressEvent = createRpcEvent<ComposeProgressUpdate | undefined>(
		'composeProgress',
		'save-last',
	);

	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): GraphServices {
		const base = createSharedServices(this.container, this.host, () => {}, buffer, tracker);

		return proxyServices({
			...base,
			graphInspect: {
				getAiExcludedFiles: async (repoPath: string, filePaths: string[]) => {
					const { AIIgnoreCache } = await import(
						/* webpackChunkName: "ai" */ '../../../plus/ai/aiIgnoreCache.js'
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

						const logRef = mergeBaseSha ? `${mergeBaseSha}..HEAD` : 'HEAD';
						const effectiveLimit = logRef === 'HEAD' ? 20 : limit;
						// Request one extra so we can detect "more available" without a separate count.
						const log = await svc.commits.getLog(logRef, { limit: effectiveLimit + 1 });
						signal?.throwIfAborted();

						if (!log?.commits?.size) return { commits: [], hasMore: false };

						const entries: BranchCommitEntry[] = [];
						let index = 0;
						const total = log.commits.size;
						const hasMore = total > effectiveLimit;
						for (const [sha, commit] of log.commits) {
							if (index >= effectiveLimit) break;
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
						this._graph?.stashes?.get(sha) ??
						(await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha));
					if (commit == null) return undefined;
					signal?.throwIfAborted();
					return this.getCoreCommitDetails(commit);
				},
				getSearchContext: (sha: string): Promise<GitCommitSearchContext | undefined> => {
					return Promise.resolve(this.getSearchContext(sha));
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
				getWip: async (repoPath: string, signal?: AbortSignal): Promise<Wip | undefined> => {
					signal?.throwIfAborted();

					// Secondary worktrees may not be pre-registered as Repository instances;
					// open them on demand — closed, so they don't surface in the VS Code UI.
					const repo =
						this.container.git.getRepository(repoPath) ??
						(await this.container.git.getOrOpenRepository(Uri.file(repoPath), { closeOnOpen: true }));
					if (repo == null) return undefined;

					const svc = this.container.git.getRepositoryService(repoPath);
					const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
						svc.status.getStatus(),
						svc.pausedOps?.getPausedOperationStatus?.(),
					]);
					const status = getSettledValue(statusResult);
					if (status == null) return undefined;
					signal?.throwIfAborted();

					const pausedOpStatus = getSettledValue(pausedOpStatusResult);

					const conflictMarkerCounts = new Map<string, number>();
					if (status.hasConflicts) {
						const conflictedPaths = status.files.filter(f => isConflictStatus(f.status)).map(f => f.path);
						if (conflictedPaths.length > 0) {
							const counts = await Promise.allSettled(
								conflictedPaths.map(p => countConflictMarkers(Uri.joinPath(repo.uri, p))),
							);
							conflictedPaths.forEach((p, i) => {
								const c = getSettledValue(counts[i]);
								if (c != null) {
									conflictMarkerCounts.set(p, c);
								}
							});
						}
					}
					signal?.throwIfAborted();

					const files: GitFileChangeShape[] = [];
					for (const file of status.files) {
						const conflictMarkers = conflictMarkerCounts.get(file.path);
						const change = {
							repoPath: file.repoPath,
							path: file.path,
							status: file.status,
							originalPath: file.originalPath,
							staged: file.staged,
							conflictMarkers: conflictMarkers,
						};
						files.push(change);
						if (file.staged && file.wip) {
							files.push({ ...change, staged: false });
						}
					}

					const branch = await repo.git.branches.getBranch(status.branch);
					signal?.throwIfAborted();

					let branchShape: GitBranchShape | undefined;
					if (branch != null) {
						branchShape = {
							name: branch.name,
							repoPath: branch.repoPath,
							upstream: branch.upstream,
							tracking: {
								ahead: branch.upstream?.state.ahead ?? 0,
								behind: branch.upstream?.state.behind ?? 0,
							},
							reference: getReferenceFromBranch(branch),
						};
					}

					return {
						changes: {
							repository: { name: repo.name, path: repo.path, uri: repo.uri.toString() },
							branchName: status.branch,
							files: files,
							hasConflicts: status.hasConflicts,
							pausedOpStatus: pausedOpStatus,
						},
						repositoryCount: this.container.git.openRepositoryCount,
						branch: branchShape,
						repo: {
							uri: repo.uri.toString(),
							name: repo.name,
							path: repo.path,
						},
					};
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

						return { result: { summary: '', body: '' } };
					} catch (ex) {
						return { error: { message: ex instanceof Error ? ex.message : String(ex) } };
					}
				},
				reviewChanges: async (repoPath, scope, prompt, excludedFiles, signal) => {
					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(signal);
					try {
						signal?.throwIfAborted();

						const reviewType = this.getReviewTypeForScope(scope);
						const diffCacheKey = this.getDiffCacheKey(repoPath, scope, excludedFiles);
						this._graphDetailsDiffCache.delete(diffCacheKey);
						const data = await this.getDiffForScope(repoPath, scope, signal);
						if (!data) return { error: { message: 'No changes found.' } };

						// Filter out user-excluded files before review
						const excluded = excludedFiles?.length ? new Set(excludedFiles) : undefined;
						if (excluded?.size) {
							const { filterDiffFiles } = await import(
								/* webpackChunkName: "ai" */ '@gitlens/git/parsers/diffParser.js'
							);
							data.diff = await filterDiffFiles(data.diff, paths => paths.filter(p => !excluded.has(p)));
							signal?.throwIfAborted();

							if (!data.diff?.trim()) return { error: { message: 'No changes found.' } };
						}
						this._graphDetailsDiffCache.set(diffCacheKey, { diff: data.diff, message: data.message });

						// Adaptive strategy: single-pass for small diffs, two-pass for large. The
						// threshold is scoped to the selected model's input-context budget — a 1M-
						// token model happily single-passes a 100KB diff that an 8k-context model
						// couldn't. `{ silent: true }` avoids prompting the user from a background
						// fetch; on an unset model the helper falls back to a conservative default.
						const aiModel = await this.container.ai.getModel({ silent: true });
						signal?.throwIfAborted();
						if (shouldUseSinglePass(data.diff, aiModel)) {
							const result = await this.container.ai.actions.reviewChanges(
								{ diff: data.diff, message: data.message, instructions: prompt || undefined },
								{ source: 'graph', context: { type: reviewType, mode: 'single-pass' } },
								{
									cancellation: cancellation,
									progress: {
										location: ProgressLocation.Notification,
										title: 'Reviewing changes...',
									},
								},
							);

							if (result === 'cancelled' || result == null) {
								return { error: { message: 'Review was cancelled.' } };
							}

							const response = await result.promise;
							if (response === 'cancelled' || response == null) {
								return { error: { message: 'Review was cancelled.' } };
							}

							return { result: response.result };
						}

						// Two-pass: build file manifest from the (already filtered) diff
						const { parseGitDiff, countDiffInsertionsAndDeletions } = await import(
							/* webpackChunkName: "ai" */ '@gitlens/git/parsers/diffParser.js'
						);
						signal?.throwIfAborted();
						const parsed = parseGitDiff(data.diff);
						const parsedFiles = parsed.files.map(f => {
							const { insertions, deletions } = countDiffInsertionsAndDeletions(f);
							return { path: f.path, status: 'M', additions: insertions, deletions: deletions };
						});
						const fileManifest = JSON.stringify(parsedFiles);

						const overviewResult = await this.container.ai.actions.reviewOverview(
							{ files: fileManifest, message: data.message, instructions: prompt || undefined },
							{ source: 'graph', context: { type: reviewType, mode: 'two-pass' } },
							{
								cancellation: cancellation,
								progress: {
									location: ProgressLocation.Notification,
									title: 'Analyzing changes...',
								},
							},
						);

						if (overviewResult === 'cancelled' || overviewResult == null) {
							return { error: { message: 'Review was cancelled.' } };
						}

						const overviewResponse = await overviewResult.promise;
						if (overviewResponse === 'cancelled' || overviewResponse == null) {
							return { error: { message: 'Review was cancelled.' } };
						}

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
						const { filterDiffFiles } = await import(
							/* webpackChunkName: "ai" */ '@gitlens/git/parsers/diffParser.js'
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
								instructions: prompt || undefined,
							},
							focusAreaId,
							{ source: 'graph', context: { type: reviewType, mode: 'two-pass' } },
							{
								progress: {
									location: ProgressLocation.Notification,
									title: 'Reviewing focus area...',
								},
							},
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
					}
				},
				generateCommitMessage: async repoPath => {
					// Pass the Repository (not a raw diff) so the AI service applies its
					// staged-first → unstaged-fallback convention. The previous implementation
					// always grabbed the full uncommitted diff (staged + unstaged), which produced
					// messages that didn't match what the user was about to commit on a
					// staging-aware repo.
					try {
						const repo = this.container.git.getRepository(repoPath);
						if (repo == null) return undefined;

						const result = await this.container.ai.actions.generateCommitMessage(
							repo,
							{ source: 'graph-details' },
							{
								progress: {
									location: ProgressLocation.Notification,
									title: 'Generating commit message...',
								},
							},
						);
						if (result === 'cancelled' || result == null) return undefined;

						return result.result;
					} catch (ex) {
						// Surface the failure instead of silently returning so regressions are visible.
						Logger.error(ex, 'graph.generateCommitMessage');
						return undefined;
					}
				},
				composeChanges: async (repoPath, scope, instructions, excludedFiles, signal) => {
					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(signal);
					try {
						signal?.throwIfAborted();

						if (scope.type !== 'wip') {
							return { error: { message: 'Compose is only supported for working changes.' } };
						}

						const composeTools = this.getOrCreateComposeToolsForGraph();
						if (composeTools == null) {
							return { error: { message: 'Compose is not available in this environment.' } };
						}

						const repo = this.container.git.getRepository(repoPath);
						if (repo == null) {
							return { error: { message: 'Repository not found.' } };
						}

						const priorKey = this._activeComposeCacheKeys.get(repoPath);
						if (priorKey != null) {
							composeTools.discardCachedPlan(priorKey);
							this._activeComposeCacheKeys.delete(repoPath);
						}

						this._composeProgressEvent.fire({ phase: 'collecting', message: 'Preparing changes…' });

						const planResult = await composeTools.generatePlanForGraphDetails({
							repo: repo,
							scope: scope,
							customInstructions: instructions,
							excludedFiles: excludedFiles,
							cancellation: cancellation,
							telemetrySource: { source: 'graph' },
							onProgress: event => {
								this._composeProgressEvent.fire({ phase: event.phase, message: event.message });
							},
						});
						signal?.throwIfAborted();

						this._activeComposeCacheKeys.set(repoPath, planResult.cacheKey);

						const svc = this.container.git.getRepositoryService(repoPath);
						const wipStatus = await svc.status.getStatus(undefined, signal);
						signal?.throwIfAborted();
						const wipByPath = new Map<string, { status: GitFileStatus; originalPath?: string }>();
						if (wipStatus?.files) {
							for (const f of wipStatus.files) {
								if (!wipByPath.has(f.path)) {
									wipByPath.set(f.path, { status: f.status, originalPath: f.originalPath });
								}
							}
						}

						const headCommit = await svc.commits.getCommit('HEAD');
						signal?.throwIfAborted();

						const baseAnchorSha =
							planResult.kind === 'wip-only' ? planResult.headSha : planResult.rewriteFromSha;
						const baseAnchorCommit =
							baseAnchorSha === planResult.headSha
								? headCommit
								: baseAnchorSha === rootSha
									? undefined
									: await svc.commits.getCommit(baseAnchorSha);
						signal?.throwIfAborted();

						const { createCombinedDiffForCommit } = await import(
							/* webpackChunkName: "ai" */ '../composer/utils/composer.utils.js'
						);
						const { commits, commitHunksByIndex } = libraryPlanToProposedCommits(
							planResult,
							repoPath,
							wipByPath,
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
							},
						};
					} catch (ex) {
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
					const composeTools = this.getOrCreateComposeToolsForGraph();
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
					}
				},
				getBranchComparisonSummary: async (repoPath, leftRef, rightRef, options, signal) => {
					// Phase 1 — counts + the unified All Files diff. Smallest payload to land the user
					// on a useful panel; per-side commits + their files are fetched on demand via
					// `getBranchComparisonSide`.
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);

					// Two-dot for the unified "All Files" view — matches Search & Compare's
					// `ref2..ref1` semantics so a file modified on both sides shows once with a
					// single combined diff (one click → one unambiguous diff).
					const allDiffRange = `${rightRef}..${leftRef}`;

					const [counts, comparisonFiles, workingTreeFiles] = await Promise.all([
						svc.commits.getLeftRightCommitCount(`${leftRef}...${rightRef}`),
						svc.diff.getDiffStatus(allDiffRange),
						this.getBranchComparisonWorkingTreeFiles(
							repoPath,
							leftRef,
							options?.includeWorkingTree === true,
							signal,
						),
					]);
					signal?.throwIfAborted();

					const aheadCount = (counts?.left ?? 0) + (workingTreeFiles.length > 0 ? 1 : 0);
					const behindCount = counts?.right ?? 0;

					const mappedAllFiles: BranchComparisonFile[] = [];
					for (const f of comparisonFiles ?? []) {
						mappedAllFiles.push({
							repoPath: repoPath,
							path: f.path,
							status: f.status,
							originalPath: f.originalPath,
							staged: false,
							stats: f.stats,
							source: 'comparison',
						});
					}

					const allFiles = [...mappedAllFiles, ...workingTreeFiles];
					return {
						aheadCount: aheadCount,
						behindCount: behindCount,
						allFilesCount: allFiles.length,
						allFiles: allFiles,
					};
				},
				getBranchComparisonSide: async (repoPath, leftRef, rightRef, side, options, signal) => {
					// Phase 2 — that side's commits without inline files.
					// We fetch files on demand when a commit is selected.
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);

					// Two-dot range — commits reachable from one side but not the other.
					const range = side === 'ahead' ? `${rightRef}..${leftRef}` : `${leftRef}..${rightRef}`;
					const [log, comparisonFiles, workingTreeFiles] = await Promise.all([
						svc.commits.getLog(range, { limit: 100, includeFiles: false }, signal),
						svc.diff.getDiffStatus(range),
						side === 'ahead'
							? this.getBranchComparisonWorkingTreeFiles(
									repoPath,
									leftRef,
									options?.includeWorkingTree === true,
									signal,
								)
							: Promise.resolve([]),
					]);
					signal?.throwIfAborted();

					const mappedFiles: BranchComparisonFile[] = [];
					for (const f of comparisonFiles ?? []) {
						mappedFiles.push({
							repoPath: repoPath,
							path: f.path,
							status: f.status,
							originalPath: f.originalPath,
							staged: false,
							stats: f.stats,
							source: 'comparison',
						});
					}
					const allFilesForSide = [...mappedFiles, ...workingTreeFiles];

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
						commits.push(entry);
					}

					return { commits: commits, files: allFilesForSide };
				},
				getContributorsForBranchComparison: async (repoPath, leftRef, rightRef, scope, signal) => {
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);

					// Two-dot for ahead/behind (commits only on one side); three-dot for the
					// symmetric "all" union — matches the ranges used by `getBranchComparison`.
					const rev =
						scope === 'ahead'
							? `${rightRef}..${leftRef}`
							: scope === 'behind'
								? `${leftRef}..${rightRef}`
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
					return pick?.sha != null ? { name: pick.name, sha: pick.sha } : undefined;
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
		} satisfies GraphServices);
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

	private async getCoreCommitDetails(commit: GitCommit): Promise<CommitDetails> {
		const hasDistinctCommitter = commit.committer.email != null && commit.committer.email !== commit.author.email;
		const [commitResult, avatarUriResult, committerAvatarUriResult] = await Promise.allSettled([
			!commit.hasFullDetails()
				? GitCommit.ensureFullDetails(commit, { include: { uncommittedFiles: true } }).then(() => commit)
				: commit,
			getAvatarUri(commit.author.email, { ref: commit.sha, repoPath: commit.repoPath }, { size: 32 }),
			hasDistinctCommitter
				? getAvatarUri(commit.committer.email, { ref: commit.sha, repoPath: commit.repoPath }, { size: 32 })
				: Promise.resolve(undefined),
		]);

		commit = getSettledValue(commitResult, commit);
		const avatarUri = getSettledValue(avatarUriResult);
		const committerAvatarUri = hasDistinctCommitter ? getSettledValue(committerAvatarUriResult) : undefined;

		let message = CommitFormatter.fromTemplate(`\${message}`, commit);
		const index = message.indexOf('\n');
		if (index !== -1) {
			message = `${message.substring(0, index)}${messageHeadlineSplitterToken}${message.substring(index + 1)}`;
		}

		return {
			repoPath: commit.repoPath,
			sha: commit.sha,
			shortSha: commit.shortSha,
			author: { ...commit.author, avatar: avatarUri?.toString(true) },
			committer: { ...commit.committer, avatar: committerAvatarUri?.toString(true) },
			message: message,
			parents: commit.parents,
			stashNumber: commit.refType === 'stash' ? commit.stashNumber : undefined,
			stashOnRef: commit.refType === 'stash' ? commit.stashOnRef : undefined,
			files: (commit.isUncommitted ? commit.anyFiles : commit.fileset?.files)?.map(f => ({
				repoPath: f.repoPath,
				path: f.path,
				status: f.status,
				originalPath: f.originalPath,
				staged: f.staged,
				stats: f.stats,
			})),
			stats: commit.stats,
		};
	}

	canReuseInstance(...args: WebviewShowingArgs<GraphWebviewShowingArgs, State>): boolean | undefined {
		if (this.container.git.openRepositoryCount === 1) return true;

		const [arg] = args;

		let repository: GlRepository | undefined;
		if (GlRepository.is(arg)) {
			repository = arg;
		} else if (hasGitReference(arg)) {
			repository = this.container.git.getRepository(arg.ref.repoPath);
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
			'context.repository.closed': this.repository?.closed,
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
			if (!isSha(id)) {
				id = (await this.container.git.getRepositoryService(arg.ref.repoPath).revision.resolveRevision(id)).sha;
			}

			// Make sure we honor the selection to ensure we won't override it with the default selection
			this._honorSelectedId = true;
			this.setSelectedRows(id);

			if (this._graph != null) {
				if (this._graph?.ids.has(id)) {
					void this.notifyDidChangeSelection();
					return [true, this.getShownTelemetryContext()];
				}

				void this.onGetMoreRows({ id: id }, true);
			}
		} else if (hasSearchQuery(arg)) {
			this.repository = arg.repository;
			this._searchRequest = arg.search;
			this.updateState();
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
					this.updateState();
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
		const op = this.getState(true).finally(() => {
			this._lastStateSentAt = performance.now();
			this._pendingStateOp = undefined;
		});
		this._pendingStateOp = op;
		return op;
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.is('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
				registerCommand(`${this.host.id}.openInNewWindow`, async () => {
					await executeCommand<WebviewPanelShowCommandArgs<GraphWebviewShowingArgs>>(
						'gitlens.showGraphPage',
						undefined,
						this.repository,
					);
					void executeCoreCommand('workbench.action.moveEditorToNewWindow');
				}),
				registerCommand(
					`${this.host.id}.openInTab`,
					() =>
						void executeCommand<WebviewPanelShowCommandArgs<GraphWebviewShowingArgs>>(
							'gitlens.showGraphPage',
							undefined,
							this.repository,
						),
				),
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

		// Register commands from @command decorators
		for (const c of getCommands()) {
			commands.push(
				this.host.registerWebviewCommand(getWebviewCommand(c.command, this.host.type), c.handler.bind(this)),
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

		// Folder-only commands (Folder History submenu).
		for (const { command: cmd, handler } of getDetailsFolderCommands()) {
			if (cmd in sharedDetailsFolderCommandRoutes) continue;
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
	}

	onWindowFocusChanged(focused: boolean): void {
		this.isWindowFocused = focused;
	}

	onVisibilityChanged(visible: boolean): void {
		if (
			visible &&
			((this.repository != null && this.repository.etag !== this._etagRepository) ||
				this.container.subscription.etag !== this._etagSubscription)
		) {
			if (this.host.ready) {
				this.updateState(true);
			}
			return;
		}

		if (visible) {
			this.host.sendPendingIpcNotifications();
		}
	}

	@ipcRequest(GetCountsRequest)
	private async onGetCounts() {
		const graph = this._graph ?? (await this._graphLoading?.catch(() => undefined));
		if (graph == null) return undefined;

		const tags = await this.container.git.getRepositoryService(graph.repoPath).tags.getTags();
		return {
			branches: count(graph.branches?.values(), b => !b.remote),
			remotes: graph.remotes.size,
			stashes: graph.stashes?.size,
			// Subtract the default worktree
			worktrees: graph.worktrees != null ? graph.worktrees.length - 1 : undefined,
			tags: tags.values.length,
		};
	}

	@ipcRequest(GetOverviewRequest)
	private onGetOverview(): GraphOverviewData {
		return this.getOverviewData();
	}

	@ipcRequest(GetOverviewWipRequest)
	private async onGetOverviewWip(params: IpcParams<typeof GetOverviewWipRequest>): Promise<GetOverviewWipResponse> {
		if (params.branchIds.length === 0 || this._graph == null || this.repository == null) return {};

		// Default eager path uses the lightweight clean/dirty probe — full add/changed/deleted
		// breakdown is fetched on demand by the rich hover via `GetOverviewWipDetailedRequest`.
		const data = this._graph;
		return getOverviewWipBasic(
			this.container,
			data.branches.values(),
			data.worktreesByBranch ?? new Map(),
			params.branchIds,
		);
	}

	@ipcRequest(GetOverviewWipDetailedRequest)
	private async onGetOverviewWipDetailed(
		params: IpcParams<typeof GetOverviewWipDetailedRequest>,
	): Promise<GetOverviewWipResponse> {
		if (params.branchIds.length === 0 || this._graph == null || this.repository == null) return {};

		const data = this._graph;
		return getOverviewWip(
			this.container,
			data.branches.values(),
			data.worktreesByBranch ?? new Map(),
			params.branchIds,
		);
	}

	@ipcRequest(GetOverviewEnrichmentRequest)
	private async onGetOverviewEnrichment(
		params: IpcParams<typeof GetOverviewEnrichmentRequest>,
	): Promise<GetOverviewEnrichmentResponse> {
		if (params.branchIds.length === 0 || this._graph == null || this.repository == null) return {};

		const subscription = await this.container.subscription.getSubscription();
		const isPro = isSubscriptionTrialOrPaidFromState(subscription.state);

		return getOverviewEnrichment(this.container, this._graph.branches.values(), params.branchIds, {
			isPro: isPro,
			resolveLaunchpad: true,
			// Merge-target is fetched lazily by the overview card on hover (and by the click-to-scope
			// path in `graph-app`) via `BranchesService.getMergeTargetStatus`, so initial enrichment
			// doesn't block on ~4 git/integration ops per branch. The resolved value is then merged
			// back into shared `overviewEnrichment` state via `mergeMergeTargetIntoEnrichment` so the
			// scope-anchor's `reconcileScopeMergeTarget` hook still backfills the tip SHA.
			skipMergeTarget: true,
		});
	}

	@ipcRequest(GetAgentSessionsRequest)
	private onGetAgentSessions(): AgentSessionState[] {
		return this.container.agentStatus?.getSerializedSessions() ?? [];
	}

	private onAgentSessionsChanged(sessions: AgentSessionState[]): void {
		void this.host.notify(DidChangeAgentSessionsNotification, { sessions: sessions });
	}

	@ipcRequest(GetWipStatsRequest)
	private async onGetWipStats(params: IpcParams<typeof GetWipStatsRequest>): Promise<GetWipStatsResponse> {
		const response: GetWipStatsResponse = {};
		if (params.shas.length === 0) return response;

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
				const status = await svc.status.getStatus(undefined, signal);
				if (cancellation.token.isCancellationRequested) return;

				const diff = status?.diffStatus;
				response[sha] = {
					added: diff?.added ?? 0,
					deleted: diff?.deleted ?? 0,
					modified: diff?.changed ?? 0,
				};
			}),
		);

		return response;
	}

	private async onGetSidebarData(
		params: { panel: GraphSidebarPanel },
		signal?: AbortSignal,
	): Promise<DidGetSidebarDataParams> {
		const graph = this._graph ?? (await this._graphLoading?.catch(() => undefined));
		signal?.throwIfAborted();
		if (graph == null) return { panel: params.panel, items: [] };

		switch (params.panel) {
			case 'branches':
				return this.getSidebarBranches(graph);
			case 'remotes':
				return this.getSidebarRemotes(graph);
			case 'stashes':
				return this.getSidebarStashes(graph);
			case 'tags':
				return this.getSidebarTags(graph);
			case 'worktrees':
				return this.getSidebarWorktrees(graph);
			default:
				return { panel: params.panel, items: [] };
		}
	}

	private getProviderByRemote(graph: GitGraph): Map<string, string> {
		const providerByRemote = new Map<string, string>();
		for (const r of graph.remotes.values()) {
			if (r.provider?.name) {
				providerByRemote.set(r.name, r.provider.name);
			}
		}
		return providerByRemote;
	}

	private getSidebarBranches(graph: GitGraph) {
		const providerByRemote = this.getProviderByRemote(graph);
		const pinnedRefId = this.getFiltersByRepo(graph.repoPath)?.pinnedRef?.id;

		const branchCfg = configuration.get('views.branches.branches');
		const sorted = sortBranches(
			[...graph.branches.values()].filter(b => !b.remote),
			{
				current: true,
				orderBy: configuration.get('sortBranchesBy'),
				openedWorktreesByBranch: getOpenedWorktreesByBranch(graph.worktreesByBranch),
			},
		);

		const items = sorted.map(b => {
			// Exclude the default worktree from the worktree indicator (matches view behavior)
			const isCheckedOut = b.worktree != null && b.worktree !== false;
			const hasWorktree = isCheckedOut && !b.worktree.isDefault;
			const worktree = graph.worktreesByBranch?.get(b.id);
			const remoteName = b.upstream ? getRemoteNameFromBranchName(b.upstream.name) : undefined;
			return {
				name: b.name,
				sha: b.sha,
				current: b.current,
				remote: false,
				status: b.status,
				upstream: b.upstream ? { name: b.upstream.name, missing: b.upstream.missing } : undefined,
				tracking: b.upstream?.state,
				worktree: hasWorktree,
				worktreeOpened: worktree?.opened || undefined,
				checkedOut: isCheckedOut || undefined,
				disposition: b.disposition || undefined,
				date: b.date?.getTime(),
				providerName: remoteName ? providerByRemote.get(remoteName) : undefined,
				starred: b.starred || undefined,
				context: {
					webview: this.host.id,
					webviewItem: `gitlens:branch${b.current ? '+current' : ''}${
						b.upstream != null && !b.upstream.missing ? '+tracking' : ''
					}${hasWorktree ? '+worktree' : ''}${
						b.current || isCheckedOut ? '+checkedout' : ''
					}${b.upstream?.state.ahead ? '+ahead' : ''}${b.upstream?.state.behind ? '+behind' : ''}${
						b.id === pinnedRefId ? '+pinned' : ''
					}`,
					webviewItemValue: {
						type: 'branch',
						ref: createReference(b.name, graph.repoPath, {
							id: b.id,
							refType: 'branch',
							name: b.name,
							remote: false,
							upstream: b.upstream,
						}),
					},
				} satisfies GraphItemRefContext<GraphBranchContextValue>,
			};
		});
		return { panel: 'branches' as const, items: items, layout: branchCfg.layout, compact: branchCfg.compact };
	}

	private async getSidebarRemotes(graph: GitGraph) {
		const sorted = sortRemotes([...graph.remotes.values()]);
		const branchOrderBy = configuration.get('sortBranchesBy');
		const pinnedRefId = this.getFiltersByRepo(graph.repoPath)?.pinnedRef?.id;
		const branchesByRemote = new Map<string, GitBranch[]>();
		for (const b of graph.branches.values()) {
			if (!b.remote) continue;
			const remote = getRemoteNameFromBranchName(b.name);
			let arr = branchesByRemote.get(remote);
			if (arr == null) {
				arr = [];
				branchesByRemote.set(remote, arr);
			}
			arr.push(b);
		}
		const items = await Promise.all(
			sorted.map(async r => {
				const rBranches = sortBranches(branchesByRemote.get(r.name) ?? [], {
					current: false,
					orderBy: branchOrderBy,
				});
				const branches = rBranches.map(b => ({
					name: getBranchNameWithoutRemote(b.name),
					sha: b.sha,
					context: {
						webview: this.host.id,
						webviewItem: `gitlens:branch+remote${b.id === pinnedRefId ? '+pinned' : ''}`,
						webviewItemValue: {
							type: 'branch',
							ref: createReference(b.name, graph.repoPath, {
								id: b.id,
								refType: 'branch',
								name: b.name,
								remote: true,
							}),
						},
					} satisfies GraphItemRefContext<GraphBranchContextValue>,
				}));

				let connected: boolean | undefined;
				if (remoteSupportsIntegration(r)) {
					const integration = await getRemoteIntegration(r);
					connected = integration?.maybeConnected ?? (await integration?.isConnected()) ?? false;
				}

				let webviewItem = 'gitlens:remote';
				if (r.default) {
					webviewItem += '+default';
				}
				if (connected != null) {
					webviewItem += connected ? '+connected' : '+disconnected';
				}

				return {
					name: r.name,
					url: r.urls[0]?.url,
					isDefault: r.default,
					providerIcon: r.provider?.icon,
					providerName: r.provider?.name,
					connected: connected,
					branches: branches,
					context: {
						webview: this.host.id,
						webviewItem: webviewItem,
						webviewItemValue: {
							type: 'remote',
							name: r.name,
							repoPath: graph.repoPath,
						},
					} satisfies GraphItemTypedContext<GraphRemoteContextValue>,
				};
			}),
		);
		const remoteCfg = configuration.get('views.remotes.branches');
		return { panel: 'remotes' as const, items: items, layout: remoteCfg.layout, compact: remoteCfg.compact };
	}

	private getSidebarStashes(graph: GitGraph) {
		const items =
			graph.stashes != null
				? Array.from(graph.stashes.values(), s => ({
						name: s.stashName,
						sha: s.sha,
						message: s.message ?? '',
						date: s.author.date.getTime(),
						stashNumber: s.stashNumber ?? '',
						stashOnRef: s.stashOnRef,
						context: {
							webview: this.host.id,
							webviewItem: 'gitlens:stash',
							webviewItemValue: {
								type: 'stash',
								ref: createReference(s.sha, graph.repoPath, {
									refType: 'stash',
									name: s.stashName,
									message: s.message,
									number: s.stashNumber,
								}),
							},
						} satisfies GraphItemRefContext<GraphStashContextValue>,
					}))
				: [];
		return { panel: 'stashes' as const, items: items };
	}

	private async getSidebarTags(graph: GitGraph) {
		const tagCfg = configuration.get('views.tags.branches');
		const result = await this.container.git.getRepositoryService(graph.repoPath).tags.getTags({ sort: true });
		const sorted = sortTags(result.values, { orderBy: configuration.get('sortTagsBy') });
		const items = sorted.map(t => ({
			name: t.name,
			sha: t.sha,
			message: t.message || undefined,
			annotated: t.message != null && t.message.length > 0,
			date: t.date?.getTime(),
			context: {
				webview: this.host.id,
				webviewItem: 'gitlens:tag',
				webviewItemValue: {
					type: 'tag',
					ref: createReference(t.name, graph.repoPath, {
						id: t.id,
						refType: 'tag',
						name: t.name,
					}),
				},
			} satisfies GraphItemRefContext<GraphTagContextValue>,
		}));
		return { panel: 'tags' as const, items: items, layout: tagCfg.layout, compact: tagCfg.compact };
	}

	private getSidebarWorktrees(graph: GitGraph) {
		const providerByRemote = this.getProviderByRemote(graph);

		const wtCfg = configuration.get('views.worktrees.branches');
		const worktrees =
			graph.worktrees != null
				? sortWorktrees([...graph.worktrees], { orderBy: configuration.get('sortWorktreesBy') })
				: [];

		const items = worktrees.map(w => {
			const upstreamName = w.branch?.upstream?.name;
			const remoteName = upstreamName ? getRemoteNameFromBranchName(upstreamName) : undefined;

			let webviewItem = `gitlens:worktree${w.isDefault ? '+default' : ''}${
				w.workspaceFolder != null ? '+active' : ''
			}`;
			if (w.branch != null) {
				webviewItem += '+branch';
				if (w.branch.starred) {
					webviewItem += '+starred';
				}
				if (w.branch.upstream != null && !w.branch.upstream.missing) {
					webviewItem += '+tracking';
				}
				switch (w.branch.status) {
					case 'ahead':
						webviewItem += '+ahead';
						break;
					case 'behind':
						webviewItem += '+behind';
						break;
					case 'diverged':
						webviewItem += '+ahead+behind';
						break;
				}
				if (w.branch.rebasing) {
					webviewItem += '+rebasing';
				}
			} else if (w.type === 'detached') {
				webviewItem += '+detached';
			}

			// Base context — `+working` is appended in the webview when the async hasChanges resolves.
			const context: GraphSidebarWorktree['context'] =
				w.branch != null
					? {
							webview: this.host.id,
							webviewItem: webviewItem,
							webviewItemValue: {
								type: 'branch',
								ref: createReference(w.branch.name, graph.repoPath, {
									id: w.branch.id,
									refType: 'branch',
									name: w.branch.name,
									remote: false,
									upstream: w.branch.upstream,
								}),
							},
						}
					: w.sha != null
						? {
								webview: this.host.id,
								webviewItem: webviewItem,
								webviewItemValue: {
									type: 'commit',
									ref: createReference(w.sha, graph.repoPath, {
										refType: 'revision',
										name: w.sha,
										message: '',
									}),
								},
							}
						: undefined;

			return {
				name: w.name,
				uri: w.uri.fsPath,
				branch: w.branch?.name,
				sha: w.sha,
				isDefault: w.isDefault,
				locked: w.locked !== false,
				opened: w.workspaceFolder != null,
				status: w.branch?.status,
				upstream: w.branch?.upstream?.name,
				tracking: w.branch?.upstream?.state,
				providerName: remoteName ? providerByRemote.get(remoteName) : undefined,
				context: context,
			};
		});

		// Fire-and-forget: compute working changes per worktree and notify the webview
		if (worktrees.length > 0) {
			this.computeWorktreeChanges(worktrees);
		}

		return { panel: 'worktrees' as const, items: items, layout: wtCfg.layout, compact: wtCfg.compact };
	}

	private onSidebarToggleLayout(params: { panel: GraphSidebarPanel }) {
		const configKey = {
			branches: 'views.branches.branches.layout',
			remotes: 'views.remotes.branches.layout',
			tags: 'views.tags.branches.layout',
			worktrees: 'views.worktrees.branches.layout',
		} as const satisfies Partial<Record<GraphSidebarPanel, ConfigPath>>;

		const key = configKey[params.panel as keyof typeof configKey];
		if (key == null) return;

		const current = configuration.get(key);
		void configuration.updateEffective(key, current === 'tree' ? 'list' : 'tree');
	}

	private onSidebarRefresh(_params: { panel: GraphSidebarPanel }) {
		this.notifySidebarInvalidated();
	}

	private onSidebarAction(params: { command: GlCommands; context?: string; args?: unknown[] }) {
		const repoPath = this._graph?.repoPath;
		if (repoPath == null) return;

		// Typed-args path — used by panels (e.g. agents) where the action target is a structured
		// payload, not a serialized webview-item context. Args bypass the context+repoPath fallback
		// because the receiving command takes its own typed arguments.
		if (params.args != null) {
			void executeCommand(params.command, ...params.args);
			return;
		}

		if (params.context != null) {
			try {
				const ctx = JSON.parse(params.context);
				ctx.webview = this.host.id;
				ctx.webviewInstance = this.host.instanceId;
				void executeCommand(params.command, ctx);
				return;
			} catch {}
		}

		// Header actions — dispatch directly to action functions with repoPath,
		// since view commands expect view node context, not Uri
		switch (params.command) {
			case 'gitlens.views.title.createWorktree':
				void WorktreeActions.create(repoPath);
				return;
			case 'gitlens.views.title.createBranch':
				void BranchActions.create(repoPath);
				return;
			case 'gitlens.views.title.createTag':
				void TagActions.create(repoPath);
				return;
			case 'gitlens.views.addRemote':
				void RemoteActions.add(repoPath);
				return;
			case 'gitlens.switchToAnotherBranch:views':
				void RepoActions.switchTo(repoPath);
				return;
			case 'gitlens.stashSave:views':
				void StashActions.push(repoPath);
				return;
			case 'gitlens.stashesApply:views':
				void StashActions.apply(repoPath);
				return;
			case 'gitlens.graph.pull':
				void RepoActions.pull(repoPath);
				return;
			case 'gitlens.graph.push':
				void RepoActions.push(repoPath);
				return;
			case 'gitlens.fetch:graph':
				void RepoActions.fetch(repoPath);
				return;
			default:
				void executeCommand(params.command, Uri.file(repoPath));
		}
	}

	@ipcCommand(UpdateGraphConfigurationCommand)
	private onUpdateGraphConfig(params: IpcParams<typeof UpdateGraphConfigurationCommand>) {
		const config = this.getComponentConfig();

		let key: keyof IpcParams<typeof UpdateGraphConfigurationCommand>['changes'];
		for (key in params.changes) {
			if (config[key] !== params.changes[key]) {
				switch (key) {
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
					default:
						// TODO:@eamodio add more config options as needed
						debugger;
						break;
				}
			}
		}
	}

	@ipcCommand(UpdateGraphSearchModeCommand)
	private onUpdateGraphSearchMode(params: IpcParams<typeof UpdateGraphSearchModeCommand>) {
		void this.container.storage.store('graph:searchMode', params.searchMode).catch();
		void this.container.storage.store('graph:useNaturalLanguageSearch', params.useNaturalLanguage).catch();

		// Update the active search query's filter property to match the new mode
		updateSearchMode(this.container, this._search, params.searchMode);
	}

	private getSearchContext(id: string | undefined): GitCommitSearchContext | undefined {
		if (!this._search?.queryFilters.files || id == null) return undefined;

		const result = this._search.results.get(id);
		return {
			query: this._search.query,
			queryFilters: this._search.queryFilters,
			matchedFiles: result?.files ?? [],
			hiddenFromGraph: this._selectedRows?.[id]?.hidden ?? false,
		};
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'graph.commitOrdering')) {
			this.updateState();

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
			this.notifySidebarInvalidated();
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
					!this._graph?.includes?.stats)
			) {
				this.updateState();
			}
		}
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
		if (e.type !== 'workspace' || !e.keys.includes('graph:state')) return;

		// If the minimap just became visible and we skipped stats on the last fetch, refetch now
		if (
			this.isMinimapVisible() &&
			configuration.get('graph.minimap.enabled') &&
			configuration.get('graph.minimap.dataType') === 'lines' &&
			!this._graph?.includes?.stats
		) {
			this.updateState();
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
		// Index-only changes (staging/unstaging) don't affect the graph structure,
		// but do affect working tree stats — use the lightweight refresh path
		if (e.changed('index')) {
			void this.notifyDidChangeWorkingTree();
		}

		// FETCH_HEAD-only signal: refresh just the displayed fetch time, no need to rebuild
		// the full state. Force re-arm the periodic interval so it picks up the fresh value
		// (and starts running if there was no FETCH_HEAD before this fetch).
		if (e.changed('lastFetched')) {
			void this.notifyDidFetch();
			void this.ensureLastFetchedSubscription(true);
		}

		if (
			!e.changed(
				'config',
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
			)
		) {
			this._etagRepository = e.repository.etag;
			return;
		}

		if (e.changed('config')) {
			if (this._refsMetadata != null) {
				// Clear out any associated issue metadata
				for (const [, value] of this._refsMetadata) {
					if (value == null) continue;
					value.issue = undefined;
				}
			}
		}

		// Invalidate sidebar panels only for changes that actually affect their data. Skipping this for
		// config/unknown/pausedOp changes prevents the sidebar from showing a spinner during unrelated
		// repo activity (e.g. worktrees discovered during graph scroll fire `unknown` repo events).
		if (e.changed('heads', 'remotes', 'stash', 'tags')) {
			this.notifySidebarInvalidated();
		}

		// Unless we don't know what changed, update the state immediately
		this.updateState(!e.changedExclusive('unknown'));
	}

	@trace({ args: false })
	private onRepositoryWorkingTreeChanged(e: RepositoryWorkingTreeChangeEvent) {
		if (e.repository.id !== this.repository?.id) return;
		void this.notifyDidChangeWorkingTree();
	}

	@trace({ args: false })
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;
		void this.notifyDidChangeSubscription();
	}

	private onOnboardingChanged(e: OnboardingChangeEvent) {
		if (e.key === 'mcp:banner') {
			this.onMcpBannerChanged();
			// Dismissing the MCP banner can newly enable the hooks banner — refresh both.
			this.onHooksBannerChanged();
		} else if (e.key === 'hooks:banner') {
			this.onHooksBannerChanged();
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

	private onThemeChanged(theme: ColorTheme) {
		if (
			this._theme != null &&
			((isDarkTheme(theme) && isDarkTheme(this._theme)) || (isLightTheme(theme) && isLightTheme(this._theme)))
		) {
			return;
		}

		this._theme = theme;
		this.updateState();
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

	@ipcCommand(UpdateRefsVisibilityCommand)
	private onRefsVisibilityChanged(params: IpcParams<typeof UpdateRefsVisibilityCommand>) {
		this.updateExcludedRefs(this._graph?.repoPath, params.refs, params.visible);
	}

	@ipcCommand(UpdatePinnedRefCommand)
	private onPinnedRefChanged(params: IpcParams<typeof UpdatePinnedRefCommand>) {
		this.updatePinnedRef(this._graph?.repoPath, params.ref);
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
						return void this.openPullRequestOnRemote(item);
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

	@ipcRequest(GetRowHoverRequest)
	private async onHoverRowRequest(params: IpcParams<typeof GetRowHoverRequest>) {
		const hover: IpcResponse<typeof GetRowHoverRequest> = {
			id: params.id,
			markdown: undefined!,
		};

		this.cancelOperation('hover');

		if (this._graph != null) {
			const id = params.id;

			let markdown = this._hoverCache.get(id);
			if (markdown == null) {
				const cancellation = this.createCancellation('hover');

				let cache = true;
				let commit;
				let secondaryWorktree;
				try {
					const isSecondaryWip = params.type === 'work-dir-changes' && isSecondaryWipSha(id);
					const hoverRepoPath = isSecondaryWip ? getSecondaryWipPath(id) : this._graph.repoPath;
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
					const stats = this._graph.rowsStats?.get(commit.sha);
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
	}

	private async getCommitTooltip(
		commit: GitCommit,
		cancellation: CancellationToken,
		worktree?: GitWorktree | undefined,
	) {
		if (commit.isUncommitted) {
			return this.getWipTooltip(commit, cancellation, worktree);
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

	private async getWipTooltip(
		commit: GitCommit,
		cancellation: CancellationToken,
		worktree?: GitWorktree,
	): Promise<string> {
		const [authorLine] = await Promise.all([
			CommitFormatter.fromTemplateAsync(
				wipAuthorTemplate,
				commit,
				{ source: 'graph' },
				{ outputFormat: 'markdown' },
			),
			GitCommit.ensureFullDetails(commit, { include: { stats: true } }),
		]);

		if (cancellation.isCancellationRequested) throw new CancellationError();

		const workingTreeLine =
			worktree != null ? `\`Working Tree\` &nbsp;$(folder) \`${worktree.uri.fsPath}\`` : '`Working Tree`';

		const statsShort = formatCommitStats(commit.stats, 'stats', { color: true });
		const statsExpanded = formatCommitStats(commit.stats, 'expanded', {
			addParenthesesToFileStats: true,
			color: true,
			separator: ', ',
		});
		const statsLine = statsShort
			? statsExpanded
				? `${statsShort} ${statsExpanded}`
				: statsShort
			: 'No working changes';

		return `${authorLine}\\\n${workingTreeLine}\\\n${statsLine}`;
	}

	@ipcRequest(EnsureRowRequest)
	@trace()
	private async onEnsureRowRequest(params: IpcParams<typeof EnsureRowRequest>) {
		if (this._graph == null) return { id: undefined };

		let id: string | undefined;
		if (this._graph.ids.has(params.id)) {
			id = params.id;
		} else {
			await this.updateGraphWithMoreRows(this._graph, params.id, this._search);
			if (this._graph.ids.has(params.id)) {
				id = params.id;
			}

			if (id != null && params.select) {
				this.setSelectedRows(id);
			}

			void this.notifyDidChangeRows(params.select ?? false);
		}

		return { id: id };
	}

	@ipcCommand(GetMissingAvatarsCommand)
	private async onGetMissingAvatars(params: IpcParams<typeof GetMissingAvatarsCommand>) {
		if (this._graph == null) return;

		const repoPath = this._graph.repoPath;

		async function getAvatar(this: GraphWebviewProvider, email: string, id: string) {
			const uri = await getAvatarUri(email, { ref: id, repoPath: repoPath });
			this._graph!.avatars.set(email, uri.toString(true));
		}

		const promises: Promise<void>[] = [];

		for (const [email, id] of Object.entries(params.emails)) {
			if (this._graph.avatars.has(email)) continue;

			promises.push(getAvatar.call(this, email, id));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
			this.updateAvatars();
		}
	}

	@ipcCommand(GetMissingRefsMetadataCommand)
	private async onGetMissingRefMetadata(params: IpcParams<typeof GetMissingRefsMetadataCommand>) {
		if (this._graph == null || this._refsMetadata === null) {
			return;
		}

		// Check if we have connected integrations that can provide the requested metadata
		const hasHostingIntegration = getContext('gitlens:repos:withHostingIntegrationsConnected')?.includes(
			this._graph.repoPath,
		);

		if (!hasHostingIntegration) {
			// If no hosting integration, check if we at least have issue integrations connected
			const hasIssueIntegration =
				this._issueIntegrationConnectionState !== 'not-checked'
					? this._issueIntegrationConnectionState === 'connected'
					: await this.checkIssueIntegrations();
			if (!hasIssueIntegration) return;
		}

		const repoPath = this._graph.repoPath;

		async function getRefMetadata(
			this: GraphWebviewProvider,
			id: string,
			missingTypes: GraphMissingRefsMetadataType[],
		) {
			this._refsMetadata ??= new Map();

			const branch = (
				await this.container.git
					.getRepositoryService(repoPath)
					.branches.getBranches({ filter: b => b.id === id })
			)?.values?.[0];
			const metadata = { ...this._refsMetadata.get(id) };

			if (branch == null) {
				for (const type of missingTypes) {
					metadata[type] = null;
					this._refsMetadata.set(id, metadata);
				}

				return;
			}

			for (const type of missingTypes) {
				if (!supportedRefMetadataTypes.includes(type)) {
					metadata[type] = null;
					this._refsMetadata.set(id, metadata);

					continue;
				}

				if (type === 'pullRequest') {
					const pr =
						branch != null ? await getBranchAssociatedPullRequest(this.container, branch) : undefined;

					if (pr == null) {
						if (metadata.pullRequest === undefined || metadata.pullRequest?.length === 0) {
							metadata.pullRequest = null;
						}

						this._refsMetadata.set(id, metadata);
						continue;
					}

					const hostingService = toGraphHostingServiceType(pr.provider.id);
					if (hostingService == null) {
						debugger;
						continue;
					}

					const prMetadata: NonNullable<NonNullable<GraphRefMetadata>['pullRequest']>[number] = {
						hostingServiceType: hostingService,
						id: Number.parseInt(pr.id) || 0,
						title: pr.title,
						author: pr.author.name,
						date: (pr.mergedDate ?? pr.closedDate ?? pr.updatedDate)?.getTime(),
						state: pr.state,
						url: pr.url,
						context: serializeWebviewItemContext<GraphItemContext>({
							webviewItem: `gitlens:pullrequest${pr.refs ? '+refs' : ''}`,
							webviewItemValue: {
								type: 'pullrequest',
								id: pr.id,
								url: pr.url,
								repoPath: repoPath,
								refs: pr.refs,
								provider: {
									id: pr.provider.id,
									name: pr.provider.name,
									domain: pr.provider.domain,
									icon: pr.provider.icon,
								},
							},
						}),
					};

					metadata.pullRequest = [prMetadata];

					this._refsMetadata.set(id, metadata);
					if (branch?.upstream?.missing) {
						this._refsMetadata.set(getBranchId(repoPath, true, branch.upstream.name), metadata);
					}
					continue;
				}

				if (type === 'upstream') {
					const upstream = branch?.upstream;

					if (upstream == null || upstream.missing) {
						metadata.upstream = null;
						this._refsMetadata.set(id, metadata);
						continue;
					}

					const upstreamMetadata: NonNullable<GraphRefMetadata>['upstream'] = {
						name: getBranchNameWithoutRemote(upstream.name),
						owner: getRemoteNameFromBranchName(upstream.name),
						ahead: branch.upstream?.state.ahead ?? 0,
						behind: branch.upstream?.state.behind ?? 0,
						context: serializeWebviewItemContext<GraphItemContext>({
							webviewItem: 'gitlens:upstreamStatus',
							webviewItemValue: {
								type: 'upstreamStatus',
								ref: getReferenceFromBranch(branch),
								ahead: branch.upstream?.state.ahead ?? 0,
								behind: branch.upstream?.state.behind ?? 0,
							},
						}),
					};

					metadata.upstream = upstreamMetadata;

					this._refsMetadata.set(id, metadata);
					continue;
				}

				// TODO: Issue metadata needs to update for a branch whenever we add an associated issue for it, so that we don't
				// have to completely refresh the component to see the new issue
				if (type === 'issue') {
					let issues: IssueShape[] | undefined = await getAssociatedIssuesForBranch(
						this.container,
						branch,
					).then(issues => issues.value);
					if (!issues?.length) {
						issues = await getBranchEnrichedAutolinks(this.container, branch).then(
							async enrichedAutolinks => {
								if (enrichedAutolinks == null) return undefined;

								return (
									await Promise.all(
										Array.from(
											enrichedAutolinks.values(),
											async ([issueOrPullRequestPromise]) =>
												issueOrPullRequestPromise ?? undefined,
										),
									)
								).filter<IssueShape>(
									(a?: unknown): a is IssueShape =>
										a != null && a instanceof Object && 'type' in a && a.type === 'issue',
								);
							},
						);

						if (!issues?.length) {
							metadata.issue = null;
							this._refsMetadata.set(id, metadata);
							continue;
						}
					}

					const issuesMetadata: NonNullable<NonNullable<GraphRefMetadata>['issue']>[number][] = [];
					for (const issue of issues) {
						const issueTracker = toGraphIssueTrackerType(issue.provider.id);
						if (issueTracker == null) {
							debugger;
							continue;
						}

						issuesMetadata.push({
							issueTrackerType: issueTracker,
							displayId: issue.id,
							id: issue.nodeId ?? issue.id,
							// TODO: This is a hack/workaround because the graph component doesn't support this in the tooltip.
							// Update this once that is fixed.
							title: `${issue.title}\nDouble-click to open issue on ${issue.provider.name}`,
							context: serializeWebviewItemContext<GraphItemContext>({
								webviewItem: 'gitlens:issue',
								webviewItemValue: {
									type: 'issue',
									id: issue.id,
									url: issue.url,
									provider: {
										id: issue.provider.id,
										name: issue.provider.name,
										domain: issue.provider.domain,
										icon: issue.provider.icon,
									},
								},
							}),
						});
					}

					metadata.issue = issuesMetadata;
					this._refsMetadata.set(id, metadata);
				}
			}
		}

		const promises: Promise<void>[] = [];

		for (const id of Object.keys(params.metadata)) {
			promises.push(getRefMetadata.call(this, id, params.metadata[id]));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
		}
		this.updateRefsMetadata();
	}

	@ipcCommand(SyncWipWatchesCommand)
	@debug()
	private async onSyncWipWatches(params: IpcParams<typeof SyncWipWatchesCommand>) {
		const wanted = new Set(params.shas);

		// Schedule lazy disposal for watchers whose row left the viewport, or cancel a pending
		// disposal if the row is back in view. Rapid scroll-past-then-back reuses the same watcher.
		for (const sha of this._wipWatches.keys()) {
			if (wanted.has(sha)) {
				const pending = this._wipWatchRemoveTimers.get(sha);
				if (pending != null) {
					clearTimeout(pending);
					this._wipWatchRemoveTimers.delete(sha);
				}
				continue;
			}

			if (this._wipWatchRemoveTimers.has(sha)) continue;

			const timer = setTimeout(() => {
				this._wipWatchRemoveTimers.delete(sha);
				const d = this._wipWatches.get(sha);
				if (d == null) return;
				this._wipWatches.delete(sha);
				d.dispose();
			}, wipWatchGracePeriodMs);
			this._wipWatchRemoveTimers.set(sha, timer);
		}

		// Open watchers for newly visible shas.
		for (const sha of wanted) {
			if (this._wipWatches.has(sha)) continue;
			if (!isSecondaryWipSha(sha)) continue;

			const path = getSecondaryWipPath(sha);
			const repo =
				this.container.git.getRepository(path) ??
				(await this.container.git.getOrOpenRepository(Uri.file(path), { closeOnOpen: true }));
			if (repo == null) continue;
			// Double-check: another concurrent call may have claimed this sha while we awaited.
			if (this._wipWatches.has(sha) || !wanted.has(sha)) continue;

			this._wipWatches.set(
				sha,
				Disposable.from(
					repo.watchWorkingTree(500),
					repo.onDidChangeWorkingTree(() => this.queueWipStale(sha)),
				),
			);
		}
	}

	private queueWipStale(sha: string) {
		this._pendingStaleShas.add(sha);
		this._flushWipStaleDebounced ??= debounce(this.flushWipStale.bind(this), 250);
		this._flushWipStaleDebounced();
	}

	private flushWipStale() {
		if (this._pendingStaleShas.size === 0) return;
		const shas = [...this._pendingStaleShas];
		this._pendingStaleShas.clear();
		this.notifyWipStale(shas);
	}

	private notifyWipStale(shas: string[]) {
		if (!this.host.ready || !this.host.visible) return;
		void this.host.notify(DidChangeWipStaleNotification, { shas: shas });
	}

	@ipcCommand(GetMoreRowsCommand)
	@trace()
	private async onGetMoreRows(params: IpcParams<typeof GetMoreRowsCommand>, sendSelectedRows: boolean = false) {
		if (this._graph?.paging == null) return;
		if (this._graph?.more == null || this.repository?.etag !== this._etagRepository) {
			this.updateState(true);

			return;
		}

		await this.updateGraphWithMoreRows(this._graph, params.id, this._search, params.limit);
		void this.notifyDidChangeRows(sendSelectedRows);
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
		const primaryRepoPath = this._graph?.repoPath;
		if (primaryRepoPath == null) return;

		const rowRepoPath =
			params.row.type === 'work-dir-changes' && isSecondaryWipSha(params.row.id)
				? getSecondaryWipPath(params.row.id)
				: primaryRepoPath;

		switch (params.action) {
			case 'compose-commits':
				await executeCommand<ComposerCommandArgs>('gitlens.composeCommits', {
					repoPath: rowRepoPath,
					source: 'graph',
				});
				break;
			case 'generate-commit-message':
				await executeCommand<GenerateCommitMessageCommandArgs>('gitlens.ai.generateCommitMessage', {
					repoPath: rowRepoPath,
					source: 'graph',
				});
				break;
			case 'stash-save':
				await StashActions.push(rowRepoPath);
				break;
			// case 'recompose-branch': {
			// 	const row = this._graph?.rows.find(r => r.sha === params.row.id);
			// 	const branchName = row?.heads?.[0]?.name;
			// 	if (branchName != null) {
			// 		await executeCommand<RecomposeBranchCommandArgs>('gitlens.recomposeBranch', {
			// 			repoPath: repoPath,
			// 			branchName: branchName,
			// 			source: 'graph',
			// 		});
			// 	}
			// 	break;
			// }
			// case 'stash-pop': {
			// 	const ref = createReference(params.row.id, repoPath, {
			// 		refType: 'stash',
			// 		name: params.row.id,
			// 		number: undefined,
			// 	});
			// 	await StashActions.pop(repoPath, ref);
			// 	break;
			// }
			// case 'stash-drop': {
			// 	const ref = createReference(params.row.id, repoPath, {
			// 		refType: 'stash',
			// 		name: params.row.id,
			// 		number: undefined,
			// 	});
			// 	await StashActions.drop(repoPath, [ref]);
			// 	break;
			// }
		}
	}

	@ipcRequest(SearchHistoryGetRequest)
	@trace()
	private onSearchHistoryGetRequest(): IpcResponse<typeof SearchHistoryGetRequest> {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);
		try {
			return { history: this._searchHistory.get() };
		} catch {
			return { history: [] };
		}
	}

	@ipcRequest(SearchHistoryStoreRequest)
	@trace()
	private async onSearchHistoryStoreRequest(params: IpcParams<typeof SearchHistoryStoreRequest>) {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);

		try {
			await this._searchHistory.store(params.search);
		} finally {
			// eslint-disable-next-line no-unsafe-finally
			return { history: this._searchHistory.get() };
		}
	}

	@ipcRequest(SearchHistoryDeleteRequest)
	@trace()
	private async onSearchHistoryDeleteRequest(params: IpcParams<typeof SearchHistoryDeleteRequest>) {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);
		try {
			await this._searchHistory.delete(params.query);
		} finally {
			// eslint-disable-next-line no-unsafe-finally
			return { history: this._searchHistory.get() };
		}
	}

	@ipcCommand(SearchCancelCommand)
	@trace()
	private onSearchCancel(params: { preserveResults: boolean }) {
		this.cancelOperation('search');

		// For pause (preserveResults: true), the generator will handle cancellation gracefully and return results collected so far

		if (!params.preserveResults) {
			this._searchIdCounter.next();
			this.resetSearchState();

			// Send clear notification to webview
			void this.host.notify(DidSearchNotification, {
				search: undefined,
				results: undefined,
				partial: false,
				searchId: this._searchIdCounter.current,
			});
		}
	}

	@ipcRequest(SearchRequest)
	@trace()
	private async onSearchRequest(params: IpcParams<typeof SearchRequest>) {
		using sw = new Stopwatch(`GraphWebviewProvider.onSearchRequest(${this.host.id})`);

		if (params.search?.naturalLanguage) {
			params.search = await processNaturalLanguageToSearchQuery(this.container, params.search, {
				source: 'graph',
			});
		}

		const query = params.search ? parseSearchQuery(params.search) : undefined;
		const types = query != null ? join(query.operations.keys(), ',') : '';

		let results: IpcResponse<typeof SearchRequest> | undefined;
		let exception: (Error & { original?: Error }) | undefined;

		try {
			results = await this.searchGraphOrContinue(params, true);
			return results;
		} catch (ex) {
			exception = ex;
			return {
				search: params.search,
				results: isCancellationError(ex)
					? undefined
					: { error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error' },
				partial: false,
				searchId: this._searchIdCounter.current,
			};
		} finally {
			const cancelled = isCancellationError(exception);

			this.host.sendTelemetryEvent('graph/searched', {
				types: types,
				duration: sw.elapsed(),
				matches: (results?.results as GraphSearchResults)?.count ?? 0,
				failed: exception != null,
				'failed.reason': exception != null ? (cancelled ? 'cancelled' : 'error') : undefined,
				'failed.error': !cancelled && exception != null ? String(exception) : undefined,
				'failed.error.detail':
					!cancelled && exception?.original != null ? String(exception?.original) : undefined,
			});
		}
	}

	private async searchGraphOrContinue(
		e: IpcParams<typeof SearchRequest>,
		progressive: boolean = true,
	): Promise<IpcResponse<typeof SearchRequest>> {
		let search = this._search;

		const graph = this._graph!;

		if (
			e.more &&
			search?.paging?.cursor != null &&
			search.comparisonKey === getSearchQueryComparisonKey(e.search)
		) {
			if (this.repository == null) {
				return {
					search: e.search,
					results: { error: 'No repository' },
					partial: false,
					searchId: this._searchIdCounter.current,
				};
			}

			const searchId = this._searchIdCounter.current;
			const cancellation = this.createCancellation('search');

			try {
				// Continue search from cursor, passing existing results
				const searchStream = this.repository.git.graph.continueSearchGraph(
					search.paging.cursor,
					search.results,
					{
						limit: e.limit ?? configuration.get('graph.searchItemLimit') ?? 0,
					},
					toAbortSignal(cancellation.token),
				);
				using _streamDisposer = createDisposable(() => void searchStream.return?.(undefined!));

				search = await this.processSearchStream(searchStream, searchId, progressive, graph);

				if (search != null && searchId === this._searchIdCounter.current) {
					return {
						search: e.search,
						results: this.getSearchResultsData(search),
						partial: false,
						searchId: searchId,
					};
				}

				return {
					search: e.search,
					results: undefined,
					partial: false,
					searchId: searchId,
				};
			} finally {
				cancellation.dispose();
			}
		}

		let firstResultSelected = false;

		if (search?.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			if (this.repository == null) {
				return {
					search: e.search,
					results: { error: 'No repository' },
					partial: false,
					searchId: this._searchIdCounter.current,
				};
			}

			if (this.repository.etag !== this._etagRepository) {
				this.updateState(true);
			}

			// Increment search ID for new search
			const searchId = this._searchIdCounter.next();
			this._search = undefined;

			// Clear previous search results immediately
			void this.host.notify(DidSearchNotification, {
				search: e.search,
				results: undefined,
				partial: false,
				searchId: searchId,
			});

			const cancellation = this.createCancellation('search');

			try {
				const searchStream = this.repository.git.graph.searchGraph(
					e.search,
					{
						limit: configuration.get('graph.searchItemLimit') ?? 0,
						ordering: configuration.get('graph.commitOrdering'),
					},
					toAbortSignal(cancellation.token),
				);
				using _streamDisposer = createDisposable(() => void searchStream.return?.(undefined!));

				search = await this.processSearchStream(searchStream, searchId, progressive, graph, {
					selectFirstResult: true,
				});

				if (search == null) {
					if (searchId !== this._searchIdCounter.current) {
						// Search was superseded — return quietly with the original searchId
						// so the webview's searchId guard ignores this stale response
						return {
							search: e.search,
							results: undefined,
							partial: false,
							searchId: searchId,
						};
					}
					throw new Error('Search generator completed without returning a result');
				}
			} catch (ex) {
				if (searchId !== this._searchIdCounter.current) {
					// Search was superseded — return with the original (stale) searchId
					// so the webview's searchId guard ignores this response
					return {
						search: e.search,
						results: undefined,
						partial: false,
						searchId: searchId,
					};
				}
				this._search = undefined;
				throw ex;
			}

			// Only update _search if this search hasn't been superseded by a newer one
			if (searchId === this._searchIdCounter.current) {
				this._search = updateSearchMode(this.container, search);
			}
		} else {
			search = this._search!;

			// Select first result if not already selected (for cached searches)
			if (!firstResultSelected) {
				const firstResult = await this.ensureSearchStartsInRange(graph, search.results);
				if (firstResult != null) {
					this.setSelectedRows(firstResult);
					firstResultSelected = true;
				}
			}

			// Send notification with cached results (only if not superseded and not resuming)
			// When resuming (e.more), don't send cached results - let progressive notifications handle it
			if (this._searchIdCounter.current != null && progressive && !e.more) {
				// Use search.query to include any mode changes (filter toggle) that happened during the search
				void this.host.notify(DidSearchNotification, {
					search: search.query,
					results: this.getSearchResultsData(search) ?? {
						count: 0,
						hasMore: false,
						commitsLoaded: { count: 0 },
					},
					selectedRows: firstResultSelected ? convertSelectedRows(this._selectedRows) : undefined,
					partial: false,
					searchId: this._searchIdCounter.current,
				});
			}
		}

		return {
			search: search.query,
			results: this.getSearchResultsData(search) ?? { count: 0, hasMore: false, commitsLoaded: { count: 0 } },
			selectedRows: firstResultSelected ? convertSelectedRows(this._selectedRows) : undefined,
			partial: false, // Final results
			searchId: this._searchIdCounter.current,
		};
	}

	private async processSearchStream(
		searchStream: AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>,
		searchId: number,
		progressive: boolean,
		graph: GitGraph,
		options?: { selectFirstResult?: boolean },
	): Promise<GitGraphSearch | undefined> {
		let search: GitGraphSearch | undefined;
		let firstResultSelected = false;

		let result: IteratorResult<GitGraphSearchProgress, GitGraphSearch> | undefined;
		while (!(result = await searchStream.next()).done) {
			// Break out if search was cancelled or a new search started
			if (searchId !== this._searchIdCounter.current) break;

			const progress = result.value;
			if (!progress.results.size) continue;

			// Accumulate results from progressive batches
			if (search?.results != null) {
				for (const [sha, data] of progress.results) {
					search.results.set(sha, data);
				}

				search = {
					repoPath: search.repoPath,
					query: search.query,
					queryFilters: search.queryFilters,
					comparisonKey: search.comparisonKey,
					results: search.results,
					hasMore: progress.hasMore,
				};
			} else {
				search = {
					repoPath: progress.repoPath,
					query: progress.query,
					queryFilters: progress.queryFilters,
					comparisonKey: progress.comparisonKey,
					results: new Map(progress.results),
					hasMore: progress.hasMore,
				};
			}
			this._search = updateSearchMode(this.container, search);

			// Select first result as soon as we find one (only once)
			let selectedRows: GraphSelectedRows | undefined;
			if (options?.selectFirstResult && !firstResultSelected) {
				const firstResult = await this.ensureSearchStartsInRange(graph, progress.results);
				if (firstResult != null) {
					this.setSelectedRows(firstResult);
					selectedRows = convertSelectedRows(this._selectedRows);
					firstResultSelected = true;
				}
			}

			if (progressive) {
				// Send only the incremental batch to frontend (not all accumulated results)
				void this.host.notify(DidSearchNotification, {
					search: this._search.query,
					results: this.getSearchResultsData(progress),
					selectedRows: selectedRows,
					partial: true,
					searchId: searchId,
				});
			}
		}

		// Skip final result processing if this search has been superseded
		if (searchId !== this._searchIdCounter.current) {
			return search;
		}

		// Get final result from generator
		if (result?.value != null) {
			search = result.value;
			this._search = updateSearchMode(this.container, search);
			void (await this.ensureSearchStartsInRange(graph, search.results));

			// Send final notification with complete results
			if (progressive) {
				void this.host.notify(DidSearchNotification, {
					search: this._search.query,
					results: this.getSearchResultsData(search) ?? {
						count: 0,
						hasMore: false,
						commitsLoaded: { count: 0 },
					},
					selectedRows:
						options?.selectFirstResult && firstResultSelected
							? convertSelectedRows(this._selectedRows)
							: undefined,
					partial: false,
					searchId: searchId,
				});
			}
		}

		return search;
	}

	@ipcCommand(SearchOpenInViewCommand)
	private onSearchOpenInView(params: IpcParams<typeof SearchOpenInViewCommand>) {
		if (this.repository == null) return;

		void this.container.views.searchAndCompare.search(this.repository.path, params.search, {
			label: { label: `for ${params.search.query}` },
			reveal: { select: true, focus: false, expand: true },
		});
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
			'repository.closed': this.repository?.closed,
			'repository.folder.scheme': this.repository?.folder?.uri.scheme,
			'repository.provider.id': this.repository?.provider.id,
		});
	}

	@ipcRequest(ChooseRefRequest)
	private async onChooseRef(params: IpcParams<typeof ChooseRefRequest>) {
		if (this.repository == null) return undefined;

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

		let branch = find(this._graph!.branches.values(), b => b.current);
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
		const mergeBase = await this.resolveScopeMergeBaseForBranch(params.repoPath, params.scope.branchName);
		return { scope: { ...params.scope, mergeBase: mergeBase } };
	}

	private async resolveScopeMergeBaseForBranch(
		repoPath: string,
		branchName: string,
	): Promise<{ sha: string; date: number } | undefined> {
		const svc = this.container.git.getRepositoryService(repoPath);

		const branch = await svc.branches.getBranch(branchName);
		if (branch == null) return undefined;

		// Scope resolution is interactive (graph navigation drives it), so keep the default
		// 'normal' priority. The `branchOverviews` cache keyed on `${ref}|${mergeTarget}` handles
		// in-flight dedup against any concurrent enrichment fetch.
		const overview = await svc.branches.getBranchContributionsOverview(branch.ref, {
			associatedPullRequest: getBranchAssociatedPullRequest(this.container, branch),
		});
		if (overview?.mergeBase == null || overview.mergeBaseDate == null) return undefined;

		return { sha: overview.mergeBase, date: overview.mergeBaseDate.getTime() };
	}

	private _fireSelectionChangedDebounced: Deferrable<GraphWebviewProvider['fireSelectionChanged']> | undefined =
		undefined;
	private _lastUserSelectionTime: number = 0;

	@ipcCommand(UpdateSelectionCommand)
	private onSelectionChanged(params: IpcParams<typeof UpdateSelectionCommand>) {
		const item = params.selection.find(r => r.active) ?? params.selection[0];
		this.setSelectedRows(item?.id, params.selection, { selected: true, hidden: item?.hidden });

		// Track when user explicitly selects
		this._lastUserSelectionTime = performance.now();
		this._honorSelectedId = true;

		this._fireSelectionChangedDebounced ??= debounce(this.fireSelectionChanged.bind(this), 50);
		this._fireSelectionChangedDebounced(item?.id, item?.type);
	}

	private fireSelectionChanged(id: string | undefined, type: GitGraphRowType | undefined) {
		if (this.repository == null) return;

		const commit = this.getRevisionReference(this.repository.path, id, type);
		this._selection = commit != null ? [commit] : undefined;
	}

	private _notifyDidChangeStateDebounced: Deferrable<GraphWebviewProvider['notifyDidChangeState']> | undefined =
		undefined;

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

	@trace()
	private updateState(immediate: boolean = false) {
		this.host.clearPendingIpcNotifications();

		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		this._notifyDidChangeStateDebounced ??= debounce(this.notifyDidChangeState.bind(this), 250);
		void this._notifyDidChangeStateDebounced();
	}

	private _notifyDidChangeAvatarsDebounced: Deferrable<GraphWebviewProvider['notifyDidChangeAvatars']> | undefined =
		undefined;

	@trace()
	private updateAvatars(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeAvatars();
			return;
		}

		this._notifyDidChangeAvatarsDebounced ??= debounce(this.notifyDidChangeAvatars.bind(this), 100);
		void this._notifyDidChangeAvatarsDebounced();
	}

	@trace()
	private async notifyDidChangeAvatars() {
		if (this._graph == null) return;

		const data = this._graph;
		return this.host.notify(DidChangeAvatarsNotification, {
			avatars: Object.fromEntries(data.avatars),
		});
	}

	@trace()
	private async notifyDidChangeBranchState(branchState: BranchState) {
		return this.host.notify(DidChangeBranchStateNotification, {
			branchState: branchState,
		});
	}

	private _notifyDidChangeRefsMetadataDebounced:
		| Deferrable<GraphWebviewProvider['notifyDidChangeRefsMetadata']>
		| undefined = undefined;

	@trace()
	private updateRefsMetadata(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeRefsMetadata();
			return;
		}

		this._notifyDidChangeRefsMetadataDebounced ??= debounce(this.notifyDidChangeRefsMetadata.bind(this), 100);
		void this._notifyDidChangeRefsMetadataDebounced();
	}

	@trace()
	private async notifyDidChangeRefsMetadata() {
		return this.host.notify(DidChangeRefsMetadataNotification, {
			metadata: this._refsMetadata != null ? Object.fromEntries(this._refsMetadata) : this._refsMetadata,
		});
	}

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
			const filters = this.getFiltersByRepo(this._graph?.repoPath);
			params = { pinnedRef: this.getPinnedRef(filters, this._graph) };
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
			const filters = this.getFiltersByRepo(this._graph?.repoPath);
			params = {
				branchesVisibility: this.getBranchesVisibility(filters),
				excludeRefs: this.getExcludedRefs(filters, this._graph) ?? {},
				excludeTypes: this.getExcludedTypes(filters) ?? {},
				includeOnlyRefs: undefined,
			};

			if (params?.includeOnlyRefs == null) {
				const includedRefsResult = await this.getIncludedRefs(filters, this._graph, { timeout: 100 });
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

	@trace()
	private async notifyDidFetch() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidFetchNotification, this._ipcNotificationMap, this);
			return false;
		}

		const lastFetched = await this.repository!.getLastFetched();
		return this.host.notify(DidFetchNotification, {
			lastFetched: new Date(lastFetched),
		});
	}

	private getSearchResultsData(
		search: GitGraphSearch | GitGraphSearchProgress | undefined,
	): GraphSearchResults | undefined {
		if (!search?.results?.size) return undefined;

		// Count the commits for these search results that are loaded in the graph
		const commitsLoaded: { count: number } = { count: 0 };
		if (this._graph?.ids != null) {
			for (const sha of search.results.keys()) {
				if (this._graph.ids.has(sha)) {
					commitsLoaded.count++;
				}
			}
		}

		return {
			ids: Object.fromEntries(search.results),
			count: search.results.size,
			hasMore: search.hasMore,
			commitsLoaded: commitsLoaded,
		};
	}

	@trace()
	private async notifyDidChangeRows(sendSelectedRows: boolean = false, completionId?: string) {
		if (this._graph == null) return;

		const graph = this._graph;

		return this.host.notify(
			DidChangeRowsNotification,
			{
				rows: graph.rows,
				avatars: Object.fromEntries(graph.avatars),
				downstreams: Object.fromEntries(graph.downstreams),
				refsMetadata: this._refsMetadata != null ? Object.fromEntries(this._refsMetadata) : this._refsMetadata,
				rowsStats: graph.rowsStats?.size ? Object.fromEntries(graph.rowsStats) : undefined,
				rowsStatsLoading:
					graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,

				search: this._search?.results?.size
					? {
							search: this._search.query,
							results: this.getSearchResultsData(this._search),
							partial: false,
							searchId: this._searchIdCounter.current,
						}
					: undefined,
				selectedRows: sendSelectedRows ? convertSelectedRows(this._selectedRows) : undefined,
				paging: {
					startingCursor: graph.paging?.startingCursor,
					hasMore: graph.paging?.hasMore ?? false,
				},
			},
			completionId,
		);
	}

	@trace({ args: false })
	private async notifyDidChangeRowsStats(graph: GitGraph) {
		if (graph.rowsStats == null) return;

		return this.host.notify(DidChangeRowsStatsNotification, {
			rowsStats: Object.fromEntries(graph.rowsStats),
			rowsStatsLoading: graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,
		});
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

	private computeWorktreeChanges(worktrees: Parameters<typeof getWorktreeHasWorkingChanges>[1][]) {
		if (this._computeWorktreeChangesPromise != null) {
			this._pendingWorktreeChanges = worktrees;
			return;
		}

		this._computeWorktreeChangesPromise = this.doComputeWorktreeChanges(worktrees).finally(() => {
			this._computeWorktreeChangesPromise = undefined;
			const pending = this._pendingWorktreeChanges;
			this._pendingWorktreeChanges = undefined;
			if (pending != null) {
				this.computeWorktreeChanges(pending);
			}
		});
	}

	private async doComputeWorktreeChanges(worktrees: Parameters<typeof getWorktreeHasWorkingChanges>[1][]) {
		try {
			const results = await Promise.allSettled(
				worktrees.map(async w => {
					const hasChanges = await getWorktreeHasWorkingChanges(this.container, w);
					return [w.uri.fsPath, hasChanges] as const;
				}),
			);

			const changes: Record<string, boolean | undefined> = {};
			for (const result of results) {
				if (result.status === 'fulfilled') {
					changes[result.value[0]] = result.value[1];
				}
			}

			this._sidebarWorktreeEvent.fire({ changes: changes });
		} catch {
			// Ignore — non-critical async enhancement
		}
	}

	@trace()
	private notifySidebarInvalidated() {
		this._sidebarInvalidatedEvent.fire(undefined);
	}

	/**
	 * Coalesces concurrent triggers into a single in-flight call, with a trailing-edge re-fire when
	 * more triggers arrive while one is running. Crucially does NOT cancel the in-flight call —
	 * cancelling a `git status` mid-flight would let the underlying fetch return undefined, the
	 * caller would fall back to all-zero stats, and that fallback would poison
	 * `_lastSentWorkingTreeStats` so subsequent legitimate updates (e.g. file change after a
	 * branch-compare burst) get dedup'd away. The previous `createCancellation('workingTree')`
	 * pattern was the source of that storm.
	 */
	private _wipNotifyInFlight?: Promise<boolean>;
	private _wipNotifyDirty = false;

	private notifyDidChangeWorkingTree(hasWorkingChanges?: boolean): Promise<boolean> {
		if (this._wipNotifyInFlight != null) {
			this._wipNotifyDirty = true;
			return this._wipNotifyInFlight;
		}
		const run = this.runNotifyDidChangeWorkingTree(hasWorkingChanges).finally(() => {
			this._wipNotifyInFlight = undefined;
			if (this._wipNotifyDirty) {
				this._wipNotifyDirty = false;
				// Trailing run uses no caller hint — it'll re-query `hasWorkingChanges` itself.
				void this.notifyDidChangeWorkingTree();
			}
		});
		this._wipNotifyInFlight = run;
		return run;
	}

	@trace()
	private async runNotifyDidChangeWorkingTree(hasWorkingChanges?: boolean): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeWorkingTreeNotification, this._ipcNotificationMap, this);
			return false;
		}

		const [stats, wipMetadataBySha, stagedCount] = await Promise.all([
			this.getWorkingTreeStatsAndPausedOperations(hasWorkingChanges),
			this.getWipMetadataBySha(),
			this.getStagedFileCount(),
		]);

		// `stats === undefined` means the underlying `git status`/`hasWorkingChanges` fetch could
		// not produce meaningful data (cancelled or hard-errored). Returning early here — without
		// updating `_lastSentWorkingTreeStats` — leaves the dedup cache untouched so the next
		// successful run pushes the truth. Falling back to all-zero stats (the previous behavior)
		// is what poisoned the cache.
		if (stats === undefined) return false;

		// Skip the notification (and the cascading overview WIP notification) when nothing actually changed.
		// Repository change/FS watcher events fire on any git activity, not just stat-affecting changes, so
		// without this the webview re-renders on every unrelated git config/branch/stash tick.
		// We include `stagedCount` separately because moving a file from unstaged → staged (or
		// vice versa, e.g. via VS Code's SCM panel) doesn't change the added/deleted/modified
		// totals — the dedup would otherwise drop those notifications and leave the WIP file
		// list stale until something else perturbs the watcher.
		if (
			this._lastSentWorkingTreeStats !== undefined &&
			areEqual(stats, this._lastSentWorkingTreeStats) &&
			areEqual(wipMetadataBySha, this._lastSentWipMetadataBySha) &&
			stagedCount === this._lastSentStagedCount
		) {
			return false;
		}

		this._lastSentWorkingTreeStats = stats;
		this._lastSentWipMetadataBySha = wipMetadataBySha;
		this._lastSentStagedCount = stagedCount;

		const result = this.host.notify(DidChangeWorkingTreeNotification, {
			stats: stats,
			wipMetadataBySha: wipMetadataBySha,
		});

		// Also push WIP updates for overview branches — only when the primary repo actually changed.
		void this.notifyDidChangeOverviewWip();

		return result;
	}

	private async notifyDidChangeOverviewWip() {
		if (!this.host.ready || !this.host.visible) return;
		if (this._graph == null) return;

		const worktreesByBranch = this._graph.worktreesByBranch ?? new Map();
		const branchIds: string[] = [];
		for (const branch of this._graph.branches.values()) {
			if (branch.remote) continue;
			if (branch.current || worktreesByBranch.get(branch.id)?.opened) {
				branchIds.push(branch.id);
			}
		}
		if (branchIds.length === 0) return;

		const wip = await this.onGetOverviewWip({ branchIds: branchIds });

		void this.host.notify(DidChangeOverviewWipNotification, { wip: wip });
	}

	@trace()
	private async notifyDidChangeOverview() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeOverviewNotification, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeOverviewNotification, {
			overview: this.getOverviewData(),
		});
	}

	private getOverviewData(): GraphOverviewData {
		const active: GraphOverviewData['active'] = [];
		const recent: GraphOverviewData['recent'] = [];

		if (this._graph == null || this.repository == null) {
			return { active: active, recent: recent };
		}

		const data = this._graph;
		const worktreesByBranch = data.worktreesByBranch ?? new Map();

		for (const branch of data.branches.values()) {
			if (branch.remote) continue;

			const branchType = getBranchOverviewType(branch, worktreesByBranch, 'OneWeek', 'OneYear');
			switch (branchType) {
				case 'active':
					active.push(toOverviewBranch(branch, worktreesByBranch, true));
					break;
				case 'recent':
					recent.push(toOverviewBranch(branch, worktreesByBranch, false));
					break;
			}
		}

		recent.sort((a, b) => (b.timestamp ?? -1) - (a.timestamp ?? -1));

		return { active: active, recent: recent };
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

	@trace()
	private async notifyDidChangeCanInstallClaudeHook() {
		const canInstall = getContext('gitlens:agents:enabled', false) && (await isClaudeAvailable());
		void this.host.notify(DidChangeCanInstallClaudeHook, canInstall);
	}

	@trace()
	private async notifyDidChangeState(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeNotification, this._ipcNotificationMap, this);
			return false;
		}

		// Coalesce: if a notify is already in flight, piggyback on it.
		if (this._pendingStateNotify != null) return this._pendingStateNotify;

		// If bootstrap (or another op) is building state right now, wait for it — afterwards the freshness
		// check below will skip the redundant work. Handles repo-change events firing during bootstrap.
		if (this._pendingStateOp != null) {
			await this._pendingStateOp.catch(() => undefined);
		}

		// Within the freshness window: defer rather than drop. A trailing flush at the window boundary
		// coalesces the rapid-fire notifies that follow bootstrap or repo subscription wiring, so legitimate
		// changes that land during the window aren't silently lost.
		if (this._lastStateSentAt != null) {
			const elapsed = performance.now() - this._lastStateSentAt;
			if (elapsed < GraphWebviewProvider.stateFreshnessMs) {
				this._stateFreshnessRetryTimer ??= setTimeout(() => {
					this._stateFreshnessRetryTimer = undefined;
					void this.notifyDidChangeState();
				}, GraphWebviewProvider.stateFreshnessMs - elapsed);
				return false;
			}
		}

		if (this._stateFreshnessRetryTimer != null) {
			clearTimeout(this._stateFreshnessRetryTimer);
			this._stateFreshnessRetryTimer = undefined;
		}
		this._notifyDidChangeStateDebounced?.cancel();

		const promise = (async () => {
			try {
				const op = this.getState();
				this._pendingStateOp = op;
				const state = await op;

				// Sidebar invalidation is intentionally NOT fired here — firing on every state notify causes
				// the sidebar to reset its counts + show a spinner on unrelated repo activity (e.g. new worktrees
				// discovered during graph scroll). The sidebar's counts/panels only need refreshing when
				// branches/remotes/tags/stashes actually change, which is handled by targeted invalidations in
				// `onRepositoryChanged` and the cold-open microtask.

				const result = await this.host.notify(DidChangeNotification, { state: state });
				this._lastStateSentAt = performance.now();
				return result;
			} finally {
				this._pendingStateNotify = undefined;
				this._pendingStateOp = undefined;
			}
		})();
		this._pendingStateNotify = promise;
		return promise;
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

		this._repositoryEventsDisposable = Disposable.from(
			repo.onDidChange(this.onRepositoryChanged, this),
			repo.watchWorkingTree(500),
			repo.onDidChangeWorkingTree(this.onRepositoryWorkingTreeChanged, this),
			onDidChangeContext(key => {
				if (key !== 'gitlens:repos:withHostingIntegrationsConnected') return;

				this.resetRefsMetadata();
				this.updateRefsMetadata();
			}),
		);
	}

	private onIntegrationConnectionChanged(e: ConnectionStateChangeEvent) {
		// If we're still discovering repositories, we'll update the view once discovery is complete
		if (this._discovering) return;

		void this.notifyDidChangeRepoConnection();

		// If an issue integration connected/disconnected, update metadata state
		if (supportedOrderedCloudIssuesIntegrationIds.includes(e.key as IssuesCloudHostIntegrationId)) {
			void this.onIssueIntegrationConnectionChanged(e.reason === 'connected');
		}
	}

	private async onIssueIntegrationConnectionChanged(connected: boolean) {
		if (connected) {
			this._issueIntegrationConnectionState = 'connected';
		} else {
			// Recheck since another issue integration might still be connected
			await this.checkIssueIntegrations();
		}

		this.resetRefsMetadata();
		this.updateRefsMetadata();
	}

	private async checkIssueIntegrations(): Promise<boolean> {
		const results = await Promise.allSettled(
			supportedOrderedCloudIssuesIntegrationIds.map(async id => {
				const integration = await this.container.integrations.get(id);
				return integration?.maybeConnected ?? (await integration?.isConnected()) ?? false;
			}),
		);
		const connected = results.map(r => (r.status === 'fulfilled' ? r.value : false));
		this._issueIntegrationConnectionState = connected.some(Boolean) ? 'connected' : 'not-connected';
		return this._issueIntegrationConnectionState === 'connected';
	}

	private async notifyDidChangeRepoConnection() {
		void this.host.notify(DidChangeRepoConnectionNotification, {
			repositories: await this.getRepositoriesState(),
		});
	}

	private async getRepositoriesState(): Promise<GraphRepository[]> {
		return formatRepositories(this.container.git.openRepositories);
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

	private async ensureSearchStartsInRange(graph: GitGraph, results: GitGraphSearchResults) {
		if (!results.size) return undefined;

		// If we have a selection and it is in the search results, keep it
		if (this._selectedId != null && results.has(this._selectedId)) {
			if (graph.ids.has(this._selectedId)) {
				return this._selectedId;
			}
		}

		// Find the first result that is in the graph
		let firstResult: string | undefined;
		for (const id of results.keys()) {
			if (graph.ids.has(id)) return id;

			firstResult = id;
			break;
		}

		if (firstResult == null) return undefined;

		await this.updateGraphWithMoreRows(graph, firstResult);
		void this.notifyDidChangeRows();

		return graph.ids.has(firstResult) ? firstResult : undefined;
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
			avatars: configuration.get('graph.avatars'),
			dateFormat:
				configuration.get('graph.dateFormat') ?? configuration.get('defaultDateFormat') ?? 'short+short',
			dateStyle: configuration.get('graph.dateStyle') ?? configuration.get('defaultDateStyle'),
			detailsLocation: configuration.get('graph.details.location') ?? 'right',
			enabledRefMetadataTypes: this.getEnabledRefMetadataTypes(),
			dimMergeCommits: configuration.get('graph.dimMergeCommits'),
			experimentalFeaturesEnabled: configuration.get('graph.experimentalFeatures.enabled'),
			highlightRowsOnRefHover: configuration.get('graph.highlightRowsOnRefHover'),
			idLength: configuration.get('advanced.abbreviatedShaLength'),
			minimap: configuration.get('graph.minimap.enabled'),
			minimapDataType: configuration.get('graph.minimap.dataType'),
			minimapMarkerTypes: this.getMinimapMarkerTypes(),
			minimapReversed: configuration.get('graph.minimap.reversed'),
			multiSelectionMode: configuration.get('graph.multiselect'),
			onlyFollowFirstParent: configuration.get('graph.onlyFollowFirstParent'),
			scrollRowPadding: configuration.get('graph.scrollRowPadding'),
			scrollMarkerTypes: this.getScrollMarkerTypes(),
			showGhostRefsOnRowHover: configuration.get('graph.showGhostRefsOnRowHover'),
			showRemoteNamesOnRefs: configuration.get('graph.showRemoteNames'),
			showWorktreeWipStats: configuration.get('graph.showWorktreeWipStats'),
			sidebar: configuration.get('graph.sidebar.enabled') ?? true,
			sidebarPinned: configuration.get('graph.sidebar.pinned') ?? true,
			stickyTimeline: configuration.get('graph.stickyTimeline'),
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

	private getEnabledRefMetadataTypes(): GraphRefMetadataType[] {
		const types: GraphRefMetadataType[] = [];

		if (configuration.get('graph.issues.enabled')) {
			types.push('issue');
		}

		if (configuration.get('graph.pullRequests.enabled')) {
			types.push('pullRequest');
		}

		if (configuration.get('graph.showUpstreamStatus')) {
			types.push('upstream');
		}

		return types;
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

	private async getWipMetadataBySha(cancellation?: CancellationToken): Promise<GraphWipMetadataBySha | undefined> {
		if (this.repository == null) return undefined;

		const worktrees = await this.repository.git.worktrees?.getWorktrees(toAbortSignal(cancellation));
		if (worktrees == null || worktrees.length === 0) return undefined;

		// All known worktrees other than the primary (which is already covered by workingTreeStats).
		// Emit row-anchor metadata only; workDirStats are fetched on-demand via GetWipStatsRequest
		// when the GK component fires onWipShasMissingStats for visible rows.
		const result: GraphWipMetadataBySha = {};
		for (const wt of worktrees) {
			if (wt.type === 'bare' || wt.sha == null) continue;
			if (wt.path === this.repository.path) continue;

			result[makeSecondaryWipSha(wt.path)] = {
				repoPath: wt.path,
				parentSha: wt.sha,
				label: wt.name,
			};
		}

		return Object.keys(result).length > 0 ? result : undefined;
	}

	/**
	 * Returns the count of staged files in the primary repo, used by `notifyDidChangeWorkingTree`
	 * to detect SCM-driven stage/unstage changes that don't shift the added/deleted/modified
	 * totals. Mixed files (path appears in both staged and unstaged) count once for staged.
	 */
	private async getStagedFileCount(cancellation?: CancellationToken): Promise<number> {
		if (this.repository == null) return 0;
		const svc = this.container.git.getRepositoryService(this.repository.path);
		const status = await svc.status.getStatus(undefined, toAbortSignal(cancellation));
		if (status?.files == null) return 0;
		const stagedPaths = new Set<string>();
		for (const f of status.files) {
			if (f.staged) {
				stagedPaths.add(f.path);
			}
		}
		return stagedPaths.size;
	}

	private async getWorkingTreeStatsAndPausedOperations(
		hasWorkingChanges?: boolean,
		cancellation?: CancellationToken,
	): Promise<GraphWorkingTreeStats | undefined> {
		if (this.repository == null || !this.container.git.repositoryCount) return undefined;

		const svc = this.container.git.getRepositoryService(this.repository.path);

		try {
			hasWorkingChanges ??= await svc.status.hasWorkingChanges(
				{ staged: true, unstaged: true, untracked: true },
				toAbortSignal(cancellation),
			);
		} catch {
			// Cancellation or hard failure — surface as undefined so callers don't poison their
			// dedup cache with all-zero fallback values, which would silently swallow future updates.
			return undefined;
		}

		if (cancellation?.isCancellationRequested) return undefined;

		const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
			hasWorkingChanges ? svc.status.getStatus(undefined, toAbortSignal(cancellation)) : undefined,
			svc.pausedOps?.getPausedOperationStatus?.(toAbortSignal(cancellation)),
		]);

		if (cancellation?.isCancellationRequested) return undefined;

		// If we expected status data (working changes detected) but the fetch failed/was cancelled,
		// return undefined for the same dedup-poisoning reason. Resolved "no working changes"
		// still produces a real zero-stats payload — that case is correct.
		if (hasWorkingChanges && statusResult.status === 'rejected') return undefined;

		const status = getSettledValue(statusResult);
		const workingTreeStatus = status?.diffStatus;
		const pausedOpStatus = getSettledValue(pausedOpStatusResult);

		return {
			added: workingTreeStatus?.added ?? 0,
			deleted: workingTreeStatus?.deleted ?? 0,
			modified: workingTreeStatus?.changed ?? 0,
			hasConflicts: status?.hasConflicts,
			pausedOpStatus: pausedOpStatus,
			context: serializeWebviewItemContext<GraphItemContext>({
				webviewItem: 'gitlens:wip',
				webviewItemValue: {
					type: 'commit',
					ref: this.getRevisionReference(this.repository.path, uncommitted, 'work-dir-changes')!,
				},
			}),
		};
	}

	private async getState(deferRows?: boolean): Promise<State> {
		this.cancelOperation('branchState');
		this.cancelOperation('state');

		const searchRequest = this._searchRequest;
		this._searchRequest = undefined;

		if (this.container.git.repositoryCount === 0) {
			return { ...this.host.baseWebviewState, allowed: true, repositories: [] };
		}

		if (this.repository == null) {
			this.repository = this.container.git.getBestRepositoryOrFirst();
			if (this.repository == null) {
				return { ...this.host.baseWebviewState, allowed: true, repositories: [] };
			}
		}

		const cancellation = this.createCancellation('state');

		this._etagRepository = this.repository?.etag;
		this.host.title = `${this.host.originalTitle}: ${this.repository.name}`;

		const { defaultItemLimit } = configuration.get('graph');

		// If we have a set of data refresh to the same set
		const limit = Math.max(defaultItemLimit, this._graph?.ids.size ?? defaultItemLimit);

		const hasWorkingChanges = await this.repository.git.status.hasWorkingChanges(
			{ staged: true, unstaged: true, untracked: true },
			toAbortSignal(cancellation.token),
		);

		let selectedId = this._selectedId;
		let selectionChanged = false;

		// Skip default row selection if we are honoring the selected id or we have a pending search request
		// to avoid overriding an honored selection or jumping to WIP/HEAD before the search is applied
		if (
			!this._honorSelectedId &&
			searchRequest == null &&
			selectedId !== uncommitted &&
			hasWorkingChanges &&
			configuration.get('graph.initialRowSelection') === 'wip'
		) {
			selectionChanged = true;

			this.setSelectedRows(uncommitted);
			selectedId = this._selectedId;
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);

		const dataPromise = this.repository.git.graph.getGraph(
			selectedId,
			{
				include: {
					stats:
						(configuration.get('graph.minimap.enabled') &&
							configuration.get('graph.minimap.dataType') === 'lines' &&
							this.isMinimapVisible()) ||
						!columnSettings.changes.isHidden,
				},
				limit: limit,
				rowProcessor: this.graphRowProcessor,
			},
			toAbortSignal(cancellation.token),
		);
		this._graphLoading = dataPromise;

		// Check for access and working tree stats
		const promises = Promise.allSettled([
			this.getGraphAccess(),
			this.getWorkingTreeStatsAndPausedOperations(hasWorkingChanges, cancellation.token),
			this.repository.git.branches.getBranch(undefined, toAbortSignal(cancellation.token)),
			this.repository.getLastFetched(),
			this.getWipMetadataBySha(cancellation.token),
		]);

		let data;
		if (deferRows) {
			queueMicrotask(async () => {
				try {
					const data = await dataPromise;
					if (cancellation.token.isCancellationRequested || this._graphLoading !== dataPromise) return;

					this.setGraph(data);

					// Don't override selection if user selected something in the last 500ms
					const userRecentlySelected = performance.now() - this._lastUserSelectionTime < 500;
					if (!userRecentlySelected && this._selectedId !== data.id) {
						selectionChanged = true;
						this.setSelectedRows(data.id);
					}

					void this.notifyDidChangeRefsVisibility();
					void this.notifyDidChangeRows(selectionChanged);
					this.notifySidebarInvalidated();
				} catch {}
			});
		} else {
			data = await dataPromise;
			this.setGraph(data);

			if (selectedId !== data.id) {
				this.setSelectedRows(data.id);
			}
		}

		const [accessResult, workingStatsResult, branchResult, lastFetchedResult, wipMetadataResult] = await promises;
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
					const updatedBranchState = { ...branchState };
					void maybePr.value.then(pr => {
						if (branchStateCancellation?.token.isCancellationRequested) return;

						if (pr != null) {
							updatedBranchState.pr = serializePullRequest(pr);
							void this.notifyDidChangeBranchState(updatedBranchState);
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

		// Resolve working tree stats outside the state literal so we can update the dedup cache
		// only when the underlying fetch produced real data. If it returned undefined (cancelled/
		// failed), we still send fallback zeros to the webview so the UI has a value, but we leave
		// `_lastSentWorkingTreeStats` untouched so the next `notifyDidChangeWorkingTree` is free
		// to push an authoritative update without being dedup'd against a fake zero.
		const resolvedWorkingTreeStats = getSettledValue(workingStatsResult);
		if (resolvedWorkingTreeStats !== undefined) {
			this._lastSentWorkingTreeStats = resolvedWorkingTreeStats;
		}

		const result: State = {
			...this.host.baseWebviewState,
			webroot: this.host.getWebRoot(),
			windowFocused: this.isWindowFocused,
			repositories: await formatRepositories(this.container.git.openRepositories),
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
			allowed: this.isGraphAccessAllowed(access, featurePreview), //(access?.allowed ?? false) !== false,
			avatars: data != null ? Object.fromEntries(data.avatars) : undefined,
			refsMetadata: this.resetRefsMetadata() === null ? null : {},
			loading: deferRows === true,
			rowsStatsLoading: data?.rowsStatsDeferred?.isLoaded != null ? !data.rowsStatsDeferred.isLoaded() : false,
			rows: data?.rows,
			downstreams: data != null ? Object.fromEntries(data.downstreams) : undefined,
			paging:
				data != null
					? {
							startingCursor: data.paging?.startingCursor,
							hasMore: data.paging?.hasMore ?? false,
						}
					: undefined,
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
			workingTreeStats: resolvedWorkingTreeStats ?? { added: 0, deleted: 0, modified: 0 },
			wipMetadataBySha: (this._lastSentWipMetadataBySha = getSettledValue(wipMetadataResult)),
			searchMode: searchMode,
			useNaturalLanguageSearch: useNaturalLanguageSearch,
			featurePreview: featurePreview,
			orgSettings: this.getOrgSettings(),
			overview: this.getOverviewData(),
			mcpBannerCollapsed: this.getMcpBannerCollapsed(),
			hooksBannerCollapsed: this.getHooksBannerCollapsed(),
			canInstallClaudeHook: getContext('gitlens:agents:enabled', false) && (await isClaudeAvailable()),
			searchRequest: searchRequest,
			detailsVisible: storedPanels?.details?.visible ?? true,
			detailsPosition: storedPanels?.details?.position,
			detailsBottomPosition: storedPanels?.details?.bottomPosition,
			sidebarVisible: storedPanels?.sidebar?.visible ?? true,
			activeSidebarPanel: storedPanels?.sidebar?.activePanel,
			sidebarPosition: storedPanels?.sidebar?.position,
			minimapVisible: storedPanels?.minimap?.visible ?? true,
			minimapPosition: storedPanels?.minimap?.position,
			timelinePeriod: storedGraphState?.timeline?.period,
			timelineSliceBy: storedGraphState?.timeline?.sliceBy,
			timelineShowAllBranches: storedGraphState?.timeline?.showAllBranches,
		};
		return result;
	}

	private updateColumns(columnsCfg: GraphColumnsConfig) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		for (const [key, value] of Object.entries(columnsCfg)) {
			columns = updateRecordValue(columns, key, value);
		}
		void this.container.storage.storeWorkspace('graph:columns', columns).catch();
		void this.notifyDidChangeColumns();
	}

	// Reset columns wrappers
	@command('gitlens.graph.resetColumnsDefault')
	private resetColumnsDefault() {
		this.updateColumns(defaultGraphColumnsSettings);
	}
	@command('gitlens.graph.resetColumnsCompact')
	private resetColumnsCompact() {
		this.updateColumns(compactGraphColumnsSettings);
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
		this.updateState();
	}

	private updateFiltersByRepo(repoPath: string | undefined, updates: Partial<StoredGraphFilters>) {
		if (repoPath == null) return;

		const filtersByRepo = this.container.storage.getWorkspace('graph:filtersByRepo');
		return this.container.storage.storeWorkspace(
			'graph:filtersByRepo',
			updateRecordValue(filtersByRepo, repoPath, { ...filtersByRepo?.[repoPath], ...updates }),
		);
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
		this.updateIncludeOnlyRefs(this._graph?.repoPath, params);
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
		this.updateExcludedTypes(this._graph?.repoPath, params);
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
		this.resetFilters(this._graph?.repoPath);
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

	private resetRefsMetadata(): null | undefined {
		this._refsMetadata =
			getContext('gitlens:repos:withHostingIntegrationsConnected') ||
			this._issueIntegrationConnectionState !== 'not-connected'
				? undefined
				: null;
		return this._refsMetadata;
	}

	private resetRepositoryState() {
		this._honorSelectedId = false;
		this._getBranchesAndTagsTips = undefined;
		this._searchHistory = undefined;
		this._lastSentWorkingTreeStats = undefined;
		this._lastSentWipMetadataBySha = undefined;
		this._lastSentStagedCount = undefined;
		this._lastStateSentAt = undefined;
		this._pendingStateNotify = undefined;
		this._pendingStateOp = undefined;
		this._graphDetailsDiffCache.clear();
		if (this._stateFreshnessRetryTimer != null) {
			clearTimeout(this._stateFreshnessRetryTimer);
			this._stateFreshnessRetryTimer = undefined;
		}
		this.setGraph(undefined);
		this.setSelectedRows(undefined);
	}

	private resetSearchState() {
		this._search = undefined;
		this.cancelOperation('search');
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

	private setGraph(graph: GitGraph | undefined) {
		this._graph = graph;
		if (graph == null) {
			this._graphLoading = undefined;
			this.resetHoverCache();
			this.resetRefsMetadata();
			this.resetSearchState();
			this.cancelOperation('computeIncludedRefs');
		} else {
			void graph.rowsStatsDeferred?.promise.then(() => {
				if (this._graph !== graph) return;
				void this.notifyDidChangeRowsStats(graph);
			});
			void this.notifyDidChangeOverview();
		}
	}

	private _pendingRowsQuery:
		| {
				promise: Promise<void>;
				cancellable: CancellationTokenSource;
				id?: string | undefined;
				search?: GitGraphSearch;
		  }
		| undefined;
	private async updateGraphWithMoreRows(
		graph: GitGraph,
		id: string | undefined,
		search?: GitGraphSearch,
		limitOverride?: number,
	) {
		if (this._pendingRowsQuery != null) {
			const { id: pendingId, search: pendingSearch } = this._pendingRowsQuery;
			if (pendingSearch === search && (pendingId === id || (pendingId != null && id == null))) {
				return this._pendingRowsQuery.promise;
			}

			this._pendingRowsQuery.cancellable.cancel();
			this._pendingRowsQuery.cancellable.dispose();
			this._pendingRowsQuery = undefined;
		}

		const sw = new Stopwatch(undefined);

		const cancellable = new CancellationTokenSource();
		const cancellation = cancellable.token;

		this._pendingRowsQuery = {
			promise: this.updateGraphWithMoreRowsCore(graph, id, search, cancellation, limitOverride).catch(
				(ex: unknown) => {
					if (cancellation.isCancellationRequested) return;

					throw ex;
				},
			),
			cancellable: cancellable,
			id: id,
			search: search,
		};

		void this._pendingRowsQuery.promise.finally(() => {
			if (cancellation.isCancellationRequested) return;

			this.host.sendTelemetryEvent('graph/rows/loaded', {
				duration: sw.elapsed(),
				rows: graph.rows.length ?? 0,
			});
			sw.stop();

			this._pendingRowsQuery = undefined;
		});

		return this._pendingRowsQuery.promise;
	}

	private async updateGraphWithMoreRowsCore(
		graph: GitGraph,
		id: string | undefined,
		search?: GitGraphSearch,
		cancellation?: CancellationToken,
		limitOverride?: number,
	) {
		const { defaultItemLimit, pageItemLimit } = configuration.get('graph');

		let limit = limitOverride ?? pageItemLimit ?? defaultItemLimit;
		let targetId = id;

		// Determine the last search result (for auto-loading more search results)
		const lastSearchResultId = search?.results.size ? last(search.results.keys()) : undefined;

		if (!id && search?.results.size) {
			// If there are a small number of results and we're filtering, load them all at once
			if (search.results.size < 50 && search.query.filter) {
				targetId = lastSearchResultId;
				limit = 0;
			} else {
				// Determine the next unloaded search result (if any)
				const nextUnloadedResultId = search?.results.size
					? find(search.results.keys(), sha => !graph.ids.has(sha))
					: undefined;
				targetId = nextUnloadedResultId;
			}
		}

		const updatedGraph = await graph.more?.(limit, targetId, toAbortSignal(cancellation));
		if (updatedGraph != null) {
			this.setGraph(updatedGraph);

			if (!search?.hasMore || lastSearchResultId == null) return;

			if (updatedGraph.ids.has(lastSearchResultId)) {
				// Auto-load more search results in the background
				// Suppress notifications - notifyDidChangeRows will send both
				// the search results AND the rows together to avoid race conditions
				try {
					await this.searchGraphOrContinue({ search: search.query, more: true }, false);
					// Search results are now updated in this._search
					// notifyDidChangeRows() will send them along with the rows
				} catch (ex) {
					if (isCancellationError(ex)) return;

					// Only send error notifications immediately
					void this.host.notify(DidSearchNotification, {
						search: search.query,
						results: {
							error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error',
						},
						partial: false,
						searchId: this._searchIdCounter.current,
					});
				}
			}
		} else {
			debugger;
		}
	}

	@command('gitlens.fetch:')
	@debug()
	private async fetch(item?: GraphItemContext | BranchRef) {
		if (item != null && 'branchId' in item) {
			await branchRefCommands.fetchBranch(this.container, item);
			return;
		}
		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.fetch(this.repository, ref);
	}

	@command('gitlens.git.branch.setMergeTarget:')
	@debug()
	private changeBranchMergeTarget(ref: BranchAndTargetRefs) {
		branchRefCommands.changeBranchMergeTarget(ref);
	}

	@command('gitlens.mergeIntoCurrent:')
	@debug()
	private async mergeIntoCurrent(ref: BranchRef) {
		await branchRefCommands.mergeIntoCurrent(this.container, ref);
	}

	@command('gitlens.rebaseCurrentOnto:')
	@debug()
	private async rebaseCurrentOnto(ref: BranchRef) {
		await branchRefCommands.rebaseCurrentOnto(this.container, ref);
	}

	@command('gitlens.pushBranch:')
	@debug()
	private async pushBranch(ref: BranchRef) {
		await branchRefCommands.pushBranch(this.container, ref);
	}

	@command('gitlens.openMergeTargetComparison:')
	@debug()
	private openMergeTargetComparison(ref: BranchAndTargetRefs) {
		return branchRefCommands.openMergeTargetComparison(this.container, ref);
	}

	@command('gitlens.deleteBranchOrWorktree:')
	@debug()
	private async deleteBranchOrWorktree(ref: BranchRef, mergeTarget?: BranchRef) {
		await branchRefCommands.deleteBranchOrWorktree(this.container, ref, mergeTarget);
	}

	@command('gitlens.fetchRemote:')
	@debug()
	private fetchRemote(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;
		void RemoteActions.fetch(item.webviewItemValue.repoPath, item.webviewItemValue.name);
	}

	@command('gitlens.pruneRemote:')
	@debug()
	private pruneRemote(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;
		void RemoteActions.prune(item.webviewItemValue.repoPath, item.webviewItemValue.name);
	}

	@command('gitlens.removeRemote:')
	@debug()
	private removeRemote(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;
		void RemoteActions.remove(item.webviewItemValue.repoPath, item.webviewItemValue.name);
	}

	@command('gitlens.openRepoOnRemote:')
	@debug()
	private openRepoOnRemoteFromGraph(item?: GraphItemContext, clipboard?: boolean) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: item.webviewItemValue.repoPath,
			resource: { type: RemoteResourceType.Repo },
			remote: item.webviewItemValue.name,
			clipboard: clipboard,
		});
	}

	@command('gitlens.copyRemoteRepositoryUrl:')
	private copyRemoteRepositoryUrl(item?: GraphItemContext) {
		return this.openRepoOnRemoteFromGraph(item, true);
	}

	@command('gitlens.openBranchesOnRemote:')
	@debug()
	private openBranchesOnRemoteFromGraph(item?: GraphItemContext, clipboard?: boolean) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: item.webviewItemValue.repoPath,
			resource: { type: RemoteResourceType.Branches },
			remote: item.webviewItemValue.name,
			clipboard: clipboard,
		});
	}

	@command('gitlens.copyRemoteBranchesUrl:')
	private copyRemoteBranchesUrlFromGraph(item?: GraphItemContext) {
		return this.openBranchesOnRemoteFromGraph(item, true);
	}

	@command('gitlens.setRemoteAsDefault:')
	@debug()
	private async setRemoteAsDefault(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		const { repoPath, name } = item.webviewItemValue;
		await this.container.git.getRepositoryService(repoPath).remotes.setRemoteAsDefault(name, true);
	}

	@command('gitlens.unsetRemoteAsDefault:')
	@debug()
	private async unsetRemoteAsDefault(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		const { repoPath, name } = item.webviewItemValue;
		await this.container.git.getRepositoryService(repoPath).remotes.setRemoteAsDefault(name, false);
	}

	@command('gitlens.connectRemoteProvider:')
	@debug()
	private connectRemoteProviderFromGraph(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		return executeCommand('gitlens.connectRemoteProvider', {
			repoPath: item.webviewItemValue.repoPath,
			remote: item.webviewItemValue.name,
		});
	}

	@command('gitlens.disconnectRemoteProvider:')
	@debug()
	private disconnectRemoteProviderFromGraph(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		return executeCommand('gitlens.disconnectRemoteProvider', {
			repoPath: item.webviewItemValue.repoPath,
			remote: item.webviewItemValue.name,
		});
	}

	@command('gitlens.graph.pushWithForce')
	@debug()
	private forcePush(item?: GraphItemContext) {
		this.push(item, true);
	}

	@command('gitlens.graph.pull')
	@debug()
	private pull(item?: GraphItemContext) {
		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.pull(this.repository, ref);
	}

	@command('gitlens.graph.push')
	@debug()
	private push(item?: GraphItemContext, force?: boolean) {
		const ref = item != null ? this.getGraphItemRef(item) : undefined;
		void RepoActions.push(this.repository, force, ref);
	}

	@command('gitlens.createBranch:')
	@debug()
	private createBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return BranchActions.create(ref.repoPath, ref);
	}

	@command('gitlens.graph.deleteBranch')
	@debug()
	private deleteBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.star.branch:')
	@debug()
	private async star(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch(ref.name);
			if (branch != null) return setBranchDisposition(this.container, branch, 'starred');
		}

		return Promise.resolve();
	}

	@command('gitlens.unstar.branch:')
	@debug()
	private async unstar(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch(ref.name);
			if (branch != null) return setBranchDisposition(this.container, branch, undefined);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.mergeBranchInto')
	@debug()
	private mergeBranchInto(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return RepoActions.merge(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.openBranchOnRemote')
	@debug()
	private openBranchOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			let remote;
			if (ref.remote) {
				remote = getRemoteNameFromBranchName(ref.name);
			} else if (ref.upstream != null) {
				remote = getRemoteNameFromBranchName(ref.upstream.name);
			}

			return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				repoPath: ref.repoPath,
				resource: {
					type: RemoteResourceType.Branch,
					branch: ref.name,
				},
				remote: remote,
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyRemoteBranchUrl')
	private copyRemoteBranchUrl(item?: GraphItemContext) {
		return this.openBranchOnRemote(item, true);
	}

	@command('gitlens.publishBranch:graph')
	@debug()
	private async publishBranch(item?: GraphItemContext | BranchRef) {
		const ref = await this.resolveBranchRef(item);
		if (ref == null) return;

		await RepoActions.push(ref.repoPath, undefined, ref);
	}

	@command('gitlens.graph.rebaseOntoBranch')
	@command('gitlens.graph.rebaseOntoCommit')
	@debug()
	private rebase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return RepoActions.rebase(ref.repoPath, ref);
	}

	@command('gitlens.graph.rebaseOntoUpstream')
	@debug()
	private rebaseToRemote(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				return RepoActions.rebase(
					ref.repoPath,
					createReference(ref.upstream.name, ref.repoPath, {
						refType: 'branch',
						name: ref.upstream.name,
						remote: true,
					}),
				);
			}
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.renameBranch')
	@debug()
	private renameBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.rename(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.associateIssueWithBranch:graph')
	@debug()
	private associateIssueWithBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
				command: 'associateIssueWithBranch',
				branch: ref,
				source: 'graph',
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.cherryPick')
	@command('gitlens.graph.cherryPick.multi')
	@debug()
	private cherryPick(item?: GraphItemContext) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return RepoActions.cherryPick(selection[0].repoPath, selection);
	}

	@command('gitlens.graph.copy')
	@debug()
	private async copy(item?: GraphItemContext) {
		let data;

		const { selection } = this.getGraphItemRefs(item);
		if (selection.length) {
			data = selection
				.map(r => (r.refType === 'revision' && r.message ? `${r.name}: ${r.message.trim()}` : r.name))
				.join('\n');
		} else if (isGraphItemTypedContext(item, 'contributor')) {
			const { name, email } = item.webviewItemValue;
			data = `${name}${email ? ` <${email}>` : ''}`;
		} else if (isGraphItemTypedContext(item, 'pullrequest')) {
			const { url } = item.webviewItemValue;
			data = url;
		}

		if (data != null) {
			await env.clipboard.writeText(data);
		}
	}

	@command('gitlens.graph.copyMessage')
	@debug()
	private copyMessage(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyMessageToClipboardCommandArgs>('gitlens.copyMessageToClipboard', {
			repoPath: ref.repoPath,
			sha: ref.ref,
			message: 'message' in ref ? ref.message : undefined,
		});
	}

	@command('gitlens.graph.copySha')
	@debug()
	private async copySha(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		let sha = ref.ref;
		if (!isSha(sha)) {
			sha = (await this.container.git.getRepositoryService(ref.repoPath).revision.resolveRevision(sha)).sha;
		}

		return executeCommand<CopyShaToClipboardCommandArgs, void>('gitlens.copyShaToClipboard', {
			sha: sha,
		});
	}

	@command('gitlens.graph.commitViaSCM')
	@debug()
	private async commitViaSCM(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');

		await executeCoreCommand('workbench.view.scm');
		if (ref != null) {
			const scmRepo = await this.container.git.getRepositoryService(ref.repoPath).getScmRepository();
			if (scmRepo == null) return;

			// Update the input box to trigger the focus event
			// eslint-disable-next-line no-self-assign
			scmRepo.inputBox.value = scmRepo.inputBox.value;
		}
	}

	@command('gitlens.graph.openCommitOnRemote')
	@command('gitlens.graph.openCommitOnRemote.multi')
	@debug()
	private openCommitOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: selection[0].repoPath,
			resource: selection.map(r => ({ type: RemoteResourceType.Commit, sha: r.ref })),
			clipboard: clipboard,
		});
	}

	@command('gitlens.graph.copyRemoteCommitUrl')
	@command('gitlens.graph.copyRemoteCommitUrl.multi')
	private copyRemoteCommitUrl(item?: GraphItemContext) {
		return this.openCommitOnRemote(item, true);
	}

	@command('gitlens.graph.compareSelectedCommits.multi')
	@debug()
	private async compareSelectedCommits(item?: GraphItemContext) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection?.length !== 2) return Promise.resolve();

		const [commit1, commit2] = selection;
		const [ref1, ref2] = await getOrderedComparisonRefs(this.container, commit1.repoPath, commit1.ref, commit2.ref);

		return this.notifyOpenCompareMode({
			repoPath: commit1.repoPath,
			leftRef: ref1,
			leftRefType: 'commit',
			rightRef: ref2,
			rightRefType: 'commit',
		});
	}

	@command('gitlens.pausedOperation.abort:')
	@debug()
	private async abortPausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		await abortPausedOperation(this.repository.git);
	}

	@command('gitlens.pausedOperation.continue:')
	@debug()
	private async continuePausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		const status = await this.repository.git.pausedOps?.getPausedOperationStatus?.();
		if (status == null || status.type === 'revert') return;

		await continuePausedOperation(this.repository.git);
	}

	@command('gitlens.pausedOperation.open:')
	@debug()
	private async openRebaseEditor(_item?: GraphItemContext) {
		if (this.repository == null) return;

		const status = await this.repository.git.pausedOps?.getPausedOperationStatus?.();
		if (status?.type !== 'rebase') return;

		const gitDir = await this.repository.git.config.getGitDir?.();
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	@command('gitlens.pausedOperation.skip:')
	@debug()
	private async skipPausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		await skipPausedOperation(this.repository.git);
	}

	@command('gitlens.pausedOperation.showConflicts:')
	@debug()
	private async showConflicts(pausedOpArgs: GitPausedOperationStatus) {
		await showPausedOperationStatus(this.container, pausedOpArgs.repoPath, {
			openRebaseEditor: pausedOpArgs.type === 'rebase',
		});
	}

	@command('gitlens.graph.stageConflictCurrentChanges:')
	@debug()
	private async stageConflictCurrentChanges(item?: DetailsItemTypedContext): Promise<void> {
		await this.runStageConflictResolution(item, 'current');
	}

	@command('gitlens.graph.stageConflictIncomingChanges:')
	@debug()
	private async stageConflictIncomingChanges(item?: DetailsItemTypedContext): Promise<void> {
		await this.runStageConflictResolution(item, 'incoming');
	}

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

		// Tell the panel to refetch — for non-active worktrees the active-repo working-tree
		// watcher won't fire, so we'd otherwise leave the panel showing pre-mutation state.
		void this.host.notify(DidRequestWipRefetchNotification, { repoPath: value.repoPath });
	}

	@command('gitlens.graph.copyDeepLinkToBranch')
	@debug()
	private copyDeepLinkToBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToBranch', { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyDeepLinkToCommit')
	@debug()
	private copyDeepLinkToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToCommit', { refOrRepoPath: ref });
	}

	@command('gitlens.graph.copyDeepLinkToRepo')
	@debug()
	private copyDeepLinkToRepo(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (!ref.remote) return Promise.resolve();

			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToRepo', {
				refOrRepoPath: ref.repoPath,
				remote: getRemoteNameFromBranchName(ref.name),
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyDeepLinkToTag')
	@debug()
	private copyDeepLinkToTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToTag', { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.shareAsCloudPatch')
	@command('gitlens.graph.createPatch')
	@command('gitlens.createCloudPatch:')
	@debug()
	private async shareAsCloudPatch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision') ?? this.getGraphItemRef(item, 'stash');

		if (ref == null) return Promise.resolve();

		const { summary: title, body: description } = splitCommitMessage(ref.message);
		return executeCommand<CreatePatchCommandArgs, void>('gitlens.createCloudPatch', {
			to: ref.ref,
			repoPath: ref.repoPath,
			title: title,
			description: description,
		});
	}

	@command('gitlens.copyPatchToClipboard:')
	@debug()
	private async copyPatchToClipboard(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision') ?? this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		const { summary: title, body: description } = splitCommitMessage(ref.message);
		return executeCommand<CreatePatchCommandArgs, void>('gitlens.copyPatchToClipboard', {
			from: `${ref.ref}^`,
			to: ref.ref,
			repoPath: ref.repoPath,
			title: title,
			description: description,
		});
	}

	@command('gitlens.graph.resetCommit')
	@debug()
	private resetCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(
			ref.repoPath,
			createReference(`${ref.ref}^`, ref.repoPath, {
				refType: 'revision',
				name: `${ref.name}^`,
				message: ref.message,
			}),
		);
	}

	@command('gitlens.graph.resetToCommit')
	@debug()
	private resetToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(ref.repoPath, ref);
	}

	@command('gitlens.graph.resetToTip')
	@debug()
	private resetToTip(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(
			ref.repoPath,
			createReference(ref.ref, ref.repoPath, { refType: 'revision', name: ref.name }),
		);
	}

	@command('gitlens.graph.revert')
	@debug()
	private revertCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.revert(ref.repoPath, ref);
	}

	@command('gitlens.switchToBranch:')
	@command('gitlens.graph.switchToCommit')
	@command('gitlens.graph.switchToTag')
	@debug()
	private async switchTo(item?: GraphItemContext | BranchRef) {
		const ref = item != null && 'branchId' in item ? await this.resolveBranchRef(item) : this.getGraphItemRef(item);
		if (ref == null) return;

		await RepoActions.switchTo(ref.repoPath, ref);
	}

	@command('gitlens.graph.resetToTag')
	@debug()
	private resetToTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'tag');
		if (ref == null) return Promise.resolve();
		return RepoActions.reset(ref.repoPath, ref);
	}

	@command('gitlens.graph.hideLocalBranch')
	@command('gitlens.graph.hideRemoteBranch')
	@command('gitlens.graph.hideTag')
	@debug()
	private hideRef(item?: GraphItemContext, options?: { group?: boolean; remote?: boolean }) {
		let refs;
		if (options?.group && isGraphItemRefGroupContext(item)) {
			({ refs } = item.webviewItemGroupValue);
		} else if (!options?.group && isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			if (ref.id != null) {
				refs = [ref];
			}
		}

		if (refs != null) {
			this.updateExcludedRefs(
				this._graph?.repoPath,
				refs.map(r => {
					const remoteBranch = r.refType === 'branch' && r.remote;
					return {
						id: r.id!,
						name: remoteBranch ? (options?.remote ? '*' : getBranchNameWithoutRemote(r.name)) : r.name,
						owner: remoteBranch ? getRemoteNameFromBranchName(r.name) : undefined,
						type: r.refType === 'branch' ? (r.remote ? 'remote' : 'head') : 'tag',
					};
				}),
				false,
			);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.hideRemote')
	private hideRemote(item?: GraphItemContext) {
		return this.hideRef(item, { remote: true });
	}

	@command('gitlens.graph.hideRefGroup')
	private hideRefGroup(item?: GraphItemContext) {
		return this.hideRef(item, { group: true });
	}

	@command('gitlens.graph.pinBranchToLeft')
	@debug()
	private pinBranchToLeft(item?: GraphItemContext) {
		if (!isGraphItemRefContext(item)) return Promise.resolve();

		const { ref } = item.webviewItemValue;
		if (ref.refType !== 'branch' || ref.id == null) return Promise.resolve();

		const remote = ref.remote;
		this.updatePinnedRef(ref.repoPath ?? this._graph?.repoPath, {
			id: ref.id,
			name: remote ? getBranchNameWithoutRemote(ref.name) : ref.name,
			owner: remote ? getRemoteNameFromBranchName(ref.name) : undefined,
			type: remote ? 'remote' : 'head',
		});
		return Promise.resolve();
	}

	@command('gitlens.graph.unpinBranchFromLeft')
	@debug()
	private unpinBranchFromLeft(_item?: GraphItemContext) {
		this.updatePinnedRef(this._graph?.repoPath, null);
		return Promise.resolve();
	}

	@command('gitlens.graph.soloBranch')
	@command('gitlens.graph.soloTag')
	@debug()
	private soloReference(item?: GraphItemContext) {
		if (!isGraphItemRefContext(item)) return;

		const { ref } = item.webviewItemValue;
		if (ref.id == null) return;

		const repo = this.container.git.getRepository(ref.repoPath);
		if (repo == null) return Promise.resolve();

		// Show the graph with a ref: search query to filter the graph to this branch
		return void executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
			repository: repo,
			search: {
				query: `ref:${ref.name}`,
				filter: true,
				matchAll: false,
				matchCase: false,
				matchRegex: false,
			},
			source: { source: 'graph' },
		});
	}

	@command('gitlens.switchToAnotherBranch:graph')
	@debug()
	private switchToAnother(item?: GraphItemContext | unknown) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return RepoActions.switchTo(this.repository?.path);

		return RepoActions.switchTo(ref.repoPath);
	}

	@command('gitlens.graph.undoCommit')
	@debug()
	private async undoCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		await undoCommit(this.container, ref);
	}

	@command('gitlens.stashSave:')
	@debug()
	private saveStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return StashActions.push(ref.repoPath);
	}

	@command('gitlens.stashApply:')
	@debug()
	private applyStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.apply(ref.repoPath, ref);
	}

	@command('gitlens.stashDelete:')
	@debug()
	private deleteStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.drop(ref.repoPath, [ref]);
	}

	@command('gitlens.stashRename:')
	@debug()
	private renameStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.rename(ref.repoPath, ref);
	}

	@command('gitlens.graph.createTag')
	@debug()
	private async createTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return TagActions.create(ref.repoPath, ref);
	}

	@command('gitlens.graph.deleteTag')
	@debug()
	private deleteTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return TagActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.createWorktree')
	@debug()
	private async createWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		await WorktreeActions.create(ref.repoPath, undefined, ref);
	}

	@command('gitlens.createPullRequest:')
	@debug()
	private async createPullRequest(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;

			const repo = this.container.git.getRepository(ref.repoPath);
			const branch = await repo?.git.branches.getBranch(ref.name);
			const remote = branch != null ? await getBranchRemote(this.container, branch) : undefined;

			return executeActionCommand<CreatePullRequestActionContext>('createPullRequest', {
				repoPath: ref.repoPath,
				remote:
					remote != null
						? {
								name: remote.name,
								provider:
									remote.provider != null
										? {
												id: remote.provider.id,
												name: remote.provider.name,
												domain: remote.provider.domain,
											}
										: undefined,
								url: remote.url,
							}
						: undefined,
				branch: {
					name: ref.name,
					upstream: ref.upstream?.name,
					isRemote: ref.remote,
				},
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.openPullRequest:')
	@debug()
	private openPullRequest(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			return executeActionCommand<OpenPullRequestActionContext>('openPullRequest', {
				repoPath: pr.repoPath,
				provider: {
					id: pr.provider.id,
					name: pr.provider.name,
					domain: pr.provider.domain,
				},
				pullRequest: {
					id: pr.id,
					url: pr.url,
				},
				source: { source: 'graph' },
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.openPullRequestChanges:')
	@debug()
	private async openPullRequestChanges(item?: GraphItemContext | BranchRef) {
		// Webview action-link path (graph overview card): look the PR up from the BranchRef.
		if (item != null && 'branchId' in item) {
			const branch = await this.container.git
				.getRepositoryService(item.repoPath)
				.branches.getBranch(item.branchName);
			if (branch == null) return;

			const pr = await getBranchAssociatedPullRequest(this.container, branch);
			if (pr?.refs?.base == null || pr.refs.head == null) return;

			const refs = getComparisonRefsForPullRequest(item.repoPath, pr.refs);
			await openComparisonChanges(
				this.container,
				{ repoPath: refs.repoPath, lhs: refs.base.ref, rhs: refs.head.ref },
				{ title: `Changes in Pull Request #${pr.id}` },
			);
			return;
		}

		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			if (pr.refs?.base != null && pr.refs.head != null) {
				const refs = getComparisonRefsForPullRequest(pr.repoPath, pr.refs);
				await openComparisonChanges(
					this.container,
					{
						repoPath: refs.repoPath,
						lhs: refs.base.ref,
						rhs: refs.head.ref,
					},
					{ title: `Changes in Pull Request #${pr.id}` },
				);
			}
		}
	}

	@command('gitlens.openPullRequestComparison:')
	@debug()
	private async openPullRequestComparison(item?: GraphItemContext | BranchRef) {
		// Webview action-link path (graph overview card): look the PR up from the BranchRef.
		if (item != null && 'branchId' in item) {
			const branch = await this.container.git
				.getRepositoryService(item.repoPath)
				.branches.getBranch(item.branchName);
			if (branch == null) return;

			const pr = await getBranchAssociatedPullRequest(this.container, branch);
			if (pr?.refs?.base == null || pr.refs.head == null) return;

			const refs = getComparisonRefsForPullRequest(item.repoPath, pr.refs);
			await this.container.views.searchAndCompare.compare(refs.repoPath, refs.head, refs.base);
			return;
		}

		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			if (pr.refs?.base != null && pr.refs.head != null) {
				const refs = getComparisonRefsForPullRequest(pr.repoPath, pr.refs);
				await this.container.views.searchAndCompare.compare(refs.repoPath, refs.head, refs.base);
			}
		}
	}

	@command('gitlens.openPullRequestOnRemote:')
	@debug()
	private openPullRequestOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const { url } = item.webviewItemValue;
			return executeCommand<OpenPullRequestOnRemoteCommandArgs>('gitlens.openPullRequestOnRemote', {
				pr: { url: url },
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@debug()
	private openIssueOnRemote(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'issue')) {
			const { url } = item.webviewItemValue;
			void executeCommand<OpenIssueOnRemoteCommandArgs>('gitlens.openIssueOnRemote', {
				issue: { url: url },
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.compareAncestryWithWorking')
	@debug()
	private async compareAncestryWithWorking(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		// Anchor on the user's current worktree — both the merge-base computation and the WT-files
		// fetch resolve relative to this. Avoids the multi-worktree degenerate case where
		// `getBranch(ref.repoPath)` returns the same ref as `ref.ref`.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const svc = this.container.git.getRepositoryService(currentRepoPath);
		const currentBranch = await svc.branches.getBranch();
		if (currentBranch == null) return undefined;

		const commonAncestor = await svc.refs.getMergeBase(currentBranch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: currentBranch.ref,
			leftRefType: 'branch',
			rightRef: commonAncestor,
			rightRefType: 'commit',
			includeWorkingTree: true,
		});
	}

	@command('gitlens.graph.compareWithHead')
	@debug()
	private async compareHeadWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		// Resolve HEAD against the user's current worktree before ordering — `'HEAD'` as an opaque
		// string would otherwise resolve against `ref.repoPath`, which may be a different worktree.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const currentBranch = await this.container.git.getRepositoryService(currentRepoPath).branches.getBranch();
		const headRef = currentBranch?.ref ?? 'HEAD';

		const [ref1, ref2] = await getOrderedComparisonRefs(this.container, currentRepoPath, headRef, ref.ref);
		const ref1IsHead = ref1 === headRef;
		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: ref1,
			leftRefType: ref1IsHead ? 'branch' : this.graphCompareRefType(ref.refType),
			rightRef: ref2,
			rightRefType: ref1IsHead ? this.graphCompareRefType(ref.refType) : 'branch',
		});
	}

	@command('gitlens.graph.compareBranchWithHead')
	@debug()
	private async compareBranchWithHead(item?: GraphItemContext | BranchRef) {
		const ref = await this.resolveBranchRef(item);
		if (ref == null) return;

		// Resolve HEAD to the user's current worktree's branch — passing `'HEAD'` as a string would
		// resolve against the IPC `repoPath` on the host, which may be a different worktree.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const currentBranch = await this.container.git.getRepositoryService(currentRepoPath).branches.getBranch();

		await this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: ref.ref,
			leftRefType: 'branch',
			rightRef: currentBranch?.ref ?? 'HEAD',
			rightRefType: 'branch',
		});
	}

	@command('gitlens.graph.compareWithMergeBase')
	@debug()
	private async compareWithMergeBase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		// "Compare with Common Base" is conceptually "where this branch diverged from where I'm
		// working." Anchor the merge-base on the user's current worktree's branch, not the clicked
		// ref's worktree's branch — otherwise in multi-worktree the merge-base degenerates to the
		// ref itself when `getBranch(ref.repoPath)` returns `ref.ref`.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const svc = this.container.git.getRepositoryService(currentRepoPath);
		const currentBranch = await svc.branches.getBranch();
		if (currentBranch == null) return undefined;

		const commonAncestor = await svc.refs.getMergeBase(currentBranch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: ref.ref,
			leftRefType: this.graphCompareRefType(ref.refType),
			rightRef: commonAncestor,
			rightRefType: 'commit',
		});
	}

	@command('gitlens.graph.openChangedFileDiffsWithMergeBase')
	@debug()
	private async openChangedFileDiffsWithMergeBase(item?: GraphItemContext | BranchRef) {
		// Webview action-link path (graph overview card) passes a BranchRef rather than the
		// graph item context; resolve the target branch from the named ref.
		let repoPath: string;
		let targetRef: string;
		let targetName: string;
		if (item != null && 'branchId' in item) {
			repoPath = item.repoPath;
			const targetBranch = await this.container.git
				.getRepositoryService(repoPath)
				.branches.getBranch(item.branchName);
			if (targetBranch == null) return undefined;

			targetRef = targetBranch.ref;
			targetName = targetBranch.name;
		} else {
			const ref = this.getGraphItemRef(item, 'branch');
			if (ref == null) return undefined;

			repoPath = ref.repoPath;
			targetRef = ref.ref;
			targetName = ref.name;
		}

		const currentBranch = await this.container.git.getRepositoryService(repoPath).branches.getBranch();
		if (currentBranch == null) return undefined;

		const commonAncestor = await this.container.git
			.getRepositoryService(repoPath)
			.refs.getMergeBase(currentBranch.ref, targetRef);
		if (commonAncestor == null) return undefined;

		return openComparisonChanges(
			this.container,
			{ repoPath: repoPath, lhs: commonAncestor, rhs: targetRef },
			{
				title: `Changes between ${targetName} (${shortenRevision(commonAncestor)}) ${
					GlyphChars.ArrowLeftRightLong
				} ${shortenRevision(targetRef, { strings: { working: 'Working Tree' } })}`,
			},
		);
	}

	@command('gitlens.graph.compareWithUpstream')
	@debug()
	private compareWithUpstream(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				return this.notifyOpenCompareMode({
					repoPath: ref.repoPath,
					leftRef: ref.ref,
					leftRefType: 'branch',
					rightRef: ref.upstream.name,
					rightRefType: 'branch',
				});
			}
		}

		return Promise.resolve();
	}

	@command('gitlens.changeUpstream:')
	@command('gitlens.setUpstream:')
	@debug()
	private changeUpstreamBranch(item?: GraphItemContext) {
		if (!isGraphItemRefContext(item, 'branch')) return Promise.resolve();
		const { ref } = item.webviewItemValue;
		return BranchActions.changeUpstream(ref.repoPath, ref);
	}

	@command('gitlens.graph.compareWithWorking')
	@debug()
	private async compareWorkingWith(item?: GraphItemContext | BranchRef) {
		const ref = await this.resolveBranchRef(item);
		if (ref == null) return;

		// Anchor against the user's *current* worktree — `getBranch()` and the host's WT-files
		// fetch (`getBranchComparisonWorkingTreeFiles`) both run against this repoPath, so passing
		// the current worktree's path makes the WT and the resolved branch ref both belong to
		// where the user is actually working — not to whichever worktree the clicked ref happens
		// to live in.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const currentBranch = await this.container.git.getRepositoryService(currentRepoPath).branches.getBranch();

		await this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: currentBranch?.ref ?? 'HEAD',
			leftRefType: 'branch',
			rightRef: ref.ref,
			rightRefType: 'branch',
			includeWorkingTree: true,
		});
	}

	@command('gitlens.views.selectForCompare:')
	@debug()
	private selectForCompare(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		void setContext('gitlens:views:canCompare', { label: ref.name, ref: ref.ref, repoPath: ref.repoPath });
	}

	@command('gitlens.views.compareWithSelected:')
	@debug()
	private compareWithSelected(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		const selectedRef = getContext('gitlens:views:canCompare');
		if (selectedRef == null) return;

		void setContext('gitlens:views:canCompare', undefined);

		if (selectedRef.repoPath !== ref.repoPath) {
			this.selectForCompare(item);
			return;
		}

		// Anchor on the selected ref's repoPath — the user deliberately chose that side via
		// "Select for Compare", so it's their canonical anchor for this comparison. `selectedRef`
		// is a `StoredNamedRef` (no `refType`) — default to `commit`. The active ref carries its
		// own `refType` from the graph item context.
		void this.notifyOpenCompareMode({
			repoPath: selectedRef.repoPath,
			leftRef: selectedRef.ref,
			leftRefType: 'commit',
			rightRef: ref.ref,
			rightRefType: this.graphCompareRefType(ref.refType),
		});
	}

	@command('gitlens.copyWorkingChangesToWorktree:')
	@debug()
	private copyWorkingChangesToWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return WorktreeActions.copyChangesToWorktree('working-tree', ref.repoPath);
	}

	@command('gitlens.ai.generateCommitMessage:')
	@debug()
	private generateCommitMessage(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCommand<GenerateCommitMessageCommandArgs>('gitlens.ai.generateCommitMessage', {
			repoPath: ref.repoPath,
			source: 'graph',
		});
	}

	@command('gitlens.ai.explainUnpushed:')
	@debug()
	private aiExplainUnpushed(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;

			if (!ref.upstream) {
				return Promise.resolve();
			}

			return executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
				repoPath: ref.repoPath,
				ref: ref.ref,
				baseBranch: ref.upstream.name,
				source: { source: 'graph', context: { type: 'branch' } },
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.ai.explainBranch:')
	@debug()
	private explainBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
			repoPath: ref.repoPath,
			ref: ref.ref,
			source: { source: 'graph', context: { type: 'branch' } },
		});
	}

	@debug()
	private async recomposeBranch(item?: GraphItemContext): Promise<void> {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref != null) {
			await executeCommand<RecomposeBranchCommandArgs>('gitlens.recomposeBranch', {
				repoPath: ref.repoPath,
				branchName: ref.name,
				source: 'graph',
			});
			return;
		}

		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null || selection.length < 2) return;

		const repoPath = selection[0].repoPath;
		const commitShas = selection.map(ref => ref.sha);

		const graph = this._graph;
		if (graph == null) return;

		// We need to make sure commit shas are sorted in the order of the commits they are based on
		commitShas.sort((a, b) => {
			const rowA = graph.rows.find(r => r.sha === a);
			const rowB = graph.rows.find(r => r.sha === b);
			return (rowA?.date ?? 0) - (rowB?.date ?? 0);
		});

		const branchCounts = new Map<string, number>();

		for (const sha of commitShas) {
			const row = graph.rows.find(r => r.sha === sha);
			if (row?.reachability) {
				for (const ref of row.reachability.refs) {
					if (ref.refType === 'branch' && !ref.remote) {
						branchCounts.set(ref.name, (branchCounts.get(ref.name) ?? 0) + 1);
					}
				}
			}
		}

		const branchesReachingAll: string[] = [];
		for (const [branchName, count] of branchCounts) {
			if (count === commitShas.length) {
				branchesReachingAll.push(branchName);
			}
		}

		if (branchesReachingAll.length !== 1) {
			void window.showErrorMessage(
				branchesReachingAll.length === 0
					? 'The selected commits are not reachable from any single branch.'
					: 'The selected commits are reachable from multiple branches. Please select commits unique to a single branch.',
			);
			return;
		}

		const branchName = branchesReachingAll[0];

		await executeCommand<RecomposeBranchCommandArgs>('gitlens.recomposeSelectedCommits', {
			repoPath: repoPath,
			branchName: branchName,
			commitShas: commitShas,
			source: 'graph',
		});
	}

	@debug()
	private async recomposeFromCommit(item?: GraphItemContext): Promise<void> {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return;

		const graph = this._graph;
		if (graph == null) return;

		const row = graph.rows.find(r => r.sha === ref.ref);
		const localBranches = row?.reachability?.refs.filter(r => r.refType === 'branch' && !r.remote);
		if (localBranches?.length !== 1) {
			void window.showErrorMessage('Unable to recompose: commit must belong to exactly one local branch');
			return;
		}

		const branchName = localBranches[0].name;
		const branch = graph.branches.get(branchName);
		if (branch == null) {
			void window.showErrorMessage(`Branch '${branchName}' not found`);
			return;
		}

		const headCommitSha = branch.sha;
		if (headCommitSha == null) {
			void window.showErrorMessage(`Unable to determine head commit for branch '${branchName}'`);
			return;
		}

		const commit = await this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);
		if (commit == null) {
			void window.showErrorMessage(`Commit '${ref.ref}' not found`);
			return;
		}

		const baseCommitSha = commit.parents.length > 0 ? commit.parents[0] : undefined;
		if (baseCommitSha == null) {
			void window.showErrorMessage('Unable to determine parent commit');
			return;
		}

		await executeCommand<RecomposeFromCommitCommandArgs>('gitlens.recomposeFromCommit', {
			repoPath: ref.repoPath,
			commitSha: ref.ref,
			branchName: branchName,
			source: 'graph',
		});
	}

	// Recompose wrappers
	@command('gitlens.recomposeBranch:')
	private recomposeBranchCommand(item?: GraphItemContext) {
		return this.recomposeBranch(item);
	}
	@command('gitlens.composeCommits:')
	private composeCommitsCommand(item?: GraphItemContext) {
		return this.composeCommits(item);
	}
	@command('gitlens.recomposeSelectedCommits:')
	private recomposeSelectedCommitsCommand(item?: GraphItemContext) {
		return this.recomposeBranch(item);
	}
	@command('gitlens.recomposeFromCommit:')
	private recomposeFromCommitCommand(item?: GraphItemContext) {
		return this.recomposeFromCommit(item);
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
		entry: { avatarUrl?: string },
		email: string | undefined,
		ref: string | undefined,
		repoPath: string | undefined,
	): void {
		if (!email) return;

		const avatar =
			ref != null && repoPath != null
				? getAvatarUri(email, { ref: ref, repoPath: repoPath }, { size: 16 })
				: getAvatarUri(email, undefined, { size: 16 });
		if (!(avatar instanceof Promise)) {
			entry.avatarUrl = avatar.toString();
		} else {
			void avatar.catch(() => undefined);
		}
	}

	private async getBranchComparisonWorkingTreeFiles(
		repoPath: string,
		leftRef: string,
		includeWorkingTree: boolean,
		signal?: AbortSignal,
	): Promise<BranchComparisonFile[]> {
		if (!includeWorkingTree) return [];

		const svc = this.container.git.getRepositoryService(repoPath);
		const branch = await svc.branches.getBranch();
		signal?.throwIfAborted();
		if (branch == null || (leftRef !== 'HEAD' && leftRef !== branch.name && leftRef !== branch.ref)) return [];

		const status = await svc.status.getStatus(undefined, signal);
		signal?.throwIfAborted();

		const files: BranchComparisonFile[] = [];
		const seen = new Set<string>();
		for (const f of status?.files ?? []) {
			if (!seen.has(f.path)) {
				seen.add(f.path);
				files.push({
					repoPath: f.repoPath,
					path: f.path,
					status: f.status,
					originalPath: f.originalPath,
					staged: f.staged,
					source: 'workingTree',
				});
			}
		}

		return files;
	}

	private getDiffCacheKey(repoPath: string, scope: ScopeSelection, excludedFiles?: readonly string[]): string {
		return JSON.stringify({
			repoPath: repoPath,
			scope: scope,
			excludedFiles: excludedFiles?.toSorted(),
		});
	}

	private async getDiffForScope(
		repoPath: string,
		scope: ScopeSelection,
		signal?: AbortSignal,
	): Promise<{ diff: string; message: string } | undefined> {
		const svc = this.container.git.getRepositoryService(repoPath);

		if (scope.type === 'commit') {
			const diffResult = await svc.diff?.getDiff?.(scope.sha);
			signal?.throwIfAborted();
			if (!diffResult?.contents) return undefined;

			const commit = await svc.commits.getCommit(scope.sha);
			signal?.throwIfAborted();
			return { diff: annotateDiffWithNewLineNumbers(diffResult.contents), message: commit?.message ?? '' };
		}

		if (scope.type === 'compare') {
			if (scope.includeShas?.length) {
				const parts: string[] = [];
				const messages: string[] = [];
				for (const sha of scope.includeShas) {
					const diff = await svc.diff?.getDiff?.(sha);
					signal?.throwIfAborted();
					if (diff?.contents) {
						parts.push(diff.contents);
					}
					const c = await svc.commits.getCommit(sha);
					signal?.throwIfAborted();
					if (c) {
						messages.push(`${shortenRevision(c.sha)}: ${c.message ?? ''}`);
					}
				}
				if (!parts.length) return undefined;
				return {
					diff: annotateDiffWithNewLineNumbers(parts.join('\n')),
					message: `Selected commits between ${shortenRevision(scope.fromSha)} and ${shortenRevision(scope.toSha)}:\n\n${messages.join('\n')}`,
				};
			}

			const data = await prepareCompareDataForAIRequest(svc, scope.toSha, scope.fromSha);
			signal?.throwIfAborted();
			if (!data) return undefined;

			return {
				diff: annotateDiffWithNewLineNumbers(data.diff),
				message: `Changes between ${shortenRevision(scope.fromSha)} and ${shortenRevision(scope.toSha)}:\n\n${data.logMessages}`,
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
		for (const sha of scope.includeShas) {
			const d = await svc.diff?.getDiff?.(sha);
			signal?.throwIfAborted();
			if (d?.contents) {
				parts.push(d.contents);
			}
			const c = await svc.commits.getCommit(sha);
			signal?.throwIfAborted();
			if (c) {
				commitMessages.push(`${shortenRevision(c.sha)}: ${c.message ?? ''}`);
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
		return { diff: annotateDiffWithNewLineNumbers(parts.join('\n')), message: message };
	}

	@command('gitlens.ai.explainCommit:')
	@debug()
	private explainCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainCommitCommandArgs>('gitlens.ai.explainCommit', {
			repoPath: ref.repoPath,
			rev: ref.ref,
			source: { source: 'graph', context: { type: 'commit' } },
		});
	}

	@command('gitlens.ai.explainStash:')
	@debug()
	private explainStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainStashCommandArgs>('gitlens.ai.explainStash', {
			repoPath: ref.repoPath,
			rev: ref.ref,
			source: { source: 'graph', context: { type: 'stash' } },
		});
	}

	@command('gitlens.ai.explainWip:')
	@debug()
	private async explainWip(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		const worktree = await this.getGraphItemWorktree(item);

		await executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
			repoPath: worktree?.repoPath ?? ref.repoPath,
			worktreePath: worktree?.path,
			source: { source: 'graph', context: { type: 'wip' } },
		});
	}

	private getOpenEditorShowOptions(): (TextDocumentShowOptions & { sourceViewColumn?: ViewColumn }) | undefined {
		if (this.host.is('view')) return undefined;

		const mode = configuration.get('graph.editorOpeningBehavior') ?? 'auto';
		if (mode !== 'auto' || !this.host.active) return undefined;

		return { viewColumn: ViewColumn.Beside, sourceViewColumn: this.host.viewColumn };
	}

	@command('gitlens.graph.openChangedFiles')
	@debug()
	private async openFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFiles(commit, this.getOpenEditorShowOptions());
	}

	@debug()
	private async openAllChanges(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openCommitChanges(this.container, commit, individually, this.getOpenEditorShowOptions());
	}

	@command('gitlens.graph.openChangedFileDiffs')
	private openChangedFileDiffs(item?: GraphItemContext) {
		return this.openAllChanges(item);
	}
	@command('gitlens.graph.openChangedFileDiffsIndividually')
	private openChangedFileDiffsIndividually(item?: GraphItemContext) {
		return this.openAllChanges(item, true);
	}

	@debug()
	private async openAllChangesWithWorking(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openCommitChangesWithWorking(this.container, commit, individually, this.getOpenEditorShowOptions());
	}

	@command('gitlens.graph.openChangedFileDiffsWithWorking')
	private openChangedFileDiffsWithWorking(item?: GraphItemContext) {
		return this.openAllChangesWithWorking(item);
	}
	@command('gitlens.graph.openChangedFileDiffsWithWorkingIndividually')
	private openChangedFileDiffsWithWorkingIndividually(item?: GraphItemContext) {
		return this.openAllChangesWithWorking(item, true);
	}

	@command('gitlens.graph.openChangedFileRevisions')
	@debug()
	private async openRevisions(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFilesAtRevision(commit, this.getOpenEditorShowOptions());
	}

	@command('gitlens.graph.openOnlyChangedFiles')
	@debug()
	private async openOnlyChangedFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openOnlyChangedFiles(this.container, commit);
	}

	@command('gitlens.graph.openInWorktree')
	@debug()
	private async openInWorktree(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const repo = this.container.git.getRepository(ref.repoPath);
			const branch = await repo?.git.branches.getBranch(ref.name);
			const pr = branch != null ? await getBranchAssociatedPullRequest(this.container, branch) : undefined;
			if (branch != null && repo != null && pr != null) {
				const remoteUrl =
					(await getBranchRemote(this.container, branch))?.url ??
					getRepositoryIdentityForPullRequest(pr).remote.url;
				if (remoteUrl != null) {
					const deepLink = getPullRequestBranchDeepLink(
						this.container,
						pr,
						branch.nameWithoutRemote,
						remoteUrl,
						DeepLinkActionType.SwitchToPullRequestWorktree,
					);

					return this.container.deepLinks.processDeepLinkUri(deepLink, false, repo);
				}
			}

			await executeGitCommand({
				command: 'switch',
				state: {
					repos: ref.repoPath,
					reference: ref,
					worktreeDefaultOpen: 'new',
				},
			});
		}
	}

	@command('gitlens.openWorktree:')
	@debug()
	private async openWorktree(item?: GraphItemContext | BranchRef, options?: { location?: OpenWorkspaceLocation }) {
		// Webview action-link path (graph overview card): branch identity arrives as a BranchRef.
		if (item != null && 'branchId' in item) {
			const repoPath = item.repoPath;
			let worktreesByBranch;
			if (repoPath === this._graph?.repoPath) {
				worktreesByBranch = this._graph?.worktreesByBranch;
			} else {
				const repo = this.container.git.getRepository(repoPath);
				if (repo == null) return;

				worktreesByBranch = await getWorktreesByBranch(repo);
			}

			const worktree = worktreesByBranch?.get(item.branchId);
			if (worktree == null) return;

			openWorkspace(worktree.uri, options);
			return;
		}

		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.id == null) return;

			let worktreesByBranch;
			if (ref.repoPath === this._graph?.repoPath) {
				worktreesByBranch = this._graph?.worktreesByBranch;
			} else {
				const repo = this.container.git.getRepository(ref.repoPath);
				if (repo == null) return;

				worktreesByBranch = await getWorktreesByBranch(repo);
			}

			const worktree = worktreesByBranch?.get(ref.id);
			if (worktree == null) return;

			openWorkspace(worktree.uri, options);
		} else if (isGraphItemRefContext(item, 'revision')) {
			// Detached worktree — find by sha
			const { ref } = item.webviewItemValue;
			const worktree = this._graph?.worktrees?.find(w => w.sha === ref.ref);
			if (worktree == null) return;

			openWorkspace(worktree.uri, options);
		}
	}

	@command('gitlens.openWorktreeInNewWindow:')
	private openWorktreeInNewWindow(item?: GraphItemContext | BranchRef) {
		return this.openWorktree(item, { location: 'newWindow' });
	}

	@command('gitlens.graph.revealWorktreeInExplorer')
	@debug()
	private async revealWorktreeInExplorer(item?: GraphItemContext) {
		const worktree = await this.getGraphItemWorktree(item);
		if (worktree == null) return;

		// Pass a sub-path (.git always exists in any worktree) so the OS file manager opens the
		// worktree folder itself rather than its parent — the default `revealFileInOS` selects
		// the folder in the parent on Windows/WSL, which isn't what users expect for a worktree.
		void revealInFileExplorer(Uri.joinPath(worktree.uri, '.git'));
	}

	@command('gitlens.graph.deleteWorktree')
	@debug()
	private async deleteWorktree(item?: GraphItemContext) {
		const worktree = await this.getGraphItemWorktree(item);
		if (worktree == null || worktree.isDefault || worktree.opened) return;

		await WorktreeActions.remove(worktree.repoPath, [worktree.uri]);
	}

	@command('gitlens.graph.addAuthor')
	@debug()
	private addAuthor(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'contributor')) {
			const { repoPath, name, email, current } = item.webviewItemValue;
			return ContributorActions.addAuthors(
				repoPath,
				new GitContributor(repoPath, name, email, current ?? false, 0),
			);
		}

		return Promise.resolve();
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

		if (name === 'changes' && !column.isHidden && !this._graph?.includes?.stats) {
			this.updateState();
		}
	}

	// Column toggle wrappers
	@command('gitlens.graph.columnAuthorOn')
	private columnAuthorOn() {
		return this.toggleColumn('author', true);
	}
	@command('gitlens.graph.columnAuthorOff')
	private columnAuthorOff() {
		return this.toggleColumn('author', false);
	}
	@command('gitlens.graph.columnDateTimeOn')
	private columnDateTimeOn() {
		return this.toggleColumn('datetime', true);
	}
	@command('gitlens.graph.columnDateTimeOff')
	private columnDateTimeOff() {
		return this.toggleColumn('datetime', false);
	}
	@command('gitlens.graph.columnShaOn')
	private columnShaOn() {
		return this.toggleColumn('sha', true);
	}
	@command('gitlens.graph.columnShaOff')
	private columnShaOff() {
		return this.toggleColumn('sha', false);
	}
	@command('gitlens.graph.columnChangesOn')
	private columnChangesOn() {
		return this.toggleColumn('changes', true);
	}
	@command('gitlens.graph.columnChangesOff')
	private columnChangesOff() {
		return this.toggleColumn('changes', false);
	}
	@command('gitlens.graph.columnGraphOn')
	private columnGraphOn() {
		return this.toggleColumn('graph', true);
	}
	@command('gitlens.graph.columnGraphOff')
	private columnGraphOff() {
		return this.toggleColumn('graph', false);
	}
	@command('gitlens.graph.columnMessageOn')
	private columnMessageOn() {
		return this.toggleColumn('message', true);
	}
	@command('gitlens.graph.columnMessageOff')
	private columnMessageOff() {
		return this.toggleColumn('message', false);
	}
	@command('gitlens.graph.columnRefOn')
	private columnRefOn() {
		return this.toggleColumn('ref', true);
	}
	@command('gitlens.graph.columnRefOff')
	private columnRefOff() {
		return this.toggleColumn('ref', false);
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

	// Scroll marker toggle wrappers
	@command('gitlens.graph.scrollMarkerLocalBranchOn')
	private scrollMarkerLocalBranchOn() {
		return this.toggleScrollMarker('localBranches', true);
	}
	@command('gitlens.graph.scrollMarkerLocalBranchOff')
	private scrollMarkerLocalBranchOff() {
		return this.toggleScrollMarker('localBranches', false);
	}
	@command('gitlens.graph.scrollMarkerRemoteBranchOn')
	private scrollMarkerRemoteBranchOn() {
		return this.toggleScrollMarker('remoteBranches', true);
	}
	@command('gitlens.graph.scrollMarkerRemoteBranchOff')
	private scrollMarkerRemoteBranchOff() {
		return this.toggleScrollMarker('remoteBranches', false);
	}
	@command('gitlens.graph.scrollMarkerStashOn')
	private scrollMarkerStashOn() {
		return this.toggleScrollMarker('stashes', true);
	}
	@command('gitlens.graph.scrollMarkerStashOff')
	private scrollMarkerStashOff() {
		return this.toggleScrollMarker('stashes', false);
	}
	@command('gitlens.graph.scrollMarkerTagOn')
	private scrollMarkerTagOn() {
		return this.toggleScrollMarker('tags', true);
	}
	@command('gitlens.graph.scrollMarkerTagOff')
	private scrollMarkerTagOff() {
		return this.toggleScrollMarker('tags', false);
	}
	@command('gitlens.graph.scrollMarkerPullRequestOn')
	private scrollMarkerPullRequestOn() {
		return this.toggleScrollMarker('pullRequests', true);
	}
	@command('gitlens.graph.scrollMarkerPullRequestOff')
	private scrollMarkerPullRequestOff() {
		return this.toggleScrollMarker('pullRequests', false);
	}
	@command('gitlens.graph.scrollMarkerWipOn')
	private scrollMarkerWipOn() {
		return this.toggleScrollMarker('wip', true);
	}
	@command('gitlens.graph.scrollMarkerWipOff')
	private scrollMarkerWipOff() {
		return this.toggleScrollMarker('wip', false);
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

	// Column mode wrappers
	@command('gitlens.graph.columnGraphCompact')
	private columnGraphCompact() {
		return this.setColumnMode('graph', 'compact');
	}
	@command('gitlens.graph.columnGraphDefault')
	private columnGraphDefault() {
		return this.setColumnMode('graph', undefined);
	}

	@command('gitlens.ai.generateChangelogFrom:')
	@debug()
	private async generateChangelogFrom(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch') || isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;

			await executeCommand<GenerateChangelogCommandArgs>('gitlens.ai.generateChangelog', {
				repoPath: ref.repoPath,
				head: ref,
				source: { source: 'graph', detail: isGraphItemRefContext(item, 'branch') ? 'branch' : 'tag' },
			});
		}

		return Promise.resolve();
	}

	@debug()
	private async composeCommits(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		const worktree = await this.getGraphItemWorktree(item);

		await executeCommand<ComposerCommandArgs>('gitlens.composeCommits', {
			repoPath: worktree?.path ?? ref.repoPath,
			source: 'graph',
		});
	}

	@command('gitlens.visualizeHistory.repo:')
	@debug()
	private visualizeHistoryRepo() {
		void executeCommand<TimelineCommandArgs | undefined>(
			'gitlens.visualizeHistory',
			this.repository != null ? { type: 'repo', uri: this.repository.uri } : undefined,
		);
	}

	private getCommitFromGraphItemRef(item?: GraphItemContext): Promise<GitCommit | undefined> {
		let ref: GitRevisionReference | GitStashReference | undefined = this.getGraphItemRef(item, 'revision');
		if (ref != null) return this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);

		ref = this.getGraphItemRef(item, 'stash');
		if (ref != null) return this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);

		return Promise.resolve(undefined);
	}

	/** The user's current/active worktree path — anchors compare actions whose intent is "from
	 *  where I'm working" (compare-with-HEAD/Working/MergeBase). The graph's `this.repository`
	 *  follows the user's selected repo in the graph header; its `.path` is the worktree the
	 *  user is currently focused on. Falls back to the clicked ref's repoPath if `this.repository`
	 *  is unset (rare — preserves prior behavior rather than dropping the action). */
	private getCurrentRepoPath(refRepoPath: string): string {
		return this.repository?.path ?? refRepoPath;
	}

	/** Maps a {@link GitReference}'s `refType` to the narrower compare-mode triple the graph
	 *  details panel uses ({@link DidRequestOpenCompareModeParams}). `revision` and `stash`
	 *  collapse to `commit`; the panel doesn't distinguish stashes here (they're reachable as
	 *  commit shas). */
	private graphCompareRefType(refType: GitReference['refType']): 'branch' | 'tag' | 'commit' {
		switch (refType) {
			case 'branch':
				return 'branch';
			case 'tag':
				return 'tag';
			default:
				return 'commit';
		}
	}

	/** Pushes the request to the graph webview to enter compare mode with the supplied refs.
	 *  Fire-and-forget; the webview applies it on next render. Replaces the prior pattern of
	 *  routing graph compare actions through the Search & Compare sidebar view. */
	private notifyOpenCompareMode(params: DidRequestOpenCompareModeParams): Promise<void> {
		void this.host.notify(DidRequestOpenCompareModeNotification, params);
		return Promise.resolve();
	}

	/**
	 * Resolves a branch ref from either a {@link GraphItemContext} (graph row context-menu / inline
	 * action path) or a {@link BranchRef} (webview action-link path used by the graph overview
	 * card and other panels). The latter only carries identity (repoPath / branchName), so we
	 * rehydrate the full {@link GitBranchReference} via the repository service.
	 */
	private async resolveBranchRef(
		item: GraphItemContext | BranchRef | undefined,
	): Promise<GitBranchReference | undefined> {
		if (item != null && 'branchId' in item) {
			const branch = await this.container.git
				.getRepositoryService(item.repoPath)
				.branches.getBranch(item.branchName);
			return branch != null ? getReferenceFromBranch(branch) : undefined;
		}
		return this.getGraphItemRef(item, 'branch');
	}

	private getGraphItemRef(item?: GraphItemContext | unknown | undefined): GitReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'branch',
	): GitBranchReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'revision',
	): GitRevisionReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'stash',
	): GitStashReference | undefined;
	private getGraphItemRef(item: GraphItemContext | unknown | undefined, refType: 'tag'): GitTagReference | undefined;
	private getGraphItemRef(
		item?: GraphItemContext | unknown,
		refType?: 'branch' | 'revision' | 'stash' | 'tag',
	): GitReference | undefined {
		if (item == null) {
			const ref = this.activeSelection;
			return ref != null && (refType == null || refType === ref.refType) ? ref : undefined;
		}

		switch (refType) {
			case 'branch':
				return isGraphItemRefContext(item, 'branch') || isGraphItemTypedContext(item, 'upstreamStatus')
					? item.webviewItemValue.ref
					: undefined;
			case 'revision':
				return isGraphItemRefContext(item, 'revision') ? item.webviewItemValue.ref : undefined;
			case 'stash':
				return isGraphItemRefContext(item, 'stash') ? item.webviewItemValue.ref : undefined;
			case 'tag':
				return isGraphItemRefContext(item, 'tag') ? item.webviewItemValue.ref : undefined;
			default:
				return isGraphItemRefContext(item) ? item.webviewItemValue.ref : undefined;
		}
	}

	private async getGraphItemWorktree(item?: GraphItemContext): Promise<GitWorktree | undefined> {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.id == null) return undefined;

			let worktreesByBranch;
			if (ref.repoPath === this._graph?.repoPath) {
				worktreesByBranch = this._graph?.worktreesByBranch;
			} else {
				const repo = this.container.git.getRepository(ref.repoPath);
				if (repo == null) return undefined;

				worktreesByBranch = await getWorktreesByBranch(repo);
			}

			return worktreesByBranch?.get(ref.id);
		}
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;
			return this._graph?.worktrees?.find(w => w.sha === ref.ref);
		}
		return undefined;
	}

	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'branch',
	): GraphItemRefs<GitBranchReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'revision',
	): GraphItemRefs<GitRevisionReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'stash',
	): GraphItemRefs<GitStashReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'tag',
	): GraphItemRefs<GitTagReference>;
	private getGraphItemRefs(item: GraphItemContext | unknown | undefined): GraphItemRefs<GitReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown,
		refType?: 'branch' | 'revision' | 'stash' | 'tag',
	): GraphItemRefs<GitReference> {
		if (item == null) return { active: undefined, selection: [] };

		switch (refType) {
			case 'branch':
				if (!isGraphItemRefContext(item, 'branch') && !isGraphItemTypedContext(item, 'upstreamStatus')) {
					return { active: undefined, selection: [] };
				}
				break;
			case 'revision':
				if (!isGraphItemRefContext(item, 'revision')) return { active: undefined, selection: [] };
				break;
			case 'stash':
				if (!isGraphItemRefContext(item, 'stash')) return { active: undefined, selection: [] };
				break;
			case 'tag':
				if (!isGraphItemRefContext(item, 'tag')) return { active: undefined, selection: [] };
				break;
			default:
				if (!isGraphItemRefContext(item)) return { active: undefined, selection: [] };
		}

		const selection = item.webviewItemsValues?.map(i => i.webviewItemValue.ref) ?? [];
		if (!selection.length) {
			selection.push(item.webviewItemValue.ref);
		}
		return { active: item.webviewItemValue.ref, selection: selection };
	}

	private createCancellation(op: CancellableOperations) {
		this.cancelOperation(op);

		const cancellation = new CancellationTokenSource();
		this._cancellations.set(op, cancellation);
		return cancellation;
	}

	private cancelOperation(op: CancellableOperations) {
		this._cancellations.get(op)?.cancel();
		this._cancellations.delete(op);
	}
}

type GraphItemRefs<T> = {
	active: T | undefined;
	selection: T[];
};

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

export function updateSearchMode<T extends GitGraphSearch | undefined>(
	container: Container,
	search: T,
	mode?: GraphSearchMode,
): T {
	if (search?.query != null) {
		mode ??= container.storage.get('graph:searchMode', 'normal');
		search.query.filter = mode === 'filter';
	}
	return search;
}
