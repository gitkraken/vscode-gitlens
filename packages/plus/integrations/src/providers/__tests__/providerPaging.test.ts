import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { ProviderApiPagedResult } from '../models.js';
import { collectProviderPagedResult, flatSettledOrThrow, mergeCollectionMetadata } from '../utils/providerPaging.js';

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

	test('preserves merged metadata when a scoped later page throws', async () => {
		const error = new Error('boom');

		const result = await collectProviderPagedResult(
			async cursor => {
				if (cursor == null) {
					return {
						values: ['a'],
						paging: { cursor: '1', more: true },
						metadata: { completeness: 'complete' },
					};
				}

				throw error;
			},
			20,
			{ providerId: 'github', resourceId: 'r1' },
		);

		assert.deepEqual(result, {
			values: ['a'],
			truncated: true,
			metadata: {
				completeness: 'partial',
				failures: [{ kind: 'provider', scope: { providerId: 'github', resourceId: 'r1' }, message: 'boom' }],
			},
		});
	});

	test('marks a missing continuation page incomplete while preserving the prefix', async () => {
		const result = await collectProviderPagedResult(
			async cursor => (cursor == null ? { values: ['a'], paging: { cursor: '1', more: true } } : undefined),
			20,
			{ providerId: 'github', resourceId: 'r1' },
		);

		assert.deepEqual(result.values, ['a']);
		assert.equal(result.truncated, true);
		assert.equal(result.metadata?.completeness, 'partial');
		assert.deepEqual(result.metadata?.failures?.[0]?.scope, {
			providerId: 'github',
			resourceId: 'r1',
		});
	});
});

suite('flatSettledOrThrow', () => {
	test('propagates the provider error when every scope fails', async () => {
		const error = new Error('boom');

		await assert.rejects(
			() => flatSettledOrThrow([Promise.reject(error), Promise.reject(new Error('later'))]),
			error,
		);
	});

	test('preserves successful scope results when another scope fails', async () => {
		const result = await flatSettledOrThrow([Promise.reject(new Error('boom')), Promise.resolve(['a', 'b'])]);

		assert.deepEqual(result, ['a', 'b']);
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

	test('collapses omissions per kind and scope, keeping the highest reported total', () => {
		const merged = mergeCollectionMetadata(
			{
				completeness: 'partial',
				omissions: [
					{ kind: 'provider-limit', scope: { repositoryId: 'o/r1' }, limit: 1000, totalCount: 1393 },
					{ kind: 'recovery-budget', scope: { repositoryId: 'o/r2' }, limit: 128 },
				],
			},
			{
				completeness: 'partial',
				omissions: [
					// Structurally identical to the first omission -> collapsed.
					{ kind: 'provider-limit', scope: { repositoryId: 'o/r1' }, limit: 1000, totalCount: 1393 },
					// The same cap on the same repo, re-measured on a later page. GitHub recomputes the match
					// total per request, so this is one omission with a drifting count, not two — collapse it
					// and keep the highest figure, or the consumer gets a near-identical warning per page.
					{ kind: 'provider-limit', scope: { repositoryId: 'o/r1' }, limit: 1000, totalCount: 1600 },
					// A different repository is a genuinely distinct omission -> kept.
					{ kind: 'provider-limit', scope: { repositoryId: 'o/r3' }, limit: 1000, totalCount: 1042 },
				],
			},
		);

		assert.equal(merged?.completeness, 'partial');
		assert.deepEqual(merged?.omissions, [
			{ kind: 'provider-limit', scope: { repositoryId: 'o/r1' }, limit: 1000, totalCount: 1600 },
			{ kind: 'recovery-budget', scope: { repositoryId: 'o/r2' }, limit: 128 },
			{ kind: 'provider-limit', scope: { repositoryId: 'o/r3' }, limit: 1000, totalCount: 1042 },
		]);
	});

	test('a re-measured omission never lowers the reported total', () => {
		// Order must not decide the outcome: a later page reporting a SMALLER total keeps the larger figure.
		const merged = mergeCollectionMetadata(
			{ completeness: 'partial', omissions: [{ kind: 'provider-limit', limit: 1000, totalCount: 1600 }] },
			{ completeness: 'partial', omissions: [{ kind: 'provider-limit', limit: 1000, totalCount: 1393 }] },
		);

		assert.deepEqual(merged?.omissions, [{ kind: 'provider-limit', limit: 1000, totalCount: 1600 }]);
	});

	test('omits the omissions key entirely when neither side reported one', () => {
		const merged = mergeCollectionMetadata(
			{ completeness: 'partial', failures: [{ kind: 'rate-limit' }] },
			{ completeness: 'complete' },
		);

		// Deep-equal against the pre-omissions shape: a metadata-free drain must not start carrying an
		// explicit `omissions: []` that consumers would have to special-case.
		assert.deepEqual(merged, { completeness: 'partial', failures: [{ kind: 'rate-limit' }] });
	});

	test('carries omissions through when only one side reported them', () => {
		const omission = { kind: 'provider-limit' as const, limit: 1000, totalCount: 1393 };

		assert.deepEqual(
			mergeCollectionMetadata({ completeness: 'complete' }, { completeness: 'partial', omissions: [omission] })
				?.omissions,
			[omission],
		);
		assert.deepEqual(
			mergeCollectionMetadata({ completeness: 'partial', omissions: [omission] }, { completeness: 'complete' })
				?.omissions,
			[omission],
		);
	});
});
