import * as assert from 'assert';
import { computeThreeWayDiff } from '../threeWayDiff.utils.js';

suite('threeWayDiff.utils', () => {
	test('marks identical sides as unchanged', () => {
		const base = ['a', 'b', 'c'];
		const result = computeThreeWayDiff(base, base.slice(), base.slice());
		assert.strictEqual(result.ours.unchanged, true);
		assert.strictEqual(result.theirs.unchanged, true);
		assert.strictEqual(result.hasOverlappingChanges, false);
	});

	test('reports added lines on a side', () => {
		const base = ['a', 'c'];
		const ours = ['a', 'b', 'c'];
		const result = computeThreeWayDiff(base, ours, base.slice());
		assert.deepStrictEqual([...result.ours.added].sort(), [1]);
		assert.deepStrictEqual([...result.ours.removed], []);
		assert.strictEqual(result.theirs.unchanged, true);
	});

	test('reports removed lines on a side', () => {
		const base = ['a', 'b', 'c'];
		const ours = ['a', 'c'];
		const result = computeThreeWayDiff(base, ours, base.slice());
		assert.deepStrictEqual([...result.ours.removed], [1]);
		assert.deepStrictEqual([...result.ours.added], []);
	});

	test('detects overlapping changes when both sides edit the same base line', () => {
		const base = ['a', 'b', 'c'];
		const ours = ['a', 'X', 'c'];
		const theirs = ['a', 'Y', 'c'];
		const result = computeThreeWayDiff(base, ours, theirs);
		assert.strictEqual(result.hasOverlappingChanges, true);
	});

	test('does NOT flag overlapping when sides change different parts of base', () => {
		const base = ['a', 'b', 'c', 'd'];
		const ours = ['A', 'b', 'c', 'd'];
		const theirs = ['a', 'b', 'c', 'D'];
		const result = computeThreeWayDiff(base, ours, theirs);
		assert.strictEqual(result.hasOverlappingChanges, false);
	});

	test('falls back to approximate diff above the size cap', () => {
		const cap = 4;
		const base = ['1', '2', '3', '4', '5'];
		const ours = ['1', '2', '3', '4', '5'];
		const result = computeThreeWayDiff(base, ours, base.slice(), { maxLinesPerSide: cap });
		assert.strictEqual(result.ours.unchanged, false);
		assert.strictEqual(result.ours.added.size, base.length);
		assert.strictEqual(result.ours.removed.size, base.length);
	});

	test('handles empty base with new content on a side', () => {
		const result = computeThreeWayDiff([], ['x', 'y'], []);
		assert.deepStrictEqual([...result.ours.added].sort(), [0, 1]);
		assert.strictEqual(result.theirs.unchanged, true);
	});
});
