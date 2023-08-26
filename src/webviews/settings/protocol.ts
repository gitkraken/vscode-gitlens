import type { Config } from '../../config';
import type { WebviewIds, WebviewViewIds } from '../../constants';

export interface State {
	webviewId: WebviewIds | WebviewViewIds;
	timestamp: number;

	version: string;
	config: Config;
	customSettings?: Record<string, boolean>;
	scope: 'user' | 'workspace';
	scopes: ['user' | 'workspace', string][];
}
