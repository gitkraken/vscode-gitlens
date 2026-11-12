import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { getAutolinks } from '@gitlens/git/utils/autolink.utils.js';
import { defer } from '@gitlens/utils/promise.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	createIntegrationManager,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../index.js';
import type { GetAutolinkReferencesOptions, IntegrationManager, RefSet } from '../index.js';
import type { IntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

async function connected(cloud = false) {
	const runtime = createFakeRuntime();
	const providerId = cloud ? IssuesCloudHostIntegrationId.Jira : IssuesSelfManagedHostIntegrationId.JiraServer;
	const connections = [
		{ tokenId: 'one', key: 'FIRST', baseUrl: 'https://jira.example.com/jira' },
		{ tokenId: 'two', key: 'SECOND', baseUrl: 'https://jira.example.com/dc' },
	];
	const descriptor = (connection: (typeof connections)[number]) => ({
		tokenId: connection.tokenId,
		provider: cloud ? 'jira' : 'jiraServer',
		type: cloud ? 'oauth' : 'pat',
		domain: cloud ? 'atlassian.net' : connection.baseUrl,
	});
	const state = {
		projectReads: [] as string[],
		tokenReads: [] as string[],
		requests: [] as string[],
		providerTokens: [] as string[],
		fail: false,
		empty: false,
		rejectToken: undefined as string | undefined,
		tokenSuffix: '',
	};
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async path => {
		state.tokenReads.push(path);
		if (path === 'v1/provider-tokens') {
			return json({ data: [{ ...descriptor(connections[0]), secondaries: [descriptor(connections[1])] }] });
		}

		const target = path.replace(/\/refresh$/, '');
		const connection =
			target === `v1/provider-tokens/${cloud ? 'jira' : 'jiraServer'}`
				? connections[0]
				: connections.find(c => target.endsWith(`/${c.tokenId}`));
		return connection == null
			? json({ data: undefined })
			: json({
					data: {
						...descriptor(connection),
						accessToken: `${connection.tokenId}${path.endsWith('/refresh') ? '-fresh' : state.tokenSuffix}`,
						expiresIn: 3600,
						scopes: '',
					},
				});
	};
	runtime.http.fetch = async (input, init) => {
		const url = new URL(input.toString());
		state.requests.push(url.href);
		const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '');
		state.providerTokens.push(token ?? '');
		const connection = connections.find(c => c.tokenId === token?.replace(/-fresh$/, ''));
		assert.ok(connection != null, 'the provider request uses the selected connection token');
		if (token === state.rejectToken && (url.pathname.endsWith('/accessible-resources') || !cloud)) {
			return new Response('{}', { status: 401 });
		}

		if (url.pathname.endsWith('/accessible-resources')) {
			return json([
				{
					id: connection.tokenId,
					name: connection.key,
					url: `https://${connection.tokenId}.atlassian.net`,
					scopes: [],
				},
			]);
		}
		if (url.pathname.endsWith('/myself')) {
			return json({ accountId: token, key: token, name: token, displayName: token, avatarUrls: {} });
		}
		if (url.pathname.endsWith('/project') || url.pathname.endsWith('/project/search')) {
			state.projectReads.push(connection.tokenId);
			if (state.fail) return new Response('{}', { status: 500 });

			if (!cloud) {
				assert.equal(url.origin + url.pathname, `${connection.baseUrl}/rest/api/2/project`);
			}
			const startAt = Number(url.searchParams.get('startAt') ?? 0);
			const projects = startAt === 0 && !state.empty ? [{ id: '101', key: connection.key, name: 'Project' }] : [];
			return json(cloud ? { values: projects, startAt: startAt } : projects);
		}
		throw new Error(`Unexpected provider path ${url.pathname}`);
	};
	const manager: IntegrationManager = createIntegrationManager(runtime);
	await manager.refreshConnections();
	return {
		manager: manager,
		providerId: providerId,
		connections: connections,
		state: state,
		runtime: runtime,
	} as const;
}

async function expireStoredConnection(
	runtime: ReturnType<typeof createFakeRuntime>,
	providerId: string,
	connectionId: string,
): Promise<void> {
	const key = `integration.auth.cloud:${providerId}|${connectionId}`;
	const stored = await runtime.storage.getSecret(key);
	assert.ok(stored != null);
	await runtime.storage.storeSecret(
		key,
		JSON.stringify({ ...JSON.parse(stored), expiresAt: new Date(0).toISOString() }),
	);
}

