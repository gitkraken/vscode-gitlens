export interface PromptTemplate {
	readonly id?: string;
	readonly template: string;
	readonly variables: string[];
}

interface ChangelogPromptTemplateContext {
	data: string;
	instructions?: string;
}

interface CommitMessagePromptTemplateContext {
	diff: string;
	context?: string;
	instructions?: string;
}

interface CreateDraftPromptTemplateContext {
	diff: string;
	context?: string;
	instructions?: string;
}

interface CreatePullRequestPromptTemplateContext {
	diff: string;
	data: string;
	context?: string;
	instructions?: string;
}

interface ExplainChangesPromptTemplateContext {
	diff: string;
	message: string;
	instructions?: string;
}

interface StashMessagePromptTemplateContext {
	diff: string;
	context?: string;
	instructions?: string;
}

export type PromptTemplateType =
	| 'generate-commitMessage'
	| 'generate-stashMessage'
	| 'generate-changelog'
	| `generate-create-${'cloudPatch' | 'codeSuggestion' | 'pullRequest'}`
	| 'explain-changes';

export type PromptTemplateContext<T extends PromptTemplateType> = T extends 'generate-commitMessage'
	? CommitMessagePromptTemplateContext
	: T extends 'generate-stashMessage'
	  ? StashMessagePromptTemplateContext
	  : T extends 'generate-create-cloudPatch' | 'generate-create-codeSuggestion'
	    ? CreateDraftPromptTemplateContext
	    : T extends 'generate-create-pullRequest'
	      ? CreatePullRequestPromptTemplateContext
	      : T extends 'generate-changelog'
	        ? ChangelogPromptTemplateContext
	        : T extends 'explain-changes'
	          ? ExplainChangesPromptTemplateContext
	          : never;
