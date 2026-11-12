import type { AnyEntityIdentifierInput } from '@gitkraken/provider-apis';
import { EntityIdentifierUtils } from '@gitkraken/provider-apis';
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
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import { getSingleConfiguredDomain } from '../utils/domain.utils.js';
import {
	isCloudGitSelfManagedHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
	isSelfManagedHostIntegrationId,
} from '../utils/integration.utils.js';
import { isGitHubDotCom, isGitLabDotCom } from './metadata.js';

// Local runtime copies of the `@gitkraken/provider-apis` entity-identifier string enums. Exported so the
// enum-parity test can guard them against upstream drift. `EntityVersion` is an intentional subset: the
// package only ever writes version 1, so the parity test asserts each local entry matches the SDK rather
// than a full mirror.
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
	Asana: 'asana',
} as const;

export const EntityType = {
	PullRequest: 'pr',
	Issue: 'issue',
} as const;

export const EntityVersion = {
	One: '1',
} as const;

export type EntityIdentifierProviderType =
	(typeof EntityIdentifierProviderType)[keyof typeof EntityIdentifierProviderType];
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/**
 * A decoded entity identifier: a GitLens-neutral copy of provider-apis' `EntityIdentifier`, so consumers never name
 * the SDK. `version` names every version the SDK decodes, unlike {@link EntityVersion}, which lists the one written.
 */
export interface EntityIdentifier {
	provider: EntityIdentifierProviderType;
	entityType: EntityType;
	version: '0' | '1';
	domain: string | null;
	resourceId: string | null;
	accountOrOrgId: string | null;
	organizationName: string | null;
	projectId: string | null;
	repoId: string | null;
	entityId: string;
}

/** The fields an entity identifier can carry. Which of them one needs depends on its provider and entity type. */
interface EntityIdentifierValues {
	version?: '0' | '1';
	entityId: string;
	domain?: string | null;
	resourceId?: string | null;
	accountOrOrgId?: string | null;
	organizationName?: string | null;
	projectId?: string | null;
	repoId?: string | null;
}

/**
 * An entity identifier's fields as {@link getEntityIdentifierInput} builds them for any issue or pull request, and as
 * a branch-issue association stores them ({@link GitConfigEntityIdentifier}): every provider (Linear included), with
 * each provider-specific field nullable. Not every one of these encodes; {@link EntityIdentifierInput} is the subset
 * that does.
 */
export interface EntityIdentifierFields extends EntityIdentifierValues {
	provider: EntityIdentifierProviderType;
	entityType: EntityType;
}

type ProviderOf<K extends keyof typeof EntityIdentifierProviderType> = (typeof EntityIdentifierProviderType)[K];

/**
 * What {@link encodeEntityIdentifier} accepts: one arm per provider and entity type the codec encodes, each requiring
 * the fields the codec refuses to encode without. Linear isn't encodable at all, and Jira and Trello have no pull
 * requests. The fields an arm doesn't require may still be present (as {@link getEntityIdentifierInput} fills them),
 * and are ignored.
 */
export type EntityIdentifierInput =
	| (EntityIdentifierValues & {
			provider: ProviderOf<'Github' | 'GithubEnterprise' | 'Gitlab' | 'GitlabSelfHosted'>;
			entityType: EntityType;
	  })
	| (EntityIdentifierValues & {
			provider: ProviderOf<'Bitbucket' | 'BitbucketServer'>;
			entityType: EntityType;
			repoId: string;
	  })
	| (EntityIdentifierValues & {
			provider: ProviderOf<'Azure' | 'AzureDevOpsServer'>;
			entityType: typeof EntityType.Issue;
			organizationName: string;
			projectId: string;
	  })
	| (EntityIdentifierValues & {
			provider: ProviderOf<'Azure' | 'AzureDevOpsServer'>;
			entityType: typeof EntityType.PullRequest;
			organizationName: string;
			projectId: string;
			repoId: string;
	  })
	| (EntityIdentifierValues & {
			provider: ProviderOf<'Jira' | 'JiraServer'>;
			entityType: typeof EntityType.Issue;
			projectId: string;
	  })
	| (EntityIdentifierValues & {
			provider: ProviderOf<'Trello'>;
			entityType: typeof EntityType.Issue;
			accountOrOrgId: string;
			projectId: string;
	  });

