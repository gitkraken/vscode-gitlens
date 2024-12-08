import { configuration } from '../system/vscode/configuration';
import type { AIModel } from './aiProviderService';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

const provider = { id: 'openai', name: 'OpenAI' } as const;

type OpenAIModel = AIModel<typeof provider.id>;
const models: OpenAIModel[] = [
	{
		id: 'o1-preview',
		name: 'o1 preview',
		maxTokens: { input: 128000, output: 32768 },
		provider: provider,
	},
	{
		id: 'o1-preview-2024-09-12',
		name: 'o1 preview',
		maxTokens: { input: 128000, output: 32768 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'o1-mini',
		name: 'o1 mini',
		maxTokens: { input: 128000, output: 65536 },
		provider: provider,
	},
	{
		id: 'o1-mini-2024-09-12',
		name: 'o1 mini',
		maxTokens: { input: 128000, output: 65536 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4o',
		name: 'GPT-4o',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		default: true,
	},
	{
		id: 'gpt-4o-2024-08-06',
		name: 'GPT-4o',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4o-2024-05-13',
		name: 'GPT-4o',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'chatgpt-4o-latest',
		name: 'GPT-4o',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4o-mini',
		name: 'GPT-4o mini',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
	},
	{
		id: 'gpt-4o-mini-2024-07-18',
		name: 'GPT-4o mini',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-turbo',
		name: 'GPT-4 Turbo',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
	},
	{
		id: 'gpt-4-turbo-2024-04-09',
		name: 'GPT-4 Turbo preview (2024-04-09)',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-turbo-preview',
		name: 'GPT-4 Turbo preview',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
	},
	{
		id: 'gpt-4-0125-preview',
		name: 'GPT-4 0125 preview',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-1106-preview',
		name: 'GPT-4 1106 preview',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4',
		name: 'GPT-4',
		maxTokens: { input: 8192, output: 4096 },
		provider: provider,
	},
	{
		id: 'gpt-4-0613',
		name: 'GPT-4 0613',
		maxTokens: { input: 8192, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-32k',
		name: 'GPT-4 32k',
		maxTokens: { input: 32768, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-32k-0613',
		name: 'GPT-4 32k 0613',
		maxTokens: { input: 32768, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-3.5-turbo',
		name: 'GPT-3.5 Turbo',
		maxTokens: { input: 16385, output: 4096 },
		provider: provider,
	},
	{
		id: 'gpt-3.5-turbo-0125',
		name: 'GPT-3.5 Turbo 0125',
		maxTokens: { input: 16385, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-3.5-turbo-1106',
		name: 'GPT-3.5 Turbo 1106',
		maxTokens: { input: 16385, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-3.5-turbo-16k',
		name: 'GPT-3.5 Turbo 16k',
		maxTokens: { input: 16385, output: 4096 },
		provider: provider,
		hidden: true,
	},
];

export class OpenAIProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {
		keyUrl: 'https://platform.openai.com/account/api-keys',
		keyValidator: /(?:sk-)?[a-zA-Z0-9]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return configuration.get('ai.openai.url') || 'https://api.openai.com/v1/chat/completions';
	}

	protected override getHeaders(
		model: AIModel<typeof provider.id>,
		url: string,
		apiKey: string,
	): Record<string, string> {
		if (url.includes('.azure.com')) {
			return {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'api-key': apiKey,
			};
		}

		return super.getHeaders(model, url, apiKey);
	}
}
