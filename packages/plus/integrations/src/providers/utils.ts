import type { AnyEntityIdentifierInput, EntityIdentifier } from '@gitkraken/provider-apis';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type {
	IssueResourceDescriptor,
	RepositoryDescriptor,
	ResourceDescriptor,
} from '@gitlens/git/models/resourceDescriptor.js';
import { isIssueResourceDescriptor, isRepositoryDescriptor } from '@gitlens/git/utils/resourceDescriptor.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { IntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { isCloudGitSelfManagedHostIntegrationId } from '../utils/integration.utils.js';
import type { AzureProjectInputDescriptor } from './azure/models.js';
import type { GitConfigEntityIdentifier } from './models.js';
import { isGitHubDotCom, isGitLabDotCom } from './models.js';

// Local runtime copies of the `@gitkraken/provider-apis` entity-identifier string enums, duplicated for
// the same CJS-from-ESM reason as the enums in `models.ts`. Exported so the enum-parity test can guard
// them against upstream drift. `EntityVersion` is an intentional subset: the package only ever writes
// version 1, so the parity test asserts each local entry matches the SDK rather than a full mirror.
export const EntityIdentifierProviderType = {
	Azure: 'azure',
	AzureDevOpsServer: 'azureDevOpsServer',
	Github: 'github',
	GithubEnterprise: 'githubEnterprise',
	Gitlab: 'gitlab',
	GitlabSelfHosted: 'gitlabSelfHosted',
	Bitbucket: 'bitbucket',
	BitbucketServer: 'bitbucketServer',
	Jira: 'jira',
	JiraServer: 'jiraServer',
	Linear: 'linear',
	Trello: 'trello',
} as const;

export const EntityType = {
	PullRequest: 'pr',
	Issue: 'issue',
} as const;

export const EntityVersion = {
	One: '1',
} as const;

/**
 * Forward-compatible structural shape of the host's `LaunchpadItem`. The package
 * uses this for narrowing inside {@link getEntityIdentifierInput}; the host's
 * actual `LaunchpadItem` (in `src/plus/launchpad/launchpadProvider.ts`) carries
 * many more fields. The declared shape only includes fields integrations inspect.
 */
type LaunchpadItem = {
	uuid: string;
	type: 'issue' | 'pullrequest';
	graphQLId?: string;
	provider: { id: string; domain?: string };
	underlyingPullRequest?: {
		id: string;
		project?: { id: string; resourceName?: string };
		repository?: { id?: string };
	};
};

function isLaunchpadItem(item: IssueOrPullRequest | LaunchpadItem): item is LaunchpadItem {
	return (item as LaunchpadItem).uuid !== undefined;
}

function isIssue(item: IssueOrPullRequest | LaunchpadItem): item is Issue {
	return item.type === 'issue';
}

