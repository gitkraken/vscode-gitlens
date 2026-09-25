import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, connectedGitLab, primarySession, stubApi } from './sweepHelpers.js';

/**
 * What these pin (#5894): a coordinate that doesn't exist is a PROVEN ABSENCE, never conflated with a failed
 * request — the same distinction `issueBatch.test.ts` (#5802) pins for issues.
 */

type Coordinate = { owner: string; repo: string; number: number };

const pr = (n: number, overrides?: Partial<PullRequestShape>) =>
	({ id: `pr${n}`, number: n, title: `PR ${n}`, state: 'opened', ...overrides }) as unknown as PullRequestShape;

/** Swaps in a fake `getPullRequestsBatch` on the memoized GitHub SDK client — see `accountWideIssueFilters.test.ts`. */
async function stubGitHubBatch(
	gh: GitHostIntegration,
	fn: (coordinates: readonly Coordinate[]) => Promise<(PullRequestShape | undefined)[] | undefined>,
): Promise<void> {
	const api = await (
		gh as unknown as { authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } } }
	).authenticationService.apis.github;
	assert.ok(api, 'github api available');
	api.getPullRequestsBatch = (_provider: unknown, _token: unknown, coordinates: readonly Coordinate[]) =>
		fn(coordinates);
}

/** Swaps in a fake `getPullRequest` on the memoized GitLab SDK client, called once PER coordinate. */
async function stubGitLabPullRequest(
	gl: GitHostIntegration,
	fn: (owner: string, repo: string, number: number) => Promise<PullRequestShape | undefined>,
): Promise<void> {
	const api = await (
		gl as unknown as { authenticationService: { apis: { gitlab: Promise<Record<string, unknown> | undefined> } } }
	).authenticationService.apis.gitlab;
	assert.ok(api, 'gitlab api available');
	api.getPullRequest = (_provider: unknown, _token: unknown, owner: string, repo: string, number: number) =>
		fn(owner, repo, number);
}

