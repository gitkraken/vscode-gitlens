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
import { getPullRequestFieldPresence } from '../fieldPresence.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import { createAzureForkSource, createAzurePullRequest } from '../providers/azure/__tests__/fixtures.js';
import type { AzurePullRequest } from '../providers/azure/models.js';
import type { GetPullRequestForRepoFn } from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { noAccess, oauthAppNotAllowed } from './azureRefusals.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { gitHubPullRequest } from './githubFixtures.js';
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
 * The pull-requests-by-branch read: for each branch, every pull request whose head is that branch, in any state.
 *
 * What these pin is what makes an empty list a PROVEN "none" a caller can cache: the match is on the head ref
 * NAME, so a merged pull request whose branch was deleted is still found; it is on the head REPOSITORY, so a
 * same-named branch in some other fork never correlates; every state is asked for, including where the host
 * answers only open ones by default; and a failure is never published as "none".
 */

type Target = { owner: string; repo: string; project?: string; branch: string; headOwner?: string };
type Answer = { pullRequests: PullRequestShape[]; truncated: boolean };
type Slot = PromiseSettledResult<Answer>;
type BranchesResultFn = (
	targets: readonly Target[],
	options: { currentAccount?: { id: string; username?: string }; limit: number },
	cancellation?: AbortSignal,
	connectionId?: string,
) => Promise<IntegrationResult<Slot[] | undefined>>;

type Manager = ReturnType<typeof createIntegrationManager>;

function stubBranchesResult(integration: GitHostIntegration, fn: BranchesResultFn): void {
	(
		integration as unknown as { getPullRequestsForBranchesResult: BranchesResultFn }
	).getPullRequestsForBranchesResult = fn;
}

/** A count of calls to `getPullRequestsForBranchesResult`, wrapping the real implementation rather than replacing it. */
function countBranchesResultCalls(integration: GitHostIntegration): { calls: number } {
	const counter = { calls: 0 };
	const target = integration as unknown as { getPullRequestsForBranchesResult: BranchesResultFn };
	const original = target.getPullRequestsForBranchesResult.bind(integration);
	target.getPullRequestsForBranchesResult = (...args) => {
		counter.calls++;
		return original(...args);
	};
	return counter;
}

function answered(pullRequests: PullRequestShape[], truncated: boolean = false): Slot {
	return { status: 'fulfilled', value: { pullRequests: pullRequests, truncated: truncated } };
}