export function getEntityIdentifierInput(entity: Issue | PullRequest | LaunchpadItem): AnyEntityIdentifierInput {
	let entityType: (typeof EntityType)[keyof typeof EntityType] = EntityType.Issue;
	if (entity.type === 'pullrequest') {
		entityType = EntityType.PullRequest;
	}

	let provider = fromStringToEntityIdentifierProviderType(entity.provider.id);
	let domain = null;
	if (provider === EntityIdentifierProviderType.Github && !isGitHubDotCom(entity.provider.domain)) {
		provider = EntityIdentifierProviderType.GithubEnterprise;
		domain = entity.provider.domain ?? null;
	}
	if (provider === EntityIdentifierProviderType.Gitlab && !isGitLabDotCom(entity.provider.domain)) {
		provider = EntityIdentifierProviderType.GitlabSelfHosted;
		domain = entity.provider.domain ?? null;
	}
	if (provider === EntityIdentifierProviderType.AzureDevOpsServer) {
		domain = entity.provider.domain ?? null;
	}

	let projectId = null;
	let resourceId = null;
	let accountOrOrgId = null;
	let organizationName = null;
	let repoId = null;
	if (provider === EntityIdentifierProviderType.Jira) {
		if (!isIssue(entity) || entity.project == null) {
			throw new Error('Jira issues must have a project');
		}

		projectId = entity.project.id;
		resourceId = entity.project.resourceId;
	} else if (
		provider === EntityIdentifierProviderType.Azure ||
		provider === EntityIdentifierProviderType.AzureDevOpsServer
	) {
		const project = isLaunchpadItem(entity) ? entity.underlyingPullRequest?.project : entity.project;
		if (project == null) {
			throw new Error('Azure issues and PRs must have a project to be encoded');
		}

		projectId = project.id;
		organizationName = project.resourceName;
		repoId = isLaunchpadItem(entity) ? entity.underlyingPullRequest?.repository?.id : entity.repository?.id;
		if (entityType === EntityType.PullRequest && repoId == null) {
			throw new Error('Azure PRs must have a repository ID to be encoded');
		}
	} else if (provider === EntityIdentifierProviderType.Trello) {
		if (!isIssue(entity) || entity.project == null) {
			throw new Error('Trello issues must have a board project to be encoded');
		}

		projectId = entity.project.id;
		// Trello currently exposes the board but not a separate workspace/org id here. Reuse the board id in
		// both serialization slots so branch associations remain round-trippable until the upstream shape grows.
		accountOrOrgId = entity.project.resourceId || entity.project.id;
	} else if (
		provider === EntityIdentifierProviderType.Bitbucket ||
		provider === EntityIdentifierProviderType.BitbucketServer
	) {
		repoId = isLaunchpadItem(entity) ? entity.underlyingPullRequest?.repository?.id : entity.repository?.id;
	}

	let entityId = isLaunchpadItem(entity) ? entity.graphQLId! : entity.nodeId!;
	if (
		provider === EntityIdentifierProviderType.Azure ||
		provider === EntityIdentifierProviderType.AzureDevOpsServer
	) {
		entityId = (isLaunchpadItem(entity) ? entity.underlyingPullRequest?.id : entity.id) as string;
	}

	// `AnyEntityIdentifierInput` includes the catch-all `EntityIdentifier`
	// variant which requires all fields, while each provider-specific variant
	// requires a different subset. The function builds a polymorphic value
	// that's correct at runtime per `provider` but the literal can't be
	// structurally narrowed to any single variant. The 2-step cast through
	// `unknown` is the documented escape for this discriminated-union pattern.
	return {
		accountOrOrgId: accountOrOrgId,
		organizationName: organizationName, // needed for Azure issues and PRs, once supported
		projectId: projectId,
		repoId: repoId ?? null, // needed for Azure and BitBucket PRs, once supported
		resourceId: resourceId, // needed for Jira issues
		provider: provider,
		entityType: entityType,
		version: EntityVersion.One,
		domain: domain,
		entityId: entityId,
	} as unknown as AnyEntityIdentifierInput;
}

export function getProviderIdFromEntityIdentifier(
	entityIdentifier: EntityIdentifier | AnyEntityIdentifierInput | GitConfigEntityIdentifier,
): IntegrationIds | undefined {
	switch (entityIdentifier.provider) {
		case EntityIdentifierProviderType.Github:
			return GitCloudHostIntegrationId.GitHub;
		case EntityIdentifierProviderType.GithubEnterprise:
			return GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
		case EntityIdentifierProviderType.Gitlab:
			return GitCloudHostIntegrationId.GitLab;
		case EntityIdentifierProviderType.GitlabSelfHosted:
			return GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;
		case EntityIdentifierProviderType.Jira:
			return IssuesCloudHostIntegrationId.Jira;
		case EntityIdentifierProviderType.Linear:
			return IssuesCloudHostIntegrationId.Linear;
		case EntityIdentifierProviderType.Trello:
			return IssuesCloudHostIntegrationId.Trello;
		case EntityIdentifierProviderType.Azure:
			return GitCloudHostIntegrationId.AzureDevOps;
		case EntityIdentifierProviderType.AzureDevOpsServer:
			return GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		case EntityIdentifierProviderType.Bitbucket:
			return GitCloudHostIntegrationId.Bitbucket;
		case EntityIdentifierProviderType.BitbucketServer:
			return isGitConfigEntityIdentifier(entityIdentifier) && entityIdentifier.metadata.isCloudEnterprise
				? GitSelfManagedHostIntegrationId.BitbucketServer
				: undefined;
		default:
			return undefined;
	}
}

