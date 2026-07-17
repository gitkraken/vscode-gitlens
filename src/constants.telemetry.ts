import type { AIProviders } from '@gitlens/ai/constants.js';
import type { AIActionType } from '@gitlens/ai/models/model.js';
import type { GitContributionTiers } from '@gitlens/git/models/contributor.js';
import type { IntegrationIds, SupportedCloudIntegrationIds } from '@gitlens/integrations/constants.js';
import type { Flatten } from '@gitlens/utils/object.js';
import type { Config, GraphBranchesVisibility, GraphConfig } from './config.js';
import type { GlCommands, GlCommandsDeprecated } from './constants.commands.js';
import type { WalkthroughSteps } from './constants.js';
import type { SubscriptionState } from './constants.subscription.js';
import type {
	CustomEditorTypes,
	TreeViewTypes,
	WebviewPanelTypes,
	WebviewTypes,
	WebviewViewTypes,
} from './constants.views.js';
import type { GraphWalkthroughContextKeys, WalkthroughContextKeys } from './constants.walkthroughs.js';
import type { FeaturePreviews, FeaturePreviewStatus } from './features.js';
import type { AgentDescriptor, AgentRoute } from './plus/agents/agentDescriptor.js';
import type { OrganizationRole } from './plus/gk/models/organization.js';
import type { Subscription, SubscriptionAccount, SubscriptionStateString } from './plus/gk/models/subscription.js';
import type { GraphColumnConfig } from './webviews/plus/graph/protocol.js';
import type { TimelinePeriod, TimelineScopeType, TimelineSliceBy } from './webviews/plus/timeline/protocol.js';

export declare type AttributeValue =
	| string
	| number
	| boolean
	| Array<null | undefined | string>
	| Array<null | undefined | number>
	| Array<null | undefined | boolean>;
export type TelemetryEventData = Record<string, AttributeValue | null | undefined>;

export interface TelemetryGlobalContext extends SubscriptionEventData {
	'cloudIntegrations.connected.count': number;
	'cloudIntegrations.connected.ids': string;
	debugging: boolean;
	/** Cohort number between 1 and 100 to use for percentage-based rollouts */
	'device.cohort': number;
	enabled: boolean;
	featureFlags: string;
	prerelease: boolean;
	install: boolean;
	upgrade: boolean;
	upgradedFrom: string | undefined;
	'folders.count': number;
	'folders.schemes': string;
	'gk.mcp.registrationCompleted': boolean;
	'providers.count': number;
	'providers.ids': string;
	'repositories.count': number;
	'repositories.hasRemotes': boolean;
	'repositories.hasRichRemotes': boolean;
	'repositories.hasConnectedRemotes': boolean;
	'repositories.withRemotes': number;
	'repositories.withHostingIntegrations': number;
	'repositories.withHostingIntegrationsConnected': number;
	'repositories.remoteProviders': string;
	'repositories.schemes': string;
	'repositories.visibility': 'private' | 'public' | 'local' | 'mixed';
	'workspace.isTrusted': boolean;
}

export interface TelemetryEvents extends WebviewShowAbortedEvents, WebviewShownEvents, WebviewClosedEvents {
	/** Sent when account validation fails */
	'account/validation/failed': AccountValidationFailedEvent;

	/** Sent when GitLens is activated */
	activate: ActivateEvent;

	/** Sent when a lazily-loaded webpack chunk fails to load — typically because VS Code
	 * background-upgraded the extension while the host kept running the old build */
	'extension/chunkLoad/failed': ExtensionChunkLoadFailedEvent;

	/** Sent when explaining changes from wip, commits, stashes, patches, etc. */
	'ai/explain': AIExplainEvent;

	/** Sent when reviewing changes from wip, commits, or commit ranges */
	'ai/review': AIReviewEvent;

	/** Sent when generating summaries from commits, stashes, patches, etc. */
	'ai/generate': AIGenerateEvent;

	/** Sent when AI is enabled */
	'ai/enabled': void;

	/** Sent when switching ai models */
	'ai/switchModel': AISwitchModelEvent;

	/** Sent when a user provides feedback (rating and optional details) for an AI feature */
	'ai/feedback': AIFeedbackEvent;

	/** Sent when the user clicks "Get More Credits" on the weekly AI usage-limit notification */
	'ai/credits/addOnClicked': AICreditsNotificationEvent;
	/** Sent when the user dismisses the weekly AI usage-limit notification */
	'ai/credits/addOnDismissed': AICreditsNotificationEvent;

	/** Sent when user dismisses the AI All Access banner */
	'aiAllAccess/bannerDismissed': void;

	/** Sent when user opens the AI All Access page */
	'aiAllAccess/opened': void;

	/** Sent when user opts in to AI All Access */
	'aiAllAccess/optedIn': void;

	/** Sent when an agent hook is installed */
	'agents/hookInstalled': AgentProviderEvent;
	/** Sent when an agent hook is uninstalled */
	'agents/hookUninstalled': AgentProviderEvent;
	/** Sent when an agent session starts */
	'agents/session/started': AgentProviderEvent;
	/** Sent when an agent session ends */
	'agents/session/ended': AgentProviderEvent;
	/** Sent when a past agent session is resumed from its transcript */
	'agents/sessionResumed': AgentSessionResumedEvent;
	/** Sent when a permission request is resolved */
	'agents/permission/resolved': AgentPermissionResolvedEvent;
	/** Sent when a reconciliation poll (`list-sessions`) finds the polled session set differs from
	 *  what the live IPC hook path had already tracked. In a single window this should be rare and
	 *  usually means a hook event was dropped; a nonzero `sync.discovered` is expected in multi-window
	 *  setups, where the machine-wide poll can surface a session owned by another window that never
	 *  routed its hook events here — so don't treat every event as a dropped IPC signal */
	'agents/session/syncDiscrepancy': AgentSyncDiscrepancyEvent;

	/** Sent when a CLI install attempt is started */
	'cli/install/started': CLIInstallStartedEvent;
	/** Sent when a CLI install attempt succeeds */
	'cli/install/succeeded': CLIInstallSucceededEvent;
	/** Sent when a CLI install attempt fails */
	'cli/install/failed': CLIInstallFailedEvent;

	/** Sent when the CLI integration IPC server fails to start */
	'cli/ipc/failed': CLIIpcFailedEvent;
	/** Sent when the CLI integration discovery file fails to be created */
	'cli/discoveryFile/failed': CLIDiscoveryFileFailedEvent;

	/** Sent when a CLI update succeeds */
	'cli/updateCore/completed': CLIUpdateCoreCompletedEvent;
	/** Sent when a CLI update fails */
	'cli/updateCore/failed': CLIUpdateCoreFailedEvent;

	/** Sent when connecting to one or more cloud-based integrations */
	'cloudIntegrations/connecting': CloudIntegrationsConnectingEvent;

	/** Sent when connected to one or more cloud-based integrations from gkdev */
	'cloudIntegrations/connected': CloudIntegrationsConnectedEvent;

	/** Sent when disconnecting a provider from the api fails */
	'cloudIntegrations/disconnect/failed': CloudIntegrationsDisconnectFailedEvent;

	/** Sent when getting connected providers from the api fails */
	'cloudIntegrations/getConnections/failed': CloudIntegrationsGetConnectionsFailedEvent;

	/** Sent when getting a provider token from the api fails */
	'cloudIntegrations/getConnection/failed': CloudIntegrationsGetConnectionFailedEvent;

	/** Sent when refreshing a provider token from the api fails */
	'cloudIntegrations/refreshConnection/failed': CloudIntegrationsRefreshConnectionFailedEvent;

	/** Sent when a connection session has a missing expiry date
	 * or when connection refresh is skipped due to being a non-cloud session */
	'cloudIntegrations/refreshConnection/skippedUnusualToken': CloudIntegrationsRefreshConnectionSkipUnusualTokenEvent;

	/** Sent when a cloud-based hosting provider is connected */
	'cloudIntegrations/hosting/connected': CloudIntegrationsHostingConnectedEvent;
	/** Sent when a cloud-based hosting provider is disconnected */
	'cloudIntegrations/hosting/disconnected': CloudIntegrationsHostingDisconnectedEvent;
	/** Sent when a cloud-based issue provider is connected */
	'cloudIntegrations/issue/connected': CloudIntegrationsIssueConnectedEvent;
	/** Sent when a cloud-based issue provider is disconnected */
	'cloudIntegrations/issue/disconnected': CloudIntegrationsIssueDisconnectedEvent;
	/** Sent when a user chooses to manage the cloud integrations */
	'cloudIntegrations/settingsOpened': CloudIntegrationsSettingsOpenedEvent;

	/** Sent when a code suggestion is archived */
	codeSuggestionArchived: CodeSuggestArchivedEvent;
	/** Sent when a code suggestion is created */
	codeSuggestionCreated: CodeSuggestCreatedEventData;
	/** Sent when a code suggestion is opened */
	codeSuggestionViewed: CodeSuggestViewedEventData;

	/** Sent when a GitLens command is executed */
	command: CommandEvent;
	/** Sent when a VS Code command is executed by a GitLens provided action */
	'command/core': CoreCommandEvent;

	/** Sent when a commit is signed */
	'commit/signed': CommitSignedEvent;
	/** Sent when commit signing fails */
	'commit/signing/failed': CommitSigningFailedEvent;
	/** Sent when commit signing setup is completed */
	'commit/signing/setup': CommitSigningSetupEvent;
	/** Sent when commit signing setup wizard is opened */
	'commit/signing/setupWizard/opened': CommitSigningSetupWizardOpenedEvent;

	/** Sent when the Inspect view is shown */
	'commitDetails/shown': DetailsShownEvent;
	/** Sent when commit reachability is successfully loaded */
	'commitDetails/reachability/loaded': DetailsReachabilityLoadedEvent;
	/** Sent when commit reachability fails to load */
	'commitDetails/reachability/failed': DetailsReachabilityFailedEvent;

	/** Sent when the Commit Composer is first loaded with repo data */
	'composer/loaded': ComposerLoadedEvent;
	/** Sent when the Commit Composer is reloaded */
	'composer/reloaded': ComposerLoadedEvent;
	/** Sent when the user adds unstaged changes to draft commits in the Commit Composer */
	'composer/action/includedUnstagedChanges': ComposerEvent;
	/** Sent when the user uses auto-compose in the Commit Composer */
	'composer/action/compose': ComposerGenerateCommitsEvent;
	/** Sent when the user fails an auto-compose operation in the Commit Composer */
	'composer/action/compose/failed': ComposerGenerateCommitsFailedEvent;
	/** Sent when the user uses recompose in the Commit Composer */
	'composer/action/recompose': ComposerGenerateCommitsEvent;
	/** Sent when the user fails a recompose operation in the Commit Composer */
	'composer/action/recompose/failed': ComposerGenerateCommitsFailedEvent;
	/** Sent when the user uses generate commit message in the Commit Composer */
	'composer/action/generateCommitMessage': ComposerGenerateCommitMessageEvent;
	/** Sent when the user fails a generate commit message operation in the Commit Composer */
	'composer/action/generateCommitMessage/failed': ComposerGenerateCommitMessageFailedEvent;
	/** Sent when the user changes the AI model in the Commit Composer */
	'composer/action/changeAiModel': ComposerEvent;
	/** Sent when the user finishes and commits in the Commit Composer */
	'composer/action/finishAndCommit': ComposerEvent;
	/** Sent when the user fails to finish and commit in the Commit Composer */
	'composer/action/finishAndCommit/failed': ComposerFinishAndCommitFailedEvent;
	/** Sent when the user uses the undo button in the Commit Composer */
	'composer/action/undo': ComposerEvent;
	/** Sent when the user uses the reset button in the Commit Composer */
	'composer/action/reset': ComposerEvent;
	/** Sent when the user is warned that the working directory has changed in the Commit Composer */
	'composer/warning/workingDirectoryChanged': ComposerEvent;
	/** Sent when the user is warned that the index has changed in the Commit Composer */
	'composer/warning/indexChanged': ComposerEvent;

	/** Sent when a conflict-prone git command (merge, rebase, cherry-pick, revert, stash apply/pop) is run */
	'gitCommand/run': GitCommandRunEvent;
	/** Sent when a conflict occurs while running a conflict-prone git command */
	'gitCommand/conflict': GitCommandConflictEvent;

	/** Sent when the Commit Graph is shown */
	'graph/shown': GraphShownEvent;
	/** Sent when a Commit Graph command is executed */
	'graph/command': CommandEventData;

	/** Sent when GitLens auto-fetch fires a `git fetch` for the visible Commit Graph */
	'graph/autoFetch': GraphAutoFetchEvent;

	/** Sent when the user clicks on the Jump to HEAD/Reference (alt) header button on the Commit Graph */
	'graph/action/jumpTo': GraphActionJumpToEvent;
	/** Sent when the user clicks on the "Jump to HEAD"/"Jump to Reference" (alt) header button on the Commit Graph */
	'graph/action/openRepoOnRemote': GraphContextEventData;
	/** Sent when the user clicks on the "Open Repository on Remote" header button on the Commit Graph */
	'graph/action/sidebar': GraphActionSidebarEvent;

	/** Sent when the user changes the "branches visibility" on the Commit Graph */
	'graph/branchesVisibility/changed': GraphBranchesVisibilityChangedEvent;
	/** Sent when the user scopes the Commit Graph to a specific branch (Focus Branch feature) */
	'graph/scope/changed': GraphScopeChangedEvent;
	/** Sent when the user clears the active Commit Graph scope */
	'graph/scope/cleared': GraphContextEventData;
	/** Sent when the user changes the columns on the Commit Graph */
	'graph/columns/changed': GraphColumnsChangedEvent;
	/** Sent when the user changes the filters on the Commit Graph */
	'graph/filters/changed': GraphFiltersChangedEvent;
	/** Sent when the user clears all filters on the Commit Graph */
	'graph/filters/cleared': GraphFiltersClearedEvent;
	/** Sent when the user selects (clicks on) a day on the minimap on the Commit Graph */
	'graph/minimap/day/selected': GraphContextEventData;
	/** Sent when the user changes the current repository on the Commit Graph */
	'graph/repository/changed': GraphRepositoryChangedEvent;

	/** Sent when the user hovers over a row on the Commit Graph (first time and every 100 times after) */
	'graph/row/hovered': GraphRowHoveredEvent;
	/** Sent when the user selects (clicks on) a row or rows on the Commit Graph (first time and every 100 times after) */
	'graph/row/selected': GraphRowSelectedEvent;
	/** Sent when rows are loaded into the Commit Graph */
	'graph/rows/loaded': GraphRowsLoadedEvent;
	/** Sent when a search was performed on the Commit Graph */
	'graph/searched': GraphSearchedEvent;

	/** Sent when a commit from the Graph's WIP panel succeeds (commit or amend) */
	'graph/wip/commit/succeeded': GraphWipCommitSucceededEvent;
	/** Sent when a commit from the Graph's WIP panel fails (e.g. a hook rejection or signing failure) */
	'graph/wip/commit/failed': GraphWipCommitFailedEvent;
	/** Sent when the user toggles the "Amend Previous Commit" checkbox in the WIP panel */
	'graph/wip/commit/amendToggled': GraphWipCommitAmendToggledEvent;
	/** Sent when the user completes the co-author picker and trailers are appended to the commit message */
	'graph/wip/commit/coauthorsAdded': GraphWipCommitCoauthorsAddedEvent;

