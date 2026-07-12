import * as assert from 'assert';
import { solveZoneLayout } from '../view.js';
import type { ZoneSpec } from '../view.js';

suite('view — solveZoneLayout', () => {
	test('normal case: slack resolves exactly to targetWidth, fill absorbs the rounding remainder', () => {
		// Two recovering non-fill zones (fractional preferred widths) each round independently, so their
		// combined rounding diverges from rounding the target by one px — the fill zone must absorb it.
		const zones: ZoneSpec[] = [
			{ id: 'ref', label: 'Ref', width: 100.5, minWidth: 10, currentWidth: 50 },
			{ id: 'author', label: 'Author', width: 90.5, minWidth: 10, currentWidth: 40 },
			{ id: 'message', label: 'Message', width: 0, minWidth: 20, flex: true },
		];

		const solved = solveZoneLayout(zones, 220);

		const sum = solved.reduce((total, z) => total + (z.currentWidth ?? 0), 0);
		assert.strictEqual(sum, 220, 'solved widths sum exactly to targetWidth');
		assert.strictEqual(solved.find(z => z.id === 'ref')?.currentWidth, 101);
		assert.strictEqual(solved.find(z => z.id === 'author')?.currentWidth, 91);
		assert.strictEqual(solved.find(z => z.flex)?.currentWidth, 28, 'the fill zone absorbed the rounding remainder');
	});

	test('pathological case: targetWidth well below Σ minWidths leaves every zone at/above its floor', () => {
		// gitlens.graph.style forced to `table` in a very narrow panel bypasses the listAutoBelow
		// auto-switch — Σ minWidths (126) comfortably exceeds this targetWidth (10).
		const zones: ZoneSpec[] = [
			{ id: 'ref', label: 'Ref', width: 180, minWidth: 32 },
			{ id: 'message', label: 'Message', width: 0, minWidth: 50, flex: true },
			{ id: 'sha', label: 'Sha', width: 76, minWidth: 44 },
		];

		const solved = solveZoneLayout(zones, 10);

		for (const z of solved) {
			assert.ok(
				(z.currentWidth ?? 0) >= z.minWidth,
				`${z.id} stayed at/above its floor (${z.currentWidth} >= ${z.minWidth})`,
			);
		}
		// Non-fill zones sit exactly at their floors — the grid overflows at floors instead of going negative.
		assert.strictEqual(solved.find(z => z.id === 'ref')?.currentWidth, 32);
		assert.strictEqual(solved.find(z => z.id === 'sha')?.currentWidth, 44);
	});
});
