// GitLens-neutral structural copies of the `@gitkraken/provider-apis` actionable pull-request shapes that Launchpad
// categorizes. Consumers depend on these instead of the SDK, so the SDK can later be absorbed into this package
// without touching them. Every shape here must stay value-for-value identical to its SDK original:
// `__tests__/actionablePullRequestParity.test.ts` fails to compile on any drift.
//
// The SDK's string enums are nominal, so the copies use the same strings as literal unions. An SDK value is
// assignable to its copy; the reverse needs a cast, which only `getActionablePullRequests` makes, at the boundary.

/** Same values as provider-apis' `GitBuildStatusState`. */
export const ActionablePullRequestBuildStatusState = {
	ActionRequired: 'ACTION_REQUIRED',
	Cancelled: 'CANCELLED',
	Error: 'ERROR',
	Failed: 'FAILED',
	Pending: 'PENDING',
	Running: 'RUNNING',
	Skipped: 'SKIPPED',
	Success: 'SUCCESS',
	Warning: 'WARNING',
	OptionalActionRequired: 'OPTIONAL_ACTION_REQUIRED',
} as const;
export type ActionablePullRequestBuildStatusState =
	(typeof ActionablePullRequestBuildStatusState)[keyof typeof ActionablePullRequestBuildStatusState];

/** Same values as provider-apis' `GitPullRequestReviewState`. */
export const ActionablePullRequestReviewState = {
	Approved: 'APPROVED',
	ChangesRequested: 'CHANGES_REQUESTED',
	Commented: 'COMMENTED',
	ReviewRequested: 'REVIEW_REQUESTED',
} as const;
export type ActionablePullRequestReviewState =
	(typeof ActionablePullRequestReviewState)[keyof typeof ActionablePullRequestReviewState];

/** Same values as provider-apis' `GitPullRequestState`. */
export type ActionablePullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';

/** Same values as provider-apis' `GitPullRequestMergeableState`. */
export type ActionablePullRequestMergeableState =
	| 'BEHIND'
	| 'BLOCKED'
	| 'CONFLICTS'
	| 'FAILING_CHECKS'
	| 'MERGEABLE'
	| 'UNKNOWN'
	| 'UNKNOWN_AND_BLOCKED'
	| 'UNSTABLE';

/** Same values as provider-apis' `GitBuildStatusStage`. */
export type ActionablePullRequestBuildStatusStage = 'build' | 'production' | 'staging' | 'test';

/** Same values as provider-apis' `PullRequestActionCategory`. */
export type ActionablePullRequestCategory =
	| 'readyToMerge'
	| 'unassignedReviewers'
	| 'failingCI'
	| 'conflicts'
	| 'needsMyReview'
	| 'changesRequested'
	| 'reviewerCommented'
	| 'waitingForReview'
	| 'draft'
	| 'other';

/** Copy of provider-apis' `Account`. */
export interface ActionablePullRequestAccount {
	id: string;
	graphQLId?: string;
	username: string | null;
	url: string | null;
	name: string | null;
	email: string | null;
	avatarUrl: string | null;
}

/** Copy of provider-apis' `GitRefWithOID`. */
export interface ActionablePullRequestRef {
	name: string;
	oid: string | null;
}

/** Copy of provider-apis' `GitRepositoryRemoteInfo`. */
export interface ActionablePullRequestRemoteInfo {
	cloneUrlHTTPS: string;
	cloneUrlSSH: string;
}

/** Copy of provider-apis' `GitBuildStatus`. */
export interface ActionablePullRequestBuildStatus {
	completedAt: Date | null;
	description: string | null;
	name: string | null;
	state: ActionablePullRequestBuildStatusState | null;
	stage: ActionablePullRequestBuildStatusStage | null;
	startedAt: Date | null;
	url: string;
}

/** Copy of provider-apis' `GitMilestone`. */
export interface ActionablePullRequestMilestone {
	id: string;
	graphQLId?: string;
	number: number;
	title: string;
	description: string | null;
	isOpen: boolean;
	url: string;
	startDate: Date | null;
	dueDate: Date | null;
}

/** Copy of provider-apis' `GitLabel`. */
export interface ActionablePullRequestLabel {
	color: string | null;
	description: string | null;
	graphQLId?: string;
	id: string | null;
	name: string;
}