function failed(reason: unknown): Slot {
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
async function apiClient(integration: GitHostIntegration, key: 'github'): Promise<Record<string, unknown>> {
	const { apis } = (
		integration as unknown as {
			authenticationService: { apis: Record<string, Promise<Record<string, unknown> | undefined>> };
		}
	).authenticationService;
	const client = await apis[key];
	assert.ok(client != null);
	return client;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

/** Serves every request with `respond`, recording each URL and body. */
function serve(
	runtime: FakeRuntime,
	respond: (url: string, body: string) => Response,
): { urls: string[]; bodies: string[] } {
	const requests = { urls: [] as string[], bodies: [] as string[] };
	runtime.http.fetch = (input, init) => {
		const url = input.toString();
		const body = typeof init?.body === 'string' ? init.body : '';
		requests.urls.push(url);
		requests.bodies.push(body);
		return Promise.resolve(respond(url, body));
	};
	return requests;
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

function providerShape(number: number): PullRequestShape {
	return { id: `pr-${number}`, number: number } as unknown as PullRequestShape;
}

function ids(item: { pullRequests: PullRequestShape[] } | undefined): string[] | undefined {
	return item?.pullRequests.map(pr => pr.id);
}

/**
 * Replaces a provider's provider-apis single pull request read — the one `getPullRequestsBatch` resolves through,
 * and so the one GitLab and Azure DevOps resolve a branch's matches through — keeping `ProvidersApi`'s own handling
 * of what it answers.
 */
async function stubSdkPullRequestFn(
	manager: Manager,
	providerId: GitCloudHostIntegrationId,
	fn: GetPullRequestForRepoFn,
): Promise<{ numbers: number[] }> {
	const requested = { numbers: [] as number[] };
	const api = await (manager as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();
	const providers = (
		api as unknown as { providers: Record<string, { getPullRequestForRepoFn?: unknown } | undefined> }
	).providers;
	const provider = providers[providerId];
	assert.ok(provider != null);
	provider.getPullRequestForRepoFn = ((input, options) => {
		requested.numbers.push(input.number);
		return fn(input, options);
	}) satisfies GetPullRequestForRepoFn;
	return requested;
}

/** What provider-apis' single pull request read answers for `number`: authored by `me`, at its own URL. */
function sdkPullRequest(number: number): { data: ReturnType<typeof providerPr> } {
	return {
		data: providerPr(`gid-${number}`, {
			number: number,
			url: `https://example.com/pull/${number}`,
			author: { id: 'me', name: 'Me', email: null, username: 'me', avatarUrl: null, url: null },
		}),
	};
}

/** An error shaped like provider-apis' for an HTTP failure, which `ProvidersApi` classifies by `response`. */
function sdkHttpError(status: number, body: unknown): Error {
	return Object.assign(new Error(`(${status})`), { response: { status: status, body: body, headers: {} } });
}

/** A GitHub GraphQL pull request node from `o/a`'s `feature` branch, or from a fork's `feature` when `forkOwner`. */
function gitHubPullRequestNode(number: number, forkOwner?: string): Record<string, unknown> {
	const headOwner = forkOwner ?? 'o';
	return {
		...gitHubPullRequest(number, {
			body: '',
			headRepository: {
				isFork: forkOwner != null,
				name: 'a',
				owner: { login: headOwner },
				sshUrl: 'git@github.com:o/a.git',
				url: 'https://github.com/o/a',
			},
			headRepositoryOwner: { login: headOwner },
			isCrossRepository: forkOwner != null,
		}),
	};
}

function gitLabMergeRequest(
	iid: number,
	options?: {
		state?: 'opened' | 'merged' | 'closed';
		updatedAt?: string;
		forkNamespace?: string;
		branch?: string;
	},
): Record<string, unknown> {
	const project = { id: 'gid://gitlab/Project/1', fullPath: 'group/r', webUrl: 'https://gitlab.com/group/r' };
	const sourceProject =
		options?.forkNamespace != null
			? {
					id: 'gid://gitlab/Project/2',
					fullPath: `${options.forkNamespace}/r`,
					webUrl: `https://gitlab.com/${options.forkNamespace}/r`,
				}
			: project;
	const updatedAt = options?.updatedAt ?? '2026-01-01T00:00:00Z';
	return {
		id: `gid://gitlab/MergeRequest/${iid}`,
		iid: String(iid),
		state: options?.state ?? 'opened',
		author: { id: 'gid://gitlab/User/1', name: 'Me', avatarUrl: null, webUrl: 'https://gitlab.com/me' },
		diffRefs: { baseSha: 'base', headSha: 'head' },
		title: `MR ${iid}`,
		description: null,
		webUrl: `https://gitlab.com/group/r/-/merge_requests/${iid}`,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: updatedAt,
		mergedAt: options?.state === 'merged' ? updatedAt : null,
		targetBranch: 'main',
		sourceBranch: options?.branch ?? 'feature',
		project: project,
		sourceProject: sourceProject,
	};
}

function gitLabConnection(nodes: Record<string, unknown>[], count: number = nodes.length): unknown {
	return {
		data: {
			project: { mergeRequests: { count: count, pageInfo: { hasNextPage: count > nodes.length }, nodes: nodes } },
		},
	};
}

function bitbucketCloudPullRequest(
	id: number,
	options?: { state?: 'OPEN' | 'MERGED' | 'DECLINED'; updatedOn?: string; forkWorkspace?: string },
): Record<string, unknown> {
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
	const source =
		options?.forkWorkspace != null
			? {
					uuid: '{fork}',
					name: 'r',
					full_name: `${options.forkWorkspace}/r`,
					links: { html: { href: `https://bitbucket.org/${options.forkWorkspace}/r` } },
				}
			: repository;
	const state = options?.state ?? 'OPEN';
	return {
		id: id,
		title: `PR ${id}`,
		state: state,
		author: user,
		closed_by: state === 'OPEN' ? null : user,
		created_on: '2026-01-01T00:00:00Z',
		updated_on: options?.updatedOn ?? '2026-01-02T00:00:00Z',
		links: { html: { href: `https://bitbucket.org/o/r/pull-requests/${id}` } },
		destination: { repository: repository, branch: { name: 'main' }, commit: { hash: 'base' } },
		source: { repository: source, branch: { name: 'feature' }, commit: { hash: 'head' } },
		participants: [],
	};
}

function bitbucketServerPullRequest(
	id: number,
	options?: { state?: 'OPEN' | 'MERGED' | 'DECLINED'; updatedDate?: number; targetRepositoryId?: number },
): Record<string, unknown> {
	const user = {
		id: 1,
		name: 'me',
		displayName: 'Me',
		emailAddress: 'me@example.com',
		links: { self: [{ href: 'https://bbs.example.com/users/me' }] },
	};
	const repository = (repositoryId: number, key: string) => ({
		id: repositoryId,
		slug: 'r',
		name: 'r',
		project: { key: key },
		links: { clone: [], self: [{ href: `https://bbs.example.com/projects/${key}/repos/r/browse` }] },
	});
	const state = options?.state ?? 'OPEN';
	return {
		id: id,
		version: 0,
		title: `PR ${id}`,
		description: '',
		state: state,
		open: state === 'OPEN',
		closed: state !== 'OPEN',
		createdDate: 0,
		updatedDate: options?.updatedDate ?? 0,
		closedDate: state === 'OPEN' ? null : (options?.updatedDate ?? 0),
		fromRef: {
			id: 'refs/heads/feature',
			displayId: 'feature',
			latestCommit: 'head',
			repository: repository(1, 'O'),
		},
		toRef: {
			id: 'refs/heads/main',
			displayId: 'main',
			latestCommit: 'base',
			repository:
				options?.targetRepositoryId != null
					? repository(options.targetRepositoryId, 'UPSTREAM')
					: repository(1, 'O'),
		},
		author: { user: user },
		reviewers: [],
		participants: [],
		properties: { commentCount: 0 },
		links: { self: [{ href: `https://bbs.example.com/projects/O/repos/r/pull-requests/${id}` }] },
	};
}

function azurePullRequest(
	id: number,
	options?: { status?: 'active' | 'completed'; creationDate?: string; closedDate?: string; fork?: boolean },
): AzurePullRequest {
	const pr = createAzurePullRequest(
		`https://dev.azure.com/org/proj/_apis/git/repositories/r/pullRequests/${id}`,
		'proj',
		'r',
	);
	const result: AzurePullRequest = {
		...pr,
		pullRequestId: id,
		codeReviewId: id,
		status: options?.status ?? 'active',
		creationDate: options?.creationDate ?? pr.creationDate,
		closedDate: options?.closedDate,
	};
	if (options?.fork) {
		result.forkSource = createAzureForkSource(pr);
	}
	return result;
}

suite('IntegrationManager.getPullRequestsForBranches', () => {
	test('answers found, none and failed targets in one integration call, dropping only the failure', async () => {
		const { manager, gl } = await connectedGitLab(createFakeRuntime());
		stubCurrentAccount(gl, 'me');
		stubBranchesResult(gl, targets =>
			Promise.resolve({
				value: targets.map(t => {
					switch (t.branch) {
						case 'found':
							return answered([providerShape(2), providerShape(1)]);
						case 'none':
							return answered([]);
						default:
							return failed(new Error('upstream exploded'));
					}
				}),
			}),
		);
		const calls = countBranchesResultCalls(gl);

		const result = await manager.getPullRequestsForBranches({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: [
				{ key: 'a', owner: 'o', repo: 'r', branch: 'found' },
				{ key: 'b', owner: 'o', repo: 'r', branch: 'none' },
				{ key: 'c', owner: 'o', repo: 'r', branch: 'failed' },
			],
		});

		assert.equal(calls.calls, 1, 'every target is answered in one integration call, not one per target');
		assert.deepEqual(result.items, [
			{ key: 'a', pullRequests: [providerShape(2), providerShape(1)] },
			// The empty list IS returned — that is what makes "none" cacheable.
			{ key: 'b', pullRequests: [] },
		]);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);

		manager.dispose();
	});

	test('passes truncation through, and only when set', async () => {
		const { manager, gl } = await connectedGitLab(createFakeRuntime());
		stubCurrentAccount(gl, 'me');
		stubBranchesResult(gl, targets =>
			Promise.resolve({ value: targets.map(t => answered([providerShape(1)], t.branch === 'busy')) }),
		);

		const result = await manager.getPullRequestsForBranches({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: [
				{ key: 'busy', owner: 'o', repo: 'r', branch: 'busy' },
				{ key: 'quiet', owner: 'o', repo: 'r', branch: 'quiet' },
			],
		});

		assert.equal(result.items[0].truncated, true);
		assert.ok(!('truncated' in result.items[1]));

		manager.dispose();
	});

	test('no targets is an empty success, not a refusal', async () => {
		const { manager } = await connectedGitHub(createFakeRuntime());

		const result = await manager.getPullRequestsForBranches({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [],
		});

		assert.deepEqual(result, { items: [], warnings: [] });

		manager.dispose();
	});

	test('refuses the whole call on a duplicate key rather than answering ambiguously', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let calls = 0;
		stubBranchesResult(gh, targets => {
			calls++;
			return Promise.resolve({ value: targets.map(() => answered([])) });
		});

		const result = await manager.getPullRequestsForBranches({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'same', owner: 'o', repo: 'r', branch: 'a' },
				{ key: 'same', owner: 'o', repo: 'r', branch: 'b' },
			],
		});

		assert.equal(calls, 0);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /Duplicate pull request branch target key 'same'/);

		manager.dispose();
	});

	test('reports an issue tracker as the wrong surface instead of attempting it', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getPullRequestsForBranches({
			providerId: IssuesCloudHostIntegrationId.Jira,
			targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'feature' }],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /not supported/i);

		manager.dispose();
	});

	test('refuses an empty or padded branch, or one given as a full ref, before asking anything', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let calls = 0;
		stubBranchesResult(gh, targets => {
			calls++;
			return Promise.resolve({ value: targets.map(() => answered([])) });
		});

		for (const [branch, message] of [
			['', /requires a non-empty branch/],
			['  ', /requires a non-empty branch/],
			// Sent as is, a padded name would match no branch and answer a cacheable "none".
			[' feature', /can't start or end with whitespace/],
			['feature\t', /can't start or end with whitespace/],
			['refs/heads/feature', /pass the branch's short name, without 'refs\/heads\/'/],
		] as const) {
			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [
					{ key: 'ok', owner: 'o', repo: 'r', branch: 'feature' },
					{ key: 'bad', owner: 'o', repo: 'r', branch: branch },
				],
			});

			assert.deepEqual(result.items, [], `branch ${JSON.stringify(branch)}`);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, message);
		}
		assert.equal(calls, 0, 'a refusal costs no request');

		manager.dispose();
	});

	test('refuses a target with an empty owner or repo', async () => {
		const { manager } = await connectedGitHub(createFakeRuntime());

		for (const [owner, repo] of [
			['', 'r'],
			['o', ' '],
		]) {
			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'bad', owner: owner, repo: repo, branch: 'feature' }],
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /requires a non-empty owner and repo/);
		}

		manager.dispose();
	});

	test('refuses an Azure DevOps target that names no project', async () => {
		const { manager, azure } = await connectedAzure(createFakeRuntime());
		let calls = 0;
		stubBranchesResult(azure, targets => {
			calls++;
			return Promise.resolve({ value: targets.map(() => answered([])) });
		});

		for (const providerId of [
			GitCloudHostIntegrationId.AzureDevOps,
			GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		]) {
			for (const project of [undefined, ' ']) {
				const result = await manager.getPullRequestsForBranches({
					providerId: providerId,
					targets: [{ key: 'bad', owner: 'org', repo: 'r', project: project, branch: 'feature' }],
				});

				assert.deepEqual(result.items, [], `${providerId} with project ${JSON.stringify(project)}`);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /target 'bad' requires a project/);
			}
		}
		assert.equal(calls, 0);

		manager.dispose();
	});

	test('refuses headOwner where a fork cannot be found by its owner, and accepts it elsewhere', async () => {
		const runtime = createFakeRuntime();
		const { manager, azure } = await connectedAzure(runtime);
		let calls = 0;
		stubBranchesResult(azure, targets => {
			calls++;
			return Promise.resolve({ value: targets.map(() => answered([])) });
		});

		for (const providerId of [
			GitCloudHostIntegrationId.AzureDevOps,
			GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			GitSelfManagedHostIntegrationId.BitbucketServer,
		]) {
			const result = await manager.getPullRequestsForBranches({
				providerId: providerId,
				targets: [
					{ key: 'fork', owner: 'org', repo: 'r', project: 'proj', branch: 'feature', headOwner: 'someone' },
				],
			});

			assert.deepEqual(result.items, [], providerId);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /has a headOwner other than its owner, which .* can't honor/);
		}
		assert.equal(calls, 0);

		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		stubCurrentAccount(gh, 'me');
		let forwarded: Target[] = [];
		stubBranchesResult(gh, targets => {
			forwarded = [...targets];
			return Promise.resolve({ value: targets.map(() => answered([])) });
		});

		const result = await manager.getPullRequestsForBranches({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'fork', owner: 'o', repo: 'r', branch: 'feature', headOwner: 'forker' }],
		});

		assert.deepEqual(result.items, [{ key: 'fork', pullRequests: [] }]);
		assert.equal(forwarded[0]?.headOwner, 'forker');

		manager.dispose();
	});

	test('a missing session is a connection warning, never a batch of "none"s', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		const github = await apiClient(gh, 'github');
		let calls = 0;
		github.getPullRequestsForBranches = (_p: unknown, _t: unknown, targets: readonly Target[]) => {
			calls++;
			return Promise.resolve(targets.map(() => answered([])));
		};

		const result = await manager.getPullRequestsForBranches({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'feature' }],
		});

		assert.equal(calls, 0);
		assert.deepEqual(result.items, [], 'no target is reported as having no pull requests');
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0]?.kind, 'no-connection', 'reported as a connection problem, not "unsupported"');

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
		github.getPullRequestsForBranches = (provider: ProviderReference, token: TokenWithInfo, targets: Target[]) => {
			tokens.push(token.accessToken);
			return Promise.resolve(
				targets.map(() => ({
					status: 'fulfilled',
					value: { pullRequests: [pullRequest(provider, 1)], truncated: false },
				})),
			);
		};

		const result = await manager.getPullRequestsForBranches({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'feature' }],
			connectionId: 'secondary',
		});

		assert.deepEqual(tokens, ['secondary-token']);
		assert.deepEqual(account.connectionIds, ['secondary']);
		assert.equal(result.items[0]?.pullRequests[0]?.number, 1);

		manager.dispose();
	});

	suite('GitHub', () => {
		test('answers up to 25 targets per request, uncached, converted like the list rows', async () => {
			const runtime = createFakeRuntime();
			let cacheReads = 0;
			runtime.cache.getPullRequestForBranch = () => {
				cacheReads++;
				throw new Error('the branch read must not go through the pull request cache');
			};
			const { manager, gh } = await connectedGitHub(runtime);
			const account = stubCurrentAccount(gh, 'me');
			const github = await apiClient(gh, 'github');
			const sizes: number[] = [];
			const limits: number[] = [];
			const forwarded: Target[] = [];
			// The truncated target takes the REST step, which confirms more match than were returned.
			github.getPullRequestNumbersForBranch = () => Promise.resolve({ numbers: [1], truncated: true });
			github.getPullRequestsForBranches = (
				provider: ProviderReference,
				_t: unknown,
				targets: Target[],
				options: { limit: number },
			) => {
				sizes.push(targets.length);
				limits.push(options.limit);
				forwarded.push(...targets);
				return Promise.resolve(
					targets.map((_, i) => ({
						status: 'fulfilled',
						value: { pullRequests: [pullRequest(provider, i + 1, 'me')], truncated: i === 0 },
					})),
				);
			};

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: Array.from({ length: 26 }, (_, i) => ({
					key: `k${i + 1}`,
					owner: 'o',
					repo: 'r',
					branch: `b${i + 1}`,
					...(i === 1 ? { headOwner: 'forker' } : {}),
				})),
			});

			assert.deepEqual(sizes, [25, 1]);
			assert.deepEqual(limits, [10, 10], 'the per-target cap is 10');
			assert.equal(forwarded[1].headOwner, 'forker');
			assert.equal(account.connectionIds.length, 1, 'the account is read once per call, not per chunk');
			assert.equal(result.items.length, 26);
			assert.equal(result.items[0].truncated, true);
			const first = result.items[0].pullRequests[0];
			assert.equal(first.number, 1);
			assert.equal(first.state, 'merged');
			assert.equal(first.authoredByMe, true, 'authorship is resolved like the list rows');
			assert.equal(result.fetchFailed, undefined);
			assert.equal(cacheReads, 0);

			manager.dispose();
		});

		test('a target that fails on its own (e.g. SAML) drops only that target, with no strike or session expiry', async () => {
			const { manager, gh } = await connectedGitHub(createFakeRuntime());
			stubCurrentAccount(gh, 'me');
			const github = await apiClient(gh, 'github');
			github.getPullRequestsForBranches = (provider: ProviderReference, _t: unknown, targets: Target[]) =>
				Promise.resolve(
					targets.map((_, i) =>
						i === 1
							? { status: 'rejected', reason: new Error(samlForbiddenMessage) }
							: {
									status: 'fulfilled',
									value: { pullRequests: [pullRequest(provider, 1)], truncated: false },
								},
					),
				);
			const sessionBefore = { ...(gh as unknown as { _session: ProviderAuthenticationSession })._session };

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [
					{ key: 'found', owner: 'o', repo: 'r', branch: 'feature' },
					{ key: 'saml', owner: 'o', repo: 'saml-org', branch: 'feature' },
				],
			});

			assert.deepEqual(
				result.items.map(i => i.key),
				['found'],
				'the SAML-forbidden target is dropped, never reported as having none',
			);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings[0]?.kind, 'other');
			assert.match(result.warnings[0]?.message ?? '', /SAML enforcement/);
			assert.equal(getRequestExceptionCount(gh), 0, 'a working token must not spend a strike');
			assert.deepEqual((gh as unknown as { _session: ProviderAuthenticationSession })._session, sessionBefore);

			manager.dispose();
		});

		test('a throwing chunk drops only its own targets — the other chunk still answers', async () => {
			const { manager, gh } = await connectedGitHub(createFakeRuntime());
			stubCurrentAccount(gh, 'me');
			const github = await apiClient(gh, 'github');
			github.getPullRequestsForBranches = (provider: ProviderReference, _t: unknown, targets: Target[]) => {
				if (targets.length === 1) return Promise.reject(new Error('second chunk exploded'));

				return Promise.resolve(
					targets.map(() => ({
						status: 'fulfilled',
						value: { pullRequests: [pullRequest(provider, 1)], truncated: false },
					})),
				);
			};

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: Array.from({ length: 26 }, (_, i) => ({
					key: `k${i + 1}`,
					owner: 'o',
					repo: 'r',
					branch: `b${i + 1}`,
				})),
			});

			assert.deepEqual(
				result.items.map(i => i.key),
				Array.from({ length: 25 }, (_, i) => `k${i + 1}`),
			);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);

			manager.dispose();
		});

		test('a headOwner equal to the owner, in any case, means the base repository', async () => {
			const runtime = createFakeRuntime();
			const requests = serve(runtime, () =>
				json(200, {
					data: {
						b0: {
							pullRequests: {
								totalCount: 2,
								nodes: [gitHubPullRequestNode(1), gitHubPullRequestNode(2, 'forker')],
							},
						},
					},
				}),
			);
			const { manager, gh } = await connectedGitHub(runtime);
			stubCurrentAccount(gh, 'me');

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'a', owner: 'o', repo: 'a', branch: 'feature', headOwner: 'O' }],
			});

			assert.deepEqual(ids(result.items[0]), ['1']);
			assert.equal(requests.urls.length, 1);

			manager.dispose();
		});

		test('a padded headOwner equal to the owner means the base repository', async () => {
			const runtime = createFakeRuntime();
			const requests = serve(runtime, () =>
				json(200, {
					data: {
						b0: {
							pullRequests: {
								totalCount: 2,
								nodes: [gitHubPullRequestNode(1), gitHubPullRequestNode(2, 'forker')],
							},
						},
					},
				}),
			);
			const { manager, gh } = await connectedGitHub(runtime);
			stubCurrentAccount(gh, 'me');

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'a', owner: 'o', repo: 'a', branch: 'feature', headOwner: '  o  ' }],
			});

			assert.deepEqual(ids(result.items[0]), ['1']);
			assert.equal(requests.urls.length, 1);

			manager.dispose();
		});
		suite('a branch name other forks share', () => {
			/** A node from `o/a`'s `feature` branch, or a fork's, updated on day `day` of January 2026. */
			function node(number: number, day: number, forkOwner?: string): Record<string, unknown> {
				return {
					...gitHubPullRequestNode(number, forkOwner),
					updatedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`,
				};
			}

			/** Ten pull requests from ten other forks' `feature`, out of `totalCount` of that name. */
			function strangers(): Record<string, unknown>[] {
				return Array.from({ length: 10 }, (_, i) => node(100 + i, 1, `stranger${i}`));
			}

			/**
			 * Serves the branch query (`branches` per alias), the REST head filter (`heads` by `head` parameter) and
			 * the batch read (any number in `nodes`), recording which of them were asked.
			 */
			function serveGitHub(
				runtime: FakeRuntime,
				branches: Record<string, { nodes: Record<string, unknown>[]; totalCount: number }>,
				heads: Record<string, number[] | Response>,
				nodes: Record<number, Record<string, unknown>> = {},
			): { heads: URL[]; batches: number[][]; urls: string[] } {
				const asked = { heads: [] as URL[], batches: [] as number[][] };
				const requests = serve(runtime, (url, body) => {
					if (url.includes('/pulls?')) {
						const parsed = new URL(url);
						asked.heads.push(parsed);
						const head = heads[parsed.searchParams.get('head') ?? ''];
						if (head instanceof Response) return head;

						return json(
							200,
							(head ?? []).map(n => ({ number: n })),
						);
					}

					const { query, variables } = JSON.parse(body) as {
						query: string;
						variables: Record<string, unknown>;
					};
					if (query.includes('query getPullRequestsBatch')) {
						const numbers = Object.keys(variables)
							.filter(k => /^k\d+$/.test(k))
							.map(k => variables[k] as number);
						asked.batches.push(numbers);
						return json(200, {
							data: Object.fromEntries(
								numbers.map((n, i) => [`p${i}`, { pullRequest: nodes[n] ?? null }]),
							),
						});
					}

					return json(200, {
						data: Object.fromEntries(
							Object.entries(branches).map(([alias, b]) => [
								alias,
								{ pullRequests: { totalCount: b.totalCount, nodes: b.nodes } },
							]),
						),
					});
				});
				return { ...asked, urls: requests.urls };
			}

			test('none of thirty same-named pull requests is a proven "none" once REST finds no match', async () => {
				const runtime = createFakeRuntime();
				const asked = serveGitHub(
					runtime,
					{ b0: { nodes: strangers(), totalCount: 30 } },
					{ 'mine:feature': [] },
				);
				const { manager, gh } = await connectedGitHub(runtime);
				stubCurrentAccount(gh, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitHub,
					targets: [{ key: 'a', owner: 'o', repo: 'a', branch: 'feature', headOwner: 'mine' }],
				});

				assert.deepEqual(ids(result.items[0]), []);
				assert.equal(result.items[0].truncated, undefined);
				assert.equal(result.fetchFailed, undefined);
				assert.equal(asked.heads.length, 1);
				const head = asked.heads[0];
				assert.equal(head.pathname, '/repos/o/a/pulls');
				assert.equal(head.searchParams.get('head'), 'mine:feature', "a fork's branch is headed by its owner");
				assert.equal(head.searchParams.get('state'), 'all');
				assert.equal(head.searchParams.get('sort'), 'updated');
				assert.equal(head.searchParams.get('direction'), 'desc');
				assert.equal(head.searchParams.get('per_page'), '11');
				assert.deepEqual(asked.batches, [], 'nothing to resolve');

				manager.dispose();
			});

			test('two matches among thirty: both, newest first, the unfetched one resolved like the rest', async () => {
				const runtime = createFakeRuntime();
				const page = [...strangers().slice(0, 9), node(5, 2, 'mine')];
				const asked = serveGitHub(
					runtime,
					{ b0: { nodes: page, totalCount: 30 } },
					{ 'mine:feature': [9, 5] },
					{ 9: node(9, 3, 'mine') },
				);
				const { manager, gh } = await connectedGitHub(runtime);
				stubCurrentAccount(gh, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitHub,
					targets: [{ key: 'a', owner: 'o', repo: 'a', branch: 'feature', headOwner: 'mine' }],
				});

				assert.deepEqual(
					result.items[0].pullRequests.map(pr => pr.number),
					[9, 5],
				);
				assert.equal(result.items[0].truncated, undefined);
				assert.deepEqual(asked.batches, [[9]], 'only the number the branch query missed is resolved');
				const [resolved, found] = result.items[0].pullRequests;
				assert.notEqual(getPullRequestFieldPresence(resolved), undefined);
				assert.deepEqual(
					getPullRequestFieldPresence(resolved),
					getPullRequestFieldPresence(found),
					'a resolved row carries the same field presence as a row the branch query returned',
				);

				manager.dispose();
			});

			test('a branch in the base repository is headed by its owner, and found rows cost no resolve', async () => {
				const runtime = createFakeRuntime();
				const page = [...strangers().slice(0, 9), node(5, 2)];
				const asked = serveGitHub(runtime, { b0: { nodes: page, totalCount: 30 } }, { 'o:feature': [5] });
				const { manager, gh } = await connectedGitHub(runtime);
				stubCurrentAccount(gh, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitHub,
					targets: [{ key: 'a', owner: 'o', repo: 'a', branch: 'feature' }],
				});

				assert.deepEqual(
					result.items[0].pullRequests.map(pr => pr.number),
					[5],
				);
				assert.equal(result.items[0].truncated, undefined);
				assert.equal(asked.heads[0].searchParams.get('head'), 'o:feature');
				assert.deepEqual(asked.batches, []);

				manager.dispose();
			});

			test('truncated when REST holds more matches than the limit', async () => {
				const runtime = createFakeRuntime();
				const numbers = Array.from({ length: 11 }, (_, i) => 200 + i);
				const asked = serveGitHub(
					runtime,
					{ b0: { nodes: strangers(), totalCount: 40 } },
					{ 'o:feature': numbers },
					Object.fromEntries(numbers.map(n => [n, node(n, 20 - (n - 200))])),
				);
				const { manager, gh } = await connectedGitHub(runtime);
				stubCurrentAccount(gh, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitHub,
					targets: [{ key: 'a', owner: 'o', repo: 'a', branch: 'feature' }],
				});

				assert.deepEqual(
					result.items[0].pullRequests.map(pr => pr.number),
					numbers.slice(0, 10),
				);
				assert.equal(result.items[0].truncated, true);
				assert.deepEqual(asked.batches, [numbers.slice(0, 10)], 'the extra one is never resolved');

				manager.dispose();
			});

			test("a deleted fork's pull request on the first page is kept alongside REST's matches", async () => {
				// GitHub keeps the deleted fork's owner on `headRepositoryOwner` (live: microsoft/vscode#336605), so
				// the branch query still matches it, while REST's `head` filter can't see it: the answer is the union.
				const runtime = createFakeRuntime();
				const deleted = { ...node(7, 2, 'mine'), headRepository: null };
				const asked = serveGitHub(
					runtime,
					{ b0: { nodes: [...strangers().slice(0, 9), deleted], totalCount: 30 } },
					{ 'mine:feature': [9] },
					{ 9: node(9, 3, 'mine') },
				);
				const { manager, gh } = await connectedGitHub(runtime);
				stubCurrentAccount(gh, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitHub,
					targets: [{ key: 'a', owner: 'o', repo: 'a', branch: 'feature', headOwner: 'mine' }],
				});

				assert.deepEqual(
					result.items[0].pullRequests.map(pr => pr.number),
					[9, 7],
					"the pull request REST found, and the deleted fork's the branch query found",
				);
				assert.equal(result.items[0].truncated, undefined);
				assert.equal(result.fetchFailed, undefined);
				assert.equal(asked.heads.length, 1);
				assert.deepEqual(asked.batches, [[9]], 'only the number the branch query missed is resolved');

				manager.dispose();
			});

			test('a target REST fails for is dropped, never answered from the branch query alone', async () => {
				const runtime = createFakeRuntime();
				serveGitHub(
					runtime,
					{
						b0: { nodes: strangers(), totalCount: 30 },
						b1: { nodes: strangers(), totalCount: 30 },
					},
					{ 'o:feature': [], 'o:other': json(500, { message: '500 Internal Server Error' }) },
				);
				const { manager, gh } = await connectedGitHub(runtime);
				stubCurrentAccount(gh, 'me');
				const watched = watchRequestFailures(runtime);

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitHub,
					targets: [
						{ key: 'answered', owner: 'o', repo: 'a', branch: 'feature' },
						{ key: 'failed', owner: 'o', repo: 'a', branch: 'other' },
					],
				});

				assert.deepEqual(
					result.items.map(i => i.key),
					['answered'],
				);
				assert.deepEqual(ids(result.items[0]), []);
				assert.equal(result.fetchFailed, true);
				assert.equal(getRequestExceptionCount(gh), 0, 'one target failing costs no strike');
				assert.equal(watched.notices.length, 1, 'one notice for the whole call');

				manager.dispose();
			});

			test('a match the batch read cannot check fails its target, not its siblings', async () => {
				const runtime = createFakeRuntime();
				serveGitHub(
					runtime,
					{
						b0: { nodes: strangers(), totalCount: 30 },
						b1: { nodes: strangers(), totalCount: 30 },
					},
					{ 'o:feature': [8], 'o:other': [] },
				);
				// The branch query missed 8, and the batch read's alias for it refuses.
				const inner = runtime.http.fetch;
				runtime.http.fetch = async (input, init) => {
					const body = typeof init?.body === 'string' ? init.body : '';
					if (body.includes('query getPullRequestsBatch')) {
						return json(200, {
							data: { p0: null },
							errors: [{ type: 'FORBIDDEN', path: ['p0'], message: 'Resource not accessible' }],
						});
					}
					return inner(input, init);
				};
				const { manager, gh } = await connectedGitHub(runtime);
				stubCurrentAccount(gh, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitHub,
					targets: [
						{ key: 'unresolved', owner: 'o', repo: 'a', branch: 'feature' },
						{ key: 'answered', owner: 'o', repo: 'a', branch: 'other' },
					],
				});

				assert.deepEqual(
					result.items.map(i => i.key),
					['answered'],
				);
				assert.equal(result.fetchFailed, true);

				manager.dispose();
			});

			test('a target the branch query settled takes no REST step', async () => {
				const runtime = createFakeRuntime();
				const asked = serveGitHub(runtime, { b0: { nodes: [node(5, 2, 'mine')], totalCount: 1 } }, {});
				const { manager, gh } = await connectedGitHub(runtime);
				stubCurrentAccount(gh, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitHub,
					targets: [{ key: 'a', owner: 'o', repo: 'a', branch: 'feature', headOwner: 'mine' }],
				});

				assert.deepEqual(
					result.items[0].pullRequests.map(pr => pr.number),
					[5],
				);
				assert.equal(asked.urls.length, 1);
				assert.deepEqual(asked.heads, []);

				manager.dispose();
			});
		});
	});

	suite('GitLab', () => {
		/** Answers the branch query with `respond`; anything else is unexpected, since step two is stubbed. */
		function branchQuery(
			runtime: FakeRuntime,
			respond: (variables: { branches: string[] }) => Response,
		): { bodies: string[] } {
			return serve(runtime, (_url, body) => {
				const request = JSON.parse(body) as { query: string; variables: { branches: string[] } };
				return request.query.includes('getMergeRequestsForBranch')
					? respond(request.variables)
					: json(500, { message: `unexpected request: ${request.query}` });
			});
		}

		test('finds merge requests by source branch name in every state, newest first, from the right source project', async () => {
			const runtime = createFakeRuntime();
			const nodes = [
				gitLabMergeRequest(1, { state: 'opened', updatedAt: '2026-01-01T00:00:00Z' }),
				gitLabMergeRequest(2, { state: 'merged', updatedAt: '2026-03-01T00:00:00Z' }),
				gitLabMergeRequest(3, { forkNamespace: 'forker', updatedAt: '2026-02-01T00:00:00Z' }),
			];
			const requests = branchQuery(runtime, () => json(200, gitLabConnection(nodes)));
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');
			const resolved = await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.GitLab, input =>
				Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [
					{ key: 'base', owner: 'group', repo: 'r', branch: 'feature' },
					{ key: 'fork', owner: 'group', repo: 'r', branch: 'feature', headOwner: 'forker' },
				],
			});

			// Newest first, kept in the branch query's order; the fork's same-named branch is a different branch.
			assert.deepEqual(ids(result.items[0]), ['gid-2', 'gid-1']);
			assert.deepEqual(ids(result.items[1]), ['gid-3']);
			assert.deepEqual(resolved.numbers, [2, 1, 3], 'only the matches are resolved');
			assert.equal(result.fetchFailed, undefined);

			const request = JSON.parse(requests.bodies[0]) as { query: string; variables: Record<string, unknown> };
			assert.match(request.query, /mergeRequests\(sourceBranches: \$branches, state: all, sort: UPDATED_DESC/);
			assert.deepEqual(request.variables, { fullPath: 'group/r', branches: ['feature'], limit: 10 });

			manager.dispose();
		});

		test('a headOwner equal to the owner, in any case, means the base repository', async () => {
			const runtime = createFakeRuntime();
			branchQuery(runtime, () =>
				json(
					200,
					gitLabConnection([gitLabMergeRequest(1), gitLabMergeRequest(3, { forkNamespace: 'forker' })]),
				),
			);
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.GitLab, input =>
				Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', branch: 'feature', headOwner: 'Group' }],
			});

			assert.deepEqual(ids(result.items[0]), ['gid-1']);

			manager.dispose();
		});

		test('a branch row is exactly the row getPullRequestsBatch returns for that merge request', async () => {
			const runtime = createFakeRuntime();
			branchQuery(runtime, () => json(200, gitLabConnection([gitLabMergeRequest(7)])));
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.GitLab, input =>
				Promise.resolve(sdkPullRequest(input.number)),
			);

			const batch = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', number: 7 }],
			});
			const branch = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', branch: 'feature' }],
			});

			const row = branch.items[0].pullRequests[0];
			assert.ok(batch.items[0].pullRequest != null);
			assert.deepStrictEqual(row, batch.items[0].pullRequest);
			assert.equal(row.url, 'https://example.com/pull/7');
			assert.equal(row.authoredByMe, true);

			manager.dispose();
		});

		test('a merge request the second step cannot check fails its whole branch, not just itself', async () => {
			const runtime = createFakeRuntime();
			branchQuery(runtime, variables =>
				json(
					200,
					gitLabConnection(
						variables.branches[0] === 'feature'
							? [gitLabMergeRequest(1), gitLabMergeRequest(2)]
							: [gitLabMergeRequest(3, { branch: 'other' })],
					),
				),
			);
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.GitLab, input =>
				input.number === 2
					? Promise.reject(sdkHttpError(500, { message: 'boom' }))
					: Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [
					{ key: 'a', owner: 'group', repo: 'r', branch: 'feature' },
					{ key: 'b', owner: 'group', repo: 'r', branch: 'other' },
				],
			});

			assert.deepEqual(
				result.items.map(i => [i.key, ids(i)]),
				[['b', ['gid-3']]],
				'a partial list would read as a complete one',
			);
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('truncated when GitLab holds more merge requests of that branch name than it returned', async () => {
			const runtime = createFakeRuntime();
			branchQuery(runtime, () => json(200, gitLabConnection([gitLabMergeRequest(1)], 12)));
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.GitLab, input =>
				Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'r', branch: 'feature' }],
			});

			assert.deepEqual(ids(result.items[0]), ['gid-1']);
			assert.equal(result.items[0].truncated, true);

			manager.dispose();
		});

		test('a missing project is a proven "none", with nothing to resolve', async () => {
			const runtime = createFakeRuntime();
			branchQuery(runtime, () => json(200, { data: { project: null } }));
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');
			const resolved = await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.GitLab, input =>
				Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [{ key: 'a', owner: 'group', repo: 'gone', branch: 'feature' }],
			});

			assert.deepEqual(result.items, [{ key: 'a', pullRequests: [] }]);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(resolved.numbers, []);

			manager.dispose();
		});

		for (const [label, response] of [
			['a GraphQL error', () => json(200, { data: { project: null }, errors: [{ message: 'Timeout' }] })],
			// GitLab's GraphQL answers a missing project with 200 and a null; a 404 means the wrong endpoint or host.
			['a 404', () => json(404, { message: 'Not Found' })],
			// No `data` proves nothing, unlike a `data.project` of null.
			['an empty response', () => json(200, {})],
			['a null data', () => json(200, { data: null })],
		] as const) {
			test(`${label} fails the target instead of reporting it has none`, async () => {
				const runtime = createFakeRuntime();
				branchQuery(runtime, response);
				const { manager, gl } = await connectedGitLab(runtime);
				stubCurrentAccount(gl, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.GitLab,
					targets: [{ key: 'a', owner: 'group', repo: 'r', branch: 'feature' }],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);

				manager.dispose();
			});
		}

		test('six branch queries each failing with 500 cost one strike and one notice, and do not disconnect', async () => {
			const runtime = createFakeRuntime();
			branchQuery(runtime, () => json(500, { message: '500 Internal Server Error' }));
			const { manager, gl } = await connectedGitLab(runtime);
			stubCurrentAccount(gl, 'me');
			const watched = watchRequestFailures(runtime);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: Array.from({ length: 6 }, (_, i) => ({
					key: `k${i}`,
					owner: 'group',
					repo: 'r',
					branch: `b${i}`,
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

	suite('Bitbucket', () => {
		test('Cloud: asks for every state by source branch name, and keeps only the right source repository', async () => {
			const runtime = createFakeRuntime();
			const requests = serve(runtime, () =>
				json(200, {
					values: [
						bitbucketCloudPullRequest(1, { state: 'OPEN', updatedOn: '2026-01-01T00:00:00Z' }),
						bitbucketCloudPullRequest(2, { state: 'MERGED', updatedOn: '2026-03-01T00:00:00Z' }),
						bitbucketCloudPullRequest(3, { forkWorkspace: 'forker', updatedOn: '2026-02-01T00:00:00Z' }),
					],
				}),
			);
			const { manager, integration } = await connectedBitbucket(runtime);
			stubCurrentAccount(integration, '{me}');

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: [
					{ key: 'base', owner: 'o', repo: 'r', branch: 'feature' },
					{ key: 'fork', owner: 'o', repo: 'r', branch: 'feature', headOwner: 'forker' },
				],
			});

			assert.deepEqual(ids(result.items[0]), ['2', '1']);
			assert.equal(result.items[0].pullRequests[0].state, 'merged');
			assert.equal(result.items[0].pullRequests[0].authoredByMe, true);
			assert.deepEqual(ids(result.items[1]), ['3']);

			const url = new URL(requests.urls[0]);
			assert.match(url.pathname, /\/repositories\/o\/r\/pullrequests$/);
			// Bitbucket Cloud answers only OPEN pull requests unless every state is named.
			assert.equal(
				url.searchParams.get('q'),
				'source.branch.name="feature" AND (state="OPEN" OR state="MERGED" OR state="DECLINED" OR state="SUPERSEDED")',
			);
			assert.equal(url.searchParams.get('sort'), '-updated_on');
			assert.equal(url.searchParams.get('pagelen'), '10');

			manager.dispose();
		});

		test('Cloud: a branch name cannot break out of its query string', async () => {
			const runtime = createFakeRuntime();
			const requests = serve(runtime, () => json(200, { values: [] }));
			const { manager, integration } = await connectedBitbucket(runtime);
			stubCurrentAccount(integration, '{me}');

			await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'x" OR state="OPEN' }],
			});

			assert.match(
				new URL(requests.urls[0]).searchParams.get('q') ?? '',
				/^source\.branch\.name="x\\" OR state=\\"OPEN" AND/,
			);

			manager.dispose();
		});

		test('Cloud: truncated when Bitbucket has another page', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () =>
				json(200, { values: [bitbucketCloudPullRequest(1)], next: 'https://api.bitbucket.org/next' }),
			);
			const { manager, integration } = await connectedBitbucket(runtime);
			stubCurrentAccount(integration, '{me}');

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'feature' }],
			});

			assert.equal(result.items[0].truncated, true);

			manager.dispose();
		});

		test('Data Center: asks the repository for its branch in every state, and drops pull requests into other repositories', async () => {
			const runtime = createFakeRuntime();
			const requests = serve(runtime, () =>
				json(200, {
					values: [
						bitbucketServerPullRequest(1, { state: 'OPEN', updatedDate: 1000 }),
						bitbucketServerPullRequest(2, { state: 'MERGED', updatedDate: 3000 }),
						bitbucketServerPullRequest(3, { targetRepositoryId: 9, updatedDate: 2000 }),
					],
					isLastPage: true,
				}),
			);
			const { manager, integration } = await connectedBitbucketServer(runtime);
			stubCurrentAccount(integration, '1');

			const result = await manager.getPullRequestsForBranches({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: [{ key: 'a', owner: 'O', repo: 'r', branch: 'feature' }],
			});

			assert.deepEqual(ids(result.items[0]), ['2', '1']);
			assert.equal(result.items[0].pullRequests[0].authoredByMe, true);
			assert.ok(!('truncated' in result.items[0]));

			const url = new URL(requests.urls[0]);
			assert.match(url.pathname, /\/projects\/O\/repos\/r\/pull-requests$/);
			assert.equal(url.searchParams.get('at'), 'refs/heads/feature');
			assert.equal(url.searchParams.get('direction'), 'OUTGOING');
			assert.equal(url.searchParams.get('state'), 'ALL');

			manager.dispose();
		});

		test('Cloud: a headOwner equal to the owner, in any case, means the base repository', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () =>
				json(200, {
					values: [bitbucketCloudPullRequest(1), bitbucketCloudPullRequest(3, { forkWorkspace: 'forker' })],
				}),
			);
			const { manager, integration } = await connectedBitbucket(runtime);
			stubCurrentAccount(integration, '{me}');

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'feature', headOwner: 'O' }],
			});

			assert.deepEqual(ids(result.items[0]), ['1']);

			manager.dispose();
		});

		test('Data Center: a headOwner equal to the owner, in any case, means the base repository and is not refused', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () =>
				json(200, {
					values: [bitbucketServerPullRequest(1), bitbucketServerPullRequest(3, { targetRepositoryId: 9 })],
					isLastPage: true,
				}),
			);
			const { manager, integration } = await connectedBitbucketServer(runtime);
			stubCurrentAccount(integration, '1');

			const result = await manager.getPullRequestsForBranches({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: [{ key: 'a', owner: 'O', repo: 'r', branch: 'feature', headOwner: 'o' }],
			});

			assert.deepEqual(ids(result.items[0]), ['1']);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		for (const { providerId, connect } of [
			{ providerId: GitCloudHostIntegrationId.Bitbucket, connect: connectedBitbucket },
			{ providerId: GitSelfManagedHostIntegrationId.BitbucketServer, connect: connectedBitbucketServer },
		]) {
			test(`${providerId}: a 404 (a missing repository) is a proven "none"`, async () => {
				const runtime = createFakeRuntime();
				serve(runtime, () => json(404, { error: {} }));
				const { manager, integration } = await connect(runtime);
				stubCurrentAccount(integration, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: providerId,
					targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'feature' }],
				});

				assert.deepEqual(result.items, [{ key: 'a', pullRequests: [] }]);
				assert.equal(result.fetchFailed, undefined);

				manager.dispose();
			});

			test(`${providerId}: a 500 fails the target instead of reporting it has none`, async () => {
				const runtime = createFakeRuntime();
				serve(runtime, () => json(500, { error: {} }));
				const { manager, integration } = await connect(runtime);
				stubCurrentAccount(integration, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: providerId,
					targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'feature' }],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);

				manager.dispose();
			});
		}

		test('Data Center: six targets each failing with 401 cost at most one strike and do not disconnect', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () => json(401, { error: {} }));
			const { manager, integration } = await connectedBitbucketServer(runtime);
			// Non-cloud session, so an `AuthenticationError` takes the direct strike path and the count is exact.
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'bbs.example.com',
				cloud: false,
			};
			stubCurrentAccount(integration, 'me');
			let disconnected: string | undefined;
			runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (disconnected = name) };

			const result = await manager.getPullRequestsForBranches({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: Array.from({ length: 6 }, (_, i) => ({
					key: `k${i}`,
					owner: 'o',
					repo: 'r',
					branch: `b${i}`,
				})),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(getRequestExceptionCount(integration), 1, 'at most one strike for the whole call');
			assert.equal(disconnected, undefined);

			manager.dispose();
		});
	});

	suite('Azure DevOps', () => {
		const target = { key: 'a', owner: 'org', repo: 'r', project: 'proj', branch: 'feature' };

		test('finds pull requests by source ref name in every status, newest first, dropping forks', async () => {
			const runtime = createFakeRuntime();
			const requests = serve(runtime, () =>
				json(200, {
					value: [
						azurePullRequest(1, { creationDate: '2026-01-01T00:00:00Z' }),
						azurePullRequest(2, {
							status: 'completed',
							creationDate: '2026-01-01T00:00:00Z',
							closedDate: '2026-03-01T00:00:00Z',
						}),
						azurePullRequest(3, { creationDate: '2026-02-01T00:00:00Z', fork: true }),
					],
				}),
			);
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');
			const inputs: Parameters<GetPullRequestForRepoFn>[0][] = [];
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.AzureDevOps, input => {
				inputs.push(input);
				return Promise.resolve(sdkPullRequest(input.number));
			});

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			// Newest first, kept in the first step's order.
			assert.deepEqual(ids(result.items[0]), ['gid-2', 'gid-1']);
			assert.ok(!('truncated' in result.items[0]));
			// Resolved exactly as `getPullRequestsBatch` resolves a coordinate, clone URLs included.
			assert.deepEqual(inputs, [
				{ repo: { namespace: 'org', name: 'r', project: 'proj' }, number: 2, includeRemoteInfo: true },
				{ repo: { namespace: 'org', name: 'r', project: 'proj' }, number: 1, includeRemoteInfo: true },
			]);

			assert.equal(requests.urls.length, 1);
			const url = new URL(requests.urls[0]);
			assert.equal(url.origin, 'https://dev.azure.com');
			assert.equal(url.pathname, '/org/proj/_apis/git/repositories/r/pullrequests');
			assert.equal(url.searchParams.get('searchCriteria.sourceRefName'), 'refs/heads/feature');
			assert.equal(url.searchParams.get('searchCriteria.status'), 'all');
			assert.equal(
				url.searchParams.get('$top'),
				'11',
				'one past the cap, to tell a full page from a truncated one',
			);

			manager.dispose();
		});

		test('a headOwner equal to the owner, in any case, means the base repository and is not refused', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () => json(200, { value: [azurePullRequest(1), azurePullRequest(3, { fork: true })] }));
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.AzureDevOps, input =>
				Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [{ ...target, headOwner: 'ORG' }],
			});

			assert.deepEqual(ids(result.items[0]), ['gid-1']);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		test('a branch row is exactly the row getPullRequestsBatch returns for that pull request', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () => json(200, { value: [azurePullRequest(7)] }));
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.AzureDevOps, input =>
				Promise.resolve(sdkPullRequest(input.number)),
			);

			const batch = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [{ key: 'a', owner: 'org', repo: 'r', project: 'proj', number: 7 }],
			});
			const branch = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			const row = branch.items[0].pullRequests[0];
			assert.ok(batch.items[0].pullRequest != null);
			assert.deepStrictEqual(row, batch.items[0].pullRequest);
			assert.equal(row.url, 'https://example.com/pull/7');
			assert.equal(row.authoredByMe, true);

			manager.dispose();
		});

		test('a pull request deleted between the two steps is dropped from the list', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () => json(200, { value: [azurePullRequest(1), azurePullRequest(2)] }));
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.AzureDevOps, input =>
				input.number === 2
					? Promise.reject(sdkHttpError(404, { typeKey: 'GitPullRequestNotFoundException', message: 'gone' }))
					: Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(ids(result.items[0]), ['gid-1']);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		test('a pull request the second step cannot check fails its whole branch, not just itself', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () => json(200, { value: [azurePullRequest(1), azurePullRequest(2)] }));
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');
			await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.AzureDevOps, input =>
				input.number === 2
					? Promise.reject(sdkHttpError(500, { message: 'boom' }))
					: Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(result.items, [], 'a partial list would read as a complete one');
			assert.equal(result.fetchFailed, true);

			manager.dispose();
		});

		test('truncated when Azure returns more than the cap', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () => json(200, { value: Array.from({ length: 11 }, (_, i) => azurePullRequest(i + 1)) }));
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');
			const resolved = await stubSdkPullRequestFn(manager, GitCloudHostIntegrationId.AzureDevOps, input =>
				Promise.resolve(sdkPullRequest(input.number)),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.equal(result.items[0].pullRequests.length, 10);
			assert.equal(result.items[0].truncated, true);
			assert.equal(resolved.numbers.length, 10, 'only the pull requests within the cap are resolved');

			manager.dispose();
		});

		test('a 404 whose body names the repository as not found is a proven "none"', async () => {
			const runtime = createFakeRuntime();
			serve(runtime, () => json(404, { typeKey: 'GitRepositoryNotFoundException', message: 'not found' }));
			const { manager, azure } = await connectedAzure(runtime);
			stubCurrentAccount(azure, 'me');

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [target],
			});

			assert.deepEqual(result.items, [{ key: 'a', pullRequests: [] }]);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		for (const [label, response] of [
			// A wrong server path (e.g. a misconfigured Azure DevOps Server collection) answers 404 with a page.
			[
				'a 404 with an HTML body',
				() =>
					new Response('<html><body>Not Found</body></html>', {
						status: 404,
						headers: { 'content-type': 'text/html' },
					}),
			],
			['a 404 with an unrecognized typeKey', () => json(404, { typeKey: 'SomeOtherException', message: 'nope' })],
			['a 500', () => json(500, { message: 'boom' })],
		] as const) {
			test(`${label} fails the target instead of reporting it has none`, async () => {
				const runtime = createFakeRuntime();
				serve(runtime, response);
				const { manager, azure } = await connectedAzure(runtime);
				stubCurrentAccount(azure, 'me');

				const result = await manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					targets: [target],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);

				manager.dispose();
			});
		}
	});

	suite('scoped refusals (#5890)', () => {
		/**
		 * An Azure DevOps connection whose branch reads refuse a project with `refusal`, or answer that the branch has
		 * no pull requests. `probe` answers the profile request that confirms the credential; the account the read
		 * looks up first is stubbed, so every profile request counted is a probe.
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
				getAzurePullRequestsForBranch: (_t: unknown, repo: { project: string }) => {
					const refused = refusal(repo.project);
					return refused != null ? Promise.reject(refused) : Promise.resolve([]);
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
			{ key: 'a', owner: 'org', repo: 'r', project: 'proj', branch: 'one' },
			{ key: 'b', owner: 'org', repo: 's', project: 'proj', branch: 'two' },
			{ key: 'c', owner: 'org', repo: 'r', project: 'other', branch: 'three' },
		];

		test('Azure: every target refused, by a credential the probe confirms, is scoped to its organization and costs nothing', async () => {
			const { manager, azure, session, checks } = await azureRefusing(
				project => (project === 'proj' ? oauthAppNotAllowed() : noAccess()),
				() => Promise.resolve({ id: 'guid-1' }),
			);

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: refusedTargets,
			});

			assert.deepEqual(result.items, [], 'a refused target is dropped, never reported as "none"');
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

			const result = await manager.getPullRequestsForBranches({
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

			const result = await manager.getPullRequestsForBranches({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: [
					{ key: 'answered', owner: 'org', repo: 'r', project: 'ok', branch: 'one' },
					{ key: 'refused', owner: 'org', repo: 'r', project: 'denied', branch: 'two' },
				],
			});

			assert.deepEqual(result.items, [{ key: 'answered', pullRequests: [] }]);
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
				manager.getPullRequestsForBranches({
					providerId: GitCloudHostIntegrationId.AzureDevOps,
					targets: [{ key: 'a', owner: 'org', repo: 'r', project: 'proj', branch: 'one' }],
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
			serve(runtime, () => json(401, { errors: [{ message: 'Authentication failed' }] }));
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

			const result = await manager.getPullRequestsForBranches({
				providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
				targets: [
					{ key: 'a', owner: 'PROJ', repo: 'one', branch: 'feature' },
					{ key: 'b', owner: 'PROJ', repo: 'two', branch: 'feature' },
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
