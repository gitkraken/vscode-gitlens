import type { WebviewState } from '../protocol.js';

export type WalkthroughMode = 'main' | 'graph';

export interface State extends WebviewState<'gitlens.views.welcome' | 'gitlens.welcome'> {
	hostAppName: string;
	mode?: WalkthroughMode;
	mcpNeedsInstall: boolean;
	mcpShowCleanupNotice: boolean;
}
