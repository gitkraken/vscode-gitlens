import type { CancellationToken } from 'vscode';
import type { AIModel } from './aiProviderService';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

const provider = { id: 'gemini', name: 'Google' } as const;

type GeminiModel = AIModel<typeof provider.id>;
const models: GeminiModel[] = [
	{
		id: 'gemini-2.0-flash-exp',
		name: 'Gemini 2.0 Flash (Experimental)',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
	},
	{
		id: 'gemini-exp-1206',
		name: 'Gemini Experimental 1206',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
	},
	{
		id: 'gemini-exp-1121',
		name: 'Gemini Experimental 1121',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
	},
	{
		id: 'gemini-1.5-pro-latest',
		name: 'Gemini 1.5 Pro',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
		default: true,
	},
	{
		id: 'gemini-1.5-flash-latest',
		name: 'Gemini 1.5 Flash',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
	},
	{
		id: 'gemini-1.5-flash-8b',
		name: 'Gemini 1.5 Flash 8B',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
	},
];

export class GeminiProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {
		keyUrl: 'https://aistudio.google.com/app/apikey',
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return `https://generativelanguage.googleapis.com/v1beta/chat/completions`;
	}

	protected override fetchCore(
		model: AIModel<typeof provider.id>,
		apiKey: string,
		request: object,
		cancellation: CancellationToken | undefined,
	) {
		if ('max_tokens' in request) {
			const { max_tokens: _, ...rest } = request;
			request = rest;
		}
		return super.fetchCore(model, apiKey, request, cancellation);
	}
}
