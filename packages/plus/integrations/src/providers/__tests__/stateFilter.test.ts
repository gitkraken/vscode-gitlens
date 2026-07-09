import * as assert from 'node:assert/strict';
import { GitIssueState, GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationManager } from '../../index.js';

/**
 * Covers the open/closed/merged state selector (#5435) on the paginated read path: a PullRequestStateFilter /
 * IssueStateFilter must map to the SDK `states` input (open-only preserved when omitted).
 */
async function seedGitHubConnection(runtime: ReturnType<typeof createFakeRuntime>, tokenId: string, token: string) {
	await runtime.storage.storeSecret(
		`integration.auth.cloud:github|${tokenId}`,
		JSON.stringify({
			id: tokenId,
			accessToken: token,
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
		}),
	);
}

type CapturingProvider = Record<string, (input: unknown, options?: { token?: string }) => Promise<unknown>>;

async function captureInput(
	gh: Awaited<ReturnType<ReturnType<typeof createIntegrationManager>['get']>>,
	fnName: string,
	captured: { input?: Record<string, unknown> },
): Promise<void> {
	const api = await (
		gh as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
	).getProvidersApi();
	(api.providers.github as CapturingProvider)[fnName] = input => {
		captured.input = input as Record<string, unknown>;
		return Promise.resolve({ data: [], pageInfo: undefined });
	};
}

suite('PR/issue state selector (#5435)', () => {
	test('getMyPullRequestsForRepos maps state=closed to the SDK states input', async () => {
		const runtime = createFakeRuntime();
		await seedGitHubConnection(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured: { input?: Record<string, unknown> } = {};
		await captureInput(gh, 'getPullRequestsForReposFn', captured);

		await (
			gh as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: { state: 'closed' },
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyPullRequestsForRepos([{ namespace: 'octo', name: 'repo' }], { state: 'closed' }, 'sec-tok');

		assert.deepEqual(captured.input?.states, [GitPullRequestState.Closed]);
	});

	test('getMyPullRequestsForRepos leaves states undefined when no state is requested', async () => {
		const runtime = createFakeRuntime();
		await seedGitHubConnection(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured: { input?: Record<string, unknown> } = {};
		await captureInput(gh, 'getPullRequestsForReposFn', captured);

		await (
			gh as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: undefined,
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyPullRequestsForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

		assert.equal(captured.input?.states, undefined, 'omitted state preserves the open-only default');
	});

	test('getMyIssuesForRepos maps state=all to the SDK issue states input', async () => {
		const runtime = createFakeRuntime();
		await seedGitHubConnection(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured: { input?: Record<string, unknown> } = {};
		await captureInput(gh, 'getIssuesForReposFn', captured);

		await (
			gh as unknown as {
				getMyIssuesForRepos: (
					repos: { namespace: string; name: string }[],
					options: { state: 'all' },
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyIssuesForRepos([{ namespace: 'octo', name: 'repo' }], { state: 'all' }, 'sec-tok');

		assert.deepEqual(captured.input?.states, [GitIssueState.Open, GitIssueState.Closed]);
	});
});
