import { browser } from '@wdio/globals';
import { welcomeWebviewTitle } from '../constants/messages.ts';
import type { ExtensionPageHandler } from '../types/helpers';

export async function waitUntilExtensionLoaded(): Promise<ExtensionPageHandler> {
	const wb = await browser.getWorkbench();
	const editorView = wb.getEditorView();
	await browser.waitUntil(
		async () => {
			const currentTab = await editorView.getActiveTab();
			return (await currentTab?.getTitle()) === welcomeWebviewTitle;
		},
		{
			timeout: 20000,
			timeoutMsg: 'GitLens Welcome page did not display',
		},
	);
	return {
		closeWelcomePage: async () => {
			await editorView.closeEditor(welcomeWebviewTitle);
		},
	};
}
