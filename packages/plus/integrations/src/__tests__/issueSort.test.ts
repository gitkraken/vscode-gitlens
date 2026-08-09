import * as assert from 'node:assert/strict';
import { compareBy, getIssueComparator as sdkIssueComparator, SUPPORTED_ISSUE_SORTS } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { gitHubIssueSortQualifiers } from '@gitlens/git-github/api/issueSearchQuery.js';
import type { IssueShape, IssueSortField, IssueSorting } from '@gitlens/git/models/issue.js';
import { getIssueComparator } from '@gitlens/git/utils/issue.utils.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { providersMetadata } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * The ORDERING half of the issue-read contract, across every surface that takes it.
 *
 * Its own file rather than a section of `issueSearch.test.ts` because the claim under test spans four reads — the
 * filtered search, the repo-scoped and account-wide `listIssuesPage` branches, and the issue-tracker read — and
 * the interesting cases are the ones where they DIFFER: which capability table each validates against, and which of
 * them merges several provider queries and therefore can't honor every key it otherwise could. Read together, those
 * differences are the contract; split across four files they read as four unrelated quirks.
 *
 * The query-string half (which key becomes which qualifier) is asserted in `@gitlens/git-github`'s own tests.
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

/** Stubs the repo-scoped shapes seam, recording the options the facade passed to it. */
async function stubRepoScopedRead(
	manager: ReturnType<typeof createIntegrationManager>,
	providerId: GitCloudHostIntegrationId,
	values: unknown[] = [],
): Promise<Record<string, unknown>[]> {
	const integration = await manager.get(providerId);
	assert.ok(integration != null);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

	const calls: Record<string, unknown>[] = [];
	(
		integration as unknown as {
			getMyIssuesForReposAsShapesResult: (repos: unknown, options: Record<string, unknown>) => Promise<unknown>;
		}
	).getMyIssuesForReposAsShapesResult = (_repos: unknown, options: Record<string, unknown>) => {
		calls.push(options);
		return Promise.resolve({ value: { values: values, paging: { more: false } } });
	};
	return calls;
}

/** Stubs the account-wide seam, recording the options the facade passed to it. */
async function stubAccountWideRead(
	manager: ReturnType<typeof createIntegrationManager>,
	providerId: GitCloudHostIntegrationId,
	values: unknown[] = [],
): Promise<Record<string, unknown>[]> {
	const integration = await manager.get(providerId);
	assert.ok(integration != null);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

	const calls: Record<string, unknown>[] = [];
	(
		integration as unknown as {
			searchMyIssuesWithTruncationResult: (
				resources: unknown,
				cancellation: unknown,
				connectionId: unknown,
				options: Record<string, unknown>,
			) => Promise<unknown>;
		}
	).searchMyIssuesWithTruncationResult = (
		_resources: unknown,
		_cancellation: unknown,
		_connectionId: unknown,
		options: Record<string, unknown>,
	) => {
		calls.push(options);
		return Promise.resolve({ value: { values: values, truncated: false, hasMore: false } });
	};
	return calls;
}

