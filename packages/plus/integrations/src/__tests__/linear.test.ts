import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
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

function fakeLinearIssue(id: string, assignee?: { id: string; name: string }): ProviderIssue {
	return {
		id: id,
		number: id,
		title: `Issue ${id}`,
		url: `https://linear.app/i/${id}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: assignee != null ? [{ id: assignee.id, name: assignee.name, avatarUrl: null, url: null }] : [],
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
			// Assignee `name` (full name) deliberately differs from the viewer id, since the filter must match
			// on the stable Linear user id, not a display/name string (name vs displayName diverge in Linear).
			getLinearIssues: () =>
				Promise.resolve({
					values: [
						fakeLinearIssue('1', { id: 'u1', name: 'Ada Lovelace' }),
						fakeLinearIssue('2', { id: 'u2', name: 'Someone Else' }),
					],
					paging: { more: false, cursor: '{}' },
				}),
			getLinearCurrentUser: () =>
				Promise.resolve({ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', displayName: 'ada' }),
		});

		// `user` is the displayName ('ada'), which does NOT equal the assignee's name ('Ada Lovelace'); the
		// filter must still match via the resolved viewer id (u1).
		const issues = await linear.getIssuesForProject({ key: 't1', id: 't1', name: 'Team 1' }, { user: 'ada' });
		assert.equal(issues?.length, 1, 'only the current user (by id) issue survives, despite name≠displayName');
		assert.equal(issues?.[0].id, '1');

		manager.dispose();
	});

	test('getIssuesForProject surfaces an error (not [] and not the unfiltered issues) when the viewer is unresolved', async () => {
		// Regression guard for the "my-issues leak": when a user scope is requested but the current viewer
		// can't be resolved, returning the unfiltered team issues would leak everyone else's, and returning []
		// is indistinguishable from "no issues assigned to me". This has regressed twice along this axis, so
		// pin that it surfaces an error the facade can turn into a warning + fetchFailed.
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

		stubApi(linear, {
			getLinearIssues: () =>
				Promise.resolve({
					values: [
						fakeLinearIssue('1', { id: 'u1', name: 'Ada Lovelace' }),
						fakeLinearIssue('2', { id: 'u2', name: 'Someone Else' }),
					],
					paging: { more: false, cursor: '{}' },
				}),
			// Viewer resolves to an id-less object → cannot scope to "my issues".
			getLinearCurrentUser: () => Promise.resolve(undefined),
		});

		// The result-returning core recovers the throw into { error } (no leaked issues, distinguishable from
		// a genuinely empty read).
		const result = await (
			linear as unknown as {
				getIssuesForProjectResult: (
					p: ResourceDescriptor,
					o?: { user?: string },
				) => Promise<{ value?: IssueShape[]; error?: unknown }>;
			}
		).getIssuesForProjectResult({ key: 't1', id: 't1', name: 'Team 1' }, { user: 'ada' });
		assert.equal(result.value, undefined, 'no issues leak when the viewer is unresolved');
		assert.ok(result.error != null, 'an unresolved viewer is surfaced as an error, not a silent empty');

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
