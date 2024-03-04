import type { WebviewState } from '../protocol';
import { IpcCommandType, IpcNotificationType } from '../protocol';

export interface State extends WebviewState {
	repositories: DidChangeRepositoriesParams;
	webroot?: string;
	promoStates: Record<string, boolean>;
	orgSettings: {
		drafts: boolean;
	};
	walkthroughCollapsed: boolean;
}

// COMMANDS
export interface CollapseSectionParams {
	section: string;
	collapsed: boolean;
}
export const CollapseSectionCommandType = new IpcCommandType<CollapseSectionParams>('home/section/collapse');

// NOTIFICATIONS

export interface DidChangeRepositoriesParams {
	count: number;
	openCount: number;
	hasUnsafe: boolean;
	trusted: boolean;
}
export const DidChangeRepositoriesType = new IpcNotificationType<DidChangeRepositoriesParams>('repositories/didChange');

export interface DidChangeSubscriptionParams {
	promoStates: Record<string, boolean>;
}
export const DidChangeSubscriptionType = new IpcNotificationType<DidChangeSubscriptionParams>('subscription/didChange');

export interface DidChangeOrgSettingsParams {
	orgSettings: State['orgSettings'];
}
export const DidChangeOrgSettingsType = new IpcNotificationType<DidChangeOrgSettingsParams>('org/settings/didChange');
