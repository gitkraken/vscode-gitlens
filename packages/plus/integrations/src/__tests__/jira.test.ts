import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { IssueFilter } from '../providers/models.js';
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

	test('when every filter branch rejects, propagates the first reason unwrapped (not an AggregateError)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		// Two filter branches, both rejecting with distinct errors. The first reason must be re-thrown as-is so
		// the facade can still classify it by type (auth/rate-limit); wrapping every reason in an AggregateError
		// would collapse the classification to a generic 'other'. The remaining reason is logged, not surfaced.
		const first = new Error('assignee branch failed');
		stubApi(jira, {
			getIssuesForProjectPaged: (
				_t: unknown,
				_name: string,
				_resourceId: string,
				options?: { authorLogin?: string; assigneeLogins?: string[] },
			) =>
				options?.authorLogin != null
					? Promise.reject(new Error('author branch failed'))
					: Promise.reject(first),
		});

		const result = await jira.getIssuesForProjectWithTruncationResult(project, {
			user: 'me',
			filters: [IssueFilter.Assignee, IssueFilter.Author],
		});

		assert.equal(result?.value, undefined, 'an all-rejected read is a hard error, not a partial success');
		assert.equal(result?.error, first, 'the first reason is propagated verbatim, not wrapped');
		assert.ok(
			!(result?.error instanceof AggregateError),
			'the reasons are not collapsed into an AggregateError (which would lose type-based classification)',
		);

		manager.dispose();
	});
});

/**
 * Verifies Jira project fan-out metadata consumption + retry-safe caching (#5438): a mixed-success fan-out
 * preserves the successful resources' projects and surfaces the failed resource's metadata, a failed resource
 * is never cached as empty (so it retries), a proven-empty resource IS cached, and a forced refresh that fails
 * doesn't erase an older valid cache entry.
 */
