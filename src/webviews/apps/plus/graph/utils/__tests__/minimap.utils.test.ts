import * as assert from 'assert';
import { resolveMinimapShown } from '../minimap.utils.js';

suite('resolveMinimapShown', () => {
	suite('policy `always`', () => {
		test('no stored value → shown', () => {
			assert.strictEqual(resolveMinimapShown('always', undefined, false, false), true);
		});

		test('stored `true` → shown', () => {
			assert.strictEqual(resolveMinimapShown('always', true, false, false), true);
		});

		test('stored `false` → hidden, even while searching', () => {
			assert.strictEqual(resolveMinimapShown('always', false, false, false), false);
			assert.strictEqual(resolveMinimapShown('always', false, true, false), false);
		});
	});

	suite('policy `onSearch`', () => {
		test('no stored value → follows the search', () => {
			assert.strictEqual(resolveMinimapShown('onSearch', undefined, false, false), false);
			assert.strictEqual(resolveMinimapShown('onSearch', undefined, true, false), true);
		});

		test('stored `false` is not an override — still follows the search', () => {
			assert.strictEqual(resolveMinimapShown('onSearch', false, false, false), false);
			assert.strictEqual(resolveMinimapShown('onSearch', false, true, false), true);
		});

		test('stored `true` pins it open regardless of the search', () => {
			assert.strictEqual(resolveMinimapShown('onSearch', true, false, false), true);
			assert.strictEqual(resolveMinimapShown('onSearch', true, true, false), true);
		});

		test('dismissal suppresses the auto-show while the search is still running', () => {
			assert.strictEqual(resolveMinimapShown('onSearch', undefined, true, true), false);
			assert.strictEqual(resolveMinimapShown('onSearch', false, true, true), false);
		});

		test('dismissal never overrides a pin', () => {
			assert.strictEqual(resolveMinimapShown('onSearch', true, true, true), true);
		});
	});

	suite('policy `hidden`', () => {
		test('no stored value → hidden', () => {
			assert.strictEqual(resolveMinimapShown('hidden', undefined, false, false), false);
		});

		test('stored `false` → hidden', () => {
			assert.strictEqual(resolveMinimapShown('hidden', false, false, false), false);
		});

		test('stored `true` pins it open', () => {
			assert.strictEqual(resolveMinimapShown('hidden', true, false, false), true);
		});

		test('a running search does not show it', () => {
			assert.strictEqual(resolveMinimapShown('hidden', undefined, true, false), false);
			assert.strictEqual(resolveMinimapShown('hidden', false, true, false), false);
		});
	});
});
