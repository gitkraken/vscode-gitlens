import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueStateFilter } from '@gitlens/git/models/issue.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationManager } from '../index.js';
import { createIntegrationManager } from '../index.js';
import { azureRestDiscoveryResponse } from '../providers/azure/__tests__/fixtures.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Azure DevOps Server 2019 serves REST API versions up to 5.0 (5.1 from Update 1), and answers any later one with its
 * HTML "Page not found" page (#6070). A version above what a resource has released, and every version of a resource
 * that is only a preview there (the work item type states), needs the `-preview` flag. These tests drive the issue
 * lists against a server that refuses both the way Azure does.
 */

interface ServerProfile {
	name: string;
	maxVersion: string;
	releasedVersion: string;
	resourceVersion: number;
	/** The version each list request negotiates, by method and route below the project. */
	expected: Record<string, string>;
}

const profiles: ServerProfile[] = [
	{
		name: 'Azure DevOps Server 2019',
		maxVersion: '5.0',
		releasedVersion: '5.0',
		resourceVersion: 1,
		expected: {
			'GET _apis/wit/fields': '5.0',
			'GET _apis/wit/workitemtypes': '5.0',
			'GET _apis/wit/workitemtypes/{type}/states': '5.0-preview.1',
			'POST _apis/wit/wiql': '5.0',
			'POST _apis/wit/workitemsbatch': '5.0',
		},
	},
	{
		name: 'Azure DevOps Server 2019 Update 1',
		maxVersion: '5.1',
		releasedVersion: '5.0',
		resourceVersion: 2,
		expected: {
			'GET _apis/wit/fields': '5.1-preview.2',
			'GET _apis/wit/workitemtypes': '5.1-preview.2',
			'GET _apis/wit/workitemtypes/{type}/states': '5.1-preview.1',
			'POST _apis/wit/wiql': '5.1-preview.2',
			'POST _apis/wit/workitemsbatch': '5.1-preview.2',
		},
	},
];

const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
const installation = '/tfs';
const collection = 'DefaultCollection';
const project = 'NikolayM';
const repository = 'NikolayM';

interface FakeWorkItem {
	id: number;
	type: 'Task' | 'Bug';
	state: string;
}

const workItems: FakeWorkItem[] = [
	{ id: 1, type: 'Task', state: 'New' },
	{ id: 2, type: 'Task', state: 'Active' },
	{ id: 3, type: 'Bug', state: 'Active' },
	{ id: 4, type: 'Task', state: 'Closed' },
	{ id: 5, type: 'Bug', state: 'Closed' },
];
/** Has no built-in description, so a list reads the collection's field catalog for its HTML fields. */
const withoutDescription = 2;
const openIds = [1, 2, 3];
const closedIds = [4, 5];

const workflow = [
	{ name: 'New', category: 'Proposed' },
	{ name: 'Active', category: 'InProgress' },
	{ name: 'Closed', category: 'Completed' },
];

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status: status,
		headers: { 'content-type': 'application/json' },
	});
}

function notFoundPage(): Response {
	return new Response('<!DOCTYPE html><html><head><title>Page not found.</title></head></html>', {
		status: 404,
		headers: { 'content-type': 'text/html' },
	});
}

function user(name: string) {
	return {
		id: name,
		displayName: name,
		uniqueName: `${name}@example.com`,
		imageUrl: '',
		url: '',
	};
}

