import type { CancellationToken } from 'vscode';
import type { Response } from '@env/fetch.js';
import { anthropicProviderDescriptor as provider } from '../../constants.ai.js';
import { AIError, AIErrorReason } from '../../errors.js';
import type { AIActionType, AIModel } from './models/model.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';
import { getReducedMaxInputTokens } from './utils/-webview/ai.utils.js';

type AnthropicModel = AIModel<typeof provider.id>;
const models: AnthropicModel[] = [
	{
		id: 'claude-haiku-4-5',
		name: 'Claude Haiku 4.5',
		maxTokens: { input: 204800, output: 32000 },
		provider: provider,
		default: true,
	},
	{
		id: 'claude-haiku-4-5-20251001',
		name: 'Claude Haiku 4.5',
		maxTokens: { input: 204800, output: 32000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-sonnet-4-6',
		name: 'Claude Sonnet 4.6',
		maxTokens: { input: 204800, output: 64000 },
		provider: provider,
	},
	{
		id: 'claude-opus-4-6',
		name: 'Claude Opus 4.6',
		maxTokens: { input: 204800, output: 128000 },
		provider: provider,
	},
	{
		id: 'claude-sonnet-4-5',
		name: 'Claude Sonnet 4.5',
		maxTokens: { input: 204800, output: 64000 },
		provider: provider,
	},
	{
		id: 'claude-sonnet-4-5-20250929',
		name: 'Claude Sonnet 4.5',
		maxTokens: { input: 204800, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-opus-4-5',
		name: 'Claude Opus 4.5',
		maxTokens: { input: 204800, output: 32000 },
		provider: provider,
	},
	{
		id: 'claude-opus-4-5-20251101',
		name: 'Claude Opus 4.5',
		maxTokens: { input: 204800, output: 32000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-opus-4-1',
		name: 'Claude Opus 4.1',
		maxTokens: { input: 204800, output: 32000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-opus-4-1-20250805',
		name: 'Claude Opus 4.1',
		maxTokens: { input: 204800, output: 32000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-opus-4-0',
		name: 'Claude Opus 4',
		maxTokens: { input: 204800, output: 32000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-opus-4-20250514',
		name: 'Claude Opus 4',
		maxTokens: { input: 204800, output: 32000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-sonnet-4-0',
		name: 'Claude Sonnet 4',
		maxTokens: { input: 204800, output: 64000 },
		provider: provider,
	},
	{
		id: 'claude-sonnet-4-20250514',
		name: 'Claude Sonnet 4',
		maxTokens: { input: 204800, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-7-sonnet-latest',
		name: 'Claude Sonnet 3.7',
		maxTokens: { input: 204800, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-7-sonnet-20250219',
		name: 'Claude Sonnet 3.7',
		maxTokens: { input: 204800, output: 64000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-sonnet-latest',
		name: 'Claude Sonnet 3.5',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-sonnet-20241022',
		name: 'Claude Sonnet 3.5',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-sonnet-20240620',
		name: 'Claude Sonnet 3.5',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-haiku-latest',
		name: 'Claude Haiku 3.5',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-haiku-20241022',
		name: 'Claude Haiku 3.5',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-opus-latest',
		name: 'Claude Opus 3',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-opus-20240229',
		name: 'Claude Opus 3',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-sonnet-latest',
		name: 'Claude Sonnet 3',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-sonnet-20240229',
		name: 'Claude Sonnet 3',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-haiku-latest',
		name: 'Claude Haiku 3',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-haiku-20240307',
		name: 'Claude Haiku 3',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-2.1',
		name: 'Claude 2.1',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
];

export class AnthropicProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: 'https://console.anthropic.com/account/keys',
		keyValidator: /(?:sk-)?[a-zA-Z0-9-_]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://api.anthropic.com/v1/messages';
	}

	protected override getHeaders<TAction extends AIActionType>(
		_action: TAction,
		apiKey: string,
		_model: AIModel<typeof provider.id>,
		_url: string,
	): Record<string, string> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
		};
	}

	protected override fetchCore<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<typeof provider.id>,
		apiKey: string,
		request: object,
		cancellation: CancellationToken | undefined,
	): Promise<Response> {
		if ('max_completion_tokens' in request) {
			const { max_completion_tokens: max, ...rest } = request;
			request = max ? { max_tokens: max, ...rest } : rest;
		}
		return super.fetchCore(action, model, apiKey, request, cancellation);
	}

	protected override async handleFetchFailure<TAction extends AIActionType>(
		rsp: Response,
		action: TAction,
		model: AIModel<typeof provider.id>,
		retries: number,
		maxInputTokens: number,
	): Promise<{ retry: true; maxInputTokens: number }> {
		if (rsp.status !== 404 && rsp.status !== 429) {
			let json;
			try {
				json = (await rsp.json()) as AnthropicError | undefined;
			} catch {}

			debugger;

			if (json?.error?.type === 'invalid_request_error') {
				if (json?.error?.message?.includes('prompt is too long')) {
					if (retries < 3) {
						// Extract actual token count from error to calculate smarter reduction
						const match = /prompt is too long: (\d+) tokens/.exec(json?.error?.message);
						const estimatedTokens = match?.[1] != null ? parseInt(match[1], 10) : undefined;

						return {
							retry: true,
							maxInputTokens: getReducedMaxInputTokens(maxInputTokens, retries + 1, estimatedTokens),
						};
					}

					throw new AIError(
						AIErrorReason.RequestTooLarge,
						new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`),
					);
				}

				if (json?.error?.message?.includes('balance is too low')) {
					throw new AIError(
						AIErrorReason.RateLimitOrFundsExceeded,
						new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`),
					);
				}
			}
		}

		return super.handleFetchFailure(rsp, action, model, retries, maxInputTokens);
	}
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
