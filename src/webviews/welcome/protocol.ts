import type { Config } from '../../config';

export interface State {
	config: Config;
	customSettings?: Record<string, boolean>;
}
