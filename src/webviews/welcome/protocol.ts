import type { Config } from '../../config';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcCommand, IpcNotification } from '../protocol';

export const scope: IpcScope = 'welcome';

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

// COMMANDS

export interface UpdateConfigurationParams {
	type: 'codeLens' | 'currentLine';
	value: boolean;
}
export const UpdateConfigurationCommand = new IpcCommand<UpdateConfigurationParams>(scope, 'configuration/update');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange', true);

export interface DidChangeOrgSettingsParams {
	orgSettings: State['orgSettings'];
}
export const DidChangeOrgSettings = new IpcNotification<DidChangeOrgSettingsParams>(scope, 'org/settings/didChange');
