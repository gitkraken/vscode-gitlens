import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { defer } from '@gitlens/utils/promise.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	supportedOrderedCloudIntegrationIds,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { ProviderSweepTargetEvent, PullRequestSweepOptions } from '../manager.js';
import type { ProviderPullRequest } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { isGitSelfManagedHostIntegrationId, isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, primarySession, providerPr, stubApi } from './sweepHelpers.js';

/**
 * `onTargetSettled`, the per-target attribution boundary on both pull request sweeps: one event per target
 * with its own rows and timing, every outcome reported, and no way for the callback to change the sweep.
 */

suite('pull request sweep target observer', () => {
	test('onTargetSettled attributes rows and timing to the provider that produced them', async () => {
		const runtime = createFakeRuntime();
		for (const [providerId, connectionId, scopes, domain] of [
			['github', 'github-secondary', ['repo'], 'github.com'],
			['gitlab', 'gitlab-secondary', ['api'], 'gitlab.com'],
		] as const) {
			await runtime.storage.storeSecret(
				`integration.auth.cloud:${providerId}|${connectionId}`,
				JSON.stringify({
					id: connectionId,
					accessToken: `${providerId}-token`,
					scopes: scopes,
					cloud: true,
					type: 'oauth',
					domain: domain,
				}),
			);
		}

		const manager = createIntegrationManager(runtime);
		// Deliberately uneven: a total row count is satisfied by attributing every row to one provider, which
		// is exactly the bug this event exists to make visible.
		for (const [integration, prIds] of [
			[await manager.get(GitCloudHostIntegrationId.GitHub), ['github-1', 'github-2']],
			[await manager.get(GitCloudHostIntegrationId.GitLab), ['gitlab-1']],
		] as const) {
			stubApi(integration, {
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repos,
				getPullRequestsForRepos: () =>
					Promise.resolve({
						values: prIds.map(id => providerPr(id)),
						paging: { more: false, cursor: '{}' },
					} satisfies PagedResult<ProviderPullRequest>),
			});
		}

		const events: ProviderSweepTargetEvent[] = [];
		const result = await manager.sweepPullRequests({
			targets: [
				{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'github-secondary' },
				{ providerId: GitCloudHostIntegrationId.GitLab, connectionId: 'gitlab-secondary' },
				// Never resolves a connection, so it never reaches the read's own domain resolution — and its
				// domain is given in URL form, which is what makes this target discriminating: echoing
				// `target.domain` would report the raw URL and split one host across two buckets.
				{
					providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'https://ghe.example.com/api/v3',
				},
			],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			onTargetSettled: event => void events.push(event),
		});

		assert.equal(events.length, 3, 'one event per target');
		assert.deepEqual(
			events
				.map(e => ({
					providerId: e.providerId,
					connectionId: e.connectionId,
					count: e.count,
					outcome: e.outcome,
					truncated: e.truncated,
				}))
				.sort((a, b) => a.providerId.localeCompare(b.providerId)),
			[
				{
					providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					connectionId: undefined,
					count: 0,
					outcome: 'failed-provider',
					truncated: false,
				},
				{
					providerId: GitCloudHostIntegrationId.GitHub,
					connectionId: 'github-secondary',
					count: 2,
					outcome: 'ok',
					truncated: false,
				},
				{
					providerId: GitCloudHostIntegrationId.GitLab,
					connectionId: 'gitlab-secondary',
					count: 1,
					outcome: 'ok',
					truncated: false,
				},
			],
		);
		// The domain follows one rule for every target: the self-managed HOST it selects, resolved without an
		// integration instance, so a target rejected by the first guard reports what a drained one would — and
		// normalized, so the URL the caller passed above comes back as the host. Cloud providers report none at
		// all: a single host is nothing to disambiguate, and reporting one only sometimes (as `domainForRead`
		// does, from the connection descriptor or the instance) splits one provider across two buckets for a
		// consumer grouping by provider + domain.
		assert.deepEqual(
			events.map(e => [e.providerId, e.domain]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
			[
				[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe.example.com'],
				[GitCloudHostIntegrationId.GitHub, undefined],
				[GitCloudHostIntegrationId.GitLab, undefined],
			],
		);
		// Magnitudes are not asserted: a threshold in a unit suite is a flake, and `queueWaitMs` is 0 by
		// construction while the target count stays within the fan-out's concurrency limit.
		for (const event of events) {
			assert.ok(
				Number.isFinite(event.durationMs) && event.durationMs >= 0,
				`durationMs is a non-negative number for ${event.providerId}`,
			);
			assert.ok(
				Number.isFinite(event.queueWaitMs) && event.queueWaitMs >= 0,
				`queueWaitMs is a non-negative number for ${event.providerId}`,
			);
		}
		assert.equal(
			events.reduce((sum, e) => sum + e.count, 0),
			result.items.length,
			'the attributed rows account for the whole sweep',
		);

		manager.dispose();
	});

	test('onTargetSettled reports a rejected target as failed-provider and an unreachable one as skipped', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('1')],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		const rejected: ProviderSweepTargetEvent[] = [];
		await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub, IssuesCloudHostIntegrationId.Jira],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			onTargetSettled: event => void rejected.push(event),
		});

		assert.deepEqual(
			rejected
				.map(e => ({ providerId: e.providerId, count: e.count, outcome: e.outcome }))
				.sort((a, b) => a.providerId.localeCompare(b.providerId)),
			[
				{ providerId: GitCloudHostIntegrationId.GitHub, count: 1, outcome: 'ok' },
				{ providerId: IssuesCloudHostIntegrationId.Jira, count: 0, outcome: 'failed-provider' },
			],
			'an issue host is attributed as a failed provider rather than going unreported',
		);

		// An implicit sweep fans out over every supported git host without attributing the ones it can't reach.
		// Its self-managed targets resolve to no connection at all and are dropped from the aggregate result
		// entirely — no rows, no warning, no id in `failedProviderIds` — so the event is the ONLY place a
		// consumer can see them, and a consumer counting targets would otherwise silently come up short.
		const implicit: ProviderSweepTargetEvent[] = [];
		const result = await manager.sweepPullRequests({
			repos: [{ namespace: 'octocat', name: 'hello' }],
			onTargetSettled: event => void implicit.push(event),
		});

		assert.deepEqual(result.failedProviderIds, []);
		assert.deepEqual(
			result.items.map(pr => pr.id),
			['1'],
		);
		// It also exceeds `providerFanOutConcurrency`, so this is the worker-queue path rather than the
		// `Promise.all` fast path — the only one where `queueWaitMs` can be non-zero.
		assert.equal(
			implicit.length,
			supportedOrderedCloudIntegrationIds.filter(id => !isIssuesHostIntegrationId(id)).length,
			'every target the implicit fan-out opened is reported exactly once',
		);
		assert.deepEqual(
			implicit
				.filter(e => e.outcome === 'skipped')
				.map(e => e.providerId)
				.sort(),
			supportedOrderedCloudIntegrationIds.filter(isGitSelfManagedHostIntegrationId).sort(),
			'the self-managed targets, which are exactly the ones absent from the result, are reported as skipped',
		);
		assert.deepEqual(
			implicit.filter(e => e.count !== 0).map(e => ({ providerId: e.providerId, count: e.count })),
			[{ providerId: GitCloudHostIntegrationId.GitHub, count: 1 }],
			'only the connected provider is credited with rows',
		);
		for (const event of implicit.filter(e => e.outcome === 'skipped')) {
			assert.equal(event.count, 0, `a skipped target contributes no rows (${event.providerId})`);
			assert.equal(event.truncated, false, `a skipped target left no pages unread (${event.providerId})`);
			assert.ok(
				Number.isFinite(event.queueWaitMs) && event.queueWaitMs >= 0,
				`queueWaitMs is a non-negative number on the worker-queue path (${event.providerId})`,
			);
		}

		manager.dispose();
	});

	test('a throwing onTargetSettled changes neither the sweep result nor its success', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('1'), providerPr('2')],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		const options: PullRequestSweepOptions = {
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		};
		const expected = await manager.sweepPullRequests(options);
		let observed = 0;
		const actual = await manager.sweepPullRequests({
			...options,
			onTargetSettled: () => {
				observed++;
				throw new Error('observer blew up');
			},
		});

		assert.equal(observed, 1, 'the observer really did run and really did throw');
		assert.deepEqual(
			actual.items.map(pr => pr.id),
			expected.items.map(pr => pr.id),
		);
		assert.equal(actual.fetchFailed, expected.fetchFailed);
		assert.deepEqual(actual.failedProviderIds, expected.failedProviderIds);
		assert.deepEqual(actual.incompleteProviderIds, expected.incompleteProviderIds);
		assert.deepEqual(actual.page, expected.page);

		manager.dispose();
	});

	test('the closed sweep reports its targets too, not just the open one', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('closed-1'), providerPr('closed-2')],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		// `sweepClosedPullRequests` only forwards to `sweepPullRequests` with the terminal states, so nothing
		// but that spread carries the observer through. Assert it here: rebuilding the forward field by field
		// would drop the option, leave every other test green, and silently empty the consumer's attribution
		// for the sweep behind the Kanban "done" column.
		const events: ProviderSweepTargetEvent[] = [];
		const result = await manager.sweepClosedPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			onTargetSettled: event => void events.push(event),
		});

		assert.deepEqual(
			events.map(e => ({ providerId: e.providerId, count: e.count, outcome: e.outcome })),
			[{ providerId: GitCloudHostIntegrationId.GitHub, count: 2, outcome: 'ok' }],
		);
		assert.equal(
			events.reduce((sum, e) => sum + e.count, 0),
			result.items.length,
			'the attributed rows account for the whole closed sweep',
		);

		manager.dispose();
	});

	test('a sibling target still reports after another target rejected the sweep', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			scopes: ['api'],
			domain: 'gitlab.com',
		};
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('1')],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		// A throw from a seam the sweep calls with no try/catch — unlike a provider read failure, which the
		// drain converts into `fetchFailed`. This is the only way the sweep itself rejects.
		const readSeam = manager as unknown as {
			getIntegrationForRead: (id: string, connectionId?: string, domain?: string) => Promise<unknown>;
		};
		const resolveIntegration = readSeam.getIntegrationForRead.bind(manager);
		readSeam.getIntegrationForRead = (id, connectionId, domain) => {
			if (id === GitCloudHostIntegrationId.GitLab) throw new Error('resolution blew up');
			return resolveIntegration(id, connectionId, domain);
		};

		// Awaited rather than slept on: the sibling settles through however many microtask hops its drain takes,
		// and a single tick that happens to be enough today is how this assertion would rot into a flake.
		const events: ProviderSweepTargetEvent[] = [];
		const settled = defer<void>();
		await assert.rejects(
			manager.sweepPullRequests({
				providerIds: [GitCloudHostIntegrationId.GitLab, GitCloudHostIntegrationId.GitHub],
				repos: [{ namespace: 'octocat', name: 'hello' }],
				onTargetSettled: event => {
					events.push(event);
					settled.fulfill();
				},
			}),
			/resolution blew up/,
		);

		// `mapBounded` propagates the first rejection but does not cancel the siblings, so GitHub's event is
		// delivered even though the sweep already failed. Pinned because a consumer that closed its accumulator
		// on rejection would misfile this into whatever bucket is current by then.
		assert.equal(events.length, 0, 'the rejection lands before the surviving sibling has settled');
		await settled.promise;
		assert.deepEqual(
			events.map(e => ({ providerId: e.providerId, count: e.count, outcome: e.outcome })),
			[{ providerId: GitCloudHostIntegrationId.GitHub, count: 1, outcome: 'ok' }],
			'the target that settled is reported after the sweep already failed; the one that threw is not',
		);

		manager.dispose();
	});
});
