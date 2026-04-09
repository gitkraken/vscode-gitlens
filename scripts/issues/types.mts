// Evidence pack schema types for the triage toolkit.
// No runtime logic — type definitions only.

export type Workflow = 'reactive' | 'audit' | 'single';

export type VerdictClass =
	| 'Close - Fixed'
	| 'Close - Duplicate'
	| 'Close - Invalid'
	| 'Close - Stale'
	| 'Request More Info'
	| 'Relabel - Bug'
	| 'Relabel - Feature Request'
	| 'Valid - Needs Triage'
	| 'Valid - Already Triaged';

export interface ReactiveQueryParams {
	since: string;
}

export interface AuditQueryParams {
	olderThan: string;
	batchSize: number;
	labelFilter: string | null;
	batchNumber: number;
}

export interface SingleQueryParams {
	issueNumbers: number[];
}

export interface RunMetadata {
	runId: string;
	timestamp: string;
	schemaVersion: string;
	workflow: Workflow;
	queryParams: ReactiveQueryParams | AuditQueryParams | SingleQueryParams;
	teamMembersRefreshedAt: string;
	changelogRefreshedAt: string;
	repo: string;
}

export interface IssueLabel {
	name: string;
	description: string;
}

export interface IssueComment {
	author: string;
	authorAssociation: string;
	body: string;
	createdAt: string;
}

export interface LinkedPr {
	number: number;
	title: string;
	state: 'open' | 'closed' | 'merged';
	mergedAt: string | null;
}

export interface ChangelogEntry {
	version: string;
	changeType: 'Added' | 'Changed' | 'Fixed' | 'Deprecated' | 'Removed';
	entry: string;
}

export interface DuplicateCandidate {
	number: number;
	title: string;
	state: 'open' | 'closed';
	closedAt: string | null;
	similarityBasis: string;
}

export interface ReactionSummary {
	thumbsUp: number;
	thumbsDown: number;
	laugh: number;
	hooray: number;
	confused: number;
	heart: number;
	rocket: number;
	eyes: number;
	total: number;
}

/** Raw issue fields from GitHub (before enrichment). */
export interface GitHubIssue {
	number: number;
	title: string;
	body: string;
	state: 'open' | 'closed';
	type: string | null;
	labels: string[];
	author: string;
	authorAssociation: string;
	assignees: string[];
	milestone: string | null;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	comments: IssueComment[];
	commentCount: number;
	linkedPrs: LinkedPr[];
	reactionGroups: Array<{ content: string; totalCount: number }>;
}

/** Enriched issue with computed evidence fields. */
export interface EnrichedIssue extends Omit<GitHubIssue, 'labels' | 'reactionGroups'> {
	reactions: ReactionSummary;
	labels: IssueLabel[];
	isTeamMember: boolean;
	changelogEntry: ChangelogEntry | null;
	lastActivityAt: string;
	duplicateCandidates: DuplicateCandidate[];
	supersessionIndicators: string[];
}

export interface EvidencePack {
	meta: RunMetadata;
	teamMembers: string[];
	issues: EnrichedIssue[];
}

export interface TriageVerdict {
	issueNumber: number;
	verdict: VerdictClass;
	confidence: 'High' | 'Medium' | 'Low';
	evidenceChecklistStatus: Record<string, boolean>;
	recommendedLabels: string[];
	recommendedActions: string[];
	requiresHumanApproval: boolean;
	evidenceSummary: string;
	canonicalDuplicateNumber: number | null;
	canonicalDuplicateStatus: string | null;
}

export interface RepositoryLabel {
	name: string;
	description: string;
}

/** Cache file wrapper with timestamp. */
export interface CacheFile<T> {
	fetchedAt: string;
	data: T;
}

/** Audit cursor for checkpoint/resume. */
export interface AuditCursor {
	endCursor: string | null;
	hasNextPage: boolean;
	batchNumber: number;
	totalFetched: number;
}
