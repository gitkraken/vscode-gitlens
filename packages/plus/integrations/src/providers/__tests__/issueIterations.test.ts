import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../../constants.js';
import type { Integration } from '../../models/integration.js';
import type { ProviderIssue } from '../models.js';
import { fromProviderIssue, toIssueShape } from '../models.js';

function createIssue(overrides: Partial<ProviderIssue> = {}): ProviderIssue {
	return {
		author: null,
		assignees: [],
		commentCount: 0,
		closedDate: null,
		createdDate: new Date(0),
		description: null,
		id: 'issue-id',
		labels: [],
		number: '42',
		repository: null,
		state: null,
		title: 'Issue 42',
		type: null,
		updatedDate: new Date(1),
		upvoteCount: 0,
		url: 'https://example.com/issues/42',
		...overrides,
	};
}

const jira = {
	id: IssuesCloudHostIntegrationId.Jira,
	name: 'Jira',
	domain: 'example.atlassian.net',
	icon: 'jira',
} as unknown as Integration;
const azure = {
	id: GitCloudHostIntegrationId.AzureDevOps,
	name: 'Azure DevOps',
	domain: 'dev.azure.com',
	icon: 'azure-devops',
} as unknown as Integration;

for (const [name, mapIssue] of [
	['fromProviderIssue', fromProviderIssue],
	['toIssueShape', toIssueShape],
] as const) {
	suite(`${name} iterations`, () => {
		test('preserves every Jira sprint, its dates, and both active and inactive states', () => {
			const startDate = new Date('2026-09-01T00:00:00Z');
			const endDate = new Date('2026-09-15T00:00:00Z');
			const issue = mapIssue(
				createIssue({
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
				jira,
			);

			assert.ok(issue != null);
			assert.deepEqual(issue.iterations, [
				{ id: '1', name: 'Sprint 1', isActive: false, startDate: startDate, endDate: endDate },
				{ id: '2', name: 'Sprint 2', isActive: true, startDate: startDate, endDate: endDate },
			]);
		});

		test('leaves unreported Jira sprint dates undefined', () => {
			const issue = mapIssue(
				createIssue({
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
				jira,
			);

			assert.ok(issue != null);
			assert.deepEqual(issue.iterations, [
				{ id: 'future', name: 'Future sprint', isActive: false, startDate: undefined, endDate: undefined },
			]);
		});

		test('maps an Azure iteration path without fabricating activity or dates', () => {
			const path = 'Payments\\Release 1\\Sprint 3';
			const issue = mapIssue(createIssue({ iteration: { path: path, name: 'Sprint 3' }, sprints: [] }), azure);

			assert.ok(issue != null);
			assert.deepEqual(issue.iterations, [{ id: path, name: 'Sprint 3' }]);
			const iteration = issue.iterations[0];
			assert.equal('isActive' in iteration, false);
			assert.equal('startDate' in iteration, false);
			assert.equal('endDate' in iteration, false);
		});

		for (const [description, providerIssue] of [
			['absent', createIssue()],
			['empty', createIssue({ sprints: [] })],
		] as const) {
			test(`leaves iterations undefined when sprint data is ${description}`, () => {
				for (const provider of [jira, azure]) {
					const issue = mapIssue(providerIssue, provider);

					assert.ok(issue != null);
					assert.equal(issue.iterations, undefined);
					assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(issue)), 'iterations'), false);
				}
			});
		}
	});
}
