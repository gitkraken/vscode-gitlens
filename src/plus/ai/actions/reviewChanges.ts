import type { CancellationToken, ProgressOptions } from 'vscode';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type {
	PromptTemplateContext,
	PromptTemplateType,
	TruncationHandler,
} from '@gitlens/ai/models/promptTemplates.js';
import type { AIChatMessage } from '@gitlens/ai/models/provider.js';
import type { AIReviewDetailResult, AIReviewResult } from '@gitlens/ai/models/results.js';
import { estimatedCharactersPerToken } from '@gitlens/ai/utils/ai.utils.js';
import { parseReviewDetailResult, parseReviewResult } from '@gitlens/ai/utils/results.utils.js';
import { truncatePromptWithDiff } from '@gitlens/ai/utils/truncation.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { TelemetryEvents } from '../../../constants.telemetry.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { AIResponse, AIResult, AISourceContext } from '../aiProviderService.js';
import type { AIService } from '../aiService.js';
import { mergeUserInstructions } from '../utils/-webview/prompt.utils.js';

export type AIReviewSourceContext = AISourceContext<{
	type: TelemetryEvents['ai/review']['reviewType'];
	mode: 'single-pass' | 'two-pass';
}>;

/**
 * Conservative fallback in estimated tokens when the caller doesn't know which AI model
 * will be used. Matches the smallest modern context-window tier (gpt-4: 8k) so single-
 * pass stays safe for any model. Callers that can provide an `AIModel` should prefer
 * {@link getSinglePassTokenThreshold} which derives a larger, model-scoped threshold.
 */
const singlePassTokenThresholdFallback = 8000;

/**
 * Fraction of a model's input context budget we're willing to spend on the full diff in
 * a single-pass review. The rest is reserved for the system prompt, user instructions,
 * output headroom, and a safety margin for tokenizer variance. 15% is conservative — it
 * keeps single-pass comfortable on 128k-input models (~19k diff tokens) while still
 * falling back to two-pass for 1M+ token diffs on 8M-context giants.
 */
const singlePassTokenFraction = 0.15;

/**
 * Returns the single-pass token threshold for the given model, or the conservative
 * fallback if the model is unknown.
 */
export function getSinglePassTokenThreshold(model: AIModel | undefined): number {
	if (model == null) return singlePassTokenThresholdFallback;
	// Clamp to at least the fallback so a tiny-window model doesn't collapse the threshold
	// to an unusable value (the fallback is already sized for gpt-4 at 8k input).
	return Math.max(singlePassTokenThresholdFallback, Math.floor(model.maxTokens.input * singlePassTokenFraction));
}

const reviewUserGuidanceHeader =
	'The user provided the following focus areas for this review — prioritize these in your analysis:';

interface RunReviewSpec<TTemplate extends PromptTemplateType, TResult> {
	promptTemplate: TTemplate;
	progressTitleVerb: string;
	reviewMode: 'single-pass' | 'two-pass';
	truncation: TruncationHandler<TTemplate> | undefined;
	parse: (content: string) => TResult;
}

async function runReview<TTemplate extends PromptTemplateType, TResult>(
	service: AIService,
	promptContext:
		| PromptTemplateContext<TTemplate>
		| ((cancellationToken: CancellationToken) => Promise<PromptTemplateContext<TTemplate>>),
	sourceContext: AIReviewSourceContext,
	spec: RunReviewSpec<TTemplate, TResult>,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResult<TResult> | 'cancelled' | undefined> {
	const { context, ...source } = sourceContext;

	const result = await service.sendRequest(
		'review-changes',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				if (typeof promptContext === 'function') {
					promptContext = await promptContext(cancellation);
				}

				promptContext.instructions = mergeUserInstructions(
					configuration.get('ai.reviewChanges.customInstructions'),
					promptContext.instructions,
					reviewUserGuidanceHeader,
				);

				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await service.getPrompt(
					spec.promptTemplate,
					model,
					promptContext,
					maxInputTokens,
					retries,
					reporting,
					spec.truncation,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			getProgressTitle: m => `${spec.progressTitleVerb} with ${m.name}...`,
			getTelemetryInfo: m => ({
				key: 'ai/review',
				data: {
					type: 'review',
					reviewType: context.type,
					reviewMode: spec.reviewMode,
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
		},
		source,
		options,
	);
	if (result == null || result === 'cancelled') return result;

	const promise: Promise<AIResponse<TResult> | 'cancelled' | undefined> = result.promise.then(result =>
		result === 'cancelled'
			? result
			: result != null
				? {
						...result,
						type: 'review-changes' as const,
						feature: `review-${context.type}`,
						result: spec.parse(result.content),
					}
				: undefined,
	);

	return {
		...result,
		type: 'review-changes',
		feature: `review-${context.type}`,
		promise: promise,
	};
}

/** Reviews changes in a diff (single-pass: full diff sent at once) */
export function reviewChanges(
	service: AIService,
	promptContext:
		| PromptTemplateContext<'review-changes'>
		| ((cancellationToken: CancellationToken) => Promise<PromptTemplateContext<'review-changes'>>),
	sourceContext: AIReviewSourceContext,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResult<AIReviewResult> | 'cancelled' | undefined> {
	return runReview(
		service,
		promptContext,
		sourceContext,
		{
			promptTemplate: 'review-changes',
			progressTitleVerb: 'Reviewing changes',
			reviewMode: 'single-pass',
			truncation: truncatePromptWithDiff,
			parse: content => parseReviewResult(content, 'single-pass'),
		},
		options,
	);
}

/** Reviews changes using just a file overview (Pass 1 of two-pass strategy) */
export function reviewOverview(
	service: AIService,
	promptContext:
		| PromptTemplateContext<'review-overview'>
		| ((cancellationToken: CancellationToken) => Promise<PromptTemplateContext<'review-overview'>>),
	sourceContext: AIReviewSourceContext,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResult<AIReviewResult> | 'cancelled' | undefined> {
	return runReview(
		service,
		promptContext,
		sourceContext,
		{
			promptTemplate: 'review-overview',
			progressTitleVerb: 'Analyzing changes',
			reviewMode: 'two-pass',
			truncation: undefined,
			parse: content => parseReviewResult(content, 'two-pass'),
		},
		options,
	);
}

/** Reviews specific files in a focus area (Pass 2 of two-pass strategy) */
export function reviewFocusArea(
	service: AIService,
	promptContext:
		| PromptTemplateContext<'review-detail'>
		| ((cancellationToken: CancellationToken) => Promise<PromptTemplateContext<'review-detail'>>),
	focusAreaId: string,
	sourceContext: AIReviewSourceContext,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResult<AIReviewDetailResult> | 'cancelled' | undefined> {
	return runReview(
		service,
		promptContext,
		sourceContext,
		{
			promptTemplate: 'review-detail',
			progressTitleVerb: 'Reviewing focus area',
			reviewMode: 'two-pass',
			truncation: truncatePromptWithDiff,
			parse: content => parseReviewDetailResult(content, focusAreaId),
		},
		options,
	);
}

/**
 * Determines whether a diff should use the single-pass or two-pass review strategy.
 * Pass the selected model to scope the threshold to its input-context budget; omit to
 * fall back to a conservative threshold sized for the smallest modern context window.
 */
export function shouldUseSinglePass(diffContent: string, model?: AIModel): boolean {
	const estimatedTokens = diffContent.length / estimatedCharactersPerToken;
	return estimatedTokens <= getSinglePassTokenThreshold(model);
}
