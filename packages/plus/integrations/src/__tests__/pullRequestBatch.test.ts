import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason, RequestRateLimitError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult, PullRequestEtagFields, PullRequestEtagInclude } from '../models/integration.js';
import type { GetPullRequestForRepoFn, ProviderRepoInput } from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { pullRequestEtag, pullRequestEtagFieldsFromShape } from '../reads/etag.js';
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
	providerPr,
	stubApi,
	watchRequestFailures,
} from './sweepHelpers.js';

/**
 * The batch pull request read: resolve N pull requests by coordinate, in any state.
 *
 * What these pin is the distinction the read exists for — an absent slot is a PROVEN ABSENCE, safe to cache,
 * while a target whose read failed is not returned at all. Several provider answers look like "not found" without
 * proving it (a GitLab `null`, a swallowed Bitbucket error, an Azure 422, a missing session); each has a test that
 * fails if that answer is published as an absence.
 */

type Coordinate = { owner: string; repo: string; number: number; project?: string };
type Slot = PromiseSettledResult<PullRequestShape | undefined>;
type BatchResultFn = (
	coordinates: readonly Coordinate[],
	options?: { currentAccount?: { id: string; username?: string } },
	cancellation?: AbortSignal,
	connectionId?: string,
) => Promise<IntegrationResult<Slot[] | undefined>>;

type Manager = ReturnType<typeof createIntegrationManager>;

function stubBatchResult(integration: GitHostIntegration, fn: BatchResultFn): void {
	(integration as unknown as { getPullRequestsBatchResult: BatchResultFn }).getPullRequestsBatchResult = fn;
}

/** A count of calls to `getPullRequestsBatchResult`, wrapping the real implementation rather than replacing it. */
function countBatchResultCalls(integration: GitHostIntegration): { calls: number } {
	const counter = { calls: 0 };
	const target = integration as unknown as { getPullRequestsBatchResult: BatchResultFn };
	const original = target.getPullRequestsBatchResult.bind(integration);
	target.getPullRequestsBatchResult = (...args) => {
		counter.calls++;
		return original(...args);
	};
	return counter;
}

function found(pr: PullRequestShape | undefined): Slot {
	return { status: 'fulfilled', value: pr };
}

function failed(reason: unknown): Slot {
	return { status: 'rejected', reason: reason };
}

/** A settled slot at the git-github API level — `GitHubApi.getPullRequestsBatch`'s own shape, pre-conversion. */
function apiFound(pr: PullRequest | undefined): PromiseSettledResult<PullRequest | undefined> {
	return { status: 'fulfilled', value: pr };
}

function apiFailed(reason: unknown): PromiseSettledResult<PullRequest | undefined> {
	return { status: 'rejected', reason: reason };
}

const samlForbiddenMessage =
	'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.';

