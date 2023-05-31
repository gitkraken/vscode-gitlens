import type { Subscription } from '../../../subscription';
import { IpcNotificationType } from '../../../webviews/protocol';

export interface State {
	timestamp: number;

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
