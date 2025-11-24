import type { CancellationToken, ProgressOptions } from 'vscode';
import type { Source } from '../../../constants.telemetry';
import { CancellationError } from '../../../errors';
import { configuration } from '../../../system/-webview/configuration';
import type { AIResponse } from '../aiProviderService';
import type { AIService } from '../aiService';
import type { AIChatMessage } from '../models/provider';

export type AISearchQueryResult = string;

/** Generates a structured search query from a natural language */
export async function generateSearchQuery(
	service: AIService,
	search: { query: string; context: string | undefined },
	source: Source,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResponse<AISearchQueryResult> | 'cancelled' | undefined> {
	const result = await service.sendRequest(
		'generate-searchQuery',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				const { prompt } = await service.getPrompt(
					'generate-searchQuery',
					model,
					{
						query: search.query,
						date: new Date().toISOString().split('T')[0],
						context: search.context,
						instructions: configuration.get('ai.generateSearchQuery.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			getProgressTitle: m => `Generating search query with ${m.name}...`,
			getTelemetryInfo: m => ({
				key: 'ai/generate',
				data: {
					type: 'searchQuery',
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
		},
		source,
		options,
	);
	if (result == null || result === 'cancelled') return result;

	const response = await result.promise;
	return response === 'cancelled'
		? response
		: response != null
			? {
					...response,
					type: 'generate-searchQuery',
					feature: 'generate-searchQuery',
					result: cleanSearchQueryResponse(response.content),
				}
			: undefined;
}

function cleanSearchQueryResponse(response: string): string {
	// Remove any markdown formatting
	let cleaned = response.replace(/```[^`]*```/g, '').replace(/`([^`]+)`/g, '$1');

	// Remove common prefixes that AI might add
	cleaned = cleaned.replace(/^(search query:|query:|result:|converted query:)\s*/i, '');

	// Remove quotes if the entire response is quoted
	cleaned = cleaned.replace(/^"(.*)"$/, '$1');
	cleaned = cleaned.replace(/^'(.*)'$/, '$1');

	// Take only the first line if there are multiple lines
	cleaned = cleaned.split('\n')[0];

	return cleaned.trim();
}
