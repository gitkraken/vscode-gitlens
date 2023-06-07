import type { Config } from '../../config';
import { IpcCommandType, IpcNotificationType } from '../protocol';

export interface State {
	timestamp: number;
	version: string;
	config: {
		codeLens: Config['codeLens']['enabled'];
		currentLine: Config['currentLine']['enabled'];
	};
	customSettings?: Record<string, boolean>;
	repoFeaturesBlocked?: boolean;
}

export interface UpdateConfigurationParams {
	type: 'codeLens' | 'currentLine';
	value: boolean;
}
export const UpdateConfigurationCommandType = new IpcCommandType<UpdateConfigurationParams>(
	'welcome/configuration/update',
);

export interface DidChangeRepositoriesParams {
	repoFeaturesBlocked?: boolean;
}
export const DidChangeRepositoriesType = new IpcNotificationType<DidChangeRepositoriesParams>('repositories/didChange');
