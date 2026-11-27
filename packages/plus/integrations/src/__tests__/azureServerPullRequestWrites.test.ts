import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import type {
	AzureServerPullRequestWriteOptions,
	AzureServerPullRequestWriteScope,
	IntegrationManager,
} from '../index.js';
import { createIntegrationManager } from '../index.js';
import { azureRestDiscoveryResponse } from '../providers/azure/__tests__/fixtures.js';
import { createFakeRuntime } from './fakeRuntime.js';

const providerId = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
const collectionId = 'fd62411b-0000-4000-8000-000000000001';
const project = { id: '12ba3e78-27d9-4ad4-82a2-4142734e75f0', name: 'Shared Project' };
const repo = { id: '58650c76-e42c-4377-9ddd-8c2fdecabaa5', name: 'Shared Repo', project: project };
const accountId = 'collection-local-user';
const sourceRef = 'refs/heads/feature';
const targetRef = 'refs/heads/main';
const sourceSha = 'a'.repeat(40);
const targetSha = 'b'.repeat(40);
const pr = {
	pullRequestId: 42,
	repository: repo,
	status: 'active',
	title: 'Original',
	description: '',
	sourceRefName: sourceRef,
	targetRefName: targetRef,
	lastMergeSourceCommit: { commitId: sourceSha },
	lastMergeTargetCommit: { commitId: targetSha },
	mergeStatus: 'succeeded',
};
type Call = { method: string; url: URL; route: string; body: Record<string, unknown> };

