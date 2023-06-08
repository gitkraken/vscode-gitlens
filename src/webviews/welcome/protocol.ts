import type { Config } from '../../config';
import { IpcCommandType, IpcNotificationType } from '../protocol';

export interface State {
	timestamp: number;
	version: string;
	config: {
		codeLens: Config['codeLens']['enabled'];
		currentLine: Config['currentLine']['enabled'];
	};
	repoFeaturesBlocked?: boolean;
}

export interface UpdateConfigurationParams {
	type: 'codeLens' | 'currentLine';
	value: boolean;
}
export const UpdateConfigurationCommandType = new IpcCommandType<UpdateConfigurationParams>(
	'welcome/configuration/update',
);

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('welcome/didChange', true);
