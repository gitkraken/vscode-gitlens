import * as assert from 'assert';
import { getStackedMergeCount } from '../pullRequest.utils.js';

suite('pullRequest.utils', () => {
	suite('getStackedMergeCount', () => {
		test('unstacked is always 1', () => {
			assert.strictEqual(getStackedMergeCount(undefined), 1);
			assert.strictEqual(getStackedMergeCount(undefined, { wholeStack: true }), 1);
		});

		test('defaults to this layer and everything below it', () => {
			assert.strictEqual(getStackedMergeCount({ position: 2, size: 4 }), 2);
		});

		test('wholeStack counts every layer', () => {
			assert.strictEqual(getStackedMergeCount({ position: 2, size: 4 }, { wholeStack: true }), 4);
		});
	});
});
