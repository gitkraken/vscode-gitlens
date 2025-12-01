import type { IpcScope, WebviewState } from '../protocol';

export const scope: IpcScope = 'welcome';

export interface State extends WebviewState<'gitlens.welcome'> {
	version: string;
}