function issue(title: string, fields: { updated?: string; created?: string; comments?: number }): IssueShape {
	return {
		type: 'issue',
		provider: { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
		id: title,
		nodeId: undefined,
		title: title,
		url: `https://github.com/o/a/issues/${title}`,
		createdDate: new Date(fields.created ?? '2020-01-01T00:00:00Z'),
		updatedDate: new Date(fields.updated ?? '2020-01-01T00:00:00Z'),
		closed: false,
		state: 'opened',
		author: undefined,
		assignees: [],
		commentsCount: fields.comments,
	} satisfies IssueShape;
}

suite('issue read ordering', () => {
	suite('the capability tables', () => {
		// The tables are a PROMISE: every key declared reaches the provider query. The SDK is what translates it, so
		// a key this side declares and that side can't translate doesn't produce a differently-ordered read — it
		// produces an `UnsupportedSortError` after the facade already told the consumer the key was fine. GitHub is
		// the one provider whose translation table lives in this repo, so it is the one this can pin directly.
		test('every GitHub key declared has a qualifier, and every qualifier is declared', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const declared = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issueSorts;
				assert.deepEqual(
					[...declared].sort(),
					Object.keys(gitHubIssueSortQualifiers).sort(),
					'the capability table and the translation table are the same set',
				);
				assert.deepEqual(
					[...manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issueSearch.sorts].sort(),
					[...declared].sort(),
					'all three GitHub issue surfaces run the same `search`, so all three order the same way',
				);
			} finally {
				manager.dispose();
			}
		});

		// GitHub can order by created/updated/comments/reactions and nothing else. `closed` is the one worth naming:
		// `IssueShape.closedDate` exists, so declaring it looks harmless — but GitHub's search has no such sort, and
		// ordering a page already cut off at the result ceiling does not make it the top N by close date.
		test('GitHub declares no close-date ordering, whatever IssueShape carries', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const declared = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issueSorts;
				assert.equal(declared.includes('closed:desc'), false);
				assert.equal(declared.includes('priority:desc'), false);
			} finally {
				manager.dispose();
			}
		});

		// GitLab's two reads are different APIs, not one narrowed twice: GraphQL has `TITLE_*`/`CLOSED_AT_*` and
		// REST has neither. Declaring the intersection would lose two keys the repository-scoped read really has.
		test('GitLab’s repo-scoped and account-wide vocabularies differ in both directions', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { issueSorts, issueSortsAccountWide } = manager.getSupportedFilters(
					GitCloudHostIntegrationId.GitLab,
				);
				assert.equal(issueSorts.includes('title:asc'), true, 'GraphQL orders by title');
				assert.equal(issueSortsAccountWide.includes('title:asc'), false, 'REST does not');
			} finally {
				manager.dispose();
			}
		});

		// Every account-wide read is a union of several queries — GitHub's three `@me` searches, GitLab's one call
		// per relationship, Azure's per-project drains — so it can only order by what a normalized issue carries.
		// Those keys are absent from the table rather than refused at runtime, which is what makes intersecting
		// against the table sufficient for that surface.
		test('no account-wide table declares a key a merge could not honor', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				for (const providerId of [
					GitCloudHostIntegrationId.GitHub,
					GitCloudHostIntegrationId.GitLab,
					GitCloudHostIntegrationId.AzureDevOps,
				]) {
					for (const sort of manager.getSupportedFilters(providerId).issueSortsAccountWide) {
						const field = sort.split(':')[0];
						assert.equal(
							['priority', 'dueDate', 'resolved'].includes(field),
							false,
							`'${sort}' is not orderable across a merge, so '${providerId}' must not declare it`,
						);
					}
				}
			} finally {
				manager.dispose();
			}
		});

		// The SDK declares its own merge-filtered GitLab surface, computed from the same GraphQL map by the same
		// rule. Core applies the rule at read time instead (`mergesProviderQueries`), so the two must agree: if
		// they don't, one of the repos is wrong about which keys survive a client-side merge, and the symptom
		// would be core promising a key the SDK's aggregate rejects — the one drift a derived table can't catch,
		// because the aggregate is a surface core never reads from directly.
		test('core’s merge rule computes the same set the SDK’s own aggregate declares', () => {
			const mergeable = SUPPORTED_ISSUE_SORTS.gitlabRepository.filter(sort => getIssueComparator(sort) != null);

			assert.deepEqual([...mergeable].sort(), [...SUPPORTED_ISSUE_SORTS.gitlabAggregate].sort());
		});

		// Linear's `PaginationOrderBy` has no ascending member. Declaring the ascending keys because the descending
		// ones exist is the exact mistake this pins: the read would be accepted here and rejected by the SDK.
		test('Linear declares descending keys only', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const declared = manager.getSupportedFilters(IssuesCloudHostIntegrationId.Linear).issueSorts;
				assert.deepEqual([...declared].sort(), ['created:desc', 'updated:desc']);
			} finally {
				manager.dispose();
			}
		});

		// A provider whose issue read can be ordered at all must be able to serve the facade's own default, or an
		// unordered request would refuse a read that works today.
		test('every declared table can express the default order', async () => {
			for (const [providerId, metadata] of Object.entries(providersMetadata)) {
				for (const [field, table] of [
					['supportedIssueSorts', metadata.supportedIssueSorts],
					['supportedAccountWideIssueSorts', metadata.supportedAccountWideIssueSorts],
				] as const) {
					if (table == null) continue;

					assert.equal(
						table.includes('updated:desc'),
						true,
						`${providerId}.${field} declares keys but not the default`,
					);
				}
			}
		});
	});

	suite('refusals', () => {
		// All-or-nothing, like every filter: at a bounded result window another order is another subset, and the
		// paging that comes with it describes that other subset. Nothing is requested, so nothing is half-read.
		test('a key the repo-scoped read cannot express refuses it, with no upstream request', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const calls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitHub);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					sort: 'priority:desc',
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /issue sort/);
				assert.equal(calls.length, 0);
			} finally {
				manager.dispose();
			}
		});

		test('the account-wide read validates against its OWN table, not the repo-scoped one', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const calls = await stubAccountWideRead(manager, GitCloudHostIntegrationId.GitLab);

				// GitLab's repo-scoped GraphQL read orders by title; its account-wide REST read does not.
				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					sort: 'title:asc',
				});

				assert.equal(result.fetchFailed, true);
				assert.equal(calls.length, 0);
			} finally {
				manager.dispose();
			}
		});

		// The provider orders by `priority` perfectly well within one repository. What can't be done is MERGING two
		// such pages, because no normalized issue carries priority to merge on. So the refusal is about the read,
		// not the provider — and it must not fire for the single-scope case, which is the next test.
		test('a key no normalized issue carries refuses a MULTI-scope page', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const calls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitLab);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					repos: [
						{ namespace: 'o', name: 'a' },
						{ namespace: 'o', name: 'b' },
					],
					sort: 'priority:desc',
				});

				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /several repositories/);
				assert.equal(calls.length, 0, 'refused before any request, like every other criteria refusal');
			} finally {
				manager.dispose();
			}
		});

		// Repository IDS, not descriptors: `getMyIssuesForReposResult` skips its per-repository fan-out for that form
		// (the branch is guarded on `!isRepoIdsInput`) and calls the SDK's `getIssuesForRepos`, which for GitLab is the
		// multi-project aggregate — it merges in the SDK and refuses `priority` however few scopes it was given. So
		// ONE id has to be refused here too, or the facade promises a key the SDK then rejects.
		test('a single repository ID is still a merge, because the id form takes the SDK aggregate', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const calls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitLab);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					repos: [123],
					sort: 'priority:desc',
				});

				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /several repositories/);
				assert.equal(calls.length, 0);
			} finally {
				manager.dispose();
			}
		});

		test('the same key is served for a single scope, where the provider does the ordering', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const calls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitLab);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					repos: [{ namespace: 'o', name: 'a' }],
					sort: 'priority:desc',
				});

				assert.equal(result.fetchFailed, undefined);
				assert.equal(calls.length, 1);
				assert.equal(calls[0].sort, 'priority:desc');
			} finally {
				manager.dispose();
			}
		});

		// The count exists to preview the constraints the read will apply. One that accepted a key the read refuses
		// would promise a fetch that can't happen, which is worse than no preview.
		test('countIssues refuses a key exactly as the search it previews would', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const result = await manager.countIssues({
					providerId: GitCloudHostIntegrationId.GitHub,
					scopes: [{ key: 'k', repos: [{ namespace: 'o', name: 'a' }], criteria: { sort: 'priority:desc' } }],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /sort:priority:desc/);
			} finally {
				manager.dispose();
			}
		});
	});

	suite('what reaches the provider', () => {
		// Omitting it would delegate the order to each provider's own default — Azure by created date, Linear by
		// created date, Jira by nothing at all — which is the cross-provider incoherence this layer exists to
		// remove. So the default is EXPLICIT on the wire, not merely documented.
		test('an omitted sort still sends the default to the provider', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const repoCalls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitHub);
				const accountCalls = await stubAccountWideRead(manager, GitCloudHostIntegrationId.GitHub);

				await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
				});
				await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub });

				assert.equal(repoCalls[0].sort, 'updated:desc');
				assert.equal(accountCalls[0].sort, 'updated:desc');
			} finally {
				manager.dispose();
			}
		});

		test('a requested key is forwarded verbatim, with no translation on this side', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const calls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitHub);

				await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					sort: 'comments:asc',
				});

				assert.equal(calls[0].sort, 'comments:asc');
			} finally {
				manager.dispose();
			}
		});
	});

	suite('the merged page', () => {
		// Each query arrived ordered by the provider; their union did not, and the union is what this read
		// publishes. Interleaved dates across two repositories are what make the difference observable.
		test('orders a multi-scope page rather than concatenating per-scope runs', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitLab, [
					issue('a1', { updated: '2020-01-02T00:00:00Z' }),
					issue('b1', { updated: '2020-01-04T00:00:00Z' }),
					issue('a2', { updated: '2020-01-01T00:00:00Z' }),
					issue('b2', { updated: '2020-01-03T00:00:00Z' }),
				]);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					repos: [
						{ namespace: 'o', name: 'a' },
						{ namespace: 'o', name: 'b' },
					],
				});

				assert.deepEqual(
					result.items.map(i => i.title),
					['b1', 'b2', 'a1', 'a2'],
				);
			} finally {
				manager.dispose();
			}
		});

		test('orders an account-wide page, which is always a union of several queries', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				await stubAccountWideRead(manager, GitCloudHostIntegrationId.GitHub, [
					issue('few', { comments: 1 }),
					issue('many', { comments: 9 }),
					issue('some', { comments: 5 }),
				]);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					sort: 'comments:desc',
				});

				assert.deepEqual(
					result.items.map(i => i.title),
					['many', 'some', 'few'],
				);
			} finally {
				manager.dispose();
			}
		});

		// A single scope arrived ordered by the provider already. Re-sorting it could only reproduce that order —
		// and would quietly paper over a provider that ignored the sort, which is worth NOT hiding.
		test('leaves a single-scope page in the order the provider returned', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitLab, [
					issue('second', { updated: '2020-01-01T00:00:00Z' }),
					issue('first', { updated: '2020-01-02T00:00:00Z' }),
				]);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					repos: [{ namespace: 'o', name: 'a' }],
				});

				assert.deepEqual(
					result.items.map(i => i.title),
					['second', 'first'],
				);
			} finally {
				manager.dispose();
			}
		});
	});

	suite('the result ceiling', () => {
		// "N matched, showing the first 1.000" is only true of a particular order — which 1.000 are reachable
		// depends on it — so the sentence has to name the key, and the omission has to carry it for a consumer
		// wording its own.
		test('the cap warning names the order the reachable window was selected under', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
			assert.ok(gh != null);
			(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
			try {
				const githubApi = await (
					gh as unknown as {
						authenticationService: { apis: { github: Promise<Record<string, unknown>> } };
					}
				).authenticationService.apis.github;
				githubApi.searchIssuesPage = () =>
					Promise.resolve({ values: [], truncated: true, hasMore: false, page: 1, totalCount: 19240 });

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					criteria: { sort: 'comments:desc' },
				});

				assert.match(result.warnings[0].message, /ordered by comments descending/);
				assert.equal(result.warnings[0].omission?.sort, 'comments:desc');
			} finally {
				manager.dispose();
			}
		});
	});
});

