import type { WebviewState } from '../protocol.js';

export type WalkthroughMode = 'main' | 'graph';

export interface State extends WebviewState<'gitlens.views.welcome'> {
	hostAppName: string;
	welcomeTitle: string;
	mode?: WalkthroughMode;
	mcpNeedsInstall: boolean;
	mcpShowCleanupNotice: boolean;
}
