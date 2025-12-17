import type { AIPrimaryProviders, AIProviders, OpenAIProviders } from '../../../constants.ai';
import type { Container } from '../../../container';
import type { Lazy } from '../../../system/lazy';
import type { ServerConnection } from '../../gk/serverConnection';
import type { AIProvider } from './provider';

export interface AIModel<Provider extends AIProviders = AIProviders, Model extends string = string> {
	readonly id: Model;
	readonly name: string;
	readonly maxTokens: { readonly input: number; readonly output: number | undefined };
	readonly provider: {
		readonly id: Provider;
		readonly name: string;
	};

	readonly default?: boolean;
	readonly hidden?: boolean;

	readonly temperature?: number | null;
}

export interface AIModelDescriptor<Provider extends AIProviders = AIProviders, Model extends string = string> {
	readonly provider: Provider;
	readonly model: Model;
}

export type AIActionType =
	| 'explain-changes'
	| 'generate-commitMessage'
	| 'generate-stashMessage'
	| 'generate-changelog'
	| `generate-create-${'cloudPatch' | 'codeSuggestion' | 'pullRequest'}`
	| 'generate-commits'
	| 'generate-searchQuery';

export interface AIProviderConstructor<Provider extends AIProviders = AIProviders> {
	new (container: Container, connection: ServerConnection): AIProvider<Provider>;
}

export interface AIProviderDescriptor<T extends AIProviders = AIProviders> {
	readonly id: T;
	readonly name: string;
	readonly primary: T extends AIPrimaryProviders ? true : false;
	readonly requiresAccount: boolean;
	readonly requiresUserKey: boolean;

	readonly type?: never;
}

export interface AIProviderDescriptorWithConfiguration<
	T extends AIProviders = AIProviders,
> extends AIProviderDescriptor<T> {
	readonly configured: boolean;
}

export interface AIProviderDescriptorWithType<T extends AIProviders = AIProviders> extends Omit<
	AIProviderDescriptor<T>,
	'type'
> {
	readonly type: Lazy<Promise<AIProviderConstructor<T>>>;
}

