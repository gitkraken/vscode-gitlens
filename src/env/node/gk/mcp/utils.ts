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

/** Maps a host app name to the CLI's MCP-install provider slug (e.g. `code` -> `vscode`). */
export function toMcpInstallProvider<T extends string | undefined>(appHostName: T): T {
	switch (appHostName) {
		case 'code':
			return 'vscode' as T;
		case 'code-insiders':
			return 'vscode-insiders' as T;
		case 'code-exploration':
			return 'vscode-exploration' as T;
		default:
			return appHostName;
	}
}
