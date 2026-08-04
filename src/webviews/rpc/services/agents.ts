import { Disposable } from 'vscode';
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
	 */
	async getAgents(): Promise<AgentInfo[]> {
		if (!getContext('gitlens:agents:enabled', false)) return [];

		const descriptors = await getSupportedAgents(this.container);
		return descriptors.map(toAgentInfo);
	}
}
