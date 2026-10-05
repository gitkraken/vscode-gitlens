import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { AuthenticationError, AuthenticationErrorReason, RequestRateLimitError } from '@gitlens/git/errors.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderHierarchyResult } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import type { ProviderOrganization } from '../results.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * A per-connection read whose token the GK API cannot hand back right now (gitkraken/kepler#3546).
 *
 * `getConnectionSession` throws on every non-terminal status: a 429 or a 5xx says nothing about whether the
 * connection still exists (#5569). The read path used to answer that throw with "no session", which the read
 * layer reports as `no-connection`, the warning a consumer treats as a credential to reconnect. During a GK API
 * rate limit every connected provider with a perfectly valid token was reported that way at once.
 *
 * These drive the real chain (read → auth provider → cloud token fetch) through a fake `fetchGkApi`, so the
 * status under test is the one the GK API answered.
 */

const tokenId = 'tok-1';
const NON_EXPIRING_SECONDS = 100_000;

/** The connection under test: GitHub by default, or a self-managed host read by its domain. */
type Target = { integrationId: IntegrationIds; domain: string };
const gitHub: Target = { integrationId: GitCloudHostIntegrationId.GitHub, domain: 'github.com' };
const gitHubEnterprise: Target = {
	integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	domain: 'ghe.example.com',
};

function tokenResponse(accessToken: string, target: Target = gitHub): Response {
	return new Response(
		JSON.stringify({
			data: {
				tokenId: tokenId,
				accessToken: accessToken,
				domain: target.domain,
				expiresIn: NON_EXPIRING_SECONDS,
				scopes: 'repo',
				type: 'oauth',
			},
		}),
		{ status: 200 },
	);
}

/** A runtime whose token endpoints answer `status()` (or a fresh token on 200), recording each path. */
function createRuntime(status: () => number, bodyless = false, target: Target = gitHub) {
	const runtime = createFakeRuntime();
	const paths: string[] = [];
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = (path: string) => {
		paths.push(path);
		const code = status();
		if (code === 200) return Promise.resolve(tokenResponse('token-fresh', target));
		// A throttled gateway often answers with no body at all, which must classify exactly like one with a body.
		if (bodyless) return Promise.resolve(new Response(null, { status: code }));
		return Promise.resolve(new Response(JSON.stringify({ error: 'nope' }), { status: code }));
	};
	return { runtime: runtime, paths: paths };
}

/** Seeds the connection's stored token; `expired` forces the read to fetch a new one from the cloud. */
async function seedConnection(
	runtime: ReturnType<typeof createFakeRuntime>,
	options: { expired: boolean },
	target: Target = gitHub,
) {
	const selfManaged = target !== gitHub;
	await runtime.storage.store('integrations:configured', {
		[target.integrationId]: [
			{
				id: tokenId,
				cloud: true,
				integrationId: target.integrationId,
				...(selfManaged ? { domain: target.domain } : {}),
				scopes: 'repo',
				primary: true,
			},
		],
	});
	await runtime.storage.storeSecret(
		`integration.auth.cloud:${target.integrationId}|${tokenId}`,
		JSON.stringify({
			id: tokenId,
			accessToken: 'token-stored',
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: target.domain,
			expiresAt: new Date(Date.now() + (options.expired ? -1000 : NON_EXPIRING_SECONDS * 1000)),
		}),
	);
}

/** The provider's answer to a token it no longer accepts. */
function refusedCredential(): AuthenticationError {
	return new AuthenticationError(
		{ providerId: gitHubEnterprise.integrationId, microHash: undefined, cloud: true, type: 'oauth', scopes: [] },
		AuthenticationErrorReason.Unauthorized,
	);
}

/** Holds the next plain (non-sync) session resolution of `integration` until the returned release is called. */
async function holdPlainResolution(integration: unknown): Promise<() => void> {
	const target = integration as {
		authenticationService: {
			get: (id: string) => Promise<{
				getSession: (descriptor: unknown, options?: { sync?: boolean }) => Promise<unknown>;
			}>;
		};
		authProvider: { id: string };
	};
	let release: (() => void) | undefined;
	const released = new Promise<void>(resolve => (release = resolve));
	let held = false;
	const authProvider = await target.authenticationService.get(target.authProvider.id);
	const getSession = authProvider.getSession.bind(authProvider);
	authProvider.getSession = async (descriptor: unknown, options?: { sync?: boolean }) => {
		if (!options?.sync && !held) {
			held = true;
			await released;
		}
		return getSession(descriptor, options);
	};
	return () => release?.();
}

/** A session as the auth provider hands it back for `target`. */
function primarySessionFor(target: Target): ProviderAuthenticationSession {
	return {
		id: tokenId,
		accessToken: 'token-stored',
		account: { id: '', label: '' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: target.domain,
	};
}

/** Expires the session the integration has cached, so its next read refreshes it from the cloud. */
function expireCachedSession(integration: unknown): void {
	const cached = integration as { _session?: ProviderAuthenticationSession | null };
	assert.ok(cached._session != null, 'a session is cached');
	cached._session = { ...cached._session, expiresAt: new Date(Date.now() - 1000) };
}

function stubOrgRead(integration: unknown): string[] {
	const seen: string[] = [];
	(
		integration as {
			getProviderOrganizationsForUser: (
				session: ProviderAuthenticationSession,
			) => Promise<ProviderHierarchyResult<ProviderOrganization> | undefined>;
		}
	).getProviderOrganizationsForUser = session => {
		seen.push(session.accessToken);
		return Promise.resolve({ values: [] });
	};
	return seen;
}

suite('per-connection reads when the GK API cannot hand back the token (kepler#3546)', () => {
	test('a 429 on the token fetch is a rate-limit warning, not no-connection', async () => {
		const { runtime } = createRuntime(() => 429);
		await seedConnection(runtime, { expired: true });
		const manager = createIntegrationManager(runtime);
		stubOrgRead(await manager.get(GitCloudHostIntegrationId.GitHub));

		const result = await manager.listOrgs({ providerId: GitCloudHostIntegrationId.GitHub, connectionId: tokenId });

		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth, connectionId: w.connectionId })),
			[{ kind: 'rate-limit', isAuth: false, connectionId: tokenId }],
		);
		manager.dispose();
	});

	test('a bodyless 429 on the token fetch is still a rate-limit warning', async () => {
		const { runtime } = createRuntime(() => 429, true);
		await seedConnection(runtime, { expired: true });
		const manager = createIntegrationManager(runtime);
		stubOrgRead(await manager.get(GitCloudHostIntegrationId.GitHub));

		const result = await manager.listOrgs({ providerId: GitCloudHostIntegrationId.GitHub, connectionId: tokenId });

		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['rate-limit'],
		);
		manager.dispose();
	});

	test('a 5xx on the token fetch is a non-auth failure, not no-connection', async () => {
		const { runtime } = createRuntime(() => 503);
		await seedConnection(runtime, { expired: true });
		const manager = createIntegrationManager(runtime);
		stubOrgRead(await manager.get(GitCloudHostIntegrationId.GitHub));

		const result = await manager.listOrgs({ providerId: GitCloudHostIntegrationId.GitHub, connectionId: tokenId });

		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth })),
			[{ kind: 'other', isAuth: false }],
		);
		manager.dispose();
	});

	test('a host read with no connection pinned is rate limited when its expired token cannot be refreshed', async () => {
		// A read by domain alone resolves the integration's own session rather than a connection's.
		let status = 200;
		const { runtime } = createRuntime(() => status, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		const seen = stubOrgRead(ghe);
		const read = () =>
			manager.listOrgs({ providerId: gitHubEnterprise.integrationId, domain: gitHubEnterprise.domain });
		await read();
		expireCachedSession(ghe);
		status = 429;

		const result = await read();

		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth })),
			[{ kind: 'rate-limit', isAuth: false }],
		);
		assert.deepEqual(seen, ['token-stored'], 'no read is made with the expired token');

		// The connection survives the throttle: once the cloud answers again the next read refreshes and succeeds.
		status = 200;
		const recovered = await read();
		assert.deepEqual(recovered.warnings, []);
		assert.deepEqual(seen, ['token-stored', 'token-fresh']);
		manager.dispose();
	});

	test('a host read overlapping a forced re-sync that hits a 429 does not leave the integration disconnected', async () => {
		let status = 200;
		const { runtime } = createRuntime(() => status, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		const seen = stubOrgRead(ghe);
		const read = () =>
			manager.listOrgs({ providerId: gitHubEnterprise.integrationId, domain: gitHubEnterprise.domain });
		await read();
		// Both the cached session and the stored token expired, so the overlapping read has to fetch one too.
		expireCachedSession(ghe);
		await seedConnection(runtime, { expired: true }, gitHubEnterprise);
		status = 429;

		// A read landing while the forced re-sync refetches must not resolve the session on its own, which would fail
		// the same way and report the integration as not connected.
		const deleteWorkspace = runtime.storage.deleteWorkspace.bind(runtime.storage);
		let overlapped: ReturnType<typeof read> | undefined;
		runtime.storage.deleteWorkspace = async (key: string) => {
			await deleteWorkspace(key);
			overlapped ??= read();
		};
		await ghe.syncCloudConnection('connected', true);
		runtime.storage.deleteWorkspace = deleteWorkspace;

		assert.ok(overlapped != null, 'the read ran inside the re-sync');
		assert.deepEqual(
			(await overlapped).warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth })),
			[{ kind: 'rate-limit', isAuth: false }],
			'the overlapping read reports the re-sync failure, not a missing connection',
		);
		assert.equal(ghe.maybeConnected, true, 'the integration is still connected');
		assert.deepEqual(
			(await read()).warnings.map(w => w.kind),
			['rate-limit'],
		);
		assert.deepEqual(seen, ['token-stored'], 'no read is made with the expired token');
		manager.dispose();
	});

	test('a session read whose expired token cannot be refreshed answers nothing rather than reading with it', async () => {
		let status = 200;
		const { runtime } = createRuntime(() => status);
		await seedConnection(runtime, { expired: false });
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.equal(await gh.isConnected(), true);
		const seen: string[] = [];
		(
			gh as unknown as {
				getProviderAccountForEmail: (session: ProviderAuthenticationSession) => Promise<unknown>;
			}
		).getProviderAccountForEmail = session => {
			seen.push(session.accessToken);
			return Promise.resolve({ id: 'me' });
		};
		expireCachedSession(gh);
		status = 429;

		const account = await gh.getAccountForEmail({ owner: 'o', name: 'r' } as never, 'me@example.com');

		assert.equal(account, undefined);
		assert.deepEqual(seen, [], 'no read is made with the expired token');
		assert.equal(gh.maybeConnected, true, 'the failed refresh does not disconnect the integration');
		manager.dispose();
	});

	test('a host read whose refresh is cancelled does not read with the expired token or report no connection', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		const seen = stubOrgRead(ghe);
		const read = () =>
			manager.listOrgs({ providerId: gitHubEnterprise.integrationId, domain: gitHubEnterprise.domain });
		await read();
		expireCachedSession(ghe);
		await seedConnection(runtime, { expired: true }, gitHubEnterprise);
		// The host's token-fetch timeout, not the reader, cancels the refresh.
		runtime.account.fetchGkApi = () => Promise.reject(new CancellationError());

		const result = await read();

		assert.deepEqual(seen, ['token-stored'], 'no read is made with the expired token');
		assert.deepEqual(
			result.warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth })),
			[{ kind: 'other', isAuth: false }],
			'a timed-out refresh is a failed read, not a missing connection',
		);
		assert.equal(ghe.maybeConnected, true, 'a cancelled refresh does not disconnect the integration');
		manager.dispose();
	});

	test('a pull request lookup inside a forced re-sync that hits a 429 throws the failure when asked to', async () => {
		let status = 200;
		const { runtime } = createRuntime(() => status, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		const seen: string[] = [];
		(
			ghe as unknown as {
				getProviderPullRequestForBranch: (session: ProviderAuthenticationSession) => Promise<unknown>;
			}
		).getProviderPullRequestForBranch = session => {
			seen.push(session.accessToken);
			return Promise.resolve(undefined);
		};
		assert.equal(await ghe.isConnected(), true);
		expireCachedSession(ghe);
		await seedConnection(runtime, { expired: true }, gitHubEnterprise);
		status = 429;

		// A caller that keeps "no pull request" must not get it for a lookup the throttle failed.
		const deleteWorkspace = runtime.storage.deleteWorkspace.bind(runtime.storage);
		let lookup: Promise<unknown> | undefined;
		runtime.storage.deleteWorkspace = async (key: string) => {
			await deleteWorkspace(key);
			lookup ??= (ghe as GitHostIntegration)
				.getPullRequestForBranch({ owner: 'o', name: 'r', key: 'o/r' }, 'feature', { throwOnError: true })
				.then(
					() => 'answered',
					(ex: unknown) => ex,
				);
		};
		await ghe.syncCloudConnection('connected', true);
		runtime.storage.deleteWorkspace = deleteWorkspace;

		assert.ok(lookup != null, 'the lookup ran inside the re-sync');
		const outcome = await lookup;
		assert.ok(
			outcome instanceof RequestRateLimitError,
			`the lookup rejects with the refresh failure, not ${String(outcome)}`,
		);
		assert.deepEqual(seen, [], 'no lookup is made with the expired token');
		manager.dispose();
	});

	test('a resolution pending since before a primary switch does not replace the switched-to session', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();
		const cached = ghe as unknown as { _session?: ProviderAuthenticationSession | null };
		const accountA = cached._session;
		assert.ok(accountA != null);

		// A refresh resolves account A and stays pending; the switch's own resolution then loads account B.
		const authProvider = await (
			ghe as unknown as {
				authenticationService: {
					get: (id: string) => Promise<{
						getSession: (descriptor: unknown, options?: { sync?: boolean }) => Promise<unknown>;
					}>;
				};
				authProvider: { id: string };
			}
		).authenticationService.get((ghe as unknown as { authProvider: { id: string } }).authProvider.id);
		let releaseA: (() => void) | undefined;
		const aReleased = new Promise<void>(resolve => (releaseA = resolve));
		let aStarted: (() => void) | undefined;
		const aPending = new Promise<void>(resolve => (aStarted = resolve));
		let plainCalls = 0;
		authProvider.getSession = async (_descriptor: unknown, options?: { sync?: boolean }) => {
			assert.ok(!options?.sync);
			plainCalls++;
			if (plainCalls === 1) {
				aStarted?.();
				await aReleased;
				return accountA;
			}
			return { ...accountA, id: 'tok-b', accessToken: 'token-b' };
		};
		const resynced = (
			ghe as unknown as { resyncSessionIfTokenChanged: (t: string) => Promise<void> }
		).resyncSessionIfTokenChanged('token-other');
		await aPending;
		const switched = ghe.switchConnection();
		releaseA?.();
		await resynced;
		await switched;

		assert.equal(plainCalls, 2, 'the switch resolved again after the pending resolution');
		assert.equal(cached._session?.accessToken, 'token-b', 'the former account does not come back');
		manager.dispose();
	});

	test('a pull request lookup started just before a forced re-sync throws the failure when asked to', async () => {
		let status = 200;
		const { runtime } = createRuntime(() => status, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = (await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain)) as
			| GitHostIntegration
			| undefined;
		assert.ok(ghe != null);
		(
			ghe as unknown as {
				getProviderPullRequestForBranch: () => Promise<unknown>;
			}
		).getProviderPullRequestForBranch = () => Promise.resolve(undefined);
		assert.equal(await ghe.isConnected(), true);
		expireCachedSession(ghe);
		await seedConnection(runtime, { expired: true }, gitHubEnterprise);
		status = 429;

		const started = ghe
			.getPullRequestForBranch({ owner: 'o', name: 'r', key: 'o/r' }, 'feature', { throwOnError: true })
			.then(
				() => 'answered',
				(ex: unknown) => ex,
			);
		const resync = ghe.syncCloudConnection('connected', true);

		const outcome = await started;
		assert.ok(
			outcome instanceof RequestRateLimitError,
			`the lookup rejects with the refresh failure, not ${String(outcome)}`,
		);
		await resync;
		manager.dispose();
	});

	test('a session settled during a forced re-sync is not undone when its refetch fails', async () => {
		let status = 200;
		const { runtime } = createRuntime(() => status, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();
		status = 429;

		// A disconnect settles the session while the refetch runs.
		const deleteWorkspace = runtime.storage.deleteWorkspace.bind(runtime.storage);
		let disconnected: Promise<void> | undefined;
		runtime.storage.deleteWorkspace = async (key: string) => {
			await deleteWorkspace(key);
			// Queued behind the re-sync, so it lands once the refetch settles.
			disconnected ??= ghe.disconnect({ silent: true });
		};
		const failure = await ghe.syncCloudConnection('connected', true);
		runtime.storage.deleteWorkspace = deleteWorkspace;
		await disconnected;

		assert.ok(disconnected, 'the disconnect ran inside the re-sync');
		assert.ok(failure != null, 'the re-sync reports its refetch failure');
		assert.equal(ghe.maybeConnected, false, 'the disconnect stands');
		manager.dispose();
	});

	test('a host read recovers once the cloud answers again after a throttled re-sync', async () => {
		let status = 200;
		const { runtime } = createRuntime(() => status, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		const seen = stubOrgRead(ghe);
		const read = () =>
			manager.listOrgs({ providerId: gitHubEnterprise.integrationId, domain: gitHubEnterprise.domain });
		await read();
		expireCachedSession(ghe);
		await seedConnection(runtime, { expired: true }, gitHubEnterprise);
		status = 429;

		// Two throttled re-syncs in a row, with reads in between.
		await ghe.syncCloudConnection('connected', true);
		assert.deepEqual(
			(await read()).warnings.map(w => w.kind),
			['rate-limit'],
		);
		await ghe.syncCloudConnection('connected', true);
		assert.equal(ghe.maybeConnected, true, 'still connected through the throttle');

		status = 200;
		const recovered = await read();
		assert.deepEqual(recovered.warnings, []);
		assert.deepEqual(seen, ['token-stored', 'token-fresh'], 'the expired token is never read with');
		manager.dispose();
	});

	test("a disconnect during a session lookup's throttled refresh waits for it and sends nothing", async () => {
		let status = 200;
		const { runtime } = createRuntime(() => status, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = (await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain)) as
			| GitHostIntegration
			| undefined;
		assert.ok(ghe != null);
		const seen: (string | undefined)[] = [];
		(
			ghe as unknown as {
				getProviderPullRequestForBranch: (session: ProviderAuthenticationSession | null) => Promise<unknown>;
			}
		).getProviderPullRequestForBranch = session => {
			// The real provider reads the session's token, so a lookup sent with no session is a crash.
			seen.push(session?.accessToken);
			return Promise.resolve(undefined);
		};
		assert.equal(await ghe.isConnected(), true);
		expireCachedSession(ghe);
		status = 429;

		// The user disconnects while the lookup's refresh is in flight: the disconnect is queued behind the refresh,
		// so the lookup reports the refresh failure and the disconnect then lands.
		const deleteWorkspace = runtime.storage.deleteWorkspace.bind(runtime.storage);
		let disconnected: Promise<void> | undefined;
		runtime.storage.deleteWorkspace = async (key: string) => {
			await deleteWorkspace(key);
			runtime.storage.deleteWorkspace = deleteWorkspace;
			disconnected ??= ghe.disconnect({ silent: true });
		};
		const outcome = await ghe
			.getPullRequestForBranch({ owner: 'o', name: 'r', key: 'o/r' }, 'feature', { throwOnError: true })
			.then(
				() => 'answered',
				(ex: unknown) => ex,
			);
		await disconnected;

		assert.equal(ghe.maybeConnected, false, 'the disconnect lands after the refresh');
		assert.ok(
			outcome instanceof RequestRateLimitError,
			`the lookup reports its refresh failure, not ${String(outcome)}`,
		);
		assert.deepEqual(seen, [], 'no lookup is sent with the expired or a missing session');
		manager.dispose();
	});

	test('a resolution overtaken by a session clear resolves again instead of reporting the integration gone', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();
		let disconnected = 0;
		(ghe as unknown as { providerOnDisconnect: () => void }).providerOnDisconnect = () => {
			disconnected++;
		};

		// A refresh's resolution is held in flight; another resolution publishes meanwhile, then a connection switch
		// clears the session and joins the refresh's (same options, so the same gate).
		const release = await holdPlainResolution(ghe);
		const cached = ghe as unknown as { _session?: ProviderAuthenticationSession | null };
		cached._session = undefined;
		ghe.refresh();
		cached._session = primarySessionFor(gitHubEnterprise);
		ghe.switchConnection();
		release();
		for (let i = 0; i < 10; i++) {
			await new Promise(resolve => setImmediate(resolve));
		}

		assert.equal(ghe.maybeConnected, true, 'the integration is still connected');
		assert.equal(disconnected, 0, 'no disconnect is run for a connection that is still there');
		manager.dispose();
	});

	test('a forced refetch that succeeds after a disconnect does not reconnect the integration', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();

		// The user disconnects while the forced refetch's token fetch is in flight, and the fetch then succeeds.
		const fetchGkApi = runtime.account.fetchGkApi;
		let disconnected: Promise<void> | undefined;
		runtime.account.fetchGkApi = async (path: string, init?: RequestInit) => {
			// Queued behind the refetch, so it lands once the refetch settles.
			disconnected ??= ghe.disconnect({ silent: true });
			return fetchGkApi(path, init);
		};
		await ghe.syncCloudConnection('connected', true);
		runtime.account.fetchGkApi = fetchGkApi;
		await disconnected;

		assert.ok(disconnected, 'the disconnect ran inside the refetch');
		assert.equal(ghe.maybeConnected, false, 'the disconnect stands');
		assert.equal(await ghe.getSession('integrations'), undefined, 'no session is served after the disconnect');
		assert.equal(
			await runtime.storage.getSecret(`integration.auth.cloud:${gitHubEnterprise.integrationId}|${tokenId}`),
			undefined,
			'the refetched token is not stored over the sign-out',
		);
		manager.dispose();

		// A later resolution from scratch (a restart) finds nothing to reconnect with.
		const restarted = createIntegrationManager(runtime);
		const again = await restarted.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(again != null);
		assert.equal(await again.isConnected(), false, 'the integration stays disconnected');
		restarted.dispose();
	});

	test('a forced refetch that succeeds after a reauthentication does not store the token it signed out', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();

		// The user reauthenticates while the forced refetch's token fetch is in flight, abandons the new sign-in, and
		// the fetch then succeeds.
		const fetchGkApi = runtime.account.fetchGkApi;
		let reauthenticated: Promise<void> | undefined;
		runtime.account.fetchGkApi = async (path: string, init?: RequestInit) => {
			// Queued behind the refetch, so it lands once the refetch settles.
			reauthenticated ??= ghe.reauthenticate();
			return fetchGkApi(path, init);
		};
		await ghe.syncCloudConnection('connected', true);
		runtime.account.fetchGkApi = fetchGkApi;
		await reauthenticated;

		assert.ok(reauthenticated, 'the reauthentication ran inside the refetch');
		assert.equal(
			await runtime.storage.getSecret(`integration.auth.cloud:${gitHubEnterprise.integrationId}|${tokenId}`),
			undefined,
			'the refetched token is not stored over the sign-out',
		);
		manager.dispose();

		// A later resolution from scratch (a restart) finds nothing to reconnect with.
		const restarted = createIntegrationManager(runtime);
		const again = await restarted.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(again != null);
		assert.equal(await again.isConnected(), false, 'the integration stays disconnected');
		restarted.dispose();
	});

	test("a sign-out of another self-managed host during a forced refetch keeps this host's token", async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		const other = await manager.get(gitHubEnterprise.integrationId, 'other.example.com');
		assert.ok(ghe != null && other != null);
		await ghe.isConnected();

		// The other host is signed out while this host's forced refetch is in flight.
		const fetchGkApi = runtime.account.fetchGkApi;
		let signedOut = false;
		runtime.account.fetchGkApi = async (path: string, init?: RequestInit) => {
			if (!signedOut) {
				signedOut = true;
				await other.disconnect({ silent: true });
			}
			return fetchGkApi(path, init);
		};
		await ghe.syncCloudConnection('connected', true);
		runtime.account.fetchGkApi = fetchGkApi;

		assert.ok(signedOut, 'the other host signed out inside the refetch');
		assert.equal(
			(await ghe.getSession('integrations'))?.accessToken,
			'token-fresh',
			'this host keeps its new token',
		);
		manager.dispose();
	});

	test('a stored token resolved before the provider refused it does not replace the refused session', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = (await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain)) as
			| GitHostIntegration
			| undefined;
		assert.ok(ghe != null);
		await ghe.isConnected();
		(ghe as unknown as { getProviderAccountForEmail: () => Promise<unknown> }).getProviderAccountForEmail = () =>
			Promise.reject(refusedCredential());

		// A forced re-sync is in flight, and the cloud will hand back the same token, when the provider refuses it.
		let release: (() => void) | undefined;
		const released = new Promise<void>(resolve => (release = resolve));
		const fetchGkApi = runtime.account.fetchGkApi;
		runtime.account.fetchGkApi = async (path: string) => {
			await released;
			return tokenResponse('token-stored', gitHubEnterprise);
		};
		const resync = ghe.syncCloudConnection('connected', true);
		await ghe.getAccountForEmail({ owner: 'o', name: 'r', key: 'o/r' }, 'me@example.com');
		release?.();
		await resync;
		runtime.account.fetchGkApi = fetchGkApi;
		for (let i = 0; i < 5; i++) {
			await new Promise(resolve => setImmediate(resolve));
		}

		const cached = ghe as unknown as { _session?: ProviderAuthenticationSession | null };
		assert.equal(cached._session?.accessToken, 'token-stored', 'the resolution published the same token anew');
		assert.ok(
			(cached._session?.expiresAt?.getTime() ?? Infinity) < Date.now(),
			'the refused token stays marked, so the next read refreshes it rather than resending it',
		);
		manager.dispose();
	});

	test('a primary switch during a forced refetch keeps the token the switch resolves', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();

		// Another account becomes primary while the forced refetch's token fetch is in flight, and the switch's own
		// resolution of the new primary is still pending when the refetch settles.
		const releaseSwitch = await holdPlainResolution(ghe);
		const fetchGkApi = runtime.account.fetchGkApi;
		let switched = false;
		runtime.account.fetchGkApi = async (path: string, init?: RequestInit) => {
			if (!switched) {
				switched = true;
				ghe.switchConnection();
			}
			return fetchGkApi(path, init);
		};
		await ghe.syncCloudConnection('connected', true);
		runtime.account.fetchGkApi = fetchGkApi;
		releaseSwitch();
		for (let i = 0; i < 10; i++) {
			await new Promise(resolve => setImmediate(resolve));
		}

		assert.ok(switched, 'the switch ran inside the refetch');
		assert.ok(
			await runtime.storage.getSecret(`integration.auth.cloud:${gitHubEnterprise.integrationId}|${tokenId}`),
			'the switched-to token is not deleted as a definitive empty answer',
		);
		assert.equal(ghe.maybeConnected, true, 'the integration stays connected');
		manager.dispose();
	});

	test('a disconnect while a forced refetch reads its stored token does not let the refetch store a new one', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();

		// The user disconnects while the refetch is still reading the stored token, before any token fetch starts.
		const key = `integration.auth.cloud:${gitHubEnterprise.integrationId}|${tokenId}`;
		const getSecret = runtime.storage.getSecret.bind(runtime.storage);
		let disconnected: Promise<void> | undefined;
		runtime.storage.getSecret = async (secretKey: string) => {
			const value = await getSecret(secretKey);
			if (disconnected == null && secretKey === key) {
				// Queued behind the refetch, so it lands once the refetch settles.
				disconnected = ghe.disconnect({ silent: true });
			}
			return value;
		};
		await ghe.syncCloudConnection('connected', true);
		runtime.storage.getSecret = getSecret;
		await disconnected;

		assert.ok(disconnected, 'the disconnect ran inside the stored-token read');
		assert.equal(ghe.maybeConnected, false, 'the disconnect stands');
		assert.equal(
			await runtime.storage.getSecret(key),
			undefined,
			'the refetched token is not stored over the sign-out',
		);
		manager.dispose();
	});

	test('a resolution pending while a cold integration switches primary does not publish the former account', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);

		// Nothing is cached yet: a resolution of account A starts and stays pending, then B becomes primary.
		const release = await holdPlainResolution(ghe);
		const pendingA = ghe.isConnected();
		const key = `integration.auth.cloud:${gitHubEnterprise.integrationId}|${tokenId}`;
		const stored = JSON.parse((await runtime.storage.getSecret(key)) ?? '{}') as Record<string, unknown>;
		await runtime.storage.storeSecret(key, JSON.stringify({ ...stored, accessToken: 'token-b' }));
		const readA = { ...stored };
		const getSecret = runtime.storage.getSecret.bind(runtime.storage);
		let servedA = false;
		runtime.storage.getSecret = async (secretKey: string) => {
			// The pending resolution read storage before the switch, so it answers with account A.
			if (!servedA && secretKey === key) {
				servedA = true;
				return JSON.stringify(readA);
			}
			return getSecret(secretKey);
		};
		ghe.switchConnection();
		release();
		await pendingA;
		runtime.storage.getSecret = getSecret;

		assert.ok(servedA, 'the pending resolution read account A');
		assert.equal(
			(await ghe.getSession('integrations'))?.accessToken,
			'token-b',
			'the former account does not come back',
		);
		manager.dispose();
	});

	test('a refresh overtaken by a provider refusal does not let the read go through with the refused token', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = (await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain)) as
			| GitHostIntegration
			| undefined;
		assert.ok(ghe != null);
		await ghe.isConnected();
		const seen: string[] = [];
		(
			ghe as unknown as { getProviderAccountForEmail: (s: ProviderAuthenticationSession) => Promise<unknown> }
		).getProviderAccountForEmail = session => {
			seen.push(session.accessToken);
			return Promise.resolve({ id: 'me' });
		};
		expireCachedSession(ghe);

		// While the read's refresh fetches the replacement, an older provider request reports the token refused.
		const fetchGkApi = runtime.account.fetchGkApi;
		let refused = false;
		runtime.account.fetchGkApi = async (path: string, init?: RequestInit) => {
			if (!refused) {
				refused = true;
				(
					ghe as unknown as { handleProviderException: (usecase: string, ex: Error) => boolean }
				).handleProviderException('getAccountForEmail', refusedCredential());
			}
			return fetchGkApi(path, init);
		};
		await ghe.getAccountForEmail({ owner: 'o', name: 'r', key: 'o/r' }, 'me@example.com');
		runtime.account.fetchGkApi = fetchGkApi;

		assert.ok(refused, 'the refusal landed inside the refresh');
		assert.deepEqual(seen, ['token-fresh'], 'the read uses the replacement, never the refused token');
		manager.dispose();
	});

	test('a disconnect while the refetched token is being stored leaves nothing stored (#5948)', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();

		// The user disconnects while the refetch writes its token: the sign-out waits for the write and removes it.
		const key = `integration.auth.cloud:${gitHubEnterprise.integrationId}|${tokenId}`;
		const storeSecret = runtime.storage.storeSecret.bind(runtime.storage);
		let disconnected: Promise<void> | undefined;
		runtime.storage.storeSecret = async (secretKey: string, value: string) => {
			if (disconnected == null && value.includes('token-fresh')) {
				disconnected = ghe.disconnect({ silent: true });
			}
			return storeSecret(secretKey, value);
		};
		await ghe.syncCloudConnection('connected', true);
		runtime.storage.storeSecret = storeSecret;
		await disconnected;

		assert.ok(disconnected != null, 'the disconnect ran inside the store');
		assert.equal(ghe.maybeConnected, false, 'the disconnect stands');
		assert.equal(await runtime.storage.getSecret(key), undefined, 'the stored token is removed');
		manager.dispose();

		const restarted = createIntegrationManager(runtime);
		const again = await restarted.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(again != null);
		assert.equal(await again.isConnected(), false, 'a restart stays disconnected');
		restarted.dispose();
	});

	test('a sign-out before a fetched token of another connection is stored refuses it (#5948)', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const configured = new ConfiguredIntegrationService(runtime);
		const mark = configured.getSignOutMark();

		// The cloud's primary moved to another connection while the user signed out of the host.
		await configured.deleteAllStoredSessions(gitHubEnterprise.integrationId, undefined, gitHubEnterprise.domain);
		const stored = await configured.storeSession(
			gitHubEnterprise.integrationId,
			{ ...primarySessionFor(gitHubEnterprise), id: 'tok-other', accessToken: 'token-other' },
			{ signOutMark: mark },
		);

		assert.equal(stored, false, 'the store is refused');
		assert.equal(
			await runtime.storage.getSecret(`integration.auth.cloud:${gitHubEnterprise.integrationId}|tok-other`),
			undefined,
		);
		assert.deepEqual(
			configured.getConfigured(gitHubEnterprise.integrationId).map(c => c.id),
			[],
			'no descriptor is registered for it',
		);
		configured.dispose();
	});

	test('a connection removed while its token is fetched is not stored back', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const configured = new ConfiguredIntegrationService(runtime);
		const mark = configured.getSignOutMark();

		await configured.deleteConnection(gitHubEnterprise.integrationId, tokenId, true);
		const stored = await configured.storeSession(
			gitHubEnterprise.integrationId,
			{ ...primarySessionFor(gitHubEnterprise), accessToken: 'token-fresh' },
			{ signOutMark: mark },
		);

		assert.equal(stored, false, 'the removed connection is not stored back');
		assert.equal(
			await runtime.storage.getSecret(`integration.auth.cloud:${gitHubEnterprise.integrationId}|${tokenId}`),
			undefined,
		);
		configured.dispose();
	});

	test('a cleanup of a replaced token does not refuse the store of its replacement', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const configured = new ConfiguredIntegrationService(runtime);
		const mark = configured.getSignOutMark();

		// Not a sign-out: the forced re-sync drops the token a replacement of another connection superseded.
		await configured.deleteStoredSessions(
			gitHubEnterprise.integrationId,
			{ domain: gitHubEnterprise.domain, scopes: [], connectionId: 'tok-old', cloud: true },
			true,
			{ preserveConfigured: true },
		);
		const stored = await configured.storeSession(
			gitHubEnterprise.integrationId,
			{ ...primarySessionFor(gitHubEnterprise), accessToken: 'token-fresh' },
			{ signOutMark: mark },
		);

		assert.equal(stored, true);
		configured.dispose();
	});

	test('a sign-out during a store waits for it and removes what it wrote', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const configured = new ConfiguredIntegrationService(runtime);
		const key = `integration.auth.cloud:${gitHubEnterprise.integrationId}|tok-other`;

		// A store of another connection's token (what a cloud reconcile writes) is held between its secret and its
		// descriptor when the user signs out of the host.
		let release: (() => void) | undefined;
		const released = new Promise<void>(resolve => (release = resolve));
		const storeSecret = runtime.storage.storeSecret.bind(runtime.storage);
		let onHeld: (() => void) | undefined;
		const held = new Promise<void>(resolve => (onHeld = resolve));
		let holding = false;
		runtime.storage.storeSecret = async (secretKey: string, value: string) => {
			await storeSecret(secretKey, value);
			if (secretKey === key && !holding) {
				holding = true;
				onHeld?.();
				await released;
			}
		};
		const store = configured.storeSession(
			gitHubEnterprise.integrationId,
			{ ...primarySessionFor(gitHubEnterprise), id: 'tok-other', accessToken: 'token-other' },
			{ signOutMark: configured.getSignOutMark() },
		);
		await held;
		const signOut = configured.deleteAllStoredSessions(
			gitHubEnterprise.integrationId,
			undefined,
			gitHubEnterprise.domain,
		);
		release?.();
		await store;
		await signOut;
		runtime.storage.storeSecret = storeSecret;

		assert.equal(await runtime.storage.getSecret(key), undefined, 'the sign-out removed the token it waited for');
		assert.deepEqual(configured.getConfigured(gitHubEnterprise.integrationId), [], 'and its descriptor');
		configured.dispose();
	});

	test('a forced new session refuses the store of a token of the host fetched before it', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();
		const integration = ghe as unknown as {
			authenticationService: {
				get: (id: string) => Promise<{
					getSession: (descriptor: unknown, options?: object) => Promise<unknown>;
				}>;
			};
			authProvider: { id: string };
			authProviderDescriptor: object;
		};
		const configured = (
			integration.authenticationService as unknown as {
				configuredIntegrationService: ConfiguredIntegrationService;
			}
		).configuredIntegrationService;
		const mark = configured.getSignOutMark();

		// The reauthentication's sign-out lands after a token of the host was fetched (the sign-in itself is abandoned).
		const authProvider = await integration.authenticationService.get(integration.authProvider.id);
		const account = runtime.account as unknown as { connect?: () => Promise<boolean> };
		account.connect = () => Promise.resolve(false);
		await authProvider.getSession(integration.authProviderDescriptor, { forceNewSession: true });
		const stored = await configured.storeSession(
			gitHubEnterprise.integrationId,
			{ ...primarySessionFor(gitHubEnterprise), accessToken: 'token-fresh' },
			{ signOutMark: mark },
		);

		assert.equal(stored, false, 'a token fetched before the reauthentication is not stored back');
		manager.dispose();
	});

	test('a disconnect queued behind a forced re-sync lands once the re-sync settles', async () => {
		const { runtime } = createRuntime(() => 200, false, gitHubEnterprise);
		await seedConnection(runtime, { expired: false }, gitHubEnterprise);
		const manager = createIntegrationManager(runtime);
		const ghe = await manager.get(gitHubEnterprise.integrationId, gitHubEnterprise.domain);
		assert.ok(ghe != null);
		await ghe.isConnected();

		let release: (() => void) | undefined;
		const released = new Promise<void>(resolve => (release = resolve));
		const fetchGkApi = runtime.account.fetchGkApi;
		runtime.account.fetchGkApi = async (path: string, init?: RequestInit) => {
			await released;
			return fetchGkApi(path, init);
		};
		const resync = ghe.syncCloudConnection('connected', true);
		let disconnectSettled = false;
		const disconnect = ghe.disconnect({ silent: true }).then(() => (disconnectSettled = true));
		for (let i = 0; i < 10; i++) {
			await new Promise(resolve => setImmediate(resolve));
		}

		assert.equal(disconnectSettled, false, 'the disconnect waits for the re-sync in flight');
		assert.equal(ghe.maybeConnected, true, 'the session kept by the re-sync still serves reads meanwhile');
		release?.();
		await resync;
		await disconnect;
		runtime.account.fetchGkApi = fetchGkApi;

		assert.equal(ghe.maybeConnected, false, 'then the disconnect lands');
		assert.equal(await ghe.getSession('integrations'), undefined);
		manager.dispose();
	});

	test('a terminal 404 on the token fetch still reports the connection as gone', async () => {
		const { runtime } = createRuntime(() => 404);
		await seedConnection(runtime, { expired: true });
		const manager = createIntegrationManager(runtime);
		stubOrgRead(await manager.get(GitCloudHostIntegrationId.GitHub));

		const result = await manager.listOrgs({ providerId: GitCloudHostIntegrationId.GitHub, connectionId: tokenId });

		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['no-connection'],
		);
		manager.dispose();
	});

	test('a current-account lookup whose token fetch hits a 429 reports a rate limit', async () => {
		const { runtime } = createRuntime(() => 429);
		await seedConnection(runtime, { expired: true });
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { getProviderCurrentAccount: () => Promise<unknown> }).getProviderCurrentAccount = () =>
			Promise.resolve({ id: 'me', username: 'me' });

		const result = await manager.getCurrentAccount({
			providerId: GitCloudHostIntegrationId.GitHub,
			connectionId: tokenId,
		});

		assert.equal(result.account, undefined);
		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['rate-limit'],
		);
		manager.dispose();
	});

	test('a repository lookup whose token fetch hits a 429 is undetermined, not unauthorized', async () => {
		const { runtime } = createRuntime(() => 429);
		await seedConnection(runtime, { expired: true });
		const manager = createIntegrationManager(runtime);

		const result = await manager.resolveRepository({
			providerId: GitCloudHostIntegrationId.GitHub,
			remoteUrl: 'https://github.com/octocat/hello.git',
			connectionId: tokenId,
		});

		assert.equal(result.resolution.status, 'undetermined');
		assert.equal(result.resolution.warning?.kind, 'rate-limit');
		manager.dispose();
	});

	test('a forced refresh answered with a terminal 404 drops the stored token', async () => {
		const { runtime } = createRuntime(() => 404);
		await seedConnection(runtime, { expired: false });
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		const seen: string[] = [];
		(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
			Promise.resolve({
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repos,
				getPullRequestsForRepos: (token: { accessToken: string }) => {
					seen.push(token.accessToken);
					return Promise.resolve({ values: [] });
				},
			});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			connectionId: tokenId,
			repos: [{ namespace: 'o', name: 'r' }],
			forceSync: true,
		});

		assert.deepEqual(seen, [], 'no read is made with the token the cloud says is gone');
		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['no-connection'],
		);
		assert.equal(
			await runtime.storage.getSecret(`integration.auth.cloud:${GitCloudHostIntegrationId.GitHub}|${tokenId}`),
			undefined,
		);
		manager.dispose();
	});

	test('a forced refresh that hits a 429 keeps the stored token, so the read still succeeds', async () => {
		let status = 429;
		const { runtime, paths } = createRuntime(() => status);
		await seedConnection(runtime, { expired: false });
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		const seen: string[] = [];
		(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
			Promise.resolve({
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repos,
				getPullRequestsForRepos: (token: { accessToken: string }) => {
					seen.push(token.accessToken);
					return Promise.resolve({ values: [] });
				},
			});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			connectionId: tokenId,
			repos: [{ namespace: 'o', name: 'r' }],
			forceSync: true,
		});

		assert.ok(
			paths.includes(`v1/provider-tokens/tokens/${tokenId}`),
			'the forced refresh asked the cloud for a new token',
		);
		assert.deepEqual(result.warnings, []);
		assert.deepEqual(seen, ['token-stored'], 'the read used the token the failed refresh left in place');

		// Once the cloud answers again, the next forced refresh replaces it.
		status = 200;
		await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			connectionId: tokenId,
			repos: [{ namespace: 'o', name: 'r' }],
			forceSync: true,
		});
		assert.deepEqual(seen, ['token-stored', 'token-fresh']);
		manager.dispose();
	});

	test('a forced re-sync whose token belongs to another connection drops the one it replaced', async () => {
		const runtime = createFakeRuntime();
		runtime.account.getAccount = async () => ({ id: 'me' });
		runtime.account.fetchGkApi = () =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						data: {
							tokenId: 'tok-2',
							accessToken: 'token-other-account',
							domain: 'github.com',
							expiresIn: NON_EXPIRING_SECONDS,
							scopes: 'repo',
							type: 'oauth',
						},
					}),
					{ status: 200 },
				),
			);
		await seedConnection(runtime, { expired: false });
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		await gh.syncCloudConnection('connected', true);

		assert.equal(
			await runtime.storage.getSecret(`integration.auth.cloud:${GitCloudHostIntegrationId.GitHub}|${tokenId}`),
			undefined,
			'the replaced connection keeps no token an unscoped read could resolve',
		);
		assert.ok(await runtime.storage.getSecret(`integration.auth.cloud:${GitCloudHostIntegrationId.GitHub}|tok-2`));
		manager.dispose();
	});

	test('a read that restores the kept token mid re-sync does not stop the forced refetch', async () => {
		const { runtime, paths } = createRuntime(() => 200);
		await seedConnection(runtime, { expired: false });
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		// The forced re-sync awaits clearing its "connected" flag before it fetches. A primary read landing in that
		// gap serves the token the re-sync kept in storage, which puts it back in the cached session.
		const deleteWorkspace = runtime.storage.deleteWorkspace.bind(runtime.storage);
		let interleaved: Promise<boolean> | undefined;
		runtime.storage.deleteWorkspace = async (key: string) => {
			await deleteWorkspace(key);
			interleaved ??= gh.isConnected();
		};

		await gh.syncCloudConnection('connected', true);
		await interleaved;

		assert.ok(interleaved, 'the concurrent read ran inside the re-sync');
		assert.ok(
			paths.some(p => p.startsWith('v1/provider-tokens/')),
			'the forced re-sync still fetched a fresh token from the cloud',
		);
		assert.equal(
			(gh as unknown as { _session?: ProviderAuthenticationSession })._session?.accessToken,
			'token-fresh',
		);
		manager.dispose();
	});

	test('a read of the kept token that settles after the forced refetch does not overwrite its result', async () => {
		const { runtime } = createRuntime(() => 200);
		await seedConnection(runtime, { expired: false });
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		const authProvider = await (
			gh as unknown as {
				authenticationService: {
					get: (id: string) => Promise<{
						getSession: (descriptor: unknown, options?: { sync?: boolean }) => Promise<unknown>;
					}>;
				};
				authProvider: { id: string };
			}
		).authenticationService.get((gh as unknown as { authProvider: { id: string } }).authProvider.id);

		// A plain read that resolved the token the re-sync kept, but whose answer arrives only after the forced
		// re-sync has returned, so its write is certain to land last.
		let releaseRead: (() => void) | undefined;
		const readReleased = new Promise<void>(resolve => (releaseRead = resolve));
		const getSession = authProvider.getSession.bind(authProvider);
		authProvider.getSession = async (descriptor: unknown, options?: { sync?: boolean }) => {
			const session = await getSession(descriptor, options);
			if (options?.sync) return session;

			await readReleased;
			return { ...(session as object), accessToken: 'token-stored' };
		};
		const deleteWorkspace = runtime.storage.deleteWorkspace.bind(runtime.storage);
		let concurrent: Promise<boolean> | undefined;
		runtime.storage.deleteWorkspace = async (key: string) => {
			await deleteWorkspace(key);
			concurrent ??= gh.isConnected();
		};

		await gh.syncCloudConnection('connected', true);
		releaseRead?.();
		await concurrent;

		assert.equal(
			(gh as unknown as { _session?: ProviderAuthenticationSession })._session?.accessToken,
			'token-fresh',
			'the refetched token stays the session',
		);
		manager.dispose();
	});
});

