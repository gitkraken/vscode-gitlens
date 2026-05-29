import * as assert from 'assert';
import { areEqual } from '../object.js';

suite('object.areEqual Test Suite', () => {
	test('primitives', () => {
		assert.strictEqual(areEqual(1, 1), true);
		assert.strictEqual(areEqual('a', 'a'), true);
		assert.strictEqual(areEqual(true, true), true);
		assert.strictEqual(areEqual(1, 2), false);
		assert.strictEqual(areEqual('a', 'b'), false);
		assert.strictEqual(areEqual(true, false), false);
		// type mismatch
		assert.strictEqual(areEqual(1, '1'), false);
		assert.strictEqual(areEqual(0, false), false);
	});

	test('null / undefined', () => {
		assert.strictEqual(areEqual(null, null), true);
		assert.strictEqual(areEqual(undefined, undefined), true);
		assert.strictEqual(areEqual(null, undefined), false);
		assert.strictEqual(areEqual(null, {}), false);
		assert.strictEqual(areEqual(undefined, 0), false);
	});

	test('flat objects', () => {
		assert.strictEqual(areEqual({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
		assert.strictEqual(areEqual({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
		// extra / missing key
		assert.strictEqual(areEqual({ a: 1 }, { a: 1, b: 2 }), false);
		assert.strictEqual(areEqual({ a: 1, b: 2 }, { a: 1 }), false);
		assert.strictEqual(areEqual({}, {}), true);
	});

	test('key order does not matter', () => {
		assert.strictEqual(areEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
	});

	test('different key sets are not equal (undefined-valued keys)', () => {
		// Same key COUNT, different key SET — must not false-positive just because the differing
		// values are both `undefined`.
		assert.strictEqual(areEqual({ a: 1, b: undefined }, { a: 1, c: undefined }), false);
		assert.strictEqual(areEqual({ a: undefined }, { b: undefined }), false);
		// A present-but-undefined key is distinct from an absent key.
		assert.strictEqual(areEqual({ a: undefined }, {}), false);
		assert.strictEqual(areEqual({}, { a: undefined }), false);
		// Consistent shapes with undefined values are equal.
		assert.strictEqual(areEqual({ a: undefined, b: 1 }, { a: undefined, b: 1 }), true);
	});

	test('nested objects', () => {
		assert.strictEqual(areEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }), true);
		assert.strictEqual(areEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }), false);
	});

	test('arrays', () => {
		assert.strictEqual(areEqual([1, 2, 3], [1, 2, 3]), true);
		assert.strictEqual(areEqual([1, 2, 3], [1, 2, 4]), false);
		assert.strictEqual(areEqual([1, 2], [1, 2, 3]), false);
		assert.strictEqual(areEqual([{ a: 1 }], [{ a: 1 }]), true);
		assert.strictEqual(areEqual([{ a: 1 }], [{ a: 2 }]), false);
		// array vs object of same "length" must not be equal
		assert.strictEqual(areEqual([], {}), false);
	});

	test('Date compared by timestamp (the branchState PR-date case)', () => {
		assert.strictEqual(areEqual(new Date(1000), new Date(1000)), true);
		assert.strictEqual(areEqual(new Date(1000), new Date(2000)), false);
		// Date nested inside an object — the real regression: a naive key-walk sees 0 keys on a Date
		// and would call these equal.
		assert.strictEqual(
			areEqual({ pr: { mergedDate: new Date(1000) } }, { pr: { mergedDate: new Date(2000) } }),
			false,
		);
		assert.strictEqual(
			areEqual({ pr: { mergedDate: new Date(1000) } }, { pr: { mergedDate: new Date(1000) } }),
			true,
		);
		// Date vs non-Date
		assert.strictEqual(areEqual(new Date(1000), { getTime: () => 1000 }), false);
		assert.strictEqual(areEqual({ getTime: () => 1000 }, new Date(1000)), false);
	});

	test('shared sub-references short-circuit to equal', () => {
		const shared = { deep: { nested: [1, 2, 3] } };
		assert.strictEqual(areEqual({ a: shared, b: 1 }, { a: shared, b: 1 }), true);
	});

	test('mixed-shape objects', () => {
		assert.strictEqual(
			areEqual(
				{ active: [{ name: 'a', ahead: 0, behind: 1 }], recent: [] },
				{ active: [{ name: 'a', ahead: 0, behind: 1 }], recent: [] },
			),
			true,
		);
		assert.strictEqual(
			areEqual(
				{ active: [{ name: 'a', ahead: 0, behind: 1 }], recent: [] },
				{ active: [{ name: 'a', ahead: 1, behind: 1 }], recent: [] },
			),
			false,
		);
	});
});
