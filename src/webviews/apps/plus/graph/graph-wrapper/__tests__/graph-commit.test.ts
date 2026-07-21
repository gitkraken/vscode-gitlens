import * as assert from 'assert';
import type { ZoneSpec } from '@gitkraken/commit-graph/view.js';
import type { GraphColumnSetting, GraphColumnsSettings } from '../../../../../plus/graph/protocol.js';
import { columnsToZones, zonesToColumnsConfig } from '../graph-commit.js';

// A persisted-columns fixture with only the `changes` key — columnsToZones ignores keys with no matching
// default zone. Cast because GraphColumnsSettings is a full Record over every column name.
function changesColumns(setting: GraphColumnSetting): GraphColumnsSettings {
	// A single-key literal can't satisfy the full Record type, so widen via an intermediate.
	const columns = { changes: setting };
	return columns as GraphColumnsSettings;
}

suite('graph-commit — columns ↔ zones mode round-trip', () => {
	test('columnsToZones carries the persisted changes.mode', () => {
		const zones = columnsToZones(changesColumns({ width: 200, isHidden: false, order: 3, mode: 'squares' }));
		assert.strictEqual(zones?.find(z => z.id === 'changes')?.mode, 'squares');
	});

	test('columnsToZones falls back to the default mode when none is persisted', () => {
		const zones = columnsToZones(changesColumns({ width: 200, isHidden: false, order: 3 }));
		assert.strictEqual(zones?.find(z => z.id === 'changes')?.mode, 'bar');
	});

	test('zonesToColumnsConfig writes the zone mode back', () => {
		const zones: ZoneSpec[] = [{ id: 'changes', label: 'Changes', width: 200, minWidth: 50, mode: 'bipolar' }];
		assert.strictEqual(zonesToColumnsConfig(zones).changes?.mode, 'bipolar');
	});

	test('a full round-trip preserves a non-default mode', () => {
		const zones = columnsToZones(changesColumns({ width: 200, isHidden: false, order: 3, mode: 'numbers' }));
		assert.notStrictEqual(zones, undefined);
		assert.strictEqual(zonesToColumnsConfig(zones!).changes?.mode, 'numbers');
	});
});
