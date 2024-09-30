import { fetch } from '@env/fetch';
import type { CancellationToken } from 'vscode';
import { window } from 'vscode';
import type { GeminiModels } from '../constants.ai';
import type { TelemetryEvents } from '../constants.telemetry';
import type { Container } from '../container';
import { CancellationError } from '../errors';
import { sum } from '../system/iterable';
import { interpolate } from '../system/string';
import { configuration } from '../system/vscode/configuration';
import type { Storage } from '../system/vscode/storage';
import type { AIModel, AIProvider } from './aiProviderService';
import { getApiKey as getApiKeyCore, getMaxCharacters } from './aiProviderService';
import {
	generateCloudPatchMessageSystemPrompt,
	generateCloudPatchMessageUserPrompt,
	generateCodeSuggestMessageSystemPrompt,
	generateCodeSuggestMessageUserPrompt,
	generateCommitMessageSystemPrompt,
	generateCommitMessageUserPrompt,
} from './prompts';

const provider = { id: 'gemini', name: 'Google' } as const;

type GeminiModel = AIModel<typeof provider.id>;
const models: GeminiModel[] = [
	{
		id: 'gemini-1.5-pro-latest',
		name: 'Gemini 1.5 Pro',
		maxTokens: 2097152,
		provider: provider,
		default: true,
	},
	{
		id: 'gemini-1.5-flash-latest',
		name: 'Gemini 1.5 Flash',
		maxTokens: 1048576,
		provider: provider,
	},
	{
		id: 'gemini-1.0-pro',
		name: 'Gemini 1.0 Pro',
		maxTokens: 30720,
		provider: provider,
	},
];