/** Copy of provider-apis' `GitPullRequestStackMembership`: a pull request's place within its stack. */
export interface ActionablePullRequestStackMembership {
	/** Identifies the stack within its repository; pair it with the repository to key a stack globally. */
	number: number;
	graphQLId?: string;
	/** The number of pull requests in the stack as the provider reports it, which may exceed how many a read holds. */
	size: number;
	/** The name of the stack's trunk, which is not any member's own base branch. */
	baseRefName: string;
	/** The 1-based position in the stack, where 1 is the bottom and `size` is the top. */
	position: number;
	/** The node ID of this pull request's entry in the stack. */
	entryGraphQLId: string;
}

/** Copy of provider-apis' `PullRequestWithUniqueID` (its `GitPullRequest` plus the entity-identifier `uuid`). */
export interface ActionablePullRequestInput {
	id: string;
	graphQLId?: string;
	number: number;
	title: string;
	description: string | null;
	url: string | null;
	state: ActionablePullRequestState;
	isDraft: boolean;
	createdDate: Date;
	updatedDate: Date;
	closedDate: Date | null;
	mergedDate: Date | null;
	baseRef: ActionablePullRequestRef | null;
	headRef: ActionablePullRequestRef | null;
	commentCount: number | null;
	upvoteCount: number | null;
	commitCount: number | null;
	fileCount: number | null;
	additions: number | null;
	deletions: number | null;
	author: ActionablePullRequestAccount | null;
	assignees: ActionablePullRequestAccount[] | null;
	reviews:
		| {
				reviewer: ActionablePullRequestAccount;
				state: ActionablePullRequestReviewState;
		  }[]
		| null;
	reviewDecision: ActionablePullRequestReviewState | null;
	isCrossRepository: boolean;
	repository: {
		id: string;
		graphQLId?: string;
		name: string;
		project?: string;
		owner: {
			login: string;
		};
		remoteInfo: ActionablePullRequestRemoteInfo | null;
	};
	headRepository: {
		id: string;
		graphQLId?: string;
		name: string;
		project?: string;
		owner: {
			login: string;
		};
		remoteInfo: ActionablePullRequestRemoteInfo | null;
		isFork?: boolean;
	} | null;
	headCommit: {
		buildStatuses: ActionablePullRequestBuildStatus[] | null;
	} | null;
	mergeableState: ActionablePullRequestMergeableState;
	milestone?: ActionablePullRequestMilestone | null;
	labels?: ActionablePullRequestLabel[];
	permissions: {
		canMerge: boolean;
		canMergeAndBypassProtections: boolean;
	} | null;
	version?: number;
	/**
	 * Its stacked-pull-request membership: `undefined` when stacking isn't knowable (every provider but GitHub, or a
	 * read that had to drop the field), `null` when the host reported it isn't in a stack.
	 */
	stack?: ActionablePullRequestStackMembership | null;
	uuid: string;
}

/** Copy of provider-apis' `EnrichedItem`: a pin or snooze stored against an entity. */
export interface ActionablePullRequestEnrichedItem {
	id: string;
	userId?: string;
	type: 'pin' | 'snooze';
	provider: 'azure' | 'bitbucket' | 'github' | 'gitlab' | 'jira' | 'linear' | 'trello' | 'gitkraken';
	entityType: 'issue' | 'pr';
	entityId: string;
	entityUrl: string;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
}

/** Copy of provider-apis' `EnrichedItemsByUniqueId`, keyed by an input's `uuid`. */
export interface ActionablePullRequestEnrichedItems {
	[uuid: string]: ActionablePullRequestEnrichedItem[];
}

/** What categorization adds to an {@link ActionablePullRequestInput} (provider-apis' `ActionablePullRequest` minus its input). */
export interface ActionablePullRequestFields {
	suggestedActionCategory: ActionablePullRequestCategory;
	priority: number;
	viewer: {
		canMerge: boolean;
		isAuthor: boolean;
		isAssignee: boolean;
		isReviewer: boolean;
		shouldMerge: boolean;
		shouldAssignReviewer: boolean;
		waitingOnReviews: boolean;
		shouldReview: boolean;
		pinned?: boolean;
		snoozed?: boolean;
		enrichedItems?: ActionablePullRequestEnrichedItem[];
	};
	failingCI: boolean;
	hasConflicts: boolean;
	changeRequestReviewCount: number;
	codeSuggestionsCount: number;
	commentReviewCount: number;
	approvalReviewCount: number;
}

/** Copy of provider-apis' `ActionablePullRequest`. */
export type ActionablePullRequest = ActionablePullRequestInput & ActionablePullRequestFields;
