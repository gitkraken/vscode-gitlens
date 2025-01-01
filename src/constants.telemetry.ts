import type { Config, GraphBranchesVisibility, GraphConfig } from './config';
import type { WalkthroughSteps } from './constants';
import type { AIModels, AIProviders } from './constants.ai';
import type { GlCommand } from './constants.commands';
import type { IntegrationId, SupportedCloudIntegrationIds } from './constants.integrations';
import type { SubscriptionState, SubscriptionStateString } from './constants.subscription';
import type { CustomEditorTypes, TreeViewTypes, WebviewTypes, WebviewViewTypes } from './constants.views';
import type { FeaturePreviews, FeaturePreviewStatus } from './features';
import type { GitContributionTiers } from './git/models/contributor';
import type { Subscription, SubscriptionAccount } from './plus/gk/account/subscription';
import type { Flatten } from './system/object';
import type { WalkthroughContextKeys } from './telemetry/walkthroughStateProvider';
import type { GraphColumnConfig } from './webviews/plus/graph/protocol';
import type { Period } from './webviews/plus/timeline/protocol';

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
	enabled: boolean;
	prerelease: boolean;
	install: boolean;
	upgrade: boolean;
	upgradedFrom: string | undefined;
	'folders.count': number;
	'folders.schemes': string;
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

export interface TelemetryEvents extends WebviewShowAbortedEvents, WebviewShownEvents {
	/** Sent when account validation fails */
	'account/validation/failed': AccountValidationFailedEvent;

	/** Sent when GitLens is activated */
	activate: ActivateEvent;

	/** Sent when explaining changes from wip, commits, stashes, patches,etc. */
	'ai/explain': AIExplainEvent;

	/** Sent when generating summaries from commits, stashes, patches, etc. */
	'ai/generate': AIGenerateEvent;

	/** Sent when connecting to one or more cloud-based integrations*/
	'cloudIntegrations/connecting': CloudIntegrationsConnectingEvent;

	/** Sent when connected to one or more cloud-based integrations from gkdev*/
	'cloudIntegrations/connected': CloudIntegrationsConnectedEvent;

	/** Sent when disconnecting a provider from the api fails*/
	'cloudIntegrations/disconnect/failed': CloudIntegrationsDisconnectFailedEvent;

	/** Sent when getting connected providers from the api fails*/
	'cloudIntegrations/getConnections/failed': CloudIntegrationsGetConnectionsFailedEvent;

	/** Sent when getting a provider token from the api fails*/
	'cloudIntegrations/getConnection/failed': CloudIntegrationsGetConnectionFailedEvent;

	/** Sent when refreshing a provider token from the api fails*/
	'cloudIntegrations/refreshConnection/failed': CloudIntegrationsRefreshConnectionFailedEvent;

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

	/** Sent when the Inspect view is shown */
	'commitDetails/shown': CommitDetailsShownEvent;
	/** Sent when the user changes the selected tab (mode) on the Graph Details view */
	'commitDetails/mode/changed': CommitDetailsModeChangedEvent;

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

	/** Sent when the user hovers over a row on the Commit Graph */
	'graph/row/hovered': GraphContextEventData;
	/** Sent when the user selects (clicks on) a row or rows on the Commit Graph */
	'graph/row/selected': GraphRowSelectedEvent;
	/** Sent when rows are loaded into the Commit Graph */
	'graph/rows/loaded': GraphRowsLoadedEvent;
	/** Sent when a search was performed on the Commit Graph */
	'graph/searched': GraphSearchedEvent;

	/** Sent when the Graph Details view is shown */
	'graphDetails/shown': GraphDetailsShownEvent;
	/** Sent when the user changes the selected tab (mode) on the Graph Details view */
	'graphDetails/mode/changed': GraphDetailsModeChangedEvent;

	/** Sent when the new Home view preview is toggled on/off */
	'home/preview/toggled': HomePreviewToggledEvent;
	/** Sent when the user chooses to create a branch from the home view */
	'home/createBranch': void;
	/** Sent when the user chooses to start work on an issue from the home view */
	'home/startWork': void;

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

	/** Sent when a PR review was started in the inspect overview */
	openReviewMode: OpenReviewModeEvent;

	/** Sent when the "context" of the workspace changes (e.g. repo added, integration connected, etc) */
	'providers/context': void;

	/** Sent when we've loaded all the git providers and their repositories */
	'providers/registrationComplete': ProvidersRegistrationCompleteEvent;

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

	/** Sent when the Commit Graph is shown */
	'timeline/shown': TimelineShownEvent;
	/** Sent when the user changes the period (timeframe) on the visual file history */
	'timeline/action/openInEditor': TimelineContextEventData;
	/** Sent when the editor changes on the visual file history */
	'timeline/editor/changed': TimelineContextEventData;
	/** Sent when the user changes the period (timeframe) on the visual file history */
	'timeline/period/changed': TimelinePeriodChangedEvent;
	/** Sent when the user selects (clicks on) a commit on the visual file history */
	'timeline/commit/selected': TimelineContextEventData;

