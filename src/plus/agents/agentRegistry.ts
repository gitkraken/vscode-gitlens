import { isCliExecutableAvailable } from '@env/gk/agentFetcher.js';
import {
	claudeExtensionId,
	claudeExtensionOpenCommand,
	claudeExtensionPrimaryEditorOpenCommand,
	claudeExtensionSidebarOpenCommand,
	isClaudeExtensionAvailable,
} from '../../agents/utils/-webview/claudeExtension.js';
import type { Container } from '../../container.js';
import { getHostAppName } from '../../system/-webview/vscode.js';
import { supportedChatHosts } from '../chat/utils/-webview/chat.utils.js';
import type { AgentDescriptor } from './agentDescriptor.js';

const ideChatLabels: Record<string, string> = {
	code: 'Copilot Chat',
	'code-insiders': 'Copilot Chat',
	'code-exploration': 'Copilot Chat',
	cursor: 'Cursor Chat',
	windsurf: 'Windsurf Chat',
	kiro: 'Kiro Chat',
	trae: 'Trae Chat',
};

/**
 * Returns the list of agent descriptors available to the picker, in fixed kind-grouped order:
 *   IDE chat (≤ 1) → Claude extension (0..1) → CLIs (alphabetical by displayName).
 *
 * Filters applied:
 *   - IDE chat: host must be in `supportedChatHosts`
 *   - Claude extension: extension installed AND its open-prompt command registered
 *   - CLI: gkcli reports `detected: true` AND emits a non-empty `executable` that exists on disk
 *
 * Returns descriptors as plain data only — safe to serialize through the deep-link bridge.
 */
export async function getSupportedAgents(container: Container): Promise<AgentDescriptor[]> {
	const result: AgentDescriptor[] = [];

	// 1) IDE chat — at most one entry, host-determined.
	const host = await getHostAppName();
	if (host != null && supportedChatHosts.includes(host)) {
		result.push({
			id: 'ide-chat',
			kind: 'ide-chat',
			host: host,
			label: ideChatLabels[host] ?? `${host} Chat`,
		});
	}

	// 2) Claude extension — gated on install + command registration.
	if (await isClaudeExtensionAvailable()) {
		result.push({ id: 'claude-extension', kind: 'claude-extension', label: 'Claude Code Extension' });
	}

	// 3) CLIs — filtered to detected + executable-on-disk, sorted by displayName.
	const cliDescriptors = await getDetectedCliDescriptors(container);
	cliDescriptors.sort((a, b) => a.label.localeCompare(b.label));
	result.push(...cliDescriptors);

	return result;
}

async function getDetectedCliDescriptors(container: Container): Promise<AgentDescriptor[]> {
	const agents = await container.agents.getDetectedCliAgents();
	return agents.map(agent => ({
		id: `cli:${agent.name}` as const,
		kind: 'cli' as const,
		agent: agent,
		label: agent.displayName || agent.name,
	}));
}

/** Re-validates a descriptor at dispatch time. Picker-time validation does not guarantee
 * dispatch-time validity — the new worktree window may have a different profile or environment. */
export async function isAgentAvailable(descriptor: AgentDescriptor): Promise<boolean> {
	switch (descriptor.kind) {
		case 'ide-chat': {
			const currentHost = await getHostAppName();
			return currentHost != null && supportedChatHosts.includes(currentHost);
		}
		case 'claude-extension':
			return isClaudeExtensionAvailable();
		case 'cli':
			return isCliExecutableAvailable(descriptor.agent.executable);
	}
}

/** Resolves a persisted `defaultAgent` id back to a live descriptor, or `undefined` if unavailable. */
export async function resolveDefaultAgent(container: Container, id: string): Promise<AgentDescriptor | undefined> {
	const available = await getSupportedAgents(container);
	return available.find(d => d.id === id);
}

export {
	claudeExtensionId,
	claudeExtensionOpenCommand,
	claudeExtensionPrimaryEditorOpenCommand,
	claudeExtensionSidebarOpenCommand,
	isClaudeExtensionAvailable,
};
