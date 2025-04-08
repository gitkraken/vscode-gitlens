import type { IssueMember } from '../../../../git/models/issue';
import { Issue, RepositoryAccessLevel } from '../../../../git/models/issue';
import type { IssueOrPullRequestState } from '../../../../git/models/issueOrPullRequest';
import type { PullRequestMember, PullRequestReviewer } from '../../../../git/models/pullRequest';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
} from '../../../../git/models/pullRequest';
import type { Provider } from '../../../../git/models/remoteProvider';
import type { ResourceDescriptor } from '../../integration';

const vstsHostnameRegex = /\.visualstudio\.com$/;

export interface AzureRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
}

export interface AzureOrganizationDescriptor extends ResourceDescriptor {
	id: string;
	name: string;
}

export interface AzureProjectDescriptor extends ResourceDescriptor {
	id: string;
	name: string;
	resourceId: string;
	resourceName: string;
}

export interface AzureRemoteRepositoryDescriptor extends ResourceDescriptor {
	id: string;
	nodeId?: string;
	resourceName: string;
	name: string;
	projectName?: string;
	url?: string;
	cloneUrlHttps?: string;
	cloneUrlSsh?: string;
}

export interface AzureProjectInputDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
}

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
	descriptor?: string;
}

export interface AzureUserWithVote extends AzureUser {
	isFlagged?: boolean;
	hasDeclined?: boolean;
	isReapprove?: boolean;
	isRequired?: boolean;
	vote?: AzurePullRequestVote;
}

export type AzurePullRequestVote =
	| 10 // approved
	| 5 // approved with suggestions
	| 0 // no vote
	| -5 // waiting for author
	| -10; // rejected

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
		//'System.AreaPath': string;
		'System.TeamProject': string;
		// 'System.IterationPath': string;
		'System.WorkItemType': string;
		'System.State': string;
		// 'System.Reason': string;
		'System.AssignedTo': AzureUser;
		'System.CreatedDate': string;
		'System.CreatedBy': AzureUser;
		'System.ChangedDate': string;
		'System.ChangedBy': AzureUser;
		'System.CommentCount': number;
		'System.Description': string;
		'System.Title': string;
		'Microsoft.VSTS.Common.ClosedDate': string;
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
	forkSource?: AzureGitForkRef;
	sourceRefName: string;
	targetRefName: string;
	isDraft: boolean;
	mergeId: string;
	mergeStatus?: AzurePullRequestAsyncStatus;
	lastMergeCommit?: AzureGitCommitRef;
	lastMergeSourceCommit: AzureGitCommitRef;
	lastMergeTargetCommit: AzureGitCommitRef;
	reviewers: AzureUserWithVote[];
	url: string;
	supportsIterations: boolean;
}

export interface AzurePullRequestWithLinks extends AzurePullRequest {
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
	artifactId: string;
	autoCompleteSetBy?: AzureUser;
	commits?: AzureGitCommitRef[];
	completionOptions?: AzurePullRequestCompletionOptions;
	completionQueueTime?: string;
	hasMultipleMergeBases?: boolean;
	labels?: AzureWebApiTagDefinition[];
	mergeFailureMessage?: string;
	mergeFailureType?: 'caseSensitive' | 'none' | 'objectTooLarge' | 'unknown';
	mergeOptions?: AzureGitPullRequestMergeOptions;
	remoteUrl?: string;
	workItemRefs?: AzureResourceRef[];
}

export function getVSTSOwner(url: URL): string {
	return url.hostname.split('.')[0];
}
export function getAzureDevOpsOwner(url: URL): string {
	return url.pathname.split('/')[1];
}
export function getAzureOwner(url: URL): string {
	const isVSTS = vstsHostnameRegex.test(url.hostname);
	return isVSTS ? getVSTSOwner(url) : getAzureDevOpsOwner(url);
}

export function getAzureRepo(pr: AzurePullRequest): string {
	return `${pr.repository.project.name}/_git/${pr.repository.name}`;
}

// Example: https://bbbchiv.visualstudio.com/MyFirstProject/_git/test
const azureProjectRepoRegex = /([^/]+)\/_git\/([^/]+)/;
function parseVstsHttpsUrl(url: URL): [owner: string, project: string, repo: string] {
	const owner = getVSTSOwner(url);
	const match = azureProjectRepoRegex.exec(url.pathname);
	if (match == null) {
		throw new Error(`Invalid VSTS URL: ${url.toString()}`);
	}
	const [, project, repo] = match;
	return [owner, project, repo];
}