function getRequestExceptionCount(integration: GitHostIntegration): number {
	return (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

/** Counts the lookups so a test can assert the account is read once per call, not once per chunk. */
function stubCurrentAccount(
	integration: GitHostIntegration,
	id: string,
	username?: string,
): { connectionIds: (string | undefined)[] } {
	const connectionIds: (string | undefined)[] = [];
	(
		integration as unknown as {
			getCurrentAccount: (options?: { connectionId?: string }) => Promise<{ id: string; username?: string }>;
		}
	).getCurrentAccount = options => {
		connectionIds.push(options?.connectionId);
		return Promise.resolve({ id: id, username: username });
	};
	return { connectionIds: connectionIds };
}

/** The integration's memoized API client, whose methods a test can replace. */
async function apiClient(
	integration: GitHostIntegration,
	key: 'github' | 'gitlab' | 'bitbucket',
): Promise<Record<string, unknown>> {
	const { apis } = (
		integration as unknown as {
			authenticationService: { apis: Record<string, Promise<Record<string, unknown> | undefined>> };
		}
	).authenticationService;
	const client = await apis[key];
	assert.ok(client != null);
	return client;
}

async function stubSdkPullRequestFn(
	manager: Manager,
	providerId: GitCloudHostIntegrationId | GitSelfManagedHostIntegrationId,
	fn: GetPullRequestForRepoFn,
): Promise<void> {
	const api = await (manager as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();
	const providers = (
		api as unknown as { providers: Record<string, { getPullRequestForRepoFn?: unknown } | undefined> }
	).providers;
	const provider = providers[providerId];
	assert.ok(provider != null);
	provider.getPullRequestForRepoFn = fn;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

function pullRequest(provider: ProviderReference, number: number, author: string = 'octocat'): PullRequest {
	// With the number, as `fromGitHubPullRequest` maps it; the constructor takes it in a late positional slot.
	return Object.assign(
		new PullRequest(
			provider,
			{ id: author, name: author, username: author },
			String(number),
			`PR_node${number}`,
			`PR ${number}`,
			`https://github.com/o/r/pull/${number}`,
			{ owner: 'o', repo: 'r' },
			'merged',
			new Date(0),
			new Date(0),
		),
		{ number: number },
	);
}

function bitbucketCloudPullRequest(id: number): Record<string, unknown> {
	const user = {
		uuid: '{me}',
		display_name: 'Me',
		nickname: 'me',
		links: { avatar: { href: 'https://avatar' }, html: { href: 'https://bitbucket.org/me' } },
	};
	const repository = {
		uuid: '{repo}',
		name: 'r',
		full_name: 'o/r',
		links: { html: { href: 'https://bitbucket.org/o/r' } },
	};
	return {
		id: id,
		title: `PR ${id}`,
		state: 'MERGED',
		author: user,
		closed_by: user,
		created_on: '2026-01-01T00:00:00Z',
		updated_on: '2026-01-02T00:00:00Z',
		links: { html: { href: `https://bitbucket.org/o/r/pull-requests/${id}` } },
		destination: { repository: repository, branch: { name: 'main' }, commit: { hash: 'base' } },
		source: { repository: repository, branch: { name: 'feature' }, commit: { hash: 'head' } },
		participants: [],
	};
}

suite('IntegrationManager.getPullRequestsBatch', () => {
	test('answers found and absent targets, and drops only the target that failed, in one integration call', async () => {
		const { manager, gl } = await connectedGitLab(createFakeRuntime());
		stubCurrentAccount(gl, 'me');
		stubBatchResult(gl, coordinates =>
			Promise.resolve({
				value: coordinates.map(c => {
					switch (c.number) {
						case 1:
							return found(providerShape(1));
						case 2:
							return found(undefined);
						default:
							return failed(new Error('upstream exploded'));
					}
				}),
			}),
		);
		const calls = countBatchResultCalls(gl);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: [
				{ key: 'found', owner: 'o', repo: 'r', number: 1 },
				{ key: 'absent', owner: 'o', repo: 'r', number: 2 },
				{ key: 'failed', owner: 'o', repo: 'r', number: 3 },
			],
		});

		assert.equal(calls.calls, 1, 'every target is resolved in one integration call, not one per target');
		assert.deepEqual(
			result.items.map(i => [i.key, i.pullRequest?.id]),
			[
				['found', 'pr-1'],
				['absent', undefined],
			],
			'the absent target IS returned — that is what makes the miss cacheable',
		);
		assert.ok(!('pullRequest' in result.items[1]));
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);

		manager.dispose();
	});

	test('no targets is an empty success, not a refusal', async () => {
		const { manager } = await connectedGitHub(createFakeRuntime());

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [],
		});

		assert.deepEqual(result, { items: [], warnings: [] });

		manager.dispose();
	});

	test('refuses the whole call on a duplicate key rather than answering ambiguously', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let calls = 0;
		stubBatchResult(gh, coordinates => {
			calls++;
			return Promise.resolve({ value: coordinates.map(() => found(undefined)) });
		});

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'same', owner: 'o', repo: 'r', number: 1 },
				{ key: 'same', owner: 'o', repo: 'r', number: 2 },
			],
		});

		assert.equal(calls, 0);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /Duplicate pull request batch target key 'same'/);
		assert.equal(
			result.warnings[0].kind,
			'other',
			'caller input the caller fixes is not an unsupported capability',
		);

		manager.dispose();
	});

	test('reports an issue tracker as the wrong surface instead of attempting it', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getPullRequestsBatch({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1 }],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0].kind, 'unsupported');
		assert.equal(result.warnings[0].isAuth, false);
		assert.match(result.warnings[0].message, /not supported/i);

		manager.dispose();
	});

	test('refuses an Azure DevOps target that names no project', async () => {
		const { manager, azure } = await connectedAzure(createFakeRuntime());
		let calls = 0;
		stubBatchResult(azure, coordinates => {
			calls++;
			return Promise.resolve({ value: coordinates.map(() => found(undefined)) });
		});

		for (const providerId of [
			GitCloudHostIntegrationId.AzureDevOps,
			GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		]) {
			for (const project of [undefined, ' ']) {
				const result = await manager.getPullRequestsBatch({
					providerId: providerId,
					targets: [
						{ key: 'ok', owner: 'org', repo: 'r', number: 1, project: 'proj' },
						{ key: 'bad', owner: 'org', repo: 'r', number: 2, project: project },
					],
				});

				assert.deepEqual(result.items, [], `${providerId} with project ${JSON.stringify(project)}`);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /target 'bad' requires a project/);
			}
		}
		assert.equal(calls, 0, 'a refusal costs no request');

		manager.dispose();
	});

	test('refuses a target whose number is not a positive safe integer', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let calls = 0;
		stubBatchResult(gh, coordinates => {
			calls++;
			return Promise.resolve({ value: coordinates.map(() => found(undefined)) });
		});

		for (const number of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'bad', owner: 'o', repo: 'r', number: number }],
			});

			assert.deepEqual(result.items, [], `number ${number}`);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /expected a positive integer/);
		}
		assert.equal(calls, 0);

		manager.dispose();
	});

	test("refuses a GitHub target whose number exceeds GraphQL's 32-bit Int, but not the same number on GitLab", async () => {
		const { manager: ghManager, gh } = await connectedGitHub(createFakeRuntime());
		let ghCalls = 0;
		stubBatchResult(gh, coordinates => {
			ghCalls++;
			return Promise.resolve({ value: coordinates.map(() => found(undefined)) });
		});

		const ghResult = await ghManager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'bad', owner: 'o', repo: 'r', number: 2147483648 }],
		});

		assert.deepEqual(ghResult.items, []);
		assert.equal(ghResult.fetchFailed, true);
		assert.match(ghResult.warnings[0].message, /32-bit/);
		assert.equal(ghCalls, 0, 'a refusal costs no request');

		ghManager.dispose();

		const { manager: glManager, gl } = await connectedGitLab(createFakeRuntime());
		stubCurrentAccount(gl, 'me');
		let glCalls = 0;
		stubBatchResult(gl, coordinates => {
			glCalls++;
			return Promise.resolve({ value: coordinates.map(() => found(undefined)) });
		});

		await glManager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: [{ key: 'ok', owner: 'group', repo: 'r', number: 2147483648 }],
		});

		assert.equal(glCalls, 1, 'GitLab has no 32-bit Int limit, so the same number is not refused');

		glManager.dispose();
	});

	test('refuses a target with an empty owner or repo', async () => {
		const { manager } = await connectedGitHub(createFakeRuntime());

		for (const [owner, repo] of [
			['', 'r'],
			['o', ' '],
		]) {
			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'bad', owner: owner, repo: repo, number: 1 }],
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /requires a non-empty owner and repo/);
		}

		manager.dispose();
	});

	test('a missing session is a connection warning, never a batch of absences', async () => {
		// Not connected: the primary path's read core answers `undefined`, which must not be read as "nothing to say".
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		const github = await apiClient(gh, 'github');
		let calls = 0;
		github.getPullRequestsBatch = (_p: unknown, _t: unknown, coordinates: readonly Coordinate[]) => {
			calls++;
			return Promise.resolve(coordinates.map(() => undefined));
		};

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1 }],
		});

		assert.equal(calls, 0);
		assert.deepEqual(result.items, [], 'no target is reported as proven absent');
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0]?.kind, 'no-connection', 'reported as a connection problem, not "unsupported"');

		manager.dispose();
	});

	test('a self-managed provider with no configured host fails with a connection warning, not a silent empty', async () => {
		// No host means no integration resolves at all, before any session is asked for.
		const manager = createIntegrationManager(createFakeRuntime());

		const [batch, branches] = await Promise.all([
			manager.getPullRequestsBatch({
				providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
				targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, project: 'p' }],
			}),
			manager.getPullRequestsForBranches({
				providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
				targets: [{ key: 'a', owner: 'o', repo: 'r', project: 'p', branch: 'feature' }],
			}),
		]);

		for (const result of [batch, branches]) {
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings[0]?.kind, 'no-connection');
		}

		manager.dispose();
	});

	test('reads through the requested connection, for both the pull requests and the account', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|secondary',
			JSON.stringify({ ...primarySession('secondary-token'), id: 'secondary' }),
		);
		const { manager, gh } = await connectedGitHub(runtime);
		const account = stubCurrentAccount(gh, 'me');
		const github = await apiClient(gh, 'github');
		const tokens: string[] = [];
		github.getPullRequestsBatch = (
			provider: ProviderReference,
			token: TokenWithInfo,
			coordinates: Coordinate[],
		) => {
			tokens.push(token.accessToken);
			return Promise.resolve(coordinates.map(c => apiFound(pullRequest(provider, c.number))));
		};

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1 }],
			connectionId: 'secondary',
		});

		assert.deepEqual(tokens, ['secondary-token']);
		assert.deepEqual(account.connectionIds, ['secondary']);
		assert.equal(result.items[0]?.pullRequest?.number, 1);

		manager.dispose();
	});

	test('GitHub resolves up to 25 targets per request, converted like the list rows', async () => {
		const runtime = createFakeRuntime();
		let cacheReads = 0;
		runtime.cache.getPullRequest = () => {
			cacheReads++;
			throw new Error('the batch read must not go through the pull request cache');
		};
		const { manager, gh } = await connectedGitHub(runtime);
		const account = stubCurrentAccount(gh, 'me');
		const github = await apiClient(gh, 'github');
		const sizes: number[] = [];
		github.getPullRequestsBatch = (provider: ProviderReference, _t: unknown, coordinates: Coordinate[]) => {
			sizes.push(coordinates.length);
			return Promise.resolve(
				coordinates.map(c => apiFound(c.number === 26 ? undefined : pullRequest(provider, c.number, 'me'))),
			);
		};

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: Array.from({ length: 26 }, (_, i) => ({ key: `k${i + 1}`, owner: 'o', repo: 'r', number: i + 1 })),
		});

		assert.deepEqual(sizes, [25, 1]);
		assert.equal(account.connectionIds.length, 1, 'the account is read once per call, not per chunk');
		assert.equal(result.items.length, 26);
		assert.equal(result.items[25].pullRequest, undefined);
		const first = result.items[0].pullRequest;
		assert.equal(first?.number, 1, 'the list rows carry the number; so must the batch');
		assert.equal(first?.state, 'merged', 'any state resolves');
		assert.equal(first?.authoredByMe, true, 'authorship is resolved like the list rows');
		assert.equal(result.fetchFailed, undefined);
		assert.equal(cacheReads, 0);

		manager.dispose();
	});

	test('GitHub batch row resolves authorship by login when the ids never can', async () => {
		// GitLens' own GitHub GraphQL client keys `author.id` by login (the `pullRequest()` fixture above
		// mirrors that: id, name and username are all the login), while the account's `id` is GitHub's numeric
		// database id — so only the username fallback can resolve authorship here.
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, '641685', 'eamodio');
		const github = await apiClient(gh, 'github');
		github.getPullRequestsBatch = (provider: ProviderReference, _t: unknown, coordinates: Coordinate[]) =>
			Promise.resolve(
				coordinates.map((c, i) => apiFound(pullRequest(provider, c.number, i === 0 ? 'eamodio' : 'octocat'))),
			);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'mine', owner: 'o', repo: 'r', number: 1 },
				{ key: 'not-mine', owner: 'o', repo: 'r', number: 2 },
			],
		});

		assert.equal(result.items.find(i => i.key === 'mine')?.pullRequest?.authoredByMe, true);
		assert.equal(result.items.find(i => i.key === 'not-mine')?.pullRequest?.authoredByMe, false);
		for (const item of result.items) {
			assert.deepEqual(item.pullRequest?.viewer, { id: '641685', username: 'eamodio' });
		}

		manager.dispose();
	});

	test('GitHub: a throwing chunk drops only its own targets — the other chunk still answers', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const github = await apiClient(gh, 'github');
		const sizes: number[] = [];
		github.getPullRequestsBatch = (provider: ProviderReference, _t: unknown, coordinates: Coordinate[]) => {
			sizes.push(coordinates.length);
			// The second chunk (the 26th target, alone) fails; the first chunk of 25 must still answer.
			if (coordinates.length === 1) return Promise.reject(new Error('second chunk exploded'));

			return Promise.resolve(coordinates.map(c => apiFound(pullRequest(provider, c.number, 'me'))));
		};

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: Array.from({ length: 26 }, (_, i) => ({ key: `k${i + 1}`, owner: 'o', repo: 'r', number: i + 1 })),
		});

		assert.deepEqual(sizes, [25, 1]);
		assert.deepEqual(
			result.items.map(i => i.key),
			Array.from({ length: 25 }, (_, i) => `k${i + 1}`),
			'the 26th target is dropped, never reported absent',
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);

		manager.dispose();
	});

	test('GitHub: a target that fails on its own (e.g. SAML) drops only that target, with no strike or session expiry', async () => {
		// GitHub answers a SAML-enforcing org with HTTP 200: the other alias's data, plus a FORBIDDEN for the one
		// the token isn't authorized for. The token still worked, so this must cost neither a strike nor a
		// session expiry — both of which `AuthenticationError` would trigger.
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const github = await apiClient(gh, 'github');
		github.getPullRequestsBatch = (provider: ProviderReference, _t: unknown, coordinates: Coordinate[]) =>
			Promise.resolve(
				coordinates.map((c, i) =>
					i === 1 ? apiFailed(new Error(samlForbiddenMessage)) : apiFound(pullRequest(provider, c.number)),
				),
			);
		const sessionBefore = { ...(gh as unknown as { _session: ProviderAuthenticationSession })._session };

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'found', owner: 'o', repo: 'r', number: 1 },
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
		stubCurrentAccount(gh, 'me');
		const github = await apiClient(gh, 'github');
		github.getPullRequestsBatch = () => Promise.resolve([apiFailed(new Error(samlForbiddenMessage))]);
		const sessionBefore = { ...(gh as unknown as { _session: ProviderAuthenticationSession })._session };

		const result = await manager.getPullRequestsBatch({
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

	suite('GitHub: every target refused (#5900)', () => {
		/** Refuses every batch request with `status`, and answers the profile read that checks the credential. */
		async function gitHubRefusing(status: 401 | 403, message: string, probeStatus: 200 | 401 = 200) {
			const runtime = createFakeRuntime();
			const checks = { probes: 0 };
			runtime.http.fetch = (_url, init) => {
				if ((typeof init?.body === 'string' ? init.body : '').includes('getCurrentAccount')) {
					checks.probes++;
					return Promise.resolve(
						probeStatus === 200
							? json(200, { data: { viewer: { databaseId: 1, login: 'me' } } })
							: json(probeStatus, { message: 'Bad credentials' }),
					);
				}
				return Promise.resolve(json(status, { message: message }));
			};
			const { manager, gh } = await connectedGitHub(runtime);
			stubCurrentAccount(gh, 'me');
			const session = { ...(gh as unknown as { _session: ProviderAuthenticationSession })._session };
			return { manager: manager, gh: gh, session: session, checks: checks };
		}

		const targets = [
			{ key: 'a', owner: 'o', repo: 'r', number: 1 },
			{ key: 'b', owner: 'o', repo: 's', number: 2 },
		];

		test('by a credential the probe confirms, each target is scoped to its repository and costs nothing', async () => {
			const { manager, gh, session, checks } = await gitHubRefusing(
				403,
				'Resource not accessible by integration',
			);

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets,
			});

			assert.deepEqual(result.items, [], 'a refused target is dropped, never reported absent');
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(
				result.warnings.filter(w => w.kind === 'auth').map(w => w.scope),
				[{ repositoryId: 'o/r' }, { repositoryId: 'o/s' }],
			);
			assert.equal(checks.probes, 1);
			assert.equal(getRequestExceptionCount(gh), 0, 'a confirmed credential spends no strike');
			assert.deepEqual((gh as unknown as { _session: ProviderAuthenticationSession })._session, session);

			manager.dispose();
		});

		test("a 401 the credential check refuses too is the connection's failure", async () => {
			const { manager, gh, session, checks } = await gitHubRefusing(401, 'Bad credentials', 401);

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets,
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(
				result.warnings.filter(w => w.kind === 'auth').map(w => w.scope),
				[undefined],
			);
			assert.equal(checks.probes, 1);
			assert.notDeepEqual(
				(gh as unknown as { _session: ProviderAuthenticationSession })._session,
				session,
				'the cloud session is expired so the next read refreshes it',
			);

			manager.dispose();
		});
	});

	test('GitHub: six requests of 25 targets each failing with 500 cost one strike and one notice, and do not disconnect', async () => {
		const runtime = createFakeRuntime();
		runtime.http.fetch = () => Promise.resolve(json(500, { message: 'Server Error' }));
		const { manager, gh } = await connectedGitHub(runtime);
		stubCurrentAccount(gh, 'me');
		const watched = watchRequestFailures(runtime);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: Array.from({ length: 150 }, (_, i) => ({ key: `k${i}`, owner: 'o', repo: 'r', number: i + 1 })),
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(getRequestExceptionCount(gh), 1, 'one strike for the whole call');
		assert.equal(watched.notices.length, 1, 'one notice for the whole call');
		assert.equal(watched.disconnected, undefined);

		manager.dispose();
	});

	test('a mix of found, absent and failed targets on a one-PR-per-request host settles each independently, in one integration call', async () => {
		const { manager, gl } = await connectedGitLab(createFakeRuntime());
		stubCurrentAccount(gl, 'me');
		stubApi(gl, {
			getPullRequestForRepo: (_token: unknown, _repo: ProviderRepoInput, number: number) => {
				switch (number) {
					case 1:
						return Promise.resolve(providerPr('gid-1', { number: 1 }));
					case 2:
						return Promise.resolve(undefined);
					default:
						return Promise.reject(new Error('upstream exploded'));
				}
			},
		});
		const gitlab = await apiClient(gl, 'gitlab');
		// Target 2's confirming read: a genuine miss, not a GraphQL error — so it stays absent.
		gitlab.getPullRequest = () => Promise.resolve(undefined);
		const calls = countBatchResultCalls(gl);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: [
				{ key: 'found', owner: 'group/sub', repo: 'r', number: 1 },
				{ key: 'absent', owner: 'group/sub', repo: 'r', number: 2 },
				{ key: 'failed', owner: 'group/sub', repo: 'r', number: 3 },
			],
		});

		assert.equal(calls.calls, 1, 'every target is resolved in one integration call, not one per target');
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.items.map(i => [i.key, i.pullRequest?.id]),
			[
				['found', 'gid-1'],
				['absent', undefined],
			],
			'the failed target is dropped, never reported absent',
		);

		manager.dispose();
	});

	suite('GitLab', () => {
		function gitLabGraphQL(
			runtime: FakeRuntime,
			responses: { sdk: Record<string, unknown>; own: Record<string, unknown> },
		): { sdk: number; own: number } {
			const calls = { sdk: 0, own: 0 };
			runtime.http.fetch = (_input, init) => {
				const body = typeof init?.body === 'string' ? init.body : '';
				if (body.includes('getPullRequestForRepo')) {
					calls.sdk++;
					return Promise.resolve(json(200, responses.sdk));
				}
				if (body.includes('getMergeRequest')) {
					calls.own++;
					return Promise.resolve(json(200, responses.own));
				}
				return Promise.reject(new Error(`unexpected request: ${body}`));
			};
			return calls;
		}

		test('a null that our own read confirms is a proven absence', async () => {
			const runtime = createFakeRuntime();
			const calls = gitLabGraphQL(runtime, {
				sdk: { data: { project: null } },
				own: { data: { project: null } },
			});
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', number: 7 }],
			});

			assert.deepEqual(calls, { sdk: 1, own: 1 });
			assert.deepEqual(result.items, [{ key: 'a' }]);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		test('a confirming read that comes back empty fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			gitLabGraphQL(runtime, { sdk: { data: { project: null } }, own: {} });
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', number: 7 }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		// provider-apis reads a GraphQL reply that carries only `errors` as `{ data: null }`.
		test('a null that came from a GraphQL error fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			const failure = { data: { project: null }, errors: [{ message: 'Timeout on validation of query' }] };
			const calls = gitLabGraphQL(runtime, { sdk: failure, own: failure });
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', number: 7 }],
			});

			assert.deepEqual(calls, { sdk: 1, own: 1 });
			assert.deepEqual(result.items, [], 'an unconfirmed null is never published as an absence');
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a null confirmed by a 404 from our own endpoint fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			const calls = { sdk: 0, own: 0 };
			runtime.http.fetch = (_input, init) => {
				const body = typeof init?.body === 'string' ? init.body : '';
				if (body.includes('getPullRequestForRepo')) {
					calls.sdk++;
					return Promise.resolve(json(200, { data: { project: null } }));
				}
				if (body.includes('getMergeRequest')) {
					calls.own++;
					// GitLab's GraphQL answers a genuine miss with 200 and a null node, never a 404 — a 404 here
					// means the confirming read hit the wrong endpoint or host, not that the MR is missing.
					return Promise.resolve(json(404, { message: 'Not Found' }));
				}
				return Promise.reject(new Error(`unexpected request: ${body}`));
			};
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', number: 7 }],
			});

			assert.deepEqual(calls, { sdk: 1, own: 1 });
			assert.deepEqual(result.items, [], 'a 404 from the wrong endpoint/host must never be read as absent');
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a pull request our own read finds after provider-apis missed it fails rather than answering thinner', async () => {
			const { manager, gl } = await connectedGitLab(createFakeRuntime());
			stubCurrentAccount(gl, 'me');
			stubApi(gl, { getPullRequestForRepo: () => Promise.resolve(undefined) });
			const gitlab = await apiClient(gl, 'gitlab');
			gitlab.getPullRequest = (provider: ProviderReference) => Promise.resolve(pullRequest(provider, 7));

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', number: 7 }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a provider-apis hit is converted like the list rows and needs no confirming read', async () => {
			const { manager, gl } = await connectedGitLab(createFakeRuntime());
			stubCurrentAccount(gl, 'me');
			const requested: { repo: ProviderRepoInput; number: number }[] = [];
			stubApi(gl, {
				getPullRequestForRepo: (_token: unknown, repo: ProviderRepoInput, number: number) => {
					requested.push({ repo: repo, number: number });
					return Promise.resolve(
						providerPr('gid-1', {
							number: number,
							author: { id: 'me', name: 'Me', email: null, username: 'me', avatarUrl: null, url: null },
						}),
					);
				},
			});
			const gitlab = await apiClient(gl, 'gitlab');
			let ownReads = 0;
			gitlab.getPullRequest = () => {
				ownReads++;
				return Promise.resolve(undefined);
			};

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group/sub', repo: 'r', number: 7 }],
			});

			assert.deepEqual(requested, [{ repo: { namespace: 'group/sub', name: 'r' }, number: 7 }]);
			assert.equal(ownReads, 0);
			const pr = result.items[0]?.pullRequest;
			// The list rows keep provider-apis' global id; only GitLens' own GitLab reads swap in the iid.
			assert.equal(pr?.id, 'gid-1');
			assert.equal(pr?.number, 7);
			assert.equal(pr?.authoredByMe, true);

			manager.dispose();
		});

		test('six targets whose confirming reads fail with 500 cost one strike and one notice, and do not disconnect', async () => {
			const runtime = createFakeRuntime();
			// Only our own confirming read reaches `fetch`; provider-apis is stubbed to miss.
			runtime.http.fetch = () => Promise.resolve(json(500, { message: '500 Internal Server Error' }));
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');
			stubApi(gl, { getPullRequestForRepo: () => Promise.resolve(undefined) });
			const watched = watchRequestFailures(runtime);

			const result = await manager.getPullRequestsBatch({
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
			assert.equal(watched.notices.length, 1, 'one notice for the whole call');
			assert.equal(watched.disconnected, undefined);

			manager.dispose();
		});
	});

	suite('Azure DevOps', () => {
		function azureStatus(
			runtime: FakeRuntime,
			status: number,
			body: unknown = { message: `status ${status}` },
		): {
			urls: string[];
		} {
			const urls: string[] = [];
			runtime.http.fetch = input => {
				urls.push(input.toString());
				return Promise.resolve(json(status, body));
			};
			return { urls: urls };
		}

		/** A 404 whose content-type is HTML, not JSON — a wrong-path response (e.g. a misconfigured virtual
		 *  directory or collection), the shape Azure never answers "not found" with. */
		function azureHtmlStatus(runtime: FakeRuntime, status: number): void {
			runtime.http.fetch = () =>
				Promise.resolve(
					new Response('<html><body>Not Found</body></html>', {
						status: status,
						headers: { 'content-type': 'text/html' },
					}),
				);
		}

		const target = { key: 'a', owner: 'org', repo: 'r', number: 7, project: 'proj' };

		test('a 404 whose body names the pull request as not found is a proven absence', async () => {
			const runtime = createFakeRuntime();
			const requests = azureStatus(runtime, 404, {
				typeKey: 'GitPullRequestNotFoundException',
				message: 'not found',
			});
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.equal(requests.urls.length, 1);
			assert.match(requests.urls[0], /\/org\/proj\/_apis\/git\/repositories\/r\/pullrequests\/7/);
			assert.deepEqual(result.items, [{ key: 'a' }]);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		test('a 404 with an HTML body fails the target instead of reporting it absent', async () => {
			// A wrong path (e.g. an Azure DevOps Server virtual directory or collection misconfigured) also
			// answers 404, often with an IIS/HTML page rather than Azure's own not-found shape.
			const runtime = createFakeRuntime();
			azureHtmlStatus(runtime, 404);
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('a 404 JSON body with an unrecognized typeKey fails the target instead of reporting it absent', async () => {
			const runtime = createFakeRuntime();
			azureStatus(runtime, 404, { typeKey: 'SomeOtherException', message: 'nope' });
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		// `throwProviderError` classifies a 410/422 as not-found alongside 404, but only a 404 whose body names the
		// target can prove absence — a 410 or a 422 proves nothing.
		for (const status of [410, 422, 500]) {
			test(`a ${status} fails the target instead of reporting it absent`, async () => {
				const runtime = createFakeRuntime();
				azureStatus(runtime, status);
				const { manager, azure } = await connectedAzure(runtime);
				stubCurrentAccount(azure, 'me');

				const result = await manager.getPullRequestsBatch({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					targets: [target],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);

				manager.dispose();
			});
		}

		test('a padded project reaches the provider trimmed', async () => {
			const runtime = createFakeRuntime();
			const requests = azureStatus(runtime, 404, {
				typeKey: 'GitPullRequestNotFoundException',
				message: 'not found',
			});
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [{ key: 'a', owner: 'org', repo: 'r', number: 7, project: ' proj ' }],
			});

			assert.equal(requests.urls.length, 1);
			assert.match(requests.urls[0], /\/org\/proj\/_apis\/git\/repositories\/r\/pullrequests\/7/);
			assert.deepEqual(result.items, [{ key: 'a' }]);

			manager.dispose();
		});

		test('a hit asks for clone URLs and is converted like the repo-scoped list rows', async () => {
			const { manager, azure } = await connectedAzure(createFakeRuntime());
			stubCurrentAccount(azure, 'me');
			const inputs: Parameters<GetPullRequestForRepoFn>[0][] = [];
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.AzureDevOps, input => {
				inputs.push(input);
				return Promise.resolve({
					data: providerPr('7', {
						number: 7,
						author: { id: 'me', name: 'Me', email: null, username: 'me', avatarUrl: null, url: null },
					}),
				});
			});

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(inputs, [
				{ repo: { namespace: 'org', name: 'r', project: 'proj' }, number: 7, includeRemoteInfo: true },
			]);
			assert.equal(result.items[0]?.pullRequest?.number, 7);
			assert.equal(result.items[0]?.pullRequest?.authoredByMe, true);

			manager.dispose();
		});
	});

	suite('Bitbucket', () => {
		function bitbucketStatus(runtime: FakeRuntime, status: number, body: unknown = { error: {} }): void {
			runtime.http.fetch = () => Promise.resolve(json(status, body));
		}

		test('Cloud: a hit is resolved through our own client', async () => {
			const runtime = createFakeRuntime();
			bitbucketStatus(runtime, 200, bitbucketCloudPullRequest(7));
			const { manager, integration } = await connectedBitbucket(runtime);
			stubCurrentAccount(integration, '{me}');

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: [{ key: 'a', owner: 'o', repo: 'r', number: 7 }],
			});

			assert.equal(result.items[0]?.pullRequest?.id, '7');
			assert.equal(result.items[0]?.pullRequest?.state, 'merged');
			assert.equal(result.items[0]?.pullRequest?.authoredByMe, true);
			assert.deepEqual(result.items[0]?.pullRequest?.viewer, { id: '{me}', username: undefined });

			manager.dispose();
		});

		for (const { providerId, connect } of [
			{ providerId: GitCloudHostIntegrationId.Bitbucket, connect: connectedBitbucket },
			{ providerId: GitSelfManagedHostIntegrationId.BitbucketServer, connect: connectedBitbucketServer },
		]) {
			test(`${providerId}: a 404 is a proven absence`, async () => {
				const runtime = createFakeRuntime();
				bitbucketStatus(runtime, 404);
				const { manager, integration } = await connect(runtime);
				stubCurrentAccount(integration, 'me');

				const result = await manager.getPullRequestsBatch({
					providerId: providerId,
					targets: [{ key: 'a', owner: 'o', repo: 'r', number: 7 }],
				});

				assert.deepEqual(result.items, [{ key: 'a' }]);
				assert.equal(result.fetchFailed, undefined);

				manager.dispose();
			});

			// The legacy by-id reads answer `undefined` for any failure; the batch must not inherit that.
			test(`${providerId}: a 500 fails the target instead of reporting it absent`, async () => {
				const runtime = createFakeRuntime();
				bitbucketStatus(runtime, 500);
				const { manager, integration } = await connect(runtime);
				stubCurrentAccount(integration, 'me');

				const result = await manager.getPullRequestsBatch({
					providerId: providerId,
					targets: [{ key: 'a', owner: 'o', repo: 'r', number: 7 }],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);

				manager.dispose();
			});
		}

		test('Bitbucket Data Center: six targets each failing with 401 cost at most one strike and do not disconnect', async () => {
			const runtime = createFakeRuntime();
			bitbucketStatus(runtime, 401);
			const { manager, integration } = await connectedBitbucketServer(runtime);
			// Non-cloud session: an `AuthenticationError` then takes the direct strike path
			// (`trackRequestException`) rather than the cloud session-expiry path, so `requestExceptionCount`
			// below is an exact strike count, not incidentally zero because the first failure only requested a
			// resync.
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'bbs.example.com',
				cloud: false,
			};
			stubCurrentAccount(integration, 'me');
			let disconnected: string | undefined;
			runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };

			const result = await manager.getPullRequestsBatch({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, owner: 'o', repo: 'r', number: i + 1 })),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(
				getRequestExceptionCount(integration),
				1,
				'six failing targets resolved in one batch call must cost at most one strike',
			);
			assert.equal(disconnected, undefined, 'must not disconnect on a single failing batch call');

			manager.dispose();
		});

		test('Bitbucket Data Center: six targets each failing with 500 cost one strike and one notice, and do not disconnect', async () => {
			const runtime = createFakeRuntime();
			bitbucketStatus(runtime, 500);
			const { manager, integration } = await connectedBitbucketServer(runtime);
			stubCurrentAccount(integration, 'me');
			const watched = watchRequestFailures(runtime);

			const result = await manager.getPullRequestsBatch({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, owner: 'o', repo: 'r', number: i + 1 })),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(getRequestExceptionCount(integration), 1, 'one strike for the whole call');
			assert.equal(watched.notices.length, 1, 'one notice for the whole call');
			assert.equal(watched.disconnected, undefined);

			manager.dispose();
		});

		test('Bitbucket Data Center: a call that answered one target shows one notice for the others failing with 500, and spends no strike', async () => {
			const runtime = createFakeRuntime();
			runtime.http.fetch = input =>
				Promise.resolve(json(input.toString().endsWith('/pull-requests/1') ? 404 : 500, { errors: [] }));
			const { manager, integration } = await connectedBitbucketServer(runtime);
			stubCurrentAccount(integration, 'me');
			const watched = watchRequestFailures(runtime);

			const result = await manager.getPullRequestsBatch({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, owner: 'o', repo: 'r', number: i + 1 })),
			});

			assert.deepEqual(result.items, [{ key: 'k0' }]);
			assert.equal(result.fetchFailed, true);
			assert.equal(getRequestExceptionCount(integration), 0);
			assert.equal(watched.notices.length, 1);
			assert.equal(watched.disconnected, undefined);

			manager.dispose();
		});

		test('Bitbucket Data Center: a call failed by a client error as well as by 500s spends one strike, not two', async () => {
			const runtime = createFakeRuntime();
			// The call fails on the first target's 400, a `RequestClientError` that spends a strike of its own.
			runtime.http.fetch = input =>
				Promise.resolve(json(input.toString().endsWith('/pull-requests/1') ? 400 : 500, { errors: [] }));
			const { manager, integration } = await connectedBitbucketServer(runtime);
			stubCurrentAccount(integration, 'me');
			const watched = watchRequestFailures(runtime);

			const result = await manager.getPullRequestsBatch({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, owner: 'o', repo: 'r', number: i + 1 })),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(getRequestExceptionCount(integration), 1);
			assert.equal(watched.notices.length, 1);
			assert.equal(watched.disconnected, undefined);

			manager.dispose();
		});

		test('Bitbucket Data Center: a read outside a batch still spends a strike and shows a notice per failed request', async () => {
			const runtime = createFakeRuntime();
			bitbucketStatus(runtime, 500);
			const { manager, integration } = await connectedBitbucketServer(runtime);
			const watched = watchRequestFailures(runtime);
			const bitbucket = await apiClient(integration, 'bitbucket');
			const token = { accessToken: 't', microHash: 'h' } as unknown as TokenWithInfo;
			const read = (method: string) =>
				(bitbucket[method] as (...args: unknown[]) => Promise<unknown>).call(
					bitbucket,
					integration,
					token,
					'o',
					'r',
					'7',
					'https://bbs.example.com/rest/api/1.0',
				);

			// The same strict read the batch makes, through the legacy read that swallows its failure.
			assert.equal(await read('getServerPullRequestById'), undefined);
			await assert.rejects(read('getServerPullRequestForBranch'));

			assert.equal(getRequestExceptionCount(integration), 2);
			assert.equal(watched.notices.length, 2);

			manager.dispose();
		});

		test('the legacy by-id reads still swallow a failure', async () => {
			const runtime = createFakeRuntime();
			bitbucketStatus(runtime, 500);
			const { manager, integration } = await connectedBitbucket(runtime);
			const bitbucket = await apiClient(integration, 'bitbucket');
			const token = { accessToken: 't', microHash: 'h' } as unknown as TokenWithInfo;
			const read = (method: string) =>
				(bitbucket[method] as (...args: unknown[]) => Promise<unknown>).call(
					bitbucket,
					integration,
					token,
					'o',
					'r',
					'7',
					'https://api.example.com',
					{ type: 'pullrequest' },
				);

			assert.equal(await read('getIssueOrPullRequest'), undefined);
			assert.equal(await read('getServerPullRequestById'), undefined);

			manager.dispose();
		});
	});

	suite('scoped refusals (#5890)', () => {
		/**
		 * An Azure DevOps connection whose pull request reads refuse a project with `refusal`, or answer that the
		 * pull request is absent. `probe` answers the profile request that confirms the credential; the account the
		 * read looks up first is stubbed, so every profile request counted is a probe.
		 */
		async function azureRefusing(
			refusal: (project: string) => Error | undefined,
			probe: () => Promise<unknown>,
			cloud: boolean = true,
		) {
			const { manager, azure } = await connectedAzure(createFakeRuntime());
			const session = { ...primarySession('t'), domain: 'dev.azure.com', cloud: cloud };
			(azure as unknown as { _session: ProviderAuthenticationSession })._session = session;
			stubCurrentAccount(azure, 'me');
			const checks = { probes: 0 };
			stubApi(azure, {
				getPullRequestForRepo: (_t: unknown, repo: { project: string }) => {
					const refused = refusal(repo.project);
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

		const refusedTargets = [
			{ key: 'a', owner: 'org', repo: 'r', number: 1, project: 'proj' },
			{ key: 'b', owner: 'org', repo: 's', number: 2, project: 'proj' },
			{ key: 'c', owner: 'org', repo: 'r', number: 3, project: 'other' },
		];

		for (const cloud of [true, false]) {
			test(`Azure: every target refused, by a credential the probe confirms, is scoped to its organization and costs nothing (${cloud ? 'cloud' : 'local'} session)`, async () => {
				const { manager, azure, session, checks } = await azureRefusing(
					project => (project === 'proj' ? oauthAppNotAllowed() : noAccess()),
					() => Promise.resolve({ id: 'guid-1' }),
					cloud,
				);

				const result = await manager.getPullRequestsBatch({
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
		}

		test('Azure: a probe that refuses the credential fails the batch as a connection failure, as before', async () => {
			const { manager, azure, checks } = await azureRefusing(
				() => oauthAppNotAllowed(),
				// The profile request's answer to a dead token, which is also what those organizations answered.
				() => Promise.reject(oauthAppNotAllowed()),
				// A local session takes the direct strike path, so the count is exact.
				false,
			);

			const result = await manager.getPullRequestsBatch({
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

		test('Azure: a target refused while another answered is scoped without a probe', async () => {
			const { manager, azure, session, checks } = await azureRefusing(
				project => (project === 'denied' ? oauthAppNotAllowed() : undefined),
				() => Promise.resolve({ id: 'guid-1' }),
			);

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [
					{ key: 'answered', owner: 'org', repo: 'r', number: 1, project: 'ok' },
					{ key: 'refused', owner: 'org', repo: 'r', number: 2, project: 'denied' },
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
				manager.getPullRequestsBatch({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					targets: [{ key: 'a', owner: 'org', repo: 'r', number: 1, project: 'proj' }],
				});

			await read();
			const second = await read();

			assert.equal(checks.probes, 1);
			assert.deepEqual(authWarnings(second), [
				{ scope: { resourceId: 'org', projectId: 'proj' }, cause: { reason: 'oauth-app-not-allowed' } },
			]);

			manager.dispose();
		});

		test('Bitbucket Data Center: every target refused, by a credential the probe confirms, is scoped to its repository and costs no strike', async () => {
			const runtime = createFakeRuntime();
			runtime.http.fetch = () => Promise.resolve(json(401, { errors: [{ message: 'Authentication failed' }] }));
			const { manager, integration } = await connectedBitbucketServer(runtime);
			// A local session takes the direct strike path, so the count is exact.
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'bbs.example.com',
				cloud: false,
			};
			stubCurrentAccount(integration, 'me');
			let probes = 0;
			stubApi(integration, {
				getCurrentUser: () => {
					probes++;
					return Promise.resolve({ id: 'u1' });
				},
			});

			const result = await manager.getPullRequestsBatch({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: [
					{ key: 'a', owner: 'PROJ', repo: 'one', number: 1 },
					{ key: 'b', owner: 'PROJ', repo: 'two', number: 2 },
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(
				result.warnings.map(w => ({ kind: w.kind, scope: w.scope })),
				[
					{ kind: 'auth', scope: { repositoryId: 'PROJ/one' } },
					{ kind: 'auth', scope: { repositoryId: 'PROJ/two' } },
				],
			);
			assert.equal(probes, 1);
			assert.equal(getRequestExceptionCount(integration), 0);

			manager.dispose();
		});
	});
});

type EtagSlot = PromiseSettledResult<PullRequestEtagFields | undefined>;
type EtagFieldsResultFn = (
	coordinates: readonly Coordinate[],
	options: { etagIncludes?: readonly PullRequestEtagInclude[] },
	cancellation?: AbortSignal,
	connectionId?: string,
) => Promise<IntegrationResult<EtagSlot[] | undefined>>;

/** Records every full read's target numbers, answering each from `answer`. */
function stubFullReads(
	integration: GitHostIntegration,
	answer: (c: Coordinate) => Slot = c => found(etagShape(c.number)),
): number[][] {
	const calls: number[][] = [];
	stubBatchResult(integration, coordinates => {
		calls.push(coordinates.map(c => c.number));
		return Promise.resolve({ value: coordinates.map(answer) });
	});
	return calls;
}

/** Records every cheap check's target numbers and options, answering each with `answer`. */
function stubEtagFieldsResult(
	integration: GitHostIntegration,
	answer: (coordinates: readonly Coordinate[]) => Promise<IntegrationResult<EtagSlot[] | undefined>>,
): { numbers: number[][]; options: { etagIncludes?: readonly PullRequestEtagInclude[] }[] } {
	const calls = {
		numbers: [] as number[][],
		options: [] as { etagIncludes?: readonly PullRequestEtagInclude[] }[],
	};
	(
		integration as unknown as { getPullRequestsEtagFieldsResult: EtagFieldsResultFn }
	).getPullRequestsEtagFieldsResult = (coordinates, options) => {
		calls.numbers.push(coordinates.map(c => c.number));
		calls.options.push(options);
		return answer(coordinates);
	};
	return calls;
}

/** A full row whose change state is derived from its number and `version`, so a test can move one on purpose. */
function etagShape(number: number, version: number = 0): PullRequest {
	return new PullRequest(
		{ id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
		{ id: 'octo', name: 'octo' },
		String(number),
		`PR_node${number}`,
		`PR ${number}`,
		`https://github.com/o/r/pull/${number}`,
		{ owner: 'o', repo: 'r' },
		'opened',
		new Date(0),
		new Date(1000 * version),
		undefined,
		undefined,
		PullRequestMergeableState.Mergeable,
		undefined,
		{
			head: { owner: 'o', repo: 'r', branch: 'feature', sha: `head-${number}`, exists: true, url: '' },
			base: { owner: 'o', repo: 'r', branch: 'main', sha: 'base', exists: true, url: '' },
			isCrossRepository: false,
		},
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		PullRequestStatusCheckRollupState.Success,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		number,
	);
}

/** The etag the caller holds after a full read of `etagShape(number, version)`. */
function heldEtag(number: number, version: number = 0, includes: readonly PullRequestEtagInclude[] = []): string {
	return pullRequestEtag(pullRequestEtagFieldsFromShape(etagShape(number, version)), includes);
}

/** What the cheap check reads for `etagShape(number, version)`. */
function etagFields(number: number, version: number = 0): EtagSlot {
	return { status: 'fulfilled', value: pullRequestEtagFieldsFromShape(etagShape(number, version)) };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => {
		resolve = r;
	});
	return { promise: promise, resolve: resolve };
}

/**
 * Etags on the batch read: a target sent with the etag of the caller's copy is checked cheaply first and read in
 * full only when it moved. The properties pinned here are the read's promises — never a false `unchanged`, never
 * a retry against a credential or limit that just failed, and exactly today's single call when no etag is sent.
 */
suite('IntegrationManager.getPullRequestsBatch etags', () => {
	test('no etags: one full call and no cheap check, as before etags existed, and every found row carries an etag', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh, c => found(c.number === 2 ? undefined : etagShape(c.number)));
		const cheap = stubEtagFieldsResult(gh, () => Promise.reject(new Error('no etag was sent')));

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1 },
				{ key: 'b', owner: 'o', repo: 'r', number: 2 },
				{ key: 'c', owner: 'o', repo: 'r', number: 3 },
			],
		});

		assert.deepEqual(full, [[1, 2, 3]], 'one call for every target, exactly as before');
		assert.deepEqual(cheap.numbers, []);
		assert.deepEqual(
			result.items.map(i => [i.key, i.pullRequest?.id, i.etag, i.unchanged]),
			[
				['a', '1', heldEtag(1), undefined],
				['b', undefined, undefined, undefined],
				['c', '3', heldEtag(3), undefined],
			],
		);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('every etag matches: every row is unchanged and nothing is read in full', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const account = stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh);
		const cheap = stubEtagFieldsResult(gh, coordinates =>
			Promise.resolve({ value: coordinates.map(c => etagFields(c.number)) }),
		);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'b', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
			],
		});

		assert.deepEqual(cheap.numbers, [[1, 2]]);
		assert.deepEqual(full, [], 'nothing changed, so nothing is read in full');
		assert.equal(account.connectionIds.length, 0, 'no row to resolve authorship for');
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
		const account = stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh, c => found(etagShape(c.number, c.number === 3 ? 1 : 0)));
		const check = deferred<IntegrationResult<EtagSlot[] | undefined>>();
		const cheap = stubEtagFieldsResult(gh, () => check.promise);

		const pending = manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'new', owner: 'o', repo: 'r', number: 1 },
				{ key: 'same', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
				{ key: 'moved', owner: 'o', repo: 'r', number: 3, etag: heldEtag(3, 0) },
				{ key: 'new2', owner: 'o', repo: 'r', number: 4 },
			],
		});

		// The full read of the targets with no etag must not wait on the cheap check.
		for (let i = 0; i < 20 && full.length === 0; i++) {
			await Promise.resolve();
		}
		assert.deepEqual(full, [[1, 4]], 'the new targets are read in full before the cheap check settles');
		assert.deepEqual(cheap.numbers, [[2, 3]]);

		check.resolve({ value: [etagFields(2), etagFields(3, 1)] });
		const result = await pending;

		assert.deepEqual(full, [[1, 4], [3]], 'the changed target gets a second full read');
		assert.equal(account.connectionIds.length, 1, 'the account is read once per call, not once per full read');
		assert.deepEqual(
			result.items.map(i => [i.key, i.pullRequest?.id, i.unchanged, i.etag]),
			[
				['new', '1', undefined, heldEtag(1)],
				['same', undefined, true, heldEtag(2)],
				['moved', '3', undefined, heldEtag(3, 1)],
				['new2', '4', undefined, heldEtag(4)],
			],
		);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('a target the cheap check proves absent is answered absent with no full read', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, () => Promise.resolve({ value: [{ status: 'fulfilled', value: undefined }] }));

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'gone', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) }],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(result.items, [{ key: 'gone' }], 'a proven absence, cacheable as before');
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('a target the cheap check failed for its own reason falls through, and the full read’s answer stands alone', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, () =>
			Promise.resolve({
				value: [etagFields(1), { status: 'rejected', reason: new Error(samlForbiddenMessage) }],
			}),
		);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'same', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'failed', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
			],
		});

		assert.deepEqual(full, [[2]]);
		assert.deepEqual(
			result.items.map(i => [i.key, i.unchanged, i.pullRequest?.id]),
			[
				['same', true, undefined],
				['failed', undefined, '2'],
			],
		);
		assert.deepEqual(result.warnings, [], 'the full read answered, so the cheap failure is not reported');
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('a target the full read also fails is dropped with the full read’s warning', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh, () => failed(new Error('full read exploded')));
		stubEtagFieldsResult(gh, () =>
			Promise.resolve({ value: [{ status: 'rejected', reason: new Error('cheap check exploded') }] }),
		);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'failed', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) }],
		});

		assert.deepEqual(full, [[1]]);
		assert.deepEqual(result.items, [], 'dropped, never reported absent or unchanged');
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => w.message),
			['full read exploded'],
		);

		manager.dispose();
	});

	const noRetry: [string, () => Error, string][] = [
		['rate limit', () => new RequestRateLimitError(new Error('rate limited'), undefined, undefined), 'rate-limit'],
		[
			'refused credential',
			() =>
				new AuthenticationError(
					{ providerId: 'github', microHash: undefined, cloud: true, type: 'oauth', scopes: [] },
					AuthenticationErrorReason.Unauthorized,
				),
			'auth',
		],
	];
	for (const [name, reason, kind] of noRetry) {
		test(`a target the cheap check failed on a ${name} is dropped with that warning, never retried in full`, async () => {
			const { manager, gh } = await connectedGitHub(createFakeRuntime());
			stubCurrentAccount(gh, 'me');
			const full = stubFullReads(gh);
			stubEtagFieldsResult(gh, () =>
				Promise.resolve({ value: [etagFields(1), { status: 'rejected', reason: reason() }] }),
			);

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [
					{ key: 'same', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
					{ key: 'failed', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
				],
			});

			assert.deepEqual(full, [], 'a full read would only hit the same failure again');
			assert.deepEqual(
				result.items.map(i => i.key),
				['same'],
			);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(
				result.warnings.map(w => w.kind),
				[kind],
			);

			manager.dispose();
		});
	}

	test('a rate-limited cheap check drops every target it held, while the new targets are still read in full', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, () =>
			Promise.resolve({ error: new RequestRateLimitError(new Error('rate limited'), undefined, undefined) }),
		);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'new', owner: 'o', repo: 'r', number: 1 },
				{ key: 'held1', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
				{ key: 'held2', owner: 'o', repo: 'r', number: 3, etag: heldEtag(3) },
			],
		});

		assert.deepEqual(full, [[1]], 'only the targets the cheap check never held');
		assert.deepEqual(
			result.items.map(i => i.key),
			['new'],
		);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['rate-limit'],
		);

		manager.dispose();
	});

	test('a cheap check that failed outright for another reason hands every target to the full read', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, () => Promise.resolve({ error: new Error('cheap check exploded') }));

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'b', owner: 'o', repo: 'r', number: 2, etag: heldEtag(2) },
			],
		});

		assert.deepEqual(full, [[1, 2]]);
		assert.deepEqual(
			result.items.map(i => [i.key, i.pullRequest?.id, i.etag]),
			[
				['a', '1', heldEtag(1)],
				['b', '2', heldEtag(2)],
			],
		);
		assert.deepEqual(result.warnings, []);

		manager.dispose();
	});

	test('a host with no cheap check makes one full call, etags and all', async () => {
		const { manager, integration } = await connectedBitbucketServer(createFakeRuntime());
		stubCurrentAccount(integration, 'me');
		assert.equal(integration.supportsPullRequestEtags, false);
		const full = stubFullReads(integration);

		const result = await manager.getPullRequestsBatch({
			providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
			domain: 'bbs.example.com',
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'b', owner: 'o', repo: 'r', number: 2 },
			],
		});

		assert.deepEqual(full, [[1, 2]], 'one call, not one per etag partition');
		assert.deepEqual(
			result.items.map(i => [i.key, i.unchanged, i.etag]),
			[
				['a', undefined, heldEtag(1)],
				['b', undefined, heldEtag(2)],
			],
			'a matching etag is still a full row: nothing proved it current without reading it',
		);

		manager.dispose();
	});

	test('an etag from another etagIncludes set reads as changed, and the row comes back with the new one', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh);
		const cheap = stubEtagFieldsResult(gh, coordinates =>
			Promise.resolve({ value: coordinates.map(c => etagFields(c.number)) }),
		);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1, 0, []) }],
			etagIncludes: ['checks'],
		});

		assert.deepEqual(cheap.options, [{ etagIncludes: ['checks'] }]);
		assert.deepEqual(full, [[1]]);
		assert.equal(result.items[0].etag, heldEtag(1, 0, ['checks']));
		assert.match(result.items[0].etag ?? '', /^pr1\+checks:/);
		assert.equal(result.items[0].unchanged, undefined);

		manager.dispose();
	});

	test('toggling the include set between calls costs a full read each time', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh);
		stubEtagFieldsResult(gh, coordinates => Promise.resolve({ value: coordinates.map(c => etagFields(c.number)) }));

		let etag: string | undefined;
		for (const etagIncludes of [['mergeable'], ['mergeable'], ['mergeable', 'checks'], []] as const) {
			full.length = 0;
			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: etag }],
				etagIncludes: etagIncludes,
			});

			// The first call has no etag, and the second repeats the set that minted it: only the other sets mismatch.
			const sameSet = etag === heldEtag(1, 0, etagIncludes);
			assert.deepEqual(full, sameSet ? [] : [[1]], `[${etagIncludes.join(', ')}]`);
			assert.equal(result.items[0].etag, heldEtag(1, 0, etagIncludes));
			etag = result.items[0].etag;
		}

		manager.dispose();
	});

	test('with etagIncludes, a matching etag still answers unchanged, whatever the order and repeats', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubCurrentAccount(gh, 'me');
		const full = stubFullReads(gh);
		const cheap = stubEtagFieldsResult(gh, coordinates =>
			Promise.resolve({ value: coordinates.map(c => etagFields(c.number)) }),
		);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1, 0, ['mergeable', 'checks']) }],
			etagIncludes: ['checks', 'mergeable', 'checks'],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(
			cheap.options,
			[{ etagIncludes: ['mergeable', 'checks'] }],
			'the hook gets the normalized set',
		);
		assert.deepEqual(result.items, [{ key: 'a', unchanged: true, etag: heldEtag(1, 0, ['mergeable', 'checks']) }]);

		manager.dispose();
	});

	test('an unknown etagIncludes value refuses the whole call before any request', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		const cheap = stubEtagFieldsResult(gh, () => Promise.reject(new Error('must not be called')));

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'b', owner: 'o', repo: 'r', number: 2 },
			],
			etagIncludes: ['mergeable', 'review'] as unknown as PullRequestEtagInclude[],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(cheap.numbers, []);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /Unknown pull request etag include 'review'/);
		assert.match(result.warnings[0].message, /'mergeable', 'reviewDecision', 'checks'/);

		manager.dispose();
	});

	test('a duplicate key is still refused before any request, etags or not', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const full = stubFullReads(gh);
		const cheap = stubEtagFieldsResult(gh, () => Promise.reject(new Error('must not be called')));

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'same', owner: 'o', repo: 'r', number: 1, etag: heldEtag(1) },
				{ key: 'same', owner: 'o', repo: 'r', number: 2 },
			],
		});

		assert.deepEqual(full, []);
		assert.deepEqual(cheap.numbers, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /Duplicate pull request batch target key 'same'/);

		manager.dispose();
	});
});

