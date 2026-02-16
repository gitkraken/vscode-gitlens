import type { SubscriptionState } from '../../constants.subscription.js';
import type { WalkthroughContextKeys } from '../../constants.walkthroughs.js';
import type { IpcScope } from '../ipc/models/ipc.js';
import { IpcCommand, IpcNotification } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';

export const scope: IpcScope = 'welcome';

export interface WalkthroughProgress {
	doneCount: number;
	allCount: number;
	progress: number;
	state: Record<WalkthroughContextKeys, boolean>;
}

export interface State extends WebviewState<'gitlens.views.welcome'> {
	webroot?: string;
	hostAppName: string;
	plusState: SubscriptionState;
	walkthroughProgress?: WalkthroughProgress;
	mcpNeedsInstall: boolean;
}

export const DismissWelcomeCommand = new IpcCommand<void>(scope, 'dismiss');

export interface DidChangeSubscriptionParams {
	plusState: SubscriptionState;
}
export const DidChangeSubscription = new IpcNotification<DidChangeSubscriptionParams>(scope, 'subscription/didChange');

export interface DidChangeWalkthroughProgressParams {
	walkthroughProgress: WalkthroughProgress;
}
export const DidChangeWalkthroughProgress = new IpcNotification<DidChangeWalkthroughProgressParams>(
	scope,
	'walkthroughProgress/didChange',
);

export const DidFocusWalkthrough = new IpcNotification<void>(scope, 'walkthrough/didFocus');