	/** Sent when the user clicks the sparkle button to generate an AI commit message */
	'graph/wip/generateMessage/started': GraphWipGenerateMessageStartedEvent;
	/** Sent when AI commit message generation completes with a non-empty message */
	'graph/wip/generateMessage/succeeded': GraphWipGenerateMessageSucceededEvent;
	/** Sent when AI commit message generation fails or returns an empty message */
	'graph/wip/generateMessage/failed': GraphWipGenerateMessageFailedEvent;
	/** Sent when the user cancels an in-flight AI commit message generation */
	'graph/wip/generateMessage/cancelled': GraphWipGenerateMessageCancelledEvent;

	/** Sent when the user triggers a branch action from the WIP panel header or next-steps */
	'graph/wip/action': GraphWipActionEvent;

	/** Sent when the user stages file(s) in the Graph's WIP panel */
	'graph/wip/staging/stage': GraphWipStagingStageEvent;
	/** Sent when the user unstages file(s) in the Graph's WIP panel */
	'graph/wip/staging/unstage': GraphWipStagingUnstageEvent;
	/** Sent when the user discards file changes from the Graph's WIP panel */
	'graph/wip/staging/discard': GraphWipStagingDiscardEvent;
	/** Sent when the user stashes specific file(s) from the Graph's WIP panel */
	'graph/wip/staging/stash': GraphWipStagingStashEvent;
	/** Sent when the user resolves conflict(s) by taking a side in the Graph's WIP panel */
	'graph/wip/staging/resolveConflict': GraphWipStagingResolveConflictEvent;
	/** Sent when any staging operation fails in the Graph's WIP panel */
	'graph/wip/staging/failed': GraphWipStagingFailedEvent;

	/** Sent when a virtual-FS-backed file (e.g. a Graph Compose proposed commit) is opened */
	'graph/virtualFile/opened': GraphVirtualFileOpenedEvent;
	/** Sent when opening a virtual-FS-backed file fails (e.g. the compose session is no longer registered) */
	'graph/virtualFile/failed': GraphVirtualFileFailedEvent;

	/** Sent when the Graph Overview panel becomes visible */
	'graph/overview/shown': GraphSidebarOverviewShownEvent;
	/** Sent when the user invokes an action item on a Graph Overview branch card */
	'graph/overview/action': GraphSidebarOverviewActionEvent;
	/** Sent when the user changes the Recent timeframe threshold in the Graph Overview */
	'graph/overview/recentThresholdChanged': GraphSidebarOverviewRecentThresholdChangedEvent;
	/** Sent when the user clicks a branch card to scope the graph to that branch */
	'graph/overview/branchSelected': GraphSidebarOverviewBranchSelectedEvent;
	/** Sent when the rich hover popover opens for the first time on a branch card */
	'graph/overview/hoverShown': GraphSidebarOverviewHoverShownEvent;
	/** Sent when the user clicks a PR or issue link in the Graph Overview hover popover */
	'graph/overview/linkClicked': GraphSidebarOverviewLinkClickedEvent;

	/** Sent when the Agents sidebar panel becomes visible */
	'graph/agents/shown': GraphSidebarAgentsShownEvent;
	/** Sent when the user clicks an agent session leaf in the sidebar agents panel */
	'graph/agents/sessionSelected': GraphSidebarAgentsSessionSelectedEvent;
	/** Sent when the user resolves a permission (Allow/Deny/Always Allow) from the sidebar agents panel */
	'graph/agents/permissionResolved': GraphSidebarAgentsPermissionResolvedEvent;
	/** Sent when the user clicks Open Session or View Plan on a session, or Open Terminal on a worktree group, in the sidebar agents panel */
	'graph/agents/sessionAction': GraphSidebarAgentsSessionActionEvent;
	/** Sent when the user clicks a header action (Start Work, Start Review, Refresh) in the sidebar agents panel */
	'graph/agents/headerAction': GraphSidebarAgentsHeaderActionEvent;
	/** Sent when the user toggles the tree/list layout in the sidebar agents panel */
	'graph/agents/layoutToggled': GraphSidebarAgentsLayoutToggledEvent;
	/** Sent when the sidebar agents filter toggles between empty and non-empty (not on every keystroke) */
	'graph/agents/filtered': GraphSidebarAgentsFilteredEvent;

	/** Sent when the Worktrees sidebar panel becomes visible */
	'graph/worktrees/shown': GraphSidebarWorktreesShownEvent;
	/** Sent when the user clicks a worktree leaf in the sidebar worktrees panel */
	'graph/worktrees/worktreeSelected': GraphSidebarWorktreesWorktreeSelectedEvent;
	/** Sent when the user invokes an action on a worktree item, via inline hover-icon or right-click context menu (see `location`) */
	'graph/worktrees/worktreeAction': GraphSidebarWorktreesWorktreeActionEvent;
	/** Sent when the user clicks a header action (Create Worktree, Refresh) in the sidebar worktrees panel */
	'graph/worktrees/headerAction': GraphSidebarWorktreesHeaderActionEvent;
	/** Sent when the user toggles the tree/list layout in the sidebar worktrees panel */
	'graph/worktrees/layoutToggled': GraphSidebarWorktreesLayoutToggledEvent;
	/** Sent when the user types in the filter box in the sidebar worktrees panel (debounced, not on every keystroke) */
	'graph/worktrees/filtered': GraphSidebarWorktreesFilteredEvent;

	/** Sent when the Branches sidebar panel becomes visible */
	'graph/branches/shown': GraphSidebarBranchesShownEvent;
	/** Sent when the user clicks a branch leaf in the sidebar branches panel */
	'graph/branches/branchSelected': GraphSidebarBranchesBranchSelectedEvent;
	/** Sent when the user invokes an action on a branch item, via inline hover-icon or right-click context menu (see `location`) */
	'graph/branches/branchAction': GraphSidebarBranchesBranchActionEvent;
	/** Sent when the user clicks a header action (Switch to Branch, Create Branch, Refresh) in the sidebar branches panel */
	'graph/branches/headerAction': GraphSidebarBranchesHeaderActionEvent;
	/** Sent when the user toggles the tree/list layout in the sidebar branches panel */
	'graph/branches/layoutToggled': GraphSidebarBranchesLayoutToggledEvent;
	/** Sent when the user types in the filter box in the sidebar branches panel */
	'graph/branches/filtered': GraphSidebarBranchesFilteredEvent;

	/** Sent when the Remotes sidebar panel becomes visible */
	'graph/remotes/shown': GraphSidebarRemotesShownEvent;
	/** Sent when the user invokes an action on a remote item, via inline hover-icon or right-click context menu (see `location`) */
	'graph/remotes/remoteAction': GraphSidebarRemotesRemoteActionEvent;
	/** Sent when the user clicks a header action (Add Remote, Refresh) in the sidebar remotes panel */
	'graph/remotes/headerAction': GraphSidebarRemotesHeaderActionEvent;
	/** Sent when the user toggles the tree/list layout in the sidebar remotes panel */
	'graph/remotes/layoutToggled': GraphSidebarRemotesLayoutToggledEvent;
	/** Sent when the user types in the filter box in the sidebar remotes panel (debounced, not on every keystroke) */
	'graph/remotes/filtered': GraphSidebarRemotesFilteredEvent;

	/** Sent when the Stashes sidebar panel becomes visible */
	'graph/stashes/shown': GraphSidebarStashesShownEvent;
	/** Sent when the user clicks a stash leaf in the sidebar stashes panel */
	'graph/stashes/stashSelected': GraphSidebarStashesStashSelectedEvent;
	/** Sent when the user invokes an action on a stash item, via inline hover-icon or right-click context menu (see `location`) */
	'graph/stashes/stashAction': GraphSidebarStashesStashActionEvent;
	/** Sent when the user clicks a header action (Stash All, Apply/Pop Stash, Refresh) in the sidebar stashes panel */
	'graph/stashes/headerAction': GraphSidebarStashesHeaderActionEvent;
	/** Sent when the user types in the filter box in the sidebar stashes panel */
	'graph/stashes/filtered': GraphSidebarStashesFilteredEvent;

	/** Sent when the Tags sidebar panel becomes visible */
	'graph/tags/shown': GraphSidebarTagsShownEvent;
	/** Sent when the user clicks a tag leaf in the sidebar tags panel */
	'graph/tags/tagSelected': GraphSidebarTagsTagSelectedEvent;
	/** Sent when the user invokes an action on a tag item, via inline hover-icon or right-click context menu (see `location`) */
	'graph/tags/tagAction': GraphSidebarTagsTagActionEvent;
	/** Sent when the user clicks a header action (Create Tag, Refresh) in the sidebar tags panel */
	'graph/tags/headerAction': GraphSidebarTagsHeaderActionEvent;
	/** Sent when the user toggles the tree/list layout in the sidebar tags panel */
	'graph/tags/layoutToggled': GraphSidebarTagsLayoutToggledEvent;
	/** Sent when the user types in the filter box in the sidebar tags panel */
	'graph/tags/filtered': GraphSidebarTagsFilteredEvent;

	/** Sent when the user switches the active visualization via the switcher, or when a virtual repo forces a fallback from the Commits Treemap to the Files Treemap */
	'graph/visualizations/modeChanged': GraphVisualizationsModeChangedEvent;
	/** Sent when the Graph leaves Visualizations display mode (close button, sidebar rail, external search request, etc.) */
	'graph/visualizations/closed': GraphVisualizationsClosedEvent;

	/** Sent when the embedded Visual History (timeline) visualization becomes visible */
	'graph/timeline/shown': GraphTimelineShownEvent;
	/** Sent when the user selects a commit in the embedded Visual History chart (first-paint auto-selections excluded) */
	'graph/timeline/commitSelected': GraphTimelineCommitSelectedEvent;
	/** Sent when the user changes the period in the embedded Visual History header */
	'graph/timeline/periodChanged': GraphTimelinePeriodChangedEvent;
	/** Sent when the user changes the slice-by axis in the embedded Visual History header */
	'graph/timeline/sliceByChanged': GraphTimelineSliceByChangedEvent;
	/** Sent when the user changes the file/folder scope of the embedded Visual History (path picker, clear, or breadcrumb) */
	'graph/timeline/scopeChanged': GraphTimelineScopeChangedEvent;

	/** Sent when a treemap visualization becomes visible for a repo + mode and its data has loaded */
	'graph/treemap/shown': GraphTreemapShownEvent;
	/** Sent when the user zooms the treemap in or out (folder drill-down or breadcrumb) */
	'graph/treemap/zoomed': GraphTreemapZoomedEvent;
	/** Sent when the user clicks a file leaf in the treemap */
	'graph/treemap/fileClicked': GraphTreemapFileClickedEvent;
	/** Sent when the user changes the period in the Commits Treemap */
	'graph/treemap/periodChanged': GraphTreemapPeriodChangedEvent;
	/** Sent when the user changes the activity decay window in the Agent Activity Treemap */
	'graph/treemap/decayChanged': GraphTreemapDecayChangedEvent;

	/** Sent when the Agent Kanban becomes visible */
	'graph/kanban/shown': GraphKanbanShownEvent;
	/** Sent when the Graph leaves Kanban display mode (close button, sidebar rail, etc.) */
	'graph/kanban/closed': GraphContextEventData;
	/** Sent when the user clicks a session card in the Agent Kanban to open its worktree WIP */
	'graph/kanban/sessionSelected': GraphKanbanSessionSelectedEvent;
	/** Sent when the user clicks Open Session or View Plan on a kanban session card */
	'graph/kanban/sessionAction': GraphKanbanSessionActionEvent;
	/** Sent when the user resolves a permission (Allow/Deny or Approve/Reject) from a kanban session card */
	'graph/kanban/permissionResolved': GraphKanbanPermissionResolvedEvent;

	/** Sent when the integrated graph details panel is expanded */
	'graphDetails/shown': GraphDetailsShownEvent;
	/** Sent when the integrated graph details panel is collapsed */
	'graphDetails/closed': GraphDetailsClosedEvent;
	/** Sent when the active mode of the integrated graph details panel changes while open */
	'graphDetails/mode/changed': GraphDetailsModeChangedEvent;
	/** Sent when commit reachability is successfully loaded in Graph Details */
	'graphDetails/reachability/loaded': DetailsReachabilityLoadedEvent;
	/** Sent when commit reachability fails to load in Graph Details */
	'graphDetails/reachability/failed': DetailsReachabilityFailedEvent;
	/** Sent when the user opens or diffs a file from a real (non-virtual) commit/compare in Graph Details */
	'graphDetails/file/opened': GraphDetailsFileOpenedEvent;
	/** Sent when the user changes the base/compare ref in Graph Details compare mode */
	'graphDetails/compare/refChanged': GraphDetailsCompareRefChangedEvent;
	/** Sent when the user switches the Ahead/Behind/All tab in Graph Details compare mode */
	'graphDetails/compare/tabChanged': GraphDetailsCompareTabChangedEvent;
	/** Sent when the user opens the current comparison in the Search & Compare view */
	'graphDetails/compare/openedInSearchAndCompare': GraphDetailsCompareOpenedInSearchAndCompareEvent;
	/** Sent when the user runs AI explain on a comparison in Graph Details */
	'graphDetails/compare/explain': GraphDetailsCompareExplainEvent;
	/** Sent when the user generates an AI changelog for a comparison in Graph Details */
	'graphDetails/compare/generateChangelog': GraphDetailsCompareGenerateChangelogEvent;

	/** Sent when the user runs AI explain on a single commit in Graph Details */
	'graphDetails/commit/explain': GraphDetailsCommitExplainEvent;
	/** Sent when a single-commit AI explain completes successfully in Graph Details */
	'graphDetails/commit/explain/completed': GraphDetailsCommitExplainEvent;
	/** Sent when a single-commit AI explain fails in Graph Details */
	'graphDetails/commit/explain/failed': GraphDetailsCommitExplainEvent;
	/** Sent when a comparison AI explain completes successfully in Graph Details */
	'graphDetails/compare/explain/completed': GraphDetailsCompareExplainEvent;
	/** Sent when a comparison AI explain fails in Graph Details */
	'graphDetails/compare/explain/failed': GraphDetailsCompareExplainEvent;

	/** Sent when the user enters compose mode in the Graph Details panel */
	'graphDetails/compose/opened': GraphDetailsComposeLifecycleEvent;
	/** Sent when the user exits compose mode in the Graph Details panel (toggled off or destroyed) */
	'graphDetails/compose/closed': GraphDetailsComposeLifecycleEvent;
	/** Sent when the user restarts a completed compose run (Back from result) */
	'graphDetails/compose/restarted': GraphDetailsComposeLifecycleEvent;
	/** Sent when a compose plan generation completes successfully (initial or refine/recompose) */
	'graphDetails/compose/generatePlan/completed': GraphDetailsComposeGeneratePlanCompletedEvent;
	/** Sent when a compose plan generation is cancelled (user-clicked Cancel or host-side abort) */
	'graphDetails/compose/generatePlan/cancelled': GraphDetailsComposeGeneratePlanLifecycleEvent;
	/** Sent when a compose plan generation fails */
	'graphDetails/compose/generatePlan/failed': GraphDetailsComposeGeneratePlanLifecycleEvent;
	/** Sent when a compose plan is applied (commits created) successfully */
	'graphDetails/compose/applyPlan/completed': GraphDetailsComposeApplyPlanEvent;
	/** Sent when applying a compose plan fails */
	'graphDetails/compose/applyPlan/failed': GraphDetailsComposeApplyPlanEvent;
	/** Sent when a per-commit message regeneration completes successfully (icon button next to a draft commit) */
	'graphDetails/compose/regenerateMessage/completed': GraphDetailsComposeRegenerateMessageEvent;
	/** Sent when a per-commit message regeneration fails or is cancelled */
	'graphDetails/compose/regenerateMessage/failed': GraphDetailsComposeRegenerateMessageFailedEvent;
	/** Sent when the user reorders draft commits in the plan (drag-and-drop or keyboard) and the host sync completes */
	'graphDetails/compose/reorder/completed': GraphDetailsComposeReorderEvent;
	/** Sent when reordering draft commits fails to sync to the host (e.g. stale plan) */
	'graphDetails/compose/reorder/failed': GraphDetailsComposeReorderFailedEvent;
	/** Sent when the user drags a file from one draft commit to another and the host re-derive completes */
	'graphDetails/compose/moveFile/completed': GraphDetailsComposeMoveFileEvent;
	/** Sent when moving a file between draft commits fails (e.g. stale plan) */
	'graphDetails/compose/moveFile/failed': GraphDetailsComposeMoveFileFailedEvent;
	/** Sent when the user switches the AI model from the compose-mode chip in the Graph Details panel */
	'graphDetails/compose/changeAiModel': GraphDetailsChangeAiModelEvent;