suite('IntegrationManager.getPullRequestsBatch (#5894)', () => {
	suite('GitHub', () => {
		test('resolves each coordinate to its keyed outcome, including current merged/closed dates', async () => {
			const { manager, gh } = await connectedGitHub(createFakeRuntime());
			const mergedDate = new Date('2024-01-02T00:00:00Z');
			const closedDate = new Date('2024-02-03T00:00:00Z');
			let received: readonly Coordinate[] = [];
			await stubGitHubBatch(gh, coordinates => {
				received = coordinates;
				return Promise.resolve(
					coordinates.map(c => {
						if (c.number === 1) return pr(1, { state: 'opened' });
						if (c.number === 2) {
							return pr(2, { state: 'merged', mergedDate: mergedDate, closedDate: closedDate });
						}
						if (c.number === 3) return pr(3, { state: 'closed', closedDate: closedDate });
						return undefined;
					}),
				);
			});

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [
					{ key: 'open', owner: 'o', repo: 'a', number: 1 },
					{ key: 'merged', owner: 'o', repo: 'a', number: 2 },
					{ key: 'closed', owner: 'o', repo: 'a', number: 3 },
					{ key: 'gone', owner: 'o', repo: 'a', number: 4 },
				],
			});

			assert.deepEqual(
				received.map(c => c.number),
				[1, 2, 3, 4],
				'a batch that fits a chunk costs exactly one request',
			);
			assert.deepEqual(
				result.items.map(i => i.key),
				['open', 'merged', 'closed', 'gone'],
				'results preserve input order and echo the caller key, not a position',
			);
			assert.equal(result.items[0].pullRequest?.state, 'opened');
			assert.equal(result.items[1].pullRequest?.state, 'merged');
			assert.equal(result.items[1].pullRequest?.mergedDate, mergedDate);
			assert.equal(result.items[1].pullRequest?.closedDate, closedDate);
			assert.equal(result.items[2].pullRequest?.state, 'closed');
			assert.equal(result.items[2].pullRequest?.closedDate, closedDate);
			assert.equal(result.items[2].pullRequest?.mergedDate, undefined);
			assert.equal(result.items[3].key, 'gone');
			assert.equal(
				result.items[3].pullRequest,
				undefined,
				'a missing coordinate is a proven absence, not dropped',
			);
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		test('a failed chunk drops only its own targets, costs far fewer requests than targets, and never reports them as absent', async () => {
			const { manager, gh } = await connectedGitHub(createFakeRuntime());
			let calls = 0;
			await stubGitHubBatch(gh, coordinates => {
				calls++;
				if (coordinates.some(c => c.number === 1)) throw new Error('batch boom');

				return Promise.resolve(coordinates.map(c => pr(c.number, { state: 'opened' })));
			});

			// 30 targets: far more than any single-request chunk this read would choose. Target 1 is always in
			// the first chunk, and target 30 is not (chunk size is bounded well under 30), so the assertions
			// below hold for any reasonable chunk size without pinning one.
			const targets = Array.from({ length: 30 }, (_, i) => ({
				key: `k${i + 1}`,
				owner: 'o',
				repo: 'a',
				number: i + 1,
			}));
			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets,
			});

			assert.ok(calls < targets.length, 'chunked into far fewer requests than targets');
			assert.equal(result.fetchFailed, true, 'the failure is surfaced');
			assert.ok(result.warnings.length > 0);
			assert.ok(
				!result.items.some(i => i.key === 'k1'),
				'a target whose chunk failed is absent from the results, NOT reported as a proven absence',
			);
			assert.ok(
				result.items.some(i => i.key === 'k30'),
				'a target outside the failed chunk still answers',
			);
			assert.ok(
				result.items.every(i => i.pullRequest != null),
				'every surviving target resolved to a pull request, not a false absence',
			);

			manager.dispose();
		});

		test('refuses the whole call on a duplicate key rather than answering ambiguously', async () => {
			const { manager, gh } = await connectedGitHub(createFakeRuntime());
			let calls = 0;
			await stubGitHubBatch(gh, coordinates => {
				calls++;
				return Promise.resolve(coordinates.map(c => pr(c.number)));
			});

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [
					{ key: 'same', owner: 'o', repo: 'a', number: 1 },
					{ key: 'same', owner: 'o', repo: 'a', number: 2 },
				],
			});

			assert.equal(calls, 0, 'the refusal costs no upstream request');
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /Duplicate/i);

			manager.dispose();
		});

		test('no targets is an empty success, not a refusal', async () => {
			const { manager } = await connectedGitHub(createFakeRuntime());

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(result.warnings, []);

			manager.dispose();
		});

		test('an unresolvable connectionId is reported, not answered as a batch of absences', async () => {
			// The primary session is fine (`connectedGitHub` sets it) — it must not paper over a specific,
			// broken `connectionId`, which is what actually fails this read.
			const { manager } = await connectedGitHub(createFakeRuntime());

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
				connectionId: 'gone',
			});

			assert.deepEqual(result.items, [], 'no target is reported as proven absent');
			assert.equal(result.fetchFailed, true);
			assert.equal(
				result.warnings[0]?.kind,
				'no-connection',
				'a broken connection is a session/connection problem, not an "unsupported provider" refusal',
			);

			manager.dispose();
		});

		test('the primary session is missing and no connectionId was requested', async () => {
			const runtime = createFakeRuntime();
			const manager = createIntegrationManager(runtime);
			await manager.get(GitCloudHostIntegrationId.GitHub); // never connected: no session, no connectionId

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
			});

			assert.deepEqual(result.items, [], 'no target is reported as proven absent');
			assert.equal(result.fetchFailed, true);
			assert.equal(
				result.warnings[0]?.kind,
				'no-connection',
				'a missing session is a session/connection problem, not an "unsupported provider" refusal',
			);

			manager.dispose();
		});
	});

	suite('GitLab', () => {
		test('distinguishes a proven absence from a failed direct read, keeping every successful target', async () => {
			const { manager, gl } = await connectedGitLab(createFakeRuntime());
			const closedDate = new Date('2024-03-04T00:00:00Z');
			const calls: number[] = [];
			await stubGitLabPullRequest(gl, (_owner, _repo, number) => {
				calls.push(number);
				if (number === 1) return Promise.resolve(pr(1, { state: 'closed', closedDate: closedDate }));
				if (number === 2) return Promise.resolve(undefined);

				throw new Error('gitlab transport boom');
			});

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: [
					{ key: 'found', owner: 'o', repo: 'a', number: 1 },
					{ key: 'missing', owner: 'o', repo: 'a', number: 2 },
					{ key: 'errored', owner: 'o', repo: 'a', number: 3 },
				],
			});

			assert.deepEqual(calls, [1, 2, 3], 'each coordinate is read directly, not via one aggregated request');
			assert.equal(result.items.find(i => i.key === 'found')?.pullRequest?.state, 'closed');
			assert.equal(result.items.find(i => i.key === 'found')?.pullRequest?.closedDate, closedDate);
			const missing = result.items.find(i => i.key === 'missing');
			assert.ok(missing != null, 'a not-found coordinate is a proven absence, not dropped');
			assert.equal(missing?.pullRequest, undefined);
			assert.ok(
				!result.items.some(i => i.key === 'errored'),
				'a failed direct read is dropped, never reported as a proven absence',
			);
			assert.equal(result.fetchFailed, true);
			assert.ok(result.warnings.length > 0);

			manager.dispose();
		});
	});

	suite('self-managed variants', () => {
		test('GitHub Enterprise resolves through the same batch hook as GitHub cloud', async () => {
			const runtime = createFakeRuntime();
			const manager = createIntegrationManager(runtime);
			const ghe = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe.example.com');
			assert.ok(ghe);
			(ghe as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'ghe.example.com',
			};
			await stubGitHubBatch(ghe, coordinates =>
				Promise.resolve(coordinates.map(c => pr(c.number, { state: 'merged', mergedDate: new Date(0) }))),
			);

			const result = await manager.getPullRequestsBatch({
				providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
				domain: 'ghe.example.com',
			});

			assert.equal(result.items[0]?.key, 'a');
			assert.equal(result.items[0]?.pullRequest?.state, 'merged');
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});

		test('GitLab self-hosted resolves through the same per-target hook as GitLab cloud', async () => {
			const runtime = createFakeRuntime();
			const manager = createIntegrationManager(runtime);
			const gls = await manager.get(GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'gitlab.example.com');
			assert.ok(gls);
			(gls as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'gitlab.example.com',
			};
			await stubGitLabPullRequest(gls, (_owner, _repo, number) =>
				Promise.resolve(pr(number, { state: 'opened' })),
			);

			const result = await manager.getPullRequestsBatch({
				providerId: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
				targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
				domain: 'gitlab.example.com',
			});

			assert.equal(result.items[0]?.key, 'a');
			assert.equal(result.items[0]?.pullRequest?.state, 'opened');
			assert.equal(result.fetchFailed, undefined);

			manager.dispose();
		});
	});

	suite('unsupported provider', () => {
		test('refuses an issue tracker (wrong surface) rather than a list-scan fallback', async () => {
			const manager = createIntegrationManager(createFakeRuntime());

			const result = await manager.getPullRequestsBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
			});

			assert.deepEqual(result.items, [], 'nothing is invented for the caller');
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /not supported/i);

			manager.dispose();
		});

		test('refuses a git host outside GitHub/GitLab (Bitbucket) rather than a list-scan fallback', async () => {
			// Connected with a real session (like `connectedGitHub`) so the refusal can only be the provider-id
			// check, never a coincidental "no session" outcome — and the provider api is stubbed to PROVE no
			// request reaches it, which is what would happen if this ever degraded into a list-scan fallback.
			const manager = createIntegrationManager(createFakeRuntime());
			const bitbucket = await manager.get(GitCloudHostIntegrationId.Bitbucket);
			(bitbucket as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'bitbucket.org',
			};
			let calls = 0;
			stubApi(
				bitbucket,
				new Proxy(
					{},
					{
						get:
							() =>
							(..._args: unknown[]) => {
								calls++;
								return Promise.resolve(undefined);
							},
					},
				),
			);

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
			});

			assert.deepEqual(result.items, [], 'nothing is invented for the caller');
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /not supported/i);
			assert.equal(calls, 0, 'no provider request is made — a list-scan fallback would fail this');

			manager.dispose();
		});
	});
});
