import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies Jira's getProviderIssuesForProject user-scoping (#5438): a resolved user always scopes the read
 * (defaulting to the assignee filter when no explicit filters are given), so it never falls through to the
 * unscoped project fetch that returns every issue.
 */

function jiraSession(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'atlassian.net',
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

const project = { key: 'p1', id: 'p1', name: 'Project One', resourceId: 'org-1', resourceName: 'Org One' };

suite('Jira issue scoping (#5438)', () => {
	test('a resolved user with no explicit filters scopes to the assignee, not an unscoped fetch', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		let scopedOptions: { assigneeLogins?: string[] } | undefined | 'unscoped' = 'unscoped';
		stubApi(jira, {
			getIssuesForProject: (
				_t: unknown,
				_name: string,
				_resourceId: string,
				options?: { assigneeLogins?: string[] },
			) => {
				// The scoped branch passes an options object; the unscoped fallback calls with no 4th arg.
				scopedOptions = options ?? 'unscoped';
				return Promise.resolve([]);
			},
		});

		await jira.getIssuesForProject(project, { user: 'me' });
		assert.notEqual(scopedOptions, 'unscoped', 'the read is scoped, not an unscoped project-wide fetch');
		assert.deepEqual(
			(scopedOptions as { assigneeLogins?: string[] }).assigneeLogins,
			['me'],
			'defaults to the assignee filter for the resolved user',
		);

		manager.dispose();
	});

	test('no user (broaden / includeAllAssignees) does an unscoped project fetch', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		let calledUnscoped = false;
		stubApi(jira, {
			getIssuesForProject: (_t: unknown, _name: string, _resourceId: string, options?: unknown) => {
				if (options == null) {
					calledUnscoped = true;
				}
				return Promise.resolve([]);
			},
		});

		await jira.getIssuesForProject(project, undefined);
		assert.equal(calledUnscoped, true, 'without a user, the project-wide (all visible) fetch is used');

		manager.dispose();
	});
});