	/** Sent when the user enters review mode in the Graph Details panel */
	'graphDetails/review/opened': GraphDetailsReviewLifecycleEvent;
	/** Sent when the user exits review mode in the Graph Details panel (toggled off or destroyed) */
	'graphDetails/review/closed': GraphDetailsReviewLifecycleEvent;
	/** Sent when the user restarts a completed review (Back from result) */
	'graphDetails/review/restarted': GraphDetailsReviewLifecycleEvent;
	/** Sent when the user discards a completed review from the ready-state footer */
	'graphDetails/review/discarded': GraphDetailsReviewLifecycleEvent;
	/** Sent when a review generation completes successfully */
	'graphDetails/review/generateReview/completed': GraphDetailsReviewGenerateReviewCompletedEvent;
	/** Sent when a review generation is cancelled (user-clicked Cancel or host-side abort) */
	'graphDetails/review/generateReview/cancelled': GraphDetailsReviewGenerateReviewLifecycleEvent;
	/** Sent when a review generation fails */
	'graphDetails/review/generateReview/failed': GraphDetailsReviewGenerateReviewLifecycleEvent;
	/** Sent when a per-focus-area review (two-pass) generation completes successfully */
	'graphDetails/review/generateFocusArea/completed': GraphDetailsReviewGenerateFocusAreaCompletedEvent;
	/** Sent when a per-focus-area review (two-pass) generation fails */
	'graphDetails/review/generateFocusArea/failed': GraphDetailsReviewGenerateFocusAreaFailedEvent;
	/** Sent when the user copies all or part of a review to clipboard */
	'graphDetails/review/copied': GraphDetailsReviewActionEvent;
	/** Sent when the user sends all or part of a review to an AI agent */
	'graphDetails/review/sentToAgent': GraphDetailsReviewActionEvent;
	/** Sent when the user switches the AI model from the review-mode chip in the Graph Details panel */
	'graphDetails/review/changeAiModel': GraphDetailsChangeAiModelEvent;

	/** Sent when the user enters resolve (AI conflict-resolution) mode in the Graph Details panel */
	'graphDetails/resolve/opened': GraphDetailsResolveLifecycleEvent;
	/** Sent when the user exits resolve mode in the Graph Details panel (toggled off or destroyed) */
	'graphDetails/resolve/closed': GraphDetailsResolveLifecycleEvent;
	/** Sent when an AI conflict-resolution run completes successfully (initial or refine/retry) */
	'graphDetails/resolve/generateResolutions/completed': GraphDetailsResolveGenerateCompletedEvent;
	/** Sent when an AI conflict-resolution run is cancelled (user-clicked Cancel or host-side abort) */
	'graphDetails/resolve/generateResolutions/cancelled': GraphDetailsResolveGenerateLifecycleEvent;
	/** Sent when an AI conflict-resolution run fails */
	'graphDetails/resolve/generateResolutions/failed': GraphDetailsResolveGenerateLifecycleEvent;
	/** Sent when AI conflict resolutions are applied to the working tree successfully */
	'graphDetails/resolve/applyResolutions/completed': GraphDetailsResolveApplyEvent;
	/** Sent when applying AI conflict resolutions fails */
	'graphDetails/resolve/applyResolutions/failed': GraphDetailsResolveApplyEvent;
	/** Sent when the user discards pending AI conflict resolutions without applying them */
	'graphDetails/resolve/discarded': GraphDetailsResolveDiscardedEvent;
	/** Sent when the user switches the AI model from the resolve-mode chip in the Graph Details panel */
	'graphDetails/resolve/changeAiModel': GraphDetailsChangeAiModelEvent;

	/** Sent when a Home command is executed */
	'home/command': CommandEventData;
	/** Sent when the user chooses to create a branch from the home view */
	'home/createBranch': void;
	/** Sent when the user chooses to start work on an issue from the home view */
	'home/startWork': void;
	/** Sent when the user starts defining a user-specific merge target branch */
	'home/changeBranchMergeTarget': void;
	/** Sent when Home fails to load some state */
	'home/failed': HomeFailedEvent;

	/** Sent when the user takes an action on the Launchpad title bar */
	'launchpad/title/action': LaunchpadTitleActionEvent;

	/** Sent when the user takes an action on a launchpad item */
	'launchpad/action': LaunchpadActionEvent;
	/** Sent when the manual-vs-agent flow resolves for a launchpad _Start Review with an Agent_ action */
	'launchpad/agent/resolved': LaunchpadAgentResolvedEvent;
	/** Sent when the user changes launchpad configuration settings */
	'launchpad/configurationChanged': LaunchpadConfigurationChangedEvent;
	/** Sent when the user expands/collapses a launchpad group */
	'launchpad/groupToggled': LaunchpadGroupToggledEvent;
	/** Sent when the user opens launchpad; use `instance` to correlate a launchpad "session" */
	'launchpad/open': LaunchpadEventDataBase;
	/** Sent when the launchpad is opened; use `instance` to correlate a launchpad "session" */
	'launchpad/opened': LaunchpadConnectedEventData;
	/** Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is disconnected; use `instance` to correlate a launchpad "session" */
	'launchpad/steps/connect': LaunchpadConnectedEventData;
	/** Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is connected; use `instance` to correlate a launchpad "session" */
	'launchpad/steps/main': LaunchpadConnectedEventData;
	/** Sent when the user opens the details of a launchpad item (e.g. click on an item); use `instance` to correlate a launchpad "session" */
	'launchpad/steps/details': LaunchpadStepsDetailsEvent;
	/** Sent when the user hides the launchpad indicator */
	'launchpad/indicator/hidden': void;
	/** Sent when the launchpad indicator loads (with data) for the first time ever for this device */
	'launchpad/indicator/firstLoad': void;
	/** Sent when a launchpad operation is taking longer than a set timeout to complete */
	'launchpad/operation/slow': LaunchpadOperationSlowEvent;

	/** Sent when GitKraken MCP setup is started */
	'mcp/setup/started': MCPSetupStartedEvent;
	/** Sent when GitKraken MCP setup is completed */
	'mcp/setup/completed': MCPSetupCompletedEvent;
	/** Sent when GitKraken MCP setup fails */
	'mcp/setup/failed': MCPSetupFailedEvent;
	/** Sent when GitKraken MCP registration fails */
	'mcp/registration/failed': MCPSetupFailedEvent;
	/** Sent when user selects agents for MCP installation */
	'mcp/agents/selected': MCPAgentsSelectedEvent;

	'op/gate/deadlock': OperationGateDeadlockEvent;
	'op/git/aborted': OperationGitAbortedEvent;
	/** Sent when getGitDir resolves to a non-existent .git directory or rev-parse fails */
	'op/git/gitDirResolve/failed': OperationGitDirResolveFailedEvent;
	/** Sent when a background git command waited in the queue */
	'op/git/queueWait': OperationGitQueueWaitEvent;

	/** Sent when fetching the product config fails */
	'productConfig/failed': ProductConfigFailedEvent;

	/** Sent when the "context" of the workspace changes (e.g. repo added, integration connected, etc) */
	'providers/context': void;

	/** Sent when we've loaded all the git providers and their repositories */
	'providers/registrationComplete': ProvidersRegistrationCompleteEvent;

	/** Sent when the Rebase Editor is shown */
	'rebaseEditor/shown': RebaseEditorShownEvent;

	/** Sent when the user starts a rebase (clicks "Start Rebase") */
	'rebaseEditor/action/start': RebaseEditorCompletionEventData;
	/** Sent when the user aborts a rebase */
	'rebaseEditor/action/abort': RebaseEditorCompletionEventData;
	/** Sent when the user continues a paused rebase */
	'rebaseEditor/action/continue': RebaseEditorContextEventData;
	/** Sent when the user skips a commit during a paused rebase */
	'rebaseEditor/action/skip': RebaseEditorContextEventData;
	/** Sent when the user switches to the text editor */
	'rebaseEditor/action/switchToText': RebaseEditorCompletionEventData;
	/** Sent when the user toggles the commit ordering (ascending/descending) */
	'rebaseEditor/action/toggleOrdering': RebaseEditorToggleOrderingEvent;
	/** Sent when the user opens the Commit Composer from the rebase editor */
	'rebaseEditor/action/recompose': RebaseEditorCompletionEventData;
	/** Sent when the user clicks to show conflicts */
	'rebaseEditor/action/showConflicts': RebaseEditorContextEventData;
	/** Sent when the user opens a conflict file from the inline conflict panel */
	'rebaseEditor/action/openConflictFile': RebaseEditorOpenConflictFileEvent;
	/** Sent when the user opens current or incoming changes for a conflict file */
	'rebaseEditor/action/openConflictChanges': RebaseEditorOpenConflictChangesEvent;
	/** Sent when the user resolves a single conflict file by taking one side */
	'rebaseEditor/action/resolveConflict': RebaseEditorResolveConflictEvent;
	/** Sent when the user stages a single conflict file (marks as resolved) */
	'rebaseEditor/action/stageConflict': RebaseEditorStageConflictEvent;
	/** Sent when the user resolves all conflict files by taking one side */
	'rebaseEditor/action/resolveAllConflicts': RebaseEditorResolveAllConflictsEvent;
	/** Sent when the user opens the Commit Graph resolve mode from the conflict panel */
	'rebaseEditor/action/resolveConflictsInGraph': RebaseEditorContextEventData;
	/** Sent when the user reveals a ref (commit/branch) in graph or commit details */
	'rebaseEditor/action/revealRef': RebaseEditorRevealRefEvent;

	/** Sent when the user changes rebase entry action(s) (pick, squash, drop, etc.) */
	'rebaseEditor/entries/changed': RebaseEditorEntriesChangedEvent;
	/** Sent when the user moves/reorders entries */
	'rebaseEditor/entries/moved': RebaseEditorEntriesMovedEvent;

	/** Sent when conflict detection starts */
	'rebaseEditor/conflicts/detecting': RebaseEditorContextEventData;
	/** Sent when conflict detection completes (check status for result) */
	'rebaseEditor/conflicts/detected': RebaseEditorConflictsDetectedEvent;
	/** Sent when conflict detection fails */
	'rebaseEditor/conflicts/failed': RebaseEditorConflictsFailedEvent;

	/** Sent when a local (Git remote-based) hosting provider is connected */
	'remoteProviders/connected': RemoteProvidersConnectedEvent;
	/** Sent when a local (Git remote-based) hosting provider is disconnected */
	'remoteProviders/disconnected': RemoteProvidersDisconnectedEvent;

	/** Sent when the workspace's repositories change */
	'repositories/changed': RepositoriesChangedEvent;
	/** Sent when the workspace's repository visibility is first requested */
	'repositories/visibility': RepositoriesVisibilityEvent;

	/** Sent when a repository is opened */
	'repository/opened': RepositoryOpenedEvent;
	/** Sent when a repository's visibility is first requested */
	'repository/visibility': RepositoryVisibilityEvent;

	/** Sent when the user opens Start Review; use `instance` to correlate a StartReview "session" */
	'startReview/open': StartReviewEventDataBase;
	/** Sent when the launchpad is opened; use `instance` to correlate a StartReview "session" */
	'startReview/opened': StartReviewConnectedEventData;
	/** Sent when the user takes an action on a Start Review PR */
	'startReview/pr/action': StartReviewPrActionEvent;
	/** Sent when the user chooses a PR to review in the second step */
	'startReview/pr/chosen': StartReviewPrChosenEvent;
	/** Sent when the user reaches the "connect an integration" step of Start Review */
	'startReview/steps/connect': StartReviewConnectedEventData;
	/** Sent when the user reaches the "choose a PR" step of Start Review */
	'startReview/steps/pr': StartReviewConnectedEventData;
	/** Sent when the user chooses to connect an integration */
	'startReview/title/action': StartReviewTitleActionEvent;
	/** Sent when the user chooses to manage integrations */
	'startReview/action': StartReviewActionEvent;
	/** Sent when the manual-vs-agent flow resolves (manual, cancel, or a specific agent) */
	'startReview/agent/resolved': StartReviewAgentResolvedEvent;

	/** Sent when the user opens Start Work; use `instance` to correlate a StartWork "session" */
	'startWork/open': StartWorkEventDataBase;
	/** Sent when the launchpad is opened; use `instance` to correlate a StartWork "session" */
	'startWork/opened': StartWorkConnectedEventData;
	/** Sent when the user takes an action on a StartWork issue */
	'startWork/issue/action': StartWorkIssueActionEvent;
	/** Sent when the user chooses an issue to start work in the second step */
	'startWork/issue/chosen': StartWorkIssueChosenEvent;
	/** Sent when the user reaches the "connect an integration" step of Start Work */
	'startWork/steps/connect': StartWorkConnectedEventData;
	/** Sent when the user reaches the "choose an issue" step of Start Work */
	'startWork/steps/issue': StartWorkConnectedEventData;
	/** Sent when the user chooses to connect an integration */
	'startWork/title/action': StartWorkTitleActionEvent;
	/** Sent when the user chooses to manage integrations */
	'startWork/action': StartWorkActionEvent;
	/** Sent when the manual-vs-agent flow resolves (manual, cancel, or a specific agent) */
	'startWork/agent/resolved': StartWorkAgentResolvedEvent;

	/** Sent when the user opens Start Work; use `instance` to correlate an Associate Issue with Branch "session" */
	'associateIssueWithBranch/open': StartWorkEventDataBase;
	/** Sent when the launchpad is opened; use `instance` to correlate an Associate Issue with Branch "session" */
	'associateIssueWithBranch/opened': StartWorkConnectedEventData;
	/** Sent when the user takes an action on an issue */
	'associateIssueWithBranch/issue/action': StartWorkIssueActionEvent;
	/** Sent when the user chooses an issue to associate with the branch in the second step */
	'associateIssueWithBranch/issue/chosen': StartWorkIssueChosenEvent;
	/** Sent when the user reaches the "connect an integration" step of Associate Issue with Branch */
	'associateIssueWithBranch/steps/connect': StartWorkConnectedEventData;
	/** Sent when the user reaches the "choose an issue" step of Associate Issue with Branch */
	'associateIssueWithBranch/steps/issue': StartWorkConnectedEventData;
	/** Sent when the user chooses to connect an integration */
	'associateIssueWithBranch/title/action': StartWorkTitleActionEvent;
	/** Sent when the user chooses to manage integrations */
	'associateIssueWithBranch/action': StartWorkActionEvent;

	/** Sent when the subscription is loaded */
	subscription: SubscriptionEventData;

	/** Sent when the user takes an action on the subscription */
	'subscription/action': SubscriptionActionEventData;
	/** Sent when the subscription changes */
	'subscription/changed': SubscriptionEventDataWithPrevious;

