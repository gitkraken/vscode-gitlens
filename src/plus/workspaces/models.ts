import type { Repository } from '../../git/models/repository';

export enum WorkspaceType {
	Local = 'local',
	Cloud = 'cloud',
}

export type CodeWorkspaceFileContents = {
	folders: { path: string }[];
	settings: { [key: string]: any };
};

export type WorkspaceRepositoriesByName = Map<string, Repository>;

export interface GetWorkspacesResponse {
	cloudWorkspaces: GKCloudWorkspace[];
	localWorkspaces: GKLocalWorkspace[];
	cloudWorkspaceInfo: string | undefined;
	localWorkspaceInfo: string | undefined;
}

export interface LoadCloudWorkspacesResponse {
	cloudWorkspaces: GKCloudWorkspace[] | undefined;
	cloudWorkspaceInfo: string | undefined;
}

export interface LoadLocalWorkspacesResponse {
	localWorkspaces: GKLocalWorkspace[] | undefined;
	localWorkspaceInfo: string | undefined;
}

export interface GetCloudWorkspaceRepositoriesResponse {
	repositories: CloudWorkspaceRepositoryDescriptor[] | undefined;
	repositoriesInfo: string | undefined;
}

// Cloud Workspace types
export class GKCloudWorkspace {
	private readonly _type: WorkspaceType = WorkspaceType.Cloud;
	private readonly _id: string;
	private readonly _organizationId: string | undefined;
	private readonly _name: string;
	private readonly _provider: CloudWorkspaceProviderType;
	private _repositories: CloudWorkspaceRepositoryDescriptor[] | undefined;
	constructor(
		id: string,
		name: string,
		organizationId: string | undefined,
		provider: CloudWorkspaceProviderType,
		private readonly getReposFn: (workspaceId: string) => Promise<GetCloudWorkspaceRepositoriesResponse>,
		repositories?: CloudWorkspaceRepositoryDescriptor[],
	) {
		this._id = id;
		this._name = name;
		this._organizationId = organizationId;
		this._provider = provider;
		this._repositories = repositories;
	}

	get type(): WorkspaceType {
		return this._type;
	}

	get id(): string {
		return this._id;
	}

	get name(): string {
		return this._name;
	}

	get organization_id(): string | undefined {
		return this._organizationId;
	}

	get provider(): CloudWorkspaceProviderType {
		return this._provider;
	}

	get repositories(): CloudWorkspaceRepositoryDescriptor[] | undefined {
		return this._repositories;
	}

	isShared(): boolean {
		return this._organizationId != null;
	}

	getRepository(name: string): CloudWorkspaceRepositoryDescriptor | undefined {
		return this._repositories?.find(r => r.name === name);
	}

	addRepositories(repositories: CloudWorkspaceRepositoryDescriptor[]): void {
		if (this._repositories == null) {
			this._repositories = repositories;
		} else {
			this._repositories = this._repositories.concat(repositories);
		}
	}

	removeRepositories(repoNames: string[]): void {
		if (this._repositories == null) return;

		this._repositories = this._repositories.filter(r => !repoNames.includes(r.name));
	}

	async getOrLoadRepositories(): Promise<GetCloudWorkspaceRepositoriesResponse> {
		if (this._repositories != null) return { repositories: this._repositories, repositoriesInfo: undefined };

		const getResponse = await this.getReposFn(this._id);
		if (getResponse.repositories != null) {
			this._repositories = getResponse.repositories;
		}

		return getResponse;
	}
}

export interface CloudWorkspaceRepositoryDescriptor {
	id: string;
	name: string;
	description: string;
	repository_id: string;
	provider: string;
	provider_organization_id: string;
	provider_organization_name: string;
	url: string;
}

