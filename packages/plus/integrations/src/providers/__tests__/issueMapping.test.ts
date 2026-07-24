import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Integration } from '../../models/integration.js';
import type { ProviderIssue } from '../models.js';
import { fromProviderIssue } from '../models.js';

const fakeIntegration = {
	id: 'azureDevOps',
	name: 'Azure DevOps',
	domain: 'dev.azure.com',
	icon: 'azure-devops',
} as unknown as Integration;

suite('issue mapping', () => {
	test('preserves repository identity, labels, and provider issue type', () => {
		const providerIssue: ProviderIssue = {
			author: null,
			assignees: [],
			commentCount: 0,
			closedDate: null,
			createdDate: new Date(0),
			description: null,
			id: 'global-id',
			labels: [
				{
					id: 'label-id',
					name: 'bug',
					color: '#ff0000',
					description: null,
				},
			],
			number: '42',
			repository: {
				id: 'repo-id',
				name: 'repo',
				owner: { login: 'octocat' },
			},
			state: null,
			title: 'Issue 42',
			type: 'Bug',
			updatedDate: new Date(1),
			upvoteCount: 0,
			url: 'https://example.com/octocat/repo/issues/42',
		};

		const issue = fromProviderIssue(providerIssue, fakeIntegration);

		assert.deepEqual(issue.repository, { owner: 'octocat', repo: 'repo', id: 'repo-id' });
		assert.deepEqual(issue.labels, [{ name: 'bug', color: '#ff0000' }]);
		assert.equal(issue.issueType, 'Bug');
	});
});
