import { Disposable, env } from 'vscode';
import type { GkAgent } from '../../../agents/agentService.js';
import type { PastAgentSessionsResult } from '../../../agents/models/agentSessionState.js';
import { areHooksAllowedForAgent } from '../../../agents/utils/agentHooks.js';
import type { Container } from '../../../container.js';
import type { AgentDescriptor } from '../../../plus/agents/agentDescriptor.js';
import { getSupportedAgents } from '../../../plus/agents/agentRegistry.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext, onDidChangeContext } from '../../../system/-webview/context.js';
import { getHostAppName, toMcpInstallProvider } from '../../../system/-webview/vscode.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createRpcEventSubscription } from '../eventVisibilityBuffer.js';
import type { AgentInfo, RpcEventSubscription } from './types.js';

export function toAgentInfo(d: AgentDescriptor): AgentInfo {
	return {
		id: d.id,
		label: d.label,
		kind: d.kind,
		mcp: d.kind === 'cli' ? { supported: d.agent.mcpSupported, installed: d.agent.mcpInstalled } : undefined,
		hooks: d.kind === 'cli' ? { supported: d.agent.hooksSupported, installed: d.agent.hooksInstalled } : undefined,
	};
}

/** Maps a hook-capable IDE agent (cursor, antigravity, ...) that isn't a detected CLI into its
 *  "Editors" section row — hooks control only, no Default/MCP actions. */
export function toHookOnlyAgentInfo(agent: GkAgent): AgentInfo {
	return {
		id: agent.name,
		label: agent.displayName || agent.name,
		kind: 'editor',
		detected: agent.detected,
		mcp: { supported: agent.mcpSupported, installed: agent.mcpInstalled },
		hooks: { supported: agent.hooksSupported, installed: agent.hooksInstalled },
	};
}

/** Maps a known CLI agent (detected or not) into its CLI-section row. Keeps the `cli:` id prefix the
 *  settings-table dispatch expects. Undetected agents carry `detected: false` for the dimmed treatment. */
function toCliAgentInfo(agent: GkAgent): AgentInfo {
	return {
		id: `cli:${agent.name}`,
		label: agent.displayName || agent.name,
		kind: 'cli',
		detected: agent.detected,
		mcp: { supported: agent.mcpSupported, installed: agent.mcpInstalled },
		hooks: areHooksAllowedForAgent(agent.name)
			? { supported: agent.hooksSupported, installed: agent.hooksInstalled }
			: undefined,
	};
}

export class AgentsService {
	/** Fired when the detected-agent list or the default agent changes. */
	readonly onAgentsChanged: RpcEventSubscription<AgentInfo[]>;

	constructor(
		private readonly container: Container,
		buffer?: EventVisibilityBuffer,
		tracker?: SubscriptionTracker,
	) {
		this.onAgentsChanged = createRpcEventSubscription<AgentInfo[]>(
			buffer,
			'agentsChanged',
			'save-last',
			buffered =>
				Disposable.from(
					configuration.onDidChange(e => {
						if (configuration.changed(e, 'ai.defaultAgent')) {
							void this.getAgents().then(buffered);
						}
					}),
					onDidChangeContext(key => {
						if (key === 'gitlens:gk:cli:installed' || key === 'gitlens:agents:enabled') {
							void this.getAgents().then(buffered);
						}
					}),
					this.container.agents.onDidChangeAgents(() => {
						void this.getAgents().then(buffered);
					}),
					this.container.agentStatus?.onDidChangeHooksInstallState(() => {
						void this.getAgents().then(buffered);
					}) ?? { dispose: () => {} },
				),
			undefined,
			tracker,
		);
	}

