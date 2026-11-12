import * as assert from 'assert';
import type { PullRequestMergeQueueEntry, PullRequestShape, PullRequestSorting } from '../../models/pullRequest.js';
import { PullRequestMergeQueueState } from '../../models/pullRequest.js';
import {
	formatPullRequestMergeQueueEnqueuedFromNow,
	formatPullRequestMergeQueueStatus,
	getPullRequestComparator,
	getPullRequestDisplayState,
	getPullRequestDisplayStatus,
	getPullRequestMergeQueueRemovalKind,
	getStackedMergeCount,
	isPullRequestInMergeQueue,
	isPullRequestMergeQueueRemovalCurrent,
} from '../pullRequest.utils.js';

suite('pullRequest.utils', () => {
	suite('getStackedMergeCount', () => {
		test('unstacked is always 1', () => {
			assert.strictEqual(getStackedMergeCount(undefined), 1);
			assert.strictEqual(getStackedMergeCount(undefined, { wholeStack: true }), 1);
		});

		test('defaults to this layer and everything below it', () => {
			assert.strictEqual(getStackedMergeCount({ position: 2, size: 4 }), 2);
		});

		test('wholeStack counts every layer', () => {
			assert.strictEqual(getStackedMergeCount({ position: 2, size: 4 }, { wholeStack: true }), 4);
		});
	});

	function queueEntry(overrides?: Partial<PullRequestMergeQueueEntry>): PullRequestMergeQueueEntry {
		return {
			state: PullRequestMergeQueueState.Queued,
			enqueuedAt: new Date('2020-01-01T00:00:00Z'),
			...overrides,
		};
	}

	suite('getPullRequestMergeQueueRemovalKind', () => {
		test("classifies GitHub's failed and manual removals, whatever the case", () => {
			assert.strictEqual(getPullRequestMergeQueueRemovalKind('failed_checks'), 'failed');
			assert.strictEqual(getPullRequestMergeQueueRemovalKind('FAILED_CHECKS'), 'failed');
			assert.strictEqual(getPullRequestMergeQueueRemovalKind('manual'), 'manual');
		});

		test('reads any other reason as other rather than guessing', () => {
			assert.strictEqual(getPullRequestMergeQueueRemovalKind('something_new'), 'other');
			assert.strictEqual(getPullRequestMergeQueueRemovalKind(''), 'other');
		});
	});

	suite('isPullRequestMergeQueueRemovalCurrent', () => {
		const removedAt = new Date('2026-11-06T10:00:00Z');
		const removal = { reason: 'failed_checks', removedAt: removedAt };

		test('a removal nothing has touched the pull request since is current', () => {
			// The removal doesn't move the update time, so it is the earlier of the two.
			assert.strictEqual(
				isPullRequestMergeQueueRemovalCurrent({
					state: 'opened',
					updatedDate: new Date('2026-11-06T09:00:00Z'),
					mergeQueueRemoval: removal,
				}),
				true,
			);
			assert.strictEqual(
				isPullRequestMergeQueueRemovalCurrent({
					state: 'opened',
					updatedDate: removedAt,
					mergeQueueRemoval: removal,
				}),
				true,
				'an update at the same instant is not a later one',
			);
		});

		test('any later update clears it — a push, but also a comment or label', () => {
			assert.strictEqual(
				isPullRequestMergeQueueRemovalCurrent({
					state: 'opened',
					updatedDate: new Date('2026-11-06T10:00:01Z'),
					mergeQueueRemoval: removal,
				}),
				false,
			);
		});

		test('a queued, closed or merged pull request, or one without a removal, has no current removal', () => {
			const updatedDate = new Date('2026-11-06T09:00:00Z');
			assert.strictEqual(
				isPullRequestMergeQueueRemovalCurrent({
					state: 'opened',
					updatedDate: updatedDate,
					mergeQueue: queueEntry(),
					mergeQueueRemoval: removal,
				}),
				false,
			);
			assert.strictEqual(
				isPullRequestMergeQueueRemovalCurrent({
					state: 'closed',
					updatedDate: updatedDate,
					mergeQueueRemoval: removal,
				}),
				false,
			);
			assert.strictEqual(
				isPullRequestMergeQueueRemovalCurrent({
					state: 'merged',
					updatedDate: updatedDate,
					mergeQueueRemoval: removal,
				}),
				false,
			);
			assert.strictEqual(
				isPullRequestMergeQueueRemovalCurrent({
					state: 'opened',
					updatedDate: updatedDate,
				}),
				false,
			);
		});

		test('takes serialized timestamps as webview shapes carry them', () => {
			assert.strictEqual(
				isPullRequestMergeQueueRemovalCurrent({
					state: 'opened',
					updatedDate: new Date('2026-11-06T09:00:00Z').getTime(),
					mergeQueueRemoval: {
						reason: 'manual',
						removedAt: removedAt.getTime(),
					},
				}),
				true,
			);
		});
	});

	suite('getPullRequestDisplayState', () => {
		test('an open pull request with a merge queue entry is queued', () => {
			const pr = { state: 'opened', mergeQueue: queueEntry() } as const;
			assert.strictEqual(isPullRequestInMergeQueue(pr), true);
			assert.strictEqual(getPullRequestDisplayState(pr), 'queued');
		});

		test('an open pull request without a merge queue entry stays opened', () => {
			assert.strictEqual(getPullRequestDisplayState({ state: 'opened' }), 'opened');
		});

		test('a merge queue entry never overrides a non-open state', () => {
			assert.strictEqual(getPullRequestDisplayState({ state: 'merged', mergeQueue: queueEntry() }), 'merged');
			assert.strictEqual(getPullRequestDisplayState({ state: 'closed', mergeQueue: queueEntry() }), 'closed');
		});
	});

	suite('getPullRequestDisplayStatus', () => {
		test('a queued pull request pairs queued with its merge queue status', () => {
			const entry = queueEntry({ state: PullRequestMergeQueueState.AwaitingChecks });
			assert.deepStrictEqual(getPullRequestDisplayStatus({ state: 'opened', mergeQueue: entry }), {
				status: 'queued',
				queueStatus: formatPullRequestMergeQueueStatus(entry),
			});
		});

		test('a queued pull request chip carries its place in the queue', () => {
			assert.deepStrictEqual(
				getPullRequestDisplayStatus({ state: 'opened', mergeQueue: queueEntry({ position: 4 }) }),
				{ status: 'queued', queueStatus: '#4 in the merge queue' },
			);
			// A merged pull request's stale entry doesn't make it queued
			assert.deepStrictEqual(
				getPullRequestDisplayStatus({ state: 'merged', mergeQueue: queueEntry({ position: 4 }) }),
				{ status: 'merged', queueStatus: undefined },
			);
		});

		test('a pull request that is not queued keeps its state and has no queue status', () => {
			assert.deepStrictEqual(getPullRequestDisplayStatus({ state: 'opened' }), {
				status: 'opened',
				queueStatus: undefined,
			});
			assert.deepStrictEqual(getPullRequestDisplayStatus({ state: 'merged', mergeQueue: queueEntry() }), {
				status: 'merged',
				queueStatus: undefined,
			});
		});
	});

	suite('formatPullRequestMergeQueueEnqueuedFromNow', () => {
		test('reads as a queued clause', () => {
			const enqueuedAt = Date.now() - 3 * 60 * 60 * 1000;
			assert.strictEqual(
				formatPullRequestMergeQueueEnqueuedFromNow({ enqueuedAt: enqueuedAt }),
				'queued 3 hours ago',
			);
		});
	});

	suite('formatPullRequestMergeQueueStatus', () => {
		test('words each state', () => {
			const status = (state: PullRequestMergeQueueState): string =>
				formatPullRequestMergeQueueStatus(queueEntry({ state: state }));
			assert.strictEqual(status(PullRequestMergeQueueState.Queued), 'Queued to merge');
			assert.strictEqual(status(PullRequestMergeQueueState.AwaitingChecks), 'Queued to merge, checks running');
			assert.strictEqual(status(PullRequestMergeQueueState.Mergeable), 'Queued to merge, next up');
			assert.strictEqual(status(PullRequestMergeQueueState.Locked), 'Merging');
			assert.strictEqual(status(PullRequestMergeQueueState.Unmergeable), 'Failing in the merge queue');
		});

		test('names the place in the queue when the provider gave one', () => {
			assert.strictEqual(
				formatPullRequestMergeQueueStatus({ state: PullRequestMergeQueueState.Queued, position: 2 }),
				'#2 in the merge queue',
			);
			assert.strictEqual(
				formatPullRequestMergeQueueStatus({ state: PullRequestMergeQueueState.AwaitingChecks, position: 2 }),
				'#2 in the merge queue, checks running',
			);
			assert.strictEqual(
				formatPullRequestMergeQueueStatus({ state: PullRequestMergeQueueState.Mergeable, position: 1 }),
				'#1 in the merge queue, next up',
			);
		});

		test('a merging or failing entry ignores its place in the queue', () => {
			assert.strictEqual(
				formatPullRequestMergeQueueStatus({ state: PullRequestMergeQueueState.Locked, position: 1 }),
				'Merging',
			);
			assert.strictEqual(
				formatPullRequestMergeQueueStatus({ state: PullRequestMergeQueueState.Unmergeable, position: 1 }),
				'Failing in the merge queue',
			);
		});

		const inMinutes = (minutes: number): Date => new Date(Date.now() + minutes * 60 * 1000);

		test('keeps a future estimate after the place in the queue', () => {
			const text = formatPullRequestMergeQueueStatus({
				state: PullRequestMergeQueueState.AwaitingChecks,
				position: 3,
				estimatedMergeAt: inMinutes(60),
			});
			assert.ok(text.startsWith('#3 in the merge queue, checks running, estimated to merge '), text);
		});

		test('appends a future estimate for states that are still waiting', () => {
			const text = formatPullRequestMergeQueueStatus(
				queueEntry({ state: PullRequestMergeQueueState.Mergeable, estimatedMergeAt: inMinutes(12) }),
			);
			assert.match(text, /^Queued to merge, next up, estimated to merge .*12 minutes/);
		});

		test('counts the estimate down from its date rather than from each render', () => {
			// A held entry whose estimate is now only 3 minutes off reads as 3 minutes, not as the 12 it was read with.
			const text = formatPullRequestMergeQueueStatus(
				queueEntry({ state: PullRequestMergeQueueState.AwaitingChecks, estimatedMergeAt: inMinutes(3) }),
			);
			assert.match(text, /estimated to merge .*3 minutes/);
		});

		test('takes the estimate as a timestamp, as the webviews carry it', () => {
			const text = formatPullRequestMergeQueueStatus({
				state: PullRequestMergeQueueState.Mergeable,
				estimatedMergeAt: inMinutes(12).getTime(),
			});
			assert.match(text, /^Queued to merge, next up, estimated to merge .*12 minutes/);
		});

		test('omits an estimate already past', () => {
			assert.strictEqual(
				formatPullRequestMergeQueueStatus(
					queueEntry({ state: PullRequestMergeQueueState.Mergeable, estimatedMergeAt: inMinutes(-2) }),
				),
				'Queued to merge, next up',
			);
			assert.strictEqual(
				formatPullRequestMergeQueueStatus({
					state: PullRequestMergeQueueState.Queued,
					estimatedMergeAt: inMinutes(-2).getTime(),
				}),
				'Queued to merge',
			);
		});

		test('omits the estimate for Locked and Unmergeable', () => {
			assert.strictEqual(
				formatPullRequestMergeQueueStatus(
					queueEntry({ state: PullRequestMergeQueueState.Locked, estimatedMergeAt: inMinutes(10) }),
				),
				'Merging',
			);
			assert.strictEqual(
				formatPullRequestMergeQueueStatus(
					queueEntry({ state: PullRequestMergeQueueState.Unmergeable, estimatedMergeAt: inMinutes(10) }),
				),
				'Failing in the merge queue',
			);
		});
	});

	function mockPr(overrides: Partial<PullRequestShape>): PullRequestShape {
		return {
			type: 'pullrequest',
			provider: { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
			id: '1',
			nodeId: undefined,
			title: 'pr',
			url: 'https://example.com/1',
			createdDate: new Date('2020-01-01T00:00:00Z'),
			updatedDate: new Date('2020-01-01T00:00:00Z'),
			closed: false,
			state: 'opened',
			author: undefined,
			...overrides,
		} as unknown as PullRequestShape;
	}

	function titlesSortedBy(sort: PullRequestSorting, prs: PullRequestShape[]): string[] {
		const comparator = getPullRequestComparator(sort);
		assert.ok(comparator != null, `expected a comparator for '${sort}'`);
		return [...prs].sort(comparator).map(pr => pr.title);
	}

	/**
	 * The comparator behind every MERGED pull-request search read — GitHub's relationship × state facets are unioned in
	 * the facade, so the per-facet server order says nothing about the assembled page. This is the only thing making
	 * that page ordered at all, exactly as `getIssueComparator` is for the merged issue reads.
	 */
	suite('getPullRequestComparator', () => {
		test('orders created dates in both directions', () => {
			const prs = [
				mockPr({ title: 'mid', createdDate: new Date('2020-01-02T00:00:00Z') }),
				mockPr({ title: 'new', createdDate: new Date('2020-01-03T00:00:00Z') }),
				mockPr({ title: 'old', createdDate: new Date('2020-01-01T00:00:00Z') }),
			];

			assert.deepEqual(titlesSortedBy('created:desc', prs), ['new', 'mid', 'old']);
			assert.deepEqual(titlesSortedBy('created:asc', prs), ['old', 'mid', 'new']);
		});

		test('orders updated dates in both directions', () => {
			const prs = [
				mockPr({ title: 'mid', updatedDate: new Date('2020-01-02T00:00:00Z') }),
				mockPr({ title: 'new', updatedDate: new Date('2020-01-03T00:00:00Z') }),
				mockPr({ title: 'old', updatedDate: new Date('2020-01-01T00:00:00Z') }),
			];

			assert.deepEqual(titlesSortedBy('updated:desc', prs), ['new', 'mid', 'old']);
			assert.deepEqual(titlesSortedBy('updated:asc', prs), ['old', 'mid', 'new']);
		});

		// Missing values sort LAST in BOTH directions, which is deliberately not what negating the descending comparator
		// would do — that floats them to the front when ascending. `createdDate`/`updatedDate` are non-optional `Date` on
		// the shape, so an absent one is a normalization gap rather than the type; it still has to compare last.
		test('sorts missing values last in both directions', () => {
			const prs = [
				mockPr({ title: 'none', updatedDate: undefined }),
				mockPr({ title: 'early', updatedDate: new Date('2020-01-01T00:00:00Z') }),
				mockPr({ title: 'late', updatedDate: new Date('2020-01-02T00:00:00Z') }),
			];

			assert.deepEqual(titlesSortedBy('updated:desc', prs), ['late', 'early', 'none']);
			assert.deepEqual(titlesSortedBy('updated:asc', prs), ['early', 'late', 'none']);
		});

		// Two missing values must compare EQUAL. Mapping them to an infinite sentinel instead of partitioning them would
		// make this `NaN`, which makes the comparator inconsistent and the resulting order implementation-defined — a
		// page whose order changes between runs for no visible reason.
		test('treats two missing values as equal rather than incomparable', () => {
			const comparator = getPullRequestComparator('created:desc');
			assert.ok(comparator != null);
			const a = mockPr({ title: 'a', createdDate: undefined });
			const b = mockPr({ title: 'b', createdDate: undefined });

			assert.equal(comparator(a, b), 0);
			assert.equal(comparator(b, a), 0);
		});

		// `undefined` is the signal a merged read uses to REFUSE, so it must be reported for exactly the fields a
		// normalized PR doesn't carry — no more (which would refuse a read that works) and no fewer (which would serve
		// concatenated per-facet runs as if they were ordered). Only `created`/`updated` are derivable from the shape.
		test('reports no comparator for the fields PullRequestShape does not model', () => {
			for (const sort of [
				'comments:desc',
				'reactions:asc',
				'title:desc',
				'closed:asc',
			] as unknown as PullRequestSorting[]) {
				assert.equal(
					getPullRequestComparator(sort),
					undefined,
					`'${sort}' is not derivable from a PullRequestShape`,
				);
			}
			for (const sort of ['created:asc', 'created:desc', 'updated:asc', 'updated:desc'] as PullRequestSorting[]) {
				assert.ok(getPullRequestComparator(sort) != null, `'${sort}' is derivable and must be orderable`);
			}
		});
	});
});
