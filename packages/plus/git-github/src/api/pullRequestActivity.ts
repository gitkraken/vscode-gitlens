import type {
	PullRequestActivityAuthor,
	PullRequestActivityItem,
	PullRequestActivityPage,
} from '@gitlens/git/models/pullRequestActivity.js';
import { base64, fromBase64ToString } from '@gitlens/utils/base64.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { AliasedGraphql, GraphqlAliasError } from './aliasedQuery.js';
import { getAliasErrorVerdict } from './aliasedQuery.js';

export interface GitHubPullRequestActivityCursor {
	readonly t: string;
	readonly ids: readonly string[];
}

export interface GitHubPullRequestActivityTarget {
	readonly owner: string;
	readonly repo: string;
	readonly number: number;
	readonly cursor?: GitHubPullRequestActivityCursor;
}

type ActivityActorNode = { __typename?: string; login?: string | null; url?: string | null } | null;

type ActivityCommentFields = {
	id: string;
	url: string;
	body?: string | null;
	publishedAt?: string | null;
	createdAt: string;
	viewerDidAuthor?: boolean | null;
	isMinimized?: boolean | null;
	author?: ActivityActorNode;
};

type ActivityReviewCommentNode = ActivityCommentFields & {
	path: string;
	line?: number | null;
	startLine?: number | null;
	originalLine?: number | null;
	outdated?: boolean | null;
	replyTo?: { id: string } | null;
	commit?: { oid: string } | null;
};

type ActivityTimelineNode =
	| (ActivityCommentFields & { __typename: 'IssueComment' })
	| (ActivityCommentFields & {
			__typename: 'PullRequestReview';
			state: string;
			submittedAt?: string | null;
			commit?: { oid: string } | null;
			comments?: { totalCount: number; nodes?: (ActivityReviewCommentNode | null)[] | null } | null;
	  })
	| { __typename: string; id?: string };

type ActivityNode = Extract<ActivityTimelineNode, { __typename: 'IssueComment' | 'PullRequestReview' }>;

type ActivityTimelineItems = {
	pageInfo: ActivityPageInfo;
	nodes?: (ActivityTimelineNode | null)[] | null;
};

type ActivityPageInfo = { hasNextPage: boolean; endCursor?: string | null };

type PullRequestActivityResponse = Record<
	string,
	{ pullRequest?: { createdAt: string; timelineItems: ActivityTimelineItems } | null } | null | undefined
>;

type ActivityQueryTarget = GitHubPullRequestActivityTarget & { readonly after?: string };

type TimelineEntry = { node: ActivityNode; publishedAt: Date; second: number; createdSecond: number };

type Timeline = { createdAt: string; entries: readonly TimelineEntry[]; pageInfo: ActivityPageInfo };

type StaleTimeline = {
	index: number;
	target: GitHubPullRequestActivityTarget & { readonly cursor: GitHubPullRequestActivityCursor };
	timeline: Timeline;
};

const maxPageSize = 100;
const maxFollowPages = 4;
const reviewCommentsPageSize = 20;

const activityItemTypes = 'PULL_REQUEST_REVIEW, ISSUE_COMMENT';
const actorFields = 'author { __typename login url }';
const reviewCommentFields = `id url body path line startLine originalLine outdated publishedAt createdAt viewerDidAuthor isMinimized replyTo { id } commit { oid } ${actorFields}`;
const timelineNodeFields = `pageInfo { hasNextPage endCursor }
						nodes { __typename
							... on IssueComment { id url body publishedAt createdAt viewerDidAuthor isMinimized ${actorFields} }
							... on PullRequestReview { id url body state publishedAt submittedAt createdAt viewerDidAuthor isMinimized commit { oid }
								${actorFields}
								comments(first: ${reviewCommentsPageSize}) { totalCount nodes { ${reviewCommentFields} } } }
						}`;

export async function readGitHubPullRequestActivity(
	graphql: AliasedGraphql,
	targets: readonly GitHubPullRequestActivityTarget[],
	limit: number,
	scope: ScopedLogger | undefined,
): Promise<PromiseSettledResult<PullRequestActivityPage | undefined>[]> {
	let timelines: PromiseSettledResult<Timeline | undefined>[];
	try {
		timelines = await readTimelines(graphql, targets, limit, scope);
	} catch (ex) {
		if (isCancellationError(ex)) throw ex;

		scope?.warn(`failed to read pull request activity; ex=${ex}`);
		return targets.map((): PromiseRejectedResult => ({ status: 'rejected', reason: ex }));
	}

	return targets.map((target, i): PromiseSettledResult<PullRequestActivityPage | undefined> => {
		const slot = timelines[i];
		if (slot.status === 'rejected') return slot;
		if (slot.value == null) return { status: 'fulfilled', value: undefined };

		try {
			return { status: 'fulfilled', value: toActivityPage(slot.value, target.cursor, limit) };
		} catch (ex) {
			scope?.warn(`failed to map pull request activity; ${describeTarget(target)}, ex=${ex}`);
			return { status: 'rejected', reason: ex };
		}
	});
}

