import * as assert from 'assert';
import { classifyRowsDelta, isHistoryRewrite } from '../delta.js';
import type { RowTopology } from '../delta.js';

function row(sha: string, parents: string[], type = 'commit-node', date = 0): RowTopology {
	return { sha: sha, parents: parents, type: type, date: date };
}

// Fresh objects per call — mirrors IPC deserialization, so identity never leaks into the compare.
function history(): RowTopology[] {
	return [row('A', ['B']), row('B', ['C', 'D']), row('C', ['E']), row('D', ['E']), row('E', [])];
}

suite('engine/delta classification', () => {
	test('no prior rows → initial', () => {
		assert.deepStrictEqual(classifyRowsDelta(undefined, history()), { kind: 'initial' });
		assert.deepStrictEqual(classifyRowsDelta([], history()), { kind: 'initial' });
	});

	test('unchanged topology with fresh objects → payload', () => {
		assert.deepStrictEqual(classifyRowsDelta(history(), history()), { kind: 'payload' });
	});

	test('older rows paged onto an unchanged prefix → append', () => {
		const next = [...history(), row('F', ['G']), row('G', [])];
		assert.deepStrictEqual(classifyRowsDelta(history(), next), { kind: 'append', firstNewIndex: 5 });
	});

	test('new commit prepended (fetch/commit) → replace', () => {
		const next = [row('N', ['A']), ...history()];
		assert.deepStrictEqual(classifyRowsDelta(history(), next), { kind: 'replace' });
	});

	test('truncated rows → replace', () => {
		assert.deepStrictEqual(classifyRowsDelta(history(), history().slice(0, 3)), { kind: 'replace' });
	});

	test('reordered rows → replace', () => {
		const next = history();
		[next[2], next[3]] = [next[3], next[2]];
		assert.deepStrictEqual(classifyRowsDelta(history(), next), { kind: 'replace' });
	});

	test('WIP anchor move (parent change, same sha) → replace', () => {
		const prior = [row('wip', ['A'], 'work-dir-changes'), ...history()];
		const next = [row('wip', ['N'], 'work-dir-changes'), ...history()];
		assert.deepStrictEqual(classifyRowsDelta(prior, next), { kind: 'replace' });
	});

	test('parent-count change (merge gained a parent) → replace', () => {
		const prior = history();
		const next = history();
		next[0] = row('A', ['B', 'X']);
		assert.deepStrictEqual(classifyRowsDelta(prior, next), { kind: 'replace' });
	});

	test('row type change (commit became stash) → replace', () => {
		const next = history();
		next[2] = row('C', ['E'], 'stash-node');
		assert.deepStrictEqual(classifyRowsDelta(history(), next), { kind: 'replace' });
	});

	test('date change (feeds the layout tie-break) → replace', () => {
		const next = history();
		next[4] = row('E', [], 'commit-node', 42);
		assert.deepStrictEqual(classifyRowsDelta(history(), next), { kind: 'replace' });
	});

	test('append with a mutated prefix → replace, not append', () => {
		const next = [...history(), row('F', [])];
		next[1] = row('B', ['C']);
		assert.deepStrictEqual(classifyRowsDelta(history(), next), { kind: 'replace' });
	});
});

suite('engine/delta isHistoryRewrite', () => {
	const wip = (parent: string) => row('0000', [parent], 'work-dir-changes');

	test('no prior rows → not a rewrite', () => {
		assert.strictEqual(isHistoryRewrite(undefined, history()), false);
		assert.strictEqual(isHistoryRewrite([], history()), false);
	});

	test('unchanged topology → not a rewrite', () => {
		assert.strictEqual(isHistoryRewrite(history(), history()), false);
	});

	test('older rows paged in at the bottom → not a rewrite', () => {
		const next = [...history(), row('F', ['G']), row('G', [])];
		assert.strictEqual(isHistoryRewrite(history(), next), false);
	});

	test('a new commit prepended on top → not a rewrite (prepend keeps stability)', () => {
		const next = [row('N', ['A']), ...history()];
		assert.strictEqual(isHistoryRewrite(history(), next), false);
	});

	test('a prepend that also trims the bottom row → not a rewrite', () => {
		const next = [row('N', ['A']), ...history().slice(0, -1)];
		assert.strictEqual(isHistoryRewrite(history(), next), false);
	});

	test('a WIP row parent moving on a plain commit → not a rewrite', () => {
		// The WIP row tracks HEAD, so its parent changes on every commit — it must not be read as a rewrite.
		const prior = [wip('A'), ...history()];
		const next = [wip('N'), row('N', ['A']), ...history()];
		assert.strictEqual(isHistoryRewrite(prior, next), false);
	});

	test('a rebased tip (top commit rewritten) → rewrite', () => {
		// The top commit's sha is gone (replayed with a new sha) — its lane preferences are stale.
		const next = [row('A2', ['B']), ...history().slice(1)];
		assert.strictEqual(isHistoryRewrite(history(), next), true);
	});

	test('a rewrite below an unchanged top commit → rewrite', () => {
		// Anchor (A) still present, but a surviving commit deeper in the window was rewritten.
		const next = history();
		next[2] = row('C2', ['E']); // C replayed as C2
		assert.strictEqual(isHistoryRewrite(history(), next), true);
	});

	test('an amended tip (same position, new sha) → rewrite', () => {
		const next = history();
		next[0] = row('A2', ['B']);
		assert.strictEqual(isHistoryRewrite(history(), next), true);
	});

	test('a reset that drops the top commits from the window → rewrite', () => {
		// HEAD reset back: the former tip rows are gone (unreachable) → surviving lanes may re-pack.
		const next = history().slice(2);
		assert.strictEqual(isHistoryRewrite(history(), next), true);
	});

	test('a WIP row present while the history below is rebased → rewrite', () => {
		const prior = [wip('A'), ...history()];
		const next = [wip('A2'), row('A2', ['B']), ...history().slice(1)];
		assert.strictEqual(isHistoryRewrite(prior, next), true);
	});
});
