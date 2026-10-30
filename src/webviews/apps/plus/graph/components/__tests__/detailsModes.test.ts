import * as assert from 'assert';
import { GlDetailsCommitPanel } from '../../../../commitDetails/components/gl-details-commit-panel.js';
import { GlDetailsMultiCommitPanel } from '../gl-details-multicommit-panel.js';
import { GlDetailsWipHeader } from '../gl-details-wip-header.js';

type Mode = 'review' | 'compose' | 'resolve';

const computeWipModes: (this: { aiEnabled: boolean; wip?: { changes?: { hasConflicts?: boolean } } }) => Mode[] =
	Reflect.get(GlDetailsWipHeader.prototype, 'computeWipModes');
const computeCommitModes: (this: { aiEnabled: boolean; isUncommitted: boolean }) => Mode[] = Reflect.get(
	GlDetailsCommitPanel.prototype,
	'computeCommitModes',
);
const computeCompareModes: (this: object) => Mode[] = Reflect.get(
	GlDetailsMultiCommitPanel.prototype,
	'computeCompareModes',
);

suite('Details mode toggles — Review without AI', () => {
	test('WIP offers Compose and Review with AI, Resolve too when conflicted', () => {
		assert.deepStrictEqual(computeWipModes.call({ aiEnabled: true, wip: { changes: {} } }), ['compose', 'review']);
		assert.deepStrictEqual(computeWipModes.call({ aiEnabled: true, wip: { changes: { hasConflicts: true } } }), [
			'resolve',
			'compose',
			'review',
		]);
	});

	test('WIP offers Review only without AI, conflicted or not', () => {
		assert.deepStrictEqual(computeWipModes.call({ aiEnabled: false, wip: { changes: {} } }), ['review']);
		assert.deepStrictEqual(computeWipModes.call({ aiEnabled: false, wip: { changes: { hasConflicts: true } } }), [
			'review',
		]);
	});

	test('a commit offers Review with AI and without it', () => {
		assert.deepStrictEqual(computeCommitModes.call({ aiEnabled: true, isUncommitted: false }), ['review']);
		assert.deepStrictEqual(computeCommitModes.call({ aiEnabled: false, isUncommitted: false }), ['review']);
	});

	test('uncommitted changes in the commit panel keep Compose for AI only', () => {
		assert.deepStrictEqual(computeCommitModes.call({ aiEnabled: true, isUncommitted: true }), [
			'compose',
			'review',
		]);
		assert.deepStrictEqual(computeCommitModes.call({ aiEnabled: false, isUncommitted: true }), ['review']);
	});

	test('a range of commits offers Review whether or not AI is on', () => {
		// The range panel takes no AI flag at all — Review is its only mode either way.
		assert.deepStrictEqual(computeCompareModes.call({}), ['review']);
	});
});
