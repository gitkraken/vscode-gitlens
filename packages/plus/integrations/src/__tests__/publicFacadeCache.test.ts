import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Account } from '@gitlens/git/models/author.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import type { IntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

const session: ProviderAuthenticationSession = {
	id: 'primary',
	accessToken: 'token',
	account: { id: 'me', label: 'me' },
	scopes: ['repo'],
	cloud: true,
	type: 'oauth',
	domain: 'github.com',
};

const account = {
	id: 'me',
	username: 'me',
	name: 'Me',
	email: 'me@example.com',
	avatarUrl: undefined,
	provider: { id: GitCloudHostIntegrationId.GitHub, name: 'GitHub', domain: 'github.com', icon: 'github' },
} satisfies Account;

async function getGitHub(manager: IntegrationService) {
	const integration = await manager.get(GitCloudHostIntegrationId.GitHub);
	assert.ok(integration);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = session;
	return integration;
}

suite('public integration manager cache', () => {
	test('adapts account caching to a neutral integration descriptor', async () => {
		const runtime = createFakeRuntime();
		const { cache: _internalCache, ...context } = runtime;
		let observed:
			| {
					integration: { id: string; domain?: string };
					options:
						| {
								connectionId?: string;
								etag?: string;
						  }
						| undefined;
			  }
			| undefined;

		const manager = createIntegrationManager({
			...context,
			cache: {
				getCurrentAccount: (integration, loader, options) => {
					observed = { integration: integration, options: options };
					return loader(new CacheController()).value;
				},
			},
		}) as IntegrationService;
		const integration = await getGitHub(manager);
		(
			integration as unknown as {
				getProviderCurrentAccount: () => Promise<Account>;
			}
		).getProviderCurrentAccount = async () => account;

		assert.equal(await integration.getCurrentAccount(), account);
		assert.deepEqual(observed?.integration, {
			id: GitCloudHostIntegrationId.GitHub,
			domain: 'github.com',
		});
		assert.equal(observed?.options?.connectionId, undefined);
		assert.match(observed?.options?.etag ?? '', /^github:true:/);
		assert.equal('getIssue' in (observed?.integration ?? {}), false);

		manager.dispose();
	});

	test('executes account loaders uncached when the public cache is omitted', async () => {
		const runtime = createFakeRuntime();
		const { cache: _internalCache, ...context } = runtime;
		const manager = createIntegrationManager(context) as IntegrationService;
		const integration = await getGitHub(manager);
		let calls = 0;
		(
			integration as unknown as {
				getProviderCurrentAccount: () => Promise<Account>;
			}
		).getProviderCurrentAccount = async () => {
			calls++;
			return account;
		};

		await integration.getCurrentAccount();
		await integration.getCurrentAccount();

		assert.equal(calls, 2);
		manager.dispose();
	});
});
