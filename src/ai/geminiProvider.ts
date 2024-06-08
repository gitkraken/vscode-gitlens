import type { CancellationToken } from 'vscode';
import { window } from 'vscode';
import { fetch } from '@env/fetch';
import type { Container } from '../container';
import { CancellationError } from '../errors';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import type { AIModel, AIProvider } from './aiProviderService';
import { getApiKey as getApiKeyCore, getMaxCharacters } from './aiProviderService';

const provider = { id: 'gemini', name: 'Google' } as const;

export type GeminiModels = 'gemini-1.0-pro' | 'gemini-1.5-pro-latest' | 'gemini-1.5-flash-latest';
type GeminiModel = AIModel<typeof provider.id>;
const models: GeminiModel[] = [
	{
		id: 'gemini-1.5-pro-latest',
		name: 'Gemini 1.5 Pro',
		maxTokens: 1048576,
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

	async generateCommitMessage(
		model: GeminiModel,
		diff: string,
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		// const retries = 0;
		const maxCodeCharacters = getMaxCharacters(model, 2600);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
			if (!customPrompt.endsWith('.')) {
				customPrompt += '.';
			}

			const request: GenerateContentRequest = {
				systemInstruction: {
					parts: [
						{
							text: `You are an advanced AI programming assistant tasked with summarizing code changes into a concise and meaningful commit message. Compose a commit message that:
- Strictly synthesizes meaningful information from the provided code diff
- Utilizes any additional user-provided context to comprehend the rationale behind the code changes
- Is clear and brief, with an informal yet professional tone, and without superfluous descriptions
- Avoids unnecessary phrases such as "this commit", "this change", and the like
- Avoids direct mention of specific code identifiers, names, or file names, unless they are crucial for understanding the purpose of the changes
- Most importantly emphasizes the 'why' of the change, its benefits, or the problem it addresses rather than only the 'what' that changed

Follow the user's instructions carefully, don't repeat yourself, don't include the code in the output, or make anything up!`,
						},
					],
				},
				contents: [
					{
						role: 'user',
						parts: [
							{
								text: `Here is the code diff to use to generate the commit message:\n\n${code}`,
							},
							...(options?.context
								? [
										{
											text: `Here is additional context which should be taken into account when generating the commit message:\n\n${options.context}`,
										},
								  ]
								: []),
							{
								text: customPrompt,
							},
						],
					},
				],
			};

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
					`Unable to generate commit message: (${this.name}:${rsp.status}) ${
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

	async explainChanges(
		model: GeminiModel,
		message: string,
		diff: string,
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		// const retries = 0;
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
