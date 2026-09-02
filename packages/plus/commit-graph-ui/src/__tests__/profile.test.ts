import assert from 'node:assert';
import { minimalCommitGraphProfile } from '../profile.js';

suite('commit graph profile composition', () => {
	test('minimal profile has no optional hot-row providers', () => {
		assert.strictEqual(minimalCommitGraphProfile.refs, undefined);
		assert.strictEqual(minimalCommitGraphProfile.wipStats, undefined);
		assert.strictEqual(minimalCommitGraphProfile.laneCollapse, undefined);
		assert.strictEqual(minimalCommitGraphProfile.stickyTimeline, undefined);
		assert.strictEqual(minimalCommitGraphProfile.scrollMarkers, undefined);
		assert.ok(Object.isFrozen(minimalCommitGraphProfile));
	});
});
