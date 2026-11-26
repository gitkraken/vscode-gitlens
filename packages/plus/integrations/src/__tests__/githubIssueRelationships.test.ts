import * as assert from 'node:assert/strict';
import { mock } from 'node:test';
import { GitHub } from '@gitkraken/provider-apis';
import type { GitHubIssueRelationshipsResult } from '@gitkraken/provider-apis';
import { suite, teardown, test } from 'mocha';
import { RequestRateLimitError } from '@gitlens/git/errors.js';
import { Emitter } from '@gitlens/utils/event.js';
import { defer } from '@gitlens/utils/promise.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { IntegrationAuthenticationProvider } from '../authentication/integrationAuthenticationProvider.js';
import { createManualTokenAuthProvider } from '../authentication/manualTokenProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { ObservedAuthenticationProvider } from '../authentication/observedAuthenticationProvider.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IssueRelationshipWriteOptions } from '../index.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

const selected = { providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'selected' };
const parent = { owner: 'Org', repo: 'First', number: 4, expectedNodeId: 'I_parent' };
const child = { owner: 'Org', repo: 'Second', number: 4, expectedNodeId: 'I_child' };
const previous = { ...parent, number: 5, expectedNodeId: 'I_old' };
const issue = {
	owner: child.owner,
	repo: child.repo,
	number: child.number,
	nodeId: child.expectedNodeId,
	url: 'https://github.com/Org/Second/issues/4',
	title: 'Child',
	state: 'open' as const,
};
const empty: Extract<GitHubIssueRelationshipsResult, { ok: true }> = {
	ok: true,
	issue: issue,
	parent: null,
	children: [],
	progress: { total: 0, completed: 0, percentCompleted: 0 },
	pageInfo: { hasNextPage: false, endCursor: null },
};

async function setup(host?: IntegrationAuthenticationProvider | (() => Promise<IntegrationAuthenticationProvider>)) {
	const runtime = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(runtime);
	const store = (id: string, token: string, expiresAt?: Date, accountId = id) =>
		configured.storeSession(selected.providerId, {
			id: id,
			accessToken: token,
			expiresAt: expiresAt,
			account: { id: accountId, label: id },
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
		});
	await store('primary', 'other-token');
	await store(selected.connectionId, 'selected-token');
	const manager = createIntegrationManager({
		...runtime,
		hooks: {
			...runtime.hooks,
			createAuthenticationProvider: async () => (typeof host === 'function' ? host() : host),
		},
	});
	return {
		manager: manager,
		store: store,
		runtime: runtime,
		dispose: () => {
			manager.dispose();
			configured.dispose();
		},
	};
}

function customHost() {
	const changes = new Emitter<void>();
	let accessToken = 'selected-token';
	let refreshes = 0;
	const provider: IntegrationAuthenticationProvider = {
		onDidChange: changes.event,
		getSession: async (_descriptor, options) => {
			if (options?.refreshRejectedToken) {
				refreshes++;
				accessToken = 'renewed';
				changes.fire();
			}
			return {
				id: selected.connectionId,
				accessToken: accessToken,
				domain: 'github.com',
				account: { id: 'actor', label: 'actor' },
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
			};
		},
		deleteSession: async () => {},
		deleteAllSessions: async () => {},
		dispose: () => changes.dispose(),
	};
	return {
		provider: provider,
		getRefreshes: () => refreshes,
		change: (token: string) => {
			accessToken = token;
			changes.fire();
		},
	};
}

