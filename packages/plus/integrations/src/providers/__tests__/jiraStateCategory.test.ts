import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape, IssueStateFilter } from '@gitlens/git/models/issue.js';
import type { FakeRuntime } from '../../__tests__/fakeRuntime.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import type { ProviderAuthenticationSession } from '../../authentication/models.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../../constants.js';
import { createIntegrationService as createIntegrationManager } from '../../integrationService.js';
import type { IssuesIntegration } from '../../models/issuesIntegration.js';

/**
 * A Jira issue's state category, through the real provider-apis normalizer, on a Spanish instance (#5864,
 * gitkraken/kepler#4010). Jira localizes a status category's `name` but not its `key`; provider-apis maps the key
 * (GKDEV-3656), so core trusts the category on every Jira read: a `done` key closes the issue, and every other key,
 * including Jira's "No Category" (`undefined`), leaves it open whatever the status is called.
 */

type Status = { name: string; key: string; categoryName: string };

const statuses = {
	toDo: { name: 'Por hacer', key: 'new', categoryName: 'Por hacer' },
	inProgress: { name: 'En curso', key: 'indeterminate', categoryName: 'En curso' },
	done: { name: 'Listo', key: 'done', categoryName: 'Listo' },
	noCategory: { name: 'Sin categoría', key: 'undefined', categoryName: 'Sin categoría' },
} satisfies Record<string, Status>;

const expected: Record<keyof typeof statuses, Pick<IssueShape, 'closed' | 'state'> & { category: string }> = {
	toDo: { closed: false, state: 'opened', category: 'TO_DO' },
	inProgress: { closed: false, state: 'opened', category: 'IN_PROGRESS' },
	done: { closed: true, state: 'closed', category: 'DONE' },
	noCategory: { closed: false, state: 'opened', category: 'TO_DO' },
};

const keys = Object.keys(statuses) as (keyof typeof statuses)[];
const issueKey = (status: keyof typeof statuses): string => `OPS-${keys.indexOf(status) + 1}`;

function rawIssue(baseUrl: string, status: keyof typeof statuses) {
	const { name, key, categoryName } = statuses[status];
	const user = {
		key: 'JIRAUSER1',
		accountId: 'me',
		name: 'me',
		displayName: 'Me',
		emailAddress: 'me@example.com',
		avatarUrls: { '48x48': 'https://avatars.example/me' },
	};
	const id = String(keys.indexOf(status) + 1);
	return {
		id: id,
		key: issueKey(status),
		self: `${baseUrl}/rest/api/2/issue/${id}`,
		fields: {
			assignee: user,
			comment: { total: 0, comments: [] },
			components: [],
			created: '2026-01-01T00:00:00.000+0000',
			creator: user,
			description: null,
			fixVersions: [],
			issuetype: { name: 'Task' },
			labels: [],
			project: { id: '101', key: 'OPS', name: 'Operaciones' },
			status: {
				id: id,
				name: name,
				statusCategory: { id: 1, colorName: 'blue-gray', key: key, name: categoryName },
			},
			summary: issueKey(status),
			updated: '2026-01-02T00:00:00.000+0000',
			votes: { votes: 0 },
		},
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

type Host = {
	name: string;
	connect(runtime: FakeRuntime): Promise<{
		manager: ReturnType<typeof createIntegrationManager>;
		page: (
			state: IssueStateFilter,
		) => ReturnType<ReturnType<typeof createIntegrationManager>['listIssueTrackerIssuesPage']>;
		read: (key: string) => Promise<IssueShape | undefined>;
	}>;
};

/** The issues a search's JQL selects, by the state clause provider-apis builds for `open` and `closed`. */
function searched(baseUrl: string, url: URL) {
	const jql = url.searchParams.get('jql') ?? '';
	const selected = jql.includes('statusCategory != Done')
		? keys.filter(s => statuses[s].key !== 'done')
		: jql.includes('statusCategory = Done')
			? keys.filter(s => statuses[s].key === 'done')
			: keys;
	return selected.map(s => rawIssue(baseUrl, s));
}

function serve(
	runtime: FakeRuntime,
	baseUrl: string,
	apiPrefix: string,
	routes: Record<string, (url: URL) => unknown>,
): void {
	runtime.http.fetch = input => {
		const url = new URL(input.toString());
		// provider-apis joins the accessible-resources URL with a double slash.
		const pathname = url.pathname.replace(/\/{2,}/g, '/');
		const path = pathname.startsWith(apiPrefix) ? pathname.slice(apiPrefix.length) : pathname;
		const route = routes[path];
		if (route != null) return Promise.resolve(jsonResponse(route(url)));

		const issue = /^\/rest\/api\/2\/issue\/([^/]+)$/.exec(path);
		if (issue != null) {
			const status = keys.find(s => issueKey(s) === decodeURIComponent(issue[1]));
			if (status != null) return Promise.resolve(jsonResponse(rawIssue(baseUrl, status)));
		}
		return Promise.resolve(jsonResponse({ errorMessages: [`unexpected ${url.pathname}`] }, 404));
	};
}

function withSession(integration: IssuesIntegration, session: ProviderAuthenticationSession): void {
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = session;
}

const serverDomain = 'jira.example.com';
const cloudSite = { id: 'site-1', name: 'site', url: 'https://site.atlassian.net', avatarUrl: '' };

const hosts: Host[] = [
	{
		name: 'Jira Cloud',
		connect: async runtime => {
			const baseUrl = cloudSite.url;
			let projectPages = 0;
			serve(runtime, baseUrl, `/ex/jira/${cloudSite.id}`, {
				'/oauth/token/accessible-resources': () => [{ ...cloudSite, scopes: [] }],
				'/rest/api/2/myself': () => ({ accountId: 'me', displayName: 'Me', emailAddress: 'me@example.com' }),
				'/rest/api/2/field': () => [],
				'/rest/api/2/project/search': () => ({
					startAt: 0,
					values: projectPages++ === 0 ? [{ id: '101', key: 'OPS', name: 'Operaciones' }] : [],
				}),
				'/rest/api/2/search/jql': url => ({ issues: searched(baseUrl, url) }),
			});
			const manager = createIntegrationManager(runtime);
			const integration = await manager.get(IssuesCloudHostIntegrationId.Jira);
			withSession(integration, {
				id: 'primary',
				accessToken: 'tok',
				account: { id: 'me', label: 'me' },
				scopes: [],
				cloud: true,
				type: 'oauth',
				domain: 'atlassian.net',
			});
			return {
				manager: manager,
				page: state =>
					manager.listIssueTrackerIssuesPage({
						providerId: IssuesCloudHostIntegrationId.Jira,
						org: cloudSite.id,
						project: 'OPS',
						state: state,
						includeAllAssignees: true,
					}),
				read: key => integration.getIssue({ id: cloudSite.id, key: cloudSite.id, name: 'site' }, key),
			};
		},
	},
	{
		name: 'Jira Data Center',
		connect: async runtime => {
			const baseUrl = `https://${serverDomain}`;
			serve(runtime, baseUrl, '', {
				'/rest/api/2/myself': () => ({ key: 'JIRAUSER1', name: 'me', displayName: 'Me' }),
				'/rest/api/2/field': () => [],
				'/rest/api/2/project': () => [{ id: '101', key: 'OPS', name: 'Operaciones' }],
				'/rest/api/2/search': url => {
					const issues = searched(baseUrl, url);
					return { startAt: 0, maxResults: 100, total: issues.length, issues: issues };
				},
			});
			const manager = createIntegrationManager(runtime);
			const integration = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, serverDomain))!;
			withSession(integration, {
				id: 'primary',
				accessToken: 'tok',
				account: { id: 'primary', label: 'primary' },
				scopes: [],
				cloud: true,
				type: 'pat',
				domain: serverDomain,
			});
			return {
				manager: manager,
				page: state =>
					manager.listIssueTrackerIssuesPage({
						providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
						domain: serverDomain,
						org: serverDomain,
						project: 'OPS',
						state: state,
						includeAllAssignees: true,
					}),
				read: key => integration.getIssue({ id: serverDomain, key: serverDomain, name: serverDomain }, key),
			};
		},
	},
];