function fromStringToEntityIdentifierProviderType(
	str: string,
): (typeof EntityIdentifierProviderType)[keyof typeof EntityIdentifierProviderType] {
	switch (str) {
		case 'github':
			return EntityIdentifierProviderType.Github;
		case 'cloud-github-enterprise':
			return EntityIdentifierProviderType.GithubEnterprise;
		case 'cloud-gitlab-self-hosted':
			return EntityIdentifierProviderType.GitlabSelfHosted;
		case 'gitlab':
			return EntityIdentifierProviderType.Gitlab;
		case 'jira':
			return EntityIdentifierProviderType.Jira;
		case 'linear':
			return EntityIdentifierProviderType.Linear;
		case 'trello':
			return EntityIdentifierProviderType.Trello;
		case 'azure':
		case 'azureDevOps':
		case 'azure-devops':
			return EntityIdentifierProviderType.Azure;
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return EntityIdentifierProviderType.AzureDevOpsServer;
		case 'bitbucket':
			return EntityIdentifierProviderType.Bitbucket;
		case 'bitbucket-server':
			return EntityIdentifierProviderType.BitbucketServer;
		default:
			throw new Error(`Unknown provider type '${str}'`);
	}
}

export function encodeIssueOrPullRequestForGitConfig(
	entity: Issue | PullRequest,
	owner: RepositoryDescriptor | IssueResourceDescriptor,
): GitConfigEntityIdentifier {
	const encodedOwner: GitConfigEntityIdentifier['metadata']['owner'] = {
		key: owner.key,
		name: owner.name,
		id: undefined,
		owner: undefined,
	};
	if (isRepositoryDescriptor(owner)) {
		encodedOwner.owner = owner.owner;
	} else if (isIssueResourceDescriptor(owner)) {
		encodedOwner.id = owner.id;
	} else {
		throw new Error('Invalid owner');
	}

	return {
		...getEntityIdentifierInput(entity),
		metadata: {
			id: entity.id,
			owner: encodedOwner,
			createdDate: new Date().toISOString(),
			isCloudEnterprise: isCloudGitSelfManagedHostIntegrationId(entity.provider.id as IntegrationIds),
		},
	};
}

export function isGitConfigEntityIdentifier(entity: unknown): entity is GitConfigEntityIdentifier {
	return (
		entity != null &&
		typeof entity === 'object' &&
		'provider' in entity &&
		entity.provider != null &&
		'entityType' in entity &&
		entity.entityType != null &&
		'version' in entity &&
		entity.version != null &&
		'entityId' in entity &&
		entity.entityId != null &&
		'metadata' in entity &&
		entity.metadata != null &&
		typeof entity.metadata === 'object' &&
		'id' in entity.metadata &&
		entity.metadata.id != null &&
		'owner' in entity.metadata &&
		entity.metadata.owner != null &&
		'createdDate' in entity.metadata &&
		entity.metadata.createdDate != null
	);
}

export function isGitConfigEntityIdentifiers(entities: unknown): entities is GitConfigEntityIdentifier[] {
	return Array.isArray(entities) && entities.every(entity => isGitConfigEntityIdentifier(entity));
}

export function decodeEntityIdentifiersFromGitConfig(str: string): GitConfigEntityIdentifier[] {
	const decoded = JSON.parse(str);

	if (!isGitConfigEntityIdentifiers(decoded)) {
		debugger;
		Logger.error('Invalid entity identifiers in git config');
		return [];
	}

	for (const decodedEntity of decoded) {
		if (
			decodedEntity.provider === EntityIdentifierProviderType.Jira &&
			(decodedEntity.resourceId == null || decodedEntity.projectId == null)
		) {
			debugger;
			Logger.error('Invalid Jira issue in git config');
		}
	}

	return decoded;
}