// Example https://bbbchiv2@dev.azure.com/bbbchiv2/MyFirstProject/_git/test
const azureHttpsUrlRegex = /([^/]+)\/([^/]+)\/_git\/([^/]+)/;
function parseAzureNewStyleUrl(url: URL): [owner: string, project: string, repo: string] {
	const match = azureHttpsUrlRegex.exec(url.pathname);
	if (match == null) {
		throw new Error(`Invalid Azure URL: ${url.toString()}`);
	}
	const [, owner, project, repo] = match;
	return [owner, project, repo];
}

export function parseAzureHttpsUrl(url: string): [owner: string, project: string, repo: string];
export function parseAzureHttpsUrl(urlObj: URL): [owner: string, project: string, repo: string];
export function parseAzureHttpsUrl(arg: URL | string): [owner: string, project: string, repo: string] {
	const url = typeof arg === 'string' ? new URL(arg) : arg;
	if (vstsHostnameRegex.test(url.hostname)) {
		return parseVstsHttpsUrl(url);
	}
	return parseAzureNewStyleUrl(url);
}

export function getAzurePullRequestWebUrl(pr: AzurePullRequest): string {
	const url = new URL(pr.url);
	const baseUrl = new URL(url.origin).toString();
	const repoPath = getAzureRepo(pr);
	const isVSTS = vstsHostnameRegex.test(url.hostname);
	if (isVSTS) {
		return `${baseUrl}/${repoPath}/pullrequest/${pr.pullRequestId}`;
	}
	const owner = getAzureDevOpsOwner(url);
	return `${baseUrl}/${owner}/${repoPath}/pullrequest/${pr.pullRequestId}`;
}

export function fromAzurePullRequestMergeStatusToMergeableState(
	mergeStatus: AzurePullRequestAsyncStatus,
): PullRequestMergeableState {
	switch (mergeStatus) {
		case 'conflicts':
			return PullRequestMergeableState.Conflicting;
		case 'failure':
			return PullRequestMergeableState.FailingChecks;
		case 'rejectedByPolicy':
			return PullRequestMergeableState.BlockedByPolicy;
		case 'succeeded':
			return PullRequestMergeableState.Mergeable;
		case 'notSet':
		case 'queued':
		default:
			return PullRequestMergeableState.Unknown;
	}
}

export function fromAzurePullRequestVoteToReviewState(vote: AzurePullRequestVote): PullRequestReviewState {
	switch (vote) {
		case 10:
		case 5:
			return PullRequestReviewState.Approved;
		case 0:
			return PullRequestReviewState.ReviewRequested;
		case -5:
		case -10:
			return PullRequestReviewState.ChangesRequested;
		default:
			return PullRequestReviewState.ReviewRequested;
	}
}

export function fromAzureUserWithVoteToReviewer(reviewer: AzureUserWithVote): PullRequestReviewer {
	return {
		isCodeOwner: undefined,
		reviewer: {
			avatarUrl: reviewer.imageUrl,
			id: reviewer.id,
			name: reviewer.displayName,
			url: reviewer.url,
		},
		state: fromAzurePullRequestVoteToReviewState(reviewer.vote ?? 0),
	};
}

export function getAzurePullRequestReviewDecision(
	votes: AzurePullRequestVote[],
): PullRequestReviewDecision | undefined {
	const reviewStates = votes.map(vote => fromAzurePullRequestVoteToReviewState(vote));
	if (reviewStates.includes(PullRequestReviewState.ChangesRequested)) {
		return PullRequestReviewDecision.ChangesRequested;
	}

	if (reviewStates.includes(PullRequestReviewState.ReviewRequested)) {
		return PullRequestReviewDecision.ReviewRequired;
	}

	if (reviewStates.includes(PullRequestReviewState.Approved)) {
		return PullRequestReviewDecision.Approved;
	}

	return undefined;
}

export function fromAzureReviewerToPullRequestMember(reviewer: AzureUser): PullRequestMember {
	return {
		avatarUrl: reviewer.imageUrl,
		id: reviewer.id,
		name: reviewer.displayName,
		url: reviewer.url,
	};
}

function normalizeAzureBranchName(branchName: string): string {
	return branchName.startsWith('refs/heads/') ? branchName.replace('refs/heads/', '') : branchName;
}