function urlFor(refset: RefSet | undefined, key: string): string | undefined {
	assert.ok(refset != null);
	return getAutolinks(`${key}-12`, [refset]).get('12')?.url;
}

suite('public Jira autolink references', () => {
	for (const [cloud, stage] of [
		[true, 'resources'],
		[true, 'projects'],
		[false, 'projects'],
	] as const) {
		test(`${cloud ? 'Cloud' : 'Data Center'} cold connection one survives connection two publishing during ${stage}`, async () => {
			const { manager, providerId, runtime, state } = await connected(cloud);
			const started = defer<void>();
			const release = defer<void>();
			try {
				const fetch = runtime.http.fetch;
				let held = false;
				runtime.http.fetch = async (input, init) => {
					const url = new URL(input.toString());
					const token = new Headers(init?.headers).get('authorization');
					if (
						!held &&
						token === 'Bearer one' &&
						(stage === 'resources'
							? url.pathname.endsWith('/accessible-resources')
							: url.pathname.endsWith('/project') || url.pathname.endsWith('/project/search'))
					) {
						held = true;
						started.fulfill();
						await release.promise;
					}
					return fetch(input, init);
				};
				const one = manager.getAutolinkReferences({ providerId: providerId, connectionId: 'one' });
				await started.promise;
				await expireStoredConnection(runtime, providerId, 'two');
				state.tokenSuffix = '-fresh';
				assert.ok(
					urlFor(
						await manager.getAutolinkReferences({ providerId: providerId, connectionId: 'two' }),
						'SECOND',
					),
				);
				release.fulfill();
				assert.ok(urlFor(await one, 'FIRST'));
				assert.ok(state.projectReads.includes('one'));
				assert.ok(state.projectReads.includes('two'));
			} finally {
				release.fulfill();
				manager.dispose();
			}
		});
	}

	test('a cold scoped snapshot survives unrelated publication before facade handoff', async () => {
		const { manager, providerId, runtime, state } = await connected();
		const ready = defer<void>();
		const release = defer<void>();
		try {
			const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
			const read = integration.getUncachedDiscoveryResult.bind(integration);
			integration.getUncachedDiscoveryResult = async (...args) => {
				const result = await read(...args);
				if (args[1] === 'one') {
					ready.fulfill();
					await release.promise;
				}
				return result;
			};
			const one = manager.getAutolinkReferences({ providerId: providerId, connectionId: 'one' });
			await ready.promise;
			await expireStoredConnection(runtime, providerId, 'two');
			state.tokenSuffix = '-fresh';
			assert.ok(
				urlFor(await manager.getAutolinkReferences({ providerId: providerId, connectionId: 'two' }), 'SECOND'),
			);
			release.fulfill();
			assert.ok(urlFor(await one, 'FIRST'));
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	for (const retireGlobally of [false, true]) {
		test(`pending connection two ${retireGlobally ? 'retires under global invalidation' : 'survives scoped forceSync of connection one'}`, async () => {
			const { manager, providerId, runtime } = await connected();
			const started = defer<void>();
			const release = defer<void>();
			try {
				const fetch = runtime.http.fetch;
				let held = false;
				runtime.http.fetch = async (input, init) => {
					if (
						!held &&
						new URL(input.toString()).pathname.endsWith('/project') &&
						new Headers(init?.headers).get('authorization') === 'Bearer two'
					) {
						held = true;
						started.fulfill();
						await release.promise;
					}
					return fetch(input, init);
				};
				const two = manager.getAutolinkReferences({ providerId: providerId, connectionId: 'two' });
				await started.promise;
				if (retireGlobally) {
					const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
					integration.invalidateDiscoveryCaches();
				} else {
					assert.ok(
						urlFor(
							await manager.getAutolinkReferences({
								providerId: providerId,
								connectionId: 'one',
								forceSync: true,
							}),
							'FIRST',
						),
					);
				}
				release.fulfill();
				if (retireGlobally) {
					assert.equal(await two, undefined);
				} else {
					assert.ok(urlFor(await two, 'SECOND'));
				}
			} finally {
				release.fulfill();
				manager.dispose();
			}
		});
	}

	for (const cloud of [false, true]) {
		for (const scoped of [false, true]) {
			test(`${cloud ? 'Cloud' : 'Data Center'} ${scoped ? 'scoped' : 'primary'} forced auth failure refuses otherwise successful projects`, async () => {
				const { manager, providerId, runtime, connections, state } = await connected(cloud);
				try {
					const options = { providerId: providerId, connectionId: scoped ? 'two' : undefined };
					assert.ok(urlFor(await manager.getAutolinkReferences(options), scoped ? 'SECOND' : 'FIRST'));
					const reads = state.projectReads.length;
					runtime.account.fetchGkApi = async () => {
						throw new Error('Token exchange unavailable');
					};
					assert.equal(await manager.getAutolinkReferences({ ...options, forceSync: true }), undefined);
					assert.equal(state.projectReads.length, reads);
					connections[scoped ? 1 : 0].key = 'CURRENT';
					assert.ok(urlFor(await manager.getAutolinkReferences(options), 'CURRENT'));
				} finally {
					manager.dispose();
				}
			});
		}
	}

	test('failed forced authentication still retires discovery started during its await', async () => {
		const { manager, providerId, runtime } = await connected();
		const authStarted = defer<void>();
		const releaseAuth = defer<void>();
		const projectsStarted = defer<void>();
		const releaseProjects = defer<void>();
		try {
			const options = { providerId: providerId, connectionId: 'two' };
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
			runtime.account.fetchGkApi = async () => {
				authStarted.fulfill();
				await releaseAuth.promise;
				throw new Error('Token exchange unavailable');
			};
			const fetchProvider = runtime.http.fetch;
			runtime.http.fetch = async (...args) => {
				const response = await fetchProvider(...args);
				projectsStarted.fulfill();
				await releaseProjects.promise;
				return response;
			};
			const forced = manager.getAutolinkReferences({ ...options, forceSync: true });
			await authStarted.promise;
			const old = manager.getAutolinkReferences(options);
			await projectsStarted.promise;
			releaseAuth.fulfill();
			assert.equal(await forced, undefined);
			releaseProjects.fulfill();
			assert.equal(await old, undefined);
		} finally {
			releaseAuth.fulfill();
			releaseProjects.fulfill();
			manager.dispose();
		}
	});

	test('a retired primary sync does not delete its newly stored replacement', async () => {
		const { manager, providerId, runtime, state } = await connected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			assert.ok(urlFor(await manager.getAutolinkReferences({ providerId: providerId }), 'FIRST'));
			const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
			const fetchToken = runtime.account.fetchGkApi;
			let held = false;
			runtime.account.fetchGkApi = async (...args) => {
				if (args[0] !== 'v1/provider-tokens' && !held) {
					held = true;
					started.fulfill();
					await release.promise;
				}
				return fetchToken(...args);
			};
			const forced = manager.getAutolinkReferences({ providerId: providerId, forceSync: true });
			await started.promise;
			integration.invalidateDiscoveryCaches();
			state.tokenSuffix = '-fresh';
			release.fulfill();
			assert.equal(await forced, undefined);
			assert.ok(manager.getConfigured(providerId).some(c => c.id === 'one'));
			const secret = JSON.parse(
				(await runtime.storage.getSecret('integration.auth.cloud:jira-server|one'))!,
			) as ProviderAuthenticationSession;
			assert.equal(secret.accessToken, 'one-fresh');
			assert.ok(urlFor(await manager.getAutolinkReferences({ providerId: providerId }), 'FIRST'));
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	for (const cloud of [false, true]) {
		for (const kind of ['public', 'cached'] as const) {
			test(`${cloud ? 'Cloud' : 'Data Center'} primary ${kind} resolution retires an independent invalidation`, async () => {
				const { manager, providerId, state } = await connected(cloud);
				const started = defer<void>();
				const release = defer<void>();
				try {
					const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
					assert.equal(await integration.isConnected(), true);
					const resources = (await integration.getResourcesForUser())!;
					const internals = integration as unknown as {
						refreshSessionIfExpired: () => Promise<Error | undefined>;
					};
					const refresh = internals.refreshSessionIfExpired.bind(integration);
					internals.refreshSessionIfExpired = async () => {
						started.fulfill();
						await release.promise;
						return refresh();
					};
					const reads = state.projectReads.length;
					const old =
						kind === 'public'
							? manager.getAutolinkReferences({ providerId: providerId })
							: integration.getProjectsForResourcesWithMetadataResult(resources);
					await started.promise;
					integration.invalidateDiscoveryCaches();
					release.fulfill();
					assert.equal(await old, undefined);
					assert.equal(state.projectReads.length, reads);
				} finally {
					release.fulfill();
					manager.dispose();
				}
			});
		}
	}

	test('a scoped automatic refresh cannot cross an independent invalidation', async () => {
		const { manager, providerId, runtime, state } = await connected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			const options = { providerId: providerId, connectionId: 'two' };
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
			const secretKey = 'integration.auth.cloud:jira-server|two';
			const secret = JSON.parse((await runtime.storage.getSecret(secretKey))!) as ProviderAuthenticationSession;
			await runtime.storage.storeSecret(secretKey, JSON.stringify({ ...secret, expiresAt: new Date(0) }));
			state.tokenSuffix = '-fresh';
			const fetchToken = runtime.account.fetchGkApi;
			let held = false;
			runtime.account.fetchGkApi = async (...args) => {
				if (args[0].includes('/two') && !held) {
					held = true;
					started.fulfill();
					await release.promise;
				}
				return fetchToken(...args);
			};
			const reads = state.projectReads.length;
			const retired = manager.getAutolinkReferences(options);
			await started.promise;
			const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
			integration.invalidateDiscoveryCaches();
			release.fulfill();
			assert.equal(await retired, undefined);
			assert.equal(state.projectReads.length, reads, 'the retired read sends no project request');
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	for (const cloud of [false, true]) {
		test(`${cloud ? 'Cloud' : 'Data Center'} scoped replacement retires old refusals before descriptor persistence`, async () => {
			const { manager, providerId, runtime, state } = await connected(cloud);
			const refreshStarted = defer<void>();
			const releaseRefresh = defer<void>();
			const oldStarted = defer<void>();
			const releaseOld = defer<void>();
			const published = defer<void>();
			const releaseStore = defer<void>();
			let forced: Promise<RefSet | undefined> | undefined;
			try {
				const options = { providerId: providerId, connectionId: 'two' };
				assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
				const fetchToken = runtime.account.fetchGkApi;
				let heldRefresh = false;
				runtime.account.fetchGkApi = async (...args) => {
					if (args[0].endsWith('/two') && !heldRefresh) {
						heldRefresh = true;
						refreshStarted.fulfill();
						await releaseRefresh.promise;
					}
					return fetchToken(...args);
				};
				const fetchProvider = runtime.http.fetch;
				runtime.http.fetch = async (input, init) => {
					if (
						new URL(input.toString()).pathname.includes('/project') &&
						new Headers(init?.headers).get('authorization') === 'Bearer two'
					) {
						oldStarted.fulfill();
						await releaseOld.promise;
						return new Response('{}', { status: 401 });
					}
					return fetchProvider(input, init);
				};
				const store = runtime.storage.store;
				let heldStore = false;
				runtime.storage.store = async (key, value) => {
					if (key === 'integrations:configured' && state.tokenSuffix === '-fresh' && !heldStore) {
						heldStore = true;
						published.fulfill();
						await releaseStore.promise;
					}
					return store(key, value);
				};
				forced = manager.getAutolinkReferences({ ...options, forceSync: true });
				await refreshStarted.promise;
				const old = manager.getAutolinkReferences(options);
				await oldStarted.promise;
				state.tokenSuffix = '-fresh';
				releaseRefresh.fulfill();
				await published.promise;
				releaseOld.fulfill();
				assert.equal(await old, undefined);
				releaseStore.fulfill();
				assert.ok(urlFor(await forced, 'SECOND'));
				assert.equal(
					state.tokenReads.some(path => path.endsWith('/refresh')),
					false,
				);
			} finally {
				releaseRefresh.fulfill();
				releaseOld.fulfill();
				releaseStore.fulfill();
				await forced;
				manager.dispose();
			}
		});
	}

	for (const cloud of [false, true]) {
		for (const kind of ['public', 'cached', 'scoped without a primary', 'same-token address change'] as const) {
			if (cloud && kind === 'same-token address change') continue;

			test(`${cloud ? 'Cloud' : 'Data Center'} old ${kind} refusal cannot expire a primary being published`, async () => {
				const { manager, providerId, runtime, state, connections } = await connected(cloud);
				const sameTokenAddress = kind === 'same-token address change';
				const replacementToken = sameTokenAddress ? 'one' : 'one-fresh';
				const replacementUrl = `${connections[0].baseUrl}/moved`;
				const refreshStarted = defer<void>();
				const releaseRefresh = defer<void>();
				const oldStarted = defer<void>();
				const releaseOld = defer<void>();
				const published = defer<void>();
				const releaseStore = defer<void>();
				let refresh: Promise<void> | undefined;
				try {
					const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
					assert.equal(await integration.isConnected(), true);
					const resources = (await integration.getResourcesForUser())!;
					const fetchToken = runtime.account.fetchGkApi;
					let heldRefresh = false;
					runtime.account.fetchGkApi = async (...args) => {
						if (args[0] !== 'v1/provider-tokens' && !heldRefresh) {
							heldRefresh = true;
							refreshStarted.fulfill();
							await releaseRefresh.promise;
						}
						return fetchToken(...args);
					};
					const fetchProvider = runtime.http.fetch;
					runtime.http.fetch = async (input, init) => {
						const url = new URL(input.toString());
						if (
							url.pathname.includes('/project') &&
							new Headers(init?.headers).get('authorization') === 'Bearer one' &&
							(!sameTokenAddress || !url.href.startsWith(replacementUrl))
						) {
							oldStarted.fulfill();
							await releaseOld.promise;
							return new Response('{}', { status: 401 });
						}
						return fetchProvider(input, init);
					};
					const store = runtime.storage.storeWorkspace;
					const internals = integration as unknown as { _session: ProviderAuthenticationSession | undefined };
					runtime.storage.storeWorkspace = async (key, value) => {
						if (
							key.startsWith('connected:') &&
							value === true &&
							internals._session?.accessToken === replacementToken &&
							(!sameTokenAddress || internals._session.baseUrl === replacementUrl)
						) {
							published.fulfill();
							await releaseStore.promise;
						}
						return store(key, value);
					};
					if (kind === 'scoped without a primary') {
						internals._session = undefined;
					}
					refresh = manager.refreshConnections();
					await refreshStarted.promise;
					const old =
						kind === 'cached'
							? integration.getProjectsForResourcesWithMetadataResult(resources)
							: manager.getAutolinkReferences({
									providerId: providerId,
									connectionId: kind === 'scoped without a primary' ? 'one' : undefined,
								});
					await oldStarted.promise;
					if (sameTokenAddress) {
						connections[0].baseUrl = replacementUrl;
					} else {
						state.tokenSuffix = '-fresh';
					}
					releaseRefresh.fulfill();
					await published.promise;
					releaseOld.fulfill();
					const oldResult = await old;
					if (kind !== 'cached') {
						assert.equal(oldResult, undefined);
					}
					assert.equal(internals._session?.accessToken, replacementToken);
					assert.notEqual(integration.connectionExpired, true);
					releaseStore.fulfill();
					await refresh;
					assert.notEqual(integration.connectionExpired, true);
					if (sameTokenAddress) {
						const moved = await manager.getAutolinkReferences({
							providerId: providerId,
							connectionId: 'one',
							forceSync: true,
						});
						assert.equal(urlFor(moved, 'FIRST'), `${replacementUrl}/browse/FIRST-12`);
						return;
					}

					const tokenReads = state.tokenReads.length;
					const currentUrl = urlFor(await manager.getAutolinkReferences({ providerId: providerId }), 'FIRST');
					assert.equal(
						currentUrl,
						`${cloud ? 'https://one.atlassian.net' : connections[0].baseUrl}/browse/FIRST-12`,
					);
					assert.equal(state.tokenReads.length, tokenReads, 'the replacement needs no recovery refresh');
				} finally {
					releaseRefresh.fulfill();
					releaseOld.fulfill();
					releaseStore.fulfill();
					await refresh;
					manager.dispose();
				}
			});
		}
	}

	test('proves an empty Data Center catalog with the same credential and distinguishes anonymous responses', async () => {
		const { manager, providerId, runtime, state } = await connected();
		const fetchProvider = runtime.http.fetch;
		let accountStatus = 200;
		let anonymous = false;
		const accountTokens: string[] = [];
		runtime.http.fetch = async (input, init) => {
			if (new URL(input.toString()).pathname.endsWith('/myself')) {
				accountTokens.push(new Headers(init?.headers).get('authorization')!);
				if (anonymous) return json({ avatarUrls: {} });
				return accountStatus === 200
					? fetchProvider(input, init)
					: new Response('{}', { status: accountStatus });
			}
			return fetchProvider(input, init);
		};
		try {
			state.empty = true;
			const options = { providerId: providerId, connectionId: 'two' };
			assert.deepEqual((await manager.getAutolinkReferences(options))?.[1], []);
			assert.deepEqual(accountTokens, ['Bearer two']);
			assert.deepEqual(state.projectReads, ['two']);
			accountStatus = 401;
			assert.equal(await manager.getAutolinkReferences(options), undefined);
			assert.deepEqual(accountTokens, ['Bearer two', 'Bearer two']);
			assert.deepEqual(state.projectReads, ['two', 'two']);
			accountStatus = 503;
			assert.equal(await manager.getAutolinkReferences(options), undefined);
			assert.deepEqual(accountTokens, ['Bearer two', 'Bearer two', 'Bearer two-fresh']);
			assert.deepEqual(state.projectReads, ['two', 'two', 'two']);
			accountStatus = 200;
			anonymous = true;
			assert.equal(await manager.getAutolinkReferences(options), undefined);
			assert.deepEqual(accountTokens, ['Bearer two', 'Bearer two', 'Bearer two-fresh', 'Bearer two-fresh']);
			assert.deepEqual(state.projectReads, ['two', 'two', 'two', 'two']);
		} finally {
			manager.dispose();
		}
	});

	test('retires an empty catalog invalidated while its credential proof is pending', async () => {
		const { manager, providerId, runtime, state } = await connected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			state.empty = true;
			const fetchProvider = runtime.http.fetch;
			let held = false;
			runtime.http.fetch = async (input, init) => {
				if (new URL(input.toString()).pathname.endsWith('/myself') && !held) {
					held = true;
					started.fulfill();
					await release.promise;
				}
				return fetchProvider(input, init);
			};
			const options = { providerId: providerId, connectionId: 'two' };
			const old = manager.getAutolinkReferences(options);
			await started.promise;
			const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
			integration.invalidateDiscoveryCaches();
			release.fulfill();
			assert.equal(await old, undefined);
			assert.deepEqual((await manager.getAutolinkReferences(options))?.[1], []);
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	for (const cloud of [false, true]) {
		for (const kind of ['public', 'cached'] as const) {
			test(`${cloud ? 'Cloud' : 'Data Center'} first expired primary refresh succeeds for ${kind} discovery`, async () => {
				const { manager, providerId, state } = await connected(cloud);
				try {
					const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
					assert.equal(await integration.isConnected(), true);
					const resources = (await integration.getResourcesForUser())!;
					const internals = integration as unknown as { _session: ProviderAuthenticationSession };
					internals._session = { ...internals._session, expiresAt: new Date(0) };
					state.tokenSuffix = '-fresh';
					if (kind === 'public') {
						assert.ok(urlFor(await manager.getAutolinkReferences({ providerId: providerId }), 'FIRST'));
					} else {
						const result = await integration.getProjectsForResourcesWithMetadataResult(resources);
						assert.equal(result?.value?.values[0]?.key, 'FIRST');
					}
					assert.equal(state.providerTokens.at(-1), 'one-fresh');
				} finally {
					manager.dispose();
				}
			});
		}

		for (const retirement of ['independent force', 'global invalidation', 'primary invalidation'] as const) {
			test(`${cloud ? 'Cloud' : 'Data Center'} expired primary refresh ${retirement === 'independent force' ? 'survives' : 'retires under'} ${retirement} before authentication`, async () => {
				const { manager, providerId, runtime, state } = await connected(cloud);
				const started = defer<void>();
				const release = defer<void>();
				try {
					const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
					assert.equal(await integration.isConnected(), true);
					const internals = integration as unknown as { _session: ProviderAuthenticationSession };
					internals._session = { ...internals._session, expiresAt: new Date(0) };
					state.tokenSuffix = '-fresh';
					const deleteWorkspace = runtime.storage.deleteWorkspace;
					let connectedDeletes = 0;
					runtime.storage.deleteWorkspace = async key => {
						if (key.startsWith('connected:') && ++connectedDeletes === 2) {
							started.fulfill();
							await release.promise;
						}
						return deleteWorkspace(key);
					};
					const primary = manager.getAutolinkReferences({ providerId: providerId });
					await started.promise;
					if (retirement === 'independent force') {
						assert.ok(
							urlFor(
								await manager.getAutolinkReferences({
									providerId: providerId,
									connectionId: 'two',
									forceSync: true,
								}),
								'SECOND',
							),
						);
					} else if (retirement === 'global invalidation') {
						integration.invalidateDiscoveryCaches();
					} else {
						integration.invalidateDiscoveryForConnection();
					}
					const readsBeforeRelease = state.tokenReads.length;
					release.fulfill();
					if (retirement === 'independent force') {
						assert.ok(urlFor(await primary, 'FIRST'));
						assert.ok(state.tokenReads.length > readsBeforeRelease);
						assert.equal(state.providerTokens.at(-1), 'one-fresh');
					} else {
						assert.equal(await primary, undefined);
						assert.equal(state.tokenReads.length, readsBeforeRelease);
					}
				} finally {
					release.fulfill();
					manager.dispose();
				}
			});
		}

		test(`${cloud ? 'Cloud' : 'Data Center'} reads are connection scoped and forceSync discovers projects`, async () => {
			const { manager, providerId, connections, state } = await connected(cloud);
			try {
				const options: GetAutolinkReferencesOptions = { providerId: providerId, connectionId: 'two' };
				const second = await manager.getAutolinkReferences(options);
				assert.ok(second?.[1].length, JSON.stringify(state));
				assert.deepEqual(
					second[1].map(r => ('prefix' in r ? r.prefix : '')),
					['SECOND-', 'SECOND_'],
				);
				assert.equal(
					urlFor(second, 'SECOND'),
					cloud
						? 'https://two.atlassian.net/browse/SECOND-12'
						: 'https://jira.example.com/dc/browse/SECOND-12',
					JSON.stringify(second),
				);
				assert.equal(second?.[0]?.id, providerId);
				const first = await manager.getAutolinkReferences({ providerId: providerId, connectionId: 'one' });
				assert.equal(
					urlFor(first, 'FIRST'),
					cloud
						? 'https://one.atlassian.net/browse/FIRST-12'
						: 'https://jira.example.com/jira/browse/FIRST-12',
				);
				connections[1].key = 'FRESH';
				assert.ok(
					urlFor(await manager.getAutolinkReferences(options), 'FRESH'),
					'each catalog read bypasses decoration caches',
				);
				const fresh = await manager.getAutolinkReferences({ ...options, forceSync: true });
				assert.equal(
					urlFor(fresh, 'FRESH'),
					cloud ? 'https://two.atlassian.net/browse/FRESH-12' : 'https://jira.example.com/dc/browse/FRESH-12',
				);
				assert.ok(state.tokenReads.filter(p => p.endsWith('/two')).length >= 2);
				assert.equal(getAutolinks('SECOND-12', [fresh!]).size, 0);
				assert.equal(
					urlFor(await manager.getAutolinkReferences({ providerId: providerId }), 'FIRST'),
					urlFor(first, 'FIRST'),
				);
			} finally {
				manager.dispose();
			}
		});

		test(`${cloud ? 'Cloud' : 'Data Center'} distinguishes failed, complete-empty and recovered catalogs`, async () => {
			const { manager, providerId, state } = await connected(cloud);
			try {
				const options = { providerId: providerId, connectionId: 'two' };
				state.fail = true;
				assert.equal(await manager.getAutolinkReferences(options), undefined);
				state.fail = false;
				state.empty = true;
				assert.deepEqual((await manager.getAutolinkReferences(options))?.[1], []);
				state.empty = false;
				assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
			} finally {
				manager.dispose();
			}
		});

		test(`${cloud ? 'Cloud' : 'Data Center'} recovers a scoped provider-rejected token before its advertised expiry`, async () => {
			const { manager, providerId, state } = await connected(cloud);
			try {
				const options = { providerId: providerId, connectionId: 'two' };
				state.rejectToken = 'two';
				assert.equal(await manager.getAutolinkReferences(options), undefined);
				assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
				assert.ok(state.tokenReads.some(path => path.endsWith('/two/refresh')));
			} finally {
				manager.dispose();
			}
		});
	}

	test('a forced catalog bypasses discovery started while its same-token authentication refresh was pending', async () => {
		const { manager, providerId, connections, runtime } = await connected();
		try {
			const options = { providerId: providerId, connectionId: 'two' };
			const refreshStarted = defer<void>();
			const authentication = defer<void>();
			const fetchGkApi = runtime.account.fetchGkApi;
			runtime.account.fetchGkApi = async (path, init) => {
				if (path.endsWith('/two')) {
					refreshStarted.fulfill();
					await authentication.promise;
				}
				return fetchGkApi(path, init);
			};
			const oldProjectStarted = defer<void>();
			const oldProjects = defer<void>();
			const fetch = runtime.http.fetch;
			let holdProject = true;
			runtime.http.fetch = async (input, init) => {
				const response = await fetch(input, init);
				if (holdProject && input.toString().includes('/project')) {
					holdProject = false;
					oldProjectStarted.fulfill();
					await oldProjects.promise;
				}
				return response;
			};
			const forced = manager.getAutolinkReferences({ ...options, forceSync: true });
			await refreshStarted.promise;
			const old = manager.getAutolinkReferences(options);
			await oldProjectStarted.promise;
			connections[1].key = 'FRESH';
			authentication.fulfill();
			assert.ok(urlFor(await forced, 'FRESH'));
			oldProjects.fulfill();
			assert.equal(await old, undefined);
		} finally {
			manager.dispose();
		}
	});

	test('a retired authentication failure does not reject the replacement connection token', async () => {
		const { manager, providerId, state, runtime } = await connected();
		try {
			const options = { providerId: providerId, connectionId: 'two' };
			state.rejectToken = 'two';
			const started = defer<void>();
			const release = defer<void>();
			const fetch = runtime.http.fetch;
			let hold = true;
			runtime.http.fetch = async (input, init) => {
				const response = await fetch(input, init);
				if (hold && input.toString().includes('/project')) {
					hold = false;
					started.fulfill();
					await release.promise;
				}
				return response;
			};
			const retired = manager.getAutolinkReferences(options);
			await started.promise;
			state.tokenSuffix = '-fresh';
			assert.ok(urlFor(await manager.getAutolinkReferences({ ...options, forceSync: true }), 'SECOND'));
			release.fulfill();
			assert.equal(await retired, undefined);
			const tokenReads = state.tokenReads.length;
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
			assert.equal(
				state.tokenReads.length,
				tokenReads,
				'the valid replacement token does not need another refresh',
			);
		} finally {
			manager.dispose();
		}
	});

	test('invalidation after snapshot completion is checked before the facade consumes it', async () => {
		const { manager, providerId } = await connected();
		try {
			const integration = (await (manager as unknown as IntegrationService).get(providerId))!;
			const read = integration.getUncachedDiscoveryResult.bind(integration);
			integration.getUncachedDiscoveryResult = async (...args) => {
				const result = await read(...args);
				integration.invalidateDiscoveryCaches();
				return result;
			};
			assert.equal(
				await manager.getAutolinkReferences({ providerId: providerId, connectionId: 'two' }),
				undefined,
			);
		} finally {
			manager.dispose();
		}
	});

	test('an explicit empty, unknown or foreign-host connection never falls back to primary projects', async () => {
		const { manager, providerId, state } = await connected();
		try {
			for (const connectionId of ['', ' ', 'missing']) {
				const refs = await manager.getAutolinkReferences({
					providerId: providerId,
					connectionId: connectionId,
				});
				assert.ok(refs == null || refs[1].length === 0);
			}
			const refs = await manager.getAutolinkReferences({
				providerId: providerId,
				connectionId: 'two',
				domain: 'foreign.example.com',
			});
			assert.equal(urlFor(refs, 'SECOND'), 'https://jira.example.com/dc/browse/SECOND-12');
			assert.deepEqual(state.projectReads, ['two']);
		} finally {
			manager.dispose();
		}
	});

	test('a failed forced refresh does not return the previous project catalog', async () => {
		const { manager, providerId, state } = await connected();
		try {
			const options = { providerId: providerId, connectionId: 'two' };
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
			state.fail = true;
			assert.equal(await manager.getAutolinkReferences({ ...options, forceSync: true }), undefined);
			state.fail = false;
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'SECOND'));
		} finally {
			manager.dispose();
		}
	});
});
