import type { AIActionType, AIModel } from '../models/model.js';

export function getActionName(action: AIActionType): string {
	switch (action) {
		case 'explain-changes':
			return 'Explain Changes';
		case 'review-changes':
			return 'Review Changes';
		case 'generate-commitMessage':
			return 'Generate Commit Message';
		case 'generate-stashMessage':
			return 'Generate Stash Message';
		case 'generate-changelog':
			return 'Generate Changelog (Preview)';
		case 'generate-create-cloudPatch':
			return 'Create Cloud Patch Details';
		case 'generate-create-codeSuggestion':
			return 'Create Code Suggestion Details';
		case 'generate-create-pullRequest':
			return 'Create Pull Request Details (Preview)';
		case 'generate-commits':
			return 'Generate Commits (Preview)';
		case 'generate-searchQuery':
			return 'Generate Search Query (Preview)';
	}
}

export const estimatedCharactersPerToken = 2.8;

export function getValidatedTemperature(
	model: AIModel,
	modelTemperature?: number | null,
	defaultTemperature?: number,
): number | undefined {
	if (modelTemperature === null) return undefined;
	// GPT5 doesn't support anything but the default temperature
	if (model.id.startsWith('gpt-5')) return undefined;

	modelTemperature ??= Math.max(0, Math.min(defaultTemperature ?? 0.7, 2));
	return modelTemperature;
}

/**
 * Calculates the reduced max input tokens for retry attempts when context length is exceeded.
 *
 * If `estimatedTokens` is provided, calculates based on the actual overage ratio.
 * Otherwise, uses a hybrid strategy: conservative fixed reduction, then escalating percentages.
 *
 * @param maxInputTokens - Current max input tokens limit
 * @param retryCount - Current retry attempt (1-based, use value after incrementing)
 * @param estimatedTokens - Optional: estimated tokens in the prompt (if known)
 * @returns New max input tokens value
 */
export function isAzureUrl(url: string): boolean {
	return url.includes('.azure.com');
}

export function getReducedMaxInputTokens(maxInputTokens: number, retryCount: number, estimatedTokens?: number): number {
	// If we know the estimated tokens, calculate reduction based on overage
	if (estimatedTokens != null && estimatedTokens > maxInputTokens) {
		const overageRatio = estimatedTokens / maxInputTokens;
		// Target below the limit with some buffer (5-15% below based on retry)
		const bufferPercent = 0.05 + retryCount * 0.05;
		const targetRatio = 1 / overageRatio - bufferPercent;
		return Math.floor(maxInputTokens * Math.max(0.5, targetRatio));
	}

	// Fallback: progressive reduction without knowing exact overage
	switch (retryCount) {
		case 1:
			// Conservative fixed reduction for small overages
			return maxInputTokens - 1000;
		case 2:
			// Moderate percentage-based reduction
			return Math.floor(maxInputTokens * 0.9);
		case 3:
		default:
			// Aggressive percentage-based reduction
			return Math.floor(maxInputTokens * 0.75);
	}
}
