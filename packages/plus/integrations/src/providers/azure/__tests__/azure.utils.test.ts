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

	test('a legacy visualstudio.com url may still name the DefaultCollection segment (#5999)', () => {
		t(
			'{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}/pullrequest/{id}',
			'https://myorg.visualstudio.com/DefaultCollection/Project/_git/Repo/pullrequest/9',
			{ ownerAndRepo: 'myorg/Project', prNumber: '9' },
		);
		t(
			'{org}.visualstudio.com/defaultcollection/_git/{repo}/pullrequest/{id}',
			'https://myorg.visualstudio.com/defaultcollection/_git/Repo/pullrequest/9',
			{ ownerAndRepo: 'myorg/Repo', prNumber: '9' },
		);
	});

	test('a visualstudio.com url with no project segment names the project after the repo', () => {
		t(
			'{org}.visualstudio.com/_git/{repo}/pullrequest/{id}',
			'https://myorg.visualstudio.com/_git/Repo/pullrequest/9',
			{
				ownerAndRepo: 'myorg/Repo',
				prNumber: '9',
			},
		);
	});

	test('a visualstudio.com url follows the remote parser for anything else before _git', () => {
		t(
			'{Org}.VisualStudio.com/DefaultCollection/{project}/_git/{repo}/pullrequest/{id}',
			'https://MyOrg.VisualStudio.com/DefaultCollection/My%20Project/_git/Repo/pullrequest/9',
			{ ownerAndRepo: 'myorg/My Project', prNumber: '9' },
		);
		t(
			'{org}.visualstudio.com/{a}/{b}/_git/{repo}',
			'https://myorg.visualstudio.com/a/b/_git/Repo/pullrequest/9',
			undefined,
		);
	});

	test('a cloud url is read the same with any scheme or `_git` casing', () => {
		t('_GIT', 'https://dev.azure.com/myorg/Project/_GIT/Repo/pullrequest/42', {
			ownerAndRepo: 'myorg/Project',
			prNumber: '42',
		});
		t('non-special scheme', 'vstfs://myorg.visualstudio.com/Project/_git/Repo/pullrequest/9', {
			ownerAndRepo: 'myorg/Project',
			prNumber: '9',
		});
	});

	test('dev.azure.com still needs the org before _git', () => {
		t('_git/{repo}/pullrequest/{id}', 'https://dev.azure.com/_git/Repo/pullrequest/3', undefined);
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

	test('a percent-encoded project name is decoded', () => {
		t(
			'{org}/{project with a space}/_git/{repo}/pullrequest/{id}',
			'https://dev.azure.com/org/My%20Project/_git/repo/pullrequest/5',
			{ ownerAndRepo: 'org/My Project', prNumber: '5' },
		);
	});
});
