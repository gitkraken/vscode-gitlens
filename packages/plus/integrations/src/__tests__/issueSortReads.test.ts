import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { IssueFilter } from '../providerFilters.js';
import type { IntegrationManager } from './issueSortHelpers.js';
import { issue, primarySession, stubAccountWideRead, stubRepoScopedRead, withManager } from './issueSortHelpers.js';

/**
 * How the issue reads BEHAVE once a sort is asked for: which table each validates against, what it refuses, what
 * it forwards to the provider, and how it orders a page it merged itself.
 *
 * The declarations those refusals are made from live in `issueSortCapabilities.test.ts`. Kept apart because the
 * interesting cases here are the ones where the four reads DIFFER, and reading them beside two table comparisons
 * buried that.
 */

suite('issue read ordering', () => {
	suite('refusals', () => {
		// All-or-nothing, like every filter: at a bounded result window another order is another subset, and the
		// paging that comes with it describes that other subset. Nothing is requested, so nothing is half-read.
		test('a key the repo-scoped read cannot express refuses it, with no upstream request', async () => {
			await withManager(async manager => {
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
			});
		});

		test('the account-wide read validates against its OWN table, not the repo-scoped one', async () => {
			await withManager(async manager => {
				const calls = await stubAccountWideRead(manager, GitCloudHostIntegrationId.GitLab);

				// GitLab's repo-scoped GraphQL read orders by title; its account-wide REST read does not.
				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					sort: 'title:asc',
				});

				assert.equal(result.fetchFailed, true);
				assert.equal(calls.length, 0);
			});
		});

		// The provider orders by `priority` perfectly well within one repository. What can't be done is MERGING two
		// such pages, because no normalized issue carries priority to merge on. So the refusal is about the read,
		// not the provider — and it must not fire for the single-scope case, which is the next test.
		test('a key no normalized issue carries refuses a MULTI-scope page', async () => {
			await withManager(async manager => {
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
			});
		});

		// Repository IDS, not descriptors: `getMyIssuesForReposResult` skips its per-repository fan-out for that form
		// (the branch is guarded on `!isRepoIdsInput`) and calls the SDK's `getIssuesForRepos`, which for GitLab is the
		// multi-project aggregate — it merges in the SDK and refuses `priority` however few scopes it was given. So
		// ONE id has to be refused here too, or the facade promises a key the SDK then rejects.
		test('a single repository ID is still a merge, because the id form takes the SDK aggregate', async () => {
			await withManager(async manager => {
				const calls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitLab);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					repos: [123],
					sort: 'priority:desc',
				});

				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /several repositories/);
				assert.equal(calls.length, 0);
			});
		});

		test('the same key is served for a single scope, where the provider does the ordering', async () => {
			await withManager(async manager => {
				const calls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitLab);

				const result = await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitLab,
					repos: [{ namespace: 'o', name: 'a' }],
					sort: 'priority:desc',
				});

				assert.equal(result.fetchFailed, undefined);
				assert.equal(calls.length, 1);
				assert.equal(calls[0].sort, 'priority:desc');
			});
		});

		// The count exists to preview the constraints the read will apply. One that accepted a key the read refuses
		// would promise a fetch that can't happen, which is worse than no preview.
		test('countIssues refuses a key exactly as the search it previews would', async () => {
			await withManager(async manager => {
				const result = await manager.countIssues({
					providerId: GitCloudHostIntegrationId.GitHub,
					scopes: [{ key: 'k', repos: [{ namespace: 'o', name: 'a' }], criteria: { sort: 'priority:desc' } }],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /sort:priority:desc/);
			});
		});
	});

	suite('what reaches the provider', () => {
		// Omitting it would delegate the order to each provider's own default — Azure by created date, Linear by
		// created date, Jira by nothing at all — which is the cross-provider incoherence this layer exists to
		// remove. So the default is EXPLICIT on the wire, not merely documented.
		test('an omitted sort still sends the default to the provider', async () => {
			await withManager(async manager => {
				const repoCalls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitHub);
				const accountCalls = await stubAccountWideRead(manager, GitCloudHostIntegrationId.GitHub);

				await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
				});
				await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub });

				assert.equal(repoCalls[0].sort, 'updated:desc');
				assert.equal(accountCalls[0].sort, 'updated:desc');
			});
		});

		test('a requested key is forwarded verbatim, with no translation on this side', async () => {
			await withManager(async manager => {
				const calls = await stubRepoScopedRead(manager, GitCloudHostIntegrationId.GitHub);

				await manager.listIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					sort: 'comments:asc',
				});

				assert.equal(calls[0].sort, 'comments:asc');
			});
		});
	});

	suite('the merged page', () => {
		// Each query arrived ordered by the provider; their union did not, and the union is what this read
		// publishes. Interleaved dates across two repositories are what make the difference observable.
		test('orders a multi-scope page rather than concatenating per-scope runs', async () => {
			await withManager(async manager => {
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
			});
		});

		test('orders an account-wide page, which is always a union of several queries', async () => {
			await withManager(async manager => {
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
			});
		});

		// A single scope arrived ordered by the provider already. Re-sorting it could only reproduce that order —
		// and would quietly paper over a provider that ignored the sort, which is worth NOT hiding.
		test('leaves a single-scope page in the order the provider returned', async () => {
			await withManager(async manager => {
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
			});
		});
	});

	suite('the result ceiling', () => {
		// "N matched, showing the first 1.000" is only true of a particular order — which 1.000 are reachable
		// depends on it — so the sentence has to name the key, and the omission has to carry it for a consumer
		// wording its own.
		test('the cap warning names the order the reachable window was selected under', async () => {
			await withManager(async manager => {
				const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
				assert.ok(gh != null);
				(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

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
			});
		});
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
		manager: IntegrationManager,
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
		await withManager(async manager => {
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
		});
	});

	test('forwards the requested key to each project read, defaulting when none was asked for', async () => {
		await withManager(async manager => {
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
		});
	});

	// Jira orders by `resolutiondate` within one project perfectly well. Two projects are concatenated here, and no
	// normalized issue carries a resolution date to merge on — so the multi-project page refuses and the
	// single-project one serves. Same key, same provider, different read.
	test('refuses an unmergeable key across projects and serves it for one', async () => {
		await withManager(async manager => {
			const many = await stubJira(manager, ['p1', 'p2']);
			const refused = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				sort: 'resolved:desc',
			});
			assert.equal(refused.fetchFailed, true);
			assert.match(refused.warnings[0].message, /several projects/);
			assert.equal(many.length, 0);
		});

		await withManager(async manager => {
			const one = await stubJira(manager, ['p1']);
			const served = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				sort: 'resolved:desc',
			});
			assert.equal(served.fetchFailed, undefined);
			assert.equal(one[0].sort, 'resolved:desc');
		});
	});

	// Projects are not the only thing a tracker read merges. Asking for several relationships makes Jira run one
	// JQL drain per filter and fold them into one map in filter order, INSIDE a single project — so a one-project
	// page of two filters is as concatenated as a two-project one, and counting only projects published those runs
	// under the requested key while `merged` said the provider had ordered them.
	test('orders a single-project page that fans out over several filters', async () => {
		await withManager(async manager => {
			await stubJira(manager, ['p1'], {
				// The stub stands in for the per-filter concatenation: an author run followed by an assignee run,
				// each ordered on its own, the pair not.
				p1: [
					issue('authored-old', { updated: '2020-01-01T00:00:00Z' }),
					issue('assigned-new', { updated: '2020-01-04T00:00:00Z' }),
					issue('assigned-mid', { updated: '2020-01-02T00:00:00Z' }),
				],
			});

			const result = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				filters: [IssueFilter.Author, IssueFilter.Assignee],
			});

			assert.deepEqual(
				result.items.map(i => i.title),
				['assigned-new', 'assigned-mid', 'authored-old'],
			);
		});
	});

	// And the same fan-out refuses a key the merge cannot honor, naming what actually merged: telling a caller to
	// read one project at a time would be useless advice for a read that is already scoped to one.
	test('refuses an unmergeable key for a one-project read that fans out over several filters', async () => {
		await withManager(async manager => {
			const calls = await stubJira(manager, ['p1']);

			const result = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				filters: [IssueFilter.Author, IssueFilter.Assignee],
				sort: 'resolved:desc',
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /several issue relationships/);
			assert.equal(calls.length, 0, 'and it cost no request');
		});
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
		await withManager(async manager => {
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
		});
	});
});
