// pullRequest.ts pulls many dependencies through Container and some of them break the unit tests.
// To avoid this file has been created that can collect more simple functions which
// don't require Container and can be tested.

import type { HostingIntegrationId } from '../../constants.integrations';

export interface PullRequestUrlIdentity {
	provider?: HostingIntegrationId;

	ownerAndRepo?: string;
	prNumber?: string;
}

export function getPullRequestIdentityValuesFromSearch(search: string): PullRequestUrlIdentity {
	let ownerAndRepo: string | undefined = undefined;
	let prNumber: string | undefined = undefined;

	let match = search.match(/([^/]+\/[^/]+)\/pull\/(\d+)/); // with org and rep name
	if (match != null) {
		ownerAndRepo = match[1];
		prNumber = match[2];
	}

	if (prNumber == null) {
		match = search.match(/(?:\/|^)pull\/(\d+)/); // without repo name
		if (match != null) {
			prNumber = match[1];
		}
	}

	if (prNumber == null) {
		match = search.match(/(?:\/)(\d+)/); // any number starting with "/"
		if (match != null) {
			prNumber = match[1];
		}
	}

	if (prNumber == null) {
		match = search.match(/^#?(\d+)$/); // just a number or with a leading "#"
		if (match != null) {
			prNumber = match[1];
		}
	}

	return { ownerAndRepo: ownerAndRepo, prNumber: prNumber };
}
