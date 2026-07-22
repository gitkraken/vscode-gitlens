import * as assert from 'assert';
import type { Account } from '@gitlens/git/models/author.js';
import type { IntegrationBase } from '@gitlens/integrations/models/integration.js';
import { CacheProvider } from '../cache.js';

function createIntegration(domain: string): IntegrationBase {
	const integration = {
		id: 'cloud-github-enterprise',
		domain: domain,
		maybeConnected: true,
		sessionFingerprint: 'shared-session',
	};
	return integration as IntegrationBase;
}

suite('CacheProvider', () => {
	test('getCurrentAccount keys self-managed integrations by domain', async () => {
		const cache = new CacheProvider({} as never);
		const lookups: string[] = [];

		const accountA1 = await cache.getCurrentAccount(createIntegration('ghe-a.example.com'), () => ({
			value: Promise.resolve({
				id: 'acct-a',
				name: 'Account A',
				username: 'acct-a',
			} satisfies Partial<Account> as Account),
		}));
		lookups.push(accountA1?.id ?? '');

		const accountB = await cache.getCurrentAccount(createIntegration('ghe-b.example.com'), () => ({
			value: Promise.resolve({
				id: 'acct-b',
				name: 'Account B',
				username: 'acct-b',
			} satisfies Partial<Account> as Account),
		}));
		lookups.push(accountB?.id ?? '');

		const accountA2 = await cache.getCurrentAccount(createIntegration('ghe-a.example.com'), () => ({
			value: Promise.resolve({
				id: 'acct-a-refetched',
				name: 'Account A',
				username: 'acct-a-refetched',
			} satisfies Partial<Account> as Account),
		}));

		assert.deepStrictEqual(lookups, ['acct-a', 'acct-b']);
		assert.strictEqual(accountA2?.id, 'acct-a', 'the first domain keeps its own cached account entry');
	});
});
