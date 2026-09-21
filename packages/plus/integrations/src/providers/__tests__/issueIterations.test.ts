import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { fromProviderIssue, toIssueShape } from '../models.js';
import { azureIntegration, createProviderIssue, jiraIntegration } from './fixtures.js';

for (const [name, mapIssue] of [
	['fromProviderIssue', fromProviderIssue],
	['toIssueShape', toIssueShape],
] as const) {
	suite(`${name} iterations`, () => {
		test('preserves every Jira sprint, its dates, and both active and inactive states', () => {
			const startDate = new Date('2026-09-01T00:00:00Z');
			const endDate = new Date('2026-09-15T00:00:00Z');
			const issue = mapIssue(
				createProviderIssue({
					sprints: [
						{
							id: '1',
							name: 'Sprint 1',
							isActive: false,
							startDate: startDate,
							endDate: endDate,
							completedDate: endDate,
						},
						{
							id: '2',
							name: 'Sprint 2',
							isActive: true,
							startDate: startDate,
							endDate: endDate,
							completedDate: null,
						},
					],
				}),
				jiraIntegration,
			);

			assert.ok(issue != null);
			assert.deepEqual(issue.iterations, [
				{ id: '1', name: 'Sprint 1', isActive: false, startDate: startDate, endDate: endDate },
				{ id: '2', name: 'Sprint 2', isActive: true, startDate: startDate, endDate: endDate },
			]);
		});

		test('leaves unreported Jira sprint dates undefined', () => {
			const issue = mapIssue(
				createProviderIssue({
					sprints: [
						{
							id: 'future',
							name: 'Future sprint',
							isActive: false,
							startDate: null,
							endDate: null,
							completedDate: null,
						},
					],
				}),
				jiraIntegration,
			);

			assert.ok(issue != null);
			assert.deepEqual(issue.iterations, [
				{ id: 'future', name: 'Future sprint', isActive: false, startDate: undefined, endDate: undefined },
			]);
		});

		test('maps an Azure iteration path without fabricating activity or dates', () => {
			const path = 'Payments\\Release 1\\Sprint 3';
			const issue = mapIssue(
				createProviderIssue({ iteration: { path: path, name: 'Sprint 3' } }),
				azureIntegration,
			);

			assert.ok(issue != null);
			// deepEqual here is deepStrictEqual, so it already fails on an invented `isActive`/`startDate`/`endDate` key.
			assert.deepEqual(issue.iterations, [{ id: path, name: 'Sprint 3' }]);
		});

		test('prefers the Azure iteration over sprints when a provider reports both', () => {
			const path = 'Payments\\Release 1\\Sprint 3';
			const issue = mapIssue(
				createProviderIssue({
					iteration: { path: path, name: 'Sprint 3' },
					sprints: [
						{
							id: '1',
							name: 'Sprint 1',
							isActive: true,
							startDate: null,
							endDate: null,
							completedDate: null,
						},
					],
				}),
				azureIntegration,
			);

			// No provider reports both today; this pins the documented precedence so a change to it is deliberate.
			assert.ok(issue != null);
			assert.deepEqual(issue.iterations, [{ id: path, name: 'Sprint 3' }]);
		});

		for (const [description, providerIssue] of [
			['absent', createProviderIssue()],
			['empty', createProviderIssue({ sprints: [] })],
		] as const) {
			test(`leaves iterations undefined when sprint data is ${description}`, () => {
				for (const provider of [jiraIntegration, azureIntegration]) {
					const issue = mapIssue(providerIssue, provider);

					assert.ok(issue != null);
					assert.equal(issue.iterations, undefined);
				}
			});
		}
	});
}
