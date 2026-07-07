import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Account } from '@gitlens/git/models/author.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies that reads (issues/PRs) can target a SPECIFIC connection (multi-account) via a `connectionId`,
 * reading with that connection's token rather than the provider's primary — mirroring gkcli's
 * `--connection <tokenId>` and the token backend's `GET /v1/provider-tokens/tokens/{tokenId}`.
 */
async function seedConnectionSecret(runtime: ReturnType<typeof createFakeRuntime>, tokenId: string, token: string) {
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

suite('per-connection reads (#5430)', () => {
	test('searchMyIssues reads with the specified connection token, not the primary', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		await runtime.storage.storeSecret(
			'integration.auth:github|sec-tok',
			JSON.stringify({
				id: 'sec-tok',
				accessToken: 'token-local-pat',
				scopes: ['repo'],
				cloud: false,
				type: 'pat',
				domain: 'github.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let capturedToken: string | undefined;
		(
			gh as unknown as {
				searchProviderMyIssues: (session: ProviderAuthenticationSession) => Promise<IssueShape[]>;
			}
		).searchProviderMyIssues = session => {
			capturedToken = session.accessToken;
			return Promise.resolve([]);
		};

		const result = await gh.searchMyIssues(undefined, undefined, 'sec-tok');

		assert.deepEqual(result, [], 'returns the specified connection results');
		assert.equal(capturedToken, 'token-secondary', 'read used the specified cloud connection token');

		manager.dispose();
	});

	test('searchMyPullRequests reads with the specified connection token', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let capturedToken: string | undefined;
		(
			gh as unknown as {
				searchProviderMyPullRequests: (session: ProviderAuthenticationSession) => Promise<PullRequest[]>;
			}
		).searchProviderMyPullRequests = session => {
			capturedToken = session.accessToken;
			return Promise.resolve([]);
		};

		await gh.searchMyPullRequests(undefined, undefined, undefined, 'sec-tok');

		assert.equal(capturedToken, 'token-secondary', 'PR read used the specified connection token');

		manager.dispose();
	});

	test('a network failure resolving the connection degrades to undefined instead of throwing', async () => {
		const runtime = createFakeRuntime();
		runtime.account.getAccount = async () => ({ id: 'me' });
		// The stored secondary session is expired, so resolving it triggers a refresh…
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|exp-tok',
			JSON.stringify({
				id: 'exp-tok',
				accessToken: 'stale',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'github.com',
				expiresAt: new Date(Date.now() - 60_000).toISOString(),
			}),
		);
		// …and the refresh hits the backend, which fails.
		runtime.account.fetchGkApi = () => Promise.reject(new Error('network down'));
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let called = false;
		(
			gh as unknown as {
				searchProviderMyIssues: (session: ProviderAuthenticationSession) => Promise<IssueShape[]>;
			}
		).searchProviderMyIssues = () => {
			called = true;
			return Promise.resolve([]);
		};

		const result = await gh.searchMyIssues(undefined, undefined, 'exp-tok');

		assert.equal(result, undefined, 'a failed connection resolution yields no results (no throw)');
		assert.equal(called, false, 'provider read not attempted when the session can’t be resolved');

		manager.dispose();
	});

	test('a read for an unknown connection degrades to undefined without calling the provider', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let called = false;
		(
			gh as unknown as {
				searchProviderMyIssues: (session: ProviderAuthenticationSession) => Promise<IssueShape[]>;
			}
		).searchProviderMyIssues = () => {
			called = true;
			return Promise.resolve([]);
		};

		const result = await gh.searchMyIssues(undefined, undefined, 'does-not-exist');

		assert.equal(result, undefined, 'unresolvable connection yields no results');
		assert.equal(called, false, 'provider read not attempted without a session');

		manager.dispose();
	});

	test('a locally disconnected provider blocks per-connection reads even when the secret remains', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		await runtime.storage.storeWorkspace('connected:github', false);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let called = false;
		(
			gh as unknown as {
				searchProviderMyIssues: (session: ProviderAuthenticationSession) => Promise<IssueShape[]>;
			}
		).searchProviderMyIssues = () => {
			called = true;
			return Promise.resolve([]);
		};

		const result = await gh.searchMyIssues(undefined, undefined, 'sec-tok');

		assert.equal(result, undefined, 'locally disconnected provider yields no results');
		assert.equal(called, false, 'provider read not attempted while locally disconnected');

		manager.dispose();
	});

	test('GitLab PR search resolves the username from the read session, not the primary account', async () => {
		const runtime = createFakeRuntime();
		// A secondary GitLab connection whose token differs from the (absent) primary.
		await runtime.storage.storeSecret(
			'integration.auth.cloud:gitlab|sec-tok',
			JSON.stringify({
				id: 'sec-tok',
				accessToken: 'token-secondary',
				scopes: ['api'],
				cloud: true,
				type: 'oauth',
				domain: 'gitlab.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);

		// Capture the session the account lookup receives. GitLab used to call the primary-scoped
		// getCurrentAccount(); the fix routes through getProviderCurrentAccount(session).
		let accountLookupToken: string | undefined;
		(
			gl as unknown as {
				getProviderCurrentAccount: (session: ProviderAuthenticationSession) => Promise<Account | undefined>;
			}
		).getProviderCurrentAccount = session => {
			accountLookupToken = session.accessToken;
			return Promise.resolve(undefined); // undefined username → method returns [] before hitting the API
		};

		// searchMyPullRequests wraps its result in an IntegrationResult ({ value, duration }).
		const result = await gl.searchMyPullRequests(undefined, undefined, undefined, 'sec-tok');

		assert.deepEqual(result?.value, [], 'no username resolves to empty results without an API call');
		assert.equal(accountLookupToken, 'token-secondary', 'username resolved from the read session token');

		manager.dispose();
	});
});
