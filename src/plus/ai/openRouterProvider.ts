import { fetch } from '@env/fetch';
import { openRouterProviderDescriptor as provider } from '../../constants.ai';
import type { AIActionType, AIModel } from './models/model';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

type OpenRouterModel = AIModel<typeof provider.id>;

export class OpenRouterProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: 'https://openrouter.ai/keys',
		keyValidator: /(?:sk-)?\w{24,128}/,
	};

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const apiKey = await this.getApiKey(true);
		if (!apiKey) return [];

		const url = 'https://openrouter.ai/api/v1/models';
		const rsp = await fetch(url, { headers: this.getHeadersCore(apiKey) });
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
			}[];
		};

		const results: ModelsResponse = await rsp.json();
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
				}) satisfies OpenRouterModel,
		);
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