interface IssueResolvableIntegration {
	getIssue(owner: unknown, id: string): Promise<Issue | undefined>;
}

export async function getIssueFromGitConfigEntityIdentifier(
	resolveIntegration: (id: IntegrationIds) => Promise<IssueResolvableIntegration | undefined>,
	identifier: GitConfigEntityIdentifier,
	options?: {
		/** Only return a value already in the local cache. No remote fetch — returns undefined on cache miss. */
		cached?: boolean;
		/**
		 * Host-supplied cache reader used when {@link cached} is set. The package is cache-agnostic, so the
		 * host (which owns the cache) provides this to satisfy a cache-only read. When omitted, `cached`
		 * yields undefined rather than falling through to a remote fetch.
		 */
		peekCachedIssue?: (
			integration: IssueResolvableIntegration | undefined,
			resource: ResourceDescriptor,
			id: string,
		) => Issue | undefined;
	},
): Promise<Issue | undefined> {
	if (identifier.entityType !== EntityType.Issue) {
		return undefined;
	}

	// TODO: Centralize where we represent all supported providers for issues
	if (
		identifier.provider !== EntityIdentifierProviderType.Jira &&
		identifier.provider !== EntityIdentifierProviderType.Linear &&
		identifier.provider !== EntityIdentifierProviderType.Github &&
		identifier.provider !== EntityIdentifierProviderType.Gitlab &&
		identifier.provider !== EntityIdentifierProviderType.GithubEnterprise &&
		identifier.provider !== EntityIdentifierProviderType.GitlabSelfHosted &&
		identifier.provider !== EntityIdentifierProviderType.Bitbucket &&
		identifier.provider !== EntityIdentifierProviderType.BitbucketServer &&
		identifier.provider !== EntityIdentifierProviderType.AzureDevOpsServer &&
		identifier.provider !== EntityIdentifierProviderType.Azure &&
		identifier.provider !== EntityIdentifierProviderType.Trello
	) {
		return undefined;
	}

	const integrationId = getProviderIdFromEntityIdentifier(identifier);
	if (integrationId == null) {
		return undefined;
	}

	const integration = await resolveIntegration(integrationId);

	const resource: ResourceDescriptor = {
		id: identifier.metadata.owner.id,
		key: identifier.metadata.owner.key,
		owner: identifier.metadata.owner.owner,
		name: identifier.metadata.owner.name,
	};
	const remoteLookupId =
		identifier.provider === EntityIdentifierProviderType.Trello ? identifier.entityId : identifier.metadata.id;

	// Cache-only read (no remote fetch). The package can't reach the host cache directly, so defer to the
	// host-supplied reader; without one, honor the no-fetch contract by returning undefined. The cache key
	// is resource+id (the integration only affects the etag), so peek even when the integration is
	// unresolvable — a still-cached issue must survive an unconfigured/disconnected integration.
	if (options?.cached) {
		const cachedIssue = options.peekCachedIssue?.(integration, resource, identifier.metadata.id);
		if (cachedIssue != null || identifier.provider !== EntityIdentifierProviderType.Trello) {
			return cachedIssue;
		}

		return options.peekCachedIssue?.(integration, resource, identifier.entityId);
	}

	if (integration == null) {
		return undefined;
	}

	return integration.getIssue(resource, remoteLookupId);
}

export function getIssueOwner(
	issue: IssueShape,
): RepositoryDescriptor | IssueResourceDescriptor | AzureProjectInputDescriptor | undefined {
	const isAzure = ['azure', GitCloudHostIntegrationId.AzureDevOps, 'azure-devops'].includes(issue.provider.id);
	return issue.repository
		? {
				key: `${issue.repository.owner}/${issue.repository.repo}`,
				owner: issue.repository.owner,
				name: issue.repository.repo,
			}
		: issue.project
			? {
					key: isAzure ? issue.project.id : issue.project.resourceId,
					id: isAzure ? issue.project.id : issue.project.resourceId,
					owner: isAzure ? issue.project.resourceName : undefined,
					name: isAzure ? issue.project.name : issue.project.resourceName,
				}
			: undefined;
}
