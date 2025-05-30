import type { Config } from '../../config';
import type { WebviewState } from '../protocol';
import { IpcCommandType, IpcNotificationType } from '../protocol';

export interface State extends WebviewState {
	version: string;
	config: {
		codeLens: Config['codeLens']['enabled'];
		currentLine: Config['currentLine']['enabled'];
	};
	repoFeaturesBlocked?: boolean;
	isTrialOrPaid: boolean;
	canShowPromo: boolean;
	orgSettings: {
		ai: boolean;
		drafts: boolean;
	};
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

export interface DidChangeOrgSettingsParams {
	orgSettings: State['orgSettings'];
}
export const DidChangeOrgSettingsType = new IpcNotificationType<DidChangeOrgSettingsParams>('org/settings/didChange');
