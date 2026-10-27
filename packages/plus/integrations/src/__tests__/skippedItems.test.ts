import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { assessCollectionMetadata, hasOnlyScopedAuthFailures, withValidSkippedItems } from '../collectionMetadata.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';

const scope = { providerId: 'jira', resourceId: 'site-1' };

function withSkipped(skippedItems: unknown, message = 'Skipped Jira issues that could not be read: P-1 (boom).') {
	const metadata: CollectionMetadata = {
		completeness: 'partial',
		failures: [
			{
				scope: scope,
				kind: 'provider',
				message: message,
				skippedItems: skippedItems as NonNullable<CollectionMetadata['failures']>[number]['skippedItems'],
			},
		],
	};
	return metadata;
}

function checked(metadata: CollectionMetadata): NonNullable<CollectionMetadata['failures']>[number] {
	const failure = withValidSkippedItems(metadata)?.failures?.[0];
	assert.ok(failure);
	return failure;
}

suite('withValidSkippedItems', () => {
	test('leaves metadata without skippedItems as it is, and metadata that is absent absent', () => {
		const metadata: CollectionMetadata = {
			completeness: 'partial',
			failures: [{ scope: scope, kind: 'provider', message: 'Request failed (500)' }],
		};

		assert.equal(withValidSkippedItems(metadata), metadata);
		assert.equal(withValidSkippedItems(undefined), undefined);
	});

	test('keeps a well-formed skippedItems as it is', () => {
		const skipped = { keys: ['P-1', 'P-2'], total: 3, complete: false };

		assert.deepEqual(checked(withSkipped(skipped)).skippedItems, skipped);
	});

	test('keeps an object without an array of keys as a skip that names none and is not complete', () => {
		for (const [bad, total] of [
			[{ total: 2, complete: true }, 2],
			[{ keys: 'P-1', total: 1, complete: true }, 1],
			[{ keys: null, total: 'many', complete: true }, 0],
			[{}, 0],
		] as const) {
			const failure = checked(withSkipped(bad));

			assert.equal(failure.message, 'Skipped Jira issues that could not be read: P-1 (boom).');
			assert.deepEqual(failure.skippedItems, { keys: [], total: total, complete: false }, JSON.stringify(bad));
		}
	});

	test('drops what is not an object at all, leaving an ordinary failure', () => {
		for (const bad of [null, 'P-1', 7, true]) {
			const failure = checked(withSkipped(bad));

			assert.equal('skippedItems' in failure, false, JSON.stringify(bad));
		}
	});

	test('a skip whose payload is unusable is still a skip, never classified by its own error text', () => {
		for (const status of ['401', '503']) {
			const metadata = withValidSkippedItems(
				withSkipped(
					{ total: 1 },
					`Skipped Jira issues that could not be read: P-1 (Request failed (${status})).`,
				),
			);

			const result = assessCollectionMetadata(IssuesCloudHostIntegrationId.Jira, undefined, undefined, metadata);

			assert.deepEqual(
				result.warnings.map(warning => [warning.kind, warning.isAuth, warning.unreadableItems]),
				[['unreadable-items', false, { keys: [], complete: false }]],
				status,
			);
			assert.equal(result.requestFailed, false, status);
			assert.equal(hasOnlyScopedAuthFailures(metadata), false, status);
		}
	});

	test('keeps only the string keys, in order, and says it is not complete', () => {
		const failure = checked(withSkipped({ keys: ['P-2', 7, null, 'P-1'], total: 4, complete: true }));

		assert.deepEqual(failure.skippedItems, { keys: ['P-2', 'P-1'], total: 4, complete: false });
	});

	test('de-duplicates keys without calling them incomplete, and counts at least the keys it names', () => {
		const failure = checked(withSkipped({ keys: ['P-1', 'P-2', 'P-1', 'P-3'], total: 'many', complete: true }));

		assert.deepEqual(failure.skippedItems, { keys: ['P-1', 'P-2', 'P-3'], total: 3, complete: true });
	});

	test('a payload that skipped items yet names none is not complete, however it says it is', () => {
		assert.deepEqual(checked(withSkipped({ keys: [], total: 2, complete: true })).skippedItems, {
			keys: [],
			total: 2,
			complete: false,
		});
		assert.deepEqual(checked(withSkipped({ keys: [], total: 0, complete: true })).skippedItems, {
			keys: [],
			total: 0,
			complete: true,
		});
	});

	test('does not touch the metadata it was given', () => {
		const metadata = withSkipped({ keys: ['P-1', 7], total: 2, complete: true });

		withValidSkippedItems(metadata);

		assert.deepEqual(metadata.failures?.[0].skippedItems, { keys: ['P-1', 7], total: 2, complete: true });
	});
});
