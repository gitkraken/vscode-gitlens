import type { AIPrimaryProviders, AIProviders } from '../../../constants.ai';
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
	| 'generate-commitMessage'
	| 'generate-stashMessage'
	| 'generate-changelog'
	| `generate-create-${'cloudPatch' | 'codeSuggestion' | 'pullRequest'}`
	| 'explain-changes';

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

export interface AIProviderDescriptorWithConfiguration<T extends AIProviders = AIProviders>
	extends AIProviderDescriptor<T> {
	readonly configured: boolean;
}

export interface AIProviderDescriptorWithType<T extends AIProviders = AIProviders>
	extends Omit<AIProviderDescriptor<T>, 'type'> {
	readonly type: Lazy<Promise<AIProviderConstructor<T>>>;
}
