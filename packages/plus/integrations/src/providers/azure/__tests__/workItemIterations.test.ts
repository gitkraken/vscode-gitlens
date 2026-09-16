import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { AzureProjectDescriptor, WorkItem } from '../models.js';
import { fromAzureWorkItem } from '../models.js';
import { azureProvider } from './fixtures.js';

const project: AzureProjectDescriptor = {
	key: 'project-id',
	id: 'project-id',
	name: 'Payments',
	resourceId: 'org-id',
	resourceName: 'acme',
};

function createWorkItem(iterationPath?: string): WorkItem {
	const link = { href: 'https://dev.azure.com/acme/Payments/_workitems/edit/42' };
	const author = {
		id: 'author-id',
		displayName: 'Author',
		uniqueName: 'author@example.com',
		url: link.href,
		imageUrl: link.href,
		_links: { avatar: link },
	};
	return {
		id: 42,
		rev: 1,
		url: link.href,
		_links: {
			fields: link,
			html: link,
			self: link,
			workItemComments: link,
			workItemRevisions: link,
			workItemType: link,
			workItemUpdates: link,
		},
		fields: {
			'System.TeamProject': project.name,
			'System.IterationPath': iterationPath,
			'System.WorkItemType': 'Bug',
			'System.State': 'Active',
			'System.AssignedTo': author,
			'System.CreatedDate': '2026-09-01T00:00:00Z',
			'System.CreatedBy': author,
			'System.ChangedDate': '2026-09-02T00:00:00Z',
			'System.ChangedBy': author,
			'System.CommentCount': 0,
			'System.Description': '',
			'System.Title': 'Issue 42',
			'Microsoft.VSTS.Common.ClosedDate': '',
		},
	};
}

suite('Azure work item iterations', () => {
	test('preserves the full path as identity and the leaf as name without sprint metadata', () => {
		const path = 'Payments\\Release 1\\Sprint 3';
		const issue = fromAzureWorkItem(createWorkItem(path), azureProvider, project);

		assert.deepEqual(issue.iterations, [{ id: path, name: 'Sprint 3' }]);
		assert.equal('isActive' in issue.iterations[0], false);
		assert.equal('startDate' in issue.iterations[0], false);
		assert.equal('endDate' in issue.iterations[0], false);
	});

	test('normalizes whitespace in the path and leaf name', () => {
		const issue = fromAzureWorkItem(createWorkItem(' Payments\\ Sprint 3 '), azureProvider, project);

		assert.deepEqual(issue.iterations, [{ id: 'Payments\\ Sprint 3', name: 'Sprint 3' }]);
	});

	for (const path of [undefined, '', ' ', 'Payments', ' Payments ', 'Payments\\', 'Payments\\ ']) {
		test(`leaves iterations undefined for an unassigned or empty path: ${JSON.stringify(path)}`, () => {
			const issue = fromAzureWorkItem(createWorkItem(path), azureProvider, project);

			assert.equal(issue.iterations, undefined);
		});
	}
});
