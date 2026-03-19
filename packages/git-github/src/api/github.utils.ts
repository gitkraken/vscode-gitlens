import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';

export function isMaybeGitHubPullRequestUrl(url: string): boolean {
	if (url == null) return false;
	return getGitHubPullRequestIdentityFromMaybeUrl(url) != null;
}

export function getGitHubPullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: undefined }) | undefined;
export function getGitHubPullRequestIdentityFromMaybeUrl<T extends string>(
	search: string,
	id: T,
): (PullRequestUrlIdentity & { provider: T }) | undefined;
export function getGitHubPullRequestIdentityFromMaybeUrl<T extends string>(
	search: string,
	id?: T,
): (PullRequestUrlIdentity & { provider: T | undefined }) | undefined {
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
