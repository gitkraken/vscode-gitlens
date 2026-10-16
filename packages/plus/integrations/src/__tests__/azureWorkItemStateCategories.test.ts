import assert from 'node:assert/strict';
import { GitIssueState } from '@gitkraken/provider-apis';
import { suite, teardown, test } from 'mocha';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { TokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId, providerFanOutConcurrency } from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason, RequestNotFoundError } from '../errors.js';
import { createIntegrationService } from '../integrationService.js';
import {
	azureProject,
	azureProvider,
	azureToken,
	azureWorkItemTypeStatesResponse,
	createWorkItem,
	isAzureWorkItemTypeStatesUrl,
} from '../providers/azure/__tests__/fixtures.js';
import { AzureDevOpsApi } from '../providers/azure/azure.js';
import type { AzureWorkItemStateCategory } from '../providers/azure/models.js';
import { azureIssueStateCategory, fromAzureWorkItem, toAzureWorkItemEtagFields } from '../providers/azure/models.js';
import { AzureWorkItemStatesCache } from '../providers/azure/workItemStateCategories.js';
import type { ProviderIssue } from '../providers/models.js';
import { fromProviderIssue, toIssueShape } from '../providers/models.js';
import { ProvidersApi } from '../providers/providersApi.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedAzure } from './sweepHelpers.js';

/**
 * Azure DevOps work items carry their workflow state and its category (GKDEV-3655), which `ProvidersApi` reads from
 * the work item type's states (`GET …/_apis/wit/workItemTypes/{type}/states`) for every work item read: by id, the
 * cheap etag read, and the project list. Each case answers the requests at the HTTP level, as Azure would, and the
 * state names deliberately contradict their categories (see `azureWorkItemTypeStates`), so only a category read from
 * the metadata passes.
 */

const realNow = Date.now;
teardown(() => {
	Date.now = realNow;
});

const date = '2026-10-01T00:00:00.000Z';

type StatesFailure = number | 'html' | 'malformed';

