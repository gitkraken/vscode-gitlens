export interface PromptTemplate<T extends PromptTemplateType = PromptTemplateType> {
	readonly id: PromptTemplateId<T>;
	readonly template: string;
	readonly variables: (keyof PromptTemplateContext<T>)[];
}

/**
 * Handler for intelligently truncating template context when it exceeds token limits.
 * Receives the full context, budget information, and a helper to check new character counts.
 *
 * @param context - The full template context with all variable values
 * @param currentCharacters - The current total character count of the prompt
 * @param targetCharacters - The maximum characters the prompt should be reduced to
 * @param getCharacters - Helper function to calculate character count for a modified context
 * @returns Modified context with truncated values, or undefined if truncation is not possible (will throw RequestTooLarge)
 */
export type TruncationHandler<T extends PromptTemplateType> = (
	context: PromptTemplateContext<T>,
	currentCharacters: number,
	targetCharacters: number,
	getCharacters: (context: PromptTemplateContext<T>) => number,
) => Promise<PromptTemplateContext<T> | undefined>;

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

interface SearchQueryPromptTemplateContext {
	query: string;
	date: string;
	context?: string;
	instructions?: string;
}

interface StashMessagePromptTemplateContext {
	diff: string;
	context?: string;
	instructions?: string;
}

interface GenerateCommitsPromptTemplateContext {
	hunks: string;
	existingCommits: string;
	hunkMap: string;
	context?: string;
	instructions?: string;
}

interface ReviewPullRequestPromptTemplateContext {
	prData: string;
	instructions?: string;
	mcpTools?: string;
}

interface StartWorkIssuePromptTemplateContext {
	issue: string;
	instructions?: string;
	mcpTools?: string;
}

export type PromptTemplateType =
	| 'generate-commitMessage'
	| 'generate-stashMessage'
	| 'generate-changelog'
	| `generate-create-${'cloudPatch' | 'codeSuggestion' | 'pullRequest'}`
	| 'generate-commits'
	| 'generate-searchQuery'
	| 'explain-changes'
	| 'start-review-pullRequest'
	| 'start-work-issue';

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
	: T extends 'generate-commits'
	? GenerateCommitsPromptTemplateContext
	: T extends 'generate-searchQuery'
	? SearchQueryPromptTemplateContext
	: T extends 'explain-changes'
	? ExplainChangesPromptTemplateContext
	: T extends 'start-review-pullRequest'
	? ReviewPullRequestPromptTemplateContext
	: T extends 'start-work-issue'
	? StartWorkIssuePromptTemplateContext
	: never;
