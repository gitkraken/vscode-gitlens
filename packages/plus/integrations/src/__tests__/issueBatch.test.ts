import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason, RequestRateLimitError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult, IssueEtagFields, IssueEtagInclude } from '../models/integration.js';
import { issueEtag } from '../reads/etag.js';
import { noAccess, oauthAppNotAllowed } from './azureRefusals.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import {
	connectedAzure,
	connectedBitbucket,
	connectedBitbucketServer,
	connectedGitHub,
	connectedGitLab,
	primarySession,
	stubApi,
	watchRequestFailures,
} from './sweepHelpers.js';

/**
 * The batch issue read (#5802): resolve N `(owner, repo, number)` coordinates, plus `project` on Azure DevOps.
 *
 * What these pin is the distinction the read exists for — an absent slot is a PROVEN ABSENCE, safe to cache,
 * while a target that failed — its own chunk outright, or just its own alias within an otherwise-answering
 * chunk — is not returned at all. Conflating the two is the bug this contract prevents: a caller that caches a
 * failure as an absence never re-resolves the issue. Several provider answers look like "not found" without
 * proving it (a GitLab "not found" left by a GraphQL error, an Azure 404 from a wrong path, a swallowed Azure
 * failure, a missing session); each has a test that fails if that answer is published as an absence.
 */

type Coordinate = { owner: string; repo: string; number: number; project?: string };
type Slot = PromiseSettledResult<IssueShape | undefined>;
type BatchFn = (
	coordinates: readonly Coordinate[],
	cancellation?: AbortSignal,
	connectionId?: string,
) => Promise<IntegrationResult<Slot[] | undefined>>;

function stubBatch(integration: GitHostIntegration, fn: BatchFn): void {
	(integration as unknown as { getIssuesBatchResult: BatchFn }).getIssuesBatchResult = fn;
}

/** A count of calls to `getIssuesBatchResult`, wrapping the real implementation rather than replacing it. */
function countBatchResultCalls(integration: GitHostIntegration): { calls: number } {
	const counter = { calls: 0 };
	const target = integration as unknown as { getIssuesBatchResult: BatchFn };
	const original = target.getIssuesBatchResult.bind(integration);
	target.getIssuesBatchResult = (...args) => {
		counter.calls++;
		return original(...args);
	};
	return counter;
}

/** The integration's memoized API client, whose methods a test can replace. */
async function apiClient(integration: GitHostIntegration, key: 'github' | 'gitlab'): Promise<Record<string, unknown>> {
	const { apis } = (
		integration as unknown as {
			authenticationService: { apis: Record<string, Promise<Record<string, unknown> | undefined>> };
		}
	).authenticationService;
	const client = await apis[key];
	assert.ok(client != null);
	return client;
}

