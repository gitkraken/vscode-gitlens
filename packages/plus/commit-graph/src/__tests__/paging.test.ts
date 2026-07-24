import * as assert from 'assert';
import { computePrefetchDistance, maxPrefetchDistanceRows, minPrefetchDistanceRows } from '../paging.js';

suite('paging — computePrefetchDistance', () => {
	test('floors at the minimum for a small viewport when idle', () => {
		// viewport 240 / row 24 => 10 rows, 2*10 = 20 < 50 floor
		assert.strictEqual(computePrefetchDistance(240, 24, 0), minPrefetchDistanceRows);
	});

	test('uses two viewport-heights of rows when that exceeds the floor', () => {
		// viewport 1200 / row 24 => 50 rows, 2*50 = 100
		assert.strictEqual(computePrefetchDistance(1200, 24, 0), 100);
	});

	test('rounds a fractional viewport up (ceil)', () => {
		// viewport 250 / row 24 => 10.41 -> ceil 11 rows, 2*11 = 22 -> still below floor
		assert.strictEqual(computePrefetchDistance(250, 24, 0), minPrefetchDistanceRows);
		// viewport 1250 / row 24 => 52.08 -> ceil 53 rows, 2*53 = 106
		assert.strictEqual(computePrefetchDistance(1250, 24, 0), 106);
	});

	test('velocity dominates when faster than the viewport term', () => {
		// 2*10 = 20, velocity 300 => 300
		assert.strictEqual(computePrefetchDistance(240, 24, 300), 300);
	});

	test('rounds velocity up generously', () => {
		assert.strictEqual(computePrefetchDistance(240, 24, 150.2), 151);
	});

	test('clamps to the maximum for a fast fling', () => {
		assert.strictEqual(computePrefetchDistance(240, 24, 1000), maxPrefetchDistanceRows);
		assert.strictEqual(computePrefetchDistance(4000, 24, 5000), maxPrefetchDistanceRows);
	});

	test('treats negative velocity as zero', () => {
		assert.strictEqual(computePrefetchDistance(240, 24, -500), minPrefetchDistanceRows);
	});

	test('guards a zero row height (no divide-by-zero)', () => {
		assert.strictEqual(computePrefetchDistance(240, 0, 0), minPrefetchDistanceRows);
		// velocity still contributes with a zero row height
		assert.strictEqual(computePrefetchDistance(240, 0, 120), 120);
	});

	test('min/max exports bound every result', () => {
		for (const v of [0, 10, 100, 400, 5000]) {
			for (const h of [0, 240, 2000]) {
				const d = computePrefetchDistance(h, 24, v);
				assert.ok(d >= minPrefetchDistanceRows, `${d} >= ${minPrefetchDistanceRows}`);
				assert.ok(d <= maxPrefetchDistanceRows, `${d} <= ${maxPrefetchDistanceRows}`);
			}
		}
	});
});
