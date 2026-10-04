import assert from 'node:assert/strict';
import { GitIssueState, JIRA_MAX_PROJECT_KEYS_PER_REQUEST } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { AuthenticationError } from '@gitlens/git/errors.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { IssueFilter } from '../providerFilters.js';
import { parseIssueTrackerPageCursor } from '../reads/cursors.js';
import { projectKey } from '../reads/hierarchy.utils.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Pins that a user-scoped tracker read searches a site's projects together instead of one search per project.
 *
 * Per project, a "my issues" page cost at least one Jira search for every project the account could see, even one
 * holding none of the user's issues, so a page wide enough to order by recency across every project grew linearly
 * with the project count (gitkraken/vscode-gitlens#5902). One JQL search names up to
 * `JIRA_MAX_PROJECT_KEYS_PER_REQUEST` projects, so the same page now costs one search per site and relationship.
 */

function jiraSession(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'atlassian.net',
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

type Site = { id: string; projects: number };

function projectsOf(site: Site) {
	return Array.from({ length: site.projects }, (_, i) => ({
		key: `${site.id}-K${i}`,
		id: `${site.id}-p${i}`,
		name: `${site.id} Project ${i}`,
		resourceId: site.id,
	}));
}

function providerIssue(projectId: string, number: string) {
	return {
		id: `id-${number}`,
		number: number,
		title: `Issue ${number}`,
		url: `https://atlassian.net/browse/${number}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: [],
		labels: [],
		project: { id: projectId, key: projectId, name: projectId, resourceId: null, namespace: null },
	};
}

type SearchCall = { projectKeys: string[]; resourceId: string; cursor?: string; assigneeLogins?: string[] };
type SearchPage = { data: unknown[]; hasMore: boolean; nextCursor: string | undefined } | undefined;

const emptyPage = (): Promise<SearchPage> => Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });

async function connectedJira(
	sites: Site[],
	search: (call: SearchCall) => Promise<SearchPage> = emptyPage,
	/** The per-project read, by the project name it is called with. */
	projectRead: (project: string) => Promise<SearchPage> = emptyPage,
) {
	const manager = createIntegrationManager(createFakeRuntime());
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();

	const searches: SearchCall[] = [];
	const states: (GitIssueState[] | undefined)[] = [];
	const projectReads: string[] = [];
	stubApi(jira, {
		getJiraResourcesForCurrentUser: () =>
			Promise.resolve(sites.map(site => ({ id: site.id, name: site.id, url: '', avatarUrl: '' }))),
		getCurrentUserForResource: (_token: unknown, resourceId: string) =>
			Promise.resolve({ id: `${resourceId}-me`, name: 'Me', username: 'me' }),
		getJiraProjectsForResource: (_token: unknown, resourceId: string) =>
			Promise.resolve({
				values: projectsOf(sites.find(site => site.id === resourceId)!),
				paging: undefined,
			}),
		getIssuesForProjectsPaged: (
			_token: unknown,
			projectKeys: string[],
			resourceId: string,
			options: { cursor?: string; assigneeLogins?: string[]; states?: GitIssueState[] },
		) => {
			states.push(options.states);
			const call = {
				projectKeys: projectKeys,
				resourceId: resourceId,
				cursor: options.cursor,
				assigneeLogins: options.assigneeLogins,
			};
			searches.push(call);
			return search(call);
		},
		getIssuesForProjectPaged: (_token: unknown, project: string) => {
			projectReads.push(project);
			return projectRead(project);
		},
	});
	return { manager: manager, searches: searches, states: states, projectReads: projectReads };
}

suite('Jira multi-project issue searches', () => {
	test('searches every project of a site at once and splits the issues back by project', async () => {
		const site = { id: 'org-1', projects: 3 };
		const { manager, searches, projectReads } = await connectedJira([site], () =>
			Promise.resolve({
				data: [
					providerIssue('org-1-p0', 'A-1'),
					providerIssue('org-1-p2', 'C-1'),
					providerIssue('org-1-p2', 'C-2'),
				],
				hasMore: false,
				nextCursor: undefined,
			}),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 20,
		});

		assert.deepEqual(
			searches.map(s => ({ keys: s.projectKeys, resourceId: s.resourceId, assignees: s.assigneeLogins })),
			[{ keys: ['org-1-K0', 'org-1-K1', 'org-1-K2'], resourceId: 'org-1', assignees: ['org-1-me'] }],
			'one search names every project by key, scoped to the account id',
		);
		assert.deepEqual(projectReads, [], 'no per-project read is issued');
		assert.deepEqual(result.items.map(i => i.id).sort(), ['A-1', 'C-1', 'C-2']);
		assert.deepEqual(
			result.items.map(i => i.projection),
			['project', 'project', 'project'],
			'a searched row carries the same projection as a per-project read',
		);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(result.hasMore, false);

		manager.dispose();
	});

	test('splits a site into searches of at most the key bound, and keeps sites apart', async () => {
		const big = { id: 'org-1', projects: JIRA_MAX_PROJECT_KEYS_PER_REQUEST + 3 };
		const small = { id: 'org-2', projects: 2 };
		const { manager, searches } = await connectedJira([big, small]);

		await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira, itemsPerPage: 100 });

		assert.deepEqual(
			searches.map(s => [s.resourceId, s.projectKeys.length, s.assigneeLogins]).sort(),
			[
				['org-1', 3, ['org-1-me']],
				['org-1', JIRA_MAX_PROJECT_KEYS_PER_REQUEST, ['org-1-me']],
				['org-2', 2, ['org-2-me']],
			].sort(),
		);

		manager.dispose();
	});

	test('reads a rejected search project by project, so one bad project fails alone', async () => {
		// One project the site no longer accepts in JQL (deleted, moved, no longer browsable) rejects the whole
		// OR'd search; read alone, only that project fails.
		const { manager, projectReads } = await connectedJira(
			[{ id: 'org-1', projects: 2 }],
			() => Promise.reject(new Error('400: The value does not exist for the field project')),
			project =>
				project === 'org-1 Project 0'
					? Promise.reject(new Error('400: The value does not exist for the field project'))
					: Promise.resolve({
							data: [providerIssue('org-1-p1', 'B-1')],
							hasMore: false,
							nextCursor: undefined,
						}),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 20,
		});

		assert.deepEqual(projectReads.sort(), ['org-1 Project 0', 'org-1 Project 1']);
		assert.deepEqual(
			result.items.map(i => i.id),
			['B-1'],
			'the sibling still serves its issues',
		);
		assert.equal(result.items[0]?.projection, 'project');
		assert.equal(result.fetchFailed, true);
		assert.equal(result.hasMore, false, 'a retry is never advertised as forward progress');
		const [failed, served] = projectsOf({ id: 'org-1', projects: 2 }).map(projectKey);
		const cursor = parseIssueTrackerPageCursor(result.cursor);
		assert.deepEqual(cursor?.retryProjects, [failed], 'only the failed project is carried for a retry');
		assert.deepEqual(cursor?.completedProjects, [served]);

		manager.dispose();
	});

	test('fails every project of a search at once on a rejected token, without reading them one by one', async () => {
		const { manager, projectReads } = await connectedJira([{ id: 'org-1', projects: 2 }], () =>
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

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 20,
		});

		assert.deepEqual(projectReads, [], 'each project would be refused the same way');
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'auth');
		assert.deepEqual(
			parseIssueTrackerPageCursor(result.cursor)?.retryProjects?.length,
			2,
			'both projects are retryable',
		);

		manager.dispose();
	});

	test('reads an incomplete search project by project instead of marking its projects truncated', async () => {
		let page = 0;
		const { manager, searches, projectReads } = await connectedJira(
			[{ id: 'org-1', projects: 2 }],
			call => {
				page++;
				// Page 2 fails after page 1 served only project 0: project 1 has no issue in the prefix, so nothing
				// about the search says whether its read is complete.
				return call.cursor == null
					? Promise.resolve({ data: [providerIssue('org-1-p0', 'A-1')], hasMore: true, nextCursor: 'c1' })
					: Promise.reject(new Error('socket hang up'));
			},
			project =>
				Promise.resolve({
					data: [providerIssue(project === 'org-1 Project 0' ? 'org-1-p0' : 'org-1-p1', `${project}-1`)],
					hasMore: false,
					nextCursor: undefined,
				}),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 20,
		});

		assert.equal(page, 2);
		assert.equal(searches.length, 2);
		assert.deepEqual(projectReads.sort(), ['org-1 Project 0', 'org-1 Project 1']);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['org-1 Project 0-1', 'org-1 Project 1-1']);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(result.page.truncated, undefined);

		manager.dispose();
	});

	test('reads a search that reaches its backstop project by project', async () => {
		let page = 0;
		const { manager, searches, projectReads } = await connectedJira([{ id: 'org-1', projects: 2 }], () => {
			page++;
			return Promise.resolve({ data: [], hasMore: true, nextCursor: `c${page}` });
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 20,
		});

		// A single project's page budget, not one per project spent on one sequential cursor chain.
		assert.equal(searches.length, 10);
		assert.deepEqual(projectReads.sort(), ['org-1 Project 0', 'org-1 Project 1']);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('reads a search project by project when an issue matches no requested project', async () => {
		const { manager, projectReads } = await connectedJira([{ id: 'org-1', projects: 2 }], () =>
			Promise.resolve({ data: [providerIssue('elsewhere', 'X-1')], hasMore: false, nextCursor: undefined }),
		);

		await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira, itemsPerPage: 20 });

		assert.deepEqual(projectReads.sort(), ['org-1 Project 0', 'org-1 Project 1']);

		manager.dispose();
	});

	test('reads a project gone since discovery as empty, once the search it broke is read project by project', async () => {
		// Jira rejects the whole OR'd JQL for one project it no longer has (#5907); read alone, that project is empty.
		const missing = () =>
			Promise.reject(
				Object.assign(new Error('(400)'), {
					response: {
						status: 400,
						body: { errorMessages: ["The value 'org-1-K0' does not exist for the field 'project'."] },
					},
				}),
			);
		const { manager, projectReads } = await connectedJira([{ id: 'org-1', projects: 2 }], missing, project =>
			project === 'org-1 Project 0'
				? missing()
				: Promise.resolve({ data: [providerIssue('org-1-p1', 'B-1')], hasMore: false, nextCursor: undefined }),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 20,
		});

		assert.deepEqual(projectReads.sort(), ['org-1 Project 0', 'org-1 Project 1']);
		assert.deepEqual(
			result.items.map(i => i.id),
			['B-1'],
		);
		assert.equal(result.fetchFailed, undefined, 'a project that no longer exists holds no issues');

		manager.dispose();
	});

	test('dedupes an issue two relationships both match', async () => {
		const { manager, searches } = await connectedJira([{ id: 'org-1', projects: 2 }], () =>
			Promise.resolve({ data: [providerIssue('org-1-p1', 'B-1')], hasMore: false, nextCursor: undefined }),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			filters: [IssueFilter.Assignee, IssueFilter.Author],
			itemsPerPage: 20,
		});

		assert.equal(searches.length, 2, 'one search per relationship, not per project');
		assert.deepEqual(
			result.items.map(i => i.id),
			['B-1'],
		);

		manager.dispose();
	});

	test('keeps reading every assignee project by project', async () => {
		const { manager, searches, projectReads } = await connectedJira([{ id: 'org-1', projects: 2 }]);

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		// An unscoped drain reports its backstop as `narrow-scope` per project, which one search cannot attribute.
		assert.deepEqual(searches, []);
		assert.deepEqual(projectReads.sort(), ['org-1 Project 0', 'org-1 Project 1']);

		manager.dispose();
	});

	test('sends the requested state to the search', async () => {
		const { manager, searches, states } = await connectedJira([{ id: 'org-1', projects: 2 }]);

		for (const state of [undefined, 'open', 'closed', 'all'] as const) {
			await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				state: state,
				itemsPerPage: 20,
			});
		}

		assert.equal(searches.length, 4, 'one search per read');
		assert.deepEqual(states, [
			undefined,
			[GitIssueState.Open],
			[GitIssueState.Closed],
			[GitIssueState.Open, GitIssueState.Closed],
		]);

		manager.dispose();
	});
});