	/** Sent when the Visual History is shown */
	'timeline/shown': TimelineShownEvent;
	/** Sent when the user clicks on the "Open in Editor" button on the Visual History */
	'timeline/action/openInEditor': TimelineActionOpenInEditorEvent;
	/** Sent when the editor changes on the Visual History */
	'timeline/editor/changed': TimelineContextEventData;
	/** Sent when the user selects (clicks on) a commit on the Visual History */
	'timeline/commit/selected': TimelineContextEventData;
	/** Sent when the user changes the configuration of the Visual History (e.g. period, show all branches, etc) */
	'timeline/config/changed': TimelineConfigChangedEvent;
	/** Sent when the scope (file/folder/repo) changes on the Visual History */
	'timeline/scope/changed': TimelineContextEventData;

	/** Sent when a "tracked feature" is interacted with, today that is only when webview/webviewView/custom editor is shown */
	'usage/track': UsageTrackEvent;

	/** Sent when the walkthrough is opened */
	walkthrough: WalkthroughEvent;
	/** Sent when the walkthrough is opened */
	'walkthrough/action': WalkthroughActionEvent;
	'walkthrough/completion': WalkthroughCompletionEvent;

	/** Sent when an action is taken in the welcome webview */
	'welcome/action': WelcomeActionEvent;
}

type WebviewShowAbortedEvents = {
	[K in `${WebviewTypes}/showAborted`]: WebviewShownEventData;
};
type WebviewShownEvents = {
	[K in `${Exclude<
		WebviewTypes,
		'commitDetails' | 'graph' | 'rebaseEditor' | 'timeline'
	>}/shown`]: WebviewShownEventData & Record<`context.${string}`, string | number | boolean | undefined>;
};

type WebviewClosedEvents = {
	[K in `${WebviewTypes}/closed`]: WebviewContextEventData &
		Record<`context.${string}`, string | number | boolean | undefined>;
};

type ConfigEventData = {
	[K in `config.${string}`]: string | number | boolean | null;
};

type FlattenedContextConfig<T extends object> = {
	[K in keyof Flatten<T, 'context.config', true>]: Flatten<T, 'context.config', true>[K];
};

interface AccountValidationFailedEvent {
	'account.id': string;
	exception: string;
	code: string | undefined;
	statusCode: number | undefined;
}

interface AgentProviderEvent {
	'agent.provider': string;
}

interface AgentPermissionResolvedEvent {
	'agent.provider': string;
	'permission.tool': string;
	'permission.decision': string;
}

interface AgentSessionResumedEvent {
	'agent.provider': string;
	/** Where the resume was invoked from. */
	'agent.resume.source': 'webview' | 'quickpick';
	/** Where it landed — a terminal, or the agent's own editor extension. */
	'agent.resume.target': 'extension' | 'terminal';
}

interface AgentSyncDiscrepancyEvent {
	'agent.provider': string;
	/** Sessions the poll reported alive that the live IPC path had not tracked. */
	'sync.discovered': number;
	/** Tracked sessions the poll no longer reports alive (teardown the live path missed). */
	'sync.missing': number;
	/** Total alive sessions reported by the poll. */
	'sync.polled': number;
	/** Total sessions tracked (from the live path) before the poll reconciled. */
	'sync.tracked': number;
}

interface ActivateEvent extends ConfigEventData {
	'activation.elapsed': number;
	'activation.mode': string | undefined;
}

interface ExtensionChunkLoadFailedEvent {
	'error.code': string | undefined;
	'error.message': string;
}

interface AIEventDataBase {
	id: string | undefined;

	'model.id': string;
	'model.provider.id': AIProviders;
	'model.provider.name': string;

	'usage.promptTokens'?: number;
	'usage.completionTokens'?: number;
	'usage.totalTokens'?: number;
	'usage.limits.used'?: number;
	'usage.limits.limit'?: number;
	'usage.limits.resetsOn'?: string;
}

interface AIEventDataSendBase extends AIEventDataBase {
	correlationId?: string;

	'retry.count': number;
	duration?: number;
	'input.length'?: number;
	'output.length'?: number;

	'config.largePromptThreshold'?: number;
	'config.usedCustomInstructions'?: boolean;

	'diff.files.count'?: number;
	'diff.hunks.count'?: number;
	'diff.lines.count'?: number;
	'diff.hash'?: string;

	'customInstructions.used'?: boolean;
	'customInstructions.length'?: number;
	'customInstructions.setting.used'?: boolean;
	'customInstructions.setting.length'?: number;
	'customInstructions.commitMessage.setting.used'?: boolean;
	'customInstructions.commitMessage.setting.length'?: number;

	'warning.exceededLargePromptThreshold'?: boolean;
	'warning.promptTruncated'?: boolean;

	failed?: boolean;
	'failed.reason'?: 'user-declined' | 'user-cancelled' | 'error';
	'failed.cancelled.reason'?: 'large-prompt';
	'failed.error'?: string;
	'failed.error.detail'?: string;
}

interface AIExplainEvent extends AIEventDataSendBase {
	type: 'change';
	changeType:
		| 'wip'
		| 'stash'
		| 'commit'
		| 'branch'
		| 'compare'
		| `draft-${'patch' | 'stash' | 'suggested_pr_change'}`;
}

interface AIReviewEvent extends AIEventDataSendBase {
	type: 'review';
	reviewType: 'commit' | 'wip' | 'compare';
	reviewMode: 'single-pass' | 'two-pass';
}

export interface AIGenerateChangelogEventData extends AIEventDataSendBase {
	type: 'changelog';
}

export interface AIGenerateCommitMessageEventData extends AIEventDataSendBase {
	type: 'commitMessage';
}

export interface AIGenerateCreatePullRequestEventData extends AIEventDataSendBase {
	type: 'createPullRequest';
}

export interface AIGenerateCreateDraftEventData extends AIEventDataSendBase {
	type: 'draftMessage';
	draftType: 'patch' | 'stash' | 'suggested_pr_change';
}

export interface AIGenerateCommitsEventData extends AIEventDataSendBase {
	type: 'commits';
}

export interface AIGenerateResolveConflictsEventData extends AIEventDataSendBase {
	type: 'resolveConflicts';
}

export interface AIGenerateSearchQueryEventData extends AIEventDataSendBase {
	type: 'searchQuery';
}

export interface AIGenerateStashMessageEventData extends AIEventDataSendBase {
	type: 'stashMessage';
}

type AIGenerateEvent =
	| AIGenerateChangelogEventData
	| AIGenerateCommitMessageEventData
	| AIGenerateCreateDraftEventData
	| AIGenerateCreatePullRequestEventData
	| AIGenerateCommitsEventData
	| AIGenerateResolveConflictsEventData
	| AIGenerateSearchQueryEventData
	| AIGenerateStashMessageEventData;

export type AISwitchModelEvent =
	| { 'model.id': string; 'model.provider.id': AIProviders; 'model.provider.name': string }
	| { failed: true };

export type AIFeedbackUnhelpfulReasons =
	| 'suggestionInaccurate'
	| 'notRelevant'
	| 'missedImportantContext'
	| 'unclearOrPoorlyFormatted'
	| 'genericOrRepetitive'
	| 'other';

export interface AIFeedbackEvent extends AIEventDataBase {
	/** The AI feature that feedback was submitted for */
	type: AIActionType;
	feature: string;
	sentiment: 'helpful' | 'unhelpful';
	/** Unhelpful reasons selected (if any) - comma-separated list of AIFeedbackUnhelpfulReasons values */
	'unhelpful.reasons'?: string;
	/** Custom feedback provided (if any) */
	'unhelpful.custom'?: string;
}

interface AICreditsNotificationEvent {
	'organization.role': OrganizationRole | undefined;
}

export interface CLIInstallStartedEvent {
	source?: Sources;
	autoInstall: boolean;
	attempts: number;
	insiders: boolean;
}

export interface CLIInstallSucceededEvent {
	autoInstall: boolean;
	attempts: number;
	source?: Sources;
	version?: string;
	insiders: boolean;
}

export interface CLIInstallFailedEvent {
	autoInstall: boolean;
	attempts: number;
	'error.message'?: string;
	source?: Sources;
	insiders: boolean;
}

export interface CLIUpdateCoreCompletedEvent {
	previous: string | undefined;
	current: string | undefined;
}

export interface CLIIpcFailedEvent {
	'error.message': string;
}

export interface CLIDiscoveryFileFailedEvent {
	'error.message': string;
}

export interface CLIUpdateCoreFailedEvent {
	previous: string | undefined;
	'error.message': string;
}

export interface MCPSetupStartedEvent {
	source: Sources;
}

export interface MCPSetupCompletedEvent {
	source: Sources;
	'cli.version'?: string;
	requiresUserCompletion: boolean;
	'agents.succeeded'?: string;
	'agents.failed'?: string;
	'agents.userAction'?: string;
}

export interface MCPSetupFailedEvent {
	source: Sources;
	reason: string;
	'cli.version'?: string;
	'error.message'?: string;
	'agents.failed'?: string;
}

export interface MCPAgentsSelectedEvent {
	source: Sources;
	'agents.count': number;
	'agents.ids': string;
}

interface CloudIntegrationsConnectingEvent {
	'integration.ids': string | undefined;
}

interface CloudIntegrationsConnectedEvent {
	'integration.ids': string | undefined;
	'integration.connected.ids': string | undefined;
}

interface CloudIntegrationsDisconnectFailedEvent {
	code: number | undefined;
	'integration.id': string | undefined;
}

interface CloudIntegrationsGetConnectionsFailedEvent {
	code: number | undefined;
}

interface CloudIntegrationsGetConnectionFailedEvent {
	code: number | undefined;
	'integration.id': string | undefined;
}

interface CloudIntegrationsRefreshConnectionFailedEvent {
	code: number | undefined;
	'integration.id': string | undefined;
}

interface CloudIntegrationsRefreshConnectionSkipUnusualTokenEvent {
	'integration.id': string;
	reason: 'skip-non-cloud' | 'missing-expiry';
	cloud: boolean | undefined;
}

interface CloudIntegrationsHostingConnectedEvent {
	'hostingProvider.provider': IntegrationIds;
	'hostingProvider.key': string;
}

interface CloudIntegrationsHostingDisconnectedEvent {
	'hostingProvider.provider': IntegrationIds;
	'hostingProvider.key': string;
}

interface CloudIntegrationsIssueConnectedEvent {
	'issueProvider.provider': IntegrationIds;
	'issueProvider.key': string;
}

interface CloudIntegrationsIssueDisconnectedEvent {
	'issueProvider.provider': IntegrationIds;
	'issueProvider.key': string;
}

interface CloudIntegrationsSettingsOpenedEvent {
	'integration.id': SupportedCloudIntegrationIds | undefined;
}

interface CodeSuggestArchivedEvent {
	provider: string | undefined;
	'repository.visibility': 'private' | 'public' | 'local' | undefined;
	/** Named for compatibility with other GK surfaces */
	repoPrivacy: 'private' | 'public' | 'local' | undefined;
	/** Named for compatibility with other GK surfaces */
	draftId: string;
	/** Named for compatibility with other GK surfaces */
	reason: 'committed' | 'rejected' | 'accepted';
}

interface CodeSuggestCreatedEventData {
	provider: string | undefined;
	'repository.visibility': 'private' | 'public' | 'local' | undefined;
	/** Named for compatibility with other GK surfaces */
	repoPrivacy: 'private' | 'public' | 'local' | undefined;
	/** Named for compatibility with other GK surfaces */
	draftId: string;
	/** Named for compatibility with other GK surfaces */
	draftPrivacy: 'public' | 'private' | 'invite_only' | 'provider_access';
	/** Named for compatibility with other GK surfaces */
	filesChanged: number;
	/** Named for compatibility with other GK surfaces */
	source: 'reviewMode';
}

interface CodeSuggestViewedEventData {
	provider: string | undefined;
	'repository.visibility': 'private' | 'public' | 'local' | undefined;
	/** Named for compatibility with other GK surfaces */
	repoPrivacy: 'private' | 'public' | 'local' | undefined;
	/** Named for compatibility with other GK surfaces */
	draftId: string;
	/** Named for compatibility with other GK surfaces */
	draftPrivacy: 'public' | 'private' | 'invite_only' | 'provider_access';
	/** Named for compatibility with other GK surfaces */
	source?: string;
}

interface CommandEventData {
	command: string;
	'context.mode'?: never;
	'context.submode'?: never;
	webview?: string;
}

interface GitCommandEventData {
	command: Extract<GlCommands, 'gitlens.gitCommands'>;
	'context.mode'?: string;
	'context.submode'?: string;
	webview?: string;
}

type CommandEvent = CommandEventData | GitCommandEventData;

interface CoreCommandEvent {
	command: string;
}

type DetailsShownEvent = WebviewShownEventData & InspectShownEventData;

export type GraphDetailsMode = 'commit' | 'wip' | 'multicommit' | 'review' | 'compose' | 'resolve' | 'compare' | 'none';

interface GraphDetailsShownEvent {
	/** What caused the panel to be shown */
	trigger:
		| 'toggle'
		| 'request-compare'
		| 'request-mode'
		| 'request-agents'
		| 'request-graph-wip-bar'
		| 'auto-restore';
	/** Which graph host the panel is in: editor area or bottom panel */
	host: 'editor' | 'panel';
	/** Active panel mode at time of show */
	mode: GraphDetailsMode;
	/** Number of rows currently selected in the graph (0, 1, or N) */
	'selection.count': number;
	/** Whether the active selection is the WIP / uncommitted row */
	'selection.uncommitted': boolean;
	/** Split-pane position percentage from the closed edge (0–100) */
	position: number | undefined;
	/** Where the details panel is anchored relative to the graph */
	location: 'right' | 'bottom';
}

interface GraphDetailsClosedEvent {
	/** How long the panel was open in milliseconds */
	duration: number;
	/** Active panel mode at time of close */
	mode: GraphDetailsMode;
}

interface GraphDetailsModeChangedEvent extends GraphContextEventData {
	'mode.old': GraphDetailsMode;
	'mode.new': GraphDetailsMode;
}

type GraphDetailsScopeEventData = {
	/** Scope type at the time of the event */
	'scope.type': 'wip' | 'commit' | 'compare';
	/** Whether staged changes were included (wip scope only) */
	'scope.includeStaged': boolean | undefined;
	/** Whether unstaged changes were included (wip scope only) */
	'scope.includeUnstaged': boolean | undefined;
	/** Number of commits included in the scope */
	'scope.commits.count': number;
	/** Effective number of files in the scope (post AI-ignore, pre user-exclusion) */
	'scope.files.count': number;
	/** Number of files the user has excluded from the scope */
	'scope.files.excluded.count': number;
};

type GraphDetailsAIModelEventData = {
	'ai.model.id': string | undefined;
	'ai.model.name': string | undefined;
	'ai.model.provider.id': AIProviders | undefined;
	'ai.model.provider.name': string | undefined;
};

type GraphDetailsInstructionsEventData = {
	'customInstructions.used': boolean;
	'customInstructions.length': number;
};

interface GraphDetailsComposeLifecycleEvent extends GraphContextEventData {}

interface GraphDetailsComposeGeneratePlanLifecycleEvent
	extends
		GraphContextEventData,
		GraphDetailsScopeEventData,
		GraphDetailsInstructionsEventData,
		GraphDetailsAIModelEventData {
	/** True when this generation refined a prior plan; false on the initial compose */
	refine: boolean;
	/** Time from dispatch to settlement in milliseconds */
	duration: number;
}

