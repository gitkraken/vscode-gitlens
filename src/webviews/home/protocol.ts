import { IpcNotificationType } from '../protocol';

export const enum CompletedActions {
	DismissedWelcome = 'dismissed:welcome',
	OpenedSCM = 'opened:scm',
}

export interface State {
	timestamp: number;

	repositories: DidChangeRepositoriesParams;
	webroot?: string;
}

export interface DidChangeRepositoriesParams {
	count: number;
	openCount: number;
	hasUnsafe: boolean;
	trusted: boolean;
}
export const DidChangeRepositoriesType = new IpcNotificationType<DidChangeRepositoriesParams>('repositories/didChange');
