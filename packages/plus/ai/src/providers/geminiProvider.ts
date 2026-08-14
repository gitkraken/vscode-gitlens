import { geminiProviderDescriptor as provider } from '../constants.js';
import type { AIActionType, AIModel } from '../models/model.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

type GeminiModel = AIModel<typeof provider.id>;
const models: GeminiModel[] = [
	{
		id: 'gemini-3.7-flash',
		name: 'Gemini 3.7 Flash',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.6-flash',
		name: 'Gemini 3.6 Flash',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		temperature: null, // Gemini 3.x reasoning is tuned for its default temperature; don't override
	},
	{
		id: 'gemini-3.5-flash',
		name: 'Gemini 3.5 Flash',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
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
	},
	{
		id: 'gemini-2.5-flash-lite',
		name: 'Gemini 2.5 Flash-Lite',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
	},
	{
		id: 'gemini-2.5-flash-preview-05-20',
		name: 'Gemini 2.5 Flash (Preview)',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.5-flash-preview-04-17',
		name: 'Gemini 2.5 Flash (Preview)',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.5-pro-preview-06-05',
		name: 'Gemini 2.5 Pro (Preview)',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gemini-2.5-pro-preview-03-25',
		name: 'Gemini 2.5 Pro (Preview)',
		maxTokens: { input: 1048576, output: 65536 },
		provider: provider,
		hidden: true,
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
		hidden: true,
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
		hidden: true,
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
		hidden: true,
		// The OpenAI-compat endpoint's `response_format: json_schema` postdates these frozen
		// pre-GA snapshots and the 1.5 generation (this and every entry below); GA 2.x+ models
		// stay on by default and rely on strip-and-retry for the shapes its converter rejects
		supportsStructuredOutputs: false,
	},
	{
		id: 'gemini-2.0-flash-thinking-exp-01-21',
		name: 'Gemini 2.0 Flash Thinking (Experimental)',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'gemini-2.0-flash-exp',
		name: 'Gemini 2.0 Flash (Experimental)',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'gemini-exp-1206',
		name: 'Gemini Experimental 1206',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'gemini-exp-1121',
		name: 'Gemini Experimental 1121',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'gemini-1.5-pro',
		name: 'Gemini 1.5 Pro',
		maxTokens: { input: 2097152, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'gemini-1.5-flash',
		name: 'Gemini 1.5 Flash',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
	},
	{
		id: 'gemini-1.5-flash-8b',
		name: 'Gemini 1.5 Flash 8B',
		maxTokens: { input: 1048576, output: 8192 },
		provider: provider,
		hidden: true,
		supportsStructuredOutputs: false,
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