function getRequestExceptionCount(integration: GitHostIntegration): number {
	return (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

const issue = (n: number) =>
	({ id: `i${n}`, title: `issue ${n}`, state: 'opened', updatedDate: new Date(0) }) as unknown as IssueShape;

function found(value: IssueShape | undefined): Slot {
	return { status: 'fulfilled', value: value };
}

function failed(reason: unknown): Slot {
	return { status: 'rejected', reason: reason };
}

const samlForbiddenMessage =
	'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.';

suite('IntegrationManager.getIssuesBatch (#5802)', () => {
	test('resolves every coordinate in one request and echoes the caller keys', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let calls = 0;
		let received: readonly { owner: string; repo: string; number: number }[] = [];
		stubBatch(gh, coordinates => {
			calls++;
			received = coordinates;
			return Promise.resolve({ value: coordinates.map(c => found(issue(c.number))) });
		});

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'left', owner: 'o', repo: 'a', number: 1 },
				{ key: 'right', owner: 'o', repo: 'b', number: 2 },
			],
		});

		assert.equal(calls, 1, 'a batch that fits a chunk costs exactly one request');
		assert.deepEqual(
			received.map(c => c.number),
			[1, 2],
		);
		assert.deepEqual(
			result.items.map(i => [i.key, i.issue?.id]),
			[
				['left', 'i1'],
				['right', 'i2'],
			],
			'results carry the caller key, not a position',
		);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('a padded owner reaches the provider trimmed', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let received: readonly { owner: string; repo: string; number: number }[] = [];
		stubBatch(gh, coordinates => {
			received = coordinates;
			return Promise.resolve({ value: coordinates.map(c => found(issue(c.number))) });
		});

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: ' o ', repo: 'a', number: 1 }],
		});

		assert.deepEqual(
			received.map(c => c.owner),
			['o'],
		);
		assert.deepEqual(
			result.items.map(i => i.key),
			['a'],
			'the result is keyed by the caller key, unaffected by trimming',
		);

		manager.dispose();
	});

	test('an absent issue is returned as a proven absence, not dropped', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubBatch(gh, coordinates =>
			Promise.resolve({ value: coordinates.map(c => found(c.number === 2 ? undefined : issue(c.number))) }),
		);

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'exists', owner: 'o', repo: 'a', number: 1 },
				{ key: 'gone', owner: 'o', repo: 'a', number: 2 },
			],
		});

		// The absent target IS present in the results with no issue: that is what makes the miss cacheable.
		assert.deepEqual(
			result.items.map(i => i.key),
			['exists', 'gone'],
		);
		assert.equal(result.items[1].issue, undefined);
		assert.equal(result.fetchFailed, undefined, 'a proven absence is not a failure');

		manager.dispose();
	});

	test('a failed chunk drops only its own targets and never reports them as absent', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const github = await apiClient(gh, 'github');
		const sizes: number[] = [];
		// 30 targets split into two chunks; the chunk holding number 1 fails.
		github.getIssuesBatch = (_p: unknown, _t: TokenWithInfo, coordinates: readonly Coordinate[]) => {
			sizes.push(coordinates.length);
			return coordinates.some(c => c.number === 1)
				? Promise.reject(new Error('batch boom'))
				: Promise.resolve(coordinates.map(c => found(issue(c.number))));
		};
		const calls = countBatchResultCalls(gh);

		const targets = Array.from({ length: 30 }, (_, i) => ({
			key: `k${i + 1}`,
			owner: 'o',
			repo: 'a',
			number: i + 1,
		}));
		const result = await manager.getIssuesBatch({ providerId: GitCloudHostIntegrationId.GitHub, targets: targets });

		assert.deepEqual(sizes, [25, 5]);
		assert.equal(calls.calls, 1, 'the chunks are one integration call, so they spend at most one strike');
		assert.equal(result.fetchFailed, true, 'the failure is surfaced');
		assert.ok(result.warnings.length > 0);
		assert.equal(result.items.length, 5, 'only the surviving chunk answers');
		assert.ok(
			!result.items.some(i => i.key === 'k1'),
			'a target whose chunk failed is absent from the results, NOT reported as a proven absence',
		);

		manager.dispose();
	});

	test('a target that fails on its own — e.g. SAML — is dropped, while the rest of its chunk still answers', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubBatch(gh, coordinates =>
			Promise.resolve({
				value: coordinates.map(c =>
					c.number === 2 ? failed(new Error(samlForbiddenMessage)) : found(issue(c.number)),
				),
			}),
		);

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'found', owner: 'o', repo: 'a', number: 1 },
				{ key: 'saml', owner: 'o', repo: 'saml-org', number: 2 },
			],
		});

		assert.deepEqual(
			result.items.map(i => i.key),
			['found'],
			'the SAML-forbidden target is dropped, never reported absent',
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0]?.kind, 'other', 'a target failing on its own is not an auth warning');
		assert.match(result.warnings[0]?.message ?? '', /SAML enforcement/);

		manager.dispose();
	});

	test('GitHub: a target that fails on its own (e.g. SAML) costs no strike or session expiry', async () => {
		// Exercises the REAL `getIssuesBatchResult`/`getProviderIssuesBatch`, not a stub of the result wrapper,
		// so `throwIfAllSettledFailed` and `handleProviderException` actually run, as they do in production.
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const github = await apiClient(gh, 'github');
		github.getIssuesBatch = (_p: unknown, _t: TokenWithInfo, coordinates: readonly Coordinate[]) =>
			Promise.resolve(
				coordinates.map((c, i) => (i === 1 ? failed(new Error(samlForbiddenMessage)) : found(issue(c.number)))),
			);
		const sessionBefore = { ...(gh as unknown as { _session: ProviderAuthenticationSession })._session };

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'found', owner: 'o', repo: 'a', number: 1 },
				{ key: 'saml', owner: 'o', repo: 'saml-org', number: 2 },
			],
		});

		assert.deepEqual(
			result.items.map(i => i.key),
			['found'],
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(getRequestExceptionCount(gh), 0, 'a working token must not spend a strike');
		assert.deepEqual(
			(gh as unknown as { _session: ProviderAuthenticationSession })._session,
			sessionBefore,
			'a working token must not have its session expired',
		);

		manager.dispose();
	});

	test('GitHub: a single SAML-forbidden target — every slot failed — still costs no strike and no session expiry', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const github = await apiClient(gh, 'github');
		github.getIssuesBatch = () => Promise.resolve([failed(new Error(samlForbiddenMessage))]);
		const sessionBefore = { ...(gh as unknown as { _session: ProviderAuthenticationSession })._session };

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'saml', owner: 'o', repo: 'saml-org', number: 2 }],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(
			getRequestExceptionCount(gh),
			0,
			'a working token must not spend a strike even when every slot failed',
		);
		assert.deepEqual(
			(gh as unknown as { _session: ProviderAuthenticationSession })._session,
			sessionBefore,
			'a working token must not have its session expired even when every slot failed',
		);

		manager.dispose();
	});

	test('refuses the whole call on a duplicate key rather than answering ambiguously', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let calls = 0;
		stubBatch(gh, coordinates => {
			calls++;
			return Promise.resolve({ value: coordinates.map(c => found(issue(c.number))) });
		});

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'same', owner: 'o', repo: 'a', number: 1 },
				{ key: 'same', owner: 'o', repo: 'a', number: 2 },
			],
		});

		assert.equal(calls, 0, 'the refusal costs no upstream request');
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /Duplicate issue batch target key/);

		manager.dispose();
	});

	test('no targets is an empty success, not a refusal', async () => {
		const { manager } = await connectedGitHub(createFakeRuntime());

		const result = await manager.getIssuesBatch({ providerId: GitCloudHostIntegrationId.GitHub, targets: [] });

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);

		manager.dispose();
	});

	test('a provider that cannot batch refuses rather than degrading into N requests', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		// What a provider with no batch hook answers: `undefined` with no error.
		stubBatch(gh, () => Promise.resolve({ value: undefined }));

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
		});

		assert.deepEqual(result.items, [], 'nothing is invented for the caller');
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /not supported/i);

		manager.dispose();
	});

	test('refuses a repository coordinate sent to an issue tracker instead of attempting it', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Linear,
			targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /takes tracker identifiers/);

		manager.dispose();
	});

	test('a lost session is reported, not answered as a batch of absences', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession | undefined })._session = undefined;
		// What the read core returns when it cannot resolve a session.
		stubBatch(gh, () => Promise.resolve(undefined));

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
			connectionId: 'gone',
		});

		assert.deepEqual(result.items, [], 'no target is reported as proven absent');
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});

	test('refuses a coordinate whose number is not a positive safe integer', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const calls = countBatchResultCalls(gh);

		for (const number of [0, -1, 1.5]) {
			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'a', owner: 'o', repo: 'r', number: number }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /expected a positive integer/);
		}
		assert.equal(calls.calls, 0, 'the refusal costs no upstream request');

		manager.dispose();
	});

	test("refuses a GitHub coordinate whose number exceeds GraphQL's 32-bit Int, but not the same number on GitLab", async () => {
		const { manager: ghManager, gh } = await connectedGitHub(createFakeRuntime());
		let ghCalls = 0;
		stubBatch(gh, coordinates => {
			ghCalls++;
			return Promise.resolve({ value: coordinates.map(() => found(undefined)) });
		});

		const ghResult = await ghManager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 2147483648 }],
		});

		assert.deepEqual(ghResult.items, []);
		assert.equal(ghResult.fetchFailed, true);
		assert.match(ghResult.warnings[0].message, /32-bit/);
		assert.equal(ghCalls, 0, 'a refusal costs no request');

		ghManager.dispose();

		const { manager: glManager, gl } = await connectedGitLab(createFakeRuntime());
		let glCalls = 0;
		stubBatch(gl, coordinates => {
			glCalls++;
			return Promise.resolve({ value: coordinates.map(() => found(undefined)) });
		});

		await glManager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: [{ key: 'a', owner: 'group', repo: 'r', number: 2147483648 }],
		});

		assert.equal(glCalls, 1, 'GitLab has no 32-bit Int limit, so the same number is not refused');

		glManager.dispose();
	});

	test('refuses a coordinate with a blank owner or repo, which would read as a missing repository', async () => {
		const { manager, gl } = await connectedGitLab(createFakeRuntime());
		const calls = countBatchResultCalls(gl);

		for (const target of [
			{ key: 'a', owner: ' ', repo: 'r', number: 1 },
			{ key: 'a', owner: 'group', repo: '', number: 1 },
		]) {
			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /requires a non-empty (owner|repo)/);
		}
		assert.equal(calls.calls, 0);

		manager.dispose();
	});

	for (const { providerId, connect } of [
		{ providerId: GitCloudHostIntegrationId.GitLab, connect: connectedGitLab },
		{ providerId: GitCloudHostIntegrationId.AzureDevOps, connect: connectedAzure },
	]) {
		test(`${providerId}: a missing session is a connection warning, never a batch of absences`, async () => {
			const runtime = createFakeRuntime();
			let requests = 0;
			runtime.http.fetch = () => {
				requests++;
				return Promise.reject(new Error('no request is expected'));
			};
			const { manager } = await connect(runtime);
			const integration = await manager.get(providerId);
			(integration as unknown as { _session: ProviderAuthenticationSession | undefined })._session = undefined;

			const result = await manager.getIssuesBatch({
				providerId: providerId,
				targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, project: 'proj' }],
			});

			assert.equal(requests, 0);
			assert.deepEqual(result.items, [], 'no target is reported as proven absent');
			assert.equal(result.fetchFailed, true);
			assert.equal(
				result.warnings[0]?.kind,
				'no-connection',
				'reported as a connection problem, not "unsupported"',
			);

			manager.dispose();
		});

		test(`${providerId}: thirty targets all failing cost at most one strike and do not disconnect`, async () => {
			const runtime = createFakeRuntime();
			// A 400 is a `RequestClientError`, which spends a strike on a cloud session, so the count below is exact.
			runtime.http.fetch = () => Promise.resolve(json(400, { message: 'bad request' }));
			let disconnected: string | undefined;
			runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };
			const { manager } = await connect(runtime);
			const integration = await manager.get(providerId);

			const result = await manager.getIssuesBatch({
				providerId: providerId,
				targets: Array.from({ length: 30 }, (_, i) => ({
					key: `k${i}`,
					owner: 'o',
					repo: 'r',
					number: i + 1,
					project: 'proj',
				})),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(
				getRequestExceptionCount(integration),
				1,
				'thirty failing targets resolved in one batch call must cost at most one strike',
			);
			assert.equal(disconnected, undefined, 'must not disconnect on a single failing batch call');

			manager.dispose();
		});
	}

	suite('GitLab', () => {
		const gitLabProject = {
			id: 'gid://gitlab/Project/9',
			fullPath: 'group/r',
			webUrl: 'https://gitlab.com/group/r',
		};

		function gitLabIssueNode(iid: number): Record<string, unknown> {
			return {
				author: {
					id: 'gid://gitlab/User/1',
					name: 'Me',
					username: 'me',
					publicEmail: null,
					avatarUrl: 'https://gitlab.com/uploads/me.png',
					webUrl: 'https://gitlab.com/me',
				},
				assignees: { nodes: [] },
				closedAt: null,
				createdAt: '2026-01-01T00:00:00Z',
				description: 'body',
				dueDate: null,
				id: `gid://gitlab/Issue/${iid}00`,
				iid: String(iid),
				labels: {
					nodes: [{ id: 'gid://gitlab/ProjectLabel/1', title: 'bug', color: '#ff0000', description: null }],
				},
				state: 'opened',
				title: `Issue ${iid}`,
				type: 'ISSUE',
				updatedAt: '2026-01-02T00:00:00Z',
				upvotes: 3,
				userNotesCount: 2,
				webUrl: `https://gitlab.com/group/r/-/issues/${iid}`,
				milestone: null,
			};
		}

		/** provider-apis' own answer for a found issue. */
		function sdkFound(iid: number): Response {
			return json(200, { data: { project: { ...gitLabProject, issue: gitLabIssueNode(iid) } } });
		}

		/**
		 * Serves provider-apis' single-issue read (`sdk`), its repo-scoped list read (`list`) and GitLens' own
		 * confirming read (`own`), by operation, counting each.
		 */
		function gitLabGraphQL(
			runtime: FakeRuntime,
			responses: { sdk?: (iid: number) => Response; own?: (iid: number) => Response; list?: () => Response },
		): { sdk: number; own: number; list: number; urls: string[] } {
			const calls = { sdk: 0, own: 0, list: 0, urls: [] as string[] };
			runtime.http.fetch = (input, init) => {
				calls.urls.push(input.toString());
				const body = typeof init?.body === 'string' ? init.body : '';
				const { variables } = JSON.parse(body) as { variables?: Record<string, unknown> };
				if (body.includes('GetSingleIssue') && responses.sdk != null) {
					calls.sdk++;
					return Promise.resolve(responses.sdk(Number(variables?.issueNumber)));
				}
				if (body.includes('hasIssue') && responses.own != null) {
					calls.own++;
					return Promise.resolve(responses.own(Number(variables?.iid)));
				}
				if (body.includes('GetIssuesFromProject') && responses.list != null) {
					calls.list++;
					return Promise.resolve(responses.list());
				}
				return Promise.reject(new Error(`unexpected request: ${body}`));
			};
			return calls;
		}

		const target = { key: 'a', owner: 'group', repo: 'r', number: 7 };

		test('answers found, absent and failed targets in one integration call, dropping only the failed one', async () => {
			const runtime = createFakeRuntime();
			gitLabGraphQL(runtime, {
				sdk: iid => {
					switch (iid) {
						case 1:
							return sdkFound(1);
						case 2:
							return json(200, { data: { project: { ...gitLabProject, issue: null } } });
						default:
							return json(500, { message: 'upstream exploded' });
					}
				},
				own: () => json(200, { data: { project: { issue: null } } }),
			});
			const { manager, gl } = await connectedGitLab(runtime);
			const calls = countBatchResultCalls(gl);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [
					{ key: 'found', owner: 'group', repo: 'r', number: 1 },
					{ key: 'absent', owner: 'group', repo: 'r', number: 2 },
					{ key: 'failed', owner: 'group', repo: 'r', number: 3 },
				],
			});

			assert.equal(calls.calls, 1, 'every target is resolved in one integration call, not one per target');
			assert.deepEqual(
				result.items.map(i => [i.key, i.issue?.id]),
				[
					['found', '1'],
					['absent', undefined],
				],
				'the failed target is dropped, never reported absent',
			);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a missing project that our own read confirms is a proven absence', async () => {
			const runtime = createFakeRuntime();
			const calls = gitLabGraphQL(runtime, {
				sdk: () => json(200, { data: { project: null } }),
				own: () => json(200, { data: { project: null } }),
			});
			const { manager } = await connectedGitLab(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [target],
			});

			assert.deepEqual([calls.sdk, calls.own], [1, 1]);
			assert.deepEqual(result.items, [{ key: 'a' }]);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		// provider-apis ignores a reply's GraphQL `errors` and reports the null it leaves as "not found".
		test('a "not found" that came from a GraphQL error fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			const failure = () =>
				json(200, { data: { project: null }, errors: [{ message: 'Timeout on validation of query' }] });
			const calls = gitLabGraphQL(runtime, { sdk: failure, own: failure });
			const { manager } = await connectedGitLab(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [target],
			});

			assert.deepEqual(result.items, [], 'an unconfirmed "not found" is never published as an absence');
			assert.equal(result.fetchFailed, true);
			assert.deepEqual([calls.sdk, calls.own], [1, 1]);

			manager.dispose();
		});

		test('an empty response fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			const calls = gitLabGraphQL(runtime, { sdk: () => json(200, {}), own: () => json(200, {}) });
			const { manager } = await connectedGitLab(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual([calls.sdk, calls.own], [1, 1]);

			manager.dispose();
		});

		// GitLab's GraphQL answers a genuine miss with 200 and a null node, never a 404: a 404 means the read hit
		// the wrong endpoint or host.
		test('a 404 fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			const calls = gitLabGraphQL(runtime, {
				sdk: () => json(404, { message: '404 Not Found' }),
				own: () => json(200, { data: { project: null } }),
			});
			const { manager } = await connectedGitLab(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual([calls.sdk, calls.own], [1, 0], 'a status error is a failure, so nothing is confirmed');

			manager.dispose();
		});

		test('an issue our own read finds after provider-apis missed it fails rather than answering thinner', async () => {
			const runtime = createFakeRuntime();
			gitLabGraphQL(runtime, {
				sdk: () => json(200, { data: { project: { ...gitLabProject, issue: null } } }),
				own: iid => json(200, { data: { project: { issue: { iid: String(iid) } } } }),
			});
			const { manager } = await connectedGitLab(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a hit is converted exactly like the repo-scoped list read, and needs no confirming read', async () => {
			const runtime = createFakeRuntime();
			const calls = gitLabGraphQL(runtime, {
				sdk: sdkFound,
				list: () =>
					json(200, {
						data: {
							project: {
								...gitLabProject,
								issues: {
									pageInfo: { hasNextPage: false, endCursor: null },
									nodes: [gitLabIssueNode(7)],
								},
							},
						},
					}),
			});
			const { manager } = await connectedGitLab(runtime);

			const list = await manager.listIssuesPage({
				providerId: GitCloudHostIntegrationId.GitLab,
				repos: [{ namespace: 'group', name: 'r' }],
			});
			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [target],
			});

			assert.equal(calls.own, 0);
			const issue = result.items[0]?.issue;
			assert.ok(issue != null && list.items[0] != null);
			// The tag names the read, so the two rows' tags differ; every other field is the same conversion.
			const { projection, ...listed } = list.items[0];
			const { projection: batchProjection, ...batched } = issue;
			assert.equal(projection, 'repos');
			assert.equal(batchProjection, 'batch');
			assert.deepEqual(batched, listed);
			// Neither is set by GitLens' own GitLab issue conversion, only by the list read's.
			assert.deepEqual(issue.labels, [{ name: 'bug', color: '#ff0000' }]);
			assert.equal(issue.thumbsUpCount, 3);

			manager.dispose();
		});

		test('self-managed: both reads go to the connection host', async () => {
			const runtime = createFakeRuntime();
			const calls = gitLabGraphQL(runtime, {
				sdk: () => json(200, { data: { project: null } }),
				own: () => json(200, { data: { project: null } }),
			});
			const manager = createIntegrationManager(runtime);
			const gl = await manager.get(GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'gitlab.example.com');
			assert.ok(gl != null);
			(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'gitlab.example.com',
			};

			const result = await manager.getIssuesBatch({
				providerId: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
				domain: 'gitlab.example.com',
				targets: [target],
			});

			assert.deepEqual(result.items, [{ key: 'a' }]);
			assert.equal(calls.urls.length, 2);
			for (const url of calls.urls) {
				assert.ok(url.startsWith('https://gitlab.example.com/'), url);
			}

			manager.dispose();
		});

		test('six targets whose confirming reads time out cost one strike and one notice, and do not disconnect', async () => {
			const runtime = createFakeRuntime();
			gitLabGraphQL(runtime, {
				sdk: () => json(200, { data: { project: null } }),
				own: () => json(502, { message: 'upstream request timeout' }),
			});
			const { manager, gl } = await connectedGitLab(runtime);
			const watched = watchRequestFailures(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: Array.from({ length: 6 }, (_, i) => ({
					key: `k${i}`,
					owner: 'group',
					repo: 'r',
					number: i + 1,
				})),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(getRequestExceptionCount(gl), 1, 'one strike for the whole call');
			assert.deepEqual(watched.notices, ['GitLab timed out'], 'one notice for the whole call');
			assert.equal(watched.disconnected, undefined);

			manager.dispose();
		});
	});

	suite('Azure DevOps', () => {
		const target = { key: 'a', owner: 'org', repo: 'r', number: 7, project: 'proj' };

		function azureWorkItem(id: number): Record<string, unknown> {
			const identity = (id: string, name: string) => ({
				displayName: name,
				id: id,
				uniqueName: `${id}@example.com`,
				_links: { avatar: { href: `https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/${id}` } },
			});
			return {
				id: id,
				rev: 3,
				fields: {
					'System.TeamProject': 'proj',
					'System.IterationPath': 'proj\\Sprint 5',
					'System.WorkItemType': 'Bug',
					'System.State': 'Active',
					'System.AssignedTo': identity('u1', 'Me'),
					'System.CreatedDate': '2026-01-01T00:00:00.123Z',
					'System.CreatedBy': identity('u2', 'Author'),
					'System.ChangedDate': '2026-01-02T00:00:00Z',
					'System.CommentCount': 4,
					'System.Title': `Work item ${id}`,
					'System.Description': '<p>body</p>',
					'System.Tags': 'backend; urgent',
				},
				_links: { html: { href: `https://dev.azure.com/org/proj/_workitems/edit/${id}` } },
				url: `https://dev.azure.com/org/5c04afe4/_apis/wit/workItems/${id}`,
			};
		}

		function azureRespond(runtime: FakeRuntime, respond: (url: string) => Response): { urls: string[] } {
			const urls: string[] = [];
			runtime.http.fetch = input => {
				const url = input.toString();
				urls.push(url);
				return Promise.resolve(respond(url));
			};
			return { urls: urls };
		}

		function workItemId(url: string): number {
			return Number(/\/_apis\/wit\/workitems\/(\d+)\?/.exec(url)?.[1]);
		}

		test('refuses a target that names no project', async () => {
			const runtime = createFakeRuntime();
			const requests = azureRespond(runtime, () => json(200, azureWorkItem(7)));
			const { manager } = await connectedAzure(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [{ key: 'a', owner: 'org', repo: 'r', number: 7 }],
			});

			assert.deepEqual(requests.urls, []);
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /requires a project/);

			manager.dispose();
		});

		test('answers found, absent and failed targets in one integration call, dropping only the failed one', async () => {
			const runtime = createFakeRuntime();
			const requests = azureRespond(runtime, url => {
				switch (workItemId(url)) {
					case 7:
						return json(200, azureWorkItem(7));
					case 8:
						return json(404, {
							message: 'TF401232: Work item 8 does not exist, or you do not have permissions to read it.',
							typeKey: 'WorkItemUnauthorizedAccessException',
						});
					default:
						return json(500, { message: 'upstream exploded' });
				}
			});
			const { manager, azure } = await connectedAzure(runtime);
			const calls = countBatchResultCalls(azure);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [
					// Work items belong to the project, so the repo is not read.
					{ key: 'found', owner: 'org', repo: '', number: 7, project: 'proj' },
					{ key: 'absent', owner: 'org', repo: 'r', number: 8, project: 'proj' },
					{ key: 'failed', owner: 'org', repo: 'r', number: 9, project: 'proj' },
				],
			});

			assert.equal(calls.calls, 1, 'every target is resolved in one integration call, not one per target');
			assert.match(requests.urls[0], /^https:\/\/dev\.azure\.com\/org\/proj\/_apis\/wit\/workitems\/7\?/);
			assert.deepEqual(
				result.items.map(i => [i.key, i.issue?.id]),
				[
					['found', '7'],
					['absent', undefined],
				],
				'the failed target is dropped, never reported absent',
			);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a 404 naming the project as missing is a proven absence', async () => {
			const runtime = createFakeRuntime();
			azureRespond(runtime, () =>
				json(404, {
					message: 'TF200016: The following project does not exist: proj.',
					typeKey: 'ProjectDoesNotExistWithNameException',
				}),
			);
			const { manager } = await connectedAzure(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(result.items, [{ key: 'a' }]);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		// A wrong path (e.g. an Azure DevOps Server virtual directory or collection misconfigured) also answers 404,
		// often with an IIS/HTML page rather than Azure's own not-found shape.
		test('a 404 with an HTML body fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			azureRespond(
				runtime,
				() =>
					new Response('<html><body>Not Found</body></html>', {
						status: 404,
						headers: { 'content-type': 'text/html' },
					}),
			);
			const { manager } = await connectedAzure(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a 404 JSON body with an unrecognized typeKey fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			azureRespond(runtime, () => json(404, { typeKey: 'SomeOtherException', message: 'nope' }));
			const { manager } = await connectedAzure(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		// `throwProviderError` classifies a 410 as not-found alongside 404, but only Azure's own not-found body can
		// prove absence; the existing single work item read swallows a 500 into "not found".
		for (const status of [410, 500]) {
			test(`a ${status} fails the target instead of reporting it absent`, async () => {
				const runtime = createFakeRuntime();
				azureRespond(runtime, () => json(status, { message: `status ${status}` }));
				const { manager } = await connectedAzure(runtime);

				const result = await manager.getIssuesBatch({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					targets: [target],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);

				manager.dispose();
			});
		}

		test('an empty response fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			azureRespond(
				runtime,
				() => new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
			);
			const { manager } = await connectedAzure(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		// Work item ids are unique across the organization, so the route's project is not trusted to scope the read.
		test('a work item from another project fails the target rather than answering for this one', async () => {
			const runtime = createFakeRuntime();
			azureRespond(runtime, url => {
				const id = workItemId(url);
				const workItem = azureWorkItem(id);
				if (id === 8) {
					(workItem.fields as Record<string, unknown>)['System.TeamProject'] = 'other';
				}
				return json(200, workItem);
			});
			const { manager } = await connectedAzure(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [
					// Azure compares project names case-insensitively.
					{ key: 'same', owner: 'org', repo: 'r', number: 7, project: 'PROJ' },
					{ key: 'other', owner: 'org', repo: 'r', number: 8, project: 'proj' },
				],
			});

			assert.deepEqual(
				result.items.map(i => [i.key, i.issue?.id]),
				[['same', '7']],
			);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a hit is converted exactly like the repo-scoped list read', async () => {
			const runtime = createFakeRuntime();
			azureRespond(runtime, url => {
				if (url.includes('/_apis/wit/wiql')) return json(200, { workItems: [{ id: 7 }] });
				if (url.includes('/_apis/wit/workitemsbatch')) return json(200, { value: [azureWorkItem(7)] });

				return json(200, azureWorkItem(7));
			});
			const { manager } = await connectedAzure(runtime);

			const list = await manager.listIssuesPage({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				repos: [{ namespace: 'org', name: 'r', project: 'proj' }],
			});
			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			const issue = result.items[0]?.issue;
			assert.ok(issue != null && list.items[0] != null);
			assert.equal(list.items.length, 1);
			// The tag names the read, so the two rows' tags differ. The reaction count does too: provider-apis fills a
			// literal 0, which GitLens' copy leaves unset, since work items have no reactions. Every other field is the
			// same conversion.
			const { projection, thumbsUpCount: listedThumbsUp, ...listed } = list.items[0];
			const { projection: batchProjection, thumbsUpCount: batchedThumbsUp, ...batched } = issue;
			assert.equal(projection, 'repos');
			assert.equal(batchProjection, 'batch');
			assert.equal(listedThumbsUp, 0);
			assert.equal(batchedThumbsUp, undefined);
			assert.deepEqual(batched, listed);
			// Set by the list read's conversion, and by neither half of GitLens' own work item conversion.
			assert.deepEqual(
				issue.labels?.map(l => l.name),
				['backend', 'urgent'],
			);
			assert.equal(issue.issueType, 'Bug');
			assert.equal(issue.url, 'https://dev.azure.com/org/proj/_workitems/edit/7');

			manager.dispose();
		});

		test('Server: the read goes to the connection host', async () => {
			const runtime = createFakeRuntime();
			const requests = azureRespond(runtime, () => json(200, azureWorkItem(7)));
			const manager = createIntegrationManager(runtime);
			const server = await manager.get(GitSelfManagedHostIntegrationId.AzureDevOpsServer, 'ado.example.com');
			assert.ok(server != null);
			(server as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'ado.example.com',
			};

			const result = await manager.getIssuesBatch({
				providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
				domain: 'ado.example.com',
				targets: [{ ...target, owner: 'DefaultCollection' }],
			});

			assert.equal(result.items[0]?.issue?.id, '7');
			assert.match(
				requests.urls[0],
				/^https:\/\/ado\.example\.com\/DefaultCollection\/proj\/_apis\/wit\/workitems\/7\?/,
			);

			manager.dispose();
		});
	});

	suite('Bitbucket', () => {
		for (const { providerId, connect } of [
			{ providerId: GitCloudHostIntegrationId.Bitbucket, connect: connectedBitbucket },
			{ providerId: GitSelfManagedHostIntegrationId.BitbucketServer, connect: connectedBitbucketServer },
		]) {
			test(`${providerId}: refuses as a host with no issues`, async () => {
				const runtime = createFakeRuntime();
				let requests = 0;
				runtime.http.fetch = () => {
					requests++;
					return Promise.reject(new Error('no request is expected'));
				};
				const { manager } = await connect(runtime);

				const result = await manager.getIssuesBatch({
					providerId: providerId,
					targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1 }],
				});

				assert.equal(requests, 0);
				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /Issues are not supported by/);

				manager.dispose();
			});
		}
	});

	suite('scoped refusals (#5890)', () => {
		/**
		 * An Azure DevOps connection whose work item reads refuse a project with `refusal`, or answer that the work
		 * item is absent. `probe` answers the profile request that confirms the credential.
		 */
		async function azureRefusing(
			refusal: (project: string) => Error | undefined,
			probe: () => Promise<unknown>,
			cloud: boolean = true,
		) {
			const { manager, azure } = await connectedAzure(createFakeRuntime());
			const session = { ...primarySession('t'), domain: 'dev.azure.com', cloud: cloud };
			(azure as unknown as { _session: ProviderAuthenticationSession })._session = session;
			const checks = { probes: 0 };
			stubApi(azure, {
				getAzureWorkItem: (_t: unknown, project: { project: string }) => {
					const refused = refusal(project.project);
					return refused != null ? Promise.reject(refused) : Promise.resolve(undefined);
				},
				getCurrentUser: () => {
					checks.probes++;
					return probe();
				},
			});
			return { manager: manager, azure: azure, session: session, checks: checks };
		}

		function authWarnings(result: { warnings: { kind: string; scope?: unknown; cause?: unknown }[] }) {
			return result.warnings.filter(w => w.kind === 'auth').map(w => ({ scope: w.scope, cause: w.cause }));
		}

		// Work items belong to the project, so no repository is named: not in the target, nor in the scope.
		const refusedTargets = [
			{ key: 'a', owner: 'org', repo: '', number: 1, project: 'proj' },
			{ key: 'b', owner: 'org', repo: '', number: 2, project: 'proj' },
			{ key: 'c', owner: 'org', repo: '', number: 3, project: 'other' },
		];

		test('Azure: every target refused, by a credential the probe confirms, is scoped to its organization and costs nothing', async () => {
			const { manager, azure, session, checks } = await azureRefusing(
				project => (project === 'proj' ? oauthAppNotAllowed() : noAccess()),
				() => Promise.resolve({ id: 'guid-1' }),
			);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: refusedTargets,
			});

			assert.deepEqual(result.items, [], 'a refused target is dropped, never reported absent');
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(authWarnings(result), [
				{ scope: { resourceId: 'org', projectId: 'proj' }, cause: { reason: 'oauth-app-not-allowed' } },
				{
					scope: { resourceId: 'org', projectId: 'other' },
					cause: { reason: 'access-denied', code: 'TF400813' },
				},
			]);
			assert.equal(checks.probes, 1);
			assert.equal(getRequestExceptionCount(azure), 0, 'a confirmed credential spends no strike');
			assert.deepEqual(
				(azure as unknown as { _session: ProviderAuthenticationSession })._session,
				session,
				'and keeps its session',
			);

			manager.dispose();
		});

		test('Azure: a probe that refuses the credential fails the batch as a connection failure, as before', async () => {
			const { manager, azure, checks } = await azureRefusing(
				() => oauthAppNotAllowed(),
				// The profile request's answer to a dead token, which is also what those organizations answered.
				() => Promise.reject(oauthAppNotAllowed()),
				// A local session takes the direct strike path, so the count is exact.
				false,
			);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: refusedTargets,
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(authWarnings(result), [{ scope: undefined, cause: undefined }]);
			assert.equal(checks.probes, 1, 'the credential was checked before the refusals were trusted');
			assert.equal(getRequestExceptionCount(azure), 1, 'one strike for the whole call');

			manager.dispose();
		});

		test('Azure: a target refused while every other target failed for another reason fails the call on that other reason', async () => {
			const { manager, azure, session, checks } = await azureRefusing(
				project => (project === 'denied' ? oauthAppNotAllowed() : new Error('socket hang up')),
				() => Promise.resolve({ id: 'guid-1' }),
			);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [
					// First, so failing on the first rejection would fail on the refusal.
					{ key: 'refused', owner: 'org', repo: '', number: 1, project: 'denied' },
					{ key: 'failed', owner: 'org', repo: '', number: 2, project: 'ok' },
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(authWarnings(result), [], 'the call failed on the other reason, not on the refusal');
			assert.equal(checks.probes, 0);
			assert.deepEqual(
				(azure as unknown as { _session: ProviderAuthenticationSession })._session,
				session,
				"one target's refusal does not expire the session",
			);

			manager.dispose();
		});

		test('Azure: a target refused while another answered is scoped without a probe', async () => {
			const { manager, azure, session, checks } = await azureRefusing(
				project => (project === 'denied' ? oauthAppNotAllowed() : undefined),
				() => Promise.resolve({ id: 'guid-1' }),
			);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [
					{ key: 'answered', owner: 'org', repo: '', number: 1, project: 'ok' },
					{ key: 'refused', owner: 'org', repo: '', number: 2, project: 'denied' },
				],
			});

			assert.deepEqual(result.items, [{ key: 'answered' }]);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(authWarnings(result), [
				{ scope: { resourceId: 'org', projectId: 'denied' }, cause: { reason: 'oauth-app-not-allowed' } },
			]);
			assert.equal(checks.probes, 0, 'the answered target already proved the credential');
			assert.equal(getRequestExceptionCount(azure), 0);
			assert.deepEqual((azure as unknown as { _session: ProviderAuthenticationSession })._session, session);

			manager.dispose();
		});

		test('Azure: a confirmed credential is remembered, so a second refused batch probes nothing', async () => {
			const { manager, checks } = await azureRefusing(
				() => oauthAppNotAllowed(),
				() => Promise.resolve({ id: 'guid-1' }),
			);
			const read = () =>
				manager.getIssuesBatch({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					targets: [{ key: 'a', owner: 'org', repo: '', number: 1, project: 'proj' }],
				});

			await read();
			const second = await read();

			assert.equal(checks.probes, 1);
			assert.deepEqual(authWarnings(second), [
				{ scope: { resourceId: 'org', projectId: 'proj' }, cause: { reason: 'oauth-app-not-allowed' } },
			]);

			manager.dispose();
		});

		test('GitHub: a target refused while another answered is scoped to its repository, with no probe to make', async () => {
			const { manager, gh } = await connectedGitHub(createFakeRuntime());
			const github = await apiClient(gh, 'github');
			github.getIssuesBatch = (_p: unknown, _t: TokenWithInfo, coordinates: readonly Coordinate[]) =>
				Promise.resolve(
					coordinates.map(c =>
						c.repo === 'denied'
							? failed(
									new AuthenticationError(
										{
											providerId: GitCloudHostIntegrationId.GitHub,
											microHash: undefined,
											cloud: true,
											type: 'oauth',
											scopes: [],
										},
										AuthenticationErrorReason.Forbidden,
									),
								)
							: found(issue(c.number)),
					),
				);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [
					{ key: 'found', owner: 'o', repo: 'a', number: 1 },
					{ key: 'refused', owner: 'o', repo: 'denied', number: 2 },
				],
			});

			assert.deepEqual(
				result.items.map(i => i.key),
				['found'],
			);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(authWarnings(result), [{ scope: { repositoryId: 'o/denied' }, cause: undefined }]);

			manager.dispose();
		});
	});
});

