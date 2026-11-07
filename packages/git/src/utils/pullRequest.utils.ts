import * as l10n from '@vscode/l10n';
import { fromNow } from '@gitlens/utils/date.js';
import type {
	PullRequest,
	PullRequestComparisonRefs,
	PullRequestMergeQueueEntry,
	PullRequestRefs,
	PullRequestRepositoryIdentityDescriptor,
	PullRequestShape,
	PullRequestSortField,
	PullRequestSorting,
	PullRequestStackInfo,
} from '../models/pullRequest.js';
import { PullRequestMergeQueueState } from '../models/pullRequest.js';
import { serializeMilestone } from './issueOrPullRequest.utils.js';
import { shortenRevision } from './revision.utils.js';

/** How many pull requests a merge action affects — unstacked is always 1; a stacked merge lands either
 *  just this layer and everything below it (`position`), or the whole stack (`wholeStack`). The one
 *  source every merge-confirmation and merge-action label counts from, so they can't drift apart.
 *  Takes only the two fields it needs (not the full {@link PullRequestStackInfo}) since callers on the
 *  webview side carry narrower serialized stack shapes. */
export function getStackedMergeCount(
	stack: Pick<PullRequestStackInfo, 'position' | 'size'> | undefined,
	options?: { wholeStack?: boolean },
): number {
	if (stack == null) return 1;
	return options?.wholeStack ? stack.size : stack.position;
}

/** Whether an open pull request is waiting in a merge queue. `false` also when the read didn't fetch the queue —
 *  check the row's `mergeQueue` field presence before treating that as "not queued". Narrows to the shape's own entry
 *  type, since webview shapes carry a serialized one, or to {@link PullRequestMergeQueueEntry} for a shape that
 *  doesn't declare one (an `IssueOrPullRequest` that is a pull request). */
export function isPullRequestInMergeQueue<T extends { readonly state?: string; readonly mergeQueue?: unknown }>(
	pr: T,
): pr is T & {
	readonly mergeQueue: 'mergeQueue' extends keyof T ? NonNullable<T['mergeQueue']> : PullRequestMergeQueueEntry;
} {
	return pr.state === 'opened' && pr.mergeQueue != null;
}

/** A pull request's state as shown to users: its provider state, except an open pull request waiting in a merge queue is `queued`. */
export function getPullRequestDisplayState<S extends string | undefined>(pr: {
	readonly state: S;
	readonly mergeQueue?: unknown;
}): S | 'queued' {
	return isPullRequestInMergeQueue(pr) ? 'queued' : pr.state;
}

/** A pull request's {@link getPullRequestDisplayState display state} paired with its
 *  {@link formatPullRequestMergeQueueStatus merge-queue status}, place in line included, which is set only while it's
 *  queued — the pair a pull request chip renders. */
export function getPullRequestDisplayStatus<S extends string | undefined>(pr: {
	readonly state: S;
	readonly mergeQueue?: Parameters<typeof formatPullRequestMergeQueueStatus>[0];
}): { status: S | 'queued'; queueStatus: string | undefined } {
	return isPullRequestInMergeQueue(pr)
		? { status: 'queued', queueStatus: formatPullRequestMergeQueueStatus(pr.mergeQueue) }
		: { status: pr.state, queueStatus: undefined };
}

/**
 * Describes where a queued pull request stands in its merge queue, with its place in line when the provider gave one
 * ("#2 in the merge queue, checks running"). Merging and failing entries read the same with or without a place, since
 * the place no longer says anything there. Takes only the fields it reads, and the estimate as a date or a timestamp
 * (ms), since webview shapes carry a serialized entry.
 */
