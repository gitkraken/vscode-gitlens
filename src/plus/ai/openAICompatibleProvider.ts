import type { CancellationToken } from 'vscode';
import type { Response } from '@env/fetch';
import { fetch } from '@env/fetch';
import type { Role } from '../../@types/vsls';
import type { AIProviders } from '../../constants.ai';
import type { Container } from '../../container';
import { AIError, AIErrorReason, CancellationError } from '../../errors';
import { getLoggableName, Logger } from '../../system/logger';
import { startLogScope } from '../../system/logger.scope';
import type { ServerConnection } from '../gk/serverConnection';
import type { AIActionType, AIModel, AIProviderDescriptor } from './models/model';
import type { AIChatMessage, AIChatMessageRole, AIProvider, AIRequestResult } from './models/provider';
import { getActionName, getOrPromptApiKey, getValidatedTemperature } from './utils/-webview/ai.utils';

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
	protected abstract readonly descriptor: AIProviderDescriptor<T>;
	protected abstract readonly config: { keyUrl?: string; keyValidator?: RegExp };

	async configured(silent: boolean): Promise<boolean> {
		return (await this.getApiKey(silent)) != null;
	}

	async getApiKey(silent: boolean): Promise<string | undefined> {
		const { keyUrl, keyValidator } = this.config;

		return getOrPromptApiKey(
			this.container,
			{
				id: this.id,
				name: this.name,
				requiresAccount: this.descriptor.requiresAccount,
				validator: keyValidator != null ? v => keyValidator.test(v) : () => true,
				url: keyUrl,
			},
			silent,
		);
	}

	abstract getModels(): Promise<readonly AIModel<T>[]>;

	protected abstract getUrl(_model: AIModel<T>): string;

	protected getHeaders<TAction extends AIActionType>(
		_action: TAction,
		apiKey: string,
		_model: AIModel<T>,
		_url: string,
	): Record<string, string> | Promise<Record<string, string>> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		};
	}

	async sendRequest<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<T>,
		apiKey: string,
		getMessages: (maxCodeCharacters: number, retries: number) => Promise<AIChatMessage[]>,
		options: { cancellation: CancellationToken; modelOptions?: { outputTokens?: number; temperature?: number } },
	): Promise<AIRequestResult | undefined> {
		using scope = startLogScope(`${getLoggableName(this)}.sendRequest`, false);

		try {
			const result = await this.fetch(
				action,
				model,
				apiKey,
				getMessages,
				options.modelOptions,
				options.cancellation,
			);
			return result;
		} catch (ex) {
			if (ex instanceof CancellationError) {
				Logger.error(ex, scope, `Cancelled request to ${getActionName(action)}: (${model.provider.name})`);
				throw ex;
			}

			Logger.error(ex, scope, `Unable to ${getActionName(action)}: (${model.provider.name})`);
			if (ex instanceof AIError) throw ex;

			debugger;
			throw new Error(`Unable to ${getActionName(action)}: (${model.provider.name}) ${ex.message}`);
		}
	}

	protected async fetch<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<T>,
		apiKey: string,
		messages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage[]>,
		modelOptions?: { outputTokens?: number; temperature?: number },
		cancellation?: CancellationToken,
	): Promise<AIRequestResult> {
		let retries = 0;
		let maxInputTokens = model.maxTokens.input;

		while (true) {
			const request: ChatCompletionRequest = {
				model: model.id,
				messages: await messages(maxInputTokens, retries),
				stream: false,
				max_completion_tokens: model.maxTokens.output
					? Math.min(modelOptions?.outputTokens ?? Infinity, model.maxTokens.output)
					: modelOptions?.outputTokens,
				temperature: getValidatedTemperature(modelOptions?.temperature ?? model.temperature),
			};

			const rsp = await this.fetchCore(action, model, apiKey, request, cancellation);
			if (!rsp.ok) {
				const result = await this.handleFetchFailure(rsp, action, model, retries, maxInputTokens);
				if (result.retry) {
					maxInputTokens = result.maxInputTokens;
					retries++;
					continue;
				}
			}

			const data: ChatCompletionResponse = await rsp.json();
			const result: AIRequestResult = {
				id: data.id,
				content: data.choices?.[0].message.content?.trim() ?? data.content?.[0]?.text?.trim() ?? '',
				model: model,
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
			return result;
		}
	}

	protected async handleFetchFailure<TAction extends AIActionType>(
		rsp: Response,
		_action: TAction,
		model: AIModel<T>,
		retries: number,
		maxInputTokens: number,
	): Promise<{ retry: true; maxInputTokens: number }> {
		if (rsp.status === 404) {
			throw new AIError(
				AIErrorReason.Unauthorized,
				new Error(`Your API key doesn't seem to have access to the selected '${model.id}' model`),
			);
		}
		if (rsp.status === 429) {
			throw new AIError(
				AIErrorReason.RateLimitOrFundsExceeded,
				new Error(
					`(${this.name}) ${rsp.status}: Too many requests (rate limit exceeded) or your account is out of funds`,
				),
			);
		}

		let json;
		try {
			json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
		} catch {}

		if (json?.error?.code === 'context_length_exceeded') {
			if (retries < 2) {
				return { retry: true, maxInputTokens: maxInputTokens - 200 * (retries || 1) };
			}

			throw new AIError(
				AIErrorReason.RequestTooLarge,
				new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`),
			);
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
				headers: await this.getHeaders(action, apiKey, model, url),
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

interface ChatCompletionRequest {
	model: string;
	messages: AIChatMessage<AIChatMessageRole>[];

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
