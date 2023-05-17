import type { Config } from '../../config';

export interface State {
	timestamp: number;

	config: Config;
	customSettings?: Record<string, boolean>;
	scope: 'user' | 'workspace';
	scopes: ['user' | 'workspace', string][];
}
