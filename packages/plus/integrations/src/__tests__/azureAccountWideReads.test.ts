import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { RequestRateLimitError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IntegrationResult } from '../models/integration.js';
import type { ProviderApiPagedResult, ProviderIssue, ProviderPullRequest } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { primarySession, stubApi } from './sweepHelpers.js';

/**
 * Azure DevOps' account-wide reads, which fan out per project: pull requests and work items, each preserving
 * the projects that succeeded when one fails, keeping same-id rows from different organizations apart, and
 * reporting the truncation its page backstop caused (#5438).
 */

suite('Azure DevOps account-wide reads (#5438)', () => {
	test("Azure account-wide PR read: one project's failure does not discard the others (#5438)", async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// The 'bad' project's read throws (e.g. a 429/403 mid-sweep); the 'good' project drains cleanly. The
		// fan-out must be settled per-project so the failure doesn't take down the good project's PRs.
		stubApi(azure, {
			getPullRequestsForAzureProject: (_t: unknown, project: { project: string }) => {
				if (project.project === 'bad') return Promise.reject(new Error('boom'));
				return Promise.resolve({
					data: [{ id: `pr-${project.project}` } as unknown as ProviderPullRequest],
					hasMore: false,
					nextPage: null,
				});
			},
		});
		(azure as unknown as { getProviderCurrentAccount: () => Promise<{ id: string }> }).getProviderCurrentAccount =
			() => Promise.resolve({ id: 'guid-1' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({
				values: [
					{ resourceName: 'org-1', name: 'good' },
					{ resourceName: 'org-1', name: 'bad' },
				],
			});

		const result = await (
			azure as unknown as {
				getMyPullRequestsForUserResult: () => Promise<
					IntegrationResult<ProviderApiPagedResult<ProviderPullRequest>>
				>;
			}
		).getMyPullRequestsForUserResult();
		const ids = result?.value?.values.map(pr => pr.id) ?? [];
		assert.deepEqual(ids, ['pr-good'], "the good project's PRs survive the bad project's failure");
		// A dropped project makes the aggregate incomplete: instead of re-throwing (which would discard the good
		// project's PRs) or a silent flatSettled, the failure is preserved as a structured per-scope failure in
		// the SDK metadata, which the facade then maps to a warning + fetchFailed.
		const failures = result?.value?.metadata?.failures ?? [];
		assert.equal(failures.length, 2, 'both filter reads for the bad project are recorded as scope failures');
		assert.ok(
			failures.every(f => f.scope?.projectId === 'bad'),
			'the failure is attributed to the bad project scope',
		);
		assert.equal(result?.value?.metadata?.completeness, 'partial', 'the aggregate is marked partial');

		manager.dispose();
	});

	test('Azure account-wide PR read keeps URL-less cross-org id collisions (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// Both orgs surface a URL-less PR whose Azure pullRequestId is "42" (ids are only org-unique). Keyed by
		// id one would be dropped; keyed by repository + id both survive while authored/reviewer facets dedupe.
		stubApi(azure, {
			getPullRequestsForAzureProject: (_t: unknown, project: { namespace: string; project: string }) =>
				Promise.resolve({
					data: [
						{
							id: '42',
							url: undefined,
							repository: { id: `${project.namespace}/repo` },
						} as unknown as ProviderPullRequest,
					],
					hasMore: false,
					nextPage: null,
				}),
		});
		(azure as unknown as { getProviderCurrentAccount: () => Promise<{ id: string }> }).getProviderCurrentAccount =
			() => Promise.resolve({ id: 'guid-1' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () =>
			Promise.resolve([
				{ id: 'org-a', name: 'Org A' },
				{ id: 'org-b', name: 'Org B' },
			]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({
				values: [
					{ resourceName: 'org-a', name: 'p' },
					{ resourceName: 'org-b', name: 'p' },
				],
			});

		const result = await (
			azure as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult();
		const repositoryIds = (result?.value?.values ?? []).map(pr => pr.repository.id).sort();
		assert.deepEqual(
			repositoryIds,
			['org-a/repo', 'org-b/repo'],
			'both URL-less cross-org PRs with the same numeric id are kept',
		);

		manager.dispose();
	});

	test('Azure account-wide PR read marks truncated when a project hits the page backstop (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// Every page claims more, so each project's drain runs until the maxPagesPerProject (20) backstop.
		// A single project fans out into an authored + assigned read, so 2 × 20 = 40 calls for one project.
		let calls = 0;
		stubApi(azure, {
			getPullRequestsForAzureProject: (_t: unknown, project: { project: string }, o?: { page?: number }) => {
				calls += 1;
				const page = o?.page ?? 1;
				return Promise.resolve({
					data: [{ id: `pr-${project.project}-${page}` } as unknown as ProviderPullRequest],
					hasMore: true,
					nextPage: page + 1,
				});
			},
		});
		(azure as unknown as { getProviderCurrentAccount: () => Promise<{ id: string }> }).getProviderCurrentAccount =
			() => Promise.resolve({ id: 'guid-1' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({ values: [{ resourceName: 'org-1', name: 'good' }] });

		const result = await (
			azure as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult();
		assert.equal(calls, 40, 'both scoped drains stop at the maxPagesPerProject backstop');
		assert.equal(result?.value?.paging?.truncated, true, 'a backstopped project is reported as truncated');

		manager.dispose();
	});

	test('Azure account-wide issue read drains every page per project/filter (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// Two pages threaded by the SDK cursor; the read must follow paging.more/cursor to the end, not stop at
		// the first page (the old `.values`-only read silently capped at page 1).
		const seenCursors: (string | undefined)[] = [];
		stubApi(azure, {
			getIssuesForAzureProject: (_t: unknown, _ns: string, _p: string, options?: { cursor?: string }) => {
				seenCursors.push(options?.cursor);
				const page = options?.cursor == null ? 1 : Number(options.cursor);
				return Promise.resolve({
					values: [
						{
							id: `i${page}`,
							url: `https://x/i${page}`,
							updatedDate: new Date(0),
						} as unknown as ProviderIssue,
					],
					paging: { more: page < 2, cursor: page < 2 ? String(page + 1) : '{}' },
				});
			},
		});
		(
			azure as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({ values: [{ resourceName: 'org-1', name: 'proj' }] });

		const result = await (
			azure as unknown as {
				searchMyIssuesWithTruncationResult: () => Promise<
					IntegrationResult<{ values: unknown[]; truncated: boolean }>
				>;
			}
		).searchMyIssuesWithTruncationResult();
		// One project × two filters (assignee + author) run concurrently, each drained to page 2. Order across
		// the two drains is not deterministic, so assert counts: two first-page reads (undefined) and two
		// second-page reads ('2').
		assert.equal(seenCursors.length, 4, 'both filters drain both pages');
		assert.equal(seenCursors.filter(c => c == null).length, 2, 'two first-page reads');
		assert.equal(seenCursors.filter(c => c === '2').length, 2, 'two second-page reads (the cursor is threaded)');
		assert.equal(result?.value?.truncated, false, 'a fully drained read is not truncated');

		manager.dispose();
	});

	test('Azure account-wide issue read keeps same-id work items from different organizations', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		stubApi(azure, {
			getIssuesForAzureProject: (_t: unknown, org: string) =>
				Promise.resolve({
					values: [
						{
							id: '42',
							number: '42',
							title: `Work item in ${org}`,
							url: `https://dev.azure.com/${org}/_workitems/edit/42`,
							createdDate: new Date(0),
							updatedDate: new Date(1),
							closedDate: null,
							author: null,
							assignees: [],
							labels: [],
							repository: null,
							commentCount: 0,
							upvoteCount: 0,
							description: null,
							type: 'Bug',
						} as unknown as ProviderIssue,
					],
					paging: { more: false, cursor: '{}' },
				}),
		});
		(
			azure as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () =>
			Promise.resolve([
				{ id: 'org-a', name: 'Org A' },
				{ id: 'org-b', name: 'Org B' },
			]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{
					values: { id: string; resourceId: string; resourceName: string; name: string }[];
				}>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({
				values: [
					{ id: 'project-a', resourceId: 'org-a', resourceName: 'org-a', name: 'project' },
					{ id: 'project-b', resourceId: 'org-b', resourceName: 'org-b', name: 'project' },
				],
			});

		const result = await (
			azure as unknown as {
				searchMyIssuesWithTruncationResult: (
					r?: unknown,
					c?: unknown,
					id?: unknown,
					o?: { includeAllAssignees?: boolean },
				) => Promise<IntegrationResult<{ values: IssueShape[]; truncated: boolean }>>;
			}
		).searchMyIssuesWithTruncationResult(undefined, undefined, undefined, { includeAllAssignees: true });

		assert.deepEqual(
			result?.value?.values.map(issue => issue.url).sort(),
			['https://dev.azure.com/org-a/_workitems/edit/42', 'https://dev.azure.com/org-b/_workitems/edit/42'],
			'organization-scoped numeric ids do not collapse across organizations',
		);

		manager.dispose();
	});

	test('Azure account-wide issue read preserves siblings and records an auth/rate-limit rejection as a scope failure (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// A 429 on the 'bad' project must NOT re-throw (that would discard the 'good' project's issues) nor
		// collapse into a generic truncation. It's preserved as a structured rate-limit scope failure in the
		// metadata, which the facade maps to a rate-limit warning + fetchFailed, while the good issues survive.
		stubApi(azure, {
			getIssuesForAzureProject: (_t: unknown, _org: string, project: string) => {
				if (project === 'bad') {
					return Promise.reject(new RequestRateLimitError(new Error('429'), undefined, undefined));
				}
				return Promise.resolve({ values: [{ id: 'i-good' }], paging: { more: false, cursor: '{}' } });
			},
		});
		(
			azure as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{
					values: { resourceId: string; resourceName: string; name: string }[];
				}>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({
				values: [
					{ resourceId: 'org-1', resourceName: 'org-1', name: 'good' },
					{ resourceId: 'org-1', resourceName: 'org-1', name: 'bad' },
				],
			});

		const result = await (
			azure as unknown as {
				searchMyIssuesWithTruncationResult: () => Promise<
					IntegrationResult<{ values: unknown[]; truncated: boolean; metadata?: CollectionMetadata }>
				>;
			}
		).searchMyIssuesWithTruncationResult();
		assert.equal(result?.error, undefined, 'a partial read is not surfaced as a hard error');
		assert.equal(result?.value?.values.length, 1, "the good project's issues survive");
		const failures = result?.value?.metadata?.failures ?? [];
		assert.ok(
			failures.some(f => f.kind === 'rate-limit' && f.scope?.projectId === 'bad'),
			'the rate-limit rejection is recorded as a scope failure on the bad project',
		);

		manager.dispose();
	});

	test('Azure account-wide issue read broadens to a single unfiltered drain per project when includeAllAssignees is set (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		const seenFilters: { assigneeLogins?: string[]; authorLogin?: string }[] = [];
		stubApi(azure, {
			getIssuesForAzureProject: (
				_t: unknown,
				_ns: string,
				_p: string,
				options?: { assigneeLogins?: string[]; authorLogin?: string },
			) => {
				seenFilters.push({ assigneeLogins: options?.assigneeLogins, authorLogin: options?.authorLogin });
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});
		(
			azure as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({ values: [{ resourceName: 'org-1', name: 'proj' }] });

		await (
			azure as unknown as {
				searchMyIssuesWithTruncationResult: (
					r?: unknown,
					c?: unknown,
					id?: unknown,
					o?: { includeAllAssignees?: boolean },
				) => Promise<IntegrationResult<{ values: unknown[]; truncated: boolean }>>;
			}
		).searchMyIssuesWithTruncationResult(undefined, undefined, undefined, { includeAllAssignees: true });

		// A single unfiltered drain replaces the assignee+author pair: any-assignee subsumes the authored read.
		assert.equal(seenFilters.length, 1, 'one unfiltered drain per project, not the assigned+authored pair');
		assert.equal(seenFilters[0].assigneeLogins, undefined, 'the per-user assignee filter is dropped');
		assert.equal(seenFilters[0].authorLogin, undefined, 'no author filter is applied either');

		manager.dispose();
	});
});
