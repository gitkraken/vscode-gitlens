import type { IpcScope, WebviewState } from '../../protocol';

export const scope: IpcScope = 'composer';

export interface State extends WebviewState {
	// Add any state properties needed for the composer webview
	// For now, this is just a mock-up so we don't need any specific state
}
