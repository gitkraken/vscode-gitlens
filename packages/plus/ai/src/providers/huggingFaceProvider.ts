import { huggingFaceProviderDescriptor as provider } from '../constants.js';
import type { AIModel } from '../models/model.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type HuggingFaceModel = AIModel<typeof provider.id>;

export class HuggingFaceProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: 'https://huggingface.co/settings/tokens',
		keyValidator: /(?:hf_)?[a-zA-Z0-9]{32,}/,
	};

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		// Hugging Face Inference Providers OpenAI-compatible model list (router replaced the retired serverless API)
		const url = 'https://router.huggingface.co/v1/models';
		const rsp = await this.context.fetch(url, {
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			method: 'GET',
		});
		if (!rsp.ok) {
			throw new Error(`Getting models (${url}) failed: ${rsp.status} (${rsp.statusText})`);
		}

		type ModelsResponse = {
			data: {
				id: string;
				architecture?: { output_modalities?: string[] };
				providers?: { status?: string; context_length?: number }[];
			}[];
		};

		const result = (await rsp.json()) as ModelsResponse;
		return result.data
			.filter(
				m => m.architecture?.output_modalities?.includes('text') && m.providers?.some(p => p.status === 'live'),
			)
			.map<HuggingFaceModel>(m => {
				const contextLength = m.providers?.find(p => p.status === 'live')?.context_length;
				return {
					id: m.id,
					name: m.id,
					maxTokens: { input: contextLength || 8192, output: 4096 },
					provider: provider,
					temperature: null,
				} satisfies HuggingFaceModel;
			});
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://router.huggingface.co/v1/chat/completions';
	}
}
