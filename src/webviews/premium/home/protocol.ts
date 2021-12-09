import type { Subscription } from '../../../subscription';
import { IpcNotificationType } from '../../protocol';

export interface State {
	subscription: Subscription;
}

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'subscription/didChange',
);
