import * as assert from 'assert';
import type {
	PullRequestMember,
	PullRequestMergeQueueEntry,
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
import { formatPullRequestMergeQueueStatus } from '@gitlens/git/utils/pullRequest.utils.js';
import {
	getActionablePullRequests,
	toProviderPullRequestWithUniqueId,
} from '@gitlens/integrations/providers/models.js';
import { getPullRequestsCacheExpiresAt, getSuggestedActions } from '../launchpadProvider.js';
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

/** An open pull request the viewer authored, approved with passing checks and no conflicts. */
function createReadyPullRequest(mergeQueue?: PullRequestMergeQueueEntry): PullRequest {
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
	);
}

function createEntry(state: PullRequestMergeQueueState): PullRequestMergeQueueEntry {
	return { state: state, enqueuedAt: new Date(0) };
}

/** What the Launchpad provider does: the shared verdict, then the merge-queue override. */
function categorize(pr: PullRequest): LaunchpadActionCategory {
	const [item] = getActionablePullRequests([toProviderPullRequestWithUniqueId(pr)], { id: me.id });
	return getLaunchpadActionCategory(item.suggestedActionCategory, pr);
}

suite('Launchpad merge queue categorization', () => {
	test('the shared categorizer calls a queued, approved, green pull request ready to merge', () => {
		// The premise of the override — if this starts failing, provider-apis learned about queues.
		const pr = createReadyPullRequest(createEntry(PullRequestMergeQueueState.Queued));
		const [item] = getActionablePullRequests([toProviderPullRequestWithUniqueId(pr)], { id: me.id });
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
			assert.ok(!getSuggestedActions(category, false, undefined).includes('merge'));
		});
	}

	test("a queued pull request's detail is its merge-queue status", () => {
		const entry = createEntry(PullRequestMergeQueueState.AwaitingChecks);
		assert.strictEqual(
			actionGroupMap.get('queued')![1](null, null, entry),
			formatPullRequestMergeQueueStatus(entry),
		);
	});

	test('a pull request failing in the merge queue is Blocked, with no merge action', () => {
		const category = categorize(createReadyPullRequest(createEntry(PullRequestMergeQueueState.Unmergeable)));
		assert.strictEqual(category, 'queue-failing');
		assert.strictEqual(launchpadCategoryToGroupMap.get(category), 'blocked');
		assert.ok(!getSuggestedActions(category, false, undefined).includes('merge'));
	});

	test('a pull request not in a merge queue keeps its shared category', () => {
		const pr = createReadyPullRequest();
		assert.strictEqual(getMergeQueueActionCategory(pr), undefined);
		assert.strictEqual(categorize(pr), 'mergeable');
		assert.ok(getSuggestedActions('mergeable', false, undefined).includes('merge'));
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
	const stack: PullRequestStackInfo = { id: 's', number: 1, size: 3, position: 2, baseRef: 'main' };

	test('rebase-stack is suggested for a stacked pull request that is not queued', () => {
		assert.ok(getSuggestedActions('mergeable', false, stack).includes('rebase-stack'));
	});

	for (const category of ['queued', 'queue-failing'] as const) {
		test(`rebase-stack is withheld from a stacked pull request that is ${category}`, () => {
			assert.ok(!getSuggestedActions(category, false, stack).includes('rebase-stack'));
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
