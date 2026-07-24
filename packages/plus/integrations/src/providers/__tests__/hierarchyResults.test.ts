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

	test('Bitbucket providerOnConnect preserves workspace metadata in cache and storage (#5438)', async () => {
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

		assert.equal((integration as any)._workspaces.get('token')?.metadata?.completeness, 'partial');
		assert.equal(
			(runtime.storage.get(storageKey) as { data: { metadata?: { completeness: string } } }).data.metadata
				?.completeness,
			'partial',
			'the persisted workspace cache keeps the partial metadata',
		);
	});
});
