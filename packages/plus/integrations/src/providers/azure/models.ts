import type { IssueIteration, IssueMember } from '@gitlens/git/models/issue.js';
import { Issue, RepositoryAccessLevel } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequestState } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestMember, PullRequestReviewer } from '@gitlens/git/models/pullRequest.js';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
} from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { ProviderAccount, ProviderIssue } from '../models.js';

const vstsHostnameSuffix = '.visualstudio.com';

export interface AzureRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
	project?: string;
	virtualDirectory?: string;
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
		'System.IterationPath'?: string;
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

export interface AzureRepositoryReference {
	id: string;
	name: string;
	url: string;
	remoteUrl?: string;
}

export interface AzureRepository extends AzureRepositoryReference {
	project: AzureProject;
	size: number;
	remoteUrl: string;
	sshUrl: string;
	webUrl: string;
	isDisabled: boolean;
	isInMaintenance: boolean;
}

export interface AzurePullRequestRepository extends AzureRepositoryReference {
	project: Pick<AzureProject, 'id' | 'name'>;
}

/** The URL fields of a repository response — all the fork lookup reads, and all an older `api-version` promises. */
export type AzureRepositoryUrls = Partial<Pick<AzureRepository, 'webUrl' | 'remoteUrl'>>;

/** The `GET .../_apis/git/repositories/{repositoryId or name}` response, adding fork/default-branch fields to {@link AzureRepository}. */
export interface AzureRepositoryWithMetadata extends AzureRepository {
	/** Fully-qualified ref, e.g. `refs/heads/main`. */
	defaultBranch?: string;
	isFork?: boolean;
	parentRepository?: {
		id: string;
		name?: string;
		project?: { id: string; name: string };
	};
}

export interface AzureGitUser {
	date?: string;
	email?: string;
	imageUrl?: string;
	name: string;
}

export interface AzureGitCommitRef {
	commitId: string;
	url: string;
}

