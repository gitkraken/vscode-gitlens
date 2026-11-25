import * as assert from 'assert';
import type { TopologicalRangeRow } from '../topologicalRange.js';
import { walkTopologicalRange } from '../topologicalRange.js';

function index(rows: readonly TopologicalRangeRow[]): Map<string, number> {
	return new Map(rows.map((r, i) => [r.sha, i]));
}

suite('walkTopologicalRange', () => {
	test('walks a linear chain newest-first between the two ends', () => {
		const rows = [
			{ sha: 'a', parents: ['b'] },
			{ sha: 'b', parents: ['c'] },
			{ sha: 'c', parents: ['d'] },
			{ sha: 'd', parents: [] },
		];
		assert.deepStrictEqual(walkTopologicalRange(rows, index(rows), 'a', 'c'), ['a', 'b', 'c']);
	});

	test('across a merge follows only first parents, leaving out interleaved off-chain rows', () => {
		const rows = [
			{ sha: 'merge', parents: ['main2', 'side2'] },
			{ sha: 'side2', parents: ['side1'] },
			{ sha: 'main2', parents: ['main1'] },
			{ sha: 'side1', parents: ['base'] },
			{ sha: 'main1', parents: ['base'] },
			{ sha: 'base', parents: [] },
		];
		assert.deepStrictEqual(walkTopologicalRange(rows, index(rows), 'merge', 'base'), [
			'merge',
			'main2',
			'main1',
			'base',
		]);
	});

	test('gives the same result whichever end is passed first', () => {
		const rows = [
			{ sha: 'a', parents: ['b'] },
			{ sha: 'b', parents: ['c'] },
			{ sha: 'c', parents: [] },
		];
		const idx = index(rows);
		assert.deepStrictEqual(walkTopologicalRange(rows, idx, 'c', 'a'), walkTopologicalRange(rows, idx, 'a', 'c'));
	});

	test('returns just the two ends when the older one is not on the first-parent chain', () => {
		const rows = [
			{ sha: 'tip', parents: ['mid'] },
			{ sha: 'mid', parents: ['base'] },
			{ sha: 'other', parents: ['base'] },
			{ sha: 'base', parents: [] },
		];
		assert.deepStrictEqual(walkTopologicalRange(rows, index(rows), 'tip', 'other'), ['tip', 'other']);
	});
});
