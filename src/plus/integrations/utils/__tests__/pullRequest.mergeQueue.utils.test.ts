import * as assert from 'assert';
import type { PullRequestMergeQueueActionFailureReason } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import {
	formatMergeQueueRemoval,
	getMergeQueueActionFailureMessage,
	getPullRequestMergeRoute,
	isMergeQueueRemovalFailed,
} from '../pullRequest.mergeQueue.utils.js';

const queuedEntry = { state: PullRequestMergeQueueState.Queued, enqueuedAt: 0 };

suite('Merge queue removal text', () => {
	const removedAt = Date.now() - 5 * 60 * 1000;

	test('a failed queue run names the failed checks', () => {
		const removal = { reason: 'failed_checks', removedAt: removedAt };
		assert.ok(isMergeQueueRemovalFailed(removal));
		const text = formatMergeQueueRemoval(removal);
		assert.ok(text.startsWith('Removed from the merge queue '), text);
		assert.ok(text.endsWith(' — checks failed'), text);
	});

	test('a removal by hand, or for a reason not recognized, gives no reason', () => {
		for (const reason of ['manual', 'MANUAL', 'something_new', '']) {
			const removal = { reason: reason, removedAt: new Date(removedAt) };
			assert.ok(!isMergeQueueRemovalFailed(removal), reason);
			const text = formatMergeQueueRemoval(removal);
			assert.ok(text.startsWith('Removed from the merge queue '), text);
			assert.ok(!text.includes('checks failed'), text);
			assert.ok(reason === '' || !text.includes(reason), text);
		}
	});
});

suite('Merge routing', () => {
	test('a pull request whose base branch requires a merge queue is added to the queue', () => {
		assert.strictEqual(getPullRequestMergeRoute({ state: 'opened', mergeQueueRequired: true }), 'enqueue');
	});

	test('a queued pull request is not merged or queued again', () => {
		assert.strictEqual(
			getPullRequestMergeRoute({ state: 'opened', mergeQueue: queuedEntry, mergeQueueRequired: true }),
			'queued',
		);
		assert.strictEqual(getPullRequestMergeRoute({ state: 'opened', mergeQueue: queuedEntry }), 'queued');
	});

	test('merges directly when no queue is required, or when it is unknown', () => {
		assert.strictEqual(getPullRequestMergeRoute({ state: 'opened', mergeQueueRequired: false }), 'merge');
		assert.strictEqual(getPullRequestMergeRoute({ state: 'opened' }), 'merge');
	});

	test('a stacked merge of more than one pull request keeps the stacked merge path', () => {
		const stack = { position: 2, size: 3 };
		assert.strictEqual(
			getPullRequestMergeRoute({ state: 'opened', mergeQueueRequired: true, stack: stack }),
			'merge',
		);
		// The bottom layer merges alone, so it routes like an unstacked pull request — unless the whole stack lands
		assert.strictEqual(
			getPullRequestMergeRoute({ state: 'opened', mergeQueueRequired: true, stack: { position: 1, size: 3 } }),
			'enqueue',
		);
		assert.strictEqual(
			getPullRequestMergeRoute(
				{ state: 'opened', mergeQueueRequired: true, stack: { position: 1, size: 3 } },
				{ wholeStack: true },
			),
			'merge',
		);
	});
});

suite('Merge queue action failure messages', () => {
	const enqueueReasons: PullRequestMergeQueueActionFailureReason[] = [
		'already-queued',
		'head-changed',
		'not-allowed',
		'permission',
		'unsupported',
		'unknown',
	];

	test('each reason for a failed add reads differently, naming the pull request', () => {
		const messages = enqueueReasons.map(reason => getMergeQueueActionFailureMessage('enqueue', '12', reason));
		assert.strictEqual(new Set(messages).size, messages.length);
		for (const message of messages) {
			assert.ok(message.startsWith('Unable to add #12 to the merge queue'), message);
		}
		assert.strictEqual(
			getMergeQueueActionFailureMessage('enqueue', '12', 'already-queued'),
			"Unable to add #12 to the merge queue: it's already queued",
		);
		assert.strictEqual(
			getMergeQueueActionFailureMessage('enqueue', '12', 'unknown'),
			'Unable to add #12 to the merge queue',
		);
	});

	test('a failed removal names the reasons that apply to it, and is generic otherwise', () => {
		assert.strictEqual(
			getMergeQueueActionFailureMessage('dequeue', '12', 'permission'),
			"Unable to remove #12 from the merge queue: you don't have permission",
		);
		for (const reason of ['unknown', 'already-queued', 'head-changed', 'not-allowed'] as const) {
			assert.strictEqual(
				getMergeQueueActionFailureMessage('dequeue', '12', reason),
				'Unable to remove #12 from the merge queue',
				reason,
			);
		}
	});
});
