import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationManager } from '../../index.js';
import { IssueFilter, PullRequestFilter } from '../models.js';

/**
 * Covers the reviewer/assignee filter routing (#5435): the "review requested from me" filter must reach the
 * field each provider actually reads (reviewRequestedLogin for GitHub/GitLab, reviewerId for Bitbucket/Azure),
 * and includeAllAssignees must drop the current-user assignee constraint on issue reads.
 */
async function seedConnection(
	runtime: ReturnType<typeof createFakeRuntime>,
	provider: string,
	domain: string,
	tokenId: string,
	token: string,
) {
	await runtime.storage.storeSecret(
		`integration.auth.cloud:${provider}|${tokenId}`,
		JSON.stringify({
			id: tokenId,
			accessToken: token,
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: domain,
		}),
	);
}

type CapturingProvider = Record<string, (input: unknown, options?: { token?: string }) => Promise<unknown>>;

async function stubProvider(
	gh: Awaited<ReturnType<ReturnType<typeof createIntegrationManager>['get']>>,
	providerKey: string,
	account: { id: string; username: string },
	listFnNames: string[],
	captured: { input?: Record<string, unknown> },
): Promise<void> {
	const api = await (
		gh as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
	).getProvidersApi();
	const provider = api.providers[providerKey] as CapturingProvider;
	provider.getCurrentUserFn = () => Promise.resolve({ data: account });
	for (const fnName of listFnNames) {
		provider[fnName] = input => {
			captured.input = input as Record<string, unknown>;
			return Promise.resolve({ data: [], pageInfo: undefined });
		};
	}
}

suite('PR/issue filter routing (#5435)', () => {
	test('Bitbucket review-requested filter is keyed by account id (reviewerId), not reviewRequestedLogin', async () => {
		const runtime = createFakeRuntime();
		await seedConnection(runtime, 'bitbucket', 'bitbucket.org', 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);

		const captured: { input?: Record<string, unknown> } = {};
		await stubProvider(
			bb,
			'bitbucket',
			{ id: 'acc-uuid', username: 'octo' },
			['getPullRequestsForRepoFn', 'getPullRequestsForReposFn'],
			captured,
		);

		await (
			bb as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: { filters: PullRequestFilter[] },
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyPullRequestsForRepos(
			[{ namespace: 'octo', name: 'repo' }],
			{ filters: [PullRequestFilter.ReviewRequested] },
			'sec-tok',
		);

		assert.equal(captured.input?.reviewerId, 'acc-uuid', 'reviewer filter keyed by account id');
		assert.equal(captured.input?.reviewRequestedLogin, undefined, 'login field not used for Bitbucket');

		manager.dispose();
	});

	test('GitHub review-requested filter is keyed by login (reviewRequestedLogin)', async () => {
		const runtime = createFakeRuntime();
		await seedConnection(runtime, 'github', 'github.com', 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured: { input?: Record<string, unknown> } = {};
		await stubProvider(
			gh,
			'github',
			{ id: 'acc-id', username: 'octocat' },
			['getPullRequestsForReposFn'],
			captured,
		);

		await (
			gh as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: { filters: PullRequestFilter[] },
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyPullRequestsForRepos(
			[{ namespace: 'octo', name: 'repo' }],
			{ filters: [PullRequestFilter.ReviewRequested] },
			'sec-tok',
		);

		assert.equal(captured.input?.reviewRequestedLogin, 'octocat', 'reviewer filter keyed by login');
		assert.equal(captured.input?.reviewerId, undefined, 'account-id field not used for GitHub');

		manager.dispose();
	});

	test('includeAllAssignees drops the current-user assignee constraint on issue reads', async () => {
		const runtime = createFakeRuntime();
		await seedConnection(runtime, 'github', 'github.com', 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured: { input?: Record<string, unknown> } = {};
		await stubProvider(gh, 'github', { id: 'acc-id', username: 'octocat' }, ['getIssuesForReposFn'], captured);

		await (
			gh as unknown as {
				getMyIssuesForRepos: (
					repos: { namespace: string; name: string }[],
					options: { filters: IssueFilter[]; includeAllAssignees: boolean },
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyIssuesForRepos(
			[{ namespace: 'octo', name: 'repo' }],
			{ filters: [IssueFilter.Assignee], includeAllAssignees: true },
			'sec-tok',
		);

		assert.equal(captured.input?.assigneeLogins, undefined, 'assignee constraint suppressed');

		manager.dispose();
	});
});
