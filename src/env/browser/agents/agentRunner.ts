import type { DeepReviewOptions, DeepReviewRunResult } from '../../../plus/agents/agentCapture.js';

/** Deep review spawns a CLI subprocess, which is unavailable in the browser/webworker host. */
export const agentCaptureSupported = false;

export function runDeepReview(_options: DeepReviewOptions): Promise<DeepReviewRunResult> {
	return Promise.resolve({ error: { message: 'Deep review is not available in this environment.' } });
}