export interface AzureGitCommit {
	_links: {
		changes: AzureLink;
		repository: AzureLink;
		self: AzureLink;
		web: AzureLink;
	};
	author: AzureGitUser;
	comment: string;
	commentTruncated?: boolean;
	commitId: string;
	commitTooManyChanges?: boolean;
	committer: AzureGitUser;
	parents: string[];
	push: {
		date: string;
		pushedBy: AzureUser;
		pushId: number;
	};
	remoteUrl: string;
	statuses?: AzureGitStatus[];
	treeId: string;
	url: string;
	workItems?: AzureResourceRef[];
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
	repository: AzureRepositoryReference;
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
	repository: AzurePullRequestRepository;
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

export function getAzureDevOpsOwner(url: URL): string {
	return url.pathname.split('/')[1];
}
export function isVsts(domain: string): boolean {
	return domain.endsWith(vstsHostnameSuffix);
}

/**
 * `baseUrl` and `owner` are the authoritative prefix used for the API request. The payload URL cannot supply that
 * prefix safely because it may address the repository by id or name an untrusted host.
 */
function getAzureRepositoryWebUrl(baseUrl: string, owner: string, projectName: string, repoName: string): string {
	const repoPath = `${encodeURIComponent(owner)}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}`;
	return `${baseUrl.replace(/\/+$/, '')}/${repoPath}`;
}

export function getAzurePullRequestWebUrl(pr: AzurePullRequest, baseUrl: string, owner: string): string {
	const repoUrl = getAzureRepositoryWebUrl(baseUrl, owner, pr.repository.project.name, pr.repository.name);
	return `${repoUrl}/pullrequest/${pr.pullRequestId}`;
}

/**
 * Whether `url` and `expected` are the two cloud spellings of one organization: a cloud organization answers on both
 * `dev.azure.com/{owner}` and the legacy `{owner}.visualstudio.com`, so those name the same host. Anything else is
 * somewhere we didn't ask.
 */
function isSameAzureCloudOrganization(url: URL, expected: URL, expectedOwner: string): boolean {
	if (url.protocol !== expected.protocol) return false;

	const owner = expectedOwner.toLowerCase();
	if (expected.hostname !== 'dev.azure.com' && !isVsts(expected.hostname)) return false;

	if (url.hostname === 'dev.azure.com') return getAzureDevOpsOwner(url).toLowerCase() === owner;

	return url.hostname === `${owner}${vstsHostnameSuffix}`;
}

/**
 * Whether `url` sits under the collection the integration is configured to talk to — `{expectedUrl}/{expectedOwner}`.
 * A matching origin says nothing on its own: Azure organizations and self-hosted collections are path segments.
 */
function isUnderAzureCollection(url: URL, expected: URL, expectedOwner: string): boolean {
	const base = expected.pathname.replace(/\/+$/, '');
	const prefix = `${base}/${encodeURIComponent(expectedOwner)}/`.toLowerCase();
	return `${url.pathname}/`.toLowerCase().startsWith(prefix);
}

/**
 * Restricts a provider-supplied repository URL to the integration's collection and removes credentials, query, and
 * fragment before a consumer can use it as a git remote. Takes the value as the payloads carry it — every one of
 * these URLs is optional — so a caller never has to spell the absent case itself.
 */
export function sanitizeAzureRepositoryUrl(
	value: string | undefined,
	expectedUrl: string,
	expectedOwner: string,
): string | undefined {
	if (value == null) return undefined;

	let expected: URL;
	let url: URL;
	try {
		expected = new URL(expectedUrl);
		url = new URL(value);
	} catch {
		return undefined;
	}

	if (expected.protocol !== 'https:' && expected.protocol !== 'http:') return undefined;
	if (!expectedOwner) return undefined;

	if (url.origin === expected.origin) {
		if (!isUnderAzureCollection(url, expected, expectedOwner)) return undefined;
	} else if (!isSameAzureCloudOrganization(url, expected, expectedOwner)) {
		return undefined;
	}

	url.username = '';
	url.password = '';
	url.search = '';
	url.hash = '';
	return url.toString();
}

/**
 * The clone URL the payload carries for a repository, restricted to the integration's collection and then
 * cross-checked against the repository that payload names.
 *
 * The collection check alone is not enough for a URL that is READ rather than built. Every other repository URL the
 * model reports is built from the authoritative prefix, so the payload cannot move it; this one cannot be built,
 * because Azure spells a repository for git the same way it spells it for the web only by convention. A URL under
 * the right collection may still name a DIFFERENT repository in it, which would leave `cloneHttps` describing one
 * repository while `url` describes another.
 *
 * Azure ends a clone URL with `_git/{repo}` on every host style — including the short `{owner}/_git/{repo}` form it
 * uses when a repository carries its project's name, and the legacy `{owner}.visualstudio.com` spelling that has no
 * organization segment at all — so the repository name is the one part comparable across all of them. A same-named
 * repository in another project of the same organization is the single substitution this cannot catch.
 */
function getAzureRepositoryCloneUrl(
	repository: AzureRepositoryReference,
	baseUrl: string,
	owner: string,
): string | undefined {
	const sanitized = sanitizeAzureRepositoryUrl(repository.remoteUrl, baseUrl, owner);
	if (sanitized == null) return undefined;

	// Safe to parse: `sanitizeAzureRepositoryUrl` returns what it already parsed.
	const segments = new URL(sanitized).pathname.split('/').filter(s => s.length > 0);
	const name = segments.pop();
	if (name == null || segments.pop() !== '_git') return undefined;

	let decoded: string;
	try {
		decoded = decodeURIComponent(name);
	} catch {
		return undefined;
	}

	// Azure resolves project and repository names case-insensitively, so comparing them any other way would refuse a
	// URL the provider considers the same one.
	return decoded.toLowerCase() === repository.name.toLowerCase() ? sanitized : undefined;
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
			username: reviewer.uniqueName,
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
		username: reviewer.uniqueName,
		url: reviewer.url,
	};
}

export function normalizeAzureBranchName(branchName: string): string {
	return branchName.startsWith('refs/heads/') ? branchName.replace('refs/heads/', '') : branchName;
}

