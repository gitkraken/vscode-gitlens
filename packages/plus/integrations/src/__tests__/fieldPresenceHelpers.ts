import assert from 'node:assert/strict';
import type { IssueProjection, IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestProjection, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { FieldPresence, IssueFieldGroup, PullRequestFieldGroup } from '../fieldPresence.js';
import { getIssueFieldPresence, getPullRequestFieldPresence } from '../fieldPresence.js';

/**
 * The anti-drift check the field presence suites share: a row's tag names the read that produced it, and its presence
 * never calls a group `fetched` that the row doesn't carry. A suite feeds each read a fixture whose every selected
 * value is non-empty, so a `fetched` group that comes back undefined or empty is a table claiming more than the read
 * delivers. Not named `*.test.ts` so the runner's glob leaves it alone.
 */

const pullRequestFields: Record<PullRequestFieldGroup, (pr: PullRequest) => unknown[]> = {
	description: pr => [pr.body],
	reviews: pr => [pr.latestReviews],
	reviewRequests: pr => [pr.reviewRequests],
	reviewDecision: pr => [pr.reviewDecision],
	assignees: pr => [pr.assignees],
	checks: pr => [pr.statusCheckRollupState],
	mergeable: pr => [pr.mergeableState],
	diffStats: pr => [pr.additions, pr.deletions, pr.filesChanged],
	commitCount: pr => [pr.commitCount],
	comments: pr => [pr.commentsCount],
	reactions: pr => [pr.thumbsUpCount],
	access: pr => [pr.viewerCanUpdate, pr.repository.accessLevel],
	authoredByMe: pr => [pr.authoredByMe],
	stack: pr => [pr.stack],
};

const issueFields: Record<IssueFieldGroup, (issue: IssueShape) => unknown[]> = {
	description: issue => [issue.body],
	assignees: issue => [issue.assignees],
	labels: issue => [issue.labels],
	comments: issue => [issue.commentsCount],
	reactions: issue => [issue.thumbsUpCount],
	access: issue => [issue.repository?.accessLevel],
};

function assertFetchedGroupsPresent<G extends string>(
	presence: Readonly<Record<G, FieldPresence>>,
	fields: Record<G, () => unknown[]>,
	label: string,
): void {
	for (const [group, value] of Object.entries(presence) as [G, FieldPresence][]) {
		if (value !== 'fetched') continue;

		for (const field of fields[group]()) {
			assert.ok(field !== undefined, `${label}: '${group}' is fetched but undefined`);
			if (Array.isArray(field)) {
				assert.ok(field.length > 0, `${label}: '${group}' is fetched but empty`);
			}
		}
	}
}

/**
 * Asserts `pr` carries `projection`, that its provider has a table for it, and that every group the table calls
 * `fetched` is present and non-empty on the row. Returns the presence for the caller's placeholder assertions.
 */
export function assertPullRequestPresence(
	pr: PullRequestShape | undefined,
	projection: PullRequestProjection,
	label: string = projection,
): Readonly<Record<PullRequestFieldGroup, FieldPresence>> {
	assert.ok(pr != null, `${label}: a row came back`);
	assert.equal(pr.projection, projection, `${label}: the row's tag`);
	const presence = getPullRequestFieldPresence(pr);
	assert.ok(presence != null, `${label}: ${pr.provider.id} has a '${projection}' table`);

	const row = pr as PullRequest;
	assertFetchedGroupsPresent(
		presence,
		Object.fromEntries(
			Object.entries(pullRequestFields).map(([group, fields]) => [group, () => fields(row)]),
		) as Record<PullRequestFieldGroup, () => unknown[]>,
		label,
	);
	return presence;
}

/** {@link assertPullRequestPresence} for issues. */
export function assertIssuePresence(
	issue: IssueShape | undefined,
	projection: IssueProjection,
	label: string = projection,
): Readonly<Record<IssueFieldGroup, FieldPresence>> {
	assert.ok(issue != null, `${label}: a row came back`);
	assert.equal(issue.projection, projection, `${label}: the row's tag`);
	const presence = getIssueFieldPresence(issue);
	assert.ok(presence != null, `${label}: ${issue.provider.id} has a '${projection}' table`);

	assertFetchedGroupsPresent(
		presence,
		Object.fromEntries(
			Object.entries(issueFields).map(([group, fields]) => [group, () => fields(issue)]),
		) as Record<IssueFieldGroup, () => unknown[]>,
		label,
	);
	return presence;
}
