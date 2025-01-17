// GitHub provider: github.ts pulls many dependencies through Container and some of them break the unit tests.
// That's why this file has been created that can collect more simple functions which
// don't require Container and can be tested.

import type { HostingIntegrationId, SelfHostedIntegrationId } from '../../../../constants.integrations';
import type { PullRequestUrlIdentity } from '../../../../git/utils/pullRequest.utils';

export type GitHubRelatedIntegrationIds =
	| HostingIntegrationId.GitHub
	| SelfHostedIntegrationId.GitHubEnterprise
	| SelfHostedIntegrationId.CloudGitHubEnterprise;

export function isMaybeGitHubPullRequestUrl(url: string): boolean {
	if (url == null) return false;
	return getGitHubPullRequestIdentityFromMaybeUrl(url) != null;
}

export function getGitHubPullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: undefined }) | undefined;
export function getGitHubPullRequestIdentityFromMaybeUrl(
	search: string,
	id: GitHubRelatedIntegrationIds,
): (PullRequestUrlIdentity & { provider: GitHubRelatedIntegrationIds }) | undefined;
export function getGitHubPullRequestIdentityFromMaybeUrl(
	search: string,
	id?: GitHubRelatedIntegrationIds,
): (PullRequestUrlIdentity & { provider: GitHubRelatedIntegrationIds | undefined }) | undefined {
	let ownerAndRepo: string | undefined = undefined;
	let prNumber: string | undefined = undefined;

	let match = search.match(/([^/]+\/[^/]+)\/(?:pull)\/(\d+)/); // with org and rep name
	if (match != null) {
		ownerAndRepo = match[1];
		prNumber = match[2];
	}

	if (prNumber == null) {
		match = search.match(/(?:\/|^)(?:pull)\/(\d+)/); // without repo name
		if (match != null) {
			prNumber = match[1];
		}
	}

	return prNumber != null ? { ownerAndRepo: ownerAndRepo, prNumber: prNumber, provider: id } : undefined;
}
