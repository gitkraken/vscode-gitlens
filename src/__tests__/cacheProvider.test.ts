import * as assert from 'assert';
import type { Account } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
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
	test('getResourceUsage reports total and per-type retained entry counts', () => {
		const cache = new CacheProvider({} as never);
		const account = Object.create(null) as Account;
		const defaultBranch = Object.create(null) as DefaultBranch;
		cache.get('currentAccount', 'id:one', undefined, () => ({ value: account }));
		cache.get('currentAccount', 'id:two', undefined, () => ({ value: account }));
		cache.get('defaultBranch', 'repo:one', undefined, () => ({ value: defaultBranch }));

		assert.deepStrictEqual(cache.getResourceUsage(), {
			'entries.total.count': 3,
			'entries.currentAccount.count': 2,
			'entries.defaultBranch.count': 1,
		});
	});

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
