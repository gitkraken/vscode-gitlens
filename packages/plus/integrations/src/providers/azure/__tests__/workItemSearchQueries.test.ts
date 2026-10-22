import * as assert from 'node:assert/strict';
import type { AzureWorkItemTypeStates } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { toAzureWorkItemSearchQueries } from '../search.js';
import { queryAzureWorkItemSearch } from '../workItemSearch.js';
import { AzureWorkItemStatesCache } from '../workItemStateCategories.js';

const asOf = '2026-10-22T11:00:00.1234567Z';

function ranker(order: readonly number[], parts: readonly number[][]) {
	const calls: { wiql: string; top: number; asOf?: string }[] = [];
	return {
		calls: calls,
		query: async (wiql: string, top: number, at?: string) => {
			calls.push({ wiql: wiql, top: top, asOf: at });
			const partition = /^part (\d+)$/.exec(wiql);
			const selected = new Set(
				partition != null
					? parts[Number(partition[1])]
					: wiql
							.match(/IN \(([^)]+)\)/)![1]
							.split(', ')
							.map(Number),
			);
			return { ids: order.filter(id => selected.has(id)).slice(0, top), asOf: asOf };
		},
	};
}

suite('Azure bounded work item query plan', () => {
	test('partitions heterogeneous escaped project, type and state predicates below the complete query limit', () => {
		for (const [projects, types, states] of [
			[40, 7, 1],
			[1, 400, 1],
			[1, 1, 1000],
		]) {
			const workflows = new Map<string, AzureWorkItemTypeStates>();
			for (let p = 0; p < projects; p++) {
				workflows.set(`Project '${p}`, {
					types: Array.from({ length: types }, (_, t) => ({
						name: `Type '${t}`,
						states: Array.from({ length: states }, (_, s) => ({
							name: `State '${p}/${t}/${s} ${'x'.repeat(150)}`,
							category: 'InProgress',
						})),
					})),
				});
			}
			const queries = toAzureWorkItemSearchQueries(
				{ text: "can't", relationships: ['assigned'] },
				'title:asc',
				[...workflows.keys()],
				workflows,
			);
			assert.ok(queries.length > 1);
			const tuples = new Set<string>();
			for (const query of queries) {
				assert.ok(`${query} ASOF '${asOf}'`.length <= 32000);
				assert.match(query, /AND \(\[System.AssignedTo\] = @Me\) AND \[System.Title\] Contains 'can''t'/);
				assert.match(query, /ORDER BY \[System.Title\] Asc, \[System.Id\] Desc$/);
				for (const [, name] of query.matchAll(/\[System.State\] IN \(([^)]*)\)/g)) {
					for (const [, state] of name.matchAll(/'((?:''|[^'])*)'/g)) {
						assert.ok(!tuples.has(state), 'partitions are disjoint');
						tuples.add(state);
					}
				}
			}
			assert.equal(tuples.size, projects * types * states);
		}
	});

	test('refuses irreducible caller text locally instead of issuing an oversized or widened query', () => {
		assert.throws(
			() => toAzureWorkItemSearchQueries({ state: 'all', text: "'".repeat(20000) }, 'updated:desc', ['Project']),
			/too long/,
		);
	});
});

