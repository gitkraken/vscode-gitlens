import * as assert from 'assert';
import { fuzzyFilter, fuzzyMatch } from '../fuzzy';

suite('fuzzyMatch', () => {
	test('should match exact strings', () => {
		const result = fuzzyMatch('message:', 'message:');
		assert.strictEqual(result.matches, true);
		assert.strictEqual(result.score, 1);
	});

	test('should match prefix strings with high score', () => {
		const result = fuzzyMatch('mes', 'message:');
		assert.strictEqual(result.matches, true);
		assert.ok(result.score > 0.9);
	});

	test('should match non-consecutive characters', () => {
		const result = fuzzyMatch('msg', 'message:');
		assert.strictEqual(result.matches, true);
		assert.ok(result.score > 0);
		assert.ok(result.score < 0.9); // Lower score than prefix match
	});

	test('should not match when pattern characters are missing', () => {
		const result = fuzzyMatch('xyz', 'message:');
		assert.strictEqual(result.matches, false);
		assert.strictEqual(result.score, 0);
	});

	test('should be case-insensitive by default', () => {
		const result = fuzzyMatch('MES', 'message:');
		assert.strictEqual(result.matches, true);
		assert.ok(result.score > 0.9);
	});

	test('should handle empty pattern', () => {
		const result = fuzzyMatch('', 'message:');
		assert.strictEqual(result.matches, true);
		assert.strictEqual(result.score, 1);
	});

	test('should handle empty target', () => {
		const result = fuzzyMatch('mes', '');
		assert.strictEqual(result.matches, false);
		assert.strictEqual(result.score, 0);
	});

	test('should score consecutive matches higher', () => {
		const consecutive = fuzzyMatch('mes', 'message:');
		const nonConsecutive = fuzzyMatch('msg', 'message:');
		assert.ok(consecutive.score > nonConsecutive.score);
	});

	test('should match short-form operators', () => {
		const result = fuzzyMatch('@', '@:');
		assert.strictEqual(result.matches, true);
		assert.ok(result.score > 0.9);
	});

	test('should match partial operator names', () => {
		const result = fuzzyMatch('aut', 'author:');
		assert.strictEqual(result.matches, true);
		assert.ok(result.score > 0.9);
	});
});

suite('fuzzyFilter', () => {
	const operators = [
		{ name: 'message:', desc: 'Search messages' },
		{ name: 'author:', desc: 'Search authors' },
		{ name: 'commit:', desc: 'Search commits' },
		{ name: 'file:', desc: 'Search files' },
	];

	test('should filter and sort by score', () => {
		const results = fuzzyFilter('mes', operators, op => op.name);
		assert.ok(results.length > 0);
		assert.strictEqual(results[0].item.name, 'message:');
	});

	test('should return all items when pattern is empty', () => {
		const results = fuzzyFilter('', operators, op => op.name);
		assert.strictEqual(results.length, operators.length);
	});

	test('should filter out non-matching items', () => {
		const results = fuzzyFilter('xyz', operators, op => op.name);
		assert.strictEqual(results.length, 0);
	});

	test('should sort by match quality', () => {
		const results = fuzzyFilter('a', operators, op => op.name);
		assert.ok(results.length > 1);
		// 'author:' should score higher than 'message:' for pattern 'a'
		assert.strictEqual(results[0].item.name, 'author:');
	});

	test('should handle multiple matches', () => {
		const results = fuzzyFilter('m', operators, op => op.name);
		assert.ok(results.length > 1);
		// Both 'message:' and 'commit:' contain 'm'
		const names = results.map(r => r.item.name);
		assert.ok(names.includes('message:'));
		assert.ok(names.includes('commit:'));
	});
});
