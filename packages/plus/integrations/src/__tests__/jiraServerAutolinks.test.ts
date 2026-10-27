import * as assert from 'node:assert/strict';
import { suite, teardown, test } from 'mocha';
import type { AutolinkReference, DynamicAutolinkReference, RefSet } from '@gitlens/git/models/autolink.js';
import { getAutolinks, getBranchAutolinks } from '@gitlens/git/utils/autolink.utils.js';
import { defer } from '@gitlens/utils/promise.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService } from '../integrationService.js';
import { discoveryCacheTtl } from '../providers/utils/discoveryCache.js';
import { createFakeRuntime } from './fakeRuntime.js';

const managers: ReturnType<typeof createIntegrationService>[] = [];
const realNow = Date.now;
teardown(() => {
	for (const manager of managers.splice(0)) {
		manager.dispose();
	}
	Date.now = realNow;
});

function session(baseUrl: string, token = 'shared-token'): ProviderAuthenticationSession {
	return {
		id: baseUrl,
		accessToken: token,
		account: { id: 'me', label: 'Me' },
		scopes: [],
		cloud: true,
		type: 'pat',
		domain: new URL(baseUrl).host,
		baseUrl: baseUrl,
	};
}

async function connected(baseUrl = 'https://jira.example.com/jira') {
	const runtime = createFakeRuntime();
	const manager = createIntegrationService(runtime);
	managers.push(manager);
	const jira = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, new URL(baseUrl).host))!;
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = session(baseUrl);
	const state = {
		projects: [{ id: '101', key: 'JMTEST', name: 'Test project' }],
		reads: 0,
		gate: undefined as Promise<void> | undefined,
		fail: false,
		missingProject: false,
		unauthorized: false,
		accountStatus: 200,
		accountReads: 0,
		onProjectRead: undefined as (() => void) | undefined,
	};
	runtime.http.fetch = async input => {
		const url = new URL(input.toString());
		if (url.pathname.endsWith('/myself')) {
			state.accountReads++;
			return new Response(JSON.stringify({ key: 'me', name: 'me', displayName: 'Me', avatarUrls: {} }), {
				status: state.accountStatus,
				headers: { 'content-type': 'application/json' },
			});
		}
		if (url.pathname.endsWith('/field')) {
			return new Response('[]', { headers: { 'content-type': 'application/json' } });
		}
		if (state.missingProject && url.pathname.endsWith('/search')) {
			return new Response(
				JSON.stringify({
					errorMessages: ["The value '101' does not exist for the field 'project'."],
					errors: {},
				}),
				{
					status: 400,
					headers: { 'content-type': 'application/json', 'x-ausername': 'me' },
				},
			);
		}

		assert.equal(url.origin + url.pathname, `${baseUrl}/rest/api/2/project`);
		state.reads++;
		const snapshot = state.projects.map(p => ({ ...p }));
		state.onProjectRead?.();
		await state.gate;
		if (state.unauthorized) return new Response('{}', { status: 401 });

		if (state.fail) throw new Error('Project read failed');
		return new Response(JSON.stringify(snapshot), { headers: { 'content-type': 'application/json' } });
	};
	return { manager: manager, jira: jira, state: state };
}

