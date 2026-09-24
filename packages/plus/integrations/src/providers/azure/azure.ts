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
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { sha256, uuid } from '@gitlens/utils/crypto.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
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
import type {
	AzureForkRepositoryUrls,
	AzureGitCommit,
	AzureProjectDescriptor,
	AzurePullRequest,
	AzurePullRequestWithLinks,
	AzureRepositoryReference,
	AzureRepositoryUrls,
	AzureRepositoryWithMetadata,
	AzureWorkItemState,
	AzureWorkItemStateCategory,
	WorkItem,
} from './models.js';
import {
	azurePullRequestStatusToState,
	azureWorkItemsStateCategoryToState,
	fromAzurePullRequest,
	fromAzureWorkItem,
	getAzurePullRequestWebUrl,
	isClosedAzurePullRequestStatus,
	isClosedAzureWorkItemStateCategory,
	normalizeAzureBranchName,
	sanitizeAzureRepositoryUrl,
} from './models.js';
import type { AzureWorkItemSearchCursor } from './search.js';
import {
	azureWorkItemBatchLimit,
	azureWorkItemSearchResultLimit,
	parseAzureWorkItemSearchCursor,
	toAzureSearchPageSize,
	toAzureWorkItemSearchCursorKey,
	toAzureWorkItemSearchWiql,
} from './search.js';

const forkRepositoryUrlCacheTtl = 5 * 60 * 1000;
/** How long a work-item search's id snapshot outlives the last page read from it, and the most it lives at all. */
const workItemSearchSnapshotTtl = 5 * 60 * 1000;
const workItemSearchSnapshotMaxTtl = 30 * 60 * 1000;

function encodePathSegment(value: string): string {
	if (value === '.' || value === '..') throw new Error(`Invalid Azure path segment '${value}'.`);

	return encodeURIComponent(value);
}

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

class WorkItemStates {
	private readonly _categories = new Map<string, AzureWorkItemStateCategory>();
	private readonly _types = new Map<string, AzureWorkItemState[]>();

	// TODO@sergeibbb: we might need some logic for invalidating
	public getStateCategory(
		project: string,
		workItemType: string,
		stateName: string,
	): AzureWorkItemStateCategory | undefined {
		return this._categories.get(this.getStateKey(project, workItemType, stateName));
	}

	public clear(): void {
		this._categories.clear();
		this._types.clear();
	}

	public saveTypeStates(project: string, workItemType: string, states: AzureWorkItemState[]): void {
		this.clearTypeStates(project, workItemType);
		this._types.set(this.getTypeKey(project, workItemType), states);
		for (const state of states) {
			this._categories.set(this.getStateKey(project, workItemType, state.name), state.category);
		}
	}

	public hasTypeStates(project: string, workItemType: string): boolean {
		return this._types.has(this.getTypeKey(project, workItemType));
	}

	private clearTypeStates(project: string, workItemType: string): void {
		const states = this._types.get(this.getTypeKey(project, workItemType));
		if (states == null) return;

		for (const state of states) {
			this._categories.delete(this.getStateKey(project, workItemType, state.name));
		}
	}

	private getStateKey(project: string, workItemType: string, stateName: string): string {
		// By stringifying the pair as JSON we make sure that all possible special characters are escaped
		return JSON.stringify([project, workItemType, stateName]);
	}

	private getTypeKey(project: string, workItemType: string): string {
		return JSON.stringify([project, workItemType]);
	}
}

export class AzureDevOpsApi implements Disposable {
	private readonly _disposable: Disposable | undefined;
	private _workItemStates: WorkItemStates = new WorkItemStates();
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

	constructor(private readonly config: ProviderApiConfig) {
		this._disposable = config.onConfigChanged?.(() => this.resetCaches());
	}

	dispose(): void {
		this._disposable?.dispose();
	}

