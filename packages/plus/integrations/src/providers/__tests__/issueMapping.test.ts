import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { IssuesCloudHostIntegrationId } from '../../constants.js';
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
		assert.equal(issue.providerState, undefined);
		assert.equal(shape.providerState, undefined);
		assert.equal(issue.bodyFormat, undefined);
		assert.equal(shape.bodyFormat, undefined);
	});

	test('identifies Jira descriptions as wiki markup in both issue mappers', () => {
		const providerIssue: ProviderIssue = {
			author: null,
			assignees: [],
			commentCount: 0,
			closedDate: null,
			createdDate: new Date(0),
			description: 'h2. Details',
			id: 'global-id',
			labels: [],
			number: 'ABC-42',
			repository: null,
			state: null,
			title: 'Issue ABC-42',
			type: null,
			updatedDate: new Date(1),
			upvoteCount: 0,
			url: 'https://example.atlassian.net/browse/ABC-42',
		};
		const jiraIntegration = {
			...fakeIntegration,
			id: IssuesCloudHostIntegrationId.Jira,
		} as unknown as Integration;

		const issue = fromProviderIssue(providerIssue, jiraIntegration);
		const shape = toIssueShape(providerIssue, jiraIntegration);
		assert.ok(shape != null);

		assert.equal(issue.body, 'h2. Details');
		assert.equal(shape.body, issue.body);
		assert.equal(issue.bodyFormat, 'jira-wiki');
		assert.equal(shape.bodyFormat, issue.bodyFormat);
	});

	test('preserves the provider workflow state in both issue mappers', () => {
		const providerIssue: ProviderIssue = {
			author: null,
			assignees: [],
			commentCount: 0,
			closedDate: null,
			createdDate: new Date(0),
			description: null,
			id: 'global-id',
			labels: [],
			number: '42',
			repository: null,
			state: { id: 'state-id', name: 'In Review', color: '#ff0000', category: 'IN_PROGRESS' },
			title: 'Issue 42',
			type: null,
			updatedDate: new Date(1),
			upvoteCount: 0,
			url: 'https://example.com/issues/42',
		};

		const issue = fromProviderIssue(providerIssue, fakeIntegration);
		const shape = toIssueShape(providerIssue, fakeIntegration);
		assert.ok(shape != null);

		const expected = { id: 'state-id', name: 'In Review', color: '#ff0000', category: 'IN_PROGRESS' };
		assert.deepEqual(issue.providerState, expected);
		assert.deepEqual(shape.providerState, expected);
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
		assert.equal(shape.author?.url, undefined, 'toIssueShape leaves an absent author url absent');
		assert.equal(issue.assignees?.[0].url, undefined);
		assert.equal(shape.assignees?.[0].url, undefined);
		assert.equal(shape.project, undefined, 'an absent provider project is not fabricated with empty fields');
		assert.equal(shape.issueType, undefined);
	});

	test('normalizes a numeric provider issue number to a string display id', () => {
		const providerIssue = {
			author: null,
			assignees: [],
			commentCount: 0,
			closedDate: null,
			createdDate: new Date(0),
			description: null,
			id: 'global-id',
			labels: [],
			number: 42,
			repository: { id: 'repo-id', name: 'repo', owner: { login: 'octocat' } },
			state: null,
			title: 'Issue 42',
			type: null,
			updatedDate: new Date(1),
			upvoteCount: 0,
			url: 'https://example.com/octocat/repo/issues/42',
		} as unknown as ProviderIssue;

		const issue = fromProviderIssue(providerIssue, fakeIntegration);
		const shape = toIssueShape(providerIssue, fakeIntegration);

		assert.ok(shape != null);
		assert.equal(issue.id, '42');
		assert.equal(issue.number, '42');
		assert.equal(shape.id, '42');
	});
});
