import * as assert from 'assert';
import { colorForColumn, contrastColor, LANE_PALETTE, setLanePalette } from '../colors.js';

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

suite('colors — contrastColor', () => {
	const grey = (n: number) => `#${n.toString(16).padStart(2, '0').repeat(3)}`;

	test('switches at the WCAG equal-contrast crossover, matching CSS contrast-color()', () => {
		// Black and white give equal contrast at luminance sqrt(1.05 * 0.05) - 0.05; on a grey ramp
		// that lands between 8-bit 117 and 118, which is also where the browser's contrast-color()
		// switches. Pinning the boundary here is what catches a re-tuned threshold.
		assert.strictEqual(contrastColor(grey(117)), '#ffffff');
		assert.strictEqual(contrastColor(grey(118)), '#000000');
	});

	test('picks black on every bundled lane, so the default graph is unaffected', () => {
		// The palette is generated at OKLCH lightness 0.78, well clear of the crossover. If a future
		// palette tweak drops a lane below it this fails, which is the point — knockout legibility
		// is a constraint on the palette, not just on this function.
		for (const lane of LANE_PALETTE) {
			assert.strictEqual(contrastColor(lane), '#000000', `lane ${lane}`);
		}
	});

	test('picks black on mid-luminance fills a 0.4 threshold got wrong', () => {
		// Regression: these sit at luminance ~0.27-0.29, above the crossover but below the 0.4 the
		// function once used, so they took white at ~3.1:1 where black gives ~6.5:1.
		assert.strictEqual(contrastColor('#BF8803'), '#000000');
		assert.strictEqual(contrastColor('#e4676b'), '#000000');
	});

	test('inverts at the extremes', () => {
		assert.strictEqual(contrastColor('#000000'), '#ffffff');
		assert.strictEqual(contrastColor('#ffffff'), '#000000');
	});
});
