import type { ClaudeCodeHookEvent } from '@gitlens/agents/types.js';
import { claudeCodeBlockingHookEvents, claudeCodeNonBlockingHookEvents } from '@gitlens/agents/types.js';
import { runCLICommand } from '../gk/cli/utils.js';

const skippedInstallEvents = new Set<ClaudeCodeHookEvent>(['WorktreeCreate', 'WorktreeRemove']);

/** Installs GitKraken Hooks for the given `gk ai hook install` client id. Claude Code keeps its
 *  curated event set (including the blocking `PermissionRequest` the graph agent sheet's
 *  approve/deny flow depends on); every other client installs bare — `gk` applies its own
 *  per-client defaults (minus skips) when no event flags are passed, and none of them are
 *  blocking, so no other agent can park on an unresolved permission ask. */
export async function installAgentHook(hookClientId: string): Promise<void> {
	if (hookClientId !== 'claude-code') {
		await runCLICommand(['ai', 'hook', 'install', hookClientId, '--force']);
		return;
	}

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
}

export async function uninstallAgentHook(hookClientId: string): Promise<void> {
	await runCLICommand(['ai', 'hook', 'uninstall', hookClientId]);
}
