/**
 * AI service — AI model queries, state, and events.
 *
 * Provides the currently selected AI model info, AI/MCP enablement state,
 * and change notifications. View-specific AI operations (explain, generate)
 * should be defined in view-specific service interfaces.
 */

import { Disposable } from 'vscode';
import type { Container } from '../../../container.js';
import { mcpRegistrationAllowed } from '../../../plus/gk/utils/-webview/mcp.utils.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext, onDidChangeContext } from '../../../system/-webview/context.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createEventSubscription } from '../eventVisibilityBuffer.js';
import type { AiModelInfo, AIState, EventSubscriber } from './types.js';

export class AIService {
	/**
	 * Fired when the selected AI model changes.
	 */
	readonly onModelChanged: EventSubscriber<AiModelInfo | undefined>;

	/**
	 * Fired when AI or MCP state changes (settings, org, CLI installation).
	 */
	readonly onStateChanged: EventSubscriber<AIState>;

	readonly #container: Container;

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.#container = container;
		this.onModelChanged = createEventSubscription<AiModelInfo | undefined>(
			buffer,
			'modelChanged',
			'save-last',
			buffered =>
				container.ai.onDidChangeModel(async () => {
					const model = await container.ai.getModel({ silent: true });
					buffered(
						model != null
							? {
									id: model.id,
									name: model.name,
									provider: { id: model.provider.id, name: model.provider.name },
								}
							: undefined,
					);
				}),
			undefined,
			tracker,
		);

		this.onStateChanged = createEventSubscription<AIState>(
			buffer,
			'aiStateChanged',
			'save-last',
			buffered =>
				Disposable.from(
					configuration.onDidChange(e => {
						if (configuration.changed(e, ['ai.enabled', 'gitkraken.mcp.autoEnabled'])) {
							buffered(this.#getAIState());
						}
					}),
					onDidChangeContext(key => {
						if (key === 'gitlens:gk:organization:ai:enabled' || key === 'gitlens:gk:cli:installed') {
							buffered(this.#getAIState());
						}
					}),
				),
			undefined,
			tracker,
		);
	}

	/**
	 * Get the currently selected AI model, or undefined if none.
	 */
	async getModel(): Promise<AiModelInfo | undefined> {
		const model = await this.#container.ai.getModel({ silent: true });
		if (model == null) return undefined;
		return {
			id: model.id,
			name: model.name,
			provider: { id: model.provider.id, name: model.provider.name },
		} satisfies AiModelInfo;
	}

	/**
	 * Get the current AI and MCP enablement state.
	 */
	getState(): Promise<AIState> {
		return Promise.resolve(this.#getAIState());
	}

	#getAIState(): AIState {
		return {
			enabled: this.#container.ai.enabled,
			orgEnabled: getContext('gitlens:gk:organization:ai:enabled', true),
			mcp: {
				bundled: mcpRegistrationAllowed(this.#container),
				settingEnabled: configuration.get('gitkraken.mcp.autoEnabled'),
				installed: getContext('gitlens:gk:cli:installed', false),
			},
		};
	}

	/**
	 * Check if AI is enabled.
	 */
	isEnabled(): Promise<boolean> {
		return Promise.resolve(this.#container.ai.enabled);
	}
}
