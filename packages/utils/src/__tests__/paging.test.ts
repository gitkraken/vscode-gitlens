import * as assert from 'assert';
import type { PagedResult, PagingOptions } from '../paging.js';
import { emptyPagedResult, PageableResult } from '../paging.js';

async function collect<T>(result: PageableResult<T>): Promise<NonNullable<T>[]> {
	const values: NonNullable<T>[] = [];
	for await (const value of result.values()) {
		values.push(value);
	}
	return values;
}

suite('PageableResult Test Suite', () => {
	test('unseeded single page performs the initial fetch (regression #5319)', async () => {
		const calls: (PagingOptions | undefined)[] = [];
		const result = new PageableResult<string>(paging => {
			calls.push(paging);
			return Promise.resolve({ values: ['a', 'b'] });
		});

		assert.deepStrictEqual(await collect(result), ['a', 'b']);
		// Exactly one fetch, seeded with `undefined`
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0], undefined);
	});

	test('unseeded multi page follows cursors in order', async () => {
		const calls: (PagingOptions | undefined)[] = [];
		const pages: PagedResult<string>[] = [
			{ values: ['a'], paging: { cursor: 'c1', more: true } },
			{ values: ['b'], paging: { cursor: 'c2', more: true } },
			{ values: ['c'], paging: { cursor: 'c3', more: false } },
		];
		let i = 0;
		const result = new PageableResult<string>(paging => {
			calls.push(paging);
			return Promise.resolve(pages[i++]);
		});

		assert.deepStrictEqual(await collect(result), ['a', 'b', 'c']);
		assert.strictEqual(calls.length, 3);
		assert.strictEqual(calls[0], undefined);
		assert.deepStrictEqual(calls[1], { cursor: 'c1', more: true });
		assert.deepStrictEqual(calls[2], { cursor: 'c2', more: true });
	});

	test('seeded result yields the seed without fetching when there are no more pages', async () => {
		let fetched = false;
		const result = new PageableResult<string>(
			() => {
				fetched = true;
				return Promise.resolve(emptyPagedResult as PagedResult<string>);
			},
			{ values: ['s'] },
		);

		assert.deepStrictEqual(await collect(result), ['s']);
		assert.strictEqual(fetched, false);
	});

	test('seeded result fetches remaining pages when more is set', async () => {
		const calls: (PagingOptions | undefined)[] = [];
		const result = new PageableResult<string>(
			paging => {
				calls.push(paging);
				return Promise.resolve({ values: ['t'], paging: { cursor: 'c1', more: false } });
			},
			{ values: ['s'], paging: { cursor: 'c0', more: true } },
		);

		assert.deepStrictEqual(await collect(result), ['s', 't']);
		assert.strictEqual(calls.length, 1);
		assert.deepStrictEqual(calls[0], { cursor: 'c0', more: true });
	});

	test('empty fetch yields nothing without throwing', async () => {
		let count = 0;
		const result = new PageableResult<string>(() => {
			count++;
			return Promise.resolve(emptyPagedResult as PagedResult<string>);
		});

		assert.deepStrictEqual(await collect(result), []);
		assert.strictEqual(count, 1);
	});

	test('re-iterating uses the cache and does not refetch', async () => {
		let count = 0;
		const pages: PagedResult<string>[] = [
			{ values: ['a'], paging: { cursor: 'c1', more: true } },
			{ values: ['b'], paging: { cursor: 'c2', more: false } },
		];
		const result = new PageableResult<string>(() => Promise.resolve(pages[count++]));

		assert.deepStrictEqual(await collect(result), ['a', 'b']);
		assert.strictEqual(count, 2);

		// Second pass should replay cached values with no additional fetches
		assert.deepStrictEqual(await collect(result), ['a', 'b']);
		assert.strictEqual(count, 2);
	});
});