/** A work item as Azure returns it, of `type` and in `state`. */
function azureItem(id: number, type: string, state: string): Record<string, unknown> {
	return {
		id: id,
		rev: 1,
		fields: {
			'System.Title': `Work item ${id}`,
			'System.State': state,
			'System.WorkItemType': type,
			'System.TeamProject': 'project',
			'System.CreatedDate': date,
			'System.ChangedDate': date,
			'System.CreatedBy': { id: 'author', displayName: 'Author', uniqueName: 'author@example.com' },
		},
		_links: { html: { href: `https://dev.azure.com/org/project/_workitems/edit/${id}` } },
	};
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

/**
 * A real `ProvidersApi` over a fake Azure DevOps host serving work items `1..types.length`, item `n` of `types[n-1]`
 * and in `state`. Records every states read, and how many were in flight at once.
 */
function azureHarness() {
	const fixture = {
		types: ['Task'],
		discoveredTypes: undefined as string[] | undefined,
		onQuery: undefined as (() => void) | undefined,
		state: 'Descartado',
		failDiscovery: false,
		closedDate: undefined as string | undefined,
		categoriesByType: undefined as Record<string, AzureWorkItemStateCategory> | undefined,
		/** Fails every states read so. */
		failStates: undefined as StatesFailure | undefined,
		/** Fails only this type's states read, with a 503. */
		failType: undefined as string | undefined,
	};
	const states: { url: URL; authorization: string | undefined }[] = [];
	const workItemReads: URL[] = [];
	const discoveryReads: URL[] = [];
	let active = 0;
	let maxActive = 0;

	const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(input.toString());
		const path = url.pathname;
		if (/\/_apis\/wit\/workItemTypes$/i.test(path)) {
			discoveryReads.push(url);
			return fixture.failDiscovery
				? json(503, {})
				: json(200, {
						value: Array.from(new Set(fixture.discoveredTypes ?? fixture.types), name => ({ name: name })),
					});
		}

		if (isAzureWorkItemTypeStatesUrl(url)) {
			states.push({ url: url, authorization: (init?.headers as Record<string, string>)?.Authorization });
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise(resolve => setTimeout(resolve, 0));
			active--;

			if (url.searchParams.get('api-version') !== '6.0-preview.1') {
				return json(400, { message: 'Azure DevOps Server 2020 serves work item states only as a preview' });
			}

			if (fixture.failType != null && path.includes(`/workItemTypes/${fixture.failType}/`)) {
				return json(503, { message: 'Unavailable' });
			}

			switch (fixture.failStates) {
				case undefined:
					return fixture.categoriesByType == null
						? azureWorkItemTypeStatesResponse(url)!
						: azureWorkItemTypeStatesResponse(url, [
								{
									name: fixture.state,
									category: fixture.categoriesByType[decodeURIComponent(path.split('/').at(-2)!)],
								},
							])!;
				case 'html':
					return new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } });
				case 'malformed':
					return json(200, { value: null });
				default:
					return json(fixture.failStates, { message: 'Unavailable' });
			}
		}

		const items = fixture.types.map((type, i) => {
			const item = azureItem(i + 1, type, fixture.state);
			if (fixture.closedDate != null) {
				(item.fields as Record<string, unknown>)['Microsoft.VSTS.Common.ClosedDate'] = fixture.closedDate;
			}
			return item;
		});
		if (path.endsWith('/_apis/wit/wiql')) {
			const query = (JSON.parse(init?.body as string) as { query: string }).query;
			const predicates = [
				...query.matchAll(/\[System.WorkItemType\] = '((?:''|[^'])*)' AND \[System.State\] IN \(([^)]*)\)/g),
			];
			const selected = query.includes('[System.Id] = 0')
				? []
				: items.filter(item => {
						if (!query.includes('[System.State]')) return true;
						return predicates.some(
							([, type, states]) =>
								type.replaceAll("''", "'") ===
									(item.fields as Record<string, unknown>)['System.WorkItemType'] &&
								[...states.matchAll(/'((?:''|[^'])*)'/g)].some(
									([, state]) => state.replaceAll("''", "'") === fixture.state,
								),
						);
					});
			fixture.onQuery?.();
			return json(200, { workItems: selected.map(w => ({ id: w.id })) });
		}

		if (path.endsWith('/_apis/wit/workitemsbatch')) {
			const ids = (JSON.parse(init?.body as string) as { ids: number[] }).ids;
			return json(200, { value: items.filter(w => ids.includes(w.id as number)) });
		}

		if (path.endsWith('/_apis/wit/workitems')) {
			workItemReads.push(url);
			const ids = url.searchParams.get('ids')?.split(',').map(Number) ?? [];
			const fields = url.searchParams.get('fields')?.split(',') ?? [];
			return json(200, {
				value: items
					.filter(w => ids.includes(w.id as number))
					.map(w => ({
						id: w.id,
						fields: Object.fromEntries(
							Object.entries(w.fields as Record<string, unknown>).filter(([k]) => fields.includes(k)),
						),
					})),
			});
		}

		const point = /\/_apis\/wit\/workitems\/(\d+)$/i.exec(path);
		if (point != null) {
			workItemReads.push(url);
			const item = items[Number(point[1]) - 1];
			return item != null ? json(200, item) : json(404, { message: 'nope', typeKey: 'WorkItemNotFound' });
		}

		throw new Error(`unexpected request: ${url.toString()}`);
	};

	const api = new ProvidersApi({
		ctx: { http: { fetch: fetch, userAgent: 'test' } },
	} as unknown as IntegrationAuthenticationService);
	return {
		api: api,
		fetch: fetch,
		fixture: fixture,
		states: states,
		workItemReads: workItemReads,
		discoveryReads: discoveryReads,
		maxActive: () => maxActive,
	};
}

const scope = { namespace: 'org', project: 'project' };
/** Every state, so a list keeps its Removed (closed, dateless) work items: see the state filter case. */
const allStates = [GitIssueState.Open, GitIssueState.Closed];
const serverToken: TokenWithInfo<GitSelfManagedHostIntegrationId.AzureDevOpsServer> = {
	...azureToken,
	providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	cloud: false,
};

function categories(issues: readonly ProviderIssue[]): (string | undefined)[] {
	return issues.map(i => i.state?.category);
}

