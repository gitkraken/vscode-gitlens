import * as assert from 'assert';
import type { ColumnNumberBySha, GraphRow } from '@gitkraken/gitkraken-components';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { createSecondaryWipSha } from '../../../../../plus/graph/protocol.js';
import type { WipCandidate } from '../nearestWip.js';
import { filterWipsInLaneOf, findNearestWipSha } from '../nearestWip.js';

function commit(sha: string, parents: string[] = []): GraphRow {
	return { sha: sha, parents: parents, type: 'commit-node' } as unknown as GraphRow;
}

suite('findNearestWipSha', () => {
	test('single WIP — picked regardless of fromSha relationship', () => {
		const rows: GraphRow[] = [commit('A', ['B']), commit('B', ['C']), commit('C')];
		const wips: WipCandidate[] = [{ sha: uncommitted, anchor: 'A' }];

		assert.strictEqual(findNearestWipSha('A', wips, rows), uncommitted);
		assert.strictEqual(findNearestWipSha('B', wips, rows), uncommitted);
		assert.strictEqual(findNearestWipSha('C', wips, rows), uncommitted);
	});

	test('two WIPs — picks the one whose anchor has fromSha as ancestor', () => {
		const secondarySha = createSecondaryWipSha('/repo/wt');
		const rows: GraphRow[] = [
			commit('A1', ['A2']),
			commit('A2', ['A3']),
			commit('A3'),
			commit('B1', ['B2']),
			commit('B2', ['B3']),
			commit('B3'),
		];
		const wips: WipCandidate[] = [
			{ sha: uncommitted, anchor: 'A1' },
			{ sha: secondarySha, anchor: 'B1' },
		];

		assert.strictEqual(findNearestWipSha('A3', wips, rows), uncommitted);
		assert.strictEqual(findNearestWipSha('B2', wips, rows), secondarySha);
		assert.strictEqual(findNearestWipSha('B3', wips, rows), secondarySha);
	});

	test('two WIPs equidistant — first encountered wins (deterministic)', () => {
		const secondarySha = createSecondaryWipSha('/repo/wt');
		const rows: GraphRow[] = [commit('X')];
		const wips: WipCandidate[] = [
			{ sha: uncommitted, anchor: 'X' },
			{ sha: secondarySha, anchor: 'X' },
		];

		assert.strictEqual(findNearestWipSha('X', wips, rows), uncommitted);
	});

	test('fromSha not an ancestor of any WIP anchor — falls back to primary WIP', () => {
		const secondarySha = createSecondaryWipSha('/repo/wt');
		const rows: GraphRow[] = [
			commit('A1', ['A2']),
			commit('A2'),
			commit('B1', ['B2']),
			commit('B2'),
			commit('orphan'),
		];
		const wips: WipCandidate[] = [
			{ sha: uncommitted, anchor: 'A1' },
			{ sha: secondarySha, anchor: 'B1' },
		];

		assert.strictEqual(findNearestWipSha('orphan', wips, rows), uncommitted);
	});

	test('fallback when no primary — returns the first WIP', () => {
		const secondarySha = createSecondaryWipSha('/repo/wt');
		const rows: GraphRow[] = [commit('B1'), commit('orphan')];
		const wips: WipCandidate[] = [{ sha: secondarySha, anchor: 'B1' }];

		assert.strictEqual(findNearestWipSha('orphan', wips, rows), secondarySha);
	});

	test('no WIPs — returns undefined', () => {
		const rows: GraphRow[] = [commit('A', ['B']), commit('B')];
		assert.strictEqual(findNearestWipSha('A', [], rows), undefined);
	});

	test('no rows — returns first WIP via fallback', () => {
		const wips: WipCandidate[] = [{ sha: uncommitted, anchor: 'A' }];
		assert.strictEqual(findNearestWipSha('A', wips, undefined), uncommitted);
	});

	test('fromSha equals an anchor — distance 0 wins over deeper ancestors', () => {
		const secondarySha = createSecondaryWipSha('/repo/wt');
		const rows: GraphRow[] = [commit('A1', ['A2']), commit('A2'), commit('B1', ['B2']), commit('B2')];
		const wips: WipCandidate[] = [
			{ sha: uncommitted, anchor: 'A1' },
			{ sha: secondarySha, anchor: 'B1' },
		];

		assert.strictEqual(findNearestWipSha('B1', wips, rows), secondarySha);
	});
});

suite('filterWipsInLaneOf', () => {
	const secondarySha = createSecondaryWipSha('/repo/wt');
	const wips: WipCandidate[] = [
		{ sha: uncommitted, anchor: 'A1' },
		{ sha: secondarySha, anchor: 'B1' },
	];

	test('keeps WIPs whose anchor shares the clicked commit column', () => {
		const columns: ColumnNumberBySha = { A1: 0, A2: 0, B1: 1 };
		const result = filterWipsInLaneOf('A2', wips, columns);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].sha, uncommitted);
	});

	test('drops off-column WIPs', () => {
		const columns: ColumnNumberBySha = { A1: 0, B1: 1, X: 0 };
		const result = filterWipsInLaneOf('X', wips, columns);
		assert.deepStrictEqual(
			result.map(w => w.sha),
			[uncommitted],
		);
	});

	test('returns input identity when columnsBySha is undefined', () => {
		assert.strictEqual(filterWipsInLaneOf('A1', wips, undefined), wips);
	});

	test('returns input identity when fromSha column is unknown', () => {
		const columns: ColumnNumberBySha = { A1: 0, B1: 1 };
		assert.strictEqual(filterWipsInLaneOf('unknown', wips, columns), wips);
	});

	test('returns empty array when no WIPs share the clicked commit column', () => {
		const columns: ColumnNumberBySha = { A1: 0, B1: 1, X: 2 };
		const result = filterWipsInLaneOf('X', wips, columns);
		assert.deepStrictEqual(result, []);
	});
});
