import type { Config, GraphBranchesVisibility, GraphConfig } from './config';
import type { WalkthroughSteps } from './constants';
import type { AIModels, AIProviders } from './constants.ai';
import type { Commands } from './constants.commands';
import type { IntegrationId, SupportedCloudIntegrationIds } from './constants.integrations';
import type { SubscriptionState } from './constants.subscription';
import type { CustomEditorTypes, TreeViewTypes, WebviewTypes, WebviewViewTypes } from './constants.views';
import type { FeaturePreviews } from './features';
import type { GitContributionTiers } from './git/models/contributor';
import type { StartWorkType } from './plus/startWork/startWork';
import type { Period } from './plus/webviews/timeline/protocol';
import type { Flatten } from './system/object';
import type { WalkthroughContextKeys } from './telemetry/walkthroughStateProvider';

export type TelemetryGlobalContext = {
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
} & SubscriptionEventData;

export type TelemetryEvents = {
	/** Sent when account validation fails */
	'account/validation/failed': {
		'account.id': string;
		exception: string;
		code: string | undefined;
		statusCode: string | undefined;
	};

	/** Sent when GitLens is activated */
	activate: {
		'activation.elapsed': number;
		'activation.mode': string | undefined;
	} & Record<`config.${string}`, string | number | boolean | null>;

	/** Sent when explaining changes from wip, commits, stashes, patches,etc. */
	'ai/explain': {
		type: 'change';
		changeType: 'wip' | 'stash' | 'commit' | `draft-${'patch' | 'stash' | 'suggested_pr_change'}`;
	} & AIEventDataBase;

	/** Sent when generating summaries from commits, stashes, patches, etc. */
	'ai/generate': AIGenerateCommitEventData | AIGenerateDraftEventData;

	/** Sent when connecting to one or more cloud-based integrations*/
	'cloudIntegrations/connecting': {
		'integration.ids': string | undefined;
	};

	/** Sent when connected to one or more cloud-based integrations from gkdev*/
	'cloudIntegrations/connected': {
		'integration.ids': string | undefined;
		'integration.connected.ids': string | undefined;
	};

	/** Sent when disconnecting a provider from the api fails*/
	'cloudIntegrations/disconnect/failed': {
		code: number | undefined;
		'integration.id': string | undefined;
	};

	/** Sent when getting connected providers from the api fails*/
	'cloudIntegrations/getConnections/failed': {
		code: number | undefined;
	};

	/** Sent when getting a provider token from the api fails*/
	'cloudIntegrations/getConnection/failed': {
		code: number | undefined;
		'integration.id': string | undefined;
	};

	/** Sent when refreshing a provider token from the api fails*/
	'cloudIntegrations/refreshConnection/failed': {
		code: number | undefined;
		'integration.id': string | undefined;
	};

	/** Sent when a cloud-based hosting provider is connected */
	'cloudIntegrations/hosting/connected': {
		'hostingProvider.provider': IntegrationId;
		'hostingProvider.key': string;
	};
	/** Sent when a cloud-based hosting provider is disconnected */
	'cloudIntegrations/hosting/disconnected': {
		'hostingProvider.provider': IntegrationId;
		'hostingProvider.key': string;
	};
	/** Sent when a cloud-based issue provider is connected */
	'cloudIntegrations/issue/connected': {
		'issueProvider.provider': IntegrationId;
		'issueProvider.key': string;
	};
	/** Sent when a cloud-based issue provider is disconnected */
	'cloudIntegrations/issue/disconnected': {
		'issueProvider.provider': IntegrationId;
		'issueProvider.key': string;
	};
	/** Sent when a user chooses to manage the cloud integrations */
	'cloudIntegrations/settingsOpened': {
		'integration.id': SupportedCloudIntegrationIds | undefined;
	};

	/** Sent when a code suggestion is archived */
	codeSuggestionArchived: {
		provider: string | undefined;
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
		/** Named for compatibility with other GK surfaces */
		repoPrivacy: 'private' | 'public' | 'local' | undefined;
		/** Named for compatibility with other GK surfaces */
		draftId: string;
		/** Named for compatibility with other GK surfaces */
		reason: 'committed' | 'rejected' | 'accepted';
	};
	/** Sent when a code suggestion is created */
	codeSuggestionCreated: {
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
	};
	/** Sent when a code suggestion is opened */
	codeSuggestionViewed: {
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
	};

	/** Sent when a GitLens command is executed */
	command: CommandEventData;
	/** Sent when a VS Code command is executed by a GitLens provided action */
	'command/core': { command: string };

	/** Sent when the Inspect view is shown */
	'commitDetails/shown': WebviewShownEventData & InspectShownEventData;
	/** Sent when the user changes the selected tab (mode) on the Graph Details view */
	'commitDetails/mode/changed': {
		'mode.old': 'wip' | 'commit';
		'mode.new': 'wip' | 'commit';
	} & InspectContextEventData;

	/** Sent when the Commit Graph is shown */
	'graph/shown': WebviewShownEventData & GraphShownEventData;
	/** Sent when a Commit Graph command is executed */
	'graph/command': Omit<CommandEventData, 'context'>;

	/** Sent when the user clicks on the Jump to HEAD/Reference (alt) header button on the Commit Graph */
	'graph/action/jumpTo': { target: 'HEAD' | 'choose' } & GraphContextEventData;
	/** Sent when the user clicks on the "Jump to HEAD"/"Jump to Reference" (alt) header button on the Commit Graph */
	'graph/action/openRepoOnRemote': GraphContextEventData;
	/** Sent when the user clicks on the "Open Repository on Remote" header button on the Commit Graph */
	'graph/action/sidebar': { action: string } & GraphContextEventData;

	/** Sent when the user changes the "branches visibility" on the Commit Graph */
	'graph/branchesVisibility/changed': {
		'branchesVisibility.old': GraphBranchesVisibility;
		'branchesVisibility.new': GraphBranchesVisibility;
	} & GraphContextEventData;
	/** Sent when the user changes the columns on the Commit Graph */
	'graph/columns/changed': Record<`column.${string}`, boolean | string | number> & GraphContextEventData;
	/** Sent when the user changes the filters on the Commit Graph */
	'graph/filters/changed': { key: string; value: boolean } & GraphContextEventData;
	/** Sent when the user selects (clicks on) a day on the minimap on the Commit Graph */
	'graph/minimap/day/selected': GraphContextEventData;
	/** Sent when the user changes the current repository on the Commit Graph */
	'graph/repository/changed': RepositoryEventData & GraphContextEventData;

	/** Sent when the user hovers over a row on the Commit Graph */
	'graph/row/hovered': GraphContextEventData;
	/** Sent when the user selects (clicks on) a row or rows on the Commit Graph */
	'graph/row/selected': { rows: number } & GraphContextEventData;
	/** Sent when rows are loaded into the Commit Graph */
	'graph/rows/loaded': { duration: number; rows: number } & GraphContextEventData;
	/** Sent when a search was performed on the Commit Graph */
	'graph/searched': { types: string; duration: number; matches: number } & GraphContextEventData;

	/** Sent when the Graph Details view is shown */
	'graphDetails/shown': WebviewShownEventData & InspectShownEventData;
	/** Sent when the user changes the selected tab (mode) on the Graph Details view */
	'graphDetails/mode/changed': {
		'mode.old': 'wip' | 'commit';
		'mode.new': 'wip' | 'commit';
	} & InspectContextEventData;

	/** Sent when the new Home view preview is toggled on/off */
	'home/preview/toggled': {
		enabled: boolean;
		version: string;
	};

	/** Sent when the Commit Graph is shown */
	'timeline/shown': WebviewShownEventData & TimelineShownEventData;
	/** Sent when the user changes the period (timeframe) on the visual file history */
	'timeline/action/openInEditor': TimelineContextEventData;
	/** Sent when the editor changes on the visual file history */
	'timeline/editor/changed': TimelineContextEventData;
	/** Sent when the user changes the period (timeframe) on the visual file history */
	'timeline/period/changed': { 'period.old': Period | undefined; 'period.new': Period } & TimelineContextEventData;
	/** Sent when the user selects (clicks on) a commit on the visual file history */
	'timeline/commit/selected': TimelineContextEventData;

	/** Sent when the user takes an action on the Launchpad title bar */
	'launchpad/title/action': LaunchpadEventData & {
		action: 'feedback' | 'open-on-gkdev' | 'refresh' | 'settings' | 'connect';
	};

	/** Sent when the user takes an action on a launchpad item */
	'launchpad/action': LaunchpadEventData & {
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
	/** Sent when the user changes launchpad configuration settings */
	'launchpad/configurationChanged': {
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
	};
	/** Sent when the user expands/collapses a launchpad group */
	'launchpad/groupToggled': LaunchpadEventData & {
		group: LaunchpadGroups;
		collapsed: boolean;
	};
	/** Sent when the user opens launchpad; use `instance` to correlate a launchpad "session" */
	'launchpad/open': LaunchpadEventDataBase;
	/** Sent when the launchpad is opened; use `instance` to correlate a launchpad "session" */
	'launchpad/opened': LaunchpadEventData & {
		connected: boolean;
	};
	/** Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is disconnected; use `instance` to correlate a launchpad "session" */
	'launchpad/steps/connect': LaunchpadEventData & {
		connected: boolean;
	};
	/** Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is connected; use `instance` to correlate a launchpad "session" */
	'launchpad/steps/main': LaunchpadEventData & {
		connected: boolean;
	};
	/** Sent when the user opens the details of a launchpad item (e.g. click on an item); use `instance` to correlate a launchpad "session" */
	'launchpad/steps/details': LaunchpadEventData & {
		action: 'select';
	} & Partial<Record<`item.${string}`, string | number | boolean>>;
	/** Sent when the user hides the launchpad indicator */
	'launchpad/indicator/hidden': void;
	/** Sent when the launchpad indicator loads (with data) for the first time ever for this device */
	'launchpad/indicator/firstLoad': void;
	/** Sent when a launchpad operation is taking longer than a set timeout to complete */
	'launchpad/operation/slow': {
		timeout: number;
		operation:
			| 'getPullRequest'
			| 'searchPullRequests'
			| 'getMyPullRequests'
			| 'getCodeSuggestions'
			| 'getEnrichedItems'
			| 'getCodeSuggestionCounts';
		duration: number;
	};

	/** Sent when the user opens Start Work; use `instance` to correlate a StartWork "session" */
	'startWork/open': StartWorkEventDataBase;
	/** Sent when the launchpad is opened; use `instance` to correlate a StartWork "session" */
	'startWork/opened': StartWorkEventData & {
		connected: boolean;
	};
	/** Sent when the user chooses an option to start work in the first step */
	'startWork/type/chosen': StartWorkEventData & {
		connected: boolean;
		type: StartWorkType;
	};
	/** Sent when the user chooses an issue to start work in the second step */
	'startWork/issue/chosen': StartWorkEventData & {
		connected: boolean;
		type: StartWorkType;
	} & Partial<Record<`item.${string}`, string | number | boolean>>;
	/** Sent when the Start Work has "reloaded" (while open, e.g. user refreshed or back button) and is disconnected; use `instance` to correlate a Start Work "session" */
	'startWork/steps/type': StartWorkEventData & {
		connected: boolean;
	};
	'startWork/steps/connect': StartWorkEventData & {
		connected: boolean;
	};
	'startWork/steps/issue': StartWorkEventData & {
		connected: boolean;
	};

	/** Sent when a PR review was started in the inspect overview */
	openReviewMode: {
		provider: string;
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
		/** Provided for compatibility with other GK surfaces */
		repoPrivacy: 'private' | 'public' | 'local' | undefined;
		filesChanged: number;
		/** Provided for compatibility with other GK surfaces */
		source: Sources;
	};

	/** Sent when the "context" of the workspace changes (e.g. repo added, integration connected, etc) */
	'providers/context': void;

	/** Sent when we've loaded all the git providers and their repositories */
	'providers/registrationComplete': {
		'config.git.autoRepositoryDetection': boolean | 'subFolders' | 'openEditors' | undefined;
	};

	/** Sent when a local (Git remote-based) hosting provider is connected */
	'remoteProviders/connected': {
		'hostingProvider.provider': IntegrationId;
		'hostingProvider.key': string;

		/** @deprecated */
		'remoteProviders.key': string;
	};
	/** Sent when a local (Git remote-based) hosting provider is disconnected */
	'remoteProviders/disconnected': {
		'hostingProvider.provider': IntegrationId;
		'hostingProvider.key': string;

		/** @deprecated */
		'remoteProviders.key': string;
	};

	/** Sent when the workspace's repositories change */
	'repositories/changed': {
		'repositories.added': number;
		'repositories.removed': number;
	};
	/** Sent when the workspace's repository visibility is first requested */
	'repositories/visibility': {
		'repositories.visibility': 'private' | 'public' | 'local' | 'mixed';
	};

	/** Sent when a repository is opened */
	'repository/opened': RepositoryEventData & {
		'repository.remoteProviders': string;
		'repository.contributors.commits.count': number | undefined;
		'repository.contributors.commits.avgPerContributor': number | undefined;
		'repository.contributors.count': number | undefined;
		'repository.contributors.since': '1.year.ago';
	} & Record<`repository.contributors.distribution.${GitContributionTiers}`, number>;
	/** Sent when a repository's visibility is first requested */
	'repository/visibility': Partial<RepositoryEventData> & {
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
	};

	/** Sent when the subscription is loaded */
	subscription: SubscriptionEventData;

	/** Sent when the user takes an action on the subscription */
	'subscription/action':
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
	/** Sent when the subscription changes */
	'subscription/changed': SubscriptionEventData;

	/** Sent when a "tracked feature" is interacted with, today that is only when webview/webviewView/custom editor is shown */
	'usage/track': {
		'usage.key': TrackedUsageKeys;
		'usage.count': number;
	};

	/** Sent when the walkthrough is opened */
	walkthrough: {
		step?: WalkthroughSteps;
	};
	/** Sent when the walkthrough is opened */
	'walkthrough/action':
		| { type: 'command'; name: WalkthroughActionNames; command: string }
		| { type: 'url'; name: WalkthroughActionNames; url: string };
	'walkthrough/completion': {
		'context.key': WalkthroughContextKeys;
	};
} & Record<`${WebviewTypes | WebviewViewTypes}/showAborted`, WebviewShownEventData> &
	Record<
		`${Exclude<WebviewTypes | WebviewViewTypes, 'commitDetails' | 'graph' | 'graphDetails' | 'timeline'>}/shown`,
		WebviewShownEventData & Record<`context.${string}`, string | number | boolean | undefined>
	>;

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

type AIEventDataBase = {
	'model.id': AIModels;
	'model.provider.id': AIProviders;
	'model.provider.name': string;
	'retry.count': number;
	duration?: number;
	'input.length'?: number;
	'output.length'?: number;
	'failed.reason'?: 'user-declined' | 'user-cancelled' | 'error';
	'failed.error'?: string;
};

export type AIGenerateCommitEventData = {
	type: 'commitMessage';
} & AIEventDataBase;

export type AIGenerateDraftEventData = {
	type: 'draftMessage';
	draftType: 'patch' | 'stash' | 'suggested_pr_change';
} & AIEventDataBase;

export type CommandEventData =
	| {
			command: Commands.GitCommands;
			/** @deprecated Nested objects should not be used in telemetry */
			context?: { mode?: string; submode?: string };
			'context.mode'?: string;
			'context.submode'?: string;
			webview?: string;
	  }
	| {
			command: string;
			context?: never;
			'context.mode'?: never;
			'context.submode'?: never;
			webview?: string;
	  };

export type StartWorkTelemetryContext = StartWorkEventData;

type StartWorkEventDataBase = {
	instance: number;
} & Partial<{ type: StartWorkType }>;

type StartWorkEventData = StartWorkEventDataBase & Partial<{ 'items.count': number }>;

export type LaunchpadTelemetryContext = LaunchpadEventData;

type LaunchpadEventDataBase = {
	instance: number;
	'initialState.group': string | undefined;
	'initialState.selectTopItem': boolean;
};

type LaunchpadEventData = LaunchpadEventDataBase &
	(
		| Partial<{ 'items.error': string }>
		| Partial<
				{
					'items.count': number;
					'items.timings.prs': number;
					'items.timings.codeSuggestionCounts': number;
					'items.timings.enrichedItems': number;
					'groups.count': number;
				} & Record<`groups.${LaunchpadGroups}.count`, number> &
					Record<`groups.${LaunchpadGroups}.collapsed`, boolean | undefined>
		  >
	);

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

type FlattenedContextConfig<T extends object> = {
	[K in keyof Flatten<T, 'context.config', true>]: Flatten<T, 'context.config', true>[K];
};
type GraphContextEventData = {} & WebviewTelemetryContext &
	Partial<{
		[K in keyof RepositoryEventData as `context.${K}`]: RepositoryEventData[K];
	}>;
type GraphShownEventData = GraphContextEventData &
	FlattenedContextConfig<GraphConfig> &
	Partial<Record<`context.column.${string}.visible`, boolean>> &
	Partial<Record<`context.column.${string}.mode`, string>>;

export type GraphTelemetryContext = GraphContextEventData;
export type GraphShownTelemetryContext = GraphShownEventData;

export type HomeTelemetryContext = {
	'context.preview': string | undefined;
} & WebviewTelemetryContext;

type InspectContextEventData = (
	| ({
			'context.mode': 'wip';
			'context.attachedTo': 'graph' | 'default';
			'context.autolinks': number;
			'context.inReview': boolean;
			'context.codeSuggestions': number;
	  } & Partial<{
			[K in keyof RepositoryEventData as `context.${K}`]: RepositoryEventData[K];
	  }>)
	| {
			'context.mode': 'commit';
			'context.attachedTo': 'graph' | 'default';
			'context.autolinks': number;
			'context.pinned': boolean;
			'context.type': 'commit' | 'stash' | undefined;
			'context.uncommitted': boolean;
	  }
) &
	WebviewTelemetryContext;
type InspectShownEventData = InspectContextEventData & FlattenedContextConfig<Config['views']['commitDetails']>;

export type InspectTelemetryContext = InspectContextEventData;
export type InspectShownTelemetryContext = InspectShownEventData;

type TimelineContextEventData = {
	'context.period': string | undefined;
} & WebviewTelemetryContext;
type TimelineShownEventData = TimelineContextEventData & FlattenedContextConfig<Config['visualHistory']>;

export type TimelineTelemetryContext = TimelineContextEventData;
export type TimelineShownTelemetryContext = TimelineShownEventData;

type RepositoryEventData = {
	'repository.id': string;
	'repository.scheme': string;
	'repository.closed': boolean;
	'repository.folder.scheme': string | undefined;
	'repository.provider.id': string;
};

type SubscriptionEventData = {
	'subscription.state'?: SubscriptionState;
	'subscription.status'?:
		| 'verification'
		| 'free'
		| 'preview'
		| 'preview-expired'
		| 'trial'
		| 'trial-expired'
		| 'trial-reactivation-eligible'
		| 'paid'
		| 'unknown';
} & Partial<
	Record<`account.${string}`, string | number | boolean | undefined> &
		Record<`subscription.${string}`, string | number | boolean | undefined> &
		Record<`subscription.previewTrial.${string}`, string | number | boolean | undefined> &
		Record<`previous.account.${string}`, string | number | boolean | undefined> &
		Record<`previous.subscription.${string}`, string | number | boolean | undefined> &
		Record<`previous.subscription.previewTrial.${string}`, string | number | boolean | undefined>
>;

type WebviewEventData = {
	'context.webview.id': string;
	'context.webview.type': string;
	'context.webview.instanceId': string | undefined;
	'context.webview.host': 'editor' | 'view';
};
export type WebviewTelemetryContext = WebviewEventData;

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

type WebviewShownEventData = {
	duration: number;
	loading: boolean;
} & WebviewEventData;

export type LoginContext = 'start_trial';
export type ConnectIntegrationContext = 'launchpad';
export type Context = LoginContext | ConnectIntegrationContext;
/** Used to provide a "source context" to gk.dev for both tracking and customization purposes */
export type TrackingContext = 'graph' | 'launchpad' | 'visual_file_history' | 'worktrees';

export type Sources =
	| 'account'
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

export declare type AttributeValue =
	| string
	| number
	| boolean
	| Array<null | undefined | string>
	| Array<null | undefined | number>
	| Array<null | undefined | boolean>;
export type TelemetryEventData = Record<string, AttributeValue | null | undefined>;

export type TrackedUsage = {
	count: number;
	firstUsedAt: number;
	lastUsedAt: number;
};

export type WalkthroughUsageKeys = 'home:walkthrough:dismissed';
export type CommandExecutionTrackedFeatures = `command:${Commands}:executed`;
export type TrackedUsageFeatures =
	| `${WebviewTypes}Webview`
	| `${TreeViewTypes | WebviewViewTypes}View`
	| `${CustomEditorTypes}Editor`;
export type TrackedUsageKeys = `${TrackedUsageFeatures}:shown` | CommandExecutionTrackedFeatures | WalkthroughUsageKeys;

export type FeaturePreviewActionsDayEventData = Record<`day.${number}.startedOn`, string>;
export type FeaturePreviewActionEventData = {
	action: `start-preview-trial:${FeaturePreviews}`;
	startedOn: string;
	day: number;
} & FeaturePreviewActionsDayEventData;
