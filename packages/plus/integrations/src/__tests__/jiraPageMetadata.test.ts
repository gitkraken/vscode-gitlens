import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { UnsupportedSortError } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { AuthenticationError } from '@gitlens/git/errors.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Pins that every Jira search wrapper of `ProvidersApi` keeps the SDK page's `metadata` (gitkraken/vscode-gitlens#5992).
 * provider-apis reports an issue it dropped because it could not read it only there (GKDEV-3652); a wrapper that
 * mapped `{ data, pageInfo }` alone made the issue vanish with no warning.
 */

const domain = 'jira.example.com';

function session(cloud: boolean): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: cloud,
		type: cloud ? 'oauth' : 'pat',
		domain: cloud ? 'atlassian.net' : domain,
	};
}

function dropped(): CollectionMetadata {
	return {
		completeness: 'partial',
		failures: [
			{
				scope: { providerId: 'jira', resourceId: 'org-1' },
				kind: 'provider',
				message: 'Skipped Jira issues that could not be read: P-2 (boom).',
				skippedItems: { keys: ['P-2'], total: 1, complete: true },
			},
		],
	};
}

type SdkPage = { data: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null }; metadata?: unknown };

async function realProvidersApi(
	providerId: IssuesCloudHostIntegrationId.Jira | IssuesSelfManagedHostIntegrationId.JiraServer,
	fns: Record<string, (...args: unknown[]) => Promise<SdkPage>>,
): Promise<{ api: ProvidersApi; dispose: () => void }> {
	const manager = createIntegrationManager(createFakeRuntime());
	const integration =
		providerId === IssuesCloudHostIntegrationId.Jira
			? await manager.get(providerId)
			: (await manager.get(providerId, domain))!;
	// The real `ProvidersApi`, not a stub of it: the wrappers under test live inside it. Only the provider function
	// table is replaced, which is where the SDK begins.
	const api = await (integration as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();
	const provider = (api as unknown as { providers: Record<string, Record<string, unknown>> }).providers[providerId];
	Object.assign(provider, fns);
	return { api: api, dispose: () => manager.dispose() };
}

const cloudToken = toTokenWithInfo(IssuesCloudHostIntegrationId.Jira, session(true));
const serverToken = toTokenWithInfo(IssuesSelfManagedHostIntegrationId.JiraServer, session(false));
const baseUrl = `https://${domain}`;

const wrappers: {
	name: string;
	providerId: IssuesCloudHostIntegrationId.Jira | IssuesSelfManagedHostIntegrationId.JiraServer;
	fn: string;
	read: (api: ProvidersApi) => Promise<unknown>;
}[] = [
	{
		name: 'getIssuesForProjectPaged',
		providerId: IssuesCloudHostIntegrationId.Jira,
		fn: 'getIssuesForProjectFn',
		read: api => api.getIssuesForProjectPaged(cloudToken, 'P', 'org-1'),
	},
	{
		name: 'getIssuesForProjectsPaged',
		providerId: IssuesCloudHostIntegrationId.Jira,
		fn: 'getIssuesForProjectsFn',
		read: api => api.getIssuesForProjectsPaged(cloudToken, ['P', 'Q'], 'org-1'),
	},
	{
		name: 'getJiraServerIssuesForProjectPaged',
		providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
		fn: 'getJiraServerIssuesForProjectFn',
		read: api => api.getJiraServerIssuesForProjectPaged(serverToken, baseUrl, '10000'),
	},
	{
		name: 'getJiraServerIssuesForProjectsPaged',
		providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
		fn: 'getJiraServerIssuesForProjectsFn',
		read: api => api.getJiraServerIssuesForProjectsPaged(serverToken, baseUrl, ['10000', '10001']),
	},
	{
		name: 'getJiraServerIssuesForCurrentUser',
		providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
		fn: 'getJiraServerIssuesForCurrentUserFn',
		read: api => api.getJiraServerIssuesForCurrentUser(serverToken, baseUrl),
	},
];

suite('Jira search wrappers forward page metadata', () => {
	for (const wrapper of wrappers) {
		test(`${wrapper.name} keeps the page's metadata`, async () => {
			const { api, dispose } = await realProvidersApi(wrapper.providerId, {
				[wrapper.fn]: () =>
					Promise.resolve({
						data: [],
						pageInfo: { hasNextPage: true, endCursor: '100' },
						metadata: dropped(),
					}),
			});

			assert.deepEqual(await wrapper.read(api), {
				data: [],
				hasMore: true,
				nextCursor: '100',
				metadata: dropped(),
			});
			dispose();
		});

		test(`${wrapper.name} adds no metadata to a clean page`, async () => {
			const { api, dispose } = await realProvidersApi(wrapper.providerId, {
				[wrapper.fn]: () => Promise.resolve({ data: [], pageInfo: { hasNextPage: false, endCursor: null } }),
			});

			const page = await wrapper.read(api);

			assert.deepEqual(page, { data: [], hasMore: false, nextCursor: undefined });
			assert.equal('metadata' in (page as object), false);
			dispose();
		});
	}

	test("getIssuesForResourceForCurrentUser checks the page's skippedItems", async () => {
		const malformed = (): CollectionMetadata => ({
			completeness: 'partial',
			failures: [
				{
					scope: { providerId: 'jira', resourceId: 'org-1' },
					kind: 'provider',
					message: 'Request failed (500)',
					skippedItems: { total: 1, complete: true } as unknown as NonNullable<
						CollectionMetadata['failures']
					>[number]['skippedItems'],
				},
			],
		});
		const { api, dispose } = await realProvidersApi(IssuesCloudHostIntegrationId.Jira, {
			getIssuesForResourceForCurrentUserFn: () =>
				Promise.resolve({
					data: [],
					pageInfo: { hasNextPage: false, endCursor: null },
					metadata: malformed(),
				}),
		});

		const result = await api.getIssuesForResourceForCurrentUser(cloudToken, 'org-1');

		assert.deepEqual(result.metadata?.failures?.[0].skippedItems, { keys: [], total: 1, complete: false });
		dispose();
	});

	test("a search wrapper checks the page's skippedItems, so no later stage meets a malformed one", async () => {
		const { api, dispose } = await realProvidersApi(IssuesCloudHostIntegrationId.Jira, {
			getIssuesForProjectFn: () =>
				Promise.resolve({
					data: [],
					pageInfo: { hasNextPage: false, endCursor: null },
					metadata: {
						completeness: 'partial',
						failures: [
							{
								scope: { providerId: 'jira', resourceId: 'org-1' },
								kind: 'provider',
								message: 'Skipped Jira issues that could not be read: P-1 (boom).',
								skippedItems: { keys: ['P-1', 7], total: 2, complete: true },
							},
						],
					},
				}),
		});

		const page = await api.getIssuesForProjectPaged(cloudToken, 'P', 'org-1');

		assert.deepEqual(page?.metadata?.failures?.[0].skippedItems, { keys: ['P-1'], total: 2, complete: false });
		dispose();
	});

	test("getIssuesForResourceForCurrentUser keeps the page's metadata", async () => {
		const { api, dispose } = await realProvidersApi(IssuesCloudHostIntegrationId.Jira, {
			getIssuesForResourceForCurrentUserFn: () =>
				Promise.resolve({ data: [], pageInfo: { hasNextPage: false, endCursor: null }, metadata: dropped() }),
		});

		const result = await api.getIssuesForResourceForCurrentUser(cloudToken, 'org-1');

		assert.deepEqual(result.metadata, dropped());
		assert.equal(result.paging?.truncated, true);
		dispose();
	});
});

function accountIssue(key: string) {
	return {
		id: `id-${key}`,
		number: key,
		title: `Issue ${key}`,
		url: `https://atlassian.net/browse/${key}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: [],
		labels: [],
	};
}

type AccountPage = {
	values: unknown[];
	paging?: { cursor: string; more: boolean; truncated?: boolean };
	metadata?: CollectionMetadata;
};

const sites = [
	{ id: 'site-1', key: 's1', name: 'S1' },
	{ id: 'site-2', key: 's2', name: 'S2' },
] satisfies ResourceDescriptor[];

async function connectedJiraCloud(
	read: (resourceId: string, cursor: string | undefined) => Promise<AccountPage>,
): Promise<{ jira: IssuesIntegration; dispose: () => void }> {
	const manager = createIntegrationManager(createFakeRuntime());
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = session(true);
	(jira as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve({
			getIssuesForResourceForCurrentUser: (_token: unknown, resourceId: string, options: { cursor?: string }) =>
				read(resourceId, options.cursor),
			// What `validateCredential` reads to confirm the credential behind a site's refusal.
			getJiraResourcesForCurrentUser: () =>
				Promise.resolve(sites.map(site => ({ ...site, url: '', avatarUrl: '' }))),
		});
	return { jira: jira, dispose: () => manager.dispose() };
}

suite('Jira Cloud account-wide read metadata', () => {
	test('merges what each page dropped, and records a failed site without losing the others', async () => {
		const { jira, dispose } = await connectedJiraCloud((resourceId, cursor) => {
			if (resourceId === 'site-2') return Promise.reject(new Error('500 Internal Server Error'));

			return Promise.resolve(
				cursor == null
					? {
							values: [accountIssue('A-1')],
							paging: { cursor: 'c1', more: true },
							metadata: {
								completeness: 'partial',
								failures: [
									{
										scope: { providerId: 'jira', resourceId: 'site-1' },
										kind: 'provider',
										message: 'Skipped Jira issues that could not be read: A-2 (boom).',
										skippedItems: { keys: ['A-2'], total: 1, complete: true },
									},
								],
							},
						}
					: { values: [accountIssue('A-3')], paging: { cursor: '{}', more: false } },
			);
		});

		const result = (await jira.searchMyIssuesWithTruncationResult(sites))?.value;

		assert.deepEqual(result?.values.map(i => i.id).sort(), ['A-1', 'A-3']);
		assert.equal(result?.truncated, true, 'the failed site is missing from it');
		assert.equal(result?.metadata?.completeness, 'partial');
		assert.deepEqual(
			result?.metadata?.failures?.map(f => [f.scope, f.kind]),
			[
				[{ providerId: 'jira', resourceId: 'site-1' }, 'provider'],
				[{ providerId: IssuesCloudHostIntegrationId.Jira, resourceId: 'site-2' }, 'provider'],
			],
		);
		dispose();
	});

	test('reports a site the page backstop stopped', async () => {
		let page = 0;
		const { jira, dispose } = await connectedJiraCloud(() => {
			page++;
			return Promise.resolve({ values: [accountIssue(`A-${page}`)], paging: { cursor: `c${page}`, more: true } });
		});

		const result = (await jira.searchMyIssuesWithTruncationResult([sites[0]]))?.value;

		assert.equal(result?.values.length, 10);
		assert.equal(result?.truncated, true);
		dispose();
	});

	test("reports a site that refused the token as that site's auth failure, keeping the other site", async () => {
		const { jira, dispose } = await connectedJiraCloud(resourceId =>
			resourceId === 'site-2'
				? Promise.reject(
						new AuthenticationError({
							providerId: IssuesCloudHostIntegrationId.Jira,
							microHash: undefined,
							cloud: true,
							type: 'oauth',
							scopes: [],
						}),
					)
				: Promise.resolve({ values: [accountIssue('A-1')], paging: { cursor: '{}', more: false } }),
		);

		const result = await jira.searchMyIssuesWithTruncationResult(sites);

		assert.equal(result?.error, undefined);
		assert.deepEqual(
			result?.value?.values.map(i => i.id),
			['A-1'],
		);
		assert.deepEqual(
			result?.value?.metadata?.failures?.map(f => [f.scope, f.kind]),
			[[{ providerId: IssuesCloudHostIntegrationId.Jira, resourceId: 'site-2' }, 'authentication']],
		);
		dispose();
	});

	test('reports every site that failed when none answered, rather than an empty success', async () => {
		const { jira, dispose } = await connectedJiraCloud(() => Promise.reject(new Error('503 Service Unavailable')));

		const result = await jira.searchMyIssuesWithTruncationResult(sites);

		assert.deepEqual(result?.value?.values, []);
		assert.equal(result?.value?.truncated, true);
		assert.deepEqual(
			result?.value?.metadata?.failures?.map(f => f.scope?.resourceId),
			['site-1', 'site-2'],
		);
		dispose();
	});

	test("a lone site refusing a sound token is that site's auth failure, not the connection's", async () => {
		// Jira answers 403 for a site the account can't browse; the credential itself checks out.
		const { jira, dispose } = await connectedJiraCloud(() =>
			Promise.reject(
				new AuthenticationError({
					providerId: IssuesCloudHostIntegrationId.Jira,
					microHash: undefined,
					cloud: true,
					type: 'oauth',
					scopes: [],
				}),
			),
		);

		const result = await jira.searchMyIssuesWithTruncationResult([sites[0]]);

		assert.equal(result?.error, undefined);
		assert.deepEqual(
			result?.value?.metadata?.failures?.map(f => [f.scope?.resourceId, f.kind]),
			[['site-1', 'authentication']],
		);
		assert.ok(
			(jira as unknown as { _session: unknown })._session != null,
			'the connection is not expired for one site',
		);
		dispose();
	});

	test('rejects an invalid call once instead of recording it against every site', async () => {
		const { jira, dispose } = await connectedJiraCloud(() =>
			Promise.reject(new UnsupportedSortError('jira', 'priority:desc', ['created:desc'])),
		);

		const result = await jira.searchMyIssuesWithTruncationResult(sites);

		assert.equal((result?.error as { code?: string } | undefined)?.code, 'UNSUPPORTED_SORT');
		dispose();
	});

	test('a cancelled read reports no backstop', async () => {
		const cancellation = new AbortController();
		const { jira, dispose } = await connectedJiraCloud(() => {
			cancellation.abort();
			return Promise.resolve({ values: [accountIssue('A-1')], paging: { cursor: 'c1', more: true } });
		});

		const result = (await jira.searchMyIssuesWithTruncationResult([sites[0]], cancellation.signal))?.value;

		assert.equal(result?.values.length, 1);
		assert.equal(result?.truncated, false);
		assert.equal(result?.metadata, undefined);
		dispose();
	});

	test("reports a site's run of pages that dropped issues once, not once per page", async () => {
		const { jira, dispose } = await connectedJiraCloud((resourceId, cursor) => {
			const page = cursor == null ? 0 : Number(cursor);
			return Promise.resolve({
				values: [],
				// As `getPagedResult` sets it from a partial page's metadata.
				paging: { cursor: String(page + 1), more: page < 2, truncated: true },
				metadata: {
					completeness: 'partial',
					failures: [
						{
							scope: { providerId: 'jira', resourceId: resourceId },
							kind: 'provider',
							message: `Skipped Jira issues that could not be read: A-${page} (boom).`,
							skippedItems: { keys: [`A-${page}`], total: 1, complete: true },
						},
					],
				},
			});
		});

		const result = (await jira.searchMyIssuesWithTruncationResult([sites[0]]))?.value;

		assert.equal(result?.truncated, true, 'what the pages dropped still makes the read truncated');
		assert.deepEqual(
			result?.metadata?.failures?.map(f => f.message),
			[
				'Skipped Jira issues that could not be read: A-0 (boom). Issues on 2 more pages could not be read either.',
			],
		);
		dispose();
	});

	test('a clean read carries no metadata', async () => {
		const { jira, dispose } = await connectedJiraCloud(() =>
			Promise.resolve({ values: [accountIssue('A-1')], paging: { cursor: '{}', more: false } }),
		);

		const result = (await jira.searchMyIssuesWithTruncationResult(sites))?.value;

		assert.equal(result?.values.length, 2);
		assert.equal(result?.metadata, undefined);
		dispose();
	});
});
