import * as assert from 'assert';
import { computeColumnsAndSegments } from '../layout.js';
import { processCommitsAndSegments } from '../process.js';
import type { CommitKind, GraphCommit, GraphRow, ProcessedGraphRow } from '../types.js';

function commit(hash: string, parents: string[], kind?: CommitKind, date = 0): GraphCommit {
	return {
		hash: hash,
		shortHash: hash.slice(0, 7),
		message: hash,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: date,
		parents: parents,
		refs: [],
		kind: kind,
	};
}

function row(sha: string, parents: string[], kind: CommitKind = 'commit'): GraphRow {
	return { sha: sha, parents: parents, kind: kind, date: 0 };
}

// The gutter cost a viewer actually sees: Σ over rows of the rightmost lane the row touches (its own
// column plus every edge column). This is what the engine's `laneArea` approximates without the edge
// pass — here we compute the true value from the edge output so the tests bind to the real thing.
function gutterArea(rows: readonly ProcessedGraphRow[]): number {
	return rows.reduce((sum, r) => sum + r.edgeColumnMax, 0);
}

function columnsBySha(rows: readonly ProcessedGraphRow[]): Map<string, number> {
	return new Map(rows.map(r => [r.sha, r.column]));
}

// A deterministic linear-congruential PRNG — `Math.random` is unavailable in engine scripts and a fixed
// seed makes a failure reproducible.
function makeRng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

