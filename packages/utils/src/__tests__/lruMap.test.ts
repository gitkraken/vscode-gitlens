import * as assert from 'assert';
import { LruMap } from '../lruMap.js';

suite('LruMap Test Suite', () => {
	suite('basics', () => {
		test('starts empty', () => {
			const m = new LruMap<string, number>(3);
			assert.strictEqual(m.size, 0);
			assert.strictEqual(m.get('a'), undefined);
			assert.strictEqual(m.has('a'), false);
		});

		test('set / get / has / delete / clear', () => {
			const m = new LruMap<string, number>(3);
			m.set('a', 1).set('b', 2);
			assert.strictEqual(m.size, 2);
			assert.strictEqual(m.get('a'), 1);
			assert.strictEqual(m.get('b'), 2);
			assert.strictEqual(m.has('a'), true);

			assert.strictEqual(m.delete('a'), true);
			assert.strictEqual(m.has('a'), false);
			assert.strictEqual(m.delete('a'), false);

			m.clear();
			assert.strictEqual(m.size, 0);
		});

		test('keys / values yield insertion order', () => {
			const m = new LruMap<string, number>(3);
			m.set('a', 1).set('b', 2).set('c', 3);
			assert.deepStrictEqual([...m.keys()], ['a', 'b', 'c']);
			assert.deepStrictEqual([...m.values()], [1, 2, 3]);
		});
	});

	suite('LRU eviction', () => {
		test('evicts least-recently-used when size exceeds limit', () => {
			const m = new LruMap<string, number>(2);
			m.set('a', 1).set('b', 2);
			m.set('c', 3); // evicts 'a'
			assert.strictEqual(m.size, 2);
			assert.strictEqual(m.has('a'), false);
			assert.strictEqual(m.has('b'), true);
			assert.strictEqual(m.has('c'), true);
		});

		test('re-setting an existing key promotes it to MRU', () => {
			const m = new LruMap<string, number>(2);
			m.set('a', 1).set('b', 2);
			m.set('a', 11); // 'a' becomes MRU
			m.set('c', 3); // evicts 'b' (now LRU), not 'a'
			assert.strictEqual(m.has('a'), true);
			assert.strictEqual(m.get('a'), 11);
			assert.strictEqual(m.has('b'), false);
			assert.strictEqual(m.has('c'), true);
		});

		test('respects limit across many inserts', () => {
			const m = new LruMap<number, string>(3);
			for (let i = 0; i < 100; i++) {
				m.set(i, `v${i}`);
			}
			assert.strictEqual(m.size, 3);
			assert.deepStrictEqual([...m.keys()], [97, 98, 99]);
		});
	});

	suite('touch', () => {
		test('promotes existing entry to MRU without changing value', () => {
			const m = new LruMap<string, number>(2);
			m.set('a', 1).set('b', 2);
			assert.strictEqual(m.touch('a'), true);
			m.set('c', 3); // evicts 'b' because 'a' was just touched
			assert.strictEqual(m.has('a'), true);
			assert.strictEqual(m.get('a'), 1);
			assert.strictEqual(m.has('b'), false);
		});

		test('returns false when key is missing', () => {
			const m = new LruMap<string, number>(2);
			m.set('a', 1);
			assert.strictEqual(m.touch('missing'), false);
		});

		test('preserves entries whose value is undefined', () => {
			const m = new LruMap<string, number | undefined>(2);
			m.set('a', undefined);
			assert.strictEqual(m.touch('a'), true);
			assert.strictEqual(m.has('a'), true);
		});
	});

	suite('update', () => {
		test('seeds a new entry from the patch when missing', () => {
			interface Entry {
				a?: number;
				b?: string;
			}
			const m = new LruMap<string, Entry>(3);
			const result = m.update('k', { a: 1 });
			assert.deepStrictEqual(result, { a: 1 });
			assert.deepStrictEqual(m.get('k'), { a: 1 });
		});

		test('merges patch into existing entry and touches the key', () => {
			interface Entry {
				a?: number;
				b?: string;
			}
			const m = new LruMap<string, Entry>(2);
			m.set('first', { a: 0 });
			m.update('k', { a: 1 });
			m.update('k', { b: 'x' }); // promotes 'k' to MRU
			assert.deepStrictEqual(m.get('k'), { a: 1, b: 'x' });

			m.set('z', { a: 99 }); // evicts 'first', not 'k'
			assert.strictEqual(m.has('first'), false);
			assert.strictEqual(m.has('k'), true);
		});

		test('returns the merged value', () => {
			interface Entry {
				a?: number;
				b?: number;
			}
			const m = new LruMap<string, Entry>(3);
			m.update('k', { a: 1 });
			const merged = m.update('k', { b: 2 });
			assert.deepStrictEqual(merged, { a: 1, b: 2 });
		});
	});
});