interface GraphDetailsComposeGeneratePlanCompletedEvent extends GraphDetailsComposeGeneratePlanLifecycleEvent {
	/** Number of proposed commits in the resulting plan */
	'result.commits.count': number;
	/** Sum of file changes across all proposed commits */
	'result.files.count': number;
	/** Sum of additions across all proposed commits */
	'result.additions.count': number;
	/** Sum of deletions across all proposed commits */
	'result.deletions.count': number;
}

interface GraphDetailsComposeApplyPlanEvent extends GraphContextEventData {
	/** Total commits in the proposed plan */
	'plan.commits.count': number;
	/** Number of commits actually committed (post-exclusion) */
	'commits.count': number;
	/** Number of commits excluded by the user before apply */
	'commits.excluded.count': number;
	/** Whether the plan was stale (working changes diverged since it was generated) at apply time */
	stale: boolean;
	/** Time from apply click to settlement in milliseconds */
	duration: number;
}

interface GraphDetailsComposeRegenerateMessageEvent extends GraphContextEventData {
	/** Time from icon click to settlement in milliseconds */
	duration: number;
}

interface GraphDetailsComposeRegenerateMessageFailedEvent extends GraphDetailsComposeRegenerateMessageEvent {
	/** Why the run did not complete successfully */
	'failure.reason': 'cancelled' | 'error';
	/** Error message text — present only when `failure.reason` is `'error'` */
	'failure.error.message'?: string;
}

interface GraphDetailsComposeReorderEvent extends GraphContextEventData {
	/** Number of proposed commits in the plan being reordered */
	'plan.commits.count': number;
	/** Time from reorder gesture to host-sync settlement in milliseconds */
	duration: number;
}

interface GraphDetailsComposeReorderFailedEvent extends GraphDetailsComposeReorderEvent {
	/** Error message text describing why the host sync failed */
	'failure.error.message'?: string;
}

interface GraphDetailsComposeMoveFileEvent extends GraphContextEventData {
	/** Number of proposed commits in the plan after the move (an emptied source commit is dropped) */
	'plan.commits.count': number;
	/** Time from the drop to host-re-derive settlement in milliseconds */
	duration: number;
}

interface GraphDetailsComposeMoveFileFailedEvent extends GraphContextEventData {
	/** Error message text describing why the move failed */
	'failure.error.message'?: string;
	/** Time from the drop to failure in milliseconds */
	duration: number;
}

interface GraphDetailsChangeAiModelEvent extends GraphContextEventData, GraphDetailsAIModelEventData {
	/** Previously-selected model id (undefined when no model was set) */
	'ai.model.previous.id': string | undefined;
	/** Previously-selected model name */
	'ai.model.previous.name': string | undefined;
	/** Previously-selected model provider id */
	'ai.model.previous.provider.id': AIProviders | undefined;
	/** Previously-selected model provider name */
	'ai.model.previous.provider.name': string | undefined;
}

interface GraphDetailsReviewLifecycleEvent extends GraphContextEventData {}

interface GraphDetailsReviewGenerateReviewLifecycleEvent
	extends
		GraphContextEventData,
		GraphDetailsScopeEventData,
		GraphDetailsInstructionsEventData,
		GraphDetailsAIModelEventData {
	/** Time from dispatch to settlement in milliseconds */
	duration: number;
}

interface GraphDetailsReviewGenerateReviewCompletedEvent extends GraphDetailsReviewGenerateReviewLifecycleEvent {
	/** Whether the review used the single-pass or two-pass mode */
	'result.mode': 'single-pass' | 'two-pass';
	/** Number of focus areas produced by the run */
	'result.focusAreas.count': number;
	/** Total findings across all focus areas (single-pass only; two-pass enriches later) */
	'result.findings.count': number;
	'result.severity.critical.count': number;
	'result.severity.warning.count': number;
	'result.severity.suggestion.count': number;
}

interface GraphDetailsReviewGenerateFocusAreaCompletedEvent
	extends GraphContextEventData, GraphDetailsAIModelEventData {
	duration: number;
	/** Findings produced for this focus area */
	'findings.count': number;
	'findings.severity.critical.count': number;
	'findings.severity.warning.count': number;
	'findings.severity.suggestion.count': number;
}

interface GraphDetailsReviewGenerateFocusAreaFailedEvent extends GraphContextEventData, GraphDetailsAIModelEventData {
	duration: number;
}

interface GraphDetailsReviewActionEvent extends GraphContextEventData {
	/** Whether the action targeted the whole review, a focus area, or a single finding */
	granularity: 'review' | 'focusArea' | 'finding';
}

interface GraphDetailsResolveLifecycleEvent extends GraphContextEventData {}

interface GraphDetailsResolveGenerateLifecycleEvent
	extends GraphContextEventData, GraphDetailsInstructionsEventData, GraphDetailsAIModelEventData {
	/** True when this run refined/retried a prior result; false on the initial resolve */
	refine: boolean;
	/** Whether the run was scoped to a focused subset of conflicted files rather than all */
	focused: boolean;
	/** Number of conflicted files the run was focused on (0 when resolving all) */
	'files.focused.count': number;
	/** Time from dispatch to settlement in milliseconds */
	duration: number;
}

interface GraphDetailsResolveGenerateCompletedEvent extends GraphDetailsResolveGenerateLifecycleEvent {
	/** Number of files the AI produced a resolution for */
	'result.resolutions.count': number;
	/** Number of files the resolver errored on */
	'result.errors.count': number;
	/** Number of files skipped (couldn't be auto-resolved, e.g. binary/marker-less) */
	'result.skipped.count': number;
	/** Resolutions using the AI-merged strategy */
	'result.strategy.ai.count': number;
	/** Resolutions resolved by taking the current/ours side */
	'result.strategy.takeOurs.count': number;
	/** Resolutions resolved by taking the incoming/theirs side */
	'result.strategy.takeTheirs.count': number;
	/** Resolutions resolved as a deletion */
	'result.strategy.deleted.count': number;
	/** Resolutions left as skipped */
	'result.strategy.skipped.count': number;
}

interface GraphDetailsResolveApplyEvent extends GraphContextEventData {
	/** Total resolutions in the pending set */
	'resolutions.count': number;
	/** Number of resolutions actually applied (post user file-exclusion) */
	'applied.count': number;
	/** Number of resolutions excluded by the user before apply */
	'excluded.count': number;
	/** Time from apply click to settlement in milliseconds */
	duration: number;
}

interface GraphDetailsResolveDiscardedEvent extends GraphContextEventData {
	/** Number of pending resolutions that were discarded */
	'resolutions.count': number;
}

interface DetailsReachabilityLoadedEvent {
	'refs.count': number;
	duration: number;
}

interface DetailsReachabilityFailedEvent {
	duration: number;
	'failed.reason': 'git-error' | 'timeout' | 'unknown';
	'failed.error'?: string;
}

interface CommitSignedEvent {
	format: 'gpg' | 'ssh' | 'x509' | 'openpgp';
}

interface CommitSigningFailedEvent {
	reason: 'noKey' | 'gpgNotFound' | 'sshNotFound' | 'passphraseFailed' | 'unknown';
	format: 'gpg' | 'ssh' | 'x509' | 'openpgp';
}

interface CommitSigningSetupEvent {
	format: 'gpg' | 'ssh' | 'x509' | 'openpgp';
	keyGenerated: boolean;
}

interface CommitSigningSetupWizardOpenedEvent {
	alreadyConfigured: boolean;
}

export type FeaturePreviewDayEventData = Record<`day.${number}.startedOn`, string>;
export type FeaturePreviewEventData = {
	feature: FeaturePreviews;
	status: FeaturePreviewStatus;
	day?: number;
	startedOn?: string;
} & FeaturePreviewDayEventData;
export type FeaturePreviewActionEventData = {
	action: `start-preview-trial:${FeaturePreviews}`;
} & FeaturePreviewEventData;

type GitCommandType = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'stash-apply' | 'stash-pop';

interface GitCommandRunEvent {
	command: GitCommandType;
}

interface GitCommandConflictEvent {
	command: GitCommandType;
}

type GraphContextEventData = WebviewTelemetryContext & Partial<RepositoryContext>;
export type GraphTelemetryContext = GraphContextEventData;

type GraphShownEventData = GraphContextEventData &
	FlattenedContextConfig<GraphConfig> &
	Partial<Record<`context.column.${string}.visible`, boolean>> &
	Partial<Record<`context.column.${string}.mode`, string>>;
export type GraphShownTelemetryContext = GraphShownEventData;

type GraphShownEvent = WebviewShownEventData & GraphShownEventData;

interface GraphActionJumpToEvent extends GraphContextEventData {
	target: 'HEAD' | 'choose';
}

interface GraphAutoFetchEvent extends GraphContextEventData {
	intervalSeconds: number;
	sinceLastFetchedMs: number;
}

interface GraphActionSidebarEvent extends GraphContextEventData {
	action: string;
}

interface GraphBranchesVisibilityChangedEvent extends GraphContextEventData {
	'branchesVisibility.old': GraphBranchesVisibility;
	'branchesVisibility.new': GraphBranchesVisibility;
}

interface GraphScopeChangedEvent extends GraphContextEventData {
	/** Where the user initiated the scope change */
	source: 'popover' | 'overview-card';
	/** Whether the scoped branch has a tracked upstream resolved at the time of the scope change */
	'scope.hasUpstream': boolean;
	/** Whether the scope's merge-target tip SHA is known at scope time (proxy for "merge-target resolved") */
	'scope.hasMergeTarget': boolean;
}

type GraphColumnEventData = {
	[K in `column.${string}.${keyof GraphColumnConfig}`]?: K extends `column.${string}.${infer P}`
		? P extends keyof GraphColumnConfig
			? GraphColumnConfig[P]
			: never
		: never;
};

interface GraphColumnsChangedEvent extends GraphColumnEventData, GraphContextEventData {}

interface GraphFiltersChangedEvent extends GraphContextEventData {
	key: string;
	value: boolean;
}

interface GraphFiltersClearedEvent extends GraphContextEventData {
	'cleared.branchesVisibility': boolean;
	'cleared.excludeTypes': boolean;
	'cleared.includeOnlyRefs': boolean;
	'cleared.excludeRefs': boolean;
}

interface GraphRepositoryChangedEvent extends RepositoryEventData, GraphContextEventData {}

interface GraphRowHoveredEvent extends GraphContextEventData {
	count: number;
}

interface GraphRowSelectedEvent extends GraphContextEventData {
	rows: number;
	count: number;
}

interface GraphRowsLoadedEvent extends GraphContextEventData {
	duration: number;
	rows: number;
}

interface GraphSearchedEvent extends GraphContextEventData {
	types: string;
	duration: number;
	matches: number;
	failed?: boolean;
	'failed.reason'?: 'cancelled' | 'error';
	'failed.error'?: string;
	'failed.error.detail'?: string;
}

export type GraphVirtualFileMode = 'diff' | 'comparePrevious' | 'multiDiff';
export type GraphVirtualFileFailureReason = 'provider-missing' | 'parent-missing' | 'unknown';

/** Classified reason a WIP-panel commit failed; mirrors `CommitFailureReason` in the repository RPC service */
export type GraphWipCommitFailureReason =
	| 'hookRejected'
	| 'signingFailed'
	| 'nothingToCommit'
	| 'conflicts'
	| 'identityMissing'
	| 'unknown';

/** Shared composition of a WIP commit — attached to both the succeeded and failed events so the
 *  two form a comparable funnel. Privacy-safe: counts and booleans only, never file paths or message text. */
type GraphWipCommitEventData = {
	/** Whether the commit was an amend */
	amend: boolean;
	/** Whether smart-commit committed everything (`-a`) because nothing was explicitly staged */
	all: boolean;
	/** Whether the `git.enableSmartCommit` preference was on at commit time */
	smartCommit: boolean;
	/** Whether any files were staged at commit time */
	hasStagedFiles: boolean;
	/** Number of staged files */
	'files.staged.count': number;
	/** Total number of changed files in the working tree */
	'files.total.count': number;
	/** Length of the commit message (characters, not content) */
	'message.length': number;
};

interface GraphWipCommitSucceededEvent extends GraphContextEventData, GraphWipCommitEventData {}

interface GraphWipCommitFailedEvent extends GraphContextEventData, GraphWipCommitEventData {
	reason: GraphWipCommitFailureReason;
	/** Whether raw output (hook/git stderr) was captured and surfaced via "View Full Output" */
	hasOutput: boolean;
}

interface GraphWipCommitAmendToggledEvent extends GraphContextEventData {
	/** New state of the amend toggle (true = amend on) */
	enabled: boolean;
	/** Whether the commit box had text when toggled */
	hasMessage: boolean;
}

interface GraphWipCommitCoauthorsAddedEvent extends GraphContextEventData {
	/** Number of co-authors selected */
	count: number;
}

interface GraphWipGenerateMessageStartedEvent extends GraphContextEventData {
	/** Whether amend mode was on at generation time */
	amend: boolean;
	/** Whether the commit box already had text (AI refine vs. blank-slate) */
	hasExistingMessage: boolean;
	/** Length of existing message (0 if blank) */
	'message.length': number;
	/** Whether files were staged */
	hasStagedFiles: boolean;
	/** Count of staged files */
	'files.staged.count': number;
	/** Total changed files in the working tree */
	'files.total.count': number;
}

interface GraphWipGenerateMessageSucceededEvent extends GraphContextEventData {
	/** Whether amend mode was on */
	amend: boolean | undefined;
	/** Whether there was prior text (refine flow) */
	hasExistingMessage: boolean | undefined;
	/** Wall-clock milliseconds from start to settlement; undefined if startedAt was missing */
	duration: number | undefined;
	/** Character length of the generated message */
	'result.length': number;
}

interface GraphWipGenerateMessageFailedEvent extends GraphContextEventData {
	/** Whether amend mode was on */
	amend: boolean | undefined;
	/** Whether there was prior text */
	hasExistingMessage: boolean | undefined;
	/** Milliseconds until failure; undefined if startedAt was missing */
	duration: number | undefined;
	/** Why the generation failed: 'error' = RPC/AI threw, 'empty' = AI returned an empty message */
	reason: 'error' | 'empty';
}

interface GraphWipGenerateMessageCancelledEvent extends GraphContextEventData {
	/** Milliseconds from start to cancellation; undefined if startedAt was missing */
	duration: number | undefined;
}

export type GraphWipAction =
	| 'push'
	| 'forcePush'
	| 'pull'
	| 'fetch'
	| 'publishBranch'
	| 'switchBranch'
	| 'createBranch'
	| 'createPullRequest'
	| 'createPullRequestWithAI'
	| 'rebaseOntoMergeTarget'
	| 'mergeMergeTarget'
	| 'shareAsCloudPatch'
	| 'copyPatch'
	| 'stashSave'
	| 'stashSaveStaged'
	| 'stashSaveFiles'
	| 'applyStash'
	| 'createWorktree'
	| 'startWork'
	| 'startReview';

interface GraphWipActionEvent extends GraphContextEventData {
	/** Which action was triggered */
	action: GraphWipAction;
}

export type GraphWipStagingScope = 'file' | 'files' | 'all';

interface GraphWipStagingStageEvent extends GraphContextEventData {
	/** Whether a single file, multi-select batch, or stage-all */
	scope: GraphWipStagingScope;
	/** Number of files being staged */
	'files.count': number;
	/** Whether the repo has conflicts at the time (stage-all prompts about conflict markers) */
	hasConflicts: boolean;
}

interface GraphWipStagingUnstageEvent extends GraphContextEventData {
	/** Whether a single file, multi-select batch, or unstage-all */
	scope: GraphWipStagingScope;
	/** Number of files being unstaged */
	'files.count': number;
}