export function formatPullRequestMergeQueueStatus(entry: {
	readonly state: PullRequestMergeQueueState;
	readonly estimatedMergeAt?: Date | number;
	readonly position?: number;
}): string {
	const position = entry.position;

	let status: string;
	switch (entry.state) {
		case PullRequestMergeQueueState.AwaitingChecks:
			status =
				position != null
					? l10n.t('#{position} in the merge queue, checks running', { position: position })
					: l10n.t('Queued to merge, checks running');
			break;
		case PullRequestMergeQueueState.Mergeable:
			status =
				position != null
					? l10n.t('#{position} in the merge queue, next up', { position: position })
					: l10n.t('Queued to merge, next up');
			break;
		case PullRequestMergeQueueState.Locked:
			// The merge is already in flight, so an estimate adds nothing
			return l10n.t('Merging');
		case PullRequestMergeQueueState.Unmergeable:
			return l10n.t('Failing in the merge queue');
		default:
			status =
				position != null
					? l10n.t('#{position} in the merge queue', { position: position })
					: l10n.t('Queued to merge');
			break;
	}

	if (entry.estimatedMergeAt == null) return status;

	// An estimate already past is wrong, not late news: "estimated to merge 2 minutes ago" would only mislead
	const estimatedMergeAt = new Date(entry.estimatedMergeAt).getTime();
	if (Number.isNaN(estimatedMergeAt) || estimatedMergeAt <= Date.now()) return status;

	return l10n.t('{0}, estimated to merge {1}', status, fromNow(estimatedMergeAt));
}

/** When a queued pull request joined its merge queue, as the clause that follows its
 *  {@link formatPullRequestMergeQueueStatus status} — "queued 3 hours ago" — so a status that ends in an estimate
 *  doesn't run straight into a bare date. */
export function formatPullRequestMergeQueueEnqueuedFromNow(entry: { readonly enqueuedAt: Date | number }): string {
	return l10n.t('queued {0}', fromNow(entry.enqueuedAt));
}

/** What a `PullRequestMergeQueueRemoval`'s reason says about the pull request: its queue run `failed`, someone
 *  removed it (`manual`), or a reason this doesn't recognize (`other`), which the removal's raw reason still names. */
export type PullRequestMergeQueueRemovalKind = 'failed' | 'manual' | 'other';

/**
 * Classifies a merge-queue removal's provider reason. Only the reasons seen from GitHub are recognized —
 * `failed_checks` (its queue run failed) and `manual` — matched without regard to case; every other reason is
 * `other` rather than guessed at, so a caller that shows one can fall back to the raw reason.
 */
export function getPullRequestMergeQueueRemovalKind(reason: string): PullRequestMergeQueueRemovalKind {
	switch (reason.toLowerCase()) {
		case 'failed_checks':
			return 'failed';
		case 'manual':
			return 'manual';
		default:
			return 'other';
	}
}

/**
 * Whether a pull request's merge-queue removal (`mergeQueueRemoval`) still describes it: it is set,
 * the pull request is open and not queued, and nothing has touched the pull request since — its update time is no
 * later than the removal, which GitHub's removal doesn't move. Narrows `mergeQueueRemoval` to set.
 *
 * The trade-off: any later update clears it, not only a push that may have fixed the failure, so a comment or a
 * label added after a failed queue run also stops it reading as failing. A provider's timeline can't say whether a
 * push followed the removal (GitHub orders commits by commit date, not push time), and a stale "failing" is worse
 * than a missed one. Takes dates or timestamps (ms), since webview shapes carry serialized ones.
 */
export function isPullRequestMergeQueueRemovalCurrent<
	T extends {
		readonly state?: string;
		readonly updatedDate: Date | number;
		readonly mergeQueue?: unknown;
		readonly mergeQueueRemoval?: { readonly removedAt: Date | number };
	},
>(pr: T): pr is T & { readonly mergeQueueRemoval: NonNullable<T['mergeQueueRemoval']> } {
	if (pr.mergeQueueRemoval == null || pr.state !== 'opened' || pr.mergeQueue != null) return false;

	const removedAt = new Date(pr.mergeQueueRemoval.removedAt).getTime();
	const updatedAt = new Date(pr.updatedDate).getTime();
	if (Number.isNaN(removedAt) || Number.isNaN(updatedAt)) return false;

	return removedAt >= updatedAt;
}

/**
 * How each sort field is read off a {@link PullRequestShape}, for the filtered PR search, which MERGES its
 * relationship × state facets in the facade and so has to order the union itself instead of trusting the
 * per-facet server order. Only the fields the shape carries appear — the same rule as `getIssueComparator`, and
 * the reason {@link PullRequestSortField} is just these two.
 */
const pullRequestSortValues: Partial<
	Record<PullRequestSortField, (pr: PullRequestShape) => number | Date | string | undefined>
