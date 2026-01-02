import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import type { LaunchpadSummaryResult } from '../../launchpadIndicator.js';
import { generateLaunchpadSummary } from '../../launchpadIndicator.js';
import type { LaunchpadGroup } from '../../models/launchpad.js';

export async function getLaunchpadSummary(container: Container): Promise<LaunchpadSummaryResult | { error: Error }> {
	const result = await container.launchpad.getCategorizedItems();

	if (result.error != null) {
		return {
			error: result.error,
		};
	}

	const groups: LaunchpadGroup[] = configuration.get('launchpad.indicator.groups') ?? [];
	return generateLaunchpadSummary(result.items, groups);
}
