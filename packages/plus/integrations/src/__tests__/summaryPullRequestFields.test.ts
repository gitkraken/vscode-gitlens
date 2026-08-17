import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderPullRequest } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * The summary PR read's field map has to stay aligned with provider-apis' gating contract, and this is
 * the test that makes a drift a failing build rather than a silent no-op.
 *
 * Why it needs a test of its own: the map lives in `gitHostIntegration.ts`, the gate that interprets it
 * lives in another package, and NOTHING connected the two. The first version of the map set
 * `commitCount: true` with only `headCommit: false`, which reads as correct and is not — provider-apis
 * gates the `commits(last: 1) { totalCount ... statusCheckRollup { contexts(first: 100) } }` subtree on
 * BOTH keys, because `commitCount` is that subtree's `totalCount`. The summary read therefore shipped
 * the exact payload it exists to avoid, and every test in both packages still passed.
 *
 * The assertion is on the map that actually reaches provider-apis, captured from the real read, rather
 * than on the map's declaration — a test that restated the declaration would pass no matter what the
 * gate does with it. It deliberately does NOT reach into provider-apis' query builder: that is not
 * public API of that package, and coupling to it here would be a second, worse version of the same
 * cross-package assumption. What it pins instead is the contract this side owes: the two keys that share
 * the gated subtree must both be false, and nothing else may be.
 */

/** Keys provider-apis gates the `commits`/`statusCheckRollup` subtree on. Both must be omitted. */
const GATED_SUBTREE_KEYS = ['headCommit', 'commitCount'] as const;

suite('summary pull request field selection', () => {
	/** The field map the repo-scoped summary read really sends to provider-apis. */
	async function captureSummaryFields(): Promise<Record<string, boolean> | undefined> {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			github: [{ id: 'tok', cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|tok',
			JSON.stringify({
				id: 'tok',
				accessToken: 'token',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'github.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let fields: Record<string, boolean> | undefined;
		const api = await (
			gh as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
		).getProvidersApi();
		const provider = api.providers.github as Record<
			string,
			(input: { fields?: Record<string, boolean> }) => Promise<unknown>
		>;
		const capture = (input: { fields?: Record<string, boolean> }) => {
			fields ??= input.fields;
			return Promise.resolve({ data: [], pageInfo: undefined });
		};
		// Both variants, so the capture holds regardless of the provider's paging mode.
		for (const fnName of ['getPullRequestsForReposFn', 'getPullRequestsForRepoFn']) {
			provider[fnName] = capture;
		}

		await (
			gh as unknown as {
				getMyPullRequestsForReposResult: (
					repos: { namespace: string; name: string }[],
					options: { summary: boolean },
				) => Promise<unknown>;
			}
		).getMyPullRequestsForReposResult([{ namespace: 'octo', name: 'repo' }], { summary: true });

		manager.dispose();
		return fields;
	}

	test('a summary read omits BOTH keys that gate the check-status subtree', async () => {
		const fields = await captureSummaryFields();
		assert.ok(fields != null, 'the summary read passed a field map to provider-apis');

		for (const key of GATED_SUBTREE_KEYS) {
			assert.equal(
				fields[key],
				false,
				`${key} must be false: provider-apis gates the commits/statusCheckRollup subtree on both keys, so leaving either truthy keeps the whole payload and the summary read saves nothing`,
			);
		}
	});

	test('a summary read drops ONLY those keys', async () => {
		// This gates one subtree, not the row. Dropping more would be a different — and worse — bug than
		// dropping none, and it would surface as missing data rather than as wasted bytes.
		const fields = await captureSummaryFields();
		const dropped = Object.entries(fields ?? {})
			.filter(([, selected]) => !selected)
			.map(([key]) => key)
			.sort();

		assert.deepEqual(dropped, [...GATED_SUBTREE_KEYS].sort());
	});

	test('a non-summary read passes no field map at all', async () => {
		// The opt-in half of the contract: an ABSENT map is what means "request every field", so the
		// default read must not start sending one.
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			github: [{ id: 'tok', cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|tok',
			JSON.stringify({
				id: 'tok',
				accessToken: 'token',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'github.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let sawFields: Record<string, boolean> | undefined;
		let called = false;
		const api = await (
			gh as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
		).getProvidersApi();
		const provider = api.providers.github as Record<
			string,
			(input: { fields?: Record<string, boolean> }) => Promise<unknown>
		>;
		const capture = (input: { fields?: Record<string, boolean> }) => {
			called = true;
			sawFields ??= input.fields;
			return Promise.resolve({ data: [], pageInfo: undefined });
		};
		for (const fnName of ['getPullRequestsForReposFn', 'getPullRequestsForRepoFn']) {
			provider[fnName] = capture;
		}

		await (
			gh as unknown as {
				getMyPullRequestsForReposResult: (repos: { namespace: string; name: string }[]) => Promise<unknown>;
			}
		).getMyPullRequestsForReposResult([{ namespace: 'octo', name: 'repo' }]);

		manager.dispose();
		assert.equal(called, true, 'the read reached the provider');
		assert.equal(sawFields, undefined, 'a non-summary read must send no field map');
	});

	test('EVERY request of a drained summary read carries the map, not just the first', async () => {
		// A page-only request on a PagingMode.Repos host (GitHub included) walks the provider's own
		// continuations to reach the requested page, so one call from the caller becomes N upstream
		// requests. All N must carry the map: dropping it on the re-reads would revert to the full payload
		// on the path that issues the MOST requests, and would return rows of a different shape than page
		// 1 — a summary row reports `headCommit`/`commitCount` as absent, a full one does not.
		//
		// Asserted over all calls rather than the first because that is exactly what a single-capture test
		// cannot see: this bug lived past a test that pinned the first request's map.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: unknown })._session = {
			id: 'primary',
			accessToken: 't',
			account: { id: 'me', label: 'me' },
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
		};

		const seen: (Record<string, boolean> | undefined)[] = [];
		(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
			Promise.resolve({
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repos,
				getPullRequestsForRepos: (
					_token: unknown,
					_repos: unknown,
					input: { fields?: Record<string, boolean> },
				) => {
					seen.push(input.fields);
					return Promise.resolve({
						values: [{ id: `page-${seen.length}` } as unknown as ProviderPullRequest],
						paging: {
							more: true,
							cursor: JSON.stringify({ value: `next-${seen.length}`, type: 'cursor' }),
						},
					});
				},
			} as unknown as Awaited<ReturnType<GitHostIntegration['getProvidersApi']>>);

		await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: [{ namespace: 'octo', name: 'repo' }],
			page: 3,
			summary: true,
		});

		manager.dispose();
		assert.ok(seen.length > 1, `the read drained (${seen.length} upstream requests), so re-reads are covered`);
		for (const [i, fields] of seen.entries()) {
			assert.ok(fields != null, `request ${i + 1} of ${seen.length} sent a field map`);
			for (const key of GATED_SUBTREE_KEYS) {
				assert.equal(fields[key], false, `request ${i + 1} of ${seen.length} dropped ${key}`);
			}
		}
	});
});
