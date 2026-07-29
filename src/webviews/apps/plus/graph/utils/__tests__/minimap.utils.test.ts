import * as assert from 'assert';
import { resolveMinimapShown } from '../minimap.utils.js';

suite('resolveMinimapShown', () => {
	suite('policy `true` — always show', () => {
		test('no stored value → shown', () => {
			assert.strictEqual(resolveMinimapShown(true, undefined, false, false), true);
		});

		test('stored `true` → shown', () => {
			assert.strictEqual(resolveMinimapShown(true, true, false, false), true);
		});

		test('stored `false` → hidden, even while searching', () => {
			assert.strictEqual(resolveMinimapShown(true, false, false, false), false);
			assert.strictEqual(resolveMinimapShown(true, false, true, false), false);
		});
	});

	suite('policy `auto` — show on search', () => {
		test('no stored value → follows the search', () => {
			assert.strictEqual(resolveMinimapShown('auto', undefined, false, false), false);
			assert.strictEqual(resolveMinimapShown('auto', undefined, true, false), true);
		});

		test('stored `false` is not an override — still follows the search', () => {
			assert.strictEqual(resolveMinimapShown('auto', false, false, false), false);
			assert.strictEqual(resolveMinimapShown('auto', false, true, false), true);
		});

		test('stored `true` pins it open regardless of the search', () => {
			assert.strictEqual(resolveMinimapShown('auto', true, false, false), true);
			assert.strictEqual(resolveMinimapShown('auto', true, true, false), true);
		});

		test('dismissal suppresses the auto-show while the search is still running', () => {
			assert.strictEqual(resolveMinimapShown('auto', undefined, true, true), false);
			assert.strictEqual(resolveMinimapShown('auto', false, true, true), false);
		});

		test('dismissal never overrides a pin', () => {
			assert.strictEqual(resolveMinimapShown('auto', true, true, true), true);
		});
	});

	suite('policy `false` — never show', () => {
		test('no stored value → hidden', () => {
			assert.strictEqual(resolveMinimapShown(false, undefined, false, false), false);
		});

		test('stored `false` → hidden', () => {
			assert.strictEqual(resolveMinimapShown(false, false, false, false), false);
		});

		test('stored `true` → shown', () => {
			assert.strictEqual(resolveMinimapShown(false, true, false, false), true);
		});

		test('a running search does not show it', () => {
			assert.strictEqual(resolveMinimapShown(false, undefined, true, false), false);
		});
	});
});
