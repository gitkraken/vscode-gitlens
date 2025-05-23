export interface PromptTemplate<T extends PromptTemplateType = PromptTemplateType> {
	readonly id: PromptTemplateId<T>;
	readonly template: string;
	readonly variables: (keyof PromptTemplateContext<T>)[];
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

interface RebasePromptTemplateContext {
	diff: string;
	data?: string;
	commits?: string;
	context?: string;
	instructions?: string;
}

interface RebaseMultiStep1PromptTemplateContext {
	diff: string;
	commits?: string;
	context?: string;
	instructions?: string;
}

interface RebaseMultiStep2PromptTemplateContext {
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
	| 'generate-rebase'
	| 'generate-rebase-multi-step1'
	| 'generate-rebase-multi-step2'
	| 'explain-changes';

type PromptTemplateVersions = '' | '_v2';

export type PromptTemplateId<T extends PromptTemplateType = PromptTemplateType> = `${T}${PromptTemplateVersions}`;

// prettier-ignore
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
	: T extends 'generate-rebase'
	? RebasePromptTemplateContext
	: T extends 'generate-rebase-multi-step1'
	? RebaseMultiStep1PromptTemplateContext
	: T extends 'generate-rebase-multi-step2'
	? RebaseMultiStep2PromptTemplateContext
	: T extends 'explain-changes'
	? ExplainChangesPromptTemplateContext
	: never;
