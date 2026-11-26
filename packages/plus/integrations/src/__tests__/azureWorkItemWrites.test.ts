import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { Emitter } from '@gitlens/utils/event.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { WorkItemDeleteOptions, WorkItemWriteOptions, WorkItemWriteScope } from '../index.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

const project = { id: '12ba3e78-27d9-4ad4-82a2-4142734e75f0', name: 'Example Project' };
const secondProject = { id: '58650c76-e42c-4377-9ddd-8c2fdecabaa5', name: 'Other Project' };
const organization = { accountId: '4a1e1dc8-7bcc-49da-94a7-faebaafca5b5', accountName: 'ExampleOrg' };
const otherOrganization = { accountId: 'de618ee3-c352-484c-94dc-75237ee25b35', accountName: 'OtherOrg' };
const accountId = 'c186e2f6-749d-4af6-82ca-67fbed9f205d';
const providerId = GitCloudHostIntegrationId.AzureDevOps;
const scope: WorkItemWriteScope = {
	providerId: providerId,
	connectionId: 'selected',
	organizationId: organization.accountId,
	organizationName: organization.accountName,
	projectId: project.id,
};
const type = {
	name: 'User Story',
	referenceName: 'Custom.UserStory',
	transitions: { '': [{ to: 'New' }], New: [{ to: 'New' }, { to: 'Archived' }] },
	states: [
		{ name: 'New', category: 'Proposed' },
		{ name: 'Archived', category: 'Removed' },
		{ name: 'Closed', category: 'Completed' },
	],
};
const catalog = [
	{ referenceName: 'System.Title', name: 'Title', type: 'string', readOnly: false },
	{ referenceName: 'System.TeamProject', name: 'Project', type: 'string', readOnly: false },
	{ referenceName: 'System.State', name: 'State', type: 'string', readOnly: false },
	{ referenceName: 'Custom.Background', name: 'Background', type: 'html', readOnly: false },
	{ referenceName: 'Custom.Sponsor', name: 'Sponsor', type: 'string', readOnly: false },
	{ referenceName: 'System.ReadOnly', name: 'Read Only', type: 'string', readOnly: true },
	{ referenceName: 'System.AreaId', name: 'Area ID', type: 'integer', readOnly: false },
	{ referenceName: 'System.IterationId', name: 'Iteration ID', type: 'integer', readOnly: false },
	{ referenceName: 'System.AreaPath', name: 'Area Path', type: 'treePath', readOnly: false },
	{ referenceName: 'System.IterationPath', name: 'Iteration Path', type: 'treePath', readOnly: false },
	{ referenceName: 'System.Parent', name: 'Parent', type: 'integer', readOnly: false },
	{ referenceName: 'System.BoardColumn', name: 'Board Column', type: 'string', readOnly: false },
];
const basicProcessFields: Partial<
	Record<string, { alwaysRequired: boolean; defaultValue: unknown; allowedValues: unknown[] }>
> = {
	'System.Title': { alwaysRequired: true, defaultValue: null, allowedValues: [] },
	'System.State': { alwaysRequired: true, defaultValue: 'To Do', allowedValues: ['Doing', 'Done', 'To Do'] },
	'System.AreaId': { alwaysRequired: true, defaultValue: null, allowedValues: [] },
	'System.IterationId': { alwaysRequired: true, defaultValue: null, allowedValues: [] },
	'System.AreaPath': { alwaysRequired: true, defaultValue: null, allowedValues: [] },
	'Custom.Sponsor': { alwaysRequired: true, defaultValue: 'Alice', allowedValues: ['Alice', 'Bob'] },
};
const typeFields = catalog.map(field => ({
	...field,
	alwaysRequired: false,
	defaultValue: null,
	allowedValues: [],
	...basicProcessFields[field.referenceName],
}));
const item = {
	id: 42,
	rev: 7,
	fields: {
		'System.Title': 'Original',
		'System.TeamProject': project.name,
		'System.WorkItemType': type.name,
		'System.State': 'New',
		'Custom.Background': '<p>Background</p>',
	},
};
const target = { ...scope, workItemId: item.id };
const deletion = {
	...target,
	expectedRevision: item.rev,
	expectedAccountId: accountId,
} satisfies WorkItemDeleteOptions;
const create = {
	...scope,
	action: 'create',
	expectedAccountId: accountId,
	workItemType: type.name,
	fields: { 'System.Title': 'New title', 'Custom.Background': '<p>Example</p>' },
} satisfies WorkItemWriteOptions;
const edit = { ...deletion, action: 'edit', fields: { 'System.Title': 'Edited' } } satisfies WorkItemWriteOptions;
const setState = { ...deletion, action: 'set-state', state: 'Archived' } satisfies WorkItemWriteOptions;
const deletedDate = '11/25/2026 6:24:35 PM';
const deletedAt = '2026-11-25T18:24:35.000Z';
function deletedItem(overrides?: { project?: string; rev?: number; id?: number; code?: number }) {
	const id = overrides?.id ?? item.id;
	return {
		id: id,
		project: overrides?.project ?? project.name,
		code: overrides?.code ?? 200,
		type: type.name,
		deletedDate: deletedDate,
		resource: { id: id, rev: overrides?.rev ?? item.rev + 1 },
	};
}
const projectNamespaceId = '52d39943-cb85-4d7f-8fa8-c6baac873819';
const workItemDeleteBit = 8192;
const categories = [
	{ referenceName: 'Microsoft.RequirementCategory', workItemTypes: [{ name: type.name }] },
	{ referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{ name: 'Test Case' }] },
];

