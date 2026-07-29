import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import type { IntegrationIds } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { IssueFilter, PullRequestFilter } from '../providerFilters.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * `getSupportedFilters` exists so a consumer can intersect its filter set against the provider BEFORE the read.
 * Repo-scoped and account-wide PR filters are independent capabilities. The filter contract is all-or-nothing,
 * so a set with one unsupported member comes back as an empty page + `fetchFailed`. The table was previously
 * reachable only by importing the internal `providers/models.js` subpath, so consumers hardcoded copies that
 * could drift from the read guard.
 */
suite('IntegrationManager.getSupportedFilters', () => {
	const allIds: IntegrationIds[] = [
		...Object.values(GitCloudHostIntegrationId),
		...Object.values(GitSelfManagedHostIntegrationId),
		...Object.values(IssuesCloudHostIntegrationId),
	];

	/**
	 * Pins the accessor to the guard the read core actually applies
	 * (`ProvidersApi.providerSupports*Filters`, an `every` over the same metadata). Both read
	 * `providersMetadata`, so they cannot disagree today — this asserts the invariant so a future refactor that
	 * gives either side its own table fails here instead of silently failing consumers' reads.
	 */
	test('agrees with the read core guard for every provider and every filter member', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
			assert.ok(gh != null);
			const api = await (
				gh as unknown as {
					getProvidersApi(): Promise<{
						providerSupportsPullRequestFilters(id: IntegrationIds, filters: PullRequestFilter[]): boolean;
						providerSupportsIssueFilters(id: IntegrationIds, filters: IssueFilter[]): boolean;
					}>;
				}
			).getProvidersApi();

			for (const id of allIds) {
				const supported = manager.getSupportedFilters(id);
				assert.ok(supported.pullRequestsAccountWide != null);
				assert.equal(
					supported.pullRequestsAccountWide.every(filter => supported.pullRequests.includes(filter)),
					true,
					`${id}: account-wide filters must remain a subset of the provider's relationship vocabulary`,
				);

				// A non-empty advertised set must be accepted whole. An empty one means the provider has no
				// filter surface at all, and the guard rejects even a single filter there — so assert that
				// instead of asserting the guard accepts `[]` (which the facade short-circuits before the guard).
				if (supported.pullRequests.length > 0) {
					assert.equal(
						api.providerSupportsPullRequestFilters(id, supported.pullRequests),
						true,
						`${id}: the advertised PR filter set must be accepted whole`,
					);
				}
				if (supported.issues.length > 0) {
					assert.equal(
						api.providerSupportsIssueFilters(id, supported.issues),
						true,
						`${id}: the advertised issue filter set must be accepted whole`,
					);
				}

				// Every member NOT advertised must be refused, so the accessor can never under-report (which
				// would leave a consumer skipping a filter the provider does support) nor over-report (which
				// would let it build a set the read then refuses).
				for (const filter of Object.values(PullRequestFilter)) {
					if (supported.pullRequests.includes(filter)) continue;

					assert.equal(
						api.providerSupportsPullRequestFilters(id, [filter]),
						false,
						`${id}: PR filter '${filter}' is not advertised, so the read must refuse it`,
					);
				}
				for (const filter of Object.values(IssueFilter)) {
					if (supported.issues.includes(filter)) continue;

					assert.equal(
						api.providerSupportsIssueFilters(id, [filter]),
						false,
						`${id}: issue filter '${filter}' is not advertised, so the read must refuse it`,
					);
				}
			}
		} finally {
			manager.dispose();
		}
	});

	test('returns copies, so a caller cannot corrupt the provider metadata', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const first = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub);
			const before = [...first.pullRequests];
			const beforeAccountWide = [...(first.pullRequestsAccountWide ?? [])];
			// `ProvidersApi` spreads `providersMetadata[id]` shallowly, so the array is shared with the live
			// guard table: handing out the internal reference would let one consumer's `.pop()` change what
			// every read accepts, process-wide.
			first.pullRequests.length = 0;
			assert.ok(first.pullRequestsAccountWide != null);
			first.pullRequestsAccountWide.push(PullRequestFilter.Author);
			first.issues.length = 0;

			const second = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub);
			assert.deepEqual(second.pullRequests, before, 'the table survives a mutated result');
			assert.deepEqual(second.pullRequestsAccountWide, beforeAccountWide);
			assert.ok(second.issues.length > 0);
		} finally {
			manager.dispose();
		}
	});

	test('reports an empty set where a provider has no surface of that kind', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			// Issue trackers have no pull requests at all.
			assert.deepEqual(manager.getSupportedFilters(IssuesCloudHostIntegrationId.Jira).pullRequests, []);
			assert.deepEqual(manager.getSupportedFilters(IssuesCloudHostIntegrationId.Trello).pullRequests, []);
			// Bitbucket's issue tracker is deprecated in favor of dedicated issue integrations, so its issue
			// read is unsupported (`supportsIssues === false`) and it advertises no issue filters.
			assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.Bitbucket).issues, []);
			assert.deepEqual(manager.getSupportedFilters(GitSelfManagedHostIntegrationId.BitbucketServer).issues, []);
		} finally {
			manager.dispose();
		}
	});

	test('reports the per-provider differences a consumer has to branch on', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			// GitHub expresses Mention; GitLab does not — the difference a hardcoded copy gets wrong.
			assert.ok(
				manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issues.includes(IssueFilter.Mention),
			);
			assert.equal(
				manager.getSupportedFilters(GitCloudHostIntegrationId.GitLab).issues.includes(IssueFilter.Mention),
				false,
			);
			// Bitbucket has no Assignee PR filter, unlike every other git host.
			assert.equal(
				manager
					.getSupportedFilters(GitCloudHostIntegrationId.Bitbucket)
					.pullRequests.includes(PullRequestFilter.Assignee),
				false,
			);
			assert.ok(
				manager
					.getSupportedFilters(GitCloudHostIntegrationId.AzureDevOps)
					.pullRequests.includes(PullRequestFilter.Assignee),
			);
			assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.Bitbucket).pullRequestsAccountWide, [
				PullRequestFilter.Author,
				PullRequestFilter.ReviewRequested,
			]);
			assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).pullRequestsAccountWide, [
				PullRequestFilter.Author,
				PullRequestFilter.Assignee,
				PullRequestFilter.ReviewRequested,
				PullRequestFilter.Mention,
			]);
			// A self-managed host mirrors its cloud counterpart.
			assert.deepEqual(
				manager.getSupportedFilters(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise),
				manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub),
			);
		} finally {
			manager.dispose();
		}
	});
});
