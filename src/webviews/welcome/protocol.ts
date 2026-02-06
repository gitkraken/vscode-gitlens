import type { SubscriptionState } from '../../constants.subscription.js';
import type { IpcScope } from '../ipc/models/ipc.js';
import { IpcCommand } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';

export const scope: IpcScope = 'welcome';

export interface State extends WebviewState<'gitlens.views.welcome'> {
	webroot?: string;
	hostAppName: string;
	plusState: SubscriptionState;
}

export const DismissWelcomeCommand = new IpcCommand<void>(scope, 'dismiss');
