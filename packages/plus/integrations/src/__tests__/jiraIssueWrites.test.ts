import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { defer } from '@gitlens/utils/promise.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import type { IssueTrackerDeleteOptions, IssueTrackerWriteConnection, IssueTrackerWriteOptions } from '../index.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

const siteA = { id: 'site-a', url: 'https://a.atlassian.net', scopes: ['delete:issue:jira'] };
const siteB = { id: 'site-b', url: 'https://b.atlassian.net', scopes: ['write:issue:jira'] };
const connection = {
	providerId: IssuesCloudHostIntegrationId.Jira,
	connectionId: 'selected',
	resourceId: siteA.id,
} satisfies IssueTrackerWriteConnection;
const project = { id: '890', key: 'ABC' };
const issueType = { id: '10002', name: 'Bug' };
const status = { id: '9', name: 'Triage', statusCategory: { key: 'new' } };
const fixed = { id: '17', name: 'Fixed', statusCategory: { key: 'done' } };
const issue = {
	id: '123',
	key: 'ABC-42',
	fields: { project: project, issuetype: issueType, summary: 'Original', status: status, subtasks: [] },
};
const address = { ...connection, issue: issue.key, expectedIssueId: issue.id };
const create = {
	...connection,
	action: 'create',
	project: project.key,
	issueTypeId: issueType.id,
	summary: 'Created',
	description: 'h2. Jira wiki',
	fields: { customfield_10010: { id: '1' } },
} satisfies IssueTrackerWriteOptions;
const edit = { ...address, action: 'edit', summary: 'Edited' } satisfies IssueTrackerWriteOptions;
const transition = {
	...address,
	action: 'transition',
	transitionId: '12',
	fields: { resolution: { id: '8' } },
} satisfies IssueTrackerWriteOptions;
const deletion = { ...address, expectedAccountId: 'actual-account' } satisfies IssueTrackerDeleteOptions;
const field = { name: 'Text', required: true, operations: ['set'], schema: { type: 'string' } };
const editFields = { summary: field, description: { ...field, required: false } };
const createFields = [
	...Object.entries(editFields).map(([id, data]) => ({ ...data, fieldId: id })),
	{ ...field, fieldId: 'customfield_10010', allowedValues: [{ id: '1' }], hasDefaultValue: true },
];
const transitions = [
	{
		id: '12',
		name: 'Fix issue',
		to: fixed,
		hasScreen: true,
		isAvailable: true,
		isConditional: true,
		fields: { resolution: field, summary: { ...field, required: false } },
	},
	{ id: '55', name: 'Reopen', to: status, hasScreen: false, isAvailable: false },
];
const receipt = {
	resourceId: siteA.id,
	siteUrl: siteA.url,
	id: issue.id,
	key: issue.key,
	url: `${siteA.url}/browse/${issue.key}`,
	project: project,
	issueType: issueType,
	summary: 'Original',
	status: { id: '9', name: 'Triage', category: 'TO_DO' },
};

type Call = { method: string; url: URL; path: string; body: unknown; token: string | null; resourceId?: string };

