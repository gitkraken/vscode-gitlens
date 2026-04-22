import type { AiGenerateParams, AiGenerateResult, AiModelPort, AiTokenUsage } from '@gitkraken/shared-tools';
import { CancellationTokenSource } from 'vscode';
import type { AIChatMessage, AIProviderResponse } from '@gitlens/ai/models/provider.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';

/*
 * Adapts `@gitkraken/compose-tools`'s AiModelPort to GitLens's AIProviderService.
 *
 * Each `generate()` call:
 *   1. Resolves GitLens's currently-selected model.
 *   2. Passes the library's prompt through as `AIChatMessage[]` — we bypass the
 *      `getPrompt` template lookup entirely. The library bakes its own prompts.
 *   3. Maps the provider response back to `AiGenerateResult`.
 *   4. Translates AbortSignal <-> CancellationToken at the boundary.
 *
 * ToS confirmation, API key gathering, and feature gating are handled inside
 * `sendRequest` itself — this adapter inherits them for free.
 *
 * Large-prompt gating is handled via the library's `onBeforePrompt` hook
 * (supplied by the integration layer), not here.
 *
 * Cancellation (`'cancelled'` outcome from sendRequest) surfaces as a thrown
 * `WorkflowError('CANCELLED')` from the library, because the library catches
 * adapter errors and wraps cancellation.
 */
export function createAiModelPort(container: Container, source: Source): AiModelPort {
	return {
		generate: async (params: AiGenerateParams): Promise<AiGenerateResult> => {
			const cancellationSource = new CancellationTokenSource();
			const abortHandler = () => cancellationSource.cancel();
			params.signal?.addEventListener('abort', abortHandler);

			try {
				const messages: AIChatMessage[] = [];
				if (params.system) {
					// GitLens's AIChatMessage union allows 'user' | 'assistant' by default;
					// system messages use the wider role and the `sendRequestConversation`
					// path accepts them. For `sendRequest` we embed the system prompt at
					// the head of the conversation.
					messages.push({ role: 'system' as 'user', content: params.system });
				}
				for (const msg of params.messages) {
					messages.push({ role: msg.role, content: msg.content });
				}

				const provider = {
					getMessages: (): Promise<AIChatMessage[]> => Promise.resolve(messages),
					getProgressTitle: () => 'Composing commits…',
					getTelemetryInfo: (model: {
						provider: { id: string; name: string };
						id: string;
						name: string;
					}) => ({
						key: 'ai/generate' as const,
						data: {
							type: 'commits' as const,
							'model.id': model.id,
							'model.provider.id': model.provider.id,
							'model.provider.name': model.provider.name,
							'retry.count': 0,
							duration: 0,
						},
					}),
				};

				const result = await container.ai.sendRequest(
					'generate-commits',
					undefined,
					// biome-ignore lint/suspicious/noExplicitAny: AIRequestProvider telemetry type is deeply private; we supply the minimum shape
					provider as any,
					source,
					{
						cancellation: cancellationSource.token,
						modelOptions: {
							outputTokens: params.maxTokens,
							temperature: params.temperature,
						},
					},
				);

				if (result === 'cancelled') {
					throw Object.assign(new Error('Operation cancelled'), { name: 'AbortError' });
				}
				if (result == null) {
					throw new Error('AI request returned no result');
				}

				const response = await result.promise;
				if (response === 'cancelled') {
					throw Object.assign(new Error('Operation cancelled'), { name: 'AbortError' });
				}
				if (response == null) {
					throw new Error('AI request produced no response');
				}

				return {
					text: response.content,
					usage: mapUsage(response),
				};
			} finally {
				params.signal?.removeEventListener('abort', abortHandler);
				cancellationSource.dispose();
			}
		},
	};
}

function mapUsage(response: AIProviderResponse<void>): AiTokenUsage | undefined {
	if (!response.usage) return undefined;
	return {
		inputTokens: response.usage.promptTokens ?? 0,
		outputTokens: response.usage.completionTokens ?? 0,
	};
}
