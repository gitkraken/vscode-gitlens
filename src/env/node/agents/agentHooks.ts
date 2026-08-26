import { getAgentCapabilities } from '@gitlens/agents/agentCapabilities.js';
import { runCLICommand } from '../gk/cli/utils.js';

/** Installs GitKraken Hooks for the given `gk ai hook install` client id, driven by the client's
 *  {@link getAgentCapabilities} descriptor. A client whose descriptor declares `installEvents` gets
 *  that curated set (Claude Code, including the blocking `PermissionRequest` the graph agent sheet's
 *  approve/deny flow depends on); everything else — a descriptor without install events, or a client
 *  GitLens has no descriptor for — installs bare, letting `gk` apply its own per-client defaults. */
export async function installAgentHook(hookClientId: string): Promise<void> {
	const args = ['ai', 'hook', 'install', hookClientId, '--force'];

	const capabilities = getAgentCapabilities(hookClientId);
	if (capabilities?.installEvents != null) {
		for (const event of capabilities.installEvents) {
			args.push('--event', event);
		}
		for (const event of capabilities.installBlockingEvents ?? []) {
			args.push('--blocking-event', event);
		}
	}

	await runCLICommand(args);
}

export async function uninstallAgentHook(hookClientId: string): Promise<void> {
	await runCLICommand(['ai', 'hook', 'uninstall', hookClientId]);
}
