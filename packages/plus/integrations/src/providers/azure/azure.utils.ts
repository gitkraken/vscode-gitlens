import { isVsts, parseAzureHttpsUrl } from '@gitlens/git/remotes/azure-devops.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.js';
import { decodePathSegment } from '../../utils/domain.utils.js';
import type { AzureRepositoryDescriptor } from './models.js';

export type AzureDevOpsIntegrationIds =
	| GitCloudHostIntegrationId.AzureDevOps
	| GitSelfManagedHostIntegrationId.AzureDevOpsServer;

/** The project and repository an Azure repository descriptor names, its `{project}/_git/{repo}` name parsed. */
export function getAzureRepositoryIdentity(repo: Pick<AzureRepositoryDescriptor, 'owner' | 'name' | 'project'>): {
	resourceName: string;
	projectName?: string;
	repositoryName: string;
} {
	const match = /^([^/]+)\/_git\/([^/]+)$/i.exec(repo.name);
	return {
		resourceName: repo.owner,
		projectName: repo.project ?? match?.[1],
		repositoryName: match?.[2] ?? repo.name,
	};
}

/**
 * Decodes one segment of an address path as a virtual directory names it: an encoded `/` stays encoded, so the segment
 * stays one segment of the `/`-joined directory.
 */
export function decodeAzurePathSegment(segment: string): string {
	return decodePathSegment(segment.replace(/%2F/gi, '%252F'));
}

export function getAzurePullRequestIdentityFromMaybeUrl(
	search: string,
): (PullRequestUrlIdentity & { provider: undefined }) | undefined;
export function getAzurePullRequestIdentityFromMaybeUrl(
	search: string,
	id: AzureDevOpsIntegrationIds,
): (PullRequestUrlIdentity & { provider: AzureDevOpsIntegrationIds }) | undefined;
/**
 * Parses a pasted Azure DevOps pull request URL (`…/_git/{repo}/pullrequest/{id}`) into `{org}/{project}`:
 * - dev.azure.com and `{org}.visualstudio.com`, read by the remote's own parser (`parseAzureHttpsUrl`)
 * - `{collection}/{project}/_git/…` on Server, where a leading virtual directory such as `tfs/` is dropped: the
 *   identity has no field for it, so the read relies on the connection's configured URL including it
 * - `{collection}/_git/…` on Server, where the project is named after the repo
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

	const rawSegments = url.pathname.split('/').filter(Boolean);
	const segments = rawSegments.map(decodePathSegment);
	const gitIndex = segments.findIndex(s => s.toLowerCase() === '_git');
	if (gitIndex < 0) return undefined;

	const repo = segments[gitIndex + 1];
	const prNumber = segments[gitIndex + 3];
	if (repo == null || segments[gitIndex + 2] !== 'pullrequest' || prNumber == null) return undefined;

	let org: string;
	let project: string;
	if (isVsts(url.hostname) || url.hostname.toLowerCase() === 'dev.azure.com') {
		// A cloud repository URL reads exactly as its remote does (org from the host or the path, the legacy
		// `DefaultCollection` segment, a project named after its repo), so hand the remote's parser the URL cut after
		// the repository
		const repoUrl = new URL(url.href);
		repoUrl.pathname = rawSegments.slice(0, gitIndex + 2).join('/');
		try {
			[org, project] = parseAzureHttpsUrl(repoUrl);
		} catch {
			return undefined;
		}
	} else {
		if (gitIndex < 1) return undefined;

		org = gitIndex === 1 ? segments[0] : segments[gitIndex - 2];
		project = gitIndex === 1 ? repo : segments[gitIndex - 1];
	}

	return { ownerAndRepo: `${org}/${project}`, prNumber: prNumber, provider: id };
}
