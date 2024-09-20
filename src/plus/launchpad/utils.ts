import type { Container } from '../../container';
import { configuration } from '../../system/vscode/configuration';
import type { LaunchpadSummaryResult } from './launchpadIndicator';
import { generateLaunchpadSummary } from './launchpadIndicator';
import type { LaunchpadGroup } from './launchpadProvider';

export async function getLaunchpadSummary(container: Container): Promise<LaunchpadSummaryResult> {
	const result = await container.launchpad.getCategorizedItems();
	const groups: LaunchpadGroup[] = configuration.get('launchpad.indicator.groups') ?? [];

	return generateLaunchpadSummary(result.items, groups);
}
