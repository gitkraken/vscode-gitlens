export type ReleaseTag = { tag: string; date: string };
export type IssueKind = 'bug' | 'not-bug' | 'unclassified';
export type BugStatus =
	| 'introduced'
	| 'not-yet-fixed'
	| 'external'
	| 'not-a-gitlens-bug'
	| 'needs-review'
	| 'never-shipped';
export type BugTarget = 'excluded' | 'open' | 'closed-fixed';
export type IssueRow = {
	number: number;
	title: string;
	url: string;
	author: string;
	isOrg: boolean;
	createdAt: string;
	state: 'open' | 'closed';
	stateReason: string | null;
	closedAt: string | null;
	issueType: string | null;
	kind: IssueKind;
	kindSource: 'type' | 'investigated';
	status: BugStatus | null;
	introducedIn: string | null;
	fixedIn: string | null;
	introducingCommit: string | null;
	fixCommit: string | null;
	traces: number;
	refreshedAt: string;
};
export type GhIssue = {
	number: number;
	title: string;
	html_url: string;
	user: { login: string };
	created_at: string;
	state: 'open' | 'closed';
	state_reason: string | null;
	closed_at: string | null;
	type: { name: string } | null;
	pull_request?: unknown;
};
export type ChangeFingerprint = { patchId: string | undefined; files: string[] };
export type TraceClassification = 'introduced' | 'external' | 'not-a-gitlens-bug';
export type TraceConfidence = 'high' | 'medium' | 'low';
export type TraceOutcome = {
	classification: TraceClassification;
	confidence: TraceConfidence;
	commit: string | null;
	introducedIn: string | null;
	shipped: string | null;
};
export type Settlement =
	| { outcome: 'tie-break' }
	| { outcome: 'needs-review' }
	| { outcome: 'settled'; status: BugStatus; introducedIn: string | null; introducingCommit: string | null };

const stableTagPattern = /^v\d+\.\d+\.\d+$/;
const notBugTypes = new Set(['Feature', 'Enhancement', 'Debt', 'Task', 'Exploration']);
const dismissedReasons = new Set(['duplicate', 'not_planned']);

function byDate(a: ReleaseTag, b: ReleaseTag): number {
	return Date.parse(a.date) - Date.parse(b.date);
}

export function parseTags(forEachRefOutput: string): ReleaseTag[] {
	const tags: ReleaseTag[] = [];
	for (const line of forEachRefOutput.split('\n')) {
		const [tag, date] = line.trim().split(/\s+/);
		if (tag == null || date == null || !stableTagPattern.test(tag)) continue;

		tags.push({ tag: tag, date: date });
	}

	return tags.sort(byDate);
}

export function kindFromType(issueType: string | null, isOrg: boolean): IssueKind | 'needs-reading' {
	if (issueType === 'Bug') return 'bug';

	if (issueType != null && notBugTypes.has(issueType)) return 'not-bug';

	return isOrg ? 'unclassified' : 'needs-reading';
}

export function decide(issue: GhIssue, existing: IssueRow | undefined): 'new' | 'unsettled' | 'settled' {
	if (existing == null) return 'new';

	const changed =
		issue.state !== existing.state ||
		issue.state_reason !== existing.stateReason ||
		(issue.type?.name ?? null) !== existing.issueType;
	const unclassifiedCommunity = !existing.isOrg && existing.kind === 'unclassified';
	const untraced =
		existing.status == null &&
		bugTarget({ state: existing.state, state_reason: existing.stateReason }, existing.kind) !== 'excluded';
	return changed || unclassifiedCommunity || untraced ? 'unsettled' : 'settled';
}

export function bugTarget(issue: Pick<GhIssue, 'state' | 'state_reason'>, kind: IssueKind): BugTarget {
	if (kind !== 'bug' || (issue.state_reason != null && dismissedReasons.has(issue.state_reason))) return 'excluded';

	return issue.state === 'open' ? 'open' : 'closed-fixed';
}

export function fixCommitPattern(n: number): string {
	return `(fix(es|ed)?|close[sd]?|resolve[sd]?) #${n}([^0-9]|$)`;
}

export function isSameChange(original: ChangeFingerprint, candidate: ChangeFingerprint): boolean {
	if (original.patchId != null && original.patchId === candidate.patchId) return true;

	const files = new Set(original.files.filter(file => file !== 'CHANGELOG.md'));
	return candidate.files.some(file => files.has(file));
}

export function earliestTag(containing: string[], tags: ReleaseTag[]): string | null {
	const present = new Set(containing);
	return tags.filter(tag => present.has(tag.tag)).sort(byDate)[0]?.tag ?? null;
}

export function containingAll(containingEach: string[][]): string[] {
	if (containingEach.length === 0) return [];

	const [first, ...rest] = containingEach;
	return first.filter(tag => rest.every(containing => containing.includes(tag)));
}

export function shippedIn(introContaining: string[], fixedContaining: string[], tags: ReleaseTag[]): string | null {
	const fixed = new Set(fixedContaining);
	return earliestTag(
		introContaining.filter(tag => !fixed.has(tag)),
		tags,
	);
}

export function reattribute(
	row: IssueRow,
	introContaining: string[],
	fixedContaining: string[],
	tags: ReleaseTag[],
): IssueRow | undefined {
	const shipped = shippedIn(introContaining, fixedContaining, tags);
	const fixedIn = earliestTag(fixedContaining, tags);
	const status: BugStatus = shipped != null ? 'introduced' : 'never-shipped';
	if (row.status === status && row.introducedIn === shipped && row.fixedIn === fixedIn) return undefined;

	return { ...row, status: status, introducedIn: shipped, fixedIn: fixedIn };
}

function agreementKey(trace: TraceOutcome): string {
	if (trace.classification !== 'introduced') return trace.classification;

	return `introduced:${trace.introducedIn ?? ''}:${trace.shipped ?? ''}`;
}

function isWeak(trace: TraceOutcome): boolean {
	return trace.confidence === 'low' || (trace.classification === 'introduced' && trace.commit == null);
}

export function settleTraces(traces: TraceOutcome[]): Settlement {
	if (traces.length < 2 || traces.length > 3) {
		throw new Error(`Expected 2 or 3 traces, got ${traces.length}`);
	}

	const groups = new Map<string, TraceOutcome[]>();
	for (const trace of traces) {
		const key = agreementKey(trace);
		groups.set(key, [...(groups.get(key) ?? []), trace]);
	}

	const winners = [...groups.values()].find(group => group.length >= 2);
	if (winners == null) return traces.length === 2 ? { outcome: 'tie-break' } : { outcome: 'needs-review' };

	if (winners.some(isWeak)) return { outcome: 'needs-review' };

	const [winner] = winners;
	if (winner.classification !== 'introduced') {
		return { outcome: 'settled', status: winner.classification, introducedIn: null, introducingCommit: null };
	}

	return {
		outcome: 'settled',
		status: winner.shipped != null ? 'introduced' : 'never-shipped',
		introducedIn: winner.shipped,
		introducingCommit: winner.commit,
	};
}
