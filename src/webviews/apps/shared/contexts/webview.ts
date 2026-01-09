import { createContext } from '@lit/context';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../../../constants.commands.js';
import type { CustomEditorIds, WebviewIds } from '../../../../constants.views.js';

export interface WebviewContext {
	webviewId: CustomEditorIds | WebviewIds;
	webviewInstanceId: string | undefined;

	createCommandLink<T>(command: GlWebviewCommandsOrCommandsWithSuffix, args?: T): string;
}

export const webviewContext = createContext<WebviewContext>('webview');
