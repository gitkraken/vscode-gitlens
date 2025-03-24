import type { Disposable } from 'vscode';
import type { Container } from '../../../container';
import type {
	GKOrgVelocitySettings,
	ProjectGoalsSettings,
	ProviderCloudWorkspaceData,
	UserCloudWorkspaceSettings,
	WorkspaceRepositoriesByName,
	WorkspaceRepositoryRelation,
	WorkspaceType,
} from './workspaces';

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

	dispose(): void {
		this._disposable.dispose();
	}

	get shared(): boolean {
		return this.organizationId != null;
	}

	get localPath(): string | undefined {
		return this._localPath;
	}

	resetRepositoriesByName(): void {
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

export interface CloudWorkspaceOrganization {
	id: string;
	team_ids: string[];
}

export interface CloudWorkspaceIssueTracker {
	provider: string;
	settings: CloudWorkspaceIssueTrackerSettings;
}

interface CloudWorkspaceIssueTrackerSettings {
	resource_id: string;
}

export interface CloudWorkspaceSettings {
	gkOrgVelocity: GKOrgVelocitySettings;
	goals: ProjectGoalsSettings;
}

export interface CloudWorkspaceFileData {
	workspaces: CloudWorkspacesPathMap;
}

export const enum CloudWorkspaceProviderType {
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

export const enum CloudWorkspaceProviderInputType {
	GitHub = 'GITHUB',
	GitHubEnterprise = 'GITHUB_ENTERPRISE',
	GitLab = 'GITLAB',
	GitLabSelfHosted = 'GITLAB_SELF_HOSTED',
	Bitbucket = 'BITBUCKET',
	Azure = 'AZURE',
}

export const cloudWorkspaceProviderInputTypeToRemoteProviderId = {
	[CloudWorkspaceProviderInputType.Azure]: 'azure-devops',
	[CloudWorkspaceProviderInputType.Bitbucket]: 'bitbucket',
	[CloudWorkspaceProviderInputType.GitHub]: 'github',
	[CloudWorkspaceProviderInputType.GitHubEnterprise]: 'github',
	[CloudWorkspaceProviderInputType.GitLab]: 'gitlab',
	[CloudWorkspaceProviderInputType.GitLabSelfHosted]: 'gitlab',
};

export type CloudWorkspacesPathMap = Record<string, CloudWorkspacePaths>;

export interface CloudWorkspacePaths {
	repoPaths: CloudWorkspaceRepoPathMap;
	externalLinks: CloudWorkspaceExternalLinkMap;
}

export type CloudWorkspaceRepoPathMap = Record<string, string>;

export type CloudWorkspaceExternalLinkMap = Record<string, string>;
