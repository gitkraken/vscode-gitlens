import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { ProviderApiPagedResult } from '../models.js';
import { collectProviderPagedResult, mergeCollectionMetadata } from '../utils/providerPaging.js';

suite('collectProviderPagedResult', () => {
	test('marks the result truncated and preserves paging when maxPages is reached', async () => {
		const pages: ProviderApiPagedResult<string>[] = [
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
		const pages: ProviderApiPagedResult<string>[] = [
			{ values: [], paging: { cursor: '1', more: true } },
			{ values: ['a'], paging: { cursor: '2', more: true } },
			{ values: ['b'] },
		];
		let call = 0;

		const result = await collectProviderPagedResult(async () => pages[call++]);

		assert.deepEqual(result, { values: ['a', 'b'] });
	});

	test('marks the result truncated and drops paging when the cursor stalls', async () => {
		const pages: ProviderApiPagedResult<string>[] = [
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

	test('omits metadata entirely when no page supplies it', async () => {
		const pages: ProviderApiPagedResult<string>[] = [
			{ values: ['a'], paging: { cursor: '1', more: true } },
			{ values: ['b'] },
		];
		let call = 0;

		const result = await collectProviderPagedResult(async () => pages[call++]);

		assert.deepEqual(result, { values: ['a', 'b'] });
		assert.equal('metadata' in result, false, 'no metadata key when no page reported it');
	});

	test('merges metadata across pages and keeps SDK incompleteness independent from the local backstop', async () => {
		const pages: ProviderApiPagedResult<string>[] = [
			{
				values: ['a'],
				paging: { cursor: '1', more: true },
				metadata: { completeness: 'complete' },
			},
			{
				values: ['b'],
				metadata: {
					completeness: 'partial',
					failures: [{ kind: 'authentication', scope: { resourceId: 'r1' } }],
				},
			},
		];
		let call = 0;

		const result = await collectProviderPagedResult(async () => pages[call++]);

		// A single fetched page said `complete`, but a later page reported `partial`, so the merged completeness
		// is `partial`. The drain finished within its page budget, so the local `truncated` backstop stays unset.
		assert.deepEqual(result, {
			values: ['a', 'b'],
			metadata: { completeness: 'partial', failures: [{ kind: 'authentication', scope: { resourceId: 'r1' } }] },
		});
	});

	test('keeps the local backstop truncation even when every fetched page reported complete', async () => {
		const pages: ProviderApiPagedResult<string>[] = [
			{ values: ['a'], paging: { cursor: '1', more: true }, metadata: { completeness: 'complete' } },
			{ values: ['b'], paging: { cursor: '2', more: true }, metadata: { completeness: 'complete' } },
		];
		let call = 0;

		const result = await collectProviderPagedResult(async () => pages[call++], 2);

		assert.deepEqual(result, {
			values: ['a', 'b'],
			paging: { cursor: '2', more: true },
			truncated: true,
			metadata: { completeness: 'complete' },
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

suite('mergeCollectionMetadata', () => {
	test('returns the other operand when one side is undefined', () => {
		const meta: CollectionMetadata = { completeness: 'partial' };
		assert.equal(mergeCollectionMetadata(undefined, undefined), undefined);
		assert.deepEqual(mergeCollectionMetadata(meta, undefined), meta);
		assert.deepEqual(mergeCollectionMetadata(undefined, meta), meta);
	});

	test('applies completeness precedence partial > unknown > complete', () => {
		assert.equal(
			mergeCollectionMetadata({ completeness: 'complete' }, { completeness: 'unknown' })?.completeness,
			'unknown',
		);
		assert.equal(
			mergeCollectionMetadata({ completeness: 'unknown' }, { completeness: 'partial' })?.completeness,
			'partial',
		);
		assert.equal(
			mergeCollectionMetadata({ completeness: 'partial' }, { completeness: 'complete' })?.completeness,
			'partial',
		);
	});

	test('concatenates failures and deduplicates by kind, scope, and message', () => {
		const merged = mergeCollectionMetadata(
			{
				completeness: 'partial',
				failures: [
					{ kind: 'authentication', scope: { resourceId: 'r1' }, message: 'nope' },
					{ kind: 'rate-limit', scope: { resourceId: 'r2' } },
				],
			},
			{
				completeness: 'partial',
				failures: [
					// Structurally identical to the first failure -> deduped.
					{ kind: 'authentication', scope: { resourceId: 'r1' }, message: 'nope' },
					// Same kind/resource but a different message -> kept as distinct.
					{ kind: 'authentication', scope: { resourceId: 'r1' }, message: 'different' },
				],
			},
		);

		assert.equal(merged?.completeness, 'partial');
		assert.deepEqual(merged?.failures, [
			{ kind: 'authentication', scope: { resourceId: 'r1' }, message: 'nope' },
			{ kind: 'rate-limit', scope: { resourceId: 'r2' } },
			{ kind: 'authentication', scope: { resourceId: 'r1' }, message: 'different' },
		]);
	});
});
