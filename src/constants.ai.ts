import type { AnthropicModels } from './ai/anthropicProvider';
import type { GeminiModels } from './ai/geminiProvider';
import type { OpenAIModels } from './ai/openaiProvider';
import type { VSCodeAIModels } from './ai/vscodeProvider';

export type AIProviders = 'anthropic' | 'gemini' | 'openai' | 'vscode';
export type AIModels<Provider extends AIProviders = AIProviders> = Provider extends 'openai'
	? OpenAIModels
	: Provider extends 'anthropic'
	  ? AnthropicModels
	  : Provider extends 'gemini'
	    ? GeminiModels
	    : Provider extends 'vscode'
	      ? VSCodeAIModels
	      : AnthropicModels | GeminiModels | OpenAIModels;

export type SupportedAIModels =
	| `anthropic:${AIModels<'anthropic'>}`
	| `google:${AIModels<'gemini'>}`
	| `openai:${AIModels<'openai'>}`
	| 'vscode';