export enum CloudWorkspaceProviderInputType {
	GitHub = 'GITHUB',
	GitHubEnterprise = 'GITHUB_ENTERPRISE',
	GitLab = 'GITLAB',
	GitLabSelfHosted = 'GITLAB_SELF_HOSTED',
	Bitbucket = 'BITBUCKET',
	Azure = 'AZURE',
}

export enum CloudWorkspaceProviderType {
	GitHub = 'github',
	GitHubEnterprise = 'github_enterprise',
	GitLab = 'gitlab',
	GitLabSelfHosted = 'gitlab_self_hosted',
	Bitbucket = 'bitbucket',
	Azure = 'azure',
}

export const cloudWorkspaceProviderTypeToRemoteProviderId = {
	[CloudWorkspaceProviderType.Azure]: 'azure-devops',
	[CloudWorkspaceProviderType.Bitbucket]: 'bitbucket',
	[CloudWorkspaceProviderType.GitHub]: 'github',
	[CloudWorkspaceProviderType.GitHubEnterprise]: 'github',
	[CloudWorkspaceProviderType.GitLab]: 'gitlab',
	[CloudWorkspaceProviderType.GitLabSelfHosted]: 'gitlab',
};

export const cloudWorkspaceProviderInputTypeToRemoteProviderId = {
	[CloudWorkspaceProviderInputType.Azure]: 'azure-devops',
	[CloudWorkspaceProviderInputType.Bitbucket]: 'bitbucket',
	[CloudWorkspaceProviderInputType.GitHub]: 'github',
	[CloudWorkspaceProviderInputType.GitHubEnterprise]: 'github',
	[CloudWorkspaceProviderInputType.GitLab]: 'gitlab',
	[CloudWorkspaceProviderInputType.GitLabSelfHosted]: 'gitlab',
};

export const defaultWorkspaceCount = 100;
export const defaultWorkspaceRepoCount = 100;

export interface CloudWorkspaceData {
	id: string;
	name: string;
	description: string;
	type: CloudWorkspaceType;
	icon_url: string;
	host_url: string;
	status: string;
	provider: string;
	azure_organization_id: string;
	azure_project: string;
	created_date: Date;
	updated_date: Date;
	created_by: string;
	updated_by: string;
	members: CloudWorkspaceMember[];
	organization: CloudWorkspaceOrganization;
	issue_tracker: CloudWorkspaceIssueTracker;
	settings: CloudWorkspaceSettings;
	current_user: UserCloudWorkspaceSettings;
	errors: string[];
	provider_data: ProviderCloudWorkspaceData;
}

export type CloudWorkspaceType = 'GK_PROJECT' | 'GK_ORG_VELOCITY' | 'GK_CLI';

export interface CloudWorkspaceMember {
	id: string;
	role: string;
	name: string;
	username: string;
	avatar_url: string;
}

interface CloudWorkspaceOrganization {
	id: string;
	team_ids: string[];
}

interface CloudWorkspaceIssueTracker {
	provider: string;
	settings: CloudWorkspaceIssueTrackerSettings;
}

interface CloudWorkspaceIssueTrackerSettings {
	resource_id: string;
}

interface CloudWorkspaceSettings {
	gkOrgVelocity: GKOrgVelocitySettings;
	goals: ProjectGoalsSettings;
}

type GKOrgVelocitySettings = Record<string, unknown>;
type ProjectGoalsSettings = Record<string, unknown>;

interface UserCloudWorkspaceSettings {
	project_id: string;
	user_id: string;
	tab_settings: UserCloudWorkspaceTabSettings;
}

interface UserCloudWorkspaceTabSettings {
	issue_tracker: CloudWorkspaceIssueTracker;
}

export interface ProviderCloudWorkspaceData {
	id: string;
	provider_organization_id: string;
	repository: CloudWorkspaceRepositoryData;
	repositories: CloudWorkspaceConnection<CloudWorkspaceRepositoryData>;
	pull_requests: CloudWorkspacePullRequestData[];
	issues: CloudWorkspaceIssue[];
	repository_members: CloudWorkspaceRepositoryMemberData[];
	milestones: CloudWorkspaceMilestone[];
	labels: CloudWorkspaceLabel[];
	issue_types: CloudWorkspaceIssueType[];
	provider_identity: ProviderCloudWorkspaceIdentity;
	metrics: ProviderCloudWorkspaceMetrics;
}

