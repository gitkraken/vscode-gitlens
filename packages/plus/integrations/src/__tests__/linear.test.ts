import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderIssue } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies the Linear issue reads implemented for #5438: getProviderIssuesForProject reads a team's issues
 * (Linear's "project" descriptor is a team) and getProviderAccountForResource resolves the viewer — both
 * previously threw 'Method not implemented.', which made every Linear read surface as a failure.
 */

function linearSession(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'linear.app',
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

function fakeLinearIssue(id: string, assignee?: string): ProviderIssue {
	return {
		id: id,
		number: id,
		title: `Issue ${id}`,
		url: `https://linear.app/i/${id}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: assignee != null ? [{ id: assignee, name: assignee, avatarUrl: null, url: null }] : [],
		labels: [],
	} as unknown as ProviderIssue;
}

suite('Linear issue reads (#5438)', () => {
	test('getIssuesForProject reads the team issues and maps them to issue shapes', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

		let capturedTeams: string[] | undefined;
		stubApi(linear, {
			getLinearIssues: (_t: unknown, input: { teams?: string[] }) => {
				capturedTeams = input.teams;
				return Promise.resolve({ values: [fakeLinearIssue('1')], paging: { more: false, cursor: '{}' } });
			},
		});

		const issues = await linear.getIssuesForProject({ key: 't1', id: 't1', name: 'Team 1' });
		assert.equal(issues?.length, 1, 'the team issues are mapped');
		assert.deepEqual(capturedTeams, ['t1'], 'scoped to the team id');

		manager.dispose();
	});

	test('getIssuesForProject scopes to the assignee client-side when a user is given', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

		stubApi(linear, {
			getLinearIssues: () =>
				Promise.resolve({
					values: [fakeLinearIssue('1', 'me'), fakeLinearIssue('2', 'other')],
					paging: { more: false, cursor: '{}' },
				}),
		});

		// Linear's getIssues has no server-side assignee filter, so the user scope is applied client-side.
		const issues = await linear.getIssuesForProject({ key: 't1', id: 't1', name: 'Team 1' }, { user: 'me' });
		assert.equal(issues?.length, 1, 'only the issue assigned to the user survives');
		assert.equal(issues?.[0].id, '1');

		manager.dispose();
	});

	test('getAccountForResource resolves the viewer', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

		stubApi(linear, {
			getLinearCurrentUser: () =>
				Promise.resolve({ id: 'u1', name: 'Me', email: 'me@example.com', displayName: 'me' }),
		});

		const account = await linear.getAccountForResource({ key: 't1', id: 't1', name: 'Team 1' });
		assert.equal(account?.id, 'u1');
		assert.equal(account?.username, 'me');

		manager.dispose();
	});
});
