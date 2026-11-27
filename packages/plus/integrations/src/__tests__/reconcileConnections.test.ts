import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Account } from '@gitlens/git/models/author.js';
import { defer } from '@gitlens/utils/promise.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import type { StoredIntegrationConfigurations } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Drives the full cloud-sync path (`refreshConnections` → `syncCloudIntegrations` →
 * `reconcileCloudConnections`) against a mocked `v1/provider-tokens` backend to verify multi-account
 * end-to-end: list flattening, per-connection token fetch, account-name precedence, and the
 * prune-on-transient-failure guard.
 */

interface TokenBackend {
	/** GET /v1/provider-tokens list payload (primary + secondaries per provider). */
	connections: unknown;
	/** Optional status for the connection-list response. */
	connectionsStatus?: number;
	/** Per-path token responses; return null to simulate a failed/absent token. */
	token: (path: string) => unknown | Promise<unknown>;
	/** HTTP status for a failed token fetch (token() returned null). Defaults to 500 (transient). */
	errorStatus?: number;
}

function createManager(backend: TokenBackend, sharedStorage?: ReturnType<typeof createFakeRuntime>['storage']) {
	const fake = createFakeRuntime();
	const runtime = sharedStorage ? { ...fake, storage: sharedStorage } : fake;
	const paths: string[] = [];
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async (path: string) => {
		paths.push(path);
		let payload: unknown = { data: null };
		let status = 200;
		if (path === 'v1/provider-tokens') {
			status = backend.connectionsStatus ?? 200;
			payload = status >= 200 && status < 300 ? { data: backend.connections } : { error: 'boom' };
		} else if (path.startsWith('v1/provider-tokens/')) {
			const data = await backend.token(path);
			if (data == null) {
				status = backend.errorStatus ?? 500;
				payload = { error: 'boom' };
			} else {
				payload = { data: data };
			}
		}
		return new Response(JSON.stringify(payload), { status: status });
	};
	return { runtime: runtime, manager: createIntegrationManager(runtime), paths: paths };
}

