import * as assert from 'assert';
import { RowUnitsIndex } from '../graph-row-units.js';
import type { RowUnitsSource } from '../graph-row-units.js';

/** Deterministic pseudo-random units vector (no `Math.random`) — a small LCG seeded fixed. */
function buildUnitsVector(length: number): number[] {
	let seed = 12345;
	function next(): number {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed;
	}

	const vector: number[] = [];
	for (let i = 0; i < length; i++) {
		// Roughly 1-in-5 rows are tall, with a height of 2-4 units.
		vector.push(next() % 5 === 0 ? 2 + (next() % 3) : 1);
	}
	return vector;
}

/** Asserts two indices agree on every observable query across `[0, rowCount)`. */
function assertIndicesAgree(a: RowUnitsIndex, b: RowUnitsIndex, rowCount: number): void {
	assert.strictEqual(a.totalUnits(rowCount), b.totalUnits(rowCount));

	for (let i = 0; i < rowCount; i++) {
		assert.strictEqual(a.unitsOf(i), b.unitsOf(i), `unitsOf(${i})`);
		assert.strictEqual(a.unitPosOf(i), b.unitPosOf(i), `unitPosOf(${i})`);
	}
}

suite('graph-row-units — RowUnitsIndex', () => {
	test('build with all-1 units returns the uniform singleton', () => {
		const result = RowUnitsIndex.build(50, () => 1);
		assert.strictEqual(result, RowUnitsIndex.uniform);
		assert.strictEqual(result.isUniform, true);
		assert.strictEqual(RowUnitsIndex.uniform.isUniform, true);
	});

	test('uniform singleton behaves correctly for direct queries', () => {
		const u = RowUnitsIndex.uniform;
		assert.strictEqual(u.totalExtra, 0);
		assert.strictEqual(u.unitsOf(7), 1);
		assert.strictEqual(u.unitsBefore(7), 0);
		assert.strictEqual(u.unitPosOf(7), 7);
		assert.strictEqual(u.totalUnits(20), 20);
		assert.strictEqual(u.rowIndexAtUnit(7, 20), 7);
		assert.strictEqual(u.rowIndexAtUnit(-5, 20), 0);
		assert.strictEqual(u.rowIndexAtUnit(1000, 20), 19);
	});

	suite('single tall row in the middle', () => {
		const rowCount = 10;
		const unitsFor: RowUnitsSource = i => (i === 4 ? 2 : 1);
		const index = RowUnitsIndex.build(rowCount, unitsFor);

		test('unitsOf before/at/after the tall row', () => {
			assert.strictEqual(index.unitsOf(3), 1);
			assert.strictEqual(index.unitsOf(4), 2);
			assert.strictEqual(index.unitsOf(5), 1);
		});

		test('unitsBefore before/at/after the tall row', () => {
			assert.strictEqual(index.unitsBefore(0), 0);
			assert.strictEqual(index.unitsBefore(4), 0);
			assert.strictEqual(index.unitsBefore(5), 1);
			assert.strictEqual(index.unitsBefore(9), 1);
		});

		test('unitPosOf across the fixture', () => {
			assert.strictEqual(index.unitPosOf(0), 0);
			assert.strictEqual(index.unitPosOf(3), 3);
			assert.strictEqual(index.unitPosOf(4), 4);
			assert.strictEqual(index.unitPosOf(5), 6);
			assert.strictEqual(index.unitPosOf(9), 10);
		});

		test('totalUnits accounts for the one extra unit', () => {
			assert.strictEqual(index.totalUnits(rowCount), 11);
		});

		test('rowIndexAtUnit round-trips every row, including the tall row 2nd unit', () => {
			for (let r = 0; r < rowCount; r++) {
				assert.strictEqual(index.rowIndexAtUnit(index.unitPosOf(r), rowCount), r, `row ${r}`);
			}
			assert.strictEqual(index.rowIndexAtUnit(index.unitPosOf(4) + 1, rowCount), 4);
		});
	});

	suite('two adjacent tall rows', () => {
		const rowCount = 10;
		const unitsFor: RowUnitsSource = i => {
			if (i === 3) return 2;
			if (i === 4) return 3;
			return 1;
		};
		const index = RowUnitsIndex.build(rowCount, unitsFor);

		test('units and positions', () => {
			assert.strictEqual(index.unitsOf(3), 2);
			assert.strictEqual(index.unitsOf(4), 3);
			assert.strictEqual(index.unitsOf(5), 1);
			assert.strictEqual(index.unitPosOf(3), 3);
			assert.strictEqual(index.unitPosOf(4), 5);
			assert.strictEqual(index.unitPosOf(5), 8);
			assert.strictEqual(index.totalUnits(rowCount), 13);
		});

		test('rowIndexAtUnit resolves every internal unit of both tall rows', () => {
			// row 3 spans units [3, 4]
			assert.strictEqual(index.rowIndexAtUnit(3, rowCount), 3);
			assert.strictEqual(index.rowIndexAtUnit(4, rowCount), 3);
			// row 4 spans units [5, 6, 7]
			assert.strictEqual(index.rowIndexAtUnit(5, rowCount), 4);
			assert.strictEqual(index.rowIndexAtUnit(6, rowCount), 4);
			assert.strictEqual(index.rowIndexAtUnit(7, rowCount), 4);
			// row 5 starts right after
			assert.strictEqual(index.rowIndexAtUnit(8, rowCount), 5);
		});
	});

	suite('tall row at index 0', () => {
		const rowCount = 5;
		const unitsFor: RowUnitsSource = i => (i === 0 ? 2 : 1);
		const index = RowUnitsIndex.build(rowCount, unitsFor);

		test('units and positions', () => {
			assert.strictEqual(index.unitsOf(0), 2);
			assert.strictEqual(index.unitPosOf(0), 0);
			assert.strictEqual(index.unitPosOf(1), 2);
			assert.strictEqual(index.totalUnits(rowCount), 6);
		});

		test('rowIndexAtUnit resolves both units of row 0', () => {
			assert.strictEqual(index.rowIndexAtUnit(0, rowCount), 0);
			assert.strictEqual(index.rowIndexAtUnit(1, rowCount), 0);
			assert.strictEqual(index.rowIndexAtUnit(2, rowCount), 1);
		});
	});

	suite('tall row as the very last row', () => {
		const rowCount = 6;
		const unitsFor: RowUnitsSource = i => (i === rowCount - 1 ? 3 : 1);
		const index = RowUnitsIndex.build(rowCount, unitsFor);

		test('totalUnits and last-row resolution', () => {
			assert.strictEqual(index.totalUnits(rowCount), 8);
			assert.strictEqual(index.unitPosOf(rowCount - 1), 5);
			assert.strictEqual(index.rowIndexAtUnit(index.totalUnits(rowCount) - 1, rowCount), rowCount - 1);
			// every unit of the tall row's span resolves back to it
			assert.strictEqual(index.rowIndexAtUnit(5, rowCount), rowCount - 1);
			assert.strictEqual(index.rowIndexAtUnit(6, rowCount), rowCount - 1);
			assert.strictEqual(index.rowIndexAtUnit(7, rowCount), rowCount - 1);
		});
	});

	suite('row with units 3+', () => {
		const rowCount = 8;
		const unitsFor: RowUnitsSource = i => (i === 2 ? 4 : 1);
		const index = RowUnitsIndex.build(rowCount, unitsFor);

		test('all four internal unit positions map back to the row', () => {
			const start = index.unitPosOf(2);
			assert.strictEqual(index.unitsOf(2), 4);
			assert.strictEqual(index.rowIndexAtUnit(start, rowCount), 2);
			assert.strictEqual(index.rowIndexAtUnit(start + 1, rowCount), 2);
			assert.strictEqual(index.rowIndexAtUnit(start + 2, rowCount), 2);
			assert.strictEqual(index.rowIndexAtUnit(start + 3, rowCount), 2);
			assert.strictEqual(index.rowIndexAtUnit(start + 4, rowCount), 3);
		});
	});

	suite('extend', () => {
		const vector = buildUnitsVector(60);
		const unitsFor: RowUnitsSource = i => vector[i];

		test('extending an index matches a fresh build over the whole extended range', () => {
			const rowCount = 25;
			const fromIndex = 10;
			const rowCount2 = 45;

			const base = RowUnitsIndex.build(rowCount, unitsFor);
			const extended = base.extend(rowCount2, fromIndex, unitsFor);
			const expected = RowUnitsIndex.build(rowCount2, unitsFor);

			assertIndicesAgree(extended, expected, rowCount2);
		});

		test('extending from 0 matches a fresh build (degenerate split)', () => {
			const rowCount = 10;
			const rowCount2 = 30;

			const base = RowUnitsIndex.build(rowCount, unitsFor);
			const extended = base.extend(rowCount2, 0, unitsFor);
			const expected = RowUnitsIndex.build(rowCount2, unitsFor);

			assertIndicesAgree(extended, expected, rowCount2);
		});

		test('extending with no tall rows anywhere returns the uniform singleton', () => {
			const base = RowUnitsIndex.build(10, () => 1);
			const extended = base.extend(30, 10, () => 1);
			assert.strictEqual(extended, RowUnitsIndex.uniform);
		});

		test('extend discards tail tall rows at or beyond fromIndex from the original', () => {
			// Tall row at index 8 exists in the base build but fromIndex re-derives everything from 5 on,
			// this time with no tall rows at all past 5 — so it must not survive into the result.
			const base = RowUnitsIndex.build(10, i => (i === 8 ? 3 : 1));
			const extended = base.extend(10, 5, () => 1);
			assert.strictEqual(extended, RowUnitsIndex.uniform);
		});
	});

	suite('equalsIndex', () => {
		const vector = buildUnitsVector(60);
		const unitsFor: RowUnitsSource = i => vector[i];

		test('two separate builds over the same units vector are content-equal', () => {
			const a = RowUnitsIndex.build(60, unitsFor);
			const b = RowUnitsIndex.build(60, unitsFor);

			assert.notStrictEqual(a, b, 'expected two distinct instances');
			assert.strictEqual(a.equalsIndex(b), true);
			assert.strictEqual(b.equalsIndex(a), true);
		});

		test('an index equals itself', () => {
			const a = RowUnitsIndex.build(60, unitsFor);
			assert.strictEqual(a.equalsIndex(a), true);
			assert.strictEqual(RowUnitsIndex.uniform.equalsIndex(RowUnitsIndex.uniform), true);
		});

		test('differing in a single row is not equal', () => {
			const a = RowUnitsIndex.build(10, i => (i === 4 ? 2 : 1));
			// Same tall row, different span.
			assert.strictEqual(a.equalsIndex(RowUnitsIndex.build(10, i => (i === 4 ? 3 : 1))), false);
			// Same span, different row.
			assert.strictEqual(a.equalsIndex(RowUnitsIndex.build(10, i => (i === 5 ? 2 : 1))), false);
			// Equal `totalExtra` spread over a different SET of rows — the element-wise walk is what catches
			// this, not the cheap total.
			const oneTallRow = RowUnitsIndex.build(10, i => (i === 4 ? 3 : 1));
			const twoTallRows = RowUnitsIndex.build(10, i => (i === 4 || i === 7 ? 2 : 1));
			assert.strictEqual(oneTallRow.totalExtra, twoTallRows.totalExtra);
			assert.strictEqual(oneTallRow.equalsIndex(twoTallRows), false);
			// No tall rows at all.
			assert.strictEqual(a.equalsIndex(RowUnitsIndex.uniform), false);
			assert.strictEqual(RowUnitsIndex.uniform.equalsIndex(a), false);
		});
	});

	suite('clamping and defensive input handling', () => {
		const rowCount = 10;

		test('rowIndexAtUnit clamps negative and huge units', () => {
			const index = RowUnitsIndex.build(rowCount, i => (i === 4 ? 3 : 1));
			assert.strictEqual(index.rowIndexAtUnit(-5, rowCount), 0);
			assert.strictEqual(index.rowIndexAtUnit(Number.MAX_SAFE_INTEGER, rowCount), rowCount - 1);
		});

		test('0 and NaN from unitsFor are treated as 1 unit and never shift later rows', () => {
			const unitsFor: RowUnitsSource = i => {
				if (i === 2) return 0;
				if (i === 5) return NaN;
				return 1;
			};
			const index = RowUnitsIndex.build(rowCount, unitsFor);

			assert.strictEqual(index, RowUnitsIndex.uniform);
			assert.strictEqual(index.unitsOf(2), 1);
			assert.strictEqual(index.unitsOf(5), 1);
			assert.strictEqual(index.unitPosOf(9), 9);
			assert.strictEqual(index.totalUnits(rowCount), rowCount);
		});

		test('a bad value alongside real tall rows is clamped without disturbing them', () => {
			const unitsFor: RowUnitsSource = i => {
				if (i === 2) return 0;
				if (i === 5) return 3;
				return 1;
			};
			const index = RowUnitsIndex.build(rowCount, unitsFor);

			assert.strictEqual(index.unitsOf(2), 1);
			assert.strictEqual(index.unitsOf(5), 3);
			assert.strictEqual(index.unitPosOf(2), 2);
			assert.strictEqual(index.unitPosOf(5), 5);
			assert.strictEqual(index.unitPosOf(9), 11);
		});
	});
});