function fromAzureUserToMember(user: AzureUser, type: 'issue'): IssueMember;
function fromAzureUserToMember(user: AzureUser, type: 'pullRequest'): PullRequestMember;
function fromAzureUserToMember(user: AzureUser, _type: 'issue' | 'pullRequest'): PullRequestMember | IssueMember {
	return {
		avatarUrl: user.imageUrl,
		id: user.id,
		name: user.displayName,
		username: user.uniqueName,
		url: user.url,
	};
}

/**
 * The URLs of a cross-repository pull request's fork, resolved by a lookup because the pull request payload embeds
 * only an abbreviated reference to it: `url` is the URL the head ref reports — the fork's web URL, or its clone URL
 * when the response carries no web URL — and `cloneHttps` its HTTPS clone URL.
 *
 * A fork that resolves neither is reported as no fork at all rather than as an object with nothing in it, so `url`
 * is always present here; `cloneHttps` alone is best-effort, and is absent when the response omits it or its URL
 * sits outside the integration's collection.
 */
export interface AzureForkRepositoryUrls {
	url: string;
	cloneHttps: string | undefined;
}

/**
 * `baseUrl` and `owner` are the prefix the pull request was read through; every URL the model reports is built from
 * them. The required `forkRepositoryUrls` argument makes each call site resolve the best-effort fork URLs explicitly.
 */
