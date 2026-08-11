import { Disposable } from 'vscode';
import type { GkAgent } from '../../../agents/agentService.js';
import type { PastAgentSessionsResult } from '../../../agents/models/agentSessionState.js';
import type { Container } from '../../../container.js';
import type { AgentDescriptor } from '../../../plus/agents/agentDescriptor.js';
import { getSupportedAgents } from '../../../plus/agents/agentRegistry.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext, onDidChangeContext } from '../../../system/-webview/context.js';
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
	 * Detected agents for the Agents settings table, grouped-able by kind in the UI.
	 * Returns `[]` when the agents feature is org-disabled (matches the AI-state gate).
	 *
	 * Appends an "Editors" group: hook-capable IDE agents (cursor, antigravity, ...) outside the
	 * known CLI set — fed from `container.agents.getHookOnlyAgents()` rather than through
	 * `getSupportedAgents()`/`AgentDescriptor`, since they're not valid default-agent or MCP targets.
	 */
	async getAgents(): Promise<AgentInfo[]> {
		if (!getContext('gitlens:agents:enabled', false)) return [];

		const descriptors = await getSupportedAgents(this.container);
		const agents = descriptors.map(toAgentInfo);

		const hookOnly = await this.container.agents.getHookOnlyAgents();
		const hookOnlyAgents = hookOnly.map(toHookOnlyAgentInfo);

		return [...agents, ...hookOnlyAgents];
	}
}
