import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { getAutolinks } from '@gitlens/git/utils/autolink.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { Emitter } from '@gitlens/utils/event.js';
import { defer } from '@gitlens/utils/promise.js';
import type {
	GetSessionOptions,
	IntegrationAuthenticationProvider,
} from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	createIntegrationManager,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../index.js';
import type { RefSet } from '../index.js';
import type { IntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function urlFor(refset: RefSet | undefined, key: string): string | undefined {
	assert.ok(refset != null);
	return getAutolinks(`${key}-12`, [refset]).get('12')?.url;
}

function customConnected() {
	const baseRuntime = createFakeRuntime();
	const changes = new Emitter<void>();
	const sessions = ['ALPHA', 'BETA'].map<ProviderAuthenticationSession>(token => ({
		id: 'custom',
		accessToken: token,
		account: { id: token, label: token },
		scopes: [],
		cloud: true,
		type: 'pat',
		domain: 'custom.example.com',
		baseUrl: 'https://custom.example.com/jira',
	}));
	const state = {
		session: sessions[0] as ProviderAuthenticationSession | undefined,
		options: [] as (GetSessionOptions | undefined)[],
		disposed: 0,
		deleted: 0,
		publications: 0,
	};
	const provider: IntegrationAuthenticationProvider = {
		onDidChange: changes.event,
		getSession: async (_descriptor, options) => {
			state.options.push(options);
			return state.session;
		},
		deleteSession: async () => {
			state.deleted++;
		},
		deleteAllSessions: async () => {
			state.deleted++;
		},
		dispose: () => {
			state.disposed++;
			changes.dispose();
		},
	};
	const runtime = {
		...baseRuntime,
		hooks: { ...baseRuntime.hooks, createAuthenticationProvider: async () => provider },
	};
	runtime.http.fetch = async (_input, init) => {
		const token = new Headers(init?.headers).get('authorization')!.replace('Bearer ', '');
		return json([{ id: '100', key: token, name: token }]);
	};
	const manager = createIntegrationManager(runtime);
	const service = manager as unknown as IntegrationService;
	const publish = service.onSessionPublishing.bind(service);
	service.onSessionPublishing = (...args) => {
		state.publications++;
		publish(...args);
	};
	const options = {
		providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
		connectionId: 'custom',
		domain: sessions[0].baseUrl,
	};
	return {
		manager: manager,
		options: options,
		runtime: runtime,
		provider: provider,
		state: state,
		sessions: sessions,
	};
}

function customDistinctAccounts() {
	const fixture = customConnected();
	fixture.provider.getSession = async descriptor => ({
		...fixture.sessions[descriptor.connectionId === 'b' ? 1 : 0],
		id: descriptor.connectionId ?? 'a',
	});
	return {
		...fixture,
		accountA: { ...fixture.options, connectionId: 'a' },
		accountB: { ...fixture.options, connectionId: 'b' },
	};
}

suite('public Jira autolink custom authentication', () => {
	test('cold same-host accounts keep their own project discovery when the other first publishes', async () => {
		const { manager, runtime, accountA, accountB } = customDistinctAccounts();
		const started = defer<void>();
		const release = defer<void>();
		try {
			const fetchProvider = runtime.http.fetch;
			runtime.http.fetch = async (input, init) => {
				const response = await fetchProvider(input, init);
				if (new Headers(init?.headers).get('authorization') === 'Bearer ALPHA') {
					started.fulfill();
					await release.promise;
				}
				return response;
			};
			const pendingA = manager.getAutolinkReferences(accountA);
			await started.promise;
			assert.ok(urlFor(await manager.getAutolinkReferences(accountB), 'BETA'));
			release.fulfill();
			assert.ok(urlFor(await pendingA, 'ALPHA'));
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	test('cold same-host account survives another first publication at the facade handoff', async () => {
		const { manager, accountA, accountB } = customDistinctAccounts();
		const started = defer<void>();
		const release = defer<void>();
		try {
			const internals = manager as unknown as {
				getIntegrationForRead: (
					id: string,
					connectionId: string,
					domain: string | undefined,
				) => Promise<
					| {
							getUncachedDiscoveryResult: (...args: unknown[]) => Promise<unknown>;
					  }
					| undefined
				>;
			};
			const integration = await internals.getIntegrationForRead(
				accountA.providerId,
				accountA.connectionId,
				accountA.domain,
			);
			assert.ok(integration != null);
			const discover = integration.getUncachedDiscoveryResult.bind(integration);
			integration.getUncachedDiscoveryResult = async (...args) => {
				const result = await discover(...args);
				if (args[1] === 'a') {
					started.fulfill();
					await release.promise;
				}
				return result;
			};
			const pendingA = manager.getAutolinkReferences(accountA);
			await started.promise;
			assert.ok(urlFor(await manager.getAutolinkReferences(accountB), 'BETA'));
			release.fulfill();
			assert.ok(urlFor(await pendingA, 'ALPHA'));
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});
	for (const otherHost of [false, true]) {
		test(`deleting one connection preserves pending and observed ${otherHost ? 'other-host' : 'same-host'} credentials`, async () => {
			const { manager, options, provider, sessions, state } = customConnected();
			const started = defer<void>();
			const release = defer<void>();
			try {
				const internals = manager as unknown as {
					authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
				};
				const wrapped = await internals.authenticationService.get(options.providerId);
				const domainB = otherHost ? 'other.example.com' : 'custom.example.com';
				const descriptorA = { domain: 'custom.example.com', scopes: [], connectionId: 'a', cloud: true };
				const descriptorB = { domain: domainB, scopes: [], connectionId: 'b', cloud: true };
				const sessionA = { ...sessions[0], id: 'a' };
				const sessionB = { ...sessions[1], id: otherHost ? 'a' : 'b', domain: domainB };
				let holdB = false;
				provider.getSession = async descriptor => {
					if (descriptor.connectionId === 'b') {
						if (holdB) {
							started.fulfill();
							await release.promise;
						}
						return sessionB;
					}
					return sessionA;
				};
				await wrapped.getSession(descriptorA);
				await wrapped.getSession(descriptorB);
				const publications = state.publications;
				holdB = true;
				const pendingB = wrapped.getSession(descriptorB);
				await started.promise;
				await wrapped.deleteSession(descriptorA);
				release.fulfill();
				assert.equal((await pendingB)?.accessToken, 'BETA');
				assert.equal((await wrapped.getSession(descriptorB))?.accessToken, 'BETA');
				assert.equal(state.publications - publications, 1);
			} finally {
				release.fulfill();
				manager.dispose();
			}
		});
	}

	test('deletion fences the target before and during the host await, including a known alias', async () => {
		const { manager, options, provider, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
			};
			const wrapped = await internals.authenticationService.get(options.providerId);
			const actual = { domain: 'custom.example.com', scopes: [], connectionId: 'actual', cloud: true };
			const alias = { ...actual, connectionId: 'alias' };
			provider.getSession = async () => ({ ...sessions[0], id: 'actual' });
			await wrapped.getSession(alias);
			provider.deleteSession = async () => {
				started.fulfill();
				await release.promise;
			};
			const deletion = wrapped.deleteSession(actual);
			await started.promise;
			const during = wrapped.getSession(alias);
			release.fulfill();
			await deletion;
			await assert.rejects(during, isCancellationError);
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	test('an unseen selector returning a deleted actual credential is retired', async () => {
		const { manager, options, provider, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
			};
			const wrapped = await internals.authenticationService.get(options.providerId);
			const direct = { domain: 'custom.example.com', scopes: [], connectionId: 'actual', cloud: true };
			const alias = { ...direct, connectionId: 'alias' };
			const unseen = { ...direct, connectionId: 'unseen' };
			provider.getSession = async descriptor => {
				if (descriptor.connectionId === 'unseen') {
					started.fulfill();
					await release.promise;
				}
				return { ...sessions[0], id: 'actual' };
			};
			await wrapped.getSession(alias);
			const pending = wrapped.getSession(unseen);
			await started.promise;
			await wrapped.deleteSession(direct);
			release.fulfill();
			await assert.rejects(pending, isCancellationError);
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	test('primary-only deletion keeps a secondary credential on the same host', async () => {
		const { manager, options, provider, sessions, state } = customConnected();
		try {
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
			};
			const wrapped = await internals.authenticationService.get(options.providerId);
			const primary = { domain: 'custom.example.com', scopes: [], cloud: true };
			const secondary = { ...primary, connectionId: 'secondary' };
			provider.getSession = async descriptor => ({
				...sessions[descriptor.connectionId === 'secondary' ? 1 : 0],
				id: descriptor.connectionId === 'secondary' ? 'secondary' : 'primary',
			});
			await wrapped.getSession(primary);
			await wrapped.getSession(secondary);
			const publications = state.publications;
			await wrapped.deleteSession(primary);
			assert.equal((await wrapped.getSession(secondary))?.accessToken, 'BETA');
			assert.equal(state.publications - publications, 1);
		} finally {
			manager.dispose();
		}
	});

	for (const [readCloud, deletedCloud, sourceCloud, retired, phase] of [
		[true, undefined, true, true, 'complete'],
		[undefined, true, true, true, 'complete'],
		[undefined, true, false, false, 'complete'],
		[undefined, true, undefined, true, 'complete'],
		[false, true, true, true, 'complete'],
		[true, false, false, true, 'complete'],
		[false, true, true, true, 'active'],
		[true, false, false, true, 'active'],
	] as const) {
		test(`cold alias request=${readCloud} source=${sourceCloud} delete=${deletedCloud} (${phase})`, async () => {
			const { manager, options, provider, sessions, state } = customConnected();
			const started = defer<void>();
			const release = defer<void>();
			const deleteStarted = defer<void>();
			const releaseDeletion = defer<void>();
			let pending: Promise<ProviderAuthenticationSession | undefined> | undefined;
			let deletion: Promise<void> | undefined;
			try {
				const internals = manager as unknown as {
					authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
				};
				const wrapped = await internals.authenticationService.get(options.providerId);
				const alias = { domain: 'custom.example.com', scopes: [], connectionId: 'alias', cloud: readCloud };
				provider.getSession = async () => {
					started.fulfill();
					await release.promise;
					return sourceCloud == null ? undefined : { ...sessions[0], id: 'actual', cloud: sourceCloud };
				};
				provider.deleteSession = async () => {
					deleteStarted.fulfill();
					if (phase === 'active') {
						await releaseDeletion.promise;
					}
				};
				pending = wrapped.getSession(alias);
				void pending.catch(() => {});
				await started.promise;
				deletion = wrapped.deleteSession({ ...alias, cloud: deletedCloud });
				await (phase === 'active' ? deleteStarted.promise : deletion);
				const publications = state.publications;
				release.fulfill();
				if (retired) {
					await assert.rejects(pending, isCancellationError);
				} else {
					assert.equal((await pending)?.cloud, false);
				}
				assert.equal(state.publications - publications, retired ? 0 : 1);
				releaseDeletion.fulfill();
				await deletion;
				assert.equal((await wrapped.getSession(alias))?.cloud, sourceCloud);
			} finally {
				releaseDeletion.fulfill();
				release.fulfill();
				await Promise.allSettled([pending, deletion]);
				manager.dispose();
			}
		});
	}

	for (const deleteHost of [false, true]) {
		test(`foreign self-managed source cannot publish into another host${deleteHost ? ' after host deletion' : ''}`, async () => {
			const { manager, options, provider, sessions, state } = customConnected();
			const started = defer<void>();
			const release = defer<void>();
			let pending: Promise<ProviderAuthenticationSession | undefined> | undefined;
			try {
				const primary = { ...options, connectionId: undefined };
				assert.ok(urlFor(await manager.getAutolinkReferences(primary), 'ALPHA'));
				const internals = manager as unknown as {
					authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
					getIntegrationForRead: (
						id: string,
						connectionId: string | undefined,
						domain: string | undefined,
					) => Promise<{ _session: ProviderAuthenticationSession | null | undefined } | undefined>;
				};
				const integration = await internals.getIntegrationForRead(
					primary.providerId,
					undefined,
					primary.domain,
				);
				assert.ok(integration?._session != null);
				const original = integration._session;
				const wrapped = await internals.authenticationService.get(options.providerId);
				provider.getSession = async () => {
					started.fulfill();
					await release.promise;
					return { ...sessions[1], id: 'foreign', domain: 'custom.example.com' };
				};
				const foreign = { domain: 'foreign.example.com', scopes: [] };
				pending = wrapped.getSession(foreign);
				void pending.catch(() => {});
				await started.promise;
				if (deleteHost) {
					await wrapped.deleteAllSessions({ domain: 'custom.example.com', scopes: [] });
				}
				const beforeReturn = state.publications;
				release.fulfill();
				await assert.rejects(pending, isCancellationError);
				assert.equal(state.publications, beforeReturn);
				if (!deleteHost) {
					assert.equal(integration._session, original);
				}
			} finally {
				release.fulfill();
				if (pending != null) {
					await Promise.allSettled([pending]);
				}
				manager.dispose();
			}
		});
	}

	for (const [readCloud, deletedCloud, sourceCloud, retired, phase] of [
		[true, undefined, true, true, 'complete'],
		[undefined, true, true, true, 'complete'],
		[undefined, true, false, false, 'complete'],
		[false, true, true, true, 'complete'],
		[true, false, false, true, 'complete'],
		[false, true, true, true, 'active'],
		[true, false, false, true, 'active'],
	] as const) {
		test(`cold primary request=${readCloud} source=${sourceCloud} delete=${deletedCloud} (${phase})`, async () => {
			const { manager, options, provider, sessions, state } = customConnected();
			const started = defer<void>();
			const release = defer<void>();
			const deleteStarted = defer<void>();
			const releaseDeletion = defer<void>();
			let pending: Promise<ProviderAuthenticationSession | undefined> | undefined;
			let deletion: Promise<void> | undefined;
			try {
				const internals = manager as unknown as {
					authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
				};
				const wrapped = await internals.authenticationService.get(options.providerId);
				const primary = { domain: 'custom.example.com', scopes: [], cloud: readCloud };
				provider.getSession = async () => {
					started.fulfill();
					await release.promise;
					return { ...sessions[0], id: 'actual', cloud: sourceCloud };
				};
				provider.deleteSession = async () => {
					deleteStarted.fulfill();
					if (phase === 'active') {
						await releaseDeletion.promise;
					}
				};
				pending = wrapped.getSession(primary);
				void pending.catch(() => {});
				await started.promise;
				deletion = wrapped.deleteSession({ ...primary, cloud: deletedCloud });
				await (phase === 'active' ? deleteStarted.promise : deletion);
				const publications = state.publications;
				release.fulfill();
				if (retired) {
					await assert.rejects(pending, isCancellationError);
				} else {
					assert.equal((await pending)?.cloud, false);
				}
				assert.equal(state.publications - publications, retired ? 0 : 1);
				releaseDeletion.fulfill();
				await deletion;
				assert.equal((await wrapped.getSession(primary))?.cloud, sourceCloud);
			} finally {
				releaseDeletion.fulfill();
				release.fulfill();
				await Promise.allSettled([pending, deletion]);
				manager.dispose();
			}
		});
	}

	test('host-wide deletion preserves another host and fences reads begun during deletion', async () => {
		const { manager, options, provider, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
			};
			const wrapped = await internals.authenticationService.get(options.providerId);
			const hostA = { domain: 'custom.example.com', scopes: [], connectionId: 'a', cloud: true };
			const hostB = { ...hostA, domain: 'other.example.com', connectionId: 'b' };
			provider.getSession = async descriptor => ({
				...sessions[descriptor.connectionId === 'b' ? 1 : 0],
				id: descriptor.connectionId ?? 'primary',
				domain: descriptor.domain,
			});
			await wrapped.getSession(hostA);
			await wrapped.getSession(hostB);
			provider.deleteAllSessions = async () => {
				started.fulfill();
				await release.promise;
			};
			const deletion = wrapped.deleteAllSessions(hostA);
			await started.promise;
			const duringA = wrapped.getSession(hostA);
			const duringB = wrapped.getSession(hostB);
			release.fulfill();
			await deletion;
			await assert.rejects(duringA, isCancellationError);
			assert.equal((await duringB)?.accessToken, 'BETA');
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	test('cloud-only deletion preserves a cached local primary and its pending project discovery for the same id', async () => {
		const { manager, options, provider, runtime, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		let pending: Promise<RefSet | undefined> | undefined;
		try {
			const primary = { ...options, connectionId: undefined };
			provider.getSession = async () => ({ ...sessions[0], id: 'shared', cloud: false });
			assert.ok(urlFor(await manager.getAutolinkReferences(primary), 'ALPHA'));
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
				getIntegrationForRead: (
					id: string,
					connectionId: string | undefined,
					domain: string | undefined,
				) => Promise<{ _session: ProviderAuthenticationSession | null | undefined } | undefined>;
			};
			const integration = await internals.getIntegrationForRead(primary.providerId, undefined, primary.domain);
			assert.equal(integration?._session?.cloud, false);
			const cached = integration._session;
			const wrapped = await internals.authenticationService.get(options.providerId);
			const fetchProvider = runtime.http.fetch;
			runtime.http.fetch = async (...args) => {
				const response = await fetchProvider(...args);
				started.fulfill();
				await release.promise;
				return response;
			};
			pending = manager.getAutolinkReferences(primary);
			await started.promise;
			await wrapped.deleteSession({
				domain: 'custom.example.com',
				scopes: [],
				connectionId: 'shared',
				cloud: true,
			});
			assert.equal(integration._session, cached);
			release.fulfill();
			assert.ok(urlFor(await pending, 'ALPHA'));
			assert.equal(integration._session, cached);
		} finally {
			release.fulfill();
			if (pending != null) {
				await Promise.allSettled([pending]);
			}
			manager.dispose();
		}
	});

	for (const global of [false, true]) {
		test(`${global ? 'global' : 'local-only'} deletion retires a cached local primary`, async () => {
			const { manager, options, provider, sessions } = customConnected();
			try {
				const primary = { ...options, connectionId: undefined };
				provider.getSession = async () => ({ ...sessions[0], id: 'shared', cloud: false });
				assert.ok(urlFor(await manager.getAutolinkReferences(primary), 'ALPHA'));
				const internals = manager as unknown as {
					authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
					getIntegrationForRead: (
						id: string,
						connectionId: string | undefined,
						domain: string | undefined,
					) => Promise<{ _session: ProviderAuthenticationSession | null | undefined } | undefined>;
				};
				const integration = await internals.getIntegrationForRead(
					primary.providerId,
					undefined,
					primary.domain,
				);
				assert.equal(integration?._session?.cloud, false);
				const wrapped = await internals.authenticationService.get(options.providerId);
				if (global) {
					await wrapped.deleteAllSessions();
				} else {
					await wrapped.deleteSession({
						domain: 'custom.example.com',
						scopes: [],
						connectionId: 'shared',
						cloud: false,
					});
				}
				assert.equal(integration._session, undefined);
			} finally {
				manager.dispose();
			}
		});
	}

	test('cloud session accepts canonical and API domains on different hosts', async () => {
		const { manager, provider, sessions } = customConnected();
		try {
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
			};
			const wrapped = await internals.authenticationService.get(IssuesCloudHostIntegrationId.Jira);
			provider.getSession = async () => ({
				...sessions[0],
				domain: 'api.atlassian.com',
				baseUrl: 'https://api.atlassian.com/ex/jira/cloud-id',
			});
			const session = await wrapped.getSession({ domain: 'tenant.atlassian.net', scopes: [], cloud: true });
			assert.equal(session?.domain, 'api.atlassian.com');
		} finally {
			manager.dispose();
		}
	});

	test('global deletion retires pending credentials on every host through completion', async () => {
		const { manager, options, provider, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		const entered = [defer<void>(), defer<void>(), defer<void>(), defer<void>()];
		const releaseReads = defer<void>();
		const pending: Promise<unknown>[] = [];
		try {
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
			};
			const wrapped = await internals.authenticationService.get(options.providerId);
			const hostA = { domain: 'custom.example.com', scopes: [], connectionId: 'a', cloud: true };
			const hostB = { ...hostA, domain: 'other.example.com', connectionId: 'b' };
			let read = 0;
			provider.getSession = async descriptor => {
				const index = read++;
				entered[index].fulfill();
				await releaseReads.promise;
				return {
					...sessions[descriptor.connectionId === 'b' ? 1 : 0],
					id: descriptor.connectionId ?? 'primary',
					domain: descriptor.domain,
				};
			};
			const beforeA = wrapped.getSession(hostA);
			const beforeB = wrapped.getSession(hostB);
			void beforeA.catch(() => {});
			void beforeB.catch(() => {});
			pending.push(beforeA, beforeB);
			await Promise.all([entered[0].promise, entered[1].promise]);
			provider.deleteAllSessions = async () => {
				started.fulfill();
				await release.promise;
			};
			const deletion = wrapped.deleteAllSessions();
			await started.promise;
			const duringA = wrapped.getSession(hostA);
			const duringB = wrapped.getSession(hostB);
			void duringA.catch(() => {});
			void duringB.catch(() => {});
			pending.push(duringA, duringB);
			await Promise.all([entered[2].promise, entered[3].promise]);
			release.fulfill();
			await deletion;
			releaseReads.fulfill();
			await assert.rejects(beforeA, isCancellationError);
			await assert.rejects(beforeB, isCancellationError);
			await assert.rejects(duringA, isCancellationError);
			await assert.rejects(duringB, isCancellationError);
		} finally {
			release.fulfill();
			releaseReads.fulfill();
			await Promise.allSettled(pending);
			manager.dispose();
		}
	});

	test('failed deletion forwards its error and still retires a target read begun during the host call', async () => {
		const { manager, options, provider, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
			};
			const wrapped = await internals.authenticationService.get(options.providerId);
			const descriptor = { domain: 'custom.example.com', scopes: [], connectionId: 'a', cloud: true };
			provider.getSession = async () => ({ ...sessions[0], id: 'a' });
			provider.deleteSession = async () => {
				started.fulfill();
				await release.promise;
				throw new Error('delete failed');
			};
			const deletion = wrapped.deleteSession(descriptor);
			await started.promise;
			const during = wrapped.getSession(descriptor);
			release.fulfill();
			await assert.rejects(deletion, /delete failed/);
			await assert.rejects(during, isCancellationError);
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	for (const scopedFirst of [false, true]) {
		test(`custom scoped removal retires cached primary with ${scopedFirst ? 'an observed' : 'a first'} selector`, async () => {
			const { manager, options, state } = customConnected();
			try {
				const primary = { ...options, connectionId: undefined };
				assert.ok(urlFor(await manager.getAutolinkReferences(primary), 'ALPHA'));
				if (scopedFirst) {
					assert.ok(urlFor(await manager.getAutolinkReferences(options), 'ALPHA'));
				}
				state.session = undefined;
				assert.equal(await manager.getAutolinkReferences(options), undefined);
				assert.equal(await manager.getAutolinkReferences(primary), undefined);
			} finally {
				manager.dispose();
			}
		});
	}

	test('an old missing-primary cleanup cannot overwrite a newer scoped credential', async () => {
		const { manager, options, runtime, state, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			const primary = { ...options, connectionId: undefined };
			state.session = undefined;
			assert.equal(await manager.getAutolinkReferences(primary), undefined);
			const remove = runtime.storage.deleteWorkspace;
			let held = false;
			runtime.storage.deleteWorkspace = async key => {
				if (key.startsWith('connected:') && !held) {
					held = true;
					started.fulfill();
					await release.promise;
				}
				return remove(key);
			};
			const old = manager.getAutolinkReferences(primary);
			await started.promise;
			state.session = sessions[1];
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'BETA'));
			release.fulfill();
			assert.equal(await old, undefined);
			assert.ok(urlFor(await manager.getAutolinkReferences(primary), 'BETA'));
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	test('a custom scoped replacement retires the matching cached primary', async () => {
		const { manager, options, state, sessions } = customConnected();
		try {
			const primary = { ...options, connectionId: undefined };
			assert.ok(urlFor(await manager.getAutolinkReferences(primary), 'ALPHA'));
			state.session = sessions[1];
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'BETA'));
			assert.ok(urlFor(await manager.getAutolinkReferences(primary), 'BETA'));
			state.session = { ...sessions[0], id: 'new-primary' };
			assert.ok(urlFor(await manager.getAutolinkReferences({ ...primary, forceSync: true }), 'ALPHA'));
		} finally {
			manager.dispose();
		}
	});

	test('a retired custom primary resolution cannot replace a newer scoped credential with disconnected state', async () => {
		const { manager, options, provider, state, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'ALPHA'));
			const getSession = provider.getSession;
			let held = false;
			provider.getSession = async (...args) => {
				const session = await getSession(...args);
				if (!held) {
					held = true;
					started.fulfill();
					await release.promise;
				}
				return session;
			};
			const primary = { ...options, connectionId: undefined };
			const old = manager.getAutolinkReferences(primary);
			await started.promise;
			state.session = sessions[1];
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'BETA'));
			release.fulfill();
			assert.equal(await old, undefined);
			assert.ok(urlFor(await manager.getAutolinkReferences(primary), 'BETA'));
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	test('custom auth forwarding retires pending resolutions on deletion and disposes its provider once', async () => {
		const { manager, options, provider, state } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'ALPHA'));
			const internals = manager as unknown as {
				authenticationService: { get: (id: string) => Promise<IntegrationAuthenticationProvider> };
			};
			const wrapped = await internals.authenticationService.get(options.providerId);
			assert.equal(wrapped.onDidChange, provider.onDidChange);
			const getSession = provider.getSession;
			provider.getSession = async (...args) => {
				const session = await getSession(...args);
				started.fulfill();
				await release.promise;
				return session;
			};
			const descriptor = { domain: 'custom.example.com', scopes: [], connectionId: 'custom', cloud: true };
			const old = wrapped.getSession(descriptor);
			await started.promise;
			await wrapped.deleteSession(descriptor, { preserveConfigured: false });
			release.fulfill();
			await assert.rejects(old, isCancellationError);
			assert.equal(state.deleted, 1);
			await wrapped.deleteAllSessions(descriptor);
			assert.equal(state.deleted, 2);
			wrapped.dispose();
			wrapped.dispose();
			assert.equal(state.disposed, 1);
			assert.equal(await wrapped.getSession(descriptor), undefined);
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	for (const status of [200, 401]) {
		test(`custom authentication replacement retires an older ${status} discovery without a change signal`, async () => {
			const { manager, options, runtime, state, sessions } = customConnected();
			const started = defer<void>();
			const release = defer<void>();
			try {
				assert.ok(urlFor(await manager.getAutolinkReferences(options), 'ALPHA'));
				const fetchProvider = runtime.http.fetch;
				runtime.http.fetch = async (input, init) => {
					const response = await fetchProvider(input, init);
					if (new Headers(init?.headers).get('authorization') === 'Bearer ALPHA') {
						started.fulfill();
						await release.promise;
						return status === 200 ? response : new Response('{}', { status: status });
					}
					return response;
				};
				const old = manager.getAutolinkReferences(options);
				await started.promise;
				state.session = sessions[1];
				assert.ok(
					urlFor(
						await manager.getAutolinkReferences(
							status === 200 ? { ...options, connectionId: 'alias' } : options,
						),
						'BETA',
					),
				);
				release.fulfill();
				assert.equal(await old, undefined);
				assert.ok(urlFor(await manager.getAutolinkReferences(options), 'BETA'));
				assert.equal(
					state.options.some(o => o?.refreshRejectedToken === true),
					false,
				);
			} finally {
				release.fulfill();
				manager.dispose();
			}
		});
	}

	test("a delayed custom resolution cannot borrow another read's reused session publication", async () => {
		const { manager, options, provider, state, sessions } = customConnected();
		const started = defer<void>();
		const release = defer<void>();
		try {
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'ALPHA'));
			const getSession = provider.getSession;
			let held = false;
			provider.getSession = async (...args) => {
				if (!held) {
					held = true;
					started.fulfill();
					await release.promise;
				}
				return getSession(...args);
			};
			const old = manager.getAutolinkReferences(options);
			await started.promise;
			state.session = sessions[1];
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'BETA'));
			release.fulfill();
			assert.equal(await old, undefined);
		} finally {
			release.fulfill();
			manager.dispose();
		}
	});

	test('an older custom credential resolution cannot retire a newer pending catalog', async () => {
		const { manager, options, provider, runtime, state, sessions } = customConnected();
		const authStarted = defer<void>();
		const releaseAuth = defer<void>();
		const projectsStarted = defer<void>();
		const releaseProjects = defer<void>();
		try {
			assert.ok(urlFor(await manager.getAutolinkReferences(options), 'ALPHA'));
			const getSession = provider.getSession;
			let held = false;
			provider.getSession = async (...args) => {
				const session = await getSession(...args);
				if (!held) {
					held = true;
					authStarted.fulfill();
					await releaseAuth.promise;
				}
				return session;
			};
			const fetchProvider = runtime.http.fetch;
			runtime.http.fetch = async (input, init) => {
				const response = await fetchProvider(input, init);
				if (new Headers(init?.headers).get('authorization') === 'Bearer BETA') {
					projectsStarted.fulfill();
					await releaseProjects.promise;
				}
				return response;
			};
			const old = manager.getAutolinkReferences(options);
			await authStarted.promise;
			state.session = sessions[1];
			const current = manager.getAutolinkReferences(options);
			await projectsStarted.promise;
			releaseAuth.fulfill();
			assert.equal(await old, undefined);
			releaseProjects.fulfill();
			assert.ok(urlFor(await current, 'BETA'));
		} finally {
			releaseAuth.fulfill();
			releaseProjects.fulfill();
			manager.dispose();
		}
	});

	for (const action of ['removed', 'disposed'] as const) {
		test(`custom discovery cannot restore a ${action} credential`, async () => {
			const { manager, options, runtime, state } = customConnected();
			const started = defer<void>();
			const release = defer<void>();
			try {
				assert.ok(urlFor(await manager.getAutolinkReferences(options), 'ALPHA'));
				const fetchProvider = runtime.http.fetch;
				runtime.http.fetch = async (...args) => {
					const response = await fetchProvider(...args);
					started.fulfill();
					await release.promise;
					return response;
				};
				const old = manager.getAutolinkReferences(options);
				await started.promise;
				if (action === 'disposed') {
					manager.dispose();
					manager.dispose();
					assert.equal(state.disposed, 1);
				} else {
					state.session = undefined;
					assert.equal(await manager.getAutolinkReferences(options), undefined);
				}
				release.fulfill();
				assert.equal(await old, undefined);
			} finally {
				release.fulfill();
				manager.dispose();
			}
		});
	}
});