export const openAIModels = <T extends OpenAIProviders>(provider: AIProviderDescriptor<T>): AIModel<T>[] => [
	{
		id: 'gpt-5.2',
		name: 'GPT-5.2',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
	},
	{
		id: 'gpt-5.2-2025-12-11',
		name: 'GPT-5.2 (2025-12-11)',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-5.1',
		name: 'GPT-5.1',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
	},
	{
		id: 'gpt-5.1-2025-11-13',
		name: 'GPT-5.1 (2025-11-13)',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-5',
		name: 'GPT-5',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
	},
	{
		id: 'gpt-5-2025-08-07',
		name: 'GPT-5 (2025-08-07)',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-5-mini',
		name: 'GPT-5 mini',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
		default: true,
	},
	{
		id: 'gpt-5-mini-2025-08-07',
		name: 'GPT-5 mini (2025-08-07)',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-5-nano',
		name: 'GPT-5 nano',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
	},
	{
		id: 'gpt-5-nano-2025-08-07',
		name: 'GPT-5 nano (2025-08-07)',
		maxTokens: { input: 400000, output: 128000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-5-pro',
		name: 'GPT-5 Pro',
		maxTokens: { input: 400000, output: 272000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-5-pro-2025-10-06',
		name: 'GPT-5 Pro (2025-10-06)',
		maxTokens: { input: 400000, output: 272000 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4.1',
		name: 'GPT-4.1',
		maxTokens: { input: 1047576, output: 32768 },
		provider: provider,
	},
	{
		id: 'gpt-4.1-2025-04-14',
		name: 'GPT-4.1 (2025-04-14)',
		maxTokens: { input: 1047576, output: 32768 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4.1-mini',
		name: 'GPT-4.1 mini',
		maxTokens: { input: 1047576, output: 32768 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4.1-mini-2025-04-14',
		name: 'GPT-4.1 mini (2025-04-14)',
		maxTokens: { input: 1047576, output: 32768 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4.1-nano',
		name: 'GPT-4.1 nano',
		maxTokens: { input: 1047576, output: 32768 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4.1-nano-2025-04-14',
		name: 'GPT-4.1 nano (2025-04-14)',
		maxTokens: { input: 1047576, output: 32768 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'o4-mini',
		name: 'o4 mini',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
	},
	{
		id: 'o4-mini-2025-04-16',
		name: 'o4 mini (2025-04-16)',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o3-deep-research',
		name: 'o3 Deep Research',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o3-deep-research-2025-06-26',
		name: 'o3 Deep Research (2025-06-26)',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o3',
		name: 'o3',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
	},
	{
		id: 'o3-2025-04-16',
		name: 'o3 (2025-04-16)',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o3-pro',
		name: 'o3 Pro',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
	},
	{
		id: 'o3-mini',
		name: 'o3 mini',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
	},
	{
		id: 'o3-mini-2025-01-31',
		name: 'o3 mini (2025-01-31)',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o1',
		name: 'o1',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o1-2024-12-17',
		name: 'o1 (2024-12-17)',
		maxTokens: { input: 200000, output: 100000 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o1-preview',
		name: 'o1 preview',
		maxTokens: { input: 128000, output: 32768 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o1-preview-2024-09-12',
		name: 'o1 preview (2024-09-12)',
		maxTokens: { input: 128000, output: 32768 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o1-mini',
		name: 'o1 mini',
		maxTokens: { input: 128000, output: 65536 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'o1-mini-2024-09-12',
		name: 'o1 mini (2024-09-12)',
		maxTokens: { input: 128000, output: 65536 },
		provider: provider,
		temperature: null,
		hidden: true,
	},
	{
		id: 'gpt-4o',
		name: 'GPT-4o',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
	},
	{
		id: 'gpt-4o-2024-11-20',
		name: 'GPT-4o (2024-11-20)',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4o-2024-08-06',
		name: 'GPT-4o (2024-08-06)',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4o-2024-05-13',
		name: 'GPT-4o (2024-05-13)',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'chatgpt-4o-latest',
		name: 'GPT-4o',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4o-mini',
		name: 'GPT-4o mini',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4o-mini-2024-07-18',
		name: 'GPT-4o mini (2024-07-18)',
		maxTokens: { input: 128000, output: 16384 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-turbo',
		name: 'GPT-4 Turbo',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-turbo-2024-04-09',
		name: 'GPT-4 Turbo preview (2024-04-09)',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-turbo-preview',
		name: 'GPT-4 Turbo preview',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-0125-preview',
		name: 'GPT-4 0125 preview',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-1106-preview',
		name: 'GPT-4 1106 preview',
		maxTokens: { input: 128000, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4',
		name: 'GPT-4',
		maxTokens: { input: 8192, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-0613',
		name: 'GPT-4 0613',
		maxTokens: { input: 8192, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-32k',
		name: 'GPT-4 32k',
		maxTokens: { input: 32768, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-4-32k-0613',
		name: 'GPT-4 32k 0613',
		maxTokens: { input: 32768, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-3.5-turbo',
		name: 'GPT-3.5 Turbo',
		maxTokens: { input: 16385, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-3.5-turbo-0125',
		name: 'GPT-3.5 Turbo 0125',
		maxTokens: { input: 16385, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-3.5-turbo-1106',
		name: 'GPT-3.5 Turbo 1106',
		maxTokens: { input: 16385, output: 4096 },
		provider: provider,
		hidden: true,
	},
	{
		id: 'gpt-3.5-turbo-16k',
		name: 'GPT-3.5 Turbo 16k',
		maxTokens: { input: 16385, output: 4096 },
		provider: provider,
		hidden: true,
	},
];
