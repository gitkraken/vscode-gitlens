export type VSCodeAIModels = `${string}:${string}`;

export type AIProviders = 'anthropic' | 'deepseek' | 'gemini' | 'github' | 'huggingface' | 'openai' | 'vscode' | 'xai';
export type SupportedAIModels = `${Exclude<AIProviders, 'vscode'>}:${string}` | 'vscode';