export type GraphWipStagingDiscardScope = 'file' | 'files' | 'staged' | 'unstaged';

interface GraphWipStagingDiscardEvent extends GraphContextEventData {
	/** Whether a single file, multi-select, discard-all-staged, or discard-all-unstaged */
	scope: GraphWipStagingDiscardScope;
	/** Number of files affected (available for file/files scope) */
	'files.count': number | undefined;
}

interface GraphWipStagingStashEvent extends GraphContextEventData {
	/** Whether a single file or multi-select batch */
	scope: 'file' | 'files';
	/** Number of files being stashed */
	'files.count': number;
}

interface GraphWipStagingResolveConflictEvent extends GraphContextEventData {
	/** Whether a single-file side pick or resolve-all-conflicts */
	scope: 'file' | 'all';
	/** Which side was chosen */
	side: 'current' | 'incoming';
}

export type GraphWipStagingOperation = 'stage' | 'unstage' | 'discard' | 'stash' | 'resolveConflict';

interface GraphWipStagingFailedEvent extends GraphContextEventData {
	/** Which staging operation failed */
	operation: GraphWipStagingOperation;
	/** Scope of the failed operation */
	scope: string;
}

export type GraphDetailsFileAction =
	| 'open'
	| 'openOnRemote'
	| 'compareWorking'
	| 'comparePrevious'
	| 'compareWip'
	| 'compareBetween'
	| 'defaultAction'
	| 'multiDiff';

interface GraphDetailsFileOpenedEvent extends GraphContextEventData {
	/** Which file open/diff operation was triggered */
	action: GraphDetailsFileAction;
	/** Number of files opened (1 for single-file actions, N for multiDiff) */
	'files.count': number;
}

interface GraphDetailsCompareRefChangedEvent extends GraphContextEventData {
	/** Which side's ref the user changed (left = Base, right = Compare) */
	side: 'left' | 'right';
	/** Whether a new ref was picked (false = picker cancelled) */
	changed: boolean;
	/** Type of the newly picked ref (e.g. branch/tag/revision); undefined when cancelled */
	refType: string | undefined;
}

interface GraphDetailsCompareTabChangedEvent extends GraphContextEventData {
	'tab.new': 'all' | 'ahead' | 'behind';
	'tab.old': 'all' | 'ahead' | 'behind';
	/** Commits ahead at switch time */
	'ahead.count': number;
	/** Commits behind at switch time */
	'behind.count': number;
}

interface GraphDetailsCompareOpenedInSearchAndCompareEvent extends GraphContextEventData {
	tab: 'all' | 'ahead' | 'behind';
	includeWorkingTree: boolean;
}

interface GraphDetailsCompareExplainEvent extends GraphContextEventData {
	/** Single-commit/range compare vs branch-compare tabs */
	variant: 'compare' | 'branchCompare';
	/** Whether the user supplied custom guidance */
	hasCustomPrompt: boolean;
	/** Active tab driving the diff direction (branch-compare only; undefined otherwise) */
	tab: 'all' | 'ahead' | 'behind' | undefined;
	includeWorkingTree: boolean;
}

interface GraphDetailsCompareGenerateChangelogEvent extends GraphContextEventData {
	variant: 'compare' | 'branchCompare';
	tab: 'all' | 'ahead' | 'behind' | undefined;
	includeWorkingTree: boolean;
}

interface GraphDetailsCommitExplainEvent extends GraphContextEventData {
	/** Whether the user supplied custom guidance */
	hasCustomPrompt: boolean;
	/** Whether the target is a stash entry rather than a regular commit */
	isStash: boolean;
}

interface GraphVirtualFileOpenedEvent extends GraphContextEventData {
	/** Which open operation the user triggered */
	mode: GraphVirtualFileMode;
	/** Number of files being opened (1 for single-file modes, N for multiDiff) */
	'files.count': number;
}

interface GraphVirtualFileFailedEvent extends GraphContextEventData {
	mode: GraphVirtualFileMode;
	/** Best-effort categorization of the failure */
	reason: GraphVirtualFileFailureReason;
	'files.count': number;
	'error.message'?: string;
}

interface GraphSidebarOverviewShownEvent extends GraphContextEventData {
	/** Number of branches in the "active" section at the time of show */
	'branches.active.count': number;
	/** Number of branches in the "recent" section at the time of show */
	'branches.recent.count': number;
	/** Active Recent timeframe threshold at the time of show */
	recentThreshold: 'OneDay' | 'OneWeek' | 'OneMonth';
}

export type GraphSidebarOverviewActionName =
	| 'pull'
	| 'push'
	| 'fetch'
	| 'publishBranch'
	| 'switch'
	| 'openWorktree'
	| 'compareWithHead'
	| 'compareWithWorking'
	| 'compareWithPr'
	| 'openPrChanges'
	| 'openChanges'
	| 'other';

interface GraphSidebarOverviewActionEvent extends GraphContextEventData {
	name: GraphSidebarOverviewActionName;
	/** Where on the card the action was invoked */
	location: 'inline' | 'hover';
	/** Whether the user held Alt/Shift to swap to the alt action */
	alt: boolean;
}

interface GraphSidebarOverviewRecentThresholdChangedEvent extends GraphContextEventData {
	/** New threshold value selected by the user */
	threshold: 'OneDay' | 'OneWeek' | 'OneMonth';
}

interface GraphSidebarOverviewBranchSelectedEvent extends GraphContextEventData {
	/** Whether the branch is the currently opened (active) branch */
	isActive: boolean;
	/** Whether the branch is checked out in a worktree */
	isWorktree: boolean;
	/** Whether the branch has an associated pull request */
	hasPr: boolean;
	/** Whether the branch has associated issues or autolinks */
	hasIssues: boolean;
	/** Whether the branch has uncommitted working tree changes */
	hasWip: boolean;
}

interface GraphSidebarOverviewHoverShownEvent extends GraphContextEventData {
	/** Whether the branch is the currently opened (active) branch */
	isActive: boolean;
	/** Whether the branch is checked out in a worktree */
	isWorktree: boolean;
	/** Whether the branch has an associated pull request */
	hasPr: boolean;
	/** Whether the branch has associated issues or autolinks */
	hasIssues: boolean;
	/** Whether the branch has uncommitted working tree changes */
	hasWip: boolean;
	/** Whether the branch has active agent sessions */
	hasAgents: boolean;
}

interface GraphSidebarOverviewLinkClickedEvent extends GraphContextEventData {
	/** Type of external link clicked */
	type: 'pullrequest' | 'issue' | 'autolink';
}

interface GraphSidebarAgentsShownEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'sessions.count': number;
	'sessions.working.count': number;
	'sessions.needsInput.count': number;
	'sessions.idle.count': number;
}

interface GraphSidebarAgentsSessionSelectedEvent extends GraphContextEventData {
	'session.phase': string;
	'session.category': 'working' | 'needs-input' | 'idle';
	'session.hasPendingPermission': boolean;
	'session.sameRepo': boolean;
	layout: 'list' | 'tree';
}

interface GraphSidebarAgentsPermissionResolvedEvent extends GraphContextEventData {
	decision: 'allow' | 'deny';
	alwaysAllow: boolean;
	'permission.kind': string;
}

interface GraphSidebarAgentsSessionActionEvent extends GraphContextEventData {
	action: 'openSession' | 'openPlanFile' | 'openTerminal';
}

interface GraphSidebarAgentsHeaderActionEvent extends GraphContextEventData {
	action: 'startWork' | 'startReview' | 'refresh';
}

interface GraphSidebarAgentsLayoutToggledEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'sessions.count': number;
}

interface GraphSidebarAgentsFilteredEvent extends GraphContextEventData {
	hasFilter: boolean;
	'filter.length': number;
	'sessions.count': number;
}

interface GraphSidebarWorktreesShownEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'worktrees.count': number;
}

interface GraphSidebarWorktreesWorktreeSelectedEvent extends GraphContextEventData {
	isActive: boolean;
	isDefault: boolean;
	hasChanges: boolean;
	hasUpstream: boolean;
}

export type GraphSidebarWorktreesActionName =
	| 'pull'
	| 'push'
	| 'fetch'
	| 'openWorktree'
	| 'openWorktreeInNewWindow'
	| 'delete'
	| 'revealInExplorer'
	| 'openInTerminal'
	| 'copyWorkingChanges'
	| 'rename'
	| 'publish'
	| 'setUpstream'
	| 'changeUpstream'
	| 'reset'
	| 'rebaseOntoUpstream';

interface GraphSidebarWorktreesWorktreeActionEvent extends GraphContextEventData {
	action: GraphSidebarWorktreesActionName;
	alt: boolean;
	/** Where the action was invoked from — hover-icon (inline) vs the right-click context menu */
	location: 'inline' | 'contextMenu';
}

interface GraphSidebarWorktreesHeaderActionEvent extends GraphContextEventData {
	action: 'createWorktree' | 'refresh';
}

interface GraphSidebarWorktreesLayoutToggledEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'worktrees.count': number;
}

interface GraphSidebarWorktreesFilteredEvent extends GraphContextEventData {
	hasFilter: boolean;
	'filter.length': number;
	'worktrees.count': number;
}

/** Fired when the branches panel becomes the active sidebar panel and its data has loaded.
 *  Note: "shown" means mounted-active — in kanban/visualizations display modes the sidebar
 *  split stays mounted but hidden, so a panel activation there still counts. The panel is
 *  local-only (remote branches are filtered out host-side), so the count covers local branches. */
interface GraphSidebarBranchesShownEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'branches.count': number;
}

interface GraphSidebarBranchesBranchSelectedEvent extends GraphContextEventData {
	isCurrent: boolean;
	hasUpstream: boolean;
	hasWorktree: boolean;
	isStarred: boolean;
}

export type GraphSidebarBranchesActionName =
	| 'switch'
	| 'fetch'
	| 'pull'
	| 'push'
	| 'compareWithHead'
	| 'compareWithWorking'
	| 'openWorktree'
	| 'openWorktreeInNewWindow'
	| 'delete'
	| 'rename'
	| 'merge'
	| 'rebaseOntoBranch'
	| 'rebaseOntoUpstream'
	| 'reset'
	| 'publish'
	| 'setUpstream'
	| 'changeUpstream';

interface GraphSidebarBranchesBranchActionEvent extends GraphContextEventData {
	action: GraphSidebarBranchesActionName;
	alt: boolean;
	/** Where the action was invoked from — hover-icon (inline) vs the right-click context menu */
	location: 'inline' | 'contextMenu';
}

interface GraphSidebarBranchesHeaderActionEvent extends GraphContextEventData {
	action: 'switchToBranch' | 'createBranch' | 'refresh';
}

interface GraphSidebarBranchesLayoutToggledEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'branches.count': number;
}

interface GraphSidebarBranchesFilteredEvent extends GraphContextEventData {
	hasFilter: boolean;
	'filter.length': number;
	/** Total branches in the panel (the filter corpus), NOT the number of matches — matching
	 *  happens inside the tree component and the match count isn't surfaced. */
	'branches.count': number;
}

interface GraphSidebarRemotesShownEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'remotes.count': number;
	/** Remotes whose integration is connected */
	'remotes.connected.count': number;
	hasMultipleRemotes: boolean;
}

export type GraphSidebarRemotesActionName =
	| 'fetch'
	| 'openOnRemote'
	| 'copyUrl'
	| 'connectIntegration'
	| 'disconnectIntegration'
	| 'openBranchesOnRemote'
	| 'copyBranchesUrl'
	| 'prune'
	| 'remove'
	| 'setDefault'
	| 'unsetDefault';

interface GraphSidebarRemotesRemoteActionEvent extends GraphContextEventData {
	action: GraphSidebarRemotesActionName;
	alt: boolean;
	/** Where the action was invoked from — hover-icon (inline) vs the right-click context menu */
	location: 'inline' | 'contextMenu';
}

interface GraphSidebarRemotesHeaderActionEvent extends GraphContextEventData {
	action: 'addRemote' | 'refresh';
}

interface GraphSidebarRemotesLayoutToggledEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'remotes.count': number;
}

interface GraphSidebarRemotesFilteredEvent extends GraphContextEventData {
	hasFilter: boolean;
	'filter.length': number;
	/** Total remotes in the panel (the filter corpus), NOT the number of matches — matching
	 *  happens inside the tree component and the match count isn't surfaced. */
	'remotes.count': number;
}

interface GraphSidebarStashesShownEvent extends GraphContextEventData {
	'stashes.count': number;
}

interface GraphSidebarStashesStashSelectedEvent extends GraphContextEventData {
	/** Whether the stash carries the branch ref it was created on */
	hasStashOnRef: boolean;
}

export type GraphSidebarStashesActionName = 'apply' | 'delete' | 'rename';

interface GraphSidebarStashesStashActionEvent extends GraphContextEventData {
	action: GraphSidebarStashesActionName;
	/** Reserved for parity with other panels' item actions — no stash inline action defines an alt variant yet, so always false today */
	alt: boolean;
	/** Where the action was invoked from — hover-icon (inline) vs the right-click context menu */
	location: 'inline' | 'contextMenu';
}

interface GraphSidebarStashesHeaderActionEvent extends GraphContextEventData {
	action: 'stashAll' | 'applyStash' | 'refresh';
}

interface GraphSidebarStashesFilteredEvent extends GraphContextEventData {
	hasFilter: boolean;
	'filter.length': number;
	'stashes.count': number;
}

interface GraphSidebarTagsShownEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'tags.count': number;
	/** Number of annotated tags (tag objects with their own metadata) vs lightweight refs */
	'tags.annotated.count': number;
}

interface GraphSidebarTagsTagSelectedEvent extends GraphContextEventData {
	/** Whether the selected tag is annotated (a tag object) vs a lightweight ref */
	annotated: boolean;
}

export type GraphSidebarTagsActionName = 'switchTo' | 'delete' | 'createBranch' | 'reset';

interface GraphSidebarTagsTagActionEvent extends GraphContextEventData {
	action: GraphSidebarTagsActionName;
	/** Reserved for parity with other panels' item actions — no tag inline action defines an alt variant yet, so always false today */
	alt: boolean;
	/** Where the action was invoked from — hover-icon (inline) vs the right-click context menu */
	location: 'inline' | 'contextMenu';
}

interface GraphSidebarTagsHeaderActionEvent extends GraphContextEventData {
	action: 'createTag' | 'refresh';
}

interface GraphSidebarTagsLayoutToggledEvent extends GraphContextEventData {
	layout: 'list' | 'tree';
	'tags.count': number;
}

interface GraphSidebarTagsFilteredEvent extends GraphContextEventData {
	hasFilter: boolean;
	'filter.length': number;
	'tags.count': number;
}

/** Flat key identifying a Graph visualization — collapses the two-axis
 *  (visualizationMode × treemapMode) state so one field names the active visualization,
 *  matching the switcher's tab model. */
export type GraphVisualizationKey = 'timeline' | 'treemap-files' | 'treemap-commits' | 'treemap-activity';

interface GraphVisualizationsModeChangedEvent extends GraphContextEventData {
	'mode.old': GraphVisualizationKey;
	'mode.new': GraphVisualizationKey;
	/** `fallback` when a virtual repo forced Commits → Files on mount (not a user action) */
	reason: 'user' | 'fallback';
}

interface GraphVisualizationsClosedEvent extends GraphContextEventData {
	mode: GraphVisualizationKey;
}

interface GraphTimelineShownEvent extends GraphContextEventData {
	period: string;
	sliceBy: 'author' | 'branch';
	scoped: boolean;
}

interface GraphTimelineCommitSelectedEvent extends GraphContextEventData {
	shift: boolean;
}

