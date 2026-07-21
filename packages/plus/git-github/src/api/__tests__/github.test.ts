import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
import { toGitHubSearchStateQualifier } from '../github.js';

suite('toGitHubSearchStateQualifier', () => {
	const cases: [label: string, state: PullRequestStateFilter | undefined, expected: string][] = [
		['undefined -> open-only default', undefined, 'is:open'],
		['open', 'open', 'is:open'],
		['merged', 'merged', 'is:merged'],
		['closed (not merged)', 'closed', 'is:closed is:unmerged'],
		['all states -> no qualifier', 'all', ''],
	];

	for (const [label, state, expected] of cases) {
		test(label, () => {
			assert.strictEqual(toGitHubSearchStateQualifier(state), expected);
		});
	}
});
