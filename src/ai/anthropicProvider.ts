import { fetch } from '@env/fetch';
import type { CancellationToken } from 'vscode';
import type { TelemetryEvents } from '../constants.telemetry';
import type { Container } from '../container';
import { CancellationError } from '../errors';
import { sum } from '../system/iterable';
import { interpolate } from '../system/string';
import { configuration } from '../system/vscode/configuration';
import type { Storage } from '../system/vscode/storage';
import type { AIModel, AIProvider } from './aiProviderService';
import { getApiKey as getApiKeyCore, getMaxCharacters, showDiffTruncationWarning } from './aiProviderService';
import {
	explainChangesSystemPrompt,
	explainChangesUserPrompt,
	generateCloudPatchMessageSystemPrompt,
	generateCloudPatchMessageUserPrompt,
	generateCodeSuggestMessageSystemPrompt,
	generateCodeSuggestMessageUserPrompt,
	generateCommitMessageSystemPrompt,
	generateCommitMessageUserPrompt,
} from './prompts';

const provider = { id: 'anthropic', name: 'Anthropic' } as const;

type AnthropicModel = AIModel<typeof provider.id>;

const models: AnthropicModel[] = [
	{
		id: 'claude-3-5-sonnet-latest',
		name: 'Claude 3.5 Sonnet',
		maxTokens: 200000,
		provider: provider,
	},
	{
		id: 'claude-3-5-sonnet-20240620',
		name: 'Claude 3.5 Sonnet',
		maxTokens: 200000,
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-haiku-latest',
		name: 'Claude 3.5 Haiku',
		maxTokens: 200000,
		provider: provider,
	},
	{
		id: 'claude-3-5-haiku-20241022',
		name: 'Claude 3.5 Haiku',
		maxTokens: 200000,
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-opus-latest',
		name: 'Claude 3 Opus',
		maxTokens: 200000,
		provider: provider,
	},
	{
		id: 'claude-3-opus-20240229',
		name: 'Claude 3 Opus',
		maxTokens: 200000,
		provider: provider,
		hidden: true,
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
			type: 'commit' | 'cloud-patch' | 'code-suggestion';
			systemPrompt: string;
			userPrompt: string;
			customInstructions?: string;
		},
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		try {
			const [result, maxCodeCharacters] = await this.makeRequest(
				model,
				apiKey,
				promptConfig.systemPrompt,
				(max, retries) => {
					const messages: Message[] = [
						{
							role: 'user',
							content: [
								{
									type: 'text',
									text: interpolate(promptConfig.userPrompt, {
										diff: diff.substring(0, max),
										context: options?.context ?? '',
										instructions: promptConfig.customInstructions ?? '',
									}),
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

			if (diff.length > maxCodeCharacters) {
				showDiffTruncationWarning(maxCodeCharacters, model);
			}

			return result;
		} catch (ex) {
			throw new Error(`Unable to generate ${promptConfig.type} message: ${ex.message}`);
		}
	}

	async generateDraftMessage(
		model: AnthropicModel,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: { cancellation?: CancellationToken; context?: string; codeSuggestion?: boolean },
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
						customInstructions: configuration.get('ai.generateCodeSuggestMessage.customInstructions'),
				  }
				: {
						type: 'cloud-patch',
						systemPrompt: generateCloudPatchMessageSystemPrompt,
						userPrompt: generateCloudPatchMessageUserPrompt,
						customInstructions: configuration.get('ai.generateCloudPatchMessage.customInstructions'),
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
		return this.generateMessage(
			model,
			diff,
			reporting,
			{
				type: 'commit',
				systemPrompt: generateCommitMessageSystemPrompt,
				userPrompt: generateCommitMessageUserPrompt,
				customInstructions: configuration.get('ai.generateCommitMessage.customInstructions') ?? '',
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

		try {
			const [result, maxCodeCharacters] = await this.makeRequest(
				model,
				apiKey,
				explainChangesSystemPrompt,
				(max, retries) => {
					const code = diff.substring(0, max);
					const messages: Message[] = [
						{
							role: 'user',
							content: [
								{
									type: 'text',
									text: interpolate(explainChangesUserPrompt, {
										diff: code,
										message: message,
										instructions: configuration.get('ai.explainChanges.customInstructions') ?? '',
									}),
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

			if (diff.length > maxCodeCharacters) {
				showDiffTruncationWarning(maxCodeCharacters, model);
			}

			return result;
		} catch (ex) {
			throw new Error(`Unable to explain changes: ${ex.message}`);
		}
	}

	private async fetch(
		apiKey: string,
		request: AnthropicMessageRequest,
		cancellation: CancellationToken | undefined,
	): ReturnType<typeof fetch> {
		let aborter: AbortController | undefined;
		if (cancellation != null) {
			aborter = new AbortController();
			cancellation.onCancellationRequested(() => aborter?.abort());
		}

		try {
			return await fetch('https://api.anthropic.com/v1/messages', {
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
		model: AnthropicModel,
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

			const rsp = await this.fetch(apiKey, request, cancellation);
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
}

async function getApiKey(storage: Storage): Promise<string | undefined> {
	return getApiKeyCore(storage, {
		id: provider.id,
		name: provider.name,
		validator: v => /(?:sk-)?[a-zA-Z0-9-_]{32,}/.test(v),
		url: 'https://console.anthropic.com/account/keys',
	});
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
	model: AnthropicModel['id'];
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
