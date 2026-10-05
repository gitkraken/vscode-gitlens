import * as assert from 'node:assert/strict';
import { suite, teardown, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { RequestClientError } from '../errors.js';
import type { IntegrationService } from '../integrationService.js';
import { createIntegrationService } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { isJiraMissingProjectError } from '../providers/providerErrors.js';
import { DiscoveryCache, discoveryCacheTtl } from '../providers/utils/discoveryCache.js';
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

/** Jira's `400` for a search scoped to a project it cannot find, as `providersApi` rethrows it. */
function missingProjectError(value: string): RequestClientError {
	const error = new Error('(400) Bad Request.');
	Object.assign(error, {
		response: {
			status: 400,
			body: { errorMessages: [`The value '${value}' does not exist for the field 'project'.`], errors: {} },
		},
	});
	return new RequestClientError(error);
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
		projects: [{ id: '10001', name: 'ALPHA' }],
		deleted: new Set<string>(),
		projectReads: 0,
		searches: [] as string[],
		/** When set, the project list waits on it, so a test can act while the read is in flight. */
		projectsGate: undefined as Promise<void> | undefined,
		searchError: undefined as Error | undefined,
	};
	stubApi(integration, {
		getJiraServerProjects: async () => {
			state.projectReads++;
			const snapshot = state.projects.map(p => ({ ...p }));
			await state.projectsGate;
			return snapshot;
		},
		getJiraServerIssuesForProjectPaged: (_t: unknown, _baseUrl: string, projectId: string) => {
			state.searches.push(projectId);
			if (state.searchError != null) return Promise.reject(state.searchError);
			if (state.deleted.has(projectId)) return Promise.reject(missingProjectError(projectId));

			const project = state.projects.find(p => p.id === projectId)!;
			return Promise.resolve({
				data: [providerIssue(`${project.name}-1`, { ...project, resourceId: jiraServerDomain })],
				hasMore: false,
				nextCursor: undefined,
			});
		},
	});
	await service.refreshConnections();
	await flush();

	const read = (options?: { forceSync?: boolean }) =>
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
			state.projects.push({ id: '10002', name: 'BETA' });
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1'], 'still inside the TTL, with no refresh');
			assert.equal(state.projectReads, 1);

			service.dispose();
		});

		test('a project created mid-session appears after refreshConnections, with no forceSync on the read', async () => {
			const { service, state, read } = await jiraServer();

			await read();
			state.projects.push({ id: '10002', name: 'BETA' });
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
			state.projects.push({ id: '10002', name: 'BETA' });
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
			state.projects.push({ id: '10002', name: 'BETA' });

			assert.deepEqual(titles(await read({ forceSync: true })), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.equal(state.projectReads, 2);

			service.dispose();
		});

		test('a deleted project reads as empty instead of failing the provider, and drops the stale list', async () => {
			const { service, state, read } = await jiraServer();
			state.projects.push({ id: '10002', name: 'BETA' });

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
			state.projects.push({ id: '10002', name: 'BETA' });
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
			state.projects.push({ id: '10002', name: 'BETA' });
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
				projects: [{ id: 'p1', key: 'ALPHA', name: 'ALPHA' }],
				deleted: new Set<string>(),
				projectReads: 0,
				/** When set, the project list waits on it, so a test can act while the read is in flight. */
				projectsGate: undefined as Promise<void> | undefined,
			};
			stubApi(integration, {
				getJiraResourcesForCurrentUser: () => Promise.resolve([site]),
				getJiraProjectsForResource: async () => {
					state.projectReads++;
					const values = state.projects.map(p => ({ ...p, resourceId: site.id, resourceName: site.name }));
					await state.projectsGate;
					return { values: values, paging: undefined };
				},
				getIssuesForProjectPaged: (_t: unknown, projectName: string) => {
					if (state.deleted.has(projectName)) return Promise.reject(missingProjectError(projectName));

					const project = state.projects.find(p => p.name === projectName)!;
					return Promise.resolve({
						data: [providerIssue(`${project.key}-1`, { ...project, resourceId: site.id })],
						hasMore: false,
						nextCursor: undefined,
					});
				},
			});
			await service.refreshConnections();
			await flush();

			const read = () =>
				service.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Jira,
					includeAllAssignees: true,
				});
			return { service: service, runtime: runtime, integration: integration, state: state, read: read };
		}

		test('the re-sync does not put back the project list it persisted before the refresh', async () => {
			const { service, runtime, integration, state, read } = await jiraCloud();

			// The connect persisted the project list, and a refresh re-runs the connect that seeds from it.
			assert.ok(runtime.storage.get('jira:tok-1:projects') != null);
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);

			state.projects.push({ id: 'p2', key: 'BETA', name: 'BETA' });
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
			state.projects.push({ id: 'p2', key: 'BETA', name: 'BETA' });

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
			state.projects.push({ id: 'p2', key: 'BETA', name: 'BETA' });
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
			state.projects.push({ id: 'p2', key: 'BETA', name: 'BETA' });
			await service.refreshConnections();
			await flush();
			await read();

			state.deleted.add('BETA');
			const result = await read();
			assert.deepEqual(titles(result), ['Issue ALPHA-1']);
			assert.equal(result.fetchFailed, undefined);

			const reads = state.projectReads;
			state.projects = state.projects.filter(p => p.name !== 'BETA');
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);
			assert.equal(state.projectReads, reads + 1, "the site's stale list was dropped and re-read");

			service.dispose();
		});
	});

	suite('Linear', () => {
		async function linear() {
			const { service, runtime } = createCloudService(IssuesCloudHostIntegrationId.Linear);
			const integration = await service.get(IssuesCloudHostIntegrationId.Linear);
			const state = { teams: [{ id: 't1', key: 'ALPHA', name: 'Alpha', iconUrl: null }], teamReads: 0 };
			stubApi(integration, {
				getLinearOrganization: () =>
					Promise.resolve({ id: 'org-1', key: 'acme', name: 'Acme', url: 'https://linear.app/acme' }),
				getLinearTeamsForCurrentUser: () => {
					state.teamReads++;
					return Promise.resolve(state.teams.map(t => ({ ...t })));
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
