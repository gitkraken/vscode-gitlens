import * as assert from 'assert';
import type { Account } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { IntegrationBase } from '@gitlens/integrations/models/integration.js';
import { CacheProvider } from '../cache.js';

function createIntegration(domain: string, id: string = 'cloud-github-enterprise'): IntegrationBase {
	const integration = {
		id: id,
		domain: domain,
		maybeConnected: true,
		sessionFingerprint: 'shared-session',
	};
	return integration as IntegrationBase;
}

suite('CacheProvider', () => {
	test('keeps same-key issues cached independently across self-managed hosts', async () => {
		const cache = new CacheProvider({} as never);
		const resource = { key: 'owner/repo', owner: 'owner', name: 'repo' };
		const hostA = createIntegration('ghe-a.example.com');
		const hostB = createIntegration('ghe-b.example.com');
		const issueA = { id: '1', title: 'Host A', closed: false } satisfies Partial<Issue> as Issue;
		const issueB = { id: '1', title: 'Host B', closed: false } satisfies Partial<Issue> as Issue;

		await cache.getIssue('1', resource, hostA, () => ({ value: Promise.resolve(issueA) }));
		assert.strictEqual(cache.peekIssue('1', resource, hostB), undefined);
		await cache.getIssue('1', resource, hostB, () => ({ value: Promise.resolve(issueB) }));
		assert.strictEqual(cache.peekIssue('1', resource, hostA), issueA);
		assert.strictEqual(cache.peekIssue('1', resource, hostB), issueB);
		assert.strictEqual(cache.peekIssue('1', resource, createIntegration('https://GHE-A.EXAMPLE.COM:443/')), issueA);
		assert.strictEqual(cache.peekIssue('1', resource, createIntegration('ghe-a.example.com:8443')), undefined);
		assert.strictEqual(cache.peekIssue('1', resource, undefined), undefined);
		assert.strictEqual(
			await cache.getIssue('1', resource, hostA, () => {
				assert.fail('Host B must not replace or invalidate host A');
			}),
			issueA,
		);
	});

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

	test('issues from self-managed hosts are keyed by domain (#5872)', async () => {
		const cache = new CacheProvider({} as never);
		const resource: ResourceDescriptor = { id: '10000', key: 'PROJ', name: 'PROJ' };
		const hostA = createIntegration('jira-a.example.com', 'jira-server');
		const hostB = createIntegration('jira-b.example.com', 'jira-server');
		const issueA = { id: 'PROJ-1', title: 'Host A' } satisfies Partial<Issue> as Issue;

		await cache.getIssue('PROJ-1', resource, hostA, () => ({ value: Promise.resolve(issueA) }));

		assert.strictEqual(cache.peekIssue('PROJ-1', resource, hostA), issueA);
		assert.strictEqual(
			cache.peekIssue('PROJ-1', resource, hostB),
			undefined,
			'a same-key issue cached for one host is not returned for another',
		);
	});

	test('a stale rejected load does not evict its replacement', async () => {
		const cache = new CacheProvider({} as never);
		const firstValue = Object.create(null) as DefaultBranch;
		const replacementValue = Object.create(null) as DefaultBranch;
		let rejectFirst: ((reason: Error) => void) | undefined;
		const first = cache.get('defaultBranch', 'repo:one', 'old-etag', cacheable => ({
			value: new Promise<DefaultBranch>((_resolve, reject) => {
				rejectFirst = reason => {
					cacheable.invalidate();
					reject(reason);
				};
			}),
		}));
		const replacement = cache.get('defaultBranch', 'repo:one', 'new-etag', () => ({
			value: Promise.resolve(replacementValue),
		}));

		assert.ok(rejectFirst != null);
		rejectFirst(new Error('stale load failed'));
		await assert.rejects(first as Promise<DefaultBranch | undefined>);
		await replacement;
		await Promise.resolve();

		let reloads = 0;
		const cached = await cache.get('defaultBranch', 'repo:one', 'new-etag', () => {
			reloads++;
			return { value: firstValue };
		});

		assert.strictEqual(cached, replacementValue);
		assert.equal(reloads, 0);
	});
});
