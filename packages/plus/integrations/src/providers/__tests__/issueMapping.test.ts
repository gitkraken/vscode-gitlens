import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Integration } from '../../models/integration.js';
import type { ProviderIssue } from '../models.js';
import { fromProviderIssue, toIssueShape } from '../models.js';

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
			project: {
				id: 'project-id',
				key: null,
				name: 'Payments',
				namespace: 'acme',
				resourceId: 'org-id',
			},
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
		const shape = toIssueShape(providerIssue, fakeIntegration);
		assert.ok(shape != null);

		assert.deepEqual(issue.repository, { owner: 'octocat', repo: 'repo', id: 'repo-id' });
		assert.deepEqual(shape.repository, issue.repository);
		assert.deepEqual(issue.labels, [{ name: 'bug', color: '#ff0000' }]);
		assert.deepEqual(shape.project, {
			id: 'project-id',
			name: 'Payments',
			resourceId: 'org-id',
			resourceName: 'acme',
		});
		assert.deepEqual(shape.project, issue.project);
		assert.equal(issue.issueType, 'Bug');
		assert.equal(shape.issueType, 'Bug');
	});

	/**
	 * Both mappers feed `listIssuesPage` — the repo-scoped path via `toIssueShape`, Azure's account-wide path via
	 * `fromProviderIssue` — so they must agree on the normalized member shape or the facade returns a different
	 * shape per provider for the same method. `url` is optional, so absent must be `undefined`: `''` passes a
	 * `!= null` presence check and renders as a link to nowhere.
	 */
	test('both issue mappers collapse an absent member url to undefined', () => {
		const providerIssue: ProviderIssue = {
			author: null,
			assignees: [{ id: 'a1', name: 'Ann', username: null, email: null, url: null, avatarUrl: null }],
			commentCount: 0,
			closedDate: null,
			createdDate: new Date(0),
			description: null,
			id: 'global-id',
			labels: [],
			number: '7',
			repository: { id: 'repo-id', name: 'repo', owner: { login: 'octocat' } },
			state: null,
			title: 'Issue 7',
			type: null,
			updatedDate: new Date(1),
			upvoteCount: 0,
			url: 'https://example.com/octocat/repo/issues/7',
		};

		const issue = fromProviderIssue(providerIssue, fakeIntegration);
		const shape = toIssueShape(providerIssue, fakeIntegration);
		assert.ok(shape != null);

		assert.equal(issue.author?.url, undefined, 'fromProviderIssue leaves an absent author url absent');
		assert.equal(shape.author.url, undefined, 'toIssueShape leaves an absent author url absent');
		assert.equal(issue.assignees?.[0].url, undefined);
		assert.equal(shape.assignees?.[0].url, undefined);
		assert.equal(shape.project, undefined, 'an absent provider project is not fabricated with empty fields');
		assert.equal(shape.issueType, undefined);
	});
});
