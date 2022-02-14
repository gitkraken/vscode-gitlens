import type { Config } from '../../config';
import { IpcNotificationType } from '../protocol';

export interface State {
	config: Config;
	customSettings?: Record<string, boolean>;
	scope: 'user' | 'workspace';
	scopes: ['user' | 'workspace', string][];
}

export interface DidJumpToParams {
	anchor: string;
}
export const DidJumpToNotificationType = new IpcNotificationType<DidJumpToParams>('settings/jumpTo');
