import type { AIModels, AIProviders } from './constants.ai';
import type { Commands } from './constants.commands';
import type { IntegrationId, SupportedCloudIntegrationIds } from './constants.integrations';
import type { SubscriptionState } from './constants.subscription';
import type { CustomEditorTypes, TreeViewTypes, WebviewTypes, WebviewViewTypes } from './constants.views';

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

	/** Sent when a "Graph" command is executed */
	'graph/command': Omit<CommandEventData, 'context'>;

	/** Sent when the user takes an action on a launchpad item */
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
		operation: 'getMyPullRequests' | 'getCodeSuggestions' | 'getEnrichedItems' | 'getCodeSuggestionCounts';
		duration: number;
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
	'repository/opened': {
		'repository.id': string;
		'repository.scheme': string;
		'repository.closed': boolean;
		'repository.folder.scheme': string | undefined;
		'repository.provider.id': string;
		'repository.remoteProviders': string;
	};
	/** Sent when a repository's visibility is first requested */
	'repository/visibility': {
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
		'repository.id': string | undefined;
		'repository.scheme': string | undefined;
		'repository.closed': boolean | undefined;
		'repository.folder.scheme': string | undefined;
		'repository.provider.id': string | undefined;
	};

	/** Sent when the subscription is loaded */
	subscription: SubscriptionEventData;
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
		  };
	/** Sent when the subscription changes */
	'subscription/changed': SubscriptionEventData;

	/** Sent when a "tracked feature" is interacted with, today that is only when webview/webviewView/custom editor is shown */
	'usage/track': {
		'usage.key': TrackedUsageKeys;
		'usage.count': number;
	};

	/** Sent when the walkthrough is opened */
	walkthrough: {
		step?:
			| 'get-started'
			| 'core-features'
			| 'pro-features'
			| 'pro-trial'
			| 'pro-upgrade'
			| 'pro-reactivate'
			| 'pro-paid'
			| 'visualize'
			| 'launchpad'
			| 'code-collab'
			| 'integrations'
			| 'more';
	};
};

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
	| 'timeline'
	| 'trial-indicator'
	| 'scm-input'
	| 'subscription'
	| 'walkthrough'
	| 'welcome'
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

export type TrackedUsageFeatures =
	| `${WebviewTypes}Webview`
	| `${TreeViewTypes | WebviewViewTypes}View`
	| `${CustomEditorTypes}Editor`;
export type TrackedUsageKeys = `${TrackedUsageFeatures}:shown`;
