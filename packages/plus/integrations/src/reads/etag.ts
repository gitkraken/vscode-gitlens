import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { IssueEtagFields, PullRequestEtagFields, PullRequestEtagInclude } from '../models/integration.js';
import { pullRequestEtagIncludes } from '../models/integration.js';

/**
 * The etags the batch reads hand back (`getPullRequestsBatch`, `getIssuesBatch`): an opaque stamp of an item's
 * change state, which a caller sends back so a cheap check can answer "unchanged" without a full read.
 *
 * Computed by core, never the provider's HTTP ETag, and from the fields alone — not the item's id, since the
 * caller's key already identifies the target and ids cross vocabularies between reads. Not hashed: the stamp IS
 * the serialized fields, so two different change states can never collide into a false `unchanged`. The prefix
 * names the scheme (`pr1`, `is1`) and, for a pull request, every {@link PullRequestEtagInclude} it covers, in
 * canonical order (`pr1+mergeable+checks:`), so two different sets can never collide even when their values do (a
 * `null` mergeability and a `null` rollup). A stamp from another scheme or another set just compares unequal and
 * costs a full read.
 */

export function pullRequestEtagFieldsFromShape(pr: PullRequestShape): PullRequestEtagFields {
	return {
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
}

export function issueEtagFieldsFromShape(issue: IssueShape): IssueEtagFields {
	return { state: issue.state, updatedDate: issue.updatedDate };
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

export function issueEtag(fields: IssueEtagFields): string {
	return `is1:${JSON.stringify([fields.state, timeOf(fields.updatedDate)])}`;
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