type EtagSlot = PromiseSettledResult<IssueEtagFields | undefined>;
type EtagFieldsResultFn = (
	coordinates: readonly Coordinate[],
	options: { etagIncludes?: readonly IssueEtagInclude[] },
	cancellation?: AbortSignal,
	connectionId?: string,
) => Promise<IntegrationResult<EtagSlot[] | undefined>>;

/** Records every full read's target numbers; issue `n` at `version` was updated at `version` seconds. */
function stubFullReads(integration: GitHostIntegration, version: (n: number) => number = () => 0): number[][] {
	const calls: number[][] = [];
	stubBatch(integration, coordinates => {
		calls.push(coordinates.map(c => c.number));
		return Promise.resolve({ value: coordinates.map(c => found(versionedIssue(c.number, version(c.number)))) });
	});
	return calls;
}

function stubEtagFieldsResult(
	integration: GitHostIntegration,
	answer: (coordinates: readonly Coordinate[]) => Promise<IntegrationResult<EtagSlot[] | undefined>>,
	options?: { etagIncludes?: readonly IssueEtagInclude[] }[],
): number[][] {
	const calls: number[][] = [];
	(integration as unknown as { getIssuesEtagFieldsResult: EtagFieldsResultFn }).getIssuesEtagFieldsResult = (
		coordinates,
		callOptions,
	) => {
		calls.push(coordinates.map(c => c.number));
		options?.push(callOptions);
		return answer(coordinates);
	};
	return calls;
}