/** Guards the assumption every table above rests on: the union really is `field:direction`, both directions. */
suite('IssueSorting', () => {
	test('is the cross product of its fields and its two directions', () => {
		const sorts: IssueSorting[] = ['created:asc', 'created:desc', 'dueDate:asc', 'title:desc'];
		for (const sort of sorts) {
			const [field, direction] = sort.split(':');
			assert.ok(field.length > 0);
			assert.ok(direction === 'asc' || direction === 'desc');
		}
	});
});

suite('issue-tracker read ordering', () => {
	/**
	 * Stubs Jira's resource/project discovery and its per-project read, recording the options each project got.
	 *
	 * `projects` is what makes the interesting case reachable: one project is a single provider query and orders by
	 * anything Jira can, while two are merged HERE and can only be ordered by what a normalized issue carries.
	 */
	async function stubJira(
		manager: ReturnType<typeof createIntegrationManager>,
		projects: string[],
		issuesByProject: Record<string, unknown[]> = {},
	): Promise<Record<string, unknown>[]> {
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		assert.ok(jira != null);
		const stub = jira as unknown as Record<string, unknown>;
		stub.getResourcesForUserResult = () =>
			Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		stub.getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({
				value: { values: projects.map(p => ({ key: p, id: p, name: p, resourceId: 'org-1' })) },
			});
		stub.getAccountForResourceResult = () => Promise.resolve({ value: { username: 'me' } });

		const calls: Record<string, unknown>[] = [];
		stub.getIssuesForProjectWithTruncationResult = (project: { id: string }, options: Record<string, unknown>) => {
			calls.push(options);
			return Promise.resolve({
				value: { values: issuesByProject[project.id] ?? [], truncated: false },
			});
		};
		return calls;
	}

	// A tracker reports under `issueSorts`, not the account-wide table — resource -> project IS its only issue
	// surface. Reading its capability from the account-wide field would report "cannot order" for a tracker that
	// orders fine, which is why this asserts the read validates against the one it publishes.
	test('validates against the table a tracker actually publishes', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const declared = manager.getSupportedFilters(IssuesCloudHostIntegrationId.Jira);
			assert.equal(declared.issueSorts.includes('resolved:desc'), true, 'JQL orders by resolutiondate');
			assert.deepEqual(declared.issueSortsAccountWide, [], 'a tracker has no account-wide surface');

			const calls = await stubJira(manager, ['p1']);
			const result = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				sort: 'comments:desc',
			});

			assert.equal(result.fetchFailed, true, 'Jira has no comment-count ordering');
			assert.equal(calls.length, 0, 'and nothing was requested');
		} finally {
			manager.dispose();
		}
	});

	test('forwards the requested key to each project read, defaulting when none was asked for', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubJira(manager, ['p1', 'p2']);

			await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira });
			assert.deepEqual(
				calls.map(c => c.sort),
				['updated:desc', 'updated:desc'],
			);

			calls.length = 0;
			await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				sort: 'created:asc',
			});
			assert.deepEqual(
				calls.map(c => c.sort),
				['created:asc', 'created:asc'],
			);
		} finally {
			manager.dispose();
		}
	});

	// Jira orders by `resolutiondate` within one project perfectly well. Two projects are concatenated here, and no
	// normalized issue carries a resolution date to merge on — so the multi-project page refuses and the
	// single-project one serves. Same key, same provider, different read.
	test('refuses an unmergeable key across projects and serves it for one', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const many = await stubJira(manager, ['p1', 'p2']);
			const refused = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				sort: 'resolved:desc',
			});
			assert.equal(refused.fetchFailed, true);
			assert.match(refused.warnings[0].message, /several projects/);
			assert.equal(many.length, 0);
		} finally {
			manager.dispose();
		}

		const manager2 = createIntegrationManager(createFakeRuntime());
		try {
			const one = await stubJira(manager2, ['p1']);
			const served = await manager2.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				sort: 'resolved:desc',
			});
			assert.equal(served.fetchFailed, undefined);
			assert.equal(one[0].sort, 'resolved:desc');
		} finally {
			manager2.dispose();
		}
	});

	// Mergeability is a property of the READ, not of the page. The project window is `itemsPerPage` wide, so
	// counting the window would refuse the first page of a two-project account and then serve the second — one
	// project per page, each single-project page ordered by the tracker — publishing half the account as a
	// successful read after the other half was refused.
	test('refuses an unmergeable key for every page, not just the ones whose window holds several projects', async () => {
		await withManager(async manager => {
			const calls = await stubJira(manager, ['p1', 'p2']);

			for (const page of [1, 2]) {
				const result = await manager.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Jira,
					sort: 'resolved:desc',
					itemsPerPage: 1,
					page: page,
				});

				assert.equal(result.fetchFailed, true, `page ${page} must refuse the same key page 1 refused`);
				assert.match(result.warnings[0].message, /several projects/);
			}

			assert.equal(calls.length, 0, 'and neither page cost a request');
		});
	});

	test('orders a page that spans several projects', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubJira(manager, ['p1', 'p2'], {
				p1: [issue('p1-old', { updated: '2020-01-01T00:00:00Z' })],
				p2: [
					issue('p2-new', { updated: '2020-01-04T00:00:00Z' }),
					issue('p2-mid', { updated: '2020-01-02T00:00:00Z' }),
				],
			});

			const result = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
			});

			assert.deepEqual(
				result.items.map(i => i.title),
				['p2-new', 'p2-mid', 'p1-old'],
			);
		} finally {
			manager.dispose();
		}
	});
});

