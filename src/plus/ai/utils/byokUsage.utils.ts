import type { AIProviders } from '@gitlens/ai/constants.js';
import type { AIActionType } from '@gitlens/ai/models/model.js';

export interface BYOKUsage {
	provider: AIProviders;
	model: string;
	action: AIActionType;
	totalTokens: number;
	inputTokens: number;
}

/**
 * Folds a conversation's per-(provider/model) usage buckets into a single report: token counts are
 * summed across buckets and attributed to the bucket with the most total tokens. A session rarely
 * spans models (only when the user switches models mid-session), and one report per session is the
 * point — each report is charged the backend's flat per-feature fee.
 * Returns undefined when there's nothing reportable (no buckets, or the API-required minimum of
 * 1 total token isn't met).
 */
export function aggregateBYOKUsage(usages: Iterable<BYOKUsage>): BYOKUsage | undefined {
	let dominant: BYOKUsage | undefined;
	let totalTokens = 0;
	let inputTokens = 0;
	for (const usage of usages) {
		totalTokens += usage.totalTokens;
		inputTokens += usage.inputTokens;
		if (dominant == null || usage.totalTokens > dominant.totalTokens) {
			dominant = usage;
		}
	}
	if (dominant == null || totalTokens < 1) return undefined;

	return {
		provider: dominant.provider,
		model: dominant.model,
		action: dominant.action,
		totalTokens: totalTokens,
		inputTokens: inputTokens,
	};
}
