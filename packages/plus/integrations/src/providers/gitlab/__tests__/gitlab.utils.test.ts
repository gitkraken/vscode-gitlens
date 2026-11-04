import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	getGitLabPullRequestIdentityFromMaybeUrl,
	isMaybeGitLabPullRequestUrl,
	matchesGitLabOrgNamespace,
	selectGitLabUserForCommit,
	splitOwnerAndRepo,
} from '../gitlab.utils.js';
import type { GitLabUser } from '../gitlab.utils.js';

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

	test('nested groups, owner is the whole namespace', () => {
		t('full URL', 'https://gitlab.com/acme/platform/kepler/-/merge_requests/12', '12', 'acme/platform/kepler');
		t(
			'deeper nesting with suffix',
			'https://gitlab.com/a/b/c/d/e/-/merge_requests/3/diffs?view=inline#note_1',
			'3',
			'a/b/c/d/e',
		);
		t(
			'self-hosted with port',
			'http://gitlab.local:8080/acme/platform/kepler/-/merge_requests/12',
			'12',
			'acme/platform/kepler',
		);
		t('no protocol', 'gitlab.com/acme/platform/kepler/-/merge_requests/12', '12', 'acme/platform/kepler');
		t(
			'no protocol with leading slash',
			'/gitlab.com/acme/platform/kepler/-/merge_requests/12',
			'12',
			'acme/platform/kepler',
		);
		t('self-hosted domain, no protocol', 'gitlab.example.com/acme/kepler/-/merge_requests/12', '12', 'acme/kepler');
		t('no domain', 'acme/platform/kepler/-/merge_requests/12', '12', 'acme/platform/kepler');
		t('no domain with leading slash', '/acme/platform/kepler/-/merge_requests/12', '12', 'acme/platform/kepler');
		t('no domain, dotless group', 'acme/platform/sub/kepler/-/merge_requests/12', '12', 'acme/platform/sub/kepler');
		t(
			'a dotted group name with only an owner and repo',
			'my.group/kepler/-/merge_requests/12',
			'12',
			'my.group/kepler',
		);
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

suite('Test GitLab commit author resolution: selectGitLabUserForCommit()', () => {
	function user(id: number, name: string, publicEmail?: string, state: string = 'active'): GitLabUser {
		return {
			id: id,
			name: name,
			username: name.toLowerCase().replace(/\s+/g, ''),
			publicEmail: publicEmail,
			state: state,
			avatarUrl: `https://gitlab.com/avatars/${id}.png`,
			webUrl: `https://gitlab.com/u${id}`,
		};
	}

	test('returns undefined for no results', () => {
		assert.strictEqual(selectGitLabUserForCommit([], 'Craig Wilson', 'craig@example.com'), undefined);
	});

	test('returns the single exact name match when there is no email to match', () => {
		const u = user(1, 'Craig Wilson');
		assert.strictEqual(selectGitLabUserForCommit([u], 'Craig Wilson', undefined), u);
	});

	test('returns the single exact name match when email does not match any public email', () => {
		const u = user(1, 'Craig Wilson');
		assert.strictEqual(selectGitLabUserForCommit([u], 'Craig Wilson', 'craig@example.com'), u);
	});

	test('prefers the public email match over a name match', () => {
		const wrong = user(1, 'Craig Wilson');
		const right = user(2, 'Craig Wilson', 'craig@example.com');
		assert.strictEqual(selectGitLabUserForCommit([wrong, right], 'Craig Wilson', 'craig@example.com'), right);
	});

	test('email match wins even when a different user is the exact name match', () => {
		const nameMatch = user(1, 'Craig Wilson');
		const emailMatch = user(2, 'Craig W', 'craig@example.com');
		assert.strictEqual(
			selectGitLabUserForCommit([nameMatch, emailMatch], 'Craig Wilson', 'craig@example.com'),
			emailMatch,
		);
	});

	test('returns undefined when multiple users share the name and none match the email (#2205)', () => {
		const a = user(1, 'Craig Wilson', 'someoneelse@example.com');
		const b = user(2, 'Craig Wilson');
		assert.strictEqual(selectGitLabUserForCommit([a, b], 'Craig Wilson', 'craig@example.com'), undefined);
	});

	test('matches name case-insensitively', () => {
		const u = user(1, 'CRAIG WILSON');
		assert.strictEqual(selectGitLabUserForCommit([u], 'craig wilson', undefined), u);
	});

	test('matches public email case-insensitively', () => {
		const a = user(1, 'Craig Wilson');
		const b = user(2, 'Craig Wilson', 'Craig@Example.com');
		assert.strictEqual(selectGitLabUserForCommit([a, b], 'Craig Wilson', 'craig@example.com'), b);
	});
});

suite('Test GitLab repo namespace matching against an org/group: matchesGitLabOrgNamespace()', () => {
	test('matches an exact top-level org', () => {
		assert.equal(matchesGitLabOrgNamespace('gitkraken', 'gitkraken'), true);
	});

	test('matches a one-level subgroup', () => {
		assert.equal(matchesGitLabOrgNamespace('gitkraken/mobile', 'gitkraken'), true);
	});

	test('matches a nested subgroup', () => {
		assert.equal(matchesGitLabOrgNamespace('gitkraken/mobile/ios', 'gitkraken'), true);
	});

	test('does not match a different org', () => {
		assert.equal(matchesGitLabOrgNamespace('other-org', 'gitkraken'), false);
	});

	test('does not match a namespace that merely shares a prefix (not a subgroup)', () => {
		assert.equal(matchesGitLabOrgNamespace('gitkraken2', 'gitkraken'), false);
		assert.equal(matchesGitLabOrgNamespace('gitkraken-labs', 'gitkraken'), false);
	});

	test('does not match the org against one of its own subgroups', () => {
		assert.equal(matchesGitLabOrgNamespace('gitkraken', 'gitkraken/mobile'), false);
	});
});

suite('Test splitOwnerAndRepo()', () => {
	test('splits at the last slash so the owner is the whole namespace', () => {
		assert.deepStrictEqual(splitOwnerAndRepo('eamodio/vscode-gitlens'), {
			owner: 'eamodio',
			name: 'vscode-gitlens',
		});
		assert.deepStrictEqual(splitOwnerAndRepo('acme/platform/kepler'), { owner: 'acme/platform', name: 'kepler' });
		assert.deepStrictEqual(splitOwnerAndRepo('a/b/c/d'), { owner: 'a/b/c', name: 'd' });
	});

	test('returns undefined without an owner and a repo', () => {
		assert.equal(splitOwnerAndRepo('kepler'), undefined);
		assert.equal(splitOwnerAndRepo('/kepler'), undefined);
		assert.equal(splitOwnerAndRepo('acme/'), undefined);
		assert.equal(splitOwnerAndRepo(''), undefined);
	});
});
