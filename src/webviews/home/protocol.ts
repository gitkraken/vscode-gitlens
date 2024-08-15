import type { Subscription } from '../../plus/gk/account/subscription';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcNotification } from '../protocol';

export const scope: IpcScope = 'home';

export enum OnboardingItem {
	repoHost = 'repoHost',
	commitGraph = 'commitGraph',
	sourceControl = 'sourceControl',
	gitLens = 'gitLens',
	inspect = 'inspect',
	visualFileHistory = 'visualFileHistory',
	launchpad = 'launchpad',
	revisionHistory = 'revisionHistory',
	allSidebarViews = 'allSidebarViews',
	editorFeatures = 'editorFeatures',
	blame = 'blame',
	codeLens = 'codeLens',
	fileAnnotations = 'fileAnnotations',
	proFeatures = 'proFeatures',
	tryTrial = 'tryTrial',
	upgradeToPro = 'upgradeToPro',
}

export type OnboardingState = Partial<Record<`${OnboardingItem}Checked`, boolean>>;

export interface State extends WebviewState {
	repositories: DidChangeRepositoriesParams;
	webroot?: string;
	subscription: Subscription;
	orgSettings: {
		drafts: boolean;
	};
	hasAnyIntegrationConnected: boolean;
	onboardingState: undefined | OnboardingState;
	repoHostConnected: boolean;
	editorPreviewEnabled: boolean;
	canEnableCodeLens: boolean;
	canEnableLineBlame: boolean;
	isOnboardingInitialized: boolean;
	proFeaturesEnabled: boolean;
}

// NOTIFICATIONS

export interface DidChangeRepositoriesParams {
	count: number;
	openCount: number;
	hasUnsafe: boolean;
	trusted: boolean;
}
export const DidChangeRepositories = new IpcNotification<DidChangeRepositoriesParams>(scope, 'repositories/didChange');

export interface DidChangeIntegrationsParams {
	hasAnyIntegrationConnected: boolean;
}
export const DidChangeIntegrationsConnections = new IpcNotification<DidChangeIntegrationsParams>(
	scope,
	'integrations/didChange',
);

export type DidChangeOnboardingStateParams = OnboardingState;
export const DidChangeOnboardingState = new IpcNotification<DidChangeOnboardingStateParams>(
	scope,
	'onboarding/usage/didChange',
);

export interface DidChangeOnboardingEditorParams {
	editorPreviewEnabled: boolean;
}
export const DidChangeOnboardingEditor = new IpcNotification<DidChangeOnboardingEditorParams>(
	scope,
	'onboarding/editor/didChange',
);

export const DidTogglePlusFeatures = new IpcNotification<boolean>(scope, 'onboarding/plus/toggle');

export interface DidChangeCodeLensStateParams {
	canBeEnabled: boolean;
}
export const DidChangeCodeLensState = new IpcNotification<DidChangeCodeLensStateParams>(
	scope,
	'onboarding/codelens/didToggle',
);

export interface DidChangeOnboardingIsInitializedParams {
	isInitialized: boolean;
}

export const DidChangeOnboardingIsInitialized = new IpcNotification<DidChangeOnboardingIsInitializedParams>(
	scope,
	'onboarding/isInitialized/didChange',
);

export interface DidChangeLineBlameStateParams {
	canBeEnabled: boolean;
}

export const DidChangeLineBlameState = new IpcNotification<DidChangeLineBlameStateParams>(
	scope,
	'onboarding/lineblame/didToggle',
);

export interface DidChangeOnboardingIntegrationParams {
	onboardingState: OnboardingState;
	repoHostConnected: boolean;
}
export const DidChangeOnboardingIntegration = new IpcNotification<DidChangeOnboardingIntegrationParams>(
	scope,
	'onboarding/integration/didChange',
);

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
}
export const DidChangeSubscription = new IpcNotification<DidChangeSubscriptionParams>(scope, 'subscription/didChange');

export interface DidChangeOrgSettingsParams {
	orgSettings: State['orgSettings'];
}
export const DidChangeOrgSettings = new IpcNotification<DidChangeOrgSettingsParams>(scope, 'org/settings/didChange');