	/** Sent when a "tracked feature" is interacted with, today that is only when webview/webviewView/custom editor is shown */
	'usage/track': UsageTrackEvent;

	/** Sent when the walkthrough is opened */
	walkthrough: WalkthroughEvent;
	/** Sent when the walkthrough is opened */
	'walkthrough/action': WalkthroughActionEvent;
	'walkthrough/completion': WalkthroughCompletionEvent;
}

type WebviewShowAbortedEvents = {
	[K in `${WebviewTypes | WebviewViewTypes}/showAborted`]: WebviewShownEventData;
};
type WebviewShownEvents = {
	[K in `${Exclude<
		WebviewTypes | WebviewViewTypes,
		'commitDetails' | 'graph' | 'graphDetails' | 'timeline'
	>}/shown`]: WebviewShownEventData & Record<`context.${string}`, string | number | boolean | undefined>;
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
	statusCode: string | undefined;
}

interface ActivateEvent extends ConfigEventData {
	'activation.elapsed': number;
	'activation.mode': string | undefined;
}

interface AIEventDataBase {
	'model.id': AIModels;
	'model.provider.id': AIProviders;
	'model.provider.name': string;
	'retry.count': number;
	duration?: number;
	'input.length'?: number;
	'output.length'?: number;
	'failed.reason'?: 'user-declined' | 'user-cancelled' | 'error';
	'failed.error'?: string;
}

interface AIExplainEvent extends AIEventDataBase {
	type: 'change';
	changeType: 'wip' | 'stash' | 'commit' | `draft-${'patch' | 'stash' | 'suggested_pr_change'}`;
}

export interface AIGenerateCommitEventData extends AIEventDataBase {
	type: 'commitMessage';
}

export interface AIGenerateDraftEventData extends AIEventDataBase {
	type: 'draftMessage';
	draftType: 'patch' | 'stash' | 'suggested_pr_change';
}

type AIGenerateEvent = AIGenerateCommitEventData | AIGenerateDraftEventData;

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

interface CloudIntegrationsHostingConnectedEvent {
	'hostingProvider.provider': IntegrationId;
	'hostingProvider.key': string;
}

interface CloudIntegrationsHostingDisconnectedEvent {
	'hostingProvider.provider': IntegrationId;
	'hostingProvider.key': string;
}

interface CloudIntegrationsIssueConnectedEvent {
	'issueProvider.provider': IntegrationId;
	'issueProvider.key': string;
}

interface CloudIntegrationsIssueDisconnectedEvent {
	'issueProvider.provider': IntegrationId;
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
	command: GlCommand.GitCommands;
	'context.mode'?: string;
	'context.submode'?: string;
	webview?: string;
}

type CommandEvent = CommandEventData | GitCommandEventData;

interface CoreCommandEvent {
	command: string;
}

type CommitDetailsShownEvent = WebviewShownEventData & InspectShownEventData;

type CommitDetailsModeChangedEvent = InspectContextEventData & {
	'mode.old': 'wip' | 'commit';
	'mode.new': 'wip' | 'commit';
};

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

interface GraphRowSelectedEvent extends GraphContextEventData {
	rows: number;
}

interface GraphRowsLoadedEvent extends GraphContextEventData {
	duration: number;
	rows: number;
}

interface GraphSearchedEvent extends GraphContextEventData {
	types: string;
	duration: number;
	matches: number;
}

type GraphDetailsShownEvent = WebviewShownEventData & InspectShownEventData;
type GraphDetailsModeChangedEvent = InspectContextEventData & {
	'mode.old': 'wip' | 'commit';
	'mode.new': 'wip' | 'commit';
};

export type HomeTelemetryContext = WebviewTelemetryContext & {
	'context.preview': string | undefined;
};

