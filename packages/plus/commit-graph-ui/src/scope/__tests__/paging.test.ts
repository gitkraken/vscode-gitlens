import * as assert from 'assert';
import { createWipRowId } from '@gitkraken/commit-graph/wip/identity.js';
import { countRenderedSearchResults } from '../paging.js';

suite('countRenderedSearchResults', () => {
	test('counts only the results that have a row', () => {
		const rows = new Map([
			['a', 0],
			['c', 2],
		]);
		assert.strictEqual(countRenderedSearchResults({ a: {}, b: {}, c: {} }, rows), 2);
	});

	test('a peer WIP result whose row is not there yet does not count', () => {
		const anchored = createWipRowId('/repo/wt-anchored');
		const unanchored = createWipRowId('/repo/wt-unanchored');
		const rows = new Map([[anchored, 0]]);
		assert.strictEqual(countRenderedSearchResults({ [anchored]: {}, [unanchored]: {} }, rows), 1);
	});

	test('no results or no rows count nothing', () => {
		assert.strictEqual(countRenderedSearchResults(undefined, new Map([['a', 0]])), 0);
		assert.strictEqual(countRenderedSearchResults({ a: {} }, undefined), 0);
	});
});
