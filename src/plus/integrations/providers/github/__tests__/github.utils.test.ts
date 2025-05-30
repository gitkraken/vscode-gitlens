import * as assert from 'assert';
//import { getGitHubPullRequestIdentityFromMaybeUrl } from '../github/models';
import { getGitHubPullRequestIdentityFromMaybeUrl, isMaybeGitHubPullRequestUrl } from '../github.utils';

suite('Test GitHub PR URL parsing to identity: getPullRequestIdentityFromMaybeUrl()', () => {
	function t(message: string, query: string, prNumber: string | undefined, ownerAndRepo?: string) {
		assert.deepStrictEqual(
			getGitHubPullRequestIdentityFromMaybeUrl(query),
			prNumber == null
				? undefined
				: {
						ownerAndRepo: ownerAndRepo,
						prNumber: prNumber,
						provider: undefined,
				  },
			`Parse: ${message} (${JSON.stringify(query)})`,
		);
		assert.equal(
			isMaybeGitHubPullRequestUrl(query),
			prNumber != null,
			`Check: ${message} (${JSON.stringify(query)})`,
		);
	}

	test('full URL or without protocol but with domain, should parse to ownerAndRepo and prNumber', () => {
		t('full URL', 'https://github.com/eamodio/vscode-gitlens/pull/1', '1', 'eamodio/vscode-gitlens');
		t(
			'with suffix',
			'https://github.com/eamodio/vscode-gitlens/pull/1/files?diff=unified#hello',
			'1',
			'eamodio/vscode-gitlens',
		);
		t(
			'with query',
			'https://github.com/eamodio/vscode-gitlens/pull/1?diff=unified#hello',
			'1',
			'eamodio/vscode-gitlens',
		);

		t('with anchor', 'https://github.com/eamodio/vscode-gitlens/pull/1#hello', '1', 'eamodio/vscode-gitlens');
		t('a weird suffix', 'https://github.com/eamodio/vscode-gitlens/pull/1-files', '1', 'eamodio/vscode-gitlens');
		t('numeric repo name', 'https://github.com/sergeibbb/1/pull/16', '16', 'sergeibbb/1');

		t('no protocol with leading slash', '/github.com/sergeibbb/1/pull/16?diff=unified', '16', 'sergeibbb/1');
		t('no protocol without leading slash', 'github.com/sergeibbb/1/pull/16/files', '16', 'sergeibbb/1');
	});

	test('no domain, should parse to ownerAndRepo and prNumber', () => {
		t('with leading slash', '/sergeibbb/1/pull/16#hello', '16', 'sergeibbb/1');
		t('words in repo name', 'eamodio/vscode-gitlens/pull/1?diff=unified#hello', '1', 'eamodio/vscode-gitlens');
		t('numeric repo name', 'sergeibbb/1/pull/16/files', '16', 'sergeibbb/1');
	});

	test('domain vs. no domain', () => {
		t(
			'with anchor',
			'https://github.com/eamodio/vscode-gitlens/pull/1#hello/sergeibbb/1/pull/16',
			'1',
			'eamodio/vscode-gitlens',
		);
	});

	test('numbers', () => {
		t('has "pull/" fragment', '/pull/16/files#hello', '16');
		t('has "pull/" fragment with double slash', '1//pull/16?diff=unified#hello', '16');
		t('with leading slash', '/16/files#hello', undefined);
		t('just a number', '16', undefined);
		t('with a hash', '#16', undefined);
	});

	test('does not match', () => {
		t('without leading slash', '16?diff=unified#hello', undefined);
		t('with leading hash', '/#16/files#hello', undefined);
		t('number is a part of a word', 'hello16', undefined);
		t('number is a part of a word', '16hello', undefined);

		t('GitLab', 'https://gitlab.com/eamodio/vscode-gitlens/-/merge_requests/16', undefined);

		t('with a number', '1/16?diff=unified#hello', undefined);
		t('with a number and slash', '/1/16?diff=unified#hello', undefined);
		t('with a word', 'anything/16?diff=unified#hello', undefined);

		t('with a wrong character leading to pull', 'sergeibbb/1/-pull/16?diff=unified#hello', undefined);
		t('with a wrong character leading to pull', 'sergeibbb/1-pull/16?diff=unified#hello', undefined);
	});
});
