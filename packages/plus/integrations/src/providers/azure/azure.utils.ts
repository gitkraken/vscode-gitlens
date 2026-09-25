import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.js';
import { vstsHostnameSuffix } from './models.js';

export type AzureDevOpsIntegrationIds =
	| GitCloudHostIntegrationId.AzureDevOps
	| GitSelfManagedHostIntegrationId.AzureDevOpsServer;

export function getAzurePullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: undefined }) | undefined;
export function getAzurePullRequestIdentityFromMaybeUrl(
	search: string,
	id: AzureDevOpsIntegrationIds,
): (PullRequestUrlIdentity & { provider: AzureDevOpsIntegrationIds }) | undefined;
/**
 * Parses a pasted Azure DevOps pull request URL (`…/_git/{repo}/pullrequest/{id}`) into `{org}/{project}`:
 * - `{org}/{project}/_git/…` on dev.azure.com or Server, where a leading virtual directory such as `tfs/` is ignored
 * - `{org}.visualstudio.com/{project}/_git/…`, where the org is the host subdomain
 * - `{org}/_git/…`, where the project is named after the repo
 */
export function getAzurePullRequestIdentityFromMaybeUrl(
	search: string,
	id?: AzureDevOpsIntegrationIds,
): (PullRequestUrlIdentity & { provider: AzureDevOpsIntegrationIds | undefined }) | undefined {
	let url: URL;
	try {
		url = new URL(search);
	} catch {
		return undefined;
	}

	const segments = url.pathname.split('/').filter(Boolean);
	const gitIndex = segments.indexOf('_git');
	if (gitIndex < 1) return undefined;

	const repo = segments[gitIndex + 1];
	const prNumber = segments[gitIndex + 3];
	if (repo == null || segments[gitIndex + 2] !== 'pullrequest' || prNumber == null) return undefined;

	const segmentBeforeGit = segments[gitIndex - 1];

	let org: string;
	let project: string;
	if (url.hostname.toLowerCase().endsWith(vstsHostnameSuffix)) {
		org = url.hostname.slice(0, -vstsHostnameSuffix.length);
		project = segmentBeforeGit;
	} else if (gitIndex === 1) {
		org = segmentBeforeGit;
		project = repo;
	} else {
		org = segments[gitIndex - 2];
		project = segmentBeforeGit;
	}

	return { ownerAndRepo: `${org}/${project}`, prNumber: prNumber, provider: id };
}