type ProviderCloudWorkspaceMetrics = Record<string, unknown>;

interface ProviderCloudWorkspaceIdentity {
	avatar_url: string;
	id: string;
	name: string;
	username: string;
	pat_organization: string;
	is_using_pat: boolean;
	scopes: string;
}

export interface Branch {
	id: string;
	node_id: string;
	name: string;
	commit: BranchCommit;
}

interface BranchCommit {
	id: string;
	url: string;
	build_status: {
		context: string;
		state: string;
		description: string;
	};
}

export interface CloudWorkspaceRepositoryData {
	id: string;
	name: string;
	description: string;
	repository_id: string;
	provider: string;
	provider_organization_id: string;
	provider_organization_name: string;
	url: string;
	default_branch: string;
	branches: Branch[];
	pull_requests: CloudWorkspacePullRequestData[];
	issues: CloudWorkspaceIssue[];
	members: CloudWorkspaceRepositoryMemberData[];
	milestones: CloudWorkspaceMilestone[];
	labels: CloudWorkspaceLabel[];
	issue_types: CloudWorkspaceIssueType[];
	possibly_deleted: boolean;
	has_webhook: boolean;
}

interface CloudWorkspaceRepositoryMemberData {
	avatar_url: string;
	name: string;
	node_id: string;
	username: string;
}

type CloudWorkspaceMilestone = Record<string, unknown>;
type CloudWorkspaceLabel = Record<string, unknown>;
type CloudWorkspaceIssueType = Record<string, unknown>;

export interface CloudWorkspacePullRequestData {
	id: string;
	node_id: string;
	number: string;
	title: string;
	description: string;
	url: string;
	milestone_id: string;
	labels: CloudWorkspaceLabel[];
	author_id: string;
	author_username: string;
	created_date: Date;
	updated_date: Date;
	closed_date: Date;
	merged_date: Date;
	first_commit_date: Date;
	first_response_date: Date;
	comment_count: number;
	repository: CloudWorkspaceRepositoryData;
	head_commit: {
		id: string;
		url: string;
		build_status: {
			context: string;
			state: string;
			description: string;
		};
	};
	lifecycle_stages: {
		stage: string;
		start_date: Date;
		end_date: Date;
	}[];
	reviews: CloudWorkspacePullRequestReviews[];
	head: {
		name: string;
	};
}

interface CloudWorkspacePullRequestReviews {
	user_id: string;
	avatar_url: string;
	state: string;
}

export interface CloudWorkspaceIssue {
	id: string;
	node_id: string;
	title: string;
	author_id: string;
	assignee_ids: string[];
	milestone_id: string;
	label_ids: string[];
	issue_type: string;
	url: string;
	created_date: Date;
	updated_date: Date;
	comment_count: number;
	repository: CloudWorkspaceRepositoryData;
}

interface CloudWorkspaceConnection<i> {
	total_count: number;
	page_info: {
		start_cursor: string;
		end_cursor: string;
		has_next_page: boolean;
	};
	nodes: i[];
}

interface CloudWorkspaceFetchedConnection<i> extends CloudWorkspaceConnection<i> {
	is_fetching: boolean;
}

export interface WorkspacesResponse {
	data: {
		projects: CloudWorkspaceConnection<CloudWorkspaceData>;
	};
}

export interface WorkspaceRepositoriesResponse {
	data: {
		project: {
			provider_data: {
				repositories: CloudWorkspaceConnection<CloudWorkspaceRepositoryData>;
			};
		};
	};
}

