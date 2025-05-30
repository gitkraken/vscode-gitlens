import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../../constants.integrations';
import type { PullRequestUrlIdentity } from '../../../../git/utils/pullRequest.utils';

export type GitLabIntegrationIds =
	| GitCloudHostIntegrationId.GitLab
	| GitSelfManagedHostIntegrationId.GitLabSelfHosted
	| GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;

export function isMaybeGitLabPullRequestUrl(url: string): boolean {
	return getGitLabPullRequestIdentityFromMaybeUrl(url) != null;
}

export function getGitLabPullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: undefined }) | undefined;
export function getGitLabPullRequestIdentityFromMaybeUrl(
	search: string,
	id: GitLabIntegrationIds,
): (PullRequestUrlIdentity & { provider: GitLabIntegrationIds }) | undefined;
export function getGitLabPullRequestIdentityFromMaybeUrl(
	search: string,
	id?: GitLabIntegrationIds,
): (PullRequestUrlIdentity & { provider: GitLabIntegrationIds | undefined }) | undefined {
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

	return prNumber != null ? { ownerAndRepo: ownerAndRepo, prNumber: prNumber, provider: id } : undefined;
}
