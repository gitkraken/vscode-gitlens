import { fetch } from '@env/fetch';
import type { CancellationToken } from 'vscode';
import type { AIProviders } from '../constants.ai';
import type { TelemetryEvents } from '../constants.telemetry';
import type { Container } from '../container';
import { CancellationError } from '../errors';
import { sum } from '../system/iterable';
import { interpolate } from '../system/string';
import { configuration } from '../system/vscode/configuration';
import type { AIModel, AIProvider } from './aiProviderService';
import { getMaxCharacters, getOrPromptApiKey, showDiffTruncationWarning } from './aiProviderService';
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

export interface AIProviderConfig {
	url: string;
	keyUrl: string;
	keyValidator?: RegExp;
}

export abstract class OpenAICompatibleProvider<T extends AIProviders> implements AIProvider<T> {
	constructor(protected readonly container: Container) {}

	dispose() {}

	abstract readonly id: T;
	abstract readonly name: string;
	protected abstract readonly config: { keyUrl: string; keyValidator?: RegExp };

	abstract getModels(): Promise<readonly AIModel<T>[]>;
	protected abstract getUrl(_model: AIModel<T>): string;

	protected async getApiKey(): Promise<string | undefined> {
		const { keyUrl, keyValidator } = this.config;

		return getOrPromptApiKey(this.container.storage, {
			id: this.id,
			name: this.name,
			validator: keyValidator != null ? v => keyValidator.test(v) : () => true,
			url: keyUrl,
		});
	}

	protected getHeaders(_model: AIModel<T>, _url: string, apiKey: string): Record<string, string> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		};
	}

	async generateMessage(
		model: AIModel<T>,
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
		const apiKey = await this.getApiKey();
		if (apiKey == null) return undefined;

		try {
			const [result, maxCodeCharacters] = await this.fetch(
				model,
				apiKey,
				(max, retries): [SystemMessage, ...ChatMessage[]] => {
					const system: SystemMessage = {
						role: 'system',
						content: promptConfig.systemPrompt,
					};
					const messages: ChatMessage[] = [
						{
							role: 'user',
							content: interpolate(promptConfig.userPrompt, {
								diff: diff.substring(0, max),
								context: options?.context ?? '',
								instructions: promptConfig.customInstructions ?? '',
							}),
						},
					];

					reporting['retry.count'] = retries;
					reporting['input.length'] =
						(reporting['input.length'] ?? 0) + sum([system, ...messages], m => m.content.length);

					return [system, ...messages];
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
		model: AIModel<T>,
		diff: string,
		reporting: TelemetryEvents['ai/generate'],
		options?: {
			cancellation?: CancellationToken;
			context?: string;
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
		model: AIModel<T>,
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
				customInstructions: configuration.get('ai.generateCommitMessage.customInstructions'),
			},
			options,
		);
	}

	async explainChanges(
		model: AIModel<T>,
		message: string,
		diff: string,
		reporting: TelemetryEvents['ai/explain'],
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined> {
		const apiKey = await this.getApiKey();
		if (apiKey == null) return undefined;

		try {
			const [result, maxCodeCharacters] = await this.fetch(
				model,
				apiKey,
				(max, retries): [SystemMessage, ...ChatMessage[]] => {
					const system: SystemMessage = {
						role: 'system',
						content: explainChangesSystemPrompt,
					};
					const messages: ChatMessage[] = [
						{
							role: 'user',
							content: interpolate(explainChangesUserPrompt, {
								diff: diff.substring(0, max),
								message: message,
								instructions: configuration.get('ai.explainChanges.customInstructions') ?? '',
							}),
						},
					];

					reporting['retry.count'] = retries;
					reporting['input.length'] =
						(reporting['input.length'] ?? 0) + sum([system, ...messages], m => m.content.length);

					return [system, ...messages];
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

	protected async fetch(
		model: AIModel<T>,
		apiKey: string,
		messages: (maxCodeCharacters: number, retries: number) => [SystemMessage, ...ChatMessage[]],
		outputTokens: number,
		cancellation: CancellationToken | undefined,
	): Promise<[result: string, maxCodeCharacters: number]> {
		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);

		while (true) {
			const request: ChatCompletionRequest = {
				model: model.id,
				messages: messages(maxCodeCharacters, retries),
				stream: false,
				max_tokens: Math.min(outputTokens, model.maxTokens.output),
			};

			const rsp = await this.fetchCore(model, apiKey, request, cancellation);
			if (!rsp.ok) {
				if (rsp.status === 404) {
					throw new Error(`Your API key doesn't seem to have access to the selected '${model.id}' model`);
				}
				if (rsp.status === 429) {
					throw new Error(
						`(${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
					);
				}

				let json;
				try {
					json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				} catch {}

				debugger;

				if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(`(${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText}`);
			}

			const data: ChatCompletionResponse = await rsp.json();
			const result = data.choices[0].message.content?.trim() ?? '';
			return [result, maxCodeCharacters];
		}
	}

	protected async fetchCore(
		model: AIModel<T>,
		apiKey: string,
		request: object,
		cancellation: CancellationToken | undefined,
	) {
		let aborter: AbortController | undefined;
		if (cancellation != null) {
			aborter = new AbortController();
			cancellation.onCancellationRequested(() => aborter?.abort());
		}

		const url = this.getUrl(model);
		try {
			return await fetch(url, {
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					...this.getHeaders(model, url, apiKey),
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

type Role = 'assistant' | 'system' | 'user';

export type SystemMessage = ChatMessage<'system'>;
export interface ChatMessage<T extends Role = 'assistant' | 'user'> {
	role: T;
	content: string;
}

interface ChatCompletionRequest {
	model: string;
	messages: ChatMessage<Role>[];

	frequency_penalty?: number;
	logit_bias?: Record<string, number>;
	max_tokens?: number;
	n?: number;
	presence_penalty?: number;
	stop?: string | string[];
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	user?: string;
}

interface ChatCompletionResponse {
	id: string;
	object: 'chat.completion';
	created: number;
	model: string;
	choices: {
		index: number;
		message: {
			role: Role;
			content: string | null;
			refusal: string | null;
		};
		finish_reason: string;
	}[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}
