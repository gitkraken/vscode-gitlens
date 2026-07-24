import * as assert from 'assert';
import { computeAdaptivePageLimit, maxAdaptivePageLimit } from '../graphWebview.utils.js';

suite('graphWebview.utils — computeAdaptivePageLimit', () => {
	test('keeps the base limit below the first depth band', () => {
		assert.strictEqual(computeAdaptivePageLimit(0, 200), 200);
		assert.strictEqual(computeAdaptivePageLimit(1999, 200), 200);
	});

	test('doubles in the 2k–5k band', () => {
		assert.strictEqual(computeAdaptivePageLimit(2000, 200), 400);
		assert.strictEqual(computeAdaptivePageLimit(4999, 200), 400);
	});

	test('quadruples in the 5k–10k band', () => {
		assert.strictEqual(computeAdaptivePageLimit(5000, 200), 800);
		assert.strictEqual(computeAdaptivePageLimit(9999, 200), 800);
	});

	test('caps at the maximum from 10k on', () => {
		assert.strictEqual(computeAdaptivePageLimit(10000, 200), maxAdaptivePageLimit);
		assert.strictEqual(computeAdaptivePageLimit(50000, 200), maxAdaptivePageLimit);
	});

	test('never scales an uncapped (0) base', () => {
		assert.strictEqual(computeAdaptivePageLimit(0, 0), 0);
		assert.strictEqual(computeAdaptivePageLimit(50000, 0), 0);
	});

	test('caps a large custom base at the maximum when scaled', () => {
		// 300 * 5 = 1500 -> capped to 1000
		assert.strictEqual(computeAdaptivePageLimit(10000, 300), maxAdaptivePageLimit);
	});

	test('never returns below the configured base, even when the cap would', () => {
		// base 1500 already exceeds the cap: shallow keeps base...
		assert.strictEqual(computeAdaptivePageLimit(0, 1500), 1500);
		// ...and deep still keeps at least the base (cap can't shrink a user's explicit larger page)
		assert.strictEqual(computeAdaptivePageLimit(10000, 1500), 1500);
	});
});
