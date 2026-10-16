import * as assert from 'node:assert/strict';
import { suite, teardown, test } from 'mocha';
import { RequestRateLimitError } from '@gitlens/git/errors.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason, RequestClientError } from '../errors.js';
import type { IntegrationService } from '../integrationService.js';
import { createIntegrationService } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { isJiraMissingProjectError, isJiraServerMissingProjectError } from '../providers/providerErrors.js';
import { DiscoveryCache, discoveryCacheTtl } from '../providers/utils/discoveryCache.js';
import { toSelectionAction } from '../reads/selectionConfirmation.js';
import type { ProviderPagedResult } from '../results.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * #5907: a tracker's project list was cached for the life of the integration, so a project created mid-session never
 * appeared and a deleted one kept being searched, which Jira refuses with a `400` that failed the whole provider.
 *
 * The refreshes are driven the way Kepler drives them: `refreshConnections()` (a forced re-sync of every connection,
 * with the token handed back unchanged, as a PAT always is) followed by a read with NO `forceSync`.
 */

const jiraServerDomain = 'jira.example.com';
const jiraServerBaseUrl = `https://${jiraServerDomain}`;

const realNow = Date.now;
teardown(() => {
	Date.now = realNow;
});

function advanceClock(ms: number): void {
	const now = Date.now();
	Date.now = () => now + ms;
}

async function flush(): Promise<void> {
	for (let i = 0; i < 25; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

/** A cloud-backed connection whose token never changes, like a Jira Data Center PAT. */
function createCloudService(id: IntegrationIds, domain?: string) {
	const runtime = createFakeRuntime();
	const tokenRequests: string[] = [];
	const type = id === IssuesSelfManagedHostIntegrationId.JiraServer ? 'pat' : 'oauth';
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async (path: string) => {
		tokenRequests.push(path);
		const connection = { tokenId: 't1', provider: toCloudIntegrationType[id], type: type, domain: domain };
		const payload =
			path === 'v1/provider-tokens'
				? { data: [connection] }
				: {
						data: {
							...connection,
							accessToken: 'tok-1',
							expiresIn: 3600,
							scopes: '',
							...(id === IssuesCloudHostIntegrationId.Trello ? { appKey: 'app-key' } : {}),
						},
					};
		return new Response(JSON.stringify(payload), { status: 200 });
	};
	// Nothing in these tests may reach a real provider: every read goes through the stubbed API below.
	runtime.http.fetch = () => Promise.reject(new Error('unexpected network request'));
	return { service: createIntegrationService(runtime), runtime: runtime, tokenRequests: tokenRequests };
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

function providerIssue(key: string, project: { id: string; name: string; resourceId: string }) {
	return {
		id: `id-${key}`,
		number: key,
		title: `Issue ${key}`,
		url: `https://jira.example.com/browse/${key}`,
		createdDate: new Date(0),
		updatedDate: new Date(1000),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: [],
		labels: [],
		project: { ...project, key: project.name, namespace: project.name },
	};
}

/**
 * Jira's `400` for a search scoped to a project it cannot find, as `providersApi` rethrows it. `user` is the
 * `X-AUSERNAME` Jira Data Center names the request's user in; Jira Cloud sends no such header.
 */
function missingProjectError(value: string, user?: string): RequestClientError {
	const error = new Error('(400) Bad Request.');
	Object.assign(error, {
		response: {
			status: 400,
			body: { errorMessages: [`The value '${value}' does not exist for the field 'project'.`], errors: {} },
			headers: user != null ? { 'x-ausername': user } : {},
		},
	});
	return new RequestClientError(error);
}

function forbiddenError(): RequestClientError {
	const error = new Error('(403) Forbidden.');
	Object.assign(error, { response: { status: 403, body: { errorMessages: ['Forbidden'], errors: {} } } });
	return new RequestClientError(error);
}

/** The selector-miss warning alone, on an empty, unfailed page with no cursor. */
function assertProjectSelectorMiss(page: ProviderPagedResult<IssueShape>, project: string): void {
	assert.deepEqual(page.items, []);
	assert.equal(page.fetchFailed, undefined);
	assert.equal(page.hasMore, false);
	assert.equal(page.cursor, undefined);
	assert.deepEqual(
		page.warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth, selector: w.selector, scope: w.scope })),
		[{ kind: 'not-found', isAuth: false, selector: { kind: 'project', value: project }, scope: undefined }],
	);
}

/** Moves on every clear of the integration's project cache, so a test can tell a read that cleared it. */
function projectsCacheGeneration(integration: IssuesIntegration): number {
	return (integration as unknown as { _projects: DiscoveryCache<unknown> })._projects.generation;
}

async function prefixesOf(integration: IssuesIntegration): Promise<(string | undefined)[]> {
	return (await integration.autolinks()).map(a => ('prefix' in a ? a.prefix : undefined)).sort();
}

function titles(result: ProviderPagedResult<IssueShape>): string[] {
	return result.items.map(i => i.title).sort();
}

/**
 * A Jira Data Center instance whose projects the test edits between reads. `deleted` projects stay in whatever list
 * the integration cached, but a search scoped to one is refused the way the live instance refuses it.
 */
async function jiraServer() {
	const { service } = createCloudService(IssuesSelfManagedHostIntegrationId.JiraServer, jiraServerDomain);
	const integration = (await service.get(IssuesSelfManagedHostIntegrationId.JiraServer, jiraServerDomain))!;
	const state = {
		projects: [{ id: '10001', key: 'ALPHA', name: 'Alpha' }],
		deleted: new Set<string>(),
		projectReads: 0,
		searches: [] as string[],
		/** When set, the project list waits on it, so a test can act while the read is in flight. */
		projectsGate: undefined as Promise<void> | undefined,
		projectsError: undefined as Error | undefined,
		searchError: undefined as Error | undefined,
		noProjectData: false,
		/** The user a refusal names in `X-AUSERNAME`: `anonymous`, or none, for a token Jira rejected. */
		user: 'julian' as string | undefined,
	};
	stubApi(integration, {
		getJiraServerCurrentUser: () =>
			state.user == null || state.user.toLowerCase() === 'anonymous'
				? Promise.reject(new Error('(401) Unauthorized.'))
				: Promise.resolve({ id: state.user, name: state.user, username: state.user }),
		getJiraServerProjects: async () => {
			state.projectReads++;
			if (state.projectsError != null) throw state.projectsError;

			const snapshot = state.projects.map(p => ({ ...p }));
			await state.projectsGate;
			return state.noProjectData ? undefined : snapshot;
		},
		getJiraServerIssuesForProjectPaged: (_t: unknown, _baseUrl: string, projectId: string) => {
			state.searches.push(projectId);
			if (state.searchError != null) return Promise.reject(state.searchError);
			if (state.deleted.has(projectId)) return Promise.reject(missingProjectError(projectId, state.user));

			const project = state.projects.find(p => p.id === projectId)!;
			return Promise.resolve({
				data: [providerIssue(`${project.key}-1`, { ...project, resourceId: jiraServerDomain })],
				hasMore: false,
				nextCursor: undefined,
			});
		},
	});
	await service.refreshConnections();
	await flush();

	const read = (options?: { forceSync?: boolean; project?: string }) =>
		service.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: jiraServerDomain,
			includeAllAssignees: true,
			...options,
		});
	return { service: service, integration: integration, state: state, read: read };
}

