import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { openRouterProviderDescriptor as provider } from '../constants.js';
import type { AIActionType, AIModel } from '../models/model.js';
import type { AIResponseFormat } from '../models/provider.js';
import type { ChatCompletionRequest } from './openAICompatibleProviderBase.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type OpenRouterModel = AIModel<typeof provider.id>;

export class OpenRouterProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	readonly supportsTools = true;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: 'https://openrouter.ai/keys',
		keyValidator: /(?:sk-)?\w{24,128}/,
	};

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		let apiKey: string | undefined;
		try {
			apiKey = await this.getApiKey(true);
		} catch (ex) {
			if (isCancellationError(ex)) return [];

			throw ex;
		}

		if (!apiKey) return [];

		const url = 'https://openrouter.ai/api/v1/models';
		const rsp = await this.context.fetch(url, { headers: this.getHeadersCore(apiKey) });
		if (!rsp.ok) {
			throw new Error(`Getting models (${url}) failed: ${rsp.status} (${rsp.statusText})`);
		}

		type ModelsResponse = {
			data: {
				id: string;
				name: string;
				context_length: number;
				top_provider: {
					max_completion_tokens?: number;
				};
				supported_parameters?: string[];
			}[];
		};

		const results = (await rsp.json()) as ModelsResponse;
		return results.data.map<OpenRouterModel>(
			m =>
				({
					id: m.id,
					name: m.name,
					maxTokens: {
						input: m.context_length,
						output: m.top_provider?.max_completion_tokens ?? Math.floor(m.context_length / 2),
					},
					provider: provider,
					temperature: null,
					// OpenRouter hard-errors when `response_format` reaches a model that doesn't advertise support
					supportsStructuredOutputs: m.supported_parameters?.includes('structured_outputs') ?? false,
				}) satisfies OpenRouterModel,
		);
	}

	protected override applyResponseFormat(
		request: ChatCompletionRequest,
		model: AIModel<typeof provider.id>,
		responseFormat: AIResponseFormat,
	): void {
		super.applyResponseFormat(request, model, responseFormat);
		// `supported_parameters` is a union across the providers serving a model — restrict routing
		// to providers that actually support every parameter sent
		request.provider = { require_parameters: true };
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://openrouter.ai/api/v1/chat/completions';
	}

	protected override getHeaders<TAction extends AIActionType>(
		_action: TAction,
		apiKey: string,
		_model: AIModel<typeof provider.id>,
		_url: string,
	): Record<string, string> {
		return this.getHeadersCore(apiKey);
	}

	private getHeadersCore(apiKey: string): Record<string, string> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://gitkraken.com/',
			'X-Title': 'GitKraken',
			Authorization: `Bearer ${apiKey}`,
		};
	}
}
