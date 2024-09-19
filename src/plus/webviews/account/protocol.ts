import type { IpcScope, WebviewState } from '../../../webviews/protocol';
import { IpcNotification } from '../../../webviews/protocol';
import type { Organization } from '../../gk/account/organization';
import type { Subscription } from '../../gk/account/subscription';

export const scope: IpcScope = 'account';

export interface State extends WebviewState {
	webroot?: string;
	subscription: Subscription;
	avatar?: string;
	organizations?: Organization[];
}

// NOTIFICATIONS

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	avatar?: string;
	organizations?: Organization[];
}
export const DidChangeSubscriptionNotification = new IpcNotification<DidChangeSubscriptionParams>(
	scope,
	'subscription/didChange',
);
