import type { RepositoriesVisibility } from '../../git/gitProviderService';
import type { Subscription } from '../../subscription';
import { IpcCommandType, IpcNotificationType } from '../protocol';

export const enum CompletedActions {
	DismissedWelcome = 'dismissed:welcome',
	OpenedSCM = 'opened:scm',
}

export interface State {
	subscription: Subscription;
	completedActions: CompletedActions[];
	completedSteps?: string[];
	dismissedSections?: string[];
	plusEnabled: boolean;
	visibility: RepositoriesVisibility;
}

export interface CompleteStepParams {
	id: string;
	completed: boolean;
}
export const CompleteStepCommandType = new IpcCommandType<CompleteStepParams>('home/step/complete');

export interface DismissSectionParams {
	id: string;
}
export const DismissSectionCommandType = new IpcCommandType<DismissSectionParams>('home/section/dismiss');

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	completedActions: CompletedActions[];
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'subscription/didChange',
);
