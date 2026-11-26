import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import type {
	AzureServerWorkItemWriteScope,
	IntegrationManager,
	WorkItemDeleteOptions,
	WorkItemWriteOptions,
} from '../index.js';
import { createIntegrationManager } from '../index.js';
import { azureRestDiscoveryResponse } from '../providers/azure/__tests__/fixtures.js';
import { isWorkItemWriteScope } from '../providers/azureWorkItemWriteErrors.js';
import { createFakeRuntime } from './fakeRuntime.js';

const providerId = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
const baseUrl = 'https://server.test/tfs';
const installation = '/tfs';
const authorization = `Basic ${btoa(':me-token')}`;
const serverIdentity = '3a5f4a91-0000-4000-8000-000000000001';
const collections = [
	{ id: 'fd62411b-0000-4000-8000-000000000001', name: 'DefaultCollection', identity: 'collection-identity-a' },
	{ id: 'fd62411b-0000-4000-8000-000000000002', name: 'Other Collection', identity: 'collection-identity-b' },
];
/** The same project name in both collections, with different ids. */
const projects = [
	{ id: '12ba3e78-27d9-4ad4-82a2-4142734e75f0', name: 'Shared', collection: collections[0].name },
	{ id: '58650c76-e42c-4377-9ddd-8c2fdecabaa5', name: 'Shared', collection: collections[1].name },
];
const [collection] = collections;
const [project, sameNameProject] = projects;
const type = {
	name: 'Task',
	referenceName: 'Microsoft.VSTS.WorkItemTypes.Task',
	transitions: { '': [{ to: 'To Do' }], 'To Do': [{ to: 'Doing' }], Doing: [{ to: 'Done' }] },
	states: [
		{ name: 'To Do', category: 'Proposed' },
		{ name: 'Doing', category: 'InProgress' },
		{ name: 'Done', category: 'Completed' },
	],
};
const catalog = [
	{ referenceName: 'System.Title', name: 'Title', type: 'string', readOnly: false },
	{ referenceName: 'System.TeamProject', name: 'Team Project', type: 'string', readOnly: false },
	{ referenceName: 'System.State', name: 'State', type: 'string', readOnly: false },
	{ referenceName: 'System.Description', name: 'Description', type: 'html', readOnly: false },
];
const typeFields = catalog.map(field => ({
	...field,
	alwaysRequired: field.referenceName === 'System.Title',
	defaultValue: null,
	allowedValues: [],
}));
const item = {
	id: 42,
	rev: 3,
	fields: {
		'System.Title': 'Original',
		'System.TeamProject': project.name,
		'System.WorkItemType': type.name,
		'System.State': 'To Do',
	},
};
const projectNamespaceId = '52d39943-cb85-4d7f-8fa8-c6baac873819';
const workItemDeleteBit = 8192;

type Call = { method: string; url: URL; route: string; body: unknown };
type Profile = { maxVersion: string; releasedVersion: string };

const server2020: Profile = { maxVersion: '6.0', releasedVersion: '6.0' };

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status: status, headers: { 'content-type': 'application/json' } });
}

