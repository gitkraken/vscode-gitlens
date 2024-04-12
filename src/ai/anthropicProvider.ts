import { window } from 'vscode';
import { fetch } from '@env/fetch';
import type { Container } from '../container';
import { showAIModelPicker } from '../quickpicks/aiModelPicker';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import type { AIProvider } from './aiProviderService';
import { getApiKey as getApiKeyCore, getMaxCharacters } from './aiProviderService';

type LegacyModels = Extract<AnthropicModels, 'claude-instant-1' | 'claude-2'>;
function isLegacyModel(model: AnthropicModels): model is LegacyModels {
	return model === 'claude-instant-1' || model === 'claude-2';
}

type SupportedModels = Exclude<AnthropicModels, LegacyModels>;

export class AnthropicProvider implements AIProvider<'anthropic'> {
	readonly id = 'anthropic';
	readonly name = 'Anthropic';

	constructor(private readonly container: Container) {}

	dispose() {}

	private get model(): AnthropicModels | null {
		return configuration.get('ai.experimental.anthropic.model') || null;
	}

	private async getOrChooseModel(): Promise<AnthropicModels | undefined> {
		const model = this.model;
		if (model != null) return model;

		const pick = await showAIModelPicker(this.id);
		if (pick == null) return undefined;

		await configuration.updateEffective(`ai.experimental.${pick.provider}.model`, pick.model);
		return pick.model;
	}

	async generateCommitMessage(diff: string, options?: { context?: string }): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = await this.getOrChooseModel();
		if (model == null) return undefined;

		let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
		if (!customPrompt.endsWith('.')) {
			customPrompt += '.';
		}

		const systemPrompt = `You are an advanced AI programming assistant tasked with summarizing code changes into a concise and meaningful commit message. Compose a commit message that:
- Strictly synthesizes meaningful information from the provided code diff
- Utilizes any additional user-provided context to comprehend the rationale behind the code changes
- Is clear and brief, with an informal yet professional tone, and without superfluous descriptions
- Avoids unnecessary phrases such as "this commit", "this change", and the like
- Avoids direct mention of specific code identifiers, names, or file names, unless they are crucial for understanding the purpose of the changes
- Most importantly emphasizes the 'why' of the change, its benefits, or the problem it addresses rather than only the 'what' that changed

Follow the user's instructions carefully, don't repeat yourself, don't include the code in the output, or make anything up!`;