async function coldConfigured() {
	const runtime = createFakeRuntime();
	const baseUrl = 'https://jira.example.com/jira';
	await runtime.storage.store('integrations:configured', {
		[IssuesSelfManagedHostIntegrationId.JiraServer]: [
			{
				id: 'primary',
				cloud: true,
				integrationId: IssuesSelfManagedHostIntegrationId.JiraServer,
				scopes: '',
				primary: true,
				domain: 'jira.example.com',
				baseUrl: baseUrl,
			},
			{
				id: 'secondary',
				cloud: true,
				integrationId: IssuesSelfManagedHostIntegrationId.JiraServer,
				scopes: '',
				domain: 'jira.example.com',
				baseUrl: baseUrl,
			},
		],
	});
	await runtime.storage.storeSecret(
		'integration.auth.cloud:jira-server|primary',
		JSON.stringify({ ...session(baseUrl, 'primary-token'), id: 'primary' }),
	);
	await runtime.storage.storeSecret(
		'integration.auth.cloud:jira-server|secondary',
		JSON.stringify({ ...session(baseUrl, 'secondary-token'), id: 'secondary' }),
	);
	const manager = createIntegrationService(runtime);
	managers.push(manager);
	let projectReads = 0;
	runtime.http.fetch = async input => {
		const url = new URL(input.toString());
		assert.equal(url.origin + url.pathname, `${baseUrl}/rest/api/2/project`);
		projectReads++;
		return new Response(JSON.stringify([{ id: '101', key: 'COLD', name: 'Cold project' }]), {
			headers: { 'content-type': 'application/json' },
		});
	};
	const jira = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!;
	assert.equal((jira as unknown as { _session: ProviderAuthenticationSession | undefined })._session, undefined);
	return { runtime: runtime, manager: manager, jira: jira, getProjectReads: () => projectReads };
}

function prefixes(refs: (AutolinkReference | DynamicAutolinkReference)[]): string[] {
	return refs.flatMap(ref => ('prefix' in ref ? [ref.prefix] : []));
}

async function flush(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setImmediate(resolve));
	}
}

