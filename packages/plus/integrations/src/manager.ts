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
 * One provider slice in a pull-request sweep.
 *
 * A sweep accepts at most one target per provider because its failure attribution is provider-scoped.
 * `domain` is a fallback for self-managed hosts whose authentication provider doesn't persist a configured
 * connection; a configured `connectionId` domain takes precedence when both are supplied. It must come from
 * the trusted authentication configuration, not repository or remote data.
 */
export interface ProviderSweepTarget {
	providerId: IntegrationIds;
	connectionId?: string;
	domain?: string;
}

type ProviderSweepSelection =
	| {
			targets: readonly ProviderSweepTarget[];
			providerIds?: never;
			connectionId?: never;
	  }
	| {
			targets?: never;
			providerIds?: IntegrationIds[];
			/**
			 * Legacy single-provider selector. It is ignored when `providerIds` contains more than one provider;
			 * use `targets` to select connections independently in a multi-provider sweep.
			 */
			connectionId?: string;
	  };

type PullRequestSweepCommonOptions = {
	repos?: ProviderRepositoriesInput;
	state?: PullRequestStateFilter[];
	filters?: PullRequestFilter[];
	forceSync?: boolean;
	maxPages?: number;
};

export type PullRequestSweepOptions = PullRequestSweepCommonOptions & ProviderSweepSelection;

export type ClosedPullRequestSweepOptions = Omit<PullRequestSweepCommonOptions, 'state'> & ProviderSweepSelection;

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
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
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
	sweepPullRequests(options?: PullRequestSweepOptions): Promise<ProviderSweepResult<PullRequestShape>>;
	sweepClosedPullRequests(options?: ClosedPullRequestSweepOptions): Promise<ProviderSweepResult<PullRequestShape>>;
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
