import type { AIModel } from './aiProviderService';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

const provider = { id: 'huggingface', name: 'Hugging Face' } as const;

type HuggingFaceModel = AIModel<typeof provider.id>;
const models: HuggingFaceModel[] = [
	{
		id: 'meta-llama/Llama-3.2-11B-Vision-Instruct',
		name: 'Meta Llama 3.2 11B Vision',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
	{
		id: 'Qwen/Qwen2.5-72B-Instruct',
		name: 'Qwen 2.5 72B',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
	{
		id: 'NousResearch/Hermes-3-Llama-3.1-8B',
		name: 'Nous Research Hermes 3',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
	{
		id: 'mistralai/Mistral-Nemo-Instruct-2407',
		name: 'Mistral Nemo',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
	},
];

export class HuggingFaceProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {
		keyUrl: 'https://huggingface.co/settings/tokens',
		keyValidator: /(?:hf_)?[a-zA-Z0-9]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(model: AIModel<typeof provider.id>): string {
		return `https://api-inference.huggingface.co/models/${model.id}/v1/chat/completions`;
	}
}