/** Flush the (all-synchronous-resolving) mocked async chain triggered by a fire-and-forget sync. */
async function flush(): Promise<void> {
	for (let i = 0; i < 25; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

const githubToken = (path: string) => {
	const tokenId = path === 'v1/provider-tokens/github' ? 'p1' : path.split('/').pop();
	return { tokenId: tokenId, accessToken: `tok-${tokenId}`, expiresIn: 3600, scopes: 'repo', type: 'oauth' };
};

const githubId = GitCloudHostIntegrationId.GitHub;
function githubConnection(id: string, secondaries: string[] = []) {
	return {
		tokenId: id,
		provider: 'github',
		type: 'oauth',
		domain: 'github.com',
		accountName: id,
		secondaries: secondaries.map(s => ({
			tokenId: s,
			provider: 'github',
			type: 'oauth',
			domain: 'github.com',
			accountName: s,
		})),
	};
}
function githubSession(id: string, token = id): ProviderAuthenticationSession {
	return {
		id: id,
		accessToken: token,
		account: { id: '', label: id },
		domain: 'github.com',
		cloud: true,
		type: 'oauth',
		scopes: ['repo'],
	};
}

suite('cloud sync — multi-account reconcile (#5430)', () => {
	for (const force of [false, true]) {
		test(`logout is serialized after an in-flight ${force ? 'forced' : 'routine'} authenticated list`, async () => {
			const { manager, runtime } = createManager({ connections: [githubConnection('p1')], token: githubToken });
			const store = new ConfiguredIntegrationService(runtime);
			await store.storeSession(githubId, githubSession('p1'));
			let account: { id: string } | undefined = { id: 'me' };
			runtime.account.getAccount = async () => account;
			const entered = defer<void>();
			const release = defer<void>();
			const fetch = runtime.account.fetchGkApi;
			runtime.account.fetchGkApi = async (path, init) => {
				if (path === 'v1/provider-tokens') {
					entered.fulfill();
					await release.promise;
				}
				return fetch(path, init);
			};
			runtime.fireSubscriptionCheckIn(force);
			await entered.promise;
			account = undefined;
			runtime.fireSubscriptionChange();
			await new Promise(resolve => setImmediate(resolve));
			release.fulfill();
			await flush();
			assert.deepEqual(manager.getConfigured(githubId), []);
			assert.equal(await runtime.storage.getSecret('integration.auth.cloud:github|p1'), undefined);
			assert.deepEqual(
				runtime.emittedEvents.filter(e => e.event === 'integration.connection.count.changed').at(-1)?.props
					?.integrationIds,
				[],
			);
			manager.dispose();
			store.dispose();
		});
	}

	for (const fresh of [false, true]) {
		test(`a delayed logout retires only credentials acquired before it (${fresh ? 'fresh token' : 'cached list'})`, async () => {
			let token = 'first';
			const { manager, runtime } = createManager({
				connections: [githubConnection('p1')],
				token: path => ({ ...githubToken(path), accessToken: token }),
			});
			const store = new ConfiguredIntegrationService(runtime);
			const earlier = defer<undefined>();
			const second = createManager(
				{
					connections: [githubConnection('p1')],
					token: path => ({ ...githubToken(path), accessToken: token }),
				},
				runtime.storage,
			);
			try {
				await manager.refreshConnections();
				const integration = await manager.get(githubId);
				assert.equal((await integration.getCredential('integrations'))?.accessToken, 'first');
				const other = await second.manager.get(githubId);
				await other.getCredential('integrations');
				second.paths.length = 0;
				runtime.account.getAccount = () => earlier.promise;
				const logout = manager['onSubscriptionChanged']();
				token = 'second';
				runtime.account.getAccount = async () => ({ id: 'second' });
				second.runtime.account.getAccount = runtime.account.getAccount;
				await second.manager['syncCloudIntegrations'](fresh);
				assert.equal(
					second.paths.some(path => path.startsWith('v1/provider-tokens/')),
					fresh,
				);
				earlier.fulfill(undefined);
				await logout;
				assert.notEqual((await integration.getCredential('integrations'))?.accessToken, 'first');
				assert.equal(
					(await store.peekStoredSession(githubId, 'p1', true, 'github.com'))?.accessToken,
					fresh ? token : undefined,
				);
			} finally {
				earlier.fulfill(undefined);
				second.manager.dispose();
				manager.dispose();
				store.dispose();
			}
		});
	}

	for (const fetchFirst of [true, false]) {
		test(`logout retires a token fetch that settles ${fetchFirst ? 'before' : 'after'} the credential clear`, async () => {
			const entered = defer<void>();
			const release = defer<void>();
			const { runtime, manager } = createManager({
				connections: [githubConnection('p1')],
				token: async path => {
					entered.fulfill();
					await release.promise;
					return githubToken(path);
				},
			});
			const store = new ConfiguredIntegrationService(runtime);
			await store.storeSession(githubId, { ...githubSession('p1'), expiresAt: new Date(0) });
			let loggedIn = true;
			const logoutSeen = defer<void>();
			const clear = defer<void>();
			runtime.account.getAccount = async () => {
				if (loggedIn) return { id: 'me' };

				logoutSeen.fulfill();
				if (fetchFirst) {
					await clear.promise;
				}
				return undefined;
			};
			const integration = await manager.get(githubId);
			(
				integration as unknown as { getProviderCurrentAccount: () => Promise<Pick<Account, 'id'>> }
			).getProviderCurrentAccount = async () => ({ id: 'viewer' });
			const pending = manager.getCurrentAccount({ providerId: githubId, connectionId: 'p1' });
			await entered.promise;
			loggedIn = false;
			runtime.fireSubscriptionChange();
			await logoutSeen.promise;
			if (!fetchFirst) {
				await flush();
			}
			release.fulfill();
			await pending;
			clear.fulfill();
			await flush();
			assert.deepEqual(manager.getConfigured(githubId), []);
			assert.equal(await runtime.storage.getSecret('integration.auth.cloud:github|p1'), undefined);
			assert.deepEqual(
				runtime.emittedEvents.filter(e => e.event === 'integration.connection.count.changed').at(-1)?.props
					?.integrationIds,
				[],
			);
			manager.dispose();
			store.dispose();
		});
	}

	test('logout clears stored cloud tokens when the active session is a local PAT', async () => {
		const { manager, runtime } = createManager({ connections: [], token: githubToken });
		const store = new ConfiguredIntegrationService(runtime);
		await store.storeSession(githubId, { ...githubSession('p1', 'local'), cloud: false, type: 'pat' });
		await store.storeSession(githubId, githubSession('p1', 'cloud'));
		const github = await manager.get(githubId);
		assert.equal((await github.getSession('integrations'))?.accessToken, 'local');
		runtime.account.getAccount = async () => undefined;
		runtime.fireSubscriptionChange();
		await flush();
		assert.equal(await runtime.storage.getSecret('integration.auth.cloud:github|p1'), undefined);
		assert.equal((await github.getSession('integrations'))?.accessToken, 'local');
		assert.deepEqual(
			store.getConfigured(githubId).map(c => c.cloud),
			[false],
		);
		manager.dispose();
		store.dispose();
	});

	for (const hold of ['list', 'primary', 'reconcile']) {
		test(`a cached later list supersedes older work waiting on the ${hold} request`, async () => {
			const entered = defer<void>();
			const release = defer<void>();
			const first = createManager({
				connections: hold === 'list' ? [] : [githubConnection('p1', ['s1'])],
				token: async path => {
					if (path === (hold === 'primary' ? 'v1/provider-tokens/github' : 'v1/provider-tokens/tokens/p1')) {
						entered.fulfill();
						await release.promise;
					}
					return { ...githubToken(path), accessToken: 'older-sync' };
				},
			});
			const second = createManager(
				{ connections: [githubConnection('s1', ['p1'])], token: githubToken },
				first.runtime.storage,
			);
			const store = new ConfiguredIntegrationService(first.runtime);
			await store.storeSession(githubId, githubSession('p1'));
			await store.storeSession(githubId, githubSession('s1'));
			assert.ok(await (await second.manager.get(githubId)).isConnected());
			if (hold === 'list') {
				const fetch = first.runtime.account.fetchGkApi;
				first.runtime.account.fetchGkApi = async (path, init) => {
					if (path === 'v1/provider-tokens') {
						entered.fulfill();
						await release.promise;
					}
					return fetch(path, init);
				};
			}
			const pending = first.manager.refreshConnections();
			await entered.promise;
			second.runtime.fireSubscriptionCheckIn(false);
			await flush();
			assert.deepEqual(second.paths, ['v1/provider-tokens']);
			const before = await store.peekStoredSession(githubId, 'p1', true, 'github.com');
			release.fulfill();
			await pending;
			assert.deepEqual(
				store
					.getConfigured(githubId)
					.map(c => c.id)
					.sort(),
				['p1', 's1'],
			);
			assert.equal(store.getConfigured(githubId).find(c => c.primary)?.id, 's1');
			assert.equal(
				(await store.peekStoredSession(githubId, 'p1', true, 'github.com'))?.accessToken,
				before?.accessToken,
			);
			first.manager.dispose();
			second.manager.dispose();
			store.dispose();
		});
	}

	test('a newer failed list leaves the earlier authenticated list authoritative', async () => {
		const first = createManager({ connections: [], token: githubToken });
		const second = createManager(
			{ connections: [], connectionsStatus: 503, token: githubToken },
			first.runtime.storage,
		);
		const store = new ConfiguredIntegrationService(first.runtime);
		await store.storeSession(githubId, githubSession('p1'));
		const entered = defer<void>();
		const release = defer<void>();
		const fetch = first.runtime.account.fetchGkApi;
		first.runtime.account.fetchGkApi = async (path, init) => {
			if (path === 'v1/provider-tokens') {
				entered.fulfill();
				await release.promise;
			}
			return fetch(path, init);
		};
		const pending = first.manager.refreshConnections();
		await entered.promise;
		await assert.rejects(second.manager.refreshConnections(), /Failed to refresh provider connections/);
		release.fulfill();
		await pending;
		assert.deepEqual(store.getConfigured(githubId), []);
		assert.equal(await first.runtime.storage.getSecret('integration.auth.cloud:github|p1'), undefined);
		first.manager.dispose();
		second.manager.dispose();
		store.dispose();
	});

	test('a cached list confirming the existing primary prevents an older unscoped GET from selecting a different account', async () => {
		const entered = defer<void>();
		const release = defer<void>();
		const first = createManager({
			connections: [],
			token: async () => {
				entered.fulfill();
				await release.promise;
				return githubToken('b');
			},
		});
		const second = createManager(
			{ connections: [githubConnection('a', ['b'])], token: githubToken },
			first.runtime.storage,
		);
		const store = new ConfiguredIntegrationService(first.runtime);
		for (const id of ['a', 'b']) {
			await store.storeSession(githubId, githubSession(id));
		}
		const old = await first.manager.get(githubId);
		assert.ok(await old.isConnected());
		assert.ok(await (await second.manager.get(githubId)).isConnected());
		const pending = old.syncCloudConnection('connected', true);
		await entered.promise;
		second.runtime.fireSubscriptionCheckIn(false);
		await flush();
		assert.deepEqual(second.paths, ['v1/provider-tokens']);
		release.fulfill();
		await pending;
		assert.equal(store.getConfigured(githubId).find(c => c.primary)?.id, 'a');
		assert.equal((await old.getSession('integrations'))?.id, 'a');
		first.manager.dispose();
		second.manager.dispose();
		store.dispose();
	});

	test('a warm check-in selects its listed primary and preserves a newly refreshed unlisted account', async () => {
		const { runtime, manager, paths } = createManager({
			connections: [githubConnection('b', ['a'])],
			token: githubToken,
		});
		const store = new ConfiguredIntegrationService(runtime);
		for (const id of ['a', 'b', 'c']) {
			await store.storeSession(githubId, githubSession(id));
		}
		const github = await manager.get(githubId);
		assert.equal((await github.getSession('integrations'))?.id, 'a');
		const fetch = runtime.account.fetchGkApi;
		runtime.account.fetchGkApi = async (path, init) => {
			if (path === 'v1/provider-tokens') {
				await store.storeSession(githubId, githubSession('c', 'updated'));
			}
			return fetch(path, init);
		};
		runtime.fireSubscriptionCheckIn(false);
		await flush();
		assert.deepEqual(paths, ['v1/provider-tokens']);
		assert.equal(store.getConfigured(githubId).find(c => c.primary)?.id, 'b');
		assert.equal((await github.getSession('integrations'))?.id, 'b');
		assert.equal((await store.peekStoredSession(githubId, 'c', true, 'github.com'))?.accessToken, 'updated');
		store.dispose();
		manager.dispose();
	});

	test('refreshing a scoped token cannot invalidate a newer named primary observation', async () => {
		const entered = defer<void>();
		const release = defer<void>();
		const { runtime, manager } = createManager({
			connections: [githubConnection('a', ['b', 'c'])],
			token: async path => {
				if (path === 'v1/provider-tokens/github') {
					entered.fulfill();
					await release.promise;
					return githubToken('b');
				}
				return githubToken(path);
			},
		});
		const store = new ConfiguredIntegrationService(runtime);
		for (const id of ['a', 'b', 'c']) {
			await store.storeSession(githubId, githubSession(id));
		}
		const pending = manager.refreshConnections();
		await entered.promise;
		await store.storeSession(githubId, githubSession('c', 'scoped-refresh'));
		release.fulfill();
		await pending;
		assert.equal(store.getConfigured(githubId).find(c => c.primary)?.id, 'b');
		manager.dispose();
		store.dispose();
	});

	test('an empty list cannot disconnect a first account published while the list is pending', async () => {
		const { manager, runtime } = createManager({ connections: [], token: githubToken });
		const configured = new ConfiguredIntegrationService(runtime);
		const github = GitCloudHostIntegrationId.GitHub;
		const entered = defer<void>();
		const release = defer<void>();
		const fetch = runtime.account.fetchGkApi;
		runtime.account.fetchGkApi = async (path, init) => {
			if (path === 'v1/provider-tokens') {
				entered.fulfill();
				await release.promise;
			}
			return fetch(path, init);
		};
		const refresh = manager.refreshConnections();
		await entered.promise;
		const writeStarted = defer<void>();
		const finishWrite = defer<void>();
		const storeSecret = runtime.storage.storeSecret;
		runtime.storage.storeSecret = async (key, value) => {
			writeStarted.fulfill();
			await finishWrite.promise;
			await storeSecret(key, value);
		};
		const write = configured.storeSession(github, {
			id: 'new',
			accessToken: 'new-token',
			cloud: true,
			domain: 'github.com',
			scopes: ['repo'],
			account: { id: 'new', label: 'New' },
			type: 'oauth',
		});
		await writeStarted.promise;
		release.fulfill();
		await new Promise(resolve => setImmediate(resolve));
		finishWrite.fulfill();
		assert.ok(await write);
		await refresh;
		assert.deepEqual(
			manager.getConfigured(github).map(c => c.id),
			['new'],
		);
		const integration = await manager.get(github);
		assert.equal((await integration.getSession('integrations'))?.accessToken, 'new-token');
		const published = runtime.emittedEvents.filter(e => e.event === 'integration.connection.count.changed');
		assert.deepEqual(published.at(-1)?.props?.integrationIds, [github]);
		manager.dispose();
		configured.dispose();
	});

	test('a warm integration re-resolves the credential that superseded a disconnected list', async () => {
		const github = GitCloudHostIntegrationId.GitHub;
		const { manager, runtime } = createManager({ connections: [], token: githubToken });
		const store = new ConfiguredIntegrationService(runtime);
		const initial: ProviderAuthenticationSession = {
			id: 'p1',
			accessToken: 'old',
			cloud: true,
			domain: 'github.com',
			scopes: ['repo'],
			type: 'oauth',
			account: { id: 'p1', label: 'p1' },
		};
		await store.storeSession(github, initial);
		const integration = await manager.get(github);
		assert.equal((await integration.getSession('integrations'))?.accessToken, 'old');
		const fetch = runtime.account.fetchGkApi;
		runtime.account.fetchGkApi = async (path, init) => {
			if (path === 'v1/provider-tokens') {
				await store.storeSession(github, { ...initial, accessToken: 'new' });
			}
			return fetch(path, init);
		};
		await manager.refreshConnections();
		assert.equal((await integration.getSession('integrations'))?.accessToken, 'new');
		manager.dispose();
		store.dispose();
	});

	for (const primaryId of ['new-primary', undefined]) {
		test(`reconciliation distinguishes a ${primaryId ? 'named' : 'legacy id-less'} primary response from the list it follows`, async () => {
			const github = GitCloudHostIntegrationId.GitHub;
			const { manager, runtime } = createManager({
				connections: [
					{
						tokenId: 'listed',
						provider: 'github',
						accountName: 'account',
						type: 'oauth',
						domain: 'github.com',
					},
				],
				token: path =>
					path === 'v1/provider-tokens/github'
						? {
								tokenId: primaryId,
								accessToken: 'from-primary',
								expiresIn: 3600,
								scopes: 'repo',
								type: 'oauth',
							}
						: githubToken(path),
			});
			await manager.refreshConnections();
			const configured = manager.getConfigured(github);
			const primary = configured.find(c => c.primary);
			assert.equal(primary?.id, primaryId ?? 'listed');
			assert.deepEqual(configured.map(c => c.id).sort(), primaryId ? ['listed', primaryId].sort() : ['listed']);
			assert.equal(await runtime.storage.getSecret('integration.auth.cloud:github|github.com'), undefined);
			if (primaryId) {
				const integration = await manager.get(github);
				assert.equal((await integration.getSession('integrations'))?.accessToken, 'from-primary');
			}
			manager.dispose();
		});
	}

	test('a newer named primary also supersedes the earlier ordering of two listed accounts', async () => {
		const github = GitCloudHostIntegrationId.GitHub;
		const { manager } = createManager({
			connections: [
				{
					tokenId: 'a',
					provider: 'github',
					type: 'oauth',
					accountName: 'a',
					domain: 'github.com',
					secondaries: [
						{ tokenId: 'b', provider: 'github', type: 'oauth', accountName: 'b', domain: 'github.com' },
					],
				},
			],
			token: path => githubToken(path === 'v1/provider-tokens/github' ? 'b' : path),
		});
		await manager.refreshConnections();
		assert.equal(manager.getConfigured(github).find(c => c.primary)?.id, 'b');
		manager.dispose();
	});

	test('a refreshed secondary in the same manager survives an older list and retains its explicit promotion', async () => {
		const github = GitCloudHostIntegrationId.GitHub;
		const entered = defer<void>();
		const release = defer<void>();
		const { manager, runtime } = createManager({
			connections: [
				{ tokenId: 'p1', provider: 'github', accountName: 'p1', type: 'oauth', domain: 'github.com' },
			],
			token: async path => {
				if (path === 'v1/provider-tokens/github') {
					entered.fulfill();
					await release.promise;
				}
				return githubToken(path);
			},
		});
		const configured = new ConfiguredIntegrationService(runtime);
		const initial: ProviderAuthenticationSession = {
			id: 'p1',
			accessToken: 'old-p1',
			cloud: true,
			domain: 'github.com',
			scopes: ['repo'],
			account: { id: '', label: '' },
			type: 'oauth',
		};
		await configured.storeSession(github, initial);
		await configured.storeSession(github, { ...initial, id: 's1', accessToken: 'old-s1', expiresAt: new Date(0) });
		const integration = await manager.get(github);
		(
			integration as unknown as { getProviderCurrentAccount: () => Promise<Pick<Account, 'id' | 'username'>> }
		).getProviderCurrentAccount = async () => ({ id: 'me', username: 'me' });
		const list = manager.refreshConnections();
		await entered.promise;
		await manager.getCurrentAccount({ providerId: github, connectionId: 's1' });
		await manager.setPrimaryConnection(github, 's1');
		release.fulfill();
		await list;
		assert.equal((await configured.peekStoredSession(github, 's1', true, 'github.com'))?.accessToken, 'tok-s1');
		assert.equal(manager.getConfigured(github).find(c => c.primary)?.id, 's1');
		manager.dispose();
		configured.dispose();
	});

	test('a connection added while the backend list is pending survives reconciliation of the older list', async () => {
		const { manager, runtime } = createManager({
			connections: [
				{ tokenId: 'p1', provider: 'github', type: 'oauth', domain: 'github.com', accountName: 'primary' },
			],
			token: githubToken,
		});
		const configured = new ConfiguredIntegrationService(runtime);
		const github = GitCloudHostIntegrationId.GitHub;
		const session: ProviderAuthenticationSession = {
			id: 'p1',
			accessToken: 'tok-p1',
			domain: 'github.com',
			cloud: true,
			scopes: ['repo'],
			type: 'oauth',
			account: { id: 'primary', label: 'primary' },
		};
		await configured.storeSession(github, session);
		const entered = defer<void>();
		const release = defer<void>();
		const fetch = runtime.account.fetchGkApi;
		runtime.account.fetchGkApi = async (path, init) => {
			if (path === 'v1/provider-tokens') {
				entered.fulfill();
				await release.promise;
			}
			return fetch(path, init);
		};
		const refresh = manager.refreshConnections();
		await entered.promise;
		await configured.storeSession(github, { ...session, id: 'added', accessToken: 'new' });
		release.fulfill();
		await refresh;
		assert.ok(configured.getConfigured(github).some(c => c.id === 'added'));
		assert.equal((await configured.peekStoredSession(github, 'added', true, 'github.com'))?.accessToken, 'new');
		manager.dispose();
		configured.dispose();
	});

	test('refreshConnections rejects and preserves configured state when the backend list fails', async () => {
		const { runtime, manager } = createManager({
			connections: [],
			connectionsStatus: 503,
			token: () => ({}),
		});
		await runtime.storage.store('integrations:configured', {
			github: [{ id: 'p1', cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
		});

		assert.equal(manager.getConfigured(GitCloudHostIntegrationId.GitHub).length, 1, 'cached state is hydrated');
		await assert.rejects(manager.refreshConnections(), /Failed to refresh provider connections/);
		assert.equal(
			manager.getConfigured(GitCloudHostIntegrationId.GitHub).length,
			1,
			'a failed authoritative refresh does not masquerade as a successful empty list',
		);

		manager.dispose();
	});

	test('connection mutations reject ids configured for another provider before calling the backend', async () => {
		const { runtime, manager, paths } = createManager({
			connections: [],
			token: () => ({}),
		});
		await runtime.storage.store('integrations:configured', {
			gitlab: [{ id: 'gl-1', cloud: true, integrationId: 'gitlab', scopes: 'api', primary: true }],
		});

		await assert.rejects(
			manager.setPrimaryConnection(GitCloudHostIntegrationId.GitHub, 'gl-1'),
			/Connection 'gl-1' is not configured for 'github'/,
		);
		await assert.rejects(
			manager.deleteConnection(GitCloudHostIntegrationId.GitHub, 'gl-1'),
			/Connection 'gl-1' is not configured for 'github'/,
		);
		assert.deepEqual(paths, [], 'provider-agnostic token endpoints are never called with the mismatched id');

		manager.dispose();
	});

	test('refreshConnections persists every account with wire account names and a single primary', async () => {
		const { manager } = createManager({
			connections: [
				{
					tokenId: 'p1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'octo',
					secondaries: [
						{
							tokenId: 's1',
							provider: 'github',
							type: 'oauth',
							domain: 'github.com',
							accountName: 'hubot',
						},
					],
				},
			],
			token: githubToken,
		});

		await manager.refreshConnections();

		const configured = manager.getConfigured(GitCloudHostIntegrationId.GitHub);
		const byId = new Map(configured.map(c => [c.id, c]));
		assert.deepEqual([...byId.keys()].sort(), ['p1', 's1'], 'both connections stored');
		assert.equal(byId.get('p1')?.primary, true, 'p1 is primary');
		assert.equal(byId.get('s1')?.primary ?? false, false, 's1 is not primary');
		assert.equal(configured.filter(c => c.primary).length, 1, 'exactly one primary');
		assert.equal(byId.get('p1')?.accountName, 'octo', 'primary account name from wire');
		assert.equal(byId.get('s1')?.accountName, 'hubot', 'secondary account name from wire');
		assert.equal(byId.get('p1')?.type, 'oauth');

		manager.dispose();
	});

	test('refreshConnections fetches connection sessions concurrently', async () => {
		const started = new Set<string>();
		let releaseRequests!: () => void;
		let resolveBothStarted!: () => void;
		const requestsReleased = new Promise<void>(resolve => (releaseRequests = resolve));
		const bothStarted = new Promise<void>(resolve => (resolveBothStarted = resolve));
		const { manager } = createManager({
			connections: [
				{
					tokenId: 'p1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'octo',
					secondaries: [
						{
							tokenId: 's1',
							provider: 'github',
							type: 'oauth',
							domain: 'github.com',
							accountName: 'hubot',
						},
					],
				},
			],
			token: async path => {
				const tokenId = path === 'v1/provider-tokens/github' ? 'p1' : path.split('/').pop()!;
				if (path.startsWith('v1/provider-tokens/tokens/')) {
					started.add(tokenId);
					if (started.size === 2) {
						resolveBothStarted();
					}
					await requestsReleased;
				}
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});
		const refresh = manager.refreshConnections();

		try {
			await Promise.race([
				bothStarted,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('connection session fetches remained sequential')), 1000),
				),
			]);
			assert.deepEqual(started, new Set(['p1', 's1']));
		} finally {
			releaseRequests();
			await refresh;
			manager.dispose();
		}
	});

	test('refreshConnections reconciles independent providers concurrently', async () => {
		const started = new Set<string>();
		let releaseRequests!: () => void;
		let resolveBothStarted!: () => void;
		const requestsReleased = new Promise<void>(resolve => (releaseRequests = resolve));
		const bothStarted = new Promise<void>(resolve => (resolveBothStarted = resolve));
		const { manager } = createManager({
			connections: [
				{
					tokenId: 'gh1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'octo',
				},
				{
					tokenId: 'gl1',
					provider: 'gitlab',
					type: 'oauth',
					domain: 'gitlab.com',
					accountName: 'tanuki',
				},
			],
			token: async path => {
				const provider = path.split('/').pop()!;
				if (path.startsWith('v1/provider-tokens/tokens/')) {
					const tokenId = provider;
					started.add(tokenId);
					if (started.size === 2) {
						resolveBothStarted();
					}
					await requestsReleased;
				}
				const tokenId = provider === 'github' ? 'gh1' : provider === 'gitlab' ? 'gl1' : provider;
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});
		const refresh = manager.refreshConnections();

		try {
			await Promise.race([
				bothStarted,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('provider reconciliations remained sequential')), 1000),
				),
			]);
			assert.deepEqual(started, new Set(['gh1', 'gl1']));
		} finally {
			releaseRequests();
			await refresh;
			manager.dispose();
		}
	});

	test('refreshConnections syncs cloud connections concurrently', async () => {
		// The sibling tests above gate on `v1/provider-tokens/tokens/…`, the per-connection reconcile pass.
		// This one gates on the PROVIDER-scoped path, which is what the `syncCloudConnection` loop resolves
		// through — a different pass, and the one that used to await each provider in turn.
		const started = new Set<string>();
		let releaseRequests!: () => void;
		let resolveBothStarted!: () => void;
		const requestsReleased = new Promise<void>(resolve => (releaseRequests = resolve));
		const bothStarted = new Promise<void>(resolve => (resolveBothStarted = resolve));
		const { manager } = createManager({
			connections: [
				{
					tokenId: 'gh1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'octo',
				},
				{
					tokenId: 'gl1',
					provider: 'gitlab',
					type: 'oauth',
					domain: 'gitlab.com',
					accountName: 'tanuki',
				},
			],
			token: async path => {
				const provider = path.split('/').pop()!;
				if (path === 'v1/provider-tokens/github' || path === 'v1/provider-tokens/gitlab') {
					started.add(provider);
					if (started.size === 2) {
						resolveBothStarted();
					}
					await requestsReleased;
				}
				const tokenId = provider === 'github' ? 'gh1' : provider === 'gitlab' ? 'gl1' : provider;
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});
		const refresh = manager.refreshConnections();

		try {
			await Promise.race([
				bothStarted,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('cloud connection syncs remained sequential')), 1000),
				),
			]);
			assert.deepEqual(started, new Set(['github', 'gitlab']));
		} finally {
			releaseRequests();
			await refresh;
			manager.dispose();
		}
	});

	test('blank wire account names fall back to the cached account name', async () => {
		const { runtime, manager } = createManager({
			connections: [
				{
					tokenId: 'p1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: '   ',
				},
			],
			token: githubToken,
		});
		await runtime.storage.store('integrations:configured', {
			github: [
				{
					id: 'p1',
					cloud: true,
					integrationId: 'github',
					scopes: 'repo',
					primary: true,
					accountName: 'cached-octo',
				},
			],
		});

		await manager.refreshConnections();

		const [connection] = manager.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(connection?.accountName, 'cached-octo', 'blank backend account name ignored');

		manager.dispose();
	});

	test('a transient token-fetch failure defers pruning so a still-valid connection survives', async () => {
		const { runtime, manager } = createManager({
			connections: [
				{
					tokenId: 'p1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'octo',
					secondaries: [
						{
							tokenId: 's1',
							provider: 'github',
							type: 'oauth',
							domain: 'github.com',
							accountName: 'hubot',
						},
					],
				},
			],
			// s1's token fetch fails this cycle; p1 (and the provider primary) succeed.
			token: (path: string) => (path.endsWith('/s1') ? null : githubToken(path)),
		});

		// Seed a pre-existing cloud primary plus a secondary that is NOT in the backend list. The model only
		// re-fetches the resolved primary on a forced sync, so the secondary ('stale') is untouched by the
		// model — its survival isolates the reconcile prune guard: it must NOT be pruned while a sibling
		// failed to sync (otherwise a transient blip would delete a still-valid connection).
		await runtime.storage.store('integrations:configured', {
			github: [
				{ id: 'p1', cloud: true, integrationId: 'github', scopes: 'repo', primary: true },
				{ id: 'stale', cloud: true, integrationId: 'github', scopes: 'repo', primary: false },
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|p1',
			JSON.stringify({ id: 'p1', accessToken: 'tok-p1', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|stale',
			JSON.stringify({ id: 'stale', accessToken: 'keep', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		await manager.refreshConnections();

		assert.ok(
			manager.getConfigured(GitCloudHostIntegrationId.GitHub).some(c => c.id === 'stale'),
			'stale connection preserved because pruning was deferred after a partial sync',
		);
		assert.ok(
			(await runtime.storage.getSecret('integration.auth.cloud:github|stale')) != null,
			'stale secret preserved',
		);

		manager.dispose();
	});

	test('intentionally skipped self-managed connections do not block stale pruning', async () => {
		const { runtime, manager } = createManager({
			connections: [
				{
					tokenId: 'ent-valid',
					provider: 'githubEnterprise',
					type: 'oauth',
					domain: 'ghe.example.com',
					accountName: 'ent-user',
				},
				{
					tokenId: 'ent-invalid',
					provider: 'githubEnterprise',
					type: 'oauth',
					domain: 'https://',
					accountName: 'bad-host',
				},
			],
			token: (path: string) => {
				const tokenId = path.endsWith('/githubEnterprise') ? 'ent-valid' : path.split('/').pop();
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});

		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ent-valid',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe.example.com',
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'stale',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'stale.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|stale',
			JSON.stringify({
				id: 'stale',
				accessToken: 'stale-token',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'stale.example.com',
			}),
		);

		await manager.refreshConnections();

		const configured = manager.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise);
		assert.ok(
			configured.some(c => c.id === 'ent-valid'),
			'valid backend connection remains configured',
		);
		assert.ok(
			!configured.some(c => c.id === 'stale'),
			'stale descriptor pruned even though another backend connection was intentionally skipped',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:cloud-github-enterprise|stale'),
			undefined,
			'stale secret removed',
		);

		manager.dispose();
	});

	test('refreshConnections preserves non-expiring GitHub tokens as long-lived sessions', async () => {
		const { manager } = createManager({
			connections: [
				{
					tokenId: 'p1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'octo',
				},
			],
			token: path => {
				const tokenId = path === 'v1/provider-tokens/github' ? 'p1' : path.split('/').pop();
				return { tokenId: tokenId, accessToken: `tok-${tokenId}`, expiresIn: 0, scopes: 'repo', type: 'oauth' };
			},
		});

		await manager.refreshConnections();

		const [configured] = manager.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.ok(configured.expiresAt != null, 'expiresAt is stored');
		assert.ok(
			new Date(configured.expiresAt).getTime() > Date.now() + 60_000,
			'non-expiring GitHub token should not be stored as immediately expired',
		);

		manager.dispose();
	});

	test('fully disconnecting a provider clears every account secret and descriptor', async () => {
		// Backend now reports the provider as fully disconnected (no connections).
		const { runtime, manager } = createManager({ connections: [], token: githubToken });
		await runtime.storage.store('integrations:configured', {
			github: [
				{ id: 'p1', cloud: true, integrationId: 'github', scopes: 'repo', primary: true },
				{ id: 's1', cloud: true, integrationId: 'github', scopes: 'repo', primary: false },
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|p1',
			JSON.stringify({ id: 'p1', accessToken: 'a', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|s1',
			JSON.stringify({ id: 's1', accessToken: 'b', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		await manager.refreshConnections();

		assert.equal(
			manager.getConfigured(GitCloudHostIntegrationId.GitHub).length,
			0,
			'all descriptors removed on full disconnect',
		);
		assert.equal(await runtime.storage.getSecret('integration.auth.cloud:github|p1'), undefined, 'primary cleared');
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|s1'),
			undefined,
			'secondary cleared (not orphaned)',
		);

		manager.dispose();
	});

	test('force-refreshing a cloud session preserves a local PAT sharing the same connection id', async () => {
		const { runtime, manager } = createManager({
			connections: [],
			token: () => ({
				tokenId: 'shared',
				accessToken: 'fresh-cloud-token',
				expiresIn: 3600,
				scopes: 'repo',
				type: 'oauth',
				domain: 'github.com',
			}),
		});
		await runtime.storage.store('integrations:configured', {
			github: [
				{ id: 'shared', cloud: false, integrationId: 'github', scopes: 'repo', primary: true },
				{ id: 'shared', cloud: true, integrationId: 'github', scopes: 'repo', primary: false },
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth:github|shared',
			JSON.stringify({ id: 'shared', accessToken: 'local-pat', scopes: ['repo'], cloud: false, type: 'pat' }),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|shared',
			JSON.stringify({ id: 'shared', accessToken: 'old-cloud', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		const github = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.equal(await github.isConnected(), true, 'cached session is warm before refresh');

		await github.syncCloudConnection('connected', true);

		assert.match(
			(await runtime.storage.getSecret('integration.auth:github|shared')) ?? '',
			/local-pat/,
			'local PAT secret preserved',
		);
		assert.match(
			(await runtime.storage.getSecret('integration.auth.cloud:github|shared')) ?? '',
			/fresh-cloud-token/,
			'cloud secret refreshed',
		);
		assert.equal((await github.getSession('integrations'))?.accessToken, 'fresh-cloud-token');

		manager.dispose();
	});

	test('fully disconnecting a self-managed provider clears every configured host', async () => {
		const { runtime, manager } = createManager({ connections: [], token: githubToken });
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'ghe-b1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-b.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|ghe-a1',
			JSON.stringify({
				id: 'ghe-a1',
				accessToken: 'a',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-a.example.com',
			}),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|ghe-b1',
			JSON.stringify({
				id: 'ghe-b1',
				accessToken: 'b',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-b.example.com',
			}),
		);

		await manager.refreshConnections();

		assert.equal(
			manager.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise).length,
			0,
			'all self-managed host descriptors removed on full disconnect',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:cloud-github-enterprise|ghe-a1'),
			undefined,
			'first host secret cleared',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:cloud-github-enterprise|ghe-b1'),
			undefined,
			'second host secret cleared',
		);

		manager.dispose();
	});

	test('refreshConnections disconnects a cached self-managed host missing from the backend', async () => {
		const { runtime, manager } = createManager({
			connections: [
				{
					tokenId: 'ghe-a1',
					provider: 'githubEnterprise',
					type: 'oauth',
					domain: 'ghe-a.example.com',
					accountName: 'a-one',
				},
			],
			token: (path: string) => {
				const tokenId = path.endsWith('/githubEnterprise') ? 'ghe-a1' : path.split('/').pop();
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'ghe-b1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-b.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|ghe-b1',
			JSON.stringify({
				id: 'ghe-b1',
				accessToken: 'b',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-b.example.com',
			}),
		);

		const gheB = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe-b.example.com');
		assert.ok(gheB != null, 'missing backend host integration constructs');
		assert.equal(await gheB.isConnected(), true, 'missing backend host session is warm before sync');

		await manager.refreshConnections();

		assert.equal(await gheB.isConnected(), false, 'missing backend host cache is disconnected');
		assert.ok(
			!manager.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise).some(c => c.id === 'ghe-b1'),
			'missing backend host descriptor removed',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:cloud-github-enterprise|ghe-b1'),
			undefined,
			'missing backend host secret removed',
		);

		manager.dispose();
	});

	test('deleteConnection emits disconnected for a cached provider when the last connection is removed', async () => {
		const { runtime, manager } = createManager({
			connections: [],
			token: () => ({}),
		});
		await runtime.storage.store('integrations:configured', {
			github: [{ id: 'p1', cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|p1',
			JSON.stringify({ id: 'p1', accessToken: 'tok-p1', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		const github = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.equal(await github.isConnected(), true, 'cached provider starts connected');
		await flush();
		runtime.emittedEvents.length = 0;

		await manager.deleteConnection(GitCloudHostIntegrationId.GitHub, 'p1');
		await flush();

		assert.ok(
			runtime.emittedEvents.some(
				e =>
					e.event === 'integration.connection.hosting.changed' &&
					e.props?.key === 'github' &&
					e.props?.connected === false,
			),
			'cached provider emits disconnected after deleting its last connection',
		);

		manager.dispose();
	});

	test('deleteConnection is cloud-scoped, preserving a shared-id local PAT', async () => {
		const { runtime, manager } = createManager({
			connections: [],
			token: () => ({}),
		});
		// A local (PAT) and a cloud session can legitimately share a connection id (e.g. the domain).
		await runtime.storage.store('integrations:configured', {
			github: [
				{ id: 'shared', cloud: false, integrationId: 'github', scopes: 'repo' },
				{ id: 'shared', cloud: true, integrationId: 'github', scopes: 'repo', primary: true },
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth:github|shared',
			JSON.stringify({ id: 'shared', accessToken: 'local-pat', scopes: ['repo'], cloud: false }),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|shared',
			JSON.stringify({ id: 'shared', accessToken: 'cloud-tok', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		// Public manager API call with no third argument, as an external consumer would call it.
		await manager.deleteConnection(GitCloudHostIntegrationId.GitHub, 'shared');

		assert.ok(
			(await runtime.storage.getSecret('integration.auth:github|shared')) != null,
			'local PAT secret preserved by the cloud-only deleteConnection call',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|shared'),
			undefined,
			'cloud secret removed',
		);

		manager.dispose();
	});

	test('a non-forced sync does not resurrect a provider disconnected locally', async () => {
		const { runtime, manager, paths } = createManager({
			connections: [{ tokenId: 'p1', provider: 'github', type: 'oauth', domain: '', accountName: 'octo' }],
			token: githubToken,
		});
		// The user disconnected GitHub locally; the backend still lists the token.
		await runtime.storage.storeWorkspace('connected:github', false);

		// Non-forced sync (check-in with force:false → syncCloudIntegrations(false)). A forced sync would
		// clear the local-disconnect flag and legitimately reconnect; a non-forced one must not.
		runtime.fireSubscriptionCheckIn(false);
		await flush();

		assert.ok(paths.includes('v1/provider-tokens'), 'the sync actually ran');
		assert.equal(
			manager.getConfigured(GitCloudHostIntegrationId.GitHub).length,
			0,
			'locally-disconnected provider not resurrected by reconcile',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|p1'),
			undefined,
			'no secret resurrected',
		);

		manager.dispose();
	});

	test('resolves account name for a self-managed provider using the parsed host (not the raw URL)', async () => {
		const { runtime, manager } = createManager({
			// No `accountName` on the wire → forces the provider-API resolution tier.
			connections: [
				{ tokenId: 'ent1', provider: 'githubEnterprise', type: 'oauth', domain: 'http://ghe.example.com' },
			],
			token: (path: string) => {
				const tokenId = path.endsWith('/githubEnterprise') ? 'ent1' : path.split('/').pop();
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});

		// Pre-create the self-managed integration under the PARSED host and stub its account lookup. Reconcile
		// must resolve to THIS instance — proving it parsed 'http://ghe.example.com' → 'ghe.example.com'. A
		// raw-URL key would miss this instance and fall through to a live provider call (undefined here).
		const ghe = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe.example.com');
		assert.ok(ghe != null, 'self-managed integration constructs');
		ghe.getProviderAccountForSession = () => Promise.resolve({ username: 'ent-user' } as Account);

		await manager.refreshConnections();

		const [connection] = manager.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise);
		assert.equal(connection?.accountName, 'ent-user', 'account name resolved via the host-keyed integration');
		assert.equal(connection?.domain, 'ghe.example.com', 'self-managed descriptor keeps its host domain');
		assert.match(
			(await runtime.storage.getSecret('integration.auth.cloud:cloud-github-enterprise|ent1')) ?? '',
			/"protocol":"http:"/,
			'stored session preserves the backend URL protocol',
		);

		manager.dispose();
	});

	test('refreshConnections accepts a bare host:port domain for self-managed providers', async () => {
		const { runtime, manager } = createManager({
			connections: [
				{
					tokenId: 'ent1',
					provider: 'githubEnterprise',
					type: 'oauth',
					domain: 'ghe.example.com:8443',
					accountName: 'ent-user',
				},
			],
			token: (path: string) => {
				const tokenId = path.endsWith('/githubEnterprise') ? 'ent1' : path.split('/').pop();
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});

		await manager.refreshConnections();

		const [connection] = manager.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise);
		assert.equal(connection?.id, 'ent1');
		assert.equal(connection?.domain, 'ghe.example.com:8443');
		assert.equal(connection?.primary, true);
		assert.equal(connection?.accountName, 'ent-user');
		assert.doesNotMatch(
			(await runtime.storage.getSecret('integration.auth.cloud:cloud-github-enterprise|ent1')) ?? '',
			/"protocol"/,
			'bare host:port does not persist a bogus protocol',
		);

		manager.dispose();
	});

	test('check-in sync applies self-managed primaries and refreshes cached models per host', async () => {
		const { runtime, manager } = createManager({
			connections: [
				{
					tokenId: 'ghe-b2',
					provider: 'githubEnterprise',
					type: 'oauth',
					domain: 'ghe-b.example.com',
					accountName: 'b-two',
					secondaries: [
						{
							tokenId: 'ghe-b1',
							provider: 'githubEnterprise',
							type: 'oauth',
							domain: 'ghe-b.example.com',
							accountName: 'b-one',
						},
					],
				},
				{
					tokenId: 'ghe-a1',
					provider: 'githubEnterprise',
					type: 'oauth',
					domain: 'ghe-a.example.com',
					accountName: 'a-one',
					secondaries: [
						{
							tokenId: 'ghe-a2',
							provider: 'githubEnterprise',
							type: 'oauth',
							domain: 'ghe-a.example.com',
							accountName: 'a-two',
						},
					],
				},
			],
			token: (path: string) => {
				const tokenId = path.endsWith('/githubEnterprise') ? 'ghe-a1' : path.split('/').pop();
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});

		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'ghe-a2',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-a.example.com',
					scopes: 'repo',
					primary: false,
				},
				{
					id: 'ghe-b1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-b.example.com',
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'ghe-b2',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-b.example.com',
					scopes: 'repo',
					primary: false,
				},
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|ghe-a1',
			JSON.stringify({
				id: 'ghe-a1',
				accessToken: 'tok-ghe-a1',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-a.example.com',
			}),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|ghe-b1',
			JSON.stringify({
				id: 'ghe-b1',
				accessToken: 'tok-ghe-b1',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-b.example.com',
			}),
		);

		const gheA = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe-a.example.com');
		const gheB = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe-b.example.com');
		assert.ok(gheA != null, 'first self-managed integration constructs');
		assert.ok(gheB != null, 'second self-managed integration constructs');
		assert.equal(await gheA.isConnected(), true, 'first host session is warm');
		assert.equal(await gheB.isConnected(), true, 'second host session is warm');

		let switchedB = false;
		gheB.switchConnection = () => {
			switchedB = true;
			return Promise.resolve();
		};

		runtime.fireSubscriptionCheckIn(false);
		await flush();

		const configured = manager.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise);
		assert.equal(
			configured.find(c => c.domain === 'ghe-a.example.com' && c.primary)?.id,
			'ghe-a1',
			'host A primary is unchanged',
		);
		assert.equal(
			configured.find(c => c.domain === 'ghe-b.example.com' && c.primary)?.id,
			'ghe-b2',
			'host B primary follows the backend primary',
		);
		assert.equal(
			configured.filter(c => c.domain === 'ghe-a.example.com' && c.primary).length,
			1,
			'host A keeps exactly one primary',
		);
		assert.equal(
			configured.filter(c => c.domain === 'ghe-b.example.com' && c.primary).length,
			1,
			'host B keeps exactly one primary',
		);
		assert.equal(switchedB, true, 'changed host refreshes its cached integration');

		manager.dispose();
	});

	test('refreshConnections fetches the backend primary when force-syncing a multi-account provider', async () => {
		const { runtime, manager, paths } = createManager({
			connections: [
				{
					tokenId: 'p1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'octo',
					secondaries: [
						{
							tokenId: 's1',
							provider: 'github',
							type: 'oauth',
							domain: 'github.com',
							accountName: 'hubot',
						},
					],
				},
			],
			token: (path: string) => {
				const tokenId = path === 'v1/provider-tokens/github' ? 'p1' : path.split('/').pop();
				return {
					tokenId: tokenId,
					accessToken: `fresh-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
					domain: 'github.com',
				};
			},
		});
		await runtime.storage.store('integrations:configured', {
			github: [
				{ id: 'p1', cloud: true, integrationId: 'github', scopes: 'repo', primary: true },
				{ id: 's1', cloud: true, integrationId: 'github', scopes: 'repo', primary: false },
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|p1',
			JSON.stringify({ id: 'p1', accessToken: 'old-p1', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|s1',
			JSON.stringify({ id: 's1', accessToken: 'old-s1', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		const github = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.equal(await github.isConnected(), true, 'primary session is warm');
		paths.splice(0);

		await manager.refreshConnections();

		assert.ok(
			paths.includes('v1/provider-tokens/github'),
			'force sync fetches the backend primary instead of falling back to a stored secondary',
		);
		assert.equal(manager.getConfigured(GitCloudHostIntegrationId.GitHub).find(c => c.primary)?.id, 'p1');
		assert.match(
			(await runtime.storage.getSecret('integration.auth.cloud:github|p1')) ?? '',
			/fresh-p1/,
			'primary secret refreshed from the backend primary',
		);

		manager.dispose();
	});

	test('a terminal forced re-sync failure drops the connection instead of leaving it token-less (#5497)', async () => {
		// The backend still lists the connection (state = 'connected'), but the token fetch fails terminally
		// (404 — the token is genuinely gone). A forced re-sync deletes the cloud secret up front while
		// preserving the descriptor; the replacement fetch then fails terminally. The descriptor (and its
		// secret) must not be left behind reported as connected.
		const { runtime, manager } = createManager({
			connections: [{ tokenId: 'p1', provider: 'github', type: 'oauth', domain: 'github.com' }],
			token: () => null, // the token is gone
			errorStatus: 404, // terminal: the connection no longer has a fetchable token
		});
		await runtime.storage.store('integrations:configured', {
			github: [{ id: 'p1', cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|p1',
			JSON.stringify({ id: 'p1', accessToken: 'old-p1', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		await manager.refreshConnections();

		assert.deepEqual(
			manager.getConfigured(GitCloudHostIntegrationId.GitHub),
			[],
			'the token-less descriptor is removed after the terminal forced re-sync failure',
		);
		assert.ok(
			(await runtime.storage.getSecret('integration.auth.cloud:github|p1')) == null,
			'the deleted cloud secret is not restored',
		);

		manager.dispose();
	});

	test('a transient forced re-sync failure preserves the connection so it self-heals (#5569)', async () => {
		// The backend still lists the connection, but the token fetch fails transiently (503). A forced re-sync
		// deletes the cloud secret up front while preserving the descriptor; the replacement fetch then fails
		// transiently. Unlike the terminal case (#5497), the descriptor must be KEPT so a healthy integration
		// isn't disconnected by a momentary backend blip — it self-heals on the next successful sync (#5569).
		let failing = true;
		const { runtime, manager } = createManager({
			connections: [{ tokenId: 'p1', provider: 'github', type: 'oauth', domain: 'github.com' }],
			token: () =>
				failing
					? null
					: { tokenId: 'p1', accessToken: 'fresh-p1', expiresIn: 3600, scopes: 'repo', type: 'oauth' },
			errorStatus: 503, // transient: the backend momentarily can't serve the token
		});
		await runtime.storage.store('integrations:configured', {
			github: [{ id: 'p1', cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|p1',
			JSON.stringify({ id: 'p1', accessToken: 'old-p1', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		await manager.refreshConnections();

		assert.deepEqual(
			manager.getConfigured(GitCloudHostIntegrationId.GitHub).map(c => c.id),
			['p1'],
			'the descriptor is preserved through a transient failure (not dropped)',
		);

		// The backend recovers: the next sync fetches a fresh token and re-hydrates the secret.
		failing = false;
		await manager.refreshConnections();

		assert.deepEqual(
			manager.getConfigured(GitCloudHostIntegrationId.GitHub).map(c => c.id),
			['p1'],
			'the connection is still configured after recovery',
		);
		const secret = await runtime.storage.getSecret('integration.auth.cloud:github|p1');
		assert.ok(secret != null, 'the cloud secret is restored on the next successful sync (self-heal)');
		assert.equal(
			(JSON.parse(secret) as { accessToken: string }).accessToken,
			'fresh-p1',
			'the restored secret holds the freshly fetched token',
		);

		manager.dispose();
	});

	test('a non-forced check-in does not re-fetch tokens for already-stored, non-expired connections', async () => {
		const { runtime, manager, paths } = createManager({
			connections: [
				{
					tokenId: 'p1',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					secondaries: [{ tokenId: 's1', provider: 'github', type: 'oauth', domain: 'github.com' }],
				},
			],
			token: githubToken,
		});
		// Both connections already stored with a future expiry, so a routine check-in has nothing to refresh.
		const future = new Date(Date.now() + 3600_000).toISOString();
		await runtime.storage.store('integrations:configured', {
			github: [
				{ id: 'p1', cloud: true, integrationId: 'github', scopes: 'repo', primary: true, expiresAt: future },
				{ id: 's1', cloud: true, integrationId: 'github', scopes: 'repo', primary: false, expiresAt: future },
			],
		});
		for (const tok of ['p1', 's1']) {
			await runtime.storage.storeSecret(
				`integration.auth.cloud:github|${tok}`,
				JSON.stringify({ id: tok, accessToken: `tok-${tok}`, scopes: ['repo'], cloud: true, type: 'oauth' }),
			);
		}
		paths.splice(0);

		// Non-forced check-in (force=false).
		runtime.fireSubscriptionCheckIn(false);
		await flush();

		assert.ok(
			!paths.some(p => p.startsWith('v1/provider-tokens/tokens/')),
			'no per-connection token fetch on a routine check-in when nothing expired',
		);
		assert.deepEqual(
			manager
				.getConfigured(GitCloudHostIntegrationId.GitHub)
				.map(c => c.id)
				.sort(),
			['p1', 's1'],
			'both connections remain configured (not pruned) despite the skipped fetch',
		);

		manager.dispose();
	});

	test('force-syncing a multi-host self-managed provider scopes each host fetch to its own connection', async () => {
		// Two GHE hosts. The provider-global endpoint (`v1/provider-tokens/githubEnterprise`) returns host B's
		// primary; if a forced sync of host A fell back to it, host A would be hydrated with host B's token.
		const { runtime, manager, paths } = createManager({
			connections: [
				{ tokenId: 'ghe-b1', provider: 'githubEnterprise', type: 'oauth', domain: 'ghe-b.example.com' },
				{ tokenId: 'ghe-a1', provider: 'githubEnterprise', type: 'oauth', domain: 'ghe-a.example.com' },
			],
			token: (path: string) => {
				// Provider-scoped endpoint yields the global primary (host B); token endpoints yield their id.
				const tokenId = path.endsWith('/githubEnterprise') ? 'ghe-b1' : path.split('/').pop();
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
					domain: tokenId === 'ghe-a1' ? 'ghe-a.example.com' : 'ghe-b.example.com',
				};
			},
		});
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'ghe-b1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-b.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|ghe-a1',
			JSON.stringify({
				id: 'ghe-a1',
				accessToken: 'old-ghe-a1',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-a.example.com',
			}),
		);

		const gheA = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe-a.example.com');
		assert.ok(gheA != null, 'host A integration constructs');
		assert.equal(await gheA.isConnected(), true, 'host A session is warm');
		paths.splice(0);

		await manager.refreshConnections();

		assert.ok(
			paths.includes('v1/provider-tokens/tokens/ghe-a1'),
			'host A session fetch is scoped to its own connection id',
		);
		assert.ok(
			!paths.includes('v1/provider-tokens/githubEnterprise'),
			'force sync must not fetch the provider-global primary for a configured multi-host provider',
		);
		assert.match(
			(await runtime.storage.getSecret('integration.auth.cloud:cloud-github-enterprise|ghe-a1')) ?? '',
			/tok-ghe-a1/,
			'host A secret refreshed from its own connection token, not host B',
		);

		manager.dispose();
	});

	test('refreshing a cloud provider does not switch a cached self-managed provider with an overlapping id prefix', async () => {
		const { manager } = createManager({
			connections: [
				{
					tokenId: 'bb1',
					provider: 'bitbucket',
					type: 'oauth',
					domain: 'bitbucket.org',
					accountName: 'bb-user',
				},
			],
			token: (path: string) => {
				const tokenId = path.endsWith('/bitbucket') ? 'bb1' : path.split('/').pop();
				return {
					tokenId: tokenId,
					accessToken: `tok-${tokenId}`,
					expiresIn: 3600,
					scopes: 'repo',
					type: 'oauth',
				};
			},
		});

		const bitbucketServer = await manager.get(GitSelfManagedHostIntegrationId.BitbucketServer, 'bbs.example.com');
		assert.ok(bitbucketServer != null, 'self-managed Bitbucket integration constructs');

		let switched = false;
		bitbucketServer.switchConnection = () => {
			switched = true;
			return Promise.resolve();
		};

		await manager.refreshConnections();

		assert.equal(switched, false, 'cloud Bitbucket refresh must not switch Bitbucket Data Center');

		manager.dispose();
	});

	test('a re-pointed Jira Server context path is re-fetched on a routine check-in, an unchanged one is not', async () => {
		// Same host, same unexpired token, different context path. `host` is normalized, so the descriptor's
		// domain is identical either way — only the address the connection actually carries changed, and every
		// read would stay on the stale path until expiry if the routine check-in short-circuited on domain alone.
		const runFor = async (wireDomain: string) => {
			const { runtime, manager, paths } = createManager({
				connections: [
					{
						tokenId: 'js1',
						provider: 'jiraServer',
						type: 'pat',
						domain: wireDomain,
						accountName: 'js-user',
					},
				],
				token: () => ({
					tokenId: 'js1',
					accessToken: 'tok-js1',
					expiresIn: 3600,
					scopes: '',
					type: 'pat',
				}),
			});
			const future = new Date(Date.now() + 3600_000).toISOString();
			await runtime.storage.store('integrations:configured', {
				'jira-server': [
					{
						id: 'js1',
						cloud: true,
						integrationId: 'jira-server',
						scopes: '',
						primary: true,
						domain: 'jira.example.com',
						baseUrl: 'https://jira.example.com/jira',
						expiresAt: future,
					},
				],
			});
			await runtime.storage.storeSecret(
				'integration.auth.cloud:jira-server|js1',
				JSON.stringify({
					id: 'js1',
					accessToken: 'tok-js1',
					scopes: [],
					cloud: true,
					type: 'pat',
					domain: 'jira.example.com',
					baseUrl: 'https://jira.example.com/jira',
				}),
			);
			paths.splice(0);

			// A warm integration for the host: storing a new session is not enough on its own, since this
			// instance holds its own and would keep addressing the old path until told to re-resolve.
			const integration = await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com');
			assert.ok(integration != null);
			let switched = false;
			integration.switchConnection = () => {
				switched = true;
				return Promise.resolve();
			};

			runtime.fireSubscriptionCheckIn(false);
			await flush();

			const refetched = paths.some(p => p.startsWith('v1/provider-tokens/tokens/'));
			const stored = manager.getConfigured(IssuesSelfManagedHostIntegrationId.JiraServer)[0];
			manager.dispose();
			return { refetched: refetched, baseUrl: stored?.baseUrl, switched: switched };
		};

		const unchanged = await runFor('https://jira.example.com/jira');
		assert.equal(unchanged.refetched, false, 'an unchanged address keeps the routine check-in cheap');
		assert.equal(unchanged.baseUrl, 'https://jira.example.com/jira');
		assert.equal(unchanged.switched, false, 'and does not churn a warm integration');

		const moved = await runFor('https://jira.example.com/jira-dc');
		assert.equal(moved.refetched, true, 'a re-pointed connection falls through to the fetch');
		assert.equal(moved.baseUrl, 'https://jira.example.com/jira-dc', 'and the new address is persisted');
		assert.equal(moved.switched, true, 'and the warm integration is told to re-resolve its session');
	});
});

suite('Linear workspace connection metadata (#5956)', () => {
	const connection = (id: string) => ({
		tokenId: id,
		provider: 'linear',
		type: 'oauth',
		domain: 'linear.app',
		accountName: 'same-person',
	});
	const token = (path: string) => {
		const id = path === 'v1/provider-tokens/linear' ? 'one' : path.split('/').pop();
		return { tokenId: id, accessToken: `token-${id}`, expiresIn: 3600, scopes: 'read', type: 'oauth' };
	};
	const mockLinearOrganization = (
		manager: ReturnType<typeof createManager>['manager'],
		lookup: (info: TokenWithInfo) => Promise<unknown>,
	) => {
		(manager as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = async () => ({
			getLinearOrganization: lookup,
		});
	};

	test('a prepared session waiting on workspace enrichment cannot restore an older expiry', async () => {
		const id = IssuesCloudHostIntegrationId.Linear;
		const { runtime, manager } = createManager({
			connections: [connection('one')],
			token: () => token('one'),
		});
		const configured = new ConfiguredIntegrationService(runtime);
		const entered = defer<void>();
		const release = defer<void>();
		mockLinearOrganization(manager, async () => {
			entered.fulfill();
			await release.promise;
			return { id: 'org-one', name: 'First' };
		});
		const refresh = manager.refreshConnections();
		await entered.promise;
		const session = await configured.peekStoredSession(id, 'one', true, 'linear.app');
		assert.ok(session);
		const currency = await configured.captureStoredRelationshipCurrency(id, session);
		assert.ok(currency);
		assert.ok(currency());
		const expired = { ...session, expiresAt: new Date(0) };
		await configured.storeSession(id, expired);
		release.fulfill();
		await refresh;
		assert.equal((await configured.peekStoredSession(id, 'one', true, 'linear.app'))?.expiresAt?.getTime(), 0);
		assert.equal(currency(), false);
		const later = new Date(Date.now() + 3600_000);
		assert.ok(
			await configured.storeSession(
				id,
				{ ...session, expiresAt: later },
				{ signOutMark: configured.getSignOutMark() },
			),
		);
		assert.ok(currency());
		assert.equal(
			(await configured.peekStoredSession(id, 'one', true, 'linear.app'))?.expiresAt?.getTime(),
			later.getTime(),
		);
		manager.dispose();
		configured.dispose();
	});

	test('resolves each workspace with its own token on every token fetch and keeps it by connection id', async () => {
		const { runtime, manager } = createManager({
			connections: [{ ...connection('one'), secondaries: [connection('two')] }],
			token: token,
		});
		const lookups: string[] = [];
		mockLinearOrganization(manager, async info => {
			lookups.push(info.accessToken);
			return info.accessToken === 'token-one'
				? { id: 'org-one', name: 'First' }
				: { id: 'org-two', name: 'Second' };
		});

		try {
			await manager.refreshConnections();
			const byId = new Map(manager.getConfigured(IssuesCloudHostIntegrationId.Linear).map(c => [c.id, c]));
			assert.equal(byId.get('one')?.resourceName, 'First');
			assert.equal(byId.get('one')?.resourceId, 'org-one');
			assert.equal(byId.get('two')?.resourceName, 'Second');
			assert.equal(byId.get('two')?.resourceId, 'org-two');
			assert.equal(byId.get('two')?.accountName, 'same-person', 'the workspace does not replace the person');
			assert.deepEqual(lookups.sort(), ['token-one', 'token-two']);

			lookups.length = 0;
			await manager.refreshConnections();
			assert.deepEqual(lookups.sort(), ['token-one', 'token-two'], 'a forced refresh looks every workspace up');
			const stored = runtime.storage.get<StoredIntegrationConfigurations>('integrations:configured');
			assert.equal(stored?.linear?.find(c => c.id === 'two')?.resourceId, 'org-two');
		} finally {
			manager.dispose();
		}
	});

	test('the lookup traverses the real provider API with the secondary connection token', async () => {
		const { runtime, manager } = createManager({
			connections: [{ ...connection('one'), secondaries: [connection('two')] }],
			token: token,
		});
		const requests: Array<{ url: string; authorization: string | null; body: string | undefined }> = [];
		runtime.http.fetch = async (url, init) => {
			const authorization = new Headers(init?.headers).get('authorization');
			requests.push({
				url: typeof url === 'string' ? url : url.href,
				authorization: authorization,
				body: typeof init?.body === 'string' ? init.body : undefined,
			});
			const organization =
				authorization === 'token-two'
					? { id: 'org-two', name: 'Second', urlKey: 'second' }
					: { id: 'org-one', name: 'First', urlKey: 'first' };
			return new Response(JSON.stringify({ data: { organization: organization } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		};
		try {
			await manager.refreshConnections();
			const secondary = manager.getConfigured(IssuesCloudHostIntegrationId.Linear).find(c => c.id === 'two');
			assert.equal(secondary?.resourceName, 'Second');
			assert.equal(secondary?.resourceId, 'org-two');
			assert.equal(requests.length, 2);
			assert.ok(requests.every(r => r.url === 'https://api.linear.app/graphql'));
			assert.ok(requests.every(r => (r.body ?? '').includes('GetOrganization')));
			assert.deepEqual(requests.map(r => r.authorization).sort(), ['token-one', 'token-two']);
		} finally {
			manager.dispose();
		}
	});

	test('a lookup still in flight is joined by the next one for the same token, not repeated', async () => {
		const { manager } = createManager({ connections: [connection('one')], token: token });
		let requests = 0;
		let answer: ((organization: unknown) => void) | undefined;
		mockLinearOrganization(manager, () => {
			requests++;
			return new Promise(resolve => {
				answer = resolve;
			});
		});
		try {
			const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
			const session = { accessToken: 'token-one' } as unknown as ProviderAuthenticationSession;
			// The first caller has given up (its sync timed out), yet its request is still pending.
			const abandoned = linear.getProviderResourceForSession(session);
			await flush();
			const next = linear.getProviderResourceForSession(session);
			await flush();
			assert.equal(requests, 1, 'the second lookup joins the pending request');

			answer?.({ id: 'org-one', name: 'First' });
			assert.deepEqual(await next, { id: 'org-one', name: 'First' });
			assert.deepEqual(await abandoned, { id: 'org-one', name: 'First' });

			const later = linear.getProviderResourceForSession(session);
			await flush();
			answer?.({ id: 'org-one', name: 'Renamed' });
			assert.deepEqual(await later, { id: 'org-one', name: 'Renamed' });
			assert.equal(requests, 2, 'a settled request is not reused');
		} finally {
			manager.dispose();
		}
	});

	test('a joined lookup that fails fails every caller, and the next one asks again', async () => {
		const { manager } = createManager({ connections: [connection('one')], token: token });
		let requests = 0;
		let fail: ((reason: Error) => void) | undefined;
		mockLinearOrganization(manager, () => {
			requests++;
			return requests === 1
				? new Promise((_, reject) => {
						fail = reject;
					})
				: Promise.resolve({ id: 'org-one', name: 'First' });
		});
		try {
			const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
			const session = { accessToken: 'token-one' } as unknown as ProviderAuthenticationSession;
			const first = linear.getProviderResourceForSession(session);
			await flush();
			const joined = linear.getProviderResourceForSession(session);
			await flush();
			fail?.(new Error('offline'));
			await assert.rejects(first, /offline/);
			await assert.rejects(joined, /offline/);

			assert.deepEqual(await linear.getProviderResourceForSession(session), { id: 'org-one', name: 'First' });
			assert.equal(requests, 2, 'the failed request is not kept');
		} finally {
			manager.dispose();
		}
	});

	test('a re-sync dropping the organization cache mid-lookup still stores the workspace', async () => {
		const { manager } = createManager({ connections: [connection('one')], token: token });
		mockLinearOrganization(manager, async () => {
			(await manager.get(IssuesCloudHostIntegrationId.Linear)).invalidateDiscoveryCaches();
			return { id: 'org-one', name: 'First' };
		});
		try {
			await manager.refreshConnections();
			const [descriptor] = manager.getConfigured(IssuesCloudHostIntegrationId.Linear);
			assert.equal(descriptor.resourceId, 'org-one');
			assert.equal(descriptor.resourceName, 'First');
		} finally {
			manager.dispose();
		}
	});

	for (const [label, outcome] of [
		['fails', () => Promise.reject(new Error('offline'))],
		['returns a blank name', () => Promise.resolve({ id: 'org-one', name: ' ' })],
		['returns a blank id', () => Promise.resolve({ id: ' ', name: 'First' })],
	] as const) {
		test(`a lookup that ${label} stores no workspace and is retried on the next refresh`, async () => {
			const { manager } = createManager({ connections: [connection('one')], token: token });
			let attempts = 0;
			mockLinearOrganization(manager, () =>
				++attempts === 1 ? outcome() : Promise.resolve({ id: 'org-one', name: 'First' }),
			);
			try {
				await manager.refreshConnections();
				const [unresolved] = manager.getConfigured(IssuesCloudHostIntegrationId.Linear);
				assert.equal(unresolved.id, 'one', 'the connection is still stored');
				assert.equal(unresolved.accountName, 'same-person');
				assert.equal(unresolved.resourceName, undefined);
				assert.equal(unresolved.resourceId, undefined);

				await manager.refreshConnections();
				const [resolved] = manager.getConfigured(IssuesCloudHostIntegrationId.Linear);
				assert.equal(resolved.resourceName, 'First');
				assert.equal(resolved.resourceId, 'org-one');
				assert.equal(attempts, 2);
			} finally {
				manager.dispose();
			}
		});
	}

	const storeLinearDescriptor = (
		runtime: ReturnType<typeof createManager>['runtime'],
		resource?: { resourceId: string; resourceName: string },
	) =>
		runtime.storage.store('integrations:configured', {
			linear: [
				{
					id: 'one',
					integrationId: 'linear',
					cloud: true,
					primary: true,
					scopes: 'read',
					expiresAt: new Date(Date.now() + 3600_000).toISOString(),
					accountName: 'same-person',
					...resource,
				},
			],
		});

	test('a forced refresh replaces a stored workspace with the one its token reports now', async () => {
		const { runtime, manager } = createManager({ connections: [connection('one')], token: token });
		await storeLinearDescriptor(runtime, { resourceId: 'org-one', resourceName: 'Old name' });
		mockLinearOrganization(manager, async () => ({ id: 'org-one', name: 'New name' }));
		try {
			await manager.refreshConnections();
			assert.equal(manager.getConfigured(IssuesCloudHostIntegrationId.Linear)[0].resourceName, 'New name');
		} finally {
			manager.dispose();
		}
	});

	test('a failed lookup keeps the stored workspace', async () => {
		const { runtime, manager } = createManager({ connections: [connection('one')], token: token });
		await storeLinearDescriptor(runtime, { resourceId: 'org-one', resourceName: 'First' });
		mockLinearOrganization(manager, () => Promise.reject(new Error('offline')));
		try {
			await manager.refreshConnections();
			const [descriptor] = manager.getConfigured(IssuesCloudHostIntegrationId.Linear);
			assert.equal(descriptor.resourceId, 'org-one');
			assert.equal(descriptor.resourceName, 'First');
		} finally {
			manager.dispose();
		}
	});

	test('a routine check-in makes no token fetch or lookup for a connection with its workspace stored', async () => {
		const { runtime, manager, paths } = createManager({ connections: [connection('one')], token: token });
		await storeLinearDescriptor(runtime, { resourceId: 'org-one', resourceName: 'First' });
		let lookups = 0;
		mockLinearOrganization(manager, async () => {
			lookups++;
			return { id: 'org-one', name: 'First' };
		});
		try {
			runtime.fireSubscriptionCheckIn(false);
			await flush();
			assert.ok(paths.includes('v1/provider-tokens'), 'the sync actually ran');
			assert.equal(lookups, 0);
			assert.ok(
				!paths.some(p => p.startsWith('v1/provider-tokens/tokens/')),
				'no token fetch on routine check-ins',
			);
			assert.equal(manager.getConfigured(IssuesCloudHostIntegrationId.Linear)[0].resourceName, 'First');
		} finally {
			manager.dispose();
		}
	});

	test('a routine check-in resolves the workspace of a connection stored without one', async () => {
		const { runtime, manager } = createManager({ connections: [connection('one')], token: token });
		await storeLinearDescriptor(runtime);
		const lookups: string[] = [];
		mockLinearOrganization(manager, async info => {
			lookups.push(info.accessToken);
			return { id: 'org-one', name: 'First' };
		});
		try {
			runtime.fireSubscriptionCheckIn(false);
			await flush();
			assert.deepEqual(lookups, ['token-one'], 'looked up with the connection token');
			const [descriptor] = manager.getConfigured(IssuesCloudHostIntegrationId.Linear);
			assert.equal(descriptor.resourceId, 'org-one');
			assert.equal(descriptor.resourceName, 'First');
		} finally {
			manager.dispose();
		}
	});

	test('a routine check-in on a cold integration resolves the workspace of the primary it fetched', async () => {
		const { runtime, manager, paths } = createManager({
			connections: [{ ...connection('one'), secondaries: [connection('two')] }],
			// The provider-scoped path the model sync fetches answers with the primary's own connection id.
			token: path => token(path === 'v1/provider-tokens/linear' ? 'v1/provider-tokens/tokens/one' : path),
		});
		const lookups: string[] = [];
		mockLinearOrganization(manager, async info => {
			lookups.push(info.accessToken);
			return info.accessToken === 'token-one'
				? { id: 'org-one', name: 'First' }
				: { id: 'org-two', name: 'Second' };
		});
		try {
			runtime.fireSubscriptionCheckIn(false);
			await flush();
			assert.ok(paths.includes('v1/provider-tokens/linear'), 'the model sync fetched the primary first');
			const byId = new Map(manager.getConfigured(IssuesCloudHostIntegrationId.Linear).map(c => [c.id, c]));
			assert.equal(byId.get('one')?.primary, true);
			assert.equal(
				byId.get('one')?.resourceId,
				'org-one',
				'the primary stored by the model sync gets its workspace',
			);
			assert.equal(byId.get('one')?.resourceName, 'First');
			assert.equal(byId.get('two')?.resourceId, 'org-two');
			assert.deepEqual(lookups.sort(), ['token-one', 'token-two']);
		} finally {
			manager.dispose();
		}
	});
});
