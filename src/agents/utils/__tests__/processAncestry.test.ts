import * as assert from 'node:assert';
import { walkAncestorChain } from '../processAncestry.js';

suite('walkAncestorChain', () => {
	test('returns ancestor pids nearest-first', () => {
		const parentPidMap = new Map([
			[300, 200],
			[200, 100],
			[100, 1],
		]);

		assert.deepStrictEqual(walkAncestorChain(300, parentPidMap), [200, 100, 1]);
	});

	test('bounds the walk at maxHops (8)', () => {
		const parentPidMap = new Map<number, number>();
		for (let pid = 1; pid <= 10; pid++) {
			parentPidMap.set(pid + 1, pid);
		}

		assert.deepStrictEqual(walkAncestorChain(11, parentPidMap), [10, 9, 8, 7, 6, 5, 4, 3]);
	});

	test('stops on a cycle instead of looping forever', () => {
		const parentPidMap = new Map([
			[1, 2],
			[2, 3],
			[3, 1],
		]);

		assert.deepStrictEqual(walkAncestorChain(1, parentPidMap), [2, 3]);
	});

	test('returns an empty chain when the pid has no parent in the snapshot', () => {
		assert.deepStrictEqual(walkAncestorChain(42, new Map()), []);
	});
});
