import { createContext } from '@lit/context';
import type { CustomEditorIds, WebviewIds, WebviewViewIds } from '../../../../constants.views';

export interface WebviewContext {
	webviewId: CustomEditorIds | WebviewIds | WebviewViewIds;
	webviewInstanceId: string | undefined;
}

export const webviewContext = createContext<WebviewContext>('webview');
