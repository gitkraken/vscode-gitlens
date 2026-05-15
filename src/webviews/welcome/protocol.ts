import type { SubscriptionState } from '../../constants.subscription.js';
import type { GraphWalkthroughContextKeys, WalkthroughContextKeys } from '../../constants.walkthroughs.js';
import type { IpcScope } from '../ipc/models/ipc.js';
import { IpcCommand, IpcNotification } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';

export const scope: IpcScope = 'welcome';

export type WalkthroughMode = 'main' | 'graph';

export interface WalkthroughProgress {
	doneCount: number;
	allCount: number;
	progress: number;
	state: Record<WalkthroughContextKeys, boolean>;
}

export interface GraphWalkthroughProgress {
	doneCount: number;
	allCount: number;
	progress: number;
	state: Record<GraphWalkthroughContextKeys, boolean>;
}

export interface State extends WebviewState<'gitlens.views.welcome'> {
	webroot?: string;
	hostAppName: string;
	plusState: SubscriptionState;
	walkthroughProgress?: WalkthroughProgress;
	graphWalkthroughProgress?: GraphWalkthroughProgress;
	mode?: WalkthroughMode;
	mcpNeedsInstall: boolean;
	mcpShowCleanupNotice: boolean;
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

export interface DidChangeGraphWalkthroughProgressParams {
	graphWalkthroughProgress: GraphWalkthroughProgress;
}
export const DidChangeGraphWalkthroughProgress = new IpcNotification<DidChangeGraphWalkthroughProgressParams>(
	scope,
	'graphWalkthroughProgress/didChange',
);

export interface DidSwitchWalkthroughModeParams {
	mode: WalkthroughMode;
}
export const DidSwitchWalkthroughMode = new IpcNotification<DidSwitchWalkthroughModeParams>(
	scope,
	'walkthroughMode/didSwitch',
);

export const DidFocusWalkthrough = new IpcNotification<void>(scope, 'walkthrough/didFocus');
