// Initialize view-node dependencies through the extension's command registry entry point.
import '../../../container.js';
import * as assert from 'assert';
import type { Account } from '@gitlens/git/models/author.js';
import { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import { getRepositoryIdentityForPullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import { GitSelfManagedHostIntegrationId, providerFanOutConcurrency } from '@gitlens/integrations/constants.js';
import type { GitHostIntegration } from '@gitlens/integrations/models/gitHostIntegration.js';
import { getGitHubPullRequestIdentityFromMaybeUrl } from '@gitlens/integrations/providers/github/github.utils.js';
import {
	getActionablePullRequests,
	toProviderPullRequestWithUniqueId,
} from '@gitlens/integrations/providers/models.js';
import { getViewNodeId } from '../../../views/nodes/abstract/viewNode.js';
import { findLaunchpadItem, getLaunchpadItemKey, getViewerAccountKey } from '../launchpadIdentity.js';
import type { LaunchpadItem } from '../launchpadProvider.js';
import { categorizePullRequests, LaunchpadProvider } from '../launchpadProvider.js';
import type { EnrichedItem } from '../models/enrichedItem.js';

const hostA: ProviderReference = {
	id: 'cloud-github-enterprise',
	name: 'GitHub Enterprise',
	domain: 'ghe-a.example.com',
	icon: 'github',
};
const hostB: ProviderReference = { ...hostA, domain: 'ghe-b.example.com' };

function createItem(provider: ProviderReference): LaunchpadItem {
	const account: Account = {
		provider: provider,
		id: 'me',
		username: 'me',
		name: undefined,
		email: undefined,
		avatarUrl: undefined,
	};
	const pr = new PullRequest(
		provider,
		{ id: 'me', name: 'Me', username: 'me' },
		'1',
		'PR_1',
		'A pull request',
		`https://${provider.domain}/owner/repo/pull/1`,
		{ owner: 'owner', repo: 'repo' },
		'opened',
		new Date(0),
		new Date(0),
	);
	const input = toProviderPullRequestWithUniqueId(pr);
	return {
		...getActionablePullRequests([input], { id: account.id })[0],
		type: 'pullrequest',
		provider: provider,
		currentViewer: account,
		enrichable: { type: 'pr', id: input.uuid, url: pr.url, provider: 'github' },
		repoIdentity: getRepositoryIdentityForPullRequest(pr),
		underlyingPullRequest: pr,
		isNew: false,
		isSearched: false,
		actionableCategory: 'other',
		suggestedActions: [],
	};
}

function enrich(item: LaunchpadItem, type: 'pin' | 'snooze', entityUrl = item.underlyingPullRequest.url): EnrichedItem {
	return {
		id: `${type}-${entityUrl}`,
		type: type,
		provider: 'github',
		entityType: 'pr',
		entityId: item.uuid,
		entityUrl: entityUrl,
		createdAt: '',
		updatedAt: '',
	};
}

function categorize(items: LaunchpadItem[], enriched: EnrichedItem[]) {
	const accounts = new Map(items.map(item => [getViewerAccountKey(item.provider), item.currentViewer]));
	const byId: Record<string, EnrichedItem[]> = {};
	for (const item of enriched) {
		(byId[item.entityId] ??= []).push(item);
	}
	return categorizePullRequests(items, accounts, { enrichedItemsByUniqueId: byId });
}

function createSearchProvider(
	integrations: Pick<
		GitHostIntegration,
		'id' | 'domain' | 'getPullRequestIdentityFromMaybeUrl' | 'getPullRequest' | 'searchPullRequests'
	>[],
): LaunchpadProvider {
	const provider = Object.create(LaunchpadProvider.prototype) as LaunchpadProvider;
	provider.getConnectedIntegrations = () => Promise.resolve(new Map(integrations.map(i => [i.id, true])));
	Object.defineProperty(provider, 'container', {
		value: {
			integrations: {
				getIntegrationsForAccountWideRead: (id: string) =>
					Promise.resolve(integrations.filter(integration => integration.id === id)),
			},
		},
	});
	return provider;
}

suite('Launchpad host identity', () => {
	test('searches every host with bounded concurrency and retains results when one host fails', async () => {
		const items = Array.from({ length: providerFanOutConcurrency * 2 + 1 }, (_, index) =>
			createItem({ ...hostA, domain: `ghe-${index}.example.com` }),
		);
		let active = 0;
		let maximumActive = 0;
		let release!: () => void;
		const pending = new Promise<void>(resolve => {
			release = resolve;
		});
		const failure = new Error('Host unavailable');
		const queries: string[] = [];
		const provider = createSearchProvider(
			items.map((item, index) => ({
				id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				domain: item.provider.domain,
				getPullRequestIdentityFromMaybeUrl: () => undefined,
				getPullRequest: () => Promise.resolve(undefined),
				searchPullRequests: async search => {
					queries.push(search);
					maximumActive = Math.max(maximumActive, ++active);
					await pending;
					active--;
					if (index === 0) throw failure;

					return [item.underlyingPullRequest];
				},
			})),
		);
		const pendingResult = provider['getSearchedPullRequests']('author:me');
		await new Promise<void>(resolve => setImmediate(resolve));
		release();
		const result = await pendingResult;
		assert.strictEqual(maximumActive, providerFanOutConcurrency);
		assert.deepStrictEqual(
			queries,
			items.map(() => 'author:me'),
		);
		assert.deepStrictEqual(
			result.value.map(pr => pr.provider.domain).sort(),
			items
				.slice(1)
				.map(i => i.provider.domain)
				.sort(),
		);
		assert.strictEqual(result.error, failure);
	});

	test('searches a pasted pull request URL only on its host, including the web port', async () => {
		const items = [createItem(hostA), createItem(hostB), createItem({ ...hostB, domain: `${hostB.domain}:8443` })];
		const reads: string[] = [];
		const parsed: string[] = [];
		const provider = createSearchProvider(
			items.map(item => ({
				id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				domain: item.provider.domain,
				getPullRequestIdentityFromMaybeUrl: search => {
					parsed.push(item.provider.domain);
					return getGitHubPullRequestIdentityFromMaybeUrl(
						search,
						GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					);
				},
				getPullRequest: () => {
					reads.push(item.provider.domain);
					return Promise.resolve(item.underlyingPullRequest);
				},
				searchPullRequests: () => {
					assert.fail('A recognized URL must use the point lookup');
				},
			})),
		);
		const result = await provider['getSearchedPullRequests']('https://GHE-B.EXAMPLE.COM:8443/owner/repo/pull/1');
		assert.deepStrictEqual(result.value, [items[2].underlyingPullRequest]);
		assert.deepStrictEqual(reads, [`${hostB.domain}:8443`]);
		assert.deepStrictEqual(parsed, reads);
	});

	test('bounds account lookups across hosts and retains accounts when one lookup fails', async () => {
		const items = Array.from({ length: providerFanOutConcurrency * 2 + 1 }, (_, index) =>
			createItem({ ...hostA, domain: `ghe-${index}.example.com` }),
		);
		const accountsByHost = new Map(items.map(item => [item.provider.domain, item.currentViewer]));
		const reads: string[] = [];
		let active = 0;
		let maximumActive = 0;
		let release!: () => void;
		const pending = new Promise<void>(resolve => {
			release = resolve;
		});
		const provider = Object.create(LaunchpadProvider.prototype) as LaunchpadProvider;
		Object.defineProperty(provider, 'container', {
			value: {
				integrations: {
					get: (_id: string, domain: string) =>
						Promise.resolve({
							getCurrentAccount: async () => {
								reads.push(domain);
								maximumActive = Math.max(maximumActive, ++active);
								await pending;
								active--;
								if (domain === items[0].provider.domain) throw new Error('Host unavailable');

								return accountsByHost.get(domain);
							},
						}),
				},
			},
		});

		const result = provider['getViewerAccounts']([
			...items.map(item => item.underlyingPullRequest),
			items[0].underlyingPullRequest,
		]);
		await new Promise<void>(resolve => setImmediate(resolve));
		release();
		const accounts = await result;

		assert.strictEqual(maximumActive, providerFanOutConcurrency);
		assert.deepStrictEqual(reads.sort(), items.map(item => item.provider.domain).sort());
		assert.strictEqual(accounts.size, items.length - 1);
		assert.strictEqual(accounts.has(getViewerAccountKey(items[0].provider)), false);
		for (const item of items.slice(1)) {
			assert.strictEqual(accounts.get(getViewerAccountKey(item.provider)), item.currentViewer);
		}
	});

	for (const type of ['pin', 'snooze'] as const) {
		test(`ignores another host's ${type} when only one pull request is returned`, () => {
			const a = createItem(hostA);
			const b = createItem(hostB);
			assert.strictEqual(a.uuid, b.uuid);
			const baseline = categorize([b], [])[0];
			const actual = categorize([b], [enrich(a, type)])[0];
			assert.deepStrictEqual(actual, baseline);
		});

		test(`keeps each host's ${type} with both same-uuid pull requests present`, () => {
			const a = createItem(hostA);
			const b = createItem(hostB);
			const own = enrich(a, type);
			const [actualA, actualB] = categorize([a, b], [own]);
			const expectedA = getActionablePullRequests(
				[a],
				{ id: 'me' },
				{ enrichedItemsByUniqueId: { [a.uuid]: [own] } },
			)[0];
			assert.deepStrictEqual(actualA, expectedA);
			assert.deepStrictEqual(actualB, categorize([b], [])[0]);
		});
	}

	test('preserves own pins after a repository rename and normalizes the URL host', () => {
		const a = createItem(hostA);
		const pin = enrich(a, 'pin', 'https://GHE-A.EXAMPLE.COM:443/old/repo/pull/1');
		const foreign = enrich(a, 'snooze', 'https://ghe-b.example.com/old/repo/pull/1');
		const [actual] = categorize([a], [pin, foreign]);
		const expected = getActionablePullRequests(
			[a],
			{ id: 'me' },
			{ enrichedItemsByUniqueId: { [a.uuid]: [pin] } },
		)[0];
		assert.deepStrictEqual(actual, expected);
		assert.strictEqual(actual.viewer.pinned, true);
	});

	test('separates instances using different web ports on the same hostname', () => {
		const a = createItem({ ...hostA, domain: 'ghe.example.com:8443' });
		const b = createItem({ ...hostA, domain: 'ghe.example.com:9443' });
		assert.deepStrictEqual(categorize([b], [enrich(a, 'snooze')]), categorize([b], []));
	});

	test('retains legacy enrichment with an empty or malformed URL', () => {
		const a = createItem(hostA);
		for (const url of ['', 'not a URL']) {
			const pin = enrich(a, 'pin', url);
			assert.strictEqual(categorize([a], [pin])[0].viewer.pinned, true);
		}
	});

	test('keeps cloud enrichment when its stored URL uses an old host spelling', () => {
		const item = createItem({ id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' });
		const pin = enrich(item, 'pin', 'https://old.example.com/owner/repo/pull/1');
		assert.strictEqual(categorize([item], [pin])[0].viewer.pinned, true);
	});

	test('leaves snooze state and pin priority to the SDK', () => {
		const a = createItem(hostA);
		const pin = enrich(a, 'pin');
		const snooze = { ...enrich(a, 'snooze'), expiresAt: '2000-01-01T00:00:00.000Z' };
		const expected = getActionablePullRequests(
			[a],
			{ id: 'me' },
			{ enrichedItemsByUniqueId: { [a.uuid]: [pin, snooze] } },
		)[0];
		const [actual] = categorize([a], [pin, snooze, enrich(createItem(hostB), 'pin')]);
		assert.deepStrictEqual(actual, expected);
		assert.strictEqual(actual.viewer.pinned, true);
		assert.strictEqual(actual.viewer.snoozed, expected.viewer.snoozed);
	});

	test('resolves a selection to its host and refuses ambiguous legacy UUIDs', () => {
		const a = createItem(hostA);
		const b = createItem(hostB);
		assert.notStrictEqual(getLaunchpadItemKey(a), getLaunchpadItemKey(b));
		assert.strictEqual(findLaunchpadItem([a, b], b), b);
		assert.strictEqual(findLaunchpadItem([a, b], { uuid: b.uuid }), undefined);
		assert.strictEqual(findLaunchpadItem([b], { uuid: b.uuid }), b);
		assert.strictEqual(
			findLaunchpadItem([b], { uuid: b.uuid, provider: { ...hostB, domain: 'https://GHE-B.EXAMPLE.COM:443/' } }),
			b,
		);
	});

	test('gives same-uuid pull requests distinct tree node IDs in the same group', () => {
		const a = createItem(hostA);
		const b = createItem(hostB);
		for (const group of [undefined, 'other'] as const) {
			assert.notStrictEqual(
				getViewNodeId('launchpad-item', { launchpadItem: a, launchpadGroup: group }),
				getViewNodeId('launchpad-item', { launchpadItem: b, launchpadGroup: group }),
			);
		}
	});

	test('tracks newly appearing pull requests independently across hosts', () => {
		const a = createItem(hostA);
		const b = createItem(hostB);
		const provider = Object.create(LaunchpadProvider.prototype) as LaunchpadProvider;
		provider['updateGroupedIds']([a]);
		assert.strictEqual(provider['isItemNewInGroup'](a, 'other'), false);
		assert.strictEqual(provider['isItemNewInGroup'](b, 'other'), true);
		provider['updateGroupedIds']([a, b]);
		assert.strictEqual(provider['isItemNewInGroup'](b, 'other'), false);
	});
});
