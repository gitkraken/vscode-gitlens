import { window } from 'vscode';
import { urls } from '../../../../constants';
import { Container } from '../../../../container';
import { openUrl } from '../../../../system/-webview/vscode/uris';
import { run } from '../../git/shell';
import { getPlatform } from '../../platform';

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

export async function runCLICommand(args: string[], options?: { cwd?: string }): Promise<string> {
	const cwd = options?.cwd ?? Container.instance.storage.get('gk:cli:path');
	if (cwd == null) {
		throw new Error('CLI is not installed');
	}

	const platform = getPlatform();

	return run(platform === 'windows' ? 'gk.exe' : './gk', args, 'utf8', { cwd: cwd });
}

export async function showManualMcpSetupPrompt(message: string): Promise<void> {
	const learnMore = { title: 'View Setup Instructions' };
	const cancel = { title: 'Cancel', isCloseAffordance: true };
	const result = await window.showErrorMessage(message, { modal: true }, learnMore, cancel);

	if (result === learnMore) {
		void openUrl(urls.helpCenterMCP);
	}
}
