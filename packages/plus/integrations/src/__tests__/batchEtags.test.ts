import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { CapturedBatch } from '../reads/batchEtags.js';
import { readEtaggedBatch } from '../reads/batchEtags.js';
import type { ProviderWarning } from '../results.js';

const targets = [
	{ key: 'a', owner: 'o', repo: 'r', number: 1 },
	{ key: 'b', owner: 'o', repo: 'r', number: 2 },
	{ key: 'c', owner: 'o', repo: 'r', number: 3 },
];

function read(readFull: () => Promise<CapturedBatch<{ number: number }>>) {
	return readEtaggedBatch({
		providerId: GitCloudHostIntegrationId.GitHub,
		domain: undefined,
		connectionId: undefined,
		targets: targets,
		supportsEtags: false,
		readFull: readFull,
		readEtagFields: () => Promise.resolve({}),
		itemEtag: () => 'etag',
		fieldsEtag: () => 'etag',
		unsupportedWarning: (): ProviderWarning => ({
			providerId: GitCloudHostIntegrationId.GitHub,
			message: 'unsupported',
			kind: 'unsupported',
			isAuth: false,
		}),
	});
}

suite('readEtaggedBatch warning target keys', () => {
	test('names the targets each dropped slot failed for, merging equal failures', async () => {
		const result = await read(() =>
			Promise.resolve({
				value: [
					{ status: 'rejected', reason: new Error('repository unavailable') },
					{ status: 'fulfilled', value: { number: 2 } },
					{ status: 'rejected', reason: new Error('repository unavailable') },
				],
			}),
		);

		assert.deepEqual(
			result.items.map(item => item.key),
			['b'],
		);
		assert.equal(result.warnings.length, 1);
		assert.deepEqual(result.warnings[0].targetKeys, ['a', 'c']);
	});

	test('names every target of an integration call that failed as a whole', async () => {
		const result = await read(() =>
			Promise.resolve({
				warning: {
					providerId: GitCloudHostIntegrationId.GitHub,
					message: 'Bad credentials',
					kind: 'auth' as const,
					isAuth: true,
				},
			}),
		);

		assert.deepEqual(result.items, []);
		assert.deepEqual(result.warnings[0].targetKeys, ['a', 'b', 'c']);
	});
});
