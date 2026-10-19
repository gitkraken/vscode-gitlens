import assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Pins that a user-scoped Jira Server read searches the instance's projects together, as Jira Cloud does per site
 * (gitkraken/vscode-gitlens#5902), while keeping what is Server's own: projects named by numeric id rather than
 * name, and every clause scoped by the username handle, never the user key (#5857).
 */

const domain = 'jira.example.com';
const baseUrl = `https://${domain}`;

function jiraServerSession(): ProviderAuthenticationSession {
	return {
		id: `conn-${domain}`,
		accessToken: `tok-${domain}`,
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'pat',
		domain: domain,
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

const projects = [
	{ id: '10000', key: 'ALPHA', name: 'Alpha' },
	{ id: '10001', key: 'BETA', name: 'Beta' },
];

function providerIssue(projectId: string, number: string) {
	return {
		id: `id-${number}`,
		number: number,
		title: `Issue ${number}`,
		url: `${baseUrl}/browse/${number}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: [],
		labels: [],
		project: { id: projectId, key: projectId, name: projectId, resourceId: domain, namespace: null },
	};
}

type SearchCall = { projectKeys: string[]; baseUrl: string; assigneeLogins?: string[] };
type SearchPage = { data: unknown[]; hasMore: boolean; nextCursor: string | undefined; metadata?: CollectionMetadata };

async function connectedJiraServer(
	search: (call: SearchCall) => Promise<SearchPage>,
	projectRead: (projectKey: string) => Promise<SearchPage> = () =>
		Promise.resolve({ data: [], hasMore: false, nextCursor: undefined }),
) {
	const manager = createIntegrationManager(createFakeRuntime());
	const jiraServer = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, domain))!;
	(jiraServer as unknown as { _session: ProviderAuthenticationSession })._session = jiraServerSession();

	const searches: SearchCall[] = [];
	const projectReads: string[] = [];
	stubApi(jiraServer, {
		getJiraServerCurrentUser: () =>
			Promise.resolve({ id: 'JIRAUSER10224', name: 'Me', username: 'me', email: null, avatarUrl: null }),
		getJiraServerProjects: () => Promise.resolve(projects),
		getJiraServerIssuesForProjectsPaged: (
			_token: unknown,
			url: string,
			projectKeys: string[],
			options: { assigneeLogins?: string[] },
		) => {
			const call = { projectKeys: projectKeys, baseUrl: url, assigneeLogins: options.assigneeLogins };
			searches.push(call);
			return search(call);
		},
		getJiraServerIssuesForProjectPaged: (_token: unknown, _url: string, projectKey: string) => {
			projectReads.push(projectKey);
			return projectRead(projectKey);
		},
	});
	return { manager: manager, searches: searches, projectReads: projectReads };
}

suite('Jira Server multi-project issue searches', () => {
	test('searches every project by id with the username handle, and splits the issues back by project', async () => {
		const { manager, searches, projectReads } = await connectedJiraServer(() =>
			Promise.resolve({
				data: [providerIssue('10001', 'BETA-1'), providerIssue('10000', 'ALPHA-4')],
				hasMore: false,
				nextCursor: undefined,
			}),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			itemsPerPage: 20,
		});

		assert.deepEqual(searches, [{ projectKeys: ['10000', '10001'], baseUrl: baseUrl, assigneeLogins: ['me'] }]);
		assert.deepEqual(projectReads, []);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['ALPHA-4', 'BETA-1']);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('reads a rejected search project by project', async () => {
		const { manager, projectReads } = await connectedJiraServer(
			() => Promise.reject(new Error('500: Internal Server Error')),
			projectKey =>
				Promise.resolve({
					data: [providerIssue(projectKey, `${projectKey}-1`)],
					hasMore: false,
					nextCursor: undefined,
				}),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			itemsPerPage: 20,
		});

		assert.deepEqual(projectReads.sort(), ['10000', '10001']);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['10000-1', '10001-1']);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('keeps the siblings of an issue a page dropped, and warns on the project it belongs to', async () => {
		// provider-apis scopes a Data Center page failure to the instance alone (GKDEV-3652), which would publish it as
		// a failure of the whole connection; the project's own read names the project instead (#5992).
		const dropped = (): CollectionMetadata => ({
			completeness: 'partial',
			failures: [
				{
					scope: { providerId: 'jiraServer' },
					kind: 'provider',
					message:
						'Skipped Jira issues that could not be read: ALPHA-2 (Cannot read properties of undefined).',
				},
			],
		});
		const { manager, projectReads } = await connectedJiraServer(
			() =>
				Promise.resolve({
					data: [providerIssue('10000', 'ALPHA-1'), providerIssue('10001', 'BETA-1')],
					hasMore: false,
					nextCursor: undefined,
					metadata: dropped(),
				}),
			projectKey =>
				Promise.resolve(
					projectKey === '10000'
						? {
								data: [providerIssue('10000', 'ALPHA-1')],
								hasMore: false,
								nextCursor: undefined,
								metadata: dropped(),
							}
						: { data: [providerIssue('10001', 'BETA-1')], hasMore: false, nextCursor: undefined },
				),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			itemsPerPage: 20,
		});

		assert.deepEqual(projectReads.sort(), ['10000', '10001']);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['ALPHA-1', 'BETA-1']);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0].message, /ALPHA-2/);
		assert.equal(result.warnings[0].scope?.projectId, 'ALPHA', 'scoped by key, though read by id');

		manager.dispose();
	});

	test('reads a lone project on its own, so an issue it drops costs no second read', async () => {
		// A search naming one project is that project's read; searching it first would read it twice whenever a page
		// dropped an issue, since a search can't report the drop and is read again project by project.
		const { manager, searches, projectReads } = await connectedJiraServer(
			() => Promise.reject(new Error('the search must not run')),
			projectKey =>
				Promise.resolve({
					data: [providerIssue(projectKey, 'ALPHA-1')],
					hasMore: false,
					nextCursor: undefined,
					metadata: {
						completeness: 'partial',
						failures: [
							{
								scope: { providerId: 'jiraServer' },
								kind: 'provider',
								message: 'Skipped Jira issues that could not be read: ALPHA-2 (boom).',
							},
						],
					},
				}),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: domain,
			project: 'ALPHA',
			itemsPerPage: 20,
		});

		assert.deepEqual(searches, []);
		assert.deepEqual(projectReads, ['10000']);
		assert.deepEqual(
			result.items.map(i => i.id),
			['ALPHA-1'],
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0]?.scope?.projectId, 'ALPHA');

		manager.dispose();
	});
});
