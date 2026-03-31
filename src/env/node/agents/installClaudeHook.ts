import { window } from 'vscode';
import { runCLICommand } from '../gk/cli/utils.js';

export async function installClaudeHook(): Promise<void> {
	try {
		await runCLICommand(['ai', 'hook', 'install', 'claude-code']);
		void window.showInformationMessage('Claude hook installed successfully.');
	} catch (ex) {
		void window.showErrorMessage(`Failed to install Claude hook: ${ex instanceof Error ? ex.message : String(ex)}`);
	}
}
