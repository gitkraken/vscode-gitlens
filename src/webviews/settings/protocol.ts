import type { Config } from '../../config';
import type { WebviewState } from '../protocol';

export interface State extends WebviewState {
	version: string;
	config: Config;
	customSettings?: Record<string, boolean>;
	scope: 'user' | 'workspace';
	scopes: ['user' | 'workspace', string][];
}
