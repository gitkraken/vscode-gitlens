import { deepSeekProviderDescriptor as provider } from '../../constants.ai';
import type { AIModel } from './models/model';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase';

type DeepSeekModel = AIModel<typeof provider.id>;
const models: DeepSeekModel[] = [
	{
		id: 'deepseek-chat',
		name: 'DeepSeek-V3',
		maxTokens: { input: 65536, output: 8192 },
		provider: provider,
		default: true,
		temperature: 0.0, // Recommended for Coding/Math
	},
	{
		id: 'deepseek-reasoner',
		name: 'DeepSeek-R1',
		maxTokens: { input: 65536, output: 8192 },
		provider: provider,
		temperature: 0.0, // Recommended for Coding/Math
	},
];

export class DeepSeekProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: 'https://platform.deepseek.com/api_keys',
		keyValidator: /(?:sk-)?[a-zA-Z0-9]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://api.deepseek.com/v1/chat/completions';
	}
}
