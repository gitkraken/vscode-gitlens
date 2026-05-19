import * as assert from 'assert';
import type { GraphRow } from '@gitkraken/gitkraken-components';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { createSecondaryWipSha } from '../../../../../plus/graph/protocol.js';
import type { WipCandidate } from '../nearestWip.js';
import { findNearestWipSha } from '../nearestWip.js';

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
