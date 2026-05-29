import * as assert from 'assert';
import { formatDate, fromNow, setDefaultDateLocales } from '../date.js';

suite('Date Test Suite', () => {
	suiteSetup(() => {
		// Force a stable locale so short relative formatting is deterministic
		setDefaultDateLocales('en');
	});

	suiteTeardown(() => {
		setDefaultDateLocales('system');
	});

	suite('fromNow', () => {
		test('returns empty string for an invalid Date', () => {
			assert.strictEqual(fromNow(new Date('not-a-date')), '');
			assert.strictEqual(fromNow(new Date('not-a-date'), true), '');
		});

		test('returns empty string for a non-finite number', () => {
			assert.strictEqual(fromNow(NaN), '');
			assert.strictEqual(fromNow(Number.POSITIVE_INFINITY), '');
			assert.strictEqual(fromNow(Number.NEGATIVE_INFINITY), '');
		});

		test('formats valid dates', () => {
			// 5 seconds ago (short, en locale) is computed by our own code, so it is stable
			assert.strictEqual(fromNow(Date.now() - 5000, true), '5s');
			// Long form is locale/ICU-dependent, so just assert it produces output without throwing
			assert.notStrictEqual(fromNow(Date.now() - 5000), '');
		});
	});

	suite('formatDate', () => {
		test('returns empty string for an invalid Date', () => {
			assert.strictEqual(formatDate(new Date('not-a-date'), 'short'), '');
			assert.strictEqual(formatDate(new Date('not-a-date'), 'YYYY-MM-DD'), '');
			assert.strictEqual(formatDate(NaN, 'short'), '');
		});

		test('formats valid dates', () => {
			assert.strictEqual(formatDate(new Date(2020, 0, 15), 'YYYY-MM-DD'), '2020-01-15');
		});
	});
});
