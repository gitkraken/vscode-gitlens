import type { Config } from '../../config';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcNotification, IpcRequest } from '../protocol';

export const scope: IpcScope = 'settings';

export interface State extends WebviewState {
	version: string;
	config: Config;
	customSettings?: Record<string, boolean>;
	scope: 'user' | 'workspace';
	scopes: ['user' | 'workspace', string][];
	hasAccount: boolean;
	hasConnectedJira: boolean;
}

// REQUESTS

export interface GenerateCommitPreviewParams {
	key: string;
	type: 'commit' | 'commit-uncommitted';
	format: string;
}
type GenerateConfigurationPreviewParams = GenerateCommitPreviewParams;
export interface DidGenerateConfigurationPreviewParams {
	preview: string;
}
export const GenerateConfigurationPreviewRequest = new IpcRequest<
	GenerateConfigurationPreviewParams,
	DidGenerateConfigurationPreviewParams
>(scope, 'configuration/preview');

// NOTIFICATIONS

export interface DidOpenAnchorParams {
	anchor: string;
	scrollBehavior: 'auto' | 'smooth';
}
export const DidOpenAnchorNotification = new IpcNotification<DidOpenAnchorParams>(scope, 'didOpenAnchor');

export interface DidChangeAccountParams {
	hasAccount: boolean;
}
export const DidChangeAccountNotification = new IpcNotification<DidChangeAccountParams>(scope, 'didChangeAccount');

export interface DidChangeConnectedJiraParams {
	hasConnectedJira: boolean;
}
export const DidChangeConnectedJiraNotification = new IpcNotification<DidChangeConnectedJiraParams>(
	scope,
	'didChangeConnectedJira',
);
