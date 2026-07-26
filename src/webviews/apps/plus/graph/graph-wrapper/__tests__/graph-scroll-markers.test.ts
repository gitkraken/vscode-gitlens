import * as assert from 'assert';
import type { GraphScrollMarkerTypes } from '../../../../../plus/graph/protocol.js';
import { buildMergeTargetScrollMarkers } from '../graph-scroll-markers.js';

const enabled = new Set<GraphScrollMarkerTypes>(['selection', 'head', 'upstream', 'mergeTarget']);
// M3 is loaded (row 3); T9 stands for a target tip that hasn't paged in yet.
const indexBySha = new Map<string, number>([
	['F2', 0],
	['F1', 1],
	['M3', 3],
]);

suite('buildMergeTargetScrollMarkers', () => {
	test('type disabled → no markers', () => {
		const markers = buildMergeTargetScrollMarkers(
			new Set(['M3']),
			indexBySha,
			new Set<GraphScrollMarkerTypes>(['head']),
			'main',
		);
		assert.deepStrictEqual(markers, []);
	});

	test('no targets → no markers', () => {
		assert.deepStrictEqual(buildMergeTargetScrollMarkers(undefined, indexBySha, enabled, 'main'), []);
		assert.deepStrictEqual(buildMergeTargetScrollMarkers(new Set(), indexBySha, enabled, 'main'), []);
	});

	test('target row not loaded → dropped (deferred resolve beat the page)', () => {
		assert.deepStrictEqual(buildMergeTargetScrollMarkers(new Set(['T9']), indexBySha, enabled, 'main'), []);
	});

	test('marks the target row at its display index', () => {
		const markers = buildMergeTargetScrollMarkers(new Set(['M3']), indexBySha, enabled, 'main');
		assert.strictEqual(markers.length, 1);
		assert.strictEqual(markers[0].index, 3);
	});

	test('row-marker + scope resolving to the same row → one marker', () => {
		// The union the caller passes collapses to a single sha, but a set of two shas landing on the same
		// index must collapse too — otherwise the row's tooltip lists "Merge Target" twice.
		const markers = buildMergeTargetScrollMarkers(
			new Set(['M3', 'M3-dup']),
			new Map([
				['M3', 3],
				['M3-dup', 3],
			]),
			enabled,
			'main',
		);
		assert.strictEqual(markers.length, 1);
	});

	test('two distinct loaded targets → one marker each', () => {
		const markers = buildMergeTargetScrollMarkers(new Set(['M3', 'F1']), indexBySha, enabled, undefined);
		assert.deepStrictEqual(
			markers.map(m => m.index).sort((a, b) => a - b),
			[1, 3],
		);
	});

	test('label carries the short ref name when known', () => {
		const [marker] = buildMergeTargetScrollMarkers(new Set(['M3']), indexBySha, enabled, 'refs/heads/main');
		assert.strictEqual(marker.label, 'Merge Target (main)');
	});

	test('label falls back to the bare role without a name (scope-only target)', () => {
		assert.strictEqual(
			buildMergeTargetScrollMarkers(new Set(['M3']), indexBySha, enabled, undefined)[0].label,
			'Merge Target',
		);
		assert.strictEqual(
			buildMergeTargetScrollMarkers(new Set(['M3']), indexBySha, enabled, '')[0].label,
			'Merge Target',
		);
	});

	test('renders as a full-rail thin line', () => {
		const [marker] = buildMergeTargetScrollMarkers(new Set(['M3']), indexBySha, enabled, 'main');
		assert.strictEqual(marker.shape, 'thinLine');
		assert.strictEqual(marker.leftPct, 0);
		assert.strictEqual(marker.widthPct, 100);
		assert.strictEqual(marker.icon, 'gl-merge-target');
	});
});
