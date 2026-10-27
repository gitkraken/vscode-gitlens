import * as assert from 'node:assert';
import { getAutolinkIcon } from '../providerIcons.js';

suite('Autolink issue state icons', () => {
	test('does not give an unclassified issue an open or closed color', () => {
		assert.deepStrictEqual(getAutolinkIcon('issue', undefined), { icon: 'issues', modifier: 'issue' });
	});

	test('preserves positively known issue states', () => {
		assert.deepStrictEqual(getAutolinkIcon('issue', 'opened'), { icon: 'issues', modifier: 'issue-opened' });
		assert.deepStrictEqual(getAutolinkIcon('issue', 'closed'), { icon: 'pass', modifier: 'issue-closed' });
	});

	test('preserves pull request states, drafts, and the default', () => {
		assert.deepStrictEqual(getAutolinkIcon('pr', 'opened'), { icon: 'git-pull-request', modifier: 'pr-opened' });
		assert.deepStrictEqual(getAutolinkIcon('pr', 'closed'), {
			icon: 'git-pull-request-closed',
			modifier: 'pr-closed',
		});
		assert.deepStrictEqual(getAutolinkIcon('pr', 'merged'), { icon: 'git-merge', modifier: 'pr-merged' });
		assert.deepStrictEqual(getAutolinkIcon('pr', 'opened', true), {
			icon: 'git-pull-request-draft',
			modifier: 'pr-draft',
		});
		assert.deepStrictEqual(getAutolinkIcon('pr'), { icon: 'git-merge', modifier: 'pr-merged' });
	});
});
