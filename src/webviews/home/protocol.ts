import type { Subscription } from '../../subscription';
import { IpcNotificationType } from '../protocol';

export interface State {
	subscription: Subscription;
	welcomeVisible: boolean;
}

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	welcomeVisible: boolean;
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'subscription/didChange',
);
