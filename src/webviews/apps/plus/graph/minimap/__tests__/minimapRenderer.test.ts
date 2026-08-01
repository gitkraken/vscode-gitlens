import * as assert from 'assert';
import type { GraphMinimapStats } from '../minimap.js';
import {
	buildViewModel,
	computeMonotoneTangents,
	dayToX,
	layout,
	padScopeRange,
	scopeZoomPaddingMs,
	xToDay,
} from '../minimapRenderer.js';

const today = new Date(2024, 5, 10).setHours(0, 0, 0, 0);
const yesterday = today - 86_400_000;
const twoDaysAgo = today - 2 * 86_400_000;

suite('minimapRenderer Test Suite', () => {
	test('layout produces zero barWidth when dayCount is 0', () => {
		const lo = layout(500, 40, 1, 0, false);
		assert.strictEqual(lo.barWidth, 0);
	});

	test('layout uses the full canvas width (the host CSS reserves the popover gutter)', () => {
		const lo = layout(500, 40, 1, 10, false);
		assert.strictEqual(lo.chartWidth, 500);
		assert.strictEqual(lo.barWidth, 50);
	});

	test('layout reserves vertical space for the bottom marker strip', () => {
		const lo = layout(500, 40, 1, 10, false);
		// markerShortY (4) + markerSize (3) + markerLaneGapPx (3) = 10 reserved from the bottom
		assert.strictEqual(lo.activityHeight, 30);
	});

	test('buildViewModel fills a contiguous day range from today back to the oldest key', () => {
		const data = new Map<number, GraphMinimapStats>([
			[today, { commits: 3, sha: 'a' }],
			[twoDaysAgo, { commits: 1, sha: 'c' }],
		]);
		const vm = buildViewModel(data, 'commits', today);
		assert.strictEqual(vm.days.length, 3);
		assert.strictEqual(vm.days[0], today);
		assert.strictEqual(vm.days[1], yesterday);
		assert.strictEqual(vm.days[2], twoDaysAgo);
		assert.strictEqual(vm.activity[0], 3);
		assert.strictEqual(vm.activity[1], 0);
		assert.strictEqual(vm.activity[2], 1);
	});

	test('buildViewModel in lines mode sums additions and deletions', () => {
		const data = new Map<number, GraphMinimapStats>([
			[
				today,
				{
					commits: 1,
					activity: { additions: 7, deletions: 3 },
					files: 2,
					sha: 'a',
				},
			],
		]);
		const vm = buildViewModel(data, 'lines', today);
		assert.strictEqual(vm.activity[0], 10);
	});

	test('xToDay maps a pointer x within a bar back to the expected day', () => {
		const data = new Map<number, GraphMinimapStats>([
			[today, { commits: 1, sha: 'a' }],
			[yesterday, { commits: 1, sha: 'b' }],
		]);
		const vm = buildViewModel(data, 'commits', today);
		const lo = layout(500, 40, 1, vm.days.length, false);
		// vm.days.length is 2, chartWidth is 500, barWidth is 250
		// Index 0 (today) covers x in [0, 250); index 1 (yesterday) covers [250, 500)
		assert.strictEqual(xToDay(10, vm, lo), today);
		assert.strictEqual(xToDay(200, vm, lo), today);
		assert.strictEqual(xToDay(260, vm, lo), yesterday);
	});

	test('xToDay returns undefined when the pointer is past the last day', () => {
		const data = new Map<number, GraphMinimapStats>([[today, { commits: 1, sha: 'a' }]]);
		const vm = buildViewModel(data, 'commits', today);
		const lo = layout(500, 40, 1, vm.days.length, false);
		// Single day: barWidth 500, so x=501 falls in index 1 (out of range)
		assert.strictEqual(xToDay(501, vm, lo), undefined);
	});

	test('dayToX returns the center of the bar for that day', () => {
		const data = new Map<number, GraphMinimapStats>([
			[today, { commits: 1, sha: 'a' }],
			[yesterday, { commits: 1, sha: 'b' }],
		]);
		const vm = buildViewModel(data, 'commits', today);
		const lo = layout(500, 40, 1, vm.days.length, false);
		// barWidth 250, first bar center at 125, second at 375
		assert.strictEqual(dayToX(today, vm, lo), 125);
		assert.strictEqual(dayToX(yesterday, vm, lo), 375);
	});

	test('dayToX returns undefined for days outside the view model', () => {
		const data = new Map<number, GraphMinimapStats>([[today, { commits: 1, sha: 'a' }]]);
		const vm = buildViewModel(data, 'commits', today);
		const lo = layout(500, 40, 1, vm.days.length, false);
		const futureDay = today + 86_400_000;
		assert.strictEqual(dayToX(futureDay, vm, lo), undefined);
	});

	test('computeMonotoneTangents produces zero tangents for a constant series', () => {
		const tangents = computeMonotoneTangents([5, 5, 5, 5], 1);
		for (const t of tangents) {
			assert.strictEqual(t, 0);
		}
	});

	test('computeMonotoneTangents preserves slope on a uniformly-increasing series', () => {
		// Secants are all 1; monotone clamp picks min(1, 1, |2|/4=0.5) * 2 = 1 for interior points
		const tangents = computeMonotoneTangents([0, 1, 2, 3], 1);
		assert.strictEqual(tangents[0], 1);
		assert.strictEqual(tangents[1], 1);
		assert.strictEqual(tangents[2], 1);
		assert.strictEqual(tangents[3], 1);
	});

	test('computeMonotoneTangents flattens the tangent at a local extremum', () => {
		// ys = [0, 1, 0] has adjacent secants 1 and -1 at the peak; the monotone algorithm zeros
		// the tangent at the peak to prevent overshoot
		const tangents = computeMonotoneTangents([0, 1, 0], 1);
		assert.strictEqual(tangents[0], 1);
		assert.strictEqual(tangents[1], 0);
		assert.strictEqual(tangents[2], -1);
	});

	test('computeMonotoneTangents returns zeros for fewer than two points', () => {
		assert.strictEqual(computeMonotoneTangents([], 1).length, 0);
		assert.strictEqual(computeMonotoneTangents([7], 1)[0], 0);
	});

	test('computeMonotoneTangents handles a two-point input with the single secant', () => {
		const tangents = computeMonotoneTangents([0, 4], 2);
		assert.strictEqual(tangents[0], 2);
		assert.strictEqual(tangents[1], 2);
	});

	test('reversed layout mirrors dayToX across the chart center', () => {
		const data = new Map<number, GraphMinimapStats>([
			[today, { commits: 1, sha: 'a' }],
			[yesterday, { commits: 1, sha: 'b' }],
		]);
		const vm = buildViewModel(data, 'commits', today);
		const lo = layout(500, 40, 1, vm.days.length, false);
		const loReversed = layout(500, 40, 1, vm.days.length, true);
		// Normal: today's bar center at 125, yesterday's at 375.
		// Reversed: chartWidth - x, so today moves to 375, yesterday to 125.
		assert.strictEqual(dayToX(today, vm, lo), 125);
		assert.strictEqual(dayToX(yesterday, vm, lo), 375);
		assert.strictEqual(dayToX(today, vm, loReversed), 375);
		assert.strictEqual(dayToX(yesterday, vm, loReversed), 125);
	});

	test('reversed layout swaps which bar a pointer x lands on', () => {
		const data = new Map<number, GraphMinimapStats>([
			[today, { commits: 1, sha: 'a' }],
			[yesterday, { commits: 1, sha: 'b' }],
		]);
		const vm = buildViewModel(data, 'commits', today);
		const loReversed = layout(500, 40, 1, vm.days.length, true);
		// Left half [0, 250) now maps to yesterday (oldest on the left); right half to today.
		assert.strictEqual(xToDay(10, vm, loReversed), yesterday);
		assert.strictEqual(xToDay(260, vm, loReversed), today);
	});

	test('padScopeRange pads a 1-day scope by `scopeZoomPaddingMs` on each side', () => {
		const start = today - 5 * 86_400_000;
		const end = start + 86_400_000;
		const padded = padScopeRange({ start: start, end: end });
		assert.strictEqual(padded.oldest, start - scopeZoomPaddingMs);
		assert.strictEqual(padded.newest, end + scopeZoomPaddingMs);
	});

	test('padScopeRange centers an empty scope (start === end) on the merge-base with non-zero span', () => {
		const mergeBase = today - 10 * 86_400_000;
		const padded = padScopeRange({ start: mergeBase, end: mergeBase });
		// Empty scope yields a 2*padding window centered on the merge-base; applyZoom widens further
		// to the brush-floor minimum, but `padScopeRange` itself only handles padding.
		assert.strictEqual(padded.oldest, mergeBase - scopeZoomPaddingMs);
		assert.strictEqual(padded.newest, mergeBase + scopeZoomPaddingMs);
		assert.ok(padded.newest > padded.oldest, 'expected non-zero span');
	});

	test('padScopeRange pads even wide scopes — there is no upper bypass', () => {
		const start = today - 60 * 86_400_000;
		const end = today - 5 * 86_400_000;
		const padded = padScopeRange({ start: start, end: end });
		assert.strictEqual(padded.oldest, start - scopeZoomPaddingMs);
		assert.strictEqual(padded.newest, end + scopeZoomPaddingMs);
	});

	test('padScopeRange normalizes inverted input (end before start)', () => {
		const a = today - 20 * 86_400_000;
		const b = today - 10 * 86_400_000;
		const padded = padScopeRange({ start: b, end: a });
		assert.strictEqual(padded.oldest, a - scopeZoomPaddingMs);
		assert.strictEqual(padded.newest, b + scopeZoomPaddingMs);
	});

	test('reversed dayToX round-trips back through xToDay', () => {
		const data = new Map<number, GraphMinimapStats>([
			[today, { commits: 1, sha: 'a' }],
			[yesterday, { commits: 1, sha: 'b' }],
			[twoDaysAgo, { commits: 1, sha: 'c' }],
		]);
		const vm = buildViewModel(data, 'commits', today);
		for (const reversed of [false, true]) {
			const lo = layout(600, 40, 1, vm.days.length, reversed);
			for (const day of [today, yesterday, twoDaysAgo]) {
				const x = dayToX(day, vm, lo);
				assert.ok(x != null, 'expected an x for a known day');
				assert.strictEqual(xToDay(x, vm, lo), day, `round-trip failed when reversed=${reversed}`);
			}
		}
	});
});