suite('Tracker project cache (#5907)', () => {
	suite('Jira Data Center', () => {
		test('serves the cached project list to an unforced read', async () => {
			const { service, state, read } = await jiraServer();

			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1'], 'still inside the TTL, with no refresh');
			assert.equal(state.projectReads, 1);

			service.dispose();
		});

		test('a project created mid-session appears after refreshConnections, with no forceSync on the read', async () => {
			const { service, state, read } = await jiraServer();

			await read();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });
			await service.refreshConnections();
			await flush();

			const result = await read();
			assert.deepEqual(titles(result), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.equal(result.fetchFailed, undefined);
			assert.equal(state.projectReads, 2);

			service.dispose();
		});

		test('a project created mid-session appears once the cache expires', async () => {
			const { service, state, read } = await jiraServer();

			await read();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });
			advanceClock(discoveryCacheTtl / 2);
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);

			// Cumulative: now past the TTL of the first read's list.
			advanceClock(discoveryCacheTtl / 2);
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.equal(state.projectReads, 2);

			service.dispose();
		});

		test('forceSync on the read re-reads the project list', async () => {
			const { service, state, read } = await jiraServer();

			await read();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });

			assert.deepEqual(titles(await read({ forceSync: true })), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.equal(state.projectReads, 2);

			service.dispose();
		});

		test('a deleted project reads as empty instead of failing the provider, and drops the stale list', async () => {
			const { service, state, read } = await jiraServer();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });

			await read();
			// Deleted after the list was cached: the cached list still names it.
			state.deleted.add('10002');

			const first = await read();
			assert.deepEqual(titles(first), ['Issue ALPHA-1'], "the other projects' issues are still read");
			assert.equal(first.fetchFailed, undefined, 'the provider is not degraded');
			assert.equal(first.warnings.length, 0);

			// The next read re-reads the list, which no longer names the deleted project, so it is not searched again.
			state.projects = state.projects.filter(p => p.id !== '10002');
			state.searches.length = 0;
			const second = await read();
			assert.deepEqual(titles(second), ['Issue ALPHA-1']);
			assert.equal(state.projectReads, 2);
			assert.deepEqual(state.searches, ['10001']);

			service.dispose();
		});

		test('a selected project deleted while the list is cached reads as empty, then misses the selector', async () => {
			const { service, state, read } = await jiraServer();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });

			assert.deepEqual(titles(await read({ project: 'BETA' })), ['Issue BETA-1']);
			state.deleted.add('10002');
			state.projects = state.projects.filter(p => p.id !== '10002');
			state.searches.length = 0;

			const refused = await read({ project: 'BETA' });
			assert.deepEqual(refused.items, []);
			assert.equal(refused.fetchFailed, undefined);
			assert.deepEqual(refused.warnings, [], 'searched from the cached list that still names it, and dropped it');
			assert.deepEqual(state.searches, ['10002']);

			assertProjectSelectorMiss(await read({ project: 'BETA' }), 'BETA');

			service.dispose();
		});

		test('a selected project recreated under its key while the list is cached is read on the next read', async () => {
			const { service, state, read } = await jiraServer();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });

			assert.deepEqual(titles(await read({ project: 'BETA' })), ['Issue BETA-1']);
			state.deleted.add('10002');
			state.projects = [
				...state.projects.filter(p => p.id !== '10002'),
				{ id: '10003', key: 'BETA', name: 'Beta' },
			];
			state.searches.length = 0;

			assert.deepEqual((await read({ project: 'BETA' })).items, [], 'the cached id, refused');
			const result = await read({ project: 'BETA' });
			assert.deepEqual(titles(result), ['Issue BETA-1']);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(result.warnings, []);
			assert.deepEqual(
				state.searches,
				['10002', '10003'],
				'the cached id, then the one the list read again names',
			);

			service.dispose();
		});

		test('a selected project created while the list is cached is read, with no selector', async () => {
			const { service, state, read } = await jiraServer();

			await read();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });

			const result = await read({ project: 'BETA' });
			assert.deepEqual(titles(result), ['Issue BETA-1']);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(result.warnings, []);
			assert.equal(state.projectReads, 3, 'the cached list, the list read again, then the list it refreshed');

			service.dispose();
		});

		test('a selected project missing from the cached list and its re-read misses the selector', async () => {
			const { service, integration, state, read } = await jiraServer();

			await read();
			const generation = projectsCacheGeneration(integration);
			assertProjectSelectorMiss(await read({ project: 'BETA' }), 'BETA');
			assert.equal(state.projectReads, 2, 'one re-read, not one per miss');
			assert.deepEqual(state.searches, ['10001']);
			assert.equal(
				projectsCacheGeneration(integration),
				generation,
				'read past the cache, without clearing it for every other read and connection',
			);

			service.dispose();
		});

		test('a selected project missing from the cached list fails the read when its re-read fails', async () => {
			const { service, state, read } = await jiraServer();

			await read();
			state.projectsError = new Error('connect ECONNRESET');

			const result = await read({ project: 'BETA' });
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.notEqual(result.cursor, undefined, 'the read can be retried');
			assert.equal(result.warnings.length, 1);
			assert.equal(result.warnings[0].selector, undefined);
			assert.equal(state.projectReads, 2);

			service.dispose();
		});

		test('a forced read missing the selected project confirms it once, past the cache', async () => {
			const { service, state, read } = await jiraServer();

			await read();
			assertProjectSelectorMiss(await read({ project: 'BETA', forceSync: true }), 'BETA');
			assert.equal(state.projectReads, 3, 'the refreshed list, then the confirmation, which joins no read');

			service.dispose();
		});

		for (const [label, user] of [
			['as the anonymous user', 'anonymous'],
			['as the anonymous user, capitalized', 'Anonymous'],
			['naming no user', undefined],
		] as const) {
			test(`a refusal ${label}, as for a rejected token, fails the read and keeps the list`, async () => {
				const { service, state, read } = await jiraServer();
				state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });

				assert.deepEqual(titles(await read({ project: 'BETA' })), ['Issue BETA-1']);
				// The project still exists: the token was revoked, so Jira reads as nobody, who sees no project.
				state.deleted.add('10002');
				state.user = user;

				const selected = await read({ project: 'BETA' });
				assert.deepEqual(selected.items, []);
				assert.equal(selected.fetchFailed, true);
				assert.notEqual(selected.cursor, undefined, 'the read can be retried');
				assert.equal(selected.warnings.length, 1);
				assert.equal(selected.warnings[0].selector, undefined);

				const all = await read();
				assert.deepEqual(titles(all), ['Issue ALPHA-1']);
				assert.equal(all.fetchFailed, true, 'not read as a project with no issues');
				assert.equal(state.projectReads, 1, 'the cached list is kept');

				service.dispose();
			});
		}

		test('a rejected token whose answers name no user does not miss the selector', async () => {
			const { service, state, read } = await jiraServer();
			// Behind a proxy that strips `X-AUSERNAME`, a rejected token's project list reads as no projects at all, and
			// only its account lookup is refused.
			state.projects = [];
			state.user = undefined;

			const result = await read({ project: 'ALPHA' });
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.notEqual(result.cursor, undefined, 'the read can be retried');
			assert.equal(
				result.warnings.some(w => w.selector != null),
				false,
			);
			assert.equal(state.projectReads, 2, 'the list was read again before the miss was weighed');

			// The same answers with a credential the account lookup accepts prove the project gone.
			state.user = 'julian';
			assertProjectSelectorMiss(await read({ project: 'ALPHA' }), 'ALPHA');

			service.dispose();
		});

		test('a 403 on the selected project fails the read, with no selector', async () => {
			const { service, state, read } = await jiraServer();
			await read({ project: 'ALPHA' });
			state.searchError = forbiddenError();

			const result = await read({ project: 'ALPHA' });
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
			assert.equal(result.warnings[0].selector, undefined);

			service.dispose();
		});

		test('a project read that returns no data is incomplete, not a removed project', async () => {
			const { service, state, read } = await jiraServer();
			state.noProjectData = true;

			const result = await read({ project: 'ALPHA', forceSync: true });
			assert.deepEqual(result.items, []);
			assert.equal(result.page.truncated, true);
			assert.notEqual(result.cursor, undefined, 'the read can be retried');
			assert.equal(
				result.warnings.some(w => w.selector != null),
				false,
			);
			assert.deepEqual(state.searches, []);

			const listed = await service.listProjects({
				providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
				domain: jiraServerDomain,
			});
			assert.deepEqual(listed.items, []);
			assert.equal(listed.fetchFailed, true, 'an unconfirmed list is not an instance with no projects');

			service.dispose();
		});

		test('any other 400 still fails the read', async () => {
			const { service, state, read } = await jiraServer();
			const error = new Error('(400) Bad Request.');
			Object.assign(error, {
				response: { status: 400, body: { errorMessages: ["Field 'sprint' does not exist."], errors: {} } },
			});
			state.searchError = new RequestClientError(error);

			const result = await read();
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);

			service.dispose();
		});

		test('a project list read before a refresh is not cached after it', async () => {
			const { service, state, read } = await jiraServer();

			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => {
				release = resolve;
			});
			const inFlight = read();
			await flush();
			// The refresh lands while the first list read is still waiting on the server.
			await service.refreshConnections();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });
			state.projectsGate = undefined;
			release();

			assert.deepEqual(titles(await inFlight), ['Issue ALPHA-1'], 'the in-flight read serves what it read');
			assert.deepEqual(
				titles(await read()),
				['Issue ALPHA-1', 'Issue BETA-1'],
				'but that list is not trusted for the next read',
			);
			assert.equal(state.projectReads, 2);

			service.dispose();
		});

		test('a disconnect drops the cached list', async () => {
			const { service, integration, state, read } = await jiraServer();

			await read();
			await integration.disconnect({ silent: true, currentSessionOnly: true });
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });
			await service.refreshConnections();
			await flush();

			assert.deepEqual(titles(await read()), ['Issue ALPHA-1', 'Issue BETA-1']);

			service.dispose();
		});
	});

	suite('Jira Cloud', () => {
		const site = { id: 'site-1', name: 'Site', url: 'https://site.atlassian.net', avatarUrl: '' };

		async function jiraCloud() {
			const { service, runtime } = createCloudService(IssuesCloudHostIntegrationId.Jira);
			const integration = await service.get(IssuesCloudHostIntegrationId.Jira);
			const state = {
				sites: [site],
				siteReads: 0,
				/** When set, the site list waits on it, answering with the sites listed when it was asked. */
				sitesGate: undefined as Promise<void> | undefined,
				projects: [{ id: 'p1', key: 'ALPHA', name: 'Alpha' }],
				deleted: new Set<string>(),
				/** `site:key` pairs deleted on that site alone: unlisted there, and its searches refused. */
				deletedOnSite: new Set<string>(),
				projectReads: 0,
				/** When set, the project list waits on it, so a test can act while the read is in flight. */
				projectsGate: undefined as Promise<void> | undefined,
				searchError: undefined as Error | undefined,
			};
			stubApi(integration, {
				getCurrentUserForResource: () => Promise.resolve({ id: 'me', name: 'Me', username: 'me' }),
				getJiraResourcesForCurrentUser: async () => {
					state.siteReads++;
					const snapshot = state.sites.map(s => ({ ...s }));
					await state.sitesGate;
					return snapshot;
				},
				// Every site lists the same projects.
				getJiraProjectsForResource: async (_t: unknown, resourceId: string) => {
					state.projectReads++;
					const values = state.projects
						.filter(p => !state.deletedOnSite.has(`${resourceId}:${p.key}`))
						.map(p => ({ ...p, resourceId: resourceId, resourceName: site.name }));
					await state.projectsGate;
					return { values: values, paging: undefined };
				},
				// Addressed by key; the names differ from the keys so a read by name finds nothing.
				getIssuesForProjectPaged: (_t: unknown, projectKey: string, resourceId: string) => {
					if (state.searchError != null) return Promise.reject(state.searchError);
					if (state.deleted.has(projectKey) || state.deletedOnSite.has(`${resourceId}:${projectKey}`)) {
						return Promise.reject(missingProjectError(projectKey));
					}

					const project = state.projects.find(p => p.key === projectKey)!;
					return Promise.resolve({
						data: [providerIssue(`${project.key}-1`, { ...project, resourceId: resourceId })],
						hasMore: false,
						nextCursor: undefined,
					});
				},
			});
			await service.refreshConnections();
			await flush();

			const read = (options?: { org?: string; project?: string }) =>
				service.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Jira,
					includeAllAssignees: true,
					...options,
				});
			return { service: service, runtime: runtime, integration: integration, state: state, read: read };
		}

		test('the re-sync does not put back the project list it persisted before the refresh', async () => {
			const { service, runtime, integration, state, read } = await jiraCloud();

			// The connect persisted the project list, and a refresh re-runs the connect that seeds from it.
			assert.ok(runtime.storage.get('jira:tok-1:projects') != null);
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);

			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await service.refreshConnections();
			await flush();

			assert.deepEqual(titles(await read()), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.ok((await prefixesOf(integration)).includes('BETA-'), 'the autolinks follow the new project list');

			service.dispose();
		});

		/**
		 * How many project-list reads a later, UNFORCED connect on the same storage makes, like the next start of the
		 * host. Not through `refreshConnections()`: its forced re-sync drops the caches before connecting, so it never
		 * trusts the persisted list and could not tell a stale one from a fresh one.
		 */
		async function projectReadsOnReconnect(runtime: ReturnType<typeof createCloudService>['runtime']) {
			const fresh = createIntegrationService(runtime);
			const integration = await fresh.get(IssuesCloudHostIntegrationId.Jira);
			let projectReads = 0;
			stubApi(integration, {
				getJiraResourcesForCurrentUser: () => Promise.resolve([site]),
				getJiraProjectsForResource: () => {
					projectReads++;
					return Promise.resolve({ values: [], paging: undefined });
				},
			});
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				id: 't1',
				accessToken: 'tok-1',
				account: { id: 'me', label: 'me' },
				scopes: [],
				cloud: true,
				type: 'oauth',
				domain: 'atlassian.net',
			};
			await (integration as unknown as { providerOnConnect(): Promise<void> }).providerOnConnect();
			fresh.dispose();
			return projectReads;
		}

		test('a connect whose project read spans an invalidation does not persist that read', async () => {
			const { service, runtime, integration, state } = await jiraCloud();
			// Force the connect to read the projects rather than seed them from storage.
			await runtime.storage.delete('jira:tok-1:projects');

			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => {
				release = resolve;
			});
			const connecting = (integration as unknown as { providerOnConnect(): Promise<void> }).providerOnConnect();
			await flush();
			// A refresh lands while the connect's project read is still waiting on the server.
			integration.invalidateDiscoveryCaches();
			state.projectsGate = undefined;
			release();
			await connecting;

			assert.equal(await projectReadsOnReconnect(runtime), 1, 'the list read before the refresh is not trusted');

			service.dispose();
		});

		test('a fresh persisted project list is trusted on connect', async () => {
			const { service, runtime } = await jiraCloud();

			assert.equal(await projectReadsOnReconnect(runtime), 0);

			service.dispose();
		});

		test('a persisted project list older than the TTL is re-read on connect', async () => {
			const { service, runtime, state } = await jiraCloud();
			const stored = runtime.storage.get<{ timestamp: number }>('jira:tok-1:projects')!;
			await runtime.storage.store('jira:tok-1:projects', {
				...stored,
				timestamp: Date.now() - discoveryCacheTtl - 1,
			});
			const reads = state.projectReads;

			assert.equal(await projectReadsOnReconnect(runtime), 1, 'the stale persisted list was not trusted');
			assert.equal(state.projectReads, reads);

			service.dispose();
		});

		test('a disconnect makes the next unforced connect re-read the persisted projects', async () => {
			const { service, integration, state, read } = await jiraCloud();
			await read();
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });

			await integration.disconnect({ silent: true, currentSessionOnly: true });
			// Reconnected with the same token and no forced re-sync, so only the disconnect can have made the list
			// persisted by the first connect untrusted.
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				id: 't1',
				accessToken: 'tok-1',
				account: { id: 'me', label: 'me' },
				scopes: [],
				cloud: true,
				type: 'oauth',
				domain: 'atlassian.net',
			};
			const reads = state.projectReads;
			await (integration as unknown as { providerOnConnect(): Promise<void> }).providerOnConnect();

			assert.equal(state.projectReads, reads + 1);
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1', 'Issue BETA-1']);

			service.dispose();
		});

		test('autolinks serve the last set once expired, and never go empty for lack of a read', async () => {
			const { service, integration, state } = await jiraCloud();

			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_'], 'cached inside the TTL');

			// Past the TTL of both the autolinks and the projects they were built from, with no issue read since.
			advanceClock(discoveryCacheTtl);
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_'], 'the expired set, without waiting');
			await flush();
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);

			service.dispose();
		});

		test('autolinks are not rebuilt with a session kept through a failed refresh (kepler#3546)', async () => {
			const { service, runtime, integration, state } = await jiraCloud();
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);

			// The session expired and the GK API throttles the refresh, so the re-sync keeps the expired session.
			const cached = integration as unknown as { _session: ProviderAuthenticationSession };
			cached._session = { ...cached._session, expiresAt: new Date(Date.now() - 1000) };
			runtime.account.fetchGkApi = () => Promise.resolve(new Response(null, { status: 429 }));
			await integration.syncCloudConnection('connected', true);
			const reads = state.projectReads;

			assert.deepEqual(
				await prefixesOf(integration),
				[],
				'the forced re-sync dropped the built set; none is rebuilt',
			);
			await flush();
			assert.equal(state.projectReads, reads, 'no provider request is made with the expired token');

			service.dispose();
		});

		test('a project read served wholly from the cache returns it, even when the cache is cleared right after', async () => {
			const { service, integration } = await jiraCloud();
			const internals = integration as unknown as {
				_session: ProviderAuthenticationSession;
				getProviderProjectsForResourcesWithMetadata: (
					session: ProviderAuthenticationSession,
					resources: unknown[],
				) => Promise<{ values: { key: string }[] }>;
			};
			const [cached] = (await integration.getResourcesForUserResult())?.value ?? [];
			await integration.getProjectsForResourcesWithMetadataResult([cached]);

			const pending = internals.getProviderProjectsForResourcesWithMetadata(internals._session, [cached]);
			integration.invalidateDiscoveryCaches();
			assert.deepEqual(
				(await pending).values.map(p => p.key),
				['ALPHA'],
			);

			service.dispose();
		});

		test('a project read keeps a cached site when the cache is cleared while it reads another', async () => {
			const { service, integration, state } = await jiraCloud();
			const internals = integration as unknown as {
				_session: ProviderAuthenticationSession;
				getProviderProjectsForResourcesWithMetadata: (
					session: ProviderAuthenticationSession,
					resources: unknown[],
				) => Promise<{ values: { key: string; resourceId: string }[] }>;
			};
			const [cached] = (await integration.getResourcesForUserResult())?.value ?? [];
			await integration.getProjectsForResourcesWithMetadataResult([cached]);

			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			const pending = internals.getProviderProjectsForResourcesWithMetadata(internals._session, [
				cached,
				{ ...cached, id: 'site-2', key: 'site-2', name: 'Site 2' },
			]);
			await flush();
			integration.invalidateDiscoveryCaches();
			release();
			assert.deepEqual((await pending).values.map(p => `${p.resourceId}:${p.key}`).sort(), [
				'site-1:ALPHA',
				'site-2:ALPHA',
			]);

			service.dispose();
		});

		test('concurrent autolink reads share one rebuild', async () => {
			const { service, integration, state } = await jiraCloud();
			integration.invalidateDiscoveryCaches();
			const reads = state.projectReads;

			const all = await Promise.all([prefixesOf(integration), prefixesOf(integration), prefixesOf(integration)]);
			assert.deepEqual(all, [
				['ALPHA-', 'ALPHA_'],
				['ALPHA-', 'ALPHA_'],
				['ALPHA-', 'ALPHA_'],
			]);
			assert.equal(state.projectReads, reads + 1);

			service.dispose();
		});

		test('a deleted project reads as empty instead of failing the provider', async () => {
			const { service, state, read } = await jiraCloud();
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await service.refreshConnections();
			await flush();
			await read();

			state.deleted.add('BETA');
			const result = await read();
			assert.deepEqual(titles(result), ['Issue ALPHA-1']);
			assert.equal(result.fetchFailed, undefined);

			const reads = state.projectReads;
			state.projects = state.projects.filter(p => p.key !== 'BETA');
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);
			assert.equal(state.projectReads, reads + 1, "the site's stale list was dropped and re-read");

			service.dispose();
		});

		test('a selected project deleted while the list is cached reads as empty, then misses the selector', async () => {
			const { service, state, read } = await jiraCloud();
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await service.refreshConnections();
			await flush();
			assert.deepEqual(titles(await read({ project: 'BETA' })), ['Issue BETA-1']);

			state.deleted.add('BETA');
			state.projects = state.projects.filter(p => p.key !== 'BETA');
			const refused = await read({ project: 'BETA' });
			assert.deepEqual(refused.items, []);
			assert.deepEqual(refused.warnings, [], 'searched from the cached list that still names it, and dropped it');
			assertProjectSelectorMiss(await read({ project: 'BETA' }), 'BETA');

			service.dispose();
		});

		/**
		 * Every page of `reads` paged `project: 'BETA'` reads (one by default), `itemsPerPage` projects at a time, on
		 * sites that all listed BETA. Each read starts again from the first page.
		 */
		async function readBetaPaged(
			edit: (state: Awaited<ReturnType<typeof jiraCloud>>['state']) => void,
			options?: { sites?: number; itemsPerPage?: number; reads?: number },
		) {
			const { service, state, read } = await jiraCloud();
			state.sites = Array.from({ length: options?.sites ?? 2 }, (_, i) =>
				i === 0 ? site : { ...site, id: `site-${i + 1}`, name: `Site ${i + 1}` },
			);
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await service.refreshConnections();
			await flush();
			assert.equal(
				titles(await read({ project: 'BETA' })).length,
				state.sites.length,
				'BETA is cached on every site',
			);

			edit(state);
			const items: IssueShape[] = [];
			const warnings: ProviderPagedResult<IssueShape>['warnings'] = [];
			for (let read = 0; read < (options?.reads ?? 1); read++) {
				let cursor: string | undefined;
				let pages = 0;
				do {
					const result = await service.listIssueTrackerIssuesPage({
						providerId: IssuesCloudHostIntegrationId.Jira,
						includeAllAssignees: true,
						project: 'BETA',
						itemsPerPage: options?.itemsPerPage ?? 1,
						cursor: cursor,
					});
					items.push(...result.items);
					warnings.push(...result.warnings);
					cursor = result.cursor;
				} while (cursor != null && ++pages < 5);
			}
			service.dispose();
			return { items: items, warnings: warnings };
		}

		test('a selected project deleted on every site misses the selector once each refused list is read again', async () => {
			// A refusal drops its site's list, and a paged read's later windows move with it, so each read refuses one
			// site here; the read after the last refusal lists BETA nowhere.
			const { items, warnings } = await readBetaPaged(
				state => {
					state.deleted.add('BETA');
					state.projects = state.projects.filter(p => p.key !== 'BETA');
				},
				{ reads: 3 },
			);
			assert.deepEqual(items, []);
			assert.deepEqual(
				warnings.map(w => w.selector),
				[{ kind: 'project', value: 'BETA' }],
			);
		});

		test('a selection confirmed past the cache neither joins nor overwrites a discovery read in flight', async () => {
			const { service, integration, state, read } = await jiraCloud();
			await read();
			advanceClock(discoveryCacheTtl);
			let release!: () => void;
			state.sitesGate = new Promise<void>(resolve => (release = resolve));
			// An ordinary read, started before site-2 exists, waits on the site list.
			const earlier = integration.getResourcesForUserResult();
			await flush();
			state.sitesGate = undefined;
			state.sites = [...state.sites, { ...site, id: 'site-2', name: 'Site 2' }];
			// Meanwhile another read cached the list from before site-2, so the selection misses it there.
			(integration as unknown as { _organizations: DiscoveryCache<unknown[]> })._organizations.set('tok-1', [
				{ ...site, key: site.id },
			]);

			const result = await read({ org: 'site-2' });
			assert.deepEqual(
				titles(result),
				['Issue ALPHA-1'],
				'the confirmation saw site-2, and the refreshed read read it',
			);

			release();
			assert.deepEqual(
				(await earlier)?.value?.map(s => s.id),
				['site-1'],
				'the earlier read answers what it read, and is refused by the refresh',
			);
			const siteReads = state.siteReads;
			assert.deepEqual(
				(await integration.getResourcesForUserResult())?.value?.map(s => s.id),
				['site-1', 'site-2'],
				'the earlier read did not put its older list back',
			);
			assert.equal(state.siteReads, siteReads, 'served from the cache');

			service.dispose();
		});

		test('a read refreshed after a stale confirmation that joins an older site read misses no selector', async () => {
			const { service, integration, state, read } = await jiraCloud();
			await read();
			// The cache lists site-1 alone; site-2 exists, and the confirmation, which joins no read, lists it.
			state.sites = [...state.sites, { ...site, id: 'site-2', name: 'Site 2' }];
			// An ordinary site read that answers as from before site-2 holds the shared lookup the read refreshed
			// after the confirmation joins, as a read started before the caches were dropped would.
			const shared = integration as unknown as {
				getResourcesForUserResult: (connectionId?: string) => Promise<{ value?: unknown[] }>;
			};
			const uncachedShared = shared.getResourcesForUserResult.bind(integration);
			let joins = 0;
			shared.getResourcesForUserResult = connectionId => {
				joins++;
				return joins === 1
					? uncachedShared(connectionId)
					: Promise.resolve({ value: [{ ...site, key: site.id }] });
			};

			const result = await read({ org: 'site-2' });
			assert.equal(joins, 2, 'the read, then the one refreshed after the confirmation found site-2');
			assert.equal(
				result.warnings.some(w => w.selector != null),
				false,
				'site-2 is listed now, whatever the joined read answered',
			);
			assert.equal(result.fetchFailed, true);
			assert.notEqual(result.cursor, undefined, 'retried on the next read');

			service.dispose();
		});

		test('a selected site removed while the list is cached misses the site, not its project', async () => {
			const { service, state, read } = await jiraCloud();
			// The cache still lists site-1, which no longer lists NOPE; the lists now name site-1 no longer.
			await read();
			state.sites = [{ ...site, id: 'site-2', name: 'Site 2' }];

			const result = await read({ org: site.id, project: 'NOPE' });
			assert.deepEqual(
				result.warnings.map(w => w.selector),
				[{ kind: 'org', value: site.id }],
			);

			service.dispose();
		});

		test('a selected site created while the list is cached, with a project it lacks, misses the project', async () => {
			const { service, state, read } = await jiraCloud();
			await read();
			state.sites = [...state.sites, { ...site, id: 'site-2', name: 'Site 2' }];

			// site-2 is listed now: the miss is the project's, found once the read is made over the fresh lists.
			assertProjectSelectorMiss(await read({ org: 'site-2', project: 'NOPE' }), 'NOPE');

			service.dispose();
		});

		test('a selected project created while the list is cached is read, with no selector', async () => {
			const { service, state, read } = await jiraCloud();
			await read();
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			const reads = state.projectReads;

			const result = await read({ project: 'BETA' });
			assert.deepEqual(titles(result), ['Issue BETA-1']);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(result.warnings, []);
			assert.equal(state.projectReads, reads + 2, 'the list read again, then the list it refreshed');

			service.dispose();
		});

		test('a selected site created while the list is cached is read, with no selector', async () => {
			const { service, state, read } = await jiraCloud();
			await read();
			state.sites = [...state.sites, { ...site, id: 'site-2', name: 'Site 2' }];
			const siteReads = state.siteReads;

			const result = await read({ org: 'site-2' });
			assert.deepEqual(titles(result), ['Issue ALPHA-1']);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(result.warnings, []);
			assert.equal(state.siteReads, siteReads + 2, 'the list read again, then the list it refreshed');

			service.dispose();
		});

		test('a selected site missing from the cached list and its re-read misses the selector', async () => {
			const { service, integration, state, read } = await jiraCloud();
			await read();
			const siteReads = state.siteReads;
			const generation = projectsCacheGeneration(integration);

			const result = await read({ org: 'site-2' });
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, undefined);
			assert.equal(result.cursor, undefined);
			assert.deepEqual(
				result.warnings.map(w => ({ kind: w.kind, selector: w.selector })),
				[{ kind: 'not-found', selector: { kind: 'org', value: 'site-2' } }],
			);
			assert.equal(state.siteReads, siteReads + 1, 'one re-read, not one per miss');
			assert.equal(
				projectsCacheGeneration(integration),
				generation,
				'read past the cache, without clearing it for every other read and connection',
			);

			service.dispose();
		});

		test('a confirmation refused for the credential reports that refusal, not a generic one', async () => {
			const { service, integration, read } = await jiraCloud();
			await read();
			(
				integration as unknown as { getUncachedDiscoveryResult: () => Promise<unknown> }
			).getUncachedDiscoveryResult = () =>
				Promise.resolve({
					error: new AuthenticationError(
						{
							providerId: IssuesCloudHostIntegrationId.Jira,
							microHash: undefined,
							cloud: true,
							type: 'oauth',
							scopes: [],
						},
						AuthenticationErrorReason.Unauthorized,
					),
				});

			const result = await read({ org: 'site-2' });
			assert.equal(result.fetchFailed, true);
			assert.notEqual(result.cursor, undefined);
			assert.deepEqual(
				result.warnings.map(w => ({ kind: w.kind, selector: w.selector })),
				[{ kind: 'auth', selector: undefined }],
				'consumers can still tell to reconnect',
			);

			service.dispose();
		});

		test('a confirmation that hit a rate limit reports it, not a generic failure', async () => {
			const { service, integration, read } = await jiraCloud();
			await read();
			(
				integration as unknown as { getUncachedDiscoveryResult: () => Promise<unknown> }
			).getUncachedDiscoveryResult = () =>
				Promise.resolve({ error: new RequestRateLimitError(new Error('rate limited'), undefined, undefined) });

			const result = await read({ org: 'site-2' });
			assert.equal(result.fetchFailed, true);
			assert.notEqual(result.cursor, undefined);
			assert.deepEqual(
				result.warnings.map(w => ({ kind: w.kind, selector: w.selector })),
				[{ kind: 'rate-limit', selector: undefined }],
				'consumers can still back off',
			);

			service.dispose();
		});

		test('a confirmation whose project list a site refused reports that refusal', async () => {
			const { service, integration, read } = await jiraCloud();
			await read();
			(
				integration as unknown as { getUncachedDiscoveryResult: () => Promise<unknown> }
			).getUncachedDiscoveryResult = () =>
				Promise.resolve({
					value: {
						resources: [{ ...site, key: site.id }],
						projects: {
							values: [],
							metadata: {
								completeness: 'partial',
								failures: [{ kind: 'authentication', scope: { resourceId: site.id } }],
							},
						},
					},
				});

			const result = await read({ project: 'NOPE' });
			assert.equal(result.fetchFailed, true);
			assert.ok(
				result.warnings.some(w => w.kind === 'auth' && w.scope?.resourceId === site.id),
				'the site refusal is reported, not a generic one',
			);
			assert.equal(
				result.warnings.some(w => w.selector != null),
				false,
			);

			service.dispose();
		});

		test('a 403 on the selected project fails the read, with no selector', async () => {
			const { service, state, read } = await jiraCloud();
			await read({ project: 'ALPHA' });
			state.searchError = forbiddenError();

			const result = await read({ project: 'ALPHA' });
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
			assert.equal(result.warnings[0].selector, undefined);

			service.dispose();
		});
	});

	suite('Linear', () => {
		async function linear() {
			const { service, runtime } = createCloudService(IssuesCloudHostIntegrationId.Linear);
			const integration = await service.get(IssuesCloudHostIntegrationId.Linear);
			const state = {
				teams: [{ id: 't1', key: 'ALPHA', name: 'Alpha', iconUrl: null }],
				teamReads: 0,
				noTeamData: false,
				noOrganizationData: false,
				/** When set, the team list waits on it, answering with the teams listed when it was asked. */
				teamsGate: undefined as Promise<void> | undefined,
			};
			stubApi(integration, {
				getLinearOrganization: () =>
					Promise.resolve(
						state.noOrganizationData
							? undefined
							: { id: 'org-1', key: 'acme', name: 'Acme', url: 'https://linear.app/acme' },
					),
				getLinearCurrentUser: () =>
					Promise.resolve({ id: 'me', name: 'Me', displayName: 'me', email: undefined }),
				getLinearTeamsForCurrentUser: async () => {
					state.teamReads++;
					const snapshot = state.noTeamData ? undefined : state.teams.map(t => ({ ...t }));
					await state.teamsGate;
					return snapshot;
				},
				getLinearIssues: (_t: unknown, input: { teams?: string[] }) => {
					const team = state.teams.find(t => t.id === input.teams?.[0])!;
					return Promise.resolve({
						values: [
							{
								...providerIssue(`${team.key}-1`, {
									id: team.id,
									name: team.name,
									resourceId: 'org-1',
								}),
								url: `https://linear.app/acme/issue/${team.key}-1`,
							},
						],
						paging: { more: false, cursor: '{}' },
					});
				},
			});
			await service.refreshConnections();
			await flush();

			const read = () =>
				service.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Linear,
					includeAllAssignees: true,
				});
			return { service: service, integration: integration, state: state, read: read, runtime: runtime };
		}

		test('autolinks are not rebuilt with a session kept through a failed refresh (kepler#3546)', async () => {
			const { service, runtime, integration, state } = await linear();
			const built = await prefixesOf(integration);
			assert.ok(built.length > 0, 'the team autolinks are built');

			// The session expired and the GK API throttles the refresh, so the re-sync keeps the expired session.
			const cached = integration as unknown as { _session: ProviderAuthenticationSession };
			cached._session = { ...cached._session, expiresAt: new Date(Date.now() - 1000) };
			runtime.account.fetchGkApi = () => Promise.resolve(new Response(null, { status: 429 }));
			await integration.syncCloudConnection('connected', true);
			const reads = state.teamReads;

			await prefixesOf(integration);
			await flush();
			assert.equal(state.teamReads, reads, 'no provider request is made with the expired token');

			service.dispose();
		});

		test('a team read that returns no data is incomplete, not a removed team', async () => {
			const { service, state } = await linear();
			state.noTeamData = true;

			const result = await service.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Linear,
				project: 'ALPHA',
				includeAllAssignees: true,
				forceSync: true,
			});
			assert.deepEqual(result.items, []);
			assert.equal(result.page.truncated, true);
			assert.equal(
				result.warnings.some(w => w.selector != null),
				false,
			);

			service.dispose();
		});

		test('a selected team missing from the cache and its re-read misses the selector', async () => {
			const { service, read } = await linear();
			await read();

			const result = await service.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Linear,
				project: 'BETA',
				includeAllAssignees: true,
			});
			assertProjectSelectorMiss(result, 'BETA');

			service.dispose();
		});

		test('a selected team missing from the cache is no selector miss when its re-read finds no organization', async () => {
			const { service, state, read } = await linear();
			await read();
			// The confirmation re-reads the organization, which now answers with no data while the cache holds it.
			state.noOrganizationData = true;

			const result = await service.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Linear,
				project: 'BETA',
				includeAllAssignees: true,
			});
			assert.deepEqual(result.items, []);
			assert.equal(
				result.warnings.some(w => w.selector != null),
				false,
				'an unconfirmed discovery is not a removed team',
			);
			assert.equal(result.fetchFailed, true);
			assert.notEqual(result.cursor, undefined, 'retried on the next read');

			service.dispose();
		});

		test('a team created mid-session appears after refreshConnections', async () => {
			const { service, state, read } = await linear();

			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);
			state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1'], 'cached while no refresh and inside the TTL');

			await service.refreshConnections();
			await flush();
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1', 'Issue BETA-1']);

			service.dispose();
		});

		test('a team created mid-session appears once the cache expires', async () => {
			const { service, state, read } = await linear();

			await read();
			state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
			advanceClock(discoveryCacheTtl);
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1', 'Issue BETA-1']);

			service.dispose();
		});

		test('autolinks serve the last set once expired and pick up a new team from the rebuild', async () => {
			const { service, integration, state } = await linear();

			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_'], 'cached inside the TTL');

			advanceClock(discoveryCacheTtl);
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_'], 'the expired set, without waiting');
			await flush();
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);

			service.dispose();
		});
	});

	suite('Trello', () => {
		test('keeps no board cache, so a board created mid-session appears on the next read', async () => {
			const { service } = createCloudService(IssuesCloudHostIntegrationId.Trello);
			const trello = await service.get(IssuesCloudHostIntegrationId.Trello);
			(trello as unknown as { _session: ProviderAuthenticationSession })._session = {
				id: 'trello',
				accessToken: 'tok-1',
				account: { id: 'me', label: 'me' },
				scopes: [],
				cloud: true,
				type: 'oauth',
				domain: 'trello.com',
				appKey: 'app-key',
			};
			const boards = [{ id: 'b1', name: 'Alpha' }];
			stubApi(trello, {
				getTrelloBoardsForCurrentUser: () => Promise.resolve(boards.map(b => ({ ...b }))),
				getTrelloListsForBoard: () => Promise.resolve([]),
				getTrelloIssuesForBoard: (_t: unknown, _appKey: string, boardId: string) =>
					Promise.resolve({
						values: [
							{
								...providerIssue(`card-${boardId}`, {
									id: boardId,
									name: boardId,
									resourceId: boardId,
								}),
								url: `https://trello.com/c/${boardId}`,
							},
						],
						metadata: { completeness: 'complete' },
					}),
			});
			const read = () =>
				service.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Trello,
					includeAllAssignees: true,
				});

			assert.deepEqual(titles(await read()), ['Issue card-b1']);
			boards.push({ id: 'b2', name: 'Beta' });
			assert.deepEqual(titles(await read()), ['Issue card-b1', 'Issue card-b2']);

			service.dispose();
		});
	});

	suite('isJiraMissingProjectError', () => {
		const withResponse = (status: number, body: unknown): Error =>
			Object.assign(new Error(`(${status})`), { response: { status: status, body: body } });

		test('recognizes the refusal, raw or wrapped', () => {
			const raw = withResponse(400, {
				errorMessages: ["The value 'KPSC290' does not exist for the field 'project'."],
			});
			assert.equal(isJiraMissingProjectError(raw), true);
			assert.equal(isJiraMissingProjectError(new RequestClientError(raw)), true);
			assert.equal(
				isJiraMissingProjectError(
					withResponse(400, { errorMessages: ["The value '10476' does not exist for the field 'project'."] }),
				),
				true,
				'a numeric project id, as Jira Data Center reads are scoped',
			);
		});

		test('rejects anything else', () => {
			const missing = "The value 'X' does not exist for the field 'project'.";
			assert.equal(isJiraMissingProjectError(new Error('boom')), false);
			assert.equal(isJiraMissingProjectError(undefined), false);
			assert.equal(isJiraMissingProjectError(withResponse(404, { errorMessages: [missing] })), false);
			assert.equal(isJiraMissingProjectError(withResponse(400, { errorMessages: [] })), false);
			assert.equal(isJiraMissingProjectError(withResponse(400, 'Bad Request')), false);
			assert.equal(
				isJiraMissingProjectError(
					withResponse(400, { errorMessages: [missing, "Field 'sprint' does not exist."] }),
				),
				false,
				'a JQL wrong in another way too is a real failure',
			);
			assert.equal(
				isJiraMissingProjectError(
					withResponse(400, { errorMessages: ["The value 'me' does not exist for the field 'assignee'."] }),
				),
				false,
				'another field is not a missing project',
			);
		});

		test('on Jira Data Center, only a refusal that names the user it authenticated', () => {
			const refusal = (headers: Record<string, string> | Headers | undefined): Error =>
				Object.assign(new Error('(400)'), {
					response: {
						status: 400,
						body: { errorMessages: ["The value 'OPS' does not exist for the field 'project'."] },
						headers: headers,
					},
				});
			const authenticated = refusal({ 'x-ausername': 'julian' });
			assert.equal(isJiraServerMissingProjectError(authenticated), true);
			assert.equal(isJiraServerMissingProjectError(new RequestClientError(authenticated)), true);
			assert.equal(isJiraServerMissingProjectError(refusal(new Headers({ 'X-AUSERNAME': 'julian' }))), true);

			assert.equal(isJiraServerMissingProjectError(refusal({ 'x-ausername': 'anonymous' })), false);
			assert.equal(isJiraServerMissingProjectError(refusal({ 'x-ausername': 'Anonymous' })), false);
			assert.equal(isJiraServerMissingProjectError(refusal({ 'x-ausername': '' })), false);
			assert.equal(isJiraServerMissingProjectError(refusal({})), false);
			assert.equal(isJiraServerMissingProjectError(refusal(undefined)), false);
			assert.equal(isJiraMissingProjectError(refusal(undefined)), true, 'Jira Cloud sends no such header');
			assert.equal(
				isJiraServerMissingProjectError(
					Object.assign(new Error('(400)'), {
						response: {
							status: 400,
							body: { errorMessages: ["Field 'sprint' does not exist."] },
							headers: { 'x-ausername': 'julian' },
						},
					}),
				),
				false,
				'an authenticated user does not make another refusal a missing project',
			);
		});
	});

	suite('uncached confirmation reads', () => {
		async function jiraCloudForReset() {
			const { service } = createCloudService(IssuesCloudHostIntegrationId.Jira);
			const integration = await service.get(IssuesCloudHostIntegrationId.Jira);
			stubApi(integration, {
				getCurrentUserForResource: () => Promise.resolve({ id: 'me', name: 'Me', username: 'me' }),
				getJiraResourcesForCurrentUser: () =>
					Promise.resolve([{ id: 'site-1', name: 'Site', url: 'https://site.atlassian.net', avatarUrl: '' }]),
				getJiraProjectsForResource: () => Promise.resolve({ values: [], paging: undefined }),
			});
			await service.refreshConnections();
			await flush();
			return { service: service, integration: integration };
		}

		test('a success clears the failure they recorded, as the cached reads do', async () => {
			const { service, integration } = await jiraCloudForReset();
			const marks = integration as unknown as {
				requestSessionSyncForUsecase: (usecase: string) => void;
				hasSessionSyncRequests: () => boolean;
			};

			// A refusal marked the discovery for a re-sync; the re-sync healed it, and the next confirmation succeeds.
			marks.requestSessionSyncForUsecase('getProjectsForResources');
			await integration.getUncachedDiscoveryResult(() => true);
			assert.equal(marks.hasSessionSyncRequests(), false, 'a later refusal can re-sync again');

			marks.requestSessionSyncForUsecase('getAccountForResource');
			await integration.getUncachedAccountForResourceResult({ key: 'site-1', id: 'site-1', name: 'Site' });
			assert.equal(marks.hasSessionSyncRequests(), false, 'a later refusal can re-sync again');

			service.dispose();
		});
	});

	suite('toSelectionAction', () => {
		test('reports a miss, refreshes a stale cache once, and leaves the unknown unconfirmed', () => {
			const missing = { verdict: 'missing', missed: 'project', resource: undefined } as const;
			assert.deepEqual(toSelectionAction(missing, false), {
				action: 'report-missing',
				missed: 'project',
				resource: undefined,
			});
			assert.equal(toSelectionAction(missing, true).action, 'report-missing');
			assert.equal(toSelectionAction({ verdict: 'stale' }, false).action, 'refresh');
			assert.equal(toSelectionAction({ verdict: 'stale' }, true).action, 'unconfirmed', 'not made again');
			assert.equal(toSelectionAction({ verdict: 'unknown', warnings: [] }, false).action, 'unconfirmed');
		});
	});

	suite('DiscoveryCache', () => {
		test('expires entries after the TTL, counted from storedAt', () => {
			// Frozen, so a slow runner can't age the entry seeded 1ms short of the TTL before it is read.
			advanceClock(0);
			const cache = new DiscoveryCache<number>(1000);
			cache.set('a', 1);
			cache.set('b', 2, { storedAt: Date.now() - 999 });
			assert.equal(cache.get('a'), 1);
			assert.equal(cache.get('b'), 2);

			advanceClock(1);
			assert.equal(cache.get('b'), undefined, 'a seeded entry keeps the age of the read that produced it');
			assert.equal(cache.get('a'), 1);

			advanceClock(1000);
			assert.equal(cache.get('a'), undefined);
		});

		test('refuses a value read before a clear', () => {
			const cache = new DiscoveryCache<number>();
			const before = cache.generation;
			cache.clear();

			assert.equal(cache.set('a', 1, { generation: before }), false);
			assert.equal(cache.get('a'), undefined);
			assert.equal(cache.set('a', 2, { generation: cache.generation }), true);
			assert.equal(cache.get('a'), 2);
		});
	});
});
