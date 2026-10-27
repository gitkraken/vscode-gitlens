import type {
	AzureDevOpsRestResource,
	AzureDevOpsRestResourceInfo,
	AzureWorkItemHtmlField,
	AzureWorkItemTypeStates,
} from '@gitkraken/provider-apis';
import * as l10n from '@vscode/l10n';
import type { UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueSearchCriteria } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import { effectiveIssueSort } from '@gitlens/git/utils/issue.utils.js';
import { base64 } from '@gitlens/utils/base64.js';
import { CancellationError, isCancellationError, raceWithSignal } from '@gitlens/utils/cancellation.js';
import { sha256, uuid } from '@gitlens/utils/crypto.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { TokenWithInfo } from '../../authentication/models.js';
import type { IntegrationServiceContext } from '../../context.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	isRateLimitResponse,
	ProviderFetchError,
	RequestClientError,
	RequestNotFoundError,
	toRateLimitError,
} from '../../errors.js';
import type { ProviderIssueSearchPage } from '../../models/issueReads.js';
import { decodePathSegment } from '../../utils/domain.utils.js';
import type { ProviderApiConfig } from '../apiConfig.js';
import { baseProviderApiConfig } from '../apiConfig.js';
import { createProviderApiRequest, createProviderApis } from '../providerApiClient.js';
import { throwProviderError } from '../providerErrors.js';
import type {
	AzureForkRepositoryUrls,
	AzureGitCommit,
	AzureProjectDescriptor,
	AzurePullRequest,
	AzurePullRequestWithLinks,
	AzureRepositoryReference,
	AzureRepositoryUrls,
	AzureRepositoryWithMetadata,
	AzureWorkItemStateCategory,
	WorkItem,
} from './models.js';
import {
	azurePullRequestStatusToState,
	azureWorkItemsStateCategoryToState,
	encodeAzurePathSegment,
	fromAzurePullRequest,
	fromAzureWorkItem,
	getAzurePullRequestWebUrl,
	isClosedAzurePullRequestStatus,
	normalizeAzureBranchName,
	parseAzureWorkItemDate,
	sanitizeAzureRepositoryUrl,
} from './models.js';
import type { AzureWorkItemSearchCursor } from './search.js';
import {
	azureWorkItemBatchLimit,
	azureWorkItemSearchResultLimit,
	azureWorkItemWiqlLengthLimit,
	parseAzureWorkItemSearchCursor,
	toAzureSearchPageSize,
	toAzureWorkItemSearchCursorKey,
	toAzureWorkItemSearchQueries,
	toAzureWorkItemSearchWiql,
} from './search.js';
import { AzureWorkItemDescriptionsCache } from './workItemDescriptions.js';
import { queryAzureWorkItemSearch } from './workItemSearch.js';
import {
	AzureWorkItemStatesCache,
	getAzureWorkItemTypeStatesPath,
	getAzureWorkItemTypesUrl,
	requireAzureWorkItemStateCategories,
	resolveAzureWorkItemStateCategory,
} from './workItemStateCategories.js';

const forkRepositoryUrlCacheTtl = 5 * 60 * 1000;
const workItemMetadataConcurrency = 6;
/** How long a work-item search's id snapshot outlives the last page read from it, and the most it lives at all. */
const workItemSearchSnapshotTtl = 5 * 60 * 1000;
const workItemSearchSnapshotMaxTtl = 30 * 60 * 1000;

type WorkItemSearchOptions = {
	baseUrl: string;
	criteria?: IssueSearchCriteria;
	projectNames?: readonly string[];
	workflowProjectNames?: readonly string[];
};

/** Whether Azure refused a WIQL query for matching more work items than it will return (`VS402337`). */
function isWorkItemLimitRefusal(ex: unknown): boolean {
	return ex instanceof RequestClientError && ex.message.includes('VS402337');
}

function parseAzureRepositoryDescriptor(repo: string): { projectName: string; repoName: string } {
	const parts = repo.split('/');
	const [projectName, segment, repoName] = parts;
	if (parts.length !== 3 || segment !== '_git' || !projectName || !repoName) {
		throw new Error(`Invalid Azure repository descriptor '${repo}'; expected '{project}/_git/{repoName}'.`);
	}

	return { projectName: projectName, repoName: repoName };
}

export class AzureDevOpsApi implements Disposable {
	private readonly restApi: ReturnType<typeof createProviderApis>['azureDevOps'];
	private readonly _disposable: Disposable | undefined;
	private readonly _workItemStates: AzureWorkItemStatesCache;
	private readonly ownsWorkItemStates: boolean;
	private readonly _workItemDescriptions: AzureWorkItemDescriptionsCache;
	private readonly ownsWorkItemDescriptions: boolean;
	private readonly _forkRepositoryUrls = new PromiseCache<string, AzureForkRepositoryUrls | undefined>({
		capacity: 100,
		createTTL: forkRepositoryUrlCacheTtl,
	});
	/**
	 * The ordered ids each filtered work-item search's first page queried, paged through by its continuations. Kept
	 * alive while a pagination keeps reading them (see `workItemSearchSnapshotTtl`). Every first page adds one, so
	 * the capacity leaves room for repeated first pages before an idle pagination's snapshot is the one evicted.
	 */
	private readonly _workItemSearches = new PromiseCache<string, number[]>({
		capacity: 50,
		accessTTL: workItemSearchSnapshotTtl,
		createTTL: workItemSearchSnapshotMaxTtl,
	});

	constructor(
		private readonly config: ProviderApiConfig,
		workItemStates?: AzureWorkItemStatesCache,
		workItemDescriptions?: AzureWorkItemDescriptionsCache,
	) {
		this.restApi = createProviderApis({
			request: createProviderApiRequest((input, init) => config.fetch(input, init)),
		}).azureDevOps;
		this._workItemStates = workItemStates ?? new AzureWorkItemStatesCache();
		this.ownsWorkItemStates = workItemStates == null;
		this._workItemDescriptions = workItemDescriptions ?? new AzureWorkItemDescriptionsCache();
		this.ownsWorkItemDescriptions = workItemDescriptions == null;
		this._disposable = config.onConfigChanged?.(() => this.resetCaches());
	}

	dispose(): void {
		this._disposable?.dispose();
	}

	private resetCaches(): void {
		this.restApi.updateConfig({});
		if (this.ownsWorkItemStates) {
			this._workItemStates.clear();
		}
		if (this.ownsWorkItemDescriptions) {
			this._workItemDescriptions.clear();
		}
		this._forkRepositoryUrls.clear();
		this._workItemSearches.clear();
	}