suite('engine/renormalize', () => {
	// A new long lane that can't reclaim a low column parks far right and drags its whole lane down through
	// every row below it — the reported bug, whose gutter cost scales with LANE LENGTH. Renormalize must
	// discard the degraded sticky layout once cold is tighter by more than the one-column slack.
	test('a far-right sticky lane that drags a long lane is renormalized back to a tight layout', () => {
		// Three long-lived side branches squat on the low columns (via preferences) above a deep fork, plus
		// a long trunk — so a new lane forced right by those incumbents spans the whole graph height.
		const base: GraphCommit[] = [];
		for (let s = 0; s < 3; s++) {
			for (let i = 1; i <= 25; i++) {
				base.push(commit(`S${s}_${i}`, [i < 25 ? `S${s}_${i + 1}` : 'T40']));
			}
		}
		for (let i = 1; i <= 50; i++) {
			base.push(commit(`T${i}`, i < 50 ? [`T${i + 1}`] : []));
		}
		const prior = processCommitsAndSegments(base);

		// A new long-lived branch forks deep at T45; sticky can't give it a low column (all preferred), so it
		// parks right and its lane runs the whole height — the case renormalize exists to catch.
		const next: GraphCommit[] = [];
		for (let i = 1; i <= 20; i++) {
			next.push(commit(`N${i}`, [i < 20 ? `N${i + 1}` : 'T45']));
		}
		const full = [...next, ...base];
		const sticky = processCommitsAndSegments(full, { stableFrom: prior.stability });
		const cold = processCommitsAndSegments(full);

		assert.ok(sticky.renormalized === true, 'a degraded far-right lane should trigger a renormalize');
		assert.ok(
			gutterArea(sticky.rows) <= gutterArea(cold.rows) + full.length,
			`renormalized gutter ${gutterArea(sticky.rows)} should be within one column of cold ${gutterArea(cold.rows)}`,
		);
	});

	// Renormalize must never fire when nothing degraded — that would reshuffle lanes for no gain and
	// destroy the stability the sticky path exists to provide.
	test('an unchanged relayout is a fixpoint and never renormalizes', () => {
		const base = [
			commit('A', ['B']),
			commit('B', ['C']),
			commit('S', ['C'], 'stash'),
			commit('C', ['D']),
			commit('D', []),
		];
		const first = processCommitsAndSegments(base);
		const again = processCommitsAndSegments(base, { stableFrom: first.stability });
		assert.ok(again.renormalized !== true, 'an unchanged relayout must not reshuffle lanes');
		assert.deepStrictEqual(
			[...columnsBySha(again.rows)],
			[...columnsBySha(first.rows)],
			'relayout with own output as preferences must reproduce identical columns',
		);
	});

	// laneArea must rank two layouts the same way the true edge-pass gutter does, or the compare-and-adopt
	// step would pick the wrong candidate.
	test('laneArea agrees with the true gutter on which layout is tighter', () => {
		const base = [
			commit('B1', ['T3']),
			commit('B2', ['T3']),
			commit('T1', ['T2']),
			commit('T2', ['T3']),
			commit('T3', []),
		];
		const prior = processCommitsAndSegments(base);
		const next = [commit('N', ['T1']), ...base];
		const nextRows = next.map(c => row(c.hash, c.parents, c.kind));

		const stickyLayout = computeColumnsAndSegments(nextRows, {
			preferredColumns: columnsBySha(prior.rows),
		});
		const coldLayout = computeColumnsAndSegments(nextRows);
		const sticky = processCommitsAndSegments(next, { preferredColumns: columnsBySha(prior.rows) });
		const cold = processCommitsAndSegments(next);

		// Same ordering by laneArea as by the true edge-pass gutter.
		assert.strictEqual(
			Math.sign(stickyLayout.laneArea - coldLayout.laneArea),
			Math.sign(gutterArea(sticky.rows) - gutterArea(cold.rows)),
			'laneArea must order the two layouts the same way the true gutter does',
		);
	});

	// The property the four prior guard fixes could not assert: replaying many updates must not let the
	// gutter ratchet away from cold. Without renormalize this fails (measured ~57% inflation on real data).
	test('replaying random updates keeps the gutter near cold', () => {
		const rng = makeRng(0x51ab1e);
		const branchCount = 5;

		let n = 0;
		const mk = (parents: string[], kind?: CommitKind): GraphCommit => commit(`c${n++}`, parents, kind, n);

		// A trunk with several branches forking off it at different depths.
		const trunk: GraphCommit[] = [];
		for (let i = 0; i < 40; i++) {
			trunk.push(mk(trunk.length ? [trunk.at(-1)!.hash] : []));
		}
		trunk.reverse();
		const branches: GraphCommit[][] = [];
		for (let b = 0; b < branchCount; b++) {
			branches.push([mk([trunk[8 + b * 5].hash])]);
		}

		const build = (): GraphCommit[] => {
			const rows: GraphCommit[] = [];
			for (const br of branches) {
				rows.push(...br);
			}
			rows.push(...trunk);
			return rows.slice().sort((a, b) => b.date - a.date);
		};

		let stability = processCommitsAndSegments(build()).stability;
		for (let step = 0; step < 60; step++) {
			const b = Math.floor(rng() * branchCount);
			if (rng() < 0.25) {
				// Rebase: rewrite the branch onto the current trunk tip (all new shas, no preferences).
				const onto = trunk[0].hash;
				const fresh: GraphCommit[] = [];
				let p = onto;
				for (let i = branches[b].length - 1; i >= 0; i--) {
					const c = mk([p]);
					p = c.hash;
					fresh.unshift(c);
				}
				branches[b] = fresh;
			} else {
				branches[b] = [mk([branches[b][0].hash]), ...branches[b]];
			}

			const rows = build();
			const sticky = processCommitsAndSegments(rows, { stableFrom: stability });
			const cold = processCommitsAndSegments(rows);
			// Renormalize guarantees the adopted layout is never materially worse than cold — allow a small
			// slack for a benign sticky lane that never tripped the gate.
			assert.ok(
				gutterArea(sticky.rows) <= gutterArea(cold.rows) + rows.length,
				`step ${step}: gutter ${gutterArea(sticky.rows)} ratcheted past cold ${gutterArea(cold.rows)}`,
			);
			stability = sticky.stability;
		}
	});
});
