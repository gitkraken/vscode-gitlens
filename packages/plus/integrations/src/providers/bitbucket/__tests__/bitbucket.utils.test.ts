import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	getBitbucketPullRequestIdentityFromMaybeUrl,
	getBitbucketServerPullRequestIdentityFromMaybeUrl,
} from '../bitbucket.utils.js';

suite('Test Bitbucket Cloud PR URL parsing to identity: getBitbucketPullRequestIdentityFromMaybeUrl()', () => {
	function t(message: string, url: string, expected: { ownerAndRepo: string; prNumber: string } | undefined) {
		assert.deepStrictEqual(
			getBitbucketPullRequestIdentityFromMaybeUrl(url),
			expected == null
				? undefined
				: { ownerAndRepo: expected.ownerAndRepo, prNumber: expected.prNumber, provider: undefined },
			`Parse: ${message} (${JSON.stringify(url)})`,
		);
	}

	test('{workspace}/{repo}/pull-requests/{id} resolves to ownerAndRepo and prNumber', () => {
		t('full url', 'https://bitbucket.org/myworkspace/myrepo/pull-requests/12', {
			ownerAndRepo: 'myworkspace/myrepo',
			prNumber: '12',
		});
	});

	test('rejects the Bitbucket Server path shape', () => {
		t(
			'projects/{KEY}/repos/{repo}/pull-requests/{id}',
			'https://bb.example.com/projects/KEY/repos/app/pull-requests/7',
			undefined,
		);
	});

	test('a url naming no pull request does not match', () => {
		t('repository url with no pull request segment', 'https://bitbucket.org/myworkspace/myrepo', undefined);
	});
});

suite('Test Bitbucket Server PR URL parsing to identity: getBitbucketServerPullRequestIdentityFromMaybeUrl()', () => {
	function t(message: string, url: string, expected: { ownerAndRepo: string; prNumber: string } | undefined) {
		assert.deepStrictEqual(
			getBitbucketServerPullRequestIdentityFromMaybeUrl(url),
			expected == null
				? undefined
				: { ownerAndRepo: expected.ownerAndRepo, prNumber: expected.prNumber, provider: undefined },
			`Parse: ${message} (${JSON.stringify(url)})`,
		);
	}

	test('projects/{KEY}/repos/{repo}/pull-requests/{id} resolves to ownerAndRepo and prNumber', () => {
		t('full url', 'https://bb.example.com/projects/KEY/repos/app/pull-requests/7', {
			ownerAndRepo: 'KEY/app',
			prNumber: '7',
		});
	});

	test('rejects the Bitbucket Cloud path shape', () => {
		t(
			'{workspace}/{repo}/pull-requests/{id}',
			'https://bitbucket.org/myworkspace/myrepo/pull-requests/12',
			undefined,
		);
	});

	test('a url naming no pull request does not match', () => {
		t('repository url with no pull request segment', 'https://bb.example.com/projects/KEY/repos/app', undefined);
	});
});
