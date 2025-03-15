import type { CancellationToken } from 'vscode';
import type { Response } from '@env/fetch';
import { fetch } from '@env/fetch';
import type { AIProviders } from '../../constants.ai';
import type { TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import { sum } from '../../system/iterable';
import { getLoggableName, Logger } from '../../system/logger';
import { startLogScope } from '../../system/logger.scope';
import type { ServerConnection } from '../gk/serverConnection';
import type { AIActionType, AIModel } from './models/model';
import type { PromptTemplate, PromptTemplateContext } from './models/promptTemplates';
import type { AIProvider, AIRequestResult } from './models/provider';
import {
	getMaxCharacters,
	getOrPromptApiKey,
	getValidatedTemperature,
	showDiffTruncationWarning,
} from './utils/-webview/ai.utils';
import { getLocalPromptTemplate, resolvePrompt } from './utils/-webview/prompt.utils';

export interface AIProviderConfig {
	url: string;
	keyUrl: string;
	keyValidator?: RegExp;
}

export abstract class OpenAICompatibleProvider<T extends AIProviders> implements AIProvider<T> {
	constructor(
		protected readonly container: Container,
		protected readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	abstract readonly id: T;
	abstract readonly name: string;
	protected abstract readonly config: { keyUrl?: string; keyValidator?: RegExp };

	abstract getModels(): Promise<readonly AIModel<T>[]>;
	async getPromptTemplate<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<T>,
	): Promise<PromptTemplate | undefined> {
		return Promise.resolve(getLocalPromptTemplate(action, model));
	}

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

	protected getHeaders<TAction extends AIActionType>(
		_action: TAction,
		_model: AIModel<T>,
		_url: string,
		apiKey: string,
	): Record<string, string> | Promise<Record<string, string>> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		};
	}

	async sendRequest<TAction extends AIActionType>(
		action: TAction,
		context: PromptTemplateContext<TAction>,
		model: AIModel<T>,
		reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
		options?: { cancellation?: CancellationToken; outputTokens?: number },
	): Promise<AIRequestResult | undefined> {
		using scope = startLogScope(`${getLoggableName(this)}.sendRequest`, false);

		const apiKey = await this.getApiKey();
		if (apiKey == null) return undefined;

		const prompt = await this.getPromptTemplate(action, model);
		if (prompt == null) {
			debugger;
			Logger.error(undefined, scope, `Unable to find prompt template for '${action}'`);
			return undefined;
		}

		try {
			let truncated = false;
			const [result, maxCodeCharacters] = await this.fetch(
				action,
				model,
				apiKey,
				(max, retries): ChatMessage[] => {
					let content;
					({ content, truncated } = resolvePrompt(action, prompt, context, max));
					const messages: ChatMessage[] = [{ role: 'user', content: content }];

					reporting['retry.count'] = retries;
					reporting['input.length'] = (reporting['input.length'] ?? 0) + sum(messages, m => m.content.length);

					return messages;
				},
				options?.outputTokens ?? 4096,
				options?.cancellation,
			);

			if (truncated) {
				showDiffTruncationWarning(maxCodeCharacters, model);
			}

			return result;
		} catch (ex) {
			Logger.error(ex, scope, `Unable to ${prompt.name}: (${model.provider.name})`);
			throw new Error(`Unable to ${prompt.name}: (${model.provider.name}) ${ex.message}`);
		}
	}

	protected async fetch<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<T>,
		apiKey: string,
		messages: (maxCodeCharacters: number, retries: number) => ChatMessage[],
		outputTokens: number,
		cancellation: CancellationToken | undefined,
	): Promise<[result: AIRequestResult, maxCodeCharacters: number]> {
		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);

		while (true) {
			const request: ChatCompletionRequest = {
				model: model.id,
				messages: messages(maxCodeCharacters, retries),
				stream: false,
				max_completion_tokens: Math.min(outputTokens, model.maxTokens.output),
				temperature: getValidatedTemperature(model.temperature),
			};

			const rsp = await this.fetchCore(action, model, apiKey, request, cancellation);
			if (!rsp.ok) {
				const result = await this.handleFetchFailure(rsp, action, model, retries, maxCodeCharacters);
				if (result.retry) {
					maxCodeCharacters = result.maxCodeCharacters;
					retries++;
					continue;
				}
			}

			const data: ChatCompletionResponse = await rsp.json();
			const result: AIRequestResult = {
				id: data.id,
				content: data.choices?.[0].message.content?.trim() ?? data.content?.[0]?.text?.trim() ?? '',
				usage: {
					promptTokens: data.usage?.prompt_tokens ?? data.usage?.input_tokens,
					completionTokens: data.usage?.completion_tokens ?? data.usage?.output_tokens,
					totalTokens: data.usage?.total_tokens,
					limits:
						data?.usage?.gk != null
							? {
									used: data.usage.gk.used,
									limit: data.usage.gk.limit,
									resetsOn: new Date(data.usage.gk.resets_on),
							  }
							: undefined,
				},
			};
			return [result, maxCodeCharacters];
		}
	}

	protected async handleFetchFailure<TAction extends AIActionType>(
		rsp: Response,
		_action: TAction,
		model: AIModel<T>,
		retries: number,
		maxCodeCharacters: number,
	): Promise<{ retry: boolean; maxCodeCharacters: number }> {
		if (rsp.status === 404) {
			throw new Error(`Your API key doesn't seem to have access to the selected '${model.id}' model`);
		}
		if (rsp.status === 429) {
			throw new Error(
				`(${this.name}) ${rsp.status}: Too many requests (rate limit exceeded) or your account is out of funds`,
			);
		}

		let json;
		try {
			json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
		} catch {}

		if (retries < 2 && json?.error?.code === 'context_length_exceeded') {
			return { retry: true, maxCodeCharacters: maxCodeCharacters - 500 };
		}

		throw new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`);
	}

	protected async fetchCore<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<T>,
		apiKey: string,
		request: object,
		cancellation: CancellationToken | undefined,
	): Promise<Response> {
		let aborter: AbortController | undefined;
		if (cancellation != null) {
			aborter = new AbortController();
			cancellation.onCancellationRequested(() => aborter?.abort());
		}

		const url = this.getUrl(model);
		try {
			return await fetch(url, {
				headers: await this.getHeaders(action, model, url, apiKey),
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

	/** @deprecated but used by Anthropic & Gemini */
	max_tokens?: number;
	/** Currently can't be used for Anthropic & Gemini */
	max_completion_tokens?: number;
	metadata?: Record<string, string>;
	stream?: boolean;
	temperature?: number;
	top_p?: number;

	/** Not supported by many models/providers */
	reasoning_effort?: 'low' | 'medium' | 'high';
}

interface ChatCompletionResponse {
	id: string;
	model: string;
	/** OpenAI compatible output */
	choices?: {
		index: number;
		message: {
			role: Role;
			content: string | null;
			refusal: string | null;
		};
		finish_reason: string;
	}[];
	/** Anthropic output */
	content?: { type: 'text'; text: string }[];
	usage: {
		/** OpenAI compatible */
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;

		/** Anthropic */
		input_tokens?: number;
		output_tokens?: number;

		/** GitKraken */
		gk: {
			used: number;
			limit: number;
			resets_on: string;
		};
	};
}
