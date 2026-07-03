import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createFakeRuntime } from './fakeRuntime.js';

function cloudSession(id: string, overrides?: Partial<ProviderAuthenticationSession>): ProviderAuthenticationSession {
	return {
		id: id,
		accessToken: `token-${id}`,
		account: { id: `acct-${id}`, label: id },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: 'github.com',
		...overrides,
	};
}

const githubDescriptor = { domain: 'github.com', scopes: ['repo'] };

suite('ConfiguredIntegrationService — multi-account (#5430)', () => {
	test('reads a legacy cloud session (no id, domain-keyed secret) with zero migration', async () => {
		const runtime = createFakeRuntime();
		// Pre-multi-account stored data: descriptor without `id`, cloud secret keyed by the canonical domain.
		await runtime.storage.store('integrations:configured', {
			github: [{ cloud: true, integrationId: 'github', scopes: 'repo' }],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|github.com',
			JSON.stringify({ id: 'github.com', accessToken: 'legacy', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);

		const service = new ConfiguredIntegrationService(runtime);
		const session = await service.getStoredSession(GitCloudHostIntegrationId.GitHub, githubDescriptor);

		assert.ok(session != null, 'legacy session resolves');
		assert.equal(session.accessToken, 'legacy');
		// The original secret is untouched (no rewrite under a new key).
		assert.ok(
			(await runtime.storage.getSecret('integration.auth.cloud:github|github.com')) != null,
			'legacy secret preserved',
		);
	});

	test('hydration backfills the connection id from the canonical domain (never empty)', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			github: [{ cloud: true, integrationId: 'github', scopes: 'repo' }],
		});

		const service = new ConfiguredIntegrationService(runtime);
		const [descriptor] = service.getConfigured(GitCloudHostIntegrationId.GitHub);

		assert.equal(descriptor.id, 'github.com');
	});

	test('reads a legacy self-managed session keyed by domain', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			'cloud-github-enterprise': [
				{ cloud: true, integrationId: 'cloud-github-enterprise', domain: 'gh.example.com', scopes: 'repo' },
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|gh.example.com',
			JSON.stringify({
				id: 'gh.example.com',
				accessToken: 'ent',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'gh.example.com',
			}),
		);

		const service = new ConfiguredIntegrationService(runtime);
		const session = await service.getStoredSession(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, {
			domain: 'gh.example.com',
			scopes: ['repo'],
		});

		assert.ok(session != null, 'self-managed session resolves');
		assert.equal(session.accessToken, 'ent');
	});

	test('two accounts on the same provider coexist; first is primary', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);

		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok1'));
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok2'));

		const configured = service.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(configured.length, 2, 'both connections stored');
		assert.deepEqual(configured.map(c => c.id).sort(), ['tok1', 'tok2'], 'both connection ids present');
		assert.equal(configured.filter(c => c.primary).length, 1, 'exactly one primary');
		assert.equal(configured.find(c => c.primary)?.id, 'tok1', 'first connection is primary');

		// Both secrets exist under distinct keys.
		assert.ok(await runtime.storage.getSecret('integration.auth.cloud:github|tok1'));
		assert.ok(await runtime.storage.getSecret('integration.auth.cloud:github|tok2'));
	});

	test('a specific secondary connection is addressable via connectionId', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok1'));
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok2'));

		const secondary = await service.getStoredSession(GitCloudHostIntegrationId.GitHub, {
			...githubDescriptor,
			connectionId: 'tok2',
		});
		assert.equal(secondary!.accessToken, 'token-tok2');

		// No connectionId resolves to the primary.
		const primary = await service.getStoredSession(GitCloudHostIntegrationId.GitHub, githubDescriptor);
		assert.equal(primary!.accessToken, 'token-tok1');
	});

	test('deleting a secondary leaves the primary and its secret intact', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok1'));
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok2'));

		await service.deleteConnection(GitCloudHostIntegrationId.GitHub, 'tok2');

		const configured = service.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(configured.length, 1);
		assert.equal(configured[0].id, 'tok1');
		assert.equal(configured[0].primary, true);
		assert.ok(await runtime.storage.getSecret('integration.auth.cloud:github|tok1'), 'primary secret intact');
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|tok2'),
			undefined,
			'secondary secret removed',
		);
	});

	test('deleting the primary promotes a secondary', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok1'));
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok2'));

		await service.deleteConnection(GitCloudHostIntegrationId.GitHub, 'tok1');

		const configured = service.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(configured.length, 1);
		assert.equal(configured[0].id, 'tok2');
		assert.equal(configured[0].primary, true, 'secondary promoted to primary');
		// The model descriptor (no connectionId) now resolves to the promoted connection.
		const session = await service.getStoredSession(GitCloudHostIntegrationId.GitHub, githubDescriptor);
		assert.equal(session!.accessToken, 'token-tok2');
	});

	test('setPrimaryConnection switches the default even when scopes/expiresAt are unchanged', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok1'));
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok2'));

		await service.setPrimaryConnection(GitCloudHostIntegrationId.GitHub, 'tok2');

		const configured = service.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(configured.find(c => c.primary)?.id, 'tok2');
		assert.equal(configured.filter(c => c.primary).length, 1, 'only one primary after switch');
		// Persisted across a fresh hydration.
		const rehydrated = new ConfiguredIntegrationService(runtime);
		assert.equal(rehydrated.getConfigured(GitCloudHostIntegrationId.GitHub).find(c => c.primary)?.id, 'tok2');
	});

	test('setPrimaryConnection ignores an unknown connection id', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok1'));
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok2'));

		await service.setPrimaryConnection(GitCloudHostIntegrationId.GitHub, 'missing');

		const configured = service.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(configured.find(c => c.primary)?.id, 'tok1', 'primary remains unchanged');
		assert.equal(configured.filter(c => c.primary).length, 1, 'still exactly one primary');
	});

	test('self-managed hosts keep independent primary connections per domain', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		const id = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;

		await service.storeSession(id, cloudSession('ghe-a1', { domain: 'ghe-a.example.com' }));
		await service.storeSession(id, cloudSession('ghe-b1', { domain: 'ghe-b.example.com' }));
		await service.storeSession(id, cloudSession('ghe-b2', { domain: 'ghe-b.example.com' }));

		let configured = service.getConfigured(id);
		assert.equal(configured.filter(c => c.primary).length, 2, 'one primary per self-managed host');
		assert.equal(
			configured.find(c => c.domain === 'ghe-a.example.com' && c.primary)?.id,
			'ghe-a1',
			'first host has its own primary',
		);
		assert.equal(
			configured.find(c => c.domain === 'ghe-b.example.com' && c.primary)?.id,
			'ghe-b1',
			'second host has its own primary',
		);

		await service.setPrimaryConnection(id, 'ghe-b2');

		configured = service.getConfigured(id);
		assert.equal(configured.find(c => c.domain === 'ghe-a.example.com' && c.primary)?.id, 'ghe-a1');
		assert.equal(configured.find(c => c.domain === 'ghe-b.example.com' && c.primary)?.id, 'ghe-b2');

		const firstHost = await service.getStoredSession(id, { domain: 'ghe-a.example.com', scopes: ['repo'] });
		const secondHost = await service.getStoredSession(id, { domain: 'ghe-b.example.com', scopes: ['repo'] });
		assert.equal(firstHost?.accessToken, 'token-ghe-a1');
		assert.equal(secondHost?.accessToken, 'token-ghe-b2');

		await service.deleteConnection(id, 'ghe-b2');

		configured = service.getConfigured(id);
		assert.equal(configured.find(c => c.domain === 'ghe-a.example.com' && c.primary)?.id, 'ghe-a1');
		assert.equal(
			configured.find(c => c.domain === 'ghe-b.example.com' && c.primary)?.id,
			'ghe-b1',
			'removing a host primary promotes a sibling from that host',
		);
	});

	test('exposes type and accountName, preserving accountName across an empty re-store', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		await service.storeSession(
			GitCloudHostIntegrationId.GitHub,
			cloudSession('tok1', { type: 'oauth', account: { id: 'u1', label: 'octocat' } }),
		);

		let [descriptor] = service.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(descriptor.type, 'oauth');
		assert.equal(descriptor.accountName, 'octocat');

		// The model re-stores the same connection with an empty account (getCloudSession sets it empty);
		// the previously-resolved accountName must survive.
		await service.storeSession(
			GitCloudHostIntegrationId.GitHub,
			cloudSession('tok1', { type: 'oauth', account: { id: '', label: '' } }),
		);
		[descriptor] = service.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(descriptor.accountName, 'octocat', 'accountName preserved across empty re-store');
	});

	test('deleteConnection scoped to cloud leaves a local PAT sharing the same id intact', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		// A local (PAT) and a cloud session can legitimately share a connection id (e.g. the domain).
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('shared', { cloud: false }));
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('shared', { cloud: true }));

		await service.deleteConnection(GitCloudHostIntegrationId.GitHub, 'shared', true);

		assert.ok(
			(await runtime.storage.getSecret('integration.auth:github|shared')) != null,
			'local PAT secret preserved',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|shared'),
			undefined,
			'cloud secret removed',
		);
		const configured = service.getConfigured(GitCloudHostIntegrationId.GitHub);
		assert.equal(configured.length, 1, 'only the cloud descriptor removed');
		assert.equal(configured[0].cloud, false, 'the surviving descriptor is the local one');
	});

	test('rehydrates a local PAT descriptor when a cloud descriptor shares the same id', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			github: [{ id: 'shared', cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
		});
		await runtime.storage.storeSecret(
			'integration.auth:github|shared',
			JSON.stringify({
				id: 'shared',
				accessToken: 'local',
				scopes: ['repo'],
				cloud: false,
				type: 'pat',
			}),
		);

		const service = new ConfiguredIntegrationService(runtime);
		const session = await service.getStoredSession(GitCloudHostIntegrationId.GitHub, {
			...githubDescriptor,
			connectionId: 'shared',
		});

		assert.equal(session?.accessToken, 'local');
		assert.ok(
			service.getConfigured(GitCloudHostIntegrationId.GitHub).some(c => c.id === 'shared' && c.cloud === false),
			'local descriptor restored alongside the cloud descriptor',
		);
	});

	test('deleteAllStoredSessions removes every connection secret for a multi-account provider', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok1'));
		await service.storeSession(GitCloudHostIntegrationId.GitHub, cloudSession('tok2'));

		await service.deleteAllStoredSessions(GitCloudHostIntegrationId.GitHub);

		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|tok1'),
			undefined,
			'first secret removed',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|tok2'),
			undefined,
			'second secret removed',
		);
		assert.equal(service.getConfigured(GitCloudHostIntegrationId.GitHub).length, 0, 'all descriptors removed');
	});
});
