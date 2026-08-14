import type { CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { IssueSearchCriteria, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequestState as PullRequestState } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestSearchCriteria,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { first } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { throwIfCallerContractError, toCollectionScopeFailure } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { toError } from '../errors.js';
import type {
	GetIssuesOptions,
	GetPullRequestsOptions,
	PagedProjectInput,
	PagedRepoInput,
	ProviderAccount,
	ProviderApiPagedResult,
	ProviderHierarchyResult,
	ProviderIssue,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
	ProviderRepository,
} from '../providers/models.js';
import {
	IssueFilter,
	PagingMode,
	PullRequestFilter,
	toIssueShape,
	toProviderIssueStates,
	toProviderPullRequestStates,
} from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { mergeCollectionMetadata } from '../providers/utils/providerPaging.js';
import type {
	IntegrationResult,
	IntegrationType,
	ProviderIssueSearchPage,
	ProviderPullRequestSearchPage,
} from './integration.js';
import { IntegrationBase } from './integration.js';
import type { MyIssuesForReposOptions } from './issueReads.js';

function isAzureDevOpsProvider(
	providerId: IntegrationIds,
): providerId is GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer {
	return (
		providerId === GitCloudHostIntegrationId.AzureDevOps ||
		providerId === GitSelfManagedHostIntegrationId.AzureDevOpsServer
	);
}

function normalizeSelfManagedBaseUrl(domain: string | undefined, protocol: string | undefined): string | undefined {
	const value = domain?.trim();
	if (!value) return undefined;

	if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
		try {
			const url = new URL(value);
			return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
		} catch {
			return undefined;
		}
	}

	const scheme = protocol ?? 'https:';
	try {
		const url = new URL(`${scheme}//${value}`);
		return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
	} catch {
		return undefined;
	}
}

function getSelfManagedApiBaseUrl(
	providerId: IntegrationIds,
	domain: string | undefined,
	protocol: string | undefined,
): string | undefined {
	const baseUrl = normalizeSelfManagedBaseUrl(domain, protocol);
	if (baseUrl == null) return undefined;

	switch (providerId) {
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return `${baseUrl.replace(/\/api(?:\/v\d+)?$/, '')}/api/v3`;
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return baseUrl.replace(/\/api(?:\/v\d+)?$/, '');
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return `${baseUrl.replace(/\/rest\/api\/1\.0$/, '')}/rest/api/1.0`;
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return baseUrl;
		default:
			return undefined;
	}
}

export type SearchMyPullRequestsOptions = {
	includeReviewRequested?: boolean;
};

/**
 * Rejects a read the provider can't serve as asked: logs the reason and returns it as the `{ error }` half of an
 * {@link IntegrationResult}, timed from `start`.
 *
 * A single builder because these refusals are a contract, not incidental returns — the read cores below reject on
 * unsupported input, an inexpressible filter set, or an unresolvable filter account, and each one must reach the
 * caller as an error it can surface as a warning rather than as an empty success. Writing the message once also
 * keeps the logged text and the thrown text from drifting apart, which is exactly what happened while each site
 * spelled its message out twice.
 */
function unsupportedRead<T>(message: string, start: number, logContext?: string): IntegrationResult<T> {
	Logger.warn(message, logContext);
	return { error: new Error(message), duration: performance.now() - start };
}

