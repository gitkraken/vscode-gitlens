import type { AIActionType } from './model';

export interface PromptTemplate {
	readonly id?: string;
	readonly name: string;
	readonly template: string;
	readonly variables: string[];
}

export type PromptTemplateContext<T extends AIActionType> = T extends
	| 'generate-commitMessage'
	| 'generate-stashMessage'
	| 'generate-create-cloudPatch'
	| 'generate-create-codeSuggestion'
	? { diff: string; context: string; instructions: string }
	: T extends 'generate-create-pullRequest'
	  ? { diff: string; data: string; context: string; instructions: string }
	  : T extends 'generate-changelog'
	    ? { data: string; instructions: string }
	    : T extends 'explain-changes'
	      ? { diff: string; message: string; instructions: string }
	      : never;
