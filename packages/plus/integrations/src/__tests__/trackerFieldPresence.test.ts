import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueProjection, IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import type { FieldPresence, IssueFieldGroup } from '../fieldPresence.js';
import { getIssueFieldPresence } from '../fieldPresence.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { IssueFilter } from '../providerFilters.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { assertIssuePresence } from './fieldPresenceHelpers.js';

/**
 * Field presence must never call a group `fetched` that a row doesn't actually carry. So every issue read of the four
 * trackers (Jira Cloud, Jira Data Center, Linear, Trello) runs for real, through the integration, GitLens' own
 * conversions and provider-apis' own normalizers, against a server that answers each request with a fully populated
 * issue (and, for Linear's GraphQL, only the fields the query selected). A `fetched` group that comes back undefined
 * or empty is then a table claiming more than the read delivers; and each known placeholder is pinned to the value
 * the row really carries, so a placeholder that starts carrying real data shows up here too.
 */

type Presence = Readonly<Record<IssueFieldGroup, FieldPresence>>;
type Json = Record<string, unknown>;

/** Every issue tag a tracker may produce; a tracker has no `search` or `repos` read. */
const allIssueProjections: readonly IssueProjection[] = ['point', 'search', 'account', 'repos', 'project', 'batch'];

const exercised = new Map<string, Set<IssueProjection>>();

function check(row: IssueShape | undefined, providerId: string, projection: IssueProjection, label: string): Presence {
	const presence = assertIssuePresence(row, projection, `${label} (${projection})`);

	let projections = exercised.get(providerId);
	if (projections == null) {
		projections = new Set();
		exercised.set(providerId, projections);
	}
	projections.add(projection);
	return presence;
}

function checkAll(
	rows: readonly (IssueShape | undefined)[],
	providerId: string,
	projection: IssueProjection,
	label: string,
): Presence {
	assert.ok(rows.length > 0, `${label} (${projection}): rows came back`);

	let presence: Presence | undefined;
	for (const row of rows) {
		presence = check(row, providerId, projection, label);
	}
	return presence!;
}

function jsonResponse(body: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

function notFound(url: URL): Response {
	return jsonResponse({ message: `unexpected ${url.pathname}` }, 404);
}

function createRuntime(): FakeRuntime {
	const runtime = createFakeRuntime();
	// The host cache would answer a repeated point read without reaching the tracker.
	runtime.cache.getIssueOrPullRequest = (_id, _type, _resource, _integration, loader) => loader({} as never).value;
	return runtime;
}

function session(
	domain: string,
	options?: { type?: ProviderAuthenticationSession['type']; appKey?: string },
): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'primary', label: 'primary' },
		scopes: [],
		cloud: true,
		type: options?.type ?? 'oauth',
		domain: domain,
		...(options?.appKey != null ? { appKey: options.appKey } : {}),
	};
}

function connect(integration: unknown, connection: ProviderAuthenticationSession): void {
	(integration as { _session: ProviderAuthenticationSession })._session = connection;
}

const createdAt = '2026-01-01T00:00:00.000+0000';
const updatedAt = '2026-01-02T00:00:00.000+0000';

/** The votes a Jira issue and a Trello card carry, which a tracker doesn't surface as reactions. */
const votes = 4;