suite('Azure DevOps work item workflow categories (GKDEV-3655)', () => {
	test('each Azure state category maps to its workflow category, Removed to CANCELED', () => {
		const cases: [AzureWorkItemStateCategory | undefined, string | undefined][] = [
			['Removed', 'CANCELED'],
			['Completed', 'DONE'],
			['Resolved', 'DONE'],
			['InProgress', 'IN_PROGRESS'],
			['Proposed', 'TO_DO'],
			[undefined, undefined],
			['Bogus' as AzureWorkItemStateCategory, undefined],
		];
		for (const [category, expected] of cases) {
			assert.equal(azureIssueStateCategory(category), expected, String(category));
		}
	});

	test("the native point and search converter keeps the state's name and its metadata category", () => {
		const cases: [string, AzureWorkItemStateCategory | undefined, string | undefined, boolean][] = [
			['Descartado', 'Removed', 'CANCELED', true],
			['Canceled', 'Completed', 'DONE', true],
			['Resolved', 'Resolved', 'DONE', true],
			['Removed', 'InProgress', 'IN_PROGRESS', false],
			['New', 'Proposed', 'TO_DO', false],
			['Unknown', undefined, undefined, false],
		];
		for (const [name, upstream, category, closed] of cases) {
			const workItem = createWorkItem();
			workItem.fields['System.State'] = name;
			const issue = fromAzureWorkItem(workItem, azureProvider, azureProject, upstream, 'point');
			assert.deepEqual(issue.providerState, { name: name, category: category }, name);
			assert.equal(issue.issueType, 'Bug', name);
			assert.equal(issue.closed, closed, name);
			assert.equal(issue.state, closed ? 'closed' : 'opened', name);
		}

		const stateless = createWorkItem();
		stateless.fields['System.State'] = '';
		assert.equal(fromAzureWorkItem(stateless, azureProvider, azureProject, 'Removed').providerState, undefined);
	});

	test('the SDK selects work items by workflow category before paging', async () => {
		const h = azureHarness();
		h.fixture.types = ['Task', 'Bug', 'Epic'];
		const read = (states?: GitIssueState[]) =>
			h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: states });

		for (const [state, terminal] of [
			['Descartado', true],
			['Canceled', true],
			['Removed', false],
		] as const) {
			h.fixture.state = state;
			assert.deepEqual((await read()).values.length, terminal ? 0 : 3, `${state}: an open read by default`);
			assert.deepEqual((await read([GitIssueState.Open])).values.length, terminal ? 0 : 3, `${state}: open`);
			assert.deepEqual((await read([GitIssueState.Closed])).values.length, terminal ? 3 : 0, `${state}: closed`);
			assert.deepEqual(
				(await read([GitIssueState.Open, GitIssueState.Closed])).values.length,
				3,
				`${state}: every state`,
			);
		}
	});

	for (const [name, token, baseUrl] of [
		['Azure DevOps', azureToken, undefined],
		['Azure DevOps Server', serverToken, 'https://server.test/tfs/'],
	] as const) {
		test(`${name}: the point read and the project list classify alike, sharing one states read`, async () => {
			const h = azureHarness();
			const options = { baseUrl: baseUrl, isPAT: true };
			for (const [state, category] of [
				['Descartado', 'CANCELED'],
				['Canceled', 'DONE'],
				['Removed', 'IN_PROGRESS'],
			]) {
				h.fixture.state = state;
				const point = await h.api.getAzureWorkItem(token, scope, 1, options);
				const list = await h.api.getIssuesForAzureProject(token, 'org', 'project', {
					...options,
					states: [GitIssueState.Open, GitIssueState.Closed],
				});
				assert.equal(list.metadata, undefined, state);
				for (const raw of [point, list.values[0]]) {
					assert.ok(raw != null, state);
					const shape = toIssueShape(raw, azureProvider);
					assert.equal(shape?.providerState?.name, state);
					assert.equal(shape?.providerState?.category, category, state);
					assert.equal(shape?.state, category === 'IN_PROGRESS' ? 'opened' : 'closed', state);
				}
			}

			assert.deepEqual(
				h.states.map(r => `${r.url.origin}${r.url.pathname}`),
				[
					`${baseUrl?.replace(/\/$/, '') ?? 'https://dev.azure.com'}/org/project/_apis/wit/workItemTypes/Task/states`,
				],
			);
		});
	}

	test('the states read asks for 6.0-preview.1 with the credential, encoding the type', async () => {
		const h = azureHarness();
		h.fixture.types = ['User Story'];

		const issue = await h.api.getAzureWorkItem(azureToken, { namespace: 'my org', project: 'project' }, 1, {});

		assert.equal(issue?.state?.category, 'CANCELED');
		assert.equal(h.states.length, 1);
		assert.equal(
			h.states[0].url.toString(),
			'https://dev.azure.com/my%20org/project/_apis/wit/workItemTypes/User%20Story/states?api-version=6.0-preview.1',
		);
		assert.equal(h.states[0].authorization, 'Bearer token');
	});

	test('a state the type does not list gets no category, and stays open', async () => {
		const h = azureHarness();
		h.fixture.state = 'Mystery';

		const point = await h.api.getAzureWorkItem(azureToken, scope, 1, {});
		const list = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: allStates });

		for (const raw of [point, list.values[0]]) {
			assert.ok(raw?.state != null);
			assert.equal(raw.state.name, 'Mystery');
			assert.equal(raw.state.category, undefined);
			assert.equal(toIssueShape(raw, azureProvider)?.state, 'opened');
		}
		assert.equal(list.metadata, undefined);
		assert.equal(h.states.length, 1, "the type's states were read, and don't list it");
	});

	test('concurrent reads coalesce, and hosts and credentials never share a states read', async () => {
		const h = azureHarness();

		await Promise.all(Array.from({ length: 3 }, () => h.api.getAzureWorkItem(azureToken, scope, 1, {})));
		assert.equal(h.states.length, 1, 'three concurrent reads, one states read');

		await h.api.getAzureWorkItem(azureToken, scope, 1, { baseUrl: 'https://other.test/tfs' });
		await h.api.getAzureWorkItem({ ...azureToken, accessToken: 'other' }, scope, 1, {});
		await h.api.getAzureWorkItem(azureToken, scope, 1, { isPAT: true });
		assert.deepEqual(
			h.states.map(r => [r.url.origin, r.authorization]),
			[
				['https://dev.azure.com', 'Bearer token'],
				['https://other.test', 'Bearer token'],
				['https://dev.azure.com', 'Bearer other'],
				['https://dev.azure.com', `Basic ${btoa(':token')}`],
			],
		);

		await h.api.getAzureWorkItem(azureToken, scope, 1, {});
		await h.api.getAzureWorkItem({ ...azureToken, accessToken: 'other' }, scope, 1, {});
		assert.equal(h.states.length, 4, 'each is cached for its own host and credential');
	});

	test('a failed states read is shared briefly, then retries and recovers', async () => {
		const h = azureHarness();
		const start = realNow();
		Date.now = () => start;
		h.fixture.failStates = 503;
		await assert.rejects(h.api.getAzureWorkItem(azureToken, scope, 1, {}));

		h.fixture.failStates = undefined;
		await assert.rejects(h.api.getAzureWorkItem(azureToken, scope, 1, {}));
		assert.equal(h.states.length, 1);
		Date.now = () => start + 30 * 1000;
		const issue = await h.api.getAzureWorkItem(azureToken, scope, 1, {});

		assert.equal(issue?.state?.category, 'CANCELED');
		assert.equal(h.states.length, 2);
	});

	test('distinct types read concurrently, each once, within the provider fan-out limit', async () => {
		const h = azureHarness();
		const types = Array.from({ length: providerFanOutConcurrency + 4 }, (_, i) => `Type${i}`);
		// Twice over, so every type has two work items.
		h.fixture.types = [...types, ...types];

		const result = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: allStates });

		assert.deepEqual(categories(result.values), new Array(types.length * 2).fill('CANCELED'));
		assert.equal(h.states.length, types.length);
		assert.equal(h.maxActive(), providerFanOutConcurrency);
	});

	test("one type's failed states read keeps every row, the other types classified, as a partial collection", async () => {
		const h = azureHarness();
		h.fixture.types = ['Task', 'Bug', 'Feature'];
		h.fixture.failType = 'Bug';

		const result = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: allStates });

		assert.deepEqual(categories(result.values), ['CANCELED', undefined, 'CANCELED']);
		assert.deepEqual(result.values[1].state, { name: 'Descartado', color: null }, 'left untouched');
		assert.equal(result.paging?.truncated, true);
		assert.equal(result.metadata?.completeness, 'partial');
		assert.equal(result.metadata?.failures?.length, 1);
		assert.deepEqual(result.metadata?.failures?.[0].scope, {
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			resourceId: 'org',
			projectId: 'project',
		});
		assert.equal(result.metadata?.failures?.[0].kind, 'provider');
		assert.equal(h.states.length, 3);
	});

	for (const [failure, kind] of [
		[401, 'authentication'],
		[403, 'authentication'],
		[404, 'not-found'],
		[503, 'provider'],
		['html', 'authentication'],
		['malformed', 'provider'],
	] as const) {
		test(`a states read failing with ${failure} keeps the listed rows as partial (${kind}), and fails the point and etag reads`, async () => {
			const h = azureHarness();
			h.fixture.failStates = failure;

			const result = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: allStates });
			assert.equal(result.values.length, 1);
			assert.deepEqual(result.values[0].state, { name: 'Descartado', color: null });
			assert.equal(result.paging?.truncated, true);
			assert.equal(result.metadata?.completeness, 'partial');
			assert.equal(result.metadata?.failures?.[0].kind, kind);

			// Never `undefined`: a states read that 404s says nothing about whether the work item exists.
			await assert.rejects(h.api.getAzureWorkItem(azureToken, scope, 1, {}), (ex: unknown) =>
				kind === 'authentication'
					? ex instanceof AuthenticationError &&
						ex.reason ===
							(failure === 403
								? AuthenticationErrorReason.Forbidden
								: AuthenticationErrorReason.Unauthorized)
					: failure === 404
						? ex instanceof RequestNotFoundError
						: ex instanceof Error,
			);
			await assert.rejects(
				h.api.getAzureWorkItemsEtagFields(azureToken, scope, [1], {}),
				ex => kind !== 'authentication' || ex instanceof AuthenticationError,
			);
			assert.equal(h.states.length, 1, 'list, point and etag share the cached failure');
		});
	}

	for (const failure of [401, 403, 'html'] as const) {
		test(`native presentation preserves a cached ${failure} authentication failure`, async () => {
			const h = azureHarness();
			h.fixture.failStates = failure;
			const runtime = createFakeRuntime();
			runtime.http.fetch = h.fetch;
			const manager = createIntegrationService(runtime);
			try {
				const api = await (
					manager as unknown as { getProvidersApi(): Promise<ProvidersApi> }
				).getProvidersApi();
				await api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: allStates, isPAT: true });
				const native = await manager.apis.azure;
				assert.ok(native != null);
				await assert.rejects(
					native.getWorkItemStateCategory('Task', 'Descartado', azureProvider, azureToken, 'org', 'project', {
						baseUrl: 'https://dev.azure.com',
					}),
					ex =>
						ex instanceof AuthenticationError &&
						ex.reason ===
							(failure === 403
								? AuthenticationErrorReason.Forbidden
								: AuthenticationErrorReason.Unauthorized),
				);
				assert.equal(h.states.length, 1);
			} finally {
				manager.dispose();
			}
		});
	}

	test('an in-flight failure cannot repopulate invalidated metadata', async () => {
		const cache = new AzureWorkItemStatesCache();
		let reject!: (error: Error) => void;
		const coordinate = {
			baseUrl: 'https://dev.azure.com',
			namespace: 'org',
			project: 'project',
			token: 'token',
			isPAT: true,
		};
		const pending = cache.getStates(
			coordinate,
			'Task',
			() =>
				new Promise((_resolve, fail) => {
					reject = fail;
				}),
		);
		cache.clear();
		reject(new Error('old request'));
		await assert.rejects(pending);
		const states = await cache.getStates(coordinate, 'Task', async () => ({
			value: [{ name: 'New', category: 'Proposed' }],
		}));
		assert.equal(states[0].category, 'Proposed');
	});

	test('manager list, point, etag and native presentation share one states read and invalidation', async () => {
		const h = azureHarness();
		const runtime = createFakeRuntime();
		runtime.http.fetch = h.fetch;
		const manager = createIntegrationService(runtime);
		try {
			const api = await (manager as unknown as { getProvidersApi(): Promise<ProvidersApi> }).getProvidersApi();
			const native = await manager.apis.azure;
			assert.ok(native != null);
			const options = { isPAT: true, baseUrl: 'https://dev.azure.com' };
			const [point, etag, list, category] = await Promise.all([
				api.getAzureWorkItem(azureToken, scope, 1, options),
				api.getAzureWorkItemsEtagFields(azureToken, scope, [1], options),
				api.getIssuesForAzureProject(azureToken, 'org', 'project', { ...options, states: allStates }),
				native.getWorkItemStateCategory(
					'Task',
					'Descartado',
					azureProvider,
					azureToken,
					'org',
					'project',
					options,
				),
			]);
			assert.equal(point?.state?.category, 'CANCELED');
			assert.equal(etag[0].category, 'CANCELED');
			assert.equal(list.values[0].state?.category, 'CANCELED');
			assert.equal(category, 'Removed');
			assert.equal(h.states.length, 1);
			h.fixture.categoriesByType = { Task: 'InProgress' };
			runtime.fireConfigChange({ httpProxy: true, remotes: false, integrationsEnabled: false, launchpad: false });
			assert.equal((await api.getAzureWorkItem(azureToken, scope, 1, options))?.state?.category, 'IN_PROGRESS');
			assert.equal(
				await native.getWorkItemStateCategory(
					'Task',
					'Descartado',
					azureProvider,
					azureToken,
					'org',
					'project',
					options,
				),
				'InProgress',
			);
			assert.equal(h.states.length, 2);
		} finally {
			manager.dispose();
		}
	});

	test('shared metadata invalidates before the lazy native client is loaded', async () => {
		const h = azureHarness();
		const runtime = createFakeRuntime();
		runtime.http.fetch = h.fetch;
		const manager = createIntegrationService(runtime);
		try {
			const api = await (manager as unknown as { getProvidersApi(): Promise<ProvidersApi> }).getProvidersApi();
			await api.getAzureWorkItem(azureToken, scope, 1, { isPAT: true });
			runtime.fireConfigChange({ httpProxy: true, remotes: false, integrationsEnabled: false, launchpad: false });
			const native = await manager.apis.azure;
			await native?.getWorkItemStateCategory('Task', 'Descartado', azureProvider, azureToken, 'org', 'project', {
				baseUrl: 'https://dev.azure.com',
			});
			assert.equal(h.states.length, 2);
		} finally {
			manager.dispose();
		}
	});

	test('full pages and continuation are selected by type and category', async () => {
		const h = azureHarness();
		h.fixture.types = ['Bug', 'Task', 'Task', 'Bug', 'Task', 'Bug'];
		h.fixture.state = 'Resolved';
		h.fixture.categoriesByType = { Bug: 'Resolved', Task: 'InProgress' };
		const read = (states?: GitIssueState[], page = 1) =>
			h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: states, pageSize: 2, page: page });
		assert.deepEqual(
			(await read()).values.map(i => i.id),
			['2', '3'],
		);
		assert.deepEqual(
			(await read(undefined, 2)).values.map(i => i.id),
			['5'],
		);
		const closed = await read([GitIssueState.Closed]);
		assert.deepEqual(
			closed.values.map(i => i.id),
			['1', '4'],
		);
		assert.equal(closed.paging?.more, true);
		assert.deepEqual(
			(await read([GitIssueState.Closed], 2)).values.map(i => i.id),
			['6'],
		);
		assert.equal(h.states.length, 2);
	});

	test('all states reads only workflows present on the page without discovering unrelated types', async () => {
		const h = azureHarness();
		h.fixture.discoveredTypes = ['Task', 'Unavailable'];
		h.fixture.failType = 'Unavailable';
		const page = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: allStates });
		assert.equal(page.values.length, 1);
		assert.deepEqual(categories(page.values), ['CANCELED']);
		assert.equal(page.metadata, undefined);
		assert.equal(h.discoveryReads.length, 0);
		assert.equal(h.states.length, 1);
	});

	for (const failure of [false, true]) {
		test(`a filtered page uses its selection snapshot when metadata expires during WIQL (refresh failure: ${failure})`, async () => {
			const h = azureHarness();
			const start = realNow();
			Date.now = () => start;
			h.fixture.onQuery = () => {
				Date.now = () => start + 5 * 60 * 1000;
				h.fixture.categoriesByType = { Task: 'InProgress' };
				h.fixture.failStates = failure ? 503 : undefined;
			};
			const page = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', {
				states: [GitIssueState.Closed],
			});
			assert.equal(page.values.length, 1);
			assert.deepEqual(categories(page.values), ['CANCELED']);
			assert.equal(page.metadata, undefined);
			assert.equal(h.states.length, 1);
		});
	}

	for (const [read, failure] of [
		['point', 503],
		['point', 404],
		['point', 'malformed'],
		['linked', 503],
		['linked', 404],
		['linked', 'malformed'],
	] as const) {
		test(`native ${read} metadata failure ${failure} rejects and recovers instead of becoming a missing issue`, async () => {
			const h = azureHarness();
			const native = new AzureDevOpsApi({
				fetch: h.fetch,
				wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
			});
			const start = realNow();
			Date.now = () => start;
			h.fixture.failStates = failure;
			const get = () =>
				read === 'point'
					? native.getIssue(
							azureProvider,
							azureToken,
							{ ...azureProject, resourceName: 'org', name: 'project' },
							'1',
							{ baseUrl: 'https://dev.azure.com' },
						)
					: native.getIssueOrPullRequest(azureProvider, azureToken, 'org', 'project/_git/repo', '1', {
							baseUrl: 'https://dev.azure.com',
						});
			await assert.rejects(get);
			await assert.rejects(get);
			assert.equal(h.states.length, 1);
			h.fixture.failStates = undefined;
			Date.now = () => start + 30 * 1000;
			assert.equal((await get())?.closed, true);
			assert.equal(h.states.length, 2);
		});
	}

	test('a failed snapshot type is not retried after its failure expires during the page read', async () => {
		const h = azureHarness();
		const start = realNow();
		Date.now = () => start;
		h.fixture.failStates = 503;
		h.fixture.onQuery = () => {
			Date.now = () => start + 30 * 1000;
			h.fixture.failStates = undefined;
		};
		const page = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', {
			states: [GitIssueState.Closed],
		});
		assert.equal(page.values.length, 1);
		assert.deepEqual(categories(page.values), [undefined]);
		assert.equal(page.metadata?.completeness, 'partial');
		assert.equal(h.states.length, 1);
	});

	test('a type absent from failed discovery is classified while the collection remains partial', async () => {
		const h = azureHarness();
		h.fixture.failDiscovery = true;
		const page = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', {
			states: [GitIssueState.Closed],
		});
		assert.equal(page.values.length, 1);
		assert.deepEqual(categories(page.values), ['CANCELED']);
		assert.equal(page.metadata?.completeness, 'partial');
		assert.equal(h.states.length, 1);
	});

	test('failed type discovery stays partial even on an empty list and recovers', async () => {
		const h = azureHarness();
		h.fixture.types = [];
		h.fixture.failDiscovery = true;
		const start = realNow();
		Date.now = () => start;
		for (const states of [undefined, [GitIssueState.Closed]]) {
			const page = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: states });
			assert.deepEqual(page.values, []);
			assert.equal(page.metadata?.completeness, 'partial');
		}
		const all = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: allStates });
		assert.deepEqual(all.values, []);
		assert.equal(all.metadata, undefined);
		h.fixture.failDiscovery = false;
		Date.now = () => start + 30 * 1000;
		const complete = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project');
		assert.deepEqual(complete.values, []);
		assert.equal(complete.metadata, undefined);
	});

	for (const [id, token, baseUrl] of [
		[GitCloudHostIntegrationId.AzureDevOps, azureToken, 'https://dev.azure.com'],
		[GitSelfManagedHostIntegrationId.AzureDevOpsServer, serverToken, 'https://server.test'],
	] as const) {
		test(`${id}: an open category remains open with a historical close date`, async () => {
			const h = azureHarness();
			h.fixture.state = 'Removed';
			h.fixture.closedDate = date;
			const runtime = createFakeRuntime();
			runtime.http.fetch = h.fetch;
			const manager = createIntegrationService(runtime);
			try {
				const integration = await manager.get(
					id,
					id === GitSelfManagedHostIntegrationId.AzureDevOpsServer ? 'server.test' : undefined,
				);
				assert.ok(integration != null);
				const options = { baseUrl: baseUrl, isPAT: true };
				const list = await h.api.getIssuesForAzureProject(token, 'org', 'project', {
					...options,
					states: [GitIssueState.Open],
				});
				assert.equal(list.values.length, 1);
				const point = await h.api.getAzureWorkItem(token, scope, 1, options);
				assert.ok(point != null);
				const shapes = [
					toIssueShape(list.values[0], integration),
					toIssueShape(point, integration),
					fromProviderIssue(list.values[0], integration),
				];
				for (const shape of shapes) {
					assert.equal(shape?.state, 'opened');
					assert.equal(shape?.closed, false);
					assert.equal(shape?.closedDate?.toISOString(), date);
				}
				const etag = await h.api.getAzureWorkItemsEtagFields(token, scope, [1], options);
				assert.equal(toAzureWorkItemEtagFields(etag[0].workItem, 'project', etag[0].category).state, 'opened');
				const native = createWorkItem();
				native.fields['System.State'] = 'Removed';
				native.fields['Microsoft.VSTS.Common.ClosedDate'] = date;
				assert.equal(fromAzureWorkItem(native, azureProvider, azureProject, 'InProgress').state, 'opened');
				assert.equal(
					toIssueShape(point, { ...azureProvider, id: GitCloudHostIntegrationId.GitHub })?.state,
					'closed',
					'other providers keep date semantics',
				);
				h.fixture.state = 'Mystery';
				const unknown = await h.api.getAzureWorkItem(token, scope, 1, options);
				assert.ok(unknown != null);
				assert.equal(
					toIssueShape(unknown, integration)?.state,
					'closed',
					'unknown category keeps date fallback',
				);
			} finally {
				manager.dispose();
			}
		});
	}

	test('an unknown category is partial even when every state is requested', async () => {
		const h = azureHarness();
		h.fixture.categoriesByType = { Task: 'unknown' as AzureWorkItemStateCategory };
		const page = await h.api.getIssuesForAzureProject(azureToken, 'org', 'project', { states: allStates });
		assert.equal(page.values.length, 1);
		assert.equal(page.metadata?.completeness, 'partial');
		await assert.rejects(h.api.getAzureWorkItem(azureToken, scope, 1, {}));
		assert.equal(h.states.length, 1);
	});

	test('a states read is reused for five minutes, then read again', async () => {
		const h = azureHarness();
		const start = realNow();
		Date.now = () => start;
		await h.api.getAzureWorkItem(azureToken, scope, 1, {});

		Date.now = () => start + 5 * 60 * 1000 - 1;
		await h.api.getAzureWorkItem(azureToken, scope, 1, {});
		assert.equal(h.states.length, 1);

		Date.now = () => start + 5 * 60 * 1000;
		await h.api.getAzureWorkItem(azureToken, scope, 1, {});
		assert.equal(h.states.length, 2);
	});

	test('at most 256 states reads are kept, the least recently used dropped first', async () => {
		const h = azureHarness();
		for (let i = 0; i <= 256; i++) {
			h.fixture.types = [`Type${i}`];
			await h.api.getAzureWorkItem(azureToken, scope, 1, {});
		}
		assert.equal(h.states.length, 257);

		h.fixture.types = ['Type256'];
		await h.api.getAzureWorkItem(azureToken, scope, 1, {});
		assert.equal(h.states.length, 257, 'the newest is kept');

		h.fixture.types = ['Type0'];
		await h.api.getAzureWorkItem(azureToken, scope, 1, {});
		assert.equal(h.states.length, 258, 'the oldest was dropped');
	});

	for (const [state, closed] of [
		['Descartado', true],
		['Canceled', true],
		['Removed', false],
	] as const) {
		test(`the cheap etag read closes ${state} exactly as the full read does`, async () => {
			const h = azureHarness();
			h.fixture.state = state;

			const raw = await h.api.getAzureWorkItem(azureToken, scope, 1, {});
			const [cheap] = await h.api.getAzureWorkItemsEtagFields(azureToken, scope, [1], {});
			assert.ok(raw != null && cheap != null);
			const full = toIssueShape(raw, azureProvider);

			assert.equal(full?.state, closed ? 'closed' : 'opened');
			assert.deepEqual(toAzureWorkItemEtagFields(cheap.workItem, 'project', cheap.category), {
				state: full?.state,
				updatedDate: full?.updatedDate,
			});
			const fields = h.workItemReads.find(u => u.pathname.endsWith('/workitems'))?.searchParams.get('fields');
			assert.ok(fields?.split(',').includes('System.State') && fields.split(',').includes('System.WorkItemType'));
			assert.equal(h.states.length, 1, 'both reads share one states read');
		});
	}

	test("the repository-scoped issue read surfaces a project's partial states read", async () => {
		const runtime = createFakeRuntime();
		const h = azureHarness();
		h.fixture.failStates = 503;
		// The same fake host, served through the integration's own `ProvidersApi`.
		runtime.http.fetch = h.fetch;
		const { manager, azure } = await connectedAzure(runtime);

		const result = await azure.getMyIssuesForReposResult([{ namespace: 'org', name: 'r', project: 'project' }]);

		assert.ok(result != null && 'value' in result && result.value != null);
		assert.equal(result.value.values.length, 1);
		assert.equal(result.value.paging?.truncated, true);
		assert.equal(result.value.metadata?.completeness, 'partial');
		assert.deepEqual(result.value.metadata?.failures?.[0].scope, {
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			resourceId: 'org',
			projectId: 'project',
		});
		assert.equal(result.value.metadata?.failures?.[0].kind, 'provider');

		manager.dispose();
	});
});
