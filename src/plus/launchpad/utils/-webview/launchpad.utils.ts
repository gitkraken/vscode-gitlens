import type { Container } from '../../../../container';
import { configuration } from '../../../../system/-webview/configuration';
import type { LaunchpadSummaryResult } from '../../launchpadIndicator';
import { generateLaunchpadSummary } from '../../launchpadIndicator';
import type { LaunchpadGroup } from '../../models/launchpad';

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