/** The ids a project WIQL query selects, from the type/state pairs of its state clause (all ids when it has none). */
function matchWiql(query: string): number[] {
	if (query.includes('[System.Id] = 0')) return [];

	const pairs = Array.from(
		query.matchAll(/\[System\.WorkItemType\] = '([^']*)' AND \[System\.State\] IN \(([^)]*)\)/g),
		([, type, states]) => ({ type: type, states: Array.from(states.matchAll(/'([^']*)'/g), m => m[1]) }),
	);
	return workItems
		.filter(w => pairs.length === 0 || pairs.some(p => p.type === w.type && p.states.includes(w.state)))
		.map(w => w.id);
}

function toWorkItem(w: FakeWorkItem) {
	const collectionUrl = `https://server.test${installation}/${collection}`;
	return {
		id: w.id,
		rev: 1,
		url: `${collectionUrl}/_apis/wit/workItems/${w.id}`,
		_links: {
			html: { href: `${collectionUrl}/${project}/_workitems/edit/${w.id}` },
		},
		fields: {
			'System.TeamProject': project,
			'System.WorkItemType': w.type,
			'System.State': w.state,
			'System.Title': `Work item ${w.id}`,
			...(w.id !== withoutDescription ? { 'System.Description': '<p>Body</p>' } : {}),
			'System.CreatedDate': '2026-01-01T00:00:00Z',
			'System.ChangedDate': `2026-01-0${w.id}T00:00:00Z`,
			'System.CreatedBy': user('me'),
			'System.AssignedTo': user('me'),
		},
	};
}

function compareVersions(left: string, right: string): number {
	const [a, b] = [left, right].map(v => v.split('-')[0].split('.').map(Number));
	return a[0] - b[0] || a[1] - b[1];
}

function createServer(profile: ServerProfile) {
	const runtime = createFakeRuntime();
	const descriptor = {
		tokenId: 'connection',
		provider: toCloudIntegrationType[id],
		type: 'pat',
		domain: `https://server.test${installation}`,
	};
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async path => {
		if (path === 'v1/provider-tokens') return json({ data: [{ ...descriptor, secondaries: [] }] });

		return json({
			data: {
				...descriptor,
				accessToken: 'me-token',
				expiresIn: 3600,
				scopes: '',
			},
		});
	};

	const requests: { method: string; url: URL }[] = [];
	/** The requests the server refused for asking a REST version it doesn't serve. */
	const refused: string[] = [];
	runtime.http.fetch = async (input, init) => {
		const url = new URL(input.toString());
		const method = init?.method ?? 'GET';
		const body = typeof init?.body === 'string' ? init.body : undefined;
		requests.push({ method: method, url: url });

		const version = url.searchParams.get('api-version');
		if (version != null) {
			const previewOnly = /\/_apis\/(?:wit\/workItemTypes\/[^/]+\/states|work\/backlogconfiguration)$/i.test(
				url.pathname,
			);
			const requested = `${method} ${decodeURIComponent(url.pathname)}?api-version=${version}`;
			if (compareVersions(version, profile.maxVersion) > 0) {
				refused.push(requested);
				return notFoundPage();
			}
			if (
				!version.includes('-preview') &&
				(previewOnly || compareVersions(version, profile.releasedVersion) > 0)
			) {
				refused.push(requested);
				return json(
					{
						message: `VS403508: The requested version "${version}" of the resource is under preview.`,
					},
					400,
				);
			}
		}

		if (!url.pathname.startsWith(`${installation}/`)) return notFoundPage();

		const segments = url.pathname
			.slice(installation.length + 1)
			.split('/')
			.map(decodeURIComponent);
		const atServer = segments[0] === '_apis';
		const route = (atServer ? segments : segments.slice(1)).join('/');
		const lower = route.toLowerCase();

		if (method === 'OPTIONS') {
			if (atServer) return notFoundPage();

			return (
				azureRestDiscoveryResponse(url, {
					...profile,
					previewOnlyResources: ['states', 'pullRequestQuery', 'backlogconfiguration', 'identityBatch'],
				}) ?? notFoundPage()
			);
		}

		if (lower === '_apis/connectiondata') {
			const identity = {
				id: 'me',
				providerDisplayName: 'me',
				properties: { Account: { $value: 'me' } },
			};
			return json({
				authenticatedUser: identity,
				authorizedUser: identity,
				instanceId: atServer ? 'server-id' : `${segments[0]}-id`,
				webApplicationRelativeDirectory: atServer ? null : `${installation}/${segments[0]}/`,
			});
		}
		if (lower === '_apis/projectcollections') {
			if (!atServer) return notFoundPage();

			return json({
				count: 1,
				value: [{ id: `${collection}-id`, name: collection, url: '' }],
			});
		}

		if (segments[0] !== collection) return json({ message: 'unknown collection' }, 404);

		if (lower === '_apis/projects') {
			return json({ count: 1, value: [{ id: `${project}-id`, name: project }] });
		}
		if (lower === '_apis/wit/fields') {
			return json({
				count: 1,
				value: [{ referenceName: 'Custom.Notes', name: 'Notes', type: 'html' }],
			});
		}

		const [projectSegment, ...rest] = segments.slice(1);
		if (projectSegment !== project && projectSegment !== `${project}-id`) {
			return json({ message: `unhandled ${url.pathname}` }, 404);
		}

		const path = rest.join('/').toLowerCase();
		switch (true) {
			case path === '_apis/git/repositories':
			case path === `_apis/git/repositories/${repository.toLowerCase()}`: {
				const repo = {
					id: `${repository}-id`,
					name: repository,
					project: { id: `${project}-id`, name: project },
					defaultBranch: 'refs/heads/main',
					remoteUrl: `https://server.test${installation}/${collection}/${project}/_git/${repository}`,
					webUrl: `https://server.test${installation}/${collection}/${project}/_git/${repository}`,
				};
				return json(path === '_apis/git/repositories' ? { count: 1, value: [repo] } : repo);
			}
			case path === '_apis/wit/workitemtypes':
				return json({ count: 2, value: [{ name: 'Task' }, { name: 'Bug' }] });
			case /^_apis\/wit\/workitemtypes\/[^/]+\/states$/.test(path):
				return json({
					count: workflow.length,
					value: workflow.map(s => ({ ...s, color: '007acc' })),
				});
			case path === '_apis/work/backlogconfiguration':
				return json({ workItemTypeMappedStates: [] });
			case path === '_apis/wit/wiql': {
				assert.equal(method, 'POST');
				const { query } = JSON.parse(body!) as { query: string };
				return json({ workItems: matchWiql(query).map(i => ({ id: i })) });
			}
			case path === '_apis/wit/workitemsbatch': {
				assert.equal(method, 'POST');
				const { ids } = JSON.parse(body!) as { ids: number[] };
				return json({
					count: ids.length,
					value: ids.map(i => toWorkItem(workItems.find(w => w.id === i)!)),
				});
			}
			case path === '_apis/wit/workitems': {
				const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number);
				return json({
					count: ids.length,
					value: ids.map(i => toWorkItem(workItems.find(w => w.id === i)!)),
				});
			}
			default:
				return json({ message: `unhandled ${url.pathname}` }, 404);
		}
	};

	return { runtime: runtime, requests: requests, refused: refused };
}

