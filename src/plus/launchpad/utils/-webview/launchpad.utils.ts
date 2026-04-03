import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import type { LaunchpadSummaryResult } from '../../launchpadIndicator.js';
import { generateLaunchpadSummary } from '../../launchpadIndicator.js';
import type { LaunchpadGroup } from '../../models/launchpad.js';

export async function getLaunchpadSummary(container: Container): Promise<LaunchpadSummaryResult | { error: Error }> {
	const result = await container.launchpad.getCategorizedItems();

	// Total failure: error with no items
	if (result.error != null && !result.items?.length) {
		return { error: result.error };
	}

	const groups: LaunchpadGroup[] = configuration.get('launchpad.indicator.groups') ?? [];
	const summary = generateLaunchpadSummary(result.items, groups);

	// Partial success: attach the error so the UI can show a warning alongside valid items
	if (result.error != null) {
		summary.error = result.error;
	}

	return summary;
}