type Call = { method: string; url: URL; path: string; headers: Headers; body: unknown };

function assertVerifiedAddresses(calls: readonly Call[]): void {
	for (const call of calls) {
		if (call.url.origin !== 'https://dev.azure.com') continue;

		const prefix = call.path.startsWith('wit/')
			? `/${organization.accountName}/${project.id}/_apis/`
			: `/${organization.accountName}/_apis/`;
		assert.ok(call.url.pathname.startsWith(prefix), `${call.method} ${call.url.pathname}`);
	}
}

async function setup(respond?: (call: Call) => unknown, auth: ProviderAuthenticationSession['type'] = 'oauth') {
	const runtime = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(runtime);
	const selected: ProviderAuthenticationSession = {
		id: 'selected',
		accessToken: 'selected-token',
		account: { id: 'stored-label', label: 'Selected account' },
		scopes: ['vso.work'],
		cloud: true,
		type: auth,
		domain: 'dev.azure.com',
	};
	await configured.storeSession(providerId, { ...selected, id: 'primary', accessToken: 'primary-token' });
	await configured.storeSession(providerId, selected);

	const calls: Call[] = [];
	runtime.http.fetch = async (input, init) => {
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
		assert.equal(init?.redirect, 'error');
		const path = url.pathname.split('/_apis/')[1];
		const call = {
			method: init?.method ?? 'GET',
			url: url,
			path: path,
			headers: headers,
			body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
		};
		calls.push(call);
		assert.equal(
			headers.get('authorization'),
			path === 'profile/profiles/me' ? 'Bearer selected-token' : 'Basic OnNlbGVjdGVkLXRva2Vu',
		);
		assert.equal(
			url.origin,
			path === 'accounts' || path === 'profile/profiles/me'
				? 'https://app.vssps.visualstudio.com'
				: 'https://dev.azure.com',
		);
		assert.equal(url.searchParams.has('destroy'), false);
		assert.equal(url.searchParams.has('bypassRules'), false);
		const custom = await respond?.(call);
		if (custom != null) return custom instanceof Response ? custom : Response.json(custom);

		switch (`${call.method} ${path}`) {
			case 'GET profile/profiles/me':
				return Response.json({ id: accountId });
			case 'GET accounts':
				assert.equal(url.searchParams.get('memberId'), accountId);
				return Response.json({ value: [organization, otherOrganization] });
			case `GET projects/${project.id}`:
				return Response.json(project);
			case `GET projects/${secondProject.id}`:
				return Response.json(secondProject);
			case 'GET wit/workitemtypes':
				return Response.json({ value: [type, { name: 'Hidden', isDisabled: true }] });
			case 'GET wit/workitemtypes/User%20Story':
				return Response.json(type);
			case 'GET wit/workitemtypes/User%20Story/fields':
				assert.equal(url.searchParams.get('$expand'), 'All');
				return Response.json({ value: typeFields });
			case 'GET wit/fields':
				return Response.json({ value: catalog });
			case 'GET wit/workitems/42':
				return Response.json(item);
			case 'GET wit/workitemtypecategories':
				return Response.json({ value: categories });
			case `GET securitynamespaces/${projectNamespaceId}`:
				assert.equal(
					url.pathname,
					`/${organization.accountName}/_apis/securitynamespaces/${projectNamespaceId}`,
				);
				return Response.json({
					value: [
						{
							namespaceId: projectNamespaceId,
							actions: [
								{ bit: 1, name: 'GENERIC_READ' },
								{ bit: workItemDeleteBit, name: 'WORK_ITEM_DELETE' },
							],
						},
					],
				});
			case `GET permissions/${projectNamespaceId}/${workItemDeleteBit}`:
				assert.equal(
					url.searchParams.get('tokens'),
					`$PROJECT:vstfs:///Classification/TeamProject/${project.id}`,
				);
				assert.equal(url.searchParams.get('alwaysAllowAdministrators'), 'false');
				return Response.json({ count: 1, value: [true] });
			case 'POST wit/workitems/$User%20Story':
				return Response.json({
					...item,
					id: 43,
					rev: 1,
					fields: { ...item.fields, 'System.Title': 'New title' },
				});
			case 'PATCH wit/workitems/42':
				return Response.json({
					...item,
					rev: 8,
					fields: { ...item.fields, 'System.State': 'Archived', 'System.Title': 'Edited' },
				});
			case 'DELETE wit/workitems/42':
				return new Response(null, { status: 204 });
			case 'GET wit/recyclebin/42':
				return Response.json(deletedItem());
			case 'GET projects/Other%20Project':
				return Response.json(secondProject);
			default:
				assert.fail(`Unexpected request ${call.method} ${url.toString()}`);
		}
	};
	const manager = createIntegrationManager(runtime);
	return {
		runtime: runtime,
		configured: configured,
		manager: manager,
		rotate: () => configured.storeSession(providerId, { ...selected, accessToken: 'rotated-token' }),
		calls: calls,
		mutations: () => calls.filter(call => call.method !== 'GET'),
		dispose: () => {
			manager.dispose();
			configured.dispose();
		},
	};
}

