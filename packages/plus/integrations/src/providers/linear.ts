import type { CollectionMetadata, CollectionScopeFailure, GitIssueState } from '@gitkraken/provider-apis';
import * as l10n from '@vscode/l10n';
import type { Account } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor, ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { isIssueResourceDescriptor } from '@gitlens/git/utils/resourceDescriptor.utils.js';
import { chunk } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import { mapSettledBounded } from '@gitlens/utils/promise.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { toCollectionScopeFailure } from '../collectionMetadata.js';
import { IssuesCloudHostIntegrationId, providerFanOutConcurrency } from '../constants.js';
import { IntegrationReadUnavailableError } from '../errors.js';
import type { IssueEtagFields } from '../models/integration.js';
import type {
	AccountWideIssuesResult,
	IssuesForProjectOptions,
	ProjectIssuesDrain,
	ProjectIssuesRequest,
	SearchMyIssuesOptions,
} from '../models/issueReads.js';
import {
	groupProjectIssuesSearches,
	IssuesIntegration,
	splitProjectIssuesSearch,
} from '../models/issuesIntegration.js';
import type { LinearIssueEtagNode } from './linearIssuesEtag.js';
import { linearIssuesEtagMaxNumbers, toLinearIssueEtagFields } from './linearIssuesEtag.js';
import type { ProviderApiCollectionResult, ProviderIssue } from './models.js';
import { fromProviderIssue, providersMetadata, toIssueShape, toProviderIssueStates } from './models.js';
import { DiscoveryCache, discoveryCacheTtl } from './utils/discoveryCache.js';
import { mergeCollectionMetadata } from './utils/providerPaging.js';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Linear];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;
/**
 * The account-wide drain's own backstop, separate from {@link maxPagesPerRequest}.
 *
 * Raised to 50 (5,000 issues at the SDK's 100-per-page) because 10 no longer means what it used to. That read
 * once fanned out over four overlapping relationship queries and merged them, so most of what a page cost was
 * rows already returned — a low budget capped the waste. It is now a single server-ordered query over an `or`
 * filter, so every page is 100 issues the caller has not seen, and the same budget just truncates real results
 * at 1,000.
 *
 * Reaching it is reported rather than silent: {@link LinearIntegration.searchProviderMyIssuesWithTruncation}
 * returns `truncated`, so the facade can say the read was incomplete instead of publishing a capped list as a
 * whole account. The bound stays — a runaway cursor must not spend requests forever — but it is now set where a
 * real Linear account is unlikely to reach it rather than where the duplication used to hurt.
 */
const maxAccountWidePagesPerRequest = 50;
const linearImplicitTeamsPageSize = 50;
/** A team key and issue number, as Linear writes an issue's identifier (`ENG-123`). */
const linearIdentifier = /^([A-Za-z0-9]+)-(\d+)$/;

export interface LinearTeamDescriptor extends IssueResourceDescriptor {
	avatarUrl: string | undefined;
}

export interface LinearOrganizationDescriptor extends IssueResourceDescriptor {
	url: string;
}

export interface LinearProjectDescriptor extends IssueResourceDescriptor {}

export class LinearIntegration extends IssuesIntegration<IssuesCloudHostIntegrationId.Linear> {
	/**
	 * Built from the teams, so it follows them: rebuilt when the team list changes or the caches are dropped, and once
	 * older than {@link discoveryCacheTtl}. An expired set is still served while it is rebuilt in the background, because
	 * autolinks are read on every render of a commit message and must not wait on the network (#5907).
	 */
	private readonly _autolinks = new Map<
		string,
		{ autolinks: (AutolinkReference | DynamicAutolinkReference)[]; builtAt: number }
	>();
	private readonly _autolinksBuilds = new Map<string, Promise<(AutolinkReference | DynamicAutolinkReference)[]>>();

