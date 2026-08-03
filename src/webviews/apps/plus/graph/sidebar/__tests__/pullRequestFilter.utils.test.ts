import * as assert from 'assert';
import {
	getPullRequestNumberFromQuery,
	parsePullRequestFilterTerms,
	withSearchedPullRequest,
} from '../pullRequestFilter.utils.js';

suite('parsePullRequestFilterTerms', () => {
	test('reduces a pasted PR URL to its number', () => {
		assert.deepStrictEqual(parsePullRequestFilterTerms('https://github.com/gitkraken/vscode-gitlens/pull/5619'), [
			'5619',
		]);
	});

	// The shapes people actually copy — the whole reason plain substring matching fails, since each of
	// these is *longer* than the stored URL.
	test('reduces PR URLs carrying a suffix', () => {
		for (const suffix of ['/files', '/commits', '#discussion_r123', '?diff=split', '/files#diff-abc']) {
			assert.deepStrictEqual(
				parsePullRequestFilterTerms(`https://github.com/gitkraken/vscode-gitlens/pull/5619${suffix}`),
				['5619'],
				suffix,
			);
		}
	});

	test('handles other providers and http/www forms', () => {
		assert.deepStrictEqual(parsePullRequestFilterTerms('https://gitlab.com/g/p/-/merge_requests/42'), ['42']);
		assert.deepStrictEqual(parsePullRequestFilterTerms('http://github.com/o/r/pull/7'), ['7']);
		assert.deepStrictEqual(parsePullRequestFilterTerms('www.github.com/o/r/pull/7'), ['7']);
	});

	// A loose "first slash-digits wins" scan reads the owner instead of the number here, filtering the
	// list on #1 — anchoring on the provider's pull request segment is what keeps that from happening.
	test('reads past an owner or repo that starts with digits', () => {
		assert.deepStrictEqual(parsePullRequestFilterTerms('https://github.com/1Password/vault/pull/456'), ['456']);
		assert.deepStrictEqual(parsePullRequestFilterTerms('https://github.com/o/2fa-lib/pull/89/files'), ['89']);
		assert.deepStrictEqual(parsePullRequestFilterTerms('https://gitlab.com/1group/p/-/merge_requests/42'), ['42']);
	});

	test('trims surrounding whitespace on a pasted URL', () => {
		assert.deepStrictEqual(parsePullRequestFilterTerms('  https://github.com/o/r/pull/12  '), ['12']);
	});

	// The guard that matters: getPullRequestIdentityFromMaybeUrl matches `/(\d+)` anywhere, so an
	// unguarded call would turn each of these branch-ish searches into a search for the wrong PR.
	test('leaves branch-shaped queries alone', () => {
		assert.deepStrictEqual(parsePullRequestFilterTerms('bug/2-fix'), ['bug/2-fix']);
		assert.deepStrictEqual(parsePullRequestFilterTerms('feature/5619-graph'), ['feature/5619-graph']);
		assert.deepStrictEqual(parsePullRequestFilterTerms('release/2024'), ['release/2024']);
	});

	test('leaves ordinary text queries alone', () => {
		assert.deepStrictEqual(parsePullRequestFilterTerms('graph panel'), ['graph', 'panel']);
		assert.deepStrictEqual(parsePullRequestFilterTerms('5619'), ['5619']);
		assert.deepStrictEqual(parsePullRequestFilterTerms(''), []);
	});

	test('a URL naming no pull request falls through to text terms', () => {
		// Matches nothing in the list, which is correct — it names no PR.
		assert.deepStrictEqual(parsePullRequestFilterTerms('https://github.com/gitkraken/vscode-gitlens'), [
			'https://github.com/gitkraken/vscode-gitlens',
		]);
	});
});

suite('withSearchedPullRequest', () => {
	const items = [{ number: '1' }, { number: '2' }];

	test('appends a pull request the list does not hold', () => {
		assert.deepStrictEqual(withSearchedPullRequest(items, { number: '99' }), [
			{ number: '1' },
			{ number: '2' },
			{ number: '99' },
		]);
	});

	test('returns the list unchanged when it already holds the pull request', () => {
		// Keyed on `number`, not `id` — the list path carries the provider's internal id while the
		// lookup path carries the number, so keying on `id` would duplicate a row already shown.
		// Identity, not just equality — an unchanged reference is what keeps the tree-model memo from
		// rebuilding on every render.
		assert.strictEqual(withSearchedPullRequest(items, { number: '2' }), items);
	});

	test('returns the list unchanged when nothing was searched', () => {
		assert.strictEqual(withSearchedPullRequest(items, undefined), items);
	});
});

suite('getPullRequestNumberFromQuery', () => {
	test('resolves URLs and bare numbers', () => {
		assert.strictEqual(getPullRequestNumberFromQuery('https://github.com/o/r/pull/5619'), '5619');
		assert.strictEqual(getPullRequestNumberFromQuery('https://github.com/o/r/pull/5619/files'), '5619');
		assert.strictEqual(getPullRequestNumberFromQuery('5619'), '5619');
		assert.strictEqual(getPullRequestNumberFromQuery('#5619'), '5619');
	});

	test('offers the number the URL actually names, not a digit-leading owner', () => {
		// Otherwise the fallback fetches PR #1 and presents it as the pasted one.
		assert.strictEqual(getPullRequestNumberFromQuery('https://github.com/1Password/vault/pull/456'), '456');
	});

	test('returns undefined for anything not addressing a pull request', () => {
		for (const query of ['', 'graph panel', 'bug/2-fix', 'feature/5619-graph', 'https://github.com/o/r']) {
			assert.strictEqual(getPullRequestNumberFromQuery(query), undefined, query);
		}
	});
});
