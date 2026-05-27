/**
 * AI service — AI model queries, state, and events.
 *
 * Provides the currently selected AI model info, AI/MCP enablement state,
 * and change notifications. View-specific AI operations (explain, generate)
 * should be defined in view-specific service interfaces.
 */

import { Disposable } from 'vscode';
import { getClaudeAgent } from '@env/providers.js';
import type { Container } from '../../../container.js';
import { resolveDefaultAgent } from '../../../plus/agents/agentRegistry.js';
import type { AIModelScope } from '../../../plus/ai/aiProviderService.js';
import { mcpRegistrationAllowed } from '../../../plus/gk/utils/-webview/mcp.utils.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext, onDidChangeContext } from '../../../system/-webview/context.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createRpcEventSubscription } from '../eventVisibilityBuffer.js';
import type { AiModelInfo, AIState, RpcEventSubscription } from './types.js';

export class AIService {
	/**
	 * Fired when the selected AI model changes.
	 */
	readonly onModelChanged: RpcEventSubscription<AiModelInfo | undefined>;

	/**
	 * Fired when AI or MCP state changes (settings, org, CLI installation).
	 */
	readonly onStateChanged: RpcEventSubscription<AIState>;

	readonly #container: Container;
	#lastGlobalModel: AiModelInfo | undefined;
	#lastGlobalModelInitialized = false;

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.#container = container;
		this.onModelChanged = createRpcEventSubscription<AiModelInfo | undefined>(
			buffer,
			'modelChanged',
			'save-last',
			buffered =>
				container.ai.onDidChangeModel(async e => {
					// Forward every change so consumers that re-read with their own scope (graph
					// details, etc.) get a refresh trigger. The broadcast value is always the
					// global default — scope-only changes don't affect it, so we cache the last
					// known global instead of re-fetching it on every fire.
					if (e.scope == null) {
						this.#lastGlobalModel = toAiModelInfo(e.model);
						this.#lastGlobalModelInitialized = true;
					} else if (!this.#lastGlobalModelInitialized) {
						this.#lastGlobalModel = toAiModelInfo(await container.ai.getModel({ silent: true }));
						this.#lastGlobalModelInitialized = true;
					}
					buffered(this.#lastGlobalModel);
				}),
			undefined,
			tracker,
		);

		this.onStateChanged = createRpcEventSubscription<AIState>(
			buffer,
			'aiStateChanged',
			'save-last',
			buffered =>
				Disposable.from(
					configuration.onDidChange(e => {
						if (configuration.changed(e, ['ai.enabled', 'gitkraken.mcp.autoEnabled', 'ai.defaultAgent'])) {
							void this.#getAIState().then(buffered);
						}
					}),
					onDidChangeContext(key => {
						if (
							key === 'gitlens:gk:organization:ai:enabled' ||
							key === 'gitlens:gk:cli:installed' ||
							key === 'gitlens:agents:enabled'
						) {
							void this.#getAIState().then(buffered);
						}
					}),
					container.agentStatus?.onDidChangeHooksInstallState(() => {
						void this.#getAIState().then(buffered);
					}) ?? { dispose: () => {} },
				),
			undefined,
			tracker,
		);
	}

	/**
	 * Get the currently selected AI model, or undefined if none.
	 *
	 * Pass `scope` to read a per-operation remembered model (compose, review). When the
	 * scope has no remembered value, the global default is returned — same as omitting it.
	 */
	async getModel(scope?: AIModelScope): Promise<AiModelInfo | undefined> {
		const model = await this.#container.ai.getModel({ silent: true, scope: scope });
		return toAiModelInfo(model);
	}

	/**
	 * Get the current AI and MCP enablement state.
	 */
	getState(): Promise<AIState> {
		return this.#getAIState();
	}

	async #getAIState(): Promise<AIState> {
		const agentsEnabled = getContext('gitlens:agents:enabled', false);
		const claude = agentsEnabled ? await getClaudeAgent() : undefined;
		const detected = claude?.detected === true;
		const supported = claude?.hooksSupported === true;
		const installed = claude?.hooksInstalled === true;

		const defaultAgentId = configuration.get('ai.defaultAgent') ?? undefined;
		const defaultAgentDescriptor = defaultAgentId != null ? await resolveDefaultAgent(defaultAgentId) : undefined;

		return {
			enabled: this.#container.ai.enabled,
			orgEnabled: getContext('gitlens:gk:organization:ai:enabled', true),
			mcp: {
				bundled: mcpRegistrationAllowed(this.#container),
				settingEnabled: configuration.get('gitkraken.mcp.autoEnabled'),
				installed: getContext('gitlens:gk:cli:installed', false),
			},
			hooks: {
				claude: { detected: detected, supported: supported, installed: installed },
				canInstallClaudeHook: agentsEnabled && detected && supported && !installed,
			},
			defaultAgent:
				defaultAgentDescriptor != null
					? { id: defaultAgentDescriptor.id, label: defaultAgentDescriptor.label }
					: undefined,
		};
	}

	/**
	 * Check if AI is enabled.
	 */
	isEnabled(): Promise<boolean> {
		return Promise.resolve(this.#container.ai.enabled);
	}
}

function toAiModelInfo(
	model: { id: string; name: string; provider: { id: string; name: string } } | undefined,
): AiModelInfo | undefined {
	if (model == null) return undefined;
	return {
		id: model.id,
		name: model.name,
		provider: { id: model.provider.id, name: model.provider.name },
	} satisfies AiModelInfo;
}
