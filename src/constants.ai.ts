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

export const aiProviderDataDisclaimer =
	'GitLens AI features can send code snippets, diffs and other context to your selected AI provider for analysis. This may contain sensitive information.';
