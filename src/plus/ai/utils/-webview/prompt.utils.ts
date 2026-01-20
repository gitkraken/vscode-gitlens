import type { TelemetryEvents } from '../../../../constants.telemetry.js';
import { AIError, AIErrorReason, CancellationError } from '../../../../errors.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { getPossessiveForm, interpolate } from '../../../../system/string.js';
import type { AIModel } from '../../models/model.js';
import type {
	PromptTemplate,
	PromptTemplateContext,
	PromptTemplateType,
	TruncationHandler,
} from '../../models/promptTemplates.js';
import {
	explainChanges,
	generateChangelog,
	generateCommitMessage,
	generateCommits,
	generateCreateCloudPatch,
	generateCreateCodeSuggest,
	generateCreatePullRequest,
	generateSearchQuery,
	generateStashMessage,
} from '../../prompts.js';
import { estimatedCharactersPerToken, showLargePromptWarning, showPromptTruncationWarning } from './ai.utils.js';

export function getLocalPromptTemplate<T extends PromptTemplateType>(
	template: T,
	_model: AIModel,
): PromptTemplate<T> | undefined {
	switch (template) {
		case 'generate-commitMessage':
			return generateCommitMessage as PromptTemplate<T>;
		case 'generate-stashMessage':
			return generateStashMessage as PromptTemplate<T>;
		case 'generate-changelog':
			return generateChangelog as PromptTemplate<T>;
		case 'generate-create-cloudPatch':
			return generateCreateCloudPatch as PromptTemplate<T>;
		case 'generate-create-codeSuggestion':
			return generateCreateCodeSuggest as PromptTemplate<T>;
		case 'generate-create-pullRequest':
			return generateCreatePullRequest as PromptTemplate<T>;
		case 'generate-searchQuery':
			return generateSearchQuery as PromptTemplate<T>;
		case 'generate-commits':
			return generateCommits as PromptTemplate<T>;
		case 'explain-changes':
			return explainChanges as PromptTemplate<T>;
	}
}

export async function resolvePrompt<T extends PromptTemplateType>(
	model: AIModel,
	template: PromptTemplate<T>,
	templateContext: PromptTemplateContext<T>,
	maxInputTokens: number,
	retries: number,
	reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
	truncationHandler?: TruncationHandler<T>,
): Promise<{ prompt: string; truncated: boolean }> {
	if (templateContext.instructions) {
		reporting['config.usedCustomInstructions'] = true;
	}

	let currentContext = templateContext;
	let truncated = false;

	const estimatedMaxCharacters = maxInputTokens * estimatedCharactersPerToken;
	let currentCharacters = getContextCharacters(template, currentContext);

	// If over limit, try truncation handler or fail
	if (currentCharacters > estimatedMaxCharacters) {
		if (truncationHandler != null) {
			const truncatedContext = await truncationHandler(
				currentContext,
				currentCharacters,
				estimatedMaxCharacters,
				ctx => getContextCharacters(template, ctx),
			);
			if (truncatedContext == null) {
				throw new AIError(
					AIErrorReason.RequestTooLarge,
					new Error(
						`Unable to truncate context to fit within the ${getPossessiveForm(model.provider.name)} limits`,
					),
				);
			}
			currentContext = truncatedContext;
			currentCharacters = getContextCharacters(template, currentContext);
			truncated = true;
		} else {
			// No handler provided and over limit - fail fast
			throw new AIError(
				AIErrorReason.RequestTooLarge,
				new Error(`Context exceeds the ${getPossessiveForm(model.provider.name)} limits`),
			);
		}
	}

	const prompt = buildPrompt(template, currentContext);

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

function getContextCharacters<T extends PromptTemplateType>(
	template: PromptTemplate<T>,
	context: PromptTemplateContext<T>,
): number {
	let length = template.template.length;
	for (const key of template.variables) {
		const value = context[key];
		if (typeof value === 'string') {
			length += value.length;
		}
	}
	return length;
}

function buildPrompt<T extends PromptTemplateType>(
	template: PromptTemplate<T>,
	context: PromptTemplateContext<T>,
): string {
	const entries: [string, string][] = [];
	for (const key of template.variables) {
		const value = context[key];
		entries.push([key as string, typeof value === 'string' ? value : '']);
	}
	return interpolate(template.template, Object.fromEntries(entries));
}
