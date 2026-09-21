import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { fromAzureWorkItem } from '../models.js';
import { azureProject, azureProvider, createWorkItem } from './fixtures.js';

suite('Azure work item iterations', () => {
	test('preserves the full path as identity and the leaf as name without sprint metadata', () => {
		const path = 'Payments\\Release 1\\Sprint 3';
		const issue = fromAzureWorkItem(createWorkItem(path), azureProvider, azureProject);

		// deepEqual here is deepStrictEqual, so it already fails on an invented `isActive`/`startDate`/`endDate` key.
		assert.deepEqual(issue.iterations, [{ id: path, name: 'Sprint 3' }]);
	});

	test('keeps the path verbatim as identity and trims only the leaf name', () => {
		// provider-apis keeps `path` unnormalized because it is what the iteration is matched back by, so trimming
		// it here would give the same work item two identities depending on which read surfaced it.
		const issue = fromAzureWorkItem(createWorkItem(' Payments\\ Sprint 3 '), azureProvider, azureProject);

		assert.deepEqual(issue.iterations, [{ id: ' Payments\\ Sprint 3 ', name: 'Sprint 3' }]);
	});

	for (const path of [undefined, '', ' ', 'Payments', ' Payments ', 'Payments\\', 'Payments\\ ']) {
		test(`leaves iterations undefined for an unassigned or empty path: ${JSON.stringify(path)}`, () => {
			const issue = fromAzureWorkItem(createWorkItem(path), azureProvider, azureProject);

			assert.equal(issue.iterations, undefined);
		});
	}
});
