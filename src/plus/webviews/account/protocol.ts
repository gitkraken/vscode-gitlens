import type { IpcScope, WebviewState } from '../../../webviews/protocol';
import { IpcNotification } from '../../../webviews/protocol';
import type { Subscription } from '../../gk/account/subscription';

export const scope: IpcScope = 'account';

export interface State extends WebviewState {
	webroot?: string;
	subscription: Subscription;
	avatar?: string;
	organizationsCount?: number;
}

// NOTIFICATIONS

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	avatar?: string;
	organizationsCount?: number;
}
export const DidChangeSubscriptionNotification = new IpcNotification<DidChangeSubscriptionParams>(
	scope,
	'subscription/didChange',
);
