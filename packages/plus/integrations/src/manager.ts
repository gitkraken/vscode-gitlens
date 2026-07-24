import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestShape, PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
import type { Event } from '@gitlens/utils/event.js';
import type { ConfiguredIntegrationsChangeEvent } from './authentication/configuredIntegrationService.js';
import type { ConfiguredIntegrationDescriptor } from './authentication/models.js';
import type { IntegrationIds } from './constants.js';
import type { IssueFilter, PullRequestFilter } from './providerFilters.js';
import type {
	ConnectionStateChangeEvent,
	ProviderBroadenResult,
	ProviderOrganization,
	ProviderPagedResult,
	ProviderRepositoryShape,
	ProviderResult,
	ProviderSweepResult,
	ResolveRepositoryResult,
} from './results.js';

/** Neutral repository input accepted by repo-scoped provider reads. */
export interface ProviderRepositoryInput {
	namespace: string;
	name: string;
	project?: string;
	id?: string;
}

export type ProviderRepositoriesInput = (string | number)[] | ProviderRepositoryInput[];

/**
 * Public, provider-neutral integration facade. Provider clients and integration model instances remain private
 * implementation details so SDK changes don't expand this contract.
 */
export interface IntegrationManager {
	readonly onDidChange: Event<ConfiguredIntegrationsChangeEvent>;
	readonly onDidChangeConnectionState: Event<ConnectionStateChangeEvent>;

	dispose(): void;

	getConfigured(
		id?: IntegrationIds,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[];
	refreshConnections(): Promise<void>;
	setPrimaryConnection(id: IntegrationIds, connectionId: string): Promise<void>;
	deleteConnection(id: IntegrationIds, connectionId: string, cloud?: boolean): Promise<void>;

	listOrgs(options?: {
		providerId?: IntegrationIds;
		connectionId?: string;
	}): Promise<ProviderResult<ProviderOrganization>>;
	listProjects(options?: {
		providerId?: IntegrationIds;
		org?: string;
		connectionId?: string;
	}): Promise<ProviderResult<ProviderOrganization>>;
	listRepos(options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		connectionId?: string;
	}): Promise<ProviderPagedResult<ProviderRepositoryShape>>;
	listPullRequestsPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderRepositoriesInput;
		states?: PullRequestStateFilter[];
		filters?: PullRequestFilter[];
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
	}): Promise<ProviderPagedResult<PullRequestShape>>;
	listIssuesPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderRepositoriesInput;
		filters?: IssueFilter[];
		includeAllAssignees?: boolean;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
	}): Promise<ProviderPagedResult<IssueShape>>;
	listIssueTrackerIssuesPage(options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		filters?: IssueFilter[];
		includeAllAssignees?: boolean;
		forceSync?: boolean;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		connectionId?: string;
	}): Promise<ProviderPagedResult<IssueShape>>;
	sweepPullRequests(options?: {
		repos?: ProviderRepositoriesInput;
		providerIds?: IntegrationIds[];
		state?: PullRequestStateFilter[];
		filters?: PullRequestFilter[];
		forceSync?: boolean;
		connectionId?: string;
		maxPages?: number;
	}): Promise<ProviderSweepResult<PullRequestShape>>;
	sweepClosedPullRequests(options?: {
		repos?: ProviderRepositoriesInput;
		providerIds?: IntegrationIds[];
		filters?: PullRequestFilter[];
		forceSync?: boolean;
		connectionId?: string;
		maxPages?: number;
	}): Promise<ProviderSweepResult<PullRequestShape>>;
	broadenIssues(options: {
		orgs: { providerId: IntegrationIds; name: string; connectionId?: string }[];
		page?: number;
		cursor?: string;
		forceSync?: boolean;
	}): Promise<ProviderBroadenResult<IssueShape>>;
	resolveRepository(options: {
		providerId?: IntegrationIds;
		remoteUrl: string;
		host?: string;
		connectionId?: string;
	}): Promise<ResolveRepositoryResult>;
}
