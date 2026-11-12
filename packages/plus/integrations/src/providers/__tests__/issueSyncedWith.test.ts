import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { fromProviderIssue, toIssueShape } from '../models.js';
import { createProviderIssue, linearIntegration } from './fixtures.js';

for (const [name, mapIssue] of [
	['fromProviderIssue', fromProviderIssue],
	['toIssueShape', toIssueShape],
] as const) {
	suite(`${name} syncedWith`, () => {
		test("carries every GitHub issue Linear's sync links to the issue", () => {
			const issue = mapIssue(
				createProviderIssue({
					syncedWith: [
						{ service: 'github', id: '6063246474', owner: 'acme', repo: 'web', number: 42 },
						{ service: 'github', id: '6063246475', owner: 'acme', repo: 'api', number: 7 },
						{ service: 'github', id: '6063246476', owner: null, repo: null, number: null },
					],
				}),
				linearIntegration,
			);

			assert.ok(issue != null);
			assert.deepEqual(issue.syncedWith, [
				{ provider: 'github', id: '6063246474', owner: 'acme', repo: 'web', number: 42 },
				{ provider: 'github', id: '6063246475', owner: 'acme', repo: 'api', number: 7 },
				{ provider: 'github', id: '6063246476' },
			]);
		});

		test('keeps an issue Linear reports as synced with nothing distinct from one with no sync data', () => {
			const unsynced = mapIssue(createProviderIssue({ syncedWith: [] }), linearIntegration);
			const unknown = mapIssue(createProviderIssue(), linearIntegration);

			assert.ok(unsynced != null && unknown != null);
			assert.deepEqual(unsynced.syncedWith, []);
			assert.equal(unknown.syncedWith, undefined);
		});
	});
}
