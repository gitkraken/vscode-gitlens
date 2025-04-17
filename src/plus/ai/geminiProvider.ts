import type { CancellationToken } from 'vscode';
import type { Response } from '@env/fetch';
import { geminiProviderDescriptor as provider } from '../../constants.ai';
import type { AIActionType, AIModel } from './models/model';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

type GeminiModel = AIModel<typeof provider.id>;
const models: GeminiModel[] = [
	{
		id: 'gemini-2.5-flash-preview-04-17',
		name: 'Gemini 2.5 Flash (Preview)',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
	},
	{
		id: 'gemini-2.5-pro-preview-03-25',
		name: 'Gemini 2.5 Pro (Preview)',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
	},
	{
		id: 'gemini-2.5-pro-exp-03-25',
		name: 'Gemini 2.5 Pro (Experimental)',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.0-flash',
		name: 'Gemini 2.0 Flash',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
		default: true,
	},
	{
		id: 'gemini-2.0-flash-001',
		name: 'Gemini 2.0 Flash',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.0-flash-lite',
		name: 'Gemini 2.0 Flash-Lite',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
	},
	{
		id: 'gemini-2.0-flash-lite-001',
		name: 'Gemini 2.0 Flash-Lite',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.0-flash-lite-preview-02-05',
		name: 'Gemini 2.0 Flash-Lite (Preview)',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.0-pro-exp-02-05',
		name: 'Gemini 2.0 Pro (Experimental)',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
	},
	{
		id: 'gemini-2.0-flash-thinking-exp-01-21',
		name: 'Gemini 2.0 Flash Thinking (Experimental)',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
	},
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
		hidden: true,
	},
	{
		id: 'gemini-exp-1121',
		name: 'Gemini Experimental 1121',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-1.5-pro',
		name: 'Gemini 1.5 Pro',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
	},
	{
		id: 'gemini-1.5-flash',
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
	protected readonly descriptor = provider;
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
		action: AIActionType,
		model: AIModel<typeof provider.id>,
		apiKey: string,
		request: object,
		cancellation: CancellationToken | undefined,
	): Promise<Response> {
		if ('max_completion_tokens' in request) {
			const { max_completion_tokens: max, ...rest } = request;
			request = max ? { max_tokens: max, ...rest } : rest;
		}
		return super.fetchCore(action, model, apiKey, request, cancellation);
	}
}
