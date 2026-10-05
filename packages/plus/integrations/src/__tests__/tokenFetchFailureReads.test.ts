import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
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

function tokenResponse(accessToken: string): Response {
	return new Response(
		JSON.stringify({
			data: {
				tokenId: tokenId,
				accessToken: accessToken,
				domain: 'github.com',
				expiresIn: NON_EXPIRING_SECONDS,
				scopes: 'repo',
				type: 'oauth',
			},
		}),
		{ status: 200 },
	);
}

/** A runtime whose token endpoints answer `status()` (or a fresh token on 200), recording each path. */
function createRuntime(status: () => number, bodyless = false) {
	const runtime = createFakeRuntime();
	const paths: string[] = [];
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = (path: string) => {
		paths.push(path);
		const code = status();
		if (code === 200) return Promise.resolve(tokenResponse('token-fresh'));
		// A throttled gateway often answers with no body at all, which must classify exactly like one with a body.
		if (bodyless) return Promise.resolve(new Response(null, { status: code }));
		return Promise.resolve(new Response(JSON.stringify({ error: 'nope' }), { status: code }));
	};
	return { runtime: runtime, paths: paths };
}

/** Seeds the connection's stored token; `expired` forces the read to fetch a new one from the cloud. */
async function seedConnection(runtime: ReturnType<typeof createFakeRuntime>, options: { expired: boolean }) {
	await runtime.storage.store('integrations:configured', {
		[GitCloudHostIntegrationId.GitHub]: [
			{
				id: tokenId,
				cloud: true,
				integrationId: GitCloudHostIntegrationId.GitHub,
				scopes: 'repo',
				primary: true,
			},
		],
	});
	await runtime.storage.storeSecret(
		`integration.auth.cloud:${GitCloudHostIntegrationId.GitHub}|${tokenId}`,
		JSON.stringify({
			id: tokenId,
			accessToken: 'token-stored',
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
			expiresAt: new Date(Date.now() + (options.expired ? -1000 : NON_EXPIRING_SECONDS * 1000)),
		}),
	);
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
		let interleaved = false;
		runtime.storage.deleteWorkspace = async (key: string) => {
			await deleteWorkspace(key);
			if (interleaved) return;

			interleaved = true;
			await gh.isConnected();
		};

		await gh.syncCloudConnection('connected', true);

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
