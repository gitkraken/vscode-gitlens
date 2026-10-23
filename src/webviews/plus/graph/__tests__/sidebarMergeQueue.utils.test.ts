import * as assert from 'assert';
import type { PullRequest, PullRequestMergeQueueEntry } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import { getMergeQueueBaseBranches, joinPullRequestMergeQueue } from '../sidebarMergeQueue.utils.js';

function pr(
	number: number,
	options?: { state?: string; base?: string; id?: string; mergeQueue?: PullRequestMergeQueueEntry },
): PullRequest {
	return {
		// The paged read puts the provider's internal id here; the number comes from the URL.
		id: options?.id ?? `PR_node${number}`,
		url: `https://github.com/o/a/pull/${number}`,
		state: options?.state ?? 'opened',
		refs: { base: { branch: options?.base ?? 'main' } },
		mergeQueue: options?.mergeQueue,
	} as unknown as PullRequest;
}

const queued: PullRequestMergeQueueEntry = {
	state: PullRequestMergeQueueState.Queued,
	enqueuedAt: new Date('2026-10-27T10:00:00Z'),
	estimatedMergeAt: undefined,
	url: 'https://github.com/o/a/queue/main',
};

suite('sidebarMergeQueue.utils — getMergeQueueBaseBranches', () => {
	test('collects the distinct base branches of open pull requests only', () => {
		assert.deepStrictEqual(
			getMergeQueueBaseBranches([
				pr(1, { base: 'main' }),
				pr(2, { base: 'main' }),
				pr(3, { base: 'release' }),
				pr(4, { base: 'legacy', state: 'merged' }),
			]),
			['main', 'release'],
		);
	});
});

suite('sidebarMergeQueue.utils — joinPullRequestMergeQueue', () => {
	test('joins a queued pull request by the number in its URL, not its node id', () => {
		const joined = joinPullRequestMergeQueue(pr(7), new Map([[7, queued]]));

		assert.strictEqual(joined.state, 'opened');
		assert.strictEqual(joined.mergeQueue, queued);
	});

	test('leaves a pull request with no entry untouched', () => {
		const row = pr(8);

		assert.strictEqual(joinPullRequestMergeQueue(row, new Map([[7, queued]])), row);
		assert.strictEqual(joinPullRequestMergeQueue(row, undefined), row);
	});

	test('prefers the entry the row already carries', () => {
		const own = { ...queued, state: PullRequestMergeQueueState.Mergeable };
		const row = pr(7, { mergeQueue: own });

		assert.strictEqual(joinPullRequestMergeQueue(row, new Map([[7, queued]])).mergeQueue, own);
	});
});
