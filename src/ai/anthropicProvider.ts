import { fetch } from '@env/fetch';
import type { CancellationToken } from 'vscode';
import { window } from 'vscode';
import type { AnthropicModels } from '../constants.ai';
import type { TelemetryEvents } from '../constants.telemetry';
import type { Container } from '../container';
import { CancellationError } from '../errors';
import { sum } from '../system/iterable';
import { configuration } from '../system/vscode/configuration';
import type { Storage } from '../system/vscode/storage';
import type { AIModel, AIProvider } from './aiProviderService';
import { getApiKey as getApiKeyCore, getMaxCharacters } from './aiProviderService';
import { cloudPatchMessageSystemPrompt, codeSuggestMessageSystemPrompt, commitMessageSystemPrompt } from './prompts';

const provider = { id: 'anthropic', name: 'Anthropic' } as const;
type LegacyModels = Extract<AnthropicModels, 'claude-instant-1' | 'claude-2'>;
type SupportedModels = Exclude<AnthropicModels, LegacyModels>;
type LegacyModel = AIModel<typeof provider.id, LegacyModels>;
type SupportedModel = AIModel<typeof provider.id, SupportedModels>;

function isLegacyModel(model: AnthropicModel): model is LegacyModel {
	return model.id === 'claude-instant-1' || model.id === 'claude-2';
}

function isSupportedModel(model: AnthropicModel): model is SupportedModel {
	return !isLegacyModel(model);
}

type AnthropicModel = AIModel<typeof provider.id>;

const models: AnthropicModel[] = [
	{
		id: 'claude-3-opus-20240229',
		name: 'Claude 3 Opus',
		maxTokens: 200000,
		provider: provider,
	},
	{
		id: 'claude-3-5-sonnet-20240620',
		name: 'Claude 3.5 Sonnet',
		maxTokens: 200000,
		provider: provider,
	},
	{
		id: 'claude-3-sonnet-20240229',
		name: 'Claude 3 Sonnet',
		maxTokens: 200000,
		provider: provider,
	},
	{
		id: 'claude-3-haiku-20240307',
		name: 'Claude 3 Haiku',
		maxTokens: 200000,
		provider: provider,
		default: true,
	},
	{ id: 'claude-2.1', name: 'Claude 2.1', maxTokens: 200000, provider: provider },
	{ id: 'claude-2', name: 'Claude 2.0', maxTokens: 100000, provider: provider },
	{
		id: 'claude-instant-1',
		name: 'Claude Instant',
		maxTokens: 100000,
		provider: provider,
	},
];

