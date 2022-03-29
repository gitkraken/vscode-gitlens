import type { Subscription } from '../../subscription';
import { IpcNotificationType } from '../protocol';

export const enum CompletedActions {
	DismissedWelcome = 'dismissed:welcome',
	OpenedSCM = 'opened:scm',
}

export interface State {
	subscription: Subscription;
	completedActions: CompletedActions[];
}

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	completedActions: CompletedActions[];
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'subscription/didChange',
);
