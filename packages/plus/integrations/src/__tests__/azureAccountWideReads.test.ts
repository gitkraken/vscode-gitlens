import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { GitPullRequestReviewState, GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type {
	CloudIntegrationAuthType,
	ProviderAuthenticationSession,
	TokenWithInfo,
} from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason, RequestRateLimitError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IntegrationResult } from '../models/integration.js';
import { PullRequestFilter } from '../providerFilters.js';
import type { ProviderApiPagedResult, ProviderIssue, ProviderPullRequest } from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import {
	conditionalAccess,
	explainedRefusal,
	globalPatNotAllowed,
	noAccess,
	oauthAppNotAllowed,
} from './azureRefusals.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { primarySession, providerPr, stubApi } from './sweepHelpers.js';

/**
 * Azure DevOps' account-wide reads, which fan out per project: pull requests and work items, each preserving
 * the projects that succeeded when one fails, keeping same-id rows from different organizations apart, and
 * reporting the truncation its page backstop caused (#5438).
 */

function refusedCredential(): AuthenticationError {
	return new AuthenticationError(
		{
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			microHash: undefined,
			cloud: true,
			type: 'oauth',
			scopes: [],
		},
		AuthenticationErrorReason.Unauthorized,
	);
}

/**
 * The #5890 repro: an Azure DevOps connection whose profile and organization list succeed, and whose second
 * organization (third-party OAuth access disabled, another tenant, Conditional Access) answers its project
 * discovery with a 401. Discovery runs for real; only the SDK surface is stubbed. `probe` answers the uncached
 * profile request that confirms the credential.
 */
