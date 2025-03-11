export type AIProviders =
	| 'anthropic'
	| 'deepseek'
	| 'gemini'
	| 'github'
	| 'gitkraken'
	| 'huggingface'
	| 'openai'
	| 'vscode'
	| 'xai';
export type AIPrimaryProviders = Extract<AIProviders, 'gitkraken' | 'vscode'>;
export const primaryAIProviders = ['gitkraken', 'vscode'] as const satisfies readonly AIPrimaryProviders[];

export type AIProviderAndModel = `${string}:${string}`;
export type SupportedAIModels = `${Exclude<AIProviders, AIPrimaryProviders>}:${string}` | AIPrimaryProviders;
