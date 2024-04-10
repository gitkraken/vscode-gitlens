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