interface GraphTimelinePeriodChangedEvent extends GraphContextEventData {
	'period.old': string;
	'period.new': string;
}

interface GraphTimelineSliceByChangedEvent extends GraphContextEventData {
	'sliceBy.old': 'author' | 'branch';
	'sliceBy.new': 'author' | 'branch';
}

interface GraphTimelineScopeChangedEvent extends GraphContextEventData {
	action: 'choose' | 'clear' | 'breadcrumb';
	'scope.type'?: 'file' | 'folder';
	/** Whether a file/folder scope is active AFTER this change */
	scoped: boolean;
}

interface GraphTreemapShownEvent extends GraphContextEventData {
	mode: 'files' | 'commits' | 'activity';
	'files.count': number;
	/** Only set in `commits` mode — the other modes have no period axis */
	period?: string;
}

interface GraphTreemapZoomedEvent extends GraphContextEventData {
	mode: 'files' | 'commits' | 'activity';
	direction: 'in' | 'out';
	/** Folder depth of the zoom target; 0 = back at the root */
	depth: number;
}

interface GraphTreemapFileClickedEvent extends GraphContextEventData {
	mode: 'files' | 'commits' | 'activity';
	action: 'open' | 'history';
	/** Only set in `activity` mode — whether the click also focused an agent session that touched the file */
	'session.focused'?: boolean;
}

interface GraphTreemapPeriodChangedEvent extends GraphContextEventData {
	'period.old': string;
	'period.new': string;
}

interface GraphTreemapDecayChangedEvent extends GraphContextEventData {
	'decay.old': string;
	'decay.new': string;
}

interface GraphKanbanShownEvent extends GraphContextEventData {
	'sessions.count': number;
	'sessions.working.count': number;
	'sessions.needsInput.count': number;
	'sessions.idle.count': number;
	'sessions.inactive.count': number;
}

interface GraphKanbanSessionSelectedEvent extends GraphContextEventData {
	'session.phase': string;
	'session.category': 'working' | 'needs-input' | 'idle';
	'session.hasPendingPermission': boolean;
	'session.sameRepo': boolean;
	column: 'needs-input' | 'working' | 'idle' | 'inactive';
}

interface GraphKanbanSessionActionEvent extends GraphContextEventData {
	action: 'openSession' | 'openPlanFile';
}

interface GraphKanbanPermissionResolvedEvent extends GraphContextEventData {
	decision: 'allow' | 'deny';
	'permission.kind': string;
}

export type HomeTelemetryContext = WebviewTelemetryContext;

interface HomeFailedEvent {
	reason: 'subscription';
	error: string;
	'error.detail'?: string;
}

type InspectCommitContextEventData = {
	'context.mode': 'commit';
	'context.autolinks': number;
	'context.pinned': boolean;
	'context.type': 'commit' | 'stash' | undefined;
	'context.uncommitted': boolean;
};

type InspectContextEventData = WebviewTelemetryContext & InspectCommitContextEventData;

type InspectShownEventData = InspectContextEventData & FlattenedContextConfig<Config['views']['commitDetails']>;

export type InspectTelemetryContext = InspectContextEventData;
export type InspectShownTelemetryContext = InspectShownEventData;

/** Telemetry context fields pushed from the Inspect webview to the host via RPC. */
export type InspectWebviewTelemetryContext = Pick<
	InspectCommitContextEventData,
	'context.autolinks' | 'context.type' | 'context.uncommitted'
>;

export type ComposerTelemetryContext = ComposerContextEventData;
type ComposerContextEventData = WebviewTelemetryContext & ComposerSessionContextEventData;
type ComposerContextSessionData = {
	'context.session.start': string;
	'context.session.duration': number | undefined;
};
type ComposerContextDiffData = {
	'context.diff.files.count': number;
	'context.diff.hunks.count': number;
	'context.diff.lines.count': number;
	'context.diff.hash': string;
	'context.diff.staged.exists': boolean;
	'context.diff.unstaged.exists': boolean;
	'context.diff.unstaged.included': boolean;
};
type ComposerContextCommitsData = {
	'context.commits.initialCount': number;
	'context.commits.autoComposedCount': number | undefined;
	'context.commits.composedCount': number | undefined;
	'context.commits.finalCount': number | undefined;
};
type ComposerContextOnboardingData = {
	'context.onboarding.dismissed': boolean;
	'context.onboarding.stepReached': number | undefined;
};
type ComposerContextAIData = {
	'context.ai.enabled.org': boolean;
	'context.ai.enabled.config': boolean;
	'context.ai.model.id': string | undefined;
	'context.ai.model.name': string | undefined;
	'context.ai.model.provider.id': AIProviders | undefined;
	'context.ai.model.temperature': number | undefined;
	'context.ai.model.maxTokens.input': number | undefined;
	'context.ai.model.maxTokens.output': number | undefined;
	'context.ai.model.default': boolean | undefined;
	'context.ai.model.hidden': boolean | undefined;
};
type ComposerContextOperationData = {
	'context.operations.generateCommits.count': number;
	'context.operations.generateCommits.cancelled.count': number;
	'context.operations.generateCommits.error.count': number;
	'context.operations.generateCommits.feedback.upvote.count': number;
	'context.operations.generateCommits.feedback.downvote.count': number;
	'context.operations.generateCommitMessage.count': number;
	'context.operations.generateCommitMessage.cancelled.count': number;
	'context.operations.generateCommitMessage.error.count': number;
	'context.operations.finishAndCommit.error.count': number;
	'context.operations.undo.count': number;
	'context.operations.redo.count': number;
	'context.operations.reset.count': number;
};
type ComposerContextWarningsData = {
	'context.warnings.workingDirectoryChanged': boolean;
	'context.warnings.indexChanged': boolean;
};
type ComposerContextErrorsData = {
	'context.errors.safety.count': number;
	'context.errors.operation.count': number;
};

type ComposerSessionContextEventData = ComposerContextSessionData &
	ComposerContextDiffData &
	ComposerContextCommitsData &
	ComposerContextOnboardingData &
	ComposerContextAIData &
	ComposerContextOperationData &
	ComposerContextWarningsData &
	ComposerContextErrorsData & {
		'context.source': Sources | undefined;
		'context.mode': 'experimental' | 'preview';
	};

type ComposerEvent = ComposerContextEventData;

type ComposerLoadedEvent = ComposerContextEventData &
	Partial<{
		'failure.reason': 'error';
		'failure.error.message': string;
	}>;

type ComposerGenerateCommitsEvent = ComposerContextEventData & {
	'customInstructions.used': boolean;
	'customInstructions.length': number;
	'customInstructions.hash': string;
	'customInstructions.setting.used': boolean;
	'customInstructions.setting.length': number;
	'customInstructions.commitMessage.setting.used': boolean;
	'customInstructions.commitMessage.setting.length': number;
};

type ComposerActionFailureEventData =
	| {
			'failure.reason': 'cancelled';
			'failure.error.message'?: never;
	  }
	| {
			'failure.reason': 'error';
			'failure.error.message': string;
	  };

type ComposerGenerateCommitsFailedEvent = ComposerGenerateCommitsEvent & ComposerActionFailureEventData;

type ComposerGenerateCommitMessageEvent = ComposerContextEventData & {
	'customInstructions.setting.used': boolean;
	'customInstructions.setting.length': number;
	overwriteExistingMessage: boolean;
};

type ComposerGenerateCommitMessageFailedEvent = ComposerGenerateCommitMessageEvent & ComposerActionFailureEventData;

type ComposerFinishAndCommitFailedEvent = ComposerContextEventData & {
	'failure.reason': 'error';
	'failure.error.message': string;
};

interface LaunchpadEventDataBase {
	/** @order 1 */
	instance: number;
	'initialState.group': string | undefined;
	'initialState.selectTopItem': boolean;
}

type LaunchpadGroups =
	| 'current-branch'
	| 'pinned'
	| 'mergeable'
	| 'blocked'
	| 'follow-up'
	| 'needs-review'
	| 'waiting-for-review'
	| 'draft'
	| 'other'
	| 'snoozed';

type LaunchpadGroupsEventData = { 'groups.count': number } & Record<`groups.${LaunchpadGroups}.count`, number> &
	Record<`groups.${LaunchpadGroups}.collapsed`, boolean | undefined>;

type LaunchpadEventData = LaunchpadEventDataBase & {
	/** @order 2 */
	'items.error'?: string;
	'items.count'?: number;
	'items.timings.prs'?: number;
	'items.timings.codeSuggestionCounts'?: number;
	'items.timings.enrichedItems'?: number;
} & Partial<LaunchpadGroupsEventData>;

export type LaunchpadTelemetryContext = LaunchpadEventData;

type LaunchpadTitleActionEvent = LaunchpadEventData & {
	action: 'feedback' | 'open-on-gkdev' | 'refresh' | 'settings' | 'connect';
};

type LaunchpadActionEvent = LaunchpadEventData & {
	action:
		| 'open'
		| 'merge'
		| 'soft-open'
		| 'switch'
		| 'open-worktree'
		| 'start-review'
		| 'show-overview'
		| 'open-changes'
		| 'open-in-graph'
		| 'pin'
		| 'unpin'
		| 'snooze'
		| 'unsnooze'
		| 'open-suggestion'
		| 'open-suggestion-browser';
} & Partial<Record<`item.${string}`, string | number | boolean>>;

type LaunchpadAgentResolvedEvent = LaunchpadEventData & AgentResolvedEventData;

interface LaunchpadConfigurationChangedEvent {
	'config.launchpad.staleThreshold': number | null;
	'config.launchpad.includedOrganizations': number;
	'config.launchpad.ignoredOrganizations': number;
	'config.launchpad.ignoredRepositories': number;
	'config.launchpad.indicator.enabled': boolean;
	'config.launchpad.indicator.icon': 'default' | 'group';
	'config.launchpad.indicator.label': false | 'item' | 'counts';
	'config.launchpad.indicator.useColors': boolean;
	'config.launchpad.indicator.groups': string;
	'config.launchpad.indicator.polling.enabled': boolean;
	'config.launchpad.indicator.polling.interval': number;
}

type LaunchpadGroupToggledEvent = LaunchpadEventData & {
	group: LaunchpadGroups;
	collapsed: boolean;
};

type LaunchpadConnectedEventData = LaunchpadEventData & {
	connected: boolean;
};

type LaunchpadStepsDetailsEvent = LaunchpadEventData & {
	action: 'select';
} & Partial<Record<`item.${string}`, string | number | boolean>>;

interface LaunchpadOperationSlowEvent {
	timeout: number;
	operation:
		| 'getPullRequest'
		| 'searchPullRequests'
		| 'getMyPullRequests'
		| 'getCodeSuggestions'
		| 'getEnrichedItems'
		| 'getCodeSuggestionCounts';
	duration: number;
}

interface OperationGateDeadlockEvent {
	key: string;
	prop: string;
	timeout: number;
	/** Whether this is just a warning or the gate was forcibly cleared */
	status: 'warning' | 'aborted';
}

interface OperationGitAbortedEvent {
	operation: string;
	duration: number;
	timeout: number;
	reason: 'timeout' | 'cancellation' | 'unknown';
}

interface OperationGitDirResolveFailedEvent {
	'repository.path': string;
	'git.dir': string;
	'error.message': string | undefined;
}

interface OperationGitQueueWaitEvent {
	/** Priority level of the command that waited */
	priority: 'interactive' | 'normal' | 'background';
	/** Time in ms the command waited in the queue before executing */
	waitTime: number;
	/** Number of active git processes when this command started */
	active: number;
	/** Number of interactive commands queued */
	'queued.interactive': number;
	/** Number of normal commands queued */
	'queued.normal': number;
	/** Number of background commands queued */
	'queued.background': number;
	/** Configured max concurrent processes */
	maxConcurrent: number;
}

interface ProductConfigFailedEvent {
	reason: 'fetch' | 'validation';
	json: string | undefined;
	exception?: string;
	statusCode?: number | undefined;
}

interface ProvidersRegistrationCompleteEvent {
	'config.git.autoRepositoryDetection': boolean | 'subFolders' | 'openEditors' | undefined;
}

export type RebaseEditorTelemetryContext = WebviewTelemetryContext & {
	'context.ascending': boolean;
	'context.todo.count': number | undefined;
	'context.done.count': number | undefined;
	'context.isRebasing': boolean | undefined;
	'context.isPaused': boolean | undefined;
	'context.preservesMerges': boolean | undefined;
	'context.hasConflicts': boolean | undefined;
	'context.session.start': string;
};
type RebaseEditorContextEventData = RebaseEditorTelemetryContext;

type RebaseEditorCompletionEventData = RebaseEditorTelemetryContext & {
	'context.session.duration': number;
};

type RebaseEditorShownEventData = RebaseEditorContextEventData & FlattenedContextConfig<Config['rebaseEditor']>;
export type RebaseEditorShownTelemetryContext = RebaseEditorShownEventData;

type RebaseEditorShownEvent = WebviewShownEventData & RebaseEditorShownEventData;

interface RebaseEditorToggleOrderingEvent extends RebaseEditorContextEventData {
	'ordering.old': 'asc' | 'desc';
	'ordering.new': 'asc' | 'desc';
}

interface RebaseEditorOpenConflictFileEvent extends RebaseEditorContextEventData {
	/** File extension of the opened conflict file (e.g. '.ts', '.json') */
	'conflict.fileExtension': string;
}

interface RebaseEditorOpenConflictChangesEvent extends RebaseEditorContextEventData {
	/** Which side of the conflict was opened */
	side: 'current' | 'incoming';
}

interface RebaseEditorResolveConflictEvent extends RebaseEditorContextEventData {
	/** Which side of the conflict was taken */
	'conflict.resolution': 'current' | 'incoming';
	/** File extension of the resolved conflict file (e.g. '.ts', '.json') */
	'conflict.fileExtension': string;
	/** Two-character conflict status (e.g. 'UU', 'AU') */
	'conflict.status': string;
}

interface RebaseEditorStageConflictEvent extends RebaseEditorContextEventData {
	/** File extension of the staged conflict file (e.g. '.ts', '.json') */
	'conflict.fileExtension': string;
	/** Two-character conflict status (e.g. 'UU', 'AU') */
	'conflict.status': string;
}

interface RebaseEditorResolveAllConflictsEvent extends RebaseEditorContextEventData {
	/** Which side of the conflict was taken for all files */
	'conflict.resolution': 'current' | 'incoming';
	/** Total number of conflicted files at the time of confirmation */
	'conflict.fileCount': number;
	/** Number of files successfully resolved (checked out or deleted, and then staged) */
	'conflict.fileCount.resolved': number;
	/** Number of files skipped because the requested side is unsupported for their status */
	'conflict.fileCount.skipped': number;
	/** Number of files whose resolution failed (checkout or staging error) */
	'conflict.fileCount.failed': number;
}

interface RebaseEditorRevealRefEvent extends RebaseEditorContextEventData {
	/** Type of ref being revealed */
	'ref.type': 'commit' | 'branch';
	/** Where the ref is being revealed */
	location: 'graph' | 'commitDetails';
}

interface RebaseEditorEntriesChangedEvent extends RebaseEditorContextEventData {
	/** The new action applied */
	action: string;
	/** Number of entries changed */
	count: number;
}

interface RebaseEditorEntriesMovedEvent extends RebaseEditorContextEventData {
	/** Number of entries moved */
	count: number;
	/** Method used to move entries */
	method: 'drag' | 'keyboard';
}

