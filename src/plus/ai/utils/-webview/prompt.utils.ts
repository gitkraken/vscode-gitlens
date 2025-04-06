import type { TelemetryEvents } from '../../../../constants.telemetry';
import { AIError, AIErrorReason, CancellationError } from '../../../../errors';
import { configuration } from '../../../../system/-webview/configuration';
import { filterMap } from '../../../../system/array';
import { sum } from '../../../../system/iterable';
import { getPossessiveForm, interpolate } from '../../../../system/string';
import type { AIModel } from '../../models/model';
import type { PromptTemplate, PromptTemplateContext, PromptTemplateType } from '../../models/promptTemplates';
import {
	explainChangesUserPrompt,
	generateChangelogUserPrompt,
	generateCloudPatchMessageUserPrompt,
	generateCodeSuggestMessageUserPrompt,
	generateCommitMessageUserPrompt,
	generatePullRequestMessageUserPrompt,
	generateStashMessageUserPrompt,
} from '../../prompts';
import { estimatedCharactersPerToken, showLargePromptWarning, showPromptTruncationWarning } from './ai.utils';

export function getLocalPromptTemplate<T extends PromptTemplateType>(
	template: T,
	_model: AIModel,
): PromptTemplate | undefined {
	switch (template) {
		case 'generate-commitMessage':
			return {
				template: generateCommitMessageUserPrompt,
				variables: [
					'diff',
					'context',
					'instructions',
				] satisfies (keyof PromptTemplateContext<'generate-commitMessage'>)[],
			};
		case 'generate-stashMessage':
			return {
				template: generateStashMessageUserPrompt,
				variables: [
					'diff',
					'context',
					'instructions',
				] satisfies (keyof PromptTemplateContext<'generate-stashMessage'>)[],
			};
		case 'generate-changelog':
			return {
				template: generateChangelogUserPrompt,
				variables: ['data', 'instructions'] satisfies (keyof PromptTemplateContext<'generate-changelog'>)[],
			};
		case 'generate-create-cloudPatch':
			return {
				template: generateCloudPatchMessageUserPrompt,
				variables: [
					'diff',
					'context',
					'instructions',
				] satisfies (keyof PromptTemplateContext<'generate-create-cloudPatch'>)[],
			};
		case 'generate-create-codeSuggestion':
			return {
				template: generateCodeSuggestMessageUserPrompt,
				variables: [
					'diff',
					'context',
					'instructions',
				] satisfies (keyof PromptTemplateContext<'generate-create-codeSuggestion'>)[],
			};
		case 'generate-create-pullRequest':
			return {
				template: generatePullRequestMessageUserPrompt,
				variables: [
					'diff',
					'data',
					'context',
					'instructions',
				] satisfies (keyof PromptTemplateContext<'generate-create-pullRequest'>)[],
			};
		case 'explain-changes':
			return {
				template: explainChangesUserPrompt,
				variables: [
					'diff',
					'message',
					'instructions',
				] satisfies (keyof PromptTemplateContext<'explain-changes'>)[],
			};
		default:
			return undefined;
	}
}

const canTruncateTemplateVariables = ['diff'];

export async function resolvePrompt<T extends PromptTemplateType>(
	model: AIModel,
	template: PromptTemplate,
	templateContext: PromptTemplateContext<T>,
	maxInputTokens: number,
	retries: number,
	reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
): Promise<{ prompt: string; truncated: boolean }> {
	if (templateContext.instructions) {
		reporting['config.usedCustomInstructions'] = true;
	}

	let entries = filterMap(Object.entries(templateContext), ([k, v]) => {
		if (!template.variables.includes(k) || (v != null && typeof v !== 'string')) {
			debugger;
			return undefined;
		}

		return [k, (v as string | null | undefined) ?? ''] as const;
	});
	const length = template.template.length + sum(entries, ([, v]) => v.length);

	let truncated = false;

	const estimatedMaxCharacters = maxInputTokens * estimatedCharactersPerToken;

	if (length > estimatedMaxCharacters) {
		truncated = true;

		entries = entries.map(([k, v]) => {
			if (!canTruncateTemplateVariables.includes(k)) return [k, v] as const;

			const truncateTo = estimatedMaxCharacters - (length - v.length);
			if (truncateTo > v.length) {
				debugger;
				throw new AIError(
					AIErrorReason.RequestTooLarge,
					new Error(
						`Unable to truncate context to fit within the ${getPossessiveForm(model.provider.name)} limits`,
					),
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

	const prompt = interpolate(template.template, Object.fromEntries(entries));

	const estimatedTokens = Math.ceil(prompt.length / estimatedCharactersPerToken);
	const warningThreshold = configuration.get('ai.largePromptWarningThreshold', undefined, 10000);

	reporting['retry.count'] = retries;
	reporting['input.length'] = prompt.length;
	reporting['config.largePromptThreshold'] = warningThreshold;

	if (retries === 0) {
		reporting['warning.promptTruncated'] = truncated;

		if (truncated) {
			showPromptTruncationWarning(model);
		}

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
