import * as assert from 'assert';
import {
	getPullRequestIdentityFromMaybeUrl,
	getPullRequestNumberFromUrl,
} from '@gitlens/git/utils/pullRequest.utils.js';

suite('Test PR URL parsing to identity: getPullRequestIdentityFromMaybeUrl()', () => {
	function t(message: string, query: string, prNumber: string | undefined, ownerAndRepo?: string) {
		assert.deepStrictEqual(
			getPullRequestIdentityFromMaybeUrl(query),
			prNumber == null
				? undefined
				: {
						ownerAndRepo: ownerAndRepo,
						prNumber: prNumber,
						provider: undefined,
					},
			`${message} (${JSON.stringify(query)})`,
		);
	}

	test('cannot recognize GitHub or GitLab URLs, sees only numbers', () => {
		t('full URL', 'https://github.com/eamodio/vscode-gitlens/pull/16', '16');
		t('numeric repo name', 'https://github.com/sergeibbb/1/pull/16', '1');

		t('no protocol', '/github.com/sergeibbb/1/pull/16?diff=unified', '1');
		t('no domain', '/sergeibbb/1/pull/16#hello', '1');
		t('domain vs. no domain', 'https://github.com/eamodio/vscode-gitlens/pull/1#hello/sergeibbb/2/pull/16', '1');
		t('has "pull/" fragment', '/pull/16/files#hello', '16');
	});

	test('has "/<num>" fragment', () => {
		t('with leading slash', '/16/files#hello', '16');
	});

	test('is a number', () => {
		t('just a number', '16', '16');
		t('with a hash', '#16', '16');
	});

	test('does not match', () => {
		t('without leading slash', '16?diff=unified#hello', undefined);
		t('with leading hash', '/#16/files#hello', undefined);
		t('number is a part of a word', 'hello16', undefined);
		t('number is a part of a word', '16hello', undefined);

		t('with a number', '1/16?diff=unified#hello', '16');
		t('with a number and slash', '/1/16?diff=unified#hello', '1');
		t('with a word', 'anything/16?diff=unified#hello', '16');

		t('with a wrong character leading to pull', 'sergeibbb/1/-pull/16?diff=unified#hello', '1');
		t('with a wrong character leading to pull', 'sergeibbb/1-pull/16?diff=unified#hello', '1');
	});
});

suite('Test PR number parsing from a url: getPullRequestNumberFromUrl()', () => {
	function t(message: string, url: string, prNumber: string | undefined) {
		assert.strictEqual(getPullRequestNumberFromUrl(url), prNumber, `${message} (${JSON.stringify(url)})`);
	}

	test('anchors on the provider pull request segment', () => {
		t('github', 'https://github.com/eamodio/vscode-gitlens/pull/16', '16');
		t('gitlab', 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/16', '16');
		t('bitbucket', 'https://bitbucket.org/eamodio/gitlens/pull-requests/16', '16');
		t('azure', 'https://dev.azure.com/gitkraken/gitlens/_git/gitlens/pullrequest/16', '16');
		t('github enterprise', 'https://github.acme.com/eamodio/vscode-gitlens/pull/16', '16');
	});

	test('is not fooled by a digit-leading owner or repo', () => {
		t('digit-leading owner', 'https://github.com/1Password/x/pull/123', '123');
		t('numeric repo name', 'https://github.com/sergeibbb/1/pull/16', '16');
		t('digits in the branch path', 'https://github.com/eamodio/2fa/pull/16/files', '16');
	});

	test('answers nothing without a pull request segment', () => {
		// The loose `/(\d+)` scan this used to fall back to read a bare repository url as a pull request
		// number — `/1Password` became #1 — and the panel's filter turned that into an offer to search for
		// an unrelated pull request. Callers holding a real pull request fall back to its id instead.
		t('bare repository url', 'https://github.com/eamodio/vscode-gitlens', undefined);
		t('digit-leading owner, no pull segment', 'https://github.com/1Password/onepassword-sdk', undefined);
		t('just a number', '16', undefined);
		t('a path with digits', '/16/files#hello', undefined);
	});
});
