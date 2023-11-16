import type { Disposable } from '../../api/gitlens';
import type { Container } from '../../container';
import type { Repository } from '../../git/models/repository';

export type WorkspaceType = 'cloud' | 'local';
export type WorkspaceAutoAddSetting = 'disabled' | 'enabled' | 'prompt';

export enum WorkspaceRepositoryRelation {
	Direct = 'DIRECT',
	ProviderProject = 'PROVIDER_PROJECT',
}

export type CodeWorkspaceFileContents = {
	folders: { path: string }[];
	settings: Record<string, any>;
};

export type WorkspaceRepositoriesByName = Map<string, RepositoryMatch>;

export interface RepositoryMatch {
	repository: Repository;
	descriptor: CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor;
}

export interface RemoteDescriptor {
	provider: string;
	owner: string;
	repoName: string;
	url?: string;
}

export interface GetWorkspacesResponse {
	cloudWorkspaces: CloudWorkspace[];
	localWorkspaces: LocalWorkspace[];
	cloudWorkspaceInfo: string | undefined;
	localWorkspaceInfo: string | undefined;
}

export interface LoadCloudWorkspacesResponse {
	cloudWorkspaces: CloudWorkspace[] | undefined;
	cloudWorkspaceInfo: string | undefined;
}

export interface LoadLocalWorkspacesResponse {
	localWorkspaces: LocalWorkspace[] | undefined;
	localWorkspaceInfo: string | undefined;
}

export interface GetCloudWorkspaceRepositoriesResponse {
	repositories: CloudWorkspaceRepositoryDescriptor[] | undefined;
	repositoriesInfo: string | undefined;
}

// Cloud Workspace types
export class CloudWorkspace {
	readonly type = 'cloud' satisfies WorkspaceType;

	private _repositoryDescriptors: CloudWorkspaceRepositoryDescriptor[] | undefined;
	private _repositoriesByName: WorkspaceRepositoriesByName | undefined;
	private _localPath: string | undefined;
	private _disposable: Disposable;

	constructor(
		private readonly container: Container,
		public readonly id: string,
		public readonly name: string,
		public readonly organizationId: string | undefined,
		public readonly provider: CloudWorkspaceProviderType,
		public readonly repoRelation: WorkspaceRepositoryRelation,
		public readonly current: boolean,
		public readonly azureInfo?: {
			organizationId?: string;
			project?: string;
		},
		repositories?: CloudWorkspaceRepositoryDescriptor[],
		localPath?: string,
	) {
		this._repositoryDescriptors = repositories;
		this._localPath = localPath;
		this._disposable = this.container.git.onDidChangeRepositories(this.resetRepositoriesByName, this);
	}

	dispose() {
		this._disposable.dispose();
	}

	get shared(): boolean {
		return this.organizationId != null;
	}

	get localPath(): string | undefined {
		return this._localPath;
	}

	resetRepositoriesByName() {
		this._repositoriesByName = undefined;
	}

	async getRepositoriesByName(options?: { force?: boolean }): Promise<WorkspaceRepositoriesByName> {
		if (this._repositoriesByName == null || options?.force) {
			this._repositoriesByName = await this.container.workspaces.resolveWorkspaceRepositoriesByName(this.id, {
				resolveFromPath: true,
				usePathMapping: true,
			});
		}

		return this._repositoriesByName;
	}

	async getRepositoryDescriptors(options?: { force?: boolean }): Promise<CloudWorkspaceRepositoryDescriptor[]> {
		if (this._repositoryDescriptors == null || options?.force) {
			this._repositoryDescriptors = await this.container.workspaces.getCloudWorkspaceRepositories(this.id);
			this.resetRepositoriesByName();
		}

		return this._repositoryDescriptors;
	}

	async getRepositoryDescriptor(name: string): Promise<CloudWorkspaceRepositoryDescriptor | undefined> {
		return (await this.getRepositoryDescriptors()).find(r => r.name === name);
	}

	// TODO@axosoft-ramint this should be the entry point, not a backdoor to update the cache
	addRepositories(repositories: CloudWorkspaceRepositoryDescriptor[]): void {
		if (this._repositoryDescriptors == null) {
			this._repositoryDescriptors = repositories;
		} else {
			this._repositoryDescriptors = this._repositoryDescriptors.concat(repositories);
		}

		this.resetRepositoriesByName();
	}