export interface WorkspacePullRequestsResponse {
	data: {
		project: {
			provider_data: {
				pull_requests: CloudWorkspaceFetchedConnection<CloudWorkspacePullRequestData>;
			};
		};
	};
}

export interface WorkspacesWithPullRequestsResponse {
	data: {
		projects: {
			nodes: {
				provider_data: {
					pull_requests: CloudWorkspaceFetchedConnection<CloudWorkspacePullRequestData>;
				};
			}[];
		};
	};
	errors?: {
		message: string;
		path: unknown[];
		statusCode: number;
	}[];
}

export interface WorkspaceIssuesResponse {
	data: {
		project: {
			provider_data: {
				issues: CloudWorkspaceFetchedConnection<CloudWorkspaceIssue>;
			};
		};
	};
}

export interface CreateWorkspaceResponse {
	data: {
		create_project: CloudWorkspaceData | null;
	};
}

export interface DeleteWorkspaceResponse {
	data: {
		delete_project: CloudWorkspaceData | null;
	};
}

export type AddRepositoriesToWorkspaceResponse = {
	data: {
		add_repositories_to_project: {
			id: string;
			provider_data: {
				[repoKey: string]: CloudWorkspaceRepositoryData;
			};
		} | null;
	};
};

export interface RemoveRepositoriesFromWorkspaceResponse {
	data: {
		remove_repositories_from_project: {
			id: string;
		} | null;
	};
}

export interface AddWorkspaceRepoDescriptor {
	owner: string;
	repoName: string;
}

// TODO@ramint Switch to using repo id once that is no longer bugged
export interface RemoveWorkspaceRepoDescriptor {
	owner: string;
	repoName: string;
}

// Local Workspace Types
export class GKLocalWorkspace {
	private readonly _type: WorkspaceType = WorkspaceType.Local;
	private readonly _id: string;
	private readonly _name: string;
	private readonly _repositories: LocalWorkspaceRepositoryDescriptor[] | undefined;
	constructor(id: string, name: string, repositories?: LocalWorkspaceRepositoryDescriptor[]) {
		this._id = id;
		this._name = name;
		this._repositories = repositories;
	}

	get type(): WorkspaceType {
		return this._type;
	}

	get id(): string {
		return this._id;
	}

	get name(): string {
		return this._name;
	}

	get repositories(): LocalWorkspaceRepositoryDescriptor[] | undefined {
		return this._repositories;
	}

	isShared(): boolean {
		return false;
	}

	getRepository(name: string): LocalWorkspaceRepositoryDescriptor | undefined {
		return this._repositories?.find(r => r.name === name);
	}
}

// Local workspace file constants

export const localWorkspaceDataFilePath = 'localWorkspaces.json';
export const localWorkspaceDataLegacyFilePath = 'workspaces/workspaces.json';

export interface LocalWorkspaceFileData {
	workspaces: LocalWorkspaceData;
}

export type LocalWorkspaceData = {
	[localWorkspaceId: string]: LocalWorkspaceDescriptor;
};

export interface LocalWorkspaceDescriptor {
	localId: string;
	profileId: string;
	name: string;
	description: string;
	repositories: LocalWorkspaceRepositoryPath[];
	version: number;
}

export interface LocalWorkspaceRepositoryPath {
	localPath: string;
}

export interface LocalWorkspaceRepositoryDescriptor extends LocalWorkspaceRepositoryPath {
	name: string;
}

// Cloud workspace file constants

export const cloudWorkspaceDataFilePath = 'cloudWorkspaces.json';

export interface CloudWorkspaceFileData {
	workspaces: CloudWorkspacesPathMap;
}

export type CloudWorkspacesPathMap = {
	[cloudWorkspaceId: string]: CloudWorkspaceRepoPaths;
};

export interface CloudWorkspaceRepoPaths {
	repoPaths: CloudWorkspaceRepoPathMap;
}

export type CloudWorkspaceRepoPathMap = {
	[repoId: string]: string;
};
