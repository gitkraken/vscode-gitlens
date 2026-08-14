import type { CancellationToken, ProgressOptions } from 'vscode';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type { AIChatMessage, AIProviderResponse } from '@gitlens/ai/models/provider.js';
import { generateSearchQuerySchema } from '@gitlens/ai/prompts.js';
import { extractJsonObject } from '@gitlens/ai/utils/results.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Source } from '../../../constants.telemetry.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { AIResponse } from '../aiProviderService.js';
import type { AIService } from '../aiService.js';

export interface AISearchQueryResult {
	readonly query: string;
	readonly explanation?: string;
	readonly mode?: 'highlight' | 'filter' | 'select';
	readonly alternates?: string[];
}

const structuralRetryInstructions =
	'Your previous response was not the required JSON object. Respond with ONLY the JSON object matching the schema.';

/** Must match the `query` placeholder in the prompt's embedded example JSON (see
 *  `generateSearchQueryExampleJson` in `prompts.ts`). Weak models sometimes echo the example object
 *  first, and {@link extractJsonObject} picks the first balanced object it finds — so a query that is
 *  (or contains) this exact placeholder text is the echoed example, not a real answer, and must count
 *  as a parse failure so the corrective retry fires. */
const exampleQueryPlaceholder = '[search operators here]';

/** Generates a structured search query from a natural language query, with one corrective retry
 *  if the response can't be parsed as the required JSON shape. */
export async function generateSearchQuery(
	service: AIService,
	search: { query: string; context: string | undefined },
	source: Source,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResponse<AISearchQueryResult> | 'cancelled' | undefined> {
	const runOnce = (preferredModel: AIModel | undefined, correctiveInstructions?: string) =>
		service.sendRequest(
			'generate-searchQuery',
			preferredModel,
			{
				getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
					const customInstructions = configuration.get('ai.generateSearchQuery.customInstructions');
					const { prompt } = await service.getPrompt(
						'generate-searchQuery',
						model,
						{
							query: search.query,
							date: new Date().toISOString().split('T')[0],
							context: search.context,
							instructions: correctiveInstructions
								? [customInstructions, correctiveInstructions].filter(Boolean).join('\n\n')
								: customInstructions,
						},
						maxInputTokens,
						retries,
						reporting,
					);
					if (cancellation.isCancellationRequested) throw new CancellationError();

					const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
					return messages;
				},
				getProgressTitle: model => `Generating search query with ${model.name}...`,
				getTelemetryInfo: model => ({
					key: 'ai/generate',
					data: {
						type: 'searchQuery',
						id: undefined,
						'model.id': model.id,
						'model.provider.id': model.provider.id,
						'model.provider.name': model.provider.name,
						'retry.count': 0,
					},
				}),
			},
			source,
			{ ...options, responseFormat: generateSearchQuerySchema },
		);

	let finalResponse: AIProviderResponse<void> | undefined;
	let parsed: AISearchQueryResult | undefined;
	let preferredModel: AIModel | undefined;

	// Two passes: the initial attempt, then one corrective retry (using the model that answered the
	// first time) if the response couldn't be parsed as the required JSON shape.
	for (const correctiveInstructions of [undefined, structuralRetryInstructions]) {
		const result = await runOnce(preferredModel, correctiveInstructions);
		if (result == null || result === 'cancelled') return result;

		const response = await result.promise;
		if (response === 'cancelled') return response;

		finalResponse = response;
		preferredModel = response?.model;
		parsed = response != null ? extractSearchQueryResult(response.content) : undefined;
		if (parsed != null) break;
	}

	if (finalResponse == null || parsed == null) return undefined;

	return { ...finalResponse, type: 'generate-searchQuery', feature: 'generate-searchQuery', result: parsed };
}

/** Extracts and normalizes the structured search query result, tolerating code fences and prose. */
export function extractSearchQueryResult(content: string): AISearchQueryResult | undefined {
	const parsed = extractJsonObject(content, o => typeof (o as { query?: unknown }).query === 'string');
	if (parsed == null) return undefined;

	const query = trimmedNonEmptyString(parsed.query);
	if (query == null) return undefined;
	if (query.includes(exampleQueryPlaceholder)) return undefined;

	return {
		query: query,
		explanation: trimmedNonEmptyString(parsed.explanation),
		mode: normalizeMode(parsed.mode),
		alternates: normalizeAlternates(parsed.alternates),
	};
}

function trimmedNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeMode(value: unknown): 'highlight' | 'filter' | 'select' | undefined {
	return value === 'highlight' || value === 'filter' || value === 'select' ? value : undefined;
}

function normalizeAlternates(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const alternates: string[] = [];
	for (const item of value) {
		const trimmed = trimmedNonEmptyString(item);
		if (trimmed == null) continue;

		alternates.push(trimmed);
		if (alternates.length === 2) break;
	}

	return alternates;
}
