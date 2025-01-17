import * as assert from 'assert';
import { getGitLabPullRequestIdentityFromMaybeUrl, isMaybeGitLabPullRequestUrl } from '../gitlab.utils';

suite('Test GitLab PR URL parsing to identity: getPullRequestIdentityFromMaybeUrl()', () => {
	function t(message: string, query: string, prNumber: string | undefined, ownerAndRepo?: string) {
		assert.deepStrictEqual(
			getGitLabPullRequestIdentityFromMaybeUrl(query),
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
			isMaybeGitLabPullRequestUrl(query),
			prNumber != null,
			`Check: ${message} (${JSON.stringify(query)})`,
		);
	}

	test('full URL or without protocol but with domain, should parse to ownerAndRepo and prNumber', () => {
		t('full URL', 'https://gitlab.com/eamodio/vscode-gitlens/-/merge_requests/1', '1', 'eamodio/vscode-gitlens');
		t(
			'with suffix',
			'https://gitlab.com/eamodio/vscode-gitlens/-/merge_requests/1/files?diff=unified#hello',
			'1',
			'eamodio/vscode-gitlens',
		);
		t(
			'with query',
			'https://gitlab.com/eamodio/vscode-gitlens/-/merge_requests/1?diff=unified#hello',
			'1',
			'eamodio/vscode-gitlens',
		);

		t(
			'with anchor',
			'https://gitlab.com/eamodio/vscode-gitlens/-/merge_requests/1#hello',
			'1',
			'eamodio/vscode-gitlens',
		);
		t(
			'a weird suffix',
			'https://gitlab.com/eamodio/vscode-gitlens/-/merge_requests/1-files',
			'1',
			'eamodio/vscode-gitlens',
		);
		t('numeric repo name', 'https://gitlab.com/sergeibbb/1/-/merge_requests/16', '16', 'sergeibbb/1');

		t(
			'no protocol with leading slash',
			'/gitlab.com/sergeibbb/1/-/merge_requests/16?diff=unified',
			'16',
			'sergeibbb/1',
		);
		t('no protocol without leading slash', 'gitlab.com/sergeibbb/1/-/merge_requests/16/files', '16', 'sergeibbb/1');
	});
	test('no domain, should parse to ownerAndRepo and prNumber', () => {
		t('with leading slash', '/sergeibbb/1/-/merge_requests/16#hello', '16', 'sergeibbb/1');
		t(
			'words in repo name',
			'eamodio/vscode-gitlens/-/merge_requests/1?diff=unified#hello',
			'1',
			'eamodio/vscode-gitlens',
		);
		t('numeric repo name', 'sergeibbb/1/-/merge_requests/16/files', '16', 'sergeibbb/1');
	});

	test('domain vs. no domain', () => {
		t(
			'with anchor',
			'https://gitlab.com/eamodio/vscode-gitlens/-/merge_requests/1#hello/sergeibbb/1/-/merge_requests/16',
			'1',
			'eamodio/vscode-gitlens',
		);
	});

	test('numbers', () => {
		t('has "-/merge_requests/" fragment', '/-/merge_requests/16/files#hello', '16');
		t('has "-/merge_requests/" fragment with double slash', '1//-/merge_requests/16?diff=unified#hello', '16');
		t('with leading slash', '/16/files#hello', undefined);
		t('just a number', '16', undefined);
		t('with a hash', '#16', undefined);
	});

	test('does not match', () => {
		t('without leading slash', '16?diff=unified#hello', undefined);
		t('with leading hash', '/#16/files#hello', undefined);
		t('number is a part of a word', 'hello16', undefined);
		t('number is a part of a word', '16hello', undefined);

		t('GitHub', 'https://github.com/eamodio/vscode-gitlens/pull/16', undefined);

		t('with a number', '1/16?diff=unified#hello', undefined);
		t('with a number and slash', '/1/16?diff=unified#hello', undefined);
		t('with a word', 'anything/16?diff=unified#hello', undefined);

		t(
			'with a wrong character leading to "-/merge_requests/"',
			'sergeibbb/1/--/merge_requests/16?diff=unified#hello',
			undefined,
		);
		t(
			'with a wrong character leading to "-/merge_requests/"',
			'sergeibbb/1--/merge_requests/16?diff=unified#hello',
			undefined,
		);
	});
});
