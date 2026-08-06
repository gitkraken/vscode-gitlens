import * as assert from 'assert';
import type { ColumnNumberBySha, WipCandidate, WipMetadataBySha, WipSearchRow } from '../nearestWip.js';
import { findNearestWipByAncestry, findWipInColumn } from '../nearestWip.js';

// Host sentinels the search is handed rather than knows: the primary working-changes revision (all
// zeroes, as GitLens uses) and the per-worktree secondary WIP row ids.
const uncommitted = '0000000000000000000000000000000000000000';
function wipRowId(worktreePath: string): string {
	return `wip::${worktreePath}`;
}

function commit(sha: string, parents: string[] = []): WipSearchRow {
	return { sha: sha, parents: parents };
}

/** The primary WIP as the host hands it in — flagged, so it wins every tie-break. */
function primaryWip(anchor: string): WipCandidate {
	return { sha: uncommitted, anchor: anchor, primary: true };
}

suite('findWipInColumn', () => {
	const featureWipSha = wipRowId('/repo/wt/feature');
	const otherWipSha = wipRowId('/repo/wt/other');

	// Helper: build the simplest metadata shape findWipInColumn cares about. Deliberately carries the
	// host's extra per-WIP fields too — the search reads a minimum shape and any superset works.
	function meta(entries: { sha: string; parentSha: string }[]): WipMetadataBySha {
		const out: Record<string, { repoPath: string; parentSha: string; label: string }> = {};
		for (const e of entries) {
			out[e.sha] = { repoPath: '/repo/wt', parentSha: e.parentSha, label: 'x' };
		}
		return out;
	}

	test('exact-anchor match: clicked commit IS a WIP anchor → that WIP, regardless of column', () => {
		// feature WIP anchored at the clicked commit. Column would put feature in column 2, but
		// the exact-anchor rule overrides — feature wins.
		const rows: WipSearchRow[] = [commit('TOP'), commit('SELECTED'), commit('OLDER')];
		const columns: ColumnNumberBySha = { TOP: 0, SELECTED: 1, OLDER: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'SELECTED' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), featureWipSha);
	});

	test('exact-anchor wins over column match', () => {
		// primary anchored at TOP (column 1, same as SELECTED). feature anchored at SELECTED.
		// Without exact-anchor, primary would win the column match. Exact-anchor returns feature.
		const rows: WipSearchRow[] = [commit('TOP'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 1, SELECTED: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'SELECTED' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), featureWipSha);
	});

	test('primary wins via exact-anchor when clicked commit IS branchʼs HEAD', () => {
		// primaryAnchor == fromSha (clicked the current branch's tip). uncommitted wins.
		const rows: WipSearchRow[] = [commit('HEAD'), commit('OLDER')];
		const columns: ColumnNumberBySha = { HEAD: 1, OLDER: 1 };

		assert.strictEqual(findWipInColumn('HEAD', rows, primaryWip('HEAD'), undefined, columns), uncommitted);
	});

	test('column match: only the same-column WIPs are considered', () => {
		// primary anchor at TOP (column 0 — different lane). feature at MID (column 1 — same
		// lane as SELECTED). feature wins; primary excluded.
		const rows: WipSearchRow[] = [commit('TOP'), commit('MID'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 0, MID: 1, SELECTED: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'MID' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), featureWipSha);
	});

	test('WIP whose anchor is BELOW (older than) the click is skipped, even if column matches', () => {
		// Click at row 1 (SELECTED). A WIP's anchor at row 3 (OLD_TIP) is below the click —
		// the branch's tip is older than the click, so the click can't be in that branch's
		// history. Even though column matches, this WIP should NOT be picked. Primary (TOP,
		// row 0, above the click, same column) wins.
		const rows: WipSearchRow[] = [commit('TOP'), commit('SELECTED'), commit('MID'), commit('OLD_TIP')];
		const columns: ColumnNumberBySha = { TOP: 1, SELECTED: 1, MID: 1, OLD_TIP: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'OLD_TIP' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), uncommitted);
	});

	test('only same-column WIP is BELOW the click → returns undefined (caller falls back to primary)', () => {
		// The below-anchor filter is absolute, not a preference: with no other candidate the
		// search returns undefined rather than reaching down for it. The caller then falls back
		// to the primary WIP (or, mid-column-load, to the ancestry search).
		const rows: WipSearchRow[] = [commit('SELECTED'), commit('OLD_TIP')];
		const columns: ColumnNumberBySha = { SELECTED: 1, OLD_TIP: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'OLD_TIP' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, undefined, m, columns), undefined);
	});

	test('partial column load: anchor whose column isnʼt yet known is KEPT (not dropped)', () => {
		// Simulates the column-recalc gap: SELECTED's column is known (1), and a freshly loaded
		// secondary's anchor column hasn't been recomputed yet (missing from map). The secondary
		// should still be considered. Setup: feature's anchor is NEARER than primary's, so under
		// the nearest-above rule it must win — proving the keep-unknown filter let it through (if
		// dropped, primary at FAR would win by default).
		const rows: WipSearchRow[] = [commit('FAR'), commit('M'), commit('NEW_ANCHOR'), commit('SELECTED')];
		// NEW_ANCHOR deliberately missing from columns (the partial-load scenario).
		const columns: ColumnNumberBySha = { FAR: 1, M: 1, SELECTED: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'NEW_ANCHOR' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('FAR'), m, columns), featureWipSha);
	});

	test('column match: NEAREST anchor above the click wins (most specific container)', () => {
		// Two WIPs both in column 1: primary far above (TOP row 0, distance 3), feature just
		// above (NEAR row 2, distance 1). Both checkouts contain SELECTED, so the nearest is the
		// one whose working changes sit directly on top of it — feature wins.
		const rows: WipSearchRow[] = [commit('TOP'), commit('M'), commit('NEAR'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 1, M: 1, NEAR: 1, SELECTED: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'NEAR' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), featureWipSha);
	});

	test('column match: nearest-above holds at lane scale (3 up beats 500 up)', () => {
		// Two anchors stacked in one lane above the cursor: the primary at the very top of 500
		// in-lane rows, a secondary 3 rows up. The near one wins however far the other is.
		const rows: WipSearchRow[] = [];
		const columns: Record<string, number> = {};
		for (let i = 0; i < 500; i++) {
			rows.push(commit(`R${i}`));
			columns[`R${i}`] = 1;
		}
		rows.push(commit('SELECTED'));
		columns.SELECTED = 1;
		const m = meta([{ sha: featureWipSha, parentSha: 'R497' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('R0'), m, columns), featureWipSha);
	});

	test('column match: exact-anchor still beats nearest (rule #1 wins regardless)', () => {
		// SELECTED is feature's exact anchor; rule #1 returns feature without the distance rule
		// ever running against primary's same-column anchor.
		const rows: WipSearchRow[] = [commit('TOP'), commit('M'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 1, M: 1, SELECTED: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'SELECTED' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), featureWipSha);
	});

	test('skips WIP whose anchor sha isnʼt in loaded rows (defensive — anchor paged out)', () => {
		// Secondary's anchor `MISSING` isn't in rows. The loop's `if (anchorIndex == null) continue`
		// must skip it without crashing and without picking it. Primary at TOP (in column, above)
		// wins by default.
		const rows: WipSearchRow[] = [commit('TOP'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 1, SELECTED: 1, MISSING: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'MISSING' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), uncommitted);
	});

	test('tie-break at equal distance: primary wins over secondary at the same row', () => {
		// Primary and secondary both anchored at TOP (row 0, 2 rows above SELECTED). Without the
		// tie-break helper, iteration order would decide (primary first → wins by luck). The
		// deterministic helper guarantees primary wins on ties regardless of order.
		const rows: WipSearchRow[] = [commit('TOP'), commit('M'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 1, M: 1, SELECTED: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'TOP' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), uncommitted);
	});

	test('tie-break at equal distance: lexicographically smaller sha wins between two secondaries', () => {
		// No primary; two secondaries both anchored at FAR (row 0). featureWipSha and
		// otherWipSha are both at distance 2 — the smaller sha wins deterministically.
		const rows: WipSearchRow[] = [commit('FAR'), commit('M'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { FAR: 1, M: 1, SELECTED: 1 };
		const m = meta([
			{ sha: featureWipSha, parentSha: 'FAR' },
			{ sha: otherWipSha, parentSha: 'FAR' },
		]);

		const winner = featureWipSha < otherWipSha ? featureWipSha : otherWipSha;
		assert.strictEqual(findWipInColumn('SELECTED', rows, undefined, m, columns), winner);
	});

	test('exact-anchor tie-break: primary wins over secondary at the same anchor', () => {
		// Detached worktree pinned at the same commit as the current branch's tip — both wips
		// share `SELECTED` as their anchor. Primary always wins via the tie-break helper.
		const rows: WipSearchRow[] = [commit('SELECTED'), commit('OLDER')];
		const columns: ColumnNumberBySha = { SELECTED: 1, OLDER: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'SELECTED' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('SELECTED'), m, columns), uncommitted);
	});

	test('off-lane WIPs ignored even if visually nearer; returns undefined when no in-column match', () => {
		// Mirrors the user's 01e52bde report: SELECTED in column 1, both WIPs in columns 2 and 3.
		// Neither is in the click's lane → undefined (caller falls back to primary).
		const rows: WipSearchRow[] = [commit('TOP'), commit('DEBT'), commit('BUG'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 0, DEBT: 2, BUG: 3, SELECTED: 1 };
		const m = meta([
			{ sha: featureWipSha, parentSha: 'DEBT' },
			{ sha: otherWipSha, parentSha: 'BUG' },
		]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), undefined);
	});

	test('returns undefined when columnsBySha is missing (caller falls back to BFS)', () => {
		const rows: WipSearchRow[] = [commit('TOP'), commit('SELECTED')];
		const m = meta([{ sha: featureWipSha, parentSha: 'TOP' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, undefined), undefined);
	});

	test('returns undefined when fromShaʼs column isnʼt known', () => {
		const rows: WipSearchRow[] = [commit('TOP'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 1 }; // SELECTED missing
		const m = meta([{ sha: featureWipSha, parentSha: 'TOP' }]);

		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), undefined);
	});

	test('returns undefined when fromSha isnʼt in rows', () => {
		const rows: WipSearchRow[] = [commit('TOP')];
		const columns: ColumnNumberBySha = { TOP: 1, MISSING: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: 'TOP' }]);

		assert.strictEqual(findWipInColumn('MISSING', rows, primaryWip('TOP'), m, columns), undefined);
	});

	test('returns undefined for empty/missing rows', () => {
		const columns: ColumnNumberBySha = { A: 1 };
		assert.strictEqual(findWipInColumn('A', undefined, undefined, undefined, columns), undefined);
		assert.strictEqual(findWipInColumn('A', [], undefined, undefined, columns), undefined);
	});

	test('no primaryAnchor and no metadata → undefined', () => {
		const rows: WipSearchRow[] = [commit('SELECTED')];
		const columns: ColumnNumberBySha = { SELECTED: 1 };

		assert.strictEqual(findWipInColumn('SELECTED', rows, undefined, undefined, columns), undefined);
	});

	test('secondary WIP with parentSha == "" (empty-string) is preserved and column-checked normally', () => {
		// Empty-string parentSha is legal (brand-new repo with no commits). Should be added as
		// a candidate. Its column would be looked up on '' which won't match → not picked.
		const rows: WipSearchRow[] = [commit('TOP'), commit('SELECTED')];
		const columns: ColumnNumberBySha = { TOP: 1, SELECTED: 1 };
		const m = meta([{ sha: featureWipSha, parentSha: '' }]);

		// primary at TOP (column 1, matches) wins; empty-parentSha secondary doesn't.
		assert.strictEqual(findWipInColumn('SELECTED', rows, primaryWip('TOP'), m, columns), uncommitted);
	});
});

