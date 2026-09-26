import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type { GetPullRequestForRepoFn, ProviderRepoInput } from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, connectedGitLab, primarySession, providerPr, stubApi } from './sweepHelpers.js';

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
	return new PullRequest(
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
	);
}

async function connectedAzure(runtime: FakeRuntime): Promise<{ manager: Manager; azure: GitHostIntegration }> {
	const manager = createIntegrationManager(runtime);
	const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
	(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'dev.azure.com',
	};
	return { manager: manager, azure: azure };
}

async function connectedBitbucket(
	runtime: FakeRuntime,
): Promise<{ manager: Manager; integration: GitHostIntegration }> {
	const manager = createIntegrationManager(runtime);
	const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
	(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'bitbucket.org',
	};
	return { manager: manager, integration: bb };
}

async function connectedBitbucketServer(
	runtime: FakeRuntime,
): Promise<{ manager: Manager; integration: GitHostIntegration }> {
	await runtime.storage.store('integrations:configured', {
		[GitSelfManagedHostIntegrationId.BitbucketServer]: [
			{
				id: 'bbs-1',
				cloud: true,
				integrationId: GitSelfManagedHostIntegrationId.BitbucketServer,
				domain: 'https://bbs.example.com',
				scopes: 'repo',
				primary: true,
			},
		],
	});
	const manager = createIntegrationManager(runtime);
	const bbs = await manager.get(GitSelfManagedHostIntegrationId.BitbucketServer, 'bbs.example.com');
	assert.ok(bbs != null);
	(bbs as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'bbs.example.com',
	};
	return { manager: manager, integration: bbs };
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
});

function providerShape(number: number): PullRequestShape {
	return { id: `pr-${number}`, number: number } as unknown as PullRequestShape;
}
