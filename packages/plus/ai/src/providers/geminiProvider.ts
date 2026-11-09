import { geminiProviderDescriptor as provider } from '../constants.js';
import type { AIActionType, AIModel } from '../models/model.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type GeminiModel = AIModel<typeof provider.id>;
const models: GeminiModel[] = [
	{
		id: 'gemini-4-argon',
		name: 'Gemini 4 Argon',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.8-flash',
		name: 'Gemini 3.8 Flash',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.7-flash',
		name: 'Gemini 3.7 Flash',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.6-flash',
		name: 'Gemini 3.6 Flash',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.5-flash',
		name: 'Gemini 3.5 Flash',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.5-flash-lite',
		name: 'Gemini 3.5 Flash-Lite',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.1-pro-preview',
		name: 'Gemini 3.1 Pro Preview',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.1-flash-lite',
		name: 'Gemini 3.1 Flash-Lite',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3-flash-preview',
		name: 'Gemini 3 Flash Preview',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		// Default stays on this preview: the 3.6/3.8 Flash models cost ~1.4x per request (~2.9x from 2027-01-01)
		default: true,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-2.5-pro',
		name: 'Gemini 2.5 Pro',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.5-flash',
		name: 'Gemini 2.5 Flash',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.5-flash-lite',
		name: 'Gemini 2.5 Flash-Lite',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
	},
];

export class GeminiProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	readonly supportsTools = true;
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
		signal: AbortSignal | undefined,
	): Promise<Response> {
		if ('max_completion_tokens' in request) {
			const { max_completion_tokens: max, ...rest } = request;
			request = max ? { max_tokens: max, ...rest } : rest;
		}
		return super.fetchCore(action, model, apiKey, request, signal);
	}
}
