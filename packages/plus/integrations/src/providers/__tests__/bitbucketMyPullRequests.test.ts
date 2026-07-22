import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationManager } from '../../index.js';

async function seedBitbucketPrimaryConnection(runtime: ReturnType<typeof createFakeRuntime>) {
	await runtime.storage.store('integrations:configured', {
		bitbucket: [
			{ id: 'bb-primary', cloud: true, integrationId: 'bitbucket', scopes: 'pullrequest:read', primary: true },
		],
	});
	await runtime.storage.storeSecret(
		'integration.auth.cloud:bitbucket|bb-primary',
		JSON.stringify({
			id: 'bb-primary',
			accessToken: 'token-primary',
			scopes: ['pullrequest:read'],
			cloud: true,
			type: 'oauth',
			domain: 'bitbucket.org',
		}),
	);
}

type CapturingProvider = Record<string, (input: unknown, options?: { token?: string }) => Promise<unknown>>;

suite('Bitbucket my pull requests search (#5530)', () => {
	test('default sweep returns authored PRs only and skips the reviewer fan-out', async () => {
		const runtime = createFakeRuntime();
		await seedBitbucketPrimaryConnection(runtime);

		let openRemotesCalls = 0;
		runtime.repositories.getOpenRemotes = async () => {
			openRemotesCalls++;
			return [{ path: 'octo/repo', provider: { owner: 'octo', repoName: 'repo' } } as unknown as GitRemote];
		};

		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(
			bb as unknown as { authenticationService: { getByRemote: (remote: GitRemote) => Promise<unknown> } }
		).authenticationService.getByRemote = async () => bb;

		const api = await (
			bb as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
		).getProvidersApi();
		const provider = api.providers.bitbucket as CapturingProvider;

		let authoredCalls = 0;
		let reviewerCalls = 0;
		provider.getCurrentUserFn = () => Promise.resolve({ data: { id: 'acc-uuid', username: 'octo' } });
		provider.getBitbucketResourcesForCurrentUserFn = () => Promise.resolve({ data: [{ slug: 'workspace' }] });
		provider.getBitbucketPullRequestsAuthoredByUserForWorkspaceFn = () => {
			authoredCalls++;
			return Promise.resolve({ data: [], pageInfo: { hasNextPage: false, nextPage: null } });
		};
		provider.getPullRequestsForReposFn = () => {
			reviewerCalls++;
			return Promise.resolve({ data: [], pageInfo: undefined });
		};

		const result = await manager.getMyPullRequests([GitCloudHostIntegrationId.Bitbucket]);

		assert.deepEqual(result?.value, [], 'empty authored results still resolve cleanly');
		assert.equal(authoredCalls, 1, 'authored workspace read still runs');
		assert.equal(reviewerCalls, 0, 'reviewer repo fan-out is skipped by default');
		assert.equal(openRemotesCalls, 0, 'default sweep avoids enumerating open remotes');

		manager.dispose();
	});

	test('opt-in reviewer sweep fans out across open remotes with the reviewer BBQL clause', async () => {
		const runtime = createFakeRuntime();
		await seedBitbucketPrimaryConnection(runtime);

		let openRemotesCalls = 0;
		runtime.repositories.getOpenRemotes = async () => {
			openRemotesCalls++;
			return [{ path: 'octo/repo', provider: { owner: 'octo', repoName: 'repo' } } as unknown as GitRemote];
		};

		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(
			bb as unknown as { authenticationService: { getByRemote: (remote: GitRemote) => Promise<unknown> } }
		).authenticationService.getByRemote = async () => bb;

		const api = await (
			bb as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
		).getProvidersApi();
		const provider = api.providers.bitbucket as CapturingProvider;

		let reviewerInput: Record<string, unknown> | undefined;
		provider.getCurrentUserFn = () => Promise.resolve({ data: { id: 'acc-uuid', username: 'octo' } });
		provider.getBitbucketResourcesForCurrentUserFn = () => Promise.resolve({ data: [{ slug: 'workspace' }] });
		provider.getBitbucketPullRequestsAuthoredByUserForWorkspaceFn = () =>
			Promise.resolve({ data: [], pageInfo: { hasNextPage: false, nextPage: null } });
		provider.getPullRequestsForReposFn = input => {
			reviewerInput = input as Record<string, unknown>;
			return Promise.resolve({ data: [], pageInfo: undefined });
		};

		await manager.getMyPullRequests([GitCloudHostIntegrationId.Bitbucket], undefined, undefined, {
			includeReviewRequested: true,
		});

		assert.equal(openRemotesCalls, 1, 'opt-in reviewer sweep enumerates open remotes once');
		assert.deepEqual(reviewerInput?.repos, [{ namespace: 'octo', name: 'repo' }]);
		assert.equal(reviewerInput?.query, 'state="OPEN" AND reviewers.uuid="acc-uuid"');

		manager.dispose();
	});
});
