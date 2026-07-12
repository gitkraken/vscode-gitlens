import * as assert from 'assert';
import { classifyRowsDelta } from '../delta.js';
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
