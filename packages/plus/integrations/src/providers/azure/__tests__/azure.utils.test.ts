import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { getAzurePullRequestIdentityFromMaybeUrl } from '../azure.utils.js';

suite('Test Azure PR URL parsing to identity: getAzurePullRequestIdentityFromMaybeUrl()', () => {
	function t(message: string, url: string, expected: { ownerAndRepo: string; prNumber: string } | undefined) {
		assert.deepStrictEqual(
			getAzurePullRequestIdentityFromMaybeUrl(url),
			expected == null
				? undefined
				: { ownerAndRepo: expected.ownerAndRepo, prNumber: expected.prNumber, provider: undefined },
			`Parse: ${message} (${JSON.stringify(url)})`,
		);
	}

	test('dev.azure.com names org and project as the two segments before _git', () => {
		t(
			'{org}/{project}/_git/{repo}/pullrequest/{id}',
			'https://dev.azure.com/myorg/Project/_git/Repo/pullrequest/42',
			{ ownerAndRepo: 'myorg/Project', prNumber: '42' },
		);
	});

	test('Azure DevOps Server behind a virtual directory ignores the leading segment', () => {
		t(
			'tfs/{collection}/{project}/_git/{repo}/pullrequest/{id}',
			'https://azure.example.com/tfs/collection/Project/_git/Repo/pullrequest/7',
			{ ownerAndRepo: 'collection/Project', prNumber: '7' },
		);
	});

	test('a legacy visualstudio.com host names the org from the subdomain', () => {
		t(
			'{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}',
			'https://myorg.visualstudio.com/Project/_git/Repo/pullrequest/9',
			{ ownerAndRepo: 'myorg/Project', prNumber: '9' },
		);
	});

	test('the short {org}/_git/{repo} form names the project after the repo', () => {
		t('{org}/_git/{repo}/pullrequest/{id}', 'https://dev.azure.com/myorg/_git/Repo/pullrequest/3', {
			ownerAndRepo: 'myorg/Repo',
			prNumber: '3',
		});
	});

	test('a url naming no pull request does not match', () => {
		t('repository url with no pull request segment', 'https://dev.azure.com/myorg/Project/_git/Repo', undefined);
	});
});