interface RebaseEditorConflictsDetectedEvent extends RebaseEditorContextEventData {
	/** Duration of conflict detection in milliseconds */
	duration: number;
	/** Result status */
	status: 'clean' | 'conflicts';
	/** Which detection mode produced this event */
	detection: 'potential' | 'todo';
	/** Number of commits checked */
	'commits.count': number;
	/** Number of conflicting commits (only when status is 'conflicts') */
	'commits.conflicting'?: number;
}

interface RebaseEditorConflictsFailedEvent extends RebaseEditorContextEventData {
	/** Duration before failure in milliseconds */
	duration: number;
	/** Number of commits that were being checked */
	'commits.count': number;
	/** Error message */
	error?: string;
}

export type RebaseEditorTelemetryEvent =
	| 'rebaseEditor/action/start'
	| 'rebaseEditor/action/abort'
	| 'rebaseEditor/action/continue'
	| 'rebaseEditor/action/skip'
	| 'rebaseEditor/action/switchToText'
	| 'rebaseEditor/action/toggleOrdering'
	| 'rebaseEditor/action/recompose'
	| 'rebaseEditor/action/showConflicts'
	| 'rebaseEditor/action/openConflictFile'
	| 'rebaseEditor/action/openConflictChanges'
	| 'rebaseEditor/action/resolveConflict'
	| 'rebaseEditor/action/stageConflict'
	| 'rebaseEditor/action/resolveAllConflicts'
	| 'rebaseEditor/action/resolveConflictsInGraph'
	| 'rebaseEditor/action/revealRef'
	| 'rebaseEditor/entries/changed'
	| 'rebaseEditor/entries/moved'
	| 'rebaseEditor/conflicts/detecting'
	| 'rebaseEditor/conflicts/detected'
	| 'rebaseEditor/conflicts/failed';

interface RemoteProvidersConnectedEvent {
	'hostingProvider.provider': IntegrationIds;
	'hostingProvider.key': string;
	/** @deprecated */
	'remoteProviders.key': string;
}

interface RemoteProvidersDisconnectedEvent {
	'hostingProvider.provider': IntegrationIds;
	'hostingProvider.key': string;
	/** @deprecated */
	'remoteProviders.key': string;
}

interface RepositoryEventData {
	'repository.id': string;
	'repository.scheme': string;
	'repository.closed': boolean;
	'repository.folder.scheme': string | undefined;
	'repository.provider.id': string;
}

type RepositoryContext = {
	[K in keyof RepositoryEventData as `context.${K}`]: RepositoryEventData[K];
};

interface RepositoriesChangedEvent {
	'repositories.added': number;
	'repositories.removed': number;
}

interface RepositoriesVisibilityEvent {
	'repositories.visibility': 'private' | 'public' | 'local' | 'mixed';
}

type RepositoryContributorsDistributionEventData = {
	[K in `repository.contributors.distribution.${GitContributionTiers}`]: number;
};

interface RepositoryOpenedEvent extends RepositoryEventData, RepositoryContributorsDistributionEventData {
	'repository.remoteProviders': string;
	'repository.submodules.openedCount': number;
	'repository.worktrees.openedCount': number;
	'repository.contributors.commits.count': number | undefined;
	'repository.contributors.commits.avgPerContributor': number | undefined;
	'repository.contributors.count': number | undefined;
	'repository.contributors.since': '1.year.ago';
}

interface RepositoryVisibilityEvent extends Partial<RepositoryEventData> {
	'repository.visibility': 'private' | 'public' | 'local' | undefined;
}

interface StartReviewEventDataBase {
	/** @order 1 */
	instance: number;
	/** Route requested by the caller for the manual-vs-agent flow; `undefined` when the caller didn't opt in. */
	'context.showOpenInAgent'?: AgentRoute;
}

interface StartReviewEventData extends StartReviewEventDataBase {
	'items.count'?: number;
}
export type StartReviewTelemetryContext = StartReviewEventData;

type StartReviewConnectedEventData = StartReviewEventData & {
	connected: boolean;
};

type StartReviewPrActionEvent = StartReviewConnectedEventData & {
	action: 'soft-open';
} & Partial<Record<`item.${string}`, string | number | boolean>>;

type StartReviewPrChosenEvent = StartReviewConnectedEventData &
	Partial<Record<`item.${string}`, string | number | boolean>>;

type StartReviewTitleActionEvent = StartReviewConnectedEventData & {
	action: 'connect';
};

type StartReviewActionEvent = StartReviewConnectedEventData & {
	action: 'manage' | 'connect';
};

type StartReviewAgentResolvedEvent = StartReviewConnectedEventData & AgentResolvedEventData;

interface StartWorkEventDataBase {
	/** @order 1 */
	instance: number;
	/** Route requested by the caller for the manual-vs-agent flow; `undefined` when the caller didn't opt in. */
	'context.showOpenInAgent'?: AgentRoute;
}

interface StartWorkEventData extends StartWorkEventDataBase {
	'items.count'?: number;
}
export type StartWorkTelemetryContext = StartWorkEventData;

type StartWorkConnectedEventData = StartWorkEventData & {
	connected: boolean;
};

type StartWorkIssueActionEvent = StartWorkConnectedEventData & {
	action: 'soft-open';
} & Partial<Record<`item.${string}`, string | number | boolean>>;

type StartWorkIssueChosenEvent = StartWorkConnectedEventData &
	Partial<Record<`item.${string}`, string | number | boolean>>;

type StartWorkTitleActionEvent = StartWorkConnectedEventData & {
	action: 'connect';
};

type StartWorkActionEvent = StartWorkConnectedEventData & {
	action: 'manage' | 'connect';
};

type StartWorkAgentResolvedEvent = StartWorkConnectedEventData & AgentResolvedEventData;

type AgentResolvedEventData =
	| {
			'agent.resolution': 'manual' | 'cancel';
	  }
	| {
			'agent.resolution': 'agent';
			'agent.id': string;
			'agent.kind': AgentDescriptor['kind'];
	  };

export type SubscriptionFeaturePreviewsEventData = {
	[F in FeaturePreviews]: {
		[K in Exclude<
			keyof FeaturePreviewEventData,
			'feature'
		> as `subscription.featurePreviews.${F}.${K}`]: NonNullable<FeaturePreviewEventData[K]>;
	};
}[FeaturePreviews];

export interface SubscriptionCurrentEventData
	extends
		Flatten<Omit<SubscriptionAccount, 'name' | 'email'>, 'account', true>,
		Omit<
			Flatten<Subscription['plan'], 'subscription', true>,
			'subscription.actual.name' | 'subscription.effective.name'
		>,
		SubscriptionFeaturePreviewsEventData {}

export interface SubscriptionPreviousEventData
	extends
		Flatten<Omit<SubscriptionAccount, 'name' | 'email'>, 'previous.account', true>,
		Omit<
			Flatten<Subscription['plan'], 'previous.subscription', true>,
			'previous.subscription.actual.name' | 'previous.subscription.effective.name'
		> {}

export interface SubscriptionEventData extends Partial<SubscriptionCurrentEventData> {
	/** Promo key (identifier) associated with the upgrade */
	'subscription.promo.key'?: string;
	/** Promo discount code associated with the upgrade */
	'subscription.promo.code'?: string;
	'subscription.state'?: SubscriptionState;
	'subscription.stateString'?: SubscriptionStateString;
}

type SubscriptionActionEventData =
	| {
			action:
				| 'sign-up'
				| 'sign-in'
				| 'sign-out'
				| 'manage'
				| 'manage-subscription'
				| 'reactivate'
				| 'refer-friend'
				| 'resend-verification'
				| 'pricing'
				| 'start-preview-trial';
	  }
	| {
			action: 'upgrade';
			/** `true` if the user cancels the VS Code prompt to open the browser */
			aborted: boolean;
			/** Promo key (identifier) associated with the upgrade */
			'promo.key'?: string;
			/** Promo discount code associated with the upgrade */
			'promo.code'?: string;
	  }
	| {
			action: 'visibility';
			visible: boolean;
	  }
	| FeaturePreviewActionEventData;

export interface SubscriptionEventDataWithPrevious
	extends SubscriptionEventData, Partial<SubscriptionPreviousEventData> {}

type TimelineContextEventData = WebviewTelemetryContext & {
	'context.period': TimelinePeriod | undefined;
	'context.scope.hasHead': boolean | undefined;
	'context.scope.hasBase': boolean | undefined;
	'context.scope.type': TimelineScopeType | undefined;
	'context.showAllBranches': boolean | undefined;
	'context.sliceBy': TimelineSliceBy | undefined;
};
export type TimelineTelemetryContext = TimelineContextEventData;

/** Telemetry context fields pushed from the Timeline webview to the host via RPC. */
export type TimelineWebviewTelemetryContext = Pick<
	TimelineContextEventData,
	'context.period' | 'context.showAllBranches' | 'context.sliceBy'
>;

type TimelineShownEventData = TimelineContextEventData & FlattenedContextConfig<Config['visualHistory']>;
export type TimelineShownTelemetryContext = TimelineShownEventData;

type TimelineShownEvent = WebviewShownEventData & TimelineShownEventData;

interface TimelineConfigChangedEvent extends TimelineContextEventData {
	period: TimelinePeriod;
	showAllBranches: boolean;
	sliceBy: TimelineSliceBy;
}

interface TimelineActionOpenInEditorEvent extends TimelineContextEventData {
	'scope.type': TimelineScopeType;
	'scope.hasHead': boolean;
	'scope.hasBase': boolean;
}

interface UsageTrackEvent {
	'usage.key': TrackedUsageKeys;
	'usage.count': number;
}

interface WalkthroughEvent {
	step?: WalkthroughSteps;
	usingFallbackUrl?: boolean;
}

type WalkthroughActionNames =
	| 'open/ai-custom-instructions-settings'
	| 'open/ai-enable-setting'
	| 'open/ai-settings'
	| 'open/help-center/ai-features'
	| 'open/help-center/accelerate-pr-reviews'
	| 'open/help-center/interactive-code-history'
	| 'open/help-center/community-vs-pro'
	| 'open/devex-platform'
	| 'open/drafts'
	| 'connect/integrations'
	| 'open/composer'
	| 'open/graph'
	| 'open/launchpad'
	| 'create/worktree'
	| 'open/help-center'
	| 'plus/login'
	| 'plus/sign-up'
	| 'plus/upgrade'
	| 'plus/reactivate'
	| 'open/walkthrough'
	| 'open/inspect'
	| 'switch/ai-model';

type WalkthroughActionEvent =
	| { type: 'command'; name: WalkthroughActionNames; command: string; detail?: string }
	| { type: 'url'; name: WalkthroughActionNames; url: string; detail?: string };

interface WalkthroughCompletionEvent {
	'context.key': WalkthroughContextKeys | GraphWalkthroughContextKeys;
}

type WelcomeActionNames =
	| 'dismiss'
	| 'open/composer'
	| 'open/graph'
	| 'open/home-view'
	| 'open/help-center'
	| 'open/help-center/community-vs-pro'
	| 'open/kepler'
	| 'open/launchpad'
	| 'plus/login'
	| 'plus/reactivate'
	| 'plus/sign-up'
	| 'plus/upgrade'
	| 'shown';

type WelcomeActionEvent =
	| { name: 'shown' | 'dismiss'; viewedCarouselPages?: number; proButtonClicked?: boolean }
	| { type: 'command'; name: WelcomeActionNames; command: string }
	| { type: 'url'; name: WelcomeActionNames; url: string };

type WebviewContextEventData = {
	'context.webview.id': string;
	'context.webview.type': string;
	'context.webview.instanceId': string | undefined;
	'context.webview.host': 'editor' | 'view' | 'panel';
};
export type WebviewTelemetryContext = WebviewContextEventData;

type WebviewShownEventData = WebviewContextEventData & {
	duration: number;
	loading: boolean;
};

/** Remaps TelemetryEvents to remove the host webview context when the event is sent from a webview app itself (not the host) */
export type WebviewTelemetryEvents = {
	[K in keyof TelemetryEvents]: Omit<
		TelemetryEvents[K],
		keyof (K extends `commitDetails/${string}`
			? InspectTelemetryContext
			: K extends `graph/${string}` | `graphDetails/${string}`
				? GraphTelemetryContext
				: K extends `timeline/${string}`
					? TimelineTelemetryContext
					: K extends `composer/${string}`
						? ComposerTelemetryContext
						: K extends `rebaseEditor/${string}`
							? RebaseEditorTelemetryContext
							: WebviewTelemetryContext)
	>;
};

/** Used to provide a "source context" to gk.dev for both tracking and customization purposes */
export type TrackingContext = 'graph' | 'launchpad' | 'mcp' | 'visual_file_history' | 'worktrees';

export type Sources =
	| 'account'
	| 'ai'
	| 'ai:markdown-preview'
	| 'ai:markdown-editor'
	| 'ai:picker'
	| 'associateIssueWithBranch'
	| 'cloud-patches'
	| 'code-suggest'
	| 'commandPalette'
	| 'composer'
	| 'deeplink'
	| 'editor:hover'
	| 'feature-badge'
	| 'feature-gate'
	| 'gk-cli-integration'
	| 'gk-mcp-provider'
	| 'graph'
	| 'graph-details'
	| 'graph-header'
	| 'graph-kanban'
	| 'graph-sidebar'
	| 'graph-treemap'
	| 'home'
	| 'inspect'
	| 'inspect-overview'
	| 'integrations'
	| 'launchpad'
	| 'launchpad-indicator'
	| 'launchpad-view'
	| 'mcp'
	| 'mcp-welcome-message'
	| 'merge-target'
	| 'notification'
	| 'patchDetails'
	| 'prompt'
	| 'quick-wizard'
	| 'rebaseEditor'
	| 'remoteProvider'
	| 'scm'
	| 'scm-input'
	| 'settings'
	| 'startReview'
	| 'startWork'
	| 'statusbar:hover'
	| 'subscription'
	| 'timeline'
	| 'trial-indicator'
	| 'view'
	| 'view:hover'
	| 'walkthrough'
	| 'welcome'
	| 'whatsnew'
	| 'worktrees';

export type Source = {
	source: Sources;
	correlationId?: string;
	detail?: string | TelemetryEventData;
};

export type TrackedUsage = {
	count: number;
	firstUsedAt: number;
	lastUsedAt: number;
};

/**
 * Actions that happen without a command
 */
export type TrackedGlActions =
	| 'gitlens.ai.generateCommits'
	| 'gitlens.ai.openInAgent'
	| 'gitlens.ai.openInAgent.dispatchFailed'
	| 'gitlens.ai.openInAgent.useDefaultsFallback'
	| 'gitlens.ai.review.copied'
	| 'gitlens.ai.review.sentToChat'
	| 'gitlens.graph.details.compareMode'
	| 'gitlens.graph.details.composeMode'
	| 'gitlens.graph.details.resolveMode'
	| 'gitlens.graph.details.reviewMode'
	| 'gitlens.graph.details.wipShown'
	| 'gitlens.graph.overview.shown'
	| 'gitlens.graph.scope.changed'
	| 'gitlens.graph.walkthrough.started'
	| 'gitlens.mcp.ipcRequest'
	| 'gitlens.mcp.bundledMcpDefinitionProvided';

export type TrackedUsageFeatures =
	| `${WebviewPanelTypes}Webview`
	| `${TreeViewTypes | WebviewViewTypes}View`
	| `${CustomEditorTypes}Editor`;
export type WalkthroughUsageKeys = 'home:walkthrough:dismissed';
type TrackedUsageCommandKeys = `command:${GlCommands | GlCommandsDeprecated}:executed`;
export type TrackedUsageKeys =
	| `${TrackedUsageFeatures}:shown`
	| `action:${TrackedGlActions}:happened`
	| TrackedUsageCommandKeys
	| WalkthroughUsageKeys;
