import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Jira Data Center reads run for real through provider-apis against a server answering Jira's own responses, for what
 * depends on the SDK's own parsing: the project key it reads from `/rest/api/2/project`, and search pages holding
 * issues it can or can't read.
 */

const domain = 'jira.example.com';
const baseUrl = `https://${domain}`;

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

type SearchPage = { startAt: number; maxResults: number; total: number; issues: unknown[] };
const emptySearch = (): SearchPage => ({ startAt: 0, maxResults: 100, total: 0, issues: [] });

function serve(
	runtime: FakeRuntime,
	projects: unknown[],
	search: (startAt: number, jql: string) => SearchPage = emptySearch,
): URL[] {
	const requests: URL[] = [];
	runtime.http.fetch = input => {
		const url = new URL(input.toString());
		requests.push(url);
		switch (url.pathname) {
			case '/rest/api/2/myself':
				return Promise.resolve(jsonResponse({ key: 'JIRAUSER1', name: 'me', displayName: 'Me' }));
			case '/rest/api/2/field':
				return Promise.resolve(jsonResponse([]));
			case '/rest/api/2/project':
				return Promise.resolve(jsonResponse(projects));
			case '/rest/api/2/search':
				return Promise.resolve(
					jsonResponse(
						search(Number(url.searchParams.get('startAt') ?? 0), url.searchParams.get('jql') ?? ''),
					),
				);
			default:
				return Promise.resolve(new Response('{}', { status: 404 }));
		}
	};
	return requests;
}

async function connected(projects: unknown[], search?: (startAt: number, jql: string) => SearchPage) {
	const runtime = createFakeRuntime();
	const requests = serve(runtime, projects, search);
	const manager = createIntegrationManager(runtime);
	const jira = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, domain))!;
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'primary', label: 'primary' },
		scopes: [],
		cloud: true,
		type: 'pat',
		domain: domain,
	};
	return { manager: manager, requests: requests };
}

suite('Jira Data Center project keys', () => {
	test('lists each project by its trimmed key, falling back to its id when the server reports none', async () => {
		const { manager } = await connected([
			{ id: '101', key: 'OPS', name: 'Operations' },
			{ id: '102', key: '', name: 'Legacy' },
			{ id: '103', key: '  ', name: 'Blank' },
			{ id: '104', key: ' WEB ', name: 'Website' },
		]);

		const catalog = await manager.listProjects({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
		});

		assert.deepEqual(
			catalog.items.map(({ id, name, orgId }) => ({ id: id, name: name, orgId: orgId })),
			[
				{ id: '101', name: 'OPS', orgId: domain },
				{ id: '102', name: '102', orgId: domain },
				{ id: '103', name: '103', orgId: domain },
				{ id: '104', name: 'WEB', orgId: domain },
			],
		);

		manager.dispose();
	});

	test('a listed project selects exactly that project, which is still read by its numeric id', async () => {
		// The display name is another project's key: a read by name would read OTHER.
		const { manager, requests } = await connected([
			{ id: '101', key: 'OPS', name: 'OTHER' },
			{ id: '102', key: 'OTHER', name: 'Other' },
		]);
		const catalog = await manager.listProjects({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
		});
		const ops = catalog.items.find(item => item.id === '101')!;

		const page = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			org: ops.orgId,
			project: ops.name,
			includeAllAssignees: true,
		});

		assert.notEqual(page.fetchFailed, true);
		const jqls = requests.filter(r => r.pathname === '/rest/api/2/search').map(r => r.searchParams.get('jql'));
		assert.equal(jqls.length, 1);
		assert.match(jqls[0]!, /project = "101"/);

		manager.dispose();
	});
});

