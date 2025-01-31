import type { IssueOrPullRequestState } from '../../../../git/models/issueOrPullRequest';

export type AzureWorkItemStateCategory = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';

export function isClosedAzureWorkItemStateCategory(category: AzureWorkItemStateCategory | undefined): boolean {
	return category === 'Completed' || category === 'Resolved' || category === 'Removed';
}

export function azureWorkItemsStateCategoryToState(
	category: AzureWorkItemStateCategory | undefined,
): IssueOrPullRequestState {
	switch (category) {
		case 'Resolved':
		case 'Completed':
		case 'Removed':
			return 'closed';
		case 'Proposed':
		case 'InProgress':
		default:
			return 'opened';
	}
}

export interface AzureLink {
	href: string;
}

export interface AzureUser {
	displayName: string;
	url: string;
	_links: {
		avatar: AzureLink;
	};
	id: string;
	uniqueName: string;
	imageUrl: string;
	descriptor: string;
}

export interface WorkItem {
	_links: {
		fields: AzureLink;
		html: AzureLink;
		self: AzureLink;
		workItemComments: AzureLink;
		workItemRevisions: AzureLink;
		workItemType: AzureLink;
		workItemUpdates: AzureLink;
	};
	fields: {
		// 'System.AreaPath': string;
		// 'System.TeamProject': string;
		// 'System.IterationPath': string;
		'System.WorkItemType': string;
		'System.State': string;
		// 'System.Reason': string;
		'System.CreatedDate': string;
		// 'System.CreatedBy': AzureUser;
		'System.ChangedDate': string;
		// 'System.ChangedBy': AzureUser;
		// 'System.CommentCount': number;
		'System.Title': string;
		// 'Microsoft.VSTS.Common.StateChangeDate': string;
		// 'Microsoft.VSTS.Common.Priority': number;
		// 'Microsoft.VSTS.Common.Severity': string;
		// 'Microsoft.VSTS.Common.ValueArea': string;
	};
	id: number;
	rev: number;
	url: string;
}

export interface AzureWorkItemState {
	name: string;
	color: string;
	category: AzureWorkItemStateCategory;
}

export type AzurePullRequestStatus = 'abandoned' | 'active' | 'completed' | 'notSet';
export function azurePullRequestStatusToState(status: AzurePullRequestStatus): IssueOrPullRequestState {
	switch (status) {
		case 'abandoned':
			return 'closed';
		case 'completed':
			return 'merged';
		case 'active':
		case 'notSet':
		default:
			return 'opened';
	}
}
export function isClosedAzurePullRequestStatus(status: AzurePullRequestStatus): boolean {
	return azurePullRequestStatusToState(status) !== 'opened';
}

export type AzureProjectState = 'createPending' | 'deleted' | 'deleting' | 'new' | 'unchanged' | 'wellFormed';
export type AzureProjectVisibility = 'private' | 'public';

export interface AzureProject {
	id: string;
	name: string;
	url: string;
	state: AzureProjectState;
	revision: number;
	visibility: AzureProjectVisibility;
	lastUpdateTime: string;
}

export interface AzureRepository {
	id: string;
	name: string;
	url: string;
	project: AzureProject;
	size: number;
	remoteUrl: string;
	sshUrl: string;
	webUrl: string;
	isDisabled: boolean;
	isInMaintenance: boolean;
}

export interface AzurePullRequest {
	repository: AzureRepository;
	pullRequestId: number;
	codeReviewId: number;
	status: AzurePullRequestStatus;
	createdBy: AzureUser;
	creationDate: string;
	closedDate: string;
	title: string;
	description: string;
	sourceRefName: string;
	targetRefName: string;
	isDraft: boolean;
	mergeId: string;
	lastMergeSourceCommit: {
		commitId: string;
		url: string;
	};
	lastMergeTargetCommit: {
		commitId: string;
		url: string;
	};
	reviewers: unknown[];
	url: string;
	_links: {
		self: AzureLink;
		repository: AzureLink;
		workItems: AzureLink;
		sourceBranch: AzureLink;
		targetBranch: AzureLink;
		statuses: AzureLink;
		sourceCommit: AzureLink;
		targetCommit: AzureLink;
		createdBy: AzureLink;
		iterations: AzureLink;
	};
	supportsIterations: boolean;
	artifactId: string;
}
export function getAzureDevOpsOwner(url: URL): string {
	return url.pathname.split('/')[1];
}
export function getAzureRepo(pr: AzurePullRequest): string {
	return `${pr.repository.project.name}/_git/${pr.repository.name}`;
}

export function getAzurePullRequestWebUrl(pr: AzurePullRequest): string {
	const url = new URL(pr.url);
	const baseUrl = new URL(url.origin).toString();
	const repoPath = getAzureRepo(pr);
	const isVSTS = url.hostname.endsWith('visualstudio.com');
	if (isVSTS) {
		return `${baseUrl}/${repoPath}/pullrequest/${pr.pullRequestId}`;
	}
	const owner = getAzureDevOpsOwner(url);
	return `${baseUrl}/${owner}/${repoPath}/pullrequest/${pr.pullRequestId}`;
}
