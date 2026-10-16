import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub } from './sweepHelpers.js';

/**
 * Some provider clients answer a canceled default-branch or metadata read with nothing rather than throwing. The host
 * keeps those answers in buckets that never expire, so a canceled read must not leave its empty answer there.
 */
suite('Canceled repository lookups', () => {
	for (const read of ['getDefaultBranch', 'getRepositoryMetadata'] as const) {
		test(`${read} keeps a canceled read's empty answer out of the cache, and a real answer in it`, async () => {
			const runtime = createFakeRuntime();
			const reads: CacheController[] = [];
			const track = <V>(loader: (c: CacheController) => { value: V }): V => {
				const cacheable = new CacheController();
				reads.push(cacheable);
				return loader(cacheable).value;
			};
			runtime.cache.getRepositoryDefaultBranch = (_repo, _integration, loader) => track(loader);
			runtime.cache.getRepositoryMetadata = (_repo, _integration, loader) => track(loader);
			const { manager, gh } = await connectedGitHub(runtime);
			let answer: unknown;
			const provider = gh as unknown as Record<string, () => Promise<unknown>>;
			provider.getProviderDefaultBranch = () => Promise.resolve(answer);
			provider.getProviderRepositoryMetadata = () => Promise.resolve(answer);
			try {
				const repo = { key: 'o/r', owner: 'o', name: 'r' };
				const aborter = new AbortController();
				aborter.abort();
				assert.equal(await gh[read](repo, { cancellation: aborter.signal }), undefined);
				// Not canceled: an empty answer is an answer.
				assert.equal(await gh[read](repo), undefined);
				answer = { name: 'main' };
				assert.deepEqual(await gh[read](repo, { cancellation: aborter.signal }), answer);
				assert.deepEqual(
					reads.map(r => r.invalidated),
					[true, false, false],
				);
			} finally {
				manager.dispose();
			}
		});
	}
});
