import { sum } from '../../../../system/iterable';
import { interpolate } from '../../../../system/string';
import type { AIActionType, AIModel } from '../../models/model';
import type { PromptTemplate, PromptTemplateContext } from '../../models/promptTemplates';
import {
	explainChangesUserPrompt,
	generateChangelogUserPrompt,
	generateCloudPatchMessageUserPrompt,
	generateCodeSuggestMessageUserPrompt,
	generateCommitMessageUserPrompt,
	generatePullRequestMessageUserPrompt,
	generateStashMessageUserPrompt,
} from '../../prompts';

export function getLocalPromptTemplate<T extends AIActionType>(action: T, _model: AIModel): PromptTemplate | undefined {
	switch (action) {
		case 'generate-commitMessage':
			return {
				name: 'Generate Commit Message',
				template: generateCommitMessageUserPrompt,
				variables: ['diff', 'context', 'instructions'],
			};
		case 'generate-stashMessage':
			return {
				name: 'Generate Stash Message',
				template: generateStashMessageUserPrompt,
				variables: ['diff', 'instructions'],
			};
		case 'generate-changelog':
			return {
				name: 'Generate Changelog (Preview)',
				template: generateChangelogUserPrompt,
				variables: ['data', 'instructions'],
			};
		case 'generate-create-cloudPatch':
			return {
				name: 'Create Cloud Patch Details',
				template: generateCloudPatchMessageUserPrompt,
				variables: ['diff', 'context', 'instructions'],
			};
		case 'generate-create-codeSuggestion':
			return {
				name: 'Create Code Suggestion Details',
				template: generateCodeSuggestMessageUserPrompt,
				variables: ['diff', 'context', 'instructions'],
			};
		case 'generate-create-pullRequest':
			return {
				name: 'Generate Pull Request Details (Preview)',
				template: generatePullRequestMessageUserPrompt,
				variables: ['diff', 'data', 'context', 'instructions'],
			};
		case 'explain-changes':
			return {
				name: 'Explain Changes',
				template: explainChangesUserPrompt,
				variables: ['diff', 'message', 'instructions'],
			};
		default:
			return undefined;
	}
}

const canTruncateTemplateVariables = ['diff'];

export function resolvePrompt<T extends AIActionType>(
	_action: T,
	template: PromptTemplate,
	templateContext: PromptTemplateContext<T>,
	maxCharacters: number,
): { content: string; truncated: boolean } {
	let entries = Object.entries(templateContext).filter(([k]) => template.variables.includes(k));
	const length = template.template.length + sum(entries, ([, v]) => v.length);

	let context: Record<string, string> = templateContext;

	let truncated = false;
	if (length > maxCharacters) {
		truncated = true;

		entries = entries.map(([k, v]) => {
			if (!canTruncateTemplateVariables.includes(k)) return [k, v] as const;

			const truncateTo = maxCharacters - (length - v.length);
			if (truncateTo > v.length) {
				debugger;
				throw new Error(`Unable to truncate context to fit within the ${template.name} limits`);
			}
			return [k, v.substring(0, truncateTo)] as const;
		});
	}

	// Ensure we blank out any missing variables
	for (const v of template.variables) {
		if (!entries.some(([k]) => k === v)) {
			entries.push([v, '']);
		}
	}

	context = Object.fromEntries(entries);

	return {
		content: interpolate(template.template, context),
		truncated: truncated,
	};
}