export class AnthropicProvider implements AIProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;

	constructor(private readonly container: Container) {}

	dispose() {}

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	async generateMessage(
		model: AnthropicModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		promptConfig: {
			systemPrompt: string;
			customPrompt: string;
			contextName: string;
		},
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		try {
			let result: string;
			let maxCodeCharacters: number;

			if (!isSupportedModel(model)) {
				[result, maxCodeCharacters] = await this.makeLegacyRequest(
					model as LegacyModel,
					apiKey,
					(max, retries) => {
						const code = diff.substring(0, max);
						let prompt = `\n\nHuman: ${promptConfig.systemPrompt}\n\nHuman: Here is the code diff to use to generate the ${promptConfig.contextName}:\n\n${code}\n`;
						if (options?.context) {
							prompt += `\nHuman: Here is additional context which should be taken into account when generating the ${promptConfig.contextName}:\n\n${options.context}\n`;
						}
						if (promptConfig.customPrompt) {
							prompt += `\nHuman: ${promptConfig.customPrompt}\n`;
						}
						prompt += '\nAssistant:';

						reporting['retry.count'] = retries;
						reporting['input.length'] = (reporting['input.length'] ?? 0) + prompt.length;

						return prompt;
					},
					4096,
					options?.cancellation,
				);
			} else {
				[result, maxCodeCharacters] = await this.makeRequest(
					model,
					apiKey,
					promptConfig.systemPrompt,
					(max, retries) => {
						const code = diff.substring(0, max);
						const messages: Message[] = [
							{
								role: 'user',
								content: [
									{
										type: 'text',
										text: `Here is the code diff to use to generate the ${promptConfig.contextName}:`,
									},
									{
										type: 'text',
										text: code,
									},
									...(options?.context
										? ([
												{
													type: 'text',
													text: `Here is additional context which should be taken into account when generating the ${promptConfig.contextName}:`,
												},
												{
													type: 'text',
													text: options.context,
												},
										  ] satisfies Message['content'])
										: []),
									...(promptConfig.customPrompt
										? ([
												{
													type: 'text',
													text: promptConfig.customPrompt,
												},
										  ] satisfies Message['content'])
										: []),
								],
							},
						];

						reporting['retry.count'] = retries;
						reporting['input.length'] =
							(reporting['input.length'] ?? 0) +
							sum(messages, m => sum(m.content, c => (c.type === 'text' ? c.text.length : 0)));

						return messages;
					},
					4096,
					options?.cancellation,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the Anthropic's limits.`,
				);
			}

			return result;
		} catch (ex) {
			throw new Error(`Unable to generate ${promptConfig.contextName}: ${ex.message}`);
		}
	}

	async generateDraftMessage(
		model: AnthropicModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: { cancellation?: CancellationToken; context?: string; codeSuggestion?: boolean },
	): Promise<string | undefined> {
		let customPrompt =
			options?.codeSuggestion === true
				? configuration.get('experimental.generateCodeSuggestionMessagePrompt')
				: configuration.get('experimental.generateCloudPatchMessagePrompt');
		if (!customPrompt.endsWith('.')) {
			customPrompt += '.';
		}

		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				systemPrompt:
					options?.codeSuggestion === true ? codeSuggestMessageSystemPrompt : cloudPatchMessageSystemPrompt,
				customPrompt: customPrompt,
				contextName:
					options?.codeSuggestion === true
						? 'code suggestion title and description'
						: 'cloud patch title and description',
			},
			options,
		);
	}

	async generateCommitMessage(
		model: AnthropicModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
		if (!customPrompt.endsWith('.')) {
			customPrompt += '.';
		}

		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				systemPrompt: commitMessageSystemPrompt,
				customPrompt: customPrompt,
				contextName: 'commit message',
			},
			options,
		);
	}

	async explainChanges(
		model: AnthropicModel,
		message: string,
		diff: string,
		reporting: TelemetryEvents['ai/explain'],
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const systemPrompt = `You are an advanced AI programming assistant tasked with summarizing code changes into an explanation that is both easy to understand and meaningful. Construct an explanation that:
- Concisely synthesizes meaningful information from the provided code diff
- Incorporates any additional context provided by the user to understand the rationale behind the code changes
- Places the emphasis on the 'why' of the change, clarifying its benefits or addressing the problem that necessitated the change, beyond just detailing the 'what' has changed

Do not make any assumptions or invent details that are not supported by the code diff or the user-provided context.`;

		try {
			let result: string;
			let maxCodeCharacters: number;

			if (!isSupportedModel(model)) {
				[result, maxCodeCharacters] = await this.makeLegacyRequest(
					model as LegacyModel,
					apiKey,
					(max, retries) => {
						const code = diff.substring(0, max);
						const prompt = `\n\nHuman: ${systemPrompt}

Human: Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:

${message}

Human: Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:

${code}

Human: Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase. And please don't explain how you arrived at the explanation, just provide the explanation.
Assistant:`;
						reporting['retry.count'] = retries;
						reporting['input.length'] = (reporting['input.length'] ?? 0) + prompt.length;

						return prompt;
					},
					4096,
					options?.cancellation,
				);
			} else {
				[result, maxCodeCharacters] = await this.makeRequest(
					model,
					apiKey,
					systemPrompt,
					(max, retries) => {
						const code = diff.substring(0, max);
						const messages: Message[] = [
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

						reporting['retry.count'] = retries;
						reporting['input.length'] =
							(reporting['input.length'] ?? 0) +
							sum(messages, m => sum(m.content, c => (c.type === 'text' ? c.text.length : 0)));

						return messages;
					},
					4096,
					options?.cancellation,
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

	private fetch(
		model: SupportedModel,
		apiKey: string,
		request: AnthropicMessageRequest,
		cancellation: CancellationToken | undefined,
	): ReturnType<typeof fetch>;
	private fetch(
		model: LegacyModel,
		apiKey: string,
		request: AnthropicCompletionRequest,
		cancellation: CancellationToken | undefined,
	): ReturnType<typeof fetch>;
	private async fetch(
		model: AnthropicModel,
		apiKey: string,
		request: AnthropicMessageRequest | AnthropicCompletionRequest,
		cancellation: CancellationToken | undefined,
	): ReturnType<typeof fetch> {
		let aborter: AbortController | undefined;
		if (cancellation != null) {
			aborter = new AbortController();
			cancellation.onCancellationRequested(() => aborter?.abort());
		}

		try {
			return await fetch(getUrl(model), {
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
		} catch (ex) {
			if (ex.name === 'AbortError') throw new CancellationError(ex);
			throw ex;
		}
	}

	private async makeRequest(
		model: SupportedModel,
		apiKey: string,
		system: string,
		messages: (maxCodeCharacters: number, retries: number) => Message[],
		maxTokens: number,
		cancellation: CancellationToken | undefined,
	): Promise<[result: string, maxCodeCharacters: number]> {
		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);

		while (true) {
			const request: AnthropicMessageRequest = {
				model: model.id,
				messages: messages(maxCodeCharacters, retries),
				system: system,
				stream: false,
				max_tokens: maxTokens,
			};

			const rsp = await this.fetch(model, apiKey, request, cancellation);
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
		model: LegacyModel,
		apiKey: string,
		prompt: (maxCodeCharacters: number, retries: number) => string,
		maxTokens: number,
		cancellation: CancellationToken | undefined,
	): Promise<[result: string, maxCodeCharacters: number]> {
		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);

		while (true) {
			const request: AnthropicCompletionRequest = {
				model: model.id,
				prompt: prompt(maxCodeCharacters, retries),
				stream: false,
				max_tokens_to_sample: maxTokens,
			};
			const rsp = await this.fetch(model, apiKey, request, cancellation);
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
		id: provider.id,
		name: provider.name,
		validator: v => /(?:sk-)?[a-zA-Z0-9-_]{32,}/.test(v),
		url: 'https://console.anthropic.com/account/keys',
	});
}

function getUrl(model: AnthropicModel): string {
	return isLegacyModel(model) ? 'https://api.anthropic.com/v1/complete' : 'https://api.anthropic.com/v1/messages';
}

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