suite('IntegrationManager GitHub issue relationships', () => {
	teardown(() => mock.restoreAll());

	for (const token of ['selected-token', 'new-token']) {
		test(`logout retires warm and selected credentials before a held list finishes; the next account can publish ${token === 'selected-token' ? 'the same' : 'a new'} token`, async () => {
			const ctx = await setup();
			const beforeList = defer<void>();
			const finishList = defer<void>();
			const deleting = defer<void>();
			const finishDelete = defer<void>();
			try {
				let account: { id: string } | undefined = { id: 'first' };
				ctx.runtime.account.getAccount = async () => account;
				const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
				const get = { ...selected, issue: child };
				const github = await ctx.manager.get(selected.providerId);
				assert.equal((await github.getCredential('integrations'))?.accessToken, 'other-token');
				let isCurrent: (() => boolean) | undefined;
				const initial = await ctx.manager.getIssueRelationships(get, undefined, guard => {
					isCurrent = guard;
				});
				assert.ok(initial.ok && isCurrent?.());
				ctx.runtime.account.fetchGkApi = async path => {
					assert.equal(path, 'v1/provider-tokens');
					beforeList.fulfill();
					await finishList.promise;
					return Response.json({ data: [] });
				};
				ctx.runtime.fireSubscriptionCheckIn(true);
				await beforeList.promise;
				const remove = ctx.runtime.storage.deleteSecret;
				ctx.runtime.storage.deleteSecret = async key => {
					if (key === 'integration.auth.cloud:github|selected') {
						deleting.fulfill();
						await finishDelete.promise;
					}
					await remove(key);
				};
				account = undefined;
				ctx.runtime.fireSubscriptionChange();
				await deleting.promise;
				assert.equal(isCurrent?.(), false);
				const freshDuringLogout = ctx.manager.getIssueRelationships(get);
				finishDelete.fulfill();
				assert.deepEqual(await freshDuringLogout, { ok: false, reason: 'no-connection' });
				assert.equal(await github.getCredential('integrations'), undefined);
				assert.equal(sdk.mock.callCount(), 1);
				account = { id: 'second' };
				ctx.runtime.fireSubscriptionChange();
				await ctx.store(selected.connectionId, token);
				const current = await ctx.manager.getIssueRelationships(get);
				assert.ok(current.ok);
				assert.notEqual(current.connectionProof, initial.connectionProof);
				assert.deepEqual(
					await ctx.manager.getIssueRelationships({
						...get,
						expectedConnectionProof: initial.connectionProof,
					}),
					{ ok: false, reason: 'no-connection' },
				);
				ctx.runtime.account.fetchGkApi = async path => {
					if (path === 'v1/provider-tokens') {
						return Response.json({
							data: [
								{
									tokenId: selected.connectionId,
									provider: 'github',
									type: 'oauth',
									domain: 'github.com',
									accountName: 'second',
								},
							],
						});
					}
					return Response.json({
						data: {
							tokenId: selected.connectionId,
							accessToken: token,
							scopes: 'repo',
							type: 'oauth',
							expiresIn: 3600,
						},
					});
				};
				await ctx.manager.refreshConnections();
				finishList.fulfill();
				await new Promise(resolve => setImmediate(resolve));
				assert.ok((await ctx.manager.getIssueRelationships(get)).ok);
				const events = ctx.runtime.emittedEvents.filter(
					e => e.event === 'integration.connection.count.changed',
				);
				assert.deepEqual(events.at(-1)?.props?.integrationIds, [selected.providerId]);
				assert.equal(sdk.mock.calls.at(-1)?.arguments[1]?.token, token);
			} finally {
				finishDelete.fulfill();
				finishList.fulfill();
				ctx.dispose();
			}
		});
	}

	test('a warm host-managed cloud connection cannot rehydrate its former desktop account after logout', async () => {
		const host = customHost();
		const ctx = await setup(host.provider);
		try {
			const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const get = { ...selected, issue: child };
			const first = await ctx.manager.getIssueRelationships(get);
			assert.ok(first.ok);
			const github = await ctx.manager.get(selected.providerId);
			assert.equal((await github.getCredential('integrations'))?.accessToken, 'selected-token');
			const removed = defer<void>();
			const connection = ctx.runtime.hooks?.connection;
			assert.ok(connection);
			connection.onConnectedChanged = () => removed.fulfill();
			ctx.runtime.account.getAccount = async () => undefined;
			ctx.runtime.fireSubscriptionChange();
			await removed.promise;
			assert.equal(await github.getCredential('integrations'), undefined);
			ctx.runtime.account.getAccount = async () => ({ id: 'second' });
			await ctx.store(selected.connectionId, 'second-account-token');
			assert.equal(await github.getCredential('integrations'), undefined);
			assert.deepEqual(await ctx.manager.getIssueRelationships(get), { ok: false, reason: 'no-connection' });
			assert.equal(sdk.mock.callCount(), 1);
			host.change('second-account-token');
			assert.equal(await github.getCredential('integrations'), undefined);
			await ctx.store(selected.connectionId, 'second-account-token', undefined, 'actor');
			assert.equal((await github.getCredential('integrations'))?.accessToken, 'second-account-token');
			const second = await ctx.manager.getIssueRelationships(get);
			assert.ok(second.ok);
			assert.notEqual(first.connectionProof, second.connectionProof);
		} finally {
			ctx.dispose();
		}
	});

	for (const warm of [false, true]) {
		test(`a ${warm ? 'warm' : 'cold'} standalone manual primary keeps its credential across desktop logout`, async () => {
			const provider = createManualTokenAuthProvider({
				id: selected.providerId,
				domain: 'github.com',
				token: 'standalone',
				account: { id: 'manual', label: 'manual' },
			});
			const ctx = await setup(provider);
			try {
				const github = await ctx.manager.get(selected.providerId);
				if (warm) {
					assert.equal((await github.getCredential('integrations'))?.accessToken, 'standalone');
				}
				const removed = defer<void>();
				const connection = ctx.runtime.hooks?.connection;
				assert.ok(connection);
				connection.onConnectedChanged = () => removed.fulfill();
				ctx.runtime.account.getAccount = async () => undefined;
				ctx.runtime.fireSubscriptionChange();
				await removed.promise;
				assert.equal((await github.getCredential('integrations'))?.accessToken, 'standalone');
				assert.deepEqual(await ctx.manager.getIssueRelationships({ ...selected, issue: child }), {
					ok: false,
					reason: 'no-connection',
				});
			} finally {
				ctx.dispose();
			}
		});
	}

	test('concurrent cold reads share an integration and usable relationship proof', async () => {
		const ctx = await setup();
		try {
			mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const input = { ...selected, issue: child };
			const results = await Promise.all([
				ctx.manager.getIssueRelationships(input),
				ctx.manager.getIssueRelationships(input),
			]);
			for (const result of results) {
				assert.ok(result.ok);
				assert.deepEqual(
					await ctx.manager.getIssueRelationships({
						...input,
						expectedConnectionProof: result.connectionProof,
					}),
					result,
				);
			}
		} finally {
			ctx.dispose();
		}
	});

	test('an alias shortens the actual host credential deadline and retiring an account is permanent', async () => {
		const host = customHost();
		const observer = new ObservedAuthenticationProvider(host.provider, false, () => {});
		const exact = { connectionId: selected.connectionId, cloud: true, domain: 'github.com', scopes: ['repo'] };
		const alias = { ...exact, connectionId: undefined };
		const source = await host.provider.getSession(exact);
		assert.ok(source);
		let next = source;
		host.provider.getSession = async () => next;
		try {
			const capture = observer.captureRelationshipSession(exact);
			const session = await observer.getSession(exact);
			assert.ok(session);
			const guard = capture(session);
			assert.ok(guard.isCurrent());
			next = { ...source, expiresAt: new Date(0) };
			await observer.getSession(alias);
			assert.equal(guard.isCurrent(), false);
			next = { ...source, account: { id: 'another', label: 'another' } };
			await observer.getSession(alias);
			next = source;
			await observer.getSession(alias);
			assert.equal(guard.isCurrent(), false);
		} finally {
			observer.dispose();
		}
	});

	test('an older host lookup that returns a different account cannot acquire relationship proof', async () => {
		const host = customHost();
		const observer = new ObservedAuthenticationProvider(host.provider, false, () => {});
		const exact = { connectionId: selected.connectionId, cloud: true, domain: 'github.com', scopes: ['repo'] };
		try {
			const session = await observer.getSession(exact);
			assert.ok(session);
			const capture = observer.captureRelationshipSession(exact);
			const delayed = defer<ProviderAuthenticationSession>();
			host.provider.getSession = () => delayed.promise;
			const earlier = observer.getSession(exact);
			host.provider.getSession = async () => session;
			const newer = await observer.getSession(exact);
			assert.ok(newer);
			delayed.fulfill({ ...session, account: { id: 'another', label: 'another' } });
			const older = await earlier;
			assert.ok(older);
			assert.equal(capture(older).isCurrent(), false);
			assert.ok(capture(newer).isCurrent());
		} finally {
			observer.dispose();
		}
	});

	test('an older host verifier cannot extend the deadline after a newer verifier settles', async () => {
		const host = customHost();
		const observer = new ObservedAuthenticationProvider(host.provider, false, () => {});
		const exact = { connectionId: selected.connectionId, cloud: true, domain: 'github.com', scopes: ['repo'] };
		try {
			const capture = observer.captureRelationshipSession(exact);
			const session = await observer.getSession(exact);
			assert.ok(session);
			const guard = capture(session);
			const delayed = defer<ProviderAuthenticationSession>();
			host.provider.getSession = () => delayed.promise;
			const first = guard.verify();
			host.provider.getSession = async () => ({ ...session, expiresAt: new Date(0) });
			assert.equal(await guard.verify(), false);
			delayed.fulfill(session);
			assert.equal(await first, false);
			assert.equal(guard.isCurrent(), false);
		} finally {
			observer.dispose();
		}
	});

	test('removing and re-adding the selected connection retires a pending page and its host proof', async () => {
		const ctx = await setup(customHost().provider);
		const input = { ...selected, issue: child };
		try {
			ctx.runtime.account.fetchGkApi = async () => new Response(null, { status: 204 });
			const entered = defer<void>();
			const release = defer<void>();
			const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const initial = await ctx.manager.getIssueRelationships(input);
			assert.ok(initial.ok);
			const pinned = { ...input, expectedConnectionProof: initial.connectionProof };
			await ctx.manager.deleteConnection(selected.providerId, 'primary');
			assert.ok((await ctx.manager.getIssueRelationships(pinned)).ok);
			sdk.mock.mockImplementation(async () => {
				entered.fulfill();
				await release.promise;
				return empty;
			});
			const pending = ctx.manager.getIssueRelationships(pinned);
			await entered.promise;
			await ctx.manager.deleteConnection(selected.providerId, selected.connectionId);
			await ctx.store(selected.connectionId, 'selected-token');
			release.fulfill();
			assert.deepEqual(await pending, { ok: false, reason: 'no-connection' });
			assert.deepEqual(await ctx.manager.getIssueRelationships(pinned), { ok: false, reason: 'no-connection' });
			const next = await ctx.manager.getIssueRelationships(input);
			assert.ok(next.ok);
			assert.notEqual(next.connectionProof, initial.connectionProof);
		} finally {
			ctx.dispose();
		}
	});

	test('disposes a host provider whose factory resolves after manager retirement', async () => {
		const host = customHost();
		const create = defer<void>();
		const release = defer<void>();
		const dispose = mock.method(host.provider, 'dispose');
		const getSession = mock.method(host.provider, 'getSession');
		const ctx = await setup(async () => {
			create.fulfill();
			await release.promise;
			return host.provider;
		});
		const capture = mock.fn();
		const pending = ctx.manager.getIssueRelationships({ ...selected, issue: child }, undefined, capture);
		await create.promise;
		ctx.dispose();
		release.fulfill();
		assert.deepEqual(await pending, { ok: false, reason: 'no-connection' });
		assert.equal(dispose.mock.callCount(), 1);
		assert.equal(getSession.mock.callCount(), 0);
		assert.equal(capture.mock.callCount(), 0);
	});

	test('recaptures once when the custom host refreshes during the initial unpinned lookup', async () => {
		const host = customHost();
		const getSession = host.provider.getSession;
		let firstLookup = true;
		host.provider.getSession = async (...args) => {
			const session = await getSession(...args);
			if (firstLookup) {
				firstLookup = false;
				host.change('renewed-token');
			}
			return session;
		};
		const ctx = await setup(host.provider);
		try {
			const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const result = await ctx.manager.getIssueRelationships({ ...selected, issue: child });
			assert.ok(result.ok);
			assert.equal(sdk.mock.calls[0].arguments[1]?.token, 'renewed-token');
			assert.equal(sdk.mock.callCount(), 1);
		} finally {
			ctx.dispose();
		}
	});

	test('a pinned credential gets no second lookup and a continually changing host gets one unpinned retry', async () => {
		const host = customHost();
		const ctx = await setup(host.provider);
		try {
			const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const write = mock.method(GitHub.prototype, 'writeIssueRelationship');
			const input = { ...selected, issue: child };
			const initial = await ctx.manager.getIssueRelationships(input);
			assert.ok(initial.ok);
			const getSession = host.provider.getSession;
			const changing = mock.method(
				host.provider,
				'getSession',
				async (...args: Parameters<typeof getSession>) => {
					host.change('selected-token');
					return getSession(...args);
				},
			);
			const denied = await ctx.manager.writeIssueRelationship({
				...selected,
				parent: parent,
				child: child,
				action: 'add',
				replaceParent: previous,
				expectedConnectionProof: initial.connectionProof,
			});
			assert.deepEqual(denied, {
				ok: false,
				reason: 'no-connection',
				outcome: 'not-sent',
				mutationDispatched: false,
			});
			assert.equal(changing.mock.callCount(), 1);
			assert.equal(write.mock.callCount(), 0);
			assert.deepEqual(await ctx.manager.getIssueRelationships(input), { ok: false, reason: 'no-connection' });
			assert.equal(changing.mock.callCount(), 3);
			assert.equal(sdk.mock.callCount(), 1);
		} finally {
			ctx.dispose();
		}
	});

	test('reads one page with the selected credential and preserves the SDK result and opaque proof', async () => {
		const ctx = await setup();
		try {
			const variables: unknown[] = [];
			ctx.runtime.http.fetch = async (url, init) => {
				assert.equal(String(url), 'https://api.github.com/graphql');
				assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer selected-token');
				assert.ok(typeof init?.body === 'string');
				variables.push((JSON.parse(init.body) as { variables: unknown }).variables);
				return Response.json({
					data: {
						repository: {
							issue: {
								id: issue.nodeId,
								number: issue.number,
								url: issue.url,
								title: issue.title,
								state: 'OPEN',
								repository: { owner: { login: issue.owner }, name: issue.repo },
								parent: null,
								subIssues: { totalCount: 0, nodes: [], pageInfo: empty.pageInfo },
								subIssuesSummary: empty.progress,
							},
						},
					},
				});
			};
			const options = { ...selected, issue: child, cursor: 'page-2', limit: 1 };
			const result = await ctx.manager.getIssueRelationships(options);
			assert.ok(result.ok);
			assert.ok(result.connectionProof);
			assert.deepEqual(result, { ...empty, connectionProof: result.connectionProof });
			assert.deepEqual(variables, [
				{ owner: child.owner, repo: child.repo, number: child.number, limit: 1, cursor: 'page-2' },
			]);
			assert.deepEqual(
				await ctx.manager.getIssueRelationships({
					...options,
					expectedConnectionProof: result.connectionProof,
				}),
				result,
			);
		} finally {
			ctx.dispose();
		}
	});

	test('preserves not found, denied, rate-limited and failed reads through the SDK transport', async () => {
		const ctx = await setup();
		try {
			for (const [status, reason] of [
				[404, 'not-found'],
				[403, 'forbidden'],
				[429, 'rate-limit'],
				[500, 'unknown'],
			] as const) {
				ctx.runtime.http.fetch = async () => Response.json({ message: 'upstream' }, { status: status });
				assert.deepEqual(await ctx.manager.getIssueRelationships({ ...selected, issue: child }), {
					ok: false,
					reason: reason,
				});
			}
		} finally {
			ctx.dispose();
		}
	});

	test('refuses an enterprise installation, absent selection and a different viewer before SDK dispatch', async () => {
		const ctx = await setup();
		try {
			const write = mock.method(GitHub.prototype, 'writeIssueRelationship');
			const options = { ...selected, parent: parent, child: child, action: 'remove' as const };
			const providers = [
				{ scope: { providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise }, reason: 'unsupported' },
				{ scope: { connectionId: '' }, reason: 'invalid-input' },
				{ scope: { connectionId: 'gone' }, reason: 'no-connection' },
				{ scope: { expectedLogin: 'different' }, reason: 'no-connection' },
			];
			ctx.runtime.http.fetch = async (_url, init) => {
				assert.equal(new Headers(init?.headers).get('authorization'), 'token selected-token');
				return Response.json({ data: { viewer: { login: 'selected' } } });
			};
			for (const { scope, reason } of providers) {
				assert.deepEqual(await ctx.manager.writeIssueRelationship({ ...options, ...scope }), {
					ok: false,
					reason: reason,
					mutationDispatched: false,
					outcome: 'not-sent',
				});
			}

			assert.equal(write.mock.callCount(), 0);
		} finally {
			ctx.dispose();
		}
	});

	test('replacement requires the original credential even if the same token returns', async () => {
		const ctx = await setup();
		try {
			const read = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const write = mock.method(GitHub.prototype, 'writeIssueRelationship');
			const result = await ctx.manager.getIssueRelationships({ ...selected, issue: child });
			assert.ok(result.ok);
			const options = {
				...selected,
				action: 'add' as const,
				parent: parent,
				child: child,
				replaceParent: previous,
			};
			assert.deepEqual(await ctx.manager.writeIssueRelationship(options as IssueRelationshipWriteOptions), {
				ok: false,
				reason: 'invalid-input',
				mutationDispatched: false,
				outcome: 'not-sent',
			});
			assert.deepEqual(
				await ctx.manager.writeIssueRelationship({
					...options,
					connectionId: 'primary',
					expectedConnectionProof: result.connectionProof,
				}),
				{ ok: false, reason: 'no-connection', mutationDispatched: false, outcome: 'not-sent' },
			);
			await ctx.store(selected.connectionId, 'rotated-token');
			await ctx.store(selected.connectionId, 'selected-token');
			const scope = read.mock.calls[0].arguments[1];
			assert.ok(scope);
			assert.equal(await scope.isSessionCurrent?.(), false);
			assert.deepEqual(
				await ctx.manager.writeIssueRelationship({
					...options,
					expectedConnectionProof: result.connectionProof,
				}),
				{ ok: false, reason: 'no-connection', mutationDispatched: false, outcome: 'not-sent' },
			);
			assert.equal(write.mock.callCount(), 0);
		} finally {
			ctx.dispose();
		}
	});

	test('passes attach, detach and anchored reorder to the SDK with the verified viewer credential', async () => {
		const ctx = await setup();
		try {
			const targets = { ...selected, parent: parent, child: child };
			const operations: IssueRelationshipWriteOptions[] = [
				{ ...targets, action: 'add' },
				{ ...targets, action: 'remove' },
				{ ...targets, action: 'reorder', placement: { after: previous } },
			];
			const parentIssue = {
				...issue,
				nodeId: parent.expectedNodeId,
				repo: parent.repo,
				url: 'https://github.com/Org/First/issues/4',
			};
			const success = { ok: true as const, parent: parentIssue, child: issue, previousParent: null };
			const write = mock.method(GitHub.prototype, 'writeIssueRelationship', async () => success);
			let viewerReads = 0;
			ctx.runtime.http.fetch = async (_url, init) => {
				assert.equal(new Headers(init?.headers).get('authorization'), 'token selected-token');
				viewerReads++;
				return Response.json({ data: { viewer: { login: 'Selected' } } });
			};
			for (const operation of operations) {
				const result = await ctx.manager.writeIssueRelationship({
					...operation,
					expectedLogin: 'selected',
				});
				assert.deepEqual(result, success);
				const call = write.mock.calls.at(-1);
				assert.ok(call);
				const [input, credentials] = call.arguments;
				assert.ok(credentials);
				assert.equal(credentials.token, 'selected-token');
				assert.partialDeepStrictEqual(input, operation);
			}

			assert.equal(viewerReads, operations.length);
		} finally {
			ctx.dispose();
		}
	});

	test('keeps a host proof across the first primary lookup and retires it when the host credential changes and returns', async () => {
		const host = customHost();
		const ctx = await setup(host.provider);
		try {
			mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const read = { ...selected, issue: child };
			const initial = await ctx.manager.getIssueRelationships(read);
			assert.ok(initial.ok);
			assert.ok(await (await ctx.manager.get(selected.providerId)).isConnected());
			const pinned = { ...read, expectedConnectionProof: initial.connectionProof };
			assert.deepEqual(await ctx.manager.getIssueRelationships(pinned), initial);
			host.change('another-token');
			host.change('selected-token');
			assert.deepEqual(await ctx.manager.getIssueRelationships(pinned), { ok: false, reason: 'no-connection' });
		} finally {
			ctx.dispose();
		}
	});

	test('retiring and restoring the account behind the same stored token retires approval', async () => {
		const ctx = await setup();
		try {
			mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const read = await ctx.manager.getIssueRelationships({ ...selected, issue: child });
			assert.ok(read.ok);
			await ctx.store(selected.connectionId, 'selected-token', undefined, 'different-account');
			await ctx.store(selected.connectionId, 'selected-token');
			assert.deepEqual(
				await ctx.manager.getIssueRelationships({
					...selected,
					issue: child,
					expectedConnectionProof: read.connectionProof,
				}),
				{ ok: false, reason: 'no-connection' },
			);
		} finally {
			ctx.dispose();
		}
	});

	test('withholds a completed read when the latest stored expiry passes', async () => {
		const ctx = await setup();
		try {
			mock.method(GitHub.prototype, 'getIssueRelationships', async () => {
				await ctx.store(selected.connectionId, 'selected-token', new Date(0));
				return empty;
			});
			assert.deepEqual(await ctx.manager.getIssueRelationships({ ...selected, issue: child }), {
				ok: false,
				reason: 'no-connection',
			});
		} finally {
			ctx.dispose();
		}
	});

	for (const limited of [false, true]) {
		test(`classifies a 403 viewer preflight ${limited ? 'with' : 'without'} Retry-After before sending a mutation`, async () => {
			const ctx = await setup();
			try {
				const requests: string[] = [];
				ctx.runtime.http.fetch = async (_url, init) => {
					assert.ok(typeof init?.body === 'string');
					requests.push(init.body);
					return Response.json(
						{ message: 'upstream' },
						{ status: 403, headers: limited ? { 'Retry-After': '10' } : {} },
					);
				};
				assert.deepEqual(
					await ctx.manager.writeIssueRelationship({
						...selected,
						expectedLogin: 'actor',
						action: 'add',
						parent: parent,
						child: child,
					}),
					{
						ok: false,
						reason: limited ? 'rate-limit' : 'forbidden',
						mutationDispatched: false,
						outcome: 'not-sent',
					},
				);
				assert.equal(requests.length, 1);
				assert.match(requests[0], /WriteViewer/);
			} finally {
				ctx.dispose();
			}
		});
	}

	const mutationFailures = [
		...([401, 429] as const).flatMap(status =>
			(['failed stream', 'text/plain', 'no content type', 'opaque text'] as const).map(body => ({
				status: status,
				body: body,
				throttled: status === 429,
			})),
		),
		...(['malformed JSON', 'failed stream', 'unsupported media type'] as const).flatMap(body =>
			[false, true].map(throttled => ({ status: 403, body: body, throttled: throttled })),
		),
	];
	for (const { status, body, throttled } of mutationFailures) {
		test(`HTTP ${status} with ${body} leaves the removal unconfirmed (${throttled ? 'throttled' : 'unthrottled'})`, async () => {
			const host = customHost();
			const ctx = await setup(host.provider);
			const queries: string[] = [];
			const node = (pin: typeof parent) => ({
				id: pin.expectedNodeId,
				number: pin.number,
				title: pin.repo,
				state: 'OPEN',
				url: `https://github.com/${pin.owner}/${pin.repo}/issues/${pin.number}`,
				repository: {
					owner: { login: pin.owner },
					name: pin.repo,
					isArchived: false,
					viewerPermission: 'WRITE',
				},
			});
			try {
				ctx.runtime.http.fetch = async (_url, init) => {
					assert.ok(typeof init?.body === 'string');
					const { query } = JSON.parse(init.body) as { query: string };
					queries.push(query);
					if (query.includes('PreflightIssueRelationship')) {
						return Response.json({
							data: {
								target: { issue: node(parent) },
								child: { issue: { ...node(child), parent: { id: parent.expectedNodeId } } },
							},
						});
					}

					assert.match(query, /removeSubIssue/);
					const headers = new Headers();
					if (status === 403 && throttled) {
						headers.set('retry-after', '10');
					}
					if (body === 'failed stream') {
						headers.set('content-type', 'application/json');
						return new Response(
							new ReadableStream({ start: controller => controller.error(new Error('closed')) }),
							{ status: status, headers: headers },
						);
					}
					if (body === 'malformed JSON' || body === 'unsupported media type') {
						headers.set(
							'content-type',
							body === 'malformed JSON' ? 'application/json' : 'application/custom',
						);
						return new Response('{bad', { status: status, headers: headers });
					}

					if (body === 'opaque text') {
						return new Response('proxy failure', { status: status });
					}

					if (body === 'text/plain') {
						headers.set('content-type', 'text/plain');
					}
					const envelope = { data: { removeSubIssue: null }, errors: [{ message: 'interrupted' }] };
					return new Response(new TextEncoder().encode(JSON.stringify(envelope)), {
						status: status,
						headers: headers,
					});
				};
				assert.deepEqual(
					await ctx.manager.writeIssueRelationship({
						...selected,
						action: 'remove',
						parent: parent,
						child: child,
					}),
					{
						ok: false,
						reason: status === 401 ? 'no-connection' : throttled ? 'rate-limit' : 'forbidden',
						outcome: 'unconfirmed',
					},
				);
				assert.equal(host.getRefreshes(), 0);
				const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
				assert.ok((await ctx.manager.getIssueRelationships({ ...selected, issue: child })).ok);
				assert.equal(host.getRefreshes(), status === 401 ? 1 : 0);
				assert.equal(sdk.mock.calls[0].arguments[1]?.token, status === 401 ? 'renewed' : 'selected-token');
				assert.equal(queries.length, 2);
			} finally {
				ctx.dispose();
			}
		});
	}

	for (const source of ['viewer', 'SDK', 'malformed JSON', 'unsupported media type', 'failed stream']) {
		for (const status of [401, 403]) {
			test(`recovers only an exact 401 from the ${source} (HTTP ${status})`, async () => {
				const host = customHost();
				const ctx = await setup(host.provider);
				try {
					const read = { ...selected, issue: child, ...(source === 'viewer' && { expectedLogin: 'actor' }) };
					let requests = 0;
					ctx.runtime.http.fetch = async () => {
						requests++;
						if (source === 'malformed JSON') {
							return new Response('{bad', {
								status: status,
								headers: { 'content-type': 'application/json' },
							});
						}
						if (source === 'unsupported media type') {
							return new Response('bytes', {
								status: status,
								headers: { 'content-type': 'application/custom' },
							});
						}
						if (source === 'failed stream') {
							const stream = new ReadableStream({
								start: function (controller) {
									controller.error(new Error('stream closed'));
								},
							});
							return new Response(stream, {
								status: status,
								headers: { 'content-type': 'application/json' },
							});
						}
						return Response.json({ message: 'refused' }, { status: status });
					};
					const result = await ctx.manager.getIssueRelationships(read);
					assert.ok(!result.ok);
					assert.equal(result.reason, status === 401 ? 'no-connection' : 'forbidden');
					assert.equal(requests, 1);
					assert.equal(host.getRefreshes(), 0);
					const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
					const next = await ctx.manager.getIssueRelationships({ ...selected, issue: child });
					assert.ok(next.ok);
					assert.equal(host.getRefreshes(), status === 401 ? 1 : 0);
					assert.equal(sdk.mock.calls[0].arguments[1]?.token, status === 401 ? 'renewed' : 'selected-token');
				} finally {
					ctx.dispose();
				}
			});
		}
	}

	for (const status of [401, 403]) {
		test(`a final host lookup error preserves SDK HTTP ${status} without refreshing the credential`, async () => {
			const host = customHost();
			const ctx = await setup(host.provider);
			const lookup = host.provider.getSession;
			const read = { ...selected, issue: child };
			try {
				ctx.runtime.http.fetch = async () => {
					host.provider.getSession = () => {
						throw new RequestRateLimitError(new Error('limited'), undefined, undefined);
					};
					return Response.json({ message: 'refused' }, { status: status });
				};
				assert.deepEqual(await ctx.manager.getIssueRelationships(read), {
					ok: false,
					reason: status === 401 ? 'no-connection' : 'forbidden',
				});

				host.provider.getSession = lookup;
				mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
				assert.ok((await ctx.manager.getIssueRelationships(read)).ok);
				assert.equal(host.getRefreshes(), 0);
			} finally {
				ctx.dispose();
			}
		});
	}

	test('a final host verification outage withholds a page and preserves known provider failures', async () => {
		const host = customHost();
		const ctx = await setup(host.provider);
		const outage = () => {
			throw new RequestRateLimitError(new Error('limited'), undefined, undefined);
		};
		const lookup = host.provider.getSession;
		try {
			const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => {
				host.provider.getSession = outage;
				return empty;
			});
			const read = { ...selected, issue: child };
			assert.deepEqual(await ctx.manager.getIssueRelationships(read), { ok: false, reason: 'rate-limit' });
			host.provider.getSession = lookup;
			sdk.mock.mockImplementation(async () => {
				host.provider.getSession = outage;
				return { ok: false, reason: 'forbidden' } as const;
			});
			assert.deepEqual(await ctx.manager.getIssueRelationships(read), { ok: false, reason: 'forbidden' });
			host.provider.getSession = lookup;
			const partial = {
				ok: false,
				reason: 'conflict',
				phase: 'attach',
				outcome: 'unconfirmed',
				detached: true,
			} as const;
			mock.method(GitHub.prototype, 'writeIssueRelationship', async () => {
				host.provider.getSession = outage;
				return partial;
			});
			assert.deepEqual(
				await ctx.manager.writeIssueRelationship({
					...selected,
					action: 'remove',
					parent: parent,
					child: child,
				}),
				partial,
			);
		} finally {
			ctx.dispose();
		}
	});

	for (const ended of ['forbidden', 'throw', '401']) {
		test(`settles a late ${ended} under the original credential`, async () => {
			const host = customHost();
			const ctx = await setup(host.provider);
			try {
				ctx.runtime.http.fetch = async () => {
					host.change('another-token');
					host.change('selected-token');
					return Response.json({}, { status: ended === '401' ? 401 : 403 });
				};
				if (ended === 'throw') {
					mock.method(GitHub.prototype, 'getIssueRelationships', async () => {
						host.change('selected-token');
						throw new Error('late failure');
					});
				}
				assert.deepEqual(await ctx.manager.getIssueRelationships({ ...selected, issue: child }), {
					ok: false,
					reason: 'no-connection',
				});
				mock.restoreAll();
				mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
				assert.ok((await ctx.manager.getIssueRelationships({ ...selected, issue: child })).ok);
				assert.equal(host.getRefreshes(), 0);
			} finally {
				ctx.dispose();
			}
		});
	}

	for (const source of ['stored credential', 'expiry', 'host credential']) {
		test(`captures the ${source} for publication after an unpinned write`, async () => {
			const host = source === 'host credential' ? customHost() : undefined;
			const ctx = await setup(host?.provider);
			try {
				mock.method(GitHub.prototype, 'writeIssueRelationship', async () => ({
					ok: true as const,
					parent: issue,
					child: issue,
					previousParent: null,
				}));
				let isCurrent: (() => boolean) | undefined;
				const result = await ctx.manager.writeIssueRelationship(
					{ ...selected, action: 'remove', parent: parent, child: child },
					undefined,
					guard => {
						isCurrent = guard;
					},
				);
				assert.ok(result.ok);
				assert.ok(isCurrent?.());
				if (host != null) {
					host.change('changed');
					host.change('selected-token');
				} else if (source === 'expiry') {
					await ctx.store(selected.connectionId, 'selected-token', new Date(0));
				} else {
					await ctx.store(selected.connectionId, 'changed');
					await ctx.store(selected.connectionId, 'selected-token');
				}
				assert.equal(isCurrent?.(), false);
			} finally {
				ctx.dispose();
			}
		});
	}

	test('captures a shortened expiry published between selected-session lookup and binding', async () => {
		const ctx = await setup();
		try {
			const expiresAt = new Date(Date.now() + 600_000);
			const lookup = ConfiguredIntegrationService.prototype.getStoredSession;
			mock.method(
				ConfiguredIntegrationService.prototype,
				'getStoredSession',
				async function (this: ConfiguredIntegrationService, ...args: Parameters<typeof lookup>) {
					const session = await lookup.call(this, ...args);
					if (session?.id === selected.connectionId) {
						await ctx.store(selected.connectionId, 'selected-token', expiresAt);
					}
					return session;
				},
			);
			mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			let isCurrent: (() => boolean) | undefined;
			const read = await ctx.manager.getIssueRelationships({ ...selected, issue: child }, undefined, guard => {
				isCurrent = guard;
			});
			assert.ok(read.ok);
			assert.ok(isCurrent?.());
			mock.method(Date, 'now', () => expiresAt.getTime());
			assert.equal(isCurrent?.(), false);
		} finally {
			ctx.dispose();
		}
	});

	test('checks the original host selection after viewer lookup before reading issues', async () => {
		const ctx = await setup();
		try {
			let current = true;
			ctx.runtime.http.fetch = async () => {
				current = false;
				return Response.json({ data: { viewer: { login: 'selected' } } });
			};
			const sdk = mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const result = await ctx.manager.getIssueRelationships(
				{ ...selected, issue: child, expectedLogin: 'selected' },
				() => current,
			);
			assert.deepEqual(result, { ok: false, reason: 'no-connection' });
			assert.equal(sdk.mock.callCount(), 0);
		} finally {
			ctx.dispose();
		}
	});

	test('captures read currency through manager disposal', async () => {
		const ctx = await setup();
		let isCurrent: (() => boolean) | undefined;
		try {
			mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const result = await ctx.manager.getIssueRelationships({ ...selected, issue: child }, undefined, guard => {
				isCurrent = guard;
			});
			assert.ok(result.ok);
			assert.ok(isCurrent?.());
		} finally {
			ctx.dispose();
		}
		assert.equal(isCurrent?.(), false);
	});

	test('preserves a rejected attach after detach and schedules token recovery for the next operation', async () => {
		const host = customHost();
		const ctx = await setup(host.provider);
		try {
			mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const read = await ctx.manager.getIssueRelationships({ ...selected, issue: child });
			assert.ok(read.ok);
			const sdk = mock.method(
				GitHub.prototype,
				'writeIssueRelationship',
				async (...[, options]: Parameters<GitHub['writeIssueRelationship']>) => {
					options?.onUnauthorized?.();
					return {
						ok: false as const,
						reason: 'forbidden' as const,
						phase: 'attach' as const,
						outcome: 'rejected' as const,
						detached: true as const,
					};
				},
			);
			const result = await ctx.manager.writeIssueRelationship({
				...selected,
				action: 'add',
				parent: parent,
				child: child,
				replaceParent: previous,
				expectedConnectionProof: read.connectionProof,
			});
			assert.deepEqual(result, {
				ok: false,
				reason: 'no-connection',
				phase: 'attach',
				outcome: 'rejected',
				detached: true,
			});
			assert.equal(sdk.mock.callCount(), 1);
			assert.equal(host.getRefreshes(), 0);
			assert.ok((await ctx.manager.getIssueRelationships({ ...selected, issue: child })).ok);
			assert.equal(host.getRefreshes(), 1);
		} finally {
			ctx.dispose();
		}
	});

	test('withholds receipts after replacement succeeds on a retired credential and retains detach evidence', async () => {
		const ctx = await setup();
		try {
			mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
			const read = await ctx.manager.getIssueRelationships({ ...selected, issue: child });
			assert.ok(read.ok);
			mock.method(GitHub.prototype, 'writeIssueRelationship', async () => {
				await ctx.store(selected.connectionId, 'different-token');
				return { ok: true as const, parent: issue, child: issue, previousParent: issue };
			});
			assert.deepEqual(
				await ctx.manager.writeIssueRelationship({
					...selected,
					action: 'add',
					parent: parent,
					child: child,
					replaceParent: previous,
					expectedConnectionProof: read.connectionProof,
				}),
				{ ok: false, reason: 'unknown', outcome: 'unconfirmed', phase: 'attach', detached: true },
			);
		} finally {
			ctx.dispose();
		}
	});

	for (const revoked of [
		'selected GitHub token',
		'host credential',
		'stored expiry',
		'integrations setting',
		'workspace connection',
		'configured selection',
		'microtask before detach',
		'microtask before attach',
	]) {
		test(`stops a replacement on retirement of the ${revoked}`, async () => {
			const ctx = await setup(revoked === 'configured selection' ? customHost().provider : undefined);
			try {
				mock.method(GitHub.prototype, 'getIssueRelationships', async () => empty);
				const result = await ctx.manager.getIssueRelationships({ ...selected, issue: child });
				assert.ok(result.ok);

				const node = (pin: typeof parent) => ({
					id: pin.expectedNodeId,
					number: pin.number,
					url: `https://github.com/${pin.owner}/${pin.repo}/issues/${pin.number}`,
					state: 'OPEN',
					title: pin.expectedNodeId,
					repository: {
						name: pin.repo,
						owner: { login: pin.owner },
						isArchived: false,
						viewerPermission: 'ADMIN',
					},
				});
				const requests: string[] = [];
				let hostSessionCurrent = true;
				if (revoked.startsWith('microtask')) {
					const write = GitHub.prototype.writeIssueRelationship;
					mock.method(
						GitHub.prototype,
						'writeIssueRelationship',
						function (this: GitHub, ...[input, options]: Parameters<typeof write>) {
							assert.ok(options?.isSessionCurrent);
							const verify = options.isSessionCurrent;
							return write.call(this, input, {
								...options,
								isSessionCurrent: async () => {
									const verified = await verify();
									if (
										(requests.length === 1 && revoked === 'microtask before detach') ||
										(requests.length === 2 && revoked === 'microtask before attach')
									) {
										queueMicrotask(() => {
											hostSessionCurrent = false;
										});
									}
									return verified;
								},
							});
						},
					);
				}
				ctx.runtime.http.fetch = async (url, init) => {
					assert.equal(String(url), 'https://api.github.com/graphql');
					assert.ok(typeof init?.body === 'string');
					const { query, variables } = JSON.parse(init.body) as { query: string; variables: unknown };
					assert.equal(new Headers(init.headers).get('authorization'), 'Bearer selected-token');
					requests.push(query);
					if (query.includes('PreflightIssueRelationship')) {
						return Response.json({
							data: {
								target: { issue: { ...node(parent), subIssues: { totalCount: 0 }, parent: null } },
								child: {
									issue: {
										...node(child),
										parent: { id: previous.expectedNodeId },
										subIssues: { totalCount: 0 },
									},
								},
								other: { issue: { ...node(previous), parent: null } },
							},
						});
					}

					assert.match(query, /removeSubIssue/);
					assert.deepEqual(variables, {
						input: { issueId: previous.expectedNodeId, subIssueId: child.expectedNodeId },
					});
					if (revoked === 'selected GitHub token') {
						await ctx.store(selected.connectionId, 'rotated-token');
					} else if (revoked === 'stored expiry') {
						await ctx.store(selected.connectionId, 'selected-token', new Date(Date.now() - 1000));
					} else if (revoked === 'integrations setting') {
						ctx.runtime.config.isIntegrationsEnabled = () => false;
					} else if (revoked === 'workspace connection') {
						await ctx.runtime.storage.storeWorkspace('connected:github', false);
					} else if (revoked === 'configured selection') {
						ctx.runtime.account.fetchGkApi = async () => new Response(null, { status: 204 });
						await ctx.manager.deleteConnection(selected.providerId, selected.connectionId);
						await ctx.store(selected.connectionId, 'selected-token');
					} else if (revoked === 'host credential') {
						hostSessionCurrent = false;
					}
					return Response.json({
						data: { updated: { issue: node(previous), subIssue: { ...node(child), parent: null } } },
					});
				};
				assert.deepEqual(
					await ctx.manager.writeIssueRelationship(
						{
							...selected,
							parent: parent,
							child: child,
							action: 'add',
							replaceParent: previous,
							expectedConnectionProof: result.connectionProof,
						},
						() => hostSessionCurrent,
					),
					revoked === 'microtask before detach'
						? {
								ok: false,
								reason: 'no-connection',
								phase: 'detach',
								outcome: 'not-sent',
								mutationDispatched: false,
							}
						: { ok: false, reason: 'no-connection', phase: 'attach', outcome: 'not-sent', detached: true },
				);
				assert.equal(requests.length, revoked === 'microtask before detach' ? 1 : 2);
			} finally {
				ctx.dispose();
			}
		});
	}
});