/** A Story whose field configuration hides Fix versions, so Jira leaves `fixVersions` out of the payload. */
function story(key: string) {
	const user = {
		key: 'JIRAUSER1',
		name: 'me',
		displayName: 'Me',
		emailAddress: 'me@example.com',
		avatarUrls: { '48x48': 'https://avatars.example/me' },
	};
	const id = key.replace(/\D/g, '');
	return {
		id: id,
		key: key,
		self: `${baseUrl}/rest/api/2/issue/${id}`,
		fields: {
			assignee: user,
			comment: { total: 0, comments: [] },
			components: [],
			created: '2026-01-01T00:00:00.000+0000',
			creator: user,
			description: null,
			issuetype: { name: 'Story' },
			labels: [],
			project: { id: '101', key: 'OPS', name: 'Operations' },
			status: { id: '1', name: 'To Do', statusCategory: { colorName: 'blue-gray', key: 'new', name: 'To Do' } },
			summary: key,
			updated: '2026-01-02T00:00:00.000+0000',
			votes: { votes: 0 },
		},
	};
}

suite('Jira Data Center search pages', () => {
	test('reads an issue whose type hides a field, and drains past a page whose every issue is unreadable', async () => {
		// Two pages of two: the first holds only issues provider-apis can't read, the second a hidden-field Story.
		const { manager, requests } = await connected([{ id: '101', key: 'OPS', name: 'OPS' }], startAt =>
			startAt === 0
				? { startAt: 0, maxResults: 2, total: 3, issues: [{ key: 'OPS-1', fields: null }, { key: 'OPS-2' }] }
				: { startAt: startAt, maxResults: 2, total: 3, issues: [story('OPS-3')] },
		);

		const page = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			org: domain,
			project: 'OPS',
			includeAllAssignees: true,
		});

		assert.deepEqual(
			page.items.map(issue => issue.id),
			['OPS-3'],
		);
		assert.deepEqual(
			requests.filter(r => r.pathname === '/rest/api/2/search').map(r => r.searchParams.get('startAt')),
			[null, '2'],
			'the drain reads on past the unreadable page',
		);
		assert.equal(page.fetchFailed, true, 'the skipped issues are reported, not hidden');
		assert.equal(page.warnings.length, 1);
		assert.match(page.warnings[0].message, /OPS-1.*OPS-2/);
		assert.deepEqual(page.warnings[0].scope, { resourceId: domain, projectId: 'OPS' });
		// By its kind and keys, not its text (#6011), read from the wording of the SDK this runs.
		assert.equal(page.warnings[0].kind, 'unreadable-items');
		assert.deepEqual(page.warnings[0].unreadableItems, { keys: ['OPS-1', 'OPS-2'], complete: true });

		manager.dispose();
	});

	test('names the skipped issues the SDK names, and says when it named only some', async () => {
		// Twelve unreadable issues, the first without a key: provider-apis names ten and counts the rest.
		const issues = [
			{ fields: null },
			...Array.from({ length: 11 }, (_, i) => ({ key: `OPS-${i + 1}`, fields: null })),
		];
		const { manager } = await connected([{ id: '101', key: 'OPS', name: 'OPS' }], () => ({
			startAt: 0,
			maxResults: 100,
			total: issues.length,
			issues: issues,
		}));

		const page = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			org: domain,
			project: 'OPS',
			includeAllAssignees: true,
		});

		assert.deepEqual(
			page.warnings.map(warning => [warning.kind, warning.unreadableItems]),
			[
				[
					'unreadable-items',
					{
						keys: ['OPS-1', 'OPS-2', 'OPS-3', 'OPS-4', 'OPS-5', 'OPS-6', 'OPS-7', 'OPS-8', 'OPS-9'],
						complete: false,
					},
				],
			],
		);

		manager.dispose();
	});

	test('reports a project cut at the page backstop beside another that skipped an issue (#6011)', async () => {
		// OPS never ends, one issue a page; WEB holds one issue provider-apis can't read.
		const { manager } = await connected(
			[
				{ id: '101', key: 'OPS', name: 'Operations' },
				{ id: '102', key: 'WEB', name: 'Website' },
			],
			(startAt, jql) =>
				jql.includes('project = "101"')
					? { startAt: startAt, maxResults: 1, total: 1000, issues: [story(`OPS-${startAt + 1}`)] }
					: { startAt: 0, maxResults: 100, total: 1, issues: [{ key: 'WEB-7', fields: null }] },
		);

		const page = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			includeAllAssignees: true,
		});

		assert.equal(page.fetchFailed, true);
		assert.equal(page.items.length, 10);
		assert.deepEqual(
			page.warnings.map(warning => [
				warning.kind,
				warning.scope,
				warning.unreadableItems,
				warning.omission?.recovery,
				warning.omission?.scope?.projectId,
			]),
			[
				[
					'unreadable-items',
					{ resourceId: domain, projectId: 'WEB' },
					{ keys: ['WEB-7'], complete: true },
					undefined,
					undefined,
				],
				['other', undefined, undefined, 'narrow-scope', 'OPS'],
			],
		);
		assert.match(page.warnings[1].message, /Project 'Operations' holds more issues than one read can return/);

		manager.dispose();
	});
});