export class GeminiProvider implements AIProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;

	constructor(private readonly container: Container) {}

	dispose() {}

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	async generateMessage(
		model: GeminiModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		promptConfig: {
			type: 'commit' | 'cloud-patch' | 'code-suggestion';
			systemPrompt: string;
			userPrompt: string;
			customInstructions?: string;
		},
		options?: {
			cancellation?: CancellationToken | undefined;
			context?: string | undefined;
		},
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const retries = 0;
		const maxCodeCharacters = getMaxCharacters(model, 2600);
		while (true) {
			const request: GenerateContentRequest = {
				systemInstruction: {
					parts: [
						{
							text: promptConfig.systemPrompt,
						},
					],
				},
				contents: [
					{
						role: 'user',
						parts: [
							{
								text: interpolate(promptConfig.userPrompt, {
									diff: diff.substring(0, maxCodeCharacters),
									context: options?.context ?? '',
									instructions: promptConfig.customInstructions ?? '',
								}),
							},
						],
					},
				],
			};

			reporting['retry.count'] = retries;
			reporting['input.length'] =
				(reporting['input.length'] ?? 0) +
				sum(request.systemInstruction?.parts, p => p.text.length) +
				sum(request.contents, c => sum(c.parts, p => p.text.length));

			const rsp = await this.fetch(model.id, apiKey, request, options?.cancellation);
			if (!rsp.ok) {
				let json;
				try {
					json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				} catch {}

				debugger;

				// if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
				// 	maxCodeCharacters -= 500 * retries;
				// 	continue;
				// }

				throw new Error(
					`Unable to generate ${promptConfig.type} message: (${this.name}:${rsp.status}) ${
						json?.error?.message || rsp.statusText
					}`,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the Gemini's limits.`,
				);
			}

			const data: GenerateContentResponse = await rsp.json();
			const message = data.candidates[0].content.parts[0].text.trim();
			return message;
		}
	}

	async generateDraftMessage(
		model: GeminiModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: {
			cancellation?: CancellationToken | undefined;
			context?: string | undefined;
			codeSuggestion?: boolean | undefined;
		},
	): Promise<string | undefined> {
		let codeSuggestion;
		if (options != null) {
			({ codeSuggestion, ...options } = options ?? {});
		}

		return this.generateMessage(
			model,
			diff,
			reporting,
			codeSuggestion
				? {
						type: 'code-suggestion',
						systemPrompt: generateCodeSuggestMessageSystemPrompt,
						userPrompt: generateCodeSuggestMessageUserPrompt,
						customInstructions: configuration.get('experimental.generateCodeSuggestionMessagePrompt'),
				  }
				: {
						type: 'cloud-patch',
						systemPrompt: generateCloudPatchMessageSystemPrompt,
						userPrompt: generateCloudPatchMessageUserPrompt,
						customInstructions: configuration.get('experimental.generateCloudPatchMessagePrompt'),
				  },
			options,
		);
	}

	async generateCommitMessage(
		model: GeminiModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				type: 'commit',
				systemPrompt: generateCommitMessageSystemPrompt,
				userPrompt: generateCommitMessageUserPrompt,
				customInstructions: configuration.get('experimental.generateCommitMessagePrompt'),
			},
			options,
		);
	}

	async explainChanges(
		model: GeminiModel,
		message: string,
		diff: string,
		reporting: TelemetryEvents['ai/explain'],
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const retries = 0;
		const maxCodeCharacters = getMaxCharacters(model, 3000);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			const request: GenerateContentRequest = {
				systemInstruction: {
					parts: [
						{
							text: `You are an advanced AI programming assistant tasked with summarizing code changes into an explanation that is both easy to understand and meaningful. Construct an explanation that:
- Concisely synthesizes meaningful information from the provided code diff
- Incorporates any additional context provided by the user to understand the rationale behind the code changes
- Places the emphasis on the 'why' of the change, clarifying its benefits or addressing the problem that necessitated the change, beyond just detailing the 'what' has changed

Do not make any assumptions or invent details that are not supported by the code diff or the user-provided context.`,
						},
					],
				},
				contents: [
					{
						role: 'user',
						parts: [
							{
								text: `Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:\n\n${message}`,
							},
							{
								text: `Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:\n\n${code}`,
							},
							{
								text: `Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase.`,
							},
						],
					},
				],
			};

			reporting['retry.count'] = retries;
			reporting['input.length'] =
				(reporting['input.length'] ?? 0) +
				sum(request.systemInstruction?.parts, p => p.text.length) +
				sum(request.contents, c => sum(c.parts, p => p.text.length));

			const rsp = await this.fetch(model.id, apiKey, request, options?.cancellation);
			if (!rsp.ok) {
				let json;
				try {
					json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				} catch {}

				debugger;

				// if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
				// 	maxCodeCharacters -= 500 * retries;
				// 	continue;
				// }

				throw new Error(
					`Unable to explain changes: (${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText}`,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the Gemini's limits.`,
				);
			}

			const data: GenerateContentResponse = await rsp.json();
			const summary = data.candidates[0].content.parts[0].text.trim();
			return summary;
		}
	}

	private async fetch(
		model: GeminiModels,
		apiKey: string,
		request: GenerateContentRequest,
		cancellation: CancellationToken | undefined,
	) {
		let aborter: AbortController | undefined;
		if (cancellation != null) {
			aborter = new AbortController();
			cancellation.onCancellationRequested(() => aborter?.abort());
		}

		try {
			return await fetch(getUrl(model), {
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'x-goog-api-key': apiKey,
				},
				method: 'POST',
				body: JSON.stringify(request),
				signal: aborter?.signal,
			});
		} catch (ex) {
			if (ex.name === 'AbortError') throw new CancellationError(ex);

			throw ex;
		}
	}
}

async function getApiKey(storage: Storage): Promise<string | undefined> {
	return getApiKeyCore(storage, {
		id: provider.id,
		name: provider.name,
		validator: () => true,
		url: 'https://aistudio.google.com/app/apikey',
	});
}

function getUrl(model: GeminiModels): string {
	return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

interface Content {
	parts: Part[];
	role?: 'model' | 'user';
}

type Part = TextPart;
interface TextPart {
	text: string;
}

interface GenerationConfig {
	stopSequences?: string[];
	candidateCount?: number;
	maxOutputTokens?: number;
	temperature?: number;
	topP?: number;
	topK?: number;
}

interface GenerateContentRequest {
	contents: Content[];
	systemInstruction?: Content;
	generationConfig?: GenerationConfig;
}

interface Candidate {
	content: Content;
	finishReason?: 'FINISH_REASON_UNSPECIFIED' | 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
	safetyRatings: any[];
	citationMetadata: any;
	tokenCount: number;
	index: number;
}

interface GenerateContentResponse {
	candidates: Candidate[];
	promptFeedback: {
		blockReason: 'BLOCK_REASON_UNSPECIFIED' | 'SAFETY' | 'OTHER';
		safetyRatings: any[];
	};
}
