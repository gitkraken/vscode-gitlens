import assert from 'node:assert';
import type { TemplateResult } from 'lit';
import type {
	CommitGraphRefsExtension,
	CommitGraphScrollMarkersExtension,
	CommitGraphStickyTimelineExtension,
	CommitGraphWipStatsExtension,
} from '../runtime.js';
import { defineCommitGraphProfile, minimalCommitGraphRuntime, prepareCommitGraphRuntime } from '../runtime.js';

const refs = { id: 'refs' } as CommitGraphRefsExtension;
const wipStats = { id: 'wip-stats' } as CommitGraphWipStatsExtension;
const stickyTimeline = { id: 'sticky-timeline' } as CommitGraphStickyTimelineExtension;
const scrollMarkers = { id: 'scroll-markers' } as CommitGraphScrollMarkersExtension;

suite('commit graph runtime composition', () => {
	test('minimal runtime has no optional hot-row providers', () => {
		assert.strictEqual(minimalCommitGraphRuntime.refs, undefined);
		assert.strictEqual(minimalCommitGraphRuntime.wipStats, undefined);
		assert.strictEqual(minimalCommitGraphRuntime.laneCollapse, undefined);
		assert.strictEqual(minimalCommitGraphRuntime.stickyTimeline, undefined);
		assert.strictEqual(minimalCommitGraphRuntime.scrollMarkers, undefined);
		assert.ok(Object.isFrozen(minimalCommitGraphRuntime));
	});

	test('prepares direct immutable slots once', () => {
		const profile = defineCommitGraphProfile({ extensions: [refs, wipStats, stickyTimeline, scrollMarkers] });
		const runtime = prepareCommitGraphRuntime(profile);

		assert.strictEqual(runtime.refs, refs);
		assert.strictEqual(runtime.wipStats, wipStats);
		assert.strictEqual(runtime.stickyTimeline, stickyTimeline);
		assert.strictEqual(runtime.scrollMarkers, scrollMarkers);
		assert.ok(Object.isFrozen(profile));
		assert.ok(Object.isFrozen(profile.extensions));
		assert.ok(Object.isFrozen(runtime));
	});

	test('rejects duplicate slots before mount', () => {
		assert.throws(
			() => prepareCommitGraphRuntime({ extensions: [refs, refs] }),
			/Duplicate commit graph extension slot 'refs'/,
		);
	});

	test('rejects a ref finder without refs', () => {
		assert.throws(
			() => prepareCommitGraphRuntime({ renderRefFinder: () => ({}) as TemplateResult }),
			/requires the 'refs' extension/,
		);
	});
});