suite('findNearestWipByAncestry', () => {
	test('single WIP — picked regardless of fromSha relationship', () => {
		const rows: WipSearchRow[] = [commit('A', ['B']), commit('B', ['C']), commit('C')];
		const wips: WipCandidate[] = [primaryWip('A')];

		assert.strictEqual(findNearestWipByAncestry('A', wips, rows), uncommitted);
		assert.strictEqual(findNearestWipByAncestry('B', wips, rows), uncommitted);
		assert.strictEqual(findNearestWipByAncestry('C', wips, rows), uncommitted);
	});

	test('two equidistant WIPs — the first encountered wins (deterministic)', () => {
		// Both anchors sit exactly one hop from M, so `distance < best.distance` (strict) must keep the
		// first candidate rather than letting the later one displace it at equal distance. Without the
		// strict compare the winner would depend on candidate order, and the jump target would flip
		// between renders as `Object.entries(wipMetadataBySha)` reorders.
		const first = wipRowId('/repo/wt-a');
		const second = wipRowId('/repo/wt-b');
		const rows: WipSearchRow[] = [commit('A', ['M']), commit('B', ['M']), commit('M')];
		const wips: WipCandidate[] = [
			{ sha: first, anchor: 'A' },
			{ sha: second, anchor: 'B' },
		];

		assert.strictEqual(findNearestWipByAncestry('M', wips, rows), first);
		// Order-swapped: still the first of the two, proving order decides and nothing else does.
		assert.strictEqual(
			findNearestWipByAncestry('M', [wips[1], wips[0]], rows),
			second,
			'the winner tracks candidate order, not sha',
		);
	});

	test('two WIPs — picks the one whose anchor has fromSha as ancestor', () => {
		const secondarySha = wipRowId('/repo/wt');
		const rows: WipSearchRow[] = [
			commit('A1', ['A2']),
			commit('A2', ['A3']),
			commit('A3'),
			commit('B1', ['B2']),
			commit('B2', ['B3']),
			commit('B3'),
		];
		const wips: WipCandidate[] = [primaryWip('A1'), { sha: secondarySha, anchor: 'B1' }];

		assert.strictEqual(findNearestWipByAncestry('A3', wips, rows), uncommitted);
		assert.strictEqual(findNearestWipByAncestry('B2', wips, rows), secondarySha);
		assert.strictEqual(findNearestWipByAncestry('B3', wips, rows), secondarySha);
	});

	test('fromSha not an ancestor of any WIP anchor — falls back to primary WIP', () => {
		const secondarySha = wipRowId('/repo/wt');
		const rows: WipSearchRow[] = [
			commit('A1', ['A2']),
			commit('A2'),
			commit('B1', ['B2']),
			commit('B2'),
			commit('orphan'),
		];
		const wips: WipCandidate[] = [primaryWip('A1'), { sha: secondarySha, anchor: 'B1' }];

		assert.strictEqual(findNearestWipByAncestry('orphan', wips, rows), uncommitted);
	});

	test('fallback when no primary — returns the first WIP', () => {
		const secondarySha = wipRowId('/repo/wt');
		const rows: WipSearchRow[] = [commit('B1'), commit('orphan')];
		const wips: WipCandidate[] = [{ sha: secondarySha, anchor: 'B1' }];

		assert.strictEqual(findNearestWipByAncestry('orphan', wips, rows), secondarySha);
	});

	test('no WIPs — returns undefined', () => {
		const rows: WipSearchRow[] = [commit('A', ['B']), commit('B')];
		assert.strictEqual(findNearestWipByAncestry('A', [], rows), undefined);
	});

	test('no rows — returns first WIP via fallback', () => {
		const wips: WipCandidate[] = [primaryWip('A')];
		assert.strictEqual(findNearestWipByAncestry('A', wips, undefined), uncommitted);
	});

	test('fromSha equals an anchor — distance 0 wins over deeper ancestors', () => {
		const secondarySha = wipRowId('/repo/wt');
		const rows: WipSearchRow[] = [commit('A1', ['A2']), commit('A2'), commit('B1', ['B2']), commit('B2')];
		const wips: WipCandidate[] = [primaryWip('A1'), { sha: secondarySha, anchor: 'B1' }];

		assert.strictEqual(findNearestWipByAncestry('B1', wips, rows), secondarySha);
	});
});
