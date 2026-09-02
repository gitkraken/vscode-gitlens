import * as assert from 'assert';
import { relativeTimeShort } from '../time.js';

suite('time — relativeTimeShort', () => {
	// Every case is pinned against an explicit `now`, which is the whole point of taking it as an
	// argument: a suite that let the formatter read the wall clock could only assert shapes.
	const now = 1_700_000_000_000;
	const ago = (ms: number) => relativeTimeShort(now - ms, now);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;

	test('steps through each unit at its boundary', () => {
		assert.strictEqual(ago(0), 'now');
		assert.strictEqual(ago(59_999), 'now');
		assert.strictEqual(ago(minute), '1m');
		assert.strictEqual(ago(59 * minute), '59m');
		assert.strictEqual(ago(hour), '1h');
		assert.strictEqual(ago(23 * hour), '23h');
		assert.strictEqual(ago(day), '1d');
		assert.strictEqual(ago(6 * day), '6d');
		assert.strictEqual(ago(7 * day), '1w');
		assert.strictEqual(ago(29 * day), '4w');
		assert.strictEqual(ago(30 * day), '1mo');
		assert.strictEqual(ago(364 * day), '12mo');
		assert.strictEqual(ago(365 * day), '1y');
		assert.strictEqual(ago(3 * 365 * day), '3y');
	});

	test('a future date reads as now rather than a negative magnitude', () => {
		assert.strictEqual(relativeTimeShort(now + day, now), 'now');
	});

	test('an unusable timestamp formats to nothing, so callers can drop the fragment', () => {
		assert.strictEqual(relativeTimeShort(Number.NaN, now), '');
		assert.strictEqual(relativeTimeShort(Number.POSITIVE_INFINITY, now), '');
	});
});
