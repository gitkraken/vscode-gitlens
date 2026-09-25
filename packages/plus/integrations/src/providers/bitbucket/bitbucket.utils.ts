import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.js';

/** A Bitbucket Data Center URL's path shape (`/projects/{KEY}/repos/{repo}/…`), rejected by the Cloud parser. */
const bitbucketServerPathShape = /\/projects\/[^/]+\/repos\/[^/]+/i;

export function getBitbucketPullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: undefined }) | undefined;
export function getBitbucketPullRequestIdentityFromMaybeUrl(
	search: string,
	id: GitCloudHostIntegrationId.Bitbucket,
): (PullRequestUrlIdentity & { provider: GitCloudHostIntegrationId.Bitbucket }) | undefined;
export function getBitbucketPullRequestIdentityFromMaybeUrl(
	search: string,
	id?: GitCloudHostIntegrationId.Bitbucket,
): (PullRequestUrlIdentity & { provider: GitCloudHostIntegrationId.Bitbucket | undefined }) | undefined {
	if (bitbucketServerPathShape.test(search)) return undefined;

	const match = search.match(/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/);
	if (match == null) return undefined;

	return { ownerAndRepo: `${match[1]}/${match[2]}`, prNumber: match[3], provider: id };
}

export function getBitbucketServerPullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: undefined }) | undefined;
export function getBitbucketServerPullRequestIdentityFromMaybeUrl(
	search: string,
	id: GitSelfManagedHostIntegrationId.BitbucketServer,
): (PullRequestUrlIdentity & { provider: GitSelfManagedHostIntegrationId.BitbucketServer }) | undefined;
export function getBitbucketServerPullRequestIdentityFromMaybeUrl(
	search: string,
	id?: GitSelfManagedHostIntegrationId.BitbucketServer,
): (PullRequestUrlIdentity & { provider: GitSelfManagedHostIntegrationId.BitbucketServer | undefined }) | undefined {
	const match = search.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i);
	if (match == null) return undefined;

	return { ownerAndRepo: `${match[1]}/${match[2]}`, prNumber: match[3], provider: id };
}
