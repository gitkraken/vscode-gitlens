import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type {
	PullRequestSearchCapabilities,
	PullRequestSearchCriteria,
	PullRequestShape,
} from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { PullRequestFilter } from '../providerFilters.js';
import { providersMetadata } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

function primarySession(token: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: 'github.com',
	};
}

type SearchPageResponse = {
	values: PullRequestShape[];
	truncated: boolean;
	hasMore: boolean;
	page: number;
	cursor?: string;
	totalCount?: number;
};

async function stubGitHubSearch(
	manager: ReturnType<typeof createIntegrationManager>,
	respond: (options: Record<string, unknown>, call: number) => SearchPageResponse | undefined,
): Promise<Record<string, unknown>[]> {
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	assert.ok(gh != null);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

	const githubApi = await (
		gh as unknown as {
			authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
		}
	).authenticationService.apis.github;
	assert.ok(githubApi != null);

	const calls: Record<string, unknown>[] = [];
	githubApi.searchPullRequestsPage = (_provider: unknown, _token: unknown, options: Record<string, unknown>) => {
		calls.push(options);
		return Promise.resolve(respond(options, calls.length));
	};
	return calls;
}

function emptyPage(overrides?: Partial<SearchPageResponse>): SearchPageResponse {
	return { values: [], truncated: false, hasMore: false, page: 1, ...overrides };
}

suite('IntegrationManager.searchPullRequestsPage', () => {
	test('searches account-wide when current-user relationships provide the scope', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: {
					text: 'graph performance',
					relationships: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
				},
			});

			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(result.warnings, []);
			assert.equal(calls.length, 1);
			assert.deepEqual(calls[0].criteria, {
				text: 'graph performance',
				relationships: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
			});
			assert.equal(calls[0].repos, undefined);
		} finally {
			manager.dispose();
		}
	});

	test('forwards descriptor repo scope, org, relationship/state sets, archived mode, and page size', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				repos: [{ namespace: 'o', name: 'a' }],
				org: 'acme',
				criteria: {
					text: 'crash',
					relationships: [PullRequestFilter.Assignee, PullRequestFilter.ReviewRequested],
					states: ['closed', 'merged'],
					includeArchived: true,
				},
				itemsPerPage: 25,
			});

			assert.deepEqual(calls[0].repos, ['o/a']);
			assert.equal(calls[0].org, 'acme');
			assert.deepEqual(calls[0].criteria, {
				text: 'crash',
				relationships: [PullRequestFilter.Assignee, PullRequestFilter.ReviewRequested],
				states: ['closed', 'merged'],
				includeArchived: true,
			});
			assert.equal(calls[0].pageSize, 25);
		} finally {
			manager.dispose();
		}
	});

	test('refuses an unscoped search with no repository, organization, or relationship', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash' },
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /must be scoped/);
			assert.equal(calls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('refuses repository ids because provider search scopes by path', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				repos: ['1234'],
				criteria: { text: 'crash' },
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /repository id/);
			assert.equal(calls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('refuses providers that declare no pull-request search', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitLab,
				criteria: { text: 'crash' },
			});
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /not supported/);
		} finally {
			manager.dispose();
		}
	});

	test('refuses issue trackers as a git-host-only surface', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const result = await manager.searchPullRequestsPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				criteria: { text: 'crash' },
			});
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /git-host integration/);
		} finally {
			manager.dispose();
		}
	});

	test('validates every criteria channel against the capability table before requesting', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const metadata = providersMetadata[GitCloudHostIntegrationId.GitHub];
		const supported = metadata.supportedPullRequestSearch;
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const cases: {
				capabilities: PullRequestSearchCapabilities;
				criteria: PullRequestSearchCriteria;
				expected: RegExp;
			}[] = [
				{
					capabilities: { ...supported!, text: false },
					criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
					expected: /text/,
				},
				{
					capabilities: { ...supported!, relationships: [PullRequestFilter.Author] },
					criteria: { relationships: [PullRequestFilter.ReviewRequested] },
					expected: /relationships:review-requested/,
				},
				{
					capabilities: { ...supported!, states: ['open'] },
					criteria: { relationships: [PullRequestFilter.Author], states: ['closed', 'merged'] },
					expected: /states:closed.*states:merged/,
				},
				{
					capabilities: { ...supported!, includeArchived: false },
					criteria: { relationships: [PullRequestFilter.Author], includeArchived: true },
					expected: /includeArchived/,
				},
				{
					capabilities: { ...supported!, draft: false },
					criteria: { relationships: [PullRequestFilter.Author], draft: true },
					expected: /draft/,
				},
			];

			for (const testCase of cases) {
				metadata.supportedPullRequestSearch = testCase.capabilities;
				const result = await manager.searchPullRequestsPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					criteria: testCase.criteria,
				});
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, testCase.expected);
			}
			assert.equal(calls.length, 0);
		} finally {
			metadata.supportedPullRequestSearch = supported;
			manager.dispose();
		}
	});

	test('validates repository and organization scopes against their declared capabilities', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const metadata = providersMetadata[GitCloudHostIntegrationId.GitHub];
		const supported = metadata.supportedPullRequestSearch;
		try {
			metadata.supportedPullRequestSearch = {
				...supported!,
				repositoryScope: false,
			};
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				repos: [{ namespace: 'o', name: 'a' }],
				criteria: { text: 'crash' },
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /repositoryScope/);
			assert.equal(calls.length, 0);

			metadata.supportedPullRequestSearch = {
				...supported!,
				organizationScope: false,
			};
			const orgResult = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				org: 'acme',
				criteria: { text: 'crash' },
			});
			assert.equal(orgResult.fetchFailed, true);
			assert.match(orgResult.warnings[0].message, /organizationScope/);
			assert.equal(calls.length, 0);
		} finally {
			metadata.supportedPullRequestSearch = supported;
			manager.dispose();
		}
	});

	test('reports a succeeded provider-limit omission with total and limit', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubSearch(manager, () => emptyPage({ truncated: true, totalCount: 19240 }));
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
			});

			assert.equal(result.fetchFailed, undefined);
			assert.equal(result.page.truncated, true);
			assert.equal(result.warnings.length, 1);
			assert.equal(result.warnings[0].omission?.kind, 'provider-limit');
			assert.equal(result.warnings[0].omission?.recovery, 'none');
			assert.equal(result.warnings[0].omission?.totalCount, 19240);
			assert.equal(result.warnings[0].omission?.limit, 1000);
		} finally {
			manager.dispose();
		}
	});

	test('uses one upstream request when the caller threads a cursor', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage({ page: 2, cursor: 'next', hasMore: true }));
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
				page: 2,
				cursor: 'opaque',
			});

			assert.equal(calls.length, 1);
			assert.equal(calls[0].cursor, 'opaque');
			assert.equal(result.page.currentPage, 2);
			assert.equal(result.cursor, 'next');
		} finally {
			manager.dispose();
		}
	});

	test('walks cursor pages when only a page number is supplied', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, (_options, call) =>
				emptyPage({
					page: call,
					hasMore: call < 3,
					cursor: call < 3 ? `c${call}` : undefined,
				}),
			);
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
				page: 3,
			});

			assert.equal(calls.length, 3);
			assert.equal(calls[1].cursor, 'c1');
			assert.equal(calls[2].cursor, 'c2');
			assert.equal(result.page.currentPage, 3);
		} finally {
			manager.dispose();
		}
	});

	test('surfaces an unimplemented provider hook as unsupported, not empty success', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubSearch(manager, () => undefined);
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
		} finally {
			manager.dispose();
		}
	});
});