function versionedIssue(n: number, version: number = 0): IssueShape {
	return { ...issue(n), updatedDate: new Date(1000 * version) };
}

/** The issue's number names the target only: an issue etag covers its change state, not its identity. */
function heldEtag(_n: number, version: number = 0): string {
	return issueEtag({ state: 'opened', updatedDate: new Date(1000 * version) }, []);
}

function etagFields(_n: number, version: number = 0): EtagSlot {
	return { status: 'fulfilled', value: { state: 'opened', updatedDate: new Date(1000 * version) } };
}

/**
 * Etags on the coordinate issue batch: the pull-request read's flow (see `pullRequestBatch.test.ts`), pinned again
 * here because the issue read wires its own cheap check.
 */
suite('IntegrationManager.getIssuesBatch etags', () => {
	test('no etags: one full call and no cheap check, and every found row carries an etag', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		const cheap = stubEtagFieldsResult(gh, () => Promise.reject(new Error('no etag was sent')));

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1 },
				{ key: 'b', owner: 'o', repo: 'r', number: 2 },
			],
		});

		assert.deepEqual(full, [[1, 2]]);
		assert.deepEqual(cheap, []);
		assert.deepEqual(
			result.items.map(i => [i.key, i.issue?.id, i.etag]),
			[
				['a', 'i1', heldEtag(1)],
				['b', 'i2', heldEtag(2)],
			],
		);

		manager.dispose();
	});

	test('every etag matches: every row is unchanged and nothing is read in full', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, coordinates => Promise.resolve({ value: coordinates.map(c => etagFields(c.number)) }));

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'b', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
			],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(result, {
			items: [
				{ key: 'a', unchanged: true, etag: heldEtag(1) },
				{ key: 'b', unchanged: true, etag: heldEtag(2) },
			],
			warnings: [],
			fetchFailed: undefined,
		});

		manager.dispose();
	});

	test('a mixed batch reads the new targets alongside the cheap check, then the changed ones, in target order', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh, n => (n === 3 ? 1 : 0));
		let resolveCheck!: (value: IntegrationResult<EtagSlot[] | undefined>) => void;
		const cheap = stubEtagFieldsResult(gh, () => new Promise(resolve => (resolveCheck = resolve)));

		const pending = manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'new', owner: 'o', repo: 'r', number: 1 },
				{ key: 'same', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
				{ key: 'moved', owner: 'o', repo: 'r', number: 3, etag: heldEtag(3, 0) },
				{ key: 'gone', owner: 'o', repo: 'r', number: 4, etag: heldEtag(4) },
			],
		});

		for (let i = 0; i < 20 && full.length === 0; i++) {
			await Promise.resolve();
		}
		assert.deepEqual(full, [[1]], 'the new target is read in full before the cheap check settles');
		assert.deepEqual(cheap, [[2, 3, 4]]);

		resolveCheck({ value: [etagFields(2), etagFields(3, 1), { status: 'fulfilled', value: undefined }] });
		const result = await pending;

		assert.deepEqual(full, [[1], [3]]);
		assert.deepEqual(
			result.items.map(i => [i.key, i.issue?.id, i.unchanged, i.etag]),
			[
				['new', 'i1', undefined, heldEtag(1)],
				['same', undefined, true, heldEtag(2)],
				['moved', 'i3', undefined, heldEtag(3, 1)],
				['gone', undefined, undefined, undefined],
			],
		);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('a target the cheap check failed for its own reason falls through, its warning dropped once answered', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, () =>
			Promise.resolve({ value: [{ status: 'rejected', reason: new Error(samlForbiddenMessage) }] }),
		);

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) }],
		});

		assert.deepEqual(full, [[1]]);
		assert.deepEqual(
			result.items.map(i => i.issue?.id),
			['i1'],
		);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('a rate-limited target is dropped with that warning, never retried in full', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, () =>
			Promise.resolve({
				value: [
					etagFields(1),
					{
						status: 'rejected',
						reason: new RequestRateLimitError(new Error('rate limited'), undefined, undefined),
					},
				],
			}),
		);

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'b', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
			],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(
			result.items.map(i => i.key),
			['a'],
		);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['rate-limit'],
		);

		manager.dispose();
	});

	test('a cheap check refused outright on the credential drops every target it held, without a full read', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, () =>
			Promise.resolve({
				error: new AuthenticationError(
					{ providerId: 'github', microHash: undefined, cloud: true, type: 'oauth', scopes: [] },
					AuthenticationErrorReason.Unauthorized,
				),
			}),
		);

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) }],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['auth'],
		);

		manager.dispose();
	});

	suite('failure budget: the cheap check spends a strike only for a refused credential', () => {
		/** Fails every request with a 500, counting the cheap checks and full reads. */
		function serveOutage(runtime: FakeRuntime): { check: number; full: number } {
			const asked = { check: 0, full: 0 };
			runtime.http.fetch = (_url, init) => {
				const body = typeof init?.body === 'string' ? init.body : '';
				if (body.includes('getIssuesEtagFieldsBatch')) {
					asked.check++;
				} else if (body.includes('getIssuesBatch')) {
					asked.full++;
				}
				return Promise.resolve(json(500, { message: 'Server Error' }));
			};
			return asked;
		}

		const etagged = [
			{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
			{ key: 'b', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
		];

		test('a total outage of a fully etagged batch spends one strike and shows one notice', async () => {
			const runtime = createFakeRuntime();
			const asked = serveOutage(runtime);
			const { manager, gh } = await connectedGitHub(runtime);
			const watched = watchRequestFailures(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: etagged,
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual([asked.check, asked.full], [1, 1], 'every target fell through to one full read');
			assert.equal(getRequestExceptionCount(gh), 1, 'the full read spends the only strike');
			assert.equal(watched.notices.length, 1);
			assert.equal(watched.disconnected, undefined);

			manager.dispose();
		});

		test('a total outage of a mixed batch spends at most two strikes, one per full read', async () => {
			const runtime = createFakeRuntime();
			const asked = serveOutage(runtime);
			const { manager, gh } = await connectedGitHub(runtime);
			const watched = watchRequestFailures(runtime);

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [...etagged, { key: 'new', owner: 'o', repo: 'r', number: 3 }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual([asked.check, asked.full], [1, 2]);
			assert.equal(getRequestExceptionCount(gh), 2, 'one strike per full read, none for the cheap check');
			assert.equal(watched.notices.length, 2);

			manager.dispose();
		});
	});

	test('a host with no cheap check makes one full call, etags and all', async () => {
		const { manager, azure } = await connectedAzure(createFakeRuntime());
		// Every git host with issues has a cheap check, so one without is made by removing Azure DevOps' hook, which
		// is what `supportsIssueEtags` reads.
		(azure as unknown as { getProviderIssuesEtagFields: undefined }).getProviderIssuesEtagFields = undefined;
		assert.equal(azure.supportsIssueEtags, false);
		const full = stubFullReads(azure);

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1, project: 'p', etag: heldEtag(1) },
				{ key: 'b', owner: 'o', repo: 'r', number: 2, project: 'p' },
			],
		});

		assert.deepEqual(full, [[1, 2]]);
		assert.deepEqual(
			result.items.map(i => [i.key, i.unchanged, i.etag]),
			[
				['a', undefined, heldEtag(1)],
				['b', undefined, heldEtag(2)],
			],
		);

		manager.dispose();
	});

	test('a duplicate key is still refused before any request', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		const cheap = stubEtagFieldsResult(gh, () => Promise.reject(new Error('must not be called')));

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'same', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'same', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
			],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(cheap, []);
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});

	test("'reactions' reaches the cheap check normalized, and its etag matches whatever the order and repeats", async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		const options: { etagIncludes?: readonly IssueEtagInclude[] }[] = [];
		stubEtagFieldsResult(
			gh,
			coordinates =>
				Promise.resolve({
					value: coordinates.map((): EtagSlot => ({
						status: 'fulfilled',
						value: { state: 'opened', updatedDate: new Date(0), thumbsUpCount: 2 },
					})),
				}),
			options,
		);
		const held = issueEtag({ state: 'opened', updatedDate: new Date(0), thumbsUpCount: 2 }, ['reactions']);

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: held }],
			etagIncludes: ['reactions', 'reactions'],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(options, [{ etagIncludes: ['reactions'] }], 'the hook gets the normalized set');
		assert.deepEqual(result.items, [{ key: 'a', unchanged: true, etag: held }]);

		manager.dispose();
	});

	test('an etag minted without reactions reads as changed under them, and the row comes back with the new one', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, coordinates => Promise.resolve({ value: coordinates.map(c => etagFields(c.number)) }));

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) }],
			etagIncludes: ['reactions'],
		});

		assert.deepEqual(full, [[1]]);
		assert.equal(result.items[0].unchanged, undefined);
		assert.match(result.items[0].etag ?? '', /^is1\+reactions:/);

		manager.dispose();
	});

	for (const [form, providerId, target] of [
		[
			'coordinate',
			GitCloudHostIntegrationId.GitHub,
			{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
		],
		['tracker', IssuesCloudHostIntegrationId.Linear, { key: 'a', resourceId: 'team', identifier: 'ABC-1' }],
	] as const) {
		test(`an unknown etagIncludes value refuses the whole call before any request (${form} form)`, async () => {
			const { manager, gh } = await connectedGitHub(createFakeRuntime());
			const full = stubFullReads(gh);
			const cheap = stubEtagFieldsResult(gh, () => Promise.reject(new Error('must not be called')));

			const result = await manager.getIssuesBatch({
				providerId: providerId,
				targets: [target],
				etagIncludes: ['reactions', 'votes'] as unknown as IssueEtagInclude[],
			});

			assert.deepEqual(full, []);
			assert.deepEqual(cheap, []);
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /Unknown issue etag include 'votes'/);
			assert.match(result.warnings[0].message, /expected one of 'reactions'/);

			manager.dispose();
		});
	}
});

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}