function createServer(
	profile: Profile = server2020,
	respond?: (call: Call) => Response | Promise<Response> | undefined,
	domain: string = baseUrl,
) {
	const runtime = createFakeRuntime();
	const descriptor = {
		tokenId: 'connection',
		provider: toCloudIntegrationType[providerId],
		type: 'pat',
		domain: domain,
	};
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async path => {
		if (path === 'v1/provider-tokens') return json({ data: [{ ...descriptor, secondaries: [] }] });

		return json({ data: { ...descriptor, accessToken: 'me-token', expiresIn: 3600, scopes: '' } });
	};

	const calls: Call[] = [];
	runtime.http.fetch = async (input, init) => {
		const url = new URL(input.toString());
		const method = init?.method ?? 'GET';
		assert.equal(url.origin, 'https://server.test');
		assert.ok(url.pathname.startsWith(`${installation}/`), url.pathname);
		assert.equal(url.searchParams.has('destroy'), false);
		assert.equal(url.searchParams.has('bypassRules'), false);
		const route = url.pathname
			.slice(installation.length + 1)
			.split('/')
			.map(decodeURIComponent)
			.join('/');
		const call = {
			method: method,
			url: url,
			route: route,
			body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
		};
		calls.push(call);

		if (method === 'OPTIONS') {
			return (await respond?.(call)) ?? azureRestDiscoveryResponse(url, profile) ?? json({}, 404);
		}

		const version = url.searchParams.get('api-version');
		if (version != null) {
			const [major] = version.split('-')[0].split('.').map(Number);
			if (major > Number(profile.maxVersion.split('.')[0])) return json({ message: 'unsupported version' }, 404);
		}

		const custom = await respond?.(call);
		if (custom != null) return custom;

		const headers = new Headers(init?.headers);
		if (route === '_apis/connectionData') {
			return json({
				authenticatedUser: { id: serverIdentity, properties: { Account: { $value: 'me' } } },
				instanceId: 'a0000000-0000-4000-8000-000000000000',
			});
		}
		if (route === '_apis/projectCollections') {
			return json({ count: 2, value: collections.map(c => ({ id: c.id, name: c.name })) });
		}

		const [collectionName, ...rest] = route.split('/');
		const current = collections.find(c => c.name === collectionName);
		if (current == null) return json({ message: 'unknown collection' }, 404);

		const path = rest.join('/');
		if (path === '_apis/connectionData') {
			assert.equal(headers.get('authorization'), authorization);
			return json({
				authenticatedUser: { id: current.identity, properties: { Account: { $value: 'me' } } },
				instanceId: current.id,
				webApplicationRelativeDirectory: `${installation}/${current.name}/`,
			});
		}

		for (const p of projects.filter(p => p.collection === current.name)) {
			if (path === `_apis/projects/${p.id}`) return json({ id: p.id, name: p.name });
		}
		if (path === `_apis/securitynamespaces/${projectNamespaceId}`) {
			return json({
				value: [
					{
						namespaceId: projectNamespaceId,
						actions: [{ bit: workItemDeleteBit, name: 'WORK_ITEM_DELETE' }],
					},
				],
			});
		}
		if (path === `_apis/permissions/${projectNamespaceId}/${workItemDeleteBit}`) {
			assert.equal(url.searchParams.get('tokens'), `$PROJECT:vstfs:///Classification/TeamProject/${project.id}`);
			return json({ count: 1, value: [true] });
		}

		const prefix = `${project.id}/_apis/wit/`;
		if (current !== collection || !path.startsWith(prefix)) return json({ message: `unhandled ${route}` }, 404);

		assert.equal(headers.get('authorization'), authorization);

		switch (`${method} ${path.slice(prefix.length)}`) {
			case 'GET workitemtypes':
				return json({ value: [type] });
			case 'GET workitemtypes/Task':
				return json(type);
			case 'GET workitemtypes/Task/fields':
				return json({ value: typeFields });
			case 'GET fields':
				return json({ value: catalog });
			case 'GET workitemtypecategories':
				return json({ value: [] });
			case 'GET workitems/42':
				return json(item);
			case 'POST workitems/$Task':
				return json({ ...item, id: 43, rev: 1, fields: { ...item.fields, 'System.Title': 'New' } });
			case 'PATCH workitems/42':
				return json({ ...item, rev: 4, fields: { ...item.fields, 'System.State': 'Doing' } });
			case 'DELETE workitems/42':
				return json({
					id: 42,
					project: project.name,
					code: 200,
					deletedDate: '11/25/2026 6:24:35 PM',
					resource: { id: 42, rev: 4 },
				});
			default:
				return json({ message: `unhandled ${route}` }, 404);
		}
	};

	return {
		runtime: runtime,
		calls: calls,
		mutations: () => calls.filter(c => c.method !== 'GET' && c.method !== 'OPTIONS'),
	};
}

