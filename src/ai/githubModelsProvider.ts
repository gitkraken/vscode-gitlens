import type { AIModel } from './aiProviderService';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

const provider = { id: 'github', name: 'GitHub Models' } as const;

type GitHubModelsModel = AIModel<typeof provider.id>;
const models: GitHubModelsModel[] = [
	{
		id: 'o1-preview',
		name: 'o1 preview',
		maxTokens: { input: 128000, output: 32768 },
		provider: provider,
	},
	{
		id: 'o1-mini',
		name: 'o1 mini',
		maxTokens: { input: 128000, output: 65536 },
		provider: provider,
	},
	{
		id: 'gpt-4o',
		name: 'GPT-4o',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
	},
	{
		id: 'gpt-4o-mini',
		name: 'GPT-4o mini',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
	},
	{
		id: 'Phi-3.5-MoE-instruct',
		name: 'Phi 3.5 MoE',
		maxTokens: { input: 134144, output: 4096 },
		provider: provider,
	},
	{
		id: 'Phi-3.5-mini-instruct',
		name: 'Phi 3.5 mini',
		maxTokens: { input: 134144, output: 4096 },
		provider: provider,
	},
	{
		id: 'AI21-Jamba-1.5-Large',
		name: 'Jamba 1.5 Large',
		maxTokens: { input: 268288, output: 4096 },
		provider: provider,
	},
	{
		id: 'AI21-Jamba-1.5-Mini',
		name: 'Jamba 1.5 Mini',
		maxTokens: { input: 268288, output: 4096 },
		provider: provider,
	},
];

export class GitHubModelsProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {
		keyUrl: 'https://github.com/settings/tokens',
		keyValidator: /(?:ghp-)?[a-zA-Z0-9]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://models.inference.ai.azure.com/chat/completions';
	}
}