suite('Azure partitioned work item execution', () => {
	test('keeps server title/null/tie order, including a winner from the last partition and repeated refills', async () => {
		const order = [9000, ...Array.from({ length: 1300 }, (_, i) => 1300 - i)];
		const parts = [
			order.filter(id => id !== 9000 && id % 2 === 0),
			order.filter(id => id === 9000 || id % 2 !== 0),
		];
		const ranked = ranker(order, parts);
		assert.deepEqual(await queryAzureWorkItemSearch(['part 0', 'part 1'], 'title:asc', true, ranked.query), order);
		assert.ok(ranked.calls.length > 4);
		assert.equal(ranked.calls[0].asOf, undefined);
		assert.ok(ranked.calls.slice(1).every(c => c.asOf === asOf));
		assert.ok(
			ranked.calls
				.filter(c => c.wiql.startsWith('SELECT'))
				.every(c => c.top <= 400 && /ORDER BY \[System.Title\] Asc, \[System.Id\] Desc$/.test(c.wiql)),
		);
	});

	test('counts the union exactly without ranking, including overlap', async () => {
		const ranked = ranker(
			[9, 8, 7, 6],
			[
				[9, 7],
				[9, 8, 6],
			],
		);
		const ids = await queryAzureWorkItemSearch(['part 0', 'part 1'], 'title:desc', false, ranked.query);
		assert.equal(ids.length, 4);
		assert.equal(ranked.calls.length, 2);
		assert.equal(ranked.calls[1].asOf, asOf);
	});

	test('distinguishes the exact 20000 boundary from overflow after globally ordering the union', async () => {
		for (const count of [20000, 20001, 24000]) {
			const order = Array.from({ length: count }, (_, i) => count - i);
			const parts = [order.filter(id => id % 2 === 0), order.filter(id => id % 2 !== 0)];
			const ranked = ranker(order, parts);
			const ids = await queryAzureWorkItemSearch(['part 0', 'part 1'], 'updated:desc', true, ranked.query);
			assert.deepEqual(ids, order.slice(0, 20001));
			const counted = ranker(order, parts);
			assert.equal(
				(await queryAzureWorkItemSearch(['part 0', 'part 1'], 'updated:desc', false, counted.query)).length,
				Math.min(count, 20001),
			);
		}
	});

	test('never locally sorts title values or nullable fields and preserves the requested direction', async () => {
		for (const sort of ['title:asc', 'title:desc', 'closed:asc', 'comments:desc'] as const) {
			const order = [4, 9, 2, 1];
			const ranked = ranker(order, [
				[9, 1],
				[4, 2],
			]);
			assert.deepEqual(await queryAzureWorkItemSearch(['part 0', 'part 1'], sort, true, ranked.query), order);
		}
	});

	test('refuses missing server time and incomplete ranking instead of guessing or dropping ids', async () => {
		await assert.rejects(
			queryAzureWorkItemSearch(['a', 'b'], 'updated:desc', true, async () => ({ ids: [1] })),
			/snapshot date/,
		);
		await assert.rejects(
			queryAzureWorkItemSearch(['a', 'b'], 'updated:desc', true, async () => ({ ids: [1], asOf: 'invalid' })),
			/snapshot date/,
		);
		await assert.rejects(
			queryAzureWorkItemSearch(['a', 'b'], 'updated:desc', true, async wiql => ({
				ids: wiql === 'a' ? [1] : wiql === 'b' ? [2] : [1],
				asOf: asOf,
			})),
			/incomplete.*ranking/,
		);
	});

	test('stops before another ranking refill once the caller cancels', async () => {
		const controller = new AbortController();
		const order = Array.from({ length: 1000 }, (_, i) => 1000 - i);
		const ranked = ranker(order, [order.filter(id => id % 2 === 0), order.filter(id => id % 2 !== 0)]);
		await assert.rejects(
			queryAzureWorkItemSearch(
				['part 0', 'part 1'],
				'updated:desc',
				true,
				async (...args) => {
					const result = await ranked.query(...args);
					if (args[0].startsWith('SELECT')) {
						controller.abort();
					}
					return result;
				},
				controller.signal,
			),
			isCancellationError,
		);
		assert.equal(ranked.calls.length, 3);
	});
});

suite('Azure metadata cancellation', () => {
	test('does not cache a canceled metadata read or start queued canceled work', async () => {
		const cache = new AzureWorkItemStatesCache();
		const scope = {
			baseUrl: 'https://azure.example.com',
			namespace: 'Collection',
			project: 'Project',
			token: 'test',
			isPAT: true,
		};
		const controller = new AbortController();
		let reads = 0;
		const first = cache.getTypes(
			scope,
			signal => {
				reads++;
				return new Promise((_resolve, reject) =>
					signal!.addEventListener('abort', () => reject(new CancellationError()), { once: true }),
				);
			},
			controller.signal,
		);
		controller.abort();
		await assert.rejects(first, isCancellationError);
		await assert.rejects(
			cache.getTypes(
				scope,
				async () => {
					reads++;
					return { value: [] };
				},
				controller.signal,
			),
			isCancellationError,
		);
		assert.deepEqual(
			await cache.getTypes(scope, async () => {
				reads++;
				return { value: [{ name: 'Task' }] };
			}),
			['Task'],
		);
		assert.equal(reads, 2);
	});
});
