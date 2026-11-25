import * as assert from 'assert';
import type { ZoneSpec } from '@gitkraken/commit-graph/zones.js';
import { hasPersistentRowActions, lastVisibleZoneIndex, persistentRowActionCount } from '../persistentActions.js';

function zones(...ids: string[]): ZoneSpec[] {
	return ids.map(id => ({ id: id, width: 50 }) as unknown as ZoneSpec);
}

suite('persistent row actions', () => {
	test('counts the buttons shown at rest, and is zero without a persistent member', () => {
		assert.strictEqual(persistentRowActionCount({ kind: 'commit', isUnpulled: true }), 1);
		assert.strictEqual(
			persistentRowActionCount({
				kind: 'workdir',
				wipActions: [
					{ action: 'a', icon: 'x', label: 'A', persistent: true },
					{ action: 'b', icon: 'x', label: 'B', persistent: false },
				],
			}),
			1,
		);

		const none = [
			{ kind: 'commit' as const },
			{ kind: 'stash' as const, isUnpulled: true },
			{ kind: 'commit' as const, isUnpushed: true, supportedRowActions: [] },
		];
		for (const input of none) {
			assert.strictEqual(persistentRowActionCount(input), 0);
			assert.strictEqual(hasPersistentRowActions(input), false);
		}
	});

	test('the last visible zone skips suppressed cells and yields to a graph column spliced after it', () => {
		const z = zones('message', 'author', 'datetime');
		assert.strictEqual(lastVisibleZoneIndex(z, Infinity, -1, 'message', 0), 2);
		assert.strictEqual(lastVisibleZoneIndex(z, 1, -1, 'message', 0), 0);
		assert.strictEqual(lastVisibleZoneIndex(z, Infinity, -1, 'message', 3), -1);
	});
});
