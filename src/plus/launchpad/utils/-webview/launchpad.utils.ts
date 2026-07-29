import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import type { LaunchpadSummaryError, LaunchpadSummaryResult } from '../../launchpadIndicator.js';
import { generateLaunchpadSummary } from '../../launchpadIndicator.js';
import type { LaunchpadGroup } from '../../models/launchpad.js';

/** `Error` has non-enumerable `message`/`stack`, so it serializes to `{}` over the webview RPC. */
function toSummaryError(ex: Error): LaunchpadSummaryError {
	return { name: ex.name, message: ex.message };
}

export async function getLaunchpadSummary(
	container: Container,
	options?: { force?: boolean },
): Promise<LaunchpadSummaryResult | { error: LaunchpadSummaryError }> {
	const result = await (options?.force
		? container.launchpad.getCategorizedItems({ force: true })
		: container.launchpad.getCategorizedItems());

	// Total failure: error with no items
	if (result.error != null && !result.items?.length) {
		return { error: toSummaryError(result.error) };
	}

	const groups: LaunchpadGroup[] = configuration.get('launchpad.indicator.groups') ?? [];
	const summary = generateLaunchpadSummary(result.items, groups);

	// Partial success: attach the error so the UI can show a warning alongside valid items
	if (result.error != null) {
		summary.error = toSummaryError(result.error);
	}

	return summary;
}