async function readTimelines(
	graphql: AliasedGraphql,
	targets: readonly GitHubPullRequestActivityTarget[],
	limit: number,
	scope: ScopedLogger | undefined,
): Promise<PromiseSettledResult<Timeline | undefined>[]> {
	const { data, errors } = await queryActivity(graphql, targets, limit);
	const timelines = targets.map((target, i): PromiseSettledResult<Timeline | undefined> => {
		const alias = `p${i}`;
		const node = data[alias]?.pullRequest;
		const verdict = getAliasErrorVerdict(errors, alias, node);
		if (verdict != null && verdict !== 'absent') return verdict;
		if (node == null) return { status: 'fulfilled', value: undefined };

		try {
			return {
				status: 'fulfilled',
				value: {
					createdAt: node.createdAt,
					entries: toTimelineEntries(node.timelineItems),
					pageInfo: node.timelineItems.pageInfo,
				},
			};
		} catch (ex) {
			scope?.warn(`failed to map pull request activity; ${describeTarget(target)}, ex=${ex}`);
			return { status: 'rejected', reason: ex };
		}
	});

	const stale = targets.flatMap((target, i): StaleTimeline[] => {
		const slot = timelines[i];
		const cursor = target.cursor;
		return cursor != null && slot.status === 'fulfilled' && slot.value != null
			? [{ index: i, target: { ...target, cursor: cursor }, timeline: slot.value }]
			: [];
	});
	const followed = await readPastStalePages(graphql, stale, limit, scope);
	stale.forEach((s, i) => {
		timelines[s.index] = { status: 'fulfilled', value: followed[i] };
	});
	return timelines;
}

async function queryActivity(
	graphql: AliasedGraphql,
	targets: readonly ActivityQueryTarget[],
	limit: number,
): Promise<{ readonly data: PullRequestActivityResponse; readonly errors: readonly GraphqlAliasError[] }> {
	const variables: Record<string, unknown> = {};
	targets.forEach((target, i) => {
		variables[`o${i}`] = target.owner;
		variables[`n${i}`] = target.repo;
		variables[`k${i}`] = target.number;
		if (target.cursor != null) {
			variables[`s${i}`] = activitySince(target.cursor);
			if (target.after != null) {
				variables[`a${i}`] = target.after;
			}
		}
	});

	const rsp = await graphql<PullRequestActivityResponse>(activityQuery(targets, limit), variables);
	if (rsp?.data == null) throw new Error('GitHub returned no data for the pull request activity');

	return rsp;
}

async function readPastStalePages(
	graphql: AliasedGraphql,
	stale: readonly StaleTimeline[],
	limit: number,
	scope: ScopedLogger | undefined,
): Promise<Timeline[]> {
	const timelines = stale.map(s => s.timeline);
	let due = stale.flatMap((s, index) => followFrom(index, s.timeline, s.target.cursor));
	for (let round = 0; round < maxFollowPages && due.length !== 0; round++) {
		let answer: { readonly data: PullRequestActivityResponse; readonly errors: readonly GraphqlAliasError[] };
		try {
			answer = await queryActivity(
				graphql,
				due.map(d => ({ ...stale[d.index].target, after: d.after })),
				limit,
			);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			scope?.warn(`failed to read past pull request activity pages; ex=${ex}`);
			break;
		}

		const { data, errors } = answer;
		due = due.flatMap(({ index }, i) => {
			const alias = `p${i}`;
			const next = data[alias]?.pullRequest?.timelineItems;
			if (next == null || errors.some(e => e.path?.[0] === alias)) {
				scope?.warn(`failed to read past a pull request activity page; ${describeTarget(stale[index].target)}`);
				return [];
			}

			const timeline: Timeline = {
				createdAt: timelines[index].createdAt,
				entries: [...timelines[index].entries, ...toTimelineEntries(next)],
				pageInfo: next.pageInfo,
			};
			timelines[index] = timeline;
			return followFrom(index, timeline, stale[index].target.cursor);
		});
	}
	return timelines;
}

function followFrom(
	index: number,
	timeline: Timeline,
	cursor: GitHubPullRequestActivityCursor,
): { index: number; after: string }[] {
	const { hasNextPage, endCursor } = timeline.pageInfo;
	if (!hasNextPage || endCursor == null) return [];

	const since = toEpochSecond(cursor.t);
	const seen = new Set(cursor.ids);
	return timeline.entries.some(i => i.second >= since && !seen.has(i.node.id))
		? []
		: [{ index: index, after: endCursor }];
}

