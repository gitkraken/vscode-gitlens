import * as assert from 'assert';
import type {
	PullRequestMember,
	PullRequestMergeQueueEntry,
	PullRequestMergeQueueRemoval,
	PullRequestStackInfo,
} from '@gitlens/git/models/pullRequest.js';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestMergeQueueState,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import { formatPullRequestMergeQueueStatus, isPullRequestInMergeQueue } from '@gitlens/git/utils/pullRequest.utils.js';
import { getActionablePullRequests, toActionablePullRequestInput } from '@gitlens/integrations/index.js';
import { formatMergeQueueRemoval } from '../../integrations/utils/pullRequest.mergeQueue.utils.js';
import { getPullRequestsCacheExpiresAt, getSuggestedActions, isLaunchpadItemStale } from '../launchpadProvider.js';
import type { LaunchpadActionCategory } from '../models/launchpad.js';
import {
	actionGroupMap,
	getLaunchpadActionCategory,
	getMergeQueueActionCategory,
	launchpadCategoryToGroupMap,
	launchpadPriorityGroups,
} from '../models/launchpad.js';
import { getBlockedSummaryLabel } from '../utils/-webview/launchpadIndicator.utils.js';

/**
 * `getActionablePullRequests` knows nothing about merge queues, so a queued, approved, green pull request comes back
 * `readyToMerge`. These pin the GitLens-side override every categorizing site applies after it.
 */