		try {
			let result: string;
			let maxCodeCharacters: number;

			if (isLegacyModel(model)) {
				[result, maxCodeCharacters] = await this.makeLegacyRequest(
					model,
					apiKey,
					max => {
						const code = diff.substring(0, max);
						let prompt = `\n\nHuman: ${systemPrompt}\n\nHuman: Here is the code diff to use to generate the commit message:\n\n${code}\n`;
						if (options?.context) {
							prompt += `\nHuman: Here is additional context which should be taken into account when generating the commit message:\n\n${options.context}\n`;
						}
						if (customPrompt) {
							prompt += `\nHuman: ${customPrompt}\n`;
						}
						prompt += '\nAssistant:';
						return prompt;
					},
					4096,
				);
			} else {
				[result, maxCodeCharacters] = await this.makeRequest(
					model,
					apiKey,
					systemPrompt,
					max => {
						const code = diff.substring(0, max);
						const message: Message = {
							role: 'user',
							content: [
								{
									type: 'text',
									text: 'Here is the code diff to use to generate the commit message:',
								},
								{
									type: 'text',
									text: code,
								},
							],
						};
						if (options?.context) {
							message.content.push(
								{
									type: 'text',
									text: 'Here is additional context which should be taken into account when generating the commit message:',
								},
								{
									type: 'text',
									text: options.context,
								},
							);
						}
						if (customPrompt) {
							message.content.push({
								type: 'text',
								text: customPrompt,
							});
						}
						return [message];
					},
					4096,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the Anthropic's limits.`,
				);
			}

			return result;
		} catch (ex) {
			throw new Error(`Unable to generate commit message: ${ex.message}`);
		}
	}

	async explainChanges(message: string, diff: string): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = await this.getOrChooseModel();
		if (model == null) return undefined;

		const systemPrompt = `You are an advanced AI programming assistant tasked with summarizing code changes into an explanation that is both easy to understand and meaningful. Construct an explanation that:
- Concisely synthesizes meaningful information from the provided code diff
- Incorporates any additional context provided by the user to understand the rationale behind the code changes
- Places the emphasis on the 'why' of the change, clarifying its benefits or addressing the problem that necessitated the change, beyond just detailing the 'what' has changed

Do not make any assumptions or invent details that are not supported by the code diff or the user-provided context.`;

		try {
			let result: string;
			let maxCodeCharacters: number;

			if (model === 'claude-instant-1' || model === 'claude-2') {
				[result, maxCodeCharacters] = await this.makeLegacyRequest(
					model,
					apiKey,
					max => {
						const code = diff.substring(0, max);
						return `\n\nHuman: ${systemPrompt}

Human: Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:

${message}

Human: Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:

${code}

Human: Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase. And please don't explain how you arrived at the explanation, just provide the explanation.
Assistant:`;
					},
					4096,
				);
			} else {
				[result, maxCodeCharacters] = await this.makeRequest(
					model,
					apiKey,
					systemPrompt,
					max => {
						const code = diff.substring(0, max);
						return [
							{
								role: 'user',
								content: [
									{
										type: 'text',
										text: 'Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:',
									},
									{
										type: 'text',
										text: message,
									},
									{
										type: 'text',
										text: 'Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:',
									},
									{
										type: 'text',
										text: code,
									},
									{
										type: 'text',
										text: `Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase. And please don't explain how you arrived at the explanation, just provide the explanation`,
									},
								],
							},
						];
					},
					4096,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the Anthropic's limits.`,
				);
			}

			return result;
		} catch (ex) {
			throw new Error(`Unable to explain changes: ${ex.message}`);
		}
	}

	private fetch(model: SupportedModels, apiKey: string, request: AnthropicMessageRequest): ReturnType<typeof fetch>;
	private fetch(model: LegacyModels, apiKey: string, request: AnthropicCompletionRequest): ReturnType<typeof fetch>;
	private fetch(
		model: AnthropicModels,
		apiKey: string,
		request: AnthropicMessageRequest | AnthropicCompletionRequest,
	): ReturnType<typeof fetch> {
		return fetch(getUrl(model), {
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'X-API-Key': apiKey,
				'anthropic-version': '2023-06-01',
			},
			method: 'POST',
			body: JSON.stringify(request),
		});
	}

	private async makeRequest(
		model: SupportedModels,
		apiKey: string,
		system: string,
		messages: (maxCodeCharacters: number) => Message[],
		maxTokens: number,
	): Promise<[result: string, maxCodeCharacters: number]> {
		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);

		while (true) {
			const request: AnthropicMessageRequest = {
				model: model,
				messages: messages(maxCodeCharacters),
				system: system,
				stream: false,
				max_tokens: maxTokens,
			};
			const rsp = await this.fetch(model, apiKey, request);
			if (!rsp.ok) {
				let json;
				try {
					json = (await rsp.json()) as AnthropicError | undefined;
				} catch {}

				debugger;

				if (
					retries++ < 2 &&
					json?.error?.type === 'invalid_request_error' &&
					json?.error?.message?.includes('prompt is too long')
				) {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(`(${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText})`);
			}

			const data: AnthropicMessageResponse = await rsp.json();
			const result = data.content
				.map(c => c.text)
				.join('\n')
				.trim();
			return [result, maxCodeCharacters];
		}
	}

	private async makeLegacyRequest(
		model: Extract<AnthropicModels, 'claude-instant-1' | 'claude-2'>,
		apiKey: string,
		prompt: (maxCodeCharacters: number) => string,
		maxTokens: number,
	): Promise<[result: string, maxCodeCharacters: number]> {
		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);

		while (true) {
			const request: AnthropicCompletionRequest = {
				model: model,
				prompt: prompt(maxCodeCharacters),
				stream: false,
				max_tokens_to_sample: maxTokens,
			};
			const rsp = await this.fetch(model, apiKey, request);
			if (!rsp.ok) {
				let json;
				try {
					json = (await rsp.json()) as AnthropicError | undefined;
				} catch {}

				debugger;

				if (
					retries++ < 2 &&
					json?.error?.type === 'invalid_request_error' &&
					json?.error?.message?.includes('prompt is too long')
				) {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(`(${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText})`);
			}

			const data: AnthropicCompletionResponse = await rsp.json();
			const result = data.completion.trim();
			return [result, maxCodeCharacters];
		}
	}
}

async function getApiKey(storage: Storage): Promise<string | undefined> {
	return getApiKeyCore(storage, {
		id: 'anthropic',
		name: 'Anthropic',
		validator: v => /(?:sk-)?[a-zA-Z0-9-_]{32,}/.test(v),
		url: 'https://console.anthropic.com/account/keys',
	});
}

function getUrl(model: AnthropicModels): string {
	return isLegacyModel(model) ? 'https://api.anthropic.com/v1/complete' : 'https://api.anthropic.com/v1/messages';
}

export type AnthropicModels =
	| 'claude-instant-1'
	| 'claude-2'
	| 'claude-2.1'
	| 'claude-3-opus-20240229'
	| 'claude-3-sonnet-20240229'
	| 'claude-3-haiku-20240307';

interface AnthropicError {
	type: 'error';
	error: {
		type:
			| 'invalid_request_error'
			| 'authentication_error'
			| 'permission_error'
			| 'not_found_error'
			| 'rate_limit_error'
			| 'api_error'
			| 'overloaded_error';
		message: string;
	};
}

interface AnthropicCompletionRequest {
	model: Extract<AnthropicModels, 'claude-instant-1' | 'claude-2'>;
	prompt: string;
	stream: boolean;

	max_tokens_to_sample: number;
	stop_sequences?: string[];

	temperature?: number;
	top_k?: number;
	top_p?: number;
	tags?: Record<string, string>;
}

interface AnthropicCompletionResponse {
	completion: string;
	stop: string | null;
	stop_reason: 'stop_sequence' | 'max_tokens';
	truncated: boolean;
	exception: string | null;
	log_id: string;
}

interface Message {
	role: 'user' | 'assistant';
	content: (
		| { type: 'text'; text: string }
		| {
				type: 'image';
				source: {
					type: 'base64';
					media_type: `image/${'jpeg' | 'png' | 'gif' | 'webp'}`;
					data: string;
				};
		  }
	)[];
}

interface AnthropicMessageRequest {
	model: SupportedModels;
	messages: Message[];
	system?: string;

	max_tokens: number;
	metadata?: object;
	stop_sequences?: string[];
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	top_k?: number;
}

interface AnthropicMessageResponse {
	id: string;
	type: 'message';
	role: 'assistant';
	content: { type: 'text'; text: string }[];
	model: string;
	stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
	stop_sequence: string | null;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}
