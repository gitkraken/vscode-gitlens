import type { CancellationToken } from 'vscode';
import type { Response } from '@env/fetch';
import { anthropicProviderDescriptor as provider } from '../../constants.ai';
import { AIError, AIErrorReason } from '../../errors';
import type { AIActionType, AIModel } from './models/model';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

type AnthropicModel = AIModel<typeof provider.id>;
const models: AnthropicModel[] = [
	{
		id: 'claude-3-7-sonnet-latest',
		name: 'Claude 3.7 Sonnet',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
	},
	{
		id: 'claude-3-7-sonnet-20250219',
		name: 'Claude 3.7 Sonnet',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-sonnet-latest',
		name: 'Claude 3.5 Sonnet',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
	},
	{
		id: 'claude-3-5-sonnet-20241022',
		name: 'Claude 3.5 Sonnet',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-sonnet-20240620',
		name: 'Claude 3.5 Sonnet',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-5-haiku-latest',
		name: 'Claude 3.5 Haiku',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		default: true,
	},
	{
		id: 'claude-3-5-haiku-20241022',
		name: 'Claude 3.5 Haiku',
		maxTokens: { input: 204800, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-opus-latest',
		name: 'Claude 3 Opus',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
	},
	{
		id: 'claude-3-opus-20240229',
		name: 'Claude 3 Opus',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-sonnet-latest',
		name: 'Claude 3 Sonnet',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-sonnet-20240229',
		name: 'Claude 3 Sonnet',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'claude-3-haiku-latest',
		name: 'Claude 3 Haiku',
		maxTokens: { input: 204800, output: 4096 },
		provider: provider,
	},
	{
		id: 'claude-3-haiku-20240307',
		name: 'Claude 3 Haiku',
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

export class AnthropicProvider extends OpenAICompatibleProvider<typeof provider.id> {
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

			if (json?.error?.type === 'invalid_request_error' && json?.error?.message?.includes('prompt is too long')) {
				if (retries < 2) {
					return { retry: true, maxInputTokens: maxInputTokens - 200 * (retries || 1) };
				}

				throw new AIError(
					AIErrorReason.RequestTooLarge,
					new Error(`(${this.name}) ${rsp.status}: ${json?.error?.message || rsp.statusText}`),
				);
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
