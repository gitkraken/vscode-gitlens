import type { Account } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor, ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { isIssueResourceDescriptor } from '@gitlens/git/utils/resourceDescriptor.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { IntegrationReadUnavailableError } from '../errors.js';
import { IssuesIntegration } from '../models/issuesIntegration.js';
import type { IssueFilter, ProviderIssue } from './models.js';
import { fromProviderIssue, providersMetadata, toIssueShape } from './models.js';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Linear];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;

export interface LinearTeamDescriptor extends IssueResourceDescriptor {
	avatarUrl: string | undefined;
}

export interface LinearOrganizationDescriptor extends IssueResourceDescriptor {
	url: string;
}

export interface LinearProjectDescriptor extends IssueResourceDescriptor {}

export class LinearIntegration extends IssuesIntegration<IssuesCloudHostIntegrationId.Linear> {
	private _autolinks: Map<string, (AutolinkReference | DynamicAutolinkReference)[]> | undefined;
	override async autolinks(): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected || this._session == null) {
			return [];
		}

		const cachedAutolinks = this._autolinks?.get(this._session.accessToken);
		if (cachedAutolinks != null) return cachedAutolinks;

		const organization = await this.getOrganization(this._session);
		if (organization == null) return [];

		const autolinks: (AutolinkReference | DynamicAutolinkReference)[] = [];

		const teams = await this.getTeams(this._session);
		for (const team of teams ?? []) {
			const dashedPrefix = `${team.key}-`;
			const underscoredPrefix = `${team.key}_`;

			autolinks.push({
				prefix: dashedPrefix,
				url: `${organization.url}/issue/${dashedPrefix}<num>`,
				alphanumeric: false,
				ignoreCase: false,
				title: `Open Issue ${dashedPrefix}<num> on ${organization.name}`,

				type: 'issue',
				description: `${organization.name} Issue ${dashedPrefix}<num>`,
				descriptor: { ...organization },
			});
			autolinks.push({
				prefix: underscoredPrefix,
				url: `${organization.url}/issue/${dashedPrefix}<num>`,
				alphanumeric: false,
				ignoreCase: false,
				referenceType: 'branch',
				title: `Open Issue ${dashedPrefix}<num> on ${organization.name}`,

				type: 'issue',
				description: `${organization.name} Issue ${dashedPrefix}<num>`,
				descriptor: { ...organization },
			});
		}

		this._autolinks ??= new Map<string, (AutolinkReference | DynamicAutolinkReference)[]>();
		this._autolinks.set(this._session.accessToken, autolinks);

		return autolinks;
	}

	private _organizations: Map<string, LinearOrganizationDescriptor | undefined> | undefined;
	private async getOrganization(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<LinearOrganizationDescriptor | undefined> {
		const { accessToken } = session;
		this._organizations ??= new Map<string, LinearOrganizationDescriptor | undefined>();

		const cachedResources = this._organizations.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const organization = await api.getLinearOrganization(toTokenWithInfo(this.id, session));
			const descriptor: LinearOrganizationDescriptor | undefined = organization && {
				id: organization.id,
				key: organization.key,
				name: organization.name,
				url: organization.url,
			};
			if (descriptor) {
				this._organizations.set(accessToken, descriptor);
			}
		}

		return this._organizations.get(accessToken);
	}

	private _teams: Map<string, LinearTeamDescriptor[] | undefined> | undefined;
	private async getTeams(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<LinearTeamDescriptor[] | undefined> {
		const { accessToken } = session;
		this._teams ??= new Map<string, LinearTeamDescriptor[] | undefined>();

		const cachedResources = this._teams.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const teams = await api.getLinearTeamsForCurrentUser(toTokenWithInfo(this.id, session));
			const descriptors: LinearTeamDescriptor[] | undefined = teams?.map(t => ({
				id: t.id,
				key: t.key,
				name: t.name,
				avatarUrl: t.iconUrl,
			}));
			if (descriptors) {
				this._teams.set(accessToken, descriptors);
			}
		}

		return this._teams.get(accessToken);
	}

	protected override async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
	): Promise<ResourceDescriptor[] | undefined> {
		const organization = await this.getOrganization(session);
		return organization != null ? [organization] : undefined;
	}
	protected override getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		_resources: ResourceDescriptor[],
	): Promise<ResourceDescriptor[] | undefined> {
		return this.getTeams(session);
	}
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;

	protected override async getProviderAccountForResource(
		session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
	): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		// Linear's viewer isn't a ProviderAccount (no username/avatar), so build the Account manually
		// (Trello-style) from the fields the viewer query returns.
		const user = await api.getLinearCurrentUser(toTokenWithInfo(this.id, session));
		if (user == null) return undefined;

		return {
			provider: this,
			id: user.id,
			name: user.name ?? user.displayName ?? undefined,
			username: user.displayName ?? undefined,
			email: user.email ?? undefined,
			avatarUrl: undefined,
		};
	}

	protected override async getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: ResourceDescriptor,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<IssueShape[] | undefined> {
		return (await this.getProviderIssuesForProjectWithTruncation(session, project, options))?.values;
	}

	protected override async getProviderIssuesForProjectWithTruncation(
		session: ProviderAuthenticationSession,
		project: ResourceDescriptor,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<{ values: IssueShape[]; truncated: boolean } | undefined> {
		if (!isIssueResourceDescriptor(project)) return undefined;

		const api = await this.getProvidersApi();
		// `getProviderProjectsForResources` returns Linear teams, so `project.id` is a team id here. Drain the
		// team's issues (Linear pages by cursor); bounded by maxPagesPerRequest as a backstop. `truncated` is
		// set when that backstop stopped the drain with more pages still available.
		let cursor: string | undefined;
		let hasMore: boolean;
		let requestCount = 0;
		let truncated = false;
		const issues: IssueShape[] = [];
		do {
			const result = await api.getLinearIssues(
				toTokenWithInfo(this.id, session),
				{ teams: [project.id] },
				{ cursor: cursor },
			);
			requestCount += 1;
			hasMore = result.paging?.more ?? false;
			const nextCursor = result.paging?.cursor;
			for (const issue of result.values) {
				const shape = toIssueShape(issue, this);
				if (shape != null) {
					issues.push(shape);
				}
			}
			// The provider claims more but returns no advancing cursor: we can't continue without re-reading the
			// same page, so the drain is incomplete — flag it rather than silently stopping.
			if (hasMore && (nextCursor == null || nextCursor === cursor)) {
				truncated = true;
				break;
			}
			cursor = nextCursor;
			// More pages remain but we've hit the backstop: the drain is incomplete.
			if (hasMore && requestCount >= maxPagesPerRequest) {
				truncated = true;
			}
		} while (requestCount < maxPagesPerRequest && hasMore);

		// Linear's issue list has no server-side author/assignee filter, so scope to the current user
		// client-side when a user was requested (the assignee filter is what "my issues" means here).
		// Match on the viewer's stable id, not the passed display name: Linear's `name` (full name) and
		// `displayName` (nickname) are distinct fields, and assignees are normalized with `.name` = the full
		// name while the caller's `user` is the displayName — so a name string can miss. The assignee `.id`
		// is the Linear user id, which is unambiguous.
		if (options?.user != null) {
			const viewerId = (await api.getLinearCurrentUser(toTokenWithInfo(this.id, session)))?.id;
			// If the viewer can't be resolved we can't scope to "my issues" — returning the unfiltered team
			// issues would leak everyone else's, and returning [] is indistinguishable from "no issues assigned
			// to me". Throw so the facade (getIssuesForProjectResult → runCaptured) surfaces a warning +
			// fetchFailed the caller can act on, instead of a silent empty.
			if (viewerId == null) {
				throw new IntegrationReadUnavailableError(
					metadata.name,
					'could not resolve the current user to scope issues to',
				);
			}
			return {
				values: issues.filter(issue => issue.assignees?.some(a => a.id === viewerId)),
				truncated: truncated,
			};
		}

		return { values: issues, truncated: truncated };
	}

	override get id(): IssuesCloudHostIntegrationId.Linear {
		return IssuesCloudHostIntegrationId.Linear;
	}
	protected override get key(): 'linear' {
		return 'linear';
	}
	override get name(): string {
		return metadata.name;
	}
	override get domain(): string {
		return metadata.domain;
	}
	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		if (resources != null) {
			return undefined;
		}

		const api = await this.getProvidersApi();
		let cursor = undefined;
		let hasMore: boolean;
		let requestCount = 0;
		const issues = [];
		try {
			do {
				if (cancellation?.aborted) {
					break;
				}

				const result = await api.getIssuesForCurrentUser(toTokenWithInfo(this.id, session), {
					cursor: cursor,
				});
				requestCount += 1;
				hasMore = result.paging?.more ?? false;
				cursor = result.paging?.cursor;
				const formattedIssues = result.values
					.map(issue => toIssueShape(issue, this))
					.filter((result): result is IssueShape => result != null);
				if (formattedIssues.length > 0) {
					issues.push(...formattedIssues);
				}
			} while (requestCount < maxPagesPerRequest && hasMore);
		} catch (ex) {
			if (issues.length === 0) {
				throw ex;
			}

			Logger.error(ex, 'searchProviderMyIssues');
		}
		return issues;
	}
	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		{ key }: { id: string; key: string },
		_type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		const issue = await this.getRawProviderIssue(session, resource, key);
		const autolinkableIssue: ProviderIssue | undefined = issue && {
			...issue,
			url: this.getIssueAutolinkLikeUrl(issue),
		};
		return autolinkableIssue && toIssueShape(autolinkableIssue, this);
	}
	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const result = await this.getRawProviderIssue(session, resource, id);
		return result && fromProviderIssue(result, this);
	}

	private async getRawProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<ProviderIssue | undefined> {
		const api = await this.getProvidersApi();
		try {
			if (!isIssueResourceDescriptor(resource)) {
				Logger.error(undefined, 'getProviderIssue: resource is not an IssueResourceDescriptor');
				return undefined;
			}

			const result = await api.getIssue(toTokenWithInfo(this.id, session), {
				resourceId: resource.id,
				number: id,
			});

			if (result == null) return undefined;

			return result;
		} catch (ex) {
			Logger.error(ex, 'getProviderIssue');
			return undefined;
		}
	}
	private getIssueAutolinkLikeUrl(issue: ProviderIssue): string | null {
		const url = issue.url;
		if (url == null) return null;

		const lastSegment = url.split('/').pop();
		if (!lastSegment || issue.number === lastSegment) {
			return url;
		}
		return url.substring(0, url.length - lastSegment.length - 1);
	}
}
