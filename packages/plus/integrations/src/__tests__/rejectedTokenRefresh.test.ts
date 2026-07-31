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
 * They also pin the bound on the recovery: one refresh per cycle, never one per read, and a token the refresh
 * cannot fix still reaching the failure budget that prompts a reconnect. Note that the cloud mints a NEW
 * access token on every `/refresh`, so a changed token is not evidence the connection healed — treating it as
 * such is exactly what would refresh forever and starve that budget.
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

	test('a refused token the cloud keeps rotating still reaches the reconnect prompt', async () => {
		let minted = 0;
		const { runtime, calls } = createRuntimeWithCloudToken('sec-tok', () => `token-${minted}`);
		await seedConnection(runtime, 'sec-tok', 'token-0');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		// Every read is refused, and the cloud mints a NEW access token on each `/refresh` — which is what a
		// real OAuth refresh does. So "the token changed" is NOT evidence the connection healed: a credential
		// refused for a reason a refresh cannot fix (retired scopes) looks freshly rotated on every attempt.
		// Re-arming the recovery on a changed token would therefore refresh on every read forever and the
		// failure budget would never advance, leaving the connection broken in silence.
		const seen = stubOrgRead(gh, () => {
			minted++;
			return true;
		});

		let disconnected: string | undefined;
		// `hooks` is optional on the runtime contract but always populated by the fake.
		runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };

		for (let i = 0; i < 8; i++) {
			await gh.getOrganizationsForUserResult('sec-tok');
		}

		assert.equal(disconnected, gh.name, 'the failure budget still advances and prompts a reconnect');
		assert.equal(seen.length, 8, 'every read still attempted the provider');
		// Read 1 records the rejection and read 2 spends it; reads 3-7 exhaust the 5-exception budget, whose
		// disconnect resets the tracker, so read 8 opens a fresh cycle. Bounded either way — never per-read.
		assert.equal(refreshCalls(calls).length, 2, 'one refresh per recovery cycle, not one per read');

		manager.dispose();
	});

	test('a token still refused after its refresh falls through to the failure budget', async () => {
		const token = 'token-stale';
		const { runtime } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		stubOrgRead(gh, () => true);

		// The refresh keeps handing back the same refused token, so the rejection is not self-healing. Once
		// spent, every further rejection has to reach `trackRequestException` — that is what eventually
		// disconnects and surfaces the reconnect prompt. Without the fall-through the connection would fail
		// silently forever.
		let disconnected: string | undefined;
		// `hooks` is optional on the runtime contract but always populated by the fake.
		runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };

		// 1 records the rejection, 2 consumes it; from 3 on each failure spends one of the 5 budgeted
		// exceptions, so the limit is reached on read 7.
		for (let i = 0; i < 7; i++) {
			await gh.getOrganizationsForUserResult('sec-tok');
		}

		assert.equal(disconnected, gh.name, 'the exhausted failure budget prompts a reconnect');

		manager.dispose();
	});

	test('a disconnect drops the rejection, so a reconnected token is read as-is', async () => {
		const token = 'token-stale';
		const { runtime, calls } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let rejecting = true;
		stubOrgRead(gh, () => rejecting);

		await gh.getOrganizationsForUserResult('sec-tok'); // records the rejection

		// A disconnect (or a forced re-sync) replaces or removes every stored token, so the rejection recorded
		// against the one that preceded it describes nothing and must not force a refresh afterwards.
		gh.resetRequestExceptionCount('all');
		rejecting = false;

		const result = await gh.getOrganizationsForUserResult('sec-tok');

		assert.ok(result?.error == null);
		assert.deepEqual(refreshCalls(calls), [], 'the cleared rejection does not refresh');

		manager.dispose();
	});

	test('switching or deleting a connection drops its rejection', async () => {
		const token = 'token-stale';
		const { runtime, calls } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let rejecting = true;
		stubOrgRead(gh, () => rejecting);

		await gh.getOrganizationsForUserResult('sec-tok'); // records the rejection

		// `switchConnection` is what `IntegrationService.deleteConnection`/`setPrimaryConnection` call once the
		// connection set changed. A rejection recorded against the previous set can name a token that is now
		// gone, so it must not survive to force a refresh — nor outlive the connection it belonged to.
		gh.switchConnection();
		rejecting = false;

		const result = await gh.getOrganizationsForUserResult('sec-tok');

		assert.ok(result?.error == null);
		assert.deepEqual(refreshCalls(calls), [], 'the dropped rejection does not refresh');

		manager.dispose();
	});

	test('reauthenticating drops the rejection, so the new credential is read as-is', async () => {
		const token = 'token-stale';
		const { runtime } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let rejecting = true;
		stubOrgRead(gh, () => rejecting);

		await gh.getOrganizationsForUserResult('sec-tok'); // records the rejection

		// Reauthenticating is the user-facing recovery an auth failure leads to, and it replaces every token a
		// rejection could name. Note the state this lands in: a per-connection read never populates the primary
		// `_session`, so it is still `undefined` here and `reauthenticate` returns at its own early guard —
		// which is exactly why the rejection has to be dropped ahead of that guard, or the failure that
		// prompted the reauthentication would strand it.
		await gh.reauthenticate();
		rejecting = false;

		// Asserted on the tracker rather than on refresh calls: reauthentication perturbs the stored session, so
		// counting wire calls would measure that re-resolve rather than the rejection being dropped.
		const tracker = (gh as unknown as { _rejectedTokens: { empty: boolean } })._rejectedTokens;
		assert.equal(tracker.empty, true, 'no rejection survives the reauthentication');

		const result = await gh.getOrganizationsForUserResult('sec-tok');
		assert.ok(result?.error == null, 'the connection reads normally afterwards');

		manager.dispose();
	});

	test('a forced re-sync drops the rejection, having deleted the token it named', async () => {
		const token = 'token-stale';
		const { runtime } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		stubOrgRead(gh, () => true);
		await gh.getOrganizationsForUserResult('sec-tok'); // records the rejection

		// A forced re-sync deletes the stored secret outright. Its own "did the token change" check needs an
		// `oldSession` to compare, and a per-connection read never populates one — so the clear cannot be left
		// to that check.
		await gh.syncCloudConnection('connected', true);

		const tracker = (gh as unknown as { _rejectedTokens: { empty: boolean } })._rejectedTokens;
		assert.equal(tracker.empty, true, 'the deleted token leaves no rejection behind');

		manager.dispose();
	});

	test('concurrent reads of one rejected connection refresh only once', async () => {
		let token = 'token-stale';
		const { runtime, calls } = createRuntimeWithCloudToken('sec-tok', () => token);
		await seedConnection(runtime, 'sec-tok', token);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const seen = stubOrgRead(gh, attempt => attempt === 1);

		await gh.getOrganizationsForUserResult('sec-tok'); // records the rejection
		token = 'token-fresh';

		// Account-wide reads fan out, so several reads of the same connection can be in flight at once. The
		// rejection is claimed before the session resolves, so exactly one of them may force the refresh —
		// otherwise a fan-out would multiply one rejection into N cloud round trips.
		await Promise.all([
			gh.getOrganizationsForUserResult('sec-tok'),
			gh.getOrganizationsForUserResult('sec-tok'),
			gh.getOrganizationsForUserResult('sec-tok'),
		]);

		assert.equal(refreshCalls(calls).length, 1, 'the concurrent fan-out forces a single refresh');
		assert.equal(seen.length, 4, 'every read still attempted the provider');

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
