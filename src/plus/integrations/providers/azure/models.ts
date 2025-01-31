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

export interface AzureUserWithVote extends AzureUser {
	isFlagged: boolean;
	isReapprove: boolean;
	isRequired: boolean;
}

export interface AzureWorkItemCommentVersionRef {
	commentId: number;
	createdInRevision: number;
	isDeleted: boolean;
	text: string;
	url: string;
	version: number;
}

export interface AzureWorkItemRelation {
	attributes: {
		[key: string]: string;
	};
	relation: string;
	url: string;
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
	commentVersionRef?: AzureWorkItemCommentVersionRef;
	relations?: AzureWorkItemRelation[];
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

export interface AzureGitCommitRef {
	commitId: string;
	url: string;
}

export interface AzureResourceRef {
	id: string;
	url: string;
}

export interface AzurePullRequestCompletionOptions {
	autoCompleteIgnoreConflicts: number[];
	bypassPolicy: boolean;
	bypassReason: string;
	deleteSourceBranch: boolean;
	mergeCommitMessage: string;
	mergeStrategy: 'noFastForward' | 'rebase' | 'rebaseMerge' | 'squash';
	squashMerge: boolean;
	transitionWorkItems: boolean;
	triggeredByAutoComplete: boolean;
}

export interface AzureGitStatus {
	context: {
		name: string;
		genre: string;
	};
	createdBy: AzureUser;
	createDate: string;
	description: string;
	state: 'error' | 'failed' | 'notApplicable' | 'notSet' | 'pending' | 'succeeded';
	targetUrl: string;
	updateDate: string;
}

export interface AzureGitForkRef {
	creator: AzureUser;
	isLocked: boolean;
	isLockedBy: AzureUser;
	name: string;
	objectId: string;
	peeledObjectId: string;
	repository: AzureRepository;
	statuses: AzureGitStatus[];
	url: string;
}

export interface AzureWebApiTagDefinition {
	active: boolean;
	id: string;
	name: string;
	url: string;
}

export interface AzureGitPullRequestMergeOptions {
	conflictAuthorshipCommits: boolean;
	detectRenameFalsePositives: boolean;
	disableRenames: boolean;
}

export type AzurePullRequestAsyncStatus =
	| 'conflicts'
	| 'failure'
	| 'notSet'
	| 'queued'
	| 'rejectedByPolicy'
	| 'succeeded';

export interface AzurePullRequest {
	repository: AzureRepository;
	pullRequestId: number;
	codeReviewId: number;
	status: AzurePullRequestStatus;
	createdBy: AzureUser;
	creationDate: string;
	closedDate?: string;
	closedBy?: AzureUser; // Can be missed even if closedDate is presented.
	title: string;
	description: string;
	sourceRefName: string;
	targetRefName: string;
	isDraft: boolean;
	mergeId: string;
	lastMergeSourceCommit: AzureGitCommitRef;
	lastMergeTargetCommit: AzureGitCommitRef;
	reviewers: AzureUserWithVote[];
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
	autoCompleteSetBy?: AzureUser;
	commits?: AzureGitCommitRef[];
	completionOptions?: AzurePullRequestCompletionOptions;
	completionQueueTime?: string;
	forkSource?: AzureGitForkRef;
	hasMultipleMergeBases?: boolean;
	labels?: AzureWebApiTagDefinition[];
	lastMergeCommit?: AzureGitCommitRef;
	mergeFailureMessage?: string;
	mergeFailureType?: 'caseSensitive' | 'none' | 'objectTooLarge' | 'unknown';
	mergeOptions?: AzureGitPullRequestMergeOptions;
	mergeStatus?: AzurePullRequestAsyncStatus;
	remoteUrl?: string;
	workItemRefs?: AzureResourceRef[];
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
