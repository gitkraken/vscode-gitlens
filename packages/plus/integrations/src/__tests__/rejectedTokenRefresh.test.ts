import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { AuthenticationError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { ProviderHierarchyResult } from '../providers/models.js';
import type { ProviderOrganization } from '../results.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * A token the provider REJECTS while the backend still believes it is valid — a revoked grant, retired
 * scopes, an app removed from the org. The refresh used to be purely predictive (`expiresIn < 60`), so this
 * token was never refreshed: `expiresIn` stayed high, the read kept re-sending the refused token, and the
 * failure only cleared when the user reconnected by hand.
 *
 * These tests pin the observed trigger. They drive the whole chain (read → `AuthenticationError` →
 * per-connection rejection → forced refresh on the next read) through a fake `fetchGkApi`, so what is
 * asserted is the actual `POST v1/provider-tokens/tokens/{id}/refresh` reaching the wire — the refresh token
 * itself never reaches the client, the GK cloud exchanges it server-side.
 *
 * The read under test is `getOrganizationsForUserResult`: connection-scoped, and it holds no cache of its
 * own, so what the assertions see is the auth path rather than a memoized result.
 */

interface FetchCall {
	path: string;
	method: string | undefined;
}

const NON_EXPIRING_SECONDS = 100_000;

/**
 * A runtime whose cloud token endpoints answer with a long-lived token, recording every call. `token()`
 * decides the current token value, so a test can prove the refreshed one replaced it.
 */
function createRuntimeWithCloudToken(tokenId: string, token: () => string) {
	const runtime = createFakeRuntime();
	const calls: FetchCall[] = [];
	// `getCloudSession` bails before any cloud call when no GK account is signed in, so the refresh under
	// test would never be reached.
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = (path: string, init?: RequestInit) => {
		calls.push({ path: path, method: init?.method });
		if (path === 'v1/provider-tokens') {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						data: [{ tokenId: tokenId, provider: 'github', type: 'oauth', domain: 'github.com' }],
					}),
					{ status: 200 },
				),
			);
		}
		return Promise.resolve(
			new Response(
				JSON.stringify({
					data: {
						tokenId: tokenId,
						accessToken: token(),
						domain: 'github.com',
						// Deliberately NOT about to lapse: the whole point is that a purely time-based
						// refresh cannot see this token is dead.
						expiresIn: NON_EXPIRING_SECONDS,
						scopes: 'repo',
						type: 'oauth',
					},
				}),
				{ status: 200 },
			),
		);
	};
	return { runtime: runtime, calls: calls };
}

