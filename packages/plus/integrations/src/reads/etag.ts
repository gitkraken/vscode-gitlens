import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { getIssueFieldPresence } from '../fieldPresence.js';
import type {
	IssueEtagFields,
	IssueEtagInclude,
	PullRequestEtagFields,
	PullRequestEtagInclude,
} from '../models/integration.js';
import { issueEtagIncludes, pullRequestEtagIncludes, pullRequestRevision } from '../models/integration.js';

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

/** The hosts that keep no update time on a pull request, whose etag adds a {@link pullRequestRevision}. */
const revisionProviderIds: ReadonlySet<string> = new Set([
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
	if (pr.provider != null && revisionProviderIds.has(pr.provider.id)) {
		fields.revision = pullRequestRevision(pr);
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
