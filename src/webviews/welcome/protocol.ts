import type { Config } from '../../config';
import { IpcCommandType } from '../protocol';

export interface State {
	timestamp: number;
	version: string;
	config: {
		codeLens: Config['codeLens']['enabled'];
		currentLine: Config['currentLine']['enabled'];
	};
	customSettings?: Record<string, boolean>;
}

export interface UpdateConfigurationParams {
	type: 'codeLens' | 'currentLine';
	value: boolean;
}
export const UpdateConfigurationCommandType = new IpcCommandType<UpdateConfigurationParams>(
	'welcome/configuration/update',
);
