import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { GitSelfManagedHostIntegrationId } from '../../constants.js';
import { createIntegrationManager } from '../../index.js';

async function seedConnection(
	runtime: ReturnType<typeof createFakeRuntime>,
	integrationId: GitSelfManagedHostIntegrationId,
	tokenId: string,
	token: string,
	domain: string,
) {
	await runtime.storage.storeSecret(
		`integration.auth.cloud:${integrationId}|${tokenId}`,
		JSON.stringify({
			id: tokenId,
			accessToken: token,
			scopes: ['api'],
			cloud: true,
			type: 'oauth',
			domain: domain,
		}),
	);
}

type CapturingProvider = Record<
	string,
	(input: unknown, options?: { token?: string; baseUrl?: string }) => Promise<unknown>
>;

async function captureBaseUrl(
	integration: Awaited<ReturnType<ReturnType<typeof createIntegrationManager>['get']>>,
	integrationId: GitSelfManagedHostIntegrationId,
	fnNames: string[],
	captured: { baseUrl?: string; called: boolean },
): Promise<void> {
	const api = await (
		integration as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
	).getProvidersApi();
	const provider = api.providers[integrationId] as CapturingProvider;

	for (const fnName of fnNames) {
		provider[fnName] = (_input, options) => {
			captured.called = true;
			captured.baseUrl = options?.baseUrl;
			return Promise.resolve({ data: [], pageInfo: undefined });
		};
	}
}

suite('Self-hosted repo-scoped baseUrl (#5526)', () => {
	test('GitHub Enterprise: strips /api and appends /api/v3', async () => {
		const runtime = createFakeRuntime();
		const domain = 'https://ghe.example.com/api';
		const integrationId = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
		await seedConnection(runtime, integrationId, 'ghe-tok', 'token', domain);
		const manager = createIntegrationManager(runtime);

		try {
			const ghe = await manager.get(integrationId, domain);
			assert.ok(ghe != null, 'GHE integration resolves');

			const captured = { baseUrl: undefined as string | undefined, called: false };
			await captureBaseUrl(ghe, integrationId, ['getIssuesForReposFn'], captured);

			await (ghe as any).getMyIssuesForRepos([{ namespace: 'org', name: 'repo' }], undefined, 'ghe-tok');

			assert.equal(captured.called, true);
			assert.equal(captured.baseUrl, 'https://ghe.example.com/api/v3');
		} finally {
			manager.dispose();
		}
	});

	test('Bitbucket Server: de-dupes /rest/api/1.0', async () => {
		const runtime = createFakeRuntime();
		const domain = 'https://bitbucket.example.com/rest/api/1.0';
		const integrationId = GitSelfManagedHostIntegrationId.BitbucketServer;
		await seedConnection(runtime, integrationId, 'bb-tok', 'token', domain);
		const manager = createIntegrationManager(runtime);

		try {
			const bb = await manager.get(integrationId, domain);
			assert.ok(bb != null, 'Bitbucket integration resolves');

			const captured = { baseUrl: undefined as string | undefined, called: false };
			await captureBaseUrl(bb, integrationId, ['getPullRequestsForReposFn'], captured);

			await (bb as any).getMyPullRequestsForRepos([{ namespace: 'proj', name: 'repo' }], undefined, 'bb-tok');

			assert.equal(captured.called, true);
			assert.equal(captured.baseUrl, 'https://bitbucket.example.com/rest/api/1.0');
		} finally {
			manager.dispose();
		}
	});

	test('Bitbucket Server: handles subpath with /rest/api/1.0', async () => {
		const runtime = createFakeRuntime();
		const domain = 'https://host/bitbucket/rest/api/1.0';
		const integrationId = GitSelfManagedHostIntegrationId.BitbucketServer;
		await seedConnection(runtime, integrationId, 'bb-tok', 'token', domain);
		const manager = createIntegrationManager(runtime);

		try {
			const bb = await manager.get(integrationId, domain);
			assert.ok(bb != null, 'Bitbucket integration resolves');

			const captured = { baseUrl: undefined as string | undefined, called: false };
			await captureBaseUrl(bb, integrationId, ['getPullRequestsForReposFn'], captured);

			await (bb as any).getMyPullRequestsForRepos([{ namespace: 'proj', name: 'repo' }], undefined, 'bb-tok');

			assert.equal(captured.called, true);
			assert.equal(captured.baseUrl, 'https://host/bitbucket/rest/api/1.0');
		} finally {
			manager.dispose();
		}
	});
});