/**
 * The one rule this repo implements twice.
 *
 * `getIssueComparator` exists on both sides — here over `IssueShape` and in `@gitkraken/provider-apis` over its
 * own normalized `Issue` — because they order the same merged pages at different layers, and neither shape can
 * import the other's. Reusing the SDK's exported `compareBy` in `@gitlens/git` would delete this repo's copy, but
 * it would also make the provider-agnostic git domain (two dependencies today, neither of them a provider SDK)
 * depend on the provider SDK, and hand `@gitlens/git-github` — which knows only octokit — a transitive edge to
 * it, to save about sixteen lines.
 *
 * So the copy stays and this watches it. It runs HERE rather than beside the comparator because this is the
 * lowest package that already depends on the SDK, so the test costs no dependency the production graph doesn't
 * already carry.
 */
suite('the comparator this repo keeps a copy of', () => {
	/**
	 * Which `IssueShape` property each sort field reads, and two ordered values for it.
	 *
	 * The property name is spelled out rather than derived, because it IS the thing that has to agree: this
	 * repo's field names are its own (`commentsCount`, `thumbsUpCount`) and the SDK's are different
	 * (`commentCount`, `upvoteCount`), so the shared part is the RULE, not the shape. Each row builds both
	 * comparators over the same property, which is what makes the comparison meaningful.
	 */
	/** The `IssueShape` properties the comparator reads, and the value types they hold. */
	type OrderableKey = 'createdDate' | 'updatedDate' | 'closedDate' | 'commentsCount' | 'thumbsUpCount' | 'title';
	type OrderableValue = number | Date | string;

	const orderableFields: { field: IssueSortField; key: OrderableKey; low: OrderableValue; high: OrderableValue }[] = [
		{ field: 'created', key: 'createdDate', low: new Date('2020-01-01Z'), high: new Date('2020-06-01Z') },
		{ field: 'updated', key: 'updatedDate', low: new Date('2020-01-01Z'), high: new Date('2020-06-01Z') },
		{ field: 'closed', key: 'closedDate', low: new Date('2020-01-01Z'), high: new Date('2020-06-01Z') },
		{ field: 'comments', key: 'commentsCount', low: 1, high: 5 },
		{ field: 'reactions', key: 'thumbsUpCount', low: 1, high: 5 },
		{ field: 'title', key: 'title', low: 'a', high: 'b' },
	];

	/**
	 * An issue carrying one value on one property.
	 *
	 * `undefined` for the missing case rather than an absent key: that is the shape this repo produces, and the
	 * missing case is the half of the rule a naive sign flip gets wrong.
	 */
	function shaped(key: OrderableKey, value: OrderableValue | undefined): IssueShape {
		return { ...issue('x', {}), [key]: value };
	}

	for (const { field, key, low, high } of orderableFields) {
		for (const direction of ['asc', 'desc'] as const) {
			test(`orders ${field}:${direction} exactly as the SDK's shared rule does`, () => {
				const ours = getIssueComparator(`${field}:${direction}`);
				const theirs = compareBy<IssueShape>(item => item[key], direction);
				assert.ok(ours != null);

				// Every pairing that the rule decides differently: both present either way round, both equal, one
				// missing on each side, and both missing — which is the case that must compare EQUAL rather than
				// producing `NaN`, and the case a sign flip would move to the front when ascending.
				const pairs: [OrderableValue | undefined, OrderableValue | undefined][] = [
					[low, high],
					[high, low],
					[low, low],
					[undefined, high],
					[high, undefined],
					[undefined, undefined],
				];
				for (const [left, right] of pairs) {
					const a = shaped(key, left);
					const b = shaped(key, right);
					assert.equal(
						Math.sign(ours(a, b)),
						Math.sign(theirs(a, b)),
						`${field}:${direction} disagreed on (${String(left)}, ${String(right)})`,
					);
				}
			});
		}
	}

	// A field added to one comparator and not the other is the drift that matters most: this repo would accept a
	// merged read the SDK's own merges reject, or refuse one they honour. Comparing which keys yield a comparator
	// catches it without either side importing the other's issue shape.
	test('derives a comparator for exactly the keys the SDK does', () => {
		const fields: IssueSortField[] = [
			'created',
			'updated',
			'closed',
			'resolved',
			'comments',
			'reactions',
			'priority',
			'dueDate',
			'title',
		];

		for (const field of fields) {
			for (const direction of ['asc', 'desc'] as const) {
				const sort = `${field}:${direction}` satisfies IssueSorting;
				assert.equal(
					getIssueComparator(sort) != null,
					sdkIssueComparator(sort) != null,
					`'${sort}' is derivable on one side only`,
				);
			}
		}
	});
});
