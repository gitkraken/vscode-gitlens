import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { PullRequestState } from '@gitlens/git/models/pullRequest.js';
import { filterPullRequestsBySearchState, toGitHubSearchStateQualifier } from '../github.js';

suite('toGitHubSearchStateQualifier', () => {
	const cases: [label: string, include: PullRequestState[] | undefined, expected: string][] = [
		['undefined -> open-only default', undefined, 'is:open'],
		['empty -> open-only default', [], 'is:open'],
		['opened', ['opened'], 'is:open'],
		['merged', ['merged'], 'is:merged'],
		['closed (not merged)', ['closed'], 'is:closed is:unmerged'],
		['closed + merged', ['closed', 'merged'], 'is:closed'],
		['opened + closed', ['opened', 'closed'], 'is:unmerged'],
		['opened + merged (not expressible, no qualifier)', ['opened', 'merged'], ''],
		['all states -> no qualifier', ['opened', 'closed', 'merged'], ''],
	];

	for (const [label, include, expected] of cases) {
		test(label, () => {
			assert.strictEqual(toGitHubSearchStateQualifier(include), expected);
		});
	}

	test('is order-independent', () => {
		assert.strictEqual(toGitHubSearchStateQualifier(['merged', 'closed']), 'is:closed');
		assert.strictEqual(toGitHubSearchStateQualifier(['closed', 'opened']), 'is:unmerged');
	});
});

suite('filterPullRequestsBySearchState', () => {
	const prs: { id: string; state: PullRequestState }[] = [
		{ id: '1', state: 'opened' },
		{ id: '2', state: 'closed' },
		{ id: '3', state: 'merged' },
	];

	const ids = (include: PullRequestState[] | undefined) =>
		filterPullRequestsBySearchState(prs, include).map(pr => pr.id);

	test('defaults to open-only', () => {
		assert.deepStrictEqual(ids(undefined), ['1']);
		assert.deepStrictEqual(ids([]), ['1']);
	});

	test('filters non-exact GitHub search combinations', () => {
		assert.deepStrictEqual(ids(['opened', 'merged']), ['1', '3']);
		assert.deepStrictEqual(ids(['opened', 'closed', 'merged']), ['1', '2', '3']);
	});
});
