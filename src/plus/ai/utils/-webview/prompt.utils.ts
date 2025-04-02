import type { TelemetryEvents } from '../../../../constants.telemetry';
import { AIError, AIErrorReason, CancellationError } from '../../../../errors';
import { configuration } from '../../../../system/-webview/configuration';
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
import { estimatedCharactersPerToken, showLargePromptWarning } from './ai.utils';

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
				variables: ['diff', 'context', 'instructions'],
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

export async function resolvePrompt<T extends AIActionType>(
	_action: T,
	template: PromptTemplate,
	templateContext: PromptTemplateContext<T>,
	maxCharacters: number,
	retries: number,
	reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
): Promise<{ prompt: string; truncated: boolean }> {
	if (DEBUG) {
		if (!Object.keys(templateContext).every(k => template.variables.includes(k))) {
			debugger;
		}
	}

	if (templateContext.instructions) {
		reporting['config.usedCustomInstructions'] = true;
	}

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
				throw new AIError(
					AIErrorReason.RequestTooLarge,
					new Error(`Unable to truncate context to fit within the ${template.name} limits`),
				);
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
	const prompt = interpolate(template.template, context);

	const estimatedTokens = Math.ceil(prompt.length / estimatedCharactersPerToken);
	const warningThreshold = configuration.get('ai.largePromptWarningThreshold', undefined, 10000);

	reporting['retry.count'] = retries;
	reporting['input.length'] = prompt.length;
	reporting['config.largePromptThreshold'] = warningThreshold;

	if (retries === 0) {
		reporting['warning.promptTruncated'] = truncated;

		if (estimatedTokens > warningThreshold) {
			reporting['warning.exceededLargePromptThreshold'] = true;

			if (!(await showLargePromptWarning(Math.ceil(estimatedTokens / 100) * 100, warningThreshold))) {
				reporting['failed.reason'] = 'user-cancelled';
				reporting['failed.cancelled.reason'] = 'large-prompt';

				throw new CancellationError();
			}
		}
	}
	return { prompt: prompt, truncated: truncated };
}
