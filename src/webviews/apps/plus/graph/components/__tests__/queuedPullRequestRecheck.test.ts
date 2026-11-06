import * as assert from 'assert';
import * as sinon from 'sinon';
import { PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import type { GraphSidebarPullRequest } from '../../../../../plus/graph/protocol.js';
import type { QueueablePullRequest } from '../../../shared/mergeQueue.utils.js';
import {
	getQueuedPullRequestRefreshOutcome,
	getQueuedPullRequestSheetNumbers,
	PausableRecheckTimer,
} from '../queuedPullRequestRecheck.js';
import type { SheetDescriptor } from '../sheetStack.js';

const delay = 1000;

const queued: QueueablePullRequest = {
	state: 'opened',
	mergeQueue: { state: PullRequestMergeQueueState.Queued, url: 'https://github.com/o/r/queue/main' },
};

function sheetPullRequest(number: string, queue?: PullRequestMergeQueueState): GraphSidebarPullRequest {
	return {
		number: number,
		id: `id-${number}`,
		title: 'Some pull request',
		state: 'opened',
		url: `https://github.com/o/r/pull/${number}`,
		mergeQueue:
			queue != null ? { state: queue, url: 'https://github.com/o/r/queue/main', enqueuedAt: 0 } : undefined,
	};
}

function pullRequestSheet(
	pr: GraphSidebarPullRequest | undefined,
	number: string = pr?.number ?? '1',
	layers?: GraphSidebarPullRequest[],
): SheetDescriptor {
	return { kind: 'pullRequest', target: { number: number }, pr: pr, layers: layers };
}

suite('graph/components/queuedPullRequestRecheck', () => {
	suite('PausableRecheckTimer', () => {
		let clock: sinon.SinonFakeTimers;
		let visibility: EventTarget;
		let timer: PausableRecheckTimer;
		let controller: AbortController;
		let fired: number;

		const hide = (): boolean => visibility.dispatchEvent(new Event('webview-hidden'));
		const show = (): boolean => visibility.dispatchEvent(new Event('webview-visible'));
		const schedule = (): void =>
			timer.schedule(() => {
				fired++;
			}, controller.signal);

		setup(() => {
			clock = sinon.useFakeTimers();
			visibility = new EventTarget();
			timer = new PausableRecheckTimer(delay, () => visibility);
			controller = new AbortController();
			fired = 0;
		});

		teardown(() => {
			timer.dispose();
			clock.restore();
		});

		test('fires once after the delay while visible', () => {
			schedule();
			clock.tick(delay - 1);
			assert.strictEqual(fired, 0);
			clock.tick(1);
			assert.strictEqual(fired, 1);
			assert.strictEqual(timer.pending, false);
			clock.tick(delay * 5);
			assert.strictEqual(fired, 1);
		});

		test('does not fire while hidden, even long past due', () => {
			schedule();
			hide();
			clock.tick(delay * 10);
			assert.strictEqual(fired, 0);
			assert.strictEqual(timer.pending, true);
		});

		test('fires immediately when shown after coming due while hidden', () => {
			schedule();
			clock.tick(delay / 2);
			hide();
			clock.tick(delay);
			show();
			assert.strictEqual(fired, 1);
		});

		test('resumes only the remaining delay when shown before coming due', () => {
			schedule();
			clock.tick(delay / 4);
			hide();
			clock.tick(delay / 4);
			show();
			assert.strictEqual(fired, 0);
			clock.tick(delay / 2 - 1);
			assert.strictEqual(fired, 0);
			clock.tick(1);
			assert.strictEqual(fired, 1);
		});

		test('a recheck scheduled while hidden starts parked', () => {
			schedule();
			hide();
			schedule();
			clock.tick(delay * 2);
			assert.strictEqual(fired, 0);
			show();
			assert.strictEqual(fired, 1);
		});

		test('rescheduling replaces the pending recheck', () => {
			schedule();
			clock.tick(delay / 2);
			schedule();
			clock.tick(delay / 2);
			assert.strictEqual(fired, 0);
			clock.tick(delay / 2);
			assert.strictEqual(fired, 1);
		});

		test('aborting the signal stops a pending recheck, visible or hidden', () => {
			schedule();
			controller.abort();
			clock.tick(delay * 2);
			assert.strictEqual(fired, 0);

			controller = new AbortController();
			schedule();
			hide();
			controller.abort();
			show();
			clock.tick(delay * 2);
			assert.strictEqual(fired, 0);
			assert.strictEqual(timer.pending, false);
		});

		test('does not schedule against an already-aborted signal', () => {
			controller.abort();
			schedule();
			assert.strictEqual(timer.pending, false);
			clock.tick(delay * 2);
			assert.strictEqual(fired, 0);
		});

		test('holds at most one abort listener on the signal across reschedules and fires', () => {
			const add = sinon.spy(controller.signal, 'addEventListener');
			const remove = sinon.spy(controller.signal, 'removeEventListener');
			for (let i = 0; i < 5; i++) {
				schedule();
				clock.tick(delay);
			}
			schedule();
			assert.strictEqual(fired, 5);
			assert.strictEqual(add.callCount - remove.callCount, 1);
			timer.cancel();
			assert.strictEqual(add.callCount - remove.callCount, 0);
		});

		test('dispose stops a pending recheck and stops listening for visibility', () => {
			const remove = sinon.spy(visibility, 'removeEventListener');
			schedule();
			timer.dispose();
			clock.tick(delay * 2);
			show();
			assert.strictEqual(fired, 0);
			assert.deepStrictEqual(remove.args.map(a => a[0]).sort(), ['webview-hidden', 'webview-visible']);
		});

		test('dispose while hidden resets visibility, so the next schedule fires without a visible event', () => {
			schedule();
			hide();
			timer.dispose();
			schedule();
			clock.tick(delay);
			assert.strictEqual(fired, 1);
		});
	});

	suite('getQueuedPullRequestRefreshOutcome', () => {
		test('stays queued while the refreshed pull request is still queued', () => {
			assert.strictEqual(
				getQueuedPullRequestRefreshOutcome(queued, { status: 'fulfilled', value: queued }),
				'still-queued',
			);
		});

		test('leaves the queue when the refreshed pull request merged, closed or was dequeued', () => {
			for (const value of [{ ...queued, state: 'merged' }, { ...queued, state: 'closed' }, { state: 'opened' }]) {
				assert.strictEqual(
					getQueuedPullRequestRefreshOutcome(queued, { status: 'fulfilled', value: value }),
					'left-queue',
					`not left for ${JSON.stringify(value)}`,
				);
			}
		});

		test('retries a failed refresh while the shown pull request is queued', () => {
			assert.strictEqual(
				getQueuedPullRequestRefreshOutcome(queued, { status: 'rejected', reason: new Error('boom') }),
				'retry',
			);
		});

		test('leaves the queue when the refresh finds no pull request (merged, head branch deleted)', () => {
			assert.strictEqual(
				getQueuedPullRequestRefreshOutcome(queued, { status: 'fulfilled', value: undefined }),
				'left-queue',
			);
		});

		test('stops when the shown pull request is no longer queued', () => {
			for (const shown of [undefined, { state: 'opened' }, { ...queued, state: 'merged' }]) {
				assert.strictEqual(
					getQueuedPullRequestRefreshOutcome(shown, { status: 'fulfilled', value: queued }),
					'stop',
				);
				assert.strictEqual(
					getQueuedPullRequestRefreshOutcome(shown, { status: 'rejected', reason: new Error('boom') }),
					'stop',
				);
			}
		});
	});

	suite('getQueuedPullRequestSheetNumbers', () => {
		test('is empty without an open pull request sheet showing a queued pull request', () => {
			assert.deepStrictEqual(getQueuedPullRequestSheetNumbers([]), []);
			assert.deepStrictEqual(
				getQueuedPullRequestSheetNumbers([
					{ kind: 'compare' },
					pullRequestSheet(sheetPullRequest('1')),
					pullRequestSheet({ ...sheetPullRequest('2', PullRequestMergeQueueState.Queued), state: 'merged' }),
				]),
				[],
			);
		});

		test("skips a sheet that's still resolving", () => {
			assert.deepStrictEqual(getQueuedPullRequestSheetNumbers([pullRequestSheet(undefined, '7')]), []);
		});

		test('lists every open sheet showing a queued pull request, failing entries included, once each', () => {
			assert.deepStrictEqual(
				getQueuedPullRequestSheetNumbers([
					pullRequestSheet(sheetPullRequest('4', PullRequestMergeQueueState.Queued)),
					{ kind: 'compare' },
					pullRequestSheet(sheetPullRequest('5')),
					pullRequestSheet(sheetPullRequest('6', PullRequestMergeQueueState.Unmergeable)),
					pullRequestSheet(sheetPullRequest('4', PullRequestMergeQueueState.Queued), '4'),
				]),
				['4', '6'],
			);
		});

		test('includes queued stack layers, skips unqueued ones, and dedupes across the sheet pull request and layers', () => {
			const q = PullRequestMergeQueueState.Queued;
			assert.deepStrictEqual(
				getQueuedPullRequestSheetNumbers([
					pullRequestSheet(sheetPullRequest('10', q), '10', [
						sheetPullRequest('10', q),
						sheetPullRequest('11', q),
						sheetPullRequest('12'),
						{ ...sheetPullRequest('13', q), state: 'merged' },
					]),
					// The sheet's own pull request isn't queued, but a lower layer is
					pullRequestSheet(sheetPullRequest('20'), '20', [
						sheetPullRequest('20'),
						sheetPullRequest('11', q),
						sheetPullRequest('21', q),
					]),
				]),
				['10', '11', '21'],
			);
		});
	});
});
