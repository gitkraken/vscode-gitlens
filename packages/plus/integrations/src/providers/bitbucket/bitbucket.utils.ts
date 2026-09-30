import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.js';

const bitbucketServerPathShape = /\/(?:projects|users)\/[^/]+\/repos\/[^/]+/i;

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
	const match = search.match(/\/(projects|users)\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i);
	if (match == null) return undefined;

	// A personal repository is served under `/users/{slug}` but addressed through the API as project `~{slug}`
	const owner = match[1].toLowerCase() === 'users' ? `~${match[2]}` : match[2];
	return { ownerAndRepo: `${owner}/${match[3]}`, prNumber: match[4], provider: id };
}
