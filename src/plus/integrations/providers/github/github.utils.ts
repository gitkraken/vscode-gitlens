import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../../constants.integrations';
import type { PullRequestUrlIdentity } from '../../../../git/utils/pullRequest.utils';

export type GitHubIntegrationIds =
	| GitCloudHostIntegrationId.GitHub
	| GitSelfManagedHostIntegrationId.GitHubEnterprise
	| GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;

export function isMaybeGitHubPullRequestUrl(url: string): boolean {
	if (url == null) return false;
	return getGitHubPullRequestIdentityFromMaybeUrl(url) != null;
}

export function getGitHubPullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: undefined }) | undefined;
export function getGitHubPullRequestIdentityFromMaybeUrl(
	search: string,
	id: GitHubIntegrationIds,
): (PullRequestUrlIdentity & { provider: GitHubIntegrationIds }) | undefined;
export function getGitHubPullRequestIdentityFromMaybeUrl(
	search: string,
	id?: GitHubIntegrationIds,
): (PullRequestUrlIdentity & { provider: GitHubIntegrationIds | undefined }) | undefined {
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