suite('Jira Cloud field presence', () => {
	const site = 'site-1';
	const siteUrl = 'https://example.atlassian.net';
	const resource = { id: site, key: site, name: 'Site', url: siteUrl, avatarUrl: '' };
	const project = { key: 'p1', id: 'p1', name: 'Project', resourceId: site, resourceName: 'Site' };

	const user = {
		accountId: 'acct-1',
		displayName: 'Jira User',
		emailAddress: 'jira@example.com',
		avatarUrls: { '48x48': 'https://avatars.example/jira' },
	};
	/** More comments than the `comments` array embeds, which Jira caps: the total is what the batch read reports. */
	const embeddedComments = 2;
	const commentTotal = 7;

	function issue(): Json {
		return {
			id: '10001',
			key: 'PRJ-1',
			self: `https://api.atlassian.com/ex/jira/${site}/rest/api/2/issue/10001`,
			fields: {
				assignee: user,
				comment: {
					total: commentTotal,
					comments: Array.from({ length: embeddedComments }, (_, i) => ({ id: i })),
				},
				components: [],
				created: createdAt,
				creator: user,
				description: 'h2. Details',
				fixVersions: [],
				issuetype: { name: 'Task' },
				labels: ['bug'],
				project: { id: '10000', key: 'PRJ', name: 'Project' },
				status: {
					id: '1',
					name: 'To Do',
					statusCategory: { colorName: 'blue-gray', key: 'new', name: 'To Do' },
				},
				summary: 'Issue',
				updated: updatedAt,
				votes: { votes: votes },
			},
		};
	}

	function serve(runtime: FakeRuntime): URL[] {
		const requests: URL[] = [];
		runtime.http.fetch = input => {
			const url = new URL(input.toString());
			requests.push(url);

			// provider-apis joins the gateway's trailing slash to the path, which doubles it.
			const path = url.pathname.replace(`/ex/jira/${site}`, '').replace(/^\/\//, '/');
			switch (path) {
				case '/oauth/token/accessible-resources':
					return Promise.resolve(
						jsonResponse([
							{ id: site, name: 'Site', url: siteUrl, avatarUrl: 'https://avatars.example/site' },
						]),
					);
				case '/rest/api/2/myself':
					return Promise.resolve(jsonResponse(user));
				case '/rest/api/2/field':
					return Promise.resolve(jsonResponse([{ id: 'summary', name: 'Summary' }]));
				case '/rest/api/2/project/search': {
					const startAt = Number(url.searchParams.get('startAt') ?? 0);
					return Promise.resolve(
						jsonResponse({
							startAt: startAt,
							values: startAt > 0 ? [] : [{ id: '10000', key: 'PRJ', name: 'Project' }],
						}),
					);
				}
				case '/rest/api/2/issue/PRJ-1':
					return Promise.resolve(jsonResponse(issue()));
				case '/rest/api/2/search/jql':
					return Promise.resolve(jsonResponse({ issues: [issue()] }));
				default:
					return Promise.resolve(notFound(url));
			}
		};
		return requests;
	}

	async function connected() {
		const runtime = createRuntime();
		const requests = serve(runtime);
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		connect(jira, session('atlassian.net'));
		return { manager: manager, jira: jira, requests: requests };
	}

	function jqls(requests: readonly URL[]): string[] {
		return requests.filter(r => r.pathname.endsWith('/search/jql')).map(r => r.searchParams.get('jql') ?? '');
	}

	/** What Jira Cloud's reads can't supply, whichever read supplied the row. */
	function assertPlaceholders(
		row: IssueShape | undefined,
		presence: Presence,
		label: string,
		comments: { count: number; presence: FieldPresence },
	): void {
		assert.ok(row != null, label);
		assert.equal(row.thumbsUpCount, votes, `${label}: the votes ride in thumbsUpCount`);
		assert.equal(presence.reactions, 'unavailable', `${label}: votes are not reactions`);
		assert.equal(row.repository, undefined, `${label}: a tracker issue has no repository`);
		assert.equal(presence.access, 'unavailable', `${label}: the viewer's access is unavailable`);
		assert.equal(row.commentsCount, comments.count, `${label}: the comment count`);
		assert.equal(presence.comments, comments.presence, `${label}: comments`);
	}

	/** provider-apis counts the comments embedded in the issue, which Jira may cap, rather than reading the total. */
	const providerApisComments = { count: embeddedComments, presence: 'not-requested' } as const;

	test('the point reads', async () => {
		const { manager, jira } = await connected();

		const read = await jira.getIssue(resource, 'PRJ-1');
		const readPresence = check(read, jira.id, 'point', 'getIssue');
		assertPlaceholders(read, readPresence, 'getIssue', providerApisComments);

		const linked = (await jira.getLinkedIssueOrPullRequest(resource, { id: 'PRJ-1', key: 'PRJ-1' })) as
			| IssueShape
			| undefined;
		const linkedPresence = check(linked, jira.id, 'point', 'getLinkedIssueOrPullRequest');
		assertPlaceholders(linked, linkedPresence, 'getLinkedIssueOrPullRequest', providerApisComments);

		manager.dispose();
	});

	test('the project reads, through the facade and directly, scoped to a user and not', async () => {
		const { manager, jira, requests } = await connected();

		const assigned = await manager.listIssueTrackerIssuesPage({ providerId: jira.id });
		assert.equal(assigned.fetchFailed, undefined);
		assert.deepEqual(assigned.warnings, []);
		const presence = checkAll(assigned.items, jira.id, 'project', 'listIssueTrackerIssuesPage');
		assertPlaceholders(assigned.items[0], presence, 'listIssueTrackerIssuesPage', providerApisComments);
		assert.ok(
			jqls(requests).some(jql => jql.includes('assignee in ("acct-1")')),
			'a resolved user scopes the default read to the assignee',
		);

		// The relationship filters map through their own per-filter drain, one JQL query each.
		requests.length = 0;
		const filtered = await manager.listIssueTrackerIssuesPage({
			providerId: jira.id,
			filters: [IssueFilter.Author, IssueFilter.Mention],
		});
		assert.equal(filtered.fetchFailed, undefined);
		checkAll(filtered.items, jira.id, 'project', 'listIssueTrackerIssuesPage (filtered)');
		assert.ok(jqls(requests).some(jql => jql.includes('creator in ("acct-1")')));
		assert.ok(jqls(requests).some(jql => jql.includes('comment ~ "Jira User"')));

		requests.length = 0;
		const unscoped = await manager.listIssueTrackerIssuesPage({ providerId: jira.id, includeAllAssignees: true });
		assert.equal(unscoped.fetchFailed, undefined);
		checkAll(unscoped.items, jira.id, 'project', 'listIssueTrackerIssuesPage (unscoped)');
		assert.ok(
			jqls(requests).every(jql => !/assignee in|creator in|comment ~/.test(jql)),
			'the unscoped read carries no user clause',
		);

		const direct = await jira.getIssuesForProject(project, { user: 'Jira User' });
		checkAll(direct ?? [], jira.id, 'project', 'getIssuesForProject');

		manager.dispose();
	});

	test('the account-wide read', async () => {
		const { manager, jira } = await connected();

		const rows = await jira.searchMyIssues();
		const presence = checkAll(rows ?? [], jira.id, 'account', 'searchMyIssues');
		assertPlaceholders(rows![0], presence, 'searchMyIssues', providerApisComments);

		manager.dispose();
	});

	test('the batch read reads the comment total, not the embedded comments', async () => {
		const { manager, jira } = await connected();

		const result = await manager.getIssuesBatch({
			providerId: jira.id,
			targets: [{ key: 'PRJ-1', resourceId: site, resourceUrl: siteUrl, identifier: 'PRJ-1' }],
		});
		assert.equal(result.fetchFailed, undefined);

		const row = result.items[0]?.issue;
		const presence = check(row, jira.id, 'batch', 'getIssuesBatch');
		assertPlaceholders(row, presence, 'getIssuesBatch', { count: commentTotal, presence: 'fetched' });
		assert.ok(commentTotal > embeddedComments, 'the fixture tells the total from the embedded comments');

		manager.dispose();
	});
});

suite('Jira Data Center field presence', () => {
	const domain = 'jira.example.com';
	const baseUrl = `https://${domain}`;
	const resource = { id: domain, key: domain, name: domain, url: baseUrl };
	const project = { key: 'Project', id: '10000', name: 'Project', resourceId: domain, resourceName: domain };

	const user = {
		key: 'jirauser',
		name: 'jirauser',
		displayName: 'Jira User',
		emailAddress: 'jira@example.com',
		avatarUrls: { '48x48': 'https://avatars.example/jira' },
	};
	const embeddedComments = 2;

	function issue(): Json {
		return {
			id: '10001',
			key: 'PRJ-1',
			self: `${baseUrl}/rest/api/2/issue/10001`,
			fields: {
				assignee: user,
				comment: { total: 7, comments: Array.from({ length: embeddedComments }, (_, i) => ({ id: i })) },
				components: [],
				created: createdAt,
				creator: user,
				description: 'h2. Details',
				fixVersions: [],
				issuetype: { name: 'Task' },
				labels: ['bug'],
				project: { id: '10000', key: 'PRJ', name: 'Project' },
				status: {
					id: '1',
					name: 'To Do',
					statusCategory: { colorName: 'blue-gray', key: 'new', name: 'To Do' },
				},
				summary: 'Issue',
				updated: updatedAt,
				votes: { votes: votes },
			},
		};
	}

	function serve(runtime: FakeRuntime): URL[] {
		const requests: URL[] = [];
		runtime.http.fetch = input => {
			const url = new URL(input.toString());
			requests.push(url);
			assert.equal(url.origin, baseUrl, 'every request is addressed to the instance');

			switch (url.pathname) {
				case '/rest/api/2/myself':
					return Promise.resolve(jsonResponse(user));
				case '/rest/api/2/field':
					return Promise.resolve(jsonResponse([{ id: 'summary', name: 'Summary' }]));
				case '/rest/api/2/project':
					return Promise.resolve(jsonResponse([{ id: '10000', name: 'Project' }]));
				case '/rest/api/2/issue/PRJ-1':
					return Promise.resolve(jsonResponse(issue()));
				case '/rest/api/2/search':
					return Promise.resolve(jsonResponse({ startAt: 0, maxResults: 100, total: 1, issues: [issue()] }));
				default:
					return Promise.resolve(notFound(url));
			}
		};
		return requests;
	}

	async function connected() {
		const runtime = createRuntime();
		const requests = serve(runtime);
		const manager = createIntegrationManager(runtime);
		const jira = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, domain))!;
		connect(jira, session(domain, { type: 'pat' }));
		return { manager: manager, jira: jira, requests: requests };
	}

	function jqls(requests: readonly URL[]): string[] {
		return requests.filter(r => r.pathname.endsWith('/search')).map(r => r.searchParams.get('jql') ?? '');
	}

	/** What Jira Data Center's reads can't supply, whichever read supplied the row. */
	function assertPlaceholders(row: IssueShape | undefined, presence: Presence, label: string): void {
		assert.ok(row != null, label);
		assert.equal(row.thumbsUpCount, votes, `${label}: the votes ride in thumbsUpCount`);
		assert.equal(presence.reactions, 'unavailable', `${label}: votes are not reactions`);
		assert.equal(row.repository, undefined, `${label}: a tracker issue has no repository`);
		assert.equal(presence.access, 'unavailable', `${label}: the viewer's access is unavailable`);
		// Every read counts the comments embedded in the issue, which Jira may cap, rather than reading the total.
		assert.equal(row.commentsCount, embeddedComments, `${label}: the embedded comment count`);
		assert.equal(presence.comments, 'not-requested', `${label}: comments`);
	}

	test('the point reads', async () => {
		const { manager, jira } = await connected();

		const read = await jira.getIssue(resource, 'PRJ-1');
		assertPlaceholders(read, check(read, jira.id, 'point', 'getIssue'), 'getIssue');

		const linked = (await jira.getLinkedIssueOrPullRequest(resource, { id: 'PRJ-1', key: 'PRJ-1' })) as
			| IssueShape
			| undefined;
		assertPlaceholders(
			linked,
			check(linked, jira.id, 'point', 'getLinkedIssueOrPullRequest'),
			'getLinkedIssueOrPullRequest',
		);

		manager.dispose();
	});

	test('the project reads, through the facade and directly, scoped to a user and not', async () => {
		const { manager, jira, requests } = await connected();

		const assigned = await manager.listIssueTrackerIssuesPage({ providerId: jira.id, domain: domain });
		assert.equal(assigned.fetchFailed, undefined);
		assert.deepEqual(assigned.warnings, []);
		const presence = checkAll(assigned.items, jira.id, 'project', 'listIssueTrackerIssuesPage');
		assertPlaceholders(assigned.items[0], presence, 'listIssueTrackerIssuesPage');
		assert.ok(
			jqls(requests).some(jql => jql.includes('assignee in ("jirauser")')),
			'a resolved user scopes the default read to the assignee',
		);

		requests.length = 0;
		const filtered = await manager.listIssueTrackerIssuesPage({
			providerId: jira.id,
			domain: domain,
			filters: [IssueFilter.Author, IssueFilter.Mention],
		});
		assert.equal(filtered.fetchFailed, undefined);
		checkAll(filtered.items, jira.id, 'project', 'listIssueTrackerIssuesPage (filtered)');
		assert.ok(jqls(requests).some(jql => jql.includes('creator in ("jirauser")')));
		assert.ok(jqls(requests).some(jql => jql.includes('comment ~ "jirauser"')));

		requests.length = 0;
		const unscoped = await manager.listIssueTrackerIssuesPage({
			providerId: jira.id,
			domain: domain,
			includeAllAssignees: true,
		});
		assert.equal(unscoped.fetchFailed, undefined);
		checkAll(unscoped.items, jira.id, 'project', 'listIssueTrackerIssuesPage (unscoped)');
		assert.ok(
			jqls(requests).every(jql => !/assignee in|creator in|comment ~/.test(jql)),
			'the unscoped read carries no user clause',
		);

		const direct = await jira.getIssuesForProject(project, { user: 'jirauser' });
		checkAll(direct ?? [], jira.id, 'project', 'getIssuesForProject');

		manager.dispose();
	});

	test('the account-wide read', async () => {
		const { manager, jira } = await connected();

		const rows = await jira.searchMyIssues();
		const presence = checkAll(rows ?? [], jira.id, 'account', 'searchMyIssues');
		assertPlaceholders(rows![0], presence, 'searchMyIssues');

		manager.dispose();
	});

	test('the batch read is provider-apis point read, so it still counts only the embedded comments', async () => {
		const { manager, jira } = await connected();

		const result = await manager.getIssuesBatch({
			providerId: jira.id,
			domain: domain,
			targets: [{ key: 'PRJ-1', resourceId: domain, identifier: 'PRJ-1' }],
		});
		assert.equal(result.fetchFailed, undefined);

		const row = result.items[0]?.issue;
		assertPlaceholders(row, check(row, jira.id, 'batch', 'getIssuesBatch'), 'getIssuesBatch');

		manager.dispose();
	});
});

