import type { AIModel } from './aiProviderService';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

const provider = { id: 'xai', name: 'xAI' } as const;

type xAIModel = AIModel<typeof provider.id>;
const models: xAIModel[] = [
	{
		id: 'grok-beta',
		name: 'Grok Beta',
		maxTokens: { input: 131072, output: 4096 },
		provider: provider,
		default: true,
	},
];

export class xAIProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {
		keyUrl: 'https://console.x.ai/',
		keyValidator: /(?:xai-)?[a-zA-Z0-9]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://api.x.ai/v1/chat/completions';
	}
}