async function setup(respond?: (call: Call) => object | undefined | Promise<object | undefined>) {
	const runtime = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(runtime);
	for (const id of ['primary', 'selected']) {
		await configured.storeSession(connection.providerId, {
			id: id,
			accessToken: `token-${id}`,
			account: { id: 'backend-id', label: 'backend-label' },
			scopes: ['write:issue:jira'],
			cloud: true,
			type: 'oauth',
			domain: 'atlassian.net',
		});
	}

	configured.dispose();

	const calls: Call[] = [];
	const errors: string[] = [];
	let liveIssue = issue;
	runtime.http.fetch = async (input, init) => {
		const url = new URL(String(input));
		const [, resourceId, path = url.pathname] =
			/^\/ex\/jira\/([^/]+)\/rest\/api\/2(\/.*)$/.exec(url.pathname) ?? [];
		assert.equal(url.origin, 'https://api.atlassian.com');
		assert.equal(init?.redirect, 'error');
		const call: Call = {
			method: init?.method ?? 'GET',
			url: url,
			path: path,
			body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
			token: new Headers(init?.headers).get('authorization'),
			resourceId: resourceId,
		};
		calls.push(call);
		assert.equal(call.token, 'Bearer token-selected');
		const response = await respond?.(call);
		if (response != null) return response instanceof Response ? response : Response.json(response);

		switch (`${call.method} ${path}`) {
			case 'GET /oauth/token/accessible-resources':
				return Response.json([
					{ ...siteA, url: 'https://unrelated.atlassian.net', scopes: ['read:confluence-content.all'] },
					siteA,
					siteB,
				]);
			case 'GET /myself':
				return Response.json({ accountId: 'actual-account' });
			case 'GET /project/ABC':
			case 'GET /project/890':
				return Response.json(project);
			case 'GET /issue/createmeta/890/issuetypes':
				return Response.json({ startAt: 0, total: 1, issueTypes: [issueType] });
			case 'GET /issue/createmeta/890/issuetypes/10002':
				return Response.json({ startAt: 0, total: createFields.length, fields: createFields });
			case 'GET /issue/ABC-42':
			case 'GET /issue/abc-42':
			case 'GET /issue/123':
				return Response.json(
					resourceId === siteB.id
						? { ...liveIssue, fields: { ...liveIssue.fields, summary: 'On site B' } }
						: liveIssue,
				);
			case 'GET /mypermissions':
				if (url.searchParams.has('projectId')) {
					assert.equal(url.searchParams.get('projectId'), project.id);
					assert.equal(url.searchParams.get('permissions'), 'CREATE_ISSUES');
					return Response.json({ permissions: { CREATE_ISSUES: { havePermission: true } } });
				}

				assert.equal(url.searchParams.get('issueId'), issue.id);
				assert.equal(url.searchParams.get('permissions'), 'EDIT_ISSUES,TRANSITION_ISSUES,DELETE_ISSUES');
				return Response.json({
					permissions: Object.fromEntries(
						['EDIT_ISSUES', 'TRANSITION_ISSUES', 'DELETE_ISSUES'].map(key => [
							key,
							{ havePermission: true },
						]),
					),
				});
			case 'GET /issue/123/editmeta':
				return Response.json({ fields: editFields });
			case 'GET /issue/123/transitions':
				assert.equal(url.searchParams.get('expand'), 'transitions.fields');
				return Response.json({ transitions: transitions });
			case 'POST /issue':
				liveIssue = { ...issue, fields: { ...issue.fields, summary: 'Created' } };
				return Response.json({ id: issue.id, key: issue.key }, { status: 201 });
			case 'PUT /issue/123':
				liveIssue = { ...issue, fields: { ...issue.fields, summary: 'Edited' } };
				return new Response(null, { status: 204 });
			case 'POST /issue/123/transitions':
				liveIssue = { ...issue, fields: { ...issue.fields, status: fixed } };
				return new Response(null, { status: 204 });
			case 'DELETE /issue/123':
				return new Response(null, { status: 204 });
			default:
				assert.fail(`Unexpected request: ${call.method} ${url.toString()}`);
		}
	};
	const manager = createIntegrationManager({
		...runtime,
		hooks: { ...runtime.hooks, ui: { onError: error => errors.push(error) } },
	});
	return {
		manager: manager,
		runtime: runtime,
		calls: calls,
		errors: errors,
		mutations: () => calls.filter(call => call.method !== 'GET'),
	};
}

