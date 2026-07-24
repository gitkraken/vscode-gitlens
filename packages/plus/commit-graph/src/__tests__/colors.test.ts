import * as assert from 'assert';
import { colorForColumn, LANE_PALETTE, setLanePalette } from '../colors.js';

suite('colors — lane palette', () => {
	teardown(() => {
		// Every test that swaps the palette must reset it — `activePalette` is module-level state
		// shared across tests.
		setLanePalette(undefined);
	});

	test('colorForColumn reads the default LANE_PALETTE', () => {
		assert.strictEqual(colorForColumn(0), LANE_PALETTE[0]);
		assert.strictEqual(colorForColumn(LANE_PALETTE.length), LANE_PALETTE[0]); // wraps
	});

	// Distinct, valid 6-digit hex per lane — index-derived so each entry differs from LANE_PALETTE.
	function distinctPalette(): string[] {
		return LANE_PALETTE.map((_, i) => `#${i.toString(16).padStart(6, '0')}`);
	}

	test('setLanePalette swaps the active palette and colorForColumn reflects it', () => {
		const custom = distinctPalette();
		const changed = setLanePalette(custom);
		assert.strictEqual(changed, true);
		assert.strictEqual(colorForColumn(0), custom[0]);
		assert.strictEqual(colorForColumn(1), custom[1]);
	});

	test('setLanePalette(undefined) resets to the default', () => {
		setLanePalette(distinctPalette());
		const changed = setLanePalette(undefined);
		assert.strictEqual(changed, true);
		assert.strictEqual(colorForColumn(0), LANE_PALETTE[0]);
	});

	test('setLanePalette returns false when the resolved palette is unchanged', () => {
		assert.strictEqual(setLanePalette(undefined), false); // already the default
		assert.strictEqual(setLanePalette([...LANE_PALETTE]), false); // element-wise identical
	});

	test('setLanePalette returns true when only one lane differs', () => {
		const almostSame = LANE_PALETTE.slice();
		almostSame[0] = '#ABCDEF';
		assert.strictEqual(setLanePalette(almostSame), true);
		assert.strictEqual(setLanePalette(almostSame), false); // now already active — no further change
	});
});