function assertState(issue: IssueShape | undefined, status: keyof typeof statuses): void {
	const want = expected[status];
	const label = `${statuses[status].name} (${statuses[status].key})`;
	assert.ok(issue != null, `${label} was read`);
	assert.equal(issue.closed, want.closed, `${label} closed`);
	assert.equal(issue.state, want.state, `${label} state`);
	assert.equal(issue.providerState?.name, statuses[status].name, `${label} keeps its display name`);
	assert.equal(issue.providerState?.category, want.category, `${label} category`);
	assert.equal(issue.bodyFormat, 'jira-wiki', `${label} body is Jira wiki markup`);
}

suite('Jira state category on a localized instance (#5864, kepler#4010)', () => {
	for (const host of hosts) {
		test(`${host.name}: a project page closes the done issues and keeps the rest open`, async () => {
			const { manager, page } = await host.connect(createFakeRuntime());
			try {
				const result = await page('all');
				assert.notEqual(result.fetchFailed, true);
				for (const status of keys) {
					assertState(
						result.items.find(i => i.id === issueKey(status)),
						status,
					);
				}
			} finally {
				manager.dispose();
			}
		});

		test(`${host.name}: an open page holds only open issues, and a closed page only the done ones`, async () => {
			const { manager, page } = await host.connect(createFakeRuntime());
			try {
				for (const state of ['open', 'closed'] as const) {
					const result = await page(state);
					assert.notEqual(result.fetchFailed, true);
					assert.deepEqual(
						result.items.map(i => i.id),
						keys.filter(s => expected[s].closed === (state === 'closed')).map(issueKey),
						`the ${state} page lists the issues of its state`,
					);
					assert.ok(result.items.every(i => i.closed === (state === 'closed')));
				}
			} finally {
				manager.dispose();
			}
		});

		test(`${host.name}: an issue read closes a done issue and keeps the rest open`, async () => {
			const { manager, read } = await host.connect(createFakeRuntime());
			try {
				for (const status of keys) {
					assertState(await read(issueKey(status)), status);
				}
			} finally {
				manager.dispose();
			}
		});
	}
});