function setup(version = '6.0', baseUrl = 'https://server.test/tfs', configuredUrl = baseUrl) {
	const runtime = createFakeRuntime();
	const descriptor = {
		tokenId: 'connection',
		provider: toCloudIntegrationType[providerId],
		type: 'pat',
		domain: configuredUrl,
	};
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async path =>
		Response.json({
			data:
				path === 'v1/provider-tokens'
					? [{ ...descriptor, secondaries: [] }]
					: { ...descriptor, accessToken: 'me-token', scopes: '' },
		});
	const calls: Call[] = [];
	const fixture = {
		manager: createIntegrationManager(runtime),
		current: { ...pr },
		calls: calls,
		respond: undefined as ((call: Call) => Response | Promise<Response | undefined> | undefined) | undefined,
		mutations: () => calls.filter(c => c.method !== 'GET' && c.method !== 'OPTIONS'),
	};
	const installation = new URL(baseUrl).pathname.replace(/\/$/, '');
	runtime.http.fetch = async (input, init) => {
		const url = new URL(String(input));
		assert.equal(url.origin, new URL(baseUrl).origin);
		assert.ok(url.pathname.startsWith(`${installation}/`));
		assert.equal(new Headers(init?.headers).get('authorization'), `Basic ${btoa(':me-token')}`);
		const call: Call = {
			method: init?.method ?? 'GET',
			url: url,
			route: url.pathname
				.slice(installation.length + 1)
				.split('/')
				.map(decodeURIComponent)
				.join('/')
				.replace(/^defaultcollection\//i, 'DefaultCollection/'),
			body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
		};
		calls.push(call);
		if (call.route !== '_apis/connectionData' && call.route !== '_apis/projectCollections') {
			assert.equal(init?.redirect, 'error');
		}
		const custom = await fixture.respond?.(call);
		if (custom != null) return custom;

		if (call.method === 'OPTIONS') {
			return (
				azureRestDiscoveryResponse(url, { maxVersion: version, releasedVersion: version }) ??
				Response.json({}, { status: 404 })
			);
		}
		if (call.route === '_apis/connectionData') {
			return Response.json({
				instanceId: 'installation',
				authenticatedUser: { id: 'installation-user', properties: { Account: { $value: 'me' } } },
			});
		}
		if (call.route === 'DefaultCollection/_apis/connectionData') {
			return Response.json({
				instanceId: collectionId,
				authenticatedUser: { id: accountId, properties: { Account: { $value: 'me' } } },
				webApplicationRelativeDirectory: `${installation}/DefaultCollection/`,
			});
		}
		if (call.route === '_apis/projectCollections') {
			return Response.json({ value: [{ id: collectionId, name: 'DefaultCollection' }] });
		}

		const git = `DefaultCollection/${project.id}/_apis/git`;
		if (call.route === `${git}/repositories/${repo.name}` || call.route === `${git}/repositories/${repo.id}`) {
			assert.equal(url.searchParams.get('api-version'), version);
			return Response.json(repo);
		}
		if (call.route === `${git}/policy/configurations`) {
			assert.equal(url.searchParams.get('api-version'), '5.0-preview.1');
			assert.equal(url.searchParams.get('repositoryId'), repo.id);
			assert.equal(url.searchParams.get('refName'), targetRef);
			return Response.json({ value: [] });
		}
		if (call.route === `${git}/repositories/${repo.id}/refs`) {
			assert.equal(url.searchParams.get('api-version'), version);
			const source = url.searchParams.get('filter') === sourceRef.slice(5);
			return Response.json({
				value: [{ name: source ? sourceRef : targetRef, objectId: source ? sourceSha : targetSha }],
			});
		}
		if (call.route.startsWith(`${git}/repositories/${repo.id}/pullrequests`)) {
			assert.equal(url.searchParams.get('api-version'), version);
			if (call.method !== 'GET') {
				fixture.current = { ...fixture.current, ...call.body };
			}
			return Response.json(fixture.current);
		}
		return Response.json({ message: `Unhandled ${call.route}` }, { status: 404 });
	};
	const scope: AzureServerPullRequestWriteScope = {
		providerId: providerId,
		connectionId: 'connection',
		baseUrl: configuredUrl,
		collectionUrl: `${baseUrl}/DefaultCollection`,
		organizationId: collectionId,
		organizationName: 'DefaultCollection',
		projectId: project.id,
		repository: repo.name,
	};
	return { ...fixture, fixture: fixture, scope: scope };
}

async function withServer(
	fn: (server: ReturnType<typeof setup>, manager: IntegrationManager) => Promise<void>,
	version = '6.0',
	baseUrl?: string,
	configuredUrl?: string,
): Promise<void> {
	const server = setup(version, baseUrl, configuredUrl);
	try {
		await server.manager.refreshConnections();
		await fn(server, server.manager);
	} finally {
		server.manager.dispose();
	}
}

function writeScope(scope: AzureServerPullRequestWriteScope) {
	const { repository: _, ...rest } = scope;
	return { ...rest, repositoryId: repo.id, expectedAccountId: accountId };
}

function completion(
	scope: AzureServerPullRequestWriteScope,
): Extract<AzureServerPullRequestWriteOptions, { action: 'complete' }> {
	return {
		...writeScope(scope),
		action: 'complete',
		number: 42,
		strategy: 'squash',
		expectedSourceRef: sourceRef,
		expectedTargetRef: targetRef,
		expectedSourceSha: sourceSha,
		expectedTargetSha: targetSha,
	};
}

suite('IntegrationManager Azure DevOps Server pull request writes', () => {
	for (const baseUrl of ['https://server.test', 'https://server.test/tfs']) {
		test(`pins collection identity and canonical repository at ${baseUrl}`, async () => {
			await withServer(
				async (server, manager) => {
					const result = await manager.getAzurePullRequestCreateCapability(server.scope);
					assert.ok(result.ok);
					assert.equal(result.accountId, accountId);
					assert.equal(result.repository.repositoryId, repo.id);
					assert.deepEqual(result.repository.server, {
						providerId: providerId,
						connectionId: 'connection',
						baseUrl: baseUrl,
						collectionUrl: `${baseUrl}/DefaultCollection`,
						organizationId: collectionId,
					});
					const created = await manager.writeAzurePullRequest({
						...writeScope(server.scope),
						action: 'create',
						title: 'New',
						sourceRef: sourceRef,
						targetRef: targetRef,
					});
					assert.ok(created.ok);
					assert.equal(created.status, 'created');
					assert.equal(
						created.pullRequest.url,
						`${baseUrl}/DefaultCollection/Shared%20Project/_git/Shared%20Repo/pullrequest/42`,
					);
					assert.equal(server.mutations().length, 1);
				},
				'6.0',
				baseUrl,
			);
		});
	}

	test('accepts a connection configured at its collection', async () => {
		await withServer(
			async (server, manager) => {
				assert.ok((await manager.getAzurePullRequestCreateCapability(server.scope)).ok);
			},
			'6.0',
			'https://server.test/tfs',
			'https://server.test/tfs/DefaultCollection',
		);
	});

	for (const version of ['5.0', '6.0', '7.0']) {
		test(`negotiates ${version}, filters strategies and sends its supported completion shape`, async () => {
			await withServer(async (server, manager) => {
				const target = await manager.resolveAzurePullRequestWriteTarget({ ...server.scope, number: 42 });
				assert.ok(target.ok);
				assert.deepEqual(target.capabilities.complete, {
					kind: 'available',
					strategies:
						version === '5.0'
							? ['noFastForward', 'squash']
							: ['noFastForward', 'squash', 'rebase', 'rebaseMerge'],
				});
				server.fixture.respond = call =>
					call.method === 'PATCH' ? Response.json({ ...pr, status: 'completed' }) : undefined;
				const result = await manager.writeAzurePullRequest(completion(server.scope));
				assert.ok(result.ok);
				assert.equal(result.status, 'completed');
				assert.deepEqual(
					server.mutations()[0].body.completionOptions,
					version === '5.0'
						? { squashMerge: true, bypassPolicy: false }
						: { mergeStrategy: 'squash', bypassPolicy: false },
				);
			}, version);
		});
	}

	test('rejects rebase on 5.0 before dispatch', async () => {
		await withServer(async (server, manager) => {
			assert.deepEqual(
				await manager.writeAzurePullRequest({
					...completion(server.scope),
					strategy: 'rebase',
				}),
				{ ok: false, reason: 'unsupported' },
			);
			assert.equal(server.mutations().length, 0);
		}, '5.0');
	});

	test('refuses TFS 2018', async () => {
		await withServer(async (server, manager) => {
			assert.deepEqual(await manager.getAzurePullRequestCreateCapability(server.scope), {
				ok: false,
				reason: 'unsupported',
			});
			assert.equal(server.mutations().length, 0);
		}, '4.1');
	});

	test('edits, abandons and reactivates', async () => {
		await withServer(async (server, manager) => {
			const address = { ...writeScope(server.scope), number: 42 };
			for (const action of ['edit', 'abandon', 'reactivate'] as const) {
				const result = await manager.writeAzurePullRequest({
					...address,
					action: action,
					...(action === 'edit' && { title: 'Edited', description: 'Body' }),
				});
				assert.ok(result.ok);
				assert.equal(
					result.status,
					action === 'edit' ? 'updated' : action === 'abandon' ? 'abandoned' : 'reactivated',
				);
			}
			assert.equal(server.mutations().length, 3);
		});
	});

	for (const changed of [
		{ baseUrl: 'https://other.test/tfs' },
		{ collectionUrl: 'https://other.test/tfs/DefaultCollection' },
		{ collectionUrl: 'https://server.test/tfs/OtherCollection' },
		{ organizationId: 'fd62411b-0000-4000-8000-000000000002' },
		{ expectedAccountId: 'other-user' },
		{ projectId: 'fd62411b-0000-4000-8000-000000000003' },
		{ repository: 'Other Repo' },
	]) {
		test(`refuses mismatched identity ${JSON.stringify(changed)}`, async () => {
			await withServer(async (server, manager) => {
				const result = await manager.getAzurePullRequestCreateCapability({ ...server.scope, ...changed });
				assert.equal(result.ok, false);
				assert.equal(server.mutations().length, 0);
			});
		});
	}

	for (const host of ['dev.azure.com', 'org.visualstudio.com', 'org.dev.azure.com', 'dev.azure.com.']) {
		test(`refuses Services host ${host} before requests`, async () => {
			await withServer(async (server, manager) => {
				server.calls.length = 0;
				assert.deepEqual(
					await manager.getAzurePullRequestCreateCapability({
						...server.scope,
						baseUrl: `https://${host}`,
						collectionUrl: `https://${host}/DefaultCollection`,
					}),
					{ ok: false, reason: 'invalid-input' },
				);
				assert.equal(server.calls.length, 0);
			});
		});
	}

	test('retains legacy merge policy and blocks a disallowed strategy', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.route.endsWith('/policy/configurations')
					? Response.json({
							value: [{ isEnabled: true, isBlocking: true, settings: { useSquashMerge: false } }],
						})
					: undefined;
			assert.deepEqual(await manager.writeAzurePullRequest(completion(server.scope)), {
				ok: false,
				reason: 'policy-blocked',
			});
			assert.equal(server.mutations().length, 0);
		});
	});

	for (const [status, reason] of [
		[403, 'forbidden'],
		[400, 'invalid-input'],
		[409, 'conflict'],
		[429, 'rate-limit'],
		[503, 'outcome-unknown'],
	] as const) {
		test(`preserves provider failure ${status} without retrying`, async () => {
			await withServer(async (server, manager) => {
				server.fixture.respond = call =>
					call.method === 'PATCH' ? Response.json({ message: 'Rejected' }, { status: status }) : undefined;
				assert.deepEqual(await manager.writeAzurePullRequest(completion(server.scope)), {
					ok: false,
					reason: reason,
				});
				assert.equal(server.mutations().length, 1);
			});
		});
	}

	test('preserves a provider completion policy refusal', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.method === 'PATCH'
					? Response.json({ typeKey: 'GitPullRequestPolicyException' }, { status: 403 })
					: undefined;
			assert.deepEqual(await manager.writeAzurePullRequest(completion(server.scope)), {
				ok: false,
				reason: 'policy-blocked',
			});
			assert.equal(server.mutations().length, 1);
		});
	});

	test('leaves queued completion pending', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.method === 'PATCH'
					? Response.json({ ...pr, status: 'completed', mergeStatus: 'queued' })
					: undefined;
			const result = await manager.writeAzurePullRequest(completion(server.scope));
			assert.ok(result.ok);
			assert.equal(result.status, 'pending');
			assert.equal(server.mutations().length, 1);
		});
	});

	test('never retries an uncertain transport outcome', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call => {
				if (call.method === 'PATCH') throw new Error('Connection closed');
				return undefined;
			};
			assert.deepEqual(await manager.writeAzurePullRequest(completion(server.scope)), {
				ok: false,
				reason: 'outcome-unknown',
			});
			assert.equal(server.mutations().length, 1);
		});
	});

	test('refuses changed approved refs and commits', async () => {
		await withServer(async (server, manager) => {
			for (const changed of [
				{ expectedSourceRef: 'refs/heads/other' },
				{ expectedSourceSha: 'c'.repeat(40) },
				{ expectedTargetRef: 'refs/heads/other' },
				{ expectedTargetSha: 'c'.repeat(40) },
			]) {
				const result = await manager.writeAzurePullRequest({
					...completion(server.scope),
					...changed,
				});
				assert.deepEqual(result, {
					ok: false,
					reason:
						'expectedSourceRef' in changed || 'expectedSourceSha' in changed
							? 'source-changed'
							: 'target-changed',
				});
			}
			assert.equal(server.mutations().length, 0);
		});
	});
	test('does not dispatch after a same-ID credential replacement at the final session check', async () => {
		await withServer(async (server, manager) => {
			const configured = (manager as unknown as { configuredIntegrationService: ConfiguredIntegrationService })
				.configuredIntegrationService;
			const peek = configured.peekStoredSession.bind(configured);
			let checks = 0;
			configured.peekStoredSession = async (...args) => {
				const current = await peek(...args);
				if (++checks === 1 && current != null) {
					void configured.storeSession(providerId, { ...current, accessToken: 'replacement-token' });
				}
				return current;
			};
			assert.deepEqual(await manager.writeAzurePullRequest(completion(server.scope)), {
				ok: false,
				reason: 'no-connection',
			});
			assert.equal(checks, 1);
			assert.equal(server.mutations().length, 0);
		});
	});

	test('concurrent Server credential acquisition does not retire sibling reads', async () => {
		await withServer(async (server, manager) => {
			const results = await Promise.all([
				manager.getAzurePullRequestCreateCapability(server.scope),
				manager.resolveAzurePullRequestWriteTarget({ ...server.scope, number: 42 }),
				manager.writeAzurePullRequest({
					...writeScope(server.scope),
					action: 'edit',
					number: 42,
					title: 'New',
				}),
			]);
			assert.ok(
				results.every(result => result.ok),
				JSON.stringify(results),
			);
			assert.equal(server.mutations().length, 1);
		});
	});

	test('resolves identical repository and project names in a second collection by its own GUIDs', async () => {
		await withServer(async (server, manager) => {
			const id = 'fd62411b-0000-4000-8000-000000000002';
			const secondProject = { ...project, id: '12ba3e78-27d9-4ad4-82a2-4142734e75f1' };
			const secondRepo = { ...repo, id: '58650c76-e42c-4377-9ddd-8c2fdecabaa6', project: secondProject };
			server.fixture.respond = call => {
				if (call.route === 'Other Collection/_apis/connectionData') {
					return Response.json({
						instanceId: id,
						authenticatedUser: { id: 'second-user' },
						webApplicationRelativeDirectory: '/tfs/Other%20Collection/',
					});
				}
				if (call.route === `Other Collection/${secondProject.id}/_apis/git/repositories/${repo.name}`) {
					return Response.json(secondRepo);
				}
				return undefined;
			};
			const result = await manager.getAzurePullRequestCreateCapability({
				...server.scope,
				collectionUrl: 'https://server.test/tfs/Other%20Collection',
				organizationId: id,
				organizationName: 'Other Collection',
				projectId: secondProject.id,
				expectedAccountId: 'second-user',
			});
			assert.ok(result.ok, JSON.stringify(result));
			assert.equal(result.repository.repositoryId, secondRepo.id);
			assert.equal(result.repository.projectId, secondProject.id);
			assert.equal(result.repository.server?.organizationId, id);
		});
	});

	test('reports a failed policy read as completion unavailable and sends no write', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.route.endsWith('/policy/configurations')
					? Response.json({ message: 'Denied' }, { status: 403 })
					: undefined;
			const target = await manager.resolveAzurePullRequestWriteTarget({ ...server.scope, number: 42 });
			assert.ok(target.ok);
			assert.deepEqual(target.capabilities.complete, { kind: 'unavailable', reason: 'forbidden' });
			assert.deepEqual(await manager.writeAzurePullRequest(completion(server.scope)), {
				ok: false,
				reason: 'forbidden',
			});
			assert.equal(server.mutations().length, 0);
		});
	});
	test('reports the collection casing of the Server, not of the caller', async () => {
		await withServer(async (server, manager) => {
			const result = await manager.getAzurePullRequestCreateCapability({
				...server.scope,
				organizationName: 'defaultcollection',
				organizationId: collectionId.toUpperCase(),
			});
			assert.ok(result.ok, JSON.stringify(result));
			assert.equal(result.repository.organization, 'DefaultCollection');
			assert.equal(result.repository.server?.organizationId, collectionId);
			server.calls.length = 0;
			const created = await manager.writeAzurePullRequest({
				...writeScope(server.scope),
				organizationName: 'defaultcollection',
				action: 'create',
				title: 'New',
				sourceRef: sourceRef,
				targetRef: targetRef,
			});
			assert.ok(created.ok, JSON.stringify(created));
			assert.equal(
				created.pullRequest.url,
				'https://server.test/tfs/DefaultCollection/Shared%20Project/_git/Shared%20Repo/pullrequest/42',
			);
			const mutation = server.mutations()[0];
			assert.ok(mutation.url.pathname.startsWith('/tfs/DefaultCollection/'), mutation.url.pathname);
		});
	});

	for (const data of [
		{ webApplicationRelativeDirectory: ['tfs', 'DefaultCollection'] },
		{ webApplicationRelativeDirectory: 7 },
	]) {
		test(`refuses malformed collection identity ${JSON.stringify(data)}`, async () => {
			await withServer(async (server, manager) => {
				server.fixture.respond = call =>
					call.route === 'DefaultCollection/_apis/connectionData'
						? Response.json({
								instanceId: collectionId,
								authenticatedUser: { id: accountId },
								...data,
							})
						: undefined;
				assert.deepEqual(await manager.getAzurePullRequestCreateCapability(server.scope), {
					ok: false,
					reason: 'not-found',
				});
				assert.equal(server.mutations().length, 0);
			});
		});
	}

	test('steps down to the released major when the next major is only a preview', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.method === 'OPTIONS'
					? azureRestDiscoveryResponse(call.url, { maxVersion: '7.0', releasedVersion: '6.0' })
					: undefined;
			const result = await manager.writeAzurePullRequest(completion(server.scope));
			assert.ok(result.ok, JSON.stringify(result));
			assert.deepEqual(server.mutations()[0].body.completionOptions, {
				mergeStrategy: 'squash',
				bypassPolicy: false,
			});
		}, '6.0');
	});

	test('negotiates the stable 5.0 contract when a 2019 update advertises preview 5.1', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.method === 'OPTIONS'
					? azureRestDiscoveryResponse(call.url, { maxVersion: '5.1', releasedVersion: '5.0' })
					: undefined;
			assert.ok((await manager.getAzurePullRequestCreateCapability(server.scope)).ok);
		}, '5.0');
	});

	test('refuses a preview-only PR resource', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.method === 'OPTIONS'
					? azureRestDiscoveryResponse(call.url, { maxVersion: '7.0', releasedVersion: '0.0' })
					: undefined;
			assert.deepEqual(await manager.getAzurePullRequestCreateCapability(server.scope), {
				ok: false,
				reason: 'unsupported',
			});
			assert.equal(server.mutations().length, 0);
		});
	});
	test('negotiates stable 6.0 against the real Server 2020-style 6.1 preview maximum', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.method === 'OPTIONS'
					? azureRestDiscoveryResponse(call.url, { maxVersion: '6.1', releasedVersion: '6.0' })
					: undefined;
			const target = await manager.resolveAzurePullRequestWriteTarget({ ...server.scope, number: 42 });
			assert.ok(target.ok);
			assert.deepEqual(target.capabilities.complete, {
				kind: 'available',
				strategies: ['noFastForward', 'squash', 'rebase', 'rebaseMerge'],
			});
			const result = await manager.writeAzurePullRequest(completion(server.scope));
			assert.ok(result.ok);
			assert.deepEqual(server.mutations()[0].body.completionOptions, {
				mergeStrategy: 'squash',
				bypassPolicy: false,
			});
		}, '6.0');
	});

	test('returns unsupported for every TFS 2018 capability and action', async () => {
		await withServer(async (server, manager) => {
			const unsupported = { ok: false, reason: 'unsupported' };
			assert.deepEqual(await manager.getAzurePullRequestCreateCapability(server.scope), unsupported);
			assert.deepEqual(
				await manager.resolveAzurePullRequestWriteTarget({ ...server.scope, number: 42 }),
				unsupported,
			);
			const address = writeScope(server.scope);
			for (const options of [
				{ ...address, action: 'create', title: 'New', sourceRef: sourceRef, targetRef: targetRef },
				{ ...address, action: 'edit', number: 42, title: 'Edited' },
				{ ...address, action: 'abandon', number: 42 },
				{ ...address, action: 'reactivate', number: 42 },
				completion(server.scope),
			] satisfies AzureServerPullRequestWriteOptions[]) {
				assert.deepEqual(await manager.writeAzurePullRequest(options), unsupported);
			}
			assert.equal(server.mutations().length, 0);
		}, '4.0');
	});

	test('pins the live target tip when the Server merge preview is stale', async () => {
		await withServer(async (server, manager) => {
			server.fixture.respond = call =>
				call.method === 'GET' && call.route.endsWith('/pullrequests/42')
					? Response.json({ ...pr, lastMergeTargetCommit: { commitId: 'c'.repeat(40) } })
					: undefined;
			const target = await manager.resolveAzurePullRequestWriteTarget({ ...server.scope, number: 42 });
			assert.ok(target.ok);
			assert.equal(target.pullRequest.targetSha, targetSha);
			assert.ok((await manager.writeAzurePullRequest(completion(server.scope))).ok);
			assert.equal(server.mutations().length, 1);
		});
	});
});