const githubProvider: ProviderReference = { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' };
const me: PullRequestMember = { id: 'me', name: 'me', username: 'me' };
const reviewer: PullRequestMember = { id: 'reviewer', name: 'reviewer', username: 'reviewer' };

/** An open pull request the viewer authored, approved with passing checks and no conflicts, last updated at the
 *  epoch. */
function createReadyPullRequest(
	mergeQueue?: PullRequestMergeQueueEntry,
	options?: { mergeQueueRequired?: boolean; mergeQueueRemoval?: PullRequestMergeQueueRemoval },
): PullRequest {
	return new PullRequest(
		githubProvider,
		me,
		'1',
		'PR_kwNode1',
		'A pull request',
		'https://github.com/owner/repo/pull/1',
		{ owner: 'owner', repo: 'repo' },
		'opened',
		new Date(0),
		new Date(0),
		undefined,
		undefined,
		PullRequestMergeableState.Mergeable,
		true,
		undefined,
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		PullRequestReviewDecision.Approved,
		undefined,
		[{ isCodeOwner: false, reviewer: reviewer, state: PullRequestReviewState.Approved }],
		undefined,
		PullRequestStatusCheckRollupState.Success,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		1,
		true,
		undefined,
		undefined,
		undefined, // viewerUnresolved
		undefined, // milestone
		mergeQueue,
		options?.mergeQueueRequired,
		options?.mergeQueueRemoval,
	);
}

function createEntry(state: PullRequestMergeQueueState): PullRequestMergeQueueEntry {
	return { state: state, enqueuedAt: new Date(0) };
}

/** What the Launchpad provider does: the shared verdict, then the merge-queue override. */
function categorize(pr: PullRequest): LaunchpadActionCategory {
	const [item] = getActionablePullRequests([toActionablePullRequestInput(pr)], { id: me.id });
	return getLaunchpadActionCategory(item.suggestedActionCategory, pr);
}

suite('Launchpad merge queue categorization', () => {
	test('the shared categorizer calls a queued, approved, green pull request ready to merge', () => {
		// The premise of the override — if this starts failing, provider-apis learned about queues.
		const pr = createReadyPullRequest(createEntry(PullRequestMergeQueueState.Queued));
		const [item] = getActionablePullRequests([toActionablePullRequestInput(pr)], { id: me.id });
		assert.strictEqual(item.suggestedActionCategory, 'readyToMerge');
	});

	for (const state of [
		PullRequestMergeQueueState.Queued,
		PullRequestMergeQueueState.AwaitingChecks,
		PullRequestMergeQueueState.Mergeable,
		PullRequestMergeQueueState.Locked,
	]) {
		test(`a pull request ${state} in the merge queue is In Merge Queue, with no merge action`, () => {
			const category = categorize(createReadyPullRequest(createEntry(state)));
			assert.strictEqual(category, 'queued');

			const group = launchpadCategoryToGroupMap.get(category)!;
			assert.strictEqual(group, 'merge-queue');
			assert.ok(!launchpadPriorityGroups.includes(group));
			assert.ok(!getSuggestedActions(category, false, undefined, false).includes('merge'));
		});
	}

	test("a queued pull request's detail is its merge-queue status", () => {
		const entry = createEntry(PullRequestMergeQueueState.AwaitingChecks);
		assert.strictEqual(
			actionGroupMap.get('queued')![1](null, null, createReadyPullRequest(entry)),
			formatPullRequestMergeQueueStatus(entry),
		);
	});

	test('a pull request failing in the merge queue is Blocked, with no merge action', () => {
		const category = categorize(createReadyPullRequest(createEntry(PullRequestMergeQueueState.Unmergeable)));
		assert.strictEqual(category, 'queue-failing');
		assert.strictEqual(launchpadCategoryToGroupMap.get(category), 'blocked');
		assert.ok(!getSuggestedActions(category, false, undefined, false).includes('merge'));
	});

	test('a pull request not in a merge queue keeps its shared category', () => {
		const pr = createReadyPullRequest();
		assert.strictEqual(getMergeQueueActionCategory(pr), undefined);
		assert.strictEqual(categorize(pr), 'mergeable');
		assert.ok(getSuggestedActions('mergeable', false, undefined, false).includes('merge'));
	});

	test('a shared category Launchpad does not know yet is Other', () => {
		assert.strictEqual(getLaunchpadActionCategory('someFutureCategory', createReadyPullRequest()), 'other');
	});

	test('a queued pull request is In Merge Queue whatever its shared category', () => {
		const pr = createReadyPullRequest(createEntry(PullRequestMergeQueueState.Queued));
		assert.strictEqual(getLaunchpadActionCategory('someFutureCategory', pr), 'queued');
	});
});

suite('Launchpad merge queue suggested actions', () => {
	test('dequeue is suggested for a queued pull request', () => {
		const pr = createReadyPullRequest(createEntry(PullRequestMergeQueueState.Queued));
		const actions = getSuggestedActions(categorize(pr), false, undefined, isPullRequestInMergeQueue(pr));
		assert.deepStrictEqual(actions.slice(0, 2), ['open', 'dequeue']);
	});

	test('dequeue is suggested, after open, for a queued pull request whose entry is failing', () => {
		const pr = createReadyPullRequest(createEntry(PullRequestMergeQueueState.Unmergeable));
		const category = categorize(pr);
		assert.strictEqual(category, 'queue-failing');
		const actions = getSuggestedActions(category, false, undefined, isPullRequestInMergeQueue(pr));
		assert.deepStrictEqual(actions.slice(0, 2), ['open', 'dequeue']);
	});

	test('dequeue is not suggested for a pull request its failed queue run already removed', () => {
		const pr = createReadyPullRequest(undefined, {
			mergeQueueRemoval: { reason: 'failed_checks', removedAt: new Date(60 * 1000) },
		});
		const category = categorize(pr);
		assert.strictEqual(category, 'queue-failing');
		const actions = getSuggestedActions(category, false, undefined, isPullRequestInMergeQueue(pr));
		assert.ok(!actions.includes('dequeue'));
		assert.strictEqual(actions[0], 'open');
	});

	const stack: PullRequestStackInfo = { id: 's', number: 1, size: 3, position: 2, baseRef: 'main' };

	test('rebase-stack is suggested for a stacked pull request that is not queued', () => {
		assert.ok(getSuggestedActions('mergeable', false, stack, false).includes('rebase-stack'));
	});

	for (const category of ['queued', 'queue-failing'] as const) {
		test(`rebase-stack is withheld from a stacked pull request that is ${category}`, () => {
			assert.ok(!getSuggestedActions(category, false, stack, false).includes('rebase-stack'));
		});
	}
});

suite('Launchpad pull request cache expiry', () => {
	const now = 1_000_000;
	const full = now + 30 * 60 * 1000;
	const fiveMinutes = now + 5 * 60 * 1000;

	test('a list with no queued pull request keeps its full expiry', () => {
		assert.strictEqual(getPullRequestsCacheExpiresAt(full, [createReadyPullRequest()], now), full);
		assert.strictEqual(getPullRequestsCacheExpiresAt(full, [], now), full);
		assert.strictEqual(getPullRequestsCacheExpiresAt(full, undefined, now), full);
	});

	for (const state of [PullRequestMergeQueueState.Queued, PullRequestMergeQueueState.Unmergeable]) {
		test(`a list holding a ${state} pull request is capped at five minutes`, () => {
			const prs = [createReadyPullRequest(), createReadyPullRequest(createEntry(state))];
			assert.strictEqual(getPullRequestsCacheExpiresAt(full, prs, now), fiveMinutes);
		});
	}

	test('the cap never extends an expiry that is already shorter', () => {
		const soon = now + 60 * 1000;
		const prs = [createReadyPullRequest(createEntry(PullRequestMergeQueueState.Queued))];
		assert.strictEqual(getPullRequestsCacheExpiresAt(soon, prs, now), soon);
	});
});

suite('Launchpad blocked summary label', () => {
	test('names queue-failing pull requests alongside the other blocked reasons', () => {
		assert.strictEqual(
			getBlockedSummaryLabel(undefined, 2, undefined, 1),
			'(2 have failed CI checks, 1 is failing in the merge queue)',
		);
		assert.strictEqual(
			getBlockedSummaryLabel(1, undefined, 3, 2),
			'(1 needs reviewers, 3 have conflicts, 2 are failing in the merge queue)',
		);
	});

	test('without a queue-failing count the label is unchanged', () => {
		assert.strictEqual(getBlockedSummaryLabel(undefined, 2, undefined), '(2 failed CI checks)');
	});
});

suite('Launchpad merge queue removal', () => {
	// The pull request was last updated at the epoch; a removal at or after it still describes it
	const removedAfterUpdate = new Date(60 * 1000);

	test('a pull request its queue run just failed out of is Blocked, failing in the merge queue, with no merge action', () => {
		const pr = createReadyPullRequest(undefined, {
			mergeQueueRemoval: { reason: 'failed_checks', removedAt: removedAfterUpdate },
		});
		const category = categorize(pr);
		assert.strictEqual(category, 'queue-failing');
		assert.strictEqual(launchpadCategoryToGroupMap.get(category), 'blocked');
		assert.ok(!getSuggestedActions(category, false, undefined, false).includes('merge'));
	});

	test("a failed removal's detail is the removal, naming the failed checks", () => {
		const removal = { reason: 'failed_checks', removedAt: removedAfterUpdate };
		const detail = actionGroupMap.get('queue-failing')![1](
			null,
			null,
			createReadyPullRequest(undefined, { mergeQueueRemoval: removal }),
		);
		assert.strictEqual(detail, formatMergeQueueRemoval(removal));
		assert.ok(detail.includes('checks failed'));
	});

	test('a pull request still failing inside the merge queue keeps the queue detail', () => {
		const detail = actionGroupMap.get('queue-failing')![1](
			null,
			null,
			createReadyPullRequest(createEntry(PullRequestMergeQueueState.Unmergeable)),
		);
		assert.strictEqual(detail, 'The merge queue will remove this pull request');
	});

	test('a pull request removed from the merge queue by hand is not Blocked', () => {
		const pr = createReadyPullRequest(undefined, {
			mergeQueueRemoval: { reason: 'manual', removedAt: removedAfterUpdate },
		});
		assert.strictEqual(getMergeQueueActionCategory(pr), undefined);
		assert.strictEqual(categorize(pr), 'mergeable');
	});

	test('a failed removal that something has updated the pull request since no longer counts', () => {
		const pr = createReadyPullRequest(undefined, {
			mergeQueueRemoval: { reason: 'failed_checks', removedAt: new Date(-60 * 1000) },
		});
		assert.strictEqual(getMergeQueueActionCategory(pr), undefined);
		assert.strictEqual(categorize(pr), 'mergeable');
	});

	test('a queued pull request ignores a removal from before it rejoined', () => {
		const pr = createReadyPullRequest(createEntry(PullRequestMergeQueueState.Queued), {
			mergeQueueRemoval: { reason: 'failed_checks', removedAt: removedAfterUpdate },
		});
		assert.strictEqual(categorize(pr), 'queued');
	});
});

suite('Launchpad merge queue staleness', () => {
	const staleDate = new Date(24 * 60 * 60 * 1000);
	const beforeStaleDate = new Date(60 * 1000);
	const afterStaleDate = new Date(48 * 60 * 60 * 1000);

	test('a pull request still in the merge queue is never stale', () => {
		const pr = createReadyPullRequest(createEntry(PullRequestMergeQueueState.Queued));
		assert.strictEqual(isLaunchpadItemStale(pr, pr.updatedDate, staleDate), false);
	});

	test('an untouched pull request whose failed removal is older than the stale threshold is stale', () => {
		const pr = createReadyPullRequest(undefined, {
			mergeQueueRemoval: { reason: 'failed_checks', removedAt: beforeStaleDate },
		});
		assert.strictEqual(getMergeQueueActionCategory(pr), 'queue-failing');
		assert.strictEqual(isLaunchpadItemStale(pr, pr.updatedDate, staleDate), true);
	});

	test('a pull request whose failed removal is newer than the stale threshold is not stale, and stays queue-failing', () => {
		const pr = createReadyPullRequest(undefined, {
			mergeQueueRemoval: { reason: 'failed_checks', removedAt: afterStaleDate },
		});
		assert.strictEqual(isLaunchpadItemStale(pr, pr.updatedDate, staleDate), false);
		assert.strictEqual(categorize(pr), 'queue-failing');
	});

	test('a pull request with no merge-queue activity is stale by its update date', () => {
		const pr = createReadyPullRequest();
		assert.strictEqual(isLaunchpadItemStale(pr, pr.updatedDate, staleDate), true);
		assert.strictEqual(isLaunchpadItemStale(pr, afterStaleDate, staleDate), false);
	});

	test('nothing is stale without a stale threshold', () => {
		const pr = createReadyPullRequest();
		assert.strictEqual(isLaunchpadItemStale(pr, pr.updatedDate, undefined), false);
	});
});

suite('Launchpad merge queue actions', () => {
	test('a queued pull request offers Remove from Merge Queue', () => {
		assert.ok(getSuggestedActions('queued', false, undefined, true).includes('dequeue'));
	});

	for (const category of ['mergeable', 'queue-failing', 'failed-checks'] as const) {
		test(`a ${category} pull request that is not in the merge queue does not offer Remove from Merge Queue`, () => {
			assert.ok(!getSuggestedActions(category, false, undefined, false).includes('dequeue'));
		});
	}

	test('a pull request whose base branch requires a merge queue is still Ready to Merge, with the merge action', () => {
		// The merge action routes to the queue (see `getPullRequestMergeRoute`); the category and action stay put
		const pr = createReadyPullRequest(undefined, { mergeQueueRequired: true });
		const category = categorize(pr);
		assert.strictEqual(category, 'mergeable');
		assert.ok(getSuggestedActions(category, false, undefined, false).includes('merge'));
	});
});
