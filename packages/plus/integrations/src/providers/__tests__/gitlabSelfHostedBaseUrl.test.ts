import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { GitSelfManagedHostIntegrationId } from '../../constants.js';
import { createIntegrationManager } from '../../index.js';

async function seedGitLabConnection(
	runtime: ReturnType<typeof createFakeRuntime>,
	tokenId: string,
	token: string,
	domain: string,
) {
	await runtime.storage.storeSecret(
		`integration.auth.cloud:${GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted}|${tokenId}`,
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
	fnNames: string[],
	captured: { baseUrl?: string; called: boolean },
): Promise<void> {
	const api = await (
		integration as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
	).getProvidersApi();
	const provider = api.providers[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted] as CapturingProvider;

	for (const fnName of fnNames) {
		provider[fnName] = (_input, options) => {
			captured.called = true;
			captured.baseUrl = options?.baseUrl;
			return Promise.resolve({ data: [], pageInfo: undefined });
		};
	}
}

suite('GitLab self-hosted repo-scoped baseUrl (#5526)', () => {
	test('getMyIssuesForRepos strips a stored /api suffix from the domain before forwarding to provider-apis', async () => {
		const runtime = createFakeRuntime();
		await seedGitLabConnection(runtime, 'sec-tok', 'token-secondary', 'https://gitlab.example.com/api');
		const manager = createIntegrationManager(runtime);
		try {
			const gl = await manager.get(
				GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
				'https://gitlab.example.com/api',
			);
			assert.ok(gl != null, 'GitLab self-hosted integration resolves');

			const captured = { baseUrl: undefined as string | undefined, called: false };
			await captureBaseUrl(gl, ['getIssuesForReposFn', 'getIssuesForRepoFn'], captured);

			await (
				gl as unknown as {
					getMyIssuesForRepos: (
						repos: { namespace: string; name: string }[],
						options: undefined,
						connectionId: string,
					) => Promise<unknown>;
				}
			).getMyIssuesForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

			assert.equal(captured.called, true, 'the repo-scoped issue read reached provider-apis');
			assert.equal(captured.baseUrl, 'https://gitlab.example.com', 'bare /api suffix is stripped');
		} finally {
			manager.dispose();
		}
	});

	test('getMyIssuesForRepos strips a stored /api/v4 suffix from the domain before forwarding to provider-apis', async () => {
		const runtime = createFakeRuntime();
		await seedGitLabConnection(runtime, 'sec-tok', 'token-secondary', 'https://gitlab.example.com/api/v4');
		const manager = createIntegrationManager(runtime);
		try {
			const gl = await manager.get(
				GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
				'https://gitlab.example.com/api/v4',
			);
			assert.ok(gl != null, 'GitLab self-hosted integration resolves');

			const captured = { baseUrl: undefined as string | undefined, called: false };
			await captureBaseUrl(gl, ['getIssuesForReposFn', 'getIssuesForRepoFn'], captured);

			await (
				gl as unknown as {
					getMyIssuesForRepos: (
						repos: { namespace: string; name: string }[],
						options: undefined,
						connectionId: string,
					) => Promise<unknown>;
				}
			).getMyIssuesForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

			assert.equal(captured.called, true, 'the repo-scoped issue read reached provider-apis');
			assert.equal(captured.baseUrl, 'https://gitlab.example.com', '/api/v4 suffix is stripped');
		} finally {
			manager.dispose();
		}
	});

	test('getMyIssuesForRepos forwards the self-hosted instance baseUrl to provider-apis', async () => {
		const runtime = createFakeRuntime();
		await seedGitLabConnection(runtime, 'sec-tok', 'token-secondary', 'gitlab.example.com');
		const manager = createIntegrationManager(runtime);
		try {
			const gl = await manager.get(GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'gitlab.example.com');
			assert.ok(gl != null, 'GitLab self-hosted integration resolves');

			const captured = { baseUrl: undefined as string | undefined, called: false };
			await captureBaseUrl(gl, ['getIssuesForReposFn', 'getIssuesForRepoFn'], captured);

			await (
				gl as unknown as {
					getMyIssuesForRepos: (
						repos: { namespace: string; name: string }[],
						options: undefined,
						connectionId: string,
					) => Promise<unknown>;
				}
			).getMyIssuesForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

			assert.equal(captured.called, true, 'the repo-scoped issue read reached provider-apis');
			assert.equal(captured.baseUrl, 'https://gitlab.example.com');
		} finally {
			manager.dispose();
		}
	});

	test('getMyPullRequestsForRepos forwards the self-hosted instance baseUrl to provider-apis', async () => {
		const runtime = createFakeRuntime();
		await seedGitLabConnection(runtime, 'sec-tok', 'token-secondary', 'gitlab.example.com');
		const manager = createIntegrationManager(runtime);
		try {
			const gl = await manager.get(GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'gitlab.example.com');
			assert.ok(gl != null, 'GitLab self-hosted integration resolves');

			const captured = { baseUrl: undefined as string | undefined, called: false };
			await captureBaseUrl(gl, ['getPullRequestsForReposFn', 'getPullRequestsForRepoFn'], captured);

			await (
				gl as unknown as {
					getMyPullRequestsForRepos: (
						repos: { namespace: string; name: string }[],
						options: undefined,
						connectionId: string,
					) => Promise<unknown>;
				}
			).getMyPullRequestsForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

			assert.equal(captured.called, true, 'the repo-scoped PR read reached provider-apis');
			assert.equal(captured.baseUrl, 'https://gitlab.example.com');
		} finally {
			manager.dispose();
		}
	});
});
