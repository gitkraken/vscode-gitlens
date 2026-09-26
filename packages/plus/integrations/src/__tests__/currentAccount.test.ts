import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { RequestRateLimitError } from '@gitlens/git/errors.js';
import type { Account } from '@gitlens/git/models/author.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import type { IntegrationIds } from '../constants.js';
import { createIntegrationManager as createPublicIntegrationManager } from '../index.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IntegrationService } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, primarySession } from './sweepHelpers.js';

/**
 * `IntegrationManager.getCurrentAccount` — "who am I on this provider / connection", for a git host or issue
 * tracker alike, going through the same host-supplied cache as {@link IntegrationBase.getCurrentAccount}.
 *
 * What these pin: an absent account is NEVER reported without a warning — unlike a list/batch read, there is no
 * benign empty answer here — and a provider that can't answer at all (Jira, Linear, Trello have no
 * current-account lookup) is told apart from one that simply has no session.
 */

type Manager = ReturnType<typeof createIntegrationManager>;

function fakeAccount(id: string, providerId: IntegrationIds, domain: string): Account {
	return {
		id: id,
		username: id,
		name: id,
		email: undefined,
		avatarUrl: undefined,
		provider: { id: providerId, name: providerId, domain: domain, icon: providerId },
	};
}

function trackerSession(domain: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'primary', label: 'primary' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

async function connectedJira(runtime: FakeRuntime): Promise<{ manager: Manager; jira: IssuesIntegration }> {
	const manager = createIntegrationManager(runtime);
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');
	return { manager: manager, jira: jira };
}

function stubProviderAccount(
	integration: unknown,
	fn: (session: ProviderAuthenticationSession) => Promise<Account>,
): void {
	(integration as { getProviderCurrentAccount: typeof fn }).getProviderCurrentAccount = fn;
}

suite('IntegrationManager.getCurrentAccount', () => {
	test('a connected git host returns its account', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubProviderAccount(gh, async () => fakeAccount('me', GitCloudHostIntegrationId.GitHub, 'github.com'));

		const result = await manager.getCurrentAccount({ providerId: GitCloudHostIntegrationId.GitHub });

		assert.equal(result.account?.id, 'me');
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('an issue tracker with no current-account lookup is reported unsupported, not no-connection', async () => {
		// Real Jira/Linear/Trello never implement `getProviderCurrentAccount` — a resource-less "who am I" has
		// no meaning on a per-site tracker. A connected-but-unsupported provider must not read as "not connected".
		const { manager } = await connectedJira(createFakeRuntime());

		const result = await manager.getCurrentAccount({ providerId: IssuesCloudHostIntegrationId.Jira });

		assert.equal(result.account, undefined);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'other');
		assert.match(result.warnings[0].message, /not supported/i);

		manager.dispose();
	});

	test('connectionId reads that connection account, not the primary', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|secondary',
			JSON.stringify({ ...primarySession('secondary-token'), id: 'secondary' }),
		);
		const { manager, gh } = await connectedGitHub(runtime);
		stubProviderAccount(gh, async session =>
			fakeAccount(session.accessToken, GitCloudHostIntegrationId.GitHub, 'github.com'),
		);

		const primary = await manager.getCurrentAccount({ providerId: GitCloudHostIntegrationId.GitHub });
		const secondary = await manager.getCurrentAccount({
			providerId: GitCloudHostIntegrationId.GitHub,
			connectionId: 'secondary',
		});

		assert.equal(primary.account?.id, 't');
		assert.equal(secondary.account?.id, 'secondary-token');

		manager.dispose();
	});

	test('no session gives no account, a no-connection warning and fetchFailed', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getCurrentAccount({ providerId: GitCloudHostIntegrationId.GitHub });

		assert.equal(result.account, undefined);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'no-connection');

		manager.dispose();
	});

	test('an unresolvable self-managed target with nothing configured still carries a warning', async () => {
		// `earlyReturnConnectionWarnings` answers a silent empty result for the untargeted primary path on the
		// list reads, but "who am I" has no benign empty answer — the fallback must still warn.
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getCurrentAccount({
			providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		});

		assert.equal(result.account, undefined);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'no-connection');

		manager.dispose();
	});

	test('a provider failure gives no account and a warning of the right kind', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubProviderAccount(gh, async () => {
			throw new RequestRateLimitError(new Error('rate limited'), undefined, undefined);
		});

		const result = await manager.getCurrentAccount({ providerId: GitCloudHostIntegrationId.GitHub });

		assert.equal(result.account, undefined);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'rate-limit');

		manager.dispose();
	});

	test('goes through the IntegrationManagerCacheProvider.getCurrentAccount hook when the host supplies one', async () => {
		const runtime = createFakeRuntime();
		const { cache: _internalCache, ...context } = runtime;
		let hookCalls = 0;
		// A real cache, keyed and etag-checked like a host's own — mirroring `FakeRuntime`'s internal
		// `cache.getCurrentAccount`, but wired through the PUBLIC `IntegrationManagerCacheProvider` adapter, so
		// this proves the read's account and the hook-populated cache are one and the same.
		const stored = new Map<string, { etag: string | undefined; value: unknown }>();
		const manager = createPublicIntegrationManager({
			...context,
			cache: {
				getCurrentAccount: (integration, loader, options) => {
					hookCalls++;
					const key = `${integration.id}:${integration.domain ?? ''}:${options?.connectionId ?? ''}`;
					const cached = stored.get(key);
					if (cached != null && cached.etag === options?.etag) {
						return cached.value as ReturnType<typeof loader>['value'];
					}

					const entry = loader(new CacheController()).value;
					stored.set(key, { etag: options?.etag, value: entry });
					return entry;
				},
			},
		}) as IntegrationService;
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		let providerCalls = 0;
		stubProviderAccount(gh, async () => {
			providerCalls++;
			return fakeAccount('me', GitCloudHostIntegrationId.GitHub, 'github.com');
		});

		const first = await manager.getCurrentAccount({ providerId: GitCloudHostIntegrationId.GitHub });
		const second = await manager.getCurrentAccount({ providerId: GitCloudHostIntegrationId.GitHub });

		assert.equal(hookCalls, 2, 'the host cache hook is consulted on every call');
		assert.equal(providerCalls, 1, 'the second call is served from the host cache, not re-fetched');
		assert.equal(first.account?.id, 'me');
		assert.deepEqual(second.account, first.account);

		manager.dispose();
	});
});
