import { fetch } from '@env/fetch';
import type { AIModel } from './aiProviderService';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

const provider = { id: 'huggingface', name: 'Hugging Face' } as const;

type HuggingFaceModel = AIModel<typeof provider.id>;

export class HuggingFaceProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {
		keyUrl: 'https://huggingface.co/settings/tokens',
		keyValidator: /(?:hf_)?[a-zA-Z0-9]{32,}/,
	};

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const query = new URLSearchParams({
			filter: 'text-generation,conversational',
			inference: 'warm',
			sort: 'trendingScore',
			limit: '30',
		});
		const rsp = await fetch(`https://huggingface.co/api/models?${query.toString()}`, {
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			method: 'GET',
		});

		interface ModelsResponseResult {
			id: string;
		}

		type ModelsResponse = ModelsResponseResult[];

		const results: ModelsResponse = await rsp.json();

		const models = results.map(
			r =>
				({
					id: r.id,
					name: r.id.split('/').pop()!,
					maxTokens: { input: 4096, output: 4096 },
					provider: provider,
					temperature: null,
				}) satisfies HuggingFaceModel,
		);

		return models;
	}

	protected getUrl(model: AIModel<typeof provider.id>): string {
		return `https://api-inference.huggingface.co/models/${model.id}/v1/chat/completions`;
	}
}
