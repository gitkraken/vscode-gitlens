import type { CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { IssueShape, IssueStateFilter } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequestState as PullRequestState } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest, PullRequestMergeMethod, PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
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
import { mergeCollectionMetadata } from '../providers/utils/providerPaging.js';
import { toCollectionScopeFailure } from '../results.js';
import type { IntegrationResult, IntegrationType } from './integration.js';
import { IntegrationBase } from './integration.js';

function isAzureDevOpsProvider(
	providerId: IntegrationIds,
): providerId is GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer {
	return (
		providerId === GitCloudHostIntegrationId.AzureDevOps ||
		providerId === GitSelfManagedHostIntegrationId.AzureDevOpsServer
	);
}

function hostFromDomain(domain: string | undefined): string | undefined {
	const value = domain?.trim();
	if (!value) return undefined;

	if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
		try {
			return new URL(value).host || undefined;
		} catch {
			return undefined;
		}
	}

	try {
		return new URL(`https://${value}`).host || undefined;
	} catch {
		return undefined;
	}
}

function protocolFromDomain(domain: string | undefined): string | undefined {
	const value = domain?.trim();
	if (!value || !/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) return undefined;

	try {
		return new URL(value).protocol || undefined;
	} catch {
		return undefined;
	}
}

function getSelfManagedApiBaseUrl(
	providerId: IntegrationIds,
	domain: string | undefined,
	protocol: string | undefined,
): string | undefined {
	const host = hostFromDomain(domain);
	if (host == null) return undefined;

	const scheme = protocol ?? protocolFromDomain(domain) ?? 'https:';
	switch (providerId) {
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return `${scheme}//${host}/api/v3`;
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return `${scheme}//${host}/api`;
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return `${scheme}//${host}/rest/api/1.0`;
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return `${scheme}//${host}`;
		default:
			return undefined;
	}
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
	 * Lists the organizations (orgs/workspaces/groups) the current user belongs to on this host.
	 * `truncated === true` means the defensive page-drain backstop stopped before the upstream listing
	 * was exhausted.
	 */
	async getOrganizationsForUser(): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined> {
		return (await this.getOrganizationsForUserResult())?.value;
	}

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
	 * Whether this git host exposes issues on the ProviderBackend surface. Most git hosts do; a host whose
	 * issue tracker is deprecated (Bitbucket Cloud, superseded by dedicated issue integrations like Jira)
	 * overrides this to false, so the facade reports issues as unsupported instead of serving a partial or
	 * deprecated source.
	 */
	get supportsIssues(): boolean {
		return true;
	}

	/**
	 * Result-returning core of {@link getOrganizationsForUser}. Resolves the session for `connectionId`
	 * (or the primary connection when omitted, honoring multi-account reads) and recovers a thrown error
	 * into `{ error }` so callers can surface it as a warning instead of swallowing it to `undefined`.
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
			this.handleProviderException('getOrganizationsForUser', ex, { scope: scope });
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
			this.handleProviderException('getProjectsForOrg', ex, { scope: scope });
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
	 */
	async getRepositoriesForOrg(
		org: string,
		options?: { project?: string; cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined> {
		return (await this.getRepositoriesForOrgResult(org, options))?.value;
	}

	/**
	 * Result-returning core of {@link getRepositoriesForOrg}. Resolves the session for `connectionId`
	 * (or the primary connection when omitted) and recovers a thrown error into `{ error }` for warnings.
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
			this.handleProviderException('getRepositoriesForOrg', ex, { scope: scope });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	protected getProviderRepositoriesForOrg?(
		session: ProviderAuthenticationSession,
		org: string,
		options?: { project?: string; cursor?: string },
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

	async getMyIssuesForRepos(
		reposOrRepoIds: ProviderReposInput,
		options?: {
			filters?: IssueFilter[];
			cursor?: string;
			customUrl?: string;
			page?: number;
			pageSize?: number;
			/** When true, don't constrain to the current user's assigned issues even if the Assignee filter is set. */
			includeAllAssignees?: boolean;
			/** Issue states to include; when omitted the provider returns its default (open only). */
			state?: IssueStateFilter;
		},
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
		options?: {
			filters?: IssueFilter[];
			cursor?: string;
			customUrl?: string;
			page?: number;
			pageSize?: number;
			includeAllAssignees?: boolean;
			state?: IssueStateFilter;
		},
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
			Logger.warn(`Unsupported input for provider ${providerId}`, 'getIssuesForRepos');
			return {
				error: new Error(`Unsupported input for provider ${providerId}`),
				duration: performance.now() - start,
			};
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
				Logger.warn(`Multiple organizations not supported for provider ${providerId}`, 'getIssuesForRepos');
				return {
					error: new Error(`Multiple organizations not supported for provider ${providerId}`),
					duration: performance.now() - start,
				};
			} else if (organizations.size === 0) {
				Logger.warn(`No organizations found for provider ${providerId}`, 'getIssuesForRepos');
				return {
					error: new Error(`No organizations found for provider ${providerId}`),
					duration: performance.now() - start,
				};
			}

			const organization: string = first(organizations.values())!;

			if (options?.filters != null) {
				if (!api.providerSupportsIssueFilters(providerId, options.filters)) {
					Logger.warn(`Unsupported filters for provider ${providerId}`, 'getIssuesForRepos');
					return {
						error: new Error(`Unsupported filters for provider ${providerId}`),
						duration: performance.now() - start,
					};
				}

				let userAccount: ProviderAccount | undefined;
				try {
					userAccount = await api.getCurrentUserForInstance(
						toTokenWithInfo(providerId, session),
						organization,
						{ baseUrl: customUrl },
					);
				} catch (ex) {
					Logger.error(ex, 'getIssuesForRepos');
					return { error: toError(ex), duration: performance.now() - start };
				}

				if (userAccount == null) {
					Logger.warn(`Unable to get current user for ${providerId}`, 'getIssuesForRepos');
					return {
						error: new Error(`Unable to get current user for ${providerId}`),
						duration: performance.now() - start,
					};
				}

				const userFilterProperty = userAccount.name;

				if (userFilterProperty == null) {
					Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getIssuesForRepos');
					return {
						error: new Error(`Unable to get user property for filter for ${providerId}`),
						duration: performance.now() - start,
					};
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
							},
						);
						return { projectInput: projectInput, results: results };
					}),
				);

				for (let i = 0; i < settled.length; i++) {
					const outcome = settled[i];
					const projectInput = projectInputs[i];
					if (outcome.status !== 'fulfilled') {
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
				Logger.warn(`Unsupported filters for provider ${providerId}`, 'getIssuesForRepos');
				return {
					error: new Error(`Unsupported filters for provider ${providerId}`),
					duration: performance.now() - start,
				};
			}

			let userAccount: ProviderAccount | undefined;
			try {
				userAccount = await api.getCurrentUser(toTokenWithInfo(providerId, session), { baseUrl: customUrl });
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return { error: toError(ex), duration: performance.now() - start };
			}

			if (userAccount == null) {
				Logger.warn(`Unable to get current user for ${providerId}`, 'getIssuesForRepos');
				return {
					error: new Error(`Unable to get current user for ${providerId}`),
					duration: performance.now() - start,
				};
			}

			const userFilterProperty = userAccount.username;
			if (userFilterProperty == null) {
				Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getIssuesForRepos');
				return {
					error: new Error(`Unable to get user property for filter for ${providerId}`),
					duration: performance.now() - start,
				};
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
							},
						);
						return { repoInput: repoInput, results: results };
					}),
				);

				for (let i = 0; i < settled.length; i++) {
					const outcome = settled[i];
					const repoInput = repoInputs[i];
					if (outcome.status !== 'fulfilled') {
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
			});
			return { value: result, duration: performance.now() - start };
		} catch (ex) {
			Logger.error(ex, 'getIssuesForRepos');
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/**
	 * Repo-scoped "my issues" read returning the normalized {@link IssueShape} the ProviderBackend facade
	 * consumes. The default drains {@link getMyIssuesForReposResult} (the raw provider-apis path) and maps to
	 * IssueShape. A provider whose only issue client already yields normalized shapes and isn't wired into that
	 * path (Bitbucket, via `getUsersIssuesForRepo`) overrides this to read directly, so the facade's repo-scoped
	 * issue reads (`listIssuesPage({ repos })`, `broadenIssues`) work without a raw `ProviderIssue` round-trip.
	 */
	async getMyIssuesForReposAsShapesResult(
		reposOrRepoIds: ProviderReposInput,
		options?: {
			filters?: IssueFilter[];
			cursor?: string;
			customUrl?: string;
			page?: number;
			pageSize?: number;
			includeAllAssignees?: boolean;
			state?: IssueStateFilter;
		},
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
			Logger.warn(`Unsupported input for provider ${providerId}`);
			return {
				error: new Error(`Unsupported input for provider ${providerId}`),
				duration: performance.now() - start,
			};
		}

		let getPullRequestsOptions: GetPullRequestsOptions | undefined;
		if (options?.filters != null) {
			if (!api.providerSupportsPullRequestFilters(providerId, options.filters)) {
				Logger.warn(`Unsupported filters for provider ${providerId}`, 'getPullRequestsForRepos');
				return {
					error: new Error(`Unsupported filters for provider ${providerId}`),
					duration: performance.now() - start,
				};
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
					Logger.warn(`No organizations found for provider ${providerId}`, 'getPullRequestsForRepos');
					return {
						error: new Error(`No organizations found for provider ${providerId}`),
						duration: performance.now() - start,
					};
				}

				const organization: string = first(organizations.values())!;
				try {
					userAccount = await api.getCurrentUserForInstance(
						toTokenWithInfo(providerId, session),
						organization,
						{
							baseUrl: customUrl,
						},
					);
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return { error: toError(ex), duration: performance.now() - start };
				}
			} else {
				try {
					userAccount = await api.getCurrentUser(toTokenWithInfo(providerId, session), {
						baseUrl: customUrl,
					});
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return { error: toError(ex), duration: performance.now() - start };
				}
			}

			if (userAccount == null) {
				Logger.warn(`Unable to get current user for ${providerId}`, 'getPullRequestsForRepos');
				return {
					error: new Error(`Unable to get current user for ${providerId}`),
					duration: performance.now() - start,
				};
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
				Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getPullRequestsForRepos');
				return {
					error: new Error(`Unable to get user property for filter for ${providerId}`),
					duration: performance.now() - start,
				};
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
	): Promise<IntegrationResult<PullRequest[] | undefined>>;
	async searchMyPullRequests(
		repos?: T[],
		cancellation?: AbortSignal,
		silent?: boolean,
		connectionId?: string,
		state?: PullRequestStateFilter,
	): Promise<IntegrationResult<PullRequest[] | undefined>>;
	@trace()
	async searchMyPullRequests(
		repos?: T | T[],
		cancellation?: AbortSignal,
		silent?: boolean,
		connectionId?: string,
		state?: PullRequestStateFilter,
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
				);
			} else {
				result = {
					value: await this.searchProviderMyPullRequests(
						session,
						repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
						cancellation,
						silent,
						state,
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
		options?: { state?: PullRequestStateFilter[]; cursor?: string },
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
			this.handleProviderException('getMyPullRequestsForUser', ex, { scope: scope });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/**
	 * Reads the current user's pull requests across the whole account (author + assignee + review-requested,
	 * per each provider's native "my PRs" query), returning the raw provider shape. Optional: providers that
	 * can't express an account-wide user query leave it undefined and the surface falls back to repo-scoped.
	 *
	 * These native user queries are cursor-based, so `cursor` (not a page number) drives continuation; there
	 * is no jump-to-page-N and no per-call page size on this path.
	 */
	protected getProviderMyPullRequestsForUser?(
		session: ProviderAuthenticationSession,
		options?: { state?: PullRequestStateFilter[]; cursor?: string },
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
	): Promise<IntegrationResult<PullRequest[] | undefined>>;

	async searchPullRequests(
		searchQuery: string,
		repo?: T,
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<PullRequest[] | undefined>;
	async searchPullRequests(
		searchQuery: string,
		repos?: T[],
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<PullRequest[] | undefined>;
	@trace()
	async searchPullRequests(
		searchQuery: string,
		repos?: T | T[],
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<PullRequest[] | undefined> {
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
			);
			this.resetRequestExceptionCount('searchPullRequests');
			return prs;
		} catch (ex) {
			this.handleProviderException('searchPullRequests', ex, { scope: scope });
			return undefined;
		}
	}

	protected searchProviderPullRequests?(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: T[],
		cancellation?: AbortSignal,
	): Promise<PullRequest[] | undefined>;

	getPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
		return this.getProviderPullRequestIdentityFromMaybeUrl?.(search);
	}

	protected getProviderPullRequestIdentityFromMaybeUrl?(search: string): PullRequestUrlIdentity | undefined;
}
