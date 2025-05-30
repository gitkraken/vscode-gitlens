// GitLab provider: gitlab.ts pulls many dependencies through Container and some of them break the unit tests.
// That's why this file has been created that can collect more simple functions which
// don't require Container and can be tested.

import { HostingIntegrationId } from '../../../../constants.integrations';
import type { PullRequestUrlIdentity } from '../../../../git/models/pullRequest.utils';

export function isMaybeGitLabPullRequestUrl(url: string): boolean {
	return getGitLabPullRequestIdentityFromMaybeUrl(url) != null;
}

export function getGitLabPullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: HostingIntegrationId.GitLab }) | undefined {
	let ownerAndRepo: string | undefined = undefined;
	let prNumber: string | undefined = undefined;

	let match = search.match(/([^/]+\/[^/]+)\/(?:-\/merge_requests)\/(\d+)/); // with org and rep name
	if (match != null) {
		ownerAndRepo = match[1];
		prNumber = match[2];
	}

	if (prNumber == null) {
		match = search.match(/(?:\/|^)(?:-\/merge_requests)\/(\d+)/); // without repo name
		if (match != null) {
			prNumber = match[1];
		}
	}

	return prNumber != null
		? { ownerAndRepo: ownerAndRepo, prNumber: prNumber, provider: HostingIntegrationId.GitLab }
		: undefined;
}
