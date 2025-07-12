import type { Repository } from '../../../git/models/repository';
import type {
	CloudWorkspace,
	CloudWorkspaceData,
	CloudWorkspaceIssueTracker,
	CloudWorkspaceProviderType,
	CloudWorkspaceRepositoryDescriptor,
} from './cloudWorkspace';
import type { LocalWorkspace, LocalWorkspaceRepositoryDescriptor } from './localWorkspace';

export type WorkspaceType = 'cloud' | 'local';
export type WorkspaceAutoAddSetting = 'disabled' | 'enabled' | 'prompt';

export type WorkspaceRepositoryRelation = 'DIRECT' | 'PROVIDER_PROJECT';

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

export const defaultWorkspaceCount = 100;
export const defaultWorkspaceRepoCount = 100;

export type GKOrgVelocitySettings = Record<string, unknown>;
export type ProjectGoalsSettings = Record<string, unknown>;

export interface UserCloudWorkspaceSettings {
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
