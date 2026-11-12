import * as assert from 'assert';
import { PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import type { MergeTargetQueueState, QueueablePullRequest } from '../mergeQueue.utils.js';
import {
	getMergeTargetQueueTreatment,
	getQueuedPullRequestEntry,
	isMergeQueueEntryFailing,
	isPullRequestQueued,
} from '../mergeQueue.utils.js';

const allQueueStates = [
	PullRequestMergeQueueState.Queued,
	PullRequestMergeQueueState.AwaitingChecks,
	PullRequestMergeQueueState.Mergeable,
	PullRequestMergeQueueState.Unmergeable,
	PullRequestMergeQueueState.Locked,
];

function queued(state: PullRequestMergeQueueState = PullRequestMergeQueueState.Queued): QueueablePullRequest {
	return { state: 'opened', mergeQueue: { state: state, url: 'https://github.com/o/r/queue/main' } };
}

suite('plus/shared/mergeQueue.utils', () => {
	suite('isPullRequestQueued', () => {
		test('every queue entry state counts as queued, failing included', () => {
			for (const state of allQueueStates) {
				assert.strictEqual(isPullRequestQueued(queued(state)), true, `not queued for ${state}`);
			}
		});

		test('an open pull request without an entry is not queued', () => {
			assert.strictEqual(isPullRequestQueued({ state: 'opened' }), false);
			assert.strictEqual(isPullRequestQueued(undefined), false);
		});

		test('a merged or closed pull request is not queued, even carrying a stale entry', () => {
			for (const state of ['merged', 'closed']) {
				const pr = { ...queued(), state: state };
				assert.strictEqual(isPullRequestQueued(pr), false, `queued while ${state}`);
				assert.strictEqual(getQueuedPullRequestEntry(pr), undefined, `entry returned while ${state}`);
			}
		});
	});

	test('isMergeQueueEntryFailing is true only for Unmergeable', () => {
		for (const state of allQueueStates) {
			assert.strictEqual(
				isMergeQueueEntryFailing({ state: state }),
				state === PullRequestMergeQueueState.Unmergeable,
				`wrong for ${state}`,
			);
		}
	});

	suite('getMergeTargetQueueTreatment', () => {
		const states: MergeTargetQueueState[] = ['merged', 'conflicts', 'behind', 'in-sync'];

		test('leaves every state alone when the pull request is not queued', () => {
			for (const pr of [undefined, { state: 'opened' }, { ...queued(), state: 'merged' }]) {
				for (const state of states) {
					assert.strictEqual(getMergeTargetQueueTreatment(pr, state), 'default', `changed ${state}`);
				}
			}
		});

		test('while queued: conflicts warn, behind is left to the queue, merged and in-sync are unchanged', () => {
			for (const entryState of allQueueStates) {
				const pr = queued(entryState);
				assert.strictEqual(getMergeTargetQueueTreatment(pr, 'conflicts'), 'warning', entryState);
				assert.strictEqual(getMergeTargetQueueTreatment(pr, 'behind'), 'queue-handled', entryState);
				assert.strictEqual(getMergeTargetQueueTreatment(pr, 'merged'), 'default', entryState);
				assert.strictEqual(getMergeTargetQueueTreatment(pr, 'in-sync'), 'default', entryState);
			}
		});
	});
});
