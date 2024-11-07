import * as assert from 'assert';
import { suite, test } from 'mocha';
import { getPullRequestIdentityValuesFromSearch } from '../pullRequest.utils';

suite('Test GitHub PR URL parsing to identity: getPullRequestIdentityValuesFromSearch()', () => {
	function t(message: string, query: string, prNumber: string | undefined, ownerAndRepo?: string) {
		assert.deepStrictEqual(
			getPullRequestIdentityValuesFromSearch(query),
			{
				ownerAndRepo: ownerAndRepo,
				prNumber: prNumber,
			},
			`${message} (${JSON.stringify(query)})`,
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

	test('has "pull/" fragment', () => {
		t('with leading slash', '/pull/16/files#hello', '16');
		t('without leading slash', 'pull/16?diff=unified#hello', '16');
		t('with numeric repo name', '1/pull/16?diff=unified#hello', '16');
		t('with double slash', '1//pull/16?diff=unified#hello', '16');
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
