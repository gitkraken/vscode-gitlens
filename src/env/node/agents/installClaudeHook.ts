import { window } from 'vscode';
import { claudeCodeBlockingHookEvents, claudeCodeNonBlockingHookEvents } from '@gitlens/agents/types.js';
import { runCLICommand } from '../gk/cli/utils.js';

export async function installClaudeHook(): Promise<void> {
	const args = ['ai', 'hook', 'install', 'claude-code'];
	for (const event of claudeCodeNonBlockingHookEvents) {
		args.push('--event', event);
	}
	for (const event of claudeCodeBlockingHookEvents) {
		args.push('--blocking-event', event);
	}
	await runCLICommand(args);
	void window.showInformationMessage('Claude hook installed successfully.');
}