async function seedConnection(runtime: ReturnType<typeof createFakeRuntime>, tokenId: string, token: string) {
	await runtime.storage.store('integrations:configured', {
		github: [{ id: tokenId, cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
	});
	await runtime.storage.storeSecret(
		`integration.auth.cloud:github|${tokenId}`,
		JSON.stringify({
			id: tokenId,
			accessToken: token,
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
			expiresAt: new Date(Date.now() + NON_EXPIRING_SECONDS * 1000),
		}),
	);
}

const authError = () =>
	new AuthenticationError(
		{
			providerId: GitCloudHostIntegrationId.GitHub,
			microHash: undefined,
			cloud: true,
			type: 'oauth',
			scopes: [],
		},
		'token rejected by provider',
	);

const refreshCalls = (calls: FetchCall[]) =>
	calls.filter(c => c.path.endsWith('/refresh')).map(c => `${c.method ?? 'GET'} ${c.path}`);

/**
 * Stubs the provider org read, recording the token each attempt was handed. `rejectWhile` decides which
 * attempts the provider refuses.
 */
function stubOrgRead(integration: unknown, rejectWhile: (attempt: number) => boolean): string[] {
	const seen: string[] = [];
	(
		integration as {
			getProviderOrganizationsForUser: (
				session: ProviderAuthenticationSession,
			) => Promise<ProviderHierarchyResult<ProviderOrganization> | undefined>;
		}
	).getProviderOrganizationsForUser = session => {
		seen.push(session.accessToken);
		if (rejectWhile(seen.length)) return Promise.reject(authError());
		return Promise.resolve({ values: [] });
	};
	return seen;
}

suite('rejected-token refresh', () => {
	test('a per-connection read rejected with an AuthenticationError refreshes that token on the next read', async () => {
		let token = 'token-stale';
		const { runtime, calls } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const seen = stubOrgRead(gh, attempt => attempt === 1);

		// First read: the provider refuses the token it was handed. The failure is recovered into `{ error }`
		// (unchanged behavior); the recovery is what happens on the read that follows.
		const failed = await gh.getOrganizationsForUserResult('sec-tok');
		assert.ok(failed?.error != null, 'the rejected read reports its error');
		assert.deepEqual(refreshCalls(calls), [], 'the failing read itself does not refresh');

		// The cloud now hands back a different token, as a real refresh would.
		token = 'token-fresh';
		const recovered = await gh.getOrganizationsForUserResult('sec-tok');

		assert.deepEqual(
			refreshCalls(calls),
			['POST v1/provider-tokens/tokens/sec-tok/refresh'],
			'the next read refreshes the rejected token, scoped to its own connection id',
		);
		assert.ok(recovered?.error == null, 'the read that follows the refresh succeeds');
		assert.deepEqual(seen, ['token-stale', 'token-fresh'], 'the refused token is not sent a second time');

		manager.dispose();
	});

	test('the refresh is attempted once per rejection, so a token refused again does not loop', async () => {
		const token = 'token-stale';
		const { runtime, calls } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const seen = stubOrgRead(gh, () => true);

		// Three reads, every one refused. Only the second may refresh: the first records the rejection, the
		// second consumes it, and the third must not — a token the provider refuses even after a refresh is
		// not self-healing, and re-refreshing on every read would hammer the cloud endpoint.
		for (let i = 0; i < 3; i++) {
			const result = await gh.getOrganizationsForUserResult('sec-tok');
			assert.ok(result?.error != null, `read ${i + 1} reports its error`);
		}

		assert.deepEqual(
			refreshCalls(calls),
			['POST v1/provider-tokens/tokens/sec-tok/refresh'],
			'exactly one refresh across repeated rejections of the same connection',
		);
		assert.equal(seen.length, 3, 'every read still attempted the provider');

		manager.dispose();
	});

	test('a refresh that produced a new token re-arms, so a later rejection can refresh again', async () => {
		let token = 'token-1';
		const { runtime, calls } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		// Every read is refused, but the cloud hands back a different token each time it is asked — a
		// connection whose credential really is rotating. The rejection must retire on each new token so a
		// later failure is still recoverable, rather than latching after the first refresh.
		const seen = stubOrgRead(gh, () => true);

		await gh.getOrganizationsForUserResult('sec-tok'); // rejects token-1, records it
		token = 'token-2';
		await gh.getOrganizationsForUserResult('sec-tok'); // refreshes → token-2, which is then refused
		token = 'token-3';
		await gh.getOrganizationsForUserResult('sec-tok'); // token-2's rejection refreshes → token-3

		assert.deepEqual(seen, ['token-1', 'token-2', 'token-3'], 'each read carries the freshly refreshed credential');
		assert.equal(refreshCalls(calls).length, 2, 'one refresh per distinct rejected token');

		manager.dispose();
	});

	test('a successful read never refreshes', async () => {
		const token = 'token-good';
		const { runtime, calls } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		stubOrgRead(gh, () => false);

		const result = await gh.getOrganizationsForUserResult('sec-tok');

		assert.ok(result?.error == null);
		assert.deepEqual(refreshCalls(calls), [], 'a healthy long-lived token is left alone');

		manager.dispose();
	});
});