function activityQuery(targets: readonly ActivityQueryTarget[], limit: number): string {
	const params: string[] = [];
	const fields: string[] = [];
	targets.forEach((target, i) => {
		params.push(`$o${i}: String!`, `$n${i}: String!`, `$k${i}: Int!`);
		if (target.cursor != null) {
			params.push(`$s${i}: DateTime!`);
		}

		const after = target.cursor != null && target.after != null;
		if (after) {
			params.push(`$a${i}: String!`);
		}

		const timeline =
			target.cursor != null
				? `timelineItems(first: ${activityPageSize(limit, target.cursor)}, since: $s${i}, ${after ? `after: $a${i}, ` : ''}itemTypes: [${activityItemTypes}])`
				: `timelineItems(last: ${limit}, itemTypes: [${activityItemTypes}])`;
		fields.push(`p${i}: repository(owner: $o${i}, name: $n${i}) {
				pullRequest(number: $k${i}) {
					createdAt
					${timeline} {
						${timelineNodeFields}
					}
				}
			}`);
	});
	return `query getPullRequestActivity(
			${params.join('\n\t\t\t')}
		) {
			${fields.join('\n\t\t\t')}
		}`;
}

function activityPageSize(limit: number, cursor: GitHubPullRequestActivityCursor): number {
	return Math.min(maxPageSize, limit + cursor.ids.length);
}

function activitySince(cursor: GitHubPullRequestActivityCursor): string {
	return new Date(toEpochSecond(cursor.t) * 1000 - 1000).toISOString();
}

function describeTarget(target: GitHubPullRequestActivityTarget): string {
	return `${target.owner}/${target.repo}#${target.number}`;
}

export function encodePullRequestActivityCursor(cursor: GitHubPullRequestActivityCursor): string {
	return base64(JSON.stringify({ v: 1, t: cursor.t, ids: cursor.ids }))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

export function decodePullRequestActivityCursor(cursor: string): GitHubPullRequestActivityCursor | undefined {
	if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;

	let parsed: unknown;
	try {
		const padded = cursor
			.replace(/-/g, '+')
			.replace(/_/g, '/')
			.padEnd(Math.ceil(cursor.length / 4) * 4, '=');
		parsed = JSON.parse(fromBase64ToString(padded));
	} catch {
		return undefined;
	}
	if (parsed == null || typeof parsed !== 'object') return undefined;

	const { v, t, ids } = parsed as { v?: unknown; t?: unknown; ids?: unknown };
	if (v !== 1 || typeof t !== 'string' || Number.isNaN(Date.parse(t))) return undefined;
	if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) return undefined;

	return { t: t, ids: ids };
}

function toTimelineEntries(items: ActivityTimelineItems): TimelineEntry[] {
	const entries: TimelineEntry[] = [];
	for (const item of items.nodes ?? []) {
		if (item?.id == null || !isActivityNode(item)) continue;
		if (item.__typename === 'PullRequestReview' && item.state === 'PENDING') continue;

		const publishedAt = new Date(activityTime(item));
		entries.push({
			node: item,
			publishedAt: publishedAt,
			second: toEpochSecond(publishedAt),
			createdSecond: toEpochSecond(item.createdAt),
		});
	}
	return entries;
}

function toActivityPage(
	timeline: Timeline,
	cursor: GitHubPullRequestActivityCursor | undefined,
	limit: number,
): PullRequestActivityPage {
	const returned = timeline.entries;

	if (cursor == null) {
		return {
			items: returned.flatMap(i => toActivityItems(i.node, i.publishedAt)),
			cursor: encodePullRequestActivityCursor(baselineCursor(returned, timeline.createdAt)),
			hasMore: false,
		};
	}

	const since = toEpochSecond(cursor.t);
	const seen = new Set(cursor.ids);
	const inWindow = returned.filter(i => i.second >= since);
	const fresh = inWindow.filter(i => !seen.has(i.node.id));
	const kept = fresh.slice(0, limit);
	const lastKept = kept.at(-1);
	const cut = fresh.length > kept.length || timeline.pageInfo.hasNextPage;
	return {
		items: kept.flatMap(i => toActivityItems(i.node, i.publishedAt)),
		cursor: encodePullRequestActivityCursor(
			lastKept != null
				? resumeCursor(cursor, returned, inWindow, kept, lastKept, fresh.slice(limit), cut)
				: cursor,
		),
		hasMore: cut,
	};
}

