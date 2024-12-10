import type { Container } from '../../container';
import { configuration } from '../../system/vscode/configuration';
import { isGitHubPullRequestUrl } from '../integrations/providers/github/models';
import { isGitLabPullRequestUrl } from '../integrations/providers/gitlab/models';
import type { LaunchpadSummaryResult } from './launchpadIndicator';
import { generateLaunchpadSummary } from './launchpadIndicator';
import type { LaunchpadGroup } from './launchpadProvider';

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

export function isSupportedLaunchpadPullRequestSearchUrl(search: string): boolean {
	return isGitHubPullRequestUrl(search) || isGitLabPullRequestUrl(search);
}
