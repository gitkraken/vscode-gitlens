import type { AIModel } from '@gitlens/ai/models/model.js';
import type {
	PromptTemplate,
	PromptTemplateContext,
	PromptTemplateType,
	TruncationHandler,
} from '@gitlens/ai/models/promptTemplates.js';
import {
	addressReviewFindings,
	explainChanges,
	generateChangelog,
	generateCommitMessage,
	generateCommits,
	generateCreateCloudPatch,
	generateCreateCodeSuggest,
	generateCreatePullRequest,
	generateSearchQuery,
	generateStashMessage,
	reviewChanges,
	reviewDetail,
	reviewOverview,
	reviewPullRequest,
	startWorkFromIssue,
} from '@gitlens/ai/prompts.js';
import { estimatedCharactersPerToken } from '@gitlens/ai/utils/ai.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { getPossessiveForm, interpolate } from '@gitlens/utils/string.js';
import type { TelemetryEvents } from '../../../../constants.telemetry.js';
import { AIError, AIErrorReason } from '../../../../errors.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { showLargePromptWarning, showPromptTruncationWarning } from './ai.utils.js';

/**
 * Merges custom user-configured instructions and per-request user guidance into a single instructions block.
 * `userGuidanceHeader` is the natural-language header prepended to the user guidance (e.g. "The user provided ...:").
 * Returns an empty string when both inputs are empty.
 */
export function mergeUserInstructions(
	customInstructions: string | null | undefined,
	userGuidance: string | null | undefined,
	userGuidanceHeader: string,
): string {
	let instructions = '';
	if (customInstructions) {
		instructions += customInstructions;
	}
	if (userGuidance) {
		instructions += `${instructions ? '\n\n' : ''}${userGuidanceHeader}\n${userGuidance}`;
	}
	return instructions;
}

export function getLocalPromptTemplate<T extends PromptTemplateType>(
	template: T,
	_model: AIModel | undefined,
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
		case 'review-changes':
			return reviewChanges as PromptTemplate<T>;
		case 'review-overview':
			return reviewOverview as PromptTemplate<T>;
		case 'review-detail':
			return reviewDetail as PromptTemplate<T>;
		case 'address-review-findings':
			return addressReviewFindings as PromptTemplate<T>;
		case 'start-review-pullRequest':
			return reviewPullRequest as PromptTemplate<T>;
		case 'start-work-issue':
			return startWorkFromIssue as PromptTemplate<T>;
		default:
			return undefined;
	}
}

export interface ResolvePromptOptions {
	suppressLargePromptWarning?: boolean;
}

// Overload: when model is provided, all parameters can be provided
export async function resolvePrompt<T extends PromptTemplateType>(
	model: AIModel,
	template: PromptTemplate<T>,
	templateContext: PromptTemplateContext<T>,
	maxInputTokens: number | undefined,
	retries: number | undefined,
	reporting: TelemetryEvents['ai/generate' | 'ai/explain' | 'ai/review'] | undefined,
	truncationHandler?: TruncationHandler<T>,
	options?: ResolvePromptOptions,
): Promise<{ prompt: string; truncated: boolean }>;

// Overload: when model is undefined, other parameters must be undefined
export async function resolvePrompt<T extends PromptTemplateType>(
	model: undefined,
	template: PromptTemplate<T>,
	templateContext: PromptTemplateContext<T>,
	maxInputTokens?: undefined,
	retries?: undefined,
	reporting?: undefined,
	truncationHandler?: undefined,
	options?: undefined,
): Promise<{ prompt: string; truncated: boolean }>;

// Implementation
export async function resolvePrompt<T extends PromptTemplateType>(
	model: AIModel | undefined,
	template: PromptTemplate<T>,
	templateContext: PromptTemplateContext<T>,
	maxInputTokens?: number | undefined,
	retries?: number | undefined,
	reporting?: TelemetryEvents['ai/generate' | 'ai/explain' | 'ai/review'] | undefined,
	truncationHandler?: TruncationHandler<T>,
	options?: ResolvePromptOptions,
): Promise<{ prompt: string; truncated: boolean }> {
	let currentContext = templateContext;
	let truncated = false;

	// Only perform truncation and telemetry if model is provided
	// (overloads ensure maxInputTokens, retries, reporting are also defined when model is defined)
	if (model != null) {
		if (templateContext.instructions) {
			reporting!['config.usedCustomInstructions'] = true;
		}

		const estimatedMaxCharacters = maxInputTokens! * estimatedCharactersPerToken;
		const currentCharacters = getContextCharacters(template, currentContext);

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
				truncated = true;
			} else {
				// No handler provided and over limit - fail fast
				throw new AIError(
					AIErrorReason.RequestTooLarge,
					new Error(`Context exceeds the ${getPossessiveForm(model.provider.name)} limits`),
				);
			}
		}
	}

	const prompt = buildPrompt(template, currentContext);

	// Only perform telemetry and warnings if model is provided
	if (model != null) {
		const estimatedTokens = Math.ceil(prompt.length / estimatedCharactersPerToken);
		const warningThreshold = configuration.get('ai.largePromptWarningThreshold', undefined, 10000);

		reporting!['retry.count'] = retries!;
		reporting!['input.length'] = prompt.length;
		reporting!['config.largePromptThreshold'] = warningThreshold;

		if (retries === 0) {
			reporting!['warning.promptTruncated'] = truncated;

			if (truncated) {
				showPromptTruncationWarning(model);
			}

			if (estimatedTokens > warningThreshold) {
				reporting!['warning.exceededLargePromptThreshold'] = true;

				if (!options?.suppressLargePromptWarning) {
					if (!(await showLargePromptWarning(Math.ceil(estimatedTokens / 100) * 100, warningThreshold))) {
						reporting!['failed.reason'] = 'user-cancelled';
						reporting!['failed.cancelled.reason'] = 'large-prompt';

						throw new CancellationError();
					}
				}
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
