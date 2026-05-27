import { window } from 'vscode';
import type { ClaudeCodeHookEvent } from '@gitlens/agents/types.js';
import { claudeCodeBlockingHookEvents, claudeCodeNonBlockingHookEvents } from '@gitlens/agents/types.js';
import { runCLICommand } from '../gk/cli/utils.js';

const skippedInstallEvents = new Set<ClaudeCodeHookEvent>(['WorktreeCreate', 'WorktreeRemove']);

export async function installClaudeHook(): Promise<void> {
	const args = ['ai', 'hook', 'install', 'claude-code', '--force'];
	for (const event of claudeCodeNonBlockingHookEvents) {
		if (skippedInstallEvents.has(event)) continue;

		args.push('--event', event);
	}
	for (const event of claudeCodeBlockingHookEvents) {
		if (skippedInstallEvents.has(event)) continue;

		args.push('--blocking-event', event);
	}
	await runCLICommand(args);
	void window.showInformationMessage('Claude Hooks installed successfully.');
}