suite('Linear field presence', () => {
	const resource = { id: 'org-1', key: 'acme', name: 'Acme' };
	const viewer = { id: 'viewer-1', name: 'Viewer One', email: 'viewer@example.com', displayName: 'viewer' };
	const member = { id: viewer.id, name: viewer.name, avatarUrl: 'https://avatars.example/viewer' };

	/** Every field of a Linear issue the SDK may select, including the ones it doesn't (labels and comments). */
	function node(): Json {
		return {
			id: 'lin-1',
			identifier: 'ENG-1',
			title: 'Issue',
			url: 'https://linear.app/acme/issue/ENG-1/issue',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
			archivedAt: null,
			description: 'Details',
			creator: member,
			assignee: member,
			project: null,
			team: { id: 'team-1', name: 'Team', key: 'ENG', icon: null },
			state: { id: 'state-1', name: 'In Progress', color: '#000', type: 'started' },
			projectMilestone: null,
			labels: { nodes: [{ id: 'label-1', name: 'bug' }] },
			comments: { nodes: [{ id: 'comment-1' }] },
		};
	}

	/**
	 * Whether `query` selects `field` as one of its own fields: on a line of its own, as the SDK formats a selection,
	 * which a mention inside a filter (`comments: { some: … }`) is not.
	 */
	function selects(query: string, field: string): boolean {
		return new RegExp(`(^|\\n)\\s*${field}\\s*(\\{|\\n)`).test(query);
	}

	function select(query: string): Json {
		return Object.fromEntries(Object.entries(node()).filter(([field]) => selects(query, field)));
	}

	function serve(runtime: FakeRuntime): string[] {
		const issueQueries: string[] = [];
		runtime.http.fetch = (input, init) => {
			const url = new URL(input.toString());
			if (url.pathname !== '/graphql') return Promise.resolve(notFound(url));

			const { query, variables } = JSON.parse(init!.body as string) as {
				query: string;
				variables?: { identifier?: string };
			};
			let data: unknown;
			if (query.includes('query GetViewer')) {
				data = { viewer: viewer };
			} else if (query.includes('query GetOrganization')) {
				data = { organization: { id: 'org-1', name: 'Acme', urlKey: 'acme' } };
			} else if (query.includes('query GetTeams')) {
				data = { teams: { nodes: [{ id: 'team-1', name: 'Team', key: 'ENG', icon: null }] } };
			} else if (query.includes('query GetIssue(')) {
				issueQueries.push(query);
				data = { issue: variables?.identifier === 'ENG-1' ? select(query) : null };
			} else if (query.includes('query GetIssues(') || query.includes('query GetMyIssues(')) {
				issueQueries.push(query);
				data = { issues: { nodes: [select(query)], pageInfo: { hasNextPage: false, endCursor: null } } };
			} else {
				throw new Error(`unexpected Linear query: ${query}`);
			}
			return Promise.resolve(jsonResponse({ data: data }));
		};
		return issueQueries;
	}

	async function connected() {
		const runtime = createRuntime();
		const issueQueries = serve(runtime);
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		connect(linear, session('linear.app'));
		return { manager: manager, linear: linear, issueQueries: issueQueries };
	}

	/** Linear's fragment selects neither labels, comments nor reactions; provider-apis fills an empty label list. */
	function assertPlaceholders(row: IssueShape | undefined, presence: Presence, label: string): void {
		assert.ok(row != null, label);
		assert.deepEqual(row.labels, [], `${label}: provider-apis fills an empty list`);
		assert.equal(presence.labels, 'not-requested', `${label}: labels`);
		assert.equal(row.commentsCount, undefined, `${label}: no comment count`);
		assert.equal(presence.comments, 'not-requested', `${label}: comments`);
		assert.equal(row.thumbsUpCount, undefined, `${label}: no upvote count`);
		assert.equal(presence.reactions, 'not-requested', `${label}: reactions`);
		assert.equal(row.repository, undefined, `${label}: a tracker issue has no repository`);
		assert.equal(presence.access, 'unavailable', `${label}: the viewer's access is unavailable`);
	}

	function assertNoLabelsOrCommentsSelected(issueQueries: readonly string[]): void {
		assert.ok(issueQueries.length > 0, 'the issue queries were seen');
		for (const query of issueQueries) {
			assert.ok(
				!selects(query, 'labels') && !selects(query, 'comments'),
				'the query selects no labels or comments',
			);
		}
	}

	test('the point reads', async () => {
		const { manager, linear, issueQueries } = await connected();

		const read = await linear.getIssue(resource, 'ENG-1');
		assertPlaceholders(read, check(read, linear.id, 'point', 'getIssue'), 'getIssue');

		const linked = (await linear.getLinkedIssueOrPullRequest(resource, { id: 'ENG-1', key: 'ENG-1' })) as
			| IssueShape
			| undefined;
		assertPlaceholders(
			linked,
			check(linked, linear.id, 'point', 'getLinkedIssueOrPullRequest'),
			'getLinkedIssueOrPullRequest',
		);
		assertNoLabelsOrCommentsSelected(issueQueries);

		manager.dispose();
	});

	test('the project reads, through the facade and directly', async () => {
		const { manager, linear, issueQueries } = await connected();

		const result = await manager.listIssueTrackerIssuesPage({ providerId: linear.id });
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);
		const presence = checkAll(result.items, linear.id, 'project', 'listIssueTrackerIssuesPage');
		assertPlaceholders(result.items[0], presence, 'listIssueTrackerIssuesPage');

		const direct = await linear.getIssuesForProject({ id: 'team-1', key: 'ENG', name: 'Team' }, { user: 'viewer' });
		checkAll(direct ?? [], linear.id, 'project', 'getIssuesForProject');
		assertNoLabelsOrCommentsSelected(issueQueries);

		manager.dispose();
	});

	test('the account-wide read', async () => {
		const { manager, linear, issueQueries } = await connected();

		const rows = await linear.searchMyIssues();
		const presence = checkAll(rows ?? [], linear.id, 'account', 'searchMyIssues');
		assertPlaceholders(rows![0], presence, 'searchMyIssues');
		assertNoLabelsOrCommentsSelected(issueQueries);

		manager.dispose();
	});

	test('the batch read', async () => {
		const { manager, linear, issueQueries } = await connected();

		const result = await manager.getIssuesBatch({
			providerId: linear.id,
			targets: [{ key: 'ENG-1', resourceId: 'org-1', identifier: 'ENG-1' }],
		});
		assert.equal(result.fetchFailed, undefined);

		const row = result.items[0]?.issue;
		assertPlaceholders(row, check(row, linear.id, 'batch', 'getIssuesBatch'), 'getIssuesBatch');
		assertNoLabelsOrCommentsSelected(issueQueries);

		manager.dispose();
	});
});