/** A connected GitHub integration whose cached session is the stored token, plus the token fetches it makes. */
async function connectedGitHub(status: () => number) {
	const { runtime, paths } = createRuntime(status);
	await seedConnection(runtime, { expired: false });
	const manager = createIntegrationManager(runtime);
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	assert.equal((await gh.getSession('test'))?.accessToken, 'token-stored');
	paths.length = 0;
	return { runtime: runtime, paths: paths, manager: manager, gh: gh };
}

/**
 * `getSession()` for a consumer that sends the token itself (code suggestions, cloud patches): it used to hand an expired
 * session's token back as is while the GK API could not replace it (#5943).
 */
suite('getSession() with an expired cached session (#5943)', () => {
	test('a valid session is returned as is, with no request', async () => {
		const { paths, manager, gh } = await connectedGitHub(() => 200);

		const session = gh.getSession('code-suggest');

		assert.ok(!(session instanceof Promise), 'a valid cached session is returned synchronously');
		assert.equal(session?.accessToken, 'token-stored');
		assert.deepEqual(paths, []);
		manager.dispose();
	});

	test('an expired session is refreshed before it is returned', async () => {
		const { paths, manager, gh } = await connectedGitHub(() => 200);
		expireCachedSession(gh);

		const session = await gh.getSession('code-suggest');

		assert.equal(session?.accessToken, 'token-fresh');
		assert.equal(paths.length, 1, 'one token fetch');
		manager.dispose();
	});

	test('an expired session the GK API cannot refresh is not returned, and the integration stays connected', async () => {
		let status = 200;
		const { paths, manager, gh } = await connectedGitHub(() => status);
		expireCachedSession(gh);
		status = 429;

		assert.equal(await gh.getSession('code-suggest'), undefined, 'the expired token is not handed out');
		assert.equal(
			(gh as unknown as { _session?: ProviderAuthenticationSession })._session?.accessToken,
			'token-stored',
			'the cached session is kept',
		);
		assert.equal(gh.maybeConnected, true);

		paths.length = 0;
		assert.equal(await gh.isConnected(), true, 'a throttled refresh is not a missing connection');
		assert.deepEqual(paths, [], 'a connection check makes no request for an expired session');

		status = 503;
		assert.equal(await gh.getSession('cloud-patches'), undefined);

		// Recovers once the cloud answers again.
		status = 200;
		assert.equal((await gh.getSession('code-suggest'))?.accessToken, 'token-fresh');
		manager.dispose();
	});

	test('concurrent lookups of an expired session share one refresh', async () => {
		const { paths, manager, gh } = await connectedGitHub(() => 200);
		expireCachedSession(gh);

		const sessions = await Promise.all([gh.getSession('code-suggest'), gh.getSession('cloud-patches')]);

		assert.deepEqual(
			sessions.map(s => s?.accessToken),
			['token-fresh', 'token-fresh'],
		);
		assert.equal(paths.length, 1, 'one token fetch');
		manager.dispose();
	});

	test('a lookup whose refresh is overtaken by a disconnect answers nothing', async () => {
		let status = 200;
		const { runtime, manager, gh } = await connectedGitHub(() => status);
		expireCachedSession(gh);
		status = 429;

		// The user disconnects while the lookup's refresh is in flight; the disconnect queues behind it.
		const deleteWorkspace = runtime.storage.deleteWorkspace.bind(runtime.storage);
		let disconnected: Promise<void> | undefined;
		runtime.storage.deleteWorkspace = async (key: string) => {
			await deleteWorkspace(key);
			disconnected ??= gh.disconnect({ silent: true });
		};

		assert.equal(await gh.getSession('code-suggest'), undefined, 'the throttled refresh hands out nothing');
		runtime.storage.deleteWorkspace = deleteWorkspace;
		assert.ok(disconnected != null, 'the disconnect ran during the refresh');
		await disconnected;
		assert.equal(gh.maybeConnected, false);
		assert.equal(await gh.getSession('code-suggest'), undefined);
		manager.dispose();
	});

	test('a disconnect queued behind a successful refresh stands, and no token is served after it', async () => {
		const { runtime, manager, gh } = await connectedGitHub(() => 200);
		expireCachedSession(gh);

		// Hold the token fetch so the user disconnects while it is in flight; it then succeeds.
		let releaseFetch: (() => void) | undefined;
		const fetchHeld = new Promise<void>(resolve => (releaseFetch = resolve));
		let fetchStarted: (() => void) | undefined;
		const started = new Promise<void>(resolve => (fetchStarted = resolve));
		const fetchGkApi = runtime.account.fetchGkApi.bind(runtime.account);
		runtime.account.fetchGkApi = async (path: string, init?: RequestInit) => {
			fetchStarted?.();
			await fetchHeld;
			return fetchGkApi(path, init);
		};

		const lookup = gh.getSession('code-suggest');
		await started;
		// Queued behind the refresh in flight, so it lands once the refresh settles.
		const disconnected = gh.disconnect({ silent: true });
		releaseFetch?.();

		// The lookup settles before the queued disconnect commits, so it gets the refreshed token, never the expired one.
		assert.equal((await lookup)?.accessToken, 'token-fresh');
		await disconnected;
		runtime.account.fetchGkApi = fetchGkApi;
		assert.equal(gh.maybeConnected, false, 'the disconnect stands');
		assert.equal(await gh.getSession('code-suggest'), undefined);
		assert.equal(await gh.isConnected(), false);
		manager.dispose();
	});
});
