import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { GetIssueFn, ProviderIssue } from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { createFakeRuntime } from './fakeRuntime.js';

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
			description: null,
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

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

async function connectedJira(runtime: ReturnType<typeof createFakeRuntime>, api: Record<string, unknown>) {
	const manager = createIntegrationManager(runtime);
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');
	stubApi(jira, api);
	return { manager: manager, jira: jira };
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

suite('IntegrationManager.getTrackerIssue', () => {
	test('resolves the supplied resource and key with one provider request and no discovery', async () => {
		const runtime = createFakeRuntime();
		const requests: Array<{ init?: RequestInit; url: string }> = [];
		runtime.http.fetch = (input, init) => {
			requests.push({ url: input.toString(), init: init });
			return Promise.resolve(
				new Response(JSON.stringify(jiraIssueResponse('ABC-123')), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			);
		};
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-123',
		});

		assert.equal(requests.length, 1);
		assert.match(requests[0].url, /\/org-1\/rest\/api\/2\/issue\/ABC-123\?/);
		assert.equal(new Headers(requests[0].init?.headers).get('authorization'), 'Bearer tok');
		assert.equal(result.items[0]?.key, 'ABC-123');
		assert.equal(result.items[0]?.issue?.id, 'ABC-123');
		assert.equal(result.items[0]?.issue?.url, `${jiraResourceUrl}/browse/ABC-123`);
		assert.equal(result.items[0]?.issue?.state, 'opened');
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('uses Jira status keys rather than localized display names', async () => {
		const runtime = createFakeRuntime();
		runtime.http.fetch = () =>
			Promise.resolve(
				new Response(JSON.stringify(jiraIssueResponse('ABC-125', 'En curso', 'indeterminate')), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			);
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-125',
		});

		assert.equal(result.items[0]?.issue?.closed, false);
		assert.equal(result.items[0]?.issue?.state, 'opened');

		manager.dispose();
	});

	test('maps a completed Jira status without a second request', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(
				new Response(JSON.stringify(jiraIssueResponse('ABC-124', 'Done')), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			);
		};
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-124',
		});

		assert.equal(requests, 1);
		assert.equal(result.items[0]?.issue?.closed, true);
		assert.equal(result.items[0]?.issue?.state, 'closed');

		manager.dispose();
	});

	test('does not trust the SDK category for a localized Jira status on legacy reads', async () => {
		const { manager, jira } = await connectedJira(createFakeRuntime(), {
			getIssue: () =>
				Promise.resolve({
					...providerIssue('ABC-126'),
					state: { id: 'todo', name: 'Por hacer', color: 'blue-gray', category: 'DONE' },
				}),
		});
		const resource = { id: 'org-1', key: 'org-1', name: 'Example', url: jiraResourceUrl };

		const issue = await jira.getIssue(resource, 'ABC-126');

		assert.equal(issue?.closed, false);
		assert.equal(issue?.state, 'opened');

		manager.dispose();
	});

	test('normalizes a real Jira 404 into a proven absence', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(
				new Response(JSON.stringify({ message: 'Issue does not exist' }), {
					status: 404,
					headers: { 'content-type': 'application/json' },
				}),
			);
		};
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-404',
		});

		assert.deepEqual(result.items, [{ key: 'ABC-404' }]);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(requests, 1);

		manager.dispose();
	});

	test('does not cache Jira 410 or 422 responses as proven absences', async () => {
		for (const status of [410, 422]) {
			const runtime = createFakeRuntime();
			runtime.http.fetch = () =>
				Promise.resolve(
					new Response(JSON.stringify({ message: 'The issue request could not be served' }), {
						status: status,
						headers: { 'content-type': 'application/json' },
					}),
				);
			const manager = createIntegrationManager(runtime);
			const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
			(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');

			const result = await manager.getTrackerIssue({
				providerId: IssuesCloudHostIntegrationId.Jira,
				resourceId: 'org-1',
				resourceUrl: jiraResourceUrl,
				key: `ABC-${status}`,
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);

			manager.dispose();
		}
	});

	test('maps a successful Linear lookup and its workflow state', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('linear.app');
		let calls = 0;
		await stubLinearGetIssueFn(manager, () => {
			calls++;
			return Promise.resolve({
				data: {
					...providerIssue('ENG-123'),
					state: { id: 'done', name: 'Done', color: null, category: 'DONE' },
				},
			});
		});

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Linear,
			resourceId: 'workspace-1',
			key: 'ENG-123',
		});

		assert.equal(calls, 1);
		assert.equal(result.items[0]?.issue?.id, 'ENG-123');
		assert.equal(result.items[0]?.issue?.closed, true);
		assert.equal(result.items[0]?.issue?.state, 'closed');
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('normalizes the Linear SDK missing-issue error into a proven absence', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('linear.app');
		await stubLinearGetIssueFn(manager, () => Promise.reject(new Error('Linear issue not found: ENG-404')));

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Linear,
			resourceId: 'workspace-1',
			key: 'ENG-404',
		});

		assert.deepEqual(result.items, [{ key: 'ENG-404' }]);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('does not cache Linear transport failures as proven absences', async () => {
		for (const status of [410, 422]) {
			const runtime = createFakeRuntime();
			let requests = 0;
			runtime.http.fetch = () => {
				requests++;
				return Promise.resolve(
					new Response(JSON.stringify({ errors: [{ message: 'The issue request could not be served' }] }), {
						status: status,
						headers: { 'content-type': 'application/json' },
					}),
				);
			};
			const manager = createIntegrationManager(runtime);
			const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
			(linear as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('linear.app');

			const options = {
				providerId: IssuesCloudHostIntegrationId.Linear,
				resourceId: 'workspace-1',
				key: `ENG-${status}`,
			};
			const first = await manager.getTrackerIssue(options);
			const second = await manager.getTrackerIssue(options);

			assert.equal(requests, 2);
			assert.deepEqual(first.items, []);
			assert.equal(first.fetchFailed, true);
			assert.equal(first.warnings.length, 1);
			assert.deepEqual(second.items, []);
			assert.equal(second.fetchFailed, true);

			manager.dispose();
		}
	});

	test('does not reset the provider failure budget on a cache hit', async () => {
		const runtime = createFakeRuntime();
		let disconnected: string | undefined;
		runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('linear.app');
		let calls = 0;
		await stubLinearGetIssueFn(manager, () => {
			calls++;
			return Promise.resolve({ data: providerIssue('ENG-123') });
		});
		const options = {
			providerId: IssuesCloudHostIntegrationId.Linear,
			resourceId: 'workspace-1',
			key: 'ENG-123',
		};

		await manager.getTrackerIssue(options);
		for (let i = 0; i < 4; i++) {
			linear.trackRequestException();
		}
		await manager.getTrackerIssue(options);
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
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(
				new Response(JSON.stringify({ message: 'Invalid issue request' }), {
					status: 400,
					headers: { 'content-type': 'application/json' },
				}),
			);
		};
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');
		const options = {
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-400',
		};

		const results = await Promise.all(Array.from({ length: 5 }, () => manager.getTrackerIssue(options)));

		assert.equal(requests, 1);
		assert.equal(disconnected, undefined);
		assert.ok(results.every(result => result.fetchFailed === true));
		for (let i = 0; i < 4; i++) {
			jira.trackRequestException();
		}
		assert.equal(disconnected, jira.name);

		manager.dispose();
	});

	test('returns no item when the provider request fails', async () => {
		const { manager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: () => Promise.reject(new Error('upstream exploded')),
		});

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-123',
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);

		manager.dispose();
	});

	test('evicts a failed request instead of caching it as an absence', async () => {
		let calls = 0;
		const { manager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: () => {
				calls++;
				return calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve(providerIssue('ABC-123'));
			},
		});

		const options = {
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-123',
		};
		const first = await manager.getTrackerIssue(options);
		const second = await manager.getTrackerIssue(options);

		assert.equal(first.fetchFailed, true);
		assert.equal(calls, 2);
		assert.equal(second.items[0]?.issue?.id, 'ABC-123');

		manager.dispose();
	});

	test('evicts provider failures for the legacy integration issue read too', async () => {
		let calls = 0;
		const { manager, jira } = await connectedJira(createFakeRuntime(), {
			getIssue: () => {
				calls++;
				return calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve(providerIssue('ABC-123'));
			},
		});
		const resource = { id: 'org-1', key: 'org-1', name: 'Example', url: 'https://example.atlassian.net' };

		const first = await jira.getIssue(resource, 'ABC-123');
		const second = await jira.getIssue(resource, 'ABC-123');

		assert.equal(first, undefined);
		assert.equal(calls, 2);
		assert.equal(second?.id, 'ABC-123');

		manager.dispose();
	});

	test('uses and caches the requested connection independently from the primary', async () => {
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

		const target = {
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-123',
		};
		const secondary = await manager.getTrackerIssue({ ...target, connectionId: 'secondary' });
		const primary = await manager.getTrackerIssue(target);
		const secondaryAgain = await manager.getTrackerIssue({ ...target, connectionId: 'secondary' });

		assert.equal(secondary.items[0]?.issue?.title, 'secondary-token');
		assert.equal(primary.items[0]?.issue?.title, 'primary-token');
		assert.equal(secondaryAgain.items[0]?.issue?.title, 'secondary-token');
		assert.deepEqual(tokens, ['secondary-token', 'primary-token']);

		manager.dispose();
	});

	test('reports unsupported providers without attempting a read', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const gitHost = await manager.getTrackerIssue({
			providerId: GitCloudHostIntegrationId.GitHub,
			resourceId: 'octocat',
			key: '123',
		});
		const trello = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Trello,
			resourceId: 'board-1',
			key: '42',
		});

		assert.equal(gitHost.fetchFailed, true);
		assert.match(gitHost.warnings[0].message, /not supported/i);
		assert.equal(trello.fetchFailed, true);
		assert.match(trello.warnings[0].message, /cannot prove an absence/i);

		manager.dispose();
	});

	test('does not publish an absence when the requested session is unavailable', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-123',
			connectionId: 'gone',
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});

	test('refuses an empty or whitespace-only resource or key without attempting a request', async () => {
		let calls = 0;
		const { manager } = await connectedJira(createFakeRuntime(), {
			getJiraIssueByKey: () => {
				calls++;
				return Promise.resolve(undefined);
			},
		});

		const emptyResource = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: '',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-123',
		});
		const emptyKey = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: '',
		});
		const whitespaceResource = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: '   ',
			resourceUrl: jiraResourceUrl,
			key: 'ABC-123',
		});
		const whitespaceKey = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			resourceUrl: jiraResourceUrl,
			key: ' \t ',
		});

		assert.equal(calls, 0);
		assert.deepEqual(emptyResource.items, []);
		assert.equal(emptyResource.fetchFailed, true);
		assert.deepEqual(emptyKey.items, []);
		assert.equal(emptyKey.fetchFailed, true);
		assert.deepEqual(whitespaceResource.items, []);
		assert.equal(whitespaceResource.fetchFailed, true);
		assert.deepEqual(whitespaceKey.items, []);
		assert.equal(whitespaceKey.fetchFailed, true);

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

		const result = await manager.getTrackerIssue({
			providerId: IssuesCloudHostIntegrationId.Jira,
			resourceId: 'org-1',
			key: 'ABC-123',
		});

		assert.equal(calls, 0);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /resource URL/i);

		manager.dispose();
	});
});