suite('Jira Data Center autolinks', () => {
	test('first native autolinks read awaits its own cold primary session publication', async () => {
		const { jira, getProjectReads } = await coldConfigured();
		assert.deepEqual(prefixes(await jira.autolinks()), ['COLD-', 'COLD_']);
		assert.equal(getProjectReads(), 1);
	});

	test('native cold primary autolinks retires an independent invalidation during authentication', async () => {
		const { jira, runtime, getProjectReads } = await coldConfigured();
		const started = defer<void>();
		const release = defer<void>();
		const getSecret = runtime.storage.getSecret;
		runtime.storage.getSecret = async key => {
			started.fulfill();
			await release.promise;
			return getSecret(key);
		};
		try {
			const read = jira.autolinks();
			await started.promise;
			jira.invalidateDiscoveryCaches();
			release.fulfill();
			assert.deepEqual(await read, []);
			assert.equal(getProjectReads(), 0);
		} finally {
			release.fulfill();
		}
	});

	test('a primary waiting to store its cold session survives a secondary publication', async () => {
		const { jira, manager, runtime } = await coldConfigured();
		const started = defer<void>();
		const release = defer<void>();
		const storeWorkspace = runtime.storage.storeWorkspace;
		let held = false;
		runtime.storage.storeWorkspace = async (key, value) => {
			if (!held) {
				held = true;
				started.fulfill();
				await release.promise;
			}
			return storeWorkspace(key, value);
		};
		try {
			const primary = jira.autolinks();
			await started.promise;
			const secondary = await manager.getAutolinkReferences({
				providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
				connectionId: 'secondary',
				domain: 'jira.example.com',
			});
			assert.ok(secondary != null);
			assert.deepEqual(prefixes(secondary[1]), ['COLD-', 'COLD_']);
			release.fulfill();
			assert.deepEqual(prefixes(await primary), ['COLD-', 'COLD_']);
		} finally {
			release.fulfill();
		}
	});

	test('keeps the cached catalog when an anonymous empty refresh fails its fresh account check', async () => {
		const { jira, state } = await connected();
		assert.deepEqual(prefixes(await jira.autolinks()), ['JMTEST-', 'JMTEST_']);
		state.projects = [];
		state.accountStatus = 401;
		const now = realNow();
		Date.now = () => now + discoveryCacheTtl + 1;
		assert.deepEqual(prefixes(await jira.autolinks()), ['JMTEST-', 'JMTEST_']);
		await flush();
		assert.equal(state.accountReads, 1);
		assert.deepEqual(prefixes(await jira.autolinks()), ['JMTEST-', 'JMTEST_']);
	});

	for (const providerId of [
		IssuesCloudHostIntegrationId.Jira,
		IssuesSelfManagedHostIntegrationId.JiraServer,
	] as const) {
		test(`${providerId} retires a read invalidated while resolving its connection session`, async () => {
			const runtime = createFakeRuntime();
			const manager = createIntegrationService(runtime);
			managers.push(manager);
			const jira = (await manager.get(
				providerId,
				providerId === IssuesCloudHostIntegrationId.Jira ? 'atlassian.net' : 'jira.example.com',
			))!;
			const gate = defer<ProviderAuthenticationSession>();
			const started = defer<void>();
			let providerReads = 0;
			runtime.http.fetch = async input => {
				providerReads++;
				const path = new URL(input.toString()).pathname;
				if (path.endsWith('/accessible-resources')) {
					return new Response(
						JSON.stringify([{ id: 'site', name: 'Site', url: 'https://site.atlassian.net', scopes: [] }]),
						{
							headers: { 'content-type': 'application/json' },
						},
					);
				}
				if (path.endsWith('/project/search')) {
					return new Response(
						JSON.stringify({ values: [{ id: '101', key: 'LIVE', name: 'Live' }], startAt: 0 }),
						{
							headers: { 'content-type': 'application/json' },
						},
					);
				}
				if (path.endsWith('/project')) {
					return new Response(JSON.stringify([{ id: '101', key: 'LIVE', name: 'Live' }]), {
						headers: { 'content-type': 'application/json' },
					});
				}
				throw new Error(`Unexpected provider path ${path}`);
			};
			const internals = jira as unknown as {
				authenticationService: {
					get: () => Promise<{ getSession: () => Promise<ProviderAuthenticationSession> }>;
				};
			};
			const resolved = session('https://jira.example.com/jira');
			internals.authenticationService.get = async () => ({
				getSession: async () => {
					started.fulfill();
					return gate.promise;
				},
			});
			const options = {
				providerId: providerId,
				connectionId: 'secondary',
				domain: providerId === IssuesCloudHostIntegrationId.Jira ? 'atlassian.net' : 'jira.example.com',
			};
			try {
				const read = manager.getAutolinkReferences(options);
				await started.promise;
				jira.invalidateDiscoveryCaches();
				gate.fulfill(resolved);
				assert.equal(await read, undefined);
				assert.equal(providerReads, 0, 'the retired read never reaches the provider');
				(jira as unknown as { _session: ProviderAuthenticationSession })._session = resolved;
				const control = await jira.getUncachedDiscoveryResult(() => true);
				assert.equal(control?.value?.projects?.values[0]?.key, 'LIVE');
				assert.ok(providerReads > 0, 'an unretired read reaches the provider');
			} finally {
				gate.fulfill(resolved);
			}
		});
	}

	test('discovers real project keys through the SDK and preserves the instance context path', async () => {
		const { jira, state } = await connected();
		state.projects.push(
			{ id: '102', key: '', name: 'JMTEST' },
			{ id: '103', key: ' ', name: 'Blank key' },
			{ id: '104', key: '104', name: 'Numeric fallback' },
		);
		const refs = await jira.autolinks();
		assert.deepEqual(prefixes(refs), ['JMTEST-', 'JMTEST_']);
		const refsets: RefSet[] = [[jira, refs]];
		assert.equal(
			getAutolinks('Fix JMTEST-12', refsets).get('12')?.url,
			'https://jira.example.com/jira/browse/JMTEST-12',
		);
		assert.equal(
			[...getBranchAutolinks('feature/JMTEST_12-fix', refsets).values()][0]?.url,
			'https://jira.example.com/jira/browse/JMTEST-12',
		);
		assert.equal(getAutolinks('JMTEST_12', refsets).size, 0);
		assert.equal(getAutolinks('jmtest-12', refsets).size, 0);
		assert.equal(state.reads, 1);
	});

	test('cold callers share discovery and wait for its result', async () => {
		const { jira, state } = await connected();
		const gate = defer<void>();
		state.gate = gate.promise;
		const reads = [Promise.resolve(jira.autolinks()), Promise.resolve(jira.autolinks())];
		let settled = false;
		void Promise.all(reads).then(() => {
			settled = true;
		});
		await flush();
		assert.equal(state.reads, 1);
		assert.equal(settled, false);
		gate.fulfill();
		for (const refs of await Promise.all(reads)) {
			assert.deepEqual(prefixes(refs), ['JMTEST-', 'JMTEST_']);
		}
		await jira.autolinks();
		assert.equal(state.reads, 1);
	});

	test('expired links remain available while the project set is rebuilt', async () => {
		const { jira, state } = await connected();
		await jira.autolinks();
		state.projects = [{ id: '102', key: 'NEW', name: 'New project' }];
		const now = Date.now();
		Date.now = () => now + discoveryCacheTtl;
		assert.deepEqual(prefixes(await jira.autolinks()), ['JMTEST-', 'JMTEST_']);
		await flush();
		assert.deepEqual(prefixes(await jira.autolinks()), ['NEW-', 'NEW_']);
		assert.equal(state.reads, 2);
	});

	test('a failed rebuild retains decoration, but a forced reset never revives it', async () => {
		const { jira, state } = await connected();
		await jira.autolinks();
		state.fail = true;
		const now = Date.now();
		Date.now = () => now + discoveryCacheTtl;
		await jira.autolinks();
		await flush();
		assert.deepEqual(prefixes(await jira.autolinks()), ['JMTEST-', 'JMTEST_']);
		jira.invalidateDiscoveryCaches();
		assert.deepEqual(await jira.autolinks(), []);
		state.fail = false;
		assert.deepEqual(prefixes(await jira.autolinks()), ['JMTEST-', 'JMTEST_']);
	});

	test('invalidation retires an older build without joining it or removing its replacement', async () => {
		const { jira, state } = await connected();
		const oldGate = defer<void>();
		state.gate = oldGate.promise;
		const oldRead = jira.autolinks();
		await flush();
		jira.invalidateDiscoveryCaches();
		state.projects = [{ id: '102', key: 'NEW', name: 'New project' }];
		const newGate = defer<void>();
		state.gate = newGate.promise;
		const freshRead = jira.autolinks();
		await flush();
		assert.equal(state.reads, 2);
		oldGate.fulfill();
		assert.deepEqual(await oldRead, []);
		const concurrentFreshRead = jira.autolinks();
		await flush();
		assert.equal(state.reads, 2, 'the retired build cannot remove the fresh in-flight build');
		newGate.fulfill();
		assert.deepEqual(prefixes(await freshRead), ['NEW-', 'NEW_']);
		assert.deepEqual(prefixes(await concurrentFreshRead), ['NEW-', 'NEW_']);
		assert.deepEqual(prefixes(await jira.autolinks()), ['NEW-', 'NEW_']);
		assert.equal(state.reads, 2);
	});

	test('issue discovery and decoration share a single pending cached project snapshot', async () => {
		const { jira, state } = await connected();
		const resources = (await jira.getResourcesForUser())!;
		const gate = defer<void>();
		state.gate = gate.promise;
		const projects = jira.getProjectsForResourcesWithMetadataResult(resources);
		await flush();
		const links = jira.autolinks();
		await flush();
		assert.equal(state.reads, 1, 'another reader cannot publish a different concurrent project snapshot');
		gate.fulfill();
		assert.equal((await projects)?.value?.values[0]?.key, 'JMTEST');
		assert.deepEqual(prefixes(await links), ['JMTEST-', 'JMTEST_']);
		assert.deepEqual(prefixes(await jira.autolinks()), ['JMTEST-', 'JMTEST_']);
		assert.equal(state.reads, 1);
	});

	test('a missing-project response retires pending discovery instead of restoring the deleted project', async () => {
		const { jira, state } = await connected();
		const gate = defer<void>();
		const started = defer<void>();
		state.gate = gate.promise;
		state.onProjectRead = () => started.fulfill();
		try {
			const links = jira.autolinks();
			await started.promise;
			state.projects = [];
			state.missingProject = true;
			const generation = jira.discoveryGeneration;
			const issues = await jira.getIssuesForProject({
				id: '101',
				key: 'JMTEST',
				name: 'Test',
				resourceId: 'jira.example.com',
			});
			assert.deepEqual(issues, []);
			assert.ok(jira.discoveryGeneration > generation);
			gate.fulfill();
			assert.deepEqual(await links, []);
			state.gate = undefined;
			assert.deepEqual(await jira.autolinks(), []);
			assert.equal(state.reads, 2);
		} finally {
			gate.fulfill();
		}
	});

	test('disconnect retires discovery already in flight', async () => {
		const { jira, state } = await connected();
		const gate = defer<void>();
		const started = defer<void>();
		state.gate = gate.promise;
		state.onProjectRead = () => started.fulfill();
		try {
			const read = jira.autolinks();
			await started.promise;
			await jira.disconnect({ silent: true });
			gate.fulfill();
			assert.deepEqual(await read, []);
			assert.deepEqual(await jira.autolinks(), []);
		} finally {
			gate.fulfill();
		}
	});

	test('a retired decoration failure does not expire the replacement primary session', async () => {
		const { jira, state } = await connected();
		const gate = defer<void>();
		const started = defer<void>();
		state.gate = gate.promise;
		state.onProjectRead = () => started.fulfill();
		state.unauthorized = true;
		try {
			const retired = jira.autolinks();
			await started.promise;
			jira.invalidateDiscoveryCaches();
			const replacement = {
				...session('https://jira.example.com/jira', 'replacement'),
				expiresAt: new Date(Date.now() + 3600000),
			};
			(jira as unknown as { _session: ProviderAuthenticationSession })._session = replacement;
			gate.fulfill();
			assert.deepEqual(await retired, []);
			assert.equal(jira.connectionExpired, false);
			assert.equal((jira as unknown as { _session: ProviderAuthenticationSession })._session, replacement);
			state.gate = undefined;
			state.unauthorized = false;
			assert.deepEqual(prefixes(await jira.autolinks()), ['JMTEST-', 'JMTEST_']);
		} finally {
			gate.fulfill();
		}
	});

	test('two installations with the same token never share prefixes or URLs', async () => {
		const a = await connected('https://jira-a.example.com/jira');
		const b = await connected('https://jira-b.example.com/dc');
		b.state.projects = [{ id: '101', key: 'SECOND', name: 'Second' }];
		assert.deepEqual(prefixes(await a.jira.autolinks()), ['JMTEST-', 'JMTEST_']);
		const refs = await b.jira.autolinks();
		assert.deepEqual(prefixes(refs), ['SECOND-', 'SECOND_']);
		assert.equal('url' in refs[0] && refs[0].url, 'https://jira-b.example.com/dc/browse/SECOND-<num>');
	});

	test('secondary reads pin the configured context path and leave the primary session alone', async () => {
		const { jira, manager } = await connected();
		const primary = session('https://jira.example.com/jira');
		let secondary = session('https://jira.example.com/dc');
		const internals = jira as unknown as {
			_session: ProviderAuthenticationSession;
			authenticationService: { get: () => Promise<{ getSession: () => Promise<ProviderAuthenticationSession> }> };
			getProvidersApi: () => Promise<unknown>;
		};
		internals._session = primary;
		internals.authenticationService.get = async () => ({ getSession: async () => secondary });
		internals.getProvidersApi = async () => ({
			getJiraServerProjects: (_token: unknown, baseUrl: string) =>
				Promise.resolve([{ id: '101', key: baseUrl.endsWith('/dc') ? 'SECOND' : 'PRIMARY', name: 'Project' }]),
		});
		const options = {
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			connectionId: 'secondary',
			domain: 'jira.example.com',
		} as const;
		assert.deepEqual(prefixes((await manager.getAutolinkReferences(options))![1]), ['SECOND-', 'SECOND_']);
		assert.deepEqual(prefixes(await jira.autolinks()), ['PRIMARY-', 'PRIMARY_']);
		assert.equal(internals._session, primary);
		secondary = { ...secondary, baseUrl: 'https://another.example.com/dc' };
		assert.deepEqual(prefixes((await manager.getAutolinkReferences(options))![1]), ['PRIMARY-', 'PRIMARY_']);
	});
});
