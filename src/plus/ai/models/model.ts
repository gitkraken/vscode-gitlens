import type { AIProviders } from '../../../constants.ai';

export interface AIModel<Provider extends AIProviders = AIProviders, Model extends string = string> {
	readonly id: Model;
	readonly name: string;
	readonly maxTokens: { readonly input: number; readonly output: number };
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
	| `explain-changes`;