async function azureWithRefusingOrg(
	probe: () => Promise<unknown>,
	options?: { refusal?: () => Error; type?: CloudIntegrationAuthType },
) {
	const manager = createIntegrationManager(createFakeRuntime());
	const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
	(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'dev.azure.com',
		...(options?.type != null ? { type: options.type } : {}),
	};

	stubApi(azure, {
		getAzureGroupIdsForUser: () => Promise.resolve([]),
		getAzureProjectsForResource: (_t: unknown, resourceName: string) =>
			resourceName === 'Org Denied'
				? Promise.reject((options?.refusal ?? refusedCredential)())
				: Promise.resolve({
						values: [{ id: 'p1', name: 'proj', namespace: resourceName }],
						paging: { more: false },
					}),
		getPullRequestsForAzureProject: (_t: unknown, project: { namespace: string; project: string }) =>
			Promise.resolve({
				data: [
					providerPr('pr-1', {
						url: `https://dev.azure.com/${project.namespace}/${project.project}/_git/repo/pullrequest/1`,
					}),
				],
				hasMore: false,
				nextPage: null,
			}),
		// Through the real discovery cache, which is where a refused organization's name is found again.
		getAzureResourcesForUser: () =>
			Promise.resolve([
				{ id: 'org-ok', name: 'Org OK' },
				{ id: 'org-denied', name: 'Org Denied' },
			]),
		getCurrentUser: probe,
	});
	(azure as unknown as { getProviderCurrentAccount: () => Promise<{ id: string }> }).getProviderCurrentAccount = () =>
		Promise.resolve({ id: 'guid-1' });

	return manager;
}

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
			getAzureGroupIdsForUser: () => Promise.resolve([]),
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
			getAzureGroupIdsForUser: () => Promise.resolve([]),
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
			getAzureGroupIdsForUser: () => Promise.resolve([]),
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

	test('Azure: one organization refusing the token is a scoped auth warning, not a connection failure (#5890)', async () => {
		let probes = 0;
		const manager = await azureWithRefusingOrg(() => {
			probes++;
			return Promise.resolve({ id: 'guid-1' });
		});

		try {
			const [result, concurrent] = await Promise.all([
				manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps }),
				manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps }),
			]);

			assert.equal(result.items.length, 1, "the healthy organization's pull requests survive");
			assert.equal(result.fetchFailed, true, 'the refused organization leaves the read incomplete');
			const auth = result.warnings.filter(w => w.kind === 'auth');
			assert.equal(auth.length, 1);
			assert.equal(auth[0].isAuth, true);
			// The structural distinction a consumer needs before prompting to reconnect: the failure belongs to
			// one organization, and reconnecting can never heal it because the credential is fine.
			assert.deepEqual(auth[0].scope, { resourceId: 'org-denied' });
			// Only scoped refusals came back, which a revoked token served from cached discovery would produce
			// too, so the credential was confirmed first.
			assert.equal(
				probes,
				1,
				'the credential is probed once before the scope is trusted, even by two reads at once',
			);
			assert.deepEqual(concurrent.warnings.find(w => w.kind === 'auth')?.scope, { resourceId: 'org-denied' });

			const again = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });
			assert.deepEqual(again.warnings.find(w => w.kind === 'auth')?.scope, { resourceId: 'org-denied' });
			assert.equal(probes, 1, 'a scope that keeps refusing does not cost a probe on every read');
		} finally {
			manager.dispose();
		}
	});

	test('Azure: a probe that fails is not remembered, so the next read confirms the credential again (#5890)', async () => {
		let probes = 0;
		const manager = await azureWithRefusingOrg(
			() => (++probes === 1 ? Promise.reject(new Error('socket hang up')) : Promise.resolve({ id: 'guid-1' })),
			{ refusal: oauthAppNotAllowed },
		);
		const read = () => manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

		try {
			const first = await read();
			// Proves nothing either way, so the refusal is reported as it was recorded, and not named: unconfirmed,
			// this answer is also what an expired token gets.
			const unconfirmed = first.warnings.find(w => w.kind === 'auth');
			assert.deepEqual(unconfirmed?.scope, { resourceId: 'org-denied' });
			assert.equal(unconfirmed?.cause, undefined);

			const second = await read();
			assert.equal(probes, 2, 'the failed probe was not remembered as a pass');
			assert.equal(second.warnings.find(w => w.kind === 'auth')?.cause?.reason, 'oauth-app-not-allowed');

			await read();
			assert.equal(probes, 2, 'the probe that passed is');
		} finally {
			manager.dispose();
		}
	});

	test('Azure: an organization that disallows third-party OAuth apps is named, with its policy page (#5890)', async () => {
		const manager = await azureWithRefusingOrg(() => Promise.resolve({ id: 'guid-1' }), {
			refusal: oauthAppNotAllowed,
		});

		try {
			const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

			const auth = result.warnings.filter(w => w.kind === 'auth');
			assert.equal(auth.length, 1);
			assert.deepEqual(auth[0].scope, { resourceId: 'org-denied' });
			// What a consumer recommends a fix from, instead of a reconnect that could never heal it.
			assert.deepEqual(auth[0].cause, {
				reason: 'oauth-app-not-allowed',
				remedyUrl: 'https://dev.azure.com/Org%20Denied/_settings/organizationPolicy',
			});
			assert.match(auth[0].message, /does not allow third-party OAuth apps$/);
			assert.equal(result.items.length, 1, "the healthy organization's pull requests survive");
		} finally {
			manager.dispose();
		}
	});

	test('Azure: an organization the account has no access to is access-denied, not an OAuth policy (#5890)', async () => {
		const manager = await azureWithRefusingOrg(() => Promise.resolve({ id: 'guid-1' }), { refusal: noAccess });

		try {
			const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

			const auth = result.warnings.find(w => w.kind === 'auth');
			assert.deepEqual(auth?.cause, { reason: 'access-denied', code: 'TF400813' });
			assert.match(auth?.message ?? '', /the account has no access to it$/);
		} finally {
			manager.dispose();
		}
	});

	test('Azure: a Conditional Access block is named from VS403463 (#5890)', async () => {
		const manager = await azureWithRefusingOrg(() => Promise.resolve({ id: 'guid-1' }), {
			refusal: conditionalAccess,
		});

		try {
			const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

			assert.deepEqual(result.warnings.find(w => w.kind === 'auth')?.cause, {
				reason: 'conditional-access',
				code: 'VS403463',
			});
		} finally {
			manager.dispose();
		}
	});

	test('Azure: a personal access token is never told an OAuth policy refused it (#5890)', async () => {
		// The policy does not govern PATs, so the same bare 401 is left unnamed rather than misdiagnosed.
		const bare = await azureWithRefusingOrg(() => Promise.resolve({ id: 'guid-1' }), {
			refusal: oauthAppNotAllowed,
			type: 'pat',
		});
		// And one the organization explains in its own words keeps them.
		const explained = await azureWithRefusingOrg(() => Promise.resolve({ id: 'guid-1' }), {
			refusal: globalPatNotAllowed,
			type: 'pat',
		});

		try {
			const bareAuth = (
				await bare.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps })
			).warnings.find(w => w.kind === 'auth');
			assert.deepEqual(bareAuth?.scope, { resourceId: 'org-denied' });
			assert.equal(bareAuth?.cause, undefined);
			assert.match(bareAuth?.message ?? '', /\(401\) Unauthorized\.$/);

			const explainedAuth = (
				await explained.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps })
			).warnings.find(w => w.kind === 'auth');
			assert.equal(explainedAuth?.cause, undefined);
			assert.match(explainedAuth?.message ?? '', /prohibits access by global Personal Access Token/);
		} finally {
			bare.dispose();
			explained.dispose();
		}
	});

	test('Azure: a refusal Azure explains otherwise is not guessed at, and keeps its own words (#5890)', async () => {
		const manager = await azureWithRefusingOrg(() => Promise.resolve({ id: 'guid-1' }), {
			refusal: explainedRefusal,
		});

		try {
			const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

			const auth = result.warnings.find(w => w.kind === 'auth');
			assert.deepEqual(auth?.scope, { resourceId: 'org-denied' });
			assert.equal(auth?.cause, undefined, 'only the answers captured for the OAuth policy are named after it');
			assert.match(auth?.message ?? '', /VS30063: You are not authorized/);
		} finally {
			manager.dispose();
		}
	});

	test('Azure: a probe that returns no account proves nothing (#5890)', async () => {
		// Azure DevOps Server's current-user request answers every failure but a refusal this way.
		let probes = 0;
		const manager = await azureWithRefusingOrg(
			() => {
				probes++;
				return Promise.resolve(undefined);
			},
			{ refusal: oauthAppNotAllowed },
		);
		const read = () => manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

		try {
			const first = await read();
			const auth = first.warnings.find(w => w.kind === 'auth');
			assert.deepEqual(auth?.scope, { resourceId: 'org-denied' }, 'the read is left as it was');
			assert.equal(auth?.cause, undefined, 'and nothing is named on an unconfirmed credential');

			await read();
			assert.equal(probes, 2, 'not remembered as a pass');
		} finally {
			manager.dispose();
		}
	});

	test('Azure: a probe denied with a 403 proves nothing (#5890)', async () => {
		// The credential authenticated and was only denied the check's own request.
		let probes = 0;
		const manager = await azureWithRefusingOrg(
			() => {
				probes++;
				return Promise.reject(
					new AuthenticationError(
						{
							providerId: GitCloudHostIntegrationId.AzureDevOps,
							microHash: undefined,
							cloud: true,
							type: 'oauth',
							scopes: [],
						},
						AuthenticationErrorReason.Forbidden,
					),
				);
			},
			{ refusal: oauthAppNotAllowed },
		);
		const read = () => manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

		try {
			const first = await read();
			const auth = first.warnings.find(w => w.kind === 'auth');
			assert.deepEqual(auth?.scope, { resourceId: 'org-denied' }, 'not failed as a connection failure');
			assert.equal(auth?.cause, undefined, 'and nothing is named on an unconfirmed credential');
			assert.equal(first.items.length, 1);

			await read();
			assert.equal(probes, 2, 'not remembered as a pass');
		} finally {
			manager.dispose();
		}
	});

	test('Azure: a refused credential stops the probe that passed from vouching for it (#5890)', async () => {
		let probes = 0;
		const manager = await azureWithRefusingOrg(() => {
			probes++;
			return Promise.resolve({ id: 'guid-1' });
		});
		const read = () => manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

		try {
			await read();
			await read();
			assert.equal(probes, 1, 'a pass is remembered');

			// Any read of this connection that sees the credential refused, e.g. an uncached one elsewhere.
			const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
			(azure as unknown as { handleProviderException(usecase: string, ex: Error): void }).handleProviderException(
				'getIssue',
				refusedCredential(),
			);
			// The refused token stays expired, so the next read reads with its replacement (any transition queued by
			// the refusal settles first, so it cannot mark the replacement).
			await new Promise(resolve => setImmediate(resolve));
			(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t2'),
				domain: 'dev.azure.com',
			};

			await read();
			assert.equal(probes, 2, 'the credential is confirmed again rather than trusted');
		} finally {
			manager.dispose();
		}
	});

	test("Azure: the policy page is found from an organization's name as well as its id (#5890)", async () => {
		const manager = await azureWithRefusingOrg(() => Promise.resolve({ id: 'guid-1' }));

		try {
			// Fills the discovery cache the failure is recorded under.
			await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

			// Repo-scoped reads record the organization by name.
			const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
			const session = (azure as unknown as { _session: ProviderAuthenticationSession })._session;
			const describe = (
				azure as unknown as {
					describeRefusal(
						session: ProviderAuthenticationSession,
						refusal: { status: number },
						scope: { resourceId?: string },
					): { reason: string; remedyUrl?: string } | undefined;
				}
			).describeRefusal.bind(azure);

			assert.equal(
				describe(session, { status: 401 }, { resourceId: 'Org Denied' })?.remedyUrl,
				'https://dev.azure.com/Org%20Denied/_settings/organizationPolicy',
			);
		} finally {
			manager.dispose();
		}
	});

	test('Azure: a token revoked after discovery fails the read as a connection failure, not a scoped one (#5890)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// The first read discovers 'Org OK' and caches its projects per token. Then the token is revoked and the
		// user is also in 'Org Denied', which is the only organization the second read still has to request.
		let revoked = false;
		const discovered: string[] = [];
		stubApi(azure, {
			getAzureProjectsForResource: (_t: unknown, resourceName: string) => {
				discovered.push(resourceName);
				return revoked
					? Promise.reject(refusedCredential())
					: Promise.resolve({
							values: [{ id: 'p1', name: 'proj', namespace: resourceName }],
							paging: { more: false },
						});
			},
			getCurrentUser: () => (revoked ? Promise.reject(refusedCredential()) : Promise.resolve({ id: 'guid-1' })),
		});
		const orgs = [{ id: 'org-ok', name: 'Org OK' }];
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve(orgs);

		try {
			const first = await manager.listProjects({ providerId: GitCloudHostIntegrationId.AzureDevOps });
			assert.equal(first.items.length, 1);
			assert.deepEqual(first.warnings, []);

			revoked = true;
			orgs.push({ id: 'org-denied', name: 'Org Denied' });
			const result = await manager.listProjects({ providerId: GitCloudHostIntegrationId.AzureDevOps });

			assert.deepEqual(discovered, ['Org OK', 'Org Denied'], "'Org OK' was answered from the cache");
			const auth = result.warnings.filter(w => w.kind === 'auth');
			assert.equal(auth.length, 1);
			// Without the probe this is `{ resourceId: 'org-denied' }` next to the cached project: exactly what one
			// organization refusing a sound credential looks like, so a consumer would never offer to reconnect.
			assert.equal('scope' in auth[0], false, 'the refused credential is reported for the connection');
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(result.items, [], 'cached results are not published under a refused credential');
		} finally {
			manager.dispose();
		}
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

/** A pending review request from `reviewerId`, as provider-apis normalizes an Azure reviewer. */
function requestedFrom(reviewerId: string) {
	return {
		reviewer: { id: reviewerId, name: reviewerId, username: reviewerId, email: null, avatarUrl: null, url: null },
		state: GitPullRequestReviewState.ReviewRequested,
	};
}

/**
 * An Azure DevOps connection with one organization and two projects, `web` and `api`. Its pull request reads answer
 * by filter from `rows`, keyed `project:all` for a read with no filter and `project:<reviewerId>` for a reviewer
 * read, and are recorded the same way (`project:creator` for an author read).
 */
async function azureWithGroups(options: {
	groups: () => Promise<string[]>;
	rows?: Record<string, ProviderPullRequest[]>;
}) {
	const manager = createIntegrationManager(createFakeRuntime());
	const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
	(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'dev.azure.com',
	};
	const reads: string[] = [];
	const readStates = new Map<string, GitPullRequestState[] | undefined>();
	const groupReads: { namespace: string; userId: string }[] = [];
	stubApi(azure, {
		getAzureGroupIdsForUser: (_t: unknown, namespace: string, userId: string) => {
			groupReads.push({ namespace: namespace, userId: userId });
			return options.groups();
		},
		getPullRequestsForAzureProject: (
			_t: unknown,
			project: { project: string },
			o?: { reviewerId?: string; authorLogin?: string; states?: GitPullRequestState[] },
		) => {
			const key = `${project.project}:${o?.reviewerId ?? (o?.authorLogin != null ? 'creator' : 'all')}`;
			reads.push(key);
			readStates.set(key, o?.states);
			return Promise.resolve({ data: options.rows?.[key] ?? [], hasMore: false, nextPage: null });
		},
	});
	(azure as unknown as { getProviderCurrentAccount: () => Promise<{ id: string }> }).getProviderCurrentAccount = () =>
		Promise.resolve({ id: 'me' });
	(
		azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
	).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
	(
		azure as unknown as {
			getProviderProjectsForResources: () => Promise<{
				values: { id: string; resourceId: string; resourceName: string; name: string }[];
			}>;
		}
	).getProviderProjectsForResources = () =>
		Promise.resolve({
			values: [
				{ id: 'web-id', resourceId: 'org-1', resourceName: 'Org One', name: 'web' },
				{ id: 'api-id', resourceId: 'org-1', resourceName: 'Org One', name: 'api' },
			],
		});

	const read = (filters?: PullRequestFilter[], state?: PullRequestStateFilter[]) =>
		(
			azure as unknown as {
				getMyPullRequestsForUserResult: (options?: {
					filters?: PullRequestFilter[];
					state?: PullRequestStateFilter[];
				}) => Promise<IntegrationResult<ProviderApiPagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult({ filters: filters, state: state });
	return {
		manager: manager,
		azure: azure,
		read: read,
		reads: reads,
		readStates: readStates,
		groupReads: groupReads,
	};
}

suite('Azure DevOps group reviewer reads (#5917)', () => {
	// `#1` is reviewed by the user's team only; `#2` by the user and the team; `#3` by a group of another project the
	// user is in and by a stranger group; `#4` only by a group the user isn't in; `#5` by nobody.
	const pr1 = providerPr('pr-1', { reviews: [requestedFrom('web-team')] });
	const pr2 = providerPr('pr-2', { reviews: [requestedFrom('me'), requestedFrom('web-team')] });
	const pr3 = providerPr('pr-3', { reviews: [requestedFrom('api-contributors'), requestedFrom('stranger-group')] });
	const pr4 = providerPr('pr-4', { reviews: [requestedFrom('stranger-group')] });
	const pr5 = providerPr('pr-5', { reviews: [] });
	// The user's own: `#6` only their team reviews, which isn't asking them; `#7` names them.
	const me = { id: 'me', name: 'Me', username: 'me', email: null, avatarUrl: null, url: null };
	const pr6 = providerPr('pr-6', { author: me, reviews: [requestedFrom('web-team')] });
	const pr7 = providerPr('pr-7', { author: me, reviews: [requestedFrom('me'), requestedFrom('web-team')] });
	const marks = (values: ProviderPullRequest[] | undefined, id: string) =>
		values?.find(pr => pr.id === id)?.reviews?.map(r => [r.reviewer.id, r.isMyGroup ?? false]);

	test("reads each project once and keeps what the user or any of the user's groups reviews, marking the groups", async () => {
		const { manager, read, reads, groupReads } = await azureWithGroups({
			groups: () => Promise.resolve(['web-team', 'api-contributors']),
			rows: { 'web:all': [pr1, pr2, pr3, pr4, pr5, pr6, pr7], 'api:all': [] },
		});

		const result = await read([PullRequestFilter.ReviewRequested]);
		assert.deepEqual(result?.value?.metadata?.failures ?? [], []);
		assert.deepEqual(
			reads.sort(),
			['api:all', 'web:all'],
			'open pull requests: no reviewer filter, no author read',
		);
		assert.deepEqual(groupReads, [{ namespace: 'Org One', userId: 'me' }], 'one group read per organization');

		const values = result?.value?.values;
		assert.deepEqual(values?.map(pr => pr.id).sort(), ['pr-1', 'pr-2', 'pr-3', 'pr-7']);
		assert.deepEqual(marks(values, 'pr-1'), [['web-team', true]]);
		assert.deepEqual(marks(values, 'pr-2'), [
			['me', false],
			['web-team', true],
		]);
		assert.deepEqual(
			marks(values, 'pr-3'),
			[
				['api-contributors', true],
				['stranger-group', false],
			],
			"a group the user isn't in is not marked",
		);

		manager.dispose();
	});
	test("over closed states, follows only the user's own requests there, through Azure's filter", async () => {
		const old = providerPr('pr-old', { reviews: [requestedFrom('me')] });
		const { manager, read, reads, readStates } = await azureWithGroups({
			groups: () => Promise.resolve(['web-team']),
			// The read of every pull request stops short of `pr-old`, as a backstopped history would.
			rows: { 'web:all': [pr1], 'web:me': [old] },
		});
		const result = await read([PullRequestFilter.ReviewRequested], ['all']);
		assert.deepEqual(reads.sort(), ['api:all', 'api:me', 'web:all', 'web:me']);
		assert.deepEqual(
			readStates.get('web:all'),
			[GitPullRequestState.Open],
			'only open pull requests are read whole',
		);
		assert.deepEqual(readStates.get('web:me'), [GitPullRequestState.Closed, GitPullRequestState.Merged]);
		assert.deepEqual(result?.value?.values.map(pr => pr.id).sort(), ['pr-1', 'pr-old']);

		reads.length = 0;
		await read([PullRequestFilter.ReviewRequested], ['merged']);
		assert.deepEqual(reads.sort(), ['api:me', 'web:me'], 'no open pull request asked for, none read whole');

		manager.dispose();
	});

	test('reads no groups, and no pull request without a filter, when only authored pull requests are asked for', async () => {
		const { manager, read, reads, groupReads } = await azureWithGroups({
			groups: () => Promise.resolve(['web-team']),
		});

		const result = await read([PullRequestFilter.Author]);
		assert.deepEqual(result?.value?.metadata?.failures ?? [], []);
		assert.deepEqual(groupReads, []);
		assert.deepEqual(reads.sort(), ['api:creator', 'web:creator']);

		manager.dispose();
	});

	test('reads the groups for the assignee relationship too, which Azure reads by reviewer', async () => {
		const { manager, read, reads, groupReads } = await azureWithGroups({
			groups: () => Promise.resolve(['web-team']),
			rows: { 'web:all': [pr1] },
		});

		const result = await read([PullRequestFilter.Assignee]);
		assert.equal(groupReads.length, 1);
		assert.deepEqual(reads.sort(), ['api:all', 'web:all']);
		assert.deepEqual(
			result?.value?.values.map(pr => pr.id),
			['pr-1'],
		);

		manager.dispose();
	});

	test("keeps the user's own requests and reports the organization when its groups cannot be read", async () => {
		const { manager, read } = await azureWithGroups({
			groups: () => Promise.reject(new RequestRateLimitError(new Error('throttled'), undefined, undefined)),
			rows: { 'web:all': [pr1, pr2, pr3] },
		});

		const result = await read([PullRequestFilter.ReviewRequested]);
		assert.deepEqual(
			result?.value?.values.map(pr => pr.id),
			['pr-2'],
			'what the user reviews by name, and nothing marked as a group of theirs',
		);
		assert.deepEqual(marks(result?.value?.values, 'pr-2'), [
			['me', false],
			['web-team', false],
		]);
		const failures = result?.value?.metadata?.failures ?? [];
		assert.equal(failures.length, 1);
		assert.equal(failures[0].scope?.resourceId, 'org-1', 'attributed to the organization');
		assert.equal(failures[0].kind, 'rate-limit', 'the failure keeps its kind, so it stays actionable');
		assert.equal(result?.value?.metadata?.completeness, 'partial');
		assert.equal(result?.value?.paging?.truncated, true);

		manager.dispose();
	});

	test("keeps the user's groups between reads until the connection is re-synced, but never keeps a failure", async () => {
		let fail = true;
		const { manager, azure, read, groupReads } = await azureWithGroups({
			groups: () => (fail ? Promise.reject(new Error('identities unavailable')) : Promise.resolve(['web-team'])),
			rows: { 'web:all': [pr1] },
		});

		const failed = await read([PullRequestFilter.ReviewRequested]);
		assert.deepEqual(failed?.value?.values ?? [], []);
		assert.equal(groupReads.length, 1);

		fail = false;
		const first = await read([PullRequestFilter.ReviewRequested]);
		assert.deepEqual(
			first?.value?.values.map(pr => pr.id),
			['pr-1'],
		);
		assert.equal(groupReads.length, 2, 'the failed read was not kept');

		await read([PullRequestFilter.ReviewRequested]);
		assert.equal(groupReads.length, 2, 'the next read reuses the groups');

		azure.invalidateDiscoveryCaches();
		await read([PullRequestFilter.ReviewRequested]);
		assert.equal(groupReads.length, 3, 'a re-sync reads them again');

		manager.dispose();
	});

	test('reads the groups from the identity routes, with the credential provider-apis would send', async () => {
		const runtime = createFakeRuntime();
		const requests: { method: string; url: string; authorization: string; body?: string }[] = [];
		let memberOf: unknown = ['desc;a', 'desc;b'];
		let batch: (descriptors: string[]) => unknown = descriptors => ({
			value: descriptors.map(d => ({ id: d.replace('desc;', 'id-') })),
		});
		runtime.http.fetch = (input, init) => {
			const url = String(input);
			requests.push({
				method: init?.method ?? 'GET',
				url: url,
				authorization: new Headers(init?.headers).get('authorization') ?? '',
				body: typeof init?.body === 'string' ? init.body : undefined,
			});
			const answer = url.includes('/_apis/identitybatch')
				? batch((JSON.parse(init!.body as string) as { descriptors: string[] }).descriptors)
				: { value: [{ id: 'me', memberOf: memberOf }] };
			return Promise.resolve(
				new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }),
			);
		};
		const manager = createIntegrationManager(runtime);
		const api = await (manager as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();
		const token: TokenWithInfo<GitCloudHostIntegrationId.AzureDevOps> = {
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			accessToken: 'secret',
			microHash: undefined,
			cloud: true,
			type: 'oauth',
			scopes: [],
		};
		const basic = `Basic ${Buffer.from(':secret').toString('base64')}`;

		assert.deepEqual(await api.getAzureGroupIdsForUser(token, 'My Org', 'me', { isPAT: true }), ['id-a', 'id-b']);
		assert.deepEqual(requests, [
			{
				method: 'GET',
				url: 'https://vssps.dev.azure.com/My%20Org/_apis/identities?identityIds=me&queryMembership=Expanded&api-version=5.0',
				authorization: basic,
				body: undefined,
			},
			{
				method: 'POST',
				url: 'https://vssps.dev.azure.com/My%20Org/_apis/identitybatch?api-version=5.0-preview.1',
				authorization: basic,
				body: JSON.stringify({ descriptors: ['desc;a', 'desc;b'], queryMembership: 'None' }),
			},
		]);

		// Azure DevOps Server: below the collection, on the installation's own host.
		requests.length = 0;
		await api.getAzureGroupIdsForUser(token, 'Default Collection', 'me', {
			isPAT: true,
			baseUrl: 'https://server.test/tfs/',
		});
		assert.deepEqual(
			requests.map(r => r.url.split('?')[0]),
			[
				'https://server.test/tfs/Default%20Collection/_apis/identities',
				'https://server.test/tfs/Default%20Collection/_apis/identitybatch',
			],
		);

		// No groups: no batch read.
		requests.length = 0;
		memberOf = [];
		assert.deepEqual(await api.getAzureGroupIdsForUser(token, 'My Org', 'me', { isPAT: true }), []);
		assert.equal(requests.length, 1);

		// A group Azure no longer resolves (deleted) can't be anyone's reviewer, so it is skipped.
		memberOf = ['desc;a', 'desc;gone'];
		batch = () => ({ value: [{ id: 'id-a' }, null] });
		assert.deepEqual(await api.getAzureGroupIdsForUser(token, 'My Org', 'me', { isPAT: true }), ['id-a']);

		// Many groups: resolved in batches of 100, never one oversized request.
		requests.length = 0;
		memberOf = Array.from({ length: 150 }, (_, i) => `desc;${i}`);
		batch = descriptors => ({ value: descriptors.map(d => ({ id: d.replace('desc;', 'id-') })) });
		const many = await api.getAzureGroupIdsForUser(token, 'My Org', 'me', { isPAT: true });
		assert.equal(many.length, 150);
		assert.deepEqual(
			requests
				.filter(r => r.method === 'POST')
				.map(r => (JSON.parse(r.body!) as { descriptors: string[] }).descriptors.length),
			[100, 50],
		);

		// A later batch that comes back short fails the read, as the first would.
		batch = descriptors => ({
			value: descriptors.slice(0, descriptors.length === 50 ? 49 : undefined).map(d => ({ id: d })),
		});
		await assert.rejects(
			api.getAzureGroupIdsForUser(token, 'My Org', 'me', { isPAT: true }),
			/did not resolve every group/,
		);

		memberOf = ['desc;a', 'desc;b'];
		// Anything else that can't be matched to a reviewer fails rather than narrowing the read.
		batch = () => ({ value: [{ id: 'id-a' }] });
		await assert.rejects(
			api.getAzureGroupIdsForUser(token, 'My Org', 'me', { isPAT: true }),
			/did not resolve every group/,
		);
		batch = () => ({ value: [{ id: 'id-a' }, { name: 'no id' }] });
		await assert.rejects(api.getAzureGroupIdsForUser(token, 'My Org', 'me', { isPAT: true }), /without its id/);
		memberOf = undefined;
		await assert.rejects(
			api.getAzureGroupIdsForUser(token, 'My Org', 'me', { isPAT: true }),
			/no group membership/,
		);

		manager.dispose();
	});
});