export abstract class GitHostIntegration<
	ID extends IntegrationIds = IntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> extends IntegrationBase<ID> {
	readonly type: IntegrationType = 'git';

	@gate()
	@trace()
	async getAccountForEmail(repo: T, email: string, options?: { avatarSize?: number }): Promise<Account | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const author = await this.getProviderAccountForEmail(this._session!, repo, email, options);
			this.resetRequestExceptionCount('getAccountForEmail');
			return author;
		} catch (ex) {
			this.handleProviderException('getAccountForEmail', ex, { scope: scope });
			return undefined;
		}
	}

	protected abstract getProviderAccountForEmail(
		session: ProviderAuthenticationSession,
		repo: T,
		email: string,
		options?: { avatarSize?: number },
	): Promise<Account | undefined>;

	/**
	 * Returns the SSH signing keys (full OpenSSH-format `<type> <key> [comment]` strings) registered by the accounts
	 * matching the given emails on this integration, for building an `allowed_signers` file. Keyed by lowercased email;
	 * emails with no match (and unsupported integrations) are absent. Batching the lookups is left to the integration.
	 */
	@gate()
	@trace()
	async getSshSigningKeysForEmails(repo: T, emails: string[]): Promise<Map<string, string[]>> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return new Map();

		await this.refreshSessionIfExpired(scope);

		try {
			const keys = await this.getProviderSshSigningKeysForEmails(this._session!, repo, emails);
			this.resetRequestExceptionCount('getSshSigningKeysForEmails');
			return keys;
		} catch (ex) {
			this.handleProviderException('getSshSigningKeysForEmails', ex, { scope: scope });
			return new Map();
		}
	}

	/** Override in integrations that expose users' SSH signing keys. Defaults to none. */
	protected getProviderSshSigningKeysForEmails(
		_session: ProviderAuthenticationSession,
		_repo: T,
		_emails: string[],
	): Promise<Map<string, string[]>> {
		return Promise.resolve(new Map<string, string[]>());
	}

	@gate()
	@trace()
	async getAccountForCommit(
		repo: T,
		rev: string,
		options?: { avatarSize?: number },
	): Promise<Account | UnidentifiedAuthor | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const author = await this.getProviderAccountForCommit(this._session!, repo, rev, options);
			this.resetRequestExceptionCount('getAccountForCommit');
			return author;
		} catch (ex) {
			this.handleProviderException('getAccountForCommit', ex, { scope: scope });
			return undefined;
		}
	}

	protected abstract getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: T,
		rev: string,
		options?: { avatarSize?: number },
	): Promise<Account | UnidentifiedAuthor | undefined>;

	@trace()
	async getDefaultBranch(
		repo: T,
		options?: { cancellation?: AbortSignal; expiryOverride?: boolean | number },
	): Promise<DefaultBranch | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const defaultBranch = this.ctx.cache.getRepositoryDefaultBranch(
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderDefaultBranch(this._session!, repo, options?.cancellation);
						this.resetRequestExceptionCount('getDefaultBranch');
						return result;
					} catch (ex) {
						this.handleProviderException('getDefaultBranch', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			{ expiryOverride: options?.expiryOverride },
		);
		return defaultBranch;
	}

	getRepoInfo?(repo: {
		owner: string;
		name: string;
		project?: string;
		connectionId?: string;
	}): Promise<ProviderRepository | undefined>;

	protected abstract getProviderDefaultBranch(
		{ accessToken }: ProviderAuthenticationSession,
		repo: T,
		cancellation?: AbortSignal,
	): Promise<DefaultBranch | undefined>;

	@trace()
	async getRepositoryMetadata(
		repo: T,
		options?: { cancellation?: AbortSignal; expiryOverride?: boolean | number },
	): Promise<RepositoryMetadata | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const metadata = this.ctx.cache.getRepositoryMetadata(
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderRepositoryMetadata(
							this._session!,
							repo,
							options?.cancellation,
						);
						this.resetRequestExceptionCount('getRepositoryMetadata');
						return result;
					} catch (ex) {
						this.handleProviderException('getRepositoryMetadata', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			{ expiryOverride: options?.expiryOverride },
		);
		return metadata;
	}

	protected abstract getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: T,
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined>;

	/**
	 * Whether this git host implements generic org discovery. False for providers that register no
	 * {@link getProviderOrganizationsForUser} hook (e.g. Bitbucket Data Center) — the facade uses this to
	 * report `unsupported` instead of a silent empty list, which is indistinguishable from "has no orgs".
	 */
	get supportsOrganizationDiscovery(): boolean {
		return this.getProviderOrganizationsForUser != null;
	}

	/** Whether this git host implements generic repository discovery ({@link getProviderRepositoriesForOrg}). */
	get supportsRepositoryDiscovery(): boolean {
		return this.getProviderRepositoriesForOrg != null;
	}

	/**
	 * Whether this git host has a project tier between org and repo ({@link getProviderProjectsForOrg}). Only
	 * Azure DevOps does; the facade uses this to skip the read entirely rather than call a core that returns
	 * `undefined` for a session-less reason and be misread as a broken connection.
	 */
	get supportsProjectDiscovery(): boolean {
		return this.getProviderProjectsForOrg != null;
	}

	/**
	 * Whether this git host implements the account-wide user-affiliated repository read
	 * ({@link getProviderRepositoriesForUser}) — the org-less `gk provider repos <provider>` equivalent.
	 */
	get supportsUserRepositoryDiscovery(): boolean {
		return this.getProviderRepositoriesForUser != null;
	}

	/**
	 * Whether this git host exposes issues on the ProviderBackend surface. Most git hosts do; a host with no
	 * usable issue tracker overrides this to false — Bitbucket Cloud (deprecated in favor of dedicated issue
	 * integrations like Jira) and Bitbucket Data Center (never had one) — so the facade reports issues as
	 * unsupported instead of serving a partial/deprecated source or failing inside a provider client that
	 * registers no issue function at all.
	 *
	 * Keep this in sync with {@link ProviderMetadata.supportedIssueFilters}: a provider that declares no issue
	 * filters and no issue read is answering the same capability question twice, and the two must agree.
	 */
	get supportsIssues(): boolean {
		return true;
	}

	/**
	 * Lists the organizations (orgs/workspaces/groups) the current user belongs to on this host.
	 * `truncated === true` means the defensive page-drain backstop stopped before the upstream listing was
	 * exhausted.
	 *
	 * Resolves the session for `connectionId` (or the primary connection when omitted, honoring multi-account
	 * reads) and recovers a thrown error into `{ error }` so callers can surface it as a warning instead of
	 * swallowing it to `undefined`.
	 */
	@trace()
	async getOrganizationsForUserResult(
		connectionId?: string,
	): Promise<IntegrationResult<ProviderHierarchyResult<ProviderOrganization> | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		try {
			const result = await this.getProviderOrganizationsForUser?.(session);
			this.resetRequestExceptionCount('getOrganizationsForUser');
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('getOrganizationsForUser', ex, {
				scope: scope,
				connectionId: connectionId,
			});
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	protected getProviderOrganizationsForUser?(
		session: ProviderAuthenticationSession,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined>;

	/**
	 * Result-returning list of the projects a git host exposes beneath its orgs, unified into the
	 * {@link ProviderOrganization} shape. Only Azure DevOps has a project tier between org and repo; other
	 * git hosts have none and leave {@link getProviderProjectsForOrg} undefined, so this returns `undefined`
	 * for them (the ProviderBackend facade then treats them as having no projects). With `org`, scopes to
	 * that org's projects; without, returns projects across every org the user can see.
	 */
	@trace()
	async getProjectsForOrgResult(
		org?: string,
		connectionId?: string,
	): Promise<IntegrationResult<ProviderHierarchyResult<ProviderOrganization> | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		if (this.getProviderProjectsForOrg == null) {
			return undefined;
		}

		const start = performance.now();
		try {
			const result = await this.getProviderProjectsForOrg(session, org);
			this.resetRequestExceptionCount('getProjectsForOrg');
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('getProjectsForOrg', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	protected getProviderProjectsForOrg?(
		session: ProviderAuthenticationSession,
		org?: string,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined>;

	/**
	 * Lists repositories under the given organization (org/workspace/group) one page at a time — follow
	 * `paging.cursor` to page, or drain with the integrations provider paging helper.
	 * `options.project` is only meaningful for Azure DevOps, whose repos are scoped by `org` + `project`;
	 * every other host ignores it. (Azure without a project can't page its cross-project merge, so it
	 * returns all matches in a single page.) `truncated === true` means the defensive page-drain
	 * backstop stopped before the upstream listing was exhausted.
	 *
	 * Resolves the session for `connectionId` (or the primary connection when omitted) and recovers a thrown
	 * error into `{ error }`, so a caller surfaces it as a warning instead of a silent `undefined`.
	 */
	@trace()
	async getRepositoriesForOrgResult(
		org: string,
		options?: { project?: string; cursor?: string; connectionId?: string },
	): Promise<IntegrationResult<ProviderHierarchyResult<ProviderRepository> | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(options?.connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		try {
			const result = await this.getProviderRepositoriesForOrg?.(session, org, options);
			this.resetRequestExceptionCount('getRepositoriesForOrg');
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('getRepositoriesForOrg', ex, {
				scope: scope,
				connectionId: options?.connectionId,
			});
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	protected getProviderRepositoriesForOrg?(
		session: ProviderAuthenticationSession,
		org: string,
		options?: { project?: string; cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined>;

	/**
	 * Result-returning account-wide, user-affiliated repository read (the org-less
	 * `gk provider repos <provider>` equivalent): repositories the user owns, collaborates on, or can
	 * access through org membership — NOT every repo of every org. Optional: providers without a native
	 * user-affiliated listing (Bitbucket workspaces, Azure orgs, which require an org/workspace scope)
	 * leave the hook undefined and the facade reports the read as unsupported so callers fan out per org.
	 */
	@trace()
	async getRepositoriesForUserResult(options?: {
		cursor?: string;
		connectionId?: string;
	}): Promise<IntegrationResult<ProviderHierarchyResult<ProviderRepository> | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(options?.connectionId, scope);
		if (session == null) return undefined;

		if (this.getProviderRepositoriesForUser == null) {
			return undefined;
		}

		const start = performance.now();
		try {
			const result = await this.getProviderRepositoriesForUser(session, options);
			this.resetRequestExceptionCount('getRepositoriesForUser');
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('getRepositoriesForUser', ex, {
				scope: scope,
				connectionId: options?.connectionId,
			});
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	protected getProviderRepositoriesForUser?(
		session: ProviderAuthenticationSession,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined>;

	async mergePullRequest(pr: PullRequest, options?: { mergeMethod?: PullRequestMergeMethod }): Promise<boolean> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return false;

		await this.refreshSessionIfExpired(scope);

		try {
			const result = await this.mergeProviderPullRequest(this._session!, pr, options);
			this.resetRequestExceptionCount('mergePullRequest');
			return result;
		} catch (ex) {
			this.handleProviderException('mergePullRequest', ex, { scope: scope });
			return false;
		}
	}

	protected abstract mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: { mergeMethod?: PullRequestMergeMethod },
	): Promise<boolean>;

	@trace()
	async getPullRequestForBranch(
		repo: T,
		branch: string,
		options?: { avatarSize?: number; expiryOverride?: boolean | number; include?: PullRequestState[] },
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const { expiryOverride, ...opts } = options ?? {};

		const pr = this.ctx.cache.getPullRequestForBranch(
			branch,
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderPullRequestForBranch(this._session!, repo, branch, opts);
						this.resetRequestExceptionCount('getPullRequestForBranch');
						return result;
					} catch (ex) {
						this.handleProviderException('getPullRequestForBranch', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			{ expiryOverride: expiryOverride },
		);
		return pr;
	}

	protected abstract getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: T,
		branch: string,
		options?: { avatarSize?: number; include?: PullRequestState[] },
	): Promise<PullRequest | undefined>;

	@trace()
	async getPullRequestForCommit(
		repo: T,
		rev: string,
		options?: { expiryOverride?: boolean | number },
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const pr = this.ctx.cache.getPullRequestForSha(
			rev,
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderPullRequestForCommit(this._session!, repo, rev);
						this.resetRequestExceptionCount('getPullRequestForCommit');
						return result;
					} catch (ex) {
						this.handleProviderException('getPullRequestForCommit', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			options,
		);
		return pr;
	}

	protected abstract getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: T,
		rev: string,
	): Promise<PullRequest | undefined>;

	/**
	 * Memoized identity lookups backing filter resolution. Keyed by the session's token fingerprint plus the
	 * scope of the lookup (base URL, and the Azure organization for the per-instance variant), so a different
	 * account, host, or org never reuses an entry and a rotated token simply misses.
	 *
	 * Not cleared when the token changes: one integration instance serves every connection of its provider
	 * (multi-account), so clearing on a fingerprint change would make two accounts reading in alternation
	 * evict each other and defeat the memo. Entries are bounded by tokens x hosts x orgs seen — a handful for
	 * the life of the integration.
	 */
	private readonly _filterAccounts = new Map<string, Promise<ProviderAccount | undefined>>();

	/**
	 * Resolves the account a repo-scoped read turns `IssueFilter`/`PullRequestFilter` into a provider
	 * login/id with, memoized per token+scope.
	 *
	 * Every FILTERED read needs this, and `ProvidersApi.getCurrentUser` is a bare round trip — unlike
	 * {@link IntegrationBase.getCurrentAccount}, which the host caches. So a consumer that fans ONE page out
	 * into several filtered reads paid one identity request PER read, all resolving the same account: a
	 * per-user-facet fan-out (author + assignee + review-requested) doubled its request count, and paid it
	 * again on every page turn.
	 *
	 * The promise is memoized rather than the value, so concurrent facets share one in-flight request instead
	 * of racing. A rejection is evicted so the next read retries rather than caching a failure — matching how
	 * `getCurrentAccount` invalidates on error.
	 */
	private getFilterAccount(
		api: ProvidersApi,
		session: ProviderAuthenticationSession,
		customUrl: string | undefined,
		organization?: string,
	): Promise<ProviderAccount | undefined> {
		const key = `${this.getSessionFingerprint(session)}:${customUrl ?? ''}:${organization ?? ''}`;

		let pending = this._filterAccounts.get(key);
		if (pending == null) {
			const tokenWithInfo = toTokenWithInfo(this.authProvider.id, session);
			pending = (
				organization != null
					? api.getCurrentUserForInstance(tokenWithInfo, organization, { baseUrl: customUrl })
					: api.getCurrentUser(tokenWithInfo, { baseUrl: customUrl })
			).catch((ex: unknown) => {
				this._filterAccounts.delete(key);
				throw ex;
			});
			this._filterAccounts.set(key, pending);
		}

		return pending;
	}

	async getMyIssuesForRepos(
		reposOrRepoIds: ProviderReposInput,
		options?: MyIssuesForReposOptions,
		connectionId?: string,
	): Promise<PagedResult<ProviderIssue> | undefined> {
		return (await this.getMyIssuesForReposResult(reposOrRepoIds, options, connectionId))?.value;
	}

	/**
	 * Result-returning core of {@link getMyIssuesForRepos}. Resolves the session for `connectionId`
	 * (or the primary connection when omitted, so multi-account reads use the right token) and recovers
	 * thrown errors and validation failures into `{ error }` so callers can surface them as warnings
	 * rather than swallowing them to `undefined`.
	 */
	async getMyIssuesForReposResult(
		reposOrRepoIds: ProviderReposInput,
		options?: MyIssuesForReposOptions,
		connectionId?: string,
	): Promise<IntegrationResult<(PagedResult<ProviderIssue> & { metadata?: CollectionMetadata }) | undefined>> {
		const scope = getScopedLogger();
		const providerId = this.authProvider.id;
		const states = toProviderIssueStates(options?.state);
		// `connectionId` targets a specific account (multi-account); omitted reads the primary. The session
		// is resolved here for connectivity/bail; the connection's token is applied per API call below.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		const customUrl =
			options?.customUrl ?? getSelfManagedApiBaseUrl(providerId, session.domain || this.domain, session.protocol);

		const api = await this.getProvidersApi();
		if (
			providerId !== GitCloudHostIntegrationId.GitLab &&
			(api.isRepoIdsInput(reposOrRepoIds) ||
				(isAzureDevOpsProvider(providerId) &&
					!reposOrRepoIds.every(repo => repo.project != null && repo.namespace != null)))
		) {
			return unsupportedRead(`Unsupported input for provider ${providerId}`, start, 'getIssuesForRepos');
		}

		let getIssuesOptions: GetIssuesOptions | undefined;
		if (isAzureDevOpsProvider(providerId)) {
			const organizations = new Set<string>();
			const projects = new Set<string>();
			for (const repo of reposOrRepoIds as ProviderRepoInput[]) {
				organizations.add(repo.namespace);
				projects.add(repo.project!);
			}

			if (organizations.size > 1) {
				return unsupportedRead(
					`Multiple organizations not supported for provider ${providerId}`,
					start,
					'getIssuesForRepos',
				);
			} else if (organizations.size === 0) {
				return unsupportedRead(`No organizations found for provider ${providerId}`, start, 'getIssuesForRepos');
			}

			const organization: string = first(organizations.values())!;

			if (options?.filters != null) {
				if (!api.providerSupportsIssueFilters(providerId, options.filters)) {
					return unsupportedRead(
						`Unsupported filters for provider ${providerId}`,
						start,
						'getIssuesForRepos',
					);
				}

				let userAccount: ProviderAccount | undefined;
				try {
					userAccount = await this.getFilterAccount(api, session, customUrl, organization);
				} catch (ex) {
					Logger.error(ex, 'getIssuesForRepos');
					return { error: toError(ex), duration: performance.now() - start };
				}

				if (userAccount == null) {
					return unsupportedRead(`Unable to get current user for ${providerId}`, start, 'getIssuesForRepos');
				}

				const userFilterProperty = userAccount.name;

				if (userFilterProperty == null) {
					return unsupportedRead(
						`Unable to get user property for filter for ${providerId}`,
						start,
						'getIssuesForRepos',
					);
				}

				getIssuesOptions = {
					authorLogin: options.filters.includes(IssueFilter.Author) ? userFilterProperty : undefined,
					assigneeLogins:
						!options.includeAllAssignees && options.filters.includes(IssueFilter.Assignee)
							? [userFilterProperty]
							: undefined,
					mentionLogin: options.filters.includes(IssueFilter.Mention) ? userFilterProperty : undefined,
				};
			}

			const cursorInfo = this.parseCursorInfo<PagedProjectInput>(options?.cursor);
			const cursors: PagedProjectInput[] = cursorInfo.cursors ?? [];
			let projectInputs: PagedProjectInput[] = Array.from(projects.values(), project => ({
				namespace: organization,
				project: project,
				cursor: undefined,
			}));
			if (cursors.length > 0) {
				projectInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedProjectInput[]; page?: number } = { cursors: [] };
				let hasMore = false;
				let truncated = false;
				let metadata: CollectionMetadata | undefined;
				const data: ProviderIssue[] = [];
				// `allSettled`, not `Promise.all`: one project's read rejecting must not discard every sibling
				// project's already-fetched issues and cursors. A rejected project is recorded as a structured
				// failure so the facade can warn and set `fetchFailed` instead of reporting a partial project set
				// as complete.
				const settled = await Promise.allSettled(
					projectInputs.map(async projectInput => {
						const results = await api.getIssuesForAzureProject(
							toTokenWithInfo(providerId, session),
							projectInput.namespace,
							projectInput.project,
							{
								...getIssuesOptions,
								cursor: projectInput.cursor,
								baseUrl: customUrl,
								// Continuation is driven by the per-project cursor; only apply an explicit page on the
								// first request so it can't clobber a continuation cursor on later pages.
								page: projectInput.cursor == null ? options?.page : undefined,
								pageSize: options?.pageSize,
								states: states,
								sort: options?.sort,
							},
						);
						return { projectInput: projectInput, results: results };
					}),
				);

				for (let i = 0; i < settled.length; i++) {
					const outcome = settled[i];
					const projectInput = projectInputs[i];
					if (outcome.status !== 'fulfilled') {
						// Errors that really are per-scope (auth, rate limit, a missing project) degrade below; one
						// that is a fact about the call is re-thrown instead — see `throwIfCallerContractError`.
						throwIfCallerContractError(outcome.reason);

						truncated = true;
						const failure = toCollectionScopeFailure(
							{
								providerId: providerId,
								resourceId: projectInput.namespace,
								projectId: projectInput.project,
							},
							outcome.reason,
						);
						metadata = mergeCollectionMetadata(metadata, {
							completeness: 'partial',
							failures: [failure],
						});
						continue;
					}

					const { projectInput: _projectInput, results } = outcome.value;
					data.push(...results.values);
					if (results.paging?.more) {
						hasMore = true;
						cursor.cursors.push({
							namespace: projectInput.namespace,
							project: projectInput.project,
							cursor: results.paging.cursor,
						});
					}
				}

				// Keep the requested page number in the composite cursor so the facade can report the real
				// currentPage when the consumer continues using only the cursor.
				if (options?.page != null) {
					cursor.page = options.page;
				}

				return {
					value: {
						values: data,
						paging: {
							more: hasMore,
							cursor: JSON.stringify(cursor),
							truncated: truncated || undefined,
							// Echo the requested numbered page so the facade reports the real currentPage for
							// numbered-page hosts (GitLab/Bitbucket/Azure), not a synthesized 1. Cursor-only hosts
							// leave `page` undefined via their own reads.
							page: options?.page,
						},
						metadata: metadata,
					},
					duration: performance.now() - start,
				};
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return { error: toError(ex), duration: performance.now() - start };
			}
		}
		if (options?.filters != null) {
			// Validate the requested filters against what this provider actually supports — same guard the Azure
			// branch above applies. Without it an unsupported filter (e.g. GitLab has no Mention endpoint) would
			// resolve to no filter property being set and silently degrade to an unfiltered, project-wide read.
			if (!api.providerSupportsIssueFilters(providerId, options.filters)) {
				return unsupportedRead(`Unsupported filters for provider ${providerId}`, start, 'getIssuesForRepos');
			}

			let userAccount: ProviderAccount | undefined;
			try {
				userAccount = await this.getFilterAccount(api, session, customUrl);
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return { error: toError(ex), duration: performance.now() - start };
			}

			if (userAccount == null) {
				return unsupportedRead(`Unable to get current user for ${providerId}`, start, 'getIssuesForRepos');
			}

			const userFilterProperty = userAccount.username;
			if (userFilterProperty == null) {
				return unsupportedRead(
					`Unable to get user property for filter for ${providerId}`,
					start,
					'getIssuesForRepos',
				);
			}

			getIssuesOptions = {
				authorLogin: options.filters.includes(IssueFilter.Author) ? userFilterProperty : undefined,
				assigneeLogins:
					!options.includeAllAssignees && options.filters.includes(IssueFilter.Assignee)
						? [userFilterProperty]
						: undefined,
				mentionLogin: options.filters.includes(IssueFilter.Mention) ? userFilterProperty : undefined,
			};
		}

		if (api.getProviderIssuesPagingMode(providerId) === PagingMode.Repo && !api.isRepoIdsInput(reposOrRepoIds)) {
			const cursorInfo = this.parseCursorInfo<PagedRepoInput>(options?.cursor);
			const cursors: PagedRepoInput[] = cursorInfo.cursors ?? [];
			let repoInputs: PagedRepoInput[] = reposOrRepoIds.map(repo => ({ repo: repo, cursor: undefined }));
			if (cursors.length > 0) {
				repoInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedRepoInput[]; page?: number } = { cursors: [] };
				let hasMore = false;
				let truncated = false;
				let metadata: CollectionMetadata | undefined;
				const data: ProviderIssue[] = [];
				// `allSettled`, not `Promise.all`: one repo's read rejecting must not discard every sibling repo's
				// already-fetched issues and cursors. A rejected repo is recorded as a structured failure so the
				// facade can warn and set `fetchFailed` instead of reporting a partial repo set as complete.
				const settled = await Promise.allSettled(
					repoInputs.map(async repoInput => {
						const results = await api.getIssuesForRepo(
							toTokenWithInfo(providerId, session),
							repoInput.repo,
							{
								...getIssuesOptions,
								cursor: repoInput.cursor,
								baseUrl: customUrl,
								// Continuation is driven by the per-repo cursor; only apply an explicit page on the
								// first request so it can't clobber a continuation cursor on later pages.
								page: repoInput.cursor == null ? options?.page : undefined,
								pageSize: options?.pageSize,
								states: states,
								sort: options?.sort,
							},
						);
						return { repoInput: repoInput, results: results };
					}),
				);

				for (let i = 0; i < settled.length; i++) {
					const outcome = settled[i];
					const repoInput = repoInputs[i];
					if (outcome.status !== 'fulfilled') {
						// See the project fan-out above. Reachable in practice even though the facade validates the
						// key first — a self-managed GitLab can reject an `IssueSort` member the SDK declares, which
						// is only discoverable from the response.
						throwIfCallerContractError(outcome.reason);

						truncated = true;
						const failure = toCollectionScopeFailure(
							{
								providerId: providerId,
								repositoryId: `${repoInput.repo.namespace}/${repoInput.repo.name}`,
							},
							outcome.reason,
						);
						metadata = mergeCollectionMetadata(metadata, {
							completeness: 'partial',
							failures: [failure],
						});
						continue;
					}

					const { repoInput: _repoInput, results } = outcome.value;
					data.push(...results.values);
					if (results.paging?.more) {
						hasMore = true;
						cursor.cursors.push({ repo: repoInput.repo, cursor: results.paging.cursor });
					}
				}

				if (options?.page != null) {
					cursor.page = options.page;
				}

				return {
					value: {
						values: data,
						paging: {
							more: hasMore,
							cursor: JSON.stringify(cursor),
							truncated: truncated || undefined,
							// Echo the requested numbered page so the facade reports the real currentPage for
							// numbered-page hosts (GitLab/Bitbucket/Azure), not a synthesized 1. Cursor-only hosts
							// leave `page` undefined via their own reads.
							page: options?.page,
						},
						metadata: metadata,
					},
					duration: performance.now() - start,
				};
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return { error: toError(ex), duration: performance.now() - start };
			}
		}

		try {
			const result = await api.getIssuesForRepos(toTokenWithInfo(providerId, session), reposOrRepoIds, {
				...getIssuesOptions,
				cursor: options?.cursor,
				baseUrl: customUrl,
				page: options?.page,
				pageSize: options?.pageSize,
				states: states,
				sort: options?.sort,
			});
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			Logger.error(ex, 'getIssuesForRepos');
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/**
	 * Repo-scoped "my issues" read returning the normalized {@link IssueShape} the ProviderBackend facade
	 * consumes (`listIssuesPage({ repos })`, `broadenIssues`). Maps {@link getMyIssuesForReposResult} — the raw
	 * provider-apis path — to IssueShape.
	 *
	 * It's the seam rather than an inline map so a provider whose only issue client already yields normalized
	 * shapes, and isn't wired into the raw path, can override it and serve these reads without a
	 * `ProviderIssue` round-trip. No provider does today: the one candidate (Bitbucket Cloud's legacy
	 * `getUsersIssuesForRepo`) reports `supportsIssues: false`, so the facade never reaches this for it.
	 */
	async getMyIssuesForReposAsShapesResult(
		reposOrRepoIds: ProviderReposInput,
		options?: MyIssuesForReposOptions,
		connectionId?: string,
	): Promise<IntegrationResult<(PagedResult<IssueShape> & { metadata?: CollectionMetadata }) | undefined>> {
		const result = await this.getMyIssuesForReposResult(reposOrRepoIds, options, connectionId);
		if (result == null) return undefined;
		if (result.error != null) return { error: result.error, duration: result.duration };
		if (result.value == null) return { value: undefined, duration: result.duration };

		const values = result.value.values
			.map(issue => toIssueShape(issue, this))
			.filter((issue): issue is IssueShape => issue != null);
		return { value: { ...result.value, values: values }, duration: result.duration };
	}

	async getMyPullRequestsForRepos(
		reposOrRepoIds: ProviderReposInput,
		options?: {
			filters?: PullRequestFilter[];
			cursor?: string;
			customUrl?: string;
			page?: number;
			pageSize?: number;
			/** PR states to include; when omitted the provider returns its default (open only). */
			state?: PullRequestStateFilter | PullRequestStateFilter[];
		},
		connectionId?: string,
	): Promise<ProviderApiPagedResult<ProviderPullRequest> | undefined> {
		return (await this.getMyPullRequestsForReposResult(reposOrRepoIds, options, connectionId))?.value;
	}

	/**
	 * Result-returning core of {@link getMyPullRequestsForRepos}. Resolves the session for `connectionId`
	 * (or the primary connection when omitted, so multi-account reads use the right token) and recovers
	 * thrown errors and validation failures into `{ error }` so callers can surface them as warnings
	 * rather than swallowing them to `undefined`.
	 */
	async getMyPullRequestsForReposResult(
		reposOrRepoIds: ProviderReposInput,
		options?: {
			filters?: PullRequestFilter[];
			cursor?: string;
			customUrl?: string;
			page?: number;
			pageSize?: number;
			state?: PullRequestStateFilter | PullRequestStateFilter[];
		},
		connectionId?: string,
	): Promise<IntegrationResult<ProviderApiPagedResult<ProviderPullRequest> | undefined>> {
		const scope = getScopedLogger();
		const providerId = this.authProvider.id;
		const states = toProviderPullRequestStates(options?.state);
		// `connectionId` targets a specific account (multi-account); omitted reads the primary. The session
		// is resolved here for connectivity/bail; the connection's token is applied per API call below.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		const customUrl =
			options?.customUrl ?? getSelfManagedApiBaseUrl(providerId, session.domain || this.domain, session.protocol);

		const api = await this.getProvidersApi();
		if (
			providerId !== GitCloudHostIntegrationId.GitLab &&
			(api.isRepoIdsInput(reposOrRepoIds) ||
				(isAzureDevOpsProvider(providerId) &&
					!reposOrRepoIds.every(repo => repo.project != null && repo.namespace != null)))
		) {
			return unsupportedRead(`Unsupported input for provider ${providerId}`, start);
		}

		let getPullRequestsOptions: GetPullRequestsOptions | undefined;
		if (options?.filters != null) {
			if (!api.providerSupportsPullRequestFilters(providerId, options.filters)) {
				return unsupportedRead(
					`Unsupported filters for provider ${providerId}`,
					start,
					'getPullRequestsForRepos',
				);
			}

			let userAccount: ProviderAccount | undefined;
			if (isAzureDevOpsProvider(providerId)) {
				const organizations = new Set<string>();
				for (const repo of reposOrRepoIds as ProviderRepoInput[]) {
					organizations.add(repo.namespace);
				}

				if (organizations.size > 1) {
					Logger.warn(
						`Multiple organizations not supported for provider ${providerId}`,
						'getPullRequestsForRepos',
					);
					return {
						error: new Error(`Multiple organizations not supported for provider ${providerId}`),
						duration: performance.now() - start,
					};
				} else if (organizations.size === 0) {
					return unsupportedRead(
						`No organizations found for provider ${providerId}`,
						start,
						'getPullRequestsForRepos',
					);
				}

				const organization: string = first(organizations.values())!;
				try {
					userAccount = await this.getFilterAccount(api, session, customUrl, organization);
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return { error: toError(ex), duration: performance.now() - start };
				}
			} else {
				try {
					userAccount = await this.getFilterAccount(api, session, customUrl);
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return { error: toError(ex), duration: performance.now() - start };
				}
			}

			if (userAccount == null) {
				return unsupportedRead(
					`Unable to get current user for ${providerId}`,
					start,
					'getPullRequestsForRepos',
				);
			}

			let userFilterProperty: string | null;
			switch (providerId) {
				case GitCloudHostIntegrationId.Bitbucket:
				case GitCloudHostIntegrationId.AzureDevOps:
				case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
					userFilterProperty = userAccount.id;
					break;
				default:
					userFilterProperty = userAccount.username;
					break;
			}

			if (userFilterProperty == null) {
				return unsupportedRead(
					`Unable to get user property for filter for ${providerId}`,
					start,
					'getPullRequestsForRepos',
				);
			}

			// Route the "review requested from me" filter to the field each provider actually reads:
			// GitHub/GitLab expect a login (reviewRequestedLogin), Bitbucket/Azure an account id (reviewerId),
			// and Bitbucket Server a login (reviewerLogin). `userFilterProperty` is already the account id for
			// Bitbucket/Azure and the username for the rest.
			let reviewRequestedLogin: string | undefined;
			let reviewerId: string | undefined;
			let reviewerLogin: string | undefined;
			if (options.filters.includes(PullRequestFilter.ReviewRequested)) {
				switch (providerId) {
					case GitCloudHostIntegrationId.Bitbucket:
					case GitCloudHostIntegrationId.AzureDevOps:
					case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
						reviewerId = userFilterProperty;
						break;
					case GitSelfManagedHostIntegrationId.BitbucketServer:
						reviewerLogin = userFilterProperty;
						break;
					default:
						reviewRequestedLogin = userFilterProperty;
						break;
				}
			}

			getPullRequestsOptions = {
				authorLogin: options.filters.includes(PullRequestFilter.Author) ? userFilterProperty : undefined,
				assigneeLogins: options.filters.includes(PullRequestFilter.Assignee) ? [userFilterProperty] : undefined,
				reviewRequestedLogin: reviewRequestedLogin,
				reviewerId: reviewerId,
				reviewerLogin: reviewerLogin,
				mentionLogin: options.filters.includes(PullRequestFilter.Mention) ? userFilterProperty : undefined,
			};
		}

		if (
			api.getProviderPullRequestsPagingMode(providerId) === PagingMode.Repo &&
			!api.isRepoIdsInput(reposOrRepoIds)
		) {
			const cursorInfo = this.parseCursorInfo<PagedRepoInput>(options?.cursor);
			const cursors: PagedRepoInput[] = cursorInfo.cursors ?? [];
			let repoInputs: PagedRepoInput[] = reposOrRepoIds.map(repo => ({ repo: repo, cursor: undefined }));
			if (cursors.length > 0) {
				repoInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedRepoInput[]; page?: number } = { cursors: [] };
				let hasMore = false;
				let truncated = false;
				let metadata: CollectionMetadata | undefined;
				const failures: CollectionScopeFailure[] = [];
				const data: ProviderPullRequest[] = [];
				// `allSettled`, not `Promise.all`: one repo's read rejecting must not discard every sibling repo's
				// already-fetched PRs and cursors. A rejected repo becomes a structured `CollectionScopeFailure`
				// (attributed to that repo) so the facade warns on it + sets `fetchFailed`, while the survivors and
				// their continuation cursors are still returned.
				const settled = await Promise.allSettled(
					repoInputs.map(async repoInput => {
						const results = await api.getPullRequestsForRepo(
							toTokenWithInfo(providerId, session),
							repoInput.repo,
							{
								...getPullRequestsOptions,
								cursor: repoInput.cursor,
								baseUrl: customUrl,
								// Continuation is driven by the per-repo cursor; only apply an explicit page on the
								// first request so it can't clobber a continuation cursor on later pages.
								page: repoInput.cursor == null ? options?.page : undefined,
								pageSize: options?.pageSize,
								states: states,
								// Azure DevOps only populates clone URLs on request (extra call); no-op elsewhere.
								includeRemoteInfo: isAzureDevOpsProvider(providerId) ? true : undefined,
							},
						);
						return { repoInput: repoInput, results: results };
					}),
				);

				// `allSettled` preserves order, so `settled[i]` is `repoInputs[i]`.
				settled.forEach((outcome, i) => {
					if (outcome.status !== 'fulfilled') {
						const failedRepo = repoInputs[i].repo;
						failures.push(
							toCollectionScopeFailure(
								{ providerId: providerId, repositoryId: `${failedRepo.namespace}/${failedRepo.name}` },
								outcome.reason,
							),
						);
						return;
					}

					const { repoInput, results } = outcome.value;
					data.push(...results.values);
					// Fan-out across repos: preserve each repo's SDK completeness/failures and its terminal
					// truncation so a single failed/incomplete repo isn't lost when merged with its siblings.
					metadata = mergeCollectionMetadata(metadata, results.metadata);
					if (results.paging?.truncated) {
						truncated = true;
					}
					if (results.paging?.more) {
						hasMore = true;
						cursor.cursors.push({ repo: repoInput.repo, cursor: results.paging.cursor });
					}
				});

				// Merge the GitLens-side per-repo rejections into the SDK metadata so both flow through the same
				// warning/fetchFailed assessment downstream.
				if (failures.length > 0) {
					metadata = mergeCollectionMetadata(metadata, { completeness: 'partial', failures: failures });
				}

				// Keep the requested page number in the composite cursor so the facade can report the real
				// currentPage when the consumer continues using only the cursor.
				if (options?.page != null) {
					cursor.page = options.page;
				}

				return {
					value: {
						values: data,
						paging: {
							more: hasMore,
							cursor: JSON.stringify(cursor),
							truncated: truncated || undefined,
							// Echo the requested numbered page so the facade reports the real currentPage for
							// numbered-page hosts (GitLab/Bitbucket/Azure), not a synthesized 1. Cursor-only hosts
							// leave `page` undefined via their own reads.
							page: options?.page,
						},
						metadata: metadata,
					},
					duration: performance.now() - start,
				};
			} catch (ex) {
				Logger.error(ex, 'getPullRequestsForRepos');
				return { error: toError(ex), duration: performance.now() - start };
			}
		}

		try {
			const result = await api.getPullRequestsForRepos(toTokenWithInfo(providerId, session), reposOrRepoIds, {
				...getPullRequestsOptions,
				cursor: options?.cursor,
				baseUrl: customUrl,
				page: options?.page,
				pageSize: options?.pageSize,
				states: states,
				// Azure DevOps only populates clone URLs on request (extra call); no-op elsewhere.
				includeRemoteInfo: isAzureDevOpsProvider(providerId) ? true : undefined,
			});
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			Logger.error(ex, 'getPullRequestsForRepos');
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	async searchMyPullRequests(
		repo?: T,
		cancellation?: AbortSignal,
		silent?: boolean,
		connectionId?: string,
		state?: PullRequestStateFilter,
		options?: SearchMyPullRequestsOptions,
	): Promise<IntegrationResult<PullRequest[] | undefined>>;
	async searchMyPullRequests(
		repos?: T[],
		cancellation?: AbortSignal,
		silent?: boolean,
		connectionId?: string,
		state?: PullRequestStateFilter,
		options?: SearchMyPullRequestsOptions,
	): Promise<IntegrationResult<PullRequest[] | undefined>>;
	@trace()
	async searchMyPullRequests(
		repos?: T | T[],
		cancellation?: AbortSignal,
		silent?: boolean,
		connectionId?: string,
		state?: PullRequestStateFilter,
		options?: SearchMyPullRequestsOptions,
	): Promise<IntegrationResult<PullRequest[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		try {
			// Prefer the optional metadata-aware path for account-wide reads so partial failures (e.g. one Azure
			// org rejecting) are surfaced as a soft `{ value, error }` instead of being lost. Repo-scoped reads and
			// providers without that override keep using the legacy array path.
			let result: IntegrationResult<PullRequest[] | undefined>;
			if (this.searchProviderMyPullRequestsResult != null && repos == null) {
				result = await this.searchProviderMyPullRequestsResult(
					session,
					repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
					cancellation,
					silent,
					state,
					options,
				);
			} else {
				result = {
					value: await this.searchProviderMyPullRequests(
						session,
						repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
						cancellation,
						silent,
						state,
						options,
					),
				};
			}
			this.resetRequestExceptionCount('searchMyPullRequests');
			// `IntegrationResult` is a strict union of value-only or error-only (and may be `undefined`). Return the
			// matching branch explicitly; a missing result is treated as a successful empty read.
			if (result == null) {
				return { value: undefined, duration: performance.now() - start };
			}
			if (result.error != null) {
				return { error: result.error, duration: performance.now() - start };
			}
			return { value: result.value, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('searchMyPullRequests', ex, {
				scope: scope,
				silent: true,
				connectionId: connectionId,
			});
			return {
				error: toError(ex),
				duration: performance.now() - start,
			};
		}
	}

	/**
	 * Account-wide, user-scoped counterpart of {@link getMyPullRequestsForReposResult} that returns the raw
	 * `ProviderPullRequest` shape (not the normalized model). Unlike the repo-scoped core, this needs no
	 * `repos` — it reads the current user's pull requests across the account, so the ProviderBackend sweep
	 * can drive its Kanban "done" column even when no repositories are supplied (where the repo-scoped core
	 * rejects an empty `repos` input). Recovers thrown errors into `{ error }` so callers surface warnings.
	 */
	async getMyPullRequestsForUserResult(
		options?: {
			state?: PullRequestStateFilter[];
			cursor?: string;
			includeReviewRequested?: boolean;
			/** Exact OR union of account-wide relationships to include. */
			filters?: PullRequestFilter[];
			/** Request only the stable list fields, omitting optional provider enrichments. */
			summary?: boolean;
		},
		connectionId?: string,
	): Promise<IntegrationResult<ProviderApiPagedResult<ProviderPullRequest> | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		if (this.getProviderMyPullRequestsForUser == null) {
			return undefined;
		}

		const start = performance.now();
		try {
			const result = await this.getProviderMyPullRequestsForUser(session, options);
			this.resetRequestExceptionCount('getMyPullRequestsForUser');
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('getMyPullRequestsForUser', ex, {
				scope: scope,
				connectionId: connectionId,
			});
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/**
	 * Reads the current user's pull requests across the whole account using each provider's native "my PRs"
	 * query, returning the raw provider shape. Without `filters`, the exact user scopes depend on provider-native
	 * behavior and options like `includeReviewRequested`. With `filters`, each member is an exact account-wide OR
	 * relationship validated by the facade before this provider hook is called. Optional: providers that can't
	 * express an account-wide user query leave it undefined and the surface falls back to repo-scoped.
	 *
	 * These native user queries are cursor-based, so `cursor` (not a page number) drives continuation; there
	 * is no jump-to-page-N and no per-call page size on this path.
	 *
	 * `includeReviewRequested` opts into the review-requested slice for providers whose account-wide read
	 * only returns authored PRs natively and must fan out per-repo to add reviewer PRs (Bitbucket). It's off
	 * by default so a sweep pays gkcli-parity cost (authored only) unless the caller deliberately opts in;
	 * providers whose native query already covers review-requested PRs ignore it.
	 */
	protected getProviderMyPullRequestsForUser?(
		session: ProviderAuthenticationSession,
		options?: {
			state?: PullRequestStateFilter[];
			cursor?: string;
			includeReviewRequested?: boolean;
			filters?: PullRequestFilter[];
			summary?: boolean;
		},
	): Promise<ProviderApiPagedResult<ProviderPullRequest> | undefined>;

	/**
	 * Parses a Repo/Project paging cursor into its `cursors` bundle. Guards against valid JSON whose
	 * `cursors` is a truthy non-array (e.g. `{ "cursors": "..." }`), which would otherwise bypass the
	 * `?? []` fallback at call sites and flow into `.map()` downstream, throwing instead of degrading to
	 * the first page.
	 */
	private parseCursorInfo<T>(cursor?: string): { cursors?: T[] } {
		try {
			const parsed = JSON.parse(cursor ?? '{}') as { cursors?: T[] };
			return Array.isArray(parsed?.cursors) ? parsed : {};
		} catch {
			return {};
		}
	}

	// `state` selects which PR states to include (open/closed/merged/all). Providers that cannot express it
	// in a single query filter the normalized results; omitted preserves the historical open-only behavior.
	protected abstract searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: T[],
		cancellation?: AbortSignal,
		silent?: boolean,
		state?: PullRequestStateFilter,
		options?: SearchMyPullRequestsOptions,
	): Promise<PullRequest[] | undefined>;

	/**
	 * Optional metadata-aware counterpart of {@link searchProviderMyPullRequests}. Providers whose account-wide
	 * "my PRs" read already produces {@link ProviderApiPagedResult} with completeness/failures can override
	 * this to return a soft `{ value, error }` result so `searchMyPullRequests` surfaces partial data and a
	 * warning instead of silently discarding the failure signal. The wrapper prefers this when present; the
	 * abstract {@link searchProviderMyPullRequests} remains the required fallback for repo-scoped and
	 * metadata-oblivious paths.
	 */
	protected searchProviderMyPullRequestsResult?(
		session: ProviderAuthenticationSession,
		repos?: T[],
		cancellation?: AbortSignal,
		silent?: boolean,
		state?: PullRequestStateFilter,
		options?: SearchMyPullRequestsOptions,
	): Promise<IntegrationResult<PullRequest[] | undefined>>;

	/**
	 * Result-returning wrapper for the filtered pull-request search. Errors become the soft
	 * `{ error }` branch so the public facade can preserve an empty account and a failed request as distinct
	 * outcomes.
	 */
	async searchPullRequestsPageResult(
		options: {
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: PullRequestSearchCriteria;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IntegrationResult<ProviderPullRequestSearchPage | undefined>> {
		const scope = getScopedLogger();
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		try {
			const result = await this.searchProviderPullRequestsPage?.(session, options, cancellation);
			this.resetRequestExceptionCount('searchPullRequestsPage');
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('searchPullRequestsPage', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/** Must agree with `ProviderMetadata.supportedPullRequestSearch`. */
	protected searchProviderPullRequestsPage?(
		session: ProviderAuthenticationSession,
		options: {
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: PullRequestSearchCriteria;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<ProviderPullRequestSearchPage | undefined>;

	async searchPullRequests(
		searchQuery: string,
		repo?: T,
		cancellation?: AbortSignal,
		options?: { include?: PullRequestState[] },
	): Promise<PullRequest[] | undefined>;
	async searchPullRequests(
		searchQuery: string,
		repos?: T[],
		cancellation?: AbortSignal,
		options?: { include?: PullRequestState[] },
	): Promise<PullRequest[] | undefined>;
	async searchPullRequests(
		searchQuery: string,
		repo?: T,
		cancellation?: AbortSignal,
		connectionId?: string,
		options?: { include?: PullRequestState[] },
	): Promise<PullRequest[] | undefined>;
	async searchPullRequests(
		searchQuery: string,
		repos?: T[],
		cancellation?: AbortSignal,
		connectionId?: string,
		options?: { include?: PullRequestState[] },
	): Promise<PullRequest[] | undefined>;
	@trace()
	async searchPullRequests(
		searchQuery: string,
		repos?: T | T[],
		cancellation?: AbortSignal,
		connectionIdOrOptions?: string | { include?: PullRequestState[] },
		options?: { include?: PullRequestState[] },
	): Promise<PullRequest[] | undefined> {
		// `connectionId` (string) can be omitted when passing `options`; split the overlapping 4th arg.
		// When the 4th arg isn't the options object (a string `connectionId` or `undefined`), fall back to
		// the 5th-arg `options` so an explicit `undefined` connectionId still honors state filtering.
		const connectionId = typeof connectionIdOrOptions === 'string' ? connectionIdOrOptions : undefined;
		const searchOptions =
			connectionIdOrOptions != null && typeof connectionIdOrOptions !== 'string'
				? connectionIdOrOptions
				: options;
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const prs = await this.searchProviderPullRequests?.(
				session,
				searchQuery,
				repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
				cancellation,
				searchOptions,
			);
			this.resetRequestExceptionCount('searchPullRequests');
			return prs;
		} catch (ex) {
			this.handleProviderException('searchPullRequests', ex, { scope: scope, connectionId: connectionId });
			return undefined;
		}
	}

	protected searchProviderPullRequests?(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: T[],
		cancellation?: AbortSignal,
		options?: { include?: PullRequestState[] },
	): Promise<PullRequest[] | undefined>;

	/**
	 * Result-returning wrapper for the FILTERED issue search — issues matching structured criteria over a
	 * repository/org scope, with no forced relationship to the current user. Recovers thrown errors into
	 * `{ error }` so the facade surfaces a warning instead of a silent empty page.
	 *
	 * Distinct from every other issue read on this class: {@link searchMyIssuesWithTruncationResult} is bound to
	 * the current user by construction, and {@link getMyIssuesForReposAsShapesResult} goes through the SDK's
	 * repo-scoped read (whose over-limit recovery walk can cost up to 128 requests). This one is one request per
	 * page and carries no relationship it wasn't asked for.
	 */
	async searchIssuesPageResult(
		options: {
			/**
			 * Repositories to search, as namespace/name descriptors. NOT repository ids: a search query names
			 * repositories by path, so an id-based input can't be expressed and the facade rejects it before here.
			 */
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: IssueSearchCriteria;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IntegrationResult<ProviderIssueSearchPage | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		try {
			const result = await this.searchProviderIssuesPage?.(session, options, cancellation);
			this.resetRequestExceptionCount('searchIssuesPage');
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('searchIssuesPage', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/**
	 * OPTIONAL, like {@link searchProviderPullRequests}: a provider that can't express the criteria server-side
	 * doesn't implement it, and the facade refuses the read (warning + `fetchFailed`) rather than serving a list
	 * that was never narrowed. Whether a provider implements this must agree with what
	 * `ProviderMetadata.supportedIssueSearch` declares.
	 */
	protected searchProviderIssuesPage?(
		session: ProviderAuthenticationSession,
		options: {
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: IssueSearchCriteria;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<ProviderIssueSearchPage | undefined>;

	/**
	 * Result-returning wrapper for the count-only probe: how many issues MATCH each scope, transferring no issues
	 * at all. Recovers thrown errors into `{ error }` like the reads around it.
	 *
	 * Counts come back POSITIONALLY — one per input scope, in order — because a caller's key must never reach the
	 * provider query. `undefined` in a slot means the provider didn't report a count for it, never zero matches.
	 */
	async countIssuesResult(
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: IssueSearchCriteria }[],
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IntegrationResult<(number | undefined)[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		try {
			const counts = await this.countProviderIssues?.(session, scopes, cancellation);
			this.resetRequestExceptionCount('countIssues');
			return { value: counts, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('countIssues', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/**
	 * OPTIONAL: only a provider that can answer "how many match" WITHOUT fetching the matches implements this.
	 * GitHub's search reports `issueCount` on a zero-node selection; GitLab's REST exposes a total on some
	 * endpoints but not for a search-shaped query, and Azure has no equivalent. A provider that can't answer
	 * doesn't implement it and the facade refuses the probe, so a consumer hides its count rather than being shown
	 * a fabricated one.
	 */
	protected countProviderIssues?(
		session: ProviderAuthenticationSession,
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: IssueSearchCriteria }[],
		cancellation?: AbortSignal,
	): Promise<(number | undefined)[] | undefined>;

	/** The PR twin of {@link countIssuesResult}: counts each scope's pull requests, transferring none. */
	async countPullRequestsResult(
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: PullRequestSearchCriteria }[],
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IntegrationResult<(number | undefined)[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const start = performance.now();
		try {
			const counts = await this.countProviderPullRequests?.(session, scopes, cancellation);
			this.resetRequestExceptionCount('countPullRequests');
			return { value: counts, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('countPullRequests', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/** OPTIONAL, like {@link countProviderIssues}: only a provider that can count without fetching implements it. */
	protected countProviderPullRequests?(
		session: ProviderAuthenticationSession,
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: PullRequestSearchCriteria }[],
		cancellation?: AbortSignal,
	): Promise<(number | undefined)[] | undefined>;

	getPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
		return this.getProviderPullRequestIdentityFromMaybeUrl?.(search);
	}

	protected getProviderPullRequestIdentityFromMaybeUrl?(search: string): PullRequestUrlIdentity | undefined;
}
