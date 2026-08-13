import * as assert from 'node:assert';
import { isCloseMatch } from '../graphSearchService.js';

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
