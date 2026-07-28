import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IntegrationResult } from '../models/integration.js';
import { IssueFilter } from '../providerFilters.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * The account-wide issue read (`listIssuesPage` with no `repos`) delegates to each provider's own "my issues"
 * query, and unfiltered those queries are each provider's own definition of "mine" — GitHub/GHE union
 * authored + assigned + mentioned, Azure drains assigned + authored, GitLab reads assigned-to-me. All but
 * GitLab's are WIDER than `assignee:@me`, and a consumer couldn't narrow them from the outside: the fan-out
 * happens inside the provider, so dropping the extra items from the returned page leaves `items` describing a
 * different result set than the `hasMore`/`cursor` that came back with it.
 *
 * `filters` narrows the read at the source. It's validated against `supportedAccountWideIssueFilters` — NOT the
 * repo-scoped `supportedIssueFilters`, since the two are different provider queries — and an inexpressible set is
 * refused whole rather than served as the unnarrowed union.
 */

function primarySession(token: string, domain = 'github.com'): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

function stubApi(integration: unknown, api: Record<string, unknown>): void {
	(integration as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () => Promise.resolve(api);
}

suite('account-wide issue filters', () => {
	suite('GitHub', () => {
		test('[Assignee] runs only the assigned search — `assignee:@me` parity, not the authored ∪ assigned ∪ mentioned union', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
				assert.ok(gh != null);
				(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

				const githubApi = await (
					gh as unknown as {
						authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
					}
				).authenticationService.apis.github;
				assert.ok(githubApi);

				const seen: ({ authored?: boolean; assigned?: boolean; mentioned?: boolean } | undefined)[] = [];
				githubApi.searchMyIssues = (
					_provider: unknown,
					_token: unknown,
					options?: { categories?: { authored?: boolean; assigned?: boolean; mentioned?: boolean } },
				) => {
					seen.push(options?.categories);
					return Promise.resolve({ values: [], hasMore: false, page: 1, truncated: false });
				};

				await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					filters: [IssueFilter.Assignee],
				});

				assert.deepEqual(
					seen,
					[{ authored: false, assigned: true, mentioned: false }],
					'only the assigned category is read',
				);
			} finally {
				manager.dispose();
			}
		});

		test('no filters keeps the provider’s own definition of "mine" (all three searches)', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
				assert.ok(gh != null);
				(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

				const githubApi = await (
					gh as unknown as {
						authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
					}
				).authenticationService.apis.github;
				assert.ok(githubApi);

				let seenCategories: unknown = 'not called';
				githubApi.searchMyIssues = (
					_provider: unknown,
					_token: unknown,
					options?: { categories?: unknown },
				) => {
					seenCategories = options?.categories;
					return Promise.resolve({ values: [], hasMore: false, page: 1, truncated: false });
				};

				await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub });

				assert.equal(seenCategories, undefined, 'an unfiltered read passes no category selection');
			} finally {
				manager.dispose();
			}
		});

		test('an empty filter set is unfiltered, not "read nothing"', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
				assert.ok(gh != null);
				(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

				const githubApi = await (
					gh as unknown as {
						authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
					}
				).authenticationService.apis.github;
				assert.ok(githubApi);

				let called = false;
				githubApi.searchMyIssues = (
					_provider: unknown,
					_token: unknown,
					options?: { categories?: unknown },
				) => {
					called = true;
					assert.equal(options?.categories, undefined);
					return Promise.resolve({ values: [], hasMore: false, page: 1, truncated: false });
				};

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					filters: [],
				});

				assert.equal(called, true, 'the read still happens');
				assert.equal(result.fetchFailed, undefined, 'an empty set is not treated as an unsupported set');
			} finally {
				manager.dispose();
			}
		});
	});

	suite('Azure DevOps', () => {
		async function connectedAzure(manager: ReturnType<typeof createIntegrationManager>) {
			const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
			assert.ok(azure != null);
			(azure as unknown as { _session: ProviderAuthenticationSession })._session = primarySession(
				't',
				'dev.azure.com',
			);
			(
				azure as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
			).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });
			(
				azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
			).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
			(
				azure as unknown as {
					getProviderProjectsForResources: () => Promise<{
						values: { resourceName: string; name: string }[];
					}>;
				}
			).getProviderProjectsForResources = () =>
				Promise.resolve({ values: [{ resourceName: 'org-1', name: 'proj' }] });
			return azure;
		}

		function stubDrains(azure: unknown): { assigneeLogins?: string[]; authorLogin?: string }[] {
			const seen: { assigneeLogins?: string[]; authorLogin?: string }[] = [];
			stubApi(azure, {
				getIssuesForAzureProject: (
					_t: unknown,
					_ns: string,
					_p: string,
					options?: { assigneeLogins?: string[]; authorLogin?: string },
				) => {
					seen.push({ assigneeLogins: options?.assigneeLogins, authorLogin: options?.authorLogin });
					return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
				},
			});
			return seen;
		}

		test('[Assignee] drops the authored drain', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const azure = await connectedAzure(manager);
				const seen = stubDrains(azure);

				await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					filters: [IssueFilter.Assignee],
				});

				assert.equal(seen.length, 1, 'one drain per project instead of the assigned+authored pair');
				assert.deepEqual(seen[0].assigneeLogins, ['me']);
				assert.equal(seen[0].authorLogin, undefined);
			} finally {
				manager.dispose();
			}
		});

		test('[Author] drops the assigned drain', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const azure = await connectedAzure(manager);
				const seen = stubDrains(azure);

				await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					filters: [IssueFilter.Author],
				});

				assert.equal(seen.length, 1);
				assert.equal(seen[0].authorLogin, 'me');
				assert.equal(seen[0].assigneeLogins, undefined);
			} finally {
				manager.dispose();
			}
		});

		test('unfiltered still drains assigned + authored', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const azure = await connectedAzure(manager);
				const seen = stubDrains(azure);

				await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.AzureDevOps });

				assert.equal(seen.length, 2, 'the provider\'s own definition of "mine" is unchanged');
			} finally {
				manager.dispose();
			}
		});

		test('[Mention] is refused — Azure has no mention query to narrow to', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const azure = await connectedAzure(manager);
				const seen = stubDrains(azure);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					filters: [IssueFilter.Mention],
				});

				assert.equal(seen.length, 0, 'the read is skipped rather than served unnarrowed');
				assert.equal(result.items.length, 0);
				assert.equal(result.fetchFailed, true);
				assert.equal(result.hasMore, false);
				assert.ok(
					result.warnings.some(w => /not supported/i.test(w.message)),
					'a warning names the unsupported filter set',
				);
			} finally {
				manager.dispose();
			}
		});
	});

	suite('GitLab', () => {
		test('[Assignee] is accepted — it is what the account-wide read already does', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
				assert.ok(gl != null);
				(gl as unknown as { _session: ProviderAuthenticationSession })._session = primarySession(
					't',
					'gitlab.com',
				);
				(
					gl as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
				).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });

				const seenScopes: (string | undefined)[] = [];
				stubApi(gl, {
					getIssuesForCurrentUser: (_t: unknown, options?: { scope?: string; assigneeUsername?: string }) => {
						seenScopes.push(options?.scope);
						return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
					},
				});

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					filters: [IssueFilter.Assignee],
				});

				assert.deepEqual(seenScopes, ['assigned_to_me']);
				assert.equal(result.fetchFailed, undefined);
			} finally {
				manager.dispose();
			}
		});

		test('[Author] is refused — the SDK account-wide input has no author axis', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
				assert.ok(gl != null);
				(gl as unknown as { _session: ProviderAuthenticationSession })._session = primarySession(
					't',
					'gitlab.com',
				);

				let called = false;
				stubApi(gl, {
					getIssuesForCurrentUser: () => {
						called = true;
						return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
					},
				});

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					filters: [IssueFilter.Author],
				});

				assert.equal(called, false, 'no unnarrowed read is issued in place of the requested one');
				assert.equal(result.fetchFailed, true);
			} finally {
				manager.dispose();
			}
		});

		test('a partially-expressible set is refused whole, not narrowed to its expressible member', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
				assert.ok(gl != null);
				(gl as unknown as { _session: ProviderAuthenticationSession })._session = primarySession(
					't',
					'gitlab.com',
				);

				let called = false;
				stubApi(gl, {
					getIssuesForCurrentUser: () => {
						called = true;
						return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
					},
				});

				// Dropping `Author` and reading assigned-only would answer a narrower question than asked; keeping it
				// and reading unfiltered would answer a wider one. Neither is the caller's request.
				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					filters: [IssueFilter.Assignee, IssueFilter.Author],
				});

				assert.equal(called, false);
				assert.equal(result.fetchFailed, true);
			} finally {
				manager.dispose();
			}
		});
	});

	test('filters and includeAllAssignees together are refused — one narrows, the other broadens', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
			assert.ok(gh != null);
			(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

			let called = false;
			(
				gh as unknown as {
					searchMyIssuesWithTruncationResult: () => Promise<
						IntegrationResult<{ values: IssueShape[]; truncated: boolean }>
					>;
				}
			).searchMyIssuesWithTruncationResult = () => {
				called = true;
				return Promise.resolve({ value: { values: [], truncated: false } });
			};

			const result = await manager.listIssuesPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				filters: [IssueFilter.Assignee],
				includeAllAssignees: true,
			});

			assert.equal(called, false, 'neither intent is silently picked');
			assert.equal(result.fetchFailed, true);
			assert.ok(result.warnings.some(w => /contradictory/i.test(w.message)));
		} finally {
			manager.dispose();
		}
	});

	suite('getSupportedFilters().issuesAccountWide', () => {
		test('reports what each git host can express account-wide', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issuesAccountWide, [
					IssueFilter.Author,
					IssueFilter.Assignee,
					IssueFilter.Mention,
				]);
				assert.deepEqual(
					manager.getSupportedFilters(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise)
						.issuesAccountWide,
					manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issuesAccountWide,
					'GHE mirrors GitHub',
				);
				assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.AzureDevOps).issuesAccountWide, [
					IssueFilter.Author,
					IssueFilter.Assignee,
				]);
				// Author became expressible in `@gitkraken/provider-apis` 0.54.0 (`author_username` on the REST
				// account-wide read); before that `scope` + `assigneeUsername` were the only axes. Mention stays out —
				// that read has no first-class mention filter to narrow with.
				assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.GitLab).issuesAccountWide, [
					IssueFilter.Assignee,
					IssueFilter.Author,
				]);
				assert.deepEqual(
					manager.getSupportedFilters(GitCloudHostIntegrationId.Bitbucket).issuesAccountWide,
					[],
					'Bitbucket exposes no issues at all',
				);
			} finally {
				manager.dispose();
			}
		});

		test('is a subset of the repo-scoped set for every provider', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const ids = [
					...Object.values(GitCloudHostIntegrationId),
					...Object.values(GitSelfManagedHostIntegrationId),
					...Object.values(IssuesCloudHostIntegrationId),
				];
				for (const id of ids) {
					const { issues, issuesAccountWide } = manager.getSupportedFilters(id);
					const extra = issuesAccountWide.filter(f => !issues.includes(f));
					assert.deepEqual(
						extra,
						[],
						`${id}: an account-wide filter that the repo-scoped read can't express would mean the narrower table is the wrong default to intersect against`,
					);
				}
			} finally {
				manager.dispose();
			}
		});

		test('returns copies, so a caller can’t corrupt the metadata', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const first = manager.getSupportedFilters(GitCloudHostIntegrationId.GitLab);
				first.issuesAccountWide.push(IssueFilter.Mention);

				assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.GitLab).issuesAccountWide, [
					IssueFilter.Assignee,
					IssueFilter.Author,
				]);
			} finally {
				manager.dispose();
			}
		});
	});
});