suite('Jira project fan-out metadata + caching (#5438)', () => {
	const orgOk = { key: 'r1', id: 'r1', name: 'Resource 1', url: '', avatarUrl: '' };
	const orgBad = { key: 'r2', id: 'r2', name: 'Resource 2', url: '', avatarUrl: '' };

	function jiraProject(id: string, resourceId: string) {
		return { key: id, id: id, name: `Project ${id}`, resourceId: resourceId };
	}

	test('a mixed-success fan-out keeps the successful projects and reports the failed resource metadata', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		const calls: string[][] = [];
		stubApi(jira, {
			getJiraProjectsForResources: (_t: unknown, resourceIds: string[]) => {
				calls.push(resourceIds);
				// r1 succeeds, r2 fails with auth: the SDK returns r1's project plus a structured failure for r2.
				return Promise.resolve({
					values: [jiraProject('p1', 'r1')],
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { resourceId: 'r2' } }],
					},
				});
			},
		});

		const result = await (
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: (
					resources: unknown[],
				) => Promise<{ value?: { values: { id: string }[]; metadata?: { completeness: string } } }>;
			}
		).getProjectsForResourcesWithMetadataResult([orgOk, orgBad]);

		assert.deepEqual(
			result.value?.values.map(p => p.id),
			['p1'],
			'the successful resource contributes its project',
		);
		assert.equal(result.value?.metadata?.completeness, 'partial', 'the fan-out reports partial completeness');
		assert.deepEqual(calls[0], ['r1', 'r2'], 'both resources are requested on the first read');

		manager.dispose();
	});

	test('a failed resource is not cached as empty and is retried on the next call', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		const requested: string[][] = [];
		let attempt = 0;
		stubApi(jira, {
			getJiraProjectsForResources: (_t: unknown, resourceIds: string[]) => {
				requested.push(resourceIds);
				attempt++;
				if (attempt === 1) {
					// First call: r2 fails.
					return Promise.resolve({
						values: [jiraProject('p1', 'r1')],
						metadata: {
							completeness: 'partial',
							failures: [{ kind: 'network', scope: { resourceId: 'r2' } }],
						},
					});
				}
				// Second call: r2 recovers.
				return Promise.resolve({
					values: [jiraProject('p2', 'r2')],
					metadata: { completeness: 'complete' },
				});
			},
		});

		const api = jira as unknown as {
			getProjectsForResourcesWithMetadataResult: (
				resources: unknown[],
			) => Promise<{ value?: { values: { id: string }[] } }>;
		};

		await api.getProjectsForResourcesWithMetadataResult([orgOk, orgBad]);
		const second = await api.getProjectsForResourcesWithMetadataResult([orgOk, orgBad]);

		// r1 was cached after the first (successful) read, so only the failed r2 is retried on the second call.
		assert.deepEqual(requested[1], ['r2'], 'only the previously-failed resource is retried');
		assert.deepEqual(
			second.value?.values.map(p => p.id).sort(),
			['p1', 'p2'],
			'the retried resource now contributes its project alongside the cached one',
		);

		manager.dispose();
	});

	test('a proven-empty resource is cached and does not refetch', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		let calls = 0;
		stubApi(jira, {
			getJiraProjectsForResources: (_t: unknown, _resourceIds: string[]) => {
				calls++;
				// r1 completes successfully but genuinely has no projects.
				return Promise.resolve({ values: [], metadata: { completeness: 'complete' } });
			},
		});

		const api = jira as unknown as {
			getProjectsForResourcesWithMetadataResult: (resources: unknown[]) => Promise<unknown>;
		};

		await api.getProjectsForResourcesWithMetadataResult([orgOk]);
		await api.getProjectsForResourcesWithMetadataResult([orgOk]);

		assert.equal(calls, 1, 'a proven-empty resource is cached and not refetched');

		manager.dispose();
	});

	test('a failed forced refresh does not erase an older valid cache entry', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		let attempt = 0;
		stubApi(jira, {
			getJiraProjectsForResources: (_t: unknown, _resourceIds: string[]) => {
				attempt++;
				if (attempt === 1) {
					return Promise.resolve({
						values: [jiraProject('p1', 'r1')],
						metadata: { completeness: 'complete' },
					});
				}
				// Forced refresh fails for r1.
				return Promise.resolve({
					values: [],
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'rate-limit', scope: { resourceId: 'r1' } }],
					},
				});
			},
		});

		const withMetadata = jira as unknown as {
			getProviderProjectsForResourcesWithMetadata: (
				session: ProviderAuthenticationSession,
				resources: unknown[],
				force?: boolean,
			) => Promise<{ values: { id: string }[]; metadata?: { failures?: unknown[] } }>;
		};

		await withMetadata.getProviderProjectsForResourcesWithMetadata(jiraSession(), [orgOk], false);
		const refreshed = await withMetadata.getProviderProjectsForResourcesWithMetadata(jiraSession(), [orgOk], true);

		// The forced refresh failed, but the older valid cache entry for r1 must survive so the caller still sees
		// its project — while the refresh failure remains visible in the returned metadata.
		assert.deepEqual(
			refreshed.values.map(p => p.id),
			['p1'],
			'the previously cached project is preserved through a failed refresh',
		);
		assert.equal(refreshed.metadata?.failures?.length, 1, 'the refresh failure is still surfaced to the caller');

		manager.dispose();
	});

	test('a no-failure fan-out behaves exactly as before (all projects, no metadata failures)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		stubApi(jira, {
			getJiraProjectsForResources: () =>
				Promise.resolve({
					values: [jiraProject('p1', 'r1'), jiraProject('p2', 'r2')],
					metadata: { completeness: 'complete' },
				}),
		});

		const result = await (
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: (
					resources: unknown[],
				) => Promise<{ value?: { values: { id: string }[]; metadata?: { failures?: unknown[] } } }>;
			}
		).getProjectsForResourcesWithMetadataResult([orgOk, orgBad]);

		assert.deepEqual(result.value?.values.map(p => p.id).sort(), ['p1', 'p2']);
		assert.equal(result.value?.metadata?.failures, undefined, 'no failures on a clean fan-out');

		manager.dispose();
	});

	test('a mixed-success filter fan-out keeps the surviving branch and flags truncation (#5438)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

		// Two filter branches: the assignee read succeeds, the author read rejects. The surviving branch's
		// issues must be preserved and the result flagged `truncated` (an incomplete read), NOT returned as a
		// complete "these are all your issues" list.
		stubApi(jira, {
			getIssuesForProjectPaged: (
				_t: unknown,
				_name: string,
				_resourceId: string,
				options?: { authorLogin?: string; assigneeLogins?: string[] },
			) => {
				if (options?.authorLogin != null) return Promise.reject(new Error('author branch boom'));
				return Promise.resolve({
					data: [
						{
							id: 'i1',
							number: '1',
							title: 'Assigned issue',
							url: 'https://atlassian.net/i/1',
							createdDate: new Date(0),
							updatedDate: new Date(0),
							closedDate: null,
							author: { id: 'a', name: 'A', avatarUrl: null, url: null },
							assignees: [],
							labels: [],
						},
					],
					hasMore: false,
					nextCursor: undefined,
				});
			},
		});

		const result = await jira.getIssuesForProjectWithTruncationResult(project, {
			user: 'me',
			filters: [IssueFilter.Assignee, IssueFilter.Author],
		});

		assert.equal(result?.value?.values.length, 1, 'the surviving assignee branch is preserved');
		assert.equal(result?.value?.truncated, true, 'a rejected sibling branch flags the read as truncated');
		assert.equal(result?.error, undefined, 'a partial success is not surfaced as a hard error');

		manager.dispose();
	});
});
