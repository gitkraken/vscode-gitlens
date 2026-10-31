import type { CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
import type { Account } from '@gitlens/git/models/author.js';
import type { Issue, IssueProject, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor, ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { isIssueResourceDescriptor } from '@gitlens/git/utils/resourceDescriptor.utils.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { IntegrationReadUnavailableError, toError } from '../errors.js';
import type {
	AccountWideIssuesResult,
	IssuesForProjectOptions,
	ProjectIssuesDrain,
	SearchMyIssuesOptions,
} from '../models/issueReads.js';
import { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderApiCollectionResult, ProviderApiPagedResult, ProviderIssue } from './models.js';
import { fromProviderIssue, providersMetadata, toIssueShape, toProviderIssueStates } from './models.js';
import { collectProviderPagedResult, mergeCollectionMetadata } from './utils/providerPaging.js';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Asana];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
/** Long enough to span one tracker read, short enough that a profile change shows on the next. */
const recentAccountTTL = 60 * 1000;
/** The workspace and project discovery backstop: provider-apis pages them 100 at a time, so 2,000 of each. */
const maxDiscoveryPages = 20;
/** The task drain's backstop, per project or per workspace: 1,000 tasks at the SDK's 100-per-page. */
const maxTaskPages = 10;

/** An Asana workspace (or organization), the resource a tracker read discovers projects under. */
export interface AsanaWorkspaceDescriptor extends IssueResourceDescriptor {}

/** An Asana project, naming the workspace it belongs to so its tasks can be encoded and its account resolved. */
export interface AsanaProjectDescriptor extends IssueResourceDescriptor {
	resourceId: string;
	resourceName: string;
}

export class AsanaIntegration extends IssuesIntegration<IssuesCloudHostIntegrationId.Asana> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;

	override get id(): IssuesCloudHostIntegrationId.Asana {
		return IssuesCloudHostIntegrationId.Asana;
	}
	protected override get key(): 'asana' {
		return 'asana';
	}
	override get name(): string {
		return metadata.name;
	}
	override get domain(): string {
		return metadata.domain;
	}

	/**
	 * Always asks Asana: the host's current-account cache decides when this runs. An Asana user is the same in every
	 * workspace, so the answer is lent briefly to the per-workspace lookup a tracker read makes right after it.
	 */
	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const account = await this.fetchAccount(session);
		if (account != null) {
			this._recentAccounts.set(session.accessToken, Promise.resolve(account));
		}
		return account;
	}

	protected override getProviderUncachedAccountForResource(
		session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
	): Promise<Account | undefined> {
		return this.fetchAccount(session);
	}

	protected override getProviderAccountForResource(
		session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
	): Promise<Account | undefined> {
		return this._recentAccounts.getOrCreate(session.accessToken, () => this.fetchAccount(session), {
			evictWhen: account => account == null,
		});
	}

	protected override clearDiscoveryCaches(): void {
		this._recentAccounts.clear();
	}

	private readonly _recentAccounts = new PromiseCache<string, Account | undefined>({
		capacity: 10,
		createTTL: recentAccountTTL,
	});

	private async fetchAccount(session: ProviderAuthenticationSession): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		const user = await api.getAsanaCurrentUser(toTokenWithInfo(this.id, session));
		if (user == null) return undefined;

		return {
			provider: this,
			id: user.id,
			name: user.name ?? undefined,
			// Asana has no usernames; the SDK reports the display name as the handle.
			username: user.username ?? undefined,
			email: user.email ?? undefined,
			avatarUrl: user.avatarUrl ?? undefined,
		};
	}

	protected override async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
	): Promise<AsanaWorkspaceDescriptor[] | undefined> {
		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const workspaces = await collectProviderPagedResult(
			cursor => api.getAsanaWorkspacesForCurrentUser(tokenWithInfo, { cursor: cursor }),
			maxDiscoveryPages,
		);
		return workspaces.values.map(w => ({ key: w.id, id: w.id, name: w.name }));
	}

	protected override async getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: ResourceDescriptor[],
	): Promise<AsanaProjectDescriptor[] | undefined> {
		return (await this.getProviderProjectsForResourcesWithMetadata(session, resources)).values;
	}

	/**
	 * Each workspace's unarchived projects, drained per workspace. A workspace whose drain failed or ran out of pages
	 * keeps what it read and is recorded in the metadata, so one large or unreadable workspace doesn't hide the rest.
	 */
	protected override async getProviderProjectsForResourcesWithMetadata(
		session: ProviderAuthenticationSession,
		resources: ResourceDescriptor[],
	): Promise<ProviderApiCollectionResult<AsanaProjectDescriptor>> {
		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);

		const values: AsanaProjectDescriptor[] = [];
		let collectionMetadata: CollectionMetadata | undefined;
		for (const workspace of resources.filter(isIssueResourceDescriptor)) {
			const scope: CollectionScopeFailure['scope'] = { providerId: this.id, resourceId: workspace.id };
			const projects = await collectProviderPagedResult(
				cursor => api.getAsanaProjectsForWorkspace(tokenWithInfo, workspace.id, { cursor: cursor }),
				maxDiscoveryPages,
				scope,
			);
			values.push(
				...projects.values.map(p => ({
					key: p.id,
					id: p.id,
					name: p.name,
					resourceId: workspace.id,
					resourceName: workspace.name,
				})),
			);
			collectionMetadata = mergeCollectionMetadata(
				collectionMetadata,
				projects.truncated ? { ...projects.metadata, completeness: 'partial' } : projects.metadata,
			);
		}

		return collectionMetadata != null ? { values: values, metadata: collectionMetadata } : { values: values };
	}

	protected override async getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: ResourceDescriptor,
		options?: IssuesForProjectOptions,
	): Promise<IssueShape[] | undefined> {
		return (await this.getProviderIssuesForProjectWithTruncation(session, project, options))?.values;
	}

	/**
	 * A project's tasks, narrowed to the viewer's by assignee after the drain: Asana's task list takes a project or
	 * an assignee, never both. So a user-scoped read of a busy project spends its page budget on other people's
	 * tasks, and a truncated one can't be recovered by a narrower scope.
	 */
	protected override async getProviderIssuesForProjectWithTruncation(
		session: ProviderAuthenticationSession,
		project: ResourceDescriptor,
		options?: IssuesForProjectOptions,
	): Promise<ProjectIssuesDrain | undefined> {
		if (!isAsanaProjectDescriptor(project)) return undefined;

		let viewerId: string | undefined;
		if (options?.user != null) {
			viewerId = options.userId ?? (await this.getProviderAccountForResource(session, project))?.id;
			// Without the viewer the read can't be scoped to "my issues": the unfiltered project would leak everyone
			// else's tasks, and an empty list would read as "nothing assigned to me".
			if (viewerId == null) {
				throw new IntegrationReadUnavailableError(
					metadata.name,
					'could not resolve the current user to scope issues to',
				);
			}
		}

		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const states = toProviderIssueStates(options?.state);
		const drain = await this.drainTasks(
			cursor =>
				api.getAsanaIssuesForProject(tokenWithInfo, project.id, {
					cursor: cursor,
					states: states,
					sort: options?.sort,
				}),
			{ providerId: this.id, resourceId: project.resourceId, projectId: project.id },
		);

		const issueProject: IssueProject = {
			id: project.id,
			name: project.name,
			resourceId: project.resourceId,
			resourceName: project.resourceName,
		};
		const values = drain.values.flatMap(issue => {
			if (viewerId != null && !issue.assignees.some(a => a.id === viewerId)) return [];

			const shape = toIssueShape(issue, this, { projection: 'project' });
			return shape == null ? [] : [{ ...shape, project: issueProject } satisfies IssueShape];
		});

		return drain.truncated
			? { values: values, truncated: true, recovery: 'none', metadata: drain.metadata }
			: { values: values, truncated: false, metadata: drain.metadata };
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		return (await this.searchProviderMyIssuesWithTruncation(session, resources, cancellation))?.values;
	}

	/**
	 * The tasks assigned to the viewer, one drain per workspace (Asana requires the workspace alongside the
	 * assignee). Reads every workspace the user belongs to unless `resources` names some. Cancellation stops
	 * between workspaces and is not reported as truncation: the caller asked for the read to stop.
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyIssuesOptions,
	): Promise<AccountWideIssuesResult | undefined> {
		const workspaces = (resources ?? (await this.getProviderResourcesForUser(session)) ?? []).filter(
			isIssueResourceDescriptor,
		);

		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const states = toProviderIssueStates(options?.state);

		const values: IssueShape[] = [];
		let truncated = false;
		let collectionMetadata: CollectionMetadata | undefined;
		for (const workspace of workspaces) {
			if (cancellation?.aborted) break;

			const drain = await this.drainTasks(
				cursor =>
					api.getAsanaIssuesForCurrentUser(tokenWithInfo, workspace.id, {
						cursor: cursor,
						states: states,
						sort: options?.sort,
					}),
				{ providerId: this.id, resourceId: workspace.id },
			);
			truncated ||= drain.truncated;
			collectionMetadata = mergeCollectionMetadata(collectionMetadata, drain.metadata);
			for (const issue of drain.values) {
				const shape = toIssueShape(issue, this, { projection: 'account' });
				if (shape != null) {
					values.push({ ...shape, project: toAsanaIssueProject(issue, workspace) });
				}
			}
		}

		return { values: values, truncated: truncated, metadata: collectionMetadata };
	}

	/**
	 * Follows a task read's cursor up to {@link maxTaskPages}. `truncated` is set when the backstop stopped it with
	 * pages left, or when a page after the first failed (recorded under `scope`, keeping the prefix). A failure on the
	 * first page throws, so the caller sees an error rather than an empty success.
	 */
	private async drainTasks(
		fetch: (cursor: string | undefined) => Promise<ProviderApiPagedResult<ProviderIssue>>,
		scope: CollectionScopeFailure['scope'],
	): Promise<{ values: ProviderIssue[]; truncated: boolean; metadata?: CollectionMetadata }> {
		let pagesRead = 0;
		let firstPageError: Error | undefined;
		const drain = await collectProviderPagedResult(
			async cursor => {
				try {
					const page = await fetch(cursor);
					pagesRead++;
					return page;
				} catch (ex) {
					if (pagesRead === 0) {
						firstPageError = toError(ex);
					}
					throw ex;
				}
			},
			maxTaskPages,
			scope,
		);
		if (firstPageError != null) throw firstPageError;

		return { values: drain.values, truncated: drain.truncated === true, metadata: drain.metadata };
	}

	protected override getProviderLinkedIssueOrPullRequest(
		_session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
		_id: { id: string; key: string },
		_type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		// Asana task references are gids in a permalink URL, never a short key a commit message would carry.
		return Promise.resolve(undefined);
	}

	/** `resource` is the task's workspace; `id` is the task gid, which is also what an Asana issue reports as its id. */
	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		if (!isIssueResourceDescriptor(resource)) return undefined;

		const api = await this.getProvidersApi();
		const issue = await api.getAsanaIssue(toTokenWithInfo(this.id, session), id);
		return issue != null
			? fromProviderIssue(issue, this, { projection: 'point', project: toAsanaIssueProject(issue, resource) })
			: undefined;
	}
}

function isAsanaProjectDescriptor(project: ResourceDescriptor): project is AsanaProjectDescriptor {
	return isIssueResourceDescriptor(project) && typeof project.resourceId === 'string';
}

/**
 * The project an issue read outside a project reports. An Asana issue entity identifier is keyed by the task's
 * workspace, which the SDK reports beside the project rather than in it, so this always names the workspace as the
 * resource. A task in no project (only in someone's My Tasks) reports the workspace as its project too, so its
 * branch associations stay round-trippable.
 */
function toAsanaIssueProject(issue: ProviderIssue, workspace: IssueResourceDescriptor): IssueProject {
	const resourceId = issue.workspaceId ?? workspace.id;
	const resourceName = resourceId === workspace.id ? workspace.name : '';
	return issue.project?.id != null
		? { id: issue.project.id, name: issue.project.name, resourceId: resourceId, resourceName: resourceName }
		: { id: resourceId, name: resourceName, resourceId: resourceId, resourceName: resourceName };
}
