import { window } from 'vscode';
import { runCLICommand } from '../gk/cli/utils.js';

export async function uninstallClaudeHook(): Promise<void> {
	await runCLICommand(['ai', 'hook', 'uninstall', 'claude-code']);
	void window.showInformationMessage('Claude Hooks uninstalled successfully.');
}
