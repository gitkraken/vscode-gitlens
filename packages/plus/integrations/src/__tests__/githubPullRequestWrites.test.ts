import * as assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { suite, test } from 'mocha';
import { Emitter } from '@gitlens/utils/event.js';
import { microhash } from '@gitlens/utils/hash.js';
import { defer } from '@gitlens/utils/promise.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationManager, PullRequestWriteOptions } from '../index.js';
import { createIntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

const repo = { providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'selected', owner: 'org', repo: 'repo' };
const target = { ...repo, number: 42, expectedNodeId: 'legacy-pr-id' };
const headSha = 'd'.repeat(40);
const baseRef = 'release/stable';
const baseRefId = 'REF_release';
const observed = { ...target, expectedBaseRef: baseRef, expectedHeadSha: headSha };
const merge = { ...observed, action: 'merge', mergeMethod: 'squash' } as const;
const enqueue = { ...observed, action: 'enqueue' } as const;
const repository = {
	id: 'R_10',
	owner: { login: 'Org' },
	name: 'Repo',
	isArchived: false,
	isDisabled: false,
	isLocked: false,
	viewerPermission: 'WRITE',
	mergeCommitAllowed: true,
	squashMergeAllowed: true,
	rebaseMergeAllowed: true,
	viewerDefaultMergeMethod: 'MERGE',
	base: { id: 'REF_base' },
	head: { id: 'REF_head' },
};
const node = {
	__typename: 'PullRequest',
	id: 'PR_42',
	number: 42,
	title: 'Proposed change',
	body: 'Description',
	url: 'https://github.com/Org/Repo/pull/42',
	state: 'OPEN',
	updatedAt: '2026-11-23T09:00:00Z',
	headRefOid: headSha,
	baseRefName: baseRef,
	repository: repository,
	viewerCanUpdate: true,
	viewerCanClose: true,
	viewerCanReopen: true,
	isDraft: false,
	isInMergeQueue: false,
	isMergeQueueEnabled: false,
	stack: null,
	baseRef: { id: baseRefId },
};
const writeTarget = { repository: repository, node: node };
const queueTarget = { repository: repository, node: { ...node, isMergeQueueEnabled: true } };
const snapshot = {
	owner: 'Org',
	repo: 'Repo',
	number: 42,
	nodeId: 'PR_42',
	url: node.url,
	title: node.title,
	body: node.body,
	state: 'open',
	updatedAt: node.updatedAt,
	headSha: headSha,
	baseRef: baseRef,
};
const queueEntry = { state: 'AWAITING_CHECKS', enqueuedAt: '2026-11-23T09:00:00Z', position: 1 };
const deniedBranchProtection = {
	errors: [
		{
			type: 'FORBIDDEN',
			message: 'Branch protection policy access is restricted',
			path: ['node', 'baseRef', 'branchProtectionRule'],
		},
	],
};

type Call = {
	url: URL;
	authorization: string | null;
	query: string;
	variables?: Record<string, unknown>;
	canonicalIds: boolean;
};

function cloudToken(accessToken: string, connectionId = 'selected') {
	return Response.json({
		data: {
			tokenId: connectionId,
			accessToken: accessToken,
			type: 'oauth',
			scopes: 'repo',
			domain: 'github.com',
			expiresIn: 3600,
		},
	});
}

function branchRules(nodes: object[], endCursor?: string, requiresLinearHistory = false) {
	return {
		data: {
			node: {
				id: baseRefId,
				refUpdateRule: requiresLinearHistory ? { requiresLinearHistory: true } : null,
				rules: { nodes: nodes, pageInfo: { hasNextPage: endCursor != null, endCursor: endCursor ?? null } },
			},
		},
	};
}

async function withManager(
	respond: (call: Call, storeSelected: (token: string) => Promise<boolean>) => object | Promise<object>,
	run: (fixture: {
		manager: ReturnType<typeof createIntegrationService>;
		calls: Call[];
		runtime: ReturnType<typeof createFakeRuntime>;
		storeSelected: (token: string) => Promise<boolean>;
	}) => Promise<void>,
	tokens: { primary: string; selected: string } = { primary: 'token-primary', selected: 'token-selected' },
) {
	const runtime = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(runtime);
	const storeSession = (id: string, token: string) =>
		configured.storeSession(GitCloudHostIntegrationId.GitHub, {
			id: id,
			accessToken: token,
			account: { id: id, label: id },
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
		});
	await storeSession('primary', tokens.primary);
	await storeSession('selected', tokens.selected);
	const calls: Call[] = [];
	runtime.http.fetch = async (url, init) => {
		const headers = new Headers(init?.headers);
		assert.ok(typeof init?.body === 'string');
		const body = JSON.parse(init.body) as { query: string; variables?: Record<string, unknown> };
		const call = {
			url: new URL(String(url)),
			authorization: headers.get('authorization'),
			canonicalIds: headers.get('x-github-next-global-id') === '1',
			query: body.query.trimStart(),
			variables: body.variables,
		};
		calls.push(call);
		const result = await respond(call, token => storeSession('selected', token));
		return result instanceof Response ? result : Response.json(result);
	};
	const manager = createIntegrationService(runtime);
	try {
		await run({
			manager: manager,
			calls: calls,
			runtime: runtime,
			storeSelected: token => storeSession('selected', token),
		});
	} finally {
		manager.dispose();
		configured.dispose();
	}
}

suite('IntegrationManager GitHub pull request writes', () => {
	const operations: {
		options: PullRequestWriteOptions;
		mutation: string;
		input: object;
		result: { status: string; state: 'open' | 'closed' | 'merged'; title?: string; body?: string };
	}[] = [
		{
			options: {
				...repo,
				action: 'create',
				headRef: 'feature/change',
				baseRef: baseRef,
				title: node.title,
				expectedRepositoryId: repository.id,
			},
			mutation: 'createPullRequest',
			input: {
				repositoryId: repository.id,
				headRefName: 'feature/change',
				baseRefName: baseRef,
				title: node.title,
			},
			result: { status: 'created', state: 'open' },
		},
		{
			options: { ...target, action: 'edit', title: 'Edited', body: '' },
			mutation: 'updatePullRequest',
			input: { pullRequestId: node.id, title: 'Edited', body: '' },
			result: { status: 'updated', state: 'open', title: 'Edited', body: '' },
		},
		{
			options: { ...target, action: 'set-state', state: 'closed' },
			mutation: 'closePullRequest',
			input: { pullRequestId: node.id },
			result: { status: 'closed', state: 'closed' },
		},
		{
			options: { ...target, action: 'set-state', state: 'open' },
			mutation: 'reopenPullRequest',
			input: { pullRequestId: node.id },
			result: { status: 'reopened', state: 'open' },
		},
		{
			options: { ...merge, expectedHeadSha: headSha.toUpperCase() },
			mutation: 'mergePullRequest',
			input: { pullRequestId: node.id, expectedHeadOid: headSha, mergeMethod: 'SQUASH' },
			result: { status: 'merged', state: 'merged' },
		},
	];

	for (const { options, mutation, input, result } of operations) {
		test(`dispatches ${mutation} under the selected connection and returns the receipt`, async () => {
			const title = result.title ?? node.title;
			const body = result.body ?? node.body;
			const closedAt = '2026-11-23T10:00:00Z';
			const mergedAt = '2026-11-23T10:00:01Z';
			await withManager(
				({ query }) => {
					if (query.includes('branchProtectionRule')) return deniedBranchProtection;
					if (query.startsWith('query PullRequestBranchRules')) return branchRules([]);

					if (query.startsWith('query')) {
						return {
							data: {
								...writeTarget,
								node: { ...node, state: mutation === 'reopenPullRequest' ? 'CLOSED' : 'OPEN' },
							},
						};
					}

					assert.match(query, new RegExp(`change: ${mutation}\\b`));
					return {
						data: {
							change: {
								pullRequest: {
									...node,
									state: result.state.toUpperCase(),
									title: title,
									body: body,
									closedAt: closedAt,
									mergedAt: result.state === 'merged' ? mergedAt : null,
								},
							},
						},
					};
				},
				async ({ manager, calls, runtime }) => {
					assert.deepEqual(await manager.writePullRequest(options), {
						ok: true,
						status: result.status,
						pullRequest: {
							...snapshot,
							state: result.state,
							title: title,
							body: body,
							...(result.state !== 'open'
								? { closedAt: result.state === 'merged' ? mergedAt : closedAt }
								: {}),
						},
					});
					assert.deepEqual(calls.at(-1)?.variables, { input: input });
					assert.ok(
						calls.every(
							call => call.authorization === 'token token-selected' && call.url.host === 'api.github.com',
						),
					);
					assert.ok(calls.every(call => call.canonicalIds));
					assert.equal(
						calls.some(call => call.query.startsWith('query PullRequestBranchRules')),
						options.action === 'merge',
					);
					assert.equal(runtime.deletePullRequestsCalls, 1);
				},
			);
		});
	}

	test('reports direct strategies across every rules page and uses the canonical node from a legacy alias', async () => {
		await withManager(
			({ query, variables }) => {
				if (!query.startsWith('query PullRequestBranchRules')) return { data: writeTarget };

				assert.equal(variables?.id, baseRefId);
				return variables?.cursor == null
					? branchRules([{ type: 'REQUIRED_LINEAR_HISTORY', parameters: null }], 'page-two')
					: branchRules([{ type: 'PULL_REQUEST', parameters: { allowedMergeMethods: ['SQUASH'] } }]);
			},
			async ({ manager, calls }) => {
				assert.deepEqual(await manager.resolvePullRequestWriteTarget(target), {
					ok: true,
					pullRequest: snapshot,
					capabilities: {
						edit: true,
						close: true,
						reopen: false,
						merge: { kind: 'direct', methods: ['squash'], defaultMethod: undefined },
					},
				});
				assert.deepEqual(calls[0].variables, {
					owner: 'org',
					repo: 'repo',
					expectedNodeId: target.expectedNodeId,
				});
				assert.equal(calls.length, 3);
				assert.deepEqual(calls[2].variables, { id: baseRefId, cursor: 'page-two' });
			},
		);
	});

	test('keeps edit and state capabilities when the selected viewer cannot read merge rules', async () => {
		await withManager(
			({ query }) => {
				if (query.includes('branchProtectionRule')) return deniedBranchProtection;
				if (query.startsWith('query PullRequestBranchRules')) {
					return {
						errors: [
							{ type: 'FORBIDDEN', message: 'Effective rules are restricted', path: ['node', 'rules'] },
						],
					};
				}
				return { data: writeTarget };
			},
			async ({ manager }) => {
				assert.deepEqual(await manager.resolvePullRequestWriteTarget(target), {
					ok: true,
					pullRequest: snapshot,
					capabilities: {
						edit: true,
						close: true,
						reopen: false,
						merge: { kind: 'unavailable', reason: 'forbidden' },
					},
				});
			},
		);
	});

	test('honors linear history from the viewer-visible ref policy before offering or dispatching a merge commit', async () => {
		await withManager(
			({ query }) => {
				if (query.startsWith('query PullRequestBranchRules')) {
					assert.match(query, /refUpdateRule\s*\{\s*requiresLinearHistory\s*\}/);
					return branchRules([], undefined, true);
				}
				return { data: writeTarget };
			},
			async ({ manager, calls }) => {
				const capability = await manager.resolvePullRequestWriteTarget(target);
				assert.ok(capability.ok);
				assert.deepEqual(capability.capabilities.merge, {
					kind: 'direct',
					methods: ['squash', 'rebase'],
					defaultMethod: undefined,
				});
				assert.deepEqual(await manager.writePullRequest({ ...merge, mergeMethod: 'merge' }), {
					ok: false,
					reason: 'blocked',
				});
				assert.ok(calls.every(call => call.query.startsWith('query')));
			},
		);
	});

	test('distinguishes repository create access from an unknown viewer permission', async () => {
		const repositories = [
			repository,
			{ ...repository, viewerPermission: 'READ' },
			{ ...repository, viewerPermission: 'TRIAGE' },
			{ ...repository, viewerPermission: null },
			{ ...repository, isArchived: true },
		];
		await withManager(
			() => ({ data: { repository: repositories.shift() } }),
			async ({ manager, calls }) => {
				for (const canCreate of [true, true, true, undefined, false]) {
					assert.deepEqual(await manager.getPullRequestCreateCapability(repo), {
						ok: true,
						repositoryId: repository.id,
						canCreate: canCreate,
					});
				}

				assert.ok(calls.every(call => call.query.startsWith('query PullRequestCreateCapability')));
			},
		);
	});

	for (const viewerPermission of ['READ', 'TRIAGE']) {
		test(`lets GitHub authorize creation from existing refs for a ${viewerPermission} viewer`, async () => {
			await withManager(
				({ query }) =>
					query.startsWith('query')
						? { data: { repository: { ...repository, viewerPermission: viewerPermission } } }
						: { data: { change: { pullRequest: node } } },
				async ({ manager, calls }) => {
					assert.deepEqual(await manager.writePullRequest(operations[0].options), {
						ok: true,
						status: 'created',
						pullRequest: snapshot,
					});
					assert.equal(calls.length, 2);
					assert.match(calls[1].query, /\bcreatePullRequest\(/);
					assert.equal(calls[1].authorization, 'token token-selected');
				},
			);
		});
	}

	test('rejects a mutated repository name or PR identity without dispatch', async () => {
		await withManager(
			({ query }) => ({
				data: query.startsWith('query PullRequestCreateTarget')
					? { repository: { ...repository, id: 'R_different' } }
					: { ...writeTarget, node: { ...node, repository: { ...repository, id: 'R_foreign' } } },
			}),
			async ({ manager, calls }) => {
				assert.deepEqual(await manager.writePullRequest({ ...target, action: 'edit', title: 'Edited' }), {
					ok: false,
					reason: 'not-found',
				});
				assert.deepEqual(
					await manager.writePullRequest({
						...repo,
						action: 'create',
						title: node.title,
						headRef: 'feature/change',
						baseRef: baseRef,
						expectedRepositoryId: repository.id,
					}),
					{ ok: false, reason: 'not-found' },
				);
				assert.equal(calls.length, 2);
				assert.ok(calls.every(call => call.query.startsWith('query')));
			},
		);
	});

	test('rejects unsupported and missing connections without sending traffic', async () => {
		await withManager(
			() => assert.fail('must not contact GitHub'),
			async ({ manager }) => {
				assert.deepEqual(
					await manager.writePullRequest({
						...merge,
						providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					}),
					{
						ok: false,
						reason: 'unsupported',
					},
				);
				assert.deepEqual(await manager.writePullRequest({ ...merge, connectionId: 'missing' }), {
					ok: false,
					reason: 'no-connection',
				});
			},
		);
	});

	test('rejects stale head or base and invalidates cached pull requests', async () => {
		await withManager(
			() => ({ data: writeTarget }),
			async ({ manager, calls, runtime }) => {
				assert.deepEqual(await manager.writePullRequest({ ...merge, expectedHeadSha: 'e'.repeat(40) }), {
					ok: false,
					reason: 'head-changed',
				});
				assert.deepEqual(await manager.writePullRequest({ ...merge, expectedBaseRef: 'previous-base' }), {
					ok: false,
					reason: 'base-changed',
				});
				assert.equal(runtime.deletePullRequestsCalls, 2);
				assert.equal(calls.length, 2);
				assert.ok(calls.every(call => call.query.startsWith('query PullRequestWriteTarget')));
			},
		);
	});

	test('does not dispatch after the selected credential changes during preflight', async () => {
		await withManager(
			async ({ query }, storeSelected) => {
				assert.match(query, /^query PullRequestWriteTarget\b/);
				await storeSelected('replacement-token');
				return { data: writeTarget };
			},
			async ({ manager, calls }) => {
				assert.deepEqual(await manager.writePullRequest({ ...target, action: 'edit', title: 'Edited' }), {
					ok: false,
					reason: 'no-connection',
				});
				assert.equal(calls.length, 1);
			},
		);
	});

	test('returns the confirmed edit even if the credential changes during the mutation and the response has partial errors', async () => {
		await withManager(
			async ({ query }, storeSelected) => {
				if (query.startsWith('query')) return { data: writeTarget };

				await storeSelected('replacement-token');
				return {
					data: { change: { pullRequest: { ...node, title: 'Edited' } } },
					errors: [{ type: 'FORBIDDEN', message: 'refused field', path: ['change', 'pullRequest', 'field'] }],
				};
			},
			async ({ manager, runtime }) => {
				assert.deepEqual(await manager.writePullRequest({ ...target, action: 'edit', title: 'Edited' }), {
					ok: true,
					status: 'updated',
					pullRequest: { ...snapshot, title: 'Edited' },
				});
				assert.equal(runtime.deletePullRequestsCalls, 1);
			},
		);
	});

	test('reports a denied provider write without returning the raw error', async () => {
		await withManager(
			({ query }) =>
				query.startsWith('query')
					? { data: writeTarget }
					: {
							errors: [{ type: 'FORBIDDEN', message: 'confidential provider detail', path: ['change'] }],
						},
			async ({ manager }) => {
				assert.deepEqual(await manager.writePullRequest({ ...target, action: 'edit', title: 'Edited' }), {
					ok: false,
					reason: 'forbidden',
				});
			},
		);
	});

	test('does not retry a lost mutation reply', async () => {
		await withManager(
			({ query }) =>
				query.startsWith('query') ? { data: writeTarget } : new Response('unavailable', { status: 503 }),
			async ({ manager, runtime, calls }) => {
				assert.deepEqual(await manager.writePullRequest({ ...target, action: 'edit', title: 'Edited' }), {
					ok: false,
					reason: 'outcome-unknown',
				});
				assert.equal(calls.length, 2);
				assert.equal(runtime.deletePullRequestsCalls, 1);
			},
		);
	});

	test('uses the existing queue mutation with the expected head and routes direct merge away from the queue', async () => {
		await withManager(
			({ query }) =>
				query.startsWith('query')
					? { data: queueTarget }
					: {
							data: { enqueuePullRequest: { mergeQueueEntry: queueEntry } },
						},
			async ({ manager, calls }) => {
				assert.deepEqual(await manager.writePullRequest(merge), { ok: false, reason: 'blocked' });
				assert.deepEqual(await manager.writePullRequest(enqueue), {
					ok: true,
					status: 'queued',
					pullRequest: snapshot,
				});
				assert.equal(calls.length, 3);
				assert.match(calls[2].query, /^mutation enqueuePullRequest\b/);
				assert.deepEqual(calls[2].variables, { id: node.id, expectedHeadOid: headSha });
			},
		);
	});

	for (const { where, run, status, reason } of [
		{
			where: 'repository capability read',
			run: (manager: IntegrationManager) => manager.getPullRequestCreateCapability(repo),
			status: 401,
			reason: 'no-connection',
		},
		{
			where: 'branch rules read',
			run: (manager: IntegrationManager) => manager.resolvePullRequestWriteTarget(target),
			status: 401,
			reason: 'no-connection',
		},
		{
			where: 'edit mutation',
			run: (manager: IntegrationManager) => manager.writePullRequest(operations[1].options),
			status: 401,
			reason: 'no-connection',
		},
		{
			where: 'enqueue mutation',
			run: (manager: IntegrationManager) => manager.writePullRequest(enqueue),
			status: 401,
			reason: 'no-connection',
		},
		{
			where: 'enqueue mutation',
			run: (manager: IntegrationManager) => manager.writePullRequest(enqueue),
			status: 403,
			reason: 'forbidden',
		},
	]) {
		test(`keeps HTTP ${status} from the ${where} scoped to the selected connection`, async () => {
			await withManager(
				({ query, authorization }) => {
					if (query.startsWith('query PullRequestWriteTarget')) {
						return { data: where === 'enqueue mutation' ? queueTarget : writeTarget };
					}

					if (
						query.startsWith('query PullRequestCreateCapability') &&
						authorization !== 'token token-selected'
					) {
						return { data: { repository: repository } };
					}

					return Response.json({ message: 'Provider refused this request' }, { status: status });
				},
				async ({ manager, runtime, calls }) => {
					const backendPaths: string[] = [];
					const prompts: string[] = [];
					assert.ok(runtime.hooks);
					runtime.hooks.onReauthenticationRequired = async message => {
						prompts.push(message);
						return false;
					};
					runtime.account.getAccount = async () => ({ id: 'test' });
					runtime.account.fetchGkApi = async path => {
						backendPaths.push(path);
						const accessToken = path.endsWith('/refresh') ? 'token-refreshed' : 'token-selected';
						return cloudToken(accessToken);
					};

					assert.deepEqual(await run(manager), { ok: false, reason: reason });
					assert.deepEqual(backendPaths, []);
					assert.equal(calls.at(-1)?.authorization, 'token token-selected');
					const writes = calls.filter(call => call.query.startsWith('mutation')).length;

					assert.equal(
						(await manager.getPullRequestCreateCapability({ ...repo, connectionId: 'primary' })).ok,
						true,
					);
					assert.deepEqual(backendPaths, []);
					const next = await manager.getPullRequestCreateCapability(repo);
					if (status === 401) {
						assert.equal(next.ok, true);
						assert.equal(calls.at(-1)?.authorization, 'token token-refreshed');
						assert.deepEqual(backendPaths, [
							'v1/provider-tokens/tokens/selected',
							'v1/provider-tokens/tokens/selected/refresh',
						]);
					} else {
						assert.deepEqual(next, { ok: false, reason: 'forbidden' });
						assert.deepEqual(backendPaths, []);
					}
					assert.deepEqual(prompts, []);
					assert.equal(calls.filter(call => call.query.startsWith('mutation')).length, writes);
				},
			);
		});
	}

	test('keeps a concurrent replacement when recovery finishes with an older credential', async () => {
		const refreshStarted = defer<void>();
		const finishRefresh = defer<void>();
		let refreshes = 0;
		await withManager(
			({ query }) => {
				if (query.startsWith('query PullRequestWriteTarget')) return { data: queueTarget };
				if (query.startsWith('query')) return { data: { repository: repository } };

				return Response.json({ message: 'Revoked credential' }, { status: 401 });
			},
			async ({ manager, runtime, calls, storeSelected }) => {
				runtime.account.getAccount = async () => ({ id: 'test' });
				runtime.account.fetchGkApi = async path => {
					if (!path.endsWith('/refresh')) {
						return cloudToken(refreshes === 0 ? 'token-selected' : 'concurrent-replacement');
					}

					if (++refreshes === 1) {
						refreshStarted.fulfill();
						await finishRefresh.promise;
						return cloudToken('older-refresh-result');
					}

					return cloudToken('token-recovered');
				};
				assert.deepEqual(await manager.writePullRequest(enqueue), { ok: false, reason: 'no-connection' });
				const reading = manager.getPullRequestCreateCapability(repo);
				await refreshStarted.promise;
				try {
					await storeSelected('concurrent-replacement');
				} finally {
					finishRefresh.fulfill();
				}
				assert.equal((await reading).ok, true);
				assert.equal(calls.at(-1)?.authorization, 'token concurrent-replacement');
				assert.deepEqual(await manager.writePullRequest(enqueue), { ok: false, reason: 'no-connection' });
				assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
				assert.equal(calls.at(-1)?.authorization, 'token token-recovered');
				assert.equal(refreshes, 2);
			},
		);
	});

	test('ignores late unauthorized replies for a replaced credential', async () => {
		await withManager(
			async ({ authorization, query }, storeSelected) => {
				if (query.startsWith('query PullRequestWriteTarget')) return { data: queueTarget };
				if (authorization === 'token token-selected') {
					await storeSelected('token-replaced');
					return Response.json({ message: 'Revoked credential' }, { status: 401 });
				}

				return { data: { repository: repository } };
			},
			async ({ manager, runtime, calls }) => {
				const backendPaths: string[] = [];
				runtime.account.getAccount = async () => ({ id: 'test' });
				runtime.account.fetchGkApi = async path => {
					backendPaths.push(path);
					return Response.json({});
				};

				assert.deepEqual(await manager.writePullRequest(enqueue), { ok: false, reason: 'no-connection' });
				assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
				assert.equal(calls.at(-1)?.authorization, 'token token-replaced');
				assert.deepEqual(backendPaths, []);
			},
		);
	});

	for (const replacement of ['stored', 'cloud']) {
		test(`preserves a ${replacement} replacement installed after a rejected write settles`, async () => {
			await withManager(
				({ query }) => {
					if (query.startsWith('query PullRequestWriteTarget')) return { data: queueTarget };
					if (query.startsWith('query')) return { data: { repository: repository } };

					return Response.json({ message: 'Revoked credential' }, { status: 401 });
				},
				async ({ manager, runtime, calls, storeSelected }) => {
					const backendPaths: string[] = [];
					runtime.account.getAccount = async () => ({ id: 'test' });
					runtime.account.fetchGkApi = async path => {
						backendPaths.push(path);
						return cloudToken('token-replaced');
					};

					assert.deepEqual(await manager.writePullRequest(enqueue), { ok: false, reason: 'no-connection' });
					if (replacement === 'stored') {
						await storeSelected('token-replaced');
					}
					assert.deepEqual(backendPaths, []);
					assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
					assert.equal(calls.at(-1)?.authorization, 'token token-replaced');
					assert.deepEqual(
						backendPaths,
						replacement === 'cloud' ? ['v1/provider-tokens/tokens/selected'] : [],
					);
				},
			);
		});
	}

	test('keeps a recovered credential when connection sync resolves an older fetch', async () => {
		const olderSelectedRead = defer<void>();
		const primaryReconciliation = defer<void>();
		const allowPrimaryResponse = defer<void>();
		await withManager(
			({ query }) => {
				if (query.startsWith('query PullRequestWriteTarget')) return { data: queueTarget };
				if (query.startsWith('query PullRequestCreateCapability')) return { data: { repository: repository } };

				return Response.json({ message: 'Revoked credential' }, { status: 401 });
			},
			async ({ manager, runtime, calls }) => {
				runtime.account.getAccount = async () => ({ id: 'test' });
				const primary = {
					tokenId: 'primary',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'primary',
				};
				const selected = { ...primary, tokenId: 'selected', accountName: 'selected' };
				runtime.account.fetchGkApi = async path => {
					switch (path) {
						case 'v1/provider-tokens':
							return Response.json({ data: [{ ...primary, secondaries: [selected] }] });
						case 'v1/provider-tokens/github':
							return cloudToken('token-primary', 'primary');
						case 'v1/provider-tokens/tokens/primary':
							primaryReconciliation.fulfill();
							await allowPrimaryResponse.promise;
							return cloudToken('token-primary', 'primary');
						case 'v1/provider-tokens/tokens/selected':
							olderSelectedRead.fulfill();
							return cloudToken('token-selected');
						case 'v1/provider-tokens/tokens/selected/refresh':
							return cloudToken('token-recovered');
						default:
							assert.fail(`Unexpected callback path: ${path}`);
					}
				};

				const sync = manager.refreshConnections();
				try {
					await Promise.all([olderSelectedRead.promise, primaryReconciliation.promise]);
					assert.deepEqual(await manager.writePullRequest(enqueue), { ok: false, reason: 'no-connection' });
					assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
					assert.equal(calls.at(-1)?.authorization, 'token token-recovered');
				} finally {
					allowPrimaryResponse.fulfill();
				}
				await sync;
				assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
				assert.equal(calls.at(-1)?.authorization, 'token token-recovered');
			},
		);
	});

	test('uses the recovered primary when a pending forced refetch returns the rejected credential', async () => {
		const refetchStarted = defer<void>();
		const finishRefetch = defer<void>();
		let primaryToken = 'token-primary';
		await withManager(
			({ query }) => {
				if (query.startsWith('query PullRequestWriteTarget')) return { data: queueTarget };
				if (query.startsWith('query PullRequestCreateCapability')) return { data: { repository: repository } };

				return Response.json({ message: 'Revoked credential' }, { status: 401 });
			},
			async ({ manager, runtime, calls }) => {
				runtime.account.getAccount = async () => ({ id: 'test' });
				runtime.account.fetchGkApi = async path => {
					switch (path) {
						case 'v1/provider-tokens':
							return Response.json({
								data: [{ provider: 'github', type: 'oauth', domain: 'github.com' }],
							});
						case 'v1/provider-tokens/github':
							refetchStarted.fulfill();
							await finishRefetch.promise;
							return cloudToken('token-primary', 'primary');
						case 'v1/provider-tokens/tokens/primary':
							return cloudToken(primaryToken, 'primary');
						case 'v1/provider-tokens/tokens/primary/refresh':
							primaryToken = 'token-recovered';
							return cloudToken(primaryToken, 'primary');
						default:
							assert.fail(`Unexpected callback path: ${path}`);
					}
				};
				const primary = { ...repo, connectionId: 'primary' };
				const sync = manager.refreshConnections();
				try {
					await refetchStarted.promise;
					assert.deepEqual(await manager.writePullRequest({ ...enqueue, ...primary }), {
						ok: false,
						reason: 'no-connection',
					});
					assert.equal((await manager.getPullRequestCreateCapability(primary)).ok, true);
				} finally {
					finishRefetch.fulfill();
				}
				await sync;
				assert.equal((await manager.getPullRequestCreateCapability(primary)).ok, true);
				assert.equal(calls.at(-1)?.authorization, 'token token-recovered');
			},
		);
	});

	test('keeps the recovered credential after a selected force refresh returns a stale absence', async () => {
		const refetchStarted = defer<void>();
		const finishRefetch = defer<void>();
		let selectedFetches = 0;
		await withManager(
			({ query }) => {
				if (query.startsWith('query PullRequestWriteTarget')) return { data: queueTarget };
				if (query.startsWith('query PullRequestCreateCapability')) return { data: { repository: repository } };
				if (query.startsWith('query')) return { data: {} };

				return Response.json({ message: 'Revoked credential' }, { status: 401 });
			},
			async ({ manager, runtime, calls }) => {
				runtime.account.getAccount = async () => ({ id: 'test' });
				runtime.account.fetchGkApi = async path => {
					switch (path) {
						case 'v1/provider-tokens/tokens/selected':
							if (++selectedFetches === 1) {
								refetchStarted.fulfill();
								await finishRefetch.promise;
								return Response.json({}, { status: 404 });
							}
							return cloudToken('token-selected');
						case 'v1/provider-tokens/tokens/selected/refresh':
							return cloudToken('token-recovered');
						default:
							assert.fail(`Unexpected callback path: ${path}`);
					}
				};
				const list = manager.listPullRequestsPage({
					providerId: repo.providerId,
					connectionId: repo.connectionId,
					forceSync: true,
					repos: [{ namespace: repo.owner, name: repo.repo }],
				});
				try {
					await refetchStarted.promise;
					assert.deepEqual(await manager.writePullRequest(enqueue), { ok: false, reason: 'no-connection' });
					assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
				} finally {
					finishRefetch.fulfill();
				}
				await list;
				assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
				assert.equal(calls.at(-1)?.authorization, 'token token-recovered');
				assert.equal(selectedFetches, 2);
			},
		);
	});

	test('resets strikes after a successful PR operation on the current primary credential', async () => {
		let refused = true;
		await withManager(
			() =>
				refused
					? Response.json({ message: 'Revoked credential' }, { status: 401 })
					: { data: { repository: repository } },
			async ({ manager, runtime, calls }) => {
				const primary = { ...repo, connectionId: 'primary' };
				const github = await manager.get(GitCloudHostIntegrationId.GitHub);
				assert.equal(await github.isConnected(), true);
				runtime.account.getAccount = async () => ({ id: 'test' });
				runtime.account.fetchGkApi = async () => cloudToken('token-primary', 'primary');
				assert.deepEqual(await manager.getPullRequestCreateCapability(primary), {
					ok: false,
					reason: 'no-connection',
				});
				refused = false;
				assert.equal((await manager.getPullRequestCreateCapability(primary)).ok, true);
				assert.equal(await github.isConnected(), true);
				for (let index = 0; index < 5; index++) {
					refused = true;
					assert.deepEqual(await manager.getPullRequestCreateCapability(primary), {
						ok: false,
						reason: 'no-connection',
					});
					refused = false;
					assert.equal((await manager.getPullRequestCreateCapability(primary)).ok, true);
				}
				await setImmediate();
				assert.equal(github.maybeConnected, true);
				assert.ok(calls.every(call => call.authorization === 'token token-primary'));
			},
		);
	});

	test('returns the provider rate-limit outcome from the queue mutation', async () => {
		await withManager(
			({ query }) =>
				query.startsWith('query')
					? { data: queueTarget }
					: { errors: [{ type: 'RATE_LIMITED', message: 'Request limit reached' }] },
			async ({ manager, calls }) => {
				assert.deepEqual(await manager.writePullRequest(enqueue), { ok: false, reason: 'rate-limit' });
				assert.equal(calls.filter(call => call.query.startsWith('mutation')).length, 1);
			},
		);
	});

	for (const [type, reason] of [
		['NOT_FOUND', 'not-found'],
		['INSUFFICIENT_SCOPES', 'forbidden'],
		['BAD_USER_INPUT', 'invalid-input'],
		['UNPROCESSABLE', 'blocked'],
	]) {
		test(`preserves the definitive ${type} queue refusal`, async () => {
			await withManager(
				({ query }) =>
					query.startsWith('query')
						? { data: queueTarget }
						: {
								errors: [
									{
										type: type,
										message: 'The queue request was refused',
										path: ['enqueuePullRequest'],
									},
								],
							},
				async ({ manager, calls }) => {
					assert.deepEqual(await manager.writePullRequest(enqueue), { ok: false, reason: reason });
					assert.equal(calls.filter(call => call.query.startsWith('mutation')).length, 1);
				},
			);
		});
	}

	for (const superseded of [false, true]) {
		test(
			superseded
				? 'skips a superseded custom recovery'
				: 'recovers a custom connection using the host refresh flag',
			async () => {
				const probeStarted = defer<void>();
				const finishProbe = defer<void>();
				await withManager(
					({ query }) => {
						if (query.startsWith('query PullRequestWriteTarget')) return { data: queueTarget };
						if (query.startsWith('query')) return { data: { repository: repository } };

						return Response.json({ message: 'Revoked credential' }, { status: 401 });
					},
					async ({ runtime, manager, calls }) => {
						const changes = new Emitter<void>();
						const refreshed: string[] = [];
						let token = 'custom-rejected';
						let pauseNextRead = false;
						assert.ok(runtime.hooks);
						runtime.hooks.createAuthenticationProvider = async () => ({
							onDidChange: changes.event,
							getSession: async ({ connectionId }, options) => {
								assert.equal(connectionId, 'selected');
								if (options?.refreshRejectedToken) {
									refreshed.push(connectionId);
									token = 'custom-refreshed';
								}
								const session: ProviderAuthenticationSession = {
									id: connectionId,
									accessToken: token,
									account: { id: 'custom-account', label: 'Custom account' },
									scopes: ['repo'],
									cloud: true,
									type: 'oauth',
									domain: 'github.com',
								};
								if (pauseNextRead) {
									pauseNextRead = false;
									probeStarted.fulfill();
									await finishProbe.promise;
								}
								return session;
							},
							deleteSession: async () => {},
							deleteAllSessions: async () => {},
							dispose: () => changes.dispose(),
						});
						assert.deepEqual(await manager.writePullRequest(enqueue), {
							ok: false,
							reason: 'no-connection',
						});
						assert.deepEqual(refreshed, []);
						if (superseded) {
							pauseNextRead = true;
							const pending = manager.getPullRequestCreateCapability(repo);
							await probeStarted.promise;
							try {
								token = 'custom-replacement';
								assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
							} finally {
								finishProbe.fulfill();
							}
							assert.deepEqual(await pending, { ok: false, reason: 'no-connection' });
							assert.equal(calls.at(-1)?.authorization, 'token custom-replacement');
							assert.deepEqual(refreshed, []);
							assert.deepEqual(await manager.writePullRequest(enqueue), {
								ok: false,
								reason: 'no-connection',
							});
						}
						assert.equal((await manager.getPullRequestCreateCapability(repo)).ok, true);
						assert.equal(calls.at(-1)?.authorization, 'token custom-refreshed');
						assert.deepEqual(refreshed, ['selected']);
					},
				);
			},
		);
	}

	for (const { entry, error, expected } of [
		{ entry: queueEntry, error: 'FORBIDDEN', expected: { ok: true, status: 'queued', pullRequest: snapshot } },
		{ entry: queueEntry, error: 'RATE_LIMITED', expected: { ok: true, status: 'queued', pullRequest: snapshot } },
		{ entry: null, error: 'FORBIDDEN', expected: { ok: false, reason: 'outcome-unknown' } },
	]) {
		test(`classifies nested ${error} in a queue response ${entry == null ? 'without' : 'with'} a receipt`, async () => {
			await withManager(
				({ query }) =>
					query.startsWith('query')
						? { data: queueTarget }
						: {
								data: { enqueuePullRequest: { mergeQueueEntry: entry } },
								errors: [
									{
										type: error,
										message: 'refused nested field',
										path: ['enqueuePullRequest', 'mergeQueueEntry', 'mergeQueue', 'url'],
									},
								],
							},
				async ({ manager, runtime }) => {
					assert.deepEqual(await manager.writePullRequest(enqueue), expected);
					assert.equal(runtime.deletePullRequestsCalls, 1);
				},
			);
		});
	}

	test('never shares an enqueue result across credentials with the same logging microhash', async () => {
		const tokens = { primary: 'fixture-25', selected: 'fixture-31' };
		assert.equal(microhash(tokens.primary, 3), microhash(tokens.selected, 3));
		const arrivedFirstWrite = defer<void>();
		const releaseFirstWrite = defer<void>();
		const arrivedSecondQuery = defer<void>();
		await withManager(
			async ({ authorization, query }) => {
				if (query.startsWith('query')) {
					if (authorization === `token ${tokens.selected}`) {
						arrivedSecondQuery.fulfill();
					}
					return { data: queueTarget };
				}

				if (authorization === `token ${tokens.primary}`) {
					arrivedFirstWrite.fulfill();
					await releaseFirstWrite.promise;
					return { data: { enqueuePullRequest: { mergeQueueEntry: queueEntry } } };
				}

				return { errors: [{ type: 'FORBIDDEN', message: 'cannot queue', path: ['enqueuePullRequest'] }] };
			},
			async ({ manager, calls }) => {
				const first = manager.writePullRequest({ ...enqueue, connectionId: 'primary' });
				await arrivedFirstWrite.promise;
				const second = manager.writePullRequest(enqueue);
				await arrivedSecondQuery.promise;
				await setImmediate();
				releaseFirstWrite.fulfill();
				assert.deepEqual(await Promise.all([first, second]), [
					{ ok: true, status: 'queued', pullRequest: snapshot },
					{ ok: false, reason: 'forbidden' },
				]);
				assert.equal(calls.filter(call => call.query.startsWith('mutation')).length, 2);
			},
			tokens,
		);
	});
});
