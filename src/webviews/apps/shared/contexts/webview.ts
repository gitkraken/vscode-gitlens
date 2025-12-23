import { createContext } from '@lit/context';
import type { CustomEditorIds, WebviewIds } from '../../../../constants.views';

export interface WebviewContext {
	webviewId: CustomEditorIds | WebviewIds;
	webviewInstanceId: string | undefined;
}

export const webviewContext = createContext<WebviewContext>('webview');
