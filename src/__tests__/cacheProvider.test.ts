import * as assert from 'assert';
import type { Account } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { IntegrationIds } from '@gitlens/integrations/constants.js';
import {
	GitSelfManagedHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '@gitlens/integrations/constants.js';
import type { IntegrationCacheDescriptor } from '@gitlens/integrations/index.js';
import { defer } from '@gitlens/utils/promise.js';
import { CacheProvider } from '../cache.js';

function createIntegration(
	domain: string,
	id: IntegrationIds = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
): IntegrationCacheDescriptor {
	return {
		id: id,
		domain: domain,
		maybeConnected: true,
		sessionFingerprint: 'shared-session',
	};
}

function createPullRequest(title: string): PullRequest {
	return {
		id: '1',
		title: title,
		type: 'pullrequest',
		state: 'opened',
		closed: false,
	} satisfies Partial<PullRequest> as PullRequest;
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
		const hostA = createIntegration('jira-a.example.com', IssuesSelfManagedHostIntegrationId.JiraServer);
		const hostB = createIntegration('jira-b.example.com', IssuesSelfManagedHostIntegrationId.JiraServer);
		const issueA = { id: 'PROJ-1', title: 'Host A' } satisfies Partial<Issue> as Issue;

		await cache.getIssue('PROJ-1', resource, hostA, () => ({ value: Promise.resolve(issueA) }));

		assert.strictEqual(cache.peekIssue('PROJ-1', resource, hostA), issueA);
		assert.strictEqual(
			cache.peekIssue('PROJ-1', resource, hostB),
			undefined,
			'a same-key issue cached for one host is not returned for another',
		);
	});

	test('isolates Enterprise pull request lookups and invalidation by origin', async () => {
		const cache = new CacheProvider({} as never);
		const resource = { key: 'org/repo', owner: 'org', name: 'repo' };
		const domain = 'ghe.example.test:8443';
		const http = { ...createIntegration(domain), installationOrigin: `http://${domain}` };
		const https = { ...createIntegration(domain), installationOrigin: `https://${domain}` };
		const httpPullRequest = createPullRequest('HTTP pull request');
		const httpsPullRequest = createPullRequest('HTTPS pull request');
		const refreshed = createPullRequest('Refreshed pull request');
		const issue = { id: '2', title: 'Issue', type: 'issue' } satisfies Partial<Issue> as Issue;

		const loadHttp = () => ({ value: Promise.resolve(httpPullRequest) });
		const loadHttps = () => ({ value: Promise.resolve(httpsPullRequest) });
		const loadRefreshed = () => ({ value: Promise.resolve(refreshed) });
		const fail = () => assert.fail('the cache must retain this entry');

		await cache.getPullRequest('1', resource, http, loadHttp);
		await cache.getPullRequestForBranch('main', resource, http, loadHttp);
		await cache.getPullRequestForSha('abc', resource, http, loadHttp);
		await cache.getIssueOrPullRequest('1', 'pullrequest', resource, http, loadHttp);
		assert.strictEqual(await cache.getPullRequest('1', resource, https, loadHttps), httpsPullRequest);
		assert.strictEqual(await cache.getPullRequestForBranch('main', resource, https, loadHttps), httpsPullRequest);
		assert.strictEqual(await cache.getPullRequestForSha('abc', resource, https, loadHttps), httpsPullRequest);
		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', 'pullrequest', resource, https, loadHttps),
			httpsPullRequest,
		);

		await cache.getIssueOrPullRequest('2', undefined, resource, http, () => ({ value: Promise.resolve(issue) }));
		await cache.getIssueOrPullRequest('2', 'issue', resource, http, () => ({ value: Promise.resolve(issue) }));

		cache.deletePullRequests({ id: http.id, domain: http.installationOrigin });

		assert.strictEqual(await cache.getPullRequest('1', resource, http, loadRefreshed), refreshed);
		assert.strictEqual(await cache.getPullRequestForBranch('main', resource, http, loadRefreshed), refreshed);
		assert.strictEqual(await cache.getPullRequestForSha('abc', resource, http, loadRefreshed), refreshed);
		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', 'pullrequest', resource, http, loadRefreshed),
			refreshed,
		);
		assert.strictEqual(await cache.getPullRequest('1', resource, https, fail), httpsPullRequest);
		assert.strictEqual(await cache.getPullRequestForBranch('main', resource, https, fail), httpsPullRequest);
		assert.strictEqual(await cache.getPullRequestForSha('abc', resource, https, fail), httpsPullRequest);
		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', 'pullrequest', resource, https, fail),
			httpsPullRequest,
		);
		assert.strictEqual(await cache.getIssueOrPullRequest('2', undefined, resource, http, fail), issue);
		assert.strictEqual(await cache.getIssueOrPullRequest('2', 'issue', resource, http, fail), issue);
	});

	test('invalidates an Enterprise pull request when the linked lookup used an issue hint', async () => {
		const cache = new CacheProvider({} as never);
		const resource = { key: 'org/repo' };
		const domain = 'ghe.example.test:8443';
		const http = { ...createIntegration(domain), installationOrigin: `http://${domain}` };
		const https = { ...createIntegration(domain), installationOrigin: `https://${domain}` };
		const old = createPullRequest('Old');
		const refreshed = createPullRequest('Refreshed');
		const sibling = createPullRequest('Sibling');

		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', 'issue', resource, http, () => ({ value: old })),
			old,
		);
		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', 'issue', resource, https, () => ({ value: sibling })),
			sibling,
		);

		cache.deletePullRequests({ id: http.id, domain: http.installationOrigin });

		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', 'issue', resource, http, () => ({ value: refreshed })),
			refreshed,
		);
		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', 'issue', resource, https, () => assert.fail('retain the sibling')),
			sibling,
		);
	});

	test('a pending Enterprise linked lookup cannot restore a pull request after invalidation', async () => {
		const cache = new CacheProvider({} as never);
		const resource = { key: 'org/repo' };
		const integration = {
			...createIntegration('ghe.example.test'),
			installationOrigin: 'https://ghe.example.test',
		};
		const stale = createPullRequest('Stale');
		const fresh = createPullRequest('Fresh');
		const pending = defer<PullRequest>();
		const result = cache.getIssueOrPullRequest('1', undefined, resource, integration, () => ({
			value: pending.promise,
		}));

		cache.deletePullRequests({ id: integration.id, domain: integration.installationOrigin });

		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', undefined, resource, integration, () => ({ value: fresh })),
			fresh,
		);
		pending.fulfill(stale);
		assert.strictEqual(await result, stale);
		assert.strictEqual(
			await cache.getIssueOrPullRequest('1', undefined, resource, integration, () => {
				assert.fail('the replacement must remain cached');
			}),
			fresh,
		);
	});

	test('an Enterprise read needs origin and credential proof to share a cache entry', async () => {
		const cache = new CacheProvider({} as never);
		const resource = { key: 'org/repo' };
		const bare = createIntegration('ghe.example.test');
		const proved = { ...bare, installationOrigin: 'https://ghe.example.test' };
		const first = createPullRequest('First');
		const second = createPullRequest('Second');
		const firstLoad = () => ({ value: first });
		const secondLoad = () => ({ value: second });
		const fail = () => assert.fail('a repeated proved read must reuse its cache entry');

		const wrongOrigin = { ...proved, installationOrigin: 'http://ghe.example.test' };
		const replacement = { ...proved, sessionFingerprint: 'replacement' };
		assert.strictEqual(await cache.getPullRequestForBranch('main', resource, bare, firstLoad), first);
		assert.strictEqual(await cache.getPullRequestForBranch('main', resource, proved, secondLoad), second);
		assert.strictEqual(await cache.getPullRequestForBranch('main', resource, proved, fail), second);
		assert.strictEqual(await cache.getPullRequestForSha('abc', resource, proved, secondLoad), second);
		for (const descriptor of [bare, wrongOrigin, replacement]) {
			assert.strictEqual(cache.peekPullRequestForBranch('main', resource, descriptor), undefined);
			assert.strictEqual(cache.peekPullRequestForSha('abc', resource, descriptor), undefined);
		}

		assert.strictEqual(cache.peekPullRequestForBranch('main', resource, proved), second);
		assert.strictEqual(cache.peekPullRequestForSha('abc', resource, proved), second);
		assert.strictEqual(await cache.getPullRequestForBranch('main', resource, replacement, firstLoad), first);
		assert.strictEqual(cache.peekPullRequestForBranch('main', resource, replacement), first);
		assert.strictEqual(cache.peekPullRequestForBranch('main', resource, proved), undefined);
		assert.deepStrictEqual(
			await cache.getPullRequestsForBranchName('main', resource, bare, () => ({ value: [first] })),
			[first],
		);
		assert.deepStrictEqual(
			await cache.getPullRequestsForBranchName('main', resource, bare, () => ({ value: [second] })),
			[second],
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
