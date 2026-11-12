import type { IssueShape, IssueSyncedWith } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequestState } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeableState,
	PullRequestMergeQueueEntry,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestShape,
	PullRequestState,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { getIssueFieldPresence } from '../fieldPresence.js';
import { issueNamesPeople } from '../providers/models.js';

/**
 * The etags the batch reads hand back (`getPullRequestsBatch`, `getIssuesBatch`): an opaque stamp of an item's
 * change state, which a caller sends back so a cheap check can answer "unchanged" without a full read.
 *
 * Computed by core, never the provider's HTTP ETag, and from the fields alone — not the item's id, since the
 * caller's key already identifies the target and ids cross vocabularies between reads. Not hashed: the stamp IS
 * the serialized fields, so two different change states can never collide into a false `unchanged` — except for an
 * Azure DevOps pull request's `revision`, a 64-bit hash of the fields Azure changes without a timestamp, where a
 * collision (about 2^-64) is the only way a change can hide. The prefix names the scheme (`pr1`, `is1`) and every
 * include it covers ({@link PullRequestEtagInclude}, {@link IssueEtagInclude}), in canonical order
 * (`pr1+mergeable+checks:`, `is1+reactions:`), so two different sets can never collide even when their values do (a
 * `null` mergeability and a `null` rollup). A stamp from another scheme or another set just compares unequal and
 * costs a full read.
 */

/**
 * An input a pull request's etag can be widened to, each of which a host changes without moving `updatedAt`. Every
 * entry costs its own fields in the cheap check, so a caller picks only the ones it needs. `'checks'` is the check
 * rollup.
 */
export type PullRequestEtagInclude = 'mergeable' | 'reviewDecision' | 'checks';

/** Every {@link PullRequestEtagInclude}, in the canonical order an etag lists them in. */
export const pullRequestEtagIncludes: readonly PullRequestEtagInclude[] = ['mergeable', 'reviewDecision', 'checks'];

/**
 * The change state a batch read's etag is computed from ({@link pullRequestEtag}), in the NORMALIZED vocabulary of
 * `PullRequestShape` — the values a full row carries after its provider's whole conversion chain, so a cheap
 * check and a full read of the same pull request yield the same fields. Each of `mergeableState`, `reviewDecision`
 * and `statusCheckRollupState` counts only when its {@link PullRequestEtagInclude} is requested.
 */
export interface PullRequestEtagFields {
	state: PullRequestState;
	isDraft?: boolean;
	updatedDate: Date;
	headSha?: string;
	mergeableState?: PullRequestMergeableState;
	reviewDecision?: PullRequestReviewDecision;
	statusCheckRollupState?: PullRequestStatusCheckRollupState;
	/**
	 * A fingerprint of the fields a host changes without moving an update time ({@link pullRequestRevision}); set
	 * only for hosts that keep none (Azure DevOps and Server). Part of the etag whenever it is set, not an include.
	 */
	revision?: string;
	/**
	 * A full row marked `viewerUnresolved`, which no cheap check ever sets: such a row never compares unchanged, so it
	 * is read in full again rather than kept without a viewer until the pull request changes.
	 */
	viewerUnresolved?: true;
	/**
	 * The pull request's merge-queue entry, as far as the etag reads it: whether it's queued, in which state and since
	 * when, none of which moves `updatedDate`. Part of the etag whenever it is set, not an include, and set only on a
	 * queued pull request, so every other pull request's etag is unchanged by it. Read only where the queue is
	 * (github.com).
	 */
	mergeQueue?: Pick<PullRequestMergeQueueEntry, 'state' | 'enqueuedAt'>;
	/**
	 * When the pull request's `mergeQueueRemoval` happened, set only while it has one. Like `mergeQueue`, part of the
	 * etag whenever it is set, not an include: a pull request that joins its queue and is removed between two checks
	 * moves neither its update time nor, at either check, `mergeQueue`.
	 */
	mergeQueueRemovedAt?: Date;
	/**
	 * The read selected merge-queue data (GitHub.com, for a read that asks for it or a host that opts in), whatever
	 * that data says. Part of the etag whenever it is set, as a marker: without it a pull request that isn't queued and
	 * has no removal computes the etag it has without the data, so a host that starts asking for the data would keep a
	 * held row lacking it as `unchanged`. A full row sets it from its `mergeQueueRequired`, which only a read that
	 * selected the data carries; a cheap check sets it from the same selection.
	 */
	mergeQueueRead?: true;
}

