import * as assert from 'assert';
import { getPullRequestIdentityFromMaybeUrl } from '../pullRequest.utils';

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