/**
 * Jira Data Center serves a token it rejects as the anonymous user, measured against Jira Data Center 10.7.3 with a
 * revoked token: `/rest/api/2/project` answers `200 []` and `/rest/api/2/myself` `401`, each naming `anonymous` in
 * `X-AUSERNAME`. Read as data, the empty project list made a selected project look deleted.
 */
suite('Jira Data Center rejected token', () => {
	function anonymous(body: unknown, status = 200): Response {
		return new Response(JSON.stringify(body), {
			status: status,
			headers: { 'content-type': 'application/json', 'x-ausername': 'anonymous' },
		});
	}

	/** A server rejecting the token: every answer, the project list's `200 []` included, names `anonymous`. */
	async function rejectingToken() {
		const runtime = createFakeRuntime();
		const requests: URL[] = [];
		runtime.http.fetch = input => {
			const url = new URL(input.toString());
			requests.push(url);
			switch (url.pathname) {
				case '/rest/api/2/myself':
					return Promise.resolve(anonymous({ errorMessages: ['Unauthorized'] }, 401));
				case '/rest/api/2/project':
					return Promise.resolve(anonymous([]));
				default:
					return Promise.resolve(anonymous(emptySearch()));
			}
		};
		const manager = createIntegrationManager(runtime);
		const jira = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, domain))!;
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = {
			id: 'primary',
			accessToken: 'revoked',
			account: { id: 'primary', label: 'primary' },
			scopes: [],
			cloud: true,
			type: 'pat',
			domain: domain,
		};
		return { manager: manager, requests: requests };
	}

	test('a project selector reads as an authentication failure, not as a project that is gone', async () => {
		const { manager, requests } = await rejectingToken();

		const page = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			org: domain,
			project: 'OPS',
			includeAllAssignees: true,
		});

		assert.ok(
			requests.some(r => r.pathname === '/rest/api/2/project'),
			'the read must reach the project list',
		);
		assert.deepEqual(page.items, []);
		assert.equal(page.fetchFailed, true);
		assert.ok(
			page.warnings.every(w => w.selector == null),
			`no selector warning: ${JSON.stringify(page.warnings)}`,
		);
		assert.ok(
			page.warnings.some(w => w.kind === 'auth' && w.isAuth),
			`an authentication warning: ${JSON.stringify(page.warnings)}`,
		);

		manager.dispose();
	});

	test('the project list fails as an authentication failure instead of answering no projects', async () => {
		const { manager } = await rejectingToken();

		const catalog = await manager.listProjects({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
		});

		assert.deepEqual(catalog.items, []);
		assert.equal(catalog.fetchFailed, true);
		assert.ok(
			catalog.warnings.some(w => w.kind === 'auth' && w.isAuth),
			`an authentication warning: ${JSON.stringify(catalog.warnings)}`,
		);

		manager.dispose();
	});
});