async function withManager(
	server: ReturnType<typeof createServer>,
	fn: (manager: IntegrationManager, scope: AzureServerWorkItemWriteScope) => Promise<void>,
	connectionBaseUrl: string = baseUrl,
): Promise<void> {
	const manager = createIntegrationManager(server.runtime);
	try {
		await manager.refreshConnections();
		const [connection] = manager.getConfigured(providerId);
		await fn(manager, {
			providerId: providerId,
			connectionId: connection.id,
			baseUrl: connectionBaseUrl,
			organizationId: collection.id,
			organizationName: collection.name,
			collectionUrl: `${baseUrl}/${collection.name}`,
			projectId: project.id,
		});
	} finally {
		manager.dispose();
	}
}

suite('IntegrationManager Azure DevOps Server work item writes', () => {
	test('pins the collection, its identity and the listed collection URL, and negotiates the server version', async () => {
		const server = createServer();
		await withManager(server, async (manager, scope) => {
			const orgs = await manager.listOrgs({ providerId: providerId, connectionId: scope.connectionId });
			assert.equal(orgs.items.find(o => o.name === collection.name)?.url, scope.collectionUrl);

			const types = await manager.getWorkItemCreateOptions(scope);
			assert.ok(types.ok && 'workItemTypes' in types, JSON.stringify(types));
			assert.equal(types.providerId, providerId);
			assert.equal(types.accountId, collection.identity);
			assert.notEqual(types.accountId, serverIdentity);
			assert.deepEqual(types.organization, {
				id: collection.id,
				name: collection.name,
				url: scope.collectionUrl,
			});
			assert.equal(types.providerId === providerId && types.baseUrl, baseUrl);
			assert.deepEqual(types.project, { id: project.id, name: project.name });
			assert.deepEqual(server.mutations(), []);

			const witCalls = server.calls.filter(c => c.url.pathname.includes('/_apis/wit/'));
			assert.ok(witCalls.length > 0);
			for (const call of witCalls) {
				assert.equal(
					call.url.pathname.startsWith(`${installation}/${collection.name}/${project.id}/_apis/wit/`),
					true,
				);
				assert.equal(call.url.searchParams.get('api-version'), '6.0');
			}
		});
	});

	test('creates, edits and transitions in the selected collection project with the collection identity', async () => {
		const server = createServer();
		await withManager(server, async (manager, scope) => {
			const options = await manager.getWorkItemWriteOptions({ ...scope, workItemId: item.id });
			assert.ok(options.ok, JSON.stringify(options));
			assert.deepEqual(options.availableStates, [type.states[1]]);
			assert.deepEqual(options.deleteCapability, { allowed: true });
			assert.equal(options.issue.url, `${scope.collectionUrl}/${project.id}/_workitems/edit/42`);

			const expected = { ...scope, expectedAccountId: options.accountId };
			const created = await manager.writeWorkItem({
				...expected,
				action: 'create',
				workItemType: type.name,
				fields: { 'System.Title': 'New' },
			});
			assert.ok(created.ok, JSON.stringify(created));
			assert.equal(created.issue.id, 43);

			const transitioned = await manager.writeWorkItem({
				...expected,
				workItemId: item.id,
				expectedRevision: item.rev,
				action: 'set-state',
				state: 'Doing',
			});
			assert.ok(transitioned.ok, JSON.stringify(transitioned));
			assert.deepEqual(transitioned.issue.state, { name: 'Doing', category: 'InProgress' });

			const [posted, patched] = server.mutations();
			assert.equal(
				posted.url.pathname,
				`${installation}/${collection.name}/${project.id}/_apis/wit/workitems/$Task`,
			);
			assert.deepEqual(patched.body, [
				{ op: 'test', path: '/rev', value: item.rev },
				{ op: 'add', path: '/fields/System.State', value: 'Doing' },
			]);
			assert.equal(patched.url.searchParams.get('api-version'), '6.0');
		});
	});

	test('deletes to the Recycle Bin once and proves the revision', async () => {
		const server = createServer();
		await withManager(server, async (manager, scope) => {
			const deletion = {
				...scope,
				workItemId: item.id,
				expectedRevision: item.rev,
				expectedAccountId: collection.identity,
			} satisfies WorkItemDeleteOptions;
			const result = await manager.deleteWorkItem(deletion);
			assert.ok(result.ok, JSON.stringify(result));
			assert.deepEqual(result.deletion, {
				disposition: 'recycle-bin',
				restorable: true,
				revision: item.rev + 1,
				deletedAt: '2026-11-25T18:24:35.000Z',
			});
			assert.deepEqual(
				server.mutations().map(c => `${c.method} ${c.url.pathname}`),
				[`DELETE ${installation}/${collection.name}/${project.id}/_apis/wit/workitems/42`],
			);
		});
	});

	test('fails closed on another installation, collection, same-name project or account before any mutation', async () => {
		const server = createServer();
		await withManager(server, async (manager, scope) => {
			const edit = {
				...scope,
				workItemId: item.id,
				expectedRevision: item.rev,
				expectedAccountId: collection.identity,
				action: 'edit',
				fields: { 'System.Title': 'Edited' },
			} satisfies WorkItemWriteOptions;
			const cases = [
				[{ ...edit, baseUrl: 'https://server.test' }, 'not-found'],
				[{ ...edit, baseUrl: 'https://server.test:8443/tfs' }, 'not-found'],
				[{ ...edit, baseUrl: 'http://server.test/tfs' }, 'not-found'],
				[{ ...edit, collectionUrl: 'https://dev.azure.com/DefaultCollection' }, 'invalid-input'],
				[{ ...edit, collectionUrl: `${baseUrl}/Other%20Collection` }, 'not-found'],
				[{ ...edit, organizationId: collections[1].id }, 'not-found'],
				[
					{
						...edit,
						organizationId: collections[1].id,
						organizationName: collections[1].name,
						collectionUrl: `${baseUrl}/${collections[1].name}`,
						expectedAccountId: collections[1].identity,
					},
					'not-found',
				],
				[{ ...edit, projectId: sameNameProject.id }, 'not-found'],
				[{ ...edit, expectedAccountId: serverIdentity }, 'no-connection'],
				[{ ...edit, connectionId: 'missing' }, 'no-connection'],
				[{ ...edit, organizationName: '../DefaultCollection' }, 'invalid-input'],
				[{ ...edit, collectionUrl: 'ftp://server.test/tfs/DefaultCollection' }, 'invalid-input'],
				[{ ...edit, baseUrl: 'https://user:secret@server.test/tfs' }, 'invalid-input'],
			] as const;
			for (const [input, reason] of cases) {
				const result = await manager.writeWorkItem(input);
				assert.ok(!result.ok);
				assert.equal(result.reason, reason, JSON.stringify(input));
				assert.equal(result.mutationDispatched, false);
			}
			assert.deepEqual(server.mutations(), []);
		});
	});

	test('writes through a connection addressed at the collection itself, and only with that base', async () => {
		const collectionUrl = `${baseUrl}/${collection.name}`;
		const server = createServer(server2020, undefined, collectionUrl);
		await withManager(
			server,
			async (manager, scope) => {
				const types = await manager.getWorkItemCreateOptions(scope);
				assert.ok(types.ok, JSON.stringify(types));
				assert.equal(types.providerId === providerId && types.baseUrl, collectionUrl);
				assert.equal(types.organization.id, collection.id);
				assert.deepEqual(await manager.getWorkItemCreateOptions({ ...scope, baseUrl: baseUrl }), {
					ok: false,
					reason: 'not-found',
					mutationDispatched: false,
				});
			},
			collectionUrl,
		);
	});

	test('reads the type states at the version the states resource itself negotiates', async () => {
		const statesLocationId = '7c9d7a76-4a09-43e8-b5df-bd792f4ac6aa';
		const statesRoute = `${collection.name}/${project.id}/_apis/wit/workitemtypes/Task/states`;
		const cases = [
			{
				server: server2020,
				states: { maxVersion: '6.0', releasedVersion: '5.0', resourceVersion: 2 },
				expected: '6.0-preview.2',
			},
			{
				server: { maxVersion: '7.0', releasedVersion: '7.0' },
				states: { maxVersion: '7.0', releasedVersion: '7.0', resourceVersion: 1 },
				expected: '7.0',
			},
			{
				server: { maxVersion: '5.0', releasedVersion: '5.0' },
				states: { maxVersion: '5.0', releasedVersion: '4.1', resourceVersion: 1 },
				expected: '5.0-preview.1',
			},
			{
				server: server2020,
				states: { minVersion: '6.1', maxVersion: '6.1', releasedVersion: '0.0', resourceVersion: 1 },
				expected: '6.1-preview.1',
			},
			{ server: server2020, states: undefined, expected: undefined },
		] as const;
		for (const { server: profile, states, expected } of cases) {
			const server = createServer(profile, call => {
				if (call.method === 'OPTIONS') {
					if (!call.route.endsWith('/_apis/wit')) return undefined;

					return azureRestDiscoveryResponse(call.url, profile)
						?.json()
						.then(body =>
							json({
								value: (body as { value: { id: string }[] }).value.flatMap(location =>
									location.id !== statesLocationId
										? [location]
										: states != null
											? [{ ...location, ...states }]
											: [],
								),
							}),
						);
				}
				if (call.route === `${collection.name}/${project.id}/_apis/wit/workitemtypes/Task`) {
					return json({ ...type, states: undefined });
				}
				if (call.route === statesRoute) {
					return call.url.searchParams.get('api-version') === expected
						? json({ value: type.states })
						: json({ message: 'VS403508: wrong version' }, 400);
				}
				return undefined;
			});
			await withManager(server, async (manager, scope) => {
				const options = await manager.getWorkItemCreateOptions({ ...scope, workItemType: type.name });
				const statesCalls = server.calls.filter(c => c.route === statesRoute);
				if (expected == null) {
					assert.deepEqual(options, { ok: false, reason: 'unsupported', mutationDispatched: false });
					assert.deepEqual(statesCalls, []);
					return;
				}

				assert.ok(options.ok && 'states' in options, JSON.stringify(options));
				assert.deepEqual(options.states, type.states);
				assert.deepEqual(
					statesCalls.map(c => c.url.searchParams.get('api-version')),
					[expected],
				);
			});
		}
	});

	test('refuses an Azure DevOps Services address configured as a Server connection, before any request', async () => {
		for (const cloudBase of [
			'https://dev.azure.com/acme',
			'https://acme.visualstudio.com',
			'https://dev.azure.com./acme',
			'https://DEV.AZURE.COM../acme',
			'https://acme.visualstudio.com.',
			'https://vssps.dev.azure.com./acme',
		]) {
			const server = createServer(server2020, undefined, cloudBase);
			const fetch = server.runtime.http.fetch;
			let requests = 0;
			server.runtime.http.fetch = (input, init) => {
				requests++;
				return fetch(input, init);
			};
			await withManager(
				server,
				async (manager, scope) => {
					requests = 0;
					const result = await manager.writeWorkItem({
						...scope,
						collectionUrl: `${cloudBase}/${collection.name}`,
						workItemId: item.id,
						expectedRevision: item.rev,
						expectedAccountId: collection.identity,
						action: 'edit',
						fields: { 'System.Title': 'Edited' },
					});
					assert.deepEqual(
						result,
						{ ok: false, reason: 'invalid-input', mutationDispatched: false },
						cloudBase,
					);
					assert.equal(requests, 0, cloudBase);
				},
				cloudBase,
			);
		}

		for (const host of ['tfs.westeurope.cloudapp.azure.com', 'dev.azure.com.contoso.test', 'devazure.com']) {
			const base = `https://${host}/tfs`;
			const scope: AzureServerWorkItemWriteScope = {
				providerId: providerId,
				connectionId: 'connection',
				baseUrl: base,
				organizationId: collection.id,
				organizationName: collection.name,
				collectionUrl: `${base}/${collection.name}`,
				projectId: project.id,
			};
			assert.equal(isWorkItemWriteScope(scope), true, host);
		}
	});

	test('refuses a collection whose connection data names another collection id or directory', async () => {
		for (const data of [
			{ instanceId: collections[1].id, webApplicationRelativeDirectory: `${installation}/${collection.name}/` },
			{ instanceId: collection.id, webApplicationRelativeDirectory: `${installation}/` },
			{ instanceId: 'DefaultCollection', webApplicationRelativeDirectory: `${installation}/${collection.name}/` },
		]) {
			const server = createServer(server2020, call =>
				call.route === `${collection.name}/_apis/connectionData`
					? json({ ...data, authenticatedUser: { id: collection.identity } })
					: undefined,
			);
			await withManager(server, async (manager, scope) => {
				assert.deepEqual(await manager.getWorkItemCreateOptions(scope), {
					ok: false,
					reason: 'not-found',
					mutationDispatched: false,
				});
			});
		}
	});

	test('uses each supported release version and refuses TFS 2018', async () => {
		for (const [profile, expected] of [
			[{ maxVersion: '5.0', releasedVersion: '5.0' }, '5.0'],
			[{ maxVersion: '5.1', releasedVersion: '5.0' }, '5.0'],
			[{ maxVersion: '7.0', releasedVersion: '7.0' }, '7.0'],
			[{ maxVersion: '7.1', releasedVersion: '7.1' }, '7.0'],
		] as const) {
			const server = createServer(profile);
			await withManager(server, async (manager, scope) => {
				assert.ok((await manager.getWorkItemCreateOptions(scope)).ok);
				const versions = new Set(
					server.calls
						.filter(c => c.method === 'GET' && c.route.includes('/_apis/wit/'))
						.map(c => c.url.searchParams.get('api-version')),
				);
				assert.deepEqual([...versions], [expected]);
			});
		}

		const tfs = createServer({ maxVersion: '4.1', releasedVersion: '4.1' });
		await withManager(tfs, async (manager, scope) => {
			assert.deepEqual(await manager.getWorkItemCreateOptions(scope), {
				ok: false,
				reason: 'unsupported',
				mutationDispatched: false,
			});
			assert.equal(
				tfs.calls.some(c => c.route.includes('/_apis/wit/')),
				false,
			);
		});
	});

	test('reports a denied delete permission and a refused write without retrying', async () => {
		const denied = createServer(server2020, call =>
			call.route.includes('/_apis/permissions/') ? json({ count: 1, value: [false] }) : undefined,
		);
		await withManager(denied, async (manager, scope) => {
			const result = await manager.deleteWorkItem({
				...scope,
				workItemId: item.id,
				expectedRevision: item.rev,
				expectedAccountId: collection.identity,
			});
			assert.deepEqual(result, { ok: false, reason: 'forbidden', mutationDispatched: false });
			assert.deepEqual(denied.mutations(), []);
		});

		const refused = createServer(server2020, call =>
			call.method === 'PATCH' ? json({ message: 'TF237111: no permission' }, 403) : undefined,
		);
		await withManager(refused, async (manager, scope) => {
			const result = await manager.writeWorkItem({
				...scope,
				workItemId: item.id,
				expectedRevision: item.rev,
				expectedAccountId: collection.identity,
				action: 'edit',
				fields: { 'System.Title': 'Edited' },
			});
			assert.deepEqual(result, { ok: false, reason: 'forbidden' });
			assert.equal(refused.mutations().length, 1);
		});

		const failed = createServer(server2020, call =>
			call.method === 'DELETE' ? json({ message: 'boom' }, 500) : undefined,
		);
		await withManager(failed, async (manager, scope) => {
			const result = await manager.deleteWorkItem({
				...scope,
				workItemId: item.id,
				expectedRevision: item.rev,
				expectedAccountId: collection.identity,
			});
			assert.deepEqual(result, { ok: false, reason: 'unknown', applied: 'maybe' });
			assert.equal(failed.mutations().length, 1);
			assert.equal(
				failed.calls.some(c => c.route.includes('recyclebin')),
				false,
			);
		});
	});
});
