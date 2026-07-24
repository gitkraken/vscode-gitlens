import * as assert from 'assert';
import type { PagedResult, PagingOptions } from '../paging.js';
import { collectPagedResults, emptyPagedResult, PageableResult } from '../paging.js';

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

suite('collectPagedResults Test Suite', () => {
	test('single page returns all values with one undefined-cursor fetch', async () => {
		const cursors: (string | undefined)[] = [];
		const values = await collectPagedResults<string>(cursor => {
			cursors.push(cursor);
			return Promise.resolve({ values: ['a', 'b'] });
		});

		assert.deepStrictEqual(values, ['a', 'b']);
		assert.deepStrictEqual(cursors, [undefined]);
	});

	test('drains multiple pages, feeding each paging.cursor back', async () => {
		const cursors: (string | undefined)[] = [];
		const pages: PagedResult<string>[] = [
			{ values: ['a'], paging: { cursor: 'c1', more: true } },
			{ values: ['b'], paging: { cursor: 'c2', more: true } },
			{ values: ['c'], paging: { cursor: 'c3', more: false } },
		];
		let i = 0;
		const values = await collectPagedResults<string>(cursor => {
			cursors.push(cursor);
			return Promise.resolve(pages[i++]);
		});

		assert.deepStrictEqual(values, ['a', 'b', 'c']);
		assert.deepStrictEqual(cursors, [undefined, 'c1', 'c2']);
	});

	test('stops when the cursor stops advancing (guards against an infinite loop)', async () => {
		let count = 0;
		const values = await collectPagedResults<string>(() => {
			count++;
			// `more` stays true but the cursor never changes
			return Promise.resolve({ values: ['x'], paging: { cursor: 'stuck', more: true } });
		});

		// First page (cursor undefined) + one more (cursor 'stuck'), then the stall guard breaks
		assert.deepStrictEqual(values, ['x', 'x']);
		assert.strictEqual(count, 2);
	});

	test('honors the maxPages bound even when more stays true', async () => {
		let count = 0;
		const values = await collectPagedResults<number>(() => {
			count++;
			return Promise.resolve({ values: [count], paging: { cursor: `c${count}`, more: true } });
		}, 3);

		assert.deepStrictEqual(values, [1, 2, 3]);
		assert.strictEqual(count, 3);
	});

	test('stops gracefully when a fetch returns undefined', async () => {
		let count = 0;
		const pages: (PagedResult<string> | undefined)[] = [
			{ values: ['a'], paging: { cursor: 'c1', more: true } },
			undefined,
		];
		const values = await collectPagedResults<string>(() => Promise.resolve(pages[count++]));

		assert.deepStrictEqual(values, ['a']);
		assert.strictEqual(count, 2);
	});

	test('keeps draining through a page with empty values while more stays true', async () => {
		// A caller-side filter (e.g. GitLab's org-namespace filter) can leave a page empty without
		// ending pagination — draining must follow `paging.more`, not the emptiness of `values`.
		const pages: PagedResult<string>[] = [
			{ values: ['a'], paging: { cursor: 'c1', more: true } },
			{ values: [], paging: { cursor: 'c2', more: true } },
			{ values: ['b'], paging: { cursor: 'c3', more: false } },
		];
		let i = 0;
		const values = await collectPagedResults<string>(() => Promise.resolve(pages[i++]));

		assert.deepStrictEqual(values, ['a', 'b']);
		assert.strictEqual(i, 3);
	});
});