suite('Trello field presence', () => {
	const appKey = 'app-key';
	const board = { key: 'b1', id: 'b1', name: 'Board 1' };
	const cardId = '64b5abcd0000000000000000';

	function card(): Json {
		return {
			id: cardId,
			idShort: 7,
			name: 'Card',
			url: 'https://trello.com/c/abc/7-card',
			dateLastActivity: '2026-01-02T00:00:00.000Z',
			idList: 'list-1',
			// A card has a description, which no read surfaces.
			desc: 'Card description',
			badges: { comments: 3, votes: votes },
			members: [
				{
					id: 'member-1',
					username: 'trellouser',
					fullName: 'Trello User',
					avatarUrl: 'https://avatars.example/t',
				},
			],
			labels: [{ id: 'label-1', color: 'green', name: 'bug' }],
		};
	}

	function serve(runtime: FakeRuntime): URL[] {
		const requests: URL[] = [];
		runtime.http.fetch = input => {
			const url = new URL(input.toString());
			requests.push(url);

			switch (url.pathname) {
				case '/1/members/me':
					return Promise.resolve(
						jsonResponse({
							id: 'member-1',
							username: 'trellouser',
							fullName: 'Trello User',
							email: 'trello@example.com',
							url: 'https://trello.com/trellouser',
						}),
					);
				case '/1/members/me/boards':
					return Promise.resolve(jsonResponse([{ id: 'b1', name: 'Board 1' }]));
				case '/1/boards/b1/lists':
					return Promise.resolve(jsonResponse([{ id: 'list-1', name: 'To Do' }]));
				case `/1/cards/${cardId}`:
					return Promise.resolve(jsonResponse(card()));
				case '/1/search':
					return Promise.resolve(jsonResponse({ cards: [card()] }));
				default:
					return Promise.resolve(notFound(url));
			}
		};
		return requests;
	}

	async function connected() {
		const runtime = createRuntime();
		const requests = serve(runtime);
		const manager = createIntegrationManager(runtime);
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		connect(trello, session('trello.com', { appKey: appKey }));
		return { manager: manager, trello: trello, requests: requests };
	}

	/** A card's description is never read, and its votes aren't reactions. */
	function assertPlaceholders(row: IssueShape | undefined, presence: Presence, label: string): void {
		assert.ok(row != null, label);
		assert.equal(row.body, undefined, `${label}: the description is not surfaced`);
		assert.equal(presence.description, 'not-requested', `${label}: description`);
		assert.equal(row.thumbsUpCount, votes, `${label}: the votes ride in thumbsUpCount`);
		assert.equal(presence.reactions, 'unavailable', `${label}: votes are not reactions`);
		assert.equal(row.repository, undefined, `${label}: a tracker issue has no repository`);
		assert.equal(presence.access, 'unavailable', `${label}: the viewer's access is unavailable`);
	}

	test('the point read', async () => {
		const { manager, trello } = await connected();

		const read = await trello.getIssue(board, cardId);
		assertPlaceholders(read, check(read, trello.id, 'point', 'getIssue'), 'getIssue');

		// A linked issue or pull request is never resolved for Trello.
		assert.equal(await trello.getLinkedIssueOrPullRequest(board, { id: cardId, key: cardId }), undefined);

		manager.dispose();
	});

	test('the project reads, through the facade and directly', async () => {
		const { manager, trello, requests } = await connected();

		const result = await manager.listIssueTrackerIssuesPage({ providerId: trello.id });
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);
		const presence = checkAll(result.items, trello.id, 'project', 'listIssueTrackerIssuesPage');
		assertPlaceholders(result.items[0], presence, 'listIssueTrackerIssuesPage');
		assert.ok(
			requests.some(r => r.pathname === '/1/search' && r.searchParams.get('query')?.includes('@me')),
			'a resolved user scopes the read to the cards assigned to them',
		);

		const direct = await trello.getIssuesForProject(board);
		checkAll(direct ?? [], trello.id, 'project', 'getIssuesForProject');

		manager.dispose();
	});

	test('has no account-wide or batch read', async () => {
		const { manager, trello } = await connected();

		assert.equal(await trello.searchMyIssues(), undefined, 'no cross-board issues endpoint');

		const result = await manager.getIssuesBatch({
			providerId: trello.id,
			targets: [{ key: '7', resourceId: 'b1', identifier: '7' }],
		});
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});
});

suite('Tracker field presence coverage', () => {
	test('every projection each tracker has a table entry for was exercised above', () => {
		for (const providerId of [
			IssuesCloudHostIntegrationId.Jira,
			IssuesSelfManagedHostIntegrationId.JiraServer,
			IssuesCloudHostIntegrationId.Linear,
			IssuesCloudHostIntegrationId.Trello,
		]) {
			const tabled = allIssueProjections.filter(
				projection =>
					getIssueFieldPresence({
						provider: { id: providerId },
						projection: projection,
					} as unknown as IssueShape) != null,
			);
			assert.ok(tabled.length > 0, `${providerId} has a table`);
			assert.deepEqual([...(exercised.get(providerId) ?? [])].sort(), [...tabled].sort(), providerId);
		}
	});
});