	/**
	 * Gets the past sessions a worktree can resume, most-recently-active first.
	 *
	 * Past sessions only — live ones already reach webviews on a push channel, and a snapshot taken
	 * here would disagree with it within seconds.
	 *
	 * Returns `undefined` when agents are unavailable (the org gate is off, or we're in a browser
	 * host, where no providers exist) as distinct from an empty result, which means the store simply
	 * holds nothing for this worktree. Callers cache the two differently.
	 *
	 * Tracked `completed` sessions are excluded: webviews already render those as cards, so leaving
	 * them in would spend the `limit` slots on rows that get deduped away at render.
	 */
	async getPastSessionsForWorktree(
		worktreePath: string,
		options?: { limit?: number },
		signal?: AbortSignal,
	): Promise<PastAgentSessionsResult | undefined> {
		signal?.throwIfAborted();

		const agents = this.container.agentStatus;
		if (agents == null) return undefined;

		const result = await agents.getPastSessions(worktreePath, { ...options, excludeCompleted: true });
		signal?.throwIfAborted();

		return result;
	}

	/**
	 * Agents for the Agents settings table, grouped-able by kind in the UI.
	 * Returns `[]` when the agents feature is org-disabled (matches the AI-state gate).
	 *
	 * Rows come from three sources: non-CLI descriptors (IDE chat, Claude extension) from the shared
	 * picker registry, every known CLI (detected and undetected, so the table can dim the undetected
	 * ones), and a single "Editors" row for the editor GitLens is actually running in.
	 */
	async getAgents(): Promise<AgentInfo[]> {
		if (!getContext('gitlens:agents:enabled', false)) return [];

		// Resolve the current IDE host once — its bundled MCP and hooks belong to a single row: the host's
		// chat row when it has one (folded in below), otherwise a standalone "Editors" row.
		const host = await getHostAppName();
		const hostAgentName = host != null ? toMcpInstallProvider(host) : undefined;
		const all = await this.container.agents.getAll();
		const hostGkAgent = hostAgentName != null ? all.find(a => a.name === hostAgentName) : undefined;
		const hostHooks =
			hostGkAgent?.hooksSupported === true && areHooksAllowedForAgent(hostGkAgent.name)
				? { supported: true, installed: hostGkAgent.hooksInstalled }
				: undefined;
		const bundleCapable = this.container.gkMcp?.isRegistrationCapable ?? false;

		// The Claude Code Extension runs on the Claude Code CLI, so when that CLI is installed its MCP/hooks
		// state is reflected onto the extension row (read-only in the UI; managed from the CLI row).
		const claudeCli = all.find(a => a.name === 'claude-cli');
		const claudeCliInstalled = claudeCli?.detected === true;

		// Non-CLI rows (IDE chat, Claude extension) from the shared picker registry. The IDE-chat row IS
		// the current host, so fold the host's bundled MCP (rendered from AIState.mcp) and hooks onto it.
		const descriptors = await getSupportedAgents(this.container);
		let hasChatHost = false;
		const nonCli = descriptors
			.filter(d => d.kind !== 'cli')
			.map((d): AgentInfo => {
				const info = toAgentInfo(d);
				if (d.kind === 'ide-chat') {
					hasChatHost = true;
					return { ...info, hooks: hostHooks, hooksAgentId: hostHooks != null ? hostAgentName : undefined };
				}

				if (d.kind === 'claude-extension' && claudeCliInstalled && claudeCli != null) {
					return {
						...info,
						mcp: { supported: claudeCli.mcpSupported, installed: claudeCli.mcpInstalled },
						hooks: { supported: claudeCli.hooksSupported, installed: claudeCli.hooksInstalled },
					};
				}

				return info;
			});

		// CLI rows: every known CLI, detected or not — the table dims undetected ones.
		const cliAgents = await this.container.agents.getCliAgents();
		const cli = cliAgents.map(toCliAgentInfo).sort((a, b) => a.label.localeCompare(b.label));

		// Editors: surface the current IDE host as its own row ONLY when it has no chat row to fold into.
		let editor: AgentInfo | undefined;
		if (!hasChatHost && hostAgentName != null && (hostHooks != null || bundleCapable)) {
			editor = {
				id: hostAgentName,
				label: hostGkAgent?.displayName || env.appName,
				kind: 'editor',
				detected: true,
				mcp: undefined,
				hooks: hostHooks,
			};
		}

		return [...nonCli, ...cli, ...(editor != null ? [editor] : [])];
	}
}
