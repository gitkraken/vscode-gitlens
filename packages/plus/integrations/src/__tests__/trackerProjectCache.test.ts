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
import { DiscoveryCache, discoveryCacheTtl, incompleteAutolinksRetryDelay } from '../providers/utils/discoveryCache.js';
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

/** Lets pending work run until `condition` holds, failing with `what` when it never does. */
async function until(condition: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 20 && !condition(); i++) {
		await flush();
	}
	assert.ok(condition(), what);
}

/** Counts the calls to the integration's shared resource lookup, whatever each then joins. */
function countResourceLookups(integration: IssuesIntegration): { count: number } {
	const lookups = { count: 0 };
	const shared = integration as unknown as { getResourcesForUserResult: (connectionId?: string) => Promise<unknown> };
	const lookup = shared.getResourcesForUserResult.bind(integration);
	shared.getResourcesForUserResult = connectionId => {
		lookups.count++;
		return lookup(connectionId);
	};
	return lookups;
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
	const { service, runtime, tokenRequests } = createCloudService(
		IssuesSelfManagedHostIntegrationId.JiraServer,
		jiraServerDomain,
	);
	const integration = (await service.get(IssuesSelfManagedHostIntegrationId.JiraServer, jiraServerDomain))!;
	const state = {
		projects: [{ id: '10001', key: 'ALPHA', name: 'Alpha' }],
		deleted: new Set<string>(),
		projectReads: 0,
		accountReads: 0,
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
		getJiraServerCurrentUser: () => {
			state.accountReads++;
			return state.user == null || state.user.toLowerCase() === 'anonymous'
				? Promise.reject(new Error('(401) Unauthorized.'))
				: Promise.resolve({ id: state.user, name: state.user, username: state.user });
		},
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

	const read = (options?: { forceSync?: boolean; project?: string; connectionId?: string }) =>
		service.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: jiraServerDomain,
			includeAllAssignees: true,
			...options,
		});
	return {
		service: service,
		runtime: runtime,
		tokenRequests: tokenRequests,
		integration: integration,
		state: state,
		read: read,
	};
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

		test('a per-connection forceSync read re-reads the project list when its re-sync succeeds', async () => {
			// The per-connection re-sync goes through the auth provider, which never reaches the integration's own re-sync
			// and the cache drop it makes, so only the read's own drop lets it see the new project.
			const { service, state, tokenRequests, read } = await jiraServer();

			await read({ connectionId: 't1' });
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });
			const syncs = tokenRequests.length;

			const result = await read({ connectionId: 't1', forceSync: true });
			assert.ok(tokenRequests.length > syncs, 'the connection was re-synced');
			assert.deepEqual(titles(result), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.equal(result.fetchFailed, undefined);
			assert.equal(state.projectReads, 2);

			service.dispose();
		});

		test('a per-connection forceSync read re-reads the project list even when its re-sync fails', async () => {
			// A failed refetch keeps the stored token and still has the read go ahead, and nothing on this path drops
			// the cache but the read itself, so the list cached before the refresh must not outlive it.
			const { service, runtime, state, read } = await jiraServer();

			await read({ connectionId: 't1' });
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });
			let syncs = 0;
			runtime.account.fetchGkApi = () => {
				syncs++;
				return Promise.reject(new Error('GK API outage'));
			};

			const result = await read({ connectionId: 't1', forceSync: true });
			assert.ok(syncs > 0, 'the re-sync was attempted');
			assert.deepEqual(titles(result), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.equal(state.projectReads, 2);

			service.dispose();
		});

		test('a forceSync read re-reads the project list even when its re-sync fails', async () => {
			// The primary read's failed re-sync still has the read go ahead, so the list cached before the refresh must
			// not outlive the refresh the caller asked for.
			const { service, runtime, state, read } = await jiraServer();

			await read();
			state.projects.push({ id: '10002', key: 'BETA', name: 'Beta' });
			let syncs = 0;
			runtime.account.fetchGkApi = () => {
				syncs++;
				return Promise.reject(new Error('GK API outage'));
			};

			const result = await read({ forceSync: true });
			assert.ok(syncs > 0, 'the re-sync was attempted');
			assert.deepEqual(titles(result), ['Issue ALPHA-1', 'Issue BETA-1']);
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
			assert.equal(state.projectReads, 1, 'the anonymous empty response fails its first discovery read');
			assert.equal(state.accountReads, 1, 'a fresh account check proves the credential was refused');

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
		const otherSite = { id: 'site-2', name: 'Other', url: 'https://other.atlassian.net', avatarUrl: '' };

		async function jiraCloud() {
			const { service, runtime } = createCloudService(IssuesCloudHostIntegrationId.Jira);
			const integration = await service.get(IssuesCloudHostIntegrationId.Jira);
			const state = {
				sites: [site],
				siteReads: 0,
				/** When set, the site list waits on it, answering with the sites listed when it was asked. */
				sitesGate: undefined as Promise<void> | undefined,
				/** When set, the site list read fails, after `sitesGate`. */
				sitesError: undefined as Error | undefined,
				projects: [{ id: 'p1', key: 'ALPHA', name: 'Alpha' }],
				deleted: new Set<string>(),
				/** `site:key` pairs deleted on that site alone: unlisted there, and its searches refused. */
				deletedOnSite: new Set<string>(),
				projectReads: 0,
				/** When set, the project list waits on it, so a test can act while the read is in flight. */
				projectsGate: undefined as Promise<void> | undefined,
				/** Sites whose project list read fails, after `projectsGate`. */
				failingSites: new Set<string>(),
				/** Sites whose project list comes back cut short. */
				truncatedSites: new Set<string>(),
				/** Sites whose project list reads its first page and fails on the second. */
				secondPageFailingSites: new Set<string>(),
				searchError: undefined as Error | undefined,
				/** The sites the issue searches were made on. */
				searchedSites: new Set<string>(),
			};
			stubApi(integration, {
				getCurrentUserForResource: () => Promise.resolve({ id: 'me', name: 'Me', username: 'me' }),
				getJiraResourcesForCurrentUser: async () => {
					state.siteReads++;
					const snapshot = state.sites.map(s => ({ ...s }));
					await state.sitesGate;
					if (state.sitesError != null) throw state.sitesError;

					return snapshot;
				},
				// Every site lists the same projects.
				getJiraProjectsForResource: async (_t: unknown, resourceId: string, options?: { cursor?: string }) => {
					state.projectReads++;
					const values = state.projects
						.filter(p => !state.deletedOnSite.has(`${resourceId}:${p.key}`))
						.map(p => ({ ...p, resourceId: resourceId, resourceName: site.name }));
					await state.projectsGate;
					if (state.failingSites.has(resourceId)) throw new Error('(503) Service Unavailable.');

					// The first project on its own page, and a second page, with the rest, that fails.
					if (state.secondPageFailingSites.has(resourceId)) {
						if (options?.cursor === 'p2') throw new Error('(503) Service Unavailable.');

						return { values: values.slice(0, 1), paging: { more: true, cursor: 'p2' } };
					}

					// A truncated site's list advertises a continuation that leads nowhere, so the drain stops short.
					const truncated = state.truncatedSites.has(resourceId);
					return { values: values, paging: truncated ? { more: true, cursor: '{}' } : undefined };
				},
				// Addressed by key; the names differ from the keys so a read by name finds nothing.
				getIssuesForProjectPaged: (_t: unknown, projectKey: string, resourceId: string) => {
					state.searchedSites.add(resourceId);
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

		test('a real unforced connect reads discovery despite fresh persisted lists', async () => {
			const { service, runtime } = await jiraCloud();
			service.dispose();
			const timestamp = Date.now();
			await runtime.storage.store('jira:tok-1:organizations', { v: 1, timestamp: timestamp, data: [site] });
			await runtime.storage.store('jira:tok-1:projects', {
				v: 1,
				timestamp: timestamp,
				data: [{ id: 'persisted', key: 'OLD', name: 'Old', resourceId: site.id, resourceName: site.name }],
			});
			let writes = 0;
			const store = runtime.storage.store;
			runtime.storage.store = async (key, value) => {
				if (key.startsWith('jira:')) {
					writes++;
				}

				await store(key, value);
			};
			const fresh = createIntegrationService(runtime);
			try {
				const integration = await fresh.get(IssuesCloudHostIntegrationId.Jira);
				let sites = 0;
				let projects = 0;
				stubApi(integration, {
					getJiraResourcesForCurrentUser: async () => {
						sites++;
						return [site];
					},
					getJiraProjectsForResource: async () => {
						projects++;
						return {
							values: [
								{ id: 'live', key: 'LIVE', name: 'Live', resourceId: site.id, resourceName: site.name },
							],
						};
					},
				});
				await (
					integration as unknown as {
						resolveSessionLocked(options: { createIfNeeded: boolean }): Promise<unknown>;
					}
				).resolveSessionLocked({ createIfNeeded: false });
				await flush();
				assert.equal(sites, 1);
				assert.equal(projects, 1);
				assert.deepEqual(await prefixesOf(integration), ['LIVE-', 'LIVE_']);
				assert.equal(writes, 0, 'discovery stays in memory');
			} finally {
				fresh.dispose();
			}
		});

		test('the re-sync warms up the current project list', async () => {
			const { service, integration, state, read } = await jiraCloud();
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);

			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await service.refreshConnections();
			await flush();

			assert.deepEqual(titles(await read()), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.ok((await prefixesOf(integration)).includes('BETA-'), 'the autolinks follow the new project list');

			service.dispose();
		});

		test('a refresh whose token refetch fails still drops the project list (#6159)', async () => {
			// The refresh a consumer runs, with the GK API listing the connection but failing its token refetch: the
			// stored token is kept and no new session is published, so only the forced refresh's own drop retires the
			// list cached before it.
			const { service, runtime, state, read } = await jiraCloud();

			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			const fetchGkApi = runtime.account.fetchGkApi;
			let refetches = 0;
			runtime.account.fetchGkApi = (path, init) => {
				if (path === 'v1/provider-tokens') return fetchGkApi(path, init);

				refetches++;
				return Promise.resolve(new Response(null, { status: 503 }));
			};
			await service.refreshConnections();
			await flush();

			assert.ok(refetches > 0, 'the token refetch was attempted');
			const result = await read();
			assert.deepEqual(titles(result), ['Issue ALPHA-1', 'Issue BETA-1']);
			assert.equal(result.fetchFailed, undefined);

			service.dispose();
		});

		test('a disconnect makes the next connect re-read projects', async () => {
			const { service, integration, state, read } = await jiraCloud();
			await read();
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await integration.disconnect({ silent: true, currentSessionOnly: true });
			const reads = state.projectReads;
			await (
				integration as unknown as {
					resolveSessionLocked(options: { createIfNeeded: boolean }): Promise<unknown>;
				}
			).resolveSessionLocked({ createIfNeeded: true });
			await flush();
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

		test("autolinks keep a set missing a site's projects, and retry that site in the background after the delay", async () => {
			const { service, integration, state } = await jiraCloud();
			try {
				integration.invalidateDiscoveryCaches();
				state.sites = [site, otherSite];
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
				state.deletedOnSite.add('site-1:BETA');
				state.deletedOnSite.add('site-2:ALPHA');
				state.failingSites.add('site-2');
				const reads = state.projectReads;

				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the first render gets what was read',
				);
				assert.equal(state.projectReads, reads + 2);
				state.failingSites.clear();
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				await flush();
				assert.equal(state.projectReads, reads + 2, 'a render within the retry delay reads nothing');

				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the render after the delay does not wait',
				);
				await until(() => state.projectReads === reads + 3, 'only the site that failed was read again');
				await flush();
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
				await flush();
				assert.equal(state.projectReads, reads + 3, 'the complete set is kept past the retry delay');
			} finally {
				service.dispose();
			}
		});

		test('a failed autolink rebuild keeps serving the last set, and is retried after the delay', async () => {
			const { service, integration, state } = await jiraCloud();
			try {
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				const siteReads = state.siteReads;
				state.sitesError = new Error('(503) Service Unavailable.');
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });

				// Past the TTL of the autolinks and of the sites, so the rebuild reads the sites, and fails.
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the expired set, without waiting',
				);
				await until(() => state.siteReads === siteReads + 1, 'the background rebuild read the sites');
				await flush();
				state.sitesError = undefined;
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the failed rebuild kept the last set',
				);
				await flush();
				assert.equal(state.siteReads, siteReads + 1, 'a render within the retry delay reads nothing');

				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the render after the delay does not wait',
				);
				await until(() => state.siteReads === siteReads + 2, 'the render after the delay retried the build');
				await flush();
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
			} finally {
				service.dispose();
			}
		});

		test('a site whose projects fail to re-read keeps its prefixes until it reads again', async () => {
			const { service, integration, state } = await jiraCloud();
			try {
				integration.invalidateDiscoveryCaches();
				state.sites = [site, otherSite];
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' }, { id: 'p3', key: 'GAMMA', name: 'Gamma' });
				for (const hidden of ['site-1:BETA', 'site-1:GAMMA', 'site-2:ALPHA', 'site-2:GAMMA']) {
					state.deletedOnSite.add(hidden);
				}
				const before = ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'];
				assert.deepEqual(await prefixesOf(integration), before);
				const reads = state.projectReads;

				// Past the TTL, the other site's projects fail to re-read, while this site has lost ALPHA and gained GAMMA.
				state.failingSites.add('site-2');
				state.deletedOnSite.add('site-1:ALPHA');
				state.deletedOnSite.delete('site-1:GAMMA');
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(await prefixesOf(integration), before, 'the expired set, without waiting');
				await until(() => state.projectReads === reads + 2, 'the background rebuild read both sites');
				await flush();
				const after = ['BETA-', 'BETA_', 'GAMMA-', 'GAMMA_'];
				assert.deepEqual(
					await prefixesOf(integration),
					after,
					'only the failed site keeps the prefixes it had',
				);

				state.failingSites.clear();
				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), after);
				await until(
					() => state.projectReads === reads + 3,
					'the render after the delay re-read the failed site',
				);
				await flush();
				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), after);
				await flush();
				assert.equal(state.projectReads, reads + 3, 'the complete set is kept past the retry delay');
			} finally {
				service.dispose();
			}
		});

		test('a failed rebuild does not keep its fallback over a project list stored meanwhile', async () => {
			const { service, integration, state, read } = await jiraCloud();
			let release!: () => void;
			try {
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
				const siteReads = state.siteReads;
				state.sitesGate = new Promise<void>(resolve => (release = resolve));
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the expired set, without waiting',
				);
				await until(() => state.siteReads === siteReads + 1, 'the background rebuild is reading the sites');

				// An issue read stores the sites and the project list, BETA included, while the rebuild still waits.
				state.sitesGate = undefined;
				await read();
				const projectReads = state.projectReads;
				state.sitesError = new Error('(503) Service Unavailable.');
				release();
				await flush();
				state.sitesError = undefined;

				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
					'the next render rebuilt from the stored list',
				);
				assert.equal(state.projectReads, projectReads, 'without reading the projects again');
			} finally {
				release?.();
				service.dispose();
			}
		});

		test('a rebuild whose read of a site fails builds it from the list another read stored meanwhile', async () => {
			const { service, integration, state, read } = await jiraCloud();
			let release!: () => void;
			try {
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
				const reads = state.projectReads;
				state.projectsGate = new Promise<void>(resolve => (release = resolve));
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the expired set, without waiting',
				);
				await until(() => state.projectReads === reads + 1, 'the background rebuild is reading the projects');

				// An issue read stores the site's list, BETA included, and then the rebuild's own read of it fails.
				state.projectsGate = undefined;
				await read();
				const projectReads = state.projectReads;
				state.failingSites.add('site-1');
				release();
				await flush();
				state.failingSites.clear();

				const stored = ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'];
				assert.deepEqual(await prefixesOf(integration), stored, 'the rebuild kept the stored list');
				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), stored);
				await flush();
				assert.equal(state.projectReads, projectReads, 'kept as complete, with no read since');
			} finally {
				release?.();
				service.dispose();
			}
		});

		test('a first build that fails keeps no fallback over lists another read stored meanwhile', async () => {
			const { service, integration, state, read } = await jiraCloud();
			let release!: () => void;
			try {
				integration.invalidateDiscoveryCaches();
				const siteReads = state.siteReads;
				state.sitesGate = new Promise<void>(resolve => (release = resolve));
				const first = prefixesOf(integration);
				await until(() => state.siteReads === siteReads + 1, 'the first build is reading the sites');

				// An issue read stores the sites and their projects, and then the build's own site read fails.
				state.sitesGate = undefined;
				await read();
				const reads = { sites: state.siteReads, projects: state.projectReads };
				state.sitesError = new Error('(503) Service Unavailable.');
				release();
				assert.deepEqual(await first, [], 'the render that waited on the failed build gets none');
				state.sitesError = undefined;

				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the next render built from the stored lists',
				);
				assert.deepEqual(
					{ sites: state.siteReads, projects: state.projectReads },
					reads,
					'without reading them',
				);
			} finally {
				release?.();
				service.dispose();
			}
		});

		test('a truncated site serves what was read of it, without carrying prefixes it no longer lists', async () => {
			const { service, integration, state } = await jiraCloud();
			try {
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				const reads = state.projectReads;

				// Past the TTL, the site lists BETA and no longer ALPHA, and its list now comes back cut short.
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
				state.deletedOnSite.add('site-1:ALPHA');
				state.truncatedSites.add('site-1');
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the expired set, without waiting',
				);
				await until(() => state.projectReads === reads + 1, 'the background rebuild read the projects');
				await flush();
				assert.deepEqual(await prefixesOf(integration), ['BETA-', 'BETA_']);
			} finally {
				service.dispose();
			}
		});

		test('a site that fails after a read cut short keeps the prefixes that read served, not those of its older list (#6183, #6184)', async () => {
			const { service, integration, state } = await jiraCloud();
			try {
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				const reads = state.projectReads;

				// Past the TTL, the site lists BETA and no longer ALPHA, and its list comes back cut short.
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
				state.deletedOnSite.add('site-1:ALPHA');
				state.truncatedSites.add('site-1');
				advanceClock(discoveryCacheTtl);
				await prefixesOf(integration);
				await until(() => state.projectReads === reads + 1, 'the background rebuild read the projects');
				await flush();
				assert.deepEqual(await prefixesOf(integration), ['BETA-', 'BETA_']);

				// Then its read fails at the retry.
				state.truncatedSites.clear();
				state.failingSites.add('site-1');
				advanceClock(incompleteAutolinksRetryDelay);
				await prefixesOf(integration);
				await until(() => state.projectReads === reads + 2, 'the retry read the projects');
				await flush();
				assert.deepEqual(
					await prefixesOf(integration),
					['BETA-', 'BETA_'],
					'what it served last, not the deleted ALPHA of its list stored before',
				);
			} finally {
				service.dispose();
			}
		});

		test('a site whose later page fails keeps the prefixes it held beyond the pages read', async () => {
			const { service, integration, state } = await jiraCloud();
			try {
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
				integration.invalidateDiscoveryCaches();
				const before = ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'];
				assert.deepEqual(await prefixesOf(integration), before);
				const reads = state.projectReads;

				// Past the TTL, the site's first page, ALPHA's, reads, but its second, BETA's, fails.
				state.secondPageFailingSites.add('site-1');
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(await prefixesOf(integration), before, 'the expired set, without waiting');
				await until(() => state.projectReads === reads + 2, 'the background rebuild read both pages');
				await flush();
				assert.deepEqual(await prefixesOf(integration), before, 'BETA is kept from the set it had');
			} finally {
				service.dispose();
			}
		});

		test('a connect warm-up drops a fallback a build kept without project lists', async () => {
			const { service, integration, state } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals & {
				_organizations: DiscoveryCache<unknown>;
				providerOnConnect(): Promise<void>;
			};
			let releaseConnect!: () => void;
			let releaseBuild!: () => void;
			try {
				internals._organizations.clear();
				internals._projects.clear();
				const siteReads = state.siteReads;
				const projectReads = state.projectReads;

				// The connect re-reads the stale sites, and a render meanwhile starts a build that reads them too.
				state.sitesGate = new Promise<void>(resolve => (releaseConnect = resolve));
				const connecting = internals.providerOnConnect();
				await until(() => state.siteReads === siteReads + 1, 'the connect is reading the sites');
				state.sitesGate = new Promise<void>(resolve => (releaseBuild = resolve));
				const render = prefixesOf(integration);
				await until(() => state.siteReads === siteReads + 2, 'the build is reading the sites');

				// The warm-up stores the project list while the build's own site read fails.
				releaseConnect();
				await connecting;
				state.sitesError = new Error('(503) Service Unavailable.');
				releaseBuild();
				assert.deepEqual(await render, [], 'the render that waited on the failed build gets none');
				state.sitesError = undefined;

				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the next render built from the warmed lists',
				);
				assert.deepEqual(
					{ sites: state.siteReads, projects: state.projectReads },
					{ sites: siteReads + 2, projects: projectReads + 1 },
					'without another project read',
				);
			} finally {
				releaseConnect?.();
				releaseBuild?.();
				service.dispose();
			}
		});

		test('autolinks for an account with no sites are kept as complete', async () => {
			const { service, integration, state } = await jiraCloud();
			try {
				integration.invalidateDiscoveryCaches();
				state.sites = [];
				assert.deepEqual(await prefixesOf(integration), []);
				const kept = (integration as unknown as JiraCloudInternals)._autolinks.get('tok-1');
				assert.deepEqual(kept?.autolinks, []);
				assert.equal(kept?.complete, true, 'no sites is a complete answer, kept for the TTL');
			} finally {
				service.dispose();
			}
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

		test('an autolink read after a forced refresh does not join a rebuild started before it (#6170)', async () => {
			const { service, integration, state } = await jiraCloud();
			integration.invalidateDiscoveryCaches();
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			// A render, started before BETA exists, waits on the project list.
			const earlier = prefixesOf(integration);
			await until(() => state.projectReads === reads + 1, 'the earlier render read the projects');
			state.projectsGate = undefined;
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });

			// The drop every forced refresh begins with, while the earlier rebuild is still pending.
			integration.beginForcedRefresh();
			const later = prefixesOf(integration);
			await flush();
			release();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'], 'the later render rebuilt');
			assert.deepEqual(await earlier, ['ALPHA-', 'ALPHA_'], 'the earlier render answers what it read');

			service.dispose();
		});

		test('a rebuild started before a forced refresh does not retire the one started after it (#6170)', async () => {
			const { service, integration, state } = await jiraCloud();
			integration.invalidateDiscoveryCaches();
			let reads = state.projectReads;
			let releaseEarlier!: () => void;
			state.projectsGate = new Promise<void>(resolve => (releaseEarlier = resolve));
			const earlier = prefixesOf(integration);
			await until(() => state.projectReads === reads + 1, 'the earlier render read the projects');

			let releaseLater!: () => void;
			state.projectsGate = new Promise<void>(resolve => (releaseLater = resolve));
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			integration.beginForcedRefresh();
			const later = prefixesOf(integration);
			await until(() => state.projectReads === reads + 2, 'the later render read the projects');

			// The earlier rebuild settles while the later one is still pending; a render then still joins the later.
			releaseEarlier();
			assert.deepEqual(await earlier, ['ALPHA-', 'ALPHA_']);
			reads = state.projectReads;
			const joined = prefixesOf(integration);
			await flush();
			assert.equal(state.projectReads, reads, 'the render joined the later rebuild');
			releaseLater();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
			assert.deepEqual(await joined, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);

			service.dispose();
		});

		type JiraCloudInternals = {
			_session: ProviderAuthenticationSession;
			_autolinksResets: number;
			getProviderResourcesForUser: (session: ProviderAuthenticationSession, force?: boolean) => Promise<unknown>;
			_autolinks: Map<string, { autolinks: { prefix?: string }[]; complete?: boolean }>;
			_autolinksBuilds: Map<string, Promise<{ prefix?: string }[]>>;
			_projects: DiscoveryCache<{ key: string }[]>;
			_projectEvictions: Map<string, number>;
			buildAutolinks: (session: ProviderAuthenticationSession) => Promise<{ prefix?: string }[]>;
			buildAutolinksCore: (session: ProviderAuthenticationSession) => Promise<{ prefix?: string }[]>;
			getProviderProjectsForResourcesWithMetadata: (
				session: ProviderAuthenticationSession,
				resources: unknown[],
				force?: boolean,
			) => Promise<unknown>;
		};

		/**
		 * A background rebuild, the autolinks and the project list having expired, holding the site's list, BETA
		 * included, when an issue read lists the same projects again and then finds BETA gone and evicts that list
		 * (#6176). The issue read stores the list unchanged, so the eviction alone fences and retires the rebuild. BETA
		 * is then unlisted too, so any read after the eviction no longer names it.
		 */
		async function evictBetaDuringRebuild() {
			const jira = await jiraCloud();
			const { integration, state, read } = jira;
			const internals = integration as unknown as JiraCloudInternals;
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			integration.invalidateDiscoveryCaches();
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);

			advanceClock(discoveryCacheTtl);
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			await prefixesOf(integration);
			await until(() => state.projectReads === reads + 1, 'the rebuild read the projects');
			const earlier = internals._autolinksBuilds.get('tok-1')!;
			state.projectsGate = undefined;

			state.deleted.add('BETA');
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1'], 'the read evicted the list that named BETA');
			assert.equal(state.projectReads, reads + 2, 'the issue read listed the projects again');
			state.projects = state.projects.filter(p => p.key !== 'BETA');
			return { ...jira, internals: internals, earlier: earlier, release: release };
		}

		test('a rebuild holding a project list evicted meanwhile does not cache it (#6176)', async () => {
			const { service, integration, internals, earlier, release } = await evictBetaDuringRebuild();

			release();
			assert.deepEqual(
				(await earlier).map(a => a.prefix).sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the earlier rebuild answers what it read',
			);
			assert.ok(
				!internals._autolinks.get('tok-1')?.autolinks.some(a => a.prefix?.startsWith('BETA')),
				'the evicted project is not kept in the built set',
			);
			assert.equal(internals._projects.get('tok-1:site-1'), undefined, 'nor is the evicted list put back');
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_'], 'the next render rebuilt without it');

			service.dispose();
		});

		test('an autolink read after a missing-project eviction does not join a rebuild started before it (#6176)', async () => {
			const { service, integration, state, earlier, release } = await evictBetaDuringRebuild();
			const reads = state.projectReads;

			const later = prefixesOf(integration);
			await flush();
			assert.equal(state.projectReads, reads + 1, 'the later render read the projects again');
			release();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_'], 'the later render rebuilt');
			assert.deepEqual((await earlier).map(a => a.prefix).sort(), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_'], 'the later rebuild is the one kept');

			service.dispose();
		});

		test('a drop forgets the eviction counts along with the lists they fenced (#6176)', async () => {
			const { service, integration, internals, earlier, release } = await evictBetaDuringRebuild();
			release();
			await earlier;
			assert.equal(internals._projectEvictions.get('tok-1'), 1, 'the eviction moved the count');

			integration.invalidateDiscoveryCaches();
			assert.equal(internals._projectEvictions.size, 0, 'no token is kept past the drop');

			service.dispose();
		});

		test("a missing-project eviction leaves another token's rebuild and caches alone (#6176)", async () => {
			const { service, integration, state, read } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await service.refreshConnections();
			await flush();
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1', 'Issue BETA-1']);

			// Another token's rebuild holds its own list, BETA included, while this token's read evicts BETA.
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			const other = internals.buildAutolinks({ ...internals._session, accessToken: 'tok-2' });
			await until(() => state.projectReads === reads + 1, "the other token's rebuild read the projects");
			state.projectsGate = undefined;

			state.deleted.add('BETA');
			assert.deepEqual(titles(await read()), ['Issue ALPHA-1']);
			assert.equal(internals._projects.get('tok-1:site-1'), undefined, "this token's list was evicted");
			assert.equal(internals._autolinksBuilds.get('tok-2'), other, "the other token's rebuild is still joined");
			release();

			assert.deepEqual((await other).map(a => a.prefix).sort(), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
			assert.deepEqual(
				internals._autolinks
					.get('tok-2')
					?.autolinks.map(a => a.prefix)
					.sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				"the other token's set is kept",
			);
			assert.deepEqual(
				internals._projects.get('tok-2:site-1')?.map(p => p.key),
				['ALPHA', 'BETA'],
				"the other token's list is kept",
			);

			service.dispose();
		});

		/**
		 * A background rebuild, the autolinks and the project list having expired, reading the list again while ALPHA
		 * alone is listed, when BETA is created and an issue read lists the projects again, replacing the list the
		 * rebuild holds (#6184). With `identical`, BETA isn't created, so the issue read stores the same list again.
		 */
		async function replaceListDuringRebuild(options?: { identical?: boolean }) {
			const jira = await jiraCloud();
			const { integration, state, read } = jira;
			const internals = integration as unknown as JiraCloudInternals;
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);

			advanceClock(discoveryCacheTtl);
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_'], 'the expired set, without waiting');
			await until(() => state.projectReads === reads + 1, 'the rebuild read the projects');
			const earlier = internals._autolinksBuilds.get('tok-1')!;
			state.projectsGate = undefined;

			if (!options?.identical) {
				state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			}
			await read();
			assert.equal(state.projectReads, reads + 2, 'the issue read listed the projects again');
			return { ...jira, internals: internals, earlier: earlier, release: release };
		}

		test('a rebuild holding a project list replaced meanwhile keeps the newer list, not the one it read (#6184)', async () => {
			const { service, integration, internals, earlier, release } = await replaceListDuringRebuild();

			release();
			assert.deepEqual(
				(await earlier).map(a => a.prefix).sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the earlier rebuild builds from the list stored when it settles (#6183), not the one it read',
			);
			assert.deepEqual(
				internals._autolinks
					.get('tok-1')
					?.autolinks.map(a => a.prefix)
					.sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the older set is not kept',
			);
			assert.deepEqual(
				internals._projects.get('tok-1:site-1')?.map(p => p.key),
				['ALPHA', 'BETA'],
				'nor does the older read put its list back',
			);
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'], 'the next render');

			service.dispose();
		});

		test("a rebuild holding a cached site's project list replaced meanwhile keeps the newer list (#6184)", async () => {
			const { service, integration, state, read } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			state.sites.push({ ...site, id: 'site-2', name: 'Site 2', url: 'https://site-2.atlassian.net' });
			integration.invalidateDiscoveryCaches();
			await read();
			const site1 = (await integration.getResourcesForUserResult())?.value?.find(s => s.id === 'site-1');
			assert.ok(site1 != null);

			// Site 2's list is due for a re-read, so the rebuild takes site 1's from the cache and reads site 2's.
			internals._projects.delete('tok-1:site-2');
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			const earlier = prefixesOf(integration);
			await until(() => state.projectReads === reads + 1, "the rebuild read site 2's projects");
			const rebuild = internals._autolinksBuilds.get('tok-1');
			state.projectsGate = undefined;

			// BETA is created, and a forced read replaces site 1's list, the one the rebuild took from the cache.
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await internals.getProviderProjectsForResourcesWithMetadata(internals._session, [site1], true);
			assert.notEqual(internals._autolinksBuilds.get('tok-1'), rebuild, 'the replacement retired the rebuild');
			release();

			assert.deepEqual(
				await earlier,
				['ALPHA-', 'ALPHA-', 'ALPHA_', 'ALPHA_', 'BETA-', 'BETA_'],
				'the rebuild builds each site from its list stored when it settles (#6183)',
			);
			assert.deepEqual(
				internals._autolinks
					.get('tok-1')
					?.autolinks.map(a => a.prefix)
					.sort(),
				['ALPHA-', 'ALPHA-', 'ALPHA_', 'ALPHA_', 'BETA-', 'BETA_'],
				'the older set is not kept',
			);
			assert.deepEqual(
				internals._projects.get('tok-1:site-1')?.map(p => p.key),
				['ALPHA', 'BETA'],
			);
			assert.deepEqual(
				internals._projects.get('tok-1:site-2')?.map(p => p.key),
				['ALPHA'],
				"the rebuild's read of site 2, the latest of that site, is kept",
			);
			assert.deepEqual(
				await prefixesOf(integration),
				['ALPHA-', 'ALPHA-', 'ALPHA_', 'ALPHA_', 'BETA-', 'BETA_'],
				'the next render',
			);

			service.dispose();
		});

		test('an autolink read after a project list replacement does not join a rebuild started before it (#6184)', async () => {
			const { service, integration, internals, earlier, release } = await replaceListDuringRebuild();
			assert.notEqual(internals._autolinksBuilds.get('tok-1'), earlier, 'the replacement retired the rebuild');

			let settled = false;
			const later = prefixesOf(integration).finally(() => (settled = true));
			await until(() => settled, 'the later render did not wait on the earlier rebuild');
			release();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'], 'the later render rebuilt');
			assert.deepEqual(
				(await earlier).map(a => a.prefix).sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the earlier rebuild builds from the list stored when it settles (#6183), not the one it read',
			);
			assert.deepEqual(
				await prefixesOf(integration),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the later rebuild is the one kept',
			);

			service.dispose();
		});

		test('a rebuild retired by a project list replacement does not replace the set a later rebuild kept (#6184)', async () => {
			const { service, integration, internals, earlier, release } = await replaceListDuringRebuild();
			// A later render rebuilds from the newer list and keeps that set.
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
			const newer = internals._autolinks.get('tok-1');
			assert.ok(newer != null);

			// The retired rebuild settles once that list expired: its own, older read is refused, so it builds from
			// the newer list, but no longer as stored fresh, and so incomplete.
			advanceClock(discoveryCacheTtl);
			release();
			assert.deepEqual(
				(await earlier).map(a => a.prefix).sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the retired rebuild answers the newer list, not its own older read, even once that list expired',
			);
			assert.equal(internals._autolinks.get('tok-1'), newer, 'the set the later rebuild kept stays');

			service.dispose();
		});

		test('a rebuild retired by a project list replacement that settles once that list expired keeps the newer list, incomplete (#6184)', async () => {
			const { service, integration, internals, earlier, release, read } = await replaceListDuringRebuild();

			// No render meanwhile: the rebuild settles once the newer list expired, its own, older read refused.
			advanceClock(discoveryCacheTtl);
			release();
			const newer = ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'];
			assert.deepEqual((await earlier).map(a => a.prefix).sort(), newer, 'built from the newer list');
			const kept = internals._autolinks.get('tok-1');
			assert.equal(kept?.complete, false, 'kept to be retried after the delay');

			// The same list stored again drops that incomplete set, so the next render builds it again from the list.
			await read();
			assert.notEqual(internals._autolinks.get('tok-1'), kept, 'the incomplete set is dropped');
			assert.deepEqual(await prefixesOf(integration), newer);
			assert.equal(internals._autolinks.get('tok-1')?.complete, true);

			service.dispose();
		});

		test("a site that keeps failing keeps its prefixes when another site's list change retires the rebuild holding them (#6184)", async () => {
			const { service, integration, state } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			integration.invalidateDiscoveryCaches();
			state.sites = [site, otherSite];
			const both = ['ALPHA-', 'ALPHA-', 'ALPHA_', 'ALPHA_'];
			assert.deepEqual(await prefixesOf(integration), both);
			const site1 = (await integration.getResourcesForUserResult())?.value?.find(s => s.id === 'site-1');
			assert.ok(site1 != null);

			// Past the TTL, site 2's projects fail to re-read, and a background rebuild holding the set waits on both
			// sites' projects.
			state.failingSites.add('site-2');
			advanceClock(discoveryCacheTtl);
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			assert.deepEqual(await prefixesOf(integration), both, 'the expired set, without waiting');
			await until(() => state.projectReads === reads + 2, 'the rebuild read both sites');
			const retired = internals._autolinksBuilds.get('tok-1');
			state.projectsGate = undefined;

			// BETA is created, and a forced read replaces site 1's list, retiring that rebuild and dropping the set. A
			// later render rebuilds, site 2 still failing, and settles first.
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await internals.getProviderProjectsForResourcesWithMetadata(internals._session, [site1], true);
			assert.notEqual(internals._autolinksBuilds.get('tok-1'), retired, 'the replacement retired the rebuild');
			const expected = ['ALPHA-', 'ALPHA-', 'ALPHA_', 'ALPHA_', 'BETA-', 'BETA_'];
			assert.deepEqual(
				await prefixesOf(integration),
				expected,
				"the later rebuild keeps site 2's prefixes from its last list stored, not from the set dropped",
			);

			release();
			await retired;
			assert.deepEqual(await prefixesOf(integration), expected, 'and they stay once the retired rebuild settles');

			service.dispose();
		});

		/**
		 * A background rebuild holding ALPHA alone is retired when an issue read stores ALPHA and BETA, and a later
		 * render, once the sites expired but not that list, starts another rebuild whose site read fails. `settleFirst`
		 * says which of the two settles first: the retired one keeps a set built from the lists now cached, and the
		 * later one the fallback it held, none. With `incomplete`, a second site's projects fail throughout, so the
		 * retired rebuild's set is incomplete.
		 */
		async function retireThenFailLaterRebuild(settleFirst: 'retired' | 'later', incomplete: boolean) {
			const { service, integration, state, read } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			if (incomplete) {
				integration.invalidateDiscoveryCaches();
				state.sites = [site, otherSite];
				state.failingSites.add('site-2');
			}
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);

			advanceClock(discoveryCacheTtl);
			const reads = state.projectReads;
			let releaseRetired!: () => void;
			state.projectsGate = new Promise<void>(resolve => (releaseRetired = resolve));
			await prefixesOf(integration);
			await until(
				() => state.projectReads === reads + state.sites.length,
				'the rebuild read the sites, then the projects',
			);
			const retired = internals._autolinksBuilds.get('tok-1')!;
			state.projectsGate = undefined;

			advanceClock(1000);
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await read();
			assert.notEqual(internals._autolinksBuilds.get('tok-1'), retired, 'the replacement retired the rebuild');

			// The sites the retired rebuild stored expire; the project list stored after them doesn't.
			advanceClock(discoveryCacheTtl - 500);
			let releaseSites!: () => void;
			state.sitesGate = new Promise<void>(resolve => (releaseSites = resolve));
			state.sitesError = new Error('(503) Service Unavailable.');
			const siteReads = state.siteReads;
			const later = prefixesOf(integration);
			await until(() => state.siteReads === siteReads + 1, 'the later rebuild read the sites');
			const settleRetired = async () => {
				releaseRetired();
				await retired;
			};
			const settleLater = async () => {
				releaseSites();
				assert.deepEqual(await later, [], 'the later rebuild answers the fallback it held');
			};
			if (settleFirst === 'retired') {
				await settleRetired();
				await settleLater();
			} else {
				await settleLater();
				await settleRetired();
			}
			state.sitesGate = undefined;
			state.sitesError = undefined;
			return { service: service, internals: internals };
		}

		for (const incomplete of [false, true]) {
			for (const settleFirst of ['retired', 'later'] as const) {
				test(`a later rebuild's failed fallback and a retired rebuild's ${incomplete ? 'incomplete' : 'complete'} set built from the cached lists: the set is kept, whichever settles first (#6184, ${settleFirst} first)`, async () => {
					const { service, internals } = await retireThenFailLaterRebuild(settleFirst, incomplete);
					const kept = internals._autolinks.get('tok-1');
					assert.deepEqual(
						kept?.autolinks.map(a => a.prefix).sort(),
						['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
						'the set built from the lists cached when it settled',
					);
					assert.equal(kept?.complete, !incomplete);

					service.dispose();
				});
			}
		}

		test('a rebuild retired while holding a site list since replaced does not replace the set a later rebuild kept (#6184)', async () => {
			const { service, integration, state, read } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);

			// A background rebuild reads the one site, then waits on its projects.
			advanceClock(discoveryCacheTtl);
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			await prefixesOf(integration);
			await until(() => state.projectReads === reads + 1, 'the rebuild read the projects');
			const retired = internals._autolinksBuilds.get('tok-1')!;
			state.projectsGate = undefined;

			// A second site appears; once the site list expired an issue read lists both, retiring the rebuild, and a
			// later render keeps the set for both sites.
			state.sites = [site, otherSite];
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			advanceClock(discoveryCacheTtl);
			await read();
			assert.notEqual(internals._autolinksBuilds.get('tok-1'), retired, 'the replacement retired the rebuild');
			await prefixesOf(integration);
			const sitesOf = () =>
				[
					...new Set(
						(
							internals._autolinks.get('tok-1')?.autolinks as
								| { descriptor?: { key?: string } }[]
								| undefined
						)?.map(a => a.descriptor?.key),
					),
				].sort();
			assert.deepEqual(sitesOf(), ['site-1', 'site-2']);

			// The retired rebuild settles with every site it listed cached, but from the site list it read.
			release();
			await retired;
			assert.deepEqual(sitesOf(), ['site-1', 'site-2'], 'the set for both sites stays');

			service.dispose();
		});

		test('a rebuild retired while holding a site list since replaced keeps its set incomplete when it settles first (#6184)', async () => {
			const { service, integration, state, read } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);

			advanceClock(discoveryCacheTtl);
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			await prefixesOf(integration);
			await until(() => state.projectReads === reads + 1, 'the rebuild read the projects');
			const retired = internals._autolinksBuilds.get('tok-1')!;
			state.projectsGate = undefined;

			// A second site appears, and an issue read lists both, retiring the rebuild; no render keeps a set meanwhile.
			state.sites = [site, otherSite];
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			advanceClock(discoveryCacheTtl);
			await read();
			release();
			await retired;
			assert.equal(
				internals._autolinks.get('tok-1')?.complete,
				false,
				'built from the site list it read, not the stored one: retried after the delay',
			);

			advanceClock(incompleteAutolinksRetryDelay);
			await prefixesOf(integration);
			await until(() => internals._autolinksBuilds.get('tok-1') == null, 'the retry settled');
			const kept = internals._autolinks.get('tok-1');
			assert.deepEqual(
				[
					...new Set(
						(kept?.autolinks as { descriptor?: { key?: string } }[] | undefined)?.map(
							a => a.descriptor?.key,
						),
					),
				].sort(),
				['site-1', 'site-2'],
			);
			assert.equal(kept?.complete, true);

			service.dispose();
		});

		test("a project list stored again with no set kept still fences a failing build's fallback (#6183, #6184)", async () => {
			const { service, integration, read } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			await prefixesOf(integration);
			internals._autolinks.delete('tok-1');
			const resets = internals._autolinksResets;

			advanceClock(discoveryCacheTtl);
			await read();
			assert.equal(internals._autolinksResets, resets + 1);

			service.dispose();
		});

		test('a build whose site list another read stores again, the same, keeps its set complete (#6184)', async () => {
			const { service, integration, state } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			await prefixesOf(integration);

			advanceClock(discoveryCacheTtl);
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			await prefixesOf(integration);
			await until(() => state.projectReads === reads + 1, 'the rebuild read the projects');
			const rebuild = internals._autolinksBuilds.get('tok-1')!;
			state.projectsGate = undefined;

			// Another reader reads the same sites again, storing them anew while the rebuild waits.
			await internals.getProviderResourcesForUser(internals._session, true);
			release();
			await rebuild;
			assert.equal(internals._autolinks.get('tok-1')?.complete, true, 'not retried for an identical site list');

			service.dispose();
		});

		test("a site that keeps failing keeps its last list's prefixes through the empty fallback a build kept after a list change (#6184)", async () => {
			const { service, integration, state } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			integration.invalidateDiscoveryCaches();
			state.sites = [site, otherSite];
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA-', 'ALPHA_', 'ALPHA_']);
			const site1 = (await integration.getResourcesForUserResult())?.value?.find(s => s.id === 'site-1');
			assert.ok(site1 != null);

			// Past the TTL, site 2's projects fail to re-read; BETA is created, and a forced read replaces site 1's list,
			// dropping the set.
			state.failingSites.add('site-2');
			advanceClock(discoveryCacheTtl);
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await internals.getProviderProjectsForResourcesWithMetadata(internals._session, [site1], true);
			assert.equal(internals._autolinks.get('tok-1'), undefined, 'the replacement dropped the set');

			// The next render's build fails to read the sites, and keeps the fallback it held, none.
			state.sitesError = new Error('(503) Service Unavailable.');
			assert.deepEqual(await prefixesOf(integration), []);
			state.sitesError = undefined;

			// At the retry the sites read again, site 2 still failing.
			advanceClock(incompleteAutolinksRetryDelay);
			await prefixesOf(integration);
			await until(() => internals._autolinksBuilds.get('tok-1') == null, 'the retry settled');
			assert.deepEqual(
				await prefixesOf(integration),
				['ALPHA-', 'ALPHA-', 'ALPHA_', 'ALPHA_', 'BETA-', 'BETA_'],
				"site 2 keeps the prefixes of its last list stored, not the empty fallback's none",
			);

			service.dispose();
		});

		test('a project list stored again drops an incomplete set, so the next render builds it again (#6183, #6184)', async () => {
			const { service, integration, state, read } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			integration.invalidateDiscoveryCaches();
			state.sites = [site, otherSite];
			state.failingSites.add('site-2');
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			assert.equal(internals._autolinks.get('tok-1')?.complete, false, 'the set is kept incomplete');

			// Once the lists expired, an issue read stores the same list for the site that read, the other still failing.
			advanceClock(discoveryCacheTtl);
			await read();
			assert.equal(internals._autolinks.get('tok-1'), undefined, 'the incomplete set is dropped');

			service.dispose();
		});

		test('a project list replaced with an identical one keeps the built set and the rebuild (#6184)', async () => {
			const { service, integration, internals, earlier, release } = await replaceListDuringRebuild({
				identical: true,
			});
			const served = internals._autolinks.get('tok-1');
			let rebuilds = 0;
			const buildAutolinksCore = internals.buildAutolinksCore.bind(integration);
			internals.buildAutolinksCore = session => {
				rebuilds++;
				return buildAutolinksCore(session);
			};

			assert.ok(served != null, 'the set served while rebuilding is kept');
			assert.equal(internals._autolinksBuilds.get('tok-1'), earlier, 'the rebuild is not retired');
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			release();
			await earlier;

			assert.notEqual(internals._autolinks.get('tok-1'), served, 'the rebuild cached its set');
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			await flush();
			assert.equal(rebuilds, 0, 'no rebuild beyond the one in flight');

			service.dispose();
		});

		test('a project read that started later stores its list even when an earlier one changed it first (#6184)', async () => {
			const { service, integration, state } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			const sites = (await integration.getResourcesForUserResult())?.value ?? [];
			const reads = state.projectReads;

			// An earlier read lists BETA, created since the list was stored, and a later one also lists GAMMA, created
			// after the earlier one was answered.
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			let releaseEarlier!: () => void;
			state.projectsGate = new Promise<void>(resolve => (releaseEarlier = resolve));
			const earlier = internals.getProviderProjectsForResourcesWithMetadata(internals._session, sites, true);
			await until(() => state.projectReads === reads + 1, 'the earlier read listed the projects');
			state.projects.push({ id: 'p3', key: 'GAMMA', name: 'Gamma' });
			let releaseLater!: () => void;
			state.projectsGate = new Promise<void>(resolve => (releaseLater = resolve));
			const later = internals.getProviderProjectsForResourcesWithMetadata(internals._session, sites, true);
			await until(() => state.projectReads === reads + 2, 'the later read listed the projects');
			state.projectsGate = undefined;

			// The earlier read is answered first and changes the stored list; the later one, answered last, replaces it.
			releaseEarlier();
			await earlier;
			releaseLater();
			await later;

			assert.deepEqual(
				internals._projects.get('tok-1:site-1')?.map(p => p.key),
				['ALPHA', 'BETA', 'GAMMA'],
				'the later read is the one kept',
			);
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_', 'GAMMA-', 'GAMMA_']);

			service.dispose();
		});

		test('a project read that started earlier does not put back a list a later one found unchanged (#6184)', async () => {
			const { service, integration, state } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			const sites = (await integration.getResourcesForUserResult())?.value ?? [];
			const reads = state.projectReads;

			// An earlier read lists BETA, which is deleted again before a later read lists the projects as stored.
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			const earlier = internals.getProviderProjectsForResourcesWithMetadata(internals._session, sites, true);
			await until(() => state.projectReads === reads + 1, 'the earlier read listed the projects');
			state.projectsGate = undefined;
			state.projects = state.projects.filter(p => p.key !== 'BETA');
			await internals.getProviderProjectsForResourcesWithMetadata(internals._session, sites, true);

			release();
			assert.deepEqual(
				((await earlier) as { values: { key: string }[] }).values.map(p => p.key),
				['ALPHA'],
				'the earlier read answers with the list the later one stored, not its own',
			);
			assert.deepEqual(
				internals._projects.get('tok-1:site-1')?.map(p => p.key),
				['ALPHA'],
				'the earlier read does not put BETA back',
			);
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);

			service.dispose();
		});

		test('an autolink read after a first project list store does not join a rebuild started before it (#6184)', async () => {
			const { service, integration, state, read } = await jiraCloud();
			integration.invalidateDiscoveryCaches();
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			// A render, started before BETA exists, rebuilds and waits on the project list.
			const earlier = prefixesOf(integration);
			await until(() => state.projectReads === reads + 1, 'the earlier render read the projects');
			state.projectsGate = undefined;

			// BETA is created, and an issue read stores the site's list, the first one since the drop.
			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await read();
			let settled = false;
			const later = prefixesOf(integration).finally(() => (settled = true));
			await until(() => settled, 'the later render did not wait on the earlier rebuild');
			release();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'], 'the later render rebuilt');
			assert.deepEqual(
				await earlier,
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the earlier render builds from the list stored when it settles (#6183), not the one it read',
			);
			assert.deepEqual(
				await prefixesOf(integration),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the later rebuild is the one kept',
			);

			service.dispose();
		});

		test("a project list replacement leaves another token's rebuild and caches alone (#6184)", async () => {
			const { service, integration, state, read } = await jiraCloud();
			const internals = integration as unknown as JiraCloudInternals;
			await read();
			const sites = (await integration.getResourcesForUserResult())?.value ?? [];

			// Another token's rebuild holds its own list, ALPHA alone, while this token's list is replaced.
			const reads = state.projectReads;
			let release!: () => void;
			state.projectsGate = new Promise<void>(resolve => (release = resolve));
			const other = internals.buildAutolinks({ ...internals._session, accessToken: 'tok-2' });
			await until(() => state.projectReads === reads + 1, "the other token's rebuild read the projects");
			state.projectsGate = undefined;

			state.projects.push({ id: 'p2', key: 'BETA', name: 'Beta' });
			await internals.getProviderProjectsForResourcesWithMetadata(internals._session, sites, true);
			assert.deepEqual(
				internals._projects.get('tok-1:site-1')?.map(p => p.key),
				['ALPHA', 'BETA'],
				"this token's list was replaced",
			);
			assert.equal(internals._autolinksBuilds.get('tok-2'), other, "the other token's rebuild is still joined");
			release();

			assert.deepEqual((await other).map(a => a.prefix).sort(), ['ALPHA-', 'ALPHA_']);
			assert.deepEqual(
				internals._autolinks
					.get('tok-2')
					?.autolinks.map(a => a.prefix)
					.sort(),
				['ALPHA-', 'ALPHA_'],
				"the other token's set is kept",
			);
			assert.deepEqual(
				internals._projects.get('tok-2:site-1')?.map(p => p.key),
				['ALPHA'],
				"the other token's list is kept",
			);

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
			// An ordinary read, started before site-2 exists, waits on the site list. Through the connection, on the same
			// token and cache, so the primary read below doesn't join it as it would one of its own selector and generation.
			const earlier = integration.getResourcesForUserResult('t1');
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

		test('a forced read does not join a site lookup started before its refresh (#6162)', async () => {
			const { service, integration, state, read } = await jiraCloud();
			await read();
			// Expired, so the next lookup asks Jira rather than the cache.
			advanceClock(discoveryCacheTtl);
			const lookups = countResourceLookups(integration);
			const siteReads = state.siteReads;
			let release!: () => void;
			state.sitesGate = new Promise<void>(resolve => (release = resolve));
			// An ordinary read, started before site-2 exists, waits on the site list.
			const earlier = service.listOrgs({ providerId: IssuesCloudHostIntegrationId.Jira });
			await until(() => state.siteReads === siteReads + 1, 'the earlier read asked for the sites');
			state.sitesGate = undefined;
			state.sites = [...state.sites, { ...site, id: 'site-2', name: 'Site 2' }];
			state.searchedSites.clear();

			// The caller asks for a refresh after site-2 was created, while the earlier lookup is still pending.
			const forced = service.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				includeAllAssignees: true,
				forceSync: true,
			});
			await until(() => lookups.count === 2, 'the forced read reached the site lookup');
			release();

			const result = await forced;
			assert.deepEqual([...state.searchedSites].sort(), ['site-1', 'site-2'], 'the forced read listed site-2');
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(
				(await earlier).items.map(o => o.id),
				['site-1'],
				'the earlier read answers what it read',
			);

			service.dispose();
		});

		test('ordinary reads with no refresh between them share one site lookup (#6162)', async () => {
			const { service, integration, state, read } = await jiraCloud();
			await read();
			// Expired, so the next lookup asks Jira rather than the cache.
			advanceClock(discoveryCacheTtl);
			const siteReads = state.siteReads;
			let release!: () => void;
			state.sitesGate = new Promise<void>(resolve => (release = resolve));
			const first = service.listOrgs({ providerId: IssuesCloudHostIntegrationId.Jira });
			await until(() => state.siteReads === siteReads + 1, 'the first read asked for the sites');
			const second = service.listOrgs({ providerId: IssuesCloudHostIntegrationId.Jira });
			// An empty connectionId reads the primary too, so it joins the same lookup.
			const third = integration.getResourcesForUserResult('');
			await flush();
			release();

			assert.deepEqual(
				(await first).items.map(o => o.id),
				['site-1'],
			);
			assert.deepEqual(
				(await second).items.map(o => o.id),
				['site-1'],
			);
			assert.deepEqual(
				(await third)?.value?.map(s => s.id),
				['site-1'],
			);
			assert.equal(state.siteReads, siteReads + 1, 'the later reads joined the first lookup');

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
				/** When set, the team list read fails, after `teamsGate`. */
				teamsError: undefined as Error | undefined,
				organization: { id: 'org-1', key: 'acme', name: 'Acme', url: 'https://linear.app/acme' },
				organizationReads: 0,
				/** When set, the organization lookup waits on it, answering with the organization when it was asked. */
				organizationGate: undefined as Promise<void> | undefined,
			};
			stubApi(integration, {
				getLinearOrganization: async () => {
					state.organizationReads++;
					const snapshot = state.noOrganizationData ? undefined : { ...state.organization };
					await state.organizationGate;
					return snapshot;
				},
				getLinearCurrentUser: () =>
					Promise.resolve({ id: 'me', name: 'Me', displayName: 'me', email: undefined }),
				getLinearTeamsForCurrentUser: async () => {
					state.teamReads++;
					const snapshot = state.noTeamData ? undefined : state.teams.map(t => ({ ...t }));
					await state.teamsGate;
					if (state.teamsError != null) throw state.teamsError;

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

		test('autolinks from a full implicit teams page are served, and retried in the background after the delay', async () => {
			const { service, integration, state } = await linear();
			try {
				integration.invalidateDiscoveryCaches();
				state.teams = Array.from({ length: 50 }, (_, index) => ({
					id: `t${index}`,
					key: `T${index}`,
					name: `Team ${index}`,
					iconUrl: null,
				}));
				const reads = state.teamReads;
				const expected = state.teams.flatMap(t => [`${t.key}-`, `${t.key}_`]).sort();

				assert.deepEqual(await prefixesOf(integration), expected, 'the useful first-page prefixes are served');
				assert.equal(state.teamReads, reads + 1);
				assert.deepEqual(await prefixesOf(integration), expected);
				await flush();
				assert.equal(state.teamReads, reads + 1, 'a render within the retry delay reads nothing');

				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), expected, 'the render after the delay does not wait');
				await until(() => state.teamReads === reads + 2, 'the render after the delay retried the teams read');
				assert.deepEqual(await prefixesOf(integration), expected);
				await flush();
				assert.equal(state.teamReads, reads + 2, 'the retried incomplete set waits out another delay');
			} finally {
				service.dispose();
			}
		});

		for (const count of [0, 49, 51]) {
			test(`autolinks keep complete team lists past the retry delay, and retry incomplete ones (${count} teams)`, async () => {
				const { service, integration, state } = await linear();
				try {
					integration.invalidateDiscoveryCaches();
					state.teams = Array.from({ length: count }, (_, index) => ({
						id: `t${index}`,
						key: `T${index}`,
						name: `Team ${index}`,
						iconUrl: null,
					}));
					const reads = state.teamReads;
					const expected = state.teams.flatMap(t => [`${t.key}-`, `${t.key}_`]).sort();

					assert.deepEqual(await prefixesOf(integration), expected);
					advanceClock(incompleteAutolinksRetryDelay);
					assert.deepEqual(await prefixesOf(integration), expected);
					await flush();
					assert.equal(state.teamReads, reads + (count < 50 ? 1 : 2));
				} finally {
					service.dispose();
				}
			});
		}

		test('concurrent incomplete autolink renders share a build, and its retry caches a later complete read', async () => {
			const { service, integration, state } = await linear();
			let release!: () => void;
			try {
				integration.invalidateDiscoveryCaches();
				state.teams = Array.from({ length: 50 }, (_, index) => ({
					id: `t${index}`,
					key: `T${index}`,
					name: `Team ${index}`,
					iconUrl: null,
				}));
				state.teamsGate = new Promise<void>(resolve => (release = resolve));
				const reads = state.teamReads;
				const first = prefixesOf(integration);
				await until(() => state.teamReads === reads + 1, 'the first render read the teams');
				const second = prefixesOf(integration);
				await flush();
				assert.equal(state.teamReads, reads + 1, 'the concurrent render joins the incomplete build');
				release();
				const expected = state.teams.flatMap(t => [`${t.key}-`, `${t.key}_`]).sort();
				assert.deepEqual(await first, expected);
				assert.deepEqual(await second, expected);

				state.teamsGate = undefined;
				state.teams.pop();
				const complete = state.teams.flatMap(t => [`${t.key}-`, `${t.key}_`]).sort();
				assert.deepEqual(
					await prefixesOf(integration),
					expected,
					'a render within the retry delay reads nothing',
				);
				assert.equal(state.teamReads, reads + 1);

				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), expected, 'the render after the delay does not wait');
				await until(() => state.teamReads === reads + 2, 'the render after the delay retried discovery');
				await flush();
				assert.deepEqual(await prefixesOf(integration), complete);
				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), complete);
				await flush();
				assert.equal(state.teamReads, reads + 2, 'the complete result is cached past the retry delay');
			} finally {
				release?.();
				service.dispose();
			}
		});

		test('an incomplete background rebuild retires the previously complete autolinks', async () => {
			const { service, integration, state } = await linear();
			try {
				integration.invalidateDiscoveryCaches();
				state.teams = Array.from({ length: 49 }, (_, index) => ({
					id: `t${index}`,
					key: `T${index}`,
					name: `Team ${index}`,
					iconUrl: null,
				}));
				const complete = state.teams.flatMap(t => [`${t.key}-`, `${t.key}_`]).sort();
				assert.deepEqual(await prefixesOf(integration), complete);
				const reads = state.teamReads;
				state.teams.push({ id: 'new', key: 'NEW', name: 'New', iconUrl: null });
				const incomplete = state.teams.flatMap(t => [`${t.key}-`, `${t.key}_`]).sort();
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(await prefixesOf(integration), complete, 'the expired render does not wait');
				await flush();
				assert.equal(state.teamReads, reads + 1, 'the background rebuild read the incomplete list');
				assert.deepEqual(await prefixesOf(integration), incomplete, 'the next render exposes the new team');
				assert.deepEqual(await prefixesOf(integration), incomplete);
				await flush();
				assert.equal(state.teamReads, reads + 1, 'renders within the retry delay read nothing');

				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), incomplete, 'the render after the delay does not wait');
				await until(() => state.teamReads === reads + 2, 'the render after the delay retried discovery');
			} finally {
				service.dispose();
			}
		});

		test('a retired incomplete rebuild cannot remove newer complete autolinks', async () => {
			const { service, integration, state } = await linear();
			let release!: () => void;
			try {
				integration.invalidateDiscoveryCaches();
				state.teams = Array.from({ length: 50 }, (_, index) => ({
					id: `t${index}`,
					key: `T${index}`,
					name: `Team ${index}`,
					iconUrl: null,
				}));
				state.teamsGate = new Promise<void>(resolve => (release = resolve));
				const reads = state.teamReads;
				const earlier = prefixesOf(integration);
				await until(() => state.teamReads === reads + 1, 'the earlier render read the incomplete list');
				integration.beginForcedRefresh();
				state.teamsGate = undefined;
				state.teams = [{ id: 'new', key: 'NEW', name: 'New', iconUrl: null }];
				assert.deepEqual(await prefixesOf(integration), ['NEW-', 'NEW_']);
				release();
				assert.equal((await earlier).length, 100);
				assert.deepEqual(await prefixesOf(integration), ['NEW-', 'NEW_']);
				assert.equal(state.teamReads, reads + 2, 'the newer complete set remains cached');
			} finally {
				release?.();
				service.dispose();
			}
		});

		test('a background rebuild with no team data preserves the complete fallback', async () => {
			const { service, integration, state } = await linear();
			try {
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				state.noTeamData = true;
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				await flush();
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				await flush();
			} finally {
				service.dispose();
			}
		});

		test('autolinks retry a team read that returned no data after the retry delay', async () => {
			const { service, integration, state } = await linear();
			try {
				integration.invalidateDiscoveryCaches();
				state.noTeamData = true;
				const reads = state.teamReads;
				assert.deepEqual(await prefixesOf(integration), []);
				state.noTeamData = false;
				assert.deepEqual(await prefixesOf(integration), [], 'a render within the retry delay reads nothing');
				assert.equal(state.teamReads, reads + 1);

				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), [], 'the render after the delay does not wait');
				await until(() => state.teamReads === reads + 2, 'the render after the delay retried the teams read');
				await flush();
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			} finally {
				service.dispose();
			}
		});

		test('a team read that throws serves the held set, or none on a first build, and is retried after the delay', async () => {
			const { service, integration, state } = await linear();
			try {
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				const reads = state.teamReads;
				state.teamsError = new Error('(503) Service Unavailable.');
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the expired set, without waiting',
				);
				await until(() => state.teamReads === reads + 1, 'the background rebuild read the teams');
				await flush();
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the failed rebuild kept the held set',
				);
				await flush();
				assert.equal(state.teamReads, reads + 1, 'a render within the retry delay reads nothing');

				integration.invalidateDiscoveryCaches();
				assert.deepEqual(
					await prefixesOf(integration),
					[],
					'a first build that fails serves none, without throwing',
				);
				assert.equal(state.teamReads, reads + 2);

				state.teamsError = undefined;
				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), []);
				await until(() => state.teamReads === reads + 3, 'the render after the delay retried the teams read');
				await flush();
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			} finally {
				service.dispose();
			}
		});

		test('a failed rebuild does not keep its fallback over a team list stored meanwhile', async () => {
			const { service, integration, state, read } = await linear();
			let release!: () => void;
			try {
				assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
				state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
				const reads = state.teamReads;
				state.teamsGate = new Promise<void>(resolve => (release = resolve));
				advanceClock(discoveryCacheTtl);
				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the expired set, without waiting',
				);
				await until(() => state.teamReads === reads + 1, 'the background rebuild is reading the teams');

				// An issue read stores the team list, BETA included, while the rebuild still waits.
				state.teamsGate = undefined;
				await read();
				const teamReads = state.teamReads;
				state.teamsError = new Error('(503) Service Unavailable.');
				release();
				await flush();
				state.teamsError = undefined;

				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
					'the next render rebuilt from the stored list',
				);
				assert.equal(state.teamReads, teamReads, 'without reading the teams again');
			} finally {
				release?.();
				service.dispose();
			}
		});

		test('an incomplete build publishes a complete team list another read stored meanwhile', async () => {
			const { service, integration, state, read } = await linear();
			let release!: () => void;
			try {
				integration.invalidateDiscoveryCaches();
				state.teams = Array.from({ length: 50 }, (_, index) => ({
					id: `t${index}`,
					key: `T${index}`,
					name: `Team ${index}`,
					iconUrl: null,
				}));
				const reads = state.teamReads;
				state.teamsGate = new Promise<void>(resolve => (release = resolve));
				const first = prefixesOf(integration);
				await until(() => state.teamReads === reads + 1, 'the first build is reading the teams');

				// An issue read stores a complete list of 49 teams while the build's own read, a full page, still waits.
				state.teamsGate = undefined;
				state.teams.pop();
				await read();
				const stored = state.teams.flatMap(t => [`${t.key}-`, `${t.key}_`]).sort();
				const teamReads = state.teamReads;
				release();

				assert.deepEqual(await first, stored, 'the build published the stored list, not its own full page');
				assert.deepEqual(await prefixesOf(integration), stored);
				advanceClock(incompleteAutolinksRetryDelay);
				assert.deepEqual(await prefixesOf(integration), stored);
				await flush();
				assert.equal(state.teamReads, teamReads, 'kept as complete, with no team read since');
			} finally {
				release?.();
				service.dispose();
			}
		});

		test('a first build that fails keeps no fallback over a team list another read stored meanwhile', async () => {
			const { service, integration, state, read } = await linear();
			let release!: () => void;
			try {
				integration.invalidateDiscoveryCaches();
				const reads = state.teamReads;
				state.teamsGate = new Promise<void>(resolve => (release = resolve));
				const first = prefixesOf(integration);
				await until(() => state.teamReads === reads + 1, 'the first build is reading the teams');

				// An issue read stores the team list, and then the build's own team read fails.
				state.teamsGate = undefined;
				await read();
				const teamReads = state.teamReads;
				state.teamsError = new Error('(503) Service Unavailable.');
				release();
				assert.deepEqual(await first, [], 'the render that waited on the failed build gets none');
				state.teamsError = undefined;

				assert.deepEqual(
					await prefixesOf(integration),
					['ALPHA-', 'ALPHA_'],
					'the next render built from the stored list',
				);
				assert.equal(state.teamReads, teamReads, 'without reading it again');
			} finally {
				release?.();
				service.dispose();
			}
		});

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

		test('a lookup started after a forced refresh does not join an organization lookup started before it (#6162)', async () => {
			const { service, integration, state } = await linear();
			// The provider's lookup itself, under the integration's gate, so only its own dedup is exercised.
			const provider = integration as unknown as {
				_session: ProviderAuthenticationSession;
				getProviderResourcesForUser: (session: ProviderAuthenticationSession) => Promise<{ name: string }[]>;
			};
			const lookup = async () =>
				(await provider.getProviderResourcesForUser(provider._session))?.map(o => o.name);
			// The organization never expires, so it is dropped to have the next lookups ask Linear.
			integration.invalidateDiscoveryCaches();
			const organizationReads = state.organizationReads;
			let release!: () => void;
			state.organizationGate = new Promise<void>(resolve => (release = resolve));
			const earlier = lookup();
			await until(() => state.organizationReads === organizationReads + 1, 'the earlier lookup asked Linear');
			// An unforced lookup joins the one in flight rather than making another request.
			const joined = lookup();
			await flush();
			assert.equal(
				state.organizationReads,
				organizationReads + 1,
				'the unforced lookup joined the one in flight',
			);

			state.organizationGate = undefined;
			state.organization = { ...state.organization, name: 'Acme Renamed' };
			// The drop every forced refresh begins with, while the earlier lookup is still pending.
			integration.beginForcedRefresh();
			const later = lookup();
			await flush();
			release();

			assert.deepEqual(await later, ['Acme Renamed'], 'the later lookup asked Linear again');
			assert.deepEqual(await earlier, ['Acme'], 'the earlier lookup answers what it read');
			assert.deepEqual(await joined, ['Acme']);

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

		test('concurrent autolink reads share one rebuild', async () => {
			const { service, integration, state } = await linear();
			integration.invalidateDiscoveryCaches();
			const reads = state.teamReads;

			const all = await Promise.all([prefixesOf(integration), prefixesOf(integration), prefixesOf(integration)]);
			assert.deepEqual(all, [
				['ALPHA-', 'ALPHA_'],
				['ALPHA-', 'ALPHA_'],
				['ALPHA-', 'ALPHA_'],
			]);
			assert.equal(state.teamReads, reads + 1);

			service.dispose();
		});

		test('an autolink read after a forced refresh does not join a rebuild started before it (#6170)', async () => {
			const { service, integration, state } = await linear();
			integration.invalidateDiscoveryCaches();
			const reads = state.teamReads;
			let release!: () => void;
			state.teamsGate = new Promise<void>(resolve => (release = resolve));
			// A render, started before BETA exists, waits on the team list.
			const earlier = prefixesOf(integration);
			await until(() => state.teamReads === reads + 1, 'the earlier render read the teams');
			state.teamsGate = undefined;
			state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });

			// The drop every forced refresh begins with, while the earlier rebuild is still pending.
			integration.beginForcedRefresh();
			const later = prefixesOf(integration);
			await flush();
			release();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'], 'the later render rebuilt');
			assert.deepEqual(await earlier, ['ALPHA-', 'ALPHA_'], 'the earlier render answers what it read');

			service.dispose();
		});

		test('a rebuild started before a forced refresh does not retire the one started after it (#6170)', async () => {
			const { service, integration, state } = await linear();
			integration.invalidateDiscoveryCaches();
			let reads = state.teamReads;
			let releaseEarlier!: () => void;
			state.teamsGate = new Promise<void>(resolve => (releaseEarlier = resolve));
			const earlier = prefixesOf(integration);
			await until(() => state.teamReads === reads + 1, 'the earlier render read the teams');

			let releaseLater!: () => void;
			state.teamsGate = new Promise<void>(resolve => (releaseLater = resolve));
			state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
			integration.beginForcedRefresh();
			const later = prefixesOf(integration);
			await until(() => state.teamReads === reads + 2, 'the later render read the teams');

			// The earlier rebuild settles while the later one is still pending; a render then still joins the later.
			releaseEarlier();
			assert.deepEqual(await earlier, ['ALPHA-', 'ALPHA_']);
			reads = state.teamReads;
			const joined = prefixesOf(integration);
			await flush();
			assert.equal(state.teamReads, reads, 'the render joined the later rebuild');
			releaseLater();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
			assert.deepEqual(await joined, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);

			service.dispose();
		});

		type LinearInternals = {
			_session: ProviderAuthenticationSession;
			_autolinksResets: number;
			_autolinks: Map<string, { autolinks: { prefix?: string }[]; complete?: boolean }>;
			_autolinksBuilds: Map<string, Promise<{ prefix?: string }[]>>;
			_teams: DiscoveryCache<{ key: string }[]>;
			buildAutolinks: (session: ProviderAuthenticationSession) => Promise<{ prefix?: string }[]>;
			buildAutolinksCore: (session: ProviderAuthenticationSession) => Promise<{ prefix?: string }[]>;
			getTeamsWithMetadata: (session: ProviderAuthenticationSession, force?: boolean) => Promise<unknown>;
		};

		/**
		 * A background rebuild, the autolinks and the team list having expired, reading the teams again while ALPHA
		 * alone is listed, when BETA is created and an issue read lists the teams again, replacing the list the rebuild
		 * holds (#6184). With `identical`, BETA isn't created, so the issue read stores the same list again.
		 */
		async function replaceListDuringRebuild(options?: { identical?: boolean }) {
			const ctx = await linear();
			const { integration, state, read } = ctx;
			const internals = integration as unknown as LinearInternals;
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);

			advanceClock(discoveryCacheTtl);
			const reads = state.teamReads;
			let release!: () => void;
			state.teamsGate = new Promise<void>(resolve => (release = resolve));
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_'], 'the expired set, without waiting');
			await until(() => state.teamReads === reads + 1, 'the rebuild read the teams');
			const earlier = internals._autolinksBuilds.get('tok-1')!;
			state.teamsGate = undefined;

			if (!options?.identical) {
				state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
			}
			await read();
			assert.equal(state.teamReads, reads + 2, 'the issue read listed the teams again');
			return { ...ctx, internals: internals, earlier: earlier, release: release };
		}

		test('a rebuild holding a team list replaced meanwhile keeps the newer list, not the one it read (#6184)', async () => {
			const { service, integration, internals, earlier, release } = await replaceListDuringRebuild();

			release();
			assert.deepEqual(
				(await earlier).map(a => a.prefix).sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the earlier rebuild builds from the list stored when it settles (#6183), not the one it read',
			);
			assert.deepEqual(
				internals._autolinks
					.get('tok-1')
					?.autolinks.map(a => a.prefix)
					.sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the older set is not kept',
			);
			assert.deepEqual(
				internals._teams.get('tok-1')?.map(t => t.key),
				['ALPHA', 'BETA'],
				'nor does the older read put its list back',
			);
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'], 'the next render');

			service.dispose();
		});

		test('an autolink read after a team list replacement does not join a rebuild started before it (#6184)', async () => {
			const { service, integration, internals, earlier, release } = await replaceListDuringRebuild();
			assert.notEqual(internals._autolinksBuilds.get('tok-1'), earlier, 'the replacement retired the rebuild');

			let settled = false;
			const later = prefixesOf(integration).finally(() => (settled = true));
			await until(() => settled, 'the later render did not wait on the earlier rebuild');
			release();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'], 'the later render rebuilt');
			assert.deepEqual(
				(await earlier).map(a => a.prefix).sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the earlier rebuild builds from the list stored when it settles (#6183), not the one it read',
			);
			assert.deepEqual(
				await prefixesOf(integration),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the later rebuild is the one kept',
			);

			service.dispose();
		});

		test('a rebuild retired by a team list replacement does not replace the set a later rebuild kept (#6184)', async () => {
			const { service, integration, internals, earlier, release } = await replaceListDuringRebuild();
			// A later render rebuilds from the newer list and keeps that set.
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);
			const newer = internals._autolinks.get('tok-1');
			assert.ok(newer != null);

			// The retired rebuild settles once that list expired: its own, older read is refused, so it builds from
			// the newer list, but no longer as stored fresh, and so incomplete.
			advanceClock(discoveryCacheTtl);
			release();
			assert.deepEqual(
				(await earlier).map(a => a.prefix).sort(),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the retired rebuild answers the newer list, not its own older read, even once that list expired',
			);
			assert.equal(internals._autolinks.get('tok-1'), newer, 'the set the later rebuild kept stays');

			service.dispose();
		});

		test('a rebuild retired by a team list replacement that settles once that list expired keeps the newer list, incomplete (#6184)', async () => {
			const { service, integration, internals, earlier, release, read } = await replaceListDuringRebuild();

			// No render meanwhile: the rebuild settles once the newer list expired, its own, older read refused.
			advanceClock(discoveryCacheTtl);
			release();
			const newer = ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'];
			assert.deepEqual((await earlier).map(a => a.prefix).sort(), newer, 'built from the newer list');
			const kept = internals._autolinks.get('tok-1');
			assert.equal(kept?.complete, false, 'kept to be retried after the delay');

			// The same list stored again drops that incomplete set, so the next render builds it again from the list.
			await read();
			assert.notEqual(internals._autolinks.get('tok-1'), kept, 'the incomplete set is dropped');
			assert.deepEqual(await prefixesOf(integration), newer);
			assert.equal(internals._autolinks.get('tok-1')?.complete, true);

			service.dispose();
		});

		test('a rebuild retired by a team list replacement replaces the empty fallback a later failing rebuild kept (#6184)', async () => {
			const { service, integration, internals, state, earlier, release } = await replaceListDuringRebuild();

			// Once that list expired, a render's rebuild fails to read the teams, and keeps the fallback it held, none.
			advanceClock(discoveryCacheTtl);
			state.teamsError = new Error('(503) Service Unavailable.');
			assert.deepEqual(await prefixesOf(integration), []);
			state.teamsError = undefined;

			// The retired rebuild settles with the newer list its own read was refused for, and replaces that fallback.
			release();
			await earlier;
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_']);

			service.dispose();
		});

		test('a rebuild retired while holding an organization since re-read does not replace the set a later rebuild kept (#6184)', async () => {
			const { service, integration, internals, state, earlier, release } = await replaceListDuringRebuild();

			// The workspace url changes and a forced lookup reads it; a later render keeps links to it.
			state.organization = { ...state.organization, key: 'acme-2', url: 'https://linear.app/acme-2' };
			await integration.getProviderResourceForSession(internals._session);
			const urlsOf = () => [
				...new Set(
					(internals._autolinks.get('tok-1')?.autolinks as { url?: string }[] | undefined)?.map(a =>
						a.url?.replace(/\/issue\/.*$/, ''),
					),
				),
			];
			await prefixesOf(integration);
			assert.deepEqual(urlsOf(), ['https://linear.app/acme-2']);

			// The retired rebuild settles from the team list as cached, but with the organization it read.
			release();
			await earlier;
			assert.deepEqual(urlsOf(), ['https://linear.app/acme-2'], 'the links to the new url stay');

			service.dispose();
		});

		test("a team list stored again with no set kept still fences a failing build's fallback (#6183, #6184)", async () => {
			const { service, integration, read } = await linear();
			const internals = integration as unknown as LinearInternals;
			await prefixesOf(integration);
			internals._autolinks.delete('tok-1');
			const resets = internals._autolinksResets;

			advanceClock(discoveryCacheTtl);
			await read();
			assert.equal(internals._autolinksResets, resets + 1);

			service.dispose();
		});

		test('a build whose organization a forced lookup reads again, the same, keeps its set complete (#6184)', async () => {
			const { service, integration, state } = await linear();
			const internals = integration as unknown as LinearInternals;
			await prefixesOf(integration);

			advanceClock(discoveryCacheTtl);
			const reads = state.teamReads;
			let release!: () => void;
			state.teamsGate = new Promise<void>(resolve => (release = resolve));
			await prefixesOf(integration);
			await until(() => state.teamReads === reads + 1, 'the rebuild read the teams');
			const rebuild = internals._autolinksBuilds.get('tok-1')!;
			state.teamsGate = undefined;

			await integration.getProviderResourceForSession(internals._session);
			release();
			await rebuild;
			assert.equal(
				internals._autolinks.get('tok-1')?.complete,
				true,
				'not retried for an identical organization',
			);

			service.dispose();
		});

		test('a team list replaced with an identical one keeps the built set and the rebuild (#6184)', async () => {
			const { service, integration, internals, earlier, release } = await replaceListDuringRebuild({
				identical: true,
			});
			const served = internals._autolinks.get('tok-1');
			let rebuilds = 0;
			const buildAutolinksCore = internals.buildAutolinksCore.bind(integration);
			internals.buildAutolinksCore = session => {
				rebuilds++;
				return buildAutolinksCore(session);
			};

			assert.ok(served != null, 'the set served while rebuilding is kept');
			assert.equal(internals._autolinksBuilds.get('tok-1'), earlier, 'the rebuild is not retired');
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			release();
			await earlier;

			assert.notEqual(internals._autolinks.get('tok-1'), served, 'the rebuild cached its set');
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_']);
			await flush();
			assert.equal(rebuilds, 0, 'no rebuild beyond the one in flight');

			service.dispose();
		});

		test('a team read that started later stores its list even when an earlier one changed it first (#6184)', async () => {
			const { service, integration, state } = await linear();
			const internals = integration as unknown as LinearInternals;
			const reads = state.teamReads;

			// An earlier read lists BETA, joined since the list was stored, and a later one also lists GAMMA, joined
			// after the earlier one was answered.
			state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
			let releaseEarlier!: () => void;
			state.teamsGate = new Promise<void>(resolve => (releaseEarlier = resolve));
			const earlier = internals.getTeamsWithMetadata(internals._session, true);
			await until(() => state.teamReads === reads + 1, 'the earlier read listed the teams');
			state.teams.push({ id: 't3', key: 'GAMMA', name: 'Gamma', iconUrl: null });
			let releaseLater!: () => void;
			state.teamsGate = new Promise<void>(resolve => (releaseLater = resolve));
			const later = internals.getTeamsWithMetadata(internals._session, true);
			await until(() => state.teamReads === reads + 2, 'the later read listed the teams');
			state.teamsGate = undefined;

			// The earlier read is answered first and changes the stored list; the later one, answered last, replaces it.
			releaseEarlier();
			await earlier;
			releaseLater();
			await later;

			assert.deepEqual(
				internals._teams.get('tok-1')?.map(t => t.key),
				['ALPHA', 'BETA', 'GAMMA'],
				'the later read is the one kept',
			);
			assert.deepEqual(await prefixesOf(integration), ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_', 'GAMMA-', 'GAMMA_']);

			service.dispose();
		});

		test('an autolink read after a first team list store does not join a rebuild started before it (#6184)', async () => {
			const { service, integration, state, read } = await linear();
			integration.invalidateDiscoveryCaches();
			const reads = state.teamReads;
			let release!: () => void;
			state.teamsGate = new Promise<void>(resolve => (release = resolve));
			// A render, started before BETA is joined, rebuilds and waits on the team list.
			const earlier = prefixesOf(integration);
			await until(() => state.teamReads === reads + 1, 'the earlier render read the teams');
			state.teamsGate = undefined;

			// BETA is joined, and an issue read stores the team list, the first one since the drop.
			state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
			await read();
			let settled = false;
			const later = prefixesOf(integration).finally(() => (settled = true));
			await until(() => settled, 'the later render did not wait on the earlier rebuild');
			release();

			assert.deepEqual(await later, ['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'], 'the later render rebuilt');
			assert.deepEqual(
				await earlier,
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the earlier render builds from the list stored when it settles (#6183), not the one it read',
			);
			assert.deepEqual(
				await prefixesOf(integration),
				['ALPHA-', 'ALPHA_', 'BETA-', 'BETA_'],
				'the later rebuild is the one kept',
			);

			service.dispose();
		});

		test("a team list replacement leaves another token's rebuild and caches alone (#6184)", async () => {
			const { service, integration, state, read } = await linear();
			const internals = integration as unknown as LinearInternals;
			await read();
			advanceClock(discoveryCacheTtl);

			// Another token's rebuild holds its own list, ALPHA alone, while this token's expired list is replaced.
			const reads = state.teamReads;
			let release!: () => void;
			state.teamsGate = new Promise<void>(resolve => (release = resolve));
			const other = internals.buildAutolinks({ ...internals._session, accessToken: 'tok-2' });
			await until(() => state.teamReads === reads + 1, "the other token's rebuild read the teams");
			state.teamsGate = undefined;

			state.teams.push({ id: 't2', key: 'BETA', name: 'Beta', iconUrl: null });
			await read();
			assert.deepEqual(
				internals._teams.get('tok-1')?.map(t => t.key),
				['ALPHA', 'BETA'],
				"this token's list was replaced",
			);
			assert.equal(internals._autolinksBuilds.get('tok-2'), other, "the other token's rebuild is still joined");
			release();

			assert.deepEqual((await other).map(a => a.prefix).sort(), ['ALPHA-', 'ALPHA_']);
			assert.deepEqual(
				internals._autolinks
					.get('tok-2')
					?.autolinks.map(a => a.prefix)
					.sort(),
				['ALPHA-', 'ALPHA_'],
				"the other token's set is kept",
			);
			assert.deepEqual(
				internals._teams.get('tok-2')?.map(t => t.key),
				['ALPHA'],
				"the other token's list is kept",
			);

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
			assert.equal(cache.set('a', 2, { generation: cache.generation }), 'changed');
			assert.equal(cache.get('a'), 2);
		});

		test('refuses a value from a read that started before the one stored (#6184)', () => {
			const cache = new DiscoveryCache<number>();
			const earlier = cache.startRead();
			const later = cache.startRead();

			assert.equal(cache.set('a', 2, { read: later }), 'changed');
			assert.equal(cache.set('a', 1, { read: earlier }), false, 'the earlier read, answered last');
			assert.equal(cache.set('b', 1, { read: earlier }), 'changed', 'another key is ordered on its own');
			assert.equal(cache.set('a', 3), 'changed', 'a value stored without a read');
			assert.equal(cache.set('a', 1, { read: earlier }), false, 'keeps the order of the one it replaced');
			assert.equal(cache.get('a'), 3);
		});

		test('tells an unchanged value apart, even from an expired one (#6184)', () => {
			advanceClock(0);
			const cache = new DiscoveryCache<{ key: string }[]>(1000);
			assert.equal(cache.set('a', [{ key: 'ALPHA' }]), 'changed', 'nothing stored before');

			advanceClock(1000);
			assert.equal(cache.get('a'), undefined);
			assert.deepEqual(cache.peek('a'), [{ key: 'ALPHA' }], 'kept until replaced');
			assert.equal(cache.set('a', [{ key: 'ALPHA' }]), 'unchanged');
			assert.equal(cache.set('a', [{ key: 'ALPHA' }, { key: 'BETA' }]), 'changed');
		});
	});
});
