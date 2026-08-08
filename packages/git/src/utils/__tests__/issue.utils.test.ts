import * as assert from 'assert';
import type { IssueShape, IssueSorting } from '../../models/issue.js';
import { getIssueComparator } from '../issue.utils.js';

/**
 * The comparator behind every MERGED issue read — GitHub's aliased searches, GitLab across repositories, Azure and
 * the issue trackers across projects. What it gets wrong is not a cosmetic ordering bug: those reads publish a page
 * assembled from several provider queries, so this is the only thing making that page ordered at all.
 */

function mockIssue(overrides: Partial<IssueShape>): IssueShape {
	return {
		type: 'issue',
		provider: { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
		id: '1',
		nodeId: undefined,
		title: 'issue',
		url: 'https://example.com/1',
		createdDate: new Date('2020-01-01T00:00:00Z'),
		updatedDate: new Date('2020-01-01T00:00:00Z'),
		closed: false,
		state: 'opened',
		author: undefined,
		assignees: [],
		...overrides,
	} as unknown as IssueShape;
}

function titlesSortedBy(sort: IssueSorting, issues: IssueShape[]): string[] {
	const comparator = getIssueComparator(sort);
	assert.ok(comparator != null, `expected a comparator for '${sort}'`);
	return [...issues].sort(comparator).map(i => i.title);
}

suite('getIssueComparator', () => {
	test('orders dates in both directions', () => {
		const issues = [
			mockIssue({ title: 'mid', updatedDate: new Date('2020-01-02T00:00:00Z') }),
			mockIssue({ title: 'new', updatedDate: new Date('2020-01-03T00:00:00Z') }),
			mockIssue({ title: 'old', updatedDate: new Date('2020-01-01T00:00:00Z') }),
		];

		assert.deepEqual(titlesSortedBy('updated:desc', issues), ['new', 'mid', 'old']);
		assert.deepEqual(titlesSortedBy('updated:asc', issues), ['old', 'mid', 'new']);
	});

	test('orders counts and titles, not only dates', () => {
		const byComments = [
			mockIssue({ title: 'few', commentsCount: 1 }),
			mockIssue({ title: 'many', commentsCount: 9 }),
		];
		assert.deepEqual(titlesSortedBy('comments:desc', byComments), ['many', 'few']);

		const byTitle = [mockIssue({ title: 'b' }), mockIssue({ title: 'a' })];
		assert.deepEqual(titlesSortedBy('title:asc', byTitle), ['a', 'b']);
	});

	// Missing values sort LAST in BOTH directions, which is deliberately not what negating the descending
	// comparator would do — that floats them to the front when ascending, putting "no due date"/"never closed"
	// above every real value. Half the fields on `IssueShape` are optional, so this is the common case, not an edge.
	test('sorts missing values last in both directions', () => {
		const issues = [
			mockIssue({ title: 'none', closedDate: undefined }),
			mockIssue({ title: 'early', closedDate: new Date('2020-01-01T00:00:00Z') }),
			mockIssue({ title: 'late', closedDate: new Date('2020-01-02T00:00:00Z') }),
		];

		assert.deepEqual(titlesSortedBy('closed:desc', issues), ['late', 'early', 'none']);
		assert.deepEqual(titlesSortedBy('closed:asc', issues), ['early', 'late', 'none']);
	});

	// Two missing values must compare EQUAL. Mapping them to an infinite sentinel instead of partitioning them
	// would make this `NaN`, which makes the comparator inconsistent and the resulting order implementation-defined
	// — a page whose order changes between runs for no visible reason.
	test('treats two missing values as equal rather than incomparable', () => {
		const comparator = getIssueComparator('closed:desc');
		assert.ok(comparator != null);
		const a = mockIssue({ title: 'a' });
		const b = mockIssue({ title: 'b' });

		assert.equal(comparator(a, b), 0);
		assert.equal(comparator(b, a), 0);
	});

	// `undefined` is the signal a merged read uses to REFUSE, so it must be reported for exactly the fields a
	// normalized issue doesn't carry — no more (which would refuse a read that works) and no fewer (which would
	// serve concatenated per-scope runs as if they were ordered).
	test('reports no comparator for the fields IssueShape does not model', () => {
		for (const sort of ['priority:desc', 'dueDate:asc', 'resolved:desc'] as IssueSorting[]) {
			assert.equal(getIssueComparator(sort), undefined, `'${sort}' is not derivable from an IssueShape`);
		}
		for (const sort of [
			'created:asc',
			'updated:desc',
			'closed:asc',
			'comments:desc',
			'reactions:asc',
			'title:desc',
		] as IssueSorting[]) {
			assert.ok(getIssueComparator(sort) != null, `'${sort}' is derivable and must be orderable`);
		}
	});
});
