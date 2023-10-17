import type { Subscription } from '../../../subscription';
import type { WebviewState } from '../../../webviews/protocol';
import { IpcNotificationType } from '../../../webviews/protocol';

export interface State extends WebviewState {
	webroot?: string;
	subscription: Subscription;
	avatar?: string;
}

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	avatar?: string;
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'subscription/didChange',
);