suite('IntegrationManager Azure DevOps Services work item writes', () => {
	test('discovers types, checked fields, initial states and the same body field as the read selector', async () => {
		const fixture = await setup();
		try {
			const types = await fixture.manager.getWorkItemCreateOptions(scope);
			assert.ok(types.ok && 'workItemTypes' in types);
			assert.deepEqual(types.workItemTypes, [{ name: type.name }]);
			assert.equal(types.accountId, accountId);
			assert.deepEqual(types.project, project);

			const options = await fixture.manager.getWorkItemCreateOptions({ ...scope, workItemType: type.name });
			assert.ok(options.ok && 'fields' in options);
			assert.deepEqual(options.initialStates, [type.states[0]]);
			assert.equal(options.states[1].category, 'Removed');
			assert.equal(options.bodyField, 'Custom.Background');
			assert.deepEqual(
				options.fields.map(field => [field.referenceName, field.required]),
				[
					['System.Title', true],
					['Custom.Background', false],
					['Custom.Sponsor', true],
					['System.AreaPath', false],
					['System.IterationPath', false],
				],
			);
			assert.deepEqual(options.fields[0], {
				referenceName: 'System.Title',
				name: 'Title',
				type: 'string',
				required: true,
			});
			assert.deepEqual(options.fields[2], {
				referenceName: 'Custom.Sponsor',
				name: 'Sponsor',
				type: 'string',
				required: true,
				allowedValues: ['Alice', 'Bob'],
				defaultValue: 'Alice',
			});

			const existing = await fixture.manager.getWorkItemWriteOptions(target);
			assert.ok(existing.ok);
			assert.deepEqual(existing.availableStates, [type.states[1]]);
			assert.deepEqual(existing.deleteCapability, { allowed: true });
			assert.equal(existing.bodyField, 'Custom.Background');
			assert.equal(existing.issue.revision, item.rev);
			assert.deepEqual(fixture.mutations(), []);
		} finally {
			fixture.dispose();
		}
	});

	test('refuses unsupported providers before resolving a connection', async () => {
		const fixture = await setup();
		try {
			const input = { ...scope, providerId: GitSelfManagedHostIntegrationId.BitbucketServer };
			assert.deepEqual(await fixture.manager.getWorkItemCreateOptions(input as unknown as WorkItemWriteScope), {
				ok: false,
				reason: 'unsupported',
				mutationDispatched: false,
			});
			assert.deepEqual(fixture.calls, []);
		} finally {
			fixture.dispose();
		}
	});

	test('creates by encoded type name and patches based on the reviewed revision', async () => {
		const fixture = await setup();
		try {
			const created = await fixture.manager.writeWorkItem(create);
			assert.ok(created.ok);
			assert.ok(
				(await fixture.manager.writeWorkItem({ ...create, fields: { 'System.Title': 'Title only' } })).ok,
			);
			const routed = await fixture.manager.writeWorkItem({
				...edit,
				fields: { 'System.AreaPath': `${project.name.toUpperCase()}\\Team` },
			});
			assert.ok(routed.ok);
			assert.equal(created.issue.id, 43);
			assert.equal(created.issue.bodyField, 'Custom.Background');
			const edited = await fixture.manager.writeWorkItem({ ...edit, fields: { 'Custom.Background': null } });
			assert.ok(edited.ok);
			assert.equal(edited.issue.revision, 8);
			const transitioned = await fixture.manager.writeWorkItem(setState);
			assert.ok(transitioned.ok);
			assert.deepEqual(transitioned.issue.state, { name: 'Archived', category: 'Removed' });
			assertVerifiedAddresses(fixture.calls);
			const [posted, titleOnly, routedCall, patched, transitionedCall] = fixture.mutations();
			assert.deepEqual(titleOnly.body, [{ op: 'add', path: '/fields/System.Title', value: 'Title only' }]);
			assert.deepEqual(routedCall.body, [
				{ op: 'test', path: '/rev', value: 7 },
				{ op: 'add', path: '/fields/System.AreaPath', value: `${project.name.toUpperCase()}\\Team` },
			]);
			assert.equal(posted.path, 'wit/workitems/$User%20Story');
			assert.equal(posted.headers.get('content-type'), 'application/json-patch+json');
			assert.deepEqual(posted.body, [
				{ op: 'add', path: '/fields/System.Title', value: 'New title' },
				{ op: 'add', path: '/fields/Custom.Background', value: '<p>Example</p>' },
			]);
			assert.deepEqual(patched.body, [
				{ op: 'test', path: '/rev', value: 7 },
				{ op: 'remove', path: '/fields/Custom.Background' },
			]);
			assert.deepEqual(transitionedCall.body, [
				{ op: 'test', path: '/rev', value: 7 },
				{ op: 'add', path: '/fields/System.State', value: 'Archived' },
			]);
		} finally {
			fixture.dispose();
		}
	});

	test('reports a saved response that names another project, item or state as uncertain', async () => {
		const saved = {
			...item,
			rev: 8,
			fields: { ...item.fields, 'System.State': 'Archived', 'System.Title': 'Edited' },
		};
		const cases = [
			[setState, { ...saved, fields: { ...saved.fields, 'System.TeamProject': secondProject.name } }],
			[setState, { ...saved, id: 43 }],
			[setState, { ...saved, fields: { ...saved.fields, 'System.State': 'Active' } }],
			[create, { ...saved, fields: { ...saved.fields, 'System.TeamProject': secondProject.name } }],
		] as const;
		for (const [input, response] of cases) {
			const fixture = await setup(call => (call.method !== 'GET' ? response : undefined));
			try {
				assert.deepEqual(await fixture.manager.writeWorkItem(input), {
					ok: false,
					reason: 'unknown',
					applied: 'maybe',
				});
				assert.equal(fixture.mutations().length, 1);
			} finally {
				fixture.dispose();
			}
		}
	});

	test('refuses conflicting organization, project, item, account, revision and caller-controlled routing fields', async () => {
		const fixture = await setup();
		try {
			const cases = [
				[{ ...edit, organizationId: otherOrganization.accountId }, 'not-found'],
				[{ ...edit, projectId: secondProject.id }, 'not-found'],
				[{ ...edit, expectedAccountId: 'different-account' }, 'no-connection'],
				[{ ...edit, expectedRevision: item.rev - 1 }, 'conflict'],
				[{ ...edit, connectionId: 'missing' }, 'no-connection'],
				[{ ...edit, workItemId: Number.NaN }, 'invalid-input'],
				[{ ...edit, fields: { 'System.TeamProject': secondProject.name } }, 'invalid-input'],
				[{ ...edit, fields: { 'System.State': 'New' } }, 'invalid-input'],
				[{ ...edit, fields: { 'System.AreaId': 7 } }, 'invalid-input'],
				[{ ...edit, fields: { 'System.IterationId': 7 } }, 'invalid-input'],
				[{ ...edit, fields: { 'System.Parent': 41 } }, 'invalid-input'],
				[{ ...edit, fields: { 'System.BoardColumn': 'Done' } }, 'invalid-input'],
				[{ ...edit, fields: { 'System.AreaPath': `${secondProject.name}\\Team` } }, 'invalid-input'],
				[{ ...setState, fields: { 'System.IterationPath': secondProject.name } }, 'invalid-input'],
				[{ ...create, fields: { ...create.fields, 'System.AreaPath': `${project.name}x` } }, 'invalid-input'],
				[{ ...edit, fields: { 'System.AreaPath': null } }, 'invalid-input'],
				[{ ...create, fields: {} }, 'invalid-input'],
				[{ ...setState, state: 'Closed' }, 'transition-unavailable'],
			] as const;
			for (const [input, reason] of cases) {
				const result = await fixture.manager.writeWorkItem(input);
				assert.ok(!result.ok);
				assert.equal(result.reason, reason);
				assert.equal(result.mutationDispatched, false);
			}
			assert.deepEqual(fixture.mutations(), []);
		} finally {
			fixture.dispose();
		}
	});

	test('confirms a 204 delete through the Recycle Bin once and omits destroy', async () => {
		const fixture = await setup();
		try {
			const resolved = await fixture.manager.resolveWorkItemWriteTarget({ ...target, intent: 'delete' });
			assert.ok(resolved.ok);
			assert.deepEqual(resolved.deleteCapability, { allowed: true });
			const result = await fixture.manager.deleteWorkItem(deletion);
			assert.ok(result.ok);
			assert.deepEqual(result.deletion, {
				disposition: 'recycle-bin',
				restorable: true,
				revision: item.rev + 1,
				deletedAt: deletedAt,
			});
			assert.equal(result.issue.revision, item.rev);
			assert.deepEqual(
				fixture.mutations().map(call => call.url.pathname),
				[`/${organization.accountName}/${project.id}/_apis/wit/workitems/42`],
			);
			assert.equal(fixture.calls.at(-1)?.path, 'wit/recyclebin/42');
			assertVerifiedAddresses(fixture.calls);
			assert.ok(fixture.calls.some(call => call.path === 'wit/workitemtypecategories'));
			assert.ok(fixture.calls.some(call => call.path.startsWith('permissions/')));
		} finally {
			fixture.dispose();
		}
	});

	test('validates the deletion by its body, and reports a confirmed deletion of a changed target', async () => {
		let lastCalls: readonly Call[] = [];
		const deleteReturns = async (body: unknown, recycleBin?: unknown, lookup?: unknown) => {
			const fixture = await setup(call => {
				if (call.method === 'DELETE') return body;
				if (call.path === 'wit/recyclebin/42' && recycleBin !== undefined) return recycleBin;
				if (call.path.startsWith('projects/') && call.path !== `projects/${project.id}`) return lookup;
				return undefined;
			});
			try {
				const result = await fixture.manager.deleteWorkItem(deletion);
				assert.equal(fixture.mutations().length, 1);
				lastCalls = fixture.calls;
				return result;
			} finally {
				fixture.dispose();
			}
		};
		const direct = await deleteReturns(deletedItem({ project: project.id }));
		assert.ok(direct.ok);
		assert.equal(direct.deletion.revision, item.rev + 1);
		assert.equal(lastCalls.at(-1)?.method, 'DELETE');

		const moved = await deleteReturns(deletedItem({ project: secondProject.name }));
		assert.ok(!moved.ok && moved.reason === 'target-changed');
		assert.equal(moved.applied, true);
		assert.deepEqual(moved.project, project);
		assert.deepEqual(moved.deleted, { id: item.id, revision: item.rev + 1, project: secondProject });
		assert.deepEqual(moved.deletion, {
			disposition: 'recycle-bin',
			restorable: true,
			revision: item.rev + 1,
			deletedAt: deletedAt,
		});

		const edited = await deleteReturns(deletedItem({ rev: item.rev + 3 }));
		assert.ok(!edited.ok && edited.reason === 'target-changed');
		assert.deepEqual(edited.deleted, { id: item.id, revision: item.rev + 3, project: project });

		const movedAfter204 = await deleteReturns(new Response(null, { status: 204 }), {
			...deletedItem({ project: secondProject.name }),
			resource: undefined,
		});
		assert.ok(!movedAfter204.ok && movedAfter204.reason === 'target-changed');
		assert.deepEqual(movedAfter204.deleted, { id: item.id, project: secondProject });

		const uncertain = { ok: false, reason: 'unknown', applied: 'maybe' };
		const noContent = () => new Response(null, { status: 204 });
		assert.deepEqual(await deleteReturns(noContent(), deletedItem({ id: 43 })), uncertain);
		assert.deepEqual(await deleteReturns(noContent(), deletedItem({ code: 404 })), uncertain);
		assert.deepEqual(await deleteReturns(noContent(), Response.json({}, { status: 404 })), uncertain);
		assert.deepEqual(await deleteReturns(deletedItem({ id: 43 }), Response.json({}, { status: 404 })), uncertain);
		const undated = { ...deletedItem(), deletedDate: undefined };
		assert.deepEqual(await deleteReturns(undated, Response.json({}, { status: 404 })), uncertain);
		assert.deepEqual(
			await deleteReturns(deletedItem({ code: 404 }), Response.json({}, { status: 404 })),
			uncertain,
		);

		for (const [reported, expected] of [
			['1/5/2026 12:05:00 AM', '2026-01-05T00:05:00.000Z'],
			['1/5/2026 12:05:00 PM', '2026-01-05T12:05:00.000Z'],
		]) {
			const result = await deleteReturns({ ...deletedItem(), deletedDate: reported });
			assert.ok(result.ok);
			assert.equal(result.deletion.deletedAt, expected);
		}
		for (const unrecognized of [
			'2026-11-25T18:24:35Z',
			'25/11/2026 18:24:35',
			'13/25/2026 6:24:35 PM',
			'2/30/2026 6:24:35 PM',
			'11/25/2026 13:24:35 PM',
			'11/25/2026 6:60:35 PM',
			'1/1/0050 1:00:00 AM',
			42,
		]) {
			const result = await deleteReturns({ ...deletedItem(), deletedDate: unrecognized });
			assert.ok(result.ok);
			assert.equal('deletedAt' in result.deletion, false);
		}

		const withoutRevision = { ...deletedItem(), resource: undefined };
		const revisionFromRecycleBin = await deleteReturns(withoutRevision);
		assert.ok(revisionFromRecycleBin.ok);
		assert.equal(revisionFromRecycleBin.deletion.revision, item.rev + 1);
		const notFound = () => Response.json({}, { status: 404 });
		for (const unproven of [
			await deleteReturns(withoutRevision, notFound()),
			await deleteReturns(noContent(), withoutRevision),
		]) {
			assert.ok(!unproven.ok && unproven.reason === 'target-changed');
			assert.deepEqual(unproven.deleted, { id: item.id, project: project });
		}

		const unresolved = await deleteReturns(deletedItem({ project: secondProject.name }), undefined, notFound());
		assert.ok(!unresolved.ok && unresolved.reason === 'target-changed');
		assert.deepEqual(unresolved.deleted.project, { name: secondProject.name });
		const renamed = { id: project.id, name: 'Renamed Project' };
		assert.ok((await deleteReturns(deletedItem({ project: renamed.name }), undefined, renamed)).ok);
		const renamedAndEdited = await deleteReturns(
			deletedItem({ project: renamed.name, rev: item.rev + 2 }),
			undefined,
			renamed,
		);
		assert.ok(!renamedAndEdited.ok && renamedAndEdited.reason === 'target-changed');
		assert.deepEqual(renamedAndEdited.deleted, { id: item.id, revision: item.rev + 2, project: renamed });
		const byId = await deleteReturns(deletedItem({ project: secondProject.id }), undefined, secondProject);
		assert.ok(!byId.ok && byId.reason === 'target-changed');
		assert.deepEqual(byId.deleted.project, secondProject);
	});

	test('maps a failed delete once, without reading the Recycle Bin or retrying', async () => {
		const cases = [
			[() => Response.json({}, { status: 503 }), 'unknown'],
			[
				() => {
					throw new Error('connection lost');
				},
				'unknown',
			],
			[() => Response.json({}, { status: 429 }), 'rate-limit'],
			[() => Response.json({}, { status: 404 }), 'not-found'],
			[() => Response.json({}, { status: 403 }), 'forbidden'],
		] as const;
		for (const [response, reason] of cases) {
			const fixture = await setup(call => (call.method === 'DELETE' ? response() : undefined));
			try {
				const result = await fixture.manager.deleteWorkItem(deletion);
				assert.ok(!result.ok);
				assert.equal(result.reason, reason);
				assert.equal(
					'applied' in result ? result.applied : undefined,
					reason === 'unknown' ? 'maybe' : undefined,
				);
				assert.equal(fixture.mutations().length, 1);
				assert.ok(!fixture.calls.some(call => call.path === 'wit/recyclebin/42'));
			} finally {
				fixture.dispose();
			}
		}
	});

	test('refuses test artifacts by reference name or category, and a denied delete permission', async () => {
		const refused = async (respond: (call: Call) => unknown, reason: string) => {
			const fixture = await setup(respond);
			try {
				const expected = { ok: false, reason: reason, mutationDispatched: false };
				assert.deepEqual(
					await fixture.manager.resolveWorkItemWriteTarget({ ...target, intent: 'delete' }),
					expected,
				);
				const options = await fixture.manager.getWorkItemWriteOptions(target);
				assert.ok(options.ok);
				assert.deepEqual(options.deleteCapability, { allowed: false, reason: reason });
				assert.deepEqual(await fixture.manager.deleteWorkItem(deletion), expected);
				assert.deepEqual(fixture.mutations(), []);
				return fixture.calls;
			} finally {
				fixture.dispose();
			}
		};
		const byReferenceName = await refused(
			call =>
				call.path === 'wit/workitemtypes/User%20Story'
					? { ...type, referenceName: 'Microsoft.VSTS.WorkItemTypes.TestCase' }
					: undefined,
			'unsupported',
		);
		assert.ok(!byReferenceName.some(call => call.path === 'wit/workitemtypecategories'));
		await refused(
			call =>
				call.path === 'wit/workitemtypecategories'
					? { value: [{ referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{ name: type.name }] }] }
					: undefined,
			'unsupported',
		);
		await refused(
			call => (call.path?.startsWith('permissions/') ? { count: 1, value: [false] } : undefined),
			'forbidden',
		);
	});

	test('keeps an unavailable permission check unknown, and refuses delete when test artifacts cannot be ruled out', async () => {
		const probeFails = await setup(call =>
			call.path?.startsWith('permissions/') ? Response.json({}, { status: 403 }) : undefined,
		);
		const categoriesFail = await setup(call =>
			call.path === 'wit/workitemtypecategories' ? Response.json({}, { status: 500 }) : undefined,
		);
		try {
			const options = await probeFails.manager.getWorkItemWriteOptions(target);
			assert.ok(options.ok);
			assert.deepEqual(options.deleteCapability, { allowed: 'unknown' });
			assert.ok((await probeFails.manager.deleteWorkItem(deletion)).ok);

			const unknownOptions = await categoriesFail.manager.getWorkItemWriteOptions(target);
			assert.ok(unknownOptions.ok);
			assert.deepEqual(unknownOptions.deleteCapability, { allowed: 'unknown' });
			assert.deepEqual(await categoriesFail.manager.deleteWorkItem(deletion), {
				ok: false,
				reason: 'unknown',
				mutationDispatched: false,
			});
			assert.deepEqual(categoriesFail.mutations(), []);
		} finally {
			probeFails.dispose();
			categoriesFail.dispose();
		}
	});

	test('rechecks project, revision, type and credential right before the delete', async () => {
		const secondRead = async (change: (current: typeof item) => unknown, reason: string) => {
			let reads = 0;
			let rotate: (() => Promise<unknown>) | undefined;
			const fixture = await setup(async call => {
				if (call.path !== 'wit/workitems/42' || ++reads !== 2) return undefined;

				const changed = change(item);
				if (changed !== 'rotate') return changed;

				await rotate?.();
				return item;
			});
			rotate = fixture.rotate;
			try {
				assert.deepEqual(await fixture.manager.deleteWorkItem(deletion), {
					ok: false,
					reason: reason,
					mutationDispatched: false,
				});
				assert.deepEqual(fixture.mutations(), []);
			} finally {
				fixture.dispose();
			}
		};
		await secondRead(
			current => ({ ...current, fields: { ...current.fields, 'System.TeamProject': secondProject.name } }),
			'not-found',
		);
		await secondRead(current => ({ ...current, rev: current.rev + 1 }), 'conflict');
		await secondRead(
			current => ({ ...current, fields: { ...current.fields, 'System.WorkItemType': 'Bug' } }),
			'conflict',
		);
		await secondRead(() => 'rotate', 'no-connection');
	});

	test('does not dispatch when the selected stored credential changes during preflight', async () => {
		let rotate: (() => Promise<unknown>) | undefined;
		const fixture = await setup(async call => {
			if (call.path === 'wit/fields') {
				await rotate?.();
			}
			return undefined;
		});
		rotate = fixture.rotate;
		try {
			assert.deepEqual(await fixture.manager.writeWorkItem(create), {
				ok: false,
				reason: 'no-connection',
				mutationDispatched: false,
			});
			assert.deepEqual(fixture.mutations(), []);
		} finally {
			fixture.dispose();
		}
	});

	test('refuses personal access tokens before any request, and an unusable credential before dispatch', async () => {
		const pat = await setup(undefined, 'pat');
		const refused = await setup(call =>
			call.path === 'profile/profiles/me' ? Response.json({}, { status: 401 }) : undefined,
		);
		const signIn = await setup(call =>
			call.path === 'accounts'
				? new Response('<html><body>Sign in</body></html>', {
						status: 203,
						headers: { 'content-type': 'text/html; charset=utf-8' },
					})
				: undefined,
		);
		try {
			assert.deepEqual(await signIn.manager.writeWorkItem(edit), {
				ok: false,
				reason: 'no-connection',
				mutationDispatched: false,
			});
			assert.deepEqual(signIn.mutations(), []);
			assert.deepEqual(await pat.manager.writeWorkItem(edit), {
				ok: false,
				reason: 'unsupported',
				mutationDispatched: false,
			});
			assert.deepEqual(pat.calls, []);
			assert.deepEqual(await refused.manager.deleteWorkItem(deletion), {
				ok: false,
				reason: 'no-connection',
				mutationDispatched: false,
			});
			assert.deepEqual(refused.mutations(), []);
		} finally {
			pat.dispose();
			refused.dispose();
			signIn.dispose();
		}
	});

	test('rechecks a host-provided credential before dispatch', async () => {
		let token = 'selected-token';
		let rotateDuringPreflight = false;
		const fixture = await setup(call => {
			if (call.path === 'wit/fields' && rotateDuringPreflight) {
				token = 'rotated-token';
			}
			return undefined;
		});
		const changes = new Emitter<void>();
		assert.ok(fixture.runtime.hooks);
		fixture.runtime.hooks.createAuthenticationProvider = async () => ({
			onDidChange: changes.event,
			getSession: async ({ connectionId }) =>
				connectionId === 'selected'
					? {
							id: connectionId,
							accessToken: token,
							account: { id: 'host-account', label: 'Host account' },
							scopes: ['vso.work_write'],
							cloud: true,
							type: 'oauth',
							domain: 'dev.azure.com',
						}
					: undefined,
			deleteSession: async () => {},
			deleteAllSessions: async () => {},
			dispose: () => changes.dispose(),
		});
		try {
			assert.ok((await fixture.manager.writeWorkItem(create)).ok);
			rotateDuringPreflight = true;
			assert.deepEqual(await fixture.manager.writeWorkItem(create), {
				ok: false,
				reason: 'no-connection',
				mutationDispatched: false,
			});
			assert.equal(fixture.mutations().length, 1);
		} finally {
			fixture.dispose();
		}
	});

	test('classifies provider errors without replaying the mutation or invalidating the read connection', async () => {
		const ruleMessage = 'TF401320: Rule Error for field Sponsor. Error code: Required.';
		const priorityMessage =
			"The field 'Priority' contains the value '99' that is not in the list of supported values";
		const cases = [
			[() => Response.json({ message: ruleMessage }, { status: 400 }), 'invalid-input'],
			[
				() =>
					Response.json(
						{
							customProperties: {
								RuleValidationErrors: [
									{
										fieldReferenceName: 'Microsoft.VSTS.Common.Priority',
										fieldStatusFlags: 'required, hasValues, invalidListValue',
										errorMessage: priorityMessage,
									},
								],
							},
							message: priorityMessage,
							typeKey: 'RuleValidationException',
							errorCode: 0,
							eventId: 3200,
						},
						{ status: 400 },
					),
				'invalid-input',
			],
			[
				() =>
					Response.json(
						{
							message:
								'VS403351: Test Operation for path /rev failed, value 8 was not equal to test value 7.',
							typeKey: 'TestPatchOperationFailedException',
							errorCode: 0,
							eventId: 3000,
						},
						{ status: 412 },
					),
				'conflict',
			],
			[() => Response.json({ typeKey: 'WorkItemRevisionMismatchException' }, { status: 400 }), 'conflict'],
			[() => Response.json({}, { status: 409 }), 'conflict'],
			[() => Response.json({}, { status: 429 }), 'rate-limit'],
			[() => Response.json({}, { status: 404 }), 'not-found'],
			[() => Response.json({}, { status: 403 }), 'forbidden'],
			[() => new Response(null, { status: 401 }), 'forbidden'],
			[
				() =>
					Response.json(
						{},
						{ status: 401, headers: { 'www-authenticate': 'Bearer error="insufficient_scope"' } },
					),
				'insufficient-scope',
			],
			[() => Response.json({}, { status: 503 }), 'unknown'],
			[
				() => {
					throw new Error('connection lost');
				},
				'unknown',
			],
		] as const;
		for (const [response, reason] of cases) {
			const fixture = await setup(call => (call.method === 'PATCH' ? response() : undefined));
			try {
				const result = await fixture.manager.writeWorkItem(setState);
				assert.ok(!result.ok);
				assert.equal(result.reason, reason);
				assert.equal(result.applied, reason === 'unknown' ? 'maybe' : undefined);
				assert.equal(result.mutationDispatched, undefined);
				assert.equal(fixture.mutations().length, 1);
				assert.ok((await fixture.manager.getWorkItemWriteOptions(target)).ok);
				const stored = await fixture.configured.peekStoredSession(
					providerId,
					'selected',
					true,
					'dev.azure.com',
				);
				assert.ok(stored);
				assert.equal(stored.accessToken, 'selected-token');
				assert.equal(stored.expiresAt, undefined);
			} finally {
				fixture.dispose();
			}
		}

		const rule = await setup(call => (call.method === 'PATCH' ? cases[0][0]() : undefined));
		const priority = await setup(call => (call.method === 'PATCH' ? cases[1][0]() : undefined));
		try {
			const sponsor = await rule.manager.writeWorkItem(setState);
			assert.ok(!sponsor.ok);
			assert.deepEqual(sponsor.messages, [ruleMessage]);
			assert.deepEqual(sponsor.fieldErrors, { 'Custom.Sponsor': ruleMessage });
			const invalid = await priority.manager.writeWorkItem(setState);
			assert.ok(!invalid.ok);
			assert.deepEqual(invalid.messages, [priorityMessage]);
			assert.deepEqual(invalid.fieldErrors, { 'Microsoft.VSTS.Common.Priority': priorityMessage });
		} finally {
			rule.dispose();
			priority.dispose();
		}
	});
});
