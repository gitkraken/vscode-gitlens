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

		const captured: { assigneeLogins?: string[] }[] = [];
		stubApi(jira, {
			getIssuesForProjectPaged: (
				_t: unknown,
				_name: string,
				_resourceId: string,
				options?: { assigneeLogins?: string[] },
			) => {
				captured.push(options ?? {});
				return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
			},
		});

		await jira.getIssuesForProject(project, { user: 'me' });
		assert.deepEqual(captured[0]?.assigneeLogins, ['me'], 'defaults to the assignee filter for the resolved user');

		manager.dispose();
	});

	test('no user (broaden / includeAllAssignees) does an unscoped project fetch', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		let sawUnscoped = false;
		stubApi(jira, {
			getIssuesForProjectPaged: (
				_t: unknown,
				_name: string,
				_resourceId: string,
				options?: { authorLogin?: string; assigneeLogins?: string[]; mentionLogin?: string },
			) => {
				// The unscoped read carries no author/assignee/mention scope (only a paging cursor).
				if (options?.authorLogin == null && options?.assigneeLogins == null && options?.mentionLogin == null) {
					sawUnscoped = true;
				}
				return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
			},
		});

		await jira.getIssuesForProject(project, undefined);
		assert.equal(sawUnscoped, true, 'without a user, the project-wide (all visible) fetch is used');

		manager.dispose();
	});

	test('drains every page of a project read, threading the SDK cursor (#5438)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		// Three pages threaded by cursor; the read must follow hasMore/nextCursor to the end, not stop at page 1.
		const cursors: (string | undefined)[] = [];
		stubApi(jira, {
			getIssuesForProjectPaged: (_t: unknown, _n: string, _r: string, options?: { cursor?: string }) => {
				cursors.push(options?.cursor);
				const page = options?.cursor == null ? 1 : Number(options.cursor);
				return Promise.resolve({
					data: [
						{
							id: `i${page}`,
							number: `${page}`,
							title: `Issue ${page}`,
							url: `https://atlassian.net/i/${page}`,
							createdDate: new Date(0),
							updatedDate: new Date(0),
							closedDate: null,
							author: { id: 'a', name: 'A', avatarUrl: null, url: null },
							assignees: [],
							labels: [],
						},
					],
					hasMore: page < 3,
					nextCursor: page < 3 ? String(page + 1) : undefined,
				});
			},
		});

		const issues = await jira.getIssuesForProject(project, undefined);
		assert.deepEqual(cursors, [undefined, '2', '3'], 'each page threads the previous page cursor');
		assert.equal(issues?.length, 3, 'issues from all three pages are returned');

		manager.dispose();
	});

	test('reports truncated when the per-project drain hits its page backstop (#5438)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		// The provider always reports another page: the drain must stop at its backstop and flag truncation
		// rather than looping or silently dropping the tail.
		stubApi(jira, {
			getIssuesForProjectPaged: (_t: unknown, _n: string, _r: string, options?: { cursor?: string }) => {
				const page = options?.cursor == null ? 1 : Number(options.cursor);
				return Promise.resolve({ data: [], hasMore: true, nextCursor: String(page + 1) });
			},
		});

		const result = await (
			jira as unknown as {
				getProviderIssuesForProjectWithTruncation: (
					session: ProviderAuthenticationSession,
					p: typeof project,
					options?: unknown,
				) => Promise<{ values: unknown[]; truncated: boolean }>;
			}
		).getProviderIssuesForProjectWithTruncation(jiraSession(), project, undefined);
		assert.equal(result.truncated, true, 'the backstop hit is reported as truncated');

		manager.dispose();
	});

	test('propagates the error when every filter branch rejects, instead of an empty success (#5438)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		stubApi(jira, {
			getIssuesForProjectPaged: () => Promise.reject(new Error('boom')),
		});

		// A user-scoped read whose only filter branch rejects must surface the failure (via the result core's
		// `{ error }`), not resolve to an empty "no issues" list.
		const result = await jira.getIssuesForProjectResult(project, { user: 'me' });
		assert.ok(result?.error != null, 'the rejection surfaces as an error, not an empty success');

		manager.dispose();
	});
});