suite('IntegrationManager Jira Cloud issue writes', () => {
	test('reads issue types and drains create fields for the canonical project', async () => {
		const { manager, mutations } = await setup(({ path, url }) => {
			if (!path.endsWith('/issuetypes/10002')) return undefined;

			const startAt = Number(url.searchParams.get('startAt'));
			assert.equal(url.searchParams.get('maxResults'), '50');
			return { startAt: startAt, total: createFields.length, fields: createFields.slice(startAt, startAt + 1) };
		});
		try {
			const { project: projectKey, issueTypeId, ...options } = create;
			const scope = { ...options, project: projectKey };
			const types = await manager.getIssueTrackerCreateOptions(scope);
			assert.deepEqual(types, {
				ok: true,
				resourceId: siteA.id,
				siteUrl: siteA.url,
				accountId: 'actual-account',
				project: project,
				truncated: false,
				issueTypes: [issueType],
			});
			const result = await manager.getIssueTrackerCreateOptions({ ...scope, issueTypeId: issueTypeId });
			assert.ok(result.ok && 'fields' in result);
			assert.equal(result.truncated, false);
			assert.deepEqual(
				result.fields.map(value => value.fieldId),
				['summary', 'description', 'customfield_10010'],
			);
			assert.deepEqual(result.fields[2].allowedValues, [{ id: '1' }]);
			assert.equal(result.fields[2].hasDefaultValue, true);
			assert.equal(mutations().length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('reports capped create metadata', async () => {
		const { manager } = await setup(({ path, url }) => {
			if (!path.endsWith('/issuetypes')) return undefined;

			return { startAt: Number(url.searchParams.get('startAt')), total: 21, issueTypes: [issueType] };
		});
		try {
			const result = await manager.getIssueTrackerCreateOptions({ ...connection, project: project.key });
			assert.ok(result.ok && 'issueTypes' in result);
			assert.equal(result.truncated, true);
			assert.equal(result.issueTypes.length, 20);
		} finally {
			manager.dispose();
		}
	});

	test('returns screen fields, workflow destinations and site grant capability', async () => {
		const { manager } = await setup();
		try {
			const result = await manager.getIssueTrackerIssueWriteOptions({ ...address, resourceId: siteB.id });
			assert.ok(result.ok);
			assert.deepEqual(result.issue, {
				...receipt,
				resourceId: siteB.id,
				siteUrl: siteB.url,
				url: `${siteB.url}/browse/${issue.key}`,
				summary: 'On site B',
			});
			assert.equal(result.accountId, 'actual-account');
			assert.deepEqual(result.permissions, { edit: true, transition: true, delete: true });
			assert.deepEqual(result.deleteCapability, { allowed: false, reason: 'insufficient-scope' });
			assert.deepEqual(
				result.fields.map(value => value.fieldId),
				['summary', 'description'],
			);
			assert.deepEqual(result.transitions[0].to, { id: '17', name: 'Fixed', category: 'DONE' });
			assert.equal(result.transitions[0].isConditional, true);
			assert.equal(result.transitions[0].fields[0].required, true);
			assert.equal(result.transitions[1].isAvailable, false);
		} finally {
			manager.dispose();
		}
	});

	const writes = [
		{
			options: create,
			method: 'POST',
			path: '/issue',
			body: {
				fields: {
					summary: create.summary,
					description: create.description,
					...create.fields,
					project: { id: project.id },
					issuetype: { id: issueType.id },
				},
			},
			updated: { summary: 'Created' },
		},
		{
			options: edit,
			method: 'PUT',
			path: '/issue/123',
			body: { fields: { summary: 'Edited' } },
			updated: { summary: 'Edited' },
		},
		{
			options: transition,
			method: 'POST',
			path: '/issue/123/transitions',
			body: { transition: { id: '12' }, fields: transition.fields },
			updated: { status: { id: '17', name: 'Fixed', category: 'DONE' } },
		},
	] as const;
	for (const { options, method, path, body, updated } of writes) {
		test(`returns a canonical receipt after ${options.action}`, async () => {
			const { manager, calls, mutations } = await setup();
			try {
				assert.deepEqual(await manager.writeIssueTrackerIssue(options), {
					ok: true,
					accountId: 'actual-account',
					issue: { ...receipt, ...updated },
				});
				const [mutation] = mutations();
				assert.equal(mutations().length, 1);
				assert.equal(mutation.method, method);
				assert.equal(mutation.path, path);
				assert.equal(mutation.resourceId, siteA.id);
				assert.deepEqual(mutation.body, body);
				assert.equal(calls.at(-1)?.path, '/issue/123');
			} finally {
				manager.dispose();
			}
		});
	}

	test('resolves the delete target and confirms only the canonical non-cascading DELETE', async () => {
		const { manager, mutations } = await setup();
		try {
			const { expectedAccountId, ...target } = deletion;
			const resolved = await manager.resolveIssueTrackerIssueWriteTarget({ ...target, intent: 'delete' });
			assert.deepEqual(resolved, { ok: true, accountId: expectedAccountId, issue: receipt });
			assert.equal(mutations().length, 0);
			assert.deepEqual(await manager.deleteIssueTrackerIssue(deletion), resolved);
			const [mutation] = mutations();
			assert.equal(mutations().length, 1);
			assert.equal(mutation.method, 'DELETE');
			assert.equal(mutation.path, '/issue/123');
			assert.equal(mutation.url.searchParams.get('deleteSubtasks'), 'false');
		} finally {
			manager.dispose();
		}
	});

	test('treats a DELETE response without a 204 acknowledgement as uncertain', async () => {
		const { manager, mutations } = await setup(({ method }) =>
			method === 'DELETE' ? Response.json({}) : undefined,
		);
		try {
			assert.deepEqual(await manager.deleteIssueTrackerIssue(deletion), {
				ok: false,
				reason: 'unknown',
				applied: 'maybe',
			});
			assert.equal(mutations().length, 1);
		} finally {
			manager.dispose();
		}
	});

	for (const change of ['disconnect', 'rotate', 'rotate and restore'] as const) {
		test(`refuses to dispatch a delete after credential ${change} during preflight`, async () => {
			const preflight = defer<void>();
			const resume = defer<void>();
			const { manager, runtime, mutations } = await setup(async ({ path }) => {
				if (path === '/mypermissions') {
					preflight.fulfill();
					await resume.promise;
				}
				return undefined;
			});
			const pending = manager.deleteIssueTrackerIssue(deletion);
			const configured = new ConfiguredIntegrationService(runtime);
			try {
				await preflight.promise;
				const { providerId, connectionId } = deletion;
				if (change === 'disconnect') {
					await configured.deleteConnection(providerId, connectionId, true);
				} else {
					const session = await configured.peekStoredSession(providerId, connectionId, true, 'atlassian.net');
					assert.ok(session);
					await configured.storeSession(providerId, { ...session, accessToken: 'rotated-token' });
					if (change === 'rotate and restore') {
						await configured.storeSession(providerId, session);
					}
				}
				resume.fulfill();
				assert.deepEqual(await pending, { ok: false, reason: 'no-connection', mutationDispatched: false });
				assert.equal(mutations().length, 0);
			} finally {
				resume.fulfill();
				await pending;
				configured.dispose();
				manager.dispose();
			}
		});
	}

	test('routes identical keys and IDs to the explicitly selected site', async () => {
		const { manager, mutations } = await setup();
		try {
			const first = await manager.writeIssueTrackerIssue(edit);
			const second = await manager.writeIssueTrackerIssue({ ...edit, resourceId: siteB.id });
			assert.ok(first.ok && second.ok);
			assert.equal(first.issue.url, `${siteA.url}/browse/${issue.key}`);
			assert.equal(second.issue.url, `${siteB.url}/browse/${issue.key}`);
			assert.deepEqual(
				mutations().map(call => call.resourceId),
				[siteA.id, siteB.id],
			);
		} finally {
			manager.dispose();
		}
	});

	test('refuses an unknown connection, site or account before an issue is read', async () => {
		const { manager, calls } = await setup();
		try {
			assert.deepEqual(await manager.writeIssueTrackerIssue({ ...edit, connectionId: 'missing' }), {
				ok: false,
				reason: 'no-connection',
				mutationDispatched: false,
			});
			assert.equal(calls.length, 0);
			assert.deepEqual(await manager.writeIssueTrackerIssue({ ...edit, resourceId: 'missing' }), {
				ok: false,
				reason: 'not-found',
				mutationDispatched: false,
			});
			assert.deepEqual(await manager.deleteIssueTrackerIssue({ ...deletion, expectedAccountId: 'other' }), {
				ok: false,
				reason: 'forbidden',
				mutationDispatched: false,
			});
			assert.ok(
				calls.every(call => call.path === '/oauth/token/accessible-resources' || call.path === '/myself'),
			);
		} finally {
			manager.dispose();
		}
	});

	test('rejects stale IDs and moved keys, and accepts the canonical address case-insensitively', async () => {
		const { manager, mutations } = await setup(({ path }) => (path === '/issue/OLD-12' ? issue : undefined));
		try {
			for (const options of [
				{ ...edit, expectedIssueId: '456' },
				{ ...edit, issue: 'OLD-12' },
			]) {
				assert.deepEqual(await manager.writeIssueTrackerIssue(options), {
					ok: false,
					reason: 'conflict',
					mutationDispatched: false,
				});
			}
			assert.equal(mutations().length, 0);
			assert.ok((await manager.writeIssueTrackerIssue({ ...edit, issue: 'abc-42' })).ok);
			assert.equal(mutations()[0].path, '/issue/123');
		} finally {
			manager.dispose();
		}
	});

	test('rejects unavailable transitions and fields outside the appropriate screen', async () => {
		const { manager, mutations } = await setup();
		try {
			assert.deepEqual(await manager.writeIssueTrackerIssue({ ...transition, transitionId: '55' }), {
				ok: false,
				reason: 'transition-unavailable',
				mutationDispatched: false,
			});
			for (const options of [
				{ ...create, fields: { project: { id: '999' } } },
				{ ...edit, fields: { summary: 'override' } },
				{ ...transition, fields: { customfield_10010: 'off screen' } },
			]) {
				const result = await manager.writeIssueTrackerIssue(options);
				assert.ok(!result.ok);
				assert.equal(result.reason, 'invalid-input');
				assert.equal(result.mutationDispatched, false);
				assert.deepEqual(Object.keys(result.fieldErrors ?? {}), Object.keys(options.fields));
			}
			assert.equal(mutations().length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('sends a summary or description the transition screen sets, and refuses one it does not', async () => {
		const { manager, mutations } = await setup();
		try {
			const result = await manager.writeIssueTrackerIssue({ ...transition, summary: 'Fixed title' });
			assert.ok(result.ok);
			const [posted] = mutations();
			assert.equal(posted.path, '/issue/123/transitions');
			assert.deepEqual(posted.body, {
				transition: { id: '12' },
				fields: { ...transition.fields, summary: 'Fixed title' },
			});

			const refused = await manager.writeIssueTrackerIssue({ ...transition, description: 'Not on screen' });
			assert.ok(!refused.ok);
			assert.equal(refused.reason, 'invalid-input');
			assert.equal(refused.mutationDispatched, false);
			assert.deepEqual(refused.fieldErrors, { description: 'field-not-settable' });
			assert.equal(mutations().length, 1);
		} finally {
			manager.dispose();
		}
	});

	test('refuses deletion before approval if the site grant is missing the scope', async () => {
		const { manager, mutations } = await setup();
		try {
			assert.deepEqual(
				await manager.resolveIssueTrackerIssueWriteTarget({
					...deletion,
					resourceId: siteB.id,
					intent: 'delete',
				}),
				{
					ok: false,
					reason: 'insufficient-scope',
					mutationDispatched: false,
				},
			);
			assert.deepEqual(await manager.deleteIssueTrackerIssue({ ...deletion, resourceId: siteB.id }), {
				ok: false,
				reason: 'insufficient-scope',
				mutationDispatched: false,
			});
			assert.equal(mutations().length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('refuses deletion of an issue with subtasks', async () => {
		const { manager, mutations } = await setup(({ path }) =>
			path === '/issue/ABC-42' ? { ...issue, fields: { ...issue.fields, subtasks: [{ id: '124' }] } } : undefined,
		);
		try {
			assert.deepEqual(await manager.deleteIssueTrackerIssue(deletion), {
				ok: false,
				reason: 'invalid-input',
				mutationDispatched: false,
			});
			assert.equal(mutations().length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('honors missing permissions before dispatch', async () => {
		const { manager, mutations } = await setup(({ path }) =>
			path === '/mypermissions' ? { permissions: {} } : undefined,
		);
		try {
			for (const result of [
				await manager.writeIssueTrackerIssue(create),
				await manager.writeIssueTrackerIssue(edit),
				await manager.writeIssueTrackerIssue(transition),
				await manager.deleteIssueTrackerIssue(deletion),
			]) {
				assert.deepEqual(result, { ok: false, reason: 'forbidden', mutationDispatched: false });
			}
			assert.equal(mutations().length, 0);
		} finally {
			manager.dispose();
		}
	});

	const fieldErrors = { customfield_10010: 'Field is required.' };
	const messages = ['Check the fields.'];
	const refusals = [
		{
			status: 400,
			body: { errors: fieldErrors, errorMessages: messages },
			failure: { reason: 'invalid-input', fieldErrors: fieldErrors, messages: messages },
		},
		{ status: 403, body: {}, failure: { reason: 'forbidden' } },
		{ status: 404, body: {}, failure: { reason: 'not-found' } },
		{ status: 409, body: {}, failure: { reason: 'conflict' } },
		{
			status: 401,
			body: { message: 'Unauthorized; scope does not match' },
			failure: { reason: 'insufficient-scope' },
		},
		{ status: 429, body: {}, failure: { reason: 'rate-limit' } },
		{ status: 500, body: {}, failure: { reason: 'unknown', applied: 'maybe' } },
	];
	for (const { status: statusCode, body, failure } of refusals) {
		test(`classifies HTTP ${statusCode} from the mutation endpoint`, async () => {
			const { manager, mutations, errors } = await setup(({ method }) =>
				method === 'GET' ? undefined : Response.json(body, { status: statusCode }),
			);
			try {
				const attempts = statusCode === 401 ? 4 : 1;
				for (let index = 0; index < attempts; index++) {
					assert.deepEqual(await manager.writeIssueTrackerIssue(create), { ok: false, ...failure });
				}
				assert.equal(mutations().length, attempts);
				assert.deepEqual(errors, []);
				assert.ok((await manager.resolveIssueTrackerIssueWriteTarget(address)).ok);
			} finally {
				manager.dispose();
			}
		});
	}

	test('retains Jira validation details for edit and transition', async () => {
		const { manager } = await setup(({ method }) =>
			method === 'GET' ? undefined : Response.json({ errors: { summary: 'Invalid value' } }, { status: 422 }),
		);
		try {
			for (const options of [edit, transition]) {
				assert.deepEqual(await manager.writeIssueTrackerIssue(options), {
					ok: false,
					reason: 'invalid-input',
					fieldErrors: { summary: 'Invalid value' },
				});
			}
		} finally {
			manager.dispose();
		}
	});

	test('distinguishes a failed preflight from a lost response after dispatch', async () => {
		const { manager, mutations } = await setup(({ method, path }) => {
			if (method === 'DELETE' || path === '/project/ABC') throw new Error('connection lost');

			return undefined;
		});
		try {
			assert.deepEqual(await manager.writeIssueTrackerIssue(create), {
				ok: false,
				reason: 'unknown',
				mutationDispatched: false,
			});
			assert.deepEqual(await manager.deleteIssueTrackerIssue(deletion), {
				ok: false,
				reason: 'unknown',
				applied: 'maybe',
			});
			assert.equal(mutations().length, 1);
		} finally {
			manager.dispose();
		}
	});
});