/**
 * The fields of a pull request {@link pullRequestRevision} reads, as a full row carries them. A `PullRequestShape`
 * is one, so a full read passes its row as is and a cheap check builds one from the same mapped values.
 */
export interface PullRequestRevisionSource {
	readonly title: string;
	readonly body?: string;
	readonly refs?: { readonly base: { readonly branch: string } };
	readonly reviewRequests?: readonly PullRequestRevisionReviewer[];
	readonly latestReviews?: readonly PullRequestRevisionReviewer[];
}

interface PullRequestRevisionReviewer {
	readonly reviewer: { readonly id: string };
	readonly state: PullRequestReviewState;
}

/**
 * {@link PullRequestEtagFields.revision}: a 64-bit hash of a pull request's title, description, target branch and
 * reviewers (each one's id and review state, in a canonical order). Hashed to keep the etag short, so a collision is
 * the only way a change can hide, at about 2^-64.
 */
export function pullRequestRevision(pr: PullRequestRevisionSource): string {
	return fnv1aHash64(
		JSON.stringify([
			pr.title,
			pr.body ?? null,
			pr.refs?.base.branch ?? null,
			toRevisionReviewers(pr.reviewRequests),
			toRevisionReviewers(pr.latestReviews),
		]),
	);
}

/** Each reviewer as its serialized `[id, state]`, sorted, so the host's order never moves the revision. */
function toRevisionReviewers(reviewers: readonly PullRequestRevisionReviewer[] | undefined): string[] | null {
	return reviewers?.map(r => JSON.stringify([r.reviewer.id, r.state])).sort() ?? null;
}

/**
 * An input an issue's etag can be widened to, which a host changes without moving `updatedAt`. `'reactions'` is the
 * thumbs-up count, and widens the etag only on hosts whose rows really fetch one (GitHub/GHE and GitLab).
 */
export type IssueEtagInclude = 'reactions';

/** Every {@link IssueEtagInclude}, in the canonical order an etag lists them in. */
export const issueEtagIncludes: readonly IssueEtagInclude[] = ['reactions'];

/** The issue twin of {@link PullRequestEtagFields}, in {@link IssueShape}'s normalized vocabulary. */
export interface IssueEtagFields {
	state: IssueOrPullRequestState | undefined;
	updatedDate: Date;
	/** Counts only when `'reactions'` is requested, and only from a row whose read fetched reactions. */
	thumbsUpCount?: number;
	/**
	 * Azure DevOps only: the version of the rule a work item's body is read by ({@link azureWorkItemDescriptionRule}).
	 * A change of rule changes the body without moving `updatedDate`, so a row read under an earlier one must not
	 * compare unchanged.
	 */
	descriptionRule?: number;
	/**
	 * Azure DevOps only: the version of the rule a work item's `viewer` is set by ({@link azureWorkItemViewerRule}).
	 * A full row that names someone but got no viewer (its organization's identity couldn't be read) leaves it out, so
	 * it never compares unchanged and is read in full again rather than kept without one.
	 */
	viewerRule?: number;
	/**
	 * Linear only: the row's `syncedWith` links as {@link linearSyncedWithEtagKeys} spells them, so a link added, removed
	 * or moved to other coordinates changes the etag whether or not the issue's update time moves. `null` on a
	 * full row without `syncedWith` (held from before it existed, or read while Linear failed to resolve it), which
	 * never compares unchanged with a cheap check's list.
	 */
	syncedWithKeys?: readonly string[] | null;
}

/**
 * {@link IssueEtagFields.descriptionRule}: the version of the rule an Azure DevOps work item's body is read by, stamped
 * on both sides of its etag. Bumped whenever the rule changes which field a work item's body comes from, so every row
 * a caller holds from before is read in full once. 1: the first rich text field with content (provider-apis'
 * `getAzureWorkItemDescription`), where it used to be only Description. The rule lives in provider-apis, so a bump of
 * that package that changes it must bump this too; the etag tests pin the rule to catch one.
 *
 * It can't cover a row whose read found the organization's field catalog unavailable: that row's body falls back to
 * the built-in fields, and a cheap check, which reads no body, can't tell it from a complete one, so it stays as read
 * until the work item changes.
 */
export const azureWorkItemDescriptionRule = 1;

/**
 * {@link IssueEtagFields.viewerRule}: the version of the rule an Azure DevOps work item's `viewer` is set by, stamped
 * on both sides of its etag, so every row a caller holds from before it was set is read in full once. 1: the user's
 * identity in the work item's organization (gitkraken/kepler#4291).
 */
export const azureWorkItemViewerRule = 1;

