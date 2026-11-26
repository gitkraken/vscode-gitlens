import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { defer } from '@gitlens/utils/promise.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { StoredIntegrationConfigurations } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
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

suite('ConfiguredIntegrationService relationship currency', () => {
	test('two hydrated services preserve secondary accounts, primary promotion and other providers on disk', async () => {
		const runtime = createFakeRuntime();
		const first = new ConfiguredIntegrationService(runtime);
		const second = new ConfiguredIntegrationService(runtime);
		const github = GitCloudHostIntegrationId.GitHub;
		const gitlab = GitCloudHostIntegrationId.GitLab;
		await first.storeSession(github, cloudSession('a'));
		assert.deepEqual(
			second.getConfigured(github).map(c => c.id),
			['a'],
		);

		const entered = defer<void>();
		const release = defer<void>();
		const store = runtime.storage.store;
		runtime.storage.store = async (key, value) => {
			entered.fulfill();
			await release.promise;
			await store(key, value);
		};
		const secondary = first.storeSession(github, cloudSession('b'));
		await entered.promise;
		const other = second.storeSession(gitlab, cloudSession('lab', { domain: 'gitlab.com' }));
		await new Promise(resolve => setImmediate(resolve));
		release.fulfill();
		await Promise.all([secondary, other]);

		await second.deleteConnection(github, 'a', true);
		const record = runtime.storage.get<StoredIntegrationConfigurations>('integrations:configured');
		assert.deepEqual(
			record?.[github]?.map(c => [c.id, c.primary]),
			[['b', true]],
		);
		assert.deepEqual(
			record?.[gitlab]?.map(c => c.id),
			['lab'],
		);
		assert.deepEqual(first.getConfigured(), second.getConfigured());
		assert.deepEqual(
			first.getConfigured(github).map(c => c.id),
			['b'],
		);
		first.dispose();
		second.dispose();
	});

	test('a pending startup purge merges an intervening provider write and preserves empty placeholders', async () => {
		const runtime = createFakeRuntime();
		const github = GitCloudHostIntegrationId.GitHub;
		const gitlab = GitCloudHostIntegrationId.GitLab;
		await runtime.storage.store('integrations:configured', {
			retired: [{ integrationId: 'retired', cloud: true, domain: 'old.example.com', scopes: '' }],
			[gitlab]: [],
		});
		const first = new ConfiguredIntegrationService(runtime);
		const second = new ConfiguredIntegrationService(runtime);
		const entered = defer<void>();
		const release = defer<void>();
		const deleted: string[] = [];
		runtime.storage.deleteSecret = async key => {
			deleted.push(key);
			entered.fulfill();
			await release.promise;
		};
		const purge = first.purgeStoredConfiguration(['retired']);
		await entered.promise;
		await second.storeSession(github, cloudSession('new'));
		release.fulfill();
		await purge;
		assert.deepEqual(deleted, [
			'integration.auth:retired|old.example.com',
			'integration.auth.cloud:retired|old.example.com',
		]);
		const record = runtime.storage.get<StoredIntegrationConfigurations>('integrations:configured');
		assert.deepEqual(Object.keys(record ?? {}).sort(), [github, gitlab].sort());
		assert.deepEqual(record?.[gitlab], []);
		assert.deepEqual(
			record?.[github]?.map(c => c.id),
			['new'],
		);
		assert.deepEqual(
			first.getConfigured().map(c => c.id),
			['new'],
		);
		first.dispose();
		second.dispose();
	});

	test('a fetch cannot overwrite a newly configured or replaced credential in its variant', async () => {
		const runtime = createFakeRuntime();
		const first = new ConfiguredIntegrationService(runtime);
		const second = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const selected = cloudSession('selected');
		const initial = first.getSignOutMark();
		await second.storeSession(id, selected);
		assert.equal(
			await first.storeSession(id, { ...selected, accessToken: 'obsolete' }, { signOutMark: initial }),
			false,
		);
		const mark = first.getSignOutMark();
		const newer = { ...selected, accessToken: 'current' };
		await second.storeSession(id, newer);
		assert.equal(await first.storeSession(id, selected, { signOutMark: mark }), false);
		assert.ok(await first.storeSession(id, { ...selected, cloud: false }, { signOutMark: mark }));
		assert.equal((await second.peekStoredSession(id, selected.id, true, selected.domain))?.accessToken, 'current');
		first.dispose();
		second.dispose();
	});

	test('logout reserves the provider lock after a dispatched write without retiring the successor account write', async () => {
		const runtime = createFakeRuntime();
		const first = new ConfiguredIntegrationService(runtime);
		const next = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const session = cloudSession('slot');
		const observing = first.beginCloudSync();
		await first.storeSession(id, session);
		const current = await next.captureConfiguredConnection(id, session.id);
		assert.ok(current);
		assert.ok(current());
		const entered = defer<void>();
		const release = defer<void>();
		const original = runtime.storage.storeSecret;
		runtime.storage.storeSecret = async (key, value) => {
			entered.fulfill();
			await release.promise;
			await original(key, value);
		};
		const old = first.storeSession(id, { ...session, accessToken: 'already-dispatched' });
		await entered.promise;
		const logout = next.retireCloudAccount(observing);
		assert.equal(current(), false);
		const replacement = next.storeSession(id, session, { signOutMark: next.getSignOutMark() });
		release.fulfill();
		await old;
		await logout;
		assert.ok(await replacement);
		assert.equal(
			(await first.peekStoredSession(id, session.id, true, session.domain))?.accessToken,
			session.accessToken,
		);
		assert.equal(current(), false);
		first.dispose();
		next.dispose();
	});

	test('a first cloud write held across logout stays retired after storage reopens', async () => {
		const runtime = createFakeRuntime();
		const store = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const session = cloudSession('first');
		const entered = defer<void>();
		const release = defer<void>();
		const storeSecret = runtime.storage.storeSecret;
		runtime.storage.storeSecret = async (key, value) => {
			entered.fulfill();
			await release.promise;
			await storeSecret(key, value);
		};
		try {
			const write = store.storeSession(id, session);
			await entered.promise;
			assert.deepEqual(store.getConfigured(id), []);
			const logout = store.retireCloudAccount(store.beginCloudSync());
			release.fulfill();
			assert.equal(await write, false);
			await logout;
			const reopened = new ConfiguredIntegrationService({ ...runtime, storage: { ...runtime.storage } });
			try {
				assert.deepEqual(reopened.getConfigured(id), []);
				assert.equal(await reopened.confirmHostCloudSession(id, session, reopened.lastCloudLogout), false);
				const fresh = { ...session, accessToken: 'next' };
				await reopened.storeSession(id, fresh);
				assert.ok(await reopened.confirmHostCloudSession(id, fresh, reopened.lastCloudLogout));
			} finally {
				reopened.dispose();
			}
		} finally {
			release.fulfill();
			store.dispose();
		}
	});

	test('failed cloud secret deletion cannot reissue the departed session or its proof', async () => {
		const runtime = createFakeRuntime();
		const writer = new ConfiguredIntegrationService(runtime);
		const reader = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const selected = cloudSession('slot');
		const key = 'integration.auth.cloud:github|slot';
		try {
			await writer.storeSession(id, selected);
			const original = await reader.captureStoredRelationshipCurrency(id, selected);
			assert.ok(original);
			assert.ok(original());
			const remove = runtime.storage.deleteSecret;
			runtime.storage.deleteSecret = async target => {
				if (target === key) throw new Error('storage unavailable');

				await remove(target);
			};
			await assert.rejects(
				writer.retireCloudAccount(writer.beginCloudSync()),
				/Unable to clear retired cloud credentials/,
			);
			assert.equal(original(), false);
			assert.ok(await runtime.storage.getSecret(key));
			assert.equal(await reader.peekStoredSession(id, selected.id, true, selected.domain), undefined);
			assert.equal(
				await reader.getStoredSession(id, { ...githubDescriptor, connectionId: selected.id }),
				undefined,
			);
			assert.equal(await reader.captureStoredRelationshipCurrency(id, selected), undefined);
			assert.equal(await reader.captureConfiguredConnection(id, selected.id), undefined);
			assert.equal(await reader.confirmHostCloudSession(id, selected, reader.lastCloudLogout), false);
			const reopened = new ConfiguredIntegrationService({ ...runtime, storage: { ...runtime.storage } });
			try {
				assert.equal(
					await reopened.getStoredSession(id, { ...githubDescriptor, connectionId: selected.id }),
					undefined,
				);
				assert.equal(await reopened.confirmHostCloudSession(id, selected, reopened.lastCloudLogout), false);
				assert.equal(await reopened.captureStoredRelationshipCurrency(id, selected), undefined);
			} finally {
				reopened.dispose();
			}
			await writer.storeSession(id, selected);
			assert.ok((await reader.captureStoredRelationshipCurrency(id, selected))?.());
			assert.equal(original(), false);
		} finally {
			reader.dispose();
			writer.dispose();
		}
	});

	test('a failed durable logout marker is reported and keeps the live credential retired', async () => {
		const runtime = createFakeRuntime();
		const store = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const selected = cloudSession('slot');
		try {
			await store.storeSession(id, selected);
			const persist = runtime.storage.store;
			runtime.storage.store = async (key, value) => {
				if (key === 'integrations:cloudLogout') throw new Error('logout marker unavailable');

				await persist(key, value);
			};
			runtime.storage.deleteSecret = async () => {
				throw new Error('keychain unavailable');
			};
			await assert.rejects(store.retireCloudAccount(store.beginCloudSync()), /logout marker unavailable/);
			assert.equal(await store.peekStoredSession(id, selected.id, true, selected.domain), undefined);
			assert.equal(await store.captureStoredRelationshipCurrency(id, selected), undefined);
		} finally {
			store.dispose();
		}
	});

	test('an identical fresh cloud credential survives a delayed logout and storage reopen', async () => {
		const runtime = createFakeRuntime();
		const store = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const selected = cloudSession('slot');
		try {
			await store.storeSession(id, selected);
			const cutoff = store.beginCloudSync();
			await store.storeSession(id, selected);
			await store.retireCloudAccount(cutoff);
			const reopened = new ConfiguredIntegrationService({ ...runtime, storage: { ...runtime.storage } });
			try {
				assert.ok((await reopened.captureStoredRelationshipCurrency(id, selected))?.());
				const replacement = { ...selected, accessToken: 'new' };
				await reopened.storeSession(id, replacement);
				const next = new ConfiguredIntegrationService({ ...runtime, storage: { ...runtime.storage } });
				try {
					assert.ok((await next.captureStoredRelationshipCurrency(id, replacement))?.());
					await next.retireCloudAccount(next.beginCloudSync());
					assert.equal(
						await next.getStoredSession(id, { ...githubDescriptor, connectionId: selected.id }),
						undefined,
					);
				} finally {
					next.dispose();
				}
			} finally {
				reopened.dispose();
			}
		} finally {
			store.dispose();
		}
	});

	test('reopening after cleanup keeps a departed host slot distinct from a standalone manual session', async () => {
		const runtime = createFakeRuntime();
		const store = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const selected = cloudSession('slot');
		try {
			await store.storeSession(id, selected);
			await store.retireCloudAccount(store.beginCloudSync());
			const reopened = new ConfiguredIntegrationService({ ...runtime, storage: { ...runtime.storage } });
			try {
				assert.equal(await reopened.confirmHostCloudSession(id, selected, reopened.lastCloudLogout), false);
				assert.ok(await reopened.confirmHostCloudSession(id, cloudSession('manual'), reopened.lastCloudLogout));
				await reopened.storeSession(id, selected);
				assert.ok(await reopened.confirmHostCloudSession(id, selected, reopened.lastCloudLogout));
			} finally {
				reopened.dispose();
			}
		} finally {
			store.dispose();
		}
	});

	test('a cold legacy cloud credential in the local key cannot rehydrate after logout', async () => {
		const runtime = createFakeRuntime();
		const store = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		try {
			await runtime.storage.storeSecret(
				'integration.auth:github|github.com',
				JSON.stringify({
					id: 'github.com',
					scopes: ['repo'],
					accessToken: 'legacy',
					expiresAt: '2099-01-01',
					type: 'oauth',
				}),
			);
			await store.storeSession(id, cloudSession('local', { cloud: false, type: 'pat' }));
			await store.retireCloudAccount(store.beginCloudSync());
			assert.equal(
				await store.getStoredSession(id, { ...githubDescriptor, connectionId: 'github.com' }),
				undefined,
			);
			assert.equal(await runtime.storage.getSecret('integration.auth.cloud:github|github.com'), undefined);
			assert.equal(
				(await store.getStoredSession(id, { ...githubDescriptor, connectionId: 'local' }))?.accessToken,
				'token-local',
			);
		} finally {
			store.dispose();
		}
	});

	test('a provider-wide removal retires the selected cloud membership before any secret deletion', async () => {
		const runtime = createFakeRuntime();
		const reader = new ConfiguredIntegrationService(runtime);
		const signingOut = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const selected = cloudSession('selected');
		await signingOut.storeSession(id, selected);
		await signingOut.storeSession(id, { ...selected, cloud: false });
		const current = await reader.captureConfiguredConnection(id, selected.id);
		assert.ok(current);
		assert.ok(current());
		await signingOut.deleteConnection(id, selected.id, false);
		assert.ok(current());
		let currencyAtSignOut: boolean | undefined;
		signingOut.onWillRemoveSessions(() => {
			currencyAtSignOut = current();
		});
		await signingOut.deleteAllStoredSessions(id, true);
		assert.equal(currencyAtSignOut, false);
		await signingOut.storeSession(id, selected);
		assert.equal(current(), false);
		assert.ok((await reader.captureConfiguredConnection(id, selected.id))?.());
		reader.dispose();
		signingOut.dispose();
	});

	test('disposal in the pre-store event prevents the first secret side effect', async () => {
		const runtime = createFakeRuntime();
		const first = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		first.onWillChangeSession(() => first.dispose());
		assert.equal(await first.storeSession(id, cloudSession('old'), { signOutMark: first.getSignOutMark() }), false);
		assert.equal(await runtime.storage.getSecret('integration.auth.cloud:github|old'), undefined);
		assert.deepEqual(first.getConfigured(), []);
	});

	test('serializes overlapping writes and proof binding across services sharing storage', async () => {
		const runtime = createFakeRuntime();
		const first = new ConfiguredIntegrationService(runtime);
		const second = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const original = cloudSession('selected');
		const rotated = { ...original, accessToken: 'rotated' };
		await first.storeSession(id, original);
		const current = await second.captureStoredRelationshipCurrency(id, original);
		assert.ok(current?.());

		const entered = defer<void>();
		const release = defer<void>();
		const storeSecret = runtime.storage.storeSecret.bind(runtime.storage);
		const tokens: string[] = [];
		runtime.storage.storeSecret = async (key, value) => {
			const { accessToken } = JSON.parse(value) as ProviderAuthenticationSession;
			tokens.push(accessToken);
			if (accessToken === rotated.accessToken) {
				entered.fulfill();
				await release.promise;
			}
			await storeSecret(key, value);
		};

		const write = first.storeSession(id, rotated);
		await entered.promise;
		assert.equal(current?.(), false);
		const stale = second.captureStoredRelationshipCurrency(id, original);
		const restored = second.storeSession(id, original);
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(tokens, [rotated.accessToken]);
		release.fulfill();
		assert.ok(await write);
		assert.equal(await stale, undefined);
		assert.ok(await restored);
		assert.deepEqual(tokens, [rotated.accessToken, original.accessToken]);
		assert.equal(current?.(), false);
		assert.ok((await first.captureStoredRelationshipCurrency(id, original))?.());
		first.dispose();
		second.dispose();
	});

	test('refuses a refresh started before a second service signed out the connection', async () => {
		const runtime = createFakeRuntime();
		const refreshing = new ConfiguredIntegrationService(runtime);
		const signingOut = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const session = cloudSession('selected');
		await refreshing.storeSession(id, session);
		const signOutMark = refreshing.getSignOutMark();
		await signingOut.deleteConnection(id, session.id, true);
		assert.equal(
			await refreshing.storeSession(
				id,
				{ ...session, accessToken: 'late refresh' },
				{ signOutMark: signOutMark },
			),
			false,
		);
		assert.equal(await refreshing.peekStoredSession(id, session.id, true, session.domain), undefined);
		refreshing.dispose();
		signingOut.dispose();
	});

	test('a partial secret and descriptor write retires existing and newly requested proofs', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		const id = GitCloudHostIntegrationId.GitHub;
		const original = cloudSession('selected');
		const local = { ...original, cloud: false, accessToken: 'local' };
		await service.storeSession(id, local);
		await service.storeSession(id, original);
		const current = await service.captureStoredRelationshipCurrency(id, original);
		assert.ok(current?.());
		const rotated = { ...original, account: { id: 'changed', label: 'changed' }, accessToken: 'changed' };
		const store = runtime.storage.store;
		runtime.storage.store = async () => {
			throw new Error('descriptor store failed');
		};
		await assert.rejects(service.storeSession(id, rotated));
		assert.equal(current?.(), false);
		assert.ok(!(await service.captureStoredRelationshipCurrency(id, rotated))?.());
		runtime.storage.store = store;
		await service.storeSession(id, { ...local, accessToken: 'other-local' });
		assert.equal(await service.captureStoredRelationshipCurrency(id, rotated), undefined);
		await service.storeSession(id, rotated);
		const reloaded = new ConfiguredIntegrationService(runtime);
		assert.equal(reloaded.getConfigured(id, { cloud: true })[0].accountName, 'changed');
		reloaded.dispose();
		assert.ok((await service.captureStoredRelationshipCurrency(id, rotated))?.());
		service.dispose();
	});
});

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

	test('rehydrates a Trello session preserving the appKey (#5438)', async () => {
		const runtime = createFakeRuntime();
		// A stored Trello cloud session carries the app key its client needs alongside the token.
		await runtime.storage.store('integrations:configured', {
			trello: [{ id: 'trello.com', cloud: true, integrationId: 'trello', scopes: '' }],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:trello|trello.com',
			JSON.stringify({
				id: 'trello.com',
				accessToken: 'tok',
				scopes: [],
				cloud: true,
				type: 'oauth',
				domain: 'trello.com',
				appKey: 'my-app-key',
			}),
		);

		const service = new ConfiguredIntegrationService(runtime);
		const session = await service.getStoredSession(IssuesCloudHostIntegrationId.Trello, {
			domain: 'trello.com',
			scopes: [],
		});

		assert.ok(session != null, 'stored Trello session resolves');
		assert.equal(session.appKey, 'my-app-key', 'the appKey survives rehydration (without it every read no-ops)');
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

	test('reads a legacy self-managed full-url session by host while normalizing the configured domain', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			'cloud-github-enterprise': [
				{
					cloud: true,
					integrationId: 'cloud-github-enterprise',
					domain: 'https://gh.example.com/api/v3',
					scopes: 'repo',
				},
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|https://gh.example.com/api/v3',
			JSON.stringify({
				id: 'https://gh.example.com/api/v3',
				accessToken: 'ent',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'https://gh.example.com/api/v3',
			}),
		);

		const service = new ConfiguredIntegrationService(runtime);
		const session = await service.getStoredSession(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, {
			domain: 'gh.example.com',
			scopes: ['repo'],
		});

		assert.ok(session != null, 'legacy full-url session resolves from the normalized host scope');
		assert.equal(session.accessToken, 'ent');
		assert.equal(
			service.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise)[0].domain,
			'gh.example.com',
		);
	});

	test('getConfiguredConnectionId returns undefined for a legacy self-managed connection keyed by domain', async () => {
		const runtime = createFakeRuntime();
		// Legacy/migrated single connection: hydration backfills the descriptor id from the domain, so
		// `id === domain` (see ConfiguredIntegrationDescriptor.id). That is NOT a real backend token id, and
		// returning it would target `v1/provider-tokens/tokens/{domain}` (rejected by the backend as a non-uuid).
		await runtime.storage.store('integrations:configured', {
			'cloud-github-enterprise': [
				{ cloud: true, integrationId: 'cloud-github-enterprise', domain: 'gh.example.com', scopes: 'repo' },
			],
		});

		const service = new ConfiguredIntegrationService(runtime);

		assert.equal(
			service.getConfiguredConnectionId(
				GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				'gh.example.com',
				true,
			),
			undefined,
			'a domain-keyed legacy id must not be returned as a token id',
		);
	});

	test('getConfiguredConnectionId returns the token id for a real multi-account self-managed connection', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			'cloud-github-enterprise': [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: 'cloud-github-enterprise',
					domain: 'ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});

		const service = new ConfiguredIntegrationService(runtime);

		assert.equal(
			service.getConfiguredConnectionId(
				GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				'ghe-a.example.com',
				true,
			),
			'ghe-a1',
		);
	});

	test('getConfiguredConnectionId returns undefined for a legacy cloud connection keyed by the canonical domain', async () => {
		const runtime = createFakeRuntime();
		// Legacy cloud descriptor: hydration backfills the id from the canonical domain (`github.com`) while
		// the descriptor has no domain, so `id !== domain` alone would return `github.com` as a token id.
		await runtime.storage.store('integrations:configured', {
			github: [{ cloud: true, integrationId: 'github', scopes: 'repo' }],
		});

		const service = new ConfiguredIntegrationService(runtime);

		assert.equal(
			service.getConfiguredConnectionId(GitCloudHostIntegrationId.GitHub, undefined, true),
			undefined,
			'a canonical-domain-keyed legacy id must not be returned as a token id',
		);
	});

	test('getConfiguredConnectionId returns undefined when only a local (PAT) connection matches the cloud scope', async () => {
		const runtime = createFakeRuntime();
		// Only a local (PAT) descriptor (id !== domain) matches this host. scopeConnectionCandidates falls back
		// to the non-cloud set, so `id !== domain` alone would return the local id as a cloud token id.
		await runtime.storage.store('integrations:configured', {
			'cloud-github-enterprise': [
				{
					id: 'ghe-x',
					cloud: false,
					integrationId: 'cloud-github-enterprise',
					domain: 'gh.example.com',
					scopes: 'repo',
				},
			],
		});

		const service = new ConfiguredIntegrationService(runtime);

		assert.equal(
			service.getConfiguredConnectionId(
				GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				'gh.example.com',
				true,
			),
			undefined,
			'a local (PAT) connection id must not be returned as a cloud token id',
		);
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

	test('persists workspaces independently and preserves them across session re-stores', async () => {
		const runtime = createFakeRuntime();
		const service = new ConfiguredIntegrationService(runtime);
		for (const id of ['one', 'two']) {
			await service.storeSession(IssuesCloudHostIntegrationId.Linear, cloudSession(id), {
				resource: { id: `org-${id}`, name: `Workspace ${id}` },
			});
			await service.storeSession(IssuesCloudHostIntegrationId.Linear, cloudSession(id));
		}

		const reloaded = new ConfiguredIntegrationService(runtime);
		const descriptors = reloaded.getConfigured(IssuesCloudHostIntegrationId.Linear);
		assert.equal(descriptors.length, 2);
		for (const descriptor of descriptors) {
			assert.equal(descriptor.resourceName, `Workspace ${descriptor.id}`);
			assert.equal(descriptor.resourceId, `org-${descriptor.id}`);
			assert.equal(descriptor.accountName, descriptor.id);
		}

		service.dispose();
		reloaded.dispose();
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

	test('a cloud-scoped read resolves the cloud connection id when local and cloud ids differ', async () => {
		const runtime = createFakeRuntime();
		// Same domain, but the local (PAT) and cloud descriptors carry DIFFERENT ids. A cloud-scoped read
		// must key off the cloud id, not silently resolve the local descriptor's id and miss the cloud secret.
		// Cloud (non-self-managed) descriptors are stored without a domain, so both variants share the same
		// candidate set. The local descriptor is ordered first and neither is primary, so an unscoped resolve
		// picks the local id (candidates[0]); only cloud-scoping steers it to the cloud descriptor.
		await runtime.storage.store('integrations:configured', {
			github: [
				{ id: 'local-x', cloud: false, integrationId: 'github', scopes: 'repo' },
				{ id: 'cloud-y', cloud: true, integrationId: 'github', scopes: 'repo' },
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|cloud-y',
			JSON.stringify({ id: 'cloud-y', accessToken: 'cloud-token', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);
		await runtime.storage.storeSecret(
			'integration.auth:github|local-x',
			JSON.stringify({ id: 'local-x', accessToken: 'local-token', scopes: ['repo'], cloud: false, type: 'pat' }),
		);

		const service = new ConfiguredIntegrationService(runtime);
		const session = await service.getStoredSession(GitCloudHostIntegrationId.GitHub, {
			...githubDescriptor,
			cloud: true,
		});

		assert.equal(session?.accessToken, 'cloud-token', 'cloud-scoped read resolves the cloud connection secret');
	});

	test('a cloud-scoped delete clears the cloud secret when a differing local id is primary', async () => {
		const runtime = createFakeRuntime();
		// Mixed local+cloud with different ids; the local descriptor is primary. A cloud-scoped delete must
		// clear the cloud secret (resolving the cloud id), not resolve the primary local id and leave it.
		await runtime.storage.store('integrations:configured', {
			github: [
				{ id: 'local-x', cloud: false, integrationId: 'github', scopes: 'repo', primary: true },
				{ id: 'cloud-y', cloud: true, integrationId: 'github', scopes: 'repo', primary: false },
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|cloud-y',
			JSON.stringify({ id: 'cloud-y', accessToken: 'cloud-token', scopes: ['repo'], cloud: true, type: 'oauth' }),
		);
		await runtime.storage.storeSecret(
			'integration.auth:github|local-x',
			JSON.stringify({ id: 'local-x', accessToken: 'local-token', scopes: ['repo'], cloud: false, type: 'pat' }),
		);

		const service = new ConfiguredIntegrationService(runtime);
		await service.deleteStoredSessions(
			GitCloudHostIntegrationId.GitHub,
			{ ...githubDescriptor, cloud: true },
			true,
			{ preserveConfigured: true },
		);

		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github|cloud-y'),
			undefined,
			'cloud secret cleared for the cloud connection id',
		);
		assert.ok(
			(await runtime.storage.getSecret('integration.auth:github|local-x')) != null,
			'local PAT secret left intact by the cloud-scoped delete',
		);
		// `preserveConfigured: true` is the contract `deleteSession` relies on for a forced re-sync: the
		// secret is gone but `getConfigured()` must still report the connection so callers don't see a
		// spurious disconnect while a replacement session is being fetched.
		assert.ok(
			service.getConfigured(GitCloudHostIntegrationId.GitHub).some(d => d.id === 'cloud-y'),
			'configured descriptor for the deleted connection survives when preserveConfigured is set',
		);
	});

	test('deleteAllStoredSessions falls back to the id (not an empty key) for a self-managed provider with no descriptors', async () => {
		const runtime = createFakeRuntime();
		// Orphaned cloud secret with no configured descriptor. The canonical domain for a self-managed cloud
		// provider is '', so the fallback must key off the id, not produce `...|` (an empty connection id).
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|cloud-github-enterprise',
			JSON.stringify({
				id: 'cloud-github-enterprise',
				accessToken: 'orphan',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
			}),
		);

		const service = new ConfiguredIntegrationService(runtime);
		await service.deleteAllStoredSessions(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise);

		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:cloud-github-enterprise|cloud-github-enterprise'),
			undefined,
			'orphaned secret cleared via the id fallback',
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
