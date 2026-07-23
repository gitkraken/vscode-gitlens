import * as assert from 'assert';
import type { ZoneSpec } from '@gitkraken/commit-graph/view.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import type { GraphColumnSetting, GraphColumnsSettings } from '../../../../../plus/graph/protocol.js';
import { columnsToZones, toGraphCommit, zonesToColumnsConfig } from '../graph-commit.js';

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

// Serialized `data-vscode-context` a branch pill would carry, matching the host's shape.
function branchContext(webviewItem: string, name: string): string {
	return JSON.stringify({
		webviewItem: webviewItem,
		webviewItemValue: { type: 'branch', ref: { refType: 'branch', name: name } },
	});
}

// Serialized refGROUP context the host ships on `contexts.refGroups[name]` for a grouped ref.
function refGroupContext(webviewItemGroup: string): string {
	return JSON.stringify({
		webviewItemGroup: webviewItemGroup,
		webviewItemGroupValue: { type: 'refGroup', refs: [] },
	});
}

function commitRow(overrides: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: 'abc1234',
		parents: ['def5678'],
		author: 'Author',
		email: 'author@example.com',
		date: 0,
		message: 'a commit',
		type: 'commit-node',
		...overrides,
	};
}

suite('graph-commit — branch pill context (grouped ref parity)', () => {
	test('a grouped branch pill MERGES the branch and refGroup contexts', () => {
		// A current branch in sync with its upstream on the same commit ⇒ the host groups local + remote.
		const row = commitRow({
			heads: [
				{
					name: 'main',
					isCurrentHead: true,
					upstream: { name: 'origin/main', id: 'repo|remotes/origin/main' },
					context: branchContext('gitlens:branch+current+tracking', 'main'),
				},
			],
			contexts: { refGroups: { main: refGroupContext('gitlens:refGroup+current') } },
		});

		const ref = toGraphCommit(row).commitRefs.find(r => r.kind === 'head' && r.name === 'main');
		assert.ok(ref?.context != null, 'the head ref should carry a pill context');

		// The pill exposes BOTH the branch `when` keys and the refGroup keys — restoring branch actions
		// (e.g. "Rebase Current Branch onto Upstream…") alongside "Hide All".
		const ctx = JSON.parse(ref.context);
		assert.ok(ctx.webviewItem.startsWith('gitlens:branch'), 'merged context keeps webviewItem');
		assert.strictEqual(ctx.webviewItemGroup, 'gitlens:refGroup+current', 'merged context keeps webviewItemGroup');
		assert.strictEqual(ctx.webviewItemValue?.type, 'branch');
		assert.strictEqual(ctx.webviewItemGroupValue?.type, 'refGroup');

		// refContext stays the PURE individual (the branch sheet reads it) — no refGroup keys.
		const refCtx = JSON.parse(ref.refContext!);
		assert.ok(refCtx.webviewItem.startsWith('gitlens:branch'));
		assert.strictEqual(refCtx.webviewItemGroup, undefined, 'refContext must not carry refGroup keys');
	});

	test('an ungrouped branch pill context is the individual context (no refGroup keys)', () => {
		const row = commitRow({
			heads: [
				{ name: 'feature', isCurrentHead: false, context: branchContext('gitlens:branch+tracking', 'feature') },
			],
		});

		const ref = toGraphCommit(row).commitRefs.find(r => r.kind === 'head' && r.name === 'feature');
		const ctx = JSON.parse(ref!.context!);
		assert.ok(ctx.webviewItem.startsWith('gitlens:branch'));
		assert.strictEqual(ctx.webviewItemGroup, undefined, 'an ungrouped pill has no refGroup keys');
		// With no group there's nothing to merge, so the pill context IS the individual context.
		assert.strictEqual(ref!.context, ref!.refContext);
	});
});
