import type { Config, GraphBranchesVisibility, GraphConfig } from './config.js';
import type { AIProviders } from './constants.ai.js';
import type { GlCommands, GlCommandsDeprecated } from './constants.commands.js';
import type { IntegrationIds, SupportedCloudIntegrationIds } from './constants.integrations.js';
import type { WalkthroughSteps } from './constants.js';
import type { SubscriptionState } from './constants.subscription.js';
import type {
	CustomEditorTypes,
	TreeViewTypes,
	WebviewPanelTypes,
	WebviewTypes,
	WebviewViewTypes,
} from './constants.views.js';
import type { WalkthroughContextKeys } from './constants.walkthroughs.js';
import type { FeaturePreviews, FeaturePreviewStatus } from './features.js';
import type { GitContributionTiers } from './git/models/contributor.js';
import type { AIActionType } from './plus/ai/models/model.js';
import type { Subscription, SubscriptionAccount, SubscriptionStateString } from './plus/gk/models/subscription.js';
import type { Flatten } from './system/object.js';
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

	/** Sent when explaining changes from wip, commits, stashes, patches, etc. */
	'ai/explain': AIExplainEvent;

	/** Sent when generating summaries from commits, stashes, patches, etc. */
	'ai/generate': AIGenerateEvent;

	/** Sent when AI is enabled */
	'ai/enabled': void;

	/** Sent when switching ai models */
	'ai/switchModel': AISwitchModelEvent;

	/** Sent when a user provides feedback (rating and optional details) for an AI feature */
	'ai/feedback': AIFeedbackEvent;

	/** Sent when user dismisses the AI All Access banner */
	'aiAllAccess/bannerDismissed': void;

	/** Sent when user opens the AI All Access page */
	'aiAllAccess/opened': void;

	/** Sent when user opts in to AI All Access */
	'aiAllAccess/optedIn': void;

	/** Sent when a CLI install attempt is started */
	'cli/install/started': CLIInstallStartedEvent;
	/** Sent when a CLI install attempt succeeds */
	'cli/install/succeeded': CLIInstallSucceededEvent;
	/** Sent when a CLI install attempt fails */
	'cli/install/failed': CLIInstallFailedEvent;

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
	/** Sent when the user changes the selected tab (mode) on the Graph Details view */
	'commitDetails/mode/changed': DetailsModeChangedEvent;
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

	/** Sent when the Commit Graph is shown */
	'graph/shown': GraphShownEvent;
	/** Sent when a Commit Graph command is executed */
	'graph/command': CommandEventData;

	/** Sent when the user clicks on the Jump to HEAD/Reference (alt) header button on the Commit Graph */
	'graph/action/jumpTo': GraphActionJumpToEvent;
	/** Sent when the user clicks on the "Jump to HEAD"/"Jump to Reference" (alt) header button on the Commit Graph */
	'graph/action/openRepoOnRemote': GraphContextEventData;
	/** Sent when the user clicks on the "Open Repository on Remote" header button on the Commit Graph */
	'graph/action/sidebar': GraphActionSidebarEvent;

	/** Sent when the user changes the "branches visibility" on the Commit Graph */
	'graph/branchesVisibility/changed': GraphBranchesVisibilityChangedEvent;
	/** Sent when the user changes the columns on the Commit Graph */
	'graph/columns/changed': GraphColumnsChangedEvent;
	/** Sent when the user changes the filters on the Commit Graph */
	'graph/filters/changed': GraphFiltersChangedEvent;
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

	/** Sent when the Graph Details view is shown */
	'graphDetails/shown': DetailsShownEvent;
	/** Sent when the user changes the selected tab (mode) on the Graph Details view */
	'graphDetails/mode/changed': DetailsModeChangedEvent;
	/** Sent when commit reachability is successfully loaded in Graph Details */
	'graphDetails/reachability/loaded': DetailsReachabilityLoadedEvent;
	/** Sent when commit reachability fails to load in Graph Details */
	'graphDetails/reachability/failed': DetailsReachabilityFailedEvent;

	/** Sent when a Home command is executed */
	'home/command': CommandEventData;
	/** Sent when the new Home view preview is toggled on/off */
	'home/preview/toggled': HomePreviewToggledEvent;
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

	/** Sent when a PR review was started in the inspect overview */
	openReviewMode: OpenReviewModeEvent;

	'op/gate/deadlock': OperationGateDeadlockEvent;
	'op/git/aborted': OperationGitAbortedEvent;
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
		'commitDetails' | 'graph' | 'graphDetails' | 'rebaseEditor' | 'timeline'
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

