import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.js';

export type GitLabIntegrationIds =
	| GitCloudHostIntegrationId.GitLab
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
	const match = search.match(/(?:\/|^)-\/merge_requests\/(\d+)/);
	if (match == null) return undefined;

	return {
		ownerAndRepo: getNamespacePathBeforeMergeRequest(search.slice(0, match.index)),
		prNumber: match[1],
		provider: id,
	};
}

/**
 * The project path (the whole namespace, then the repo) from the text before `/-/merge_requests`. A
 * scheme-less path's first segment is a host only when it has a dot or port and a namespace and repo follow
 * it, so `gitlab.com/acme/repo` drops the host, while `acme/platform/repo` is all namespace.
 */
function getNamespacePathBeforeMergeRequest(path: string): string | undefined {
	const withoutScheme = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
	const hasScheme = withoutScheme.length !== path.length;
	const segments = withoutScheme.replace(/^\//, '').split('/');
	if (segments.some(s => !s)) return undefined;

	if (segments.length > 1 && (hasScheme || (segments.length > 2 && /[.:]/.test(segments[0])))) {
		segments.shift();
	}
	return segments.length > 1 ? segments.join('/') : undefined;
}

/**
 * A GitLab user as the user search returns it. Declared here, beside the one helper that reads it, rather than with the
 * other API models, so this module's declarations (public through `isMaybeGitLabPullRequestUrl`) stay clear of those
 * models' SDK mappings.
 */
export interface GitLabUser {
	id: number;
	name: string;
	username: string;
	publicEmail: string | undefined;
	state: string;
	avatarUrl: string | undefined;
	webUrl: string;
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

/**
 * Checks whether a repository's namespace belongs to the given org/group, including subgroups
 * (e.g. namespace `parent/sub` matches org `parent`). Mirrors gkcli's `gitlabOrgMatches`, used to
 * filter `getReposForCurrentUser` results since GitLab has no group-scoped repos endpoint.
 */
export function matchesGitLabOrgNamespace(namespace: string, org: string): boolean {
	return namespace === org || namespace.startsWith(`${org}/`);
}

/**
 * Splits a GitLab project path at its last slash, so the owner is the whole namespace (`acme/platform`) and the
 * name is the repo, as `resolveRepository` does. Providers whose identity is always `owner/repo` split the same.
 */
export function splitOwnerAndRepo(ownerAndRepo: string): { owner: string; name: string } | undefined {
	const index = ownerAndRepo.lastIndexOf('/');
	if (index <= 0 || index === ownerAndRepo.length - 1) return undefined;

	return { owner: ownerAndRepo.slice(0, index), name: ownerAndRepo.slice(index + 1) };
}
