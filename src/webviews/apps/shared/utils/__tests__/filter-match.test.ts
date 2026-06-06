import * as assert from 'assert';
import { collectHighlightIndices, fuzzyMatch, matchesTerms, parseFilterTerms } from '../filter-match.js';

suite('filter-match', () => {
	suite('parseFilterTerms', () => {
		test('lowercases, trims, and splits on whitespace', () => {
			assert.deepStrictEqual(parseFilterTerms('  Foo   Bar '), ['foo', 'bar']);
		});

		test('empty / whitespace-only yields no terms', () => {
			assert.deepStrictEqual(parseFilterTerms(''), []);
			assert.deepStrictEqual(parseFilterTerms('   '), []);
		});
	});

	suite('fuzzyMatch', () => {
		test('returns matched indices for a subsequence', () => {
			assert.deepStrictEqual(fuzzyMatch('hello', 'hlo'), [0, 2, 4]);
		});

		test('returns all indices for a full match', () => {
			assert.deepStrictEqual(fuzzyMatch('abc', 'abc'), [0, 1, 2]);
		});

		test('returns undefined when not a subsequence', () => {
			assert.strictEqual(fuzzyMatch('hello', 'xyz'), undefined);
			assert.strictEqual(fuzzyMatch('abc', 'acb'), undefined);
		});
	});

	suite('matchesTerms', () => {
		test('empty terms always match', () => {
			assert.strictEqual(matchesTerms({ label: 'anything' }, []), true);
		});

		test('substring match on label', () => {
			assert.strictEqual(matchesTerms({ label: 'README.md' }, ['readme']), true);
		});

		test('fuzzy match on label', () => {
			assert.strictEqual(matchesTerms({ label: 'README.md' }, ['rdme']), true);
		});

		test('substring match on filterText (full path)', () => {
			assert.strictEqual(matchesTerms({ label: 'README.md', filterText: 'src/docs/README.md' }, ['docs']), true);
		});

		test('substring match on description', () => {
			assert.strictEqual(matchesTerms({ label: 'x', description: 'modified' }, ['modif']), true);
		});

		test('all terms must match (AND)', () => {
			assert.strictEqual(
				matchesTerms({ label: 'README.md', filterText: 'src/README.md' }, ['readme', 'src']),
				true,
			);
			assert.strictEqual(
				matchesTerms({ label: 'README.md', filterText: 'src/README.md' }, ['readme', 'zzz']),
				false,
			);
		});

		test('no match returns false', () => {
			assert.strictEqual(matchesTerms({ label: 'README.md' }, ['zzz']), false);
		});
	});

	suite('collectHighlightIndices', () => {
		test('exact substring indices', () => {
			assert.deepStrictEqual(collectHighlightIndices('hello', ['ll']), [2, 3]);
		});

		test('falls back to fuzzy indices', () => {
			assert.deepStrictEqual(collectHighlightIndices('hello', ['hlo']), [0, 2, 4]);
		});

		test('merges and sorts indices across terms', () => {
			assert.deepStrictEqual(collectHighlightIndices('hello', ['he', 'lo']), [0, 1, 3, 4]);
		});

		test('no match yields no indices', () => {
			assert.deepStrictEqual(collectHighlightIndices('hello', ['xyz']), []);
		});
	});
});
