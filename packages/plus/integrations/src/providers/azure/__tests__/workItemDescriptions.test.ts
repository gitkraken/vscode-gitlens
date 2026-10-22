import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { AzureWorkItemDescriptionsCache } from '../workItemDescriptions.js';

const scope = { baseUrl: 'https://azure.example.test/tfs', namespace: 'Collection', token: 'token-a', isPAT: true };
const fields = { 'Custom.Notes': '<p>Notes</p>' };
const catalog = { value: [{ referenceName: 'Custom.Notes', name: 'Notes', type: 'html' }] };

suite('Azure work item description catalog', () => {
	test('uses built-in content without reading the catalog', async () => {
		const cache = new AzureWorkItemDescriptionsCache();
		assert.deepEqual(
			await cache.getFields({ 'Microsoft.VSTS.TCM.ReproSteps': '<p>Steps</p>' }, scope, async () => {
				throw new Error('Unexpected catalog read');
			}),
			[],
		);
	});

	test('shares catalogs only within a collection, installation, credential and auth mode', async () => {
		const cache = new AzureWorkItemDescriptionsCache();
		let calls = 0;
		const read = async () => {
			calls++;
			return catalog;
		};
		const first = await cache.getFields(fields, scope, read);
		assert.equal(
			await cache.getFields(fields, { ...scope, namespace: 'collection', baseUrl: `${scope.baseUrl}/` }, read),
			first,
		);
		for (const changed of [
			{ ...scope, token: 'token-b' },
			{ ...scope, namespace: 'Other' },
			{ ...scope, baseUrl: 'https://other.example.test/tfs' },
			{ ...scope, isPAT: false },
		]) {
			await cache.getFields(fields, changed, read);
		}
		assert.equal(calls, 5);
		cache.clear();
		await cache.getFields(fields, scope, read);
		assert.equal(calls, 6);
	});

	test('retries unavailable catalogs after the failure TTL', async () => {
		const cache = new AzureWorkItemDescriptionsCache();
		const originalNow = Date.now;
		let now = originalNow();
		let calls = 0;
		Date.now = () => now;
		try {
			const read = async () => {
				if (++calls === 1) throw new Error('Catalog unavailable');

				return catalog;
			};
			assert.deepEqual(await cache.getFields(fields, scope, read), []);
			assert.deepEqual(await cache.getFields(fields, scope, read), []);
			assert.equal(calls, 1);
			now += 30_001;
			assert.equal((await cache.getFields(fields, scope, read))[0].referenceName, 'Custom.Notes');
			assert.equal(calls, 2);
		} finally {
			Date.now = originalNow;
		}
	});

	test('a failed read completing after invalidation cannot repopulate the cache', async () => {
		const cache = new AzureWorkItemDescriptionsCache();
		let reject!: (reason: Error) => void;
		const pending = cache.getFields(
			fields,
			scope,
			() =>
				new Promise((_resolve, fail) => {
					reject = fail;
				}),
		);
		cache.clear();
		reject(new Error('Old request failed'));
		assert.deepEqual(await pending, []);
		assert.equal((await cache.getFields(fields, scope, async () => catalog))[0].referenceName, 'Custom.Notes');
	});

	test('canceling one waiter does not cancel another catalog reader', async () => {
		const cache = new AzureWorkItemDescriptionsCache();
		const abort = new AbortController();
		let resolve!: (value: unknown) => void;
		let reads = 0;
		const read = () => {
			reads++;
			return new Promise(complete => {
				resolve = complete;
			});
		};
		const canceled = cache.getFields(fields, scope, read, abort.signal);
		const shared = cache.getFields(fields, scope, read);
		abort.abort();
		await assert.rejects(canceled, isCancellationError);
		resolve(catalog);
		assert.equal((await shared)[0].referenceName, 'Custom.Notes');
		assert.equal(reads, 1);
	});
});
