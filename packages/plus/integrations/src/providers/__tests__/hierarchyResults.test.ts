import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { md5 } from '@gitlens/utils/crypto.js';
import { Emitter } from '@gitlens/utils/event.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import type { ProviderAuthenticationSession } from '../../authentication/models.js';
import { AzureDevOpsIntegration } from '../azureDevOps.js';
import { BitbucketIntegration } from '../bitbucket.js';
import { GitHubIntegration } from '../github.js';
import { GitLabIntegration } from '../gitlab.js';

function createSession(domain: string): ProviderAuthenticationSession {
	return {
		id: 'session-id',
		accessToken: 'token',
		account: { id: 'account-id', label: 'Test User' },
		scopes: [],
		cloud: true,
		type: undefined,
		domain: domain,
		expiresAt: new Date(Date.now() + 60_000),
	};
}

function setSession(integration: object, session: ProviderAuthenticationSession): void {
	(integration as { _session: ProviderAuthenticationSession })._session = session;
}

suite('provider hierarchy results', () => {
	test('GitHub organization listing returns normalized organizations', async () => {
		const api: {
			getGitHubOrgsForCurrentUser: () => Promise<{ values: { id: string; username: string }[] }>;
		} = {
			getGitHubOrgsForCurrentUser: async () => ({ values: [{ id: '1', username: 'acme' }] }),
		};
		const integration = new GitHubIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('github.com'));

		const result = await integration.getOrganizationsForUser();

		assert.deepEqual(result, {
			values: [{ id: '1', providerId: 'github', name: 'acme', url: 'https://github.com/acme' }],
		});
	});

	test('GitHub organization listing propagates truncation', async () => {
		const api: {
			getGitHubOrgsForCurrentUser: () => Promise<{
				values: { id: string; username: string }[];
				truncated?: boolean;
			}>;
		} = {
			getGitHubOrgsForCurrentUser: async () => ({ values: [{ id: '1', username: 'acme' }], truncated: true }),
		};
		const integration = new GitHubIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('github.com'));

		const result = await integration.getOrganizationsForUser();

		assert.equal(result?.truncated, true);
		assert.equal(result?.values.length, 1);
	});

	test('GitHub organization listing preserves page-1 values and metadata when page 2 fails', async () => {
		const api = {
			getGitHubOrgsForCurrentUser: async () => ({
				values: [{ id: '1', username: 'acme' }],
				truncated: true,
				metadata: {
					completeness: 'partial' as const,
					failures: [
						{
							kind: 'provider' as const,
							scope: { providerId: 'github' },
							message: 'page 2 unavailable',
						},
					],
				},
			}),
		};
		const integration = new GitHubIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('github.com'));

		const result = await integration.getOrganizationsForUser();

		assert.deepEqual(
			result?.values.map(org => org.name),
			['acme'],
		);
		assert.equal(result?.truncated, true);
		assert.equal(result?.metadata?.completeness, 'partial');
		assert.equal(result?.metadata?.failures?.[0]?.scope?.providerId, 'github');
	});

	test('GitLab organization listing returns normalized organizations', async () => {
		const api: {
			getGitlabGroupsForCurrentUser: () => Promise<{
				values: { id: string; fullPath: string; webUrl: string }[];
			}>;
		} = {
			getGitlabGroupsForCurrentUser: async () => ({
				values: [{ id: '1', fullPath: 'acme/platform', webUrl: 'https://gitlab.com/acme/platform' }],
			}),
		};
		const integration = new GitLabIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('gitlab.com'));

		const result = await integration.getOrganizationsForUser();

		assert.deepEqual(result, {
			values: [{ id: '1', providerId: 'gitlab', name: 'acme/platform', url: 'https://gitlab.com/acme/platform' }],
		});
	});

	test('GitLab organization listing propagates truncation', async () => {
		const api: {
			getGitlabGroupsForCurrentUser: () => Promise<{
				values: { id: string; fullPath: string; webUrl: string }[];
				truncated?: boolean;
			}>;
		} = {
			getGitlabGroupsForCurrentUser: async () => ({
				values: [{ id: '1', fullPath: 'acme/platform', webUrl: 'https://gitlab.com/acme/platform' }],
				truncated: true,
			}),
		};
		const integration = new GitLabIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('gitlab.com'));

		const result = await integration.getOrganizationsForUser();

		assert.equal(result?.truncated, true);
		assert.equal(result?.values.length, 1);
	});

	test('GitLab organization listing preserves page-1 values and metadata when page 2 fails', async () => {
		const api = {
			getGitlabGroupsForCurrentUser: async () => ({
				values: [{ id: '1', fullPath: 'acme/platform', webUrl: 'https://gitlab.com/acme/platform' }],
				truncated: true,
				metadata: {
					completeness: 'partial' as const,
					failures: [
						{
							kind: 'provider' as const,
							scope: { providerId: 'gitlab' },
							message: 'page 2 unavailable',
						},
					],
				},
			}),
		};
		const integration = new GitLabIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('gitlab.com'));

		const result = await integration.getOrganizationsForUser();

		assert.deepEqual(
			result?.values.map(org => org.name),
			['acme/platform'],
		);
		assert.equal(result?.truncated, true);
		assert.equal(result?.metadata?.completeness, 'partial');
		assert.equal(result?.metadata?.failures?.[0]?.scope?.providerId, 'gitlab');
	});

	test('Bitbucket workspace discovery preserves a partial prefix and retries it on the next read', async () => {
		let calls = 0;
		const api = {
			getBitbucketResourcesForCurrentUser: async () => {
				calls++;
				return calls === 1
					? {
							values: [{ id: 'ws-1', slug: 'workspace-1', name: 'Workspace 1' }],
							metadata: {
								completeness: 'partial' as const,
								failures: [
									{
										kind: 'provider' as const,
										scope: { providerId: 'bitbucket' },
										message: 'page 2 unavailable',
									},
								],
							},
						}
					: {
							values: [
								{ id: 'ws-1', slug: 'workspace-1', name: 'Workspace 1' },
								{ id: 'ws-2', slug: 'workspace-2', name: 'Workspace 2' },
							],
						};
			},
		};
		const integration = new BitbucketIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('bitbucket.org'));

		const first = await integration.getOrganizationsForUser();
		const second = await integration.getOrganizationsForUser();

		assert.deepEqual(
			first?.values.map(org => org.name),
			['workspace-1'],
		);
		assert.equal(first?.metadata?.completeness, 'partial');
		assert.deepEqual(
			second?.values.map(org => org.name),
			['workspace-1', 'workspace-2'],
		);
		assert.equal(second?.metadata, undefined);
		assert.equal(calls, 2, 'the partial prefix was not cached as complete');
	});

	test('Azure project discovery does not cache terminal pages with incomplete metadata', async () => {
		let calls = 0;
		const api = {
			getAzureProjectsForResource: async () => {
				calls++;
				return {
					values: [{ id: `p-${calls}`, name: `Project ${calls}`, namespace: 'acme' }],
					metadata: { completeness: calls === 1 ? ('partial' as const) : ('complete' as const) },
				};
			},
		};
		const integration = new AzureDevOpsIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('dev.azure.com'));
		const resource = { id: 'org-1', name: 'acme', key: 'org-1' };
		const target = integration as unknown as {
			getProviderProjectsForResources(
				session: ProviderAuthenticationSession,
				resources: unknown[],
			): Promise<{ values: { id: string }[] }>;
		};

		const first = await target.getProviderProjectsForResources(createSession('dev.azure.com'), [resource]);
		const second = await target.getProviderProjectsForResources(createSession('dev.azure.com'), [resource]);

		assert.deepEqual(
			first.values.map(project => project.id),
			['p-1'],
		);
		assert.deepEqual(
			second.values.map(project => project.id),
			['p-2'],
		);
		assert.equal(calls, 2, 'the metadata-incomplete first result was retried');
	});

	test('Azure forced partial project discovery does not duplicate the preserved cache', async () => {
		let calls = 0;
		const api = {
			getAzureProjectsForResource: async () => {
				calls++;
				return {
					values: [
						{
							id: calls === 3 ? 'p-2' : 'p-1',
							name: calls === 3 ? 'Project 2' : 'Project 1',
							namespace: 'acme',
						},
					],
					metadata: { completeness: calls === 2 ? ('partial' as const) : ('complete' as const) },
				};
			},
		};
		const integration = new AzureDevOpsIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('dev.azure.com'));
		const resource = { id: 'org-1', name: 'acme', key: 'org-1' };
		const target = integration as unknown as {
			getProviderProjectsForResources(
				session: ProviderAuthenticationSession,
				resources: unknown[],
				force?: boolean,
			): Promise<{ values: { id: string }[] }>;
		};

		await target.getProviderProjectsForResources(createSession('dev.azure.com'), [resource]);
		const partial = await target.getProviderProjectsForResources(createSession('dev.azure.com'), [resource], true);
		const recovered = await target.getProviderProjectsForResources(
			createSession('dev.azure.com'),
			[resource],
			true,
		);

		assert.deepEqual(
			partial.values.map(project => project.id),
			['p-1'],
		);
		assert.deepEqual(
			recovered.values.map(project => project.id),
			['p-2'],
		);
		assert.equal(calls, 3, 'the incomplete forced refresh did not become authoritative');
	});

	test('Azure cross-project repo listing reports truncation without exposing paging', async () => {
		const api: {
			getReposForAzureProject: (
				_token: unknown,
				_org: string,
				project: string,
				options?: { cursor?: string },
			) => Promise<{ values: { id: string; name: string }[]; paging?: { cursor: string; more: boolean } }>;
		} = {
			getReposForAzureProject: async (_token, _org, project, options) => {
				if (project === 'project-a') return { values: [{ id: 'a-1', name: 'repo-a' }] };

				const page = options?.cursor == null ? 0 : Number(options.cursor);
				return {
					values: [{ id: `b-${page}`, name: `repo-b-${page}` }],
					paging: { cursor: String(page + 1), more: true },
				};
			},
		};
		const integration = new AzureDevOpsIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('dev.azure.com'));
		(integration as any).getProviderResourcesForUser = async () => [{ id: 'org-1', name: 'acme' }];
		(integration as any).getProviderProjectsForResources = async () => ({
			values: [
				{ id: 'project-a', name: 'project-a', resourceId: 'org-1', resourceName: 'acme', key: 'project-a' },
				{ id: 'project-b', name: 'project-b', resourceId: 'org-1', resourceName: 'acme', key: 'project-b' },
			],
		});

		const result = await integration.getRepositoriesForOrg('acme');

		assert.equal(result?.truncated, true);
		assert.equal(result?.paging, undefined);
		assert.equal(result?.values.length, 21);
		assert.equal(result?.values[0].id, 'a-1');
	});

	test('Azure cross-project repo listing does not report truncation on a clean drain (#5438)', async () => {
		// Every project drains a single page and the Azure SDK supplies no collection metadata, so the merged
		// metadata is undefined. `truncated` must stay unset — a guard regression that evaluated
		// `undefined !== 'complete'` would mis-signal a complete repo list as truncated.
		const api: {
			getReposForAzureProject: (
				_token: unknown,
				_org: string,
				project: string,
			) => Promise<{ values: { id: string; name: string }[]; paging?: { cursor: string; more: boolean } }>;
		} = {
			getReposForAzureProject: async (_token, _org, project) => ({
				values: [{ id: `${project}-1`, name: `repo-${project}` }],
			}),
		};
		const integration = new AzureDevOpsIntegration(
			createFakeRuntime(),
			{} as never,
			async () => api as never,
			new Emitter(),
		);
		setSession(integration, createSession('dev.azure.com'));
		(integration as any).getProviderResourcesForUser = async () => [{ id: 'org-1', name: 'acme' }];
		(integration as any).getProviderProjectsForResources = async () => ({
			values: [
				{ id: 'project-a', name: 'project-a', resourceId: 'org-1', resourceName: 'acme', key: 'project-a' },
				{ id: 'project-b', name: 'project-b', resourceId: 'org-1', resourceName: 'acme', key: 'project-b' },
			],
		});

		const result = await integration.getRepositoriesForOrg('acme');

		assert.equal(result?.truncated, undefined, 'a clean drain with no metadata is not truncated');
		assert.equal(result?.metadata, undefined, 'no metadata is synthesized on a clean drain');
		assert.equal(result?.values.length, 2);
	});

	test('Azure providerOnConnect ignores legacy stored project arrays and rewrites complete discovery (#5438)', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('azure:token:account', { v: 1, timestamp: 0, data: { id: 'a1' } });
		await runtime.storage.store('azure:token:organizations', {
			v: 1,
			timestamp: 0,
			data: [{ id: 'org-1', name: 'acme' }],
		});
		await runtime.storage.store('azure:token:projects', {
			v: 1,
			timestamp: 0,
			data: [{ id: 'stale', name: 'stale', resourceId: 'org-1', resourceName: 'acme', key: 'stale' }],
		});

		const integration = new AzureDevOpsIntegration(
			runtime,
			{} as never,
			async () => undefined as never,
			new Emitter(),
		);
		setSession(integration, createSession('dev.azure.com'));
		let calls = 0;
		(integration as any).getProviderProjectsForResources = async () => {
			calls++;
			return {
				values: [{ id: 'fresh', name: 'fresh', resourceId: 'org-1', resourceName: 'acme', key: 'fresh' }],
				metadata: { completeness: 'complete' },
			};
		};

		await (integration as any).providerOnConnect();

		assert.equal(calls, 1, 'legacy stored arrays are ignored and discovery is retried');
		assert.deepEqual(
			(integration as any)._projects.get('token:org-1')?.map((p: { id: string }) => p.id),
			['fresh'],
		);
		assert.deepEqual(
			(runtime.storage.get('azure:token:projects') as { data: { values: { id: string }[] } }).data.values.map(
				p => p.id,
			),
			['fresh'],
			'complete discovery is rewritten in the metadata-aware storage shape',
		);
	});

	test('Azure providerOnConnect does not hydrate or persist partial project discovery (#5438)', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('azure:token:account', { v: 1, timestamp: 0, data: { id: 'a1' } });
		await runtime.storage.store('azure:token:organizations', {
			v: 1,
			timestamp: 0,
			data: [{ id: 'org-1', name: 'acme' }],
		});

		const integration = new AzureDevOpsIntegration(
			runtime,
			{} as never,
			async () => undefined as never,
			new Emitter(),
		);
		setSession(integration, createSession('dev.azure.com'));
		(integration as any).getProviderProjectsForResources = async () => ({
			values: [{ id: 'partial', name: 'partial', resourceId: 'org-1', resourceName: 'acme', key: 'partial' }],
			metadata: { completeness: 'partial' },
		});

		await (integration as any).providerOnConnect();

		assert.equal(
			(integration as any)._projects.get('token:org-1'),
			undefined,
			'partial discovery is not cached as complete',
		);
		assert.equal(
			runtime.storage.get('azure:token:projects'),
			undefined,
			'partial discovery is not persisted as complete',
		);
	});

	test('Bitbucket providerOnConnect does not cache or persist partial workspace discovery (#5438)', async () => {
		const runtime = createFakeRuntime();
		const storageKey = `bitbucket:${md5('token')}:workspaces`;
		await runtime.storage.store(`bitbucket:${md5('token')}:account`, { v: 1, timestamp: 0, data: { id: 'b1' } });

		const integration = new BitbucketIntegration(
			runtime,
			{} as never,
			async () => undefined as never,
			new Emitter(),
		);
		setSession(integration, createSession('bitbucket.org'));
		(integration as any).getProviderResourcesForCurrentUser = async () => ({
			values: [{ id: 'ws-1', key: 'ws-1', slug: 'acme', name: 'Acme' }],
			metadata: { completeness: 'partial' },
		});

		await (integration as any).providerOnConnect();

		assert.equal(
			(integration as any)._workspaces?.get('token'),
			undefined,
			'a partial workspace prefix is retried rather than becoming authoritative memory state',
		);
		assert.equal(
			runtime.storage.get(storageKey),
			undefined,
			'a partial workspace prefix is not persisted as authoritative state',
		);
	});
});