function activityTime(node: ActivityNode): string {
	return node.__typename === 'PullRequestReview'
		? (node.submittedAt ?? node.publishedAt ?? node.createdAt)
		: (node.publishedAt ?? node.createdAt);
}

function baselineCursor(timeline: readonly TimelineEntry[], createdAt: string): GitHubPullRequestActivityCursor {
	if (timeline.length === 0) return { t: toIsoSecond(toEpochSecond(createdAt)), ids: [] };

	const t = Math.max(...timeline.map(i => i.second));
	return { t: toIsoSecond(t), ids: timeline.filter(i => i.second === t).map(i => i.node.id) };
}

function resumeCursor(
	cursor: GitHubPullRequestActivityCursor,
	returned: readonly TimelineEntry[],
	inWindow: readonly TimelineEntry[],
	kept: readonly TimelineEntry[],
	lastKept: TimelineEntry,
	trimmed: readonly TimelineEntry[],
	cut: boolean,
): GitHubPullRequestActivityCursor {
	let t: number;
	if (cut) {
		t = Math.max(
			toEpochSecond(cursor.t),
			Math.min(lastKept.second, lastKept.createdSecond, ...trimmed.map(i => i.second)),
		);
	} else {
		t = Math.max(...kept.map(i => i.second));
	}

	const delivered = new Set([...cursor.ids, ...kept.map(i => i.node.id)]);
	const ids = inWindow.filter(i => i.second >= t && delivered.has(i.node.id)).map(i => i.node.id);
	if (cut) {
		const present = new Set(returned.map(i => i.node.id));
		ids.push(...cursor.ids.filter(id => !present.has(id)));
	}
	return { t: toIsoSecond(t), ids: [...new Set(ids)] };
}

function isActivityNode(node: ActivityTimelineNode): node is ActivityNode {
	return node.__typename === 'IssueComment' || node.__typename === 'PullRequestReview';
}

function toActivityItems(node: ActivityNode, publishedAt: Date): PullRequestActivityItem[] {
	const base = {
		id: node.id,
		url: node.url,
		...authorOf(node.author),
		publishedAt: publishedAt,
		byViewer: node.viewerDidAuthor === true,
		isMinimized: node.isMinimized === true,
	};
	if (node.__typename === 'IssueComment') return [{ kind: 'comment', ...base, body: node.body ?? '' }];

	const comments = (node.comments?.nodes ?? []).filter((c): c is ActivityReviewCommentNode => c != null);
	const items: PullRequestActivityItem[] = [
		{
			kind: 'review',
			...base,
			state: fromGitHubReviewState(node.state),
			body: node.body ?? '',
			...(node.commit?.oid != null ? { commitSha: node.commit.oid } : {}),
			...((node.comments?.totalCount ?? 0) > comments.length ? { commentsTruncated: true as const } : {}),
		},
	];

	const ordered = comments
		.map(c => ({ comment: c, createdAt: Date.parse(c.createdAt) }))
		.sort((a, b) => a.createdAt - b.createdAt);
	for (const { comment } of ordered) {
		items.push({
			kind: 'review-comment',
			id: comment.id,
			url: comment.url,
			...authorOf(comment.author),
			publishedAt: publishedAt,
			byViewer: comment.viewerDidAuthor === true,
			isMinimized: comment.isMinimized === true,
			reviewId: node.id,
			body: comment.body ?? '',
			path: comment.path,
			...(comment.line != null ? { line: comment.line } : {}),
			...(comment.startLine != null ? { startLine: comment.startLine } : {}),
			...(comment.originalLine != null ? { originalLine: comment.originalLine } : {}),
			outdated: comment.outdated === true,
			...(comment.replyTo?.id != null ? { inReplyTo: comment.replyTo.id } : {}),
			...(comment.commit?.oid != null ? { commitSha: comment.commit.oid } : {}),
		});
	}
	return items;
}

function authorOf(actor: ActivityActorNode | undefined): { author?: PullRequestActivityAuthor } {
	if (actor?.login == null) return {};

	return {
		author: {
			login: actor.login,
			...(actor.url != null ? { url: actor.url } : {}),
			isBot: actor.__typename === 'Bot',
		},
	};
}

function fromGitHubReviewState(state: string): 'approved' | 'changes-requested' | 'commented' | 'dismissed' {
	switch (state) {
		case 'APPROVED':
			return 'approved';
		case 'CHANGES_REQUESTED':
			return 'changes-requested';
		case 'DISMISSED':
			return 'dismissed';
		default:
			return 'commented';
	}
}

function toIsoSecond(second: number): string {
	return new Date(second * 1000).toISOString();
}

function toEpochSecond(time: string | Date): number {
	return Math.floor((typeof time === 'string' ? Date.parse(time) : time.getTime()) / 1000);
}