export function fromAzurePullRequest(
	pr: AzurePullRequest,
	provider: Provider,
	owner: string,
	baseUrl: string,
	forkRepositoryUrls: AzureForkRepositoryUrls | undefined,
): PullRequest {
	const baseRepositoryUrl = getAzureRepositoryWebUrl(baseUrl, owner, pr.repository.project.name, pr.repository.name);
	const baseCloneHttps = getAzureRepositoryCloneUrl(pr.repository, baseUrl, owner);

	const forkRepository = pr.forkSource?.repository;
	const headRepositoryUrl = forkRepository == null ? baseRepositoryUrl : forkRepositoryUrls?.url;
	const headCloneHttps = forkRepository == null ? baseCloneHttps : forkRepositoryUrls?.cloneHttps;

	return new PullRequest(
		provider,
		fromAzureUserToMember(pr.createdBy, 'pullRequest'),
		pr.pullRequestId.toString(),
		pr.pullRequestId.toString(),
		pr.title,
		getAzurePullRequestWebUrl(pr, baseUrl, owner),
		{
			owner: owner,
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
				owner: owner,
				exists: pr.targetRefName != null,
				url: baseRepositoryUrl,
				cloneHttps: baseCloneHttps,
			},
			head: {
				branch: pr.sourceRefName ? normalizeAzureBranchName(pr.sourceRefName) : '',
				sha: pr.lastMergeSourceCommit?.commitId ?? '',
				repo: forkRepository?.name ?? pr.repository.name,
				owner: owner,
				exists: pr.sourceRefName != null,
				url: headRepositoryUrl,
				cloneHttps: headCloneHttps,
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
			resourceName: owner,
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
		undefined,
		undefined,
		undefined,
		undefined,
		toWorkItemIterations(workItem.fields['System.IterationPath']),
	);
}

/**
 * Azure reports the iteration as a backslash-delimited path rooted at the project. The project root is its default
 * for a work item with no sprint, so only a nested path names one; the path is the identity because Azure supplies
 * no iteration id here.
 *
 * Mirrors `normalizeIteration` in provider-apis so the same work item yields the same identity whether it is read
 * here or through the SDK. That contract keeps the path **verbatim** — it is what the iteration is matched back by,
 * so it is deliberately not trimmed — and trims only the display name.
 */
function toWorkItemIterations(path: string | undefined): IssueIteration[] | undefined {
	if (!path) return undefined;

	const segments = path.split('\\');
	if (segments.length < 2) return undefined;

	const name = segments.at(-1)?.trim();
	return name ? [{ id: path, name: name }] : undefined;
}

/**
 * A work item as `GET …/_apis/wit/workitems/{id}?$expand=Links` returns it. Loosely typed because
 * {@link fromAzureWorkItemToProviderIssue} checks every field it reads, as provider-apis does.
 */
export interface AzureWorkItemResponse {
	id?: unknown;
	fields?: Record<string, unknown>;
	_links?: { html?: { href?: unknown } };
}

/**
 * Converts a work item exactly as provider-apis' `getIssuesForAzureProject` converts each row it reads, so a work
 * item read by id reaches `toIssueShape` identical to the list read's row for it. provider-apis exports neither
 * that converter nor a single work item read, so this mirrors it field for field; the batch issue tests compare
 * the two, so a provider-apis change that this misses fails there.
 *
 * `undefined` for a work item the SDK would skip: no positive integer id, no title, or no valid created date.
 * `state.name` is the raw `System.State`, as on every list read here, which passes the SDK no state-name map.
 */
export function fromAzureWorkItemToProviderIssue(
	workItem: AzureWorkItemResponse,
	namespace: string,
	project: string,
): ProviderIssue | undefined {
	const fields = workItem.fields;
	const id = workItem.id;
	const title = fields?.['System.Title'];
	const createdDate = parseAzureWorkItemDate(fields?.['System.CreatedDate']);
	if (
		fields == null ||
		typeof id !== 'number' ||
		!Number.isSafeInteger(id) ||
		id <= 0 ||
		typeof title !== 'string' ||
		!title.trim() ||
		createdDate == null
	) {
		return undefined;
	}

	const assignee = fromAzureWorkItemIdentity(fields['System.AssignedTo']);
	const commentCount = fields['System.CommentCount'];
	const url = workItem._links?.html?.href;
	const tags = fields['System.Tags'];
	const state = fields['System.State'];
	const type = fields['System.WorkItemType'];
	const description = fields['System.Description'];
	return {
		id: id.toString(),
		number: id.toString(),
		title: title,
		commentCount: typeof commentCount === 'number' && Number.isFinite(commentCount) ? commentCount : null,
		author: fromAzureWorkItemIdentity(fields['System.CreatedBy']),
		closedDate: parseAzureWorkItemDate(fields['Microsoft.VSTS.Common.ClosedDate']),
		createdDate: createdDate,
		updatedDate: parseAzureWorkItemDate(fields['System.ChangedDate']),
		url: typeof url === 'string' ? url : null,
		assignees: assignee != null ? [assignee] : [],
		description: typeof description === 'string' ? description : null,
		state: typeof state === 'string' && state ? { name: state, color: null } : null,
		type: typeof type === 'string' ? type : null,
		iteration: toAzureWorkItemIteration(fields['System.IterationPath']),
		repository: null,
		project: { namespace: namespace, name: project, resourceId: null, key: null, id: null },
		upvoteCount: 0,
		labels: (typeof tags === 'string' ? tags.split(';') : []).map(tag => ({
			color: null,
			description: null,
			id: null,
			name: tag.trim(),
		})),
	};
}

/** An identity field, as provider-apis maps it: `name` from `uniqueName`, `username` from `displayName`. */
function fromAzureWorkItemIdentity(value: unknown): ProviderAccount | null {
	const identity = value as
		| { id?: unknown; uniqueName?: unknown; displayName?: unknown; _links?: { avatar?: { href?: unknown } } }
		| null
		| undefined;
	if (typeof identity?.id !== 'string' || !identity.id.trim()) return null;

	const avatarUrl = identity._links?.avatar?.href;
	return {
		avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : null,
		email: null,
		id: identity.id,
		name: typeof identity.uniqueName === 'string' ? identity.uniqueName : null,
		username: typeof identity.displayName === 'string' ? identity.displayName : null,
		url: null,
	};
}

/** Only a UTC ISO timestamp naming a real calendar date and time, as provider-apis accepts; anything else is `null`. */
function parseAzureWorkItemDate(value: unknown): Date | null {
	if (typeof value !== 'string') return null;

	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?Z$/.exec(value);
	if (match == null) return null;

	const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
	const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59) {
		return null;
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** The SDK's `iteration`: only a nested path names a sprint; the project root is a work item's default. */
function toAzureWorkItemIteration(path: unknown): ProviderIssue['iteration'] {
	if (typeof path !== 'string' || !path) return undefined;

	const segments = path.split('\\');
	if (segments.length < 2) return undefined;

	const name = segments.at(-1)?.trim();
	return name ? { path: path, name: name } : undefined;
}