/**
 * A Linear row's sync links in its etag, sorted: each as its GitHub id and, when known, the coordinates a host matches
 * the GitHub row by, so a link whose coordinates Linear fills in or changes later compares changed.
 */
export function linearSyncedWithEtagKeys(links: readonly IssueSyncedWith[]): string[] {
	return links
		.map(link => (link.owner != null ? `${link.id}:${link.owner}/${link.repo}#${link.number}` : `${link.id}:`))
		.sort();
}

/**
 * Azure DevOps: a pull request there keeps no update time, so its etag adds a {@link pullRequestRevision}, and a work
 * item's etag adds the rule its body is read by (see `azureWorkItemDescriptionRule`).
 */
const azureProviderIds: ReadonlySet<string> = new Set([
	GitCloudHostIntegrationId.AzureDevOps,
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
]);

export function pullRequestEtagFieldsFromShape(pr: PullRequestShape): PullRequestEtagFields {
	const fields: PullRequestEtagFields = {
		state: pr.state,
		isDraft: pr.isDraft,
		updatedDate: pr.updatedDate,
		headSha: pr.refs?.head.sha,
		mergeableState: pr.mergeableState,
		reviewDecision: pr.reviewDecision,
		// On the class, not the shape: every provider's mapper builds a `PullRequest`. Read by name rather than by
		// `instanceof`, which a second copy of the model module fails, silently dropping the rollup from every full
		// row's etag so that no cheap check ever matches it again.
		statusCheckRollupState: 'statusCheckRollupState' in pr ? (pr as PullRequest).statusCheckRollupState : undefined,
	};
	// Read defensively, as `timeOf` reads the date: a row without a provider must not fail the read.
	if (pr.provider != null && azureProviderIds.has(pr.provider.id)) {
		fields.revision = pullRequestRevision(pr);
	}
	if (pr.viewerUnresolved) {
		fields.viewerUnresolved = true;
	}
	if (pr.mergeQueue != null) {
		fields.mergeQueue = { state: pr.mergeQueue.state, enqueuedAt: pr.mergeQueue.enqueuedAt };
	}
	if (pr.mergeQueueRemoval != null) {
		fields.mergeQueueRemovedAt = pr.mergeQueueRemoval.removedAt;
	}
	// `mergeQueueRequired` is GitHub's non-null `isMergeQueueEnabled`, so only a row from a read that selected the
	// merge-queue data has it.
	if (pr.mergeQueueRequired != null) {
		fields.mergeQueueRead = true;
	}
	return fields;
}

export function issueEtagFieldsFromShape(issue: IssueShape): IssueEtagFields {
	const fields: IssueEtagFields = { state: issue.state, updatedDate: issue.updatedDate };
	// Only where the row's read really fetched reactions: elsewhere a count is a placeholder or a tracker's votes,
	// which no cheap check reads, so taking it would fail every check of that row under `'reactions'`.
	if (
		issue.thumbsUpCount != null &&
		issue.provider != null &&
		getIssueFieldPresence(issue)?.reactions === 'fetched'
	) {
		fields.thumbsUpCount = issue.thumbsUpCount;
	}
	if (issue.provider != null && azureProviderIds.has(issue.provider.id)) {
		fields.descriptionRule = azureWorkItemDescriptionRule;
		// A row read while its organization's identity couldn't be must not compare unchanged, or it would be kept
		// without a viewer until the work item changes. Also a row that names someone and has neither field: one held
		// from before `viewerUnresolved` existed.
		if (!issue.viewerUnresolved && (issue.viewer != null || !issueNamesPeople(issue))) {
			fields.viewerRule = azureWorkItemViewerRule;
		}
	}
	if (issue.provider?.id === IssuesCloudHostIntegrationId.Linear) {
		fields.syncedWithKeys = issue.syncedWith != null ? linearSyncedWithEtagKeys(issue.syncedWith) : null;
	}
	return fields;
}

/**
 * The distinct `includes` in canonical order, whatever order and repetition the caller gave. Values it doesn't know
 * are dropped, so a caller validates them first (see {@link findInvalidPullRequestEtagInclude}).
 */
export function normalizePullRequestEtagIncludes(
	includes: readonly PullRequestEtagInclude[],
): readonly PullRequestEtagInclude[] {
	return pullRequestEtagIncludes.filter(include => includes.includes(include));
}

/** The first of `includes` that isn't a {@link PullRequestEtagInclude}, if any. */
export function findInvalidPullRequestEtagInclude(includes: readonly string[]): string | undefined {
	return includes.find(include => !(pullRequestEtagIncludes as readonly string[]).includes(include));
}