function fromAzureUserToMember(user: AzureUser, type: 'issue'): IssueMember;
function fromAzureUserToMember(user: AzureUser, type: 'pullRequest'): PullRequestMember;
function fromAzureUserToMember(user: AzureUser, _type: 'issue' | 'pullRequest'): PullRequestMember | IssueMember {
	return {
		avatarUrl: user.imageUrl,
		id: user.id,
		name: user.displayName,
		url: user.url,
	};
}

export function fromAzurePullRequest(pr: AzurePullRequest, provider: Provider, orgName: string): PullRequest {
	const url = new URL(pr.url);
	return new PullRequest(
		provider,
		fromAzureUserToMember(pr.createdBy, 'pullRequest'),
		pr.pullRequestId.toString(),
		pr.pullRequestId.toString(),
		pr.title,
		getAzurePullRequestWebUrl(pr),
		{
			owner: getAzureOwner(url),
			repo: pr.repository.name,
			id: pr.repository.id,
			// TODO: Remove this assumption once actual access level is available
			accessLevel: RepositoryAccessLevel.Write,
		},
		azurePullRequestStatusToState(pr.status),
		new Date(pr.creationDate),
		new Date(pr.closedDate || pr.creationDate),
		pr.closedDate ? new Date(pr.closedDate) : undefined,
		pr.closedDate && pr.status === 'completed' ? new Date(pr.closedDate) : undefined,
		fromAzurePullRequestMergeStatusToMergeableState(pr.mergeStatus ?? 'notSet'),
		undefined,
		{
			base: {
				branch: pr.targetRefName ? normalizeAzureBranchName(pr.targetRefName) : '',
				sha: pr.lastMergeTargetCommit?.commitId ?? '',
				repo: pr.repository.name,
				owner: getAzureOwner(url),
				exists: pr.targetRefName != null,
				url: pr.repository.webUrl,
			},
			head: {
				branch: pr.sourceRefName ? normalizeAzureBranchName(pr.sourceRefName) : '',
				sha: pr.lastMergeSourceCommit?.commitId ?? '',
				repo: pr.forkSource?.repository != null ? pr.forkSource.repository.name : pr.repository.name,
				owner: getAzureOwner(url),
				exists: pr.sourceRefName != null,
				url: pr.forkSource?.repository != null ? pr.forkSource.repository.webUrl : pr.repository.webUrl,
			},
			isCrossRepository: pr.forkSource != null,
		},
		pr.isDraft,
		undefined,
		undefined,
		undefined,
		undefined,
		getAzurePullRequestReviewDecision(pr.reviewers?.filter(r => r.isRequired).map(r => r.vote ?? 0) ?? []),
		pr.reviewers.filter(r => r.vote == null || r.vote === 0).map(r => fromAzureUserWithVoteToReviewer(r)),
		pr.reviewers.filter(r => r.vote != null && r.vote !== 0).map(r => fromAzureUserWithVoteToReviewer(r)),
		pr.reviewers.map(r => fromAzureReviewerToPullRequestMember(r)),
		undefined,
		{
			id: pr.repository?.project?.id,
			name: pr.repository.project.name,
			resourceId: '', // TODO: This is a workaround until we can get the org id here.
			resourceName: orgName,
		},
	);
}

export function fromAzureWorkItem(
	workItem: WorkItem,
	provider: Provider,
	project: AzureProjectDescriptor,
	stateCategory?: AzureWorkItemStateCategory,
): Issue {
	return new Issue(
		provider,
		workItem.id.toString(),
		workItem.id.toString(),
		workItem.fields['System.Title'],
		workItem._links.html.href,
		new Date(workItem.fields['System.CreatedDate']),
		new Date(workItem.fields['System.ChangedDate']),
		isClosedAzureWorkItemStateCategory(stateCategory),
		azureWorkItemsStateCategoryToState(stateCategory),
		fromAzureUserToMember(workItem.fields['System.CreatedBy'], 'issue'),
		workItem.fields['System.AssignedTo'] != null
			? [fromAzureUserToMember(workItem.fields['System.AssignedTo'], 'issue')]
			: [],
		undefined,
		workItem.fields['Microsoft.VSTS.Common.ClosedDate']
			? new Date(workItem.fields['Microsoft.VSTS.Common.ClosedDate'])
			: undefined,
		undefined,
		workItem.fields['System.CommentCount'],
		undefined,
		workItem.fields['System.Description'],
		project,
	);
}