async function withManager(
	server: ReturnType<typeof createServer>,
	fn: (
		manager: IntegrationManager,
		target: {
			providerId: typeof id;
			connectionId: string;
			domain: string | undefined;
		},
	) => Promise<void>,
): Promise<void> {
	const manager = createIntegrationManager(server.runtime);
	try {
		await manager.refreshConnections();
		const [connection] = manager.getConfigured(id);
		await fn(manager, {
			providerId: id,
			connectionId: connection.id,
			domain: connection.domain,
		});
	} finally {
		manager.dispose();
	}
}

const expectedIds: Record<IssueStateFilter | 'omitted', number[]> = {
	omitted: openIds,
	open: openIds,
	closed: closedIds,
	all: [...openIds, ...closedIds],
};

suite('Azure DevOps Server 2019 issue lists (#6070)', () => {
	for (const profile of profiles) {
		suite(profile.name, () => {
			for (const scope of ['account', 'project', 'repository'] as const) {
				for (const state of ['omitted', 'open', 'closed', 'all'] as const) {
					test(`lists the ${scope}'s work items with state ${state} in versions the server serves`, async () => {
						const server = createServer(profile);
						await withManager(server, async (manager, target) => {
							const page = await manager.listIssuesPage({
								...target,
								...(scope === 'project' ? { org: collection, project: project } : {}),
								...(scope === 'repository'
									? {
											repos: [
												{
													namespace: collection,
													project: project,
													name: repository,
												},
											],
										}
									: {}),
								...(state !== 'omitted' ? { state: state } : {}),
								includeAllAssignees: true,
							});

							assert.deepEqual(server.refused, [], 'no request asks for a version the server refuses');
							assert.ok(!page.fetchFailed, JSON.stringify(page.warnings));
							assert.deepEqual(
								page.items.map(i => Number(i.id)).sort((a, b) => a - b),
								expectedIds[state],
								JSON.stringify(page.warnings),
							);
						});
					});
				}
			}

			test('negotiates the versions and previews the server advertises', async () => {
				const server = createServer(profile);
				await withManager(server, async (manager, target) => {
					await manager.listIssuesPage({
						...target,
						org: collection,
						project: project,
						includeAllAssignees: true,
					});

					const routes = new Set<string>();
					for (const r of server.requests) {
						const version = r.url.searchParams.get('api-version');
						if (version == null) continue;

						const path = decodeURIComponent(r.url.pathname)
							.replace(`${installation}/${collection}/`, '')
							.replace(`${project}/`, '')
							.toLowerCase()
							.replace(/workitemtypes\/[^/]+\/states/, 'workitemtypes/{type}/states');
						const route = `${r.method} ${path}`;
						assert.equal(version, profile.expected[route], r.url.toString());
						routes.add(route);
					}
					assert.deepEqual([...routes].sort(), Object.keys(profile.expected).sort());
				});
			});
		});
	}
});
