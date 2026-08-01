import * as assert from 'assert';
import type { TimelineDatum } from '../../../../../../plus/timeline/protocol.js';
import { buildViewModel } from '../timelineData.js';
import {
	computeLayout,
	hitTestBubble,
	maxRowHeight,
	minRowHeight,
	tsToX,
	visibleIndexRange,
	xToTs,
} from '../timelineRenderer.js';

const datum = (overrides: Partial<TimelineDatum> & { offset: number }): TimelineDatum => ({
	sha: overrides.sha ?? `s${overrides.offset}`,
	author: overrides.author ?? 'Alice',
	date: new Date(Date.UTC(2026, 0, 1 + overrides.offset)).toISOString(),
	message: overrides.message ?? '',
	files: overrides.files,
	additions: overrides.additions ?? 5,
	deletions: overrides.deletions ?? 0,
	branches: overrides.branches,
	sort: overrides.offset,
});

suite('timelineRenderer Test Suite', () => {
	suite('layout', () => {
		test('reserves a left gutter for the rail+Y2 column and a right gutter for the V-scrollbar', () => {
			const lo = computeLayout(800, 400, 1, 5);
			assert.ok(lo.chartLeft > 0, 'chartLeft must reserve gutter for the rail+Y2');
			assert.ok(lo.chartRight < 800, 'chartRight must reserve gutter for the V-scrollbar');
			assert.strictEqual(lo.chartWidth, lo.chartRight - lo.chartLeft);
		});

		test('honors custom gutter overrides', () => {
			const lo = computeLayout(800, 400, 1, 5, { gutterLeft: 80, gutterRight: 8 });
			assert.strictEqual(lo.chartLeft, 80);
			assert.strictEqual(lo.chartRight, 792);
		});

		test('clamps row height to minRowHeight even when many slices would compress them', () => {
			// 50 slices in a tall canvas would naturally produce ≪minRowHeight rows — V8's contract
			// is to scroll instead of squeeze, so the row height stays at minRowHeight and the
			// virtual height overflows the visible region. Use a tall canvas so the adaptive
			// row-height floor stays at the lush minRowHeight.
			const lo = computeLayout(800, 1000, 1, 50);
			assert.strictEqual(lo.rowHeight, minRowHeight);
			// virtualSwimlaneHeight = topBuffer + sliceCount × rowHeight + bottomBuffer.
			const buffers = lo.swimlaneTopBufferPx * 2;
			assert.strictEqual(lo.virtualSwimlaneHeight, 50 * minRowHeight + buffers);
			assert.ok(lo.virtualSwimlaneHeight > lo.swimlaneBottom - lo.swimlaneTop);
		});

		test('does not exceed maxRowHeight even with very few slices', () => {
			const lo = computeLayout(800, 1000, 1, 2);
			assert.ok(lo.rowHeight <= maxRowHeight, `expected ≤ ${maxRowHeight}, got ${lo.rowHeight}`);
		});

		test('virtualSwimlaneHeight is rowHeight × sliceCount + top/bottom buffers', () => {
			const lo = computeLayout(800, 400, 1, 6);
			const buffers = lo.swimlaneTopBufferPx * 2;
			assert.strictEqual(lo.virtualSwimlaneHeight, 6 * lo.rowHeight + buffers);
		});

		test('volume strip occupies the bottom slice; X-axis labels overlay the volume top', () => {
			const lo = computeLayout(800, 400, 1, 3);
			assert.strictEqual(lo.volumeBottom, 400);
			assert.ok(lo.volumeTop < lo.volumeBottom);
			// X-axis labels render in a DOM overlay anchored to the dedicated label strip between
			// the swimlane and the volume top.
			assert.strictEqual(lo.swimlaneBottom, lo.axisStripTop);
			assert.strictEqual(lo.axisStripBottom, lo.volumeTop);
			assert.ok(lo.axisStripBottom >= lo.axisStripTop);
		});

		test('hides the volume strip when showVolume is false', () => {
			const lo = computeLayout(800, 400, 1, 3, { showVolume: false });
			assert.strictEqual(lo.volumeTop, lo.volumeBottom);
			// With no volume, the swimlane goes all the way to the canvas bottom.
			assert.strictEqual(lo.swimlaneBottom, 400);
		});

		test('header occupies a fixed strip at the top', () => {
			const lo = computeLayout(800, 400, 1, 3);
			assert.strictEqual(lo.headerY, 0);
			assert.ok(lo.headerHeight > 0);
			assert.strictEqual(lo.swimlaneTop, lo.headerHeight);
		});
	});

	suite('tsToX / xToTs round-trip', () => {
		const lo = computeLayout(1000, 400, 1, 4);
		const oldest = new Date(Date.UTC(2026, 0, 1)).getTime();
		const newest = new Date(Date.UTC(2026, 1, 1)).getTime();

		test('oldest projects to chartLeft + dataInsetX', () => {
			assert.strictEqual(tsToX(oldest, oldest, newest, lo), lo.chartLeft + lo.dataInsetX);
		});

		test('newest projects to chartRight - dataInsetX', () => {
			assert.strictEqual(tsToX(newest, oldest, newest, lo), lo.chartRight - lo.dataInsetX);
		});

		test('midpoint projects to the middle of the chart', () => {
			const mid = (oldest + newest) / 2;
			const expected = lo.chartLeft + lo.chartWidth / 2;
			assert.ok(Math.abs(tsToX(mid, oldest, newest, lo) - expected) < 0.001);
		});

		test('xToTs inverts tsToX', () => {
			const ts = oldest + (newest - oldest) * 0.42;
			const x = tsToX(ts, oldest, newest, lo);
			const back = xToTs(x, oldest, newest, lo);
			assert.ok(Math.abs(back - ts) < 1, `round-trip drift ${back - ts}ms`);
		});

		test('returns NaN when the domain has zero width', () => {
			assert.ok(Number.isNaN(tsToX(oldest, oldest, oldest, lo)));
			assert.ok(Number.isNaN(xToTs(lo.chartLeft, oldest, oldest, lo)));
		});
	});

	suite('visibleIndexRange', () => {
		const arr = new Float64Array([10, 20, 30, 40, 50]);

		test('returns [0, 0) on an empty array', () => {
			assert.deepStrictEqual(visibleIndexRange(new Float64Array([]), 0, 100), [0, 0]);
		});

		test('returns the full range when bounds cover everything', () => {
			assert.deepStrictEqual(visibleIndexRange(arr, 0, 1000), [0, 5]);
		});

		test('clamps to the inclusive intersection', () => {
			assert.deepStrictEqual(visibleIndexRange(arr, 20, 40), [1, 4]);
		});

		test('returns an empty range when bounds fall between values', () => {
			assert.deepStrictEqual(visibleIndexRange(arr, 25, 27), [2, 2]);
		});

		test('returns an empty range when bounds are entirely below the data', () => {
			assert.deepStrictEqual(visibleIndexRange(arr, 0, 5), [0, 0]);
		});
	});

	suite('hitTestBubble', () => {
		test('returns undefined when the cursor is outside the chart region', () => {
			const dataset = [datum({ offset: 0, sha: 'a' })];
			const vm = buildViewModel({ dataset: dataset, sliceBy: 'author' });
			const lo = computeLayout(800, 400, 1, 1);
			assert.strictEqual(hitTestBubble(0, 0, 0, vm, vm.oldest, vm.newest, lo), undefined);
		});

		test('hits a bubble at its center', () => {
			// Two commits on different days so the timestamp domain has non-zero width.
			const dataset = [
				datum({ offset: 0, sha: 'a', additions: 50 }),
				datum({ offset: 5, sha: 'b', additions: 50 }),
			];
			const vm = buildViewModel({ dataset: dataset, sliceBy: 'author' });
			const lo = computeLayout(800, 400, 1, vm.slices.length);

			const cx = tsToX(vm.timestamps[0], vm.oldest, vm.newest, lo);
			const cy = lo.swimlaneTop + lo.rowHeight / 2;
			const idx = hitTestBubble(cx, cy, 0, vm, vm.oldest, vm.newest, lo);
			assert.strictEqual(idx, 0);
		});

		test('respects scrollY when locating a bubble in a scrolled-off-screen row', () => {
			const dataset: TimelineDatum[] = [];
			for (let i = 0; i < 10; i++) {
				// Each commit on a separate author so each gets its own row.
				// Stagger the timestamps so the domain has non-zero width.
				dataset.push(datum({ offset: i, sha: `s${i}`, author: `Author ${i}`, additions: 10 }));
			}
			const vm = buildViewModel({ dataset: dataset, sliceBy: 'author' });
			const lo = computeLayout(400, 200, 1, vm.slices.length);

			// Find the row whose author has the highest sliceIndex — that's the row that gets scrolled
			// into view via scrollY below.
			let targetSliceIndex = -1;
			let targetVmIndex = -1;
			for (const slice of vm.slices) {
				if (slice.colorIndex > targetSliceIndex) {
					targetSliceIndex = slice.colorIndex;
				}
			}
			for (let i = 0; i < vm.commits.length; i++) {
				if (vm.sliceIndex[i] === targetSliceIndex) {
					targetVmIndex = i;
					break;
				}
			}

			const targetVirtualY = targetSliceIndex * lo.rowHeight + lo.rowHeight / 2;
			// Scroll so the target row sits at the swimlaneTop.
			const scrollY = targetVirtualY - lo.rowHeight / 2;

			const cx = tsToX(vm.timestamps[targetVmIndex], vm.oldest, vm.newest, lo);
			const cy = lo.swimlaneTop + lo.rowHeight / 2;
			assert.strictEqual(hitTestBubble(cx, cy, scrollY, vm, vm.oldest, vm.newest, lo), targetVmIndex);
		});
	});
});