/**
 * Each of `includes` adds one input — mergeability, review decision or check rollup — which a host may change
 * without moving `updatedDate`. An input that isn't listed is left out, so its churn never forces a full read.
 */
export function pullRequestEtag(fields: PullRequestEtagFields, includes: readonly PullRequestEtagInclude[]): string {
	const covered = normalizePullRequestEtagIncludes(includes);
	const state: unknown[] = [fields.state, fields.isDraft ?? null, timeOf(fields.updatedDate), fields.headSha ?? null];
	// Only where it is set, so every other host's etag stays exactly what it was.
	if (fields.revision != null) {
		state.push(fields.revision);
	}
	if (fields.viewerUnresolved) {
		state.push('viewer-unresolved');
	}
	// Only while queued, so a pull request outside any queue keeps exactly the etag it always had, and joining,
	// moving through or leaving the queue (none of which moves the update time) still reads as a change. Tagged, so
	// it can never read as another input.
	if (fields.mergeQueue != null) {
		state.push(['merge-queue', fields.mergeQueue.state, timeOf(fields.mergeQueue.enqueuedAt)]);
	}
	// Likewise only while the pull request's latest merge-queue event is a removal, so a pull request removed between
	// two checks, which neither moves its update time nor shows a queue entry at either check, still reads as a change.
	if (fields.mergeQueueRemovedAt != null) {
		state.push(['merge-queue-removed', timeOf(fields.mergeQueueRemovedAt)]);
	}
	// Whenever the read selected the merge-queue data, so an etag from such a read never equals one from a read that
	// didn't, even for a pull request that was never queued, whose state is otherwise identical. Tagged, like the
	// terms above. A read that didn't select it adds nothing, so it computes the etag it did before.
	if (fields.mergeQueueRead) {
		state.push(['merge-queue-read']);
	}

	if (covered.length === 0) return `pr1:${JSON.stringify(state)}`;

	for (const include of covered) {
		switch (include) {
			case 'mergeable':
				state.push(fields.mergeableState ?? null);
				break;
			case 'reviewDecision':
				state.push(fields.reviewDecision ?? null);
				break;
			case 'checks':
				state.push(fields.statusCheckRollupState ?? null);
				break;
		}
	}

	return `pr1+${covered.join('+')}:${JSON.stringify(state)}`;
}

/** The issue twin of {@link normalizePullRequestEtagIncludes}; validate with {@link findInvalidIssueEtagInclude}. */
export function normalizeIssueEtagIncludes(includes: readonly IssueEtagInclude[]): readonly IssueEtagInclude[] {
	return issueEtagIncludes.filter(include => includes.includes(include));
}

/** The first of `includes` that isn't an {@link IssueEtagInclude}, if any. */
export function findInvalidIssueEtagInclude(includes: readonly string[]): string | undefined {
	return includes.find(include => !(issueEtagIncludes as readonly string[]).includes(include));
}

/** `'reactions'` adds the thumbs-up count, which a host changes without moving `updatedDate`. */
export function issueEtag(fields: IssueEtagFields, includes: readonly IssueEtagInclude[]): string {
	const covered = normalizeIssueEtagIncludes(includes);
	const state: unknown[] = [fields.state, timeOf(fields.updatedDate)];
	// Only where it is set, so every other provider's etag stays exactly what it was.
	if (fields.descriptionRule != null) {
		state.push(fields.descriptionRule);
	}
	if (fields.viewerRule != null) {
		state.push(fields.viewerRule);
	}
	// Only where it is set, so every other provider's etag stays exactly what it was. An unknown list is spelled
	// apart from every known one, so it never compares unchanged.
	if (fields.syncedWithKeys !== undefined) {
		state.push(fields.syncedWithKeys === null ? 'synced-with:unknown' : ['synced-with', ...fields.syncedWithKeys]);
	}
	if (covered.length === 0) return `is1:${JSON.stringify(state)}`;

	for (const include of covered) {
		switch (include) {
			case 'reactions':
				state.push(fields.thumbsUpCount ?? null);
				break;
		}
	}

	return `is1+${covered.join('+')}:${JSON.stringify(state)}`;
}

/**
 * Never throws: an etag is computed for every fully read row, so a mapper that hands over a missing or unparseable
 * date must not fail the whole read. Such a row's etag just won't match a cheap check's, which always has a date,
 * so the cost is a full read, never a false `unchanged`.
 */
function timeOf(date: Date): number | null {
	const time = new Date(date).getTime();
	return Number.isNaN(time) ? null : time;
}
