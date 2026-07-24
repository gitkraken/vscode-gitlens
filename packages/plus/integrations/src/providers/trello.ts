import type { Account } from '@gitlens/git/models/author.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor, ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { isIssueResourceDescriptor } from '@gitlens/git/utils/resourceDescriptor.utils.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { IntegrationReadUnavailableError } from '../errors.js';
import { IssuesIntegration } from '../models/issuesIntegration.js';
import type { IssueFilter } from './models.js';
import { fromProviderIssue, providersMetadata, toIssueShape } from './models.js';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Trello];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

/** A Trello board, surfaced as both a "resource" (org analogue) and a "project" for issue reads. */
export interface TrelloBoardDescriptor extends IssueResourceDescriptor {}

export class TrelloIntegration extends IssuesIntegration<IssuesCloudHostIntegrationId.Trello> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;

	override get id(): IssuesCloudHostIntegrationId.Trello {
		return IssuesCloudHostIntegrationId.Trello;
	}
	protected override get key(): 'trello' {
		return 'trello';
	}
	override get name(): string {
		return metadata.name;
	}
	override get domain(): string {
		return metadata.domain;
	}

	/** The Trello client requires the app key paired with the token; a session without one can't read. */
	private appKeyFor(session: ProviderAuthenticationSession): string | undefined {
		return session.appKey;
	}

	/**
	 * Resolves the app key or throws — a session that authenticated but carries no app key can't read Trello,
	 * and must be surfaced as a broken read (warning + fetchFailed) rather than an empty account.
	 */
	private requireAppKey(session: ProviderAuthenticationSession): string {
		const appKey = this.appKeyFor(session);
		if (appKey == null) {
			throw new IntegrationReadUnavailableError(metadata.name, 'missing app key (session has no appKey)');
		}
		return appKey;
	}

	protected override async getProviderAccountForResource(
		session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
	): Promise<Account | undefined> {
		const appKey = this.requireAppKey(session);

		const api = await this.getProvidersApi();
		const user = await api.getTrelloCurrentUser(toTokenWithInfo(this.id, session), appKey);
		if (user == null) return undefined;

		return {
			provider: this,
			id: user.id,
			name: user.name,
			username: user.username,
			email: user.email,
			avatarUrl: user.avatarUrl ?? undefined,
		};
	}

	protected override async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
	): Promise<TrelloBoardDescriptor[] | undefined> {
		const appKey = this.requireAppKey(session);

		const api = await this.getProvidersApi();
		const boards = await api.getTrelloBoardsForCurrentUser(toTokenWithInfo(this.id, session), appKey);
		return boards?.map(b => ({ key: b.id, id: b.id, name: b.name }));
	}

	protected override getProviderProjectsForResources(
		_session: ProviderAuthenticationSession,
		resources: ResourceDescriptor[],
	): Promise<TrelloBoardDescriptor[] | undefined> {
		// Trello boards are both the resource and the project scope, so projects are the boards themselves.
		return Promise.resolve(
			resources.filter(isIssueResourceDescriptor).map(r => ({ key: r.key, id: r.id, name: r.name })),
		);
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
		// A non-issue descriptor genuinely has nothing to read (empty), but a missing app key is a broken read.
		if (!isIssueResourceDescriptor(project)) return undefined;

		const appKey = this.requireAppKey(session);

		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);

		// Enrich issues with their board list names (card status), mirroring gitkraken.dev's Trello reads.
		const lists = await api.getTrelloListsForBoard(tokenWithInfo, appKey, project.id);
		const trelloBoardListsById = lists?.reduce<Record<string, { name: string }>>((acc, list) => {
			acc[list.id] = { name: list.name };
			return acc;
		}, {});
		const boardProject = {
			id: project.id,
			name: project.name,
			resourceId: project.id,
			resourceName: project.name,
		};

		const result = await api.getTrelloIssuesForBoard(tokenWithInfo, appKey, project.id, {
			assigneeLogins: options?.user != null ? [options.user] : undefined,
			trelloBoardListsById: trelloBoardListsById,
		});

		const values = result.values.flatMap(issue => {
			const mapped = toIssueShape(issue, this);
			return mapped == null ? [] : [{ ...mapped, project: boardProject } satisfies IssueShape];
		});

		// Trello's search caps results and reports the cap through `metadata.completeness` (partial/unknown),
		// never a cursor. Surface that as terminal truncation; there is no next page to fetch, so retrying the
		// same read cannot recover the omitted cards (D11).
		const truncated = result.metadata != null && result.metadata.completeness !== 'complete';
		return { values: values, truncated: truncated };
	}

	protected override searchProviderMyIssues(
		_session: ProviderAuthenticationSession,
		_resources?: ResourceDescriptor[],
		_cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		// Trello has no cross-board "issues assigned to me" endpoint; issues are read per board via
		// getIssuesForProject. Callers that need them enumerate boards first.
		return Promise.resolve(undefined);
	}

	protected override getProviderLinkedIssueOrPullRequest(
		_session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
		_id: { id: string; key: string },
		_type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		if (!isIssueResourceDescriptor(resource)) return undefined;

		const appKey = this.requireAppKey(session);
		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const lists = await api.getTrelloListsForBoard(tokenWithInfo, appKey, resource.id);
		const trelloBoardListsById = lists?.reduce<Record<string, { name: string }>>((acc, list) => {
			acc[list.id] = { name: list.name };
			return acc;
		}, {});

		// Branch-association round-trips use the encoded entity identifier's stable Trello card id. Resolve that
		// directly so large boards don't require a capped whole-board scan; keep a numeric idShort fallback so
		// legacy/manual callers that still pass the board-local display number continue to resolve.
		let issue = await api.getTrelloCard(tokenWithInfo, appKey, id, {
			trelloBoardListsById: trelloBoardListsById,
		});
		if (issue == null && /^[0-9]+$/.test(id)) {
			issue = (
				await api.getTrelloIssuesForBoard(tokenWithInfo, appKey, resource.id, {
					trelloBoardListsById: trelloBoardListsById,
				})
			).values.find(issue => issue.number === id);
		}

		return issue != null
			? fromProviderIssue(issue, this, {
					project: {
						id: resource.id,
						name: resource.name,
						resourceId: resource.id,
						resourceName: resource.name,
					},
				})
			: undefined;
	}
}
