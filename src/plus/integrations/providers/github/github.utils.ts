import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import { getGitHubPullRequestIdentityFromMaybeUrl as _getGitHubPullRequestIdentityFromMaybeUrl } from '@gitlens/git-github/api/github.utils.js';
import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../../constants.integrations.js';

export type GitHubIntegrationIds =
	| GitCloudHostIntegrationId.GitHub
	| GitSelfManagedHostIntegrationId.GitHubEnterprise
	| GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;

export { isMaybeGitHubPullRequestUrl } from '@gitlens/git-github/api/github.utils.js';

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
	return _getGitHubPullRequestIdentityFromMaybeUrl(search, id as any);
}
