import * as assert from 'assert';
import type { RowTopology } from '../delta.js';
import { CommitGraphEngineSession } from '../session.js';
import type { GraphCommit } from '../types.js';

function row(sha: string, parents: string[], date = 0): RowTopology {
	return { sha: sha, parents: parents, kind: 'commit', date: date };
}

function toCommit(r: RowTopology): GraphCommit {
	return {
		sha: r.sha,
		shortSha: r.sha.slice(0, 7),
		message: `commit ${r.sha}`,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: r.date ?? 0,
		parents: r.parents,
		kind: r.parents.length > 1 ? 'merge' : 'commit',
	};
}

/** A trunk long enough to hold a segment, plus a side branch so more than one lane is live. */
function graph(trunkLength: number, opts?: { branchAt?: number; branchLength?: number }): RowTopology[] {
	const trunk: RowTopology[] = [];
	for (let i = 0; i < trunkLength; i++) {
		trunk.push(row(`T${i}`, i === trunkLength - 1 ? [] : [`T${i + 1}`], 1_000_000 - i * 10));
	}
	if (opts?.branchAt == null) return trunk;

	const branch: RowTopology[] = [];
	const len = opts.branchLength ?? 3;
	for (let i = 0; i < len; i++) {
		branch.push(row(`B${i}`, [i === len - 1 ? `T${opts.branchAt}` : `B${i + 1}`], 1_000_500 - i * 10));
	}
	return [...branch, ...trunk].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

function session() {
	return new CommitGraphEngineSession<RowTopology, GraphCommit>();
}

suite('engine/session', () => {
	test('classifies an unchanged push as payload and a prepend as replace', () => {
		const s = session();
		const rows = graph(8);
		assert.strictEqual(s.update({ sourceRows: rows, toCommit: toCommit }).transition.kind, 'initial');
		// Fresh objects, same topology — mirrors IPC deserialization.
		assert.strictEqual(s.update({ sourceRows: graph(8), toCommit: toCommit }).transition.kind, 'payload');
		assert.strictEqual(
			s.update({ sourceRows: [row('N', ['T0'], 1_000_100), ...graph(8)], toCommit: toCommit }).transition.kind,
			'replace',
		);
	});

	test('paging older rows onto an unchanged prefix is an append', () => {
		const s = session();
		s.update({ sourceRows: graph(8), toCommit: toCommit });
		const paged = [...graph(8), row('O1', ['O2'], 900_000), row('O2', [], 899_000)];
		const state = s.update({ sourceRows: paged, toCommit: toCommit });
		assert.strictEqual(state.transition.kind, 'append');
		assert.strictEqual(state.rows.length, paged.length);
		// The index must cover the appended tail, not just the prefix.
		assert.strictEqual(state.indexBySha.get('O2'), paged.length - 1);
	});

	// An `append` proves the TOPOLOGY prefix is unchanged — nothing about the payload the adapter reads
	// off those same rows. A push that pages in older history AND retitles a loaded row arrives as one
	// update, so a session that reused the held prefix mapping would keep serving the stale payload.
	test('remaps an appended push prefix whose payload changed', () => {
		type SourceRow = RowTopology & { message: string };
		const rows = (message: string): SourceRow[] => graph(8).map(r => ({ ...r, message: message }));
		const map = (r: SourceRow): GraphCommit => ({ ...toCommit(r), message: r.message });

		const s = new CommitGraphEngineSession<SourceRow, GraphCommit>();
		s.update({ sourceRows: rows('v1'), toCommit: map });

		const paged: SourceRow[] = [
			...rows('v2'),
			{ ...row('O1', ['O2'], 900_000), message: 'v2' },
			{ ...row('O2', [], 899_000), message: 'v2' },
		];
		const state = s.update({ sourceRows: paged, toCommit: map });

		assert.strictEqual(state.transition.kind, 'append');
		assert.ok(
			state.commits.every(c => c.message === 'v2'),
			`stale prefix payload: ${state.commits
				.filter(c => c.message !== 'v2')
				.map(c => c.sha)
				.join(', ')}`,
		);
	});

	// The trunk tip is lane-collapse protection. It is retained across a pure append (segments only
	// extend downward), but must be rediscovered whenever HEAD moves or its own segment first appears.
	test('retains the trunk across an append when HEAD is unchanged', () => {
		const s = session();
		const rows = graph(12, { branchAt: 6 });
		const first = s.update({ sourceRows: rows, toCommit: toCommit, headSha: 'T0' });
		assert.ok(first.trunkSegmentTip != null, 'precondition: a trunk segment must exist');

		const appended = [...rows, row('O1', ['O2'], 900_000), row('O2', [], 899_000)];
		const after = s.update({ sourceRows: appended, toCommit: toCommit, headSha: 'T0' });
		assert.strictEqual(after.transition.kind, 'append');
		assert.strictEqual(after.trunkSegmentTip, first.trunkSegmentTip, 'an append must not move the trunk');
	});

	test('trunk shas stay present in trunkCommitShas across an append', () => {
		const s = session();
		// A single lane whose tip (T3) has a not-yet-loaded parent (T4) — the append below pages it in,
		// genuinely EXTENDING the trunk segment rather than adding an unrelated disconnected tail.
		const initial: RowTopology[] = [
			row('T0', ['T1'], 1_000_000),
			row('T1', ['T2'], 999_990),
			row('T2', ['T3'], 999_980),
			row('T3', ['T4'], 999_970),
		];
		const first = s.update({ sourceRows: initial, toCommit: toCommit, headSha: 'T0' });
		assert.ok(first.trunkCommitShas.has('T0'), 'precondition: T0 must be a trunk member');
		assert.ok(first.trunkCommitShas.has('T3'), 'precondition: T3 must be a trunk member');

		const appended: RowTopology[] = [...initial, row('T4', ['T5'], 999_960), row('T5', [], 999_950)];
		const after = s.update({ sourceRows: appended, toCommit: toCommit, headSha: 'T0' });
		assert.strictEqual(after.transition.kind, 'append');
		// Trunk shas from before the append...
		assert.ok(after.trunkCommitShas.has('T0'));
		assert.ok(after.trunkCommitShas.has('T3'));
		// ...and the newly-appended trunk extension are both present.
		assert.ok(after.trunkCommitShas.has('T4'));
		assert.ok(after.trunkCommitShas.has('T5'));
	});

	test('recomputes the trunk when HEAD moves to another segment', () => {
		const s = session();
		const rows = graph(12, { branchAt: 6 });
		const first = s.update({ sourceRows: rows, toCommit: toCommit, headSha: 'T0' });
		const moved = s.update({ sourceRows: graph(12, { branchAt: 6 }), toCommit: toCommit, headSha: 'B0' });

		// Precondition: the two HEADs must sit on different segments, else there is nothing to detect.
		assert.ok(first.trunkSegmentTip != null && moved.trunkSegmentTip != null);
		assert.notStrictEqual(
			moved.trunkSegmentTip,
			first.trunkSegmentTip,
			'HEAD moving to another lane must move the protected trunk with it',
		);
	});

	test('a changed identity is a hard reset even when shas repeat', () => {
		const s = session();
		s.update({ identity: 'repoA', sourceRows: graph(8), toCommit: toCommit });
		const other = s.update({ identity: 'repoB', sourceRows: graph(8), toCommit: toCommit });
		assert.strictEqual(other.transition.kind, 'initial', 'a different dataset must not reuse the prior layout');
	});

	test('resetLayout forces the next update through a full pass', () => {
		const s = session();
		s.update({ sourceRows: graph(8), toCommit: toCommit });
		s.resetLayout();
		const after = s.update({ sourceRows: graph(8), toCommit: toCommit });
		assert.strictEqual(after.transition.kind, 'initial', 'the payload fast path must not survive a reset');
	});

	test('an emptied dataset resets, so a later push cannot resume stale state', () => {
		const s = session();
		s.update({ sourceRows: graph(8), toCommit: toCommit });
		const emptied = s.update({ sourceRows: [], toCommit: toCommit });
		assert.strictEqual(emptied.rows.length, 0);
		assert.strictEqual(emptied.trunkSegmentTip, undefined);
		const refilled = s.update({ sourceRows: graph(8), toCommit: toCommit });
		assert.strictEqual(refilled.transition.kind, 'initial');
	});
});
