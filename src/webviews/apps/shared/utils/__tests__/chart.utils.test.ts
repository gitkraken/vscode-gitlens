import * as assert from 'assert';
import { computeYScale } from '../chart.utils.js';

suite('chart.utils Test Suite', () => {
	suite('computeYScale', () => {
		test('returns 1 for all-zero input', () => {
			assert.strictEqual(computeYScale([0, 0, 0]), 1);
		});

		test('returns a positive scale for non-trivial input', () => {
			assert.ok(computeYScale([5, 10, 15, 20, 25]) > 0);
		});

		test('caps outliers tight enough that typical bars remain visible', () => {
			// Guard against regressing to "technically capped but visually useless": a cap of e.g. 5000
			// with typical values 3-7 would leave typical bars at <0.2% of axis height — invisible on
			// a 30px canvas. The scale must stay close to the body of the data (P95 = 7 here).
			const withSpike = computeYScale([3, 4, 5, 6, 7, 10000]);
			assert.ok(withSpike < 20, `expected cap close to typical values, got ${withSpike}`);
		});

		test('does not over-cap a smooth distribution', () => {
			// No outliers: the scale should sit just above the max, not compress the chart.
			const yMax = computeYScale([5, 6, 7, 8, 9, 10]);
			assert.ok(yMax >= 10 && yMax <= 12, `expected 10..12, got ${yMax}`);
		});

		test('keeps a smooth distribution close to its max', () => {
			const y = computeYScale([10, 20, 30, 40, 50]);
			assert.ok(y >= 50 && y <= 60, `expected 50..60, got ${y}`);
		});

		test('handles small-n without percentile-indexing bias', () => {
			// `floor(length * 0.75)` on length=4 would pick the max as Q3 and inflate the fence;
			// linear-interpolated quantiles avoid that. With no outliers, yMax should be ~max*1.1.
			const yMax = computeYScale([10, 20, 30, 40]);
			assert.ok(yMax >= 40 && yMax <= 48, `expected 40..48, got ${yMax}`);
		});
	});
});
