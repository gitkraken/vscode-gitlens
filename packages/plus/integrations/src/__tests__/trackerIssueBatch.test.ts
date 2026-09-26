import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { RequestClientError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { GetIssueFn, ProviderIssue } from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub } from './sweepHelpers.js';

/**
 * The batch issue read's TRACKER form (#5810): `(resourceId, ABC-123)` targets on Jira and Linear.
 *
 * The read is uncached, so what these pin is the distinction it exists for: an absent slot is a PROVEN ABSENCE,
 * safe to cache, while a target whose read failed — including a lost session — is not returned at all.
 */

function trackerSession(
	domain: string,
	id: string = 'primary',
	accessToken: string = 'tok',
): ProviderAuthenticationSession {
	return {
		id: id,
		accessToken: accessToken,
		account: { id: id, label: id },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

function providerIssue(key: string, title: string = `issue ${key}`): ProviderIssue {
	return {
		id: `uuid-${key}`,
		number: key,
		title: title,
		url: `https://example.atlassian.net/browse/${key}`,
		createdDate: new Date('2026-01-01T00:00:00Z'),
		updatedDate: new Date('2026-01-02T00:00:00Z'),
		labels: [],
	} as unknown as ProviderIssue;
}

const jiraResourceUrl = 'https://example.atlassian.net';

function jiraTarget(identifier: string, key: string = identifier) {
	return { key: key, resourceId: 'org-1', resourceUrl: jiraResourceUrl, identifier: identifier };
}

function jiraIssueResponse(
	key: string,
	statusCategory: string = 'To Do',
	statusCategoryKey: string = statusCategory === 'Done' ? 'done' : 'new',
): Record<string, unknown> {
	return {
		id: `uuid-${key}`,
		key: key,
		self: `https://api.atlassian.com/ex/jira/org-1/rest/api/2/issue/${key}`,
		fields: {
			assignee: null,
			comment: { total: 0, comments: [] },
			created: '2026-01-01T00:00:00Z',
			creator: null,
			description: 'h2. Details\n\n{code}example{code}',
			issuetype: { name: 'Task' },
			labels: [],
			project: { id: 'project-1', key: 'ABC', name: 'ABC' },
			status: {
				id: statusCategory === 'Done' ? 'done' : 'todo',
				name: statusCategory,
				statusCategory: { colorName: 'blue-gray', key: statusCategoryKey, name: statusCategory },
			},
			summary: `issue ${key}`,
			updated: '2026-01-02T00:00:00Z',
			votes: { votes: 0 },
		},
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

function getRequestExceptionCount(integration: IssuesIntegration): number {
	return (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

async function connectedTracker(
	runtime: ReturnType<typeof createFakeRuntime>,
	id: IssuesCloudHostIntegrationId.Jira | IssuesCloudHostIntegrationId.Linear,
) {
	const manager = createIntegrationManager(runtime);
	const integration = await manager.get(id);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession(
		id === IssuesCloudHostIntegrationId.Jira ? 'atlassian.net' : 'linear.app',
	);
	return { manager: manager, integration: integration };
}

async function connectedJira(runtime: ReturnType<typeof createFakeRuntime>, api: Record<string, unknown>) {
	const { manager, integration } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Jira);
	stubApi(integration, api);
	return { manager: manager, jira: integration };
}

async function stubLinearGetIssueFn(
	manager: ReturnType<typeof createIntegrationManager>,
	implementation: GetIssueFn,
): Promise<void> {
	const api = await (manager as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();
	const providers = (api as unknown as { providers: Record<string, { getIssueFn?: GetIssueFn } | undefined> })
		.providers;
	const provider = providers[IssuesCloudHostIntegrationId.Linear];
	assert.ok(provider != null);
	provider.getIssueFn = implementation;
}

suite('IntegrationManager.getIssuesBatch — tracker targets (#5810)', () => {
	test('resolves the supplied resource and identifier with one provider request and no discovery', async () => {
		const runtime = createFakeRuntime();
		const requests: Array<{ init?: RequestInit; url: string }> = [];
		runtime.http.fetch = (input, init) => {
			requests.push({ url: input.toString(), init: init });
			return Promise.resolve(jsonResponse(200, jiraIssueResponse('ABC-123')));
		};
		const { manager } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Jira);

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-123', 'my-key')],
		});

		assert.equal(requests.length, 1);
		assert.match(requests[0].url, /\/org-1\/rest\/api\/2\/issue\/ABC-123\?/);
		assert.equal(new Headers(requests[0].init?.headers).get('authorization'), 'Bearer tok');
		assert.equal(result.items[0]?.key, 'my-key', 'results carry the caller key, not the identifier');
		assert.equal(result.items[0]?.issue?.id, 'ABC-123');
		assert.equal(result.items[0]?.issue?.url, `${jiraResourceUrl}/browse/ABC-123`);
		assert.equal(result.items[0]?.issue?.body, 'h2. Details\n\n{code}example{code}');
		assert.equal(result.items[0]?.issue?.bodyFormat, 'jira-wiki');
		assert.equal(result.items[0]?.issue?.state, 'opened');
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('uses Jira status keys rather than localized display names', async () => {
		const runtime = createFakeRuntime();
		runtime.http.fetch = () =>
			Promise.resolve(jsonResponse(200, jiraIssueResponse('ABC-125', 'En curso', 'indeterminate')));
		const { manager } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Jira);

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-125')],
		});

		assert.equal(result.items[0]?.issue?.closed, false);
		assert.equal(result.items[0]?.issue?.state, 'opened');
		assert.deepEqual(result.items[0]?.issue?.providerState, {
			id: 'todo',
			name: 'En curso',
			color: 'blue-gray',
			category: 'IN_PROGRESS',
		});

		manager.dispose();
	});

	test('maps a completed Jira status without a second request', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(jsonResponse(200, jiraIssueResponse('ABC-124', 'Done')));
		};
		const { manager } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Jira);

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-124')],
		});

		assert.equal(requests, 1);
		assert.equal(result.items[0]?.issue?.closed, true);
		assert.equal(result.items[0]?.issue?.state, 'closed');

		manager.dispose();
	});

	test('normalizes a real Jira 404 into a proven absence', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(jsonResponse(404, { message: 'Issue does not exist' }));
		};
		const { manager } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Jira);

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-404')],
		});

		assert.deepEqual(result.items, [{ key: 'ABC-404' }]);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(requests, 1);

		manager.dispose();
	});

	test('reports Jira 410 or 422 responses as failures, never as proven absences', async () => {
		for (const status of [410, 422]) {
			const runtime = createFakeRuntime();
			runtime.http.fetch = () =>
				Promise.resolve(jsonResponse(status, { message: 'The issue request could not be served' }));
			const { manager } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Jira);

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [jiraTarget(`ABC-${status}`)],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);

			manager.dispose();
		}
	});

	test('resolves a Linear issue from the bare resource id and maps its workflow state', async () => {
		const { manager } = await connectedTracker(createFakeRuntime(), IssuesCloudHostIntegrationId.Linear);
		const inputs: Parameters<GetIssueFn>[0][] = [];
		await stubLinearGetIssueFn(manager, input => {
			inputs.push(input);
			return Promise.resolve({
				data: {
					...providerIssue('ENG-123'),
					state: { id: 'done', name: 'Done', color: null, category: 'DONE' },
				},
			});
		});

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Linear,
			targets: [{ key: 'ENG-123', resourceId: 'workspace-1', identifier: 'ENG-123' }],
		});

		// The id reaches the SDK as given. Routed through a synthesized descriptor instead, Linear's
		// descriptor-checked read would answer `undefined` without a request, published as a proven absence.
		assert.deepEqual(inputs, [{ resourceId: 'workspace-1', number: 'ENG-123' }]);
		assert.equal(result.items[0]?.issue?.id, 'ENG-123');
		assert.equal(result.items[0]?.issue?.closed, true);
		assert.equal(result.items[0]?.issue?.state, 'closed');
		assert.deepEqual(result.items[0]?.issue?.providerState, {
			id: 'done',
			name: 'Done',
			color: undefined,
			category: 'DONE',
		});
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('classifies a Linear GraphQL rate limit from the real provider path', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(
				jsonResponse(400, {
					errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }],
				}),
			);
		};
		const { manager } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Linear);

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Linear,
			targets: [{ key: 'ENG-429', resourceId: 'workspace-1', identifier: 'ENG-429' }],
		});

		assert.equal(requests, 1);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'rate-limit');

		manager.dispose();
	});

	test('normalizes the Linear SDK missing-issue error into a proven absence', async () => {
		const { manager } = await connectedTracker(createFakeRuntime(), IssuesCloudHostIntegrationId.Linear);
		await stubLinearGetIssueFn(manager, () => Promise.reject(new Error('Linear issue not found: ENG-404')));

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Linear,
			targets: [{ key: 'ENG-404', resourceId: 'workspace-1', identifier: 'ENG-404' }],
		});

		assert.deepEqual(result.items, [{ key: 'ENG-404' }]);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('reports Linear transport failures as failures on every call, never as proven absences', async () => {
		for (const status of [410, 422]) {
			const runtime = createFakeRuntime();
			let requests = 0;
			runtime.http.fetch = () => {
				requests++;
				return Promise.resolve(
					jsonResponse(status, { errors: [{ message: 'The issue request could not be served' }] }),
				);
			};
			const { manager } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Linear);

			const options = {
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: [{ key: `ENG-${status}`, resourceId: 'workspace-1', identifier: `ENG-${status}` }],
			};
			const first = await manager.getIssuesBatch(options);
			const second = await manager.getIssuesBatch(options);

			assert.equal(requests, 2);
			assert.deepEqual(first.items, []);
			assert.equal(first.fetchFailed, true);
			assert.equal(first.warnings.length, 1);
			assert.deepEqual(second.items, []);
			assert.equal(second.fetchFailed, true);

			manager.dispose();
		}
	});

	test('returns no item when the provider request fails', async () => {
		const { manager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: () => Promise.reject(new Error('upstream exploded')),
		});

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-123')],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);

		manager.dispose();
	});

	test('a failed read is not remembered: the next call asks again', async () => {
		let calls = 0;
		const { manager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: () => {
				calls++;
				return calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve(providerIssue('ABC-123'));
			},
		});

		const options = { providerId: IssuesCloudHostIntegrationId.Jira, targets: [jiraTarget('ABC-123')] };
		const first = await manager.getIssuesBatch(options);
		const second = await manager.getIssuesBatch(options);

		assert.equal(first.fetchFailed, true);
		assert.equal(calls, 2);
		assert.equal(second.items[0]?.issue?.id, 'ABC-123');

		manager.dispose();
	});

	test('reads the requested connection independently from the primary, and caches neither', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.storeSecret(
			'integration.auth.cloud:jira|secondary',
			JSON.stringify(trackerSession('atlassian.net', 'secondary', 'secondary-token')),
		);
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession(
			'atlassian.net',
			'primary',
			'primary-token',
		);
		const tokens: string[] = [];
		stubApi(jira, {
			getJiraIssueByKey: (
				tokenWithInfo: TokenWithInfo,
				_resourceId: string,
				_resourceUrl: string,
				key: string,
			) => {
				const token = tokenWithInfo.accessToken;
				tokens.push(token);
				return Promise.resolve(providerIssue(key, token));
			},
		});

		const options = { providerId: IssuesCloudHostIntegrationId.Jira, targets: [jiraTarget('ABC-123')] };
		const secondary = await manager.getIssuesBatch({ ...options, connectionId: 'secondary' });
		const primary = await manager.getIssuesBatch(options);
		const secondaryAgain = await manager.getIssuesBatch({ ...options, connectionId: 'secondary' });

		assert.equal(secondary.items[0]?.issue?.title, 'secondary-token');
		assert.equal(primary.items[0]?.issue?.title, 'primary-token');
		assert.equal(secondaryAgain.items[0]?.issue?.title, 'secondary-token');
		assert.deepEqual(tokens, ['secondary-token', 'primary-token', 'secondary-token'], 'the caller owns caching');

		manager.dispose();
	});

	test('answers a found and an absent target and drops a failed one, in one call', async () => {
		const { manager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: (_token: TokenWithInfo, _resourceId: string, _resourceUrl: string, key: string) => {
				switch (key) {
					case 'ABC-1':
						return Promise.resolve(providerIssue(key));
					case 'ABC-2':
						return Promise.resolve(undefined);
					default:
						return Promise.reject(new Error('upstream exploded'));
				}
			},
		});

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-1', 'found'), jiraTarget('ABC-2', 'absent'), jiraTarget('ABC-3', 'failed')],
		});

		assert.deepEqual(
			result.items.map(i => [i.key, i.issue?.id]),
			[
				['found', 'ABC-1'],
				['absent', undefined],
			],
			'the failed target is dropped, never reported as a proven absence',
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0].message, /upstream exploded/);

		manager.dispose();
	});

	test('asks one identifier of several resources in one integration call, answered per resource', async () => {
		const asked: string[] = [];
		const { manager, jira } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: (_token: TokenWithInfo, resourceId: string, _resourceUrl: string, key: string) => {
				asked.push(`${resourceId}/${key}`);
				return Promise.resolve(resourceId === 'org-1' ? providerIssue(key) : undefined);
			},
		});
		let batchCalls = 0;
		const batch = jira.getIssuesByResourceIdBatchResult.bind(jira);
		jira.getIssuesByResourceIdBatchResult = (targets, connectionId) => {
			batchCalls++;
			return batch(targets, connectionId);
		};

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [
				{ key: 'org-1', resourceId: 'org-1', resourceUrl: jiraResourceUrl, identifier: 'ABC-123' },
				{
					key: 'org-2',
					resourceId: 'org-2',
					resourceUrl: 'https://other.atlassian.net',
					identifier: 'ABC-123',
				},
			],
		});

		assert.equal(batchCalls, 1);
		assert.deepEqual(new Set(asked), new Set(['org-1/ABC-123', 'org-2/ABC-123']));
		assert.deepEqual(
			result.items.map(i => [i.key, i.issue?.id]),
			[
				['org-1', 'ABC-123'],
				['org-2', undefined],
			],
		);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('several failing targets cost at most one strike and do not disconnect', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			// A 400 is a request failure, which takes the direct strike path on a cloud session; an auth failure
			// would only request a session resync, leaving the count incidentally zero.
			return Promise.resolve(jsonResponse(400, { message: 'Invalid issue request' }));
		};
		let disconnected: string | undefined;
		runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };
		const { manager, integration } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Jira);

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: Array.from({ length: 6 }, (_, i) => jiraTarget(`ABC-${i + 1}`)),
		});

		assert.equal(requests, 6);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(
			getRequestExceptionCount(integration),
			1,
			'six failing targets resolved in one batch call must cost at most one strike',
		);
		assert.equal(disconnected, undefined, 'must not disconnect on a single failing batch call');

		manager.dispose();
	});

	test('refuses Trello, whose single-issue read cannot prove an absence', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Trello,
			targets: [{ key: '42', resourceId: 'board-1', identifier: '42' }],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /cannot prove an absence/i);

		manager.dispose();
	});

	test('refuses a call carrying the other target form whole, without attempting a read', async () => {
		const { manager: ghManager, gh } = await connectedGitHub(createFakeRuntime());
		let ghCalls = 0;
		(gh as unknown as { getIssuesBatchResult: () => Promise<unknown> }).getIssuesBatchResult = () => {
			ghCalls++;
			return Promise.resolve({ value: [] });
		};
		let jiraCalls = 0;
		const { manager: jiraManager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: () => {
				jiraCalls++;
				return Promise.resolve(undefined);
			},
		});

		const gitHost = await ghManager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'coordinate', owner: 'o', repo: 'a', number: 1 },
				{ key: 'tracker', resourceId: 'org-1', identifier: 'ABC-1' },
			],
		});
		const tracker = await jiraManager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-1', 'tracker'), { key: 'coordinate', owner: 'o', repo: 'a', number: 1 }],
		});

		assert.equal(ghCalls, 0);
		assert.deepEqual(gitHost.items, [], 'the valid coordinate is not answered either');
		assert.equal(gitHost.fetchFailed, true);
		assert.match(gitHost.warnings[0].message, /takes repository coordinates/);
		assert.equal(jiraCalls, 0);
		assert.deepEqual(tracker.items, [], 'the valid tracker target is not answered either');
		assert.equal(tracker.fetchFailed, true);
		assert.match(tracker.warnings[0].message, /takes tracker identifiers/);

		ghManager.dispose();
		jiraManager.dispose();
	});

	test('does not publish an absence when the requested session is unavailable', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-123')],
			connectionId: 'gone',
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});

	test('reports a missing primary session as a connection warning, not an absence', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [jiraTarget('ABC-123')],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0]?.kind, 'no-connection');

		manager.dispose();
	});

	test('refuses an empty or whitespace-only resource or identifier without attempting a request', async () => {
		let calls = 0;
		const { manager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: () => {
				calls++;
				return Promise.resolve(undefined);
			},
		});

		for (const target of [
			{ ...jiraTarget('ABC-123'), resourceId: '' },
			{ ...jiraTarget('ABC-123'), identifier: '' },
			{ ...jiraTarget('ABC-123'), resourceId: '   ' },
			{ ...jiraTarget('ABC-123'), identifier: ' \t ' },
		]) {
			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [jiraTarget('ABC-1', 'valid'), target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
		}
		assert.equal(calls, 0);

		manager.dispose();
	});

	test('requires a Jira resource URL without attempting a request', async () => {
		let calls = 0;
		const { manager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: () => {
				calls++;
				return Promise.resolve(undefined);
			},
		});

		for (const resourceUrl of [undefined, '   ']) {
			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [{ key: 'ABC-123', resourceId: 'org-1', resourceUrl: resourceUrl, identifier: 'ABC-123' }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /resource URL/i);
		}
		assert.equal(calls, 0);

		manager.dispose();
	});
});