	@trace({
		args: (provider, token, owner, repo, branch) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			branch: branch,
		}),
	})
	public async getPullRequestForBranch(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		branch: string,
		options: {
			baseUrl: string;
		},
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();
		const { projectName, repoName } = parseAzureRepositoryDescriptor(repo);

		try {
			const prResult = await this.request<{ value: AzurePullRequest[] }>(
				provider,
				token,
				options?.baseUrl,
				`${encodeAzurePathSegment(owner)}/${encodeAzurePathSegment(projectName)}/_apis/git/repositories/${encodeAzurePathSegment(repoName)}/pullRequests?searchCriteria.status=all&searchCriteria.sourceRefName=${encodeURIComponent(`refs/heads/${branch}`)}`,
				{
					method: 'GET',
				},
				scope,
			);

			// Sort PRs: open PRs first, then by most recent activity (creation or closure date)
			const sortedPRs = prResult?.value.sort((a, b) => {
				// First, prioritize open PRs (active/notSet) over closed ones (abandoned/completed)
				const aIsOpen = a.status === 'active' || a.status === 'notSet';
				const bIsOpen = b.status === 'active' || b.status === 'notSet';

				if (aIsOpen !== bIsOpen) {
					return aIsOpen ? -1 : 1; // Open PRs come first
				}

				// Among PRs with the same status, sort by most recent activity
				// Use closedDate if available, otherwise use creationDate
				const aDate = new Date(a.closedDate || a.creationDate);
				const bDate = new Date(b.closedDate || b.creationDate);

				return bDate.getTime() - aDate.getTime(); // Most recent first
			});

			const pr = sortedPRs?.[0];
			if (pr == null) return undefined;

			return await this.toPullRequest(pr, provider, token, owner, options.baseUrl, scope);
		} catch (ex) {
			// A rejected credential is actionable and must not be reported as an absent result; every other
			// failure keeps the existing degrade-to-undefined behavior.
			if (ex instanceof AuthenticationError) throw ex;

			scope?.error(ex);
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, repo, rev, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			rev: rev,
			baseUrl: baseUrl,
		}),
	})
	async getPullRequestForCommit(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		rev: string,
		baseUrl: string,
		_options?: {
			avatarSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();
		const { projectName, repoName } = parseAzureRepositoryDescriptor(repo);
		const resource = await this.requireRestResource(
			provider,
			token,
			owner,
			baseUrl,
			'pullRequestQuery',
			'4.1',
			cancellation,
		);
		try {
			const encodedProject = encodeAzurePathSegment(projectName);
			const encodedRepo = encodeAzurePathSegment(repoName);
			const prResult = await this.request<{ results: Record<string, AzurePullRequest[]>[] }>(
				provider,
				token,
				baseUrl,
				`${encodeAzurePathSegment(owner)}/${encodedProject}/_apis/git/repositories/${encodedRepo}/pullrequestquery?api-version=${resource.apiVersion}`,
				{
					method: 'POST',
					body: JSON.stringify({
						queries: [
							{
								items: [rev],
								type: 'commit',
							},
						],
					}),
				},
				scope,
				cancellation,
			);

			const pr = prResult?.results[0]?.[rev]?.[0];
			if (pr == null) return undefined;

			const pullRequest = await this.request<AzurePullRequestWithLinks>(
				provider,
				token,
				baseUrl,
				`${encodeAzurePathSegment(owner)}/${encodeAzurePathSegment(pr.repository.project.id)}/_apis/git/repositories/${encodeAzurePathSegment(pr.repository.id)}/pullRequests/${encodeAzurePathSegment(pr.pullRequestId.toString())}`,
				{ method: 'GET' },
				scope,
				cancellation,
			);
			if (pullRequest == null) return undefined;

			return await this.toPullRequest(pullRequest, provider, token, owner, baseUrl, scope, cancellation);
		} catch (ex) {
			// A rejected credential is actionable and must not be reported as an absent result; every other
			// failure keeps the existing degrade-to-undefined behavior.
			if (ex instanceof AuthenticationError) throw ex;

			scope?.error(ex);
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, projectOrName, id) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			projectOrName: projectOrName,
			id: id,
		}),
	})
	public async getPullRequest(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		projectOrName: string,
		id: string,
		options: { baseUrl: string },
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();
		// A pull request id is unique within the organization, so no repository is required here — only the
		// project. `projectOrName` is either a bare project name or a `{project}/_git/{repo}` descriptor; either
		// way the project is its first segment.
		const projectName = projectOrName.split('/')[0];

		try {
			const pr = await this.request<AzurePullRequest>(
				provider,
				token,
				options.baseUrl,
				`${encodeAzurePathSegment(owner)}/${encodeAzurePathSegment(projectName)}/_apis/git/pullrequests/${encodeAzurePathSegment(id)}`,
				{
					method: 'GET',
				},
				scope,
			);

			return pr != null
				? await this.toPullRequest(pr, provider, token, owner, options.baseUrl, scope)
				: undefined;
		} catch (ex) {
			// Only a 404 is a proven absence; `Integration.getPullRequest` handles every other failure, so it is not
			// cached as a miss
			if (ex.original?.status === 404) return undefined;

			throw ex;
		}
	}

	@trace({
		args: (provider, token, owner, repo, id) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			id: id,
		}),
	})
	public async getIssueOrPullRequest(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		id: string,
		options: {
			baseUrl: string;
			type?: IssueOrPullRequestType;
		},
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getScopedLogger();
		const { projectName, repoName } = parseAzureRepositoryDescriptor(repo);

		if (options?.type === undefined || options?.type === 'issue') {
			const resource = await this.requireRestResource(
				provider,
				token,
				owner,
				options.baseUrl,
				'workItems',
				'6.0',
			);
			let issueResult: WorkItem | undefined;
			try {
				issueResult = await this.getWorkItem(
					provider,
					token,
					owner,
					projectName,
					id,
					options.baseUrl,
					resource,
					scope,
				);
			} catch (ex) {
				// A rejected credential is actionable and must not be reported as an absent issue; every other
				// non-404 keeps the existing degrade-to-undefined behavior.
				if (ex instanceof AuthenticationError) throw ex;

				if (ex.original?.status !== 404) {
					scope?.error(ex);
					return undefined;
				}
			}

			if (issueResult != null) {
				await this.requireWorkItemProject(
					provider,
					token,
					owner,
					projectName,
					issueResult,
					options.baseUrl,
					scope,
				);
				const issueType = issueResult.fields['System.WorkItemType'];
				const state = issueResult.fields['System.State'];
				const stateCategory = await this.getWorkItemStateCategory(
					issueType,
					state,
					provider,
					token,
					owner,
					projectName,
					options,
				);

				const normalizedState = azureWorkItemsStateCategoryToState(
					stateCategory,
					parseAzureWorkItemDate(issueResult.fields['Microsoft.VSTS.Common.ClosedDate']) ?? undefined,
				);

				return {
					id: issueResult.id.toString(),
					type: 'issue',
					nodeId: issueResult.id.toString(),
					provider: provider,
					createdDate: new Date(issueResult.fields['System.CreatedDate']),
					updatedDate: new Date(issueResult.fields['System.ChangedDate']),
					state: normalizedState,
					closed: normalizedState === 'closed',
					title: issueResult.fields['System.Title'],
					url: issueResult._links.html.href,
				};
			}
		}

		if (options?.type === undefined || options?.type === 'pullrequest') {
			try {
				const prResult = await this.request<AzurePullRequestWithLinks>(
					provider,
					token,
					options?.baseUrl,
					`${encodeAzurePathSegment(owner)}/${encodeAzurePathSegment(projectName)}/_apis/git/repositories/${encodeAzurePathSegment(repoName)}/pullRequests/${encodeAzurePathSegment(id)}`,
					{
						method: 'GET',
					},
					scope,
				);

				if (prResult != null) {
					return {
						id: prResult.pullRequestId.toString(),
						type: 'pullrequest',
						nodeId: prResult.pullRequestId.toString(), // prResult.artifactId maybe?
						provider: provider,
						createdDate: new Date(prResult.creationDate),
						updatedDate: new Date(prResult.creationDate),
						state: azurePullRequestStatusToState(prResult.status),
						closed: isClosedAzurePullRequestStatus(prResult.status),
						title: prResult.title,
						url: getAzurePullRequestWebUrl(prResult, options.baseUrl, owner),
					};
				}

				return undefined;
			} catch (ex) {
				// A rejected credential is actionable and must not be reported as an absent issue; every other
				// non-404 keeps the existing degrade-to-undefined behavior.
				if (ex instanceof AuthenticationError) throw ex;

				if (ex.original?.status !== 404) {
					scope?.error(ex);
					return undefined;
				}
			}
		}
		return undefined;
	}

	@trace({
		args: (provider, token, project, id) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			project: project,
			id: id,
		}),
	})
	public async getIssue(
		provider: Provider,
		token: TokenWithInfo,
		project: AzureProjectDescriptor,
		id: string,
		options: {
			baseUrl: string;
			/**
			 * The current user as the organization's work items identify them, set as the row's `viewer`, or `null` when
			 * it couldn't be resolved, which marks the row `viewerUnresolved`. Asked only once the work item was read,
			 * alongside its state and fields; never rejects.
			 */
			viewer?: () => Promise<{ id: string } | null>;
		},
	): Promise<Issue | undefined> {
		const scope = getScopedLogger();
		const resource = await this.requireRestResource(
			provider,
			token,
			project.resourceName,
			options.baseUrl,
			'workItems',
			'6.0',
		);

		let issueResult: WorkItem | undefined;
		try {
			issueResult = await this.getWorkItem(
				provider,
				token,
				project.resourceName,
				project.name,
				id,
				options.baseUrl,
				resource,
				scope,
			);
		} catch (ex) {
			// A rejected credential is actionable and must not be reported as an absent work item; every other
			// non-404 keeps the existing degrade-to-undefined behavior.
			if (ex instanceof AuthenticationError) throw ex;

			if (ex.original?.status !== 404) {
				scope?.error(ex);
				return undefined;
			}
		}

		if (issueResult != null) {
			await this.requireWorkItemProject(
				provider,
				token,
				project.resourceName,
				project.name,
				issueResult,
				options.baseUrl,
				scope,
			);
			const issueType = issueResult.fields['System.WorkItemType'];
			const state = issueResult.fields['System.State'];
			const [stateCategory, htmlFields, viewer] = await Promise.all([
				this.getWorkItemStateCategory(
					issueType,
					state,
					provider,
					token,
					project.resourceName,
					project.name,
					options,
				),
				this.getWorkItemHtmlFields(
					provider,
					token,
					project.resourceName,
					options.baseUrl,
					issueResult.fields,
					scope,
				),
				options.viewer?.(),
			]);
			return fromAzureWorkItem(issueResult, provider, project, stateCategory, 'point', htmlFields, viewer);
		}

		return undefined;
	}

	@trace({
		args: (provider, token, owner, repo, rev, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			rev: rev,
			baseUrl: baseUrl,
		}),
	})
	async getAccountForCommit(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		rev: string,
		baseUrl: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<UnidentifiedAuthor | undefined> {
		const scope = getScopedLogger();
		const { projectName, repoName } = parseAzureRepositoryDescriptor(repo);

		try {
			// Try to get the Work item (wit) first with specific fields
			const commit = await this.request<AzureGitCommit>(
				provider,
				token,
				baseUrl,
				`${encodeAzurePathSegment(owner)}/${encodeAzurePathSegment(projectName)}/_apis/git/repositories/${encodeAzurePathSegment(repoName)}/commits/${encodeAzurePathSegment(rev)}`,
				{
					method: 'GET',
				},
				scope,
			);
			const author = commit?.author;
			if (!author) {
				return undefined;
			}
			// Azure API never gives us an id/username we can use, therefore we always return UnidentifiedAuthor
			return {
				provider: provider,
				id: undefined,
				username: undefined,
				name: author?.name,
				email: author?.email,
				avatarUrl: undefined,
			} satisfies UnidentifiedAuthor;
		} catch (ex) {
			// A rejected credential is actionable and must not be reported as an absent work item; every other
			// non-404 keeps the existing degrade-to-undefined behavior.
			if (ex instanceof AuthenticationError) throw ex;

			if (ex.original?.status !== 404) {
				scope?.error(ex);
				return undefined;
			}
		}

		return undefined;
	}

	/**
	 * The collection an Azure DevOps Server address names, or `undefined` when it names the installation.
	 *
	 * Below a collection, `connectionData` describes that collection: its `instanceId` is the collection's id, and its
	 * `webApplicationRelativeDirectory` ends in the collection's path segment (`DefaultCollection/`); it is empty or
	 * absent at the server level. As measured against Azure DevOps Server 2020. The directory may also carry the
	 * installation's own virtual directory before the collection (`tfs/DefaultCollection/`), so only its LAST segment
	 * names the collection, and only when it is the last segment of the address asked about.
	 */
	@trace({
		args: (provider, token, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			baseUrl: baseUrl,
		}),
	})
	async getAddressedCollection(
		provider: Provider,
		token: TokenWithInfo,
		baseUrl: string,
	): Promise<{ id: string; name: string } | undefined> {
		const scope = getScopedLogger();
		const connectionData = await this.request<{ instanceId?: string; webApplicationRelativeDirectory?: string }>(
			provider,
			token,
			baseUrl,
			'_apis/connectionData',
			{ method: 'GET' },
			scope,
		);
		const segment = connectionData?.webApplicationRelativeDirectory?.split('/').findLast(Boolean);
		const addressed = new URL(baseUrl).pathname.split('/').findLast(Boolean);
		if (segment == null || addressed == null || connectionData?.instanceId == null) return undefined;

		const name = decodePathSegment(segment);
		if (name.toLowerCase() !== decodePathSegment(addressed).toLowerCase()) return undefined;

		return { id: connectionData.instanceId, name: name };
	}

	@trace({
		args: (provider, token, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			baseUrl: baseUrl,
		}),
	})
	async getCurrentUserOnServer(
		provider: Provider,
		token: TokenWithInfo,
		baseUrl: string,
	): Promise<{ id: string; name?: string; email?: string; username?: string; avatarUrl?: string } | undefined> {
		const scope = getScopedLogger();

		try {
			const connectionData = await this.request<{
				authenticatedUser?: {
					id: string;
					descriptor: string;
					isActive: boolean;
					metTypeId: number;
					providerDisplayName?: string;
					emailAddress?: string;
					resourceVersion: 2;
					subjectDescriptor: string;
					properties?: {
						Account?: {
							$type: string;
							$value: string;
						};
					};
				};
			}>(
				provider,
				token,
				baseUrl,
				'_apis/connectionData',
				{
					method: 'GET',
				},
				scope,
			);

			const user = connectionData?.authenticatedUser;
			const username = user?.properties?.Account?.$value;
			if (!username) {
				return undefined;
			}

			return {
				id: user.id,
				name: user.providerDisplayName,
				email: user.emailAddress,
				username: username,
			};
		} catch (ex) {
			scope?.error(ex, `Failed to get current user from ${baseUrl}`);
			throw ex;
		}
	}

	async getWorkItemStateCategory(
		issueType: string,
		state: string,
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		projectName: string,
		options: {
			baseUrl: string;
		},
		cancellation?: AbortSignal,
	): Promise<AzureWorkItemStateCategory | undefined> {
		const states = await this.getWorkItemTypeStates(
			provider,
			token,
			owner,
			projectName,
			issueType,
			options.baseUrl,
			cancellation,
		);
		return resolveAzureWorkItemStateCategory(states, state);
	}

	private getWorkItemTypeStates(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		project: string,
		type: string,
		baseUrl: string,
		cancellation?: AbortSignal,
	) {
		return this._workItemStates.getStates(
			{ baseUrl: baseUrl, namespace: owner, project: project, token: token.accessToken, isPAT: true },
			type,
			async signal => {
				const resource = await this.requireRestResource(
					provider,
					token,
					owner,
					baseUrl,
					'workItemTypeStates',
					'6.0-preview.1',
					signal,
				);
				return this.request(
					provider,
					token,
					baseUrl,
					getAzureWorkItemTypeStatesPath(owner, project, type, resource.apiVersion),
					{ method: 'GET' },
					undefined,
					signal,
				);
			},
			cancellation,
			async signal => {
				const resource = await this.requireRestResource(
					provider,
					token,
					owner,
					baseUrl,
					'backlogConfiguration',
					'6.0-preview.1',
					signal,
				);
				const path = `${encodeAzurePathSegment(owner)}/${encodeAzurePathSegment(project)}/_apis/work/backlogconfiguration?api-version=${resource.apiVersion}`;
				return this.request(provider, token, baseUrl, path, { method: 'GET' }, undefined, signal);
			},
		);
	}

	@trace({
		args: (provider, token, owner, repo) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
		}),
	})
	async getRepositoryMetadata(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		options: {
			baseUrl: string;
		},
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		const scope = getScopedLogger();
		const resource = await this.requireRestResource(
			provider,
			token,
			owner,
			options.baseUrl,
			'repositories',
			'7.1',
			cancellation,
		);

		try {
			const response = await this.getRepository(
				provider,
				token,
				owner,
				repo,
				options.baseUrl,
				resource.apiVersion,
				scope,
				cancellation,
			);
			if (response == null) return undefined;

			// Azure's `parentRepository` only reliably carries the repo name and its project; a fork's parent
			// lives in the same organization, so the org (`owner`) is the parent owner. Only report `parent`
			// when the parent's name is actually present — never fall back to the fork's own name.
			return {
				provider: provider,
				owner: owner,
				// Prefer the API's canonical name over parsing the composite `repo` descriptor string.
				name: response.name,
				isFork: response.isFork ?? false,
				parent:
					response.isFork && response.parentRepository?.name != null
						? { owner: owner, name: response.parentRepository.name }
						: undefined,
			} satisfies RepositoryMetadata;
		} catch (ex) {
			// A rejected credential is not a probe outcome: it is actionable, and the caller routes it into the
			// session recovery. A cancellation or a 404 still degrades quietly.
			if (ex instanceof AuthenticationError) throw ex;

			// Cancellations and 404s are expected outcomes for a probe; don't log them as errors.
			if (!isCancellationError(ex) && !(ex instanceof RequestNotFoundError)) {
				scope?.error(ex);
			}
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, repo) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
		}),
	})
	async getDefaultBranch(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		options: {
			baseUrl: string;
		},
		cancellation?: AbortSignal,
	): Promise<DefaultBranch | undefined> {
		const scope = getScopedLogger();
		const resource = await this.requireRestResource(
			provider,
			token,
			owner,
			options.baseUrl,
			'repositories',
			'7.1',
			cancellation,
		);

		try {
			const response = await this.getRepository(
				provider,
				token,
				owner,
				repo,
				options.baseUrl,
				resource.apiVersion,
				scope,
				cancellation,
			);
			if (response?.defaultBranch == null) return undefined;

			return {
				provider: provider,
				name: normalizeAzureBranchName(response.defaultBranch),
			} satisfies DefaultBranch;
		} catch (ex) {
			// A rejected credential is not a probe outcome: it is actionable, and the caller routes it into the
			// session recovery. A cancellation or a 404 still degrades quietly.
			if (ex instanceof AuthenticationError) throw ex;

			// Cancellations and 404s are expected outcomes for a probe; don't log them as errors.
			if (!isCancellationError(ex) && !(ex instanceof RequestNotFoundError)) {
				scope?.error(ex);
			}
			return undefined;
		}
	}

	/**
	 * One page of a filtered work-item search over a collection: bounded WIQL queries for the ordered ids, then one
	 * detail read for the page's slice of them.
	 *
	 * The ids a first page queried are kept as the snapshot its continuations page through, for as long as the
	 * pagination keeps reading it, so metadata changes cannot retarget the continuation. Each first page queries its
	 * own snapshot, so paginations never share one. A continuation whose snapshot is gone is refused (see
	 * {@link AzureWorkItemSearchCursor}).
	 *
	 * The query asks for one id more than {@link azureWorkItemSearchResultLimit}, bounded by `$top`: the extra id is
	 * what tells "exactly the limit" from "past it". Past it, the page is `truncated` with `limitReached` and no total,
	 * since the true count is unknowable here. A server that refuses the match set even so fails the page with a
	 * "narrow the search" error: no bounded query could serve that order's first window.
	 *
	 * `resolveProject` maps each result's project name to its descriptor. A work item in a project it doesn't know
	 * fails the page rather than being dropped or mis-attributed, since either would leave the page disagreeing with
	 * the count of the same query; the caller refreshes its project discovery before a search so that means a
	 * project created during the pagination.
	 *
	 * `viewer` resolves the current user as the collection's work items identify them, set as each row's `viewer`, or
	 * `null` when it couldn't be resolved, which marks the rows `viewerUnresolved`. It's asked once for a page that read
	 * any work item, and never rejects.
	 */
	@trace({
		args: (provider, token, collection) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			collection: collection,
		}),
	})
	async searchWorkItemsPage(
		provider: Provider,
		token: TokenWithInfo,
		collection: string,
		options: WorkItemSearchOptions & {
			resolveProject: (name: string) => AzureProjectDescriptor | undefined;
			viewer?: () => Promise<{ id: string } | null>;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<ProviderIssueSearchPage> {
		const scope = getScopedLogger();
		if (cancellation?.aborted) throw new CancellationError();

		const identity = JSON.stringify([
			options.criteria?.state ?? 'open',
			toAzureWorkItemSearchWiql(
				{ ...options.criteria, state: 'all' },
				effectiveIssueSort(options.criteria?.sort),
				options.projectNames,
			),
		]);
		const key = toAzureWorkItemSearchCursorKey(collection, identity);
		const pageSize = toAzureSearchPageSize(options.pageSize, 100, azureWorkItemBatchLimit);
		const cursor = parseAzureWorkItemSearchCursor(options.cursor, key, pageSize);
		const page = cursor?.page ?? 1;

		// Keep the full request identity: metadata changes cannot retarget a live snapshot, and a hash collision
		// cannot let a different query or credential read it.
		const snapshot = cursor?.snapshot ?? uuid();
		const snapshotKey = JSON.stringify([
			await sha256(token.accessToken),
			options.baseUrl,
			collection,
			identity,
			snapshot,
		]);
		// A continuation only ever READS its snapshot: resuming against a fresh query could skip a work item silently.
		const snapshotFound = cursor?.snapshot != null ? this._workItemSearches.get(snapshotKey) : undefined;
		if (cursor?.snapshot != null && snapshotFound == null) {
			throw new Error('Work item search results expired; restart the read without a cursor');
		}

		const result = await (snapshotFound ??
			this._workItemSearches.getOrCreate(
				snapshotKey,
				(_cacheable, signal) =>
					this.readWorkItemSearch(provider, token, collection, options, true, scope, signal).catch(
						(ex: unknown) => {
							if (isWorkItemLimitRefusal(ex)) {
								throw new Error(
									`${provider.name} refused a work item search matching more than ${azureWorkItemSearchResultLimit} results; narrow the search`,
								);
							}

							throw ex;
						},
					),
				{ cancellation: cancellation },
			));
		if (cancellation?.aborted) throw new CancellationError();

		const limitReached = result.length > azureWorkItemSearchResultLimit;
		const ids = limitReached ? result.slice(0, azureWorkItemSearchResultLimit) : result;

		const offset = cursor?.offset ?? 0;

		const slice = ids.slice(offset, offset + pageSize);
		const values: Issue[] = [];
		if (slice.length > 0) {
			const batch = await this.getRestResource(
				provider,
				token,
				collection,
				options.baseUrl,
				'workItemsBatch',
				'5.0',
				cancellation,
			);
			const resource =
				batch ??
				(await this.requireRestResource(
					provider,
					token,
					collection,
					options.baseUrl,
					'workItems',
					'5.0',
					cancellation,
				));
			const route =
				batch != null
					? `workitemsbatch?api-version=${resource.apiVersion}`
					: `workitems?ids=${slice.join(',')}&$expand=Links&errorPolicy=Omit&api-version=${resource.apiVersion}`;
			const workItems = await this.request<{ value: (WorkItem | null)[] }>(
				provider,
				token,
				options.baseUrl,
				`${encodeAzurePathSegment(collection)}/_apis/wit/${route}`,
				batch != null
					? { method: 'POST', body: JSON.stringify({ ids: slice, $expand: 'Links', errorPolicy: 'Omit' }) }
					: { method: 'GET' },
				scope,
				cancellation,
			);
			const byId = new Map((workItems?.value ?? []).filter(w => w != null).map(w => [w.id, w]));
			const viewer = byId.size > 0 ? await options.viewer?.() : undefined;
			for (const id of slice) {
				// A work item deleted since the ids were queried is gone, not a failure: skipping it keeps the page
				// honest, since it no longer matches anything.
				const workItem = byId.get(id);
				if (workItem == null) continue;

				const projectName = workItem.fields['System.TeamProject'];
				if (
					options.projectNames?.length &&
					!options.projectNames.some(name => name.toLowerCase() === projectName?.toLowerCase())
				) {
					throw new Error(`Azure DevOps work item ${id} is outside the requested projects`);
				}

				const project = options.resolveProject(projectName);
				if (project == null) {
					throw new Error(`Azure DevOps work item ${id} is in project '${projectName}', which isn't visible`);
				}

				if (cancellation?.aborted) throw new CancellationError();

				const stateCategory = await this.getWorkItemStateCategory(
					workItem.fields['System.WorkItemType'],
					workItem.fields['System.State'],
					provider,
					token,
					collection,
					project.name,
					options,
					cancellation,
				);
				const htmlFields = await this.getWorkItemHtmlFields(
					provider,
					token,
					collection,
					options.baseUrl,
					workItem.fields,
					scope,
					cancellation,
				);
				values.push(
					fromAzureWorkItem(workItem, provider, project, stateCategory, 'search', htmlFields, viewer),
				);
			}
		}

		if (cancellation?.aborted) throw new CancellationError();

		const nextOffset = offset + slice.length;
		const hasMore = nextOffset < ids.length;
		const next: AzureWorkItemSearchCursor = { key: key, snapshot: snapshot, offset: nextOffset, page: page + 1 };
		return {
			values: values,
			cursor: hasMore ? JSON.stringify(next) : undefined,
			hasMore: hasMore,
			page: page,
			truncated: limitReached,
			totalCount: limitReached ? undefined : ids.length,
			limitReached: limitReached || undefined,
		};
	}

	/**
	 * How many work items the same WIQL {@link searchWorkItemsPage} would page through match, reading no details.
	 *
	 * Asks for one id more than the result ceiling, so the count is exact up to it and `'exceeds-limit'` past it —
	 * never the ceiling itself, which would understate the match set.
	 */
	@trace({
		args: (provider, token, collection) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			collection: collection,
		}),
	})
	async countWorkItems(
		provider: Provider,
		token: TokenWithInfo,
		collection: string,
		options: WorkItemSearchOptions,
		cancellation?: AbortSignal,
	): Promise<number | 'exceeds-limit'> {
		const scope = getScopedLogger();
		if (cancellation?.aborted) throw new CancellationError();

		try {
			const result = await this.readWorkItemSearch(
				provider,
				token,
				collection,
				options,
				false,
				scope,
				cancellation,
			);
			return result.length > azureWorkItemSearchResultLimit ? 'exceeds-limit' : result.length;
		} catch (ex) {
			if (isWorkItemLimitRefusal(ex)) return 'exceeds-limit';

			throw ex;
		}
	}

	private async readWorkItemSearch(
		provider: Provider,
		token: TokenWithInfo,
		collection: string,
		options: WorkItemSearchOptions,
		ordered: boolean,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
	): Promise<number[]> {
		const queries = await this.getWorkItemSearchQueries(provider, token, collection, options, cancellation);
		return queryAzureWorkItemSearch(
			queries,
			effectiveIssueSort(options.criteria?.sort),
			ordered,
			(wiql, top, asOf) =>
				this.queryWorkItemIds(
					provider,
					token,
					collection,
					options.baseUrl,
					wiql,
					top,
					scope,
					cancellation,
					asOf,
				),
			cancellation,
		);
	}

	private async getWorkItemSearchQueries(
		provider: Provider,
		token: TokenWithInfo,
		collection: string,
		options: WorkItemSearchOptions,
		cancellation?: AbortSignal,
	): Promise<string[]> {
		if (cancellation?.aborted) throw new CancellationError();

		const projectNames = options.projectNames ?? options.workflowProjectNames ?? [];
		let workflows: Map<string, AzureWorkItemTypeStates> | undefined;
		if (options.criteria?.state !== 'all') {
			const types = (
				await mapBounded(projectNames, workItemMetadataConcurrency, async project => {
					if (cancellation?.aborted) throw new CancellationError();

					const scope = {
						baseUrl: options.baseUrl,
						namespace: collection,
						project: project,
						token: token.accessToken,
						isPAT: true,
					};
					const names = await this._workItemStates.getTypes(
						scope,
						async signal => {
							const resource = await this.requireRestResource(
								provider,
								token,
								collection,
								options.baseUrl,
								'workItemTypes',
								'6.0',
								signal,
							);
							return this.request(
								provider,
								token,
								undefined,
								getAzureWorkItemTypesUrl(options.baseUrl, collection, project, resource.apiVersion),
								{ method: 'GET' },
								undefined,
								signal,
							);
						},
						cancellation,
					);
					return names.map(name => ({ project: project, name: name, scope: scope }));
				})
			).flat();
			const states = await mapBounded(types, workItemMetadataConcurrency, async type => ({
				name: type.name,
				project: type.project,
				states: requireAzureWorkItemStateCategories(
					await this.getWorkItemTypeStates(
						provider,
						token,
						collection,
						type.project,
						type.name,
						options.baseUrl,
						cancellation,
					),
				),
			}));
			workflows = new Map(
				projectNames.map(project => [project, { types: states.filter(type => type.project === project) }]),
			);
		}

		return toAzureWorkItemSearchQueries(
			options.criteria,
			effectiveIssueSort(options.criteria?.sort),
			projectNames,
			workflows,
		);
	}

	/**
	 * The ids a collection-level WIQL query matches, in its order.
	 *
	 * `timePrecision=true` lets the criteria's dates compare as instants, including on legacy servers.
	 */
	private async queryWorkItemIds(
		provider: Provider,
		token: TokenWithInfo,
		collection: string,
		baseUrl: string,
		wiql: string,
		top: number,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
		asOf?: string,
	): Promise<{ ids: number[]; asOf?: string }> {
		const query = asOf == null ? wiql : `${wiql} ASOF '${asOf}'`;
		if (query.length > azureWorkItemWiqlLengthLimit) {
			throw new Error('Azure DevOps work item search query is too long; narrow the search');
		}

		const resource = await this.requireRestResource(
			provider,
			token,
			collection,
			baseUrl,
			'wiql',
			'5.0',
			cancellation,
		);
		const result = await this.request<{ workItems?: { id: number }[]; asOf?: string }>(
			provider,
			token,
			baseUrl,
			`${encodeAzurePathSegment(collection)}/_apis/wit/wiql?$top=${top}&timePrecision=true&api-version=${resource.apiVersion}`,
			{ method: 'POST', body: JSON.stringify({ query: query }) },
			scope,
			cancellation,
		);
		if (result?.workItems == null) throw new Error('Azure DevOps returned no work item query result');

		return { ids: result.workItems.map(w => w.id), asOf: result.asOf };
	}

	private async getRepository(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		baseUrl: string,
		apiVersion: string,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
	): Promise<AzureRepositoryWithMetadata | undefined> {
		const { projectName, repoName } = parseAzureRepositoryDescriptor(repo);
		const encodedProject = encodeAzurePathSegment(projectName);
		const encodedRepo = encodeAzurePathSegment(repoName);
		return this.request<AzureRepositoryWithMetadata>(
			provider,
			token,
			baseUrl,
			`${encodeAzurePathSegment(owner)}/${encodedProject}/_apis/git/repositories/${encodedRepo}?api-version=${apiVersion}`,
			{ method: 'GET' },
			scope,
			cancellation,
		);
	}

	private async toPullRequest(
		pr: AzurePullRequest,
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		baseUrl: string,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
	): Promise<PullRequest> {
		const forkRepositoryUrls = await this.getForkRepositoryUrls(
			provider,
			token,
			owner,
			baseUrl,
			pr.forkSource?.repository,
			scope,
			cancellation,
		);
		// Only the point reads convert through here.
		return fromAzurePullRequest(pr, provider, owner, baseUrl, forkRepositoryUrls, 'point');
	}

	/**
	 * Resolves the web and HTTPS clone URLs of the fork a cross-repository pull request comes from. Every other
	 * repository URL the model reports is rebuilt from the pull request payload; only a fork reference lacks the
	 * project to do that, so only a fork costs a request.
	 *
	 * Best-effort by contract: a fork in a project the token cannot read, a deleted fork, or a throttled request
	 * leaves the head ref without a URL. It must never cost the pull request itself, which is what makes swallowing
	 * the failure here the right call rather than a shortcut.
	 */
	private async getForkRepositoryUrls(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		baseUrl: string,
		repository: AzureRepositoryReference | undefined,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
	): Promise<AzureForkRepositoryUrls | undefined> {
		if (repository == null) return undefined;

		let tokenHash: string;
		try {
			tokenHash = await sha256(token.accessToken);
		} catch {
			return undefined;
		}

		const cacheKey = JSON.stringify([tokenHash, baseUrl, owner, repository.id]);
		// The request is shared, so the factory is handed the cache's aggregate signal rather than this caller's: it
		// aborts only once every caller waiting on the entry has cancelled.
		return this._forkRepositoryUrls.getOrCreate(
			cacheKey,
			(cacheable, aggregate) =>
				this.fetchForkRepositoryUrls(
					provider,
					token,
					owner,
					baseUrl,
					repository.id,
					cacheable,
					scope,
					aggregate,
				),
			{ cancellation: cancellation },
		);
	}

	private async fetchForkRepositoryUrls(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		baseUrl: string,
		repositoryId: string,
		cacheable: CacheController,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
	): Promise<AzureForkRepositoryUrls | undefined> {
		try {
			encodeAzurePathSegment(repositoryId);
			const resource = await this.requireRestResource(
				provider,
				token,
				owner,
				baseUrl,
				'repositories',
				'4.1',
				cancellation,
			);
			const response = await this.request<AzureRepositoryUrls>(
				provider,
				token,
				baseUrl,
				`${encodeAzurePathSegment(owner)}/_apis/git/repositories/${encodeAzurePathSegment(repositoryId)}?api-version=${resource.apiVersion}`,
				{ method: 'GET' },
				scope,
				cancellation,
			);
			const webUrl = sanitizeAzureRepositoryUrl(response?.webUrl, baseUrl, owner);
			const cloneHttps = sanitizeAzureRepositoryUrl(response?.remoteUrl, baseUrl, owner);

			// The clone URL stands in for the web URL when the response omits it — an older `api-version` promises
			// neither field, and naming the fork by the URL git would use beats naming it not at all.
			const url = webUrl ?? cloneHttps;
			if (url == null) {
				cacheable.invalidate();
				return undefined;
			}

			return { url: url, cloneHttps: cloneHttps };
		} catch (ex) {
			// Missing or inaccessible forks are cached briefly; transient failures retry on the next read.
			if (!(ex instanceof RequestNotFoundError) && !(ex instanceof AuthenticationError)) {
				cacheable.invalidate();
			}

			const status = ex instanceof ProviderFetchError ? ` (${ex.status})` : '';
			scope?.warn(`Unable to resolve the fork repository URLs${status}`);
			return undefined;
		}
	}

	private async getWorkItem(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		project: string,
		id: string,
		baseUrl: string,
		resource: AzureDevOpsRestResourceInfo,
		scope: ScopedLogger | undefined,
	): Promise<WorkItem | undefined> {
		const encodedProject = encodeAzurePathSegment(project);
		const encodedId = encodeAzurePathSegment(id);
		const projectPath = resource.projectScoped ? `/${encodedProject}` : '';
		return this.request<WorkItem>(
			provider,
			token,
			baseUrl,
			`${encodeAzurePathSegment(owner)}${projectPath}/_apis/wit/workItems/${encodedId}?api-version=${resource.apiVersion}`,
			{ method: 'GET' },
			scope,
		);
	}

	private async requireWorkItemProject(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		project: string,
		workItem: WorkItem,
		baseUrl: string,
		scope: ScopedLogger | undefined,
	): Promise<void> {
		const actualProject = workItem.fields?.['System.TeamProject'];
		if (typeof actualProject !== 'string' || !actualProject.trim()) {
			throw new Error(`Azure DevOps work item ${workItem.id} has no project`);
		}

		if (actualProject.toLowerCase() === project.toLowerCase()) return;

		const canonical = await this.request<{ name: string }>(
			provider,
			token,
			baseUrl,
			`${encodeAzurePathSegment(owner)}/_apis/projects/${encodeAzurePathSegment(project)}`,
			{ method: 'GET' },
			scope,
		);
		if (canonical?.name?.toLowerCase() !== actualProject.toLowerCase()) {
			throw new Error(`Azure DevOps work item ${workItem.id} is outside the requested project`);
		}
	}

	private async getWorkItemHtmlFields(
		provider: Provider,
		token: TokenWithInfo,
		namespace: string,
		baseUrl: string,
		fields: WorkItem['fields'],
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
	): Promise<readonly AzureWorkItemHtmlField[]> {
		try {
			const requestToken = { ...token };
			return await this._workItemDescriptions.getFields(
				fields,
				{ baseUrl: baseUrl, namespace: namespace, token: requestToken.accessToken, isPAT: true },
				async signal => {
					const resource = await this.requireRestResource(
						provider,
						requestToken,
						namespace,
						baseUrl,
						'fields',
						'6.0',
						signal,
					);
					return this.request(
						provider,
						requestToken,
						baseUrl,
						`${encodeAzurePathSegment(namespace)}/_apis/wit/fields?api-version=${resource.apiVersion}`,
						{ method: 'GET' },
						undefined,
						signal,
					);
				},
				cancellation,
			);
		} catch (ex) {
			if (isCancellationError(ex) && cancellation?.aborted) throw ex;

			scope?.warn(`Unable to read the Azure DevOps field catalog of '${namespace}': ${ex}`);
			return [];
		}
	}

	private async getRestResource(
		provider: Provider,
		token: TokenWithInfo,
		namespace: string,
		baseUrl: string,
		resource: AzureDevOpsRestResource,
		version: string,
		cancellation?: AbortSignal,
	): Promise<AzureDevOpsRestResourceInfo | undefined> {
		try {
			if (cancellation?.aborted) throw new CancellationError();

			encodeAzurePathSegment(namespace);
			const discovery = this.config.wrapForForcedInsecureSSL(provider.getIgnoreSSLErrors(), () =>
				this.restApi.getRestApiResource(
					{ namespace: namespace, resource: resource, version: version },
					{ token: token.accessToken, isPAT: true, baseUrl: baseUrl },
				),
			);
			if (cancellation?.aborted) {
				// The race skips observing discovery when setup aborts its caller synchronously.
				void discovery.catch(() => {});
			}

			return await (cancellation != null ? raceWithSignal(discovery, cancellation) : discovery);
		} catch (ex) {
			return throwProviderError(token, ex);
		}
	}

	private async requireRestResource(
		provider: Provider,
		token: TokenWithInfo,
		namespace: string,
		baseUrl: string,
		resource: AzureDevOpsRestResource,
		version: string,
		cancellation?: AbortSignal,
	): Promise<AzureDevOpsRestResourceInfo> {
		let result: AzureDevOpsRestResourceInfo | undefined;
		try {
			result = await this.getRestResource(provider, token, namespace, baseUrl, resource, version, cancellation);
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) {
				throw new Error('Azure DevOps REST resource discovery failed', { cause: ex });
			}

			throw ex;
		}
		if (result == null) throw new Error(`Azure DevOps REST resource ${resource} is unavailable`);

		return result;
	}

	private async request<T>(
		provider: Provider,
		token: TokenWithInfo,
		baseUrl: string | undefined,
		route: string,
		options: { method: RequestInit['method'] } & Record<string, unknown>,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal | undefined,
	): Promise<T | undefined> {
		const { accessToken } = token;
		const url = baseUrl ? `${baseUrl}/${route}` : route;

		let rsp: Response;
		try {
			const sw = maybeStopWatch(`[AZURE] ${options?.method ?? 'GET'} request`, { log: { onlyExit: true } });

			try {
				if (cancellation?.aborted) throw new CancellationError();

				rsp = await this.config.wrapForForcedInsecureSSL(provider.getIgnoreSSLErrors(), () =>
					this.config.fetch(url, {
						headers: {
							Authorization: `Basic ${base64(`PAT:${accessToken}`)}`,
							'Content-Type': 'application/json',
						},
						signal: cancellation,
						...options,
					}),
				);

				if (rsp.ok) {
					// Azure answers a rejected credential by redirecting to its sign-in page, which returns `203
					// text/html` rather than `401`. `rsp.ok` spans 200-299, so that page used to reach `json()` and
					// die as a bare `SyntaxError` — which `getIssue` and friends catch and report as "not found",
					// making an invalid credential indistinguishable from a missing work item (GKDEV-3617).
					const contentType = rsp.headers.get('content-type')?.toLowerCase() ?? '';
					if (contentType.startsWith('text/html')) {
						const { accessToken: _accessToken, ...tokenInfo } = token;
						throw new AuthenticationError(
							tokenInfo,
							AuthenticationErrorReason.Unauthorized,
							new Error(`(${rsp.status}) Azure DevOps returned a sign-in page instead of data`),
						);
					}

					return (await rsp.json()) as T;
				}

				// Reads the body so the 403 branch below can tell a throttled request from a permission failure.
				throw await ProviderFetchError.fromResponse('AzureDevOps', rsp);
			} finally {
				sw?.stop();
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError || ex.name === 'AbortError') {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				this.config.onError?.(`AzureDevOps request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private handleRequestError(
		provider: Provider | undefined,
		token: TokenWithInfo,
		ex: ProviderFetchError | (Error & { name: 'AbortError' }),
		scope: ScopedLogger | undefined,
	): void {
		if (ex.name === 'AbortError' || !(ex instanceof ProviderFetchError)) throw new CancellationError(ex);

		const { accessToken, ...tokenInfo } = token;
		switch (ex.status) {
			case 404: // Not found
			case 410: // Gone
			case 422: // Unprocessable Entity
				throw new RequestNotFoundError(ex);
			case 401: // Unauthorized
				throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Unauthorized, ex);
			case 429: // Too Many Requests
				throw toRateLimitError(ex, accessToken);
			case 403: // Forbidden
				// Azure returns 403 for both a permission failure and a throttled request ("Request was blocked
				// due to exceeding usage of resource 'RateLimit'"), so the message is the discriminant. Reporting
				// a throttle as `auth` would prompt the user to re-authenticate a healthy connection instead of
				// retrying (see `isRateLimitResponse`).
				if (isRateLimitResponse(ex)) throw toRateLimitError(ex, accessToken);

				throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				scope?.error(ex);
				if (ex.response != null) {
					this.config.onRequestFailed?.(
						provider == null || provider.id === 'azure'
							? l10n.t(
									'{0} failed to respond and might be experiencing issues. Please visit the [AzureDevOps status page](https://status.dev.azure.com) for more information.',
									provider?.name ?? 'AzureDevOps',
								)
							: l10n.t('{0} failed to respond and might be experiencing issues.', provider.name),
					);
				}
				return;
			case 502: // Bad Gateway
				scope?.error(ex);
				// TODO: Learn the Azure API docs and put it in order:
				// if (ex.message.includes('timeout')) {
				// 	provider?.trackRequestException();
				// 	void showIntegrationRequestTimedOutWarningMessage(provider?.name ?? 'Azure');
				// 	return;
				// }
				break;
			default:
				if (ex.status >= 400 && ex.status < 500) throw new RequestClientError(ex);
				break;
		}

		scope?.error(ex);
		if (Logger.isDebugging) {
			this.config.onError?.(
				`AzureDevOps request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}
}

/** Wires an {@link AzureDevOpsApi} from the full runtime context, mapping `ctx` down to the narrow config. */
export function createAzureDevOpsApi(
	ctx: IntegrationServiceContext,
	workItemStates?: AzureWorkItemStatesCache,
	workItemDescriptions?: AzureWorkItemDescriptionsCache,
): AzureDevOpsApi {
	return new AzureDevOpsApi(baseProviderApiConfig(ctx), workItemStates, workItemDescriptions);
}