	override async autolinks(): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected || this._session == null) {
			return [];
		}

		const session = this._session;
		const cached = this._autolinks.get(session.accessToken);
		// A session kept through a failed refresh is expired: building with it would send that token to the provider
		// on every render, so serve whatever was built before (none after a forced re-sync) until a read refreshes it.
		if (this.connectionExpired === true) return cached?.autolinks ?? [];
		if (cached == null) return this.buildAutolinks(session);

		if (Date.now() - cached.builtAt >= discoveryCacheTtl) {
			void this.buildAutolinks(session).catch(() => {});
		}
		return cached.autolinks;
	}

	/** One build per token at a time: concurrent renders share it rather than each re-reading the teams. */
	private buildAutolinks(
		session: ProviderAuthenticationSession,
	): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const { accessToken } = session;
		let build = this._autolinksBuilds.get(accessToken);
		if (build == null) {
			build = this.buildAutolinksCore(session).finally(() => this._autolinksBuilds.delete(accessToken));
			this._autolinksBuilds.set(accessToken, build);
		}
		return build;
	}

	private async buildAutolinksCore(
		session: ProviderAuthenticationSession,
	): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const generation = this._teams.generation;
		const organization = await this.getOrganization(session);
		if (organization == null) return [];

		const autolinks: (AutolinkReference | DynamicAutolinkReference)[] = [];

		const teams = await this.getTeams(session);
		for (const team of teams ?? []) {
			const dashedPrefix = `${team.key}-`;
			const underscoredPrefix = `${team.key}_`;

			autolinks.push({
				prefix: dashedPrefix,
				url: `${organization.url}/issue/${dashedPrefix}<num>`,
				alphanumeric: false,
				ignoreCase: false,
				title: l10n.t('Open Issue {0} on {1}', `${dashedPrefix}<num>`, organization.name),

				type: 'issue',
				description: l10n.t('{0} Issue {1}', organization.name, `${dashedPrefix}<num>`),
				descriptor: { ...organization },
			});
			autolinks.push({
				prefix: underscoredPrefix,
				url: `${organization.url}/issue/${dashedPrefix}<num>`,
				alphanumeric: false,
				ignoreCase: false,
				referenceType: 'branch',
				title: l10n.t('Open Issue {0} on {1}', `${dashedPrefix}<num>`, organization.name),

				type: 'issue',
				description: l10n.t('{0} Issue {1}', organization.name, `${dashedPrefix}<num>`),
				descriptor: { ...organization },
			});
		}

		// Not kept when built from teams read before the caches were dropped.
		if (this._teams.generation === generation) {
			this._autolinks.set(session.accessToken, { autolinks: autolinks, builtAt: Date.now() });
		}
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

	/** Expires, and is dropped on a re-sync, so a team created or left mid-session is picked up (#5907). */
	private readonly _teams = new DiscoveryCache<LinearTeamDescriptor[]>();
	private async getTeams(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<LinearTeamDescriptor[] | undefined> {
		return (await this.getTeamsWithMetadata(session, force))?.values;
	}

	private async getTeamsWithMetadata(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<ProviderApiCollectionResult<LinearTeamDescriptor> | undefined> {
		const { accessToken } = session;

		const cachedResources = this._teams.get(accessToken);
		if (cachedResources != null && !force) return { values: cachedResources };

		const generation = this._teams.generation;
		const api = await this.getProvidersApi();
		const teams = await api.getLinearTeamsForCurrentUser(toTokenWithInfo(this.id, session));
		const descriptors: LinearTeamDescriptor[] | undefined = teams?.map(t => ({
			id: t.id,
			key: t.key,
			name: t.name,
			avatarUrl: t.iconUrl,
		}));
		if (descriptors == null) return undefined;

		// provider-apis currently requests Linear's teams connection without pageInfo or a cursor. Linear's
		// implicit page size is 50, so exactly a full page cannot prove there is no team 51. Preserve the useful
		// prefix, but mark it unknown and leave it uncached so the next read retries instead of treating it as
		// authoritative. Once provider-apis exposes a paged primitive, replace this fail-closed guard with a drain.
		if (descriptors.length >= linearImplicitTeamsPageSize) {
			return { values: descriptors, metadata: { completeness: 'unknown' } };
		}

		if (this._teams.set(accessToken, descriptors, { generation: generation })) {
			// Built from the teams; a new set means new prefixes.
			this._autolinks.delete(accessToken);
		}
		return { values: descriptors };
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
	protected override async getProviderProjectsForResourcesWithMetadata(
		session: ProviderAuthenticationSession,
		_resources: ResourceDescriptor[],
	): Promise<ProviderApiCollectionResult<ResourceDescriptor>> {
		return (await this.getTeamsWithMetadata(session)) ?? { values: [] };
	}

	override invalidateDiscoveryCaches(): void {
		this._organizations = undefined;
		this._teams.clear();
		this._autolinks.clear();
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
		options?: IssuesForProjectOptions,
	): Promise<IssueShape[] | undefined> {
		return (await this.getProviderIssuesForProjectWithTruncation(session, project, options))?.values;
	}

	protected override async getProviderIssuesForProjectWithTruncation(
		session: ProviderAuthenticationSession,
		project: ResourceDescriptor,
		options?: IssuesForProjectOptions,
	): Promise<ProjectIssuesDrain | undefined> {
		if (!isIssueResourceDescriptor(project)) return undefined;

		// Scope to "my issues" by the viewer's stable id, not the passed display name: Linear's `name` (full name)
		// and `displayName` (nickname) are distinct fields, and assignees are normalized with `.name` = the full
		// name while the caller's `user` is the displayName — so a name string can miss. The assignee `.id` is the
		// Linear user id, which is unambiguous.
		let viewerId: string | undefined;
		if (options?.user != null) {
			viewerId = await this.getViewerId(session, options);
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
		}

		// `getProviderProjectsForResources` returns Linear teams, so `project.id` is a team id here.
		//
		// The state and the viewer are narrowed server-side, not after the drain: a team's done work and other
		// people's issues would otherwise count against the backstop, so a busy team runs out of pages before the
		// viewer's open issues and hands back a page that looks complete.
		const drain = await this.drainIssues(
			session,
			{
				teams: [project.id],
				...(viewerId != null ? { assignees: [viewerId] } : {}),
				states: toProviderIssueStates(options?.state),
			},
			options?.sort,
			{ providerId: this.id, projectId: project.id },
		);

		return drain.truncated
			? { values: drain.issues, truncated: true, recovery: 'none', metadata: drain.metadata }
			: { values: drain.issues, truncated: false, metadata: drain.metadata };
	}

	/**
	 * Searches every team of a user-scoped read together: one `getIssues` names all of them and the viewer as
	 * assignee, so a team with none of the user's issues costs no request of its own. Linear's filter is a GraphQL
	 * body, not a query string, so there is no key bound to chunk at.
	 */
	protected override getProjectIssuesSearches(
		requests: readonly ProjectIssuesRequest<ResourceDescriptor>[],
	): number[][] | undefined {
		return groupProjectIssuesSearches(requests, ({ project, options }) =>
			options.user != null && isIssueResourceDescriptor(project)
				? [options.user, options.userId ?? '', options.sort ?? '', options.state ?? ''].join('\0')
				: undefined,
		);
	}

	protected override async searchProviderProjectIssues(
		session: ProviderAuthenticationSession,
		requests: readonly ProjectIssuesRequest<ResourceDescriptor>[],
	): Promise<IssueShape[][] | undefined> {
		// Every request of a search shares its user scope (see `getProjectIssuesSearches`).
		const { options } = requests[0];
		if (options.user == null) return undefined;

		// Unresolvable here means each team's own read throws the same warning, so let them.
		const viewerId = await this.getViewerId(session, options);
		if (viewerId == null) return undefined;

		const teams = requests.map(request => request.project).filter(isIssueResourceDescriptor);
		if (teams.length !== requests.length) return undefined;

		const drain = await this.drainIssues(
			session,
			{
				teams: teams.map(team => team.id),
				assignees: [viewerId],
				states: toProviderIssueStates(options.state),
			},
			options.sort,
			// Never published: an incomplete search is read again per team, which records its own failures.
			{ providerId: this.id },
		);
		// Deliberately discarded rather than served: an incomplete search says nothing about which of its teams it
		// covered, so only the per-team reads can report each one's completeness. The waste is bounded by one team's
		// page budget, and paid only by a search that needed more than that or failed partway.
		if (drain.truncated || (drain.metadata != null && drain.metadata.completeness !== 'complete')) {
			return undefined;
		}

		// A normalized Linear issue carries its team only inside `project`, which is absent for an issue in no
		// Linear project, so split by the identifier instead: Linear numbers every issue `<team key>-<n>`, and
		// renumbers it under its new team's key when it moves.
		return splitProjectIssuesSearch(
			teams.map(team => team.key),
			drain.issues,
			issue => {
				const separator = issue.id.lastIndexOf('-');
				return separator > 0 ? issue.id.slice(0, separator) : undefined;
			},
		);
	}

	private readonly _viewerIds = new PromiseCache<string, string | undefined>({ capacity: 10 });
	/**
	 * The viewer's Linear user id: the caller's resolved `userId` when it has one, else the viewer query, shared per
	 * token. A tracker read hands each team the id of the team's own resource, which Linear's team descriptors don't
	 * name, so without sharing every team read (and a search's fallback) would ask for the viewer again.
	 */
	private getViewerId(
		session: ProviderAuthenticationSession,
		options: IssuesForProjectOptions,
	): Promise<string | undefined> {
		if (options.userId) return Promise.resolve(options.userId);

		return this._viewerIds.getOrCreate(
			session.accessToken,
			async () => {
				const api = await this.getProvidersApi();
				return (await api.getLinearCurrentUser(toTokenWithInfo(this.id, session)))?.id;
			},
			// Only a resolved id is worth keeping; an unresolved viewer is asked for again next time, as is a failure.
			{ evictWhen: id => id == null },
		);
	}

	/**
	 * Follows `getIssues`' cursor up to {@link maxPagesPerRequest}. `truncated` is set when that backstop stopped
	 * the drain with more pages still available, when the provider stalled its cursor or flagged its paging as
	 * truncated, or when a page after the first failed, which is recorded at `failureScope` while the prefix is
	 * kept. A first-page failure throws, so the caller sees a hard error rather than an empty success.
	 */
	private async drainIssues(
		session: ProviderAuthenticationSession,
		filter: { teams: string[]; assignees?: string[]; states?: GitIssueState[] },
		sort: IssuesForProjectOptions['sort'],
		failureScope: CollectionScopeFailure['scope'],
	): Promise<{ issues: IssueShape[]; truncated: boolean; metadata?: CollectionMetadata }> {
		const api = await this.getProvidersApi();
		const assignees = filter.assignees?.length ? filter.assignees : undefined;
		let cursor: string | undefined;
		let hasMore: boolean;
		let requestCount = 0;
		let truncated = false;
		let collectionMetadata: CollectionMetadata | undefined;
		const issues: IssueShape[] = [];
		do {
			let result: Awaited<ReturnType<typeof api.getLinearIssues>>;
			try {
				result = await api.getLinearIssues(toTokenWithInfo(this.id, session), filter, {
					cursor: cursor,
					sort: sort,
				});
			} catch (ex) {
				if (issues.length === 0) throw ex;

				truncated = true;
				collectionMetadata = mergeCollectionMetadata(collectionMetadata, {
					completeness: 'partial',
					failures: [toCollectionScopeFailure(failureScope, ex)],
				});
				break;
			}
			requestCount += 1;
			hasMore = result.paging?.more ?? false;
			const nextCursor = result.paging?.cursor;
			truncated ||= result.paging?.truncated === true;
			collectionMetadata = mergeCollectionMetadata(collectionMetadata, result.metadata);
			for (const issue of result.values) {
				const shape = toIssueShape(issue, this, { projection: 'project' });
				// The query already scopes to the assignees; checking again keeps another user's issue out of "my
				// issues" should the provider ever return one.
				if (shape != null && (assignees == null || shape.assignees?.some(a => assignees.includes(a.id)))) {
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
			if (hasMore && requestCount >= maxPagesPerRequest) {
				truncated = true;
			}
		} while (requestCount < maxPagesPerRequest && hasMore);

		return { issues: issues, truncated: truncated, metadata: collectionMetadata };
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
		return (await this.searchProviderMyIssuesWithTruncation(session, resources, cancellation))?.values;
	}

	/**
	 * Account-wide "my issues" for Linear, drained to exhaustion and reporting whether it got there.
	 *
	 * The SDK read is one server-ordered query over an `or` filter across the four relationships (assigned,
	 * created, named in an issue's content, named in a comment), so each page is 100 issues the caller has not
	 * seen and the pages are ordered as one sequence. Draining it is therefore just following the cursor.
	 *
	 * Overridden rather than left to the base default because that default hardcodes `truncated: false`, and a
	 * bounded drain that stops early is exactly the case a caller must be able to see. Three things end the
	 * drain, and only one of them is completion:
	 *
	 * - the provider says there is no next page — complete;
	 * - the backstop is reached — `truncated`, because issues beyond it exist and were not read;
	 * - the provider claims a next page but hands back a cursor that does not advance — also `truncated`, since
	 *   the read cannot continue and the remainder is unreachable rather than absent.
	 *
	 * Cancellation is deliberately NOT truncation: the caller asked for the read to stop, so the partial list is
	 * what it asked for, and flagging it would surface an incompleteness warning for a user action.
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyIssuesOptions,
	): Promise<AccountWideIssuesResult | undefined> {
		if (resources != null) {
			return undefined;
		}

		const api = await this.getProvidersApi();
		const states = toProviderIssueStates(options?.state);
		let cursor = undefined;
		// Starts false so an immediate cancellation, which leaves the loop before the first response, reads as
		// "no more pages known" rather than as an unfinished drain.
		let hasMore = false;
		let requestCount = 0;
		let truncated = false;
		const issues = [];
		try {
			do {
				if (cancellation?.aborted) {
					break;
				}

				const result = await api.getIssuesForCurrentUser(toTokenWithInfo(this.id, session), {
					cursor: cursor,
					states: states,
					sort: options?.sort,
				});
				requestCount += 1;
				hasMore = result.paging?.more ?? false;
				const nextCursor = result.paging?.cursor;

				// Keep this page before deciding whether to continue: the request is already paid for, so
				// dropping its rows would lose real results to save nothing.
				const formattedIssues = result.values
					.map(issue => toIssueShape(issue, this, { projection: 'account' }))
					.filter((result): result is IssueShape => result != null);
				if (formattedIssues.length > 0) {
					issues.push(...formattedIssues);
				}

				// The provider claims more but hands back no advancing cursor: continuing would re-read the page
				// just returned. `ProvidersApi.getPagedResult` already normalizes this into `more: false`, so
				// this is a backstop for if that ever stops holding rather than a case seen today -- but the rest
				// of the account is unreachable either way, which is what `truncated` says.
				if (hasMore && (nextCursor == null || nextCursor === cursor)) {
					truncated = true;
					break;
				}

				cursor = nextCursor;
			} while (requestCount < maxAccountWidePagesPerRequest && hasMore);

			// Ran out of budget with pages still to come.
			if (hasMore && requestCount >= maxAccountWidePagesPerRequest) {
				truncated = true;
			}
		} catch (ex) {
			if (issues.length === 0) {
				throw ex;
			}

			// Kept what was already fetched, so the list is real but short of the account.
			truncated = true;
			Logger.error(ex, 'searchProviderMyIssues');
		}
		return { values: issues, truncated: truncated };
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
		return autolinkableIssue && toIssueShape(autolinkableIssue, this, { projection: 'point' });
	}
	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const result = await this.getRawProviderIssue(session, resource, id);
		return result && fromProviderIssue(result, this, { projection: 'point' });
	}

	protected override async getProviderIssueByResourceId(
		session: ProviderAuthenticationSession,
		resourceId: string,
		id: string,
		_resourceUrl: string | undefined,
	): Promise<Issue | undefined> {
		const api = await this.getProvidersApi();
		const result = await api.getIssue(toTokenWithInfo(this.id, session), {
			resourceId: resourceId,
			number: id,
		});
		return result && fromProviderIssue(result, this, { projection: 'batch' });
	}

	/**
	 * The cheap check behind the batch issue read's etags: one `issues` query per team and
	 * {@link linearIssuesEtagMaxNumbers} distinct numbers, where {@link getProviderIssueByResourceId} sends one request
	 * per issue. A request that throws rejects only its own targets' slots, with its error classified as the full
	 * read's would be.
	 *
	 * Never proves an absence. The query filters by the team's CURRENT key and asks for archived issues too, but the
	 * full read's `issue(id:)` may also resolve an identifier the issue no longer carries (its team was renamed, or it
	 * moved to another team), so an issue the query leaves out may still exist. Its target's slot is rejected, as is a
	 * target whose identifier isn't a team key and a number, so the full read decides. When no target was answered and
	 * nothing failed, the check declines instead, so a batch of only such targets costs a full read, not a failure.
	 */
	protected override async getProviderIssuesEtagFieldsByResourceId(
		session: ProviderAuthenticationSession,
		targets: readonly { resourceId: string; identifier: string; resourceUrl?: string }[],
	): Promise<PromiseSettledResult<IssueEtagFields | undefined>[] | undefined> {
		const slots = new Array<PromiseSettledResult<IssueEtagFields | undefined>>(targets.length);
		let answered = false;
		let failed = false;

		// Each workspace and team's distinct numbers, with the targets asking for each.
		const byTeam = new Map<string, { teamKey: string; numbers: Map<number, number[]> }>();
		for (const [index, target] of targets.entries()) {
			const match = linearIdentifier.exec(target.identifier);
			const number = match != null ? Number(match[2]) : Number.NaN;
			// Only a number written as Linear writes it, so `ENG-012` never answers for `ENG-12`.
			if (match == null || !Number.isSafeInteger(number) || String(number) !== match[2]) {
				slots[index] = {
					status: 'rejected',
					reason: new Error(`Not a Linear issue identifier: ${target.identifier}`),
				};
				continue;
			}

			const teamKey = match[1].toUpperCase();
			const groupKey = `${target.resourceId}\n${teamKey}`;
			let group = byTeam.get(groupKey);
			if (group == null) {
				group = { teamKey: teamKey, numbers: new Map() };
				byTeam.set(groupKey, group);
			}

			let indices = group.numbers.get(number);
			if (indices == null) {
				indices = [];
				group.numbers.set(number, indices);
			}
			indices.push(index);
		}

		const requests = [...byTeam.values()].flatMap(({ teamKey, numbers }) =>
			chunk([...numbers], linearIssuesEtagMaxNumbers).map(entries => ({ teamKey: teamKey, entries: entries })),
		);
		if (requests.length) {
			const api = await this.getProvidersApi();
			const tokenWithInfo = toTokenWithInfo(this.id, session);
			const answers = await mapSettledBounded(requests, providerFanOutConcurrency, r =>
				api.getLinearIssuesEtagFields(
					tokenWithInfo,
					r.teamKey,
					r.entries.map(([number]) => number),
				),
			);

			for (const [i, answer] of answers.entries()) {
				const { teamKey, entries } = requests[i];
				if (answer.status === 'rejected') {
					failed = true;
					for (const [, indices] of entries) {
						for (const index of indices) {
							slots[index] = answer;
						}
					}
					continue;
				}

				// By number, never by position: Linear returns the issues in its own order, and only the ones it found.
				const byNumber = new Map<number, LinearIssueEtagNode>();
				for (const issue of answer.value) {
					byNumber.set(issue.number, issue);
				}

				for (const [number, indices] of entries) {
					const issue = byNumber.get(number);
					let slot: PromiseSettledResult<IssueEtagFields | undefined>;
					if (issue == null) {
						slot = { status: 'rejected', reason: new Error(`Linear did not return ${teamKey}-${number}`) };
					} else {
						try {
							slot = { status: 'fulfilled', value: toLinearIssueEtagFields(issue) };
							answered = true;
						} catch (ex) {
							slot = { status: 'rejected', reason: ex };
							failed = true;
						}
					}

					for (const index of indices) {
						slots[index] = slot;
					}
				}
			}
		}

		return answered || failed ? slots : undefined;
	}

	private async getRawProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<ProviderIssue | undefined> {
		const api = await this.getProvidersApi();
		if (!isIssueResourceDescriptor(resource)) {
			Logger.error(undefined, 'getProviderIssue: resource is not an IssueResourceDescriptor');
			return undefined;
		}

		return api.getIssue(toTokenWithInfo(this.id, session), {
			resourceId: resource.id,
			number: id,
		});
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
