import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Account } from '@gitlens/git/models/author.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
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
	/** Per-path token responses; return null to simulate a failed/absent token. */
	token: (path: string) => unknown;
}

function createManager(backend: TokenBackend) {
	const runtime = createFakeRuntime();
	const paths: string[] = [];
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = (path: string) => {
		paths.push(path);
		let payload: unknown = { data: null };
		let status = 200;
		if (path === 'v1/provider-tokens') {
			payload = { data: backend.connections };
		} else if (path.startsWith('v1/provider-tokens/')) {
			const data = backend.token(path);
			if (data == null) {
				status = 500;
				payload = { error: 'boom' };
			} else {
				payload = { data: data };
			}
		}
		return Promise.resolve(new Response(JSON.stringify(payload), { status: status }));
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

suite('cloud sync — multi-account reconcile (#5430)', () => {
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

		await manager.deleteConnection(GitCloudHostIntegrationId.GitHub, 'p1', true);
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

	test('deleteConnection without an explicit cloud arg is cloud-scoped by default, preserving a shared-id local PAT', async () => {
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
			'local PAT secret preserved by a default (unscoped) deleteConnection call',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|shared'),
			undefined,
			'cloud secret removed',
		);

		manager.dispose();
	});

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
		};

		await manager.refreshConnections();

		assert.equal(switched, false, 'cloud Bitbucket refresh must not switch Bitbucket Data Center');

		manager.dispose();
	});
});
