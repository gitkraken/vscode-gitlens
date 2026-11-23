import * as assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { suite, test } from 'mocha';
import { microhash } from '@gitlens/utils/hash.js';
import { defer } from '@gitlens/utils/promise.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
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
	baseRef: { id: baseRefId, branchProtectionRule: null },
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

type Call = {
	url: URL;
	authorization: string | null;
	query: string;
	variables?: Record<string, unknown>;
	canonicalIds: boolean;
};

function branchRules(nodes: object[], endCursor?: string) {
	return {
		data: {
			node: {
				id: baseRefId,
				rules: { nodes: nodes, pageInfo: { hasNextPage: endCursor != null, endCursor: endCursor ?? null } },
			},
		},
	};
}

async function withManager(
	respond: (call: Call, storeSelected: (token: string) => Promise<boolean>) => object | Promise<object>,
	run: (fixture: {
		manager: IntegrationManager;
		calls: Call[];
		runtime: ReturnType<typeof createFakeRuntime>;
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
		await run({ manager: manager, calls: calls, runtime: runtime });
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

	test('distinguishes repository create access from an unknown viewer permission', async () => {
		const permissions = ['WRITE', 'READ', null];
		await withManager(
			() => ({ data: { repository: { ...repository, viewerPermission: permissions.shift() } } }),
			async ({ manager, calls }) => {
				for (const canCreate of [true, false, undefined]) {
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

	for (const { entry, expected } of [
		{ entry: queueEntry, expected: { ok: true, status: 'queued', pullRequest: snapshot } },
		{ entry: null, expected: { ok: false, reason: 'outcome-unknown' } },
	]) {
		test(`classifies a nested queue response error ${entry == null ? 'without' : 'with'} a receipt`, async () => {
			await withManager(
				({ query }) =>
					query.startsWith('query')
						? { data: queueTarget }
						: {
								data: { enqueuePullRequest: { mergeQueueEntry: entry } },
								errors: [
									{
										type: 'FORBIDDEN',
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
