import type { AnyEntityIdentifierInput, EntityIdentifier } from '@gitkraken/provider-apis';
import { EntityIdentifierProviderType, EntityType, EntityVersion } from '@gitkraken/provider-apis';
import type { IntegrationIds } from '../../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../constants.integrations';
import type { Container } from '../../../container';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest } from '../../../git/models/issueOrPullRequest';
import type { PullRequest } from '../../../git/models/pullRequest';
import type { IssueResourceDescriptor, RepositoryDescriptor } from '../../../git/models/resourceDescriptor';
import { isIssueResourceDescriptor, isRepositoryDescriptor } from '../../../git/utils/resourceDescriptor.utils';
import { Logger } from '../../../system/logger';
import type { LaunchpadItem } from '../../launchpad/launchpadProvider';
import { isCloudGitSelfManagedHostIntegrationId } from '../utils/-webview/integration.utils';
import type { AzureProjectInputDescriptor } from './azure/models';
import type { GitConfigEntityIdentifier } from './models';
import { isGitHubDotCom, isGitLabDotCom } from './models';

function isLaunchpadItem(item: IssueOrPullRequest | LaunchpadItem): item is LaunchpadItem {
	return (item as LaunchpadItem).uuid !== undefined;
}

function isIssue(item: IssueOrPullRequest | LaunchpadItem): item is Issue {
	return item.type === 'issue';
}

export function getEntityIdentifierInput(entity: Issue | PullRequest | LaunchpadItem): AnyEntityIdentifierInput {
	let entityType = EntityType.Issue;
	if (entity.type === 'pullrequest') {
		entityType = EntityType.PullRequest;
	}

	let provider = fromStringToEntityIdentifierProviderType(entity.provider.id);
	let domain = null;
	if (provider === EntityIdentifierProviderType.Github && !isGitHubDotCom(entity.provider.domain)) {
		provider = EntityIdentifierProviderType.GithubEnterprise;
		domain = entity.provider.domain;
	}
	if (provider === EntityIdentifierProviderType.Gitlab && !isGitLabDotCom(entity.provider.domain)) {
		provider = EntityIdentifierProviderType.GitlabSelfHosted;
		domain = entity.provider.domain;
	}
	if (provider === EntityIdentifierProviderType.AzureDevOpsServer) {
		domain = entity.provider.domain;
	}

	let projectId = null;
	let resourceId = null;
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
		repoId = isLaunchpadItem(entity) ? entity.underlyingPullRequest?.repository.id : entity.repository?.id;
		if (entityType === EntityType.PullRequest && repoId == null) {
			throw new Error('Azure PRs must have a repository ID to be encoded');
		}
	} else if (
		provider === EntityIdentifierProviderType.Bitbucket ||
		provider === EntityIdentifierProviderType.BitbucketServer
	) {
		repoId = isLaunchpadItem(entity) ? entity.underlyingPullRequest?.repository.id : entity.repository?.id;
	}

	let entityId = isLaunchpadItem(entity) ? entity.graphQLId! : entity.nodeId!;
	if (
		provider === EntityIdentifierProviderType.Azure ||
		provider === EntityIdentifierProviderType.AzureDevOpsServer
	) {
		entityId = isLaunchpadItem(entity) ? entity.underlyingPullRequest?.id : entity.id;
	}

	return {
		accountOrOrgId: null, // needed for Trello issues, once supported
		organizationName: organizationName, // needed for Azure issues and PRs, once supported
		projectId: projectId, // needed for Jira issues, Trello issues, and Azure issues and PRs, once supported
		repoId: repoId ?? null, // needed for Azure and BitBucket PRs, once supported
		resourceId: resourceId, // needed for Jira issues
		provider: provider,
		entityType: entityType,
		version: EntityVersion.One,
		domain: domain,
		entityId: entityId,
	};
}

export function getProviderIdFromEntityIdentifier(
	entityIdentifier: EntityIdentifier | AnyEntityIdentifierInput | GitConfigEntityIdentifier,
): IntegrationIds | undefined {
	switch (entityIdentifier.provider) {
		case EntityIdentifierProviderType.Github:
			return GitCloudHostIntegrationId.GitHub;
		case EntityIdentifierProviderType.GithubEnterprise:
			return isGitConfigEntityIdentifier(entityIdentifier) && entityIdentifier.metadata.isCloudEnterprise
				? GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
				: GitSelfManagedHostIntegrationId.GitHubEnterprise;
		case EntityIdentifierProviderType.Gitlab:
			return GitCloudHostIntegrationId.GitLab;
		case EntityIdentifierProviderType.GitlabSelfHosted:
			return isGitConfigEntityIdentifier(entityIdentifier) && entityIdentifier.metadata.isCloudEnterprise
				? GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted
				: GitSelfManagedHostIntegrationId.GitLabSelfHosted;
		case EntityIdentifierProviderType.Jira:
			return IssuesCloudHostIntegrationId.Jira;
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

function fromStringToEntityIdentifierProviderType(str: string): EntityIdentifierProviderType {
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

export async function getIssueFromGitConfigEntityIdentifier(
	container: Container,
	identifier: GitConfigEntityIdentifier,
): Promise<Issue | undefined> {
	if (identifier.entityType !== EntityType.Issue) {
		return undefined;
	}

	// TODO: Centralize where we represent all supported providers for issues
	if (
		identifier.provider !== EntityIdentifierProviderType.Jira &&
		identifier.provider !== EntityIdentifierProviderType.Github &&
		identifier.provider !== EntityIdentifierProviderType.Gitlab &&
		identifier.provider !== EntityIdentifierProviderType.GithubEnterprise &&
		identifier.provider !== EntityIdentifierProviderType.GitlabSelfHosted &&
		identifier.provider !== EntityIdentifierProviderType.Bitbucket &&
		identifier.provider !== EntityIdentifierProviderType.BitbucketServer &&
		identifier.provider !== EntityIdentifierProviderType.AzureDevOpsServer &&
		identifier.provider !== EntityIdentifierProviderType.Azure
	) {
		return undefined;
	}

	const integrationId = getProviderIdFromEntityIdentifier(identifier);
	if (integrationId == null) {
		return undefined;
	}

	const integration = await container.integrations.get(integrationId);
	if (integration == null) {
		return undefined;
	}

	return integration.getIssue(
		{
			id: identifier.metadata.owner.id,
			key: identifier.metadata.owner.key,
			owner: identifier.metadata.owner.owner,
			name: identifier.metadata.owner.name,
		},
		identifier.metadata.id,
	);
}

export function getIssueOwner(
	issue: IssueShape,
): RepositoryDescriptor | IssueResourceDescriptor | AzureProjectInputDescriptor | undefined {
	const isAzure = issue.provider.id === 'azure' || GitCloudHostIntegrationId.AzureDevOps || 'azure-devops';
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
