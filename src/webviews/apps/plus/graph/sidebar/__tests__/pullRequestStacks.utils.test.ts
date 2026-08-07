import * as assert from 'assert';
import type { GraphSidebarPullRequest } from '../../../../../plus/graph/protocol.js';
import { groupPullRequestsByStack } from '../pullRequestStacks.utils.js';

function pr(
	number: number,
	stack?: { number: number; position: number; size: number; baseRef?: string },
): GraphSidebarPullRequest {
	return {
		number: String(number),
		id: String(number),
		title: `PR ${number}`,
		state: 'opened',
		url: `https://github.com/o/r/pull/${number}`,
		stack: stack != null ? { ...stack, baseRef: stack.baseRef ?? 'main' } : undefined,
	} as unknown as GraphSidebarPullRequest;
}

/** Renders the grouped result the way the tree draws it — a stack row, then its members indented. */
function shape(prs: GraphSidebarPullRequest[]): string[] {
	return groupPullRequestsByStack(prs).flatMap(e =>
		e.kind === 'stack'
			? [`stack:${e.number} → ${e.baseRef} (${e.size})`, ...e.members.map(m => `  #${m.number}`)]
			: [`#${e.pr.number}`],
	);
}

suite('groupPullRequestsByStack', () => {
	test('leaves a list with no stacks untouched', () => {
		assert.deepEqual(shape([pr(3), pr(2), pr(1)]), ['#3', '#2', '#1']);
	});

	test('groups a stack under one parent, top layer first', () => {
		// Arrives interleaved and in provider (updated-desc) order.
		const items = [
			pr(50),
			pr(11, { number: 7, position: 1, size: 3 }),
			pr(40),
			pr(13, {
				number: 7,
				position: 3,
				size: 3,
			}),
			pr(12, { number: 7, position: 2, size: 3 }),
		];

		assert.deepEqual(shape(items), ['#50', 'stack:7 → main (3)', '  #13', '  #12', '  #11', '#40']);
	});

	test('the group lands where its most recently updated member was', () => {
		// #11 (bottom) is the first stack member seen, so the whole stack takes that slot — not the top.
		const items = [
			pr(99),
			pr(11, { number: 7, position: 1, size: 2 }),
			pr(12, { number: 7, position: 2, size: 2 }),
		];

		assert.deepEqual(shape(items), ['#99', 'stack:7 → main (2)', '  #12', '  #11']);
	});

	test('a lone loaded member is not grouped', () => {
		// The paging cap cut the rest of the stack off, or a searched PR was spliced in — one row must not
		// imply a group, and must not be indented under nothing.
		assert.deepEqual(shape([pr(9), pr(12, { number: 7, position: 2, size: 3 })]), ['#9', '#12']);
	});

	test('keeps two different stacks separate', () => {
		const items = [
			pr(21, { number: 1, position: 1, size: 2 }),
			pr(31, { number: 2, position: 1, size: 2 }),
			pr(22, { number: 1, position: 2, size: 2 }),
			pr(32, { number: 2, position: 2, size: 2 }),
		];

		assert.deepEqual(shape(items), [
			'stack:1 → main (2)',
			'  #22',
			'  #21',
			'stack:2 → main (2)',
			'  #32',
			'  #31',
		]);
	});

	test('emits every pull request exactly once', () => {
		const items = [pr(5), pr(11, { number: 7, position: 1, size: 2 }), pr(12, { number: 7, position: 2, size: 2 })];

		const emitted = groupPullRequestsByStack(items).flatMap(e => (e.kind === 'stack' ? e.members : [e.pr]));
		assert.equal(emitted.length, items.length);
		assert.deepEqual(new Set(emitted.map(p => p.number)).size, items.length);
	});

	test('reports the stack size GitHub gave, not the number of members loaded', () => {
		// A layer paged off the list still merges when the stack merges, so the parent must not understate it.
		const items = [pr(13, { number: 7, position: 3, size: 5 }), pr(12, { number: 7, position: 2, size: 5 })];

		const [entry] = groupPullRequestsByStack(items);
		assert.equal(entry.kind, 'stack');
		assert.equal(entry.kind === 'stack' && entry.size, 5);
		assert.equal(entry.kind === 'stack' && entry.members.length, 2);
	});

	test('carries the trunk, which is not any member own base', () => {
		const items = [
			pr(12, { number: 7, position: 2, size: 2, baseRef: 'develop' }),
			pr(11, { number: 7, position: 1, size: 2, baseRef: 'develop' }),
		];

		const [entry] = groupPullRequestsByStack(items);
		assert.equal(entry.kind === 'stack' && entry.baseRef, 'develop');
	});
});
