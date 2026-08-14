import * as assert from 'node:assert';
import { applySearchIntentMode } from '../naturalLanguageSearchProcessor.js';

suite('applySearchIntentMode', () => {
	test('mode "filter" forces filter on regardless of incoming value', () => {
		assert.strictEqual(applySearchIntentMode(undefined, 'filter'), true);
		assert.strictEqual(applySearchIntentMode(false, 'filter'), true);
		assert.strictEqual(applySearchIntentMode(true, 'filter'), true);
	});

	test('mode "highlight" leaves the incoming filter value untouched', () => {
		assert.strictEqual(applySearchIntentMode(true, 'highlight'), true);
		assert.strictEqual(applySearchIntentMode(false, 'highlight'), false);
		assert.strictEqual(applySearchIntentMode(undefined, 'highlight'), undefined);
	});

	test('mode "select" does not set filter', () => {
		assert.strictEqual(applySearchIntentMode(true, 'select'), true);
		assert.strictEqual(applySearchIntentMode(false, 'select'), false);
		assert.strictEqual(applySearchIntentMode(undefined, 'select'), undefined);
	});

	test('absent mode leaves the incoming filter value untouched', () => {
		assert.strictEqual(applySearchIntentMode(true, undefined), true);
		assert.strictEqual(applySearchIntentMode(false, undefined), false);
	});
});
