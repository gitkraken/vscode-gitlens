import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { collectProviderPagedResult } from '../utils/providerPaging.js';

suite('collectProviderPagedResult', () => {
	test('marks the result truncated and preserves paging when maxPages is reached', async () => {
		const pages: PagedResult<string>[] = [
			{ values: ['a'], paging: { cursor: '1', more: true } },
			{ values: ['b'], paging: { cursor: '2', more: true } },
		];
		let call = 0;

		const result = await collectProviderPagedResult(async () => pages[call++], 2);

		assert.deepEqual(result, {
			values: ['a', 'b'],
			paging: { cursor: '2', more: true },
			truncated: true,
		});
	});

	test('keeps draining empty pages while paging.more remains true', async () => {
		const pages: PagedResult<string>[] = [
			{ values: [], paging: { cursor: '1', more: true } },
			{ values: ['a'], paging: { cursor: '2', more: true } },
			{ values: ['b'] },
		];
		let call = 0;

		const result = await collectProviderPagedResult(async () => pages[call++]);

		assert.deepEqual(result, { values: ['a', 'b'] });
	});

	test('marks the result truncated and drops paging when the cursor stalls', async () => {
		const pages: PagedResult<string>[] = [
			{ values: ['a'], paging: { cursor: 'same-cursor', more: true } },
			{ values: ['b'], paging: { cursor: 'same-cursor', more: true } },
		];
		let call = 0;

		const result = await collectProviderPagedResult(async () => pages[call++]);

		assert.deepEqual(result, {
			values: ['a', 'b'],
			truncated: true,
		});
	});

	test('propagates provider errors instead of translating them to truncation', async () => {
		const error = new Error('boom');

		await assert.rejects(
			() =>
				collectProviderPagedResult(async cursor => {
					if (cursor == null) {
						return { values: ['a'], paging: { cursor: '1', more: true } };
					}

					throw error;
				}),
			error,
		);
	});
});
