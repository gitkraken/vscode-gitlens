export type WorkspaceProvider =
	| 'GITHUB'
	| 'GITHUB_ENTERPRISE'
	| 'GITLAB'
	| 'GITLAB_SELF_HOSTED'
	| 'BITBUCKET'
	| 'AZURE';

export interface Workspace {
	id: string;
	name: string;
	description: string;
	type: WorkspaceType;
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
	members: WorkspaceMember[];
	organization: WorkspaceOrganization;
	issue_tracker: WorkspaceIssueTracker;
	settings: WorkspaceSettings;
	current_user: UserWorkspaceSettings;
	errors: string[];
	provider_data: ProviderWorkspaceData;
}

export type WorkspaceType = 'GK_PROJECT' | 'GK_ORG_VELOCITY' | 'GK_CLI';

export interface WorkspaceMember {
	id: string;
	role: string;
	name: string;
	username: string;
	avatar_url: string;
}

interface WorkspaceOrganization {
	id: string;
	team_ids: string[];
}

interface WorkspaceIssueTracker {
	provider: string;
	settings: WorkspaceIssueTrackerSettings;
}

interface WorkspaceIssueTrackerSettings {
	resource_id: string;
}

interface WorkspaceSettings {
	gkOrgVelocity: GKOrgVelocitySettings;
	goals: ProjectGoalsSettings;
}

type GKOrgVelocitySettings = Record<string, unknown>;
type ProjectGoalsSettings = Record<string, unknown>;

interface UserWorkspaceSettings {
	project_id: string;
	user_id: string;
	tab_settings: UserWorkspaceTabSettings;
}

interface UserWorkspaceTabSettings {
	issue_tracker: WorkspaceIssueTracker;
}

export interface ProviderWorkspaceData {
	id: string;
	provider_organization_id: string;
	repository: Repository;
	repositories: Repository[];
	pull_requests: PullRequest[];
	issues: Issue[];
	repository_members: RepositoryMember[];
	milestones: Milestone[];
	labels: Label[];
	issue_types: IssueType[];
	provider_identity: ProviderIdentity;
	metrics: Metrics;
}

type Metrics = Record<string, unknown>;

interface ProviderIdentity {
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

export interface Repository {
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
	pull_requests: PullRequest[];
	issues: Issue[];
	members: RepositoryMember[];
	milestones: Milestone[];
	labels: Label[];
	issue_types: IssueType[];
	possibly_deleted: boolean;
	has_webhook: boolean;
}

interface RepositoryMember {
	avatar_url: string;
	name: string;
	node_id: string;
	username: string;
}

type Milestone = Record<string, unknown>;
type Label = Record<string, unknown>;
type IssueType = Record<string, unknown>;

export interface PullRequest {
	id: string;
	node_id: string;
	number: string;
	title: string;
	description: string;
	url: string;
	milestone_id: string;
	labels: Label[];
	author_id: string;
	author_username: string;
	created_date: Date;
	updated_date: Date;
	closed_date: Date;
	merged_date: Date;
	first_commit_date: Date;
	first_response_date: Date;
	comment_count: number;
	repository: Repository;
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
	reviews: PullRequestReviews[];
	head: {
		name: string;
	};
}

interface PullRequestReviews {
	user_id: string;
	avatar_url: string;
	state: string;
}

export interface Issue {
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
	repository: Repository;
}

interface Connection<i> {
	total_count: number;
	page_info: {
		start_cursor: string;
		end_cursor: string;
		has_next_page: boolean;
	};
	nodes: i[];
}

interface FetchedConnection<i> extends Connection<i> {
	is_fetching: boolean;
}

export interface WorkspacesResponse {
	data: {
		projects: Connection<Workspace>;
	};
}

export interface PullRequestsResponse {
	data: {
		project: {
			provider_data: {
				pull_requests: FetchedConnection<PullRequest>;
			};
		};
	};
}

export interface WorkspacesWithPullRequestsResponse {
	data: {
		projects: {
			nodes: {
				provider_data: {
					pull_requests: FetchedConnection<PullRequest>;
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

export interface IssuesResponse {
	data: {
		project: {
			provider_data: {
				issues: FetchedConnection<Issue>;
			};
		};
	};
}
