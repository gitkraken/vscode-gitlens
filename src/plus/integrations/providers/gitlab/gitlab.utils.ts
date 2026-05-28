import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../../constants.integrations.js';
import type { GitLabUser } from './models.js';

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

/**
 * Selects the GitLab user that authored a commit from a set of search results.
 *
 * GitLab has no way to resolve a commit's author to a user directly, so we search users by name/email and
 * disambiguate here. To avoid showing a stranger's avatar when multiple users share a name (see #2205), we only
 * return a user when we can identify them confidently — a matching public email, or a single exact name match.
 * Otherwise we return `undefined` so avatar resolution falls back to the commit email's Gravatar.
 */
export function selectGitLabUserForCommit(
	users: GitLabUser[],
	authorName: string,
	authorEmail: string | undefined,
): GitLabUser | undefined {
	if (users.length === 0) return undefined;

	// Strongest signal: a public email that matches the commit email — unambiguous identity
	if (authorEmail) {
		const byEmail = users.find(u => u.publicEmail && equalsIgnoreCase(u.publicEmail, authorEmail));
		if (byEmail != null) return byEmail;
	}

	// Otherwise fall back to an exact name match — but only when it's unambiguous
	const nameMatches = users.filter(u => equalsIgnoreCase(u.name, authorName));
	if (nameMatches.length === 1) return nameMatches[0];

	// No matches, or multiple name matches we can't disambiguate by email — don't guess
	return undefined;
}
