import type { Container } from '../../container';
import type { PullRequestUrlIdentity } from '../../git/models/pullRequest.utils';
import { configuration } from '../../system/vscode/configuration';
import {
	getGitHubPullRequestIdentityFromMaybeUrl,
	isMaybeGitHubPullRequestUrl,
} from '../integrations/providers/github/models';
import {
	getGitLabPullRequestIdentityFromMaybeUrl,
	isMaybeGitLabPullRequestUrl,
} from '../integrations/providers/gitlab/models';
import type { LaunchpadSummaryResult } from './launchpadIndicator';
import { generateLaunchpadSummary } from './launchpadIndicator';
import type { LaunchpadGroup } from './models';

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

export function isMaybeSupportedLaunchpadPullRequestSearchUrl(search: string): boolean {
	return isMaybeGitHubPullRequestUrl(search) || isMaybeGitLabPullRequestUrl(search);
}

// TODO: Needs to be generalized for other providers
export function getPullRequestIdentityFromMaybeUrl(url: string): PullRequestUrlIdentity {
	const github = getGitHubPullRequestIdentityFromMaybeUrl(url);
	if (github.prNumber != null) return github;

	const gitlab = getGitLabPullRequestIdentityFromMaybeUrl(url);
	if (gitlab.prNumber != null) return gitlab;

	return { prNumber: undefined, ownerAndRepo: undefined, provider: undefined };
}