/**
 * The integration's own single-issue read, which e298f7050 made report a provider failure as `{ error }` and evict
 * it, rather than caching it as an absence. Unlike the batch read it IS cached, so these pin that cache.
 */
suite('IssuesIntegration.getIssue (cached single-issue read)', () => {
	const jiraResource = { id: 'org-1', key: 'org-1', name: 'Example', url: jiraResourceUrl };
	const linearResource = { id: 'workspace-1', key: 'workspace-1', name: 'Workspace' };

	test('does not trust the SDK category for a localized Jira status', async () => {
		const { manager, jira } = await connectedJira(createFakeRuntime(), {
			getIssue: () =>
				Promise.resolve({
					...providerIssue('ABC-126'),
					state: { id: 'todo', name: 'Por hacer', color: 'blue-gray', category: 'DONE' },
				}),
		});

		const issue = await jira.getIssue(jiraResource, 'ABC-126');

		assert.equal(issue?.closed, false);
		assert.equal(issue?.state, 'opened');
		assert.deepEqual(issue?.providerState, {
			id: 'todo',
			name: 'Por hacer',
			color: 'blue-gray',
			category: undefined,
		});

		manager.dispose();
	});

	test('evicts a provider failure instead of caching it as an absence', async () => {
		let calls = 0;
		const { manager, jira } = await connectedJira(createFakeRuntime(), {
			getIssue: () => {
				calls++;
				return calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve(providerIssue('ABC-123'));
			},
		});

		const first = await jira.getIssue(jiraResource, 'ABC-123');
		const second = await jira.getIssue(jiraResource, 'ABC-123');

		assert.equal(first, undefined);
		assert.equal(calls, 2);
		assert.equal(second?.id, 'ABC-123');

		manager.dispose();
	});

	test('does not reset the provider failure budget on a cache hit', async () => {
		const runtime = createFakeRuntime();
		let disconnected: string | undefined;
		runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };
		const { manager, integration: linear } = await connectedTracker(runtime, IssuesCloudHostIntegrationId.Linear);
		let calls = 0;
		await stubLinearGetIssueFn(manager, () => {
			calls++;
			return Promise.resolve({ data: providerIssue('ENG-123') });
		});

		await linear.getIssue(linearResource, 'ENG-123');
		for (let i = 0; i < 4; i++) {
			linear.trackRequestException();
		}
		await linear.getIssue(linearResource, 'ENG-123');
		linear.trackRequestException();

		assert.equal(calls, 1);
		assert.equal(disconnected, linear.name);

		manager.dispose();
	});

	test('counts a shared concurrent failure once per provider request', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		let disconnected: string | undefined;
		runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };
		const { manager, jira } = await connectedJira(runtime, {
			getIssue: () => {
				requests++;
				return Promise.reject(new RequestClientError(new Error('Invalid issue request')));
			},
		});

		const results = await Promise.all(Array.from({ length: 5 }, () => jira.getIssue(jiraResource, 'ABC-400')));

		assert.equal(requests, 1);
		assert.equal(disconnected, undefined);
		assert.ok(results.every(issue => issue === undefined));
		for (let i = 0; i < 4; i++) {
			jira.trackRequestException();
		}
		assert.equal(disconnected, jira.name);

		manager.dispose();
	});

	test('caches the requested connection independently from the primary', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.storeSecret(
			'integration.auth.cloud:jira|secondary',
			JSON.stringify(trackerSession('atlassian.net', 'secondary', 'secondary-token')),
		);
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession(
			'atlassian.net',
			'primary',
			'primary-token',
		);
		const tokens: string[] = [];
		stubApi(jira, {
			getIssue: (tokenWithInfo: TokenWithInfo, input: { number: string }) => {
				const token = tokenWithInfo.accessToken;
				tokens.push(token);
				return Promise.resolve(providerIssue(input.number, token));
			},
		});

		const secondary = await jira.getIssue(jiraResource, 'ABC-123', { connectionId: 'secondary' });
		const primary = await jira.getIssue(jiraResource, 'ABC-123');
		const secondaryAgain = await jira.getIssue(jiraResource, 'ABC-123', { connectionId: 'secondary' });

		assert.equal(secondary?.title, 'secondary-token');
		assert.equal(primary?.title, 'primary-token');
		assert.equal(secondaryAgain?.title, 'secondary-token');
		assert.deepEqual(tokens, ['secondary-token', 'primary-token']);

		manager.dispose();
	});
});
