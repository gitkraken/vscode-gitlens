import type { AuthenticationSession, CancellationToken } from 'vscode';
import { IssuesCloudHostIntegrationId } from '../../../constants.integrations';
import type { Account } from '../../../git/models/author';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest';
import type { IssueResourceDescriptor, ResourceDescriptor } from '../../../git/models/resourceDescriptor';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import type { ProviderAuthenticationSession } from '../authentication/models';
import { IssuesIntegration } from '../models/issuesIntegration';
import type { IssueFilter } from './models';
import { providersMetadata, toIssueShape } from './models';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Linear];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;

export interface LinearTeamDescriptor extends IssueResourceDescriptor {
	url: string;
	avatarUrl: string;
}

export class LinearIntegration extends IssuesIntegration<IssuesCloudHostIntegrationId.Linear> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;

	protected override getProviderAccountForResource(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
	): Promise<Account | undefined> {
		throw new Error('Method not implemented.');
	}

	private _teams: Map<string, LinearTeamDescriptor[] | undefined> | undefined;
	protected override async getProviderResourcesForUser(
		{ accessToken }: AuthenticationSession,
		force: boolean = false,
	): Promise<LinearTeamDescriptor[] | undefined> {
		this._teams ??= new Map<string, LinearTeamDescriptor[] | undefined>();

		const cachedResources = this._teams.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const resources = await api.getLinearResourcesForCurrentUser({ accessToken: accessToken });
			this._teams.set(
				accessToken,
				resources != null
					? resources.map(r => ({
							...r,
							key: r.id,
							url: `https://linear.app/team/${r.id}`,
							avatarUrl: r.iconUrl || '',
						}))
					: undefined,
			);
		}

		return this._teams.get(accessToken);
	}

	protected override getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: ResourceDescriptor[],
	): Promise<ResourceDescriptor[] | undefined> {
		throw new Error('Method not implemented.');
	}
	protected override getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: ResourceDescriptor,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<IssueShape[] | undefined> {
		throw new Error('Method not implemented.');
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
		cancellation?: CancellationToken,
	): Promise<IssueShape[] | undefined> {
		const myResources = resources ?? (await this.getProviderResourcesForUser(session));
		console.log(myResources);
		return undefined;
		// if (!myResources) return undefined;
		// const api = await this.getProvidersApi();
		// const results: IssueShape[] = [];
		// for (const resource of myResources) {
		//   try {
		//     let cursor = undefined;
		//     let hasMore = false;
		//     let requestCount = 0;
		//     do {
		//       const resourceIssues = await api.getIssuesForResourceForCurrentUser(this.id, resource.id, {
		//         accessToken: session.accessToken,
		//         cursor: cursor,
		//       });
		//       requestCount += 1;
		//       hasMore = resourceIssues.paging?.more ?? false;
		//       cursor = resourceIssues.paging?.cursor;
		//       const formattedIssues = resourceIssues.values
		//         .map(issue => toIssueShape(issue, this))
		//         .filter((result): result is IssueShape => result != null);
		//       if (formattedIssues.length > 0) {
		//         results.push(...formattedIssues);
		//       }
		//     } while (requestCount < maxPagesPerRequest && hasMore);
		//   } catch (ex) {
		//     // TODO: We need a better way to message the failure to the user here.
		//     // This is a stopgap to prevent one bag org from throwing and preventing any issues from being returned.
		//     Logger.error(ex, 'searchProviderMyIssues');
		//   }
		// }
		// return results;
	}
	protected override getProviderIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		throw new Error('Method not implemented.');
	}
	protected override getProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		throw new Error('Method not implemented.');
	}
	// readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	// readonly id = IssuesCloudHostIntegrationId.Linear;
	// protected readonly key = this.id;
	// readonly name: string = 'Linear';
}
