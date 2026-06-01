import * as assert from 'assert';
import { base64 } from '@gitlens/utils/base64.js';
import type { GraphReachabilityTable } from '../../models/graph.js';
import type { GitCommitReachability } from '../../providers/commits.js';
import { createReachabilityTableBuilder, decodeReachabilitySet, reachableRefKey } from '../reachability.utils.js';

function setOf(...bitPositions: number[]): string {
	const max = bitPositions.length ? Math.max(...bitPositions) : 0;
	const bytes = new Uint8Array((max >> 3) + 1);
	for (const i of bitPositions) {
		bytes[i >> 3] |= 1 << (i & 7);
	}
	return base64(bytes);
}

suite('Reachability Utils Test Suite', () => {
	const dictionary: GitCommitReachability['refs'] = [
		{ refType: 'branch', name: 'main', remote: false, current: true },
		{ refType: 'branch', name: 'origin/main', remote: true },
		{ refType: 'tag', name: 'v1.0' },
		{ refType: 'branch', name: 'feature', remote: false },
	];

	suite('decodeReachabilitySet', () => {
		test('decodes a membership bitmap to its refs in dictionary order', () => {
			const table: GraphReachabilityTable = { id: 1, dictionary: dictionary, sets: [setOf(0, 2, 3)] };

			assert.deepStrictEqual(decodeReachabilitySet(table, 0), [dictionary[0], dictionary[2], dictionary[3]]);
		});

		test('decodes a single-ref set', () => {
			const table: GraphReachabilityTable = { id: 1, dictionary: dictionary, sets: [setOf(1)] };

			assert.deepStrictEqual(decodeReachabilitySet(table, 1 - 1), [dictionary[1]]);
		});

		test('selects the set at the given index', () => {
			const table: GraphReachabilityTable = {
				id: 1,
				dictionary: dictionary,
				sets: [setOf(0), setOf(0, 1), setOf(3)],
			};

			assert.deepStrictEqual(decodeReachabilitySet(table, 1), [dictionary[0], dictionary[1]]);
			assert.deepStrictEqual(decodeReachabilitySet(table, 2), [dictionary[3]]);
		});

		test('treats a bitmap shorter than the dictionary as zero high bits (append-only invariant)', () => {
			// `sets[0]` was packed when the dictionary had only 2 entries (1 byte); later-discovered refs
			// (indices 2,3) extended the dictionary but must NOT spuriously appear in the older set.
			const table: GraphReachabilityTable = { id: 1, dictionary: dictionary, sets: [setOf(1)] };

			const refs = decodeReachabilitySet(table, 0);
			assert.deepStrictEqual(refs, [dictionary[1]]);
			assert.ok(!refs.includes(dictionary[2]));
			assert.ok(!refs.includes(dictionary[3]));
		});

		test('returns an empty array for an all-zero bitmap', () => {
			const table: GraphReachabilityTable = { id: 1, dictionary: dictionary, sets: [base64(new Uint8Array(1))] };

			assert.deepStrictEqual(decodeReachabilitySet(table, 0), []);
		});

		test('returns an empty array for an out-of-range index', () => {
			const table: GraphReachabilityTable = { id: 1, dictionary: dictionary, sets: [setOf(0)] };

			assert.deepStrictEqual(decodeReachabilitySet(table, 5), []);
		});
	});

	// Exercise the REAL encoder against the decoder so the two halves of the wire format can't drift
	// (the test's own `setOf` helper above only validates the decoder against a hand-rolled bitmap).
	suite('createReachabilityTableBuilder round-trip', () => {
		const main = { refType: 'branch', name: 'main', remote: false, current: true } as const;
		const originMain = { refType: 'branch', name: 'origin/main', remote: true } as const;
		const tag = { refType: 'tag', name: 'v1.0' } as const;
		const feature = { refType: 'branch', name: 'feature', remote: false } as const;

		test('round-trips an interned set back to its refs in first-seen order', () => {
			const builder = createReachabilityTableBuilder();
			const index = builder.intern([main, tag, feature]);
			const table = builder.build()!;

			assert.strictEqual(index, 0);
			assert.deepStrictEqual(decodeReachabilitySet(table, index), [main, tag, feature]);
		});

		test('dedups identical membership to one set index regardless of input order', () => {
			const builder = createReachabilityTableBuilder();
			const a = builder.intern([main, feature]);
			const b = builder.intern([feature, main]);

			assert.strictEqual(a, b);
			assert.strictEqual(builder.build()!.sets.length, 1);
		});

		test('grows the dictionary first-seen and round-trips each distinct set', () => {
			const builder = createReachabilityTableBuilder();
			const first = builder.intern([main, originMain]);
			const second = builder.intern([main, feature]);
			const table = builder.build()!;

			assert.notStrictEqual(first, second);
			assert.deepStrictEqual(decodeReachabilitySet(table, first!), [main, originMain]);
			assert.deepStrictEqual(decodeReachabilitySet(table, second!), [main, feature]);
		});

		test('later-added refs never leak into an earlier set (append-only invariant)', () => {
			const builder = createReachabilityTableBuilder();
			const early = builder.intern([main]);
			// Extend the dictionary with refs the early set never saw.
			builder.intern([main, originMain, tag, feature]);
			const table = builder.build()!;

			assert.deepStrictEqual(decodeReachabilitySet(table, early!), [main]);
		});

		test('returns undefined for an empty or absent ref set', () => {
			const builder = createReachabilityTableBuilder();

			assert.strictEqual(builder.intern(undefined), undefined);
			assert.strictEqual(builder.intern([]), undefined);
			assert.strictEqual(builder.build(), undefined);
		});

		test('stamps a stable generation id per builder, distinct across builders', () => {
			const a = createReachabilityTableBuilder();
			a.intern([main]);
			const a1 = a.build()!;
			a.intern([main, feature]);
			const a2 = a.build()!;

			// Same builder (a `more()`-style accumulation) keeps one id across builds.
			assert.strictEqual(a1.id, a2.id);

			// A fresh builder (a new graph walk) gets a different id.
			const b = createReachabilityTableBuilder();
			b.intern([main]);
			assert.notStrictEqual(b.build()!.id, a1.id);
		});
	});

	suite('reachableRefKey', () => {
		test('distinguishes a local from a remote branch of the same name', () => {
			assert.notStrictEqual(
				reachableRefKey({ refType: 'branch', name: 'main', remote: false }),
				reachableRefKey({ refType: 'branch', name: 'main', remote: true }),
			);
		});

		test('distinguishes a tag from a branch of the same name', () => {
			assert.notStrictEqual(
				reachableRefKey({ refType: 'tag', name: 'release' }),
				reachableRefKey({ refType: 'branch', name: 'release', remote: false }),
			);
		});
	});
});