> = {
	created: pr => pr.createdDate,
	updated: pr => pr.updatedDate,
};

/**
 * A comparator for one sort key over normalized pull requests, or `undefined` when the field isn't derivable
 * from a {@link PullRequestShape} — the signal that the key is only honorable on a SINGLE-origin read where the
 * provider already ordered the page. Missing values sort LAST in both directions (partitioned before any
 * arithmetic so two missing values compare equal, exactly as `getIssueComparator` does).
 *
 * Note it orders whatever it is handed. Sorting a page already capped at the result ceiling does not make it the
 * top N.
 */
export function getPullRequestComparator(
	sort: PullRequestSorting,
): ((a: PullRequestShape, b: PullRequestShape) => number) | undefined {
	const [field, direction] = sort.split(':') as [PullRequestSortField, 'asc' | 'desc'];
	const getValue = pullRequestSortValues[field];
	if (getValue == null) return undefined;

	return (a, b) => {
		const left = toComparable(getValue(a));
		const right = toComparable(getValue(b));
		if (left == null || right == null) {
			if (left == null && right == null) return 0;

			return left == null ? 1 : -1;
		}

		const ordered = left < right ? -1 : left > right ? 1 : 0;
		return direction === 'asc' ? ordered : -ordered;
	};
}

function toComparable(value: number | Date | string | undefined): number | string | undefined {
	return value instanceof Date ? value.getTime() : value;
}

export interface PullRequestUrlIdentity<TProvider extends string = string> {
	provider?: TProvider;

	ownerAndRepo?: string;
	prNumber: string;
}

export function getComparisonRefsForPullRequest(repoPath: string, prRefs: PullRequestRefs): PullRequestComparisonRefs {
	const refs: PullRequestComparisonRefs = {
		repoPath: repoPath,
		base: { ref: prRefs.base.sha, label: `${prRefs.base.branch} (${shortenRevision(prRefs.base.sha)})` },
		head: { ref: prRefs.head.sha, label: prRefs.head.branch },
	};
	return refs;
}

export function getPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
	let prNumber: string | undefined = undefined;

	let match = search.match(/(?:\/)(\d+)/); // any number starting with "/"
	if (match != null) {
		prNumber = match[1];
	}

	if (prNumber == null) {
		match = search.match(/^#?(\d+)$/); // just a number or with a leading "#"
		if (match != null) {
			prNumber = match[1];
		}
	}

	return prNumber == null ? undefined : { ownerAndRepo: undefined, prNumber: prNumber, provider: undefined };
}

/** A pull request's display number from its url, or `undefined` for a url naming no pull request. Anchors
 *  on the provider's pull request path segment (GitHub `pull`, Bitbucket `pull-requests`, GitLab
 *  `merge_requests`, Azure `pullrequest`) so a digit-leading owner (`github.com/1Password/x/pull/123`)
 *  can't win. */
export function getPullRequestNumberFromUrl(url: string): string | undefined {
	// No loose fallback: `getPullRequestIdentityFromMaybeUrl` scans for any `/<digits>`, which reads a bare
	// repository url like `github.com/1Password/sdk` as pull request #1. Callers that hold a real pull
	// request fall back to its id instead, and the one that asks whether a pasted url names a pull request
	// needs "no" for an answer.
	return url.match(/(?:pull|pull-requests|merge_requests|pullrequest)\/(\d+)(?:\b|\/|$)/)?.[1];
}

export function getRepositoryIdentityForPullRequest(
	pr: PullRequest,
	headRepo: boolean = true,
): PullRequestRepositoryIdentityDescriptor {
	if (headRepo) {
		return {
			remote: {
				url: pr.refs?.head?.url,
				domain: pr.provider.domain,
			},
			name: `${pr.refs?.head?.owner ?? pr.repository.owner}/${pr.refs?.head?.repo ?? pr.repository.repo}`,
			provider: {
				id: pr.provider.id,
				domain: pr.provider.domain,
				repoDomain: pr.refs?.head?.owner ?? pr.repository.owner,
				repoName: pr.refs?.head?.repo ?? pr.repository.repo,
			},
		};
	}

	return {
		remote: {
			url: pr.refs?.base?.url ?? pr.url,
			domain: pr.provider.domain,
		},
		name: `${pr.refs?.base?.owner ?? pr.repository.owner}/${pr.refs?.base?.repo ?? pr.repository.repo}`,
		provider: {
			id: pr.provider.id,
			domain: pr.provider.domain,
			repoDomain: pr.refs?.base?.owner ?? pr.repository.owner,
			repoName: pr.refs?.base?.repo ?? pr.repository.repo,
			repoOwnerDomain: pr.refs?.base?.owner ?? pr.repository.owner,
		},
	};
}

