import type { IpcScope, WebviewState } from '../../protocol';

export const scope: IpcScope = 'composer';

// FIXME: this is a temporary file to allow the webview to load
// It will be replaced with the actual webview implementation in the future
export interface State extends WebviewState {}