	private resetCaches(): void {
		this._workItemStates.clear();
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
				`${encodePathSegment(owner)}/${encodePathSegment(projectName)}/_apis/git/repositories/${encodePathSegment(repoName)}/pullRequests?searchCriteria.status=all&searchCriteria.sourceRefName=${encodeURIComponent(`refs/heads/${branch}`)}`,
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
		try {
			const prResult = await this.request<{ results: Record<string, AzurePullRequest[]>[] }>(
				provider,
				token,
				baseUrl,
				`${encodePathSegment(owner)}/${encodePathSegment(projectName)}/_apis/git/repositories/${encodePathSegment(repoName)}/pullrequestquery?api-version=4.1`,
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
				`${encodePathSegment(owner)}/${encodePathSegment(pr.repository.project.id)}/_apis/git/repositories/${encodePathSegment(pr.repository.id)}/pullRequests/${encodePathSegment(pr.pullRequestId.toString())}`,
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
			try {
				// Try to get the Work item (wit) first with specific fields
				const issueResult = await this.request<WorkItem>(
					provider,
					token,
					options?.baseUrl,
					`${encodePathSegment(owner)}/${encodePathSegment(projectName)}/_apis/wit/workItems/${encodePathSegment(id)}`,
					{
						method: 'GET',
					},
					scope,
				);

				if (issueResult != null) {
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

					return {
						id: issueResult.id.toString(),
						type: 'issue',
						nodeId: issueResult.id.toString(),
						provider: provider,
						createdDate: new Date(issueResult.fields['System.CreatedDate']),
						updatedDate: new Date(issueResult.fields['System.ChangedDate']),
						state: azureWorkItemsStateCategoryToState(stateCategory),
						closed: isClosedAzureWorkItemStateCategory(stateCategory),
						title: issueResult.fields['System.Title'],
						url: issueResult._links.html.href,
					};
				}
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

		if (options?.type === undefined || options?.type === 'pullrequest') {
			try {
				const prResult = await this.request<AzurePullRequestWithLinks>(
					provider,
					token,
					options?.baseUrl,
					`${encodePathSegment(owner)}/${encodePathSegment(projectName)}/_apis/git/repositories/${encodePathSegment(repoName)}/pullRequests/${encodePathSegment(id)}`,
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
		},
	): Promise<Issue | undefined> {
		const scope = getScopedLogger();

		try {
			// Try to get the Work item (wit) first with specific fields
			const issueResult = await this.request<WorkItem>(
				provider,
				token,
				options?.baseUrl,
				`${encodePathSegment(project.resourceName)}/${encodePathSegment(project.name)}/_apis/wit/workItems/${encodePathSegment(id)}`,
				{
					method: 'GET',
				},
				scope,
			);

			if (issueResult != null) {
				const issueType = issueResult.fields['System.WorkItemType'];
				const state = issueResult.fields['System.State'];
				const stateCategory = await this.getWorkItemStateCategory(
					issueType,
					state,
					provider,
					token,
					project.resourceName,
					project.name,
					options,
				);
				return fromAzureWorkItem(issueResult, provider, project, stateCategory);
			}
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
				`${encodePathSegment(owner)}/${encodePathSegment(projectName)}/_apis/git/repositories/${encodePathSegment(repoName)}/commits/${encodePathSegment(rev)}`,
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
			// A rejected credential is the whole point of this read failing; reporting "no user" instead hides it.
			if (ex instanceof AuthenticationError) throw ex;

			scope?.error(ex, `Failed to get current user from ${baseUrl}`);
			return undefined;
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
	): Promise<AzureWorkItemStateCategory | undefined> {
		// By installation too: this API is shared by every connection, and two installations can each have a
		// collection and project of the same name whose process maps a state to a different category.
		const project = JSON.stringify([options.baseUrl, owner, projectName]);
		const category = this._workItemStates.getStateCategory(project, issueType, state);
		if (category != null) return category;

		const states = await this.retrieveWorkItemTypeStates(issueType, provider, token, owner, projectName, options);
		this._workItemStates.saveTypeStates(project, issueType, states);

		return this._workItemStates.getStateCategory(project, issueType, state);
	}

	private async retrieveWorkItemTypeStates(
		workItemType: string,
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		projectName: string,
		options: {
			baseUrl: string;
		},
	): Promise<AzureWorkItemState[]> {
		const scope = getScopedLogger();

		try {
			const issueResult = await this.request<{ value: AzureWorkItemState[]; count: number }>(
				provider,
				token,
				options?.baseUrl,
				`${encodePathSegment(owner)}/${encodePathSegment(projectName)}/_apis/wit/workItemTypes/${encodePathSegment(workItemType)}/states`,
				{
					method: 'GET',
				},
				scope,
			);

			return issueResult?.value ?? [];
		} catch (ex) {
			// A rejected credential must not be degraded to an empty state list: the caller caches whatever this
			// returns, so an empty list would pin every work item of this type to an unknown state until the
			// cache is dropped — long after the session recovery this error is supposed to trigger.
			if (ex instanceof AuthenticationError) throw ex;

			scope?.error(ex);
			return [];
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

		try {
			const response = await this.getRepository(
				provider,
				token,
				owner,
				repo,
				options.baseUrl,
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

		try {
			const response = await this.getRepository(
				provider,
				token,
				owner,
				repo,
				options.baseUrl,
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
	 * One page of a filtered work-item search over a collection: a WIQL query for the ordered ids, then one detail
	 * read for the page's slice of them.
	 *
	 * The ids a first page queried are kept as the snapshot its continuations page through, for as long as the
	 * pagination keeps reading it, so it reads a consistent set rather than re-running a query whose rows move under
	 * an `updated` order. Each first page queries its own snapshot, so paginations of one query never share one, and
	 * a continuation whose snapshot is gone is refused (see {@link AzureWorkItemSearchCursor}).
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
		options: {
			baseUrl: string;
			criteria?: IssueSearchCriteria;
			projectNames?: readonly string[];
			resolveProject: (name: string) => AzureProjectDescriptor | undefined;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<ProviderIssueSearchPage> {
		const scope = getScopedLogger();
		const wiql = toAzureWorkItemSearchWiql(
			options.criteria,
			effectiveIssueSort(options.criteria?.sort),
			options.projectNames,
		);
		const key = toAzureWorkItemSearchCursorKey(collection, wiql);
		const pageSize = toAzureSearchPageSize(options.pageSize, 100, azureWorkItemBatchLimit);
		const cursor = parseAzureWorkItemSearchCursor(options.cursor, key, pageSize);
		const page = cursor?.page ?? 1;

		// Keyed by credential and address, and by the query itself rather than its fingerprint: two accounts on one
		// installation must never page through each other's matches, and two queries whose fingerprints collide must
		// never share a snapshot. The full credential digest, since the token's `microHash` is truncated for logs.
		// And by the snapshot's own id: a first page queries a new snapshot rather than replacing the query's, so a
		// pagination still reading an earlier one keeps it (see `AzureWorkItemSearchCursor`).
		const snapshot = cursor?.snapshot ?? uuid();
		const snapshotKey = JSON.stringify([
			await sha256(token.accessToken),
			options.baseUrl,
			collection,
			wiql,
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
					this.queryWorkItemIds(
						provider,
						token,
						collection,
						options.baseUrl,
						wiql,
						azureWorkItemSearchResultLimit + 1,
						scope,
						signal,
					).catch((ex: unknown) => {
						// `$top` is expected to bound the answer; should a server refuse the match set regardless, say
						// what happened rather than surfacing a bare client error.
						if (isWorkItemLimitRefusal(ex)) {
							throw new Error(
								`${provider.name} refused a work item search matching more than ${azureWorkItemSearchResultLimit} results; narrow the search`,
							);
						}

						throw ex;
					}),
				{ cancellation: cancellation },
			));
		const limitReached = result.length > azureWorkItemSearchResultLimit;
		const ids = limitReached ? result.slice(0, azureWorkItemSearchResultLimit) : result;

		const offset = cursor?.offset ?? 0;

		const slice = ids.slice(offset, offset + pageSize);
		const values: Issue[] = [];
		if (slice.length > 0) {
			const workItems = await this.request<{ value: (WorkItem | null)[] }>(
				provider,
				token,
				options.baseUrl,
				`${encodePathSegment(collection)}/_apis/wit/workitemsbatch?api-version=5.0`,
				{ method: 'POST', body: JSON.stringify({ ids: slice, $expand: 'Links', errorPolicy: 'Omit' }) },
				scope,
				cancellation,
			);
			const byId = new Map((workItems?.value ?? []).filter(w => w != null).map(w => [w.id, w]));
			for (const id of slice) {
				// A work item deleted since the ids were queried is gone, not a failure: skipping it keeps the page
				// honest, since it no longer matches anything.
				const workItem = byId.get(id);
				if (workItem == null) continue;

				const projectName = workItem.fields['System.TeamProject'];
				const project = options.resolveProject(projectName);
				if (project == null) {
					throw new Error(`Azure DevOps work item ${id} is in project '${projectName}', which isn't visible`);
				}

				const stateCategory = await this.getWorkItemStateCategory(
					workItem.fields['System.WorkItemType'],
					workItem.fields['System.State'],
					provider,
					token,
					collection,
					project.name,
					options,
				);
				values.push(fromAzureWorkItem(workItem, provider, project, stateCategory));
			}
		}

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
		options: { baseUrl: string; criteria?: IssueSearchCriteria; projectNames?: readonly string[] },
		cancellation?: AbortSignal,
	): Promise<number | 'exceeds-limit'> {
		const scope = getScopedLogger();
		const wiql = toAzureWorkItemSearchWiql(
			options.criteria,
			effectiveIssueSort(options.criteria?.sort),
			options.projectNames,
		);
		try {
			const ids = await this.queryWorkItemIds(
				provider,
				token,
				collection,
				options.baseUrl,
				wiql,
				azureWorkItemSearchResultLimit + 1,
				scope,
				cancellation,
			);
			return ids.length > azureWorkItemSearchResultLimit ? 'exceeds-limit' : ids.length;
		} catch (ex) {
			if (isWorkItemLimitRefusal(ex)) return 'exceeds-limit';

			throw ex;
		}
	}

	/**
	 * The ids a collection-level WIQL query matches, in its order.
	 *
	 * `api-version=5.0` is the oldest version every Azure DevOps Server release this search supports (2019 and later)
	 * answers; `timePrecision=true` is what lets the criteria's dates compare as instants — see `toWiqlDate`.
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
	): Promise<number[]> {
		const result = await this.request<{ workItems?: { id: number }[] }>(
			provider,
			token,
			baseUrl,
			`${encodePathSegment(collection)}/_apis/wit/wiql?$top=${top}&timePrecision=true&api-version=5.0`,
			{ method: 'POST', body: JSON.stringify({ query: wiql }) },
			scope,
			cancellation,
		);
		if (result?.workItems == null) throw new Error('Azure DevOps returned no work item query result');

		return result.workItems.map(w => w.id);
	}

	private getRepository(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		baseUrl: string,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
	): Promise<AzureRepositoryWithMetadata | undefined> {
		const { projectName, repoName } = parseAzureRepositoryDescriptor(repo);
		return this.request<AzureRepositoryWithMetadata>(
			provider,
			token,
			baseUrl,
			`${encodePathSegment(owner)}/${encodePathSegment(projectName)}/_apis/git/repositories/${encodePathSegment(repoName)}?api-version=7.1`,
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
		return fromAzurePullRequest(pr, provider, owner, baseUrl, forkRepositoryUrls);
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
			const response = await this.request<AzureRepositoryUrls>(
				provider,
				token,
				baseUrl,
				`${encodePathSegment(owner)}/_apis/git/repositories/${encodePathSegment(repositoryId)}?api-version=4.1`,
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
					provider?.trackRequestException();
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
export function createAzureDevOpsApi(ctx: IntegrationServiceContext): AzureDevOpsApi {
	return new AzureDevOpsApi(baseProviderApiConfig(ctx));
}