interface ActivateEvent extends ConfigEventData {
	'activation.elapsed': number;
	'activation.mode': string | undefined;
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
	changeType: 'wip' | 'stash' | 'commit' | 'branch' | `draft-${'patch' | 'stash' | 'suggested_pr_change'}`;
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

export interface MCPSetupStartedEvent {
	source: Sources;
}

export interface MCPSetupCompletedEvent {
	source: Sources;
	'cli.version'?: string;
	requiresUserCompletion: boolean;
}

export interface MCPSetupFailedEvent {
	source: Sources;
	reason: string;
	'cli.version'?: string;
	'error.message'?: string;
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

type DetailsModeChangedEvent = InspectContextEventData & {
	'mode.old': 'wip' | 'commit';
	'mode.new': 'wip' | 'commit';
};

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

interface GraphActionSidebarEvent extends GraphContextEventData {
	action: string;
}

interface GraphBranchesVisibilityChangedEvent extends GraphContextEventData {
	'branchesVisibility.old': GraphBranchesVisibility;
	'branchesVisibility.new': GraphBranchesVisibility;
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

export type HomeTelemetryContext = WebviewTelemetryContext & {
	'context.preview': string | undefined;
};

interface HomePreviewToggledEvent {
	enabled: boolean;
	version: string;
}

interface HomeFailedEvent {
	reason: 'subscription';
	error: string;
	'error.detail'?: string;
}

type InspectWipContextEventData = {
	'context.mode': 'wip';
	'context.attachedTo': 'graph' | 'default';
	'context.autolinks': number;
	'context.inReview': boolean;
	'context.codeSuggestions': number;
} & Partial<RepositoryContext>;

type InspectCommitContextEventData = {
	'context.mode': 'commit';
	'context.attachedTo': 'graph' | 'default';
	'context.autolinks': number;
	'context.pinned': boolean;
	'context.type': 'commit' | 'stash' | undefined;
	'context.uncommitted': boolean;
};

type InspectContextEventData = WebviewTelemetryContext & (InspectWipContextEventData | InspectCommitContextEventData);

type InspectShownEventData = InspectContextEventData & FlattenedContextConfig<Config['views']['commitDetails']>;

export type InspectTelemetryContext = InspectContextEventData;
export type InspectShownTelemetryContext = InspectShownEventData;

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
		| 'code-suggest'
		| 'merge'
		| 'soft-open'
		| 'switch'
		| 'open-worktree'
		| 'switch-and-code-suggest'
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

interface OpenReviewModeEvent {
	provider: string;
	'repository.visibility': 'private' | 'public' | 'local' | undefined;
	/** Provided for compatibility with other GK surfaces */
	repoPrivacy: 'private' | 'public' | 'local' | undefined;
	filesChanged: number;
	/** Provided for compatibility with other GK surfaces */
	source: Sources;
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

interface StartWorkEventDataBase {
	/** @order 1 */
	instance: number;
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
	'context.key': WalkthroughContextKeys;
}

type WelcomeActionNames =
	| 'dismiss'
	| 'open/composer'
	| 'open/graph'
	| 'open/help-center'
	| 'open/help-center/community-vs-pro'
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
	'context.webview.host': 'editor' | 'view';
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
		keyof (K extends `commitDetails/${string}` | `graphDetails/${string}`
			? InspectTelemetryContext
			: K extends `graph/${string}`
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

export type LoginContext = 'start_trial';
export type ConnectIntegrationContext = 'launchpad' | 'mcp';
export type Context = LoginContext | ConnectIntegrationContext;
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

export const sourceToContext: { [source in Sources]?: Context } = {
	launchpad: 'launchpad',
};

export const detailToContext: { [detail in string]?: Context } = {
	mcp: 'mcp',
};

export type TrackedUsage = {
	count: number;
	firstUsedAt: number;
	lastUsedAt: number;
};

/**
 * Actions that happen without a command
 */
export type TrackedGlActions = `gitlens.ai.generateCommits`;

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
