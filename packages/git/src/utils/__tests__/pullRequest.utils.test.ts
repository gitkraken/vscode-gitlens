import * as assert from 'assert';
import type { PullRequestShape, PullRequestSorting } from '../../models/pullRequest.js';
import { getPullRequestComparator } from '../pullRequest.utils.js';

/**
 * The comparator behind every MERGED pull-request search read — GitHub's relationship × state facets are unioned in
 * the facade, so the per-facet server order says nothing about the assembled page. This is the only thing making
 * that page ordered at all, exactly as `getIssueComparator` is for the merged issue reads.
 */

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
