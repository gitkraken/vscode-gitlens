import { xAIProviderDescriptor as provider } from '../constants.js';
import type { AIModel } from '../models/model.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type XAIModel = AIModel<typeof provider.id>;
const models: XAIModel[] = [
	{
		id: 'grok-4.7',
		name: 'Grok 4.7',
		maxTokens: { input: 500000, output: 65536 },
		provider: provider,
	},
	{
		id: 'grok-4.6',
		name: 'Grok 4.6',
		maxTokens: { input: 500000, output: 65536 }, // xAI publishes no output cap; mirrors Grok 4.5 to bound cost
		provider: provider,
	},
	{
		id: 'grok-4.5',
		name: 'Grok 4.5',
		maxTokens: { input: 500000, output: 65536 },
		provider: provider,
	},
	{
		id: 'grok-4.3',
		name: 'Grok 4.3',
		maxTokens: { input: 1000000, output: 65536 },
		provider: provider,
		default: true,
	},
];

export class XAIProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	readonly supportsTools = true;
	protected readonly descriptor = provider;
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