/**
 * The failure budget of an etagged read, through the real wrappers and GitHub client: the cheap check spends a strike
 * toward disconnecting, and shows a notice, only for a refused credential. Every other failure leaves both to the
 * full reads its targets fall through to, so one refresh can't spend three of the five strikes.
 */
suite('IntegrationManager.getPullRequestsBatch etags: failure budget', () => {
	/** Answers each GraphQL document by its operation name, counting them; anything unlisted gets a 500. */
	function serveGitHub(
		runtime: FakeRuntime,
		answers: Partial<Record<'check' | 'full' | 'probe', () => Response>>,
	): { check: number; full: number; probe: number } {
		const asked = { check: 0, full: 0, probe: 0 };
		runtime.http.fetch = (_url, init) => {
			const body = typeof init?.body === 'string' ? init.body : '';
			const operation = body.includes('getPullRequestsEtagFieldsBatch')
				? 'check'
				: body.includes('getPullRequestsBatch')
					? 'full'
					: body.includes('getCurrentAccount')
						? 'probe'
						: undefined;
			if (operation != null) {
				asked[operation]++;
			}
			return Promise.resolve(
				(operation != null ? answers[operation]?.() : undefined) ?? json(500, { message: 'Server Error' }),
			);
		};
		return asked;
	}

	const etagged = [
		{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: 'held-1' },
		{ key: 'b', owner: 'o', repo: 's', number: 2, etag: 'held-2' },
	];

	test('a total outage of a fully etagged batch spends one strike and shows one notice', async () => {
		const runtime = createFakeRuntime();
		const asked = serveGitHub(runtime, {});
		const { manager, gh } = await connectedGitHub(runtime);
		stubCurrentAccount(gh, 'me');
		const watched = watchRequestFailures(runtime);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: etagged,
		});

		assert.deepEqual(result.items, [], 'dropped, never reported absent or unchanged');
		assert.equal(result.fetchFailed, true);
		assert.deepEqual([asked.check, asked.full], [1, 1], 'every target fell through to one full read');
		assert.equal(getRequestExceptionCount(gh), 1, 'the full read spends the only strike');
		assert.equal(watched.notices.length, 1, 'and shows the only notice');
		assert.equal(watched.disconnected, undefined);

		manager.dispose();
	});

	test('a total outage of a mixed batch spends at most two strikes, one per full read', async () => {
		const runtime = createFakeRuntime();
		const asked = serveGitHub(runtime, {});
		const { manager, gh } = await connectedGitHub(runtime);
		stubCurrentAccount(gh, 'me');
		const watched = watchRequestFailures(runtime);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [...etagged, { key: 'new', owner: 'o', repo: 'r', number: 3 }],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual([asked.check, asked.full], [1, 2]);
		assert.equal(getRequestExceptionCount(gh), 2, 'one strike per full read, none for the cheap check');
		assert.equal(watched.notices.length, 2);
		assert.equal(watched.disconnected, undefined);

		manager.dispose();
	});

	test('every cheap target refused by a credential the probe confirms is scoped and dropped, as before', async () => {
		const runtime = createFakeRuntime();
		const asked = serveGitHub(runtime, {
			check: () => json(403, { message: 'Resource not accessible by integration' }),
			probe: () => json(200, { data: { viewer: { databaseId: 1, login: 'me' } } }),
		});
		const { manager, gh } = await connectedGitHub(runtime);
		stubCurrentAccount(gh, 'me');
		const session = { ...(gh as unknown as { _session: ProviderAuthenticationSession })._session };

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: etagged,
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.filter(w => w.kind === 'auth').map(w => w.scope),
			[{ repositoryId: 'o/r' }, { repositoryId: 'o/s' }],
		);
		assert.deepEqual([asked.check, asked.probe, asked.full], [1, 1, 0], 'a full read would be refused again');
		assert.equal(getRequestExceptionCount(gh), 0, 'a confirmed credential spends no strike');
		assert.deepEqual((gh as unknown as { _session: ProviderAuthenticationSession })._session, session);

		manager.dispose();
	});

	test("a credential the cheap check's probe refuses too fails the check on the auth path, as before", async () => {
		const runtime = createFakeRuntime();
		const asked = serveGitHub(runtime, {
			check: () => json(401, { message: 'Bad credentials' }),
			probe: () => json(401, { message: 'Bad credentials' }),
		});
		const { manager, gh } = await connectedGitHub(runtime);
		stubCurrentAccount(gh, 'me');
		const session = { ...(gh as unknown as { _session: ProviderAuthenticationSession })._session };

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: etagged,
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => [w.kind, w.scope]),
			[['auth', undefined]],
			"the connection's failure, not a target's",
		);
		assert.deepEqual([asked.check, asked.probe, asked.full], [1, 1, 0]);
		assert.notDeepEqual(
			(gh as unknown as { _session: ProviderAuthenticationSession })._session,
			session,
			'the cloud session is expired so the next read refreshes it',
		);

		manager.dispose();
	});
});

function providerShape(number: number): PullRequestShape {
	return {
		id: `pr-${number}`,
		number: number,
		state: 'opened',
		updatedDate: new Date(0),
	} as unknown as PullRequestShape;
}
