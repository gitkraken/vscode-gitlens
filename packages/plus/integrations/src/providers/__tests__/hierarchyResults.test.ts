import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { Emitter } from '@gitlens/utils/event.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import type { ProviderAuthenticationSession } from '../../authentication/models.js';
import { AzureDevOpsIntegration } from '../azureDevOps.js';
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

		assert.deepEqual(result, { values: [{ id: '1', name: 'acme', url: 'https://github.com/acme' }] });
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
			values: [{ id: '1', name: 'acme/platform', url: 'https://gitlab.com/acme/platform' }],
		});
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
		(integration as any).getProviderProjectsForResources = async () => [
			{ id: 'project-a', name: 'project-a', resourceId: 'org-1', resourceName: 'acme', key: 'project-a' },
			{ id: 'project-b', name: 'project-b', resourceId: 'org-1', resourceName: 'acme', key: 'project-b' },
		];

		const result = await integration.getRepositoriesForOrg('acme');

		assert.equal(result?.truncated, true);
		assert.equal(result?.paging, undefined);
		assert.equal(result?.values.length, 21);
		assert.equal(result?.values[0].id, 'a-1');
	});
});