/** The {@link EntityIdentifierInput} arms for a pull request: what a pull request's identifier encodes as. */
export type PullRequestEntityIdentifierInput = EntityIdentifierInput & { entityType: typeof EntityType.PullRequest };

/** A branch-issue association as git config stores it: the identifier's fields plus what resolves it back. */
export type GitConfigEntityIdentifier = EntityIdentifierFields & {
	metadata: {
		id: string;
		owner: { key: string; name: string; id: string | undefined; owner: string | undefined };
		createdDate: string;
		isCloudEnterprise?: boolean;
	};
};

/** Encodes an entity identifier into the string form Launchpad keys pins/snoozes by and drafts store. */
export function encodeEntityIdentifier(entity: EntityIdentifierInput): string {
	// Each arm mirrors one of the SDK's, but the SDK's string enums are nominal, so its input can't be named without
	// them.
	return EntityIdentifierUtils.encode(entity as unknown as AnyEntityIdentifierInput);
}

/** Decodes an identifier written by {@link encodeEntityIdentifier}; throws on a malformed one. */
export function decodeEntityIdentifier(encoded: string): EntityIdentifier {
	return EntityIdentifierUtils.decode(encoded);
}

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

/**
 * The identifier fields of an issue or pull request. A pull request's are checked to encode (see
 * {@link toPullRequestEntityIdentifierInput}), so they can go straight to {@link encodeEntityIdentifier}.
 */
