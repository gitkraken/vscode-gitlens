import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { IssueResourceDescriptor, RepositoryDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { IntegrationBase } from '@gitlens/integrations/models/integration.js';
import type { GitConfigEntityIdentifier } from '@gitlens/integrations/providers/models.js';
import {
	decodeEntityIdentifiersFromGitConfig,
	encodeIssueOrPullRequestForGitConfig,
	EntityIdentifierProviderType,
	getEntityIdentifierInput,
	getIssueFromGitConfigEntityIdentifier,
	getProviderIdFromEntityIdentifier,
} from '@gitlens/integrations/providers/utils.js';
import { areDomainsOnSameHost, hostFromDomain } from '@gitlens/integrations/utils/domain.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { MaybePausedResult } from '@gitlens/utils/promise.js';
import { getSettledValue, pauseOnCancelOrTimeout } from '@gitlens/utils/promise.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { GkConfigKeys } from '../../../constants.js';
import type { Container } from '../../../container.js';

export type AssociatedIssue = { id: string; issue: Issue };

export function getAssociatedIssueId(issue: Issue | GitConfigEntityIdentifier): string {
	const identifier = 'entityId' in issue ? issue : getEntityIdentifierInput(issue);
	return JSON.stringify([
		identifier.provider,
		identifier.entityType,
		identifier.entityId,
		hostFromDomain('domain' in identifier ? (identifier.domain ?? undefined) : undefined),
		'resourceId' in identifier ? identifier.resourceId : undefined,
		'accountOrOrgId' in identifier ? identifier.accountOrOrgId : undefined,
		'organizationName' in identifier ? identifier.organizationName : undefined,
		'projectId' in identifier ? identifier.projectId : undefined,
		'repoId' in identifier ? identifier.repoId : undefined,
	]);
}

export async function addAssociatedIssueToBranch(
	container: Container,
	branch: GitBranchReference,
	issue: Issue,
	owner: RepositoryDescriptor | IssueResourceDescriptor,
	options?: {
		cancellation?: AbortSignal;
	},
): Promise<void> {
	const { key, encoded } = await getConfigKeyAndEncodedAssociatedIssuesForBranch(container, branch);
	if (options?.cancellation?.aborted) return;

	try {
		const associatedIssues: GitConfigEntityIdentifier[] = encoded
			? (JSON.parse(encoded) as GitConfigEntityIdentifier[])
			: [];
		const identifier = encodeIssueOrPullRequestForGitConfig(issue, owner);
		const id = getAssociatedIssueId(identifier);
		if (associatedIssues.some(i => getAssociatedIssueId(i) === id)) {
			return;
		}

		const legacyIndex = associatedIssues.findIndex(
			i =>
				(i.provider === EntityIdentifierProviderType.GithubEnterprise ||
					i.provider === EntityIdentifierProviderType.GitlabSelfHosted) &&
				!('domain' in i && i.domain?.trim()) &&
				getAssociatedIssueId({ ...i, domain: issue.provider.domain }) === id,
		);
		const integrationId = legacyIndex === -1 ? undefined : getProviderIdFromEntityIdentifier(identifier);
		const primary = integrationId == null ? undefined : await container.integrations.get(integrationId);
		if (options?.cancellation?.aborted) return;

		// Host-less git-provider associations resolve through the primary integration, so only that host can claim them.
		if (legacyIndex !== -1 && areDomainsOnSameHost(primary?.domain, issue.provider.domain)) {
			associatedIssues[legacyIndex] = identifier;
		} else {
			associatedIssues.push(identifier);
		}
		await container.git
			.getRepositoryService(branch.repoPath)
			.config.setGkConfig?.(key, JSON.stringify(associatedIssues));
		container.events.fire('git:repo:change', {
			repoPath: getRepositoryKey(branch.repoPath),
			changes: ['gkConfig'],
		});
	} catch (ex) {
		Logger.error(ex, 'addAssociatedIssueToBranch');
	}
}

export async function getAssociatedIssuesForBranch(
	container: Container,
	branch: GitBranch,
	options?: {
		cancellation?: AbortSignal;
		timeout?: number;
		/** Only return issues already in the local cache. No remote fetch — uncached entries are skipped. */
		cached?: boolean;
	},
): Promise<MaybePausedResult<AssociatedIssue[] | undefined>> {
	const { encoded } = await getConfigKeyAndEncodedAssociatedIssuesForBranch(container, branch);
	if (options?.cancellation?.aborted) return { value: undefined, paused: false };

	let associatedIssues: GitConfigEntityIdentifier[] | undefined;
	if (encoded) {
		try {
			associatedIssues = decodeEntityIdentifiersFromGitConfig(encoded);
		} catch (ex) {
			Logger.error(ex, 'getAssociatedIssuesForBranch');
			return { value: undefined, paused: false };
		}

		if (associatedIssues != null) {
			return pauseOnCancelOrTimeout(
				(async () => {
					return (
						await Promise.allSettled(
							(associatedIssues ?? []).map(async i => {
								// The identifier's domain selects the host for a self-managed provider (#5872)
								const issue = await getIssueFromGitConfigEntityIdentifier(
									(id, domain) => container.integrations.get(id, domain),
									i,
									{
										cached: options?.cached,
										peekCachedIssue: (integration, resource, id) =>
											container.cache.peekIssue(
												id,
												resource,
												integration as IntegrationBase | undefined,
											),
									},
								);
								return issue == null ? undefined : { id: getAssociatedIssueId(i), issue: issue };
							}),
						)
					)
						.map(r => getSettledValue(r))
						.filter((i): i is AssociatedIssue => i != null);
				})(),
				options?.cancellation,
				options?.timeout,
			);
		}
	}

	return { value: undefined, paused: false };
}

export async function removeAssociatedIssueFromBranch(
	container: Container,
	branch: GitBranchReference,
	id: string,
	options?: {
		cancellation?: AbortSignal;
	},
): Promise<void> {
	const { key, encoded } = await getConfigKeyAndEncodedAssociatedIssuesForBranch(container, branch);
	if (options?.cancellation?.aborted) return;

	try {
		let associatedIssues: GitConfigEntityIdentifier[] = encoded
			? (JSON.parse(encoded) as GitConfigEntityIdentifier[])
			: [];
		associatedIssues = associatedIssues.filter(i => getAssociatedIssueId(i) !== id);
		if (associatedIssues.length === 0) {
			await container.git.getRepositoryService(branch.repoPath).config.setGkConfig?.(key, undefined);
		} else {
			await container.git
				.getRepositoryService(branch.repoPath)
				.config.setGkConfig?.(key, JSON.stringify(associatedIssues));
		}
		container.events.fire('git:repo:change', {
			repoPath: getRepositoryKey(branch.repoPath),
			changes: ['gkConfig'],
		});
	} catch (ex) {
		Logger.error(ex, 'removeAssociatedIssueFromBranch');
	}
}

async function getConfigKeyAndEncodedAssociatedIssuesForBranch(
	container: Container,
	branch: GitBranchReference,
): Promise<{ key: GkConfigKeys; encoded: string | undefined }> {
	const key = `branch.${branch.name}.gk-associated-issues` satisfies GkConfigKeys;
	const encoded = await container.git.getRepositoryService(branch.repoPath).config.getGkConfig?.(key);
	return { key: key, encoded: encoded };
}
