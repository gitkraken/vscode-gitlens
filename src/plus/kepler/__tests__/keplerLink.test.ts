import * as assert from 'node:assert';
import { createKeplerTaskLink } from '../keplerLink.js';

suite('createKeplerTaskLink', () => {
	test('with no params, builds the bare canonical route', () => {
		assert.strictEqual(createKeplerTaskLink('kepler://', {}), 'kepler://task/new');
	});

	test('with every param, includes all of them in order', () => {
		const link = createKeplerTaskLink('kepler://', {
			url: 'https://github.com/gitkraken/vscode-gitlens/pull/1',
			kind: 'pr',
			provider: 'github',
			repo: '/Users/keith/code/vscode-gitlens',
			action: 'default-review',
		});

		assert.strictEqual(
			link,
			'kepler://task/new?url=https%3A%2F%2Fgithub.com%2Fgitkraken%2Fvscode-gitlens%2Fpull%2F1&kind=pr&provider=github&repo=%2FUsers%2Fkeith%2Fcode%2Fvscode-gitlens&action=default-review',
		);
	});

	test('with a partial set of params, omits the absent ones entirely rather than leaving them empty', () => {
		const link = createKeplerTaskLink('kepler://', { kind: 'issue', provider: 'jira' });

		assert.strictEqual(link, 'kepler://task/new?kind=issue&provider=jira');
		assert.ok(!link.includes('url='));
		assert.ok(!link.includes('repo='));
		assert.ok(!link.includes('action='));
	});

	test('URL-encodes a repo path containing spaces', () => {
		const link = createKeplerTaskLink('kepler://', { repo: '/Users/keith/code/my project' });

		assert.strictEqual(link, 'kepler://task/new?repo=%2FUsers%2Fkeith%2Fcode%2Fmy%20project');
	});

	test('respects the scheme passed in for non-production channels', () => {
		assert.strictEqual(
			createKeplerTaskLink('kepler-staging://', { kind: 'pr' }),
			'kepler-staging://task/new?kind=pr',
		);
	});
});