export function getEntityIdentifierInput(entity: PullRequest): PullRequestEntityIdentifierInput;
export function getEntityIdentifierInput(entity: Issue | PullRequest | LaunchpadItem): EntityIdentifierFields;
export function getEntityIdentifierInput(
	entity: Issue | PullRequest | LaunchpadItem,
): EntityIdentifierFields | PullRequestEntityIdentifierInput {
	let entityType: EntityType = EntityType.Issue;
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
	// An issue read through the self-managed integration already carries the enterprise id, so the rewrites above
	// never see it and its host was dropped — for exactly the issues that have one. A branch association has to
	// name it to be read back from the right server, since two hosts routinely share `owner/repo#number`. Issues
	// only: a pull request's identifier is also its Launchpad uuid, which keys stored pins and snoozes, so giving it
	// a host would orphan every existing one.
	if (
		entityType === EntityType.Issue &&
		domain == null &&
		(provider === EntityIdentifierProviderType.GithubEnterprise ||
			provider === EntityIdentifierProviderType.GitlabSelfHosted ||
			provider === EntityIdentifierProviderType.BitbucketServer)
	) {
		domain = entity.provider.domain ?? null;
	}
	if (provider === EntityIdentifierProviderType.AzureDevOpsServer) {
		domain = entity.provider.domain ?? null;
	}
	if (provider === EntityIdentifierProviderType.JiraServer) {
		// The host is the identity here, not a decoration: two self-hosted instances routinely issue the same
		// project and issue keys, so an identifier without it collides across them. The SDK's
		// `JiraIssueEntityIdentifierInput` says as much — its `JiraServer` arm requires `domain` where the
		// `Jira` arm requires `resourceId`.
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
	} else if (provider === EntityIdentifierProviderType.JiraServer) {
		if (!isIssue(entity) || entity.project == null) {
			throw new Error('Jira Server issues must have a project');
		}

		// `projectId` only; the SDK's `JiraServer` arm carries `domain` where Cloud carries `resourceId`, and a
		// self-hosted instance's single synthetic resource is the host the `domain` above already names.
		projectId = entity.project.id;
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
	} else if (provider === EntityIdentifierProviderType.Asana) {
		if (!isIssue(entity) || !entity.project?.resourceId) {
			throw new Error('Asana issues must have a workspace to be encoded');
		}

		// An Asana task is addressed by its gid alone; the workspace is what the SDK's identifier keys it under.
		accountOrOrgId = entity.project.resourceId;
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

	const fields: EntityIdentifierFields = {
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
	};
	return entityType === EntityType.PullRequest && !isLaunchpadItem(entity)
		? toPullRequestEntityIdentifierInput(fields)
		: fields;
}

/**
 * Narrows a pull request's identifier fields to the arm the codec encodes it by, throwing (as the codec would) when a
 * field that arm requires is missing.
 */
function toPullRequestEntityIdentifierInput(fields: EntityIdentifierFields): PullRequestEntityIdentifierInput {
	const { provider, organizationName, projectId, repoId } = fields;
	switch (provider) {
		case EntityIdentifierProviderType.Github:
		case EntityIdentifierProviderType.GithubEnterprise:
		case EntityIdentifierProviderType.Gitlab:
		case EntityIdentifierProviderType.GitlabSelfHosted:
			return { ...fields, provider: provider, entityType: EntityType.PullRequest };
		case EntityIdentifierProviderType.Bitbucket:
		case EntityIdentifierProviderType.BitbucketServer:
			if (repoId == null) throw new Error('Bitbucket PRs must have a repository ID to be encoded');

			return { ...fields, provider: provider, entityType: EntityType.PullRequest, repoId: repoId };
		case EntityIdentifierProviderType.Azure:
		case EntityIdentifierProviderType.AzureDevOpsServer:
			if (organizationName == null || projectId == null || repoId == null) {
				throw new Error('Azure PRs must have an organization, a project and a repository ID to be encoded');
			}

			return {
				...fields,
				provider: provider,
				entityType: EntityType.PullRequest,
				organizationName: organizationName,
				projectId: projectId,
				repoId: repoId,
			};
		default:
			throw new Error(`Pull requests from '${provider}' can't be encoded`);
	}
}

export function getProviderIdFromEntityIdentifier(
	entityIdentifier: EntityIdentifier | EntityIdentifierFields | EntityIdentifierInput | GitConfigEntityIdentifier,
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
		case EntityIdentifierProviderType.JiraServer:
			return IssuesSelfManagedHostIntegrationId.JiraServer;
		case EntityIdentifierProviderType.Linear:
			return IssuesCloudHostIntegrationId.Linear;
		case EntityIdentifierProviderType.Trello:
			return IssuesCloudHostIntegrationId.Trello;
		case EntityIdentifierProviderType.Asana:
			return IssuesCloudHostIntegrationId.Asana;
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
		case 'jira-server':
			return EntityIdentifierProviderType.JiraServer;
		case 'linear':
			return EntityIdentifierProviderType.Linear;
		case 'trello':
			return EntityIdentifierProviderType.Trello;
		case 'asana':
			return EntityIdentifierProviderType.Asana;
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

/**
 * Builds the git-config form of a branch-issue association from an issue (the only thing production callers pass).
 * A pull request is accepted but goes through {@link getEntityIdentifierInput}, so it throws when its provider can't
 * encode pull requests (Jira, Trello, Linear) or a field its arm requires is missing (Bitbucket and Bitbucket Server
 * need `repoId`; Azure and Azure DevOps Server need an organization, a project and `repoId`).
 */
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

		// The host is the identity of a self-hosted issue (see `getEntityIdentifierInput`); without it the
		// identifier cannot be resolved against any instance and `getIssueFromGitConfigEntityIdentifier` drops it.
		if (
			decodedEntity.provider === EntityIdentifierProviderType.JiraServer &&
			(getDomainFromEntityIdentifier(decodedEntity) == null || decodedEntity.projectId == null)
		) {
			debugger;
			Logger.error('Invalid Jira Server issue in git config');
		}
	}

	return decoded;
}

/**
 * The host a self-managed identifier names, or `undefined` for a cloud one (or a malformed self-managed one).
 * `domain` lives on some arms of `AnyEntityIdentifierInput` and on the catch-all, so the read is structural.
 */
function getDomainFromEntityIdentifier(identifier: GitConfigEntityIdentifier): string | undefined {
	const domain = 'domain' in identifier ? identifier.domain : undefined;
	return typeof domain === 'string' && domain.trim().length > 0 ? domain : undefined;
}

interface IssueResolvableIntegration {
	getIssue(owner: unknown, id: string): Promise<Issue | undefined>;
}

/**
 * Resolves the issue a branch association names.
 *
 * `resolveIntegration` receives the identifier's `domain` alongside the integration id, so a host-keyed
 * provider resolves the instance the association was encoded for rather than whichever connection is primary
 * (#5872). It is `undefined` for a cloud provider, which has a single host.
 */