	// TODO@axosoft-ramint this should be the entry point, not a backdoor to update the cache
	removeRepositories(repoNames: string[]): void {
		if (this._repositoryDescriptors == null) return;

		this._repositoryDescriptors = this._repositoryDescriptors.filter(r => !repoNames.includes(r.name));
		this.resetRepositoriesByName();
	}

	setLocalPath(localPath: string | undefined): void {
		this._localPath = localPath;
	}
}

export interface CloudWorkspaceRepositoryDescriptor {
	id: string;
	name: string;
	description: string;
	repository_id: string;
	provider: CloudWorkspaceProviderType | null;
	provider_project_name: string | null;
	provider_organization_id: string;
	provider_organization_name: string | null;
	url: string | null;
	workspaceId: string;
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

export enum WorkspaceAddRepositoriesChoice {
	CurrentWindow = 'Current Window',
	ParentFolder = 'Parent Folder',
}

export const defaultWorkspaceCount = 100;
export const defaultWorkspaceRepoCount = 100;

export interface CloudWorkspaceData {
	id: string;
	name: string;
	description: string;
	type: CloudWorkspaceType;
	icon_url: string | null;
	host_url: string;
	status: string;
	provider: string;
	repo_relation: string;
	azure_organization_id: string | null;
	azure_project: string | null;
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
	provider: CloudWorkspaceProviderType | null;
	provider_project_name: string | null;
	provider_organization_id: string;
	provider_organization_name: string | null;
	url: string | null;
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

export interface CloudWorkspaceConnection<i> {
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

export interface WorkspaceResponse {
	data: {
		project: CloudWorkspaceData;
	};
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
	errors?: { code: number; message: string }[];
}

export type AddRepositoriesToWorkspaceResponse = {
	data: {
		add_repositories_to_project: {
			id: string;
			provider_data: Record<string, CloudWorkspaceRepositoryData>;
		} | null;
	};
	errors?: { code: number; message: string }[];
};

export interface RemoveRepositoriesFromWorkspaceResponse {
	data: {
		remove_repositories_from_project: {
			id: string;
		} | null;
	};
	errors?: { code: number; message: string }[];
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
export class LocalWorkspace {
	readonly type = 'local' satisfies WorkspaceType;

	private _localPath: string | undefined;
	private _repositoriesByName: WorkspaceRepositoriesByName | undefined;
	private _disposable: Disposable;

	constructor(
		public readonly container: Container,
		public readonly id: string,
		public readonly name: string,
		private readonly repositoryDescriptors: LocalWorkspaceRepositoryDescriptor[],
		public readonly current: boolean,
		localPath?: string,
	) {
		this._localPath = localPath;
		this._disposable = this.container.git.onDidChangeRepositories(this.resetRepositoriesByName, this);
	}

	dispose() {
		this._disposable.dispose();
	}

	get shared(): boolean {
		return false;
	}

	get localPath(): string | undefined {
		return this._localPath;
	}

	resetRepositoriesByName() {
		this._repositoriesByName = undefined;
	}

	async getRepositoriesByName(options?: { force?: boolean }): Promise<WorkspaceRepositoriesByName> {
		if (this._repositoriesByName == null || options?.force) {
			this._repositoriesByName = await this.container.workspaces.resolveWorkspaceRepositoriesByName(this.id, {
				resolveFromPath: true,
				usePathMapping: true,
			});
		}

		return this._repositoriesByName;
	}

	getRepositoryDescriptors(): Promise<LocalWorkspaceRepositoryDescriptor[]> {
		return Promise.resolve(this.repositoryDescriptors);
	}

	getRepositoryDescriptor(name: string): Promise<LocalWorkspaceRepositoryDescriptor | undefined> {
		return Promise.resolve(this.repositoryDescriptors.find(r => r.name === name));
	}

	setLocalPath(localPath: string | undefined): void {
		this._localPath = localPath;
	}
}

export interface LocalWorkspaceFileData {
	workspaces: LocalWorkspaceData;
}

export type LocalWorkspaceData = Record<string, LocalWorkspaceDescriptor>;

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
	id?: undefined;
	name: string;
	workspaceId: string;
}

export interface CloudWorkspaceFileData {
	workspaces: CloudWorkspacesPathMap;
}

export type CloudWorkspacesPathMap = Record<string, CloudWorkspacePaths>;

export interface CloudWorkspacePaths {
	repoPaths: CloudWorkspaceRepoPathMap;
	externalLinks: CloudWorkspaceExternalLinkMap;
}

export type CloudWorkspaceRepoPathMap = Record<string, string>;

export type CloudWorkspaceExternalLinkMap = Record<string, string>;
