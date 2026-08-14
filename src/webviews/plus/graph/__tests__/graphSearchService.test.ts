import * as assert from 'node:assert';
import { parseSearchQuery } from '@gitlens/git/utils/search.utils.js';
import { buildSearchRelaxationCandidates, isCloseMatch } from '../graphSearchService.js';

suite('isCloseMatch', () => {
	test('equal (case-insensitive)', () => {
		assert.strictEqual(isCloseMatch('Keith', 'keith'), true);
	});

	test('containment either direction, min length 4', () => {
		assert.strictEqual(isCloseMatch('keith', 'keithd'), true);
		assert.strictEqual(isCloseMatch('keithd', 'keith'), true);
		assert.strictEqual(isCloseMatch('ab', 'abc'), false);
	});

	test('a transposition counts as distance 1', () => {
		assert.strictEqual(isCloseMatch('kieth', 'keith'), true);
	});

	test('a dropped character counts as distance 1', () => {
		assert.strictEqual(isCloseMatch('amodio', 'eamodio'), true);
	});

	test('distance 2 on a longer token still matches', () => {
		assert.strictEqual(isCloseMatch('daulton', 'doulten'), true);
	});

	test('short tokens are rejected even when close', () => {
		assert.strictEqual(isCloseMatch('bob', 'rob'), false);
	});

	test('distance 3 on a longer token is rejected', () => {
		assert.strictEqual(isCloseMatch('daulton', 'xauxtoy'), false);
	});
});

suite('buildSearchRelaxationCandidates', () => {
	test('fewer than 2 droppable groups present yields no drop-one-group variants', () => {
		const parsed = parseSearchQuery({ query: 'message:foo' });
		const candidates = buildSearchRelaxationCandidates(parsed);
		assert.deepStrictEqual(candidates, []);
	});

	test('exactly 2 groups yields 2 candidates, each missing one operator group', () => {
		const parsed = parseSearchQuery({ query: 'message:foo author:bar' });
		const candidates = buildSearchRelaxationCandidates(parsed);

		assert.strictEqual(candidates.length, 2);
		assert.deepStrictEqual(
			candidates.map(c => c.label),
			['without the author filter', 'without the message terms'],
		);
		assert.strictEqual(candidates[0].query, 'message:foo');
		assert.strictEqual(candidates[1].query, 'author:bar');
	});

	test('after: and before: count as ONE group — dropping it removes both in one candidate', () => {
		const parsed = parseSearchQuery({ query: 'after:2020-01-01 before:2021-01-01 message:foo' });
		const candidates = buildSearchRelaxationCandidates(parsed);

		assert.strictEqual(candidates.length, 2);
		const datesCandidate = candidates.find(c => c.label === 'without the date filter');
		assert.ok(datesCandidate);
		assert.strictEqual(datesCandidate.query, 'message:foo');

		const messageCandidate = candidates.find(c => c.label === 'without the message terms');
		assert.ok(messageCandidate);
		assert.ok(!messageCandidate.query.includes('message:'));
		assert.ok(messageCandidate.query.includes('after:'));
		assert.ok(messageCandidate.query.includes('before:'));
	});

	test('ref: alongside another group is labeled "across all branches"', () => {
		const parsed = parseSearchQuery({ query: 'ref:main message:foo' });
		const candidates = buildSearchRelaxationCandidates(parsed);

		const refCandidate = candidates.find(c => c.label === 'across all branches');
		assert.ok(refCandidate);
		assert.strictEqual(refCandidate.query, 'message:foo');
	});

	test('alternates alongside a single-group query still yield candidates, capped at 2', () => {
		const parsed = parseSearchQuery({ query: 'message:foo' });
		const candidates = buildSearchRelaxationCandidates(parsed, ['alt one', 'alt two', 'alt three']);

		assert.strictEqual(candidates.length, 2);
		assert.deepStrictEqual(
			candidates.map(c => c.query),
			['alt one', 'alt two'],
		);
		assert.deepStrictEqual(
			candidates.map(c => c.label),
			['alt one', 'alt two'],
		);
	});

	test('an alternate duplicating a drop-one-group variant appears only once', () => {
		const parsed = parseSearchQuery({ query: 'message:foo author:bar' });
		const candidates = buildSearchRelaxationCandidates(parsed, ['message:foo']);

		const matching = candidates.filter(c => c.query === 'message:foo');
		assert.strictEqual(matching.length, 1);
		// Still keeps the OTHER drop-one-group variant + didn't add a duplicate alternate candidate.
		assert.strictEqual(candidates.length, 2);
	});

	test('a misspelled author gets a respell candidate first, ahead of drop-group candidates', () => {
		const parsed = parseSearchQuery({ query: 'author:kieth message:foo' });
		const candidates = buildSearchRelaxationCandidates(parsed, undefined, [
			{ name: 'Keith Daulton', email: 'keith@example.com' },
		]);

		assert.strictEqual(candidates[0].label, "as 'Keith Daulton'");
		assert.strictEqual(candidates[0].query, 'author:"Keith Daulton" message:foo');

		const dropGroupLabels = candidates.slice(1).map(c => c.label);
		assert.deepStrictEqual(dropGroupLabels, ['without the author filter', 'without the message terms']);
	});

	test('an already correctly-spelled or quoted author yields no respell candidate', () => {
		const contributors = [{ name: 'Keith Daulton', email: 'keith@example.com' }];

		const exact = buildSearchRelaxationCandidates(
			parseSearchQuery({ query: 'author:Keith' }),
			undefined,
			contributors,
		);
		assert.ok(!exact.some(c => c.label.startsWith("as '")));

		const quoted = buildSearchRelaxationCandidates(
			parseSearchQuery({ query: 'author:"Keith Daulton"' }),
			undefined,
			contributors,
		);
		assert.ok(!quoted.some(c => c.label.startsWith("as '")));
	});

	test('@me is never treated as a misspelling', () => {
		const parsed = parseSearchQuery({ query: 'author:@me' });
		const candidates = buildSearchRelaxationCandidates(parsed, undefined, [
			{ name: 'Keith Daulton', email: 'keith@example.com' },
		]);

		assert.ok(!candidates.some(c => c.label.startsWith("as '")));
	});

	test('committer: values are respelled the same way as author:', () => {
		const parsed = parseSearchQuery({ query: 'committer:kieth' });
		const candidates = buildSearchRelaxationCandidates(parsed, undefined, [
			{ name: 'Keith Daulton', email: 'keith@example.com' },
		]);

		assert.strictEqual(candidates[0].label, "as 'Keith Daulton'");
		assert.strictEqual(candidates[0].query, 'committer:"Keith Daulton"');
	});
});