export async function getIssueFromGitConfigEntityIdentifier(
	resolveIntegration: (id: IntegrationIds, domain?: string) => Promise<IssueResolvableIntegration | undefined>,
	identifier: GitConfigEntityIdentifier,
	options?: {
		/** Legacy git-host associations need configured connections to prove their host is unambiguous. */
		getConfiguredIntegrations?: (id: IntegrationIds) => readonly { domain?: string }[];
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
		identifier.provider !== EntityIdentifierProviderType.JiraServer &&
		identifier.provider !== EntityIdentifierProviderType.Linear &&
		identifier.provider !== EntityIdentifierProviderType.Github &&
		identifier.provider !== EntityIdentifierProviderType.Gitlab &&
		identifier.provider !== EntityIdentifierProviderType.GithubEnterprise &&
		identifier.provider !== EntityIdentifierProviderType.GitlabSelfHosted &&
		identifier.provider !== EntityIdentifierProviderType.Bitbucket &&
		identifier.provider !== EntityIdentifierProviderType.BitbucketServer &&
		identifier.provider !== EntityIdentifierProviderType.AzureDevOpsServer &&
		identifier.provider !== EntityIdentifierProviderType.Azure &&
		identifier.provider !== EntityIdentifierProviderType.Trello &&
		identifier.provider !== EntityIdentifierProviderType.Asana
	) {
		return undefined;
	}

	const integrationId = getProviderIdFromEntityIdentifier(identifier);
	if (integrationId == null) {
		return undefined;
	}

	let domain = getDomainFromEntityIdentifier(identifier);
	if (domain == null && isGitSelfManagedHostIntegrationId(integrationId)) {
		domain = getSingleConfiguredDomain(options?.getConfiguredIntegrations?.(integrationId) ?? []);
	}
	// Hosts can share issue keys. Legacy git associations may omit the host, but can only be recovered when
	// configuration identifies exactly one; self-hosted tracker associations always require an explicit host.
	if (domain == null && isSelfManagedHostIntegrationId(integrationId)) {
		Logger.error(`Cannot resolve a '${integrationId}' issue from git config without an unambiguous domain`);
		return undefined;
	}

	const integration = await resolveIntegration(integrationId, domain);

	const resource: ResourceDescriptor = {
		id: identifier.metadata.owner.id,
		key: identifier.metadata.owner.key,
		owner: identifier.metadata.owner.owner,
		name: identifier.metadata.owner.name,
	};
	const remoteLookupId =
		identifier.provider === EntityIdentifierProviderType.Trello ? identifier.entityId : identifier.metadata.id;

	// Cache-only read (no remote fetch). The package can't reach the host cache directly, so defer to the
	// host-supplied reader; without one, honor the no-fetch contract by returning undefined. For a cloud
	// provider the cache key is resource+id (the integration only affects the etag), so peek even when the
	// integration is unresolvable — a still-cached issue must survive an unconfigured/disconnected integration.
	// A self-managed host's key also names the host, which only a resolved integration can supply: without one
	// the peek would fall back to the unscoped key a cloud provider writes for the same resource, so skip it.
	if (options?.cached) {
		if (integration == null && isSelfManagedHostIntegrationId(integrationId)) return undefined;

		const cachedIssue = options.peekCachedIssue?.(integration, resource, identifier.metadata.id);
		if (
			cachedIssue != null ||
			(identifier.provider !== EntityIdentifierProviderType.Trello &&
				identifier.provider !== EntityIdentifierProviderType.Linear)
		) {
			return cachedIssue;
		}

		// Two id generations coexist for these providers: Trello identifiers persisted before the stable-id
		// switch carry the board-local `idShort` in `metadata.id` while the cache is keyed by the stable card
		// id (`entityId`); Linear identifiers persisted before `Issue.id` became the human identifier carry
		// the UUID in `metadata.id` while fresh cache entries key by the identifier — and vice versa, the
		// UUID always survives in `entityId` (via `nodeId`). Peeking both keys resolves either generation.
		return options.peekCachedIssue?.(integration, resource, identifier.entityId);
	}

	if (integration == null) {
		return undefined;
	}

	return integration.getIssue(resource, remoteLookupId);
}

/** An Azure DevOps project as {@link getIssueOwner} names it: the organization as `owner`, the project as `name`. */
export interface AzureProjectInputDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
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
