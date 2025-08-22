import type { CancellationToken } from 'vscode';
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
}

export interface LinearProjectDescriptor extends IssueResourceDescriptor {}

export class LinearIntegration extends IssuesIntegration<IssuesCloudHostIntegrationId.Linear> {
	protected override getProviderResourcesForUser(
		_session: ProviderAuthenticationSession,
	): Promise<ResourceDescriptor[] | undefined> {
		throw new Error('Method not implemented.');
	}
	protected override getProviderProjectsForResources(
		_session: ProviderAuthenticationSession,
		_resources: ResourceDescriptor[],
	): Promise<ResourceDescriptor[] | undefined> {
		throw new Error('Method not implemented.');
	}
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;

	protected override getProviderAccountForResource(
		_session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
	): Promise<Account | undefined> {
		throw new Error('Method not implemented.');
	}

	protected override getProviderIssuesForProject(
		_session: ProviderAuthenticationSession,
		_project: ResourceDescriptor,
		_options?: { user?: string; filters?: IssueFilter[] },
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
		_session: ProviderAuthenticationSession,
		_resources?: ResourceDescriptor[],
		_cancellation?: CancellationToken,
	): Promise<IssueShape[] | undefined> {
		return Promise.resolve(undefined);
	}
	protected override getProviderIssueOrPullRequest(
		_session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
		_id: string,
		_type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		throw new Error('Method not implemented.');
	}
	protected override getProviderIssue(
		_session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
		_id: string,
	): Promise<Issue | undefined> {
		throw new Error('Method not implemented.');
	}
}