interface HomePreviewToggledEvent {
	enabled: boolean;
	version: string;
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

interface ProvidersRegistrationCompleteEvent {
	'config.git.autoRepositoryDetection': boolean | 'subFolders' | 'openEditors' | undefined;
}

interface RemoteProvidersConnectedEvent {
	'hostingProvider.provider': IntegrationId;
	'hostingProvider.key': string;
	/** @deprecated */
	'remoteProviders.key': string;
}

interface RemoteProvidersDisconnectedEvent {
	'hostingProvider.provider': IntegrationId;
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
	'repository.contributors.commits.count': number | undefined;
	'repository.contributors.commits.avgPerContributor': number | undefined;
	'repository.contributors.count': number | undefined;
	'repository.contributors.since': '1.year.ago';
}

interface RepositoryVisibilityEvent extends Partial<RepositoryEventData> {
	'repository.visibility': 'private' | 'public' | 'local' | undefined;
}

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
	extends Flatten<Omit<SubscriptionAccount, 'name' | 'email'>, 'account', true>,
		Omit<
			Flatten<Subscription['plan'], 'subscription', true>,
			'subscription.actual.name' | 'subscription.effective.name'
		>,
		Partial<Flatten<NonNullable<Subscription['previewTrial']>, 'subscription.previewTrial', true>>,
		SubscriptionFeaturePreviewsEventData {}

export interface SubscriptionPreviousEventData
	extends Flatten<Omit<SubscriptionAccount, 'name' | 'email'>, 'previous.account', true>,
		Omit<
			Flatten<Subscription['plan'], 'previous.subscription', true>,
			'previous.subscription.actual.name' | 'previous.subscription.effective.name'
		>,
		Partial<Flatten<NonNullable<Subscription['previewTrial']>, 'previous.subscription.previewTrial', true>> {}

export interface SubscriptionEventData extends Partial<SubscriptionCurrentEventData> {
	'subscription.state'?: SubscriptionState;
	'subscription.stateString'?: SubscriptionStateString;
	'subscription.status'?: SubscriptionStateString;
}

type SubscriptionActionEventData =
	| {
			action:
				| 'sign-up'
				| 'sign-in'
				| 'sign-out'
				| 'manage'
				| 'reactivate'
				| 'resend-verification'
				| 'pricing'
				| 'start-preview-trial'
				| 'upgrade';
	  }
	| {
			action: 'visibility';
			visible: boolean;
	  }
	| FeaturePreviewActionEventData;

export interface SubscriptionEventDataWithPrevious
	extends SubscriptionEventData,
		Partial<SubscriptionPreviousEventData> {}

type TimelineContextEventData = WebviewTelemetryContext & {
	'context.period': string | undefined;
};
export type TimelineTelemetryContext = TimelineContextEventData;

type TimelineShownEventData = TimelineContextEventData & FlattenedContextConfig<Config['visualHistory']>;
export type TimelineShownTelemetryContext = TimelineShownEventData;

type TimelineShownEvent = WebviewShownEventData & TimelineShownEventData;

interface TimelinePeriodChangedEvent extends TimelineContextEventData {
	'period.old': Period | undefined;
	'period.new': Period;
}

interface UsageTrackEvent {
	'usage.key': TrackedUsageKeys;
	'usage.count': number;
}

interface WalkthroughEvent {
	step?: WalkthroughSteps;
}

type WalkthroughActionNames =
	| 'open/help-center/start-integrations'
	| 'open/help-center/accelerate-pr-reviews'
	| 'open/help-center/streamline-collaboration'
	| 'open/help-center/interactive-code-history'
	| 'open/help-center/community-vs-pro'
	| 'open/devex-platform'
	| 'open/drafts'
	| 'connect/integrations'
	| 'open/autolinks'
	| 'open/graph'
	| 'open/launchpad'
	| 'create/worktree'
	| 'open/help-center'
	| 'plus/sign-up'
	| 'plus/upgrade'
	| 'plus/reactivate'
	| 'open/walkthrough'
	| 'open/inspect';

type WalkthroughActionEvent =
	| { type: 'command'; name: WalkthroughActionNames; command: string }
	| { type: 'url'; name: WalkthroughActionNames; url: string };

interface WalkthroughCompletionEvent {
	'context.key': WalkthroughContextKeys;
}

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
export type TelemetryEventsFromWebviewApp = {
	[K in keyof TelemetryEvents]: Omit<
		TelemetryEvents[K],
		keyof (K extends `commitDetails/${string}` | `graphDetails/${string}`
			? InspectTelemetryContext
			: K extends `graph/${string}`
			  ? GraphTelemetryContext
			  : K extends `timeline/${string}`
			    ? TimelineTelemetryContext
			    : WebviewTelemetryContext)
	>;
};

export type LoginContext = 'start_trial';
export type ConnectIntegrationContext = 'launchpad';
export type Context = LoginContext | ConnectIntegrationContext;
/** Used to provide a "source context" to gk.dev for both tracking and customization purposes */
export type TrackingContext = 'graph' | 'launchpad' | 'visual_file_history' | 'worktrees';

export type Sources =
	| 'account'
	| 'associateIssueWithBranch'
	| 'code-suggest'
	| 'cloud-patches'
	| 'commandPalette'
	| 'deeplink'
	| 'graph'
	| 'home'
	| 'inspect'
	| 'inspect-overview'
	| 'integrations'
	| 'launchpad'
	| 'launchpad-indicator'
	| 'launchpad-view'
	| 'notification'
	| 'patchDetails'
	| 'prompt'
	| 'quick-wizard'
	| 'remoteProvider'
	| 'settings'
	| 'startWork'
	| 'timeline'
	| 'trial-indicator'
	| 'scm-input'
	| 'subscription'
	| 'view'
	| 'walkthrough'
	| 'whatsnew'
	| 'worktrees';

export type Source = {
	source: Sources;
	detail?: string | TelemetryEventData;
};

export const sourceToContext: { [source in Sources]?: Context } = {
	launchpad: 'launchpad',
};

export type TrackedUsage = {
	count: number;
	firstUsedAt: number;
	lastUsedAt: number;
};

export type TrackedUsageFeatures =
	| `${WebviewTypes}Webview`
	| `${TreeViewTypes | WebviewViewTypes}View`
	| `${CustomEditorTypes}Editor`;
export type WalkthroughUsageKeys = 'home:walkthrough:dismissed';
export type TrackedUsageKeys = `${TrackedUsageFeatures}:shown` | `command:${string}:executed` | WalkthroughUsageKeys;
