import { window } from 'vscode';
import { urls } from '../../../../constants.js';
import { openUrl } from '../../../../system/-webview/vscode/uris.js';

export async function showManualMcpSetupPrompt(message: string): Promise<void> {
	const learnMore = { title: 'View Setup Instructions' };
	const cancel = { title: 'Cancel', isCloseAffordance: true };
	const result = await window.showErrorMessage(message, { modal: true }, learnMore, cancel);

	if (result === learnMore) {
		void openUrl(urls.helpCenterMCP);
	}
}
