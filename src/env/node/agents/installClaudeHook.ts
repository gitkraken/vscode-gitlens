import { window } from 'vscode';
import { runCLICommand } from '../gk/cli/utils.js';

export async function installClaudeHook(): Promise<void> {
	await runCLICommand(['ai', 'hook', 'install', 'claude-code']);
	void window.showInformationMessage('Claude hook installed successfully.');
}
