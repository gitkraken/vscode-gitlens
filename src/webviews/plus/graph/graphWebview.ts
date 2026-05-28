import type { emptySetMarker, GraphRefOptData, GraphRow, GraphSearchMode } from '@gitkraken/gitkraken-components';
import type { CancellationToken, ColorTheme, ConfigurationChangeEvent, TextDocumentShowOptions } from 'vscode';
import {
	CancellationTokenSource,
	commands,
	Disposable,
	env,
	ProgressLocation,
	Uri,
	ViewColumn,
	window,
	workspace,
} from 'vscode';
import { createGraphComposeIntegration } from '@env/coretools/composer.js';
import { getClaudeAgent } from '@env/providers.js';
import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
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
import type { GitStatus } from '@gitlens/git/models/status.js';
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
import { createRevisionRange, isSha, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import {
	getSearchQueryComparisonKey,
	parseSearchQuery,
	parseSearchQueryGitCommand,
} from '@gitlens/git/utils/search.utils.js';
import { sortBranches, sortRemotes, sortTags, sortWorktrees } from '@gitlens/git/utils/sorting.js';
import { filterMap } from '@gitlens/utils/array.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { annotateDiffWithNewLineNumbers } from '@gitlens/utils/diff.js';
import { createDisposable, disposableInterval } from '@gitlens/utils/disposable.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import { count, find, join, last } from '@gitlens/utils/iterable.js';
import { lazy } from '@gitlens/utils/lazy.js';
import { Logger } from '@gitlens/utils/logger.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { areEqual, filterMap as filterMapObject, flatten, hasKeys, updateRecordValue } from '@gitlens/utils/object.js';
import {
	getSettledValue,
	pauseOnCancelOrTimeout,
	pauseOnCancelOrTimeoutMapTuplePromise,
} from '@gitlens/utils/promise.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import { Stopwatch } from '@gitlens/utils/stopwatch.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import { isActiveAgentPhase } from '../../../agents/provider.js';
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
import { generateChangelogAndOpenMarkdownDocument } from '../../../commands/generateChangelog.js';
import type { OpenIssueOnRemoteCommandArgs } from '../../../commands/openIssueOnRemote.js';
import type { OpenOnRemoteCommandArgs } from '../../../commands/openOnRemote.js';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../../commands/openPullRequestOnRemote.js';
import type { CreatePatchCommandArgs } from '../../../commands/patches.js';
import type { RecomposeBranchCommandArgs } from '../../../commands/recomposeBranch.js';
import type { RecomposeFromCommitCommandArgs } from '../../../commands/recomposeFromCommit.js';
import type { RunPromptInAgentCommandArgs } from '../../../commands/runPromptInAgent.js';
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
import type { StoredGraphFilters, StoredGraphRefType, StoredGraphWipDraft } from '../../../constants.storage.js';
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
import { getChangesForChangelog } from '../../../git/utils/-webview/log.utils.js';
import { countConflictMarkers } from '../../../git/utils/-webview/mergeConflicts.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import {
	getBestRemoteWithIntegration,
	getRemoteIntegration,
	getRemoteProviderUrl,
	remoteSupportsIntegration,
} from '../../../git/utils/-webview/remote.utils.js';
import type { getWorktreeHasWorkingChanges } from '../../../git/utils/-webview/worktree.utils.js';
import { getOpenedWorktreesByBranch, getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import type { OnboardingChangeEvent } from '../../../onboarding/onboardingService.js';
import type { UsageChangeEvent } from '../../../onboarding/usageTracker.js';
import { getSupportedAgents } from '../../../plus/agents/agentRegistry.js';
import type { AIGenerateChangelogChanges } from '../../../plus/ai/actions/generateChangelog.js';
import { shouldUseSinglePass } from '../../../plus/ai/actions/reviewChanges.js';
import { prepareCompareDataForAIRequest } from '../../../plus/ai/utils/-webview/ai.utils.js';
import type { ChangesContextCommit, ChangesContextInput } from '../../../plus/ai/utils/-webview/changesContext.js';
import {
	formatChangesContextForPrompt,
	gatherContextForChanges,
} from '../../../plus/ai/utils/-webview/changesContext.js';
import { showPatchesView } from '../../../plus/drafts/actions.js';
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
import { loadChunk } from '../../../system/-webview/loadChunk.js';
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
import { LaunchpadService } from '../../rpc/launchpadService.js';
import { createSharedServices, proxyServices } from '../../rpc/services/common.js';
import type { BranchAndTargetRefs, BranchRef } from '../../shared/branchRefs.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewRecentThreshold,
} from '../../shared/overviewBranches.js';
import { getBranchOverviewType, toOverviewBranch } from '../../shared/overviewBranches.js';
import { getOverviewEnrichment, getOverviewWip } from '../../shared/overviewEnrichment.utils.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider.js';
import type { WebviewPanelShowCommandArgs, WebviewShowOptions } from '../../webviewsController.js';
import { isSerializedState } from '../../webviewsController.js';
import type { Change } from '../patchDetails/protocol.js';
import * as branchRefCommands from '../shared/branchRefCommands.js';
import type { ChoosePathParams, DidChoosePathParams } from '../timeline/protocol.js';
import type { TimelineCommandArgs } from '../timeline/registration.js';
import { buildTimelineDataset } from '../timeline/timelineDataset.js';
import type { GraphComposeIntegration } from './compose/integration.js';
import { isComposeSimulatorActive, runSimulatedComposeChanges } from './compose/simulator.js';
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
	WipStats,
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
	CloseGraphWalkthroughBannerParams,
	DidChangeWorkingTreeParams,
	DidGetSidebarDataParams,
	DidRequestOpenCompareModeParams,
	DidRequestOpenTimelineScopeParams,
	DidRequestSearchParams,
	GetWipStatsResponse,
	GraphActionTarget,
	GraphAutoFetchMode,
	GraphBranchContextValue,
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
	GraphShowAction,
	GraphSidebarPanel,
	GraphSidebarWorktree,
	GraphStashContextValue,
	GraphTagContextValue,
	GraphWalkthroughBannerState,
	GraphWipMetadataBySha,
	GraphWorkingTreeStats,
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
	DidChangeAvatarsNotification,
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
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
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
	DidRequestOpenCompareModeNotification,
	DidRequestOpenTimelineScopeNotification,
	DidRequestSearchNotification,
	DidRequestWipRefetchNotification,
	DidSearchNotification,
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
	GetWipStatsRequest,
	isSecondaryWipSha,
	JumpToHeadRequest,
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
	TrackGraphDetailsCompareModeCommand,
	TrackGraphDetailsComposeModeCommand,
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
import type { GraphWebviewShowingArgs, ShowInCommitGraphCommandArgs } from './registration.js';
import { SearchHistory } from './searchHistory.js';

interface SelectedRowState {
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

function hasSearchQuery(arg: any): arg is { repository: GlRepository; search: SearchQuery; selectSha?: string } {
	return arg?.repository != null && arg?.search != null;
}

function hasSidebarPanel(arg: any): arg is { sidebarPanel: GraphSidebarPanel } {
	return typeof arg?.sidebarPanel === 'string';
}

function hasAction(arg: any): arg is { action: GraphShowAction } {
	return typeof arg?.action === 'string';
}

const defaultGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 130, isHidden: false, order: 0, isFilterable: true },
	graph: { width: 150, mode: undefined, isHidden: false, order: 1 },
	message: { width: 300, isHidden: false, order: 2, isFilterable: true },
	author: { width: 130, isHidden: false, order: 3, isFilterable: true },
	changes: { width: 200, isHidden: false, order: 4, isFilterable: true },
	datetime: { width: 130, isHidden: false, order: 5, isFilterable: true },
	sha: { width: 130, isHidden: false, order: 6, isFilterable: true },
};

const compactGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 32, isHidden: false, isFilterable: true },
	graph: { width: 150, mode: 'compact', isHidden: false },
	author: { width: 32, isHidden: false, order: 2, isFilterable: true },
	message: { width: 500, isHidden: false, order: 3, isFilterable: true },
	changes: { width: 200, isHidden: false, order: 4, isFilterable: true },
	datetime: { width: 130, isHidden: true, order: 5, isFilterable: true },
	sha: { width: 130, isHidden: false, order: 6, isFilterable: true },
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
	| 'branchStateOnly'
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
	/** Mirrors the webview's `displayMode` (session-only); Visualizations mode needs row stats. */
	private _displayMode: GraphDisplayMode = 'graph';
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
	private readonly _graphDetailsDiffCache = new LruMap<string, { diff: string; message: string; context: string }>(
		GraphWebviewProvider._diffCacheCap,
	);

	// Map value type is `() => Promise<boolean | void>` so we can include notify methods that don't
	// return whether they sent (e.g. `notifyDidChangeBranchStateOnly`, `notifyDidChangeOverview`).
	// The consumer in `sendPendingIpcNotifications` `void`s the call so the boolean is unused.
	private readonly _ipcNotificationMap = new Map<IpcNotification<any>, () => Promise<boolean | void>>([
		[DidChangeBranchStateNotification, this.notifyDidChangeBranchStateOnly],
		[DidChangeColumnsNotification, this.notifyDidChangeColumns],
		[DidChangeGraphConfigurationNotification, this.notifyDidChangeConfiguration],
		[DidChangeNotification, this.notifyDidChangeState],
		[DidChangeOverviewNotification, this.notifyDidChangeOverview],
		[DidChangePinnedRefNotification, this.notifyDidChangePinnedRef],
		[DidChangeRefsVisibilityNotification, this.notifyDidChangeRefsVisibility],
		[DidChangeScrollMarkersNotification, this.notifyDidChangeScrollMarkers],
		[DidChangeSelectionNotification, this.notifyDidChangeSelection],
		[DidChangeSubscriptionNotification, this.notifyDidChangeSubscription],
		[DidChangeWipDraftsNotification, this.notifyDidChangeWipDrafts],
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
	private _treemapInvalidateSubscription: Disposable | undefined;
	private _searchHistory: SearchHistory | undefined;

	// Timeframe for the Overview panel's "Recent" section. Seeded from the `graph:state` memento
	// in `getState`, updated in-place by `onGetOverview` when the webview changes it.
	private _overviewRecentThreshold: OverviewRecentThreshold = 'OneWeek';

	// Coalesce concurrent `notifyDidChangeState` calls; skip when a fresh full-state send just happened
	// (via bootstrap or a prior notify). This prevents the second `getState`/`getGraph` pipeline run
	// that otherwise fires when `onRepositoryChanged` trips during the repo-subscription wiring right after bootstrap.
	private _pendingStateNotify: Promise<boolean> | undefined;
	/** In-flight state build (from bootstrap or a notify); shared so concurrent callers coalesce. */
	private _pendingStateOp: Promise<unknown> | undefined;
	private _lastStateSentAt: number | undefined;
	/** Trailing flush scheduled when notify was skipped inside the freshness window. */
	private _stateFreshnessRetryTimer: ReturnType<typeof setTimeout> | undefined;
	/** Set when a notify request arrives while another is in-flight, so we re-notify on completion. */
	private _stateNotifyDirty = false;
	/** Most recent branchState we sent to the webview, so async PR resolution can merge into the freshest values. */
	private _lastSentBranchState: BranchState | undefined;
	/**
	 * Fingerprint of the rows/avatars/downstreams payload most recently delivered to the webview.
	 * When the next `notifyDidChangeState` would carry an identical fingerprint we omit those four
	 * fields from the IPC. On a real repo this drops the per-event payload from ~12 MB to a few KB.
	 *
	 * Cleared on reconnect / repository switch so the next push reseeds the webview with rows.
	 */
	private _lastSentGraphFingerprint: string | undefined;
	/**
	 * Counter of sidebar-relevant repo events. `notifyDidChangeState` fires `notifySidebarInvalidated()`
	 * post-rebuild when `_firedSidebarEventSeq` lags the captured value. A counter (vs a boolean)
	 * preserves a delta when a second event lands mid-rebuild, so the trailing run still fires against
	 * a graph that reflects it.
	 */
	private _sidebarEventCounter = getScopedCounter();
	/** Watermark: counter values up to here have already fired their post-rebuild invalidation. */
	private _firedSidebarEventSeq = 0;
	// Per-Map sizes shipped on the previous `notifyDidChangeRows`. These accumulate monotonically
	// across pagination so a size that hasn't changed means no new entries; a larger size means
	// some entries were appended. Cleared in `setGraph` on graph identity change.
	private _lastSentAvatarsSize: number | undefined;
	private _lastSentRowsStatsSize: number | undefined;
	private static readonly stateFreshnessMs = 500;

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
			() => this.getFiltersByRepo(this.repository?.path ?? this._graph?.repoPath)?.pinnedRef?.id,
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
						this.pruneWipDraftsForRemovedRepos(removed.map(r => r.path));
					}
					if (removed.length === 0 && (added.length === 0 || added.every(r => r.isWorktree))) {
						this._etag = this.container.git.etag;
						return;
					}

					this.updateState();
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
					this._wipStatusCache.clear();
				} else {
					// `delete` (hard-evict) rather than `invalidate` (soft) — invalidate keeps an
					// in-flight pre-op `git status` promise alive and lets the post-op revalidate
					// join it, flashing stale data into the panel.
					this._wipStatusCache.delete(e.data.repoPath);
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

	private _disposed = false;

	dispose(): void {
		this._disposed = true;
		this.clearAutoFetchTimer();
		if (this._stateFreshnessRetryTimer != null) {
			clearTimeout(this._stateFreshnessRetryTimer);
			this._stateFreshnessRetryTimer = undefined;
		}
		// Cancel and dispose every in-flight cancellation token. Previously these survived dispose:
		// the in-flight awaitee would resolve and call `host.notify` on a torn-down host (wasted
		// work + logged errors), and each source's internal listeners leaked for the extension's
		// lifetime.
		for (const source of this._cancellations.values()) {
			source.cancel();
			source.dispose();
		}
		this._cancellations.clear();
		// Cancel any in-flight load-more so its `graph.more()` resolution can't call setGraph on a
		// disposed instance.
		if (this._pendingRowsQuery != null) {
			this._pendingRowsQuery.cancellable.cancel();
			this._pendingRowsQuery.cancellable.dispose();
			this._pendingRowsQuery = undefined;
		}
		this._notifyDidChangeRefsMetadataDebounced?.cancel();
		// Cancel the other debounced notifiers too — a trailing fire after dispose would call
		// `host.notify()` on a torn-down host (the exact class of bug this dispose pass exists
		// to fix). `_fireSelectionChangedDebounced` is technically host-I/O-free but cancelling
		// it still clears its pending timer.
		this._notifyDidChangeAvatarsDebounced?.cancel();
		this._notifyDidChangeStateDebounced?.cancel();
		this._fireSelectionChangedDebounced?.cancel();
		// The periodic interval set by `ensureLastFetchedSubscription` was previously not cleaned
		// up in dispose — the interval kept firing forever, holding the entire provider+host+repo
		// chain alive across every panel open/close cycle.
		this._lastFetchedDisposable?.dispose();
		this._lastFetchedDisposable = undefined;
		for (const t of this._wipWatchRemoveTimers.values()) {
			clearTimeout(t);
		}
		this._wipWatchRemoveTimers.clear();
		for (const d of this._wipWatches.values()) {
			d.dispose();
		}
		this._wipWatches.clear();
		for (const entry of this._wipRefetches.values()) {
			if (entry.timer != null) {
				clearTimeout(entry.timer);
			}
		}
		this._wipRefetches.clear();
		this._lastFetchedHandlerDebounced?.cancel();
		this._wipStatusCache.clear();
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

	/** Per-secondary-WIP refetch coordination (timer + in-flight Promise), keyed by secondary WIP sha. */
	private readonly _wipRefetches = new Map<
		string,
		{ timer?: ReturnType<typeof setTimeout>; repo: GlRepository; inFlight?: Promise<void>; dirty: boolean }
	>();

	/**
	 * Per-secondary-worktree cache of `getStatus()` results, keyed by worktree path. Consulted on
	 * cold load (`GetWipStatsRequest`) for newly-visible rows that don't yet have stats; the FS
	 * watcher invalidates entries on real changes. The live-update path pushes WIP+stats directly
	 * via `DidRequestWipRefetchNotification` and bypasses this cache entirely.
	 */
	private readonly _wipStatusCache = new PromiseCache<string, GitStatus | undefined>({
		createTTL: 1000 * 10, // 10 seconds
	});

	private readonly _sidebarInvalidatedEvent = createRpcEvent<undefined>('sidebarInvalidated', 'signal');
	private readonly _sidebarWorktreeEvent = createRpcEvent<{
		changes: Record<string, SidebarWorktreeChange | undefined>;
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
				getWip: async (
					repoPath: string,
					signal?: AbortSignal,
					force?: boolean,
				): Promise<{ wip: Wip; stats: GraphWorkingTreeStats } | undefined> => {
					signal?.throwIfAborted();

					// Secondary worktrees may not be pre-registered as Repository instances;
					// open them on demand — closed, so they don't surface in the VS Code UI.
					const repo =
						this.container.git.getRepository(repoPath) ??
						(await this.container.git.getOrOpenRepository(Uri.file(repoPath), { closeOnOpen: true }));
					if (repo == null) return undefined;

					// Returning both halves lets the cold-load path reseed the webview's
					// `workingTreeStats` slot from the same `git status` the panel uses — if a prior
					// initial-state fetch landed with bad data and no FS event has fired since, the
					// header/row badges stay stuck on stale stats until the next incidental tick.
					// `force` (user-initiated refresh) bypasses `_wipStatusCache` so the button runs
					// a genuinely fresh `git status` rather than re-serving a possibly-stale entry.
					return this.getWipForRepoAndStats(repo, signal, force ? { bypassCache: true } : undefined);
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
							const { filterDiffFiles } = await loadChunk(
								() => import(/* webpackChunkName: "ai" */ '@gitlens/git/parsers/diffParser.js'),
							);
							data.diff = await filterDiffFiles(data.diff, paths => paths.filter(p => !excluded.has(p)));
							signal?.throwIfAborted();

							if (!data.diff?.trim()) return { error: { message: 'No changes found.' } };
						}

						this._graphDetailsDiffCache.set(diffCacheKey, {
							diff: data.diff,
							message: data.message,
							context: data.context,
						});

						// Adaptive strategy: single-pass for small diffs, two-pass for large. The
						// threshold is scoped to the selected model's input-context budget — a 1M-
						// token model happily single-passes a 100KB diff that an 8k-context model
						// couldn't. `{ silent: true }` avoids prompting the user from a background
						// fetch; on an unset model the helper falls back to a conservative default.
						// Pass `scope: 'review'` so the threshold matches the model that the
						// downstream `reviewChanges` action will actually run.
						const aiModel = await this.container.ai.getModel({ silent: true, scope: 'review' });
						signal?.throwIfAborted();
						if (shouldUseSinglePass(data.diff, aiModel)) {
							const result = await this.container.ai.actions.reviewChanges(
								{
									diff: data.diff,
									message: data.message,
									context: data.context,
									instructions: prompt || undefined,
								},
								{ source: 'graph', context: { type: reviewType, mode: 'single-pass' } },
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
							{ cancellation: cancellation },
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
						if ((await getSupportedAgents()).length === 0) {
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
					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(signal);
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
								signal,
							);
							if (!diff?.contents) {
								diff = await repo.git.diff.getDiff?.(amend.sha, undefined, undefined, signal);
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
				composeChanges: async (repoPath, scope, instructions, excludedFiles, aiExcludedFiles, signal) => {
					const { token: cancellation, dispose: disposeCancellation } = fromAbortSignal(signal);
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

						const composeTools = simulated ? undefined : this.getOrCreateComposeToolsForGraph();
						if (!simulated && composeTools == null) {
							return { error: { message: 'Compose is not available in this environment.' } };
						}

						const priorKey = this._activeComposeCacheKeys.get(repoPath);
						if (priorKey != null) {
							composeTools?.discardCachedPlan(priorKey);
							this._activeComposeCacheKeys.delete(repoPath);
						}

						this._composeProgressEvent.fire({ phase: 'collecting', message: 'Preparing changes…' });

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
						// `discardCachedPlan` is idempotent (Map.delete on a missing key is a no-op).
						// Always call it here so a thrown `executeComposeCommit` can't leak the
						// library-side plan — once we drop the cache-key handle, we have no other
						// way to discard it later, and `dispose()` only iterates keys still in our
						// own map.
						composeTools.discardCachedPlan(cacheKey);
					}
				},
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
					// Phase 2 — that side's commits without inline files.
					// We fetch files on demand when a commit is selected.
					//
					// Convention: leftRef = Base, rightRef = Compare. The Ahead side carries the
					// Compare branch's new commits + (when IWT is on) the working tree pseudo-commit.
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);

					// Resolve rightRef's (Compare) worktree path only for the Ahead side — the Behind
					// side shows the Base branch's commits and never has WT files, so its worktree is
					// intentionally not looked up.
					//
					// Merge base: reuse the value the summary fetch already resolved (threaded via
					// `options.mergeBase`) to avoid a duplicate `git merge-base` call AND to ensure
					// the side fetch and summary agree on the same divergence point even if the
					// branches were rebased between the two calls. Only resolve from scratch when
					// the option is absent (e.g., a direct side fetch with no prior summary).
					//
					// Promise.allSettled per project convention — independent parallel awaits
					// shouldn't let one failure abort the rest. Both branches degrade gracefully:
					// missing worktree path disables IWT for this side; missing merge base falls
					// back to the 2-dot symmetric range.
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
			const repoChanged = this._repository !== arg.repository;
			this.repository = arg.repository;
			if (arg.selectSha) {
				this._honorSelectedId = true;
				this.setSelectedRows(arg.selectSha);

				if (this._graph != null) {
					if (this._graph.ids.has(arg.selectSha)) {
						void this.notifyDidChangeSelection();
					} else {
						void this.onGetMoreRows({ id: arg.selectSha }, true);
					}
				}
			}
			// Three cases routed through the state-bootstrap path (`_searchRequest` → `getState`):
			//   1. Cold show (`loading`): webview isn't ready, a standalone notification would
			//      queue in `_pendingIpcNotifications` and get wiped by the bootstrap
			//      `clearPendingIpcNotifications()`.
			//   2. Repo swap (`repoChanged`): the repository setter triggers a full `updateState`
			//      refetch anyway; pipe the search through it so it lands with the new repo's rows
			//      instead of racing against the just-cleared `_graph`.
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
		} else if (hasSidebarPanel(arg)) {
			if (loading) {
				this._pendingSidebarPanel = arg.sidebarPanel;
			} else {
				void this.host.notify(DidRequestActiveSidebarPanelNotification, { panel: arg.sidebarPanel });
			}
		} else if (hasAction(arg)) {
			if (arg.action !== 'scope-to-branch') {
				this.setSelectedRows('work-dir-changes');
			}
			if (loading) {
				this._pendingAction = { action: arg.action };
			} else {
				void this.host.notify(DidRequestGraphActionNotification, { action: arg.action });
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
		// Capture the branchState that ships with bootstrap so a delayed PR resolve merges into it.
		void op.then(state => (this._lastSentBranchState = state.branchState)).catch(() => undefined);
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
			this.recoverWorkingTreeStatsIfStuck();
		}
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
		} else if (visible) {
			this.host.sendPendingIpcNotifications();
		}

		void this.ensureAutoFetch();
		if (visible) {
			this.recoverWorkingTreeStatsIfStuck();
		}
	}

	/** Lazy escalation for the rare case where both the initial-state stats fetch AND the
	 *  500ms one-shot retry returned undefined (git busy / locked / antivirus during ready-up).
	 *  `_lastSentWipNotificationParams == null` means no authoritative working-tree push has ever
	 *  landed for this graph — so the header/row badges are rendering nothing. Recover on the
	 *  next visibility/focus transition: cheap (a single `git status` only when actually needed)
	 *  and aligned with when the user is actually looking. No-op once any push has succeeded. */
	private recoverWorkingTreeStatsIfStuck(): void {
		if (this._disposed || this.repository == null) return;
		if (this._lastSentWipNotificationParams != null) return;

		void this.notifyDidChangeWorkingTree();
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
	private onGetOverview(params: IpcParams<typeof GetOverviewRequest>): GraphOverviewData {
		if (params.recentThreshold != null) {
			this._overviewRecentThreshold = params.recentThreshold;
		}
		try {
			return this.getOverviewData();
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverview');
			// Ship a structurally-valid shape so the frontend's `.length`/`.map` reads don't crash.
			return { active: [], recent: [], error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	@ipcRequest(GetOverviewWipRequest)
	private async onGetOverviewWip(params: IpcParams<typeof GetOverviewWipRequest>): Promise<GetOverviewWipResponse> {
		if (params.branchIds.length === 0 || this._graph == null || this.repository == null) return {};

		// Visibility-refresh path: webview asks for current overview WIP on panel mount / focus.
		// Default mode routes through the shared `_wipStatusCache`, so when the per-event push has
		// just populated entries (within 10s TTL) this is essentially free — no extra `git status`.
		// Cold entries (off-screen worktree without active watcher) miss → fetched once →
		// populated for any subsequent reader (rich hover, worktrees panel, next event push).
		// `cheap` mode (Recent worktree-backed cards) probes `status.hasWorkingChanges()` per
		// worktree — `@gate`d at the sub-provider so concurrent identical calls dedup. It bypasses
		// the status cache entirely; the breakdown arrives later via the hover-triggered detailed
		// fetch which goes through the cache.
		try {
			return await this.computeOverviewWipFromCache(params.branchIds, params.cheap);
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverviewWip');
			// Record-shaped response — empty map is safe; frontend reads `response[sha]` and gets `undefined`.
			return {};
		}
	}

	@ipcRequest(GetOverviewWipDetailedRequest)
	private async onGetOverviewWipDetailed(
		params: IpcParams<typeof GetOverviewWipDetailedRequest>,
	): Promise<GetOverviewWipResponse> {
		if (params.branchIds.length === 0 || this._graph == null || this.repository == null) return {};

		try {
			return await this.computeOverviewWipFromCache(params.branchIds);
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverviewWipDetailed');
			return {};
		}
	}

	private computeOverviewWipFromCache(branchIds: string[], cheap?: boolean): Promise<GetOverviewWipResponse> {
		const data = this._graph!;
		// Cheap mode probes `hasWorkingChanges()` directly (dirty bit only) and bypasses the
		// shared `_wipStatusCache`; the cheap probe's `@gate` dedups concurrent identical calls.
		// Full breakdown arrives on hover via the non-cheap path through the cache.
		const options = cheap
			? { cheap: true }
			: {
					fetchStatus: (path: string, signal?: AbortSignal) =>
						this._wipStatusCache.getOrCreate(
							path,
							(_cacheable, factorySignal) =>
								this.container.git
									.getRepositoryService(path)
									.status.getStatus(undefined, factorySignal),
							{ cancellation: signal },
						),
				};
		return getOverviewWip(
			this.container,
			data.branches.values(),
			data.worktreesByBranch ?? new Map(),
			branchIds,
			options,
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

		// Agent membership drives the `agents` branches-visibility ref set, so any change to
		// the live session list needs to recompute the included refs and push a fresh
		// visibility notification to the webview.
		const repoPath = this.repository?.path ?? this._graph?.repoPath;
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
						this._wipStatusCache.getOrCreate(
							path,
							(_cacheable, factorySignal) => svc.status.getStatus(undefined, factorySignal),
							{ cancellation: signal },
						),
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
						pinnedRefId != null && b.id === pinnedRefId ? '+pinned' : ''
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
						webviewItem: `gitlens:branch+remote${pinnedRefId != null && b.id === pinnedRefId ? '+pinned' : ''}`,
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

			// The graph row this worktree's WIP anchors to — must mirror `getWipMetadataBySha`:
			// the worktree at the graph's repo path is the primary `uncommitted` row, others get a
			// secondary-wip sha (only when they actually have a row, i.e. non-bare with a sha).
			const wipSha = w.type === 'bare' ? undefined : createWipSha(w.path, graph.repoPath);

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
								worktreePath: w.uri.fsPath,
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
									worktreePath: w.uri.fsPath,
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
				wipSha: wipSha,
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
		// The catch-all `graph` block below already pushes the new component config to the webview;
		// here we only need to re-arm the auto-fetch loop when the toggle flips.
		if (configuration.changed(e, 'graph.autoFetch.enabled')) {
			void this.ensureAutoFetch();
		}

		if (configuration.changed(e, 'graph.experimental.visualizations.enabled')) {
			this.subscribeToTreemapInvalidations();
		}

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

	private onWorkspaceConfigurationChanged(e: ConfigurationChangeEvent) {
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
				!this._graph?.includes?.stats
			) {
				this.updateState();
			}
		}

		if (e.keys.includes('graph:wipDrafts') && this.repository != null) {
			// Push the latest scoped draft map to this webview so a concurrent provider's write
			// (other graph instance, host-initiated undo from a different webview) lands here
			// without waiting for the next full state push.
			void this.notifyDidChangeWipDrafts();
		}
	}

	private _lastSentWipDrafts: Record<string, StoredGraphWipDraft> | undefined;
	private _lastSentWipDraftsInitialized = false;

	@trace()
	private async notifyDidChangeWipDrafts(): Promise<boolean> {
		if (this.repository == null) return false;
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeWipDraftsNotification, this._ipcNotificationMap, this);
			return false;
		}

		// Slice the storage record to entries this panel's repo can display so an unrelated
		// repo's keystroke doesn't fan a full cross-repo map to every open graph instance.
		// Self-echo from this panel's own write short-circuits via the `areEqual` check below.
		// Use a separate `_initialized` flag rather than a `!== undefined` sentinel so the
		// short-circuit also covers the "storage is empty, slice is undefined" case after the
		// first send — otherwise every storage event would re-send `{ wipDrafts: undefined }`.
		const slice = this.sliceWipDraftsForPanel();
		if (this._lastSentWipDraftsInitialized && areEqual(this._lastSentWipDrafts, slice)) {
			return false;
		}

		this._lastSentWipDrafts = slice;
		this._lastSentWipDraftsInitialized = true;
		return this.host.notify(DidChangeWipDraftsNotification, { wipDrafts: slice });
	}

	private sliceWipDraftsForPanel(): Record<string, StoredGraphWipDraft> | undefined {
		const all = this.container.storage.getWorkspace('graph:wipDrafts');
		if (all == null) return undefined;

		const repoPath = this.repository?.path;
		const worktrees = this._graph?.worktrees;
		// Pre-graph load — fall back to the full map so initial state isn't blanked.
		if (repoPath == null || worktrees == null) return all;

		const paths = new Set<string>([repoPath]);
		for (const wt of worktrees) {
			paths.add(wt.path);
		}
		const slice: Record<string, StoredGraphWipDraft> = {};
		for (const path of paths) {
			const draft = all[path];
			if (draft != null) {
				slice[path] = draft;
			}
		}
		return slice;
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
		// Filter out queued events from a previous repo. `_repository` swaps before the prior
		// subscription is disposed, so a queued `onDidChange` from the old repo can dispatch in
		// the window and drive notifications against the new one. Same guard as
		// `onRepositoryWorkingTreeChanged`.
		if (e.repository.id !== this.repository?.id) return;

		// Lightweight WIP refresh — covers staging/unstaging (`index` → stats), secondary-worktree
		// add/remove (`worktrees` → wipMetadataBySha; also falls through to the structural gate
		// below as a backstop full-state push), and tracking changes (`head|heads|remotes` →
		// wip.branch.upstream, which drives the "Publish" ↔ "Create PR" next-step row in the
		// details panel). Unioned so the in-flight coalescer can't double-fire on a single
		// multi-flag event (e.g. Pull's `head, heads, remotes, index`).
		if (e.changed('head', 'heads', 'index', 'remotes', 'worktrees')) {
			void this.notifyDidChangeWorkingTree();
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
			this.clearRefsMetadataIssues();
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
		}

		// Invalidate sidebar panels only for changes that actually affect their data. Skipping this for
		// config/unknown/pausedOp changes prevents the sidebar from showing a spinner during unrelated
		// repo activity (e.g. worktrees discovered during graph scroll fire `unknown` repo events).
		// Deferred to post-rebuild (see consumer in `notifyDidChangeState`) so the webview's refetch
		// reads the updated `_graph`.
		if (e.changed('heads', 'remotes', 'stash', 'tags')) {
			this._sidebarEventCounter.next();
		}

		// Fast-path: refresh branchState immediately so push/pull/fetch ahead/behind land in the
		// header without waiting for the full graph rebuild. The full state pipeline re-sends
		// branchState; the webview dedups equal values (see `DidChangeNotification` in
		// stateProvider.ts), so the worst case is a redundant IPC discarded on receipt.
		if (e.changed('head', 'heads', 'remotes')) {
			void this.notifyDidChangeBranchStateOnly();
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

	@ipcCommand(UpdateGraphDisplayModeCommand)
	private onDisplayModeChanged(params: IpcParams<typeof UpdateGraphDisplayModeCommand>) {
		if (this._displayMode === params.mode) return;

		this._displayMode = params.mode;

		// Visualizations (Visual History) needs row stats — refetch if the current graph was loaded without them.
		if (params.mode === 'visualizations' && !this._graph?.includes?.stats) {
			// Flip the loading flag eagerly so the timeline shows its overlay during the refetch
			// (updateState is debounced 250ms + git query time — without this the timeline would
			// briefly paint with zero stats before the new state lands).
			void this.host.notify(DidChangeRowsStatsNotification, { rowsStats: {}, rowsStatsLoading: true });
			this.updateState();
		}
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

		try {
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

		try {
			let id: string | undefined;
			let loadedNewRows = false;
			if (this._graph.ids.has(params.id)) {
				id = params.id;
			} else {
				await this.updateGraphWithMoreRows(this._graph, params.id, this._search);
				if (this._graph.ids.has(params.id)) {
					id = params.id;
				}
				loadedNewRows = true;
			}

			if (id != null && params.select) {
				this.setSelectedRows(id);
				if (loadedNewRows) {
					// New rows were loaded — full `notifyDidChangeRows` (heavy: ships rows + avatars +
					// downstreams + rowsStats + refsMetadata) so the webview can render them.
					void this.notifyDidChangeRows(true);
				} else {
					// Row was already loaded — only the selection changed. Use the lightweight
					// selection-only notification (kB-scale Record<sha,true>) instead of the
					// heavy `notifyDidChangeRows` (which would re-ship the full accumulated payload).
					void this.notifyDidChangeSelection();
				}
			} else if (loadedNewRows) {
				// New rows were loaded but caller didn't ask for selection — still ship the rows.
				void this.notifyDidChangeRows(false);
			}

			return { id: id };
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onEnsureRowRequest');
			return { id: undefined, error: ex instanceof Error ? ex.message : String(ex) };
		}
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

				// Drop any pending debounced refetch for this sha. In-flight fetches are not
				// cancelled (matches `_wipNotifyInFlight` precedent) — the late notification is
				// a no-op because the state-provider gates writes on `prevSecondary != null`.
				const refetch = this._wipRefetches.get(sha);
				if (refetch != null) {
					if (refetch.timer != null) {
						clearTimeout(refetch.timer);
					}
					if (refetch.inFlight == null) {
						this._wipRefetches.delete(sha);
					}
				}
			}, wipWatchGracePeriodMs);
			this._wipWatchRemoveTimers.set(sha, timer);
		}

		// Open watchers for newly visible shas.
		for (const sha of wanted) {
			// Bail out entirely if the provider has been disposed mid-loop — `_wipWatches` was
			// cleared in `dispose()`, so subsequent `.set` calls below would leak watchers that
			// nothing ever tears down.
			if (this._disposed) break;
			if (this._wipWatches.has(sha)) continue;
			if (!isSecondaryWipSha(sha)) continue;

			const path = getSecondaryWipPath(sha);
			const repo =
				this.container.git.getRepository(path) ??
				(await this.container.git.getOrOpenRepository(Uri.file(path), { closeOnOpen: true }));
			if (this._disposed) break;
			if (repo == null) continue;
			// Double-check: another concurrent call may have claimed this sha while we awaited.
			if (this._wipWatches.has(sha) || !wanted.has(sha)) continue;

			// Use the service-level watch facility so events fire regardless of whether the
			// `GlRepository` is open or closed — secondary worktrees are typically opened with
			// `closeOnOpen: true`, which leaves `repo.watchWorkingTree` / `repo.onDidChange` dead
			// (closed repos skip `setupWatching`). Going through `repo.git.watch()` routes around
			// that gating without flipping the repo to "open" (which would inflate
			// `openRepositoryCount` and surface the worktree in multi-repo UI).
			const watcher = await repo.git.watch({ workingTreeDelayMs: 500 });
			if (watcher == null) continue;
			// Re-check after the await — provider may have been disposed, or another sync may have
			// claimed this sha.
			if (this._disposed || this._wipWatches.has(sha) || !wanted.has(sha)) {
				watcher.dispose();
				if (this._disposed) break;
				continue;
			}

			this._wipWatches.set(
				sha,
				Disposable.from(
					watcher.onDidChangeWorkingTree(() => {
						this._wipStatusCache.invalidate(path);
						this.queueWipRefetch(sha, repo);
					}),
					// `onDidChangeWorkingTree` covers FS edits to tracked/untracked files. Index,
					// paused-op, and branch-tracking changes (staging from the CLI, rebase progress,
					// fetch/publish) only surface via the structural `onDidChange` event — mirror
					// the WIP triggers the primary fires from `onRepositoryChanged` (see `index` at
					// line 2917 and `head`/`heads`/`remotes` at line 2999) so the secondary panel
					// stays reactive to those same changes.
					watcher.onDidChange(e => {
						if (!e.changed('index', 'pausedOp', 'head', 'heads', 'remotes')) return;

						this._wipStatusCache.invalidate(path);
						this.queueWipRefetch(sha, repo);
					}),
					watcher,
				),
			);
		}
	}

	private queueWipRefetch(sha: string, repo: GlRepository) {
		let entry = this._wipRefetches.get(sha);
		if (entry == null) {
			entry = { repo: repo, dirty: false };
			this._wipRefetches.set(sha, entry);
		} else {
			entry.repo = repo;
		}

		// Concurrent fetch will absorb this change via the `dirty` flag and re-fire on
		// completion — don't run a second `git status` for the same worktree in parallel.
		if (entry.inFlight != null) {
			entry.dirty = true;
			return;
		}

		if (entry.timer != null) {
			clearTimeout(entry.timer);
		}
		entry.timer = setTimeout(() => {
			entry.timer = undefined;
			void this.runWipRefetch(sha);
		}, 250);
	}

	private async runWipRefetch(sha: string): Promise<void> {
		const entry = this._wipRefetches.get(sha);
		if (entry == null) return;
		// Watcher disposed during debounce, or webview gone — drop without a fetch.
		if (!this._wipWatches.has(sha) || !this.host.ready || !this.host.visible) {
			this._wipRefetches.delete(sha);
			return;
		}

		const promise = (async () => {
			try {
				const result = await this.getWipForRepoAndStats(entry.repo);
				if (result == null) return;
				// Re-check teardown state — the await above may have spanned a dispose or watcher
				// removal. Don't gate on `host.ready` though: `host.notify` queues when not ready
				// and replays on reconnect, so the secondary refetch isn't dropped during a reload.
				if (this._disposed || !this._wipWatches.has(sha)) return;

				void this.host.notify(DidRequestWipRefetchNotification, {
					repoPath: entry.repo.path,
					wip: result.wip,
					stats: result.stats,
				});
			} finally {
				entry.inFlight = undefined;
				if (entry.dirty) {
					entry.dirty = false;
					// Re-arm immediately — the in-flight already absorbed the debounce window.
					void this.runWipRefetch(sha);
				} else {
					// `entry.timer` is always null here: queueWipRefetch short-circuits while
					// `inFlight` is set, so no new timer can have been armed during the fetch.
					this._wipRefetches.delete(sha);
				}
			}
		})();
		entry.inFlight = promise;
		await promise;
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
			case 'stash-save':
				await StashActions.push(rowRepoPath);
				break;
			case 'stash-apply':
			case 'stash-pop':
			case 'stash-drop': {
				// Look up the real stash so we pass the proper `stashName`/`stashNumber`. The wizards
				// build `stash@{N}` from these, and a missing number produces an invalid `stash@{undefined}`
				// that fails the deleteStash/pop identity check and silently throws.
				const stash = this._graph?.stashes?.get(params.row.id);
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
			return { history: this._searchHistory.get() };
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onSearchHistoryStoreRequest');
			// Surface storage errors to the frontend instead of swallowing in `finally` and pretending
			// success — the user thought the entry was saved; on reload it would be missing.
			return { history: this._searchHistory.get(), error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	@ipcRequest(SearchHistoryDeleteRequest)
	@trace()
	private async onSearchHistoryDeleteRequest(params: IpcParams<typeof SearchHistoryDeleteRequest>) {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);
		try {
			await this._searchHistory.delete(params.query);
			return { history: this._searchHistory.get() };
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onSearchHistoryDeleteRequest');
			return { history: this._searchHistory.get(), error: ex instanceof Error ? ex.message : String(ex) };
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
		// `type:wip` rows are synthetic webview-only rows that never appear in `git log`,
		// so they're enumerated host-side instead of going through the regular search path.
		const wipResponse = await this.tryHandleWipSearch(e);
		if (wipResponse != null) return wipResponse;

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

		// Captured once and used for both the cached-results notify and the final return so that
		// awaits in either branch can't race a newer search bumping `_searchIdCounter.current` and
		// stamping our response with the wrong (newer) id. In the new-search branch this gets
		// reassigned to the bumped value.
		let searchId = this._searchIdCounter.current;

		if (search?.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			if (this.repository == null) {
				return {
					search: e.search,
					results: { error: 'No repository' },
					partial: false,
					searchId: searchId,
				};
			}

			if (this.repository.etag !== this._etagRepository) {
				this.updateState(true);
			}

			// Increment search ID for new search
			searchId = this._searchIdCounter.next();
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
			if (searchId != null && progressive && !e.more) {
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
					searchId: searchId,
				});
			}
		}

		return {
			search: search.query,
			results: this.getSearchResultsData(search) ?? { count: 0, hasMore: false, commitsLoaded: { count: 0 } },
			selectedRows: firstResultSelected ? convertSelectedRows(this._selectedRows) : undefined,
			partial: false, // Final results
			searchId: searchId,
		};
	}

	private async tryHandleWipSearch(
		e: IpcParams<typeof SearchRequest>,
	): Promise<IpcResponse<typeof SearchRequest> | undefined> {
		if (!e.search?.query) return undefined;

		const parsed = parseSearchQueryGitCommand(e.search, undefined);
		if (parsed.filters.type !== 'wip') return undefined;

		if (this.repository == null) {
			return {
				search: e.search,
				results: { error: 'No repository' },
				partial: false,
				searchId: this._searchIdCounter.current,
			};
		}

		const comparisonKey = getSearchQueryComparisonKey(e.search);

		// Same wip query as the cached one (covers `e.more` too) — re-emit the cached results.
		if (this._search?.comparisonKey === comparisonKey) {
			const cached = this.getSearchResultsData(this._search) ?? {
				count: 0,
				hasMore: false,
				commitsLoaded: { count: 0 },
			};
			return {
				search: e.search,
				results: cached,
				partial: false,
				searchId: this._searchIdCounter.current,
			};
		}

		// Cancel any in-flight regular search before superseding. Otherwise the regular search's
		// git stream keeps running until the outer function unwinds, wasting work and (paired with
		// stale `_search` reads) potentially poisoning the WIP search's results.
		this.cancelOperation('search');

		const searchId = this._searchIdCounter.next();
		this._search = undefined;

		void this.host.notify(DidSearchNotification, {
			search: e.search,
			results: undefined,
			partial: false,
			searchId: searchId,
		});

		// Use the same enumeration that feeds the rendered WIP rows so search and rendering agree.
		const wipMetadataBySha = await this.getWipMetadataBySha();

		if (searchId !== this._searchIdCounter.current) {
			return {
				search: e.search,
				results: undefined,
				partial: false,
				searchId: searchId,
			};
		}

		const results: GitGraphSearchResults = new Map();
		const now = Date.now();
		let i = 0;
		results.set('work-dir-changes' satisfies GitGraphRowType, { i: i++, date: now });
		for (const sha of Object.keys(wipMetadataBySha)) {
			results.set(sha, { i: i++, date: now });
		}

		const search: GitGraphSearch = {
			repoPath: this.repository.path,
			query: e.search,
			queryFilters: parsed.filters,
			comparisonKey: comparisonKey,
			hasMore: false,
			results: results,
		};
		this._search = updateSearchMode(this.container, search);

		this.setSelectedRows('work-dir-changes' satisfies GitGraphRowType);
		const selectedRows = convertSelectedRows(this._selectedRows);

		const resultData = this.getSearchResultsData(this._search) ?? {
			count: 0,
			hasMore: false,
			commitsLoaded: { count: 0 },
		};

		void this.host.notify(DidSearchNotification, {
			search: e.search,
			results: resultData,
			selectedRows: selectedRows,
			partial: false,
			searchId: searchId,
		});

		return {
			search: e.search,
			results: resultData,
			selectedRows: selectedRows,
			partial: false,
			searchId: searchId,
		};
	}

	private async processSearchStream(
		searchStream: AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>,
		searchId: number,
		progressive: boolean,
		graph: GitGraph,
		options?: { selectFirstResult?: boolean },
	): Promise<GitGraphSearch | undefined> {
		// Snapshot `_search` so we can restore it if this stream gets superseded — the in-loop write
		// at `this._search = updateSearchMode(...)` below stamps partial results of THIS search into
		// `_search`, and if a newer search starts mid-loop those partial results would otherwise
		// survive and poison `getSearchContext`, `updateGraphWithMoreRows`, and the bootstrap state.
		// We compare by object identity (not just truthiness) so we never clobber the newer search's
		// `_search` if it already wrote past ours.
		const priorSearch = this._search;
		let ourLastWrite: GitGraphSearch | undefined;
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
			ourLastWrite = this._search;

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
			// Restore the pre-loop `_search` only if it still holds OUR partial write — by the time
			// we get here the newer search's processStream may have already written its own results;
			// identity comparison guards against clobbering them.
			if (this._search === ourLastWrite) {
				this._search = priorSearch;
			}
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

		const repoPath = this.repository?.path ?? this._graph?.repoPath;
		if (repoPath == null) return;

		void this.host.notify(DidInvalidateScopeAnchorsNotification, { repoPath: repoPath });
	}

	/** Clear cached issue metadata so the next render re-fetches. Returns true when there was
	 *  metadata to clear (caller can use this to decide whether to fire a partial IPC refresh). */
	private clearRefsMetadataIssues(): boolean {
		if (this._refsMetadata == null) return false;

		for (const [, value] of this._refsMetadata) {
			if (value == null) continue;

			value.issue = undefined;
		}
		return true;
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
		// Prefer the already-loaded branch from the in-memory graph snapshot — `_graph.branches`
		// is the same data `getBranches()` would return (same underlying cache), so this is a
		// synchronous shortcut on the hot path, not a different source of truth.
		const branch =
			this._graph?.branches.get(branchName) ??
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
		const targetBranch = this._graph?.branches.get(targetName) ?? (await svc.branches.getBranch(targetName));
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

		// Bail when the target tip is already an ancestor of the focal branch — focal merely
		// descends from target, with no real divergence to anchor a merge boundary at. The
		// merge-base equals the target tip in that case. Letting it through puts the GK
		// component's `shouldHideWipRowForScope` into the same "hide every worktree's WIP on
		// the scoped branch" path as the equal-tip case (handled above). Common when scoping
		// to a feature branch that's 1+ commits ahead of its merge target with no merges-back.
		if (mergeBaseSha === mergeTargetTipSha) {
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
		const item = params.selection.find(r => r.active) ?? params.selection[0];
		this.setSelectedRows(item?.id, params.selection, { selected: true, hidden: item?.hidden });

		this._honorSelectedId = true;

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

	// Debounced handler for repository `lastFetched` events. Coalesces 100ms bursts of FETCH_HEAD
	// FS-watcher events that real-world git operations produce (`git fetch` writes the file in
	// multiple steps, the watcher sees each one) into a single downstream refresh.
	private _lastFetchedHandlerDebounced: Deferrable<() => void> | undefined = undefined;

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
		// Skip the notify when nothing actually changed — the fast-path (notifyDidChangeBranchStateOnly)
		// can fire on every tracking-affecting repo event, and a watcher burst will often produce identical
		// payloads after coalescing.
		if (this._lastSentBranchState != null && areEqual(branchState, this._lastSentBranchState)) {
			return false;
		}

		this._lastSentBranchState = branchState;
		return this.host.notify(DidChangeBranchStateNotification, {
			branchState: branchState,
		});
	}

	/**
	 * Fast-path refresh of just the header's branchState (ahead/behind/upstream/provider/worktree).
	 * Runs in parallel with the heavier full-state pipeline so push/pull/fetch land in the header
	 * immediately on `head`/`heads`/`remotes` events instead of waiting on the full graph rebuild.
	 *
	 * Uses its own `branchStateOnly` cancellation key — sharing `branchState` with the full-state
	 * pipeline would let `getState`'s start-of-call `cancelOperation('branchState')` abort our
	 * getBranch mid-flight, which silently falls through to the `getCurrentBranch` fallback path
	 * (hardcoded ahead/behind = 0) and poisons the cache with stale zeros.
	 *
	 * Preserves the last-known PR so the PR pill doesn't flicker; the full-state pass refreshes PR data.
	 */
	@trace()
	private async notifyDidChangeBranchStateOnly(): Promise<void> {
		if (this.repository == null) return;
		if (!this.host.ready || !this.host.visible) {
			// Queue so the header refreshes immediately on panel reveal, instead of silently
			// dropping the notify (current behavior) and waiting for the full graph rebuild.
			// `_lastSentBranchState` dedupe inside `notifyDidChangeBranchState` correctly skips
			// no-change replays.
			this.host.addPendingIpcNotification(DidChangeBranchStateNotification, this._ipcNotificationMap, this);
			return;
		}

		const cancellation = this.createCancellation('branchStateOnly');
		const signal = toAbortSignal(cancellation.token);

		let branch: GitBranch | undefined;
		try {
			branch = await this.repository.git.branches.getBranch(undefined, signal);
		} catch {
			return;
		}
		if (cancellation.token.isCancellationRequested || branch == null) return;

		const branchState: BranchState = { ...(branch.upstream?.state ?? { ahead: 0, behind: 0 }) };

		let worktreesByBranch;
		try {
			worktreesByBranch = await getWorktreesByBranch(this.repository, undefined, signal);
		} catch {
			/* swallow — worktree flag is non-critical */
		}
		if (cancellation.token.isCancellationRequested) return;

		branchState.worktree = worktreesByBranch?.has(branch.id) ?? false;

		if (branch.upstream != null) {
			branchState.upstream = branch.upstream.name;
			try {
				const remote = await getBranchRemote(this.container, branch);
				if (remote?.provider != null) {
					branchState.provider = {
						name: remote.provider.name,
						icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
						url: await getRemoteProviderUrl(remote.provider, { type: RemoteResourceType.Repo }),
					};
				}
			} catch {
				/* swallow — provider info is non-critical */
			}

			// Preserve previously-resolved PR so the pill doesn't flicker between full-state passes.
			const existingPr = this._lastSentBranchState?.pr;
			if (existingPr != null) {
				branchState.pr = existingPr;
			}
		}

		if (cancellation.token.isCancellationRequested) return;

		void this.notifyDidChangeBranchState(branchState);
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
		if (search.queryFilters?.type === 'wip') {
			// `type:wip` results are synthetic WIP rows, not real commits — they never appear in
			// `_graph.ids`, and the full set is enumerated up front (one per worktree). There are
			// no commits to page in, so treat them all as loaded; otherwise filter mode pages
			// through the entire history trying to "fill" the viewport with matches.
			commitsLoaded.count = search.results.size;
		} else if (this._graph?.ids != null) {
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

		// Update the rows-fingerprint so that a subsequent `notifyDidChangeState` can dedup when its
		// payload would carry the identical rows. Without this hook the bootstrap path (which ships
		// rows here, NOT via DidChangeNotification) leaves the fingerprint unset, so the very first
		// post-bootstrap state push re-ships rows the webview already has. Reads counts off the
		// `graph` Maps directly (no `Object.fromEntries` round-trip just to take the size).
		const statsLoading = graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false;
		this._lastSentGraphFingerprint = buildGraphFingerprint(
			graph.rows,
			graph.avatars.size,
			graph.downstreams,
			statsLoading,
			this.getFiltersByRepo(graph.repoPath)?.pinnedRef?.id,
		);

		// `avatars`, `downstreams`, and `rowsStats` accumulate monotonically across pagination — once
		// a sha → stats / email → avatar / upstream → downstreams entry is added it doesn't get
		// removed within a graph session. Tracking the last-sent count lets us:
		//   - rowsStats: ship only entries past the previous size (frontend spread-merges, so deltas
		//     work). Cuts the dominant N²-ish IPC payload on big-repo scrolls.
		//   - avatars: ship `undefined` when the size hasn't changed (frontend reducer has been
		//     updated to keep its existing state when undefined). Avoids the `Object.fromEntries`
		//     cost on pure-rows page loads. SAFE because every avatar write at graphRowProcessor
		//     is gated by `!context.avatars.has(row.email)` — values never change for existing keys.
		// `downstreams` is NOT dedupe-able by size: the provider mutates existing arrays in place
		// (`downstreams.push(tip)` in packages/git-cli/src/providers/graph.ts), so the Map size can
		// stay constant while array values grow. Always ship the full Record.
		// Reset by `setGraph` on graph identity change.
		const avatarsSize = graph.avatars.size;
		const rowsStatsSize = graph.rowsStats?.size ?? 0;

		const avatarsChanged = avatarsSize !== this._lastSentAvatarsSize;
		const rowsStatsDelta =
			graph.rowsStats != null && rowsStatsSize > (this._lastSentRowsStatsSize ?? 0)
				? takeEntriesAfter(graph.rowsStats, this._lastSentRowsStatsSize ?? 0)
				: undefined;

		const success = await this.host.notify(
			DidChangeRowsNotification,
			{
				rows: graph.rows,
				avatars: avatarsChanged ? Object.fromEntries(graph.avatars) : undefined,
				downstreams: Object.fromEntries(graph.downstreams),
				refsMetadata: this._refsMetadata != null ? Object.fromEntries(this._refsMetadata) : this._refsMetadata,
				rowsStats: rowsStatsDelta,
				rowsStatsLoading:
					graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,
				rowsStatsIncluded: graph.includes?.stats === true,

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
		// Only advance the last-sent counters on confirmed delivery. When `notify` returns false
		// (webview not ready / postMessage failed), the message is requeued by type so a later
		// notification REPLACES it — if we'd advanced counters speculatively, the replacement's
		// delta would skip avatars/rowsStats the webview never received.
		if (success) {
			this._lastSentAvatarsSize = avatarsSize;
			this._lastSentRowsStatsSize = rowsStatsSize;
		}
		return success;
	}

	@trace({ args: false })
	private async notifyDidChangeRowsStats(graph: GitGraph) {
		if (graph.rowsStats == null) return;

		// Deferred-stats path: also ship a delta of just the keys added since the previous send
		// so a 100k-commit repo's stats-loading completion doesn't ship the full Map again.
		// Frontend reducer for `rowsStats` is spread-merge.
		const rowsStatsSize = graph.rowsStats.size;
		const lastSent = this._lastSentRowsStatsSize ?? 0;
		const delta = rowsStatsSize > lastSent ? takeEntriesAfter(graph.rowsStats, lastSent) : undefined;

		if (delta == null) {
			// No new entries — just ship the loading flag. The counter doesn't need to advance.
			return this.host.notify(DidChangeRowsStatsNotification, {
				rowsStats: {},
				rowsStatsLoading:
					graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,
			});
		}

		const success = await this.host.notify(DidChangeRowsStatsNotification, {
			rowsStats: delta,
			rowsStatsLoading: graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,
		});
		// See `notifyDidChangeRows` — only advance on confirmed delivery so a replaced-pending
		// notification doesn't leave the webview missing rowsStats entries.
		if (success) {
			this._lastSentRowsStatsSize = rowsStatsSize;
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
					if (w.type === 'bare') return [w.uri.fsPath, undefined] as const;

					// Route through `_wipStatusCache` so the worktrees panel shares status data
					// with the WIP/overview paths — when the per-event push has just populated the
					// cache for this worktree, the panel fetch is free.
					const path = w.uri.fsPath;
					const svc = this.container.git.getRepositoryService(path);
					const status = await this._wipStatusCache.getOrCreate(path, (_cacheable, factorySignal) =>
						svc.status.getStatus(undefined, factorySignal),
					);
					const entry: SidebarWorktreeChange | undefined =
						status != null
							? { hasChanges: status.files.length > 0, workingTreeState: status.diffStatus }
							: undefined;
					return [path, entry] as const;
				}),
			);

			const changes: Record<string, SidebarWorktreeChange | undefined> = {};
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
	 * Coalesces concurrent triggers into a single in-flight call, with a trailing-edge re-fire
	 * when more triggers arrive while one is running. Crucially does NOT cancel the in-flight
	 * call — cancelling a `git status` mid-flight would return undefined and we'd skip the
	 * notification, leaving the webview's WIP view one tick behind reality. The previous
	 * `createCancellation('workingTree')` pattern was the source of that storm.
	 */
	private _wipNotifyInFlight?: Promise<boolean>;
	private _wipNotifyDirty = false;
	/** Last-sent payload — used to skip identical pushes. Working-tree watchers fire on any FS
	 *  event in the repo (file saves, branch metadata writes, lock-file twiddles), so most ticks
	 *  produce an unchanged status. Without this gate the webview re-renders the WIP details
	 *  panel on every tick even though nothing visible changed. Same intent as `_lastSentBranchState`
	 *  / `_lastSentWipDrafts`, but stamped AFTER notify resolves (with a repo-identity re-check)
	 *  to avoid poisoning the cache on transport failure or repo swap mid-await. Reset alongside
	 *  `_lastSentWipDrafts` in `setGraph(undefined)`. */
	private _lastSentWipNotificationParams: DidChangeWorkingTreeParams | undefined;

	private notifyDidChangeWorkingTree(): Promise<boolean> {
		if (this._wipNotifyInFlight != null) {
			this._wipNotifyDirty = true;
			return this._wipNotifyInFlight;
		}

		const run = this.runNotifyDidChangeWorkingTree().finally(() => {
			this._wipNotifyInFlight = undefined;
			if (this._wipNotifyDirty) {
				this._wipNotifyDirty = false;
				void this.notifyDidChangeWorkingTree();
			}
		});
		this._wipNotifyInFlight = run;
		return run;
	}

	/** Recovery for transient initial-state cancellations. Fires once shortly after a `getState`
	 *  whose `getWorkingTreeStatsAndPausedOperations` returned undefined — without it, the
	 *  webview would sit on `workingTreeStats: undefined` (and the header/row badges would render
	 *  nothing) until an unrelated FS event happened to trigger the watcher.
	 *
	 *  Resets the dedup cache before re-notifying so a prior stale-but-non-null
	 *  `_lastSentWipNotificationParams` (e.g. a partial push during ready-up) can't dedup-equal
	 *  the corrective payload and suppress it — the whole point of the retry is to force a
	 *  fresh push through. The repo-identity guard inside `runNotifyDidChangeWorkingTree` still
	 *  protects against pushing for a stale repo if the user swapped during the 500ms window. */
	private scheduleInitialWorkingTreeStatsRetry(): void {
		setTimeout(() => {
			if (this._disposed || this.repository == null) return;

			this._lastSentWipNotificationParams = undefined;
			void this.notifyDidChangeWorkingTree();
		}, 500);
	}

	@trace()
	private async runNotifyDidChangeWorkingTree(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeWorkingTreeNotification, this._ipcNotificationMap, this);
			return false;
		}

		const repo = this.repository;
		if (repo == null || !this.container.git.repositoryCount) return false;

		// Working-tree event means this repo's status has changed; drop any cached `_wipStatusCache`
		// entry so the fetch below sees fresh data. Mirrors the secondary worktree watcher's
		// invalidate-then-refetch pattern (see `_wipWatches` setup) — without this, rapid-succession
		// primary edits within the 10s TTL would serve stale data through the per-event push.
		this._wipStatusCache.invalidate(repo.path);

		// Single `git status` per working-tree tick. The details panel previously did a second
		// `getWip` RPC after the host sent stats — both runs returned the same status data, just
		// derived differently. Pushing the full WIP here eliminates the round-trip AND removes
		// the dedup gymnastics that used to mis-skip mixed↔fully-staged transitions: the panel
		// just applies whatever the host last sent.
		const [wipAndStatsResult, wipMetadataBySha] = await Promise.all([
			this.getWipForRepoAndStats(repo),
			this.getWipMetadataBySha(),
		]);

		// Failed status fetch (cancelled / hard error) — skip the notification rather than pushing
		// a fabricated zero state. The next tick re-tries.
		if (wipAndStatsResult === undefined) return false;

		// Drop the push if the active repo changed during the await — pushing RepoA's WIP after
		// the user switched to RepoB would corrupt the webview's view of "what repo's WIP this is"
		// and pin the wrong payload in `_lastSentWipNotificationParams`, blocking the legitimate
		// next push for the new repo. The new repo's own watcher tick will produce a fresh push.
		if (this.repository !== repo) return false;

		// Overview entries for this repo's branch are updated inline by the webview's notification
		// handler from the same `wip` payload above (`mergeOverviewWipForRepo`). The previous bulk
		// fanout that re-probed every visible branch on every primary FS event is gone — non-live
		// entries (opened worktrees whose graph WIP row is off-screen) refresh lazily when the
		// overview panel becomes visible, served from `_wipStatusCache` when warm.
		const params: DidChangeWorkingTreeParams = {
			stats: wipAndStatsResult.stats,
			wipMetadataBySha: wipMetadataBySha,
			wip: wipAndStatsResult.wip,
			repoPath: repo.path,
		};
		// Skip identical pushes. Working-tree events fire on any FS write in the repo (file saves,
		// `.git/index.lock` twiddles, branch-metadata writes), so most ticks reproduce the prior
		// status verbatim. Comparing the whole params object is safe: `stats`, `wipMetadataBySha`,
		// and `wip` all derive from the same `git status` — when `wip` is unchanged the others are
		// too. Same dedup pattern as `_lastSentBranchState`.
		if (this._lastSentWipNotificationParams != null && areEqual(this._lastSentWipNotificationParams, params)) {
			return false;
		}

		// Stamp the cache only AFTER the notify resolves successfully (avoids cache poisoning on
		// transport failure — a stamped-then-failed pattern would skip the corrective next-tick
		// push when params haven't changed). Also re-check `this.repository === repo` inside the
		// `.then`: between the await starting and resolving, the user may have switched repos and
		// `setGraph(undefined)` may have cleared the cache. Without the re-check, the resolved-
		// successfully notify (for the OLD repo's payload) would re-pin stale params into the
		// just-cleared cache, blocking the NEW repo's first push.
		return this.host.notify(DidChangeWorkingTreeNotification, params).then(success => {
			if (success && this.repository === repo) {
				this._lastSentWipNotificationParams = params;
			}
			return success;
		});
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

			const branchType = getBranchOverviewType(
				branch,
				worktreesByBranch,
				this._overviewRecentThreshold,
				'OneYear',
			);
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

	/** Last value sent to the webview — seeds bulk state pushes without awaiting `gk`, and
	 *  doubles as a dedup sentinel for `notifyDidChangeCanInstallClaudeHook`. */
	private _lastCanInstallClaudeHook: boolean | undefined;

	@trace()
	private async notifyDidChangeCanInstallClaudeHook() {
		if (!this.host.visible) return;

		const claude = getContext('gitlens:agents:enabled', false) ? await getClaudeAgent() : undefined;
		const canInstall = claude?.detected === true && claude.hooksSupported && !claude.hooksInstalled;
		if (canInstall === this._lastCanInstallClaudeHook) return;

		this._lastCanInstallClaudeHook = canInstall;
		void this.host.notify(DidChangeCanInstallClaudeHook, canInstall);
	}

	@trace()
	private async notifyDidChangeState(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeNotification, this._ipcNotificationMap, this);
			return false;
		}

		// Coalesce: if a notify is already in flight, mark dirty so a trailing run picks up any
		// changes that landed mid-flight, then piggyback on the in-flight promise.
		if (this._pendingStateNotify != null) {
			this._stateNotifyDirty = true;
			return this._pendingStateNotify;
		}

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

		// Reset before kicking off the in-flight build so calls that arrive during this run flip it back on.
		this._stateNotifyDirty = false;

		const promise = (async () => {
			try {
				// Snapshot before `getState()` so a mid-rebuild event leaves a delta for the trailing run.
				const seqAtRebuildStart = this._sidebarEventCounter.current;

				const op = this.getState();
				this._pendingStateOp = op;
				const state = await op;

				// `setGraph(data)` has run inside `getState()`, so the webview's refetch will read the
				// fresh graph. Commit the *captured* value (not current) so a mid-rebuild event remains
				// unfired for the trailing run.
				if (seqAtRebuildStart !== this._firedSidebarEventSeq) {
					this._firedSidebarEventSeq = seqAtRebuildStart;
					this.notifySidebarInvalidated();
				}

				// Identity fingerprint of the rows/avatars/downstreams payload: when this matches the
				// last successful send, the webview already has identical row data — re-shipping is
				// pure waste. On a real ~50k-commit repo this single check drops repeat-event state
				// pushes from ~12 MB to a few KB. Cheap to compute (4 numeric fields + 2 SHAs); the
				// webview's `updateState` only iterates `partial`'s own keys, so omitted fields are
				// preserved on the webview side without further changes.
				const fingerprint =
					state.rows != null
						? buildGraphFingerprint(
								state.rows,
								state.avatars != null ? Object.keys(state.avatars).length : 0,
								state.downstreams,
								state.rowsStatsLoading === true,
								this.getFiltersByRepo(this._graph?.repoPath)?.pinnedRef?.id,
							)
						: undefined;
				const skipRows = fingerprint != null && fingerprint === this._lastSentGraphFingerprint;
				if (skipRows) {
					state.rows = undefined;
					state.avatars = undefined;
					state.downstreams = undefined;
					state.rowsStats = undefined;
					state.rowsStatsLoading = undefined;
					state.rowsStatsIncluded = undefined;
					state.paging = undefined;
				}

				const result = await this.host.notify(DidChangeNotification, { state: state });
				this._lastStateSentAt = performance.now();
				this._lastSentBranchState = state.branchState;
				if (fingerprint != null) {
					this._lastSentGraphFingerprint = fingerprint;
				}

				// Refresh canInstallClaudeHook asynchronously so the bulk push doesn't block on `gk`.
				// Dedups internally — only fires `DidChangeCanInstallClaudeHook` when the value diverges.
				void this.notifyDidChangeCanInstallClaudeHook();
				return result;
			} finally {
				this._pendingStateNotify = undefined;
				this._pendingStateOp = undefined;
				// Trailing run: if a change arrived during the in-flight notify, kick off another pass so
				// the late change isn't silently lost. Routes through the same freshness gate, so rapid-fire
				// dirty marks still coalesce against the 500ms window.
				if (this._stateNotifyDirty) {
					this._stateNotifyDirty = false;
					void this.notifyDidChangeState();
				}
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
			detailsLocation: configuration.get('graph.details.location') ?? 'right',
			enabledRefMetadataTypes: this.getEnabledRefMetadataTypes(),
			dimMergeCommits: configuration.get('graph.dimMergeCommits'),
			experimentalKanbanEnabled: configuration.get('graph.experimental.kanban.enabled') ?? false,
			experimentalVisualizationsEnabled: configuration.get('graph.experimental.visualizations.enabled') ?? false,
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

	@trace({ exit: r => `secondaryWorktrees=${Object.keys(r).length}` })
	private async getWipMetadataBySha(cancellation?: CancellationToken): Promise<GraphWipMetadataBySha> {
		const result: GraphWipMetadataBySha = {};
		// Capture the active repo at entry so the post-await reads below see a stable target. If
		// the user switches repos while `getWorktrees` is in flight, `this.repository` may have
		// moved to a different repo by the time we filter and assemble — the captured `repo` keeps
		// the function's output internally consistent (matches the worktrees it just fetched).
		const repo = this.repository;
		if (repo == null) return result;

		const worktrees = await repo.git.worktrees?.getWorktrees(toAbortSignal(cancellation));
		if (!worktrees?.length) return result;

		// All known worktrees other than the primary (which is already covered by workingTreeStats).
		// Emit row-anchor metadata only; workDirStats are fetched on-demand via GetWipStatsRequest
		// when the GK component fires onWipShasMissingStats for visible rows.
		// Always return an object (empty when no secondaries) — undefined would be dropped by
		// JSON.stringify, and the webview's `DidChangeNotification` handler only refreshes
		// `wipMetadataBySha` when the field is present, so removing the last secondary worktree
		// would leave a phantom anchor in the webview state until another full push arrived.
		for (const wt of worktrees) {
			if (wt.type === 'bare' || wt.sha == null) continue;
			if (wt.path === repo.path) continue;

			// Use the MAIN repo's path for branchRef so it matches the format scope uses (see
			// `setScope` in graph-app.ts) — `GitWorktree.repoPath` is the main repo's path anyway.
			// Detached worktrees have no `wt.branch`; leaving `branchRef` undefined defers them
			// to the graph component's SHA filter.
			const branchName = wt.branch?.name;
			result[createSecondaryWipSha(wt.path)] = {
				repoPath: wt.path,
				parentSha: wt.sha,
				label: wt.name,
				branchRef: branchName != null ? getBranchId(repo.path, false, branchName) : undefined,
				context: serializeWebviewItemContext<GraphItemContext>({
					webviewItem: 'gitlens:wip+worktree',
					webviewItemValue: {
						type: 'commit',
						ref: this.getRevisionReference(wt.path, uncommitted, 'work-dir-changes')!,
						worktreePath: wt.path,
					},
				}),
			};
		}

		return result;
	}

	/**
	 * Builds the full WIP payload and derived stats from a single `git status` call. Used by
	 * both `runNotifyDidChangeWorkingTree` (pushed to the webview every working-tree tick) and
	 * the inspect `getWip` (cold-load path on first WIP selection). Consolidating into one
	 * helper avoids a second `git status` per event — the panel used to fetch `getWip` after
	 * receiving the stats notification, running the same query twice.
	 */
	private async getWipForRepoAndStats(
		repo: GlRepository,
		signal?: AbortSignal,
		options?: { bypassCache?: boolean },
	): Promise<{ wip: Wip; stats: GraphWorkingTreeStats } | undefined> {
		signal?.throwIfAborted();

		const svc = this.container.git.getRepositoryService(repo.path);
		// Route `getStatus` through `_wipStatusCache` so every WIP/overview/worktrees code path
		// shares the same status data within the cache's TTL — FS-watcher invalidations keep it
		// honest, and the lazy overview-panel-visibility refresh + worktrees-panel fetch get
		// served from cache when warm (often right after we just populated it here).
		//
		// `bypassCache` (user-initiated refresh) runs a separate `git status` OUTSIDE the cache.
		// We don't invalidate or write back — invalidate would fire the shared `AbortAggregate`
		// and could cancel a concurrent watcher fetch; a write-back is unsafe because the prior
		// in-flight entry's settle handler can delete our freshly-set value. Other consumers
		// self-correct within the cache TTL via the next FS-watcher tick.
		const statusFetch = options?.bypassCache
			? svc.status.getStatus(undefined, signal)
			: this._wipStatusCache.getOrCreate(
					repo.path,
					(_cacheable, factorySignal) => svc.status.getStatus(undefined, factorySignal),
					{ cancellation: signal },
				);
		const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
			statusFetch,
			// `force` so a missed `'pausedOp'` FS-watcher tick (common on secondary worktrees
			// whose `GlRepository` is closed) can't leave the WIP row stuck on a stale indicator.
			svc.pausedOps?.getPausedOperationStatus?.({ force: true }, signal),
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

		const branch = await repo.git.branches.getBranch(status.branch, signal);
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

		const branchRemote = branch != null ? await getBranchRemote(this.container, branch) : undefined;
		signal?.throwIfAborted();

		const diff = status.diffStatus;

		// Build the stats once and embed the SAME object reference in both `wip.stats` and the
		// sibling `stats` field. The webview derives `workingTreeStats` from `wip.stats`, so the
		// file list and its counts can never drift — they're one object. The sibling is kept for
		// callers that destructure `{ wip, stats }` (refresh / cold-load paths).
		const stats: WipStats = {
			added: diff.added,
			deleted: diff.deleted,
			modified: diff.changed,
			hasConflicts: status.hasConflicts,
			conflictsCount: status.hasConflicts ? status.conflicts.length : undefined,
			pausedOpStatus: pausedOpStatus,
			context: serializeWebviewItemContext<GraphItemContext>({
				webviewItem: 'gitlens:wip',
				webviewItemValue: {
					type: 'commit',
					ref: this.getRevisionReference(repo.path, uncommitted, 'work-dir-changes')!,
					worktreePath: repo.path,
				},
			}),
		};

		return {
			wip: {
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
					isWorktree: repo.isWorktree,
					provider:
						branchRemote?.provider != null
							? {
									supportedFeatures: {
										createPullRequestWithDetails:
											branchRemote.provider.supportedFeatures?.createPullRequestWithDetails,
									},
								}
							: undefined,
				},
				stats: stats,
			},
			stats: stats,
		};
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
			// `force` so a missed `'pausedOp'` FS-watcher tick can't leave the primary's working-tree
			// badges stuck on a stale in-progress indicator after a CLI-driven completion.
			svc.pausedOps?.getPausedOperationStatus?.({ force: true }, toAbortSignal(cancellation)),
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
			conflictsCount: status?.hasConflicts ? status.conflicts.length : undefined,
			pausedOpStatus: pausedOpStatus,
			context: serializeWebviewItemContext<GraphItemContext>({
				webviewItem: 'gitlens:wip',
				webviewItemValue: {
					type: 'commit',
					ref: this.getRevisionReference(this.repository.path, uncommitted, 'work-dir-changes')!,
					worktreePath: this.repository.path,
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

		let selectionChanged = false;

		if (
			!this._honorSelectedId &&
			searchRequest == null &&
			this._selectedId !== uncommitted &&
			configuration.get('graph.initialRowSelection') === 'wip'
		) {
			selectionChanged = true;
			this.setSelectedRows(uncommitted);
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);

		const dataPromise = this.repository.git.graph.getGraph(
			this._selectedId,
			{
				include: {
					stats:
						(configuration.get('graph.minimap.enabled') &&
							configuration.get('graph.minimap.dataType') === 'lines' &&
							this.isMinimapVisible()) ||
						!columnSettings.changes.isHidden ||
						this._displayMode === 'visualizations',
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
			this.getWorkingTreeStatsAndPausedOperations(undefined, cancellation.token),
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

					// Don't clobber an honored selection if `data.id` ever diverges (slow await, scope/filter shifts, dropped SHAs)
					if (!this._honorSelectedId && this._selectedId !== data.id) {
						selectionChanged = true;
						this.setSelectedRows(data.id);
					}

					void this.notifyDidChangeRefsVisibility();
					void this.notifyDidChangePinnedRef();
					void this.notifyDidChangeRows(selectionChanged);
					// Commit so the next `notifyDidChangeState` doesn't double-fire for events covered
					// by this rebuild's invalidation.
					this._firedSidebarEventSeq = this._sidebarEventCounter.current;
					this.notifySidebarInvalidated();
				} catch {}
			});
		} else {
			data = await dataPromise;
			this.setGraph(data);

			if (!this._honorSelectedId && this._selectedId !== data.id) {
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
					const fallbackBranchState: BranchState = branchState;
					void maybePr.value.then(pr => {
						if (branchStateCancellation?.token.isCancellationRequested) return;

						if (pr != null) {
							// Merge `pr` into the most recently sent branchState so we don't clobber
							// fresher ahead/behind/upstream values shipped by a later state notify.
							const base = this._lastSentBranchState ?? fallbackBranchState;
							void this.notifyDidChangeBranchState({ ...base, pr: serializePullRequest(pr) });
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
		this._overviewRecentThreshold = storedGraphState?.overview?.recentThreshold ?? 'OneWeek';

		// If the underlying fetch returned undefined (cancelled/failed), leave `workingTreeStats`
		// undefined rather than fabricating a confident `{0,0,0}` — `gl-wip-stats` renders
		// `nothing` for an all-undefined state, which is honest. A misleading clean ✓ would stick
		// until the next FS event landed, and there's no guarantee one will: if the user already
		// had changes when the webview loaded, the working tree won't change of its own accord.
		// The one-shot retry below also seeds an authoritative push shortly after init to recover
		// from transient cancellations during ready-up.
		const resolvedWorkingTreeStats = getSettledValue(workingStatsResult);
		if (resolvedWorkingTreeStats == null) {
			this.scheduleInitialWorkingTreeStatsRetry();
		}

		const graphWalkthroughBanner = this.getGraphWalkthroughBannerState();

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
			rowsStatsIncluded: data?.includes?.stats === true,
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
			workingTreeStats: resolvedWorkingTreeStats,
			wipMetadataBySha: getSettledValue(wipMetadataResult),
			searchMode: searchMode,
			useNaturalLanguageSearch: useNaturalLanguageSearch,
			featurePreview: featurePreview,
			orgSettings: this.getOrgSettings(),
			overview: this.getOverviewData(),
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
			wipDrafts: this.sliceWipDraftsForPanel(),
			timeline: {
				period: storedGraphState?.timeline?.period,
				sliceBy: storedGraphState?.timeline?.sliceBy,
				showAllBranches: storedGraphState?.timeline?.showAllBranches,
			},
			overviewRecentThreshold: this._overviewRecentThreshold,
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
		this.writeWipDraftToStorage(params.worktreePath, params.draft);
	}

	/** Read-merge-write of `graph:wipDrafts` for one worktree's slot. Pass `draft: null` to
	 *  delete the slot. Used by the webview's `UpdateWipDraftCommand` handler AND by
	 *  host-initiated writes (Undo Commit) that need to persist a draft without waiting for the
	 *  webview to round-trip a flush. Key is the worktree's own fsPath — invariant across
	 *  whether the user opens the main repo or the worktree directly. */
	private writeWipDraftToStorage(worktreePath: string, draft: StoredGraphWipDraft | null): void {
		const current = this.container.storage.getWorkspace('graph:wipDrafts');
		const next = updateRecordValue(current, worktreePath, draft ?? undefined);
		void this.container.storage
			.storeWorkspace('graph:wipDrafts', next)
			.catch((ex: unknown) => Logger.error(ex, 'graph: failed to persist WIP draft'));
	}

	private pruneWipDraftsForRemovedRepos(removedPaths: string[]) {
		const current = this.container.storage.getWorkspace('graph:wipDrafts');
		if (current == null) return;

		let next = current;
		let changed = false;
		for (const path of removedPaths) {
			if (next[path] == null) continue;

			next = updateRecordValue(next, path, undefined);
			changed = true;
		}
		if (!changed) return;

		void this.container.storage
			.storeWorkspace('graph:wipDrafts', next)
			.catch((ex: unknown) => Logger.error(ex, 'graph: failed to prune WIP drafts'));
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
		this.notifySidebarInvalidated();
		this.updateState(true);
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
		this._lastStateSentAt = undefined;
		this._pendingStateNotify = undefined;
		this._pendingStateOp = undefined;
		this._stateNotifyDirty = false;
		this._lastSentBranchState = undefined;
		this._lastSentGraphFingerprint = undefined;
		// Not resetting `_sidebarEventCounter` / `_firedSidebarEventSeq`: an in-flight rebuild has
		// already captured its `seqAtRebuildStart` and will commit it as the fired watermark — zeroing
		// here would strand the next repo's events below it. Monotonic growth is safe; only deltas matter.
		this._lastFetchedHandlerDebounced?.cancel();
		this._graphDetailsDiffCache.clear();
		this.invalidateScopeAnchors();
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
			// Reset the per-Map "last-sent size" counters only when the graph is cleared. Repo swaps
			// route through `resetRepositoryState` → `setGraph(undefined)` first, so this branch
			// covers them. Pagination (which calls `setGraph(updatedGraph)` directly with a new
			// `GitGraph` instance that EXTENDS the prior content) must NOT reset — otherwise the
			// next `notifyDidChangeRows` re-ships the full cumulative Maps instead of just the
			// page-delta, defeating Phase 7's primary perf win.
			this._lastSentAvatarsSize = undefined;
			this._lastSentRowsStatsSize = undefined;
			this._lastSentWipDrafts = undefined;
			this._lastSentWipDraftsInitialized = false;
			this._lastSentWipNotificationParams = undefined;
			this._graphLoading = undefined;
			this.resetHoverCache();
			this.resetRefsMetadata();
			this.resetSearchState();
			this.cancelOperation('computeIncludedRefs');
			this._wipStatusCache.clear();
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

		// Worktree sidebar rows carry the worktree path on their ref context — prefer that
		if (isGraphItemRefContext(item)) {
			const values = item.webviewItemsValues?.length
				? item.webviewItemsValues.map(i => i.webviewItemValue)
				: [item.webviewItemValue];
			const paths = values
				.map(v => ('worktreePath' in v ? v.worktreePath : undefined))
				.filter((p): p is string => p != null);
			if (paths.length > 0 && paths.length === values.length) {
				data = paths.join('\n');
			}
		}

		if (data == null) {
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
		// `getOrderedComparisonRefs` returns `[newer, older]`. Compare convention is
		// `leftRef = Base (older)`, `rightRef = Compare (newer)`, so older goes on the left.
		const [newer, older] = await getOrderedComparisonRefs(
			this.container,
			commit1.repoPath,
			commit1.ref,
			commit2.ref,
		);

		return this.notifyOpenCompareMode({
			repoPath: commit1.repoPath,
			leftRef: older,
			leftRefType: 'commit',
			rightRef: newer,
			rightRefType: 'commit',
		});
	}

	@command('gitlens.pausedOperation.abort:')
	@debug()
	private async abortPausedOperation(pausedOpArgs?: GitPausedOperationStatus) {
		const repoPath = pausedOpArgs?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		await abortPausedOperation(svc);
	}

	@command('gitlens.pausedOperation.continue:')
	@debug()
	private async continuePausedOperation(pausedOpArgs?: GitPausedOperationStatus) {
		const repoPath = pausedOpArgs?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		const type = pausedOpArgs?.type ?? (await svc.pausedOps?.getPausedOperationStatus?.())?.type;
		if (type == null || type === 'revert') return;

		await continuePausedOperation(svc);
	}

	@command('gitlens.pausedOperation.open:')
	@debug()
	private async openRebaseEditor(pausedOpArgs?: GitPausedOperationStatus) {
		const repoPath = pausedOpArgs?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		const type = pausedOpArgs?.type ?? (await svc.pausedOps?.getPausedOperationStatus?.())?.type;
		if (type !== 'rebase') return;

		const gitDir = await svc.config.getGitDir?.();
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	@command('gitlens.pausedOperation.skip:')
	@debug()
	private async skipPausedOperation(pausedOpArgs?: GitPausedOperationStatus) {
		const repoPath = pausedOpArgs?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		await skipPausedOperation(svc);
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

		// For non-active worktrees, the active-repo working-tree watcher won't fire, so the
		// host's regular `DidChangeWorkingTreeNotification` won't reach the panel. Fetch the
		// updated WIP for this specific repo and push it directly — one `git status`, no
		// round-trip from the panel.
		const repo =
			this.container.git.getRepository(value.repoPath) ??
			(await this.container.git.getOrOpenRepository(Uri.file(value.repoPath), { closeOnOpen: true }));
		const result = repo != null ? await this.getWipForRepoAndStats(repo) : undefined;
		// Ship `stats` alongside `wip` so the webview never has to re-derive them — the host
		// just did the work, the webview's classifier wouldn't match `git diff --shortstat`
		// semantics for renames/conflicts, and the derived value would drop `pausedOpStatus` /
		// `context` (real visible regressions during a paused op).
		void this.host.notify(DidRequestWipRefetchNotification, {
			repoPath: value.repoPath,
			wip: result?.wip,
			stats: result?.stats,
		});
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

	@command('gitlens.shareWipAsCloudPatch:')
	@debug()
	private async shareWipAsCloudPatch(args?: { repoPath?: string }) {
		const repo = args?.repoPath != null ? this.container.git.getRepository(args.repoPath) : this.repository;
		if (repo == null) return;

		const status = await repo.git.status.getStatus();
		if (status == null) {
			void window.showErrorMessage('Unable to create cloud patch');
			return;
		}

		const files: GitFileChangeShape[] = [];
		for (const file of status.files) {
			const change = {
				repoPath: file.repoPath,
				path: file.path,
				status: file.status,
				originalPath: file.originalPath,
				staged: file.staged,
			};

			files.push(change);
			if (file.staged && file.wip) {
				files.push({ ...change, staged: false });
			}
		}

		const change: Change = {
			type: 'wip',
			repository: {
				name: repo.name,
				path: repo.path,
				uri: repo.uri.toString(),
			},
			files: files,
			revision: { to: uncommitted, from: 'HEAD' },
		};

		void showPatchesView({ mode: 'create', create: { changes: [change] } });
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

	@command('gitlens.graph.pinBranchToEdge')
	@debug()
	private pinBranchToEdge(item?: GraphItemContext) {
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

	@command('gitlens.graph.unpinBranchFromEdge')
	@debug()
	private unpinBranchFromEdge(_item?: GraphItemContext) {
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
		if (ref == null) return;

		// `createWipSha` needs the graph's anchor repo path to distinguish the primary
		// 'work-dir-changes' sha from a secondary `worktree-wip::<path>` sha. NEVER coalesce the
		// second arg to `ref.repoPath` — `createWipSha(p, p)` collapses to `uncommitted` and we'd
		// emit a primary-WIP sha for what is actually a secondary worktree. Use the bound
		// repository's path rather than `this._graph?.repoPath` — the Repository is set when the
		// webview activates, well before graph data loads, and is always present by the time the
		// context-menu reaches this command.
		const wipSha = createWipSha(ref.repoPath, this.repository?.path);

		await undoCommit(this.container, ref, {
			onBeforeReset: message => {
				// Batch the selection move, draft seed, and details-panel open before the reset
				// fires its file-watcher event, so the webview sees one coherent transition rather
				// than three across the refresh boundary. `_honorSelectedId = true` protects the
				// WIP selection from the post-refresh `data.id` override at getState().
				// `writeWipDraftToStorage` is the durable mirror of the webview-side flush so the
				// message persists across sessions even if the user never edits.
				this.writeWipDraftToStorage(ref.repoPath, { message: message, messageDirty: true });
				this._honorSelectedId = true;
				this.setSelectedRows(wipSha);
				void this.notifyDidChangeSelection();
				void this.host.notify(DidRequestGraphActionNotification, {
					action: 'show-wip',
					target: { sha: wipSha, worktreePath: ref.repoPath },
					commitMessage: message,
				});
			},
		});
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

		// Convention: leftRef = Base (older), rightRef = Compare (newer / has WT). The merge base
		// is the older anchor; the current branch carries the working tree.
		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: commonAncestor,
			leftRefType: 'commit',
			rightRef: currentBranch.ref,
			rightRefType: 'branch',
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

		// `getOrderedComparisonRefs` returns `[newer, older]`. Convention is leftRef = Base (older),
		// rightRef = Compare (newer), so the older ref lands on the left.
		const [newer, older] = await getOrderedComparisonRefs(this.container, currentRepoPath, headRef, ref.ref);
		const newerIsHead = newer === headRef;
		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: older,
			leftRefType: newerIsHead ? this.graphCompareRefType(ref.refType) : 'branch',
			rightRef: newer,
			rightRefType: newerIsHead ? 'branch' : this.graphCompareRefType(ref.refType),
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

		// Convention: leftRef = Base (older = merge base), rightRef = Compare (newer = clicked ref).
		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: commonAncestor,
			leftRefType: 'commit',
			rightRef: ref.ref,
			rightRefType: this.graphCompareRefType(ref.refType),
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
				// Convention: leftRef = Base (upstream / what we're comparing against),
				// rightRef = Compare (local branch we want to inspect for divergence).
				return this.notifyOpenCompareMode({
					repoPath: ref.repoPath,
					leftRef: ref.upstream.name,
					leftRefType: 'branch',
					rightRef: ref.ref,
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
		//
		// Convention: leftRef = Base (the clicked ref we're comparing against),
		// rightRef = Compare (the current branch, which carries the working tree).
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const currentBranch = await this.container.git.getRepositoryService(currentRepoPath).branches.getBranch();

		await this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: ref.ref,
			leftRefType: 'branch',
			rightRef: currentBranch?.ref ?? 'HEAD',
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

	@command('gitlens.reviewChanges:')
	private reviewChangesCommand(item?: GraphItemContext) {
		return this.reviewChanges(item);
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
						commits.push({ sha: sha, message: c.message ?? '' });
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
	private async openWorktree(
		item?: GraphItemContext | BranchRef | { worktreeUri: string },
		options?: { location?: OpenWorkspaceLocation },
	) {
		// Webview action-link path (WIP details header): worktree identity arrives as a full URI
		// string — no branch lookup needed (so this also covers detached-HEAD worktrees), and the
		// scheme is preserved so remote-development worktrees (vscode-remote://, etc.) open on the
		// right host instead of falling back to a local file path.
		if (item != null && typeof item === 'object' && 'worktreeUri' in item && typeof item.worktreeUri === 'string') {
			openWorkspace(Uri.parse(item.worktreeUri), options);
			return;
		}

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
			// Secondary WIP row: ref.ref is `uncommitted` AND ref.repoPath is the worktree's own
			// path. Detached worktree (commit row): resolve by sha. (Menu gating prevents the
			// primary-WIP case from reaching here, so it's not handled.)
			const { ref } = item.webviewItemValue;
			const worktree =
				ref.ref === uncommitted
					? this._graph?.worktrees?.find(w => w.path === ref.repoPath)
					: this._graph?.worktrees?.find(w => w.sha === ref.ref);
			if (worktree == null) return;

			openWorkspace(worktree.uri, options);
		}
	}

	@command('gitlens.openWorktreeInNewWindow:')
	private openWorktreeInNewWindow(item?: GraphItemContext | BranchRef | { worktreeUri: string }) {
		return this.openWorktree(item, { location: 'newWindow' });
	}

	@command('gitlens.openInIntegratedTerminal:')
	@debug()
	private openInIntegratedTerminal(item?: GraphItemContext | { worktreeUri: string }) {
		// Header button path: a full URI string is provided so remote-dev schemes are preserved.
		if (item != null && typeof item === 'object' && 'worktreeUri' in item && typeof item.worktreeUri === 'string') {
			return executeCoreCommand('openInIntegratedTerminal', Uri.parse(item.worktreeUri));
		}

		// Context-menu path: the WIP row's ref carries the worktree's own repoPath.
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCoreCommand('openInIntegratedTerminal', Uri.file(ref.repoPath));
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

		// Open the in-graph compose mode for the row that was right-clicked. For a secondary WIP
		// row `ref.repoPath` is that worktree's path; for the primary it's the main repo path.
		// The webview routes via `enterModeForWip(compose, repoPath, uncommitted)` — matching the
		// inline Compose-button path (`handleWipRowOpen`) so context-menu and button stay aligned.
		await this.host.notify(DidRequestGraphActionNotification, {
			action: 'enter-compose',
			target: { sha: uncommitted, worktreePath: ref.repoPath },
		});
	}

	@debug()
	private async reviewChanges(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		// Mirrors `composeCommits` but enters the review mode instead — the webview routes via
		// `enterModeForWip('review', repoPath, uncommitted)`, matching the in-header `review` chip.
		await this.host.notify(DidRequestGraphActionNotification, {
			action: 'enter-review',
			target: { sha: uncommitted, worktreePath: ref.repoPath },
		});
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
			// Secondary WIP row: ref.ref is `uncommitted` AND ref.repoPath is the worktree's own
			// path (different from the main repo path). Resolve by path. Primary WIP also has
			// ref.ref === uncommitted but ref.repoPath === main repo path — keep the original
			// `undefined` return so `explainWip` etc. don't pick up the primary worktree and
			// change their existing behavior.
			if (ref.ref === uncommitted && ref.repoPath !== this._graph?.repoPath) {
				return this._graph?.worktrees?.find(w => w.path === ref.repoPath);
			}
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

/**
 * Build a Record of entries that were appended to `map` after position `skip`. Relies on
 * Map iteration being insertion-order-stable: any entry at index >= `skip` is by definition
 * one that was added since the prior snapshot, assuming append-only writes between snapshots
 * (which is the case for the graph's `avatars` and `rowsStats` Maps; NOT for `downstreams`,
 * which mutates existing arrays — see notifyDidChangeRows).
 */
function takeEntriesAfter<V>(map: Map<string, V>, skip: number): Record<string, V> {
	const result: Record<string, V> = {};
	if (skip >= map.size) return result;

	let i = 0;
	for (const [k, v] of map) {
		if (i >= skip) {
			result[k] = v;
		}
		i++;
	}
	return result;
}

/**
 * Content fingerprint of the graph-payload fields a webview cares about. When this matches the
 * prior successful send, the webview already has identical row data and we can omit rows + the
 * other large fields from the next state push entirely.
 *
 * Must catch every webview-observable row change:
 *   - row added/removed → `rowCount`/`first`/`last` shift
 *   - branch tip moved without commit → the head row's `heads` entry shifts row
 *   - tag added/removed/renamed → a row's `tags` entry changes
 *   - remote branch added/updated → `remotes` entries shift
 *   - new contributor avatar resolved → `avatars` map grows
 *   - downstream tracking changed → `downstreams` keys/values shift
 *   - worktree added/removed for a branch → `heads[].worktreeId` flips
 *   - stats-loading flag flipped → ship the new loading state
 *
 * To stay cheap, the per-row scan only emits a signature for rows that ACTUALLY carry refs —
 * which on a real graph is a tiny fraction of the loaded rows (just branch tips and tagged
 * commits). Net cost is O(refs across loaded rows), typically <1ms for 100k commits.
 */
function buildGraphFingerprint(
	rows: GraphRow[] | undefined,
	avatarCount: number,
	downstreams: ReadonlyMap<string, readonly string[]> | Readonly<Record<string, readonly string[]>> | undefined,
	statsLoading: boolean,
	pinnedRefId: string | undefined,
): string {
	const first = rows?.[0]?.sha ?? '';
	const last = rows?.at(-1)?.sha ?? '';
	const rowCount = rows?.length ?? 0;
	const downstreamCount =
		downstreams == null ? 0 : downstreams instanceof Map ? downstreams.size : Object.keys(downstreams).length;

	// Per-row ref signature: position-anchored short summary for rows that carry any head/tag/remote.
	// Captures: ref renames (different id at same sha), tip moves (refs disappear from one sha and
	// appear on another), tag set changes. Skipped for the bulk of rows that have no refs at all.
	// Pushed into an array and joined at the end so V8 doesn't rope-flatten on each `+=`.
	const parts: string[] = [
		`${rowCount}|${first}|${last}|${avatarCount}|${downstreamCount}|${statsLoading ? 1 : 0}|${pinnedRefId ?? ''}`,
	];
	if (rows != null) {
		for (const r of rows) {
			const hl = r.heads?.length;
			const tl = r.tags?.length;
			const rl = r.remotes?.length;
			// Stash rows never carry heads/tags/remotes; include them explicitly so a stash
			// drop in the middle of a limit-bound graph (where rowCount/first/last all stay put)
			// still busts the fingerprint and re-ships rows.
			const isStash = r.type === 'stash-node';
			if (!hl && !tl && !rl && !isStash) continue;

			parts.push(`|${r.sha}:`);
			if (isStash) {
				parts.push('S;');
			}
			if (hl) {
				for (const h of r.heads!) {
					// Include worktreeId (adding/removing a worktree flips it for an existing
					// branch) and isCurrentHead (HEAD moving between already-visible branches),
					// so either change busts the fingerprint and re-ships rows.
					parts.push(
						`H${h.id}${h.isCurrentHead ? '*' : ''}${h.worktreeId != null ? `@${h.worktreeId}` : ''};`,
					);
				}
			}
			if (tl) {
				for (const t of r.tags!) {
					parts.push(`T${t.id};`);
				}
			}
			if (rl) {
				for (const rr of r.remotes!) {
					parts.push(`R${rr.id};`);
				}
			}
		}
	}
	// Downstream tracking signature: sort upstream-branch keys for stable order, emit each upstream
	// + its downstream-branch list. Catches `git branch --set-upstream-to` and remote-rename cases
	// where the per-row scan above doesn't see the change (e.g. tip moved off the loaded page).
	if (downstreamCount > 0) {
		const entries: [string, readonly string[]][] =
			downstreams instanceof Map ? [...downstreams] : Object.entries(downstreams!);
		entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		for (const [k, v] of entries) {
			parts.push(`|D${k}=${v.join(',')};`);
		}
	}
	// Digest down to a 16-char hex hash so the stored fingerprint stays constant-size regardless
	// of repo scale. Comparison becomes O(1); memory cost goes from ~50-100 KB to 16 bytes.
	return fnv1aHash64(parts.join(''));
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