export function isMaybeNonSpecificPullRequestSearchUrl(search: string): boolean {
	return getPullRequestIdentityFromMaybeUrl(search) != null;
}

/**
 * Deliberately leaves `projection` out: this copy drops `filesChanged`, `repository` and the class-only check rollup,
 * commit count and `viewerCanUpdate`, so a tag would have field presence report as fetched what the copy no longer has.
 */
export function serializePullRequest(value: PullRequest): PullRequestShape {
	const serialized: PullRequestShape = {
		type: value.type,
		provider: {
			id: value.provider.id,
			name: value.provider.name,
			domain: value.provider.domain,
			icon: value.provider.icon,
		},
		id: value.id,
		nodeId: value.nodeId,
		number: value.number,
		title: value.title,
		body: value.body,
		url: value.url,
		createdDate: value.createdDate,
		updatedDate: value.updatedDate,
		closedDate: value.closedDate,
		closed: value.closed,
		author: {
			id: value.author.id,
			name: value.author.name,
			username: value.author.username,
			avatarUrl: value.author.avatarUrl,
			url: value.author.url,
		},
		state: value.state,
		mergedDate: value.mergedDate,
		mergeableState: value.mergeableState,
		refs: value.refs
			? {
					head: {
						exists: value.refs.head.exists,
						owner: value.refs.head.owner,
						repo: value.refs.head.repo,
						sha: value.refs.head.sha,
						branch: value.refs.head.branch,
						url: value.refs.head.url,
						cloneHttps: value.refs.head.cloneHttps,
						cloneSsh: value.refs.head.cloneSsh,
						isFork: value.refs.head.isFork,
					},
					base: {
						exists: value.refs.base.exists,
						owner: value.refs.base.owner,
						repo: value.refs.base.repo,
						sha: value.refs.base.sha,
						branch: value.refs.base.branch,
						url: value.refs.base.url,
						cloneHttps: value.refs.base.cloneHttps,
						cloneSsh: value.refs.base.cloneSsh,
						isFork: value.refs.base.isFork,
					},
					isCrossRepository: value.refs.isCrossRepository,
				}
			: undefined,
		isDraft: value.isDraft,
		additions: value.additions,
		deletions: value.deletions,
		commentsCount: value.commentsCount,
		thumbsUpCount: value.thumbsUpCount,
		reviewDecision: value.reviewDecision,
		reviewRequests: value.reviewRequests,
		latestReviews: value.latestReviews,
		assignees: value.assignees,
		authoredByMe: value.authoredByMe,
		viewer: value.viewer != null ? { id: value.viewer.id, username: value.viewer.username } : undefined,
		viewerUnresolved: value.viewerUnresolved,
		milestone: serializeMilestone(value.milestone),
		project: value.project
			? {
					id: value.project.id,
					name: value.project.name,
					resourceId: value.project.resourceId,
					resourceName: value.project.resourceName,
				}
			: undefined,
		stack: value.stack
			? {
					id: value.stack.id,
					number: value.stack.number,
					size: value.stack.size,
					position: value.stack.position,
					baseRef: value.stack.baseRef,
				}
			: undefined,
		mergeQueue: value.mergeQueue
			? {
					state: value.mergeQueue.state,
					enqueuedAt: value.mergeQueue.enqueuedAt,
					estimatedMergeAt: value.mergeQueue.estimatedMergeAt,
					url: value.mergeQueue.url,
					position: value.mergeQueue.position,
				}
			: undefined,
		mergeQueueRequired: value.mergeQueueRequired,
		mergeQueueRemoval: value.mergeQueueRemoval
			? { reason: value.mergeQueueRemoval.reason, removedAt: value.mergeQueueRemoval.removedAt }
			: undefined,
	};
	return serialized;
}
