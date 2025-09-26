import type { AIProviderDescriptor } from './plus/ai/models/model';

export type AIProviders =
	| 'anthropic'
	| 'azure'
	| 'deepseek'
	| 'gemini'
	| 'github'
	| 'gitkraken'
	| 'huggingface'
	| 'mistral'
	| 'ollama'
	| 'openai'
	| 'openaicompatible'
	| 'openrouter'
	| 'vscode'
	| 'xai';
export type AIPrimaryProviders = Extract<AIProviders, 'gitkraken' | 'vscode'>;
export type OpenAIProviders = 'azure' | 'openai' | 'openaicompatible';

export type AIProviderAndModel = `${string}:${string}`;
export type SupportedAIModels = `${Exclude<AIProviders, AIPrimaryProviders>}:${string}` | AIPrimaryProviders;

export const gitKrakenProviderDescriptor: AIProviderDescriptor<'gitkraken'> = {
	id: 'gitkraken',
	name: 'GitKraken AI',
	primary: true,
	requiresAccount: true,
	requiresUserKey: false,
} as const;
export const vscodeProviderDescriptor: AIProviderDescriptor<'vscode'> = {
	id: 'vscode',
	name: 'Copilot',
	primary: true,
	requiresAccount: false,
	requiresUserKey: false,
} as const;
export const openAIProviderDescriptor: AIProviderDescriptor<'openai'> = {
	id: 'openai',
	name: 'OpenAI',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const azureProviderDescriptor: AIProviderDescriptor<'azure'> = {
	id: 'azure',
	name: 'Azure (Preview)',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const openAICompatibleProviderDescriptor: AIProviderDescriptor<'openaicompatible'> = {
	id: 'openaicompatible',
	name: 'OpenAI-Compatible Provider',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const anthropicProviderDescriptor: AIProviderDescriptor<'anthropic'> = {
	id: 'anthropic',
	name: 'Anthropic',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const geminiProviderDescriptor: AIProviderDescriptor<'gemini'> = {
	id: 'gemini',
	name: 'Google',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const mistralProviderDescriptor: AIProviderDescriptor<'mistral'> = {
	id: 'mistral',
	name: 'Mistral',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const deepSeekProviderDescriptor: AIProviderDescriptor<'deepseek'> = {
	id: 'deepseek',
	name: 'DeepSeek',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const xAIProviderDescriptor: AIProviderDescriptor<'xai'> = {
	id: 'xai',
	name: 'xAI',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const githubProviderDescriptor: AIProviderDescriptor<'github'> = {
	id: 'github',
	name: 'GitHub Models',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const huggingFaceProviderDescriptor: AIProviderDescriptor<'huggingface'> = {
	id: 'huggingface',
	name: 'Hugging Face',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const openRouterProviderDescriptor: AIProviderDescriptor<'openrouter'> = {
	id: 'openrouter',
	name: 'OpenRouter',
	primary: false,
	requiresAccount: true,
	requiresUserKey: true,
} as const;
export const ollamaProviderDescriptor: AIProviderDescriptor<'ollama'> = {
	id: 'ollama',
	name: 'Ollama',
	primary: false,
	requiresAccount: true,
	requiresUserKey: false,
} as const;
