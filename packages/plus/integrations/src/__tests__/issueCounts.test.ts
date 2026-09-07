import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { primarySession, stubGitHubApi } from './issueSearchHelpers.js';

/**
 * `countIssues` answers how many issues match each scope without fetching any, and its contract is mostly about
 * what it refuses and what it isolates: it validates every scope through the same rules `searchIssuesPage` uses
 * (a count computed under different constraints is a WRONG number rather than a missing one), a scope refused for
 * its own reasons drops only itself, and `count: undefined` means "not reported" rather than zero.
 *
 * A sibling of `issueSearch.test.ts` rather than a suite inside it: the two share only the API seam, which
 * `issueSearchHelpers.ts` owns.
 */

suite('IntegrationManager.countIssues', () => {
	// A provider with no filtered issue search is refused ONCE for the provider, not once per scope. That is not
	// only cheaper: the existence refusal is the one message that names no scope, so N scopes would otherwise
	// push N byte-identical warnings, and one refusal reported twice reads as two different problems.
	test('refuses a provider with no filtered issue search once, not once per scope', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitLab,
				scopes: [
					{ key: 'a', org: 'gk', criteria: { relationships: ['unassigned'] } },
					{ key: 'b', org: 'gk', criteria: { relationships: ['unassigned'] } },
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1, 'one provider-level refusal, not one per scope');
			assert.match(result.warnings[0].message, /not supported/);
		} finally {
			manager.dispose();
		}
	});

	// A CRITERIA rejection names no scope either, so two scopes inexpressible in the same way collapse to one
	// warning rather than reporting the same refusal twice. The SCOPE rejections all embed their key, so they
	// stay distinct — asserted by the `drops only itself` test below.
	test('reports one warning for two scopes refused for the same unkeyed reason', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 1) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{ key: 'a', org: 'gk', criteria: { relationships: ['any-assignee', 'unassigned'] } },
					{ key: 'b', org: 'gk', criteria: { relationships: ['any-assignee', 'unassigned'] } },
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1, 'the same refusal is not reported twice');
			assert.equal(countCalls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('echoes each count under the caller’s own key', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, {
				countIssues: scopes => scopes.map((_, i) => 10 + i),
			});

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{
						key: 'unassigned',
						repos: [{ namespace: 'o', name: 'a' }],
						criteria: { relationships: ['unassigned'] },
					},
					{ key: 'recent', repos: [{ namespace: 'o', name: 'a' }], criteria: { updatedAfter: '2026-05-05' } },
				],
			});

			assert.deepEqual(
				result.items.map(i => ({ key: i.key, count: i.count })),
				[
					{ key: 'unassigned', count: 10 },
					{ key: 'recent', count: 11 },
				],
			);
			assert.equal(result.fetchFailed, undefined);
			assert.equal(countCalls.length, 1, 'both scopes share one request');
		} finally {
			manager.dispose();
		}
	});

	// The count applies exactly the qualifiers its search would, so an unusable scope name made the count AGREE
	// with the wrong search rather than disagree with it: a consumer cross-checking "N matched" against what it
	// received could not detect the substitution by construction. This is the surface that argument is about, so
	// it is the one worth pinning.
	test('refuses a count scope whose organization a query cannot carry as given', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 1) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'org', org: 'git"kraken' }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /cannot be used as given/);
			assert.match(result.warnings[0].message, /'org'/, 'the refusal names the offending count key');
			assert.equal(countCalls.length, 0, 'no count of a different scope reaches the provider');
		} finally {
			manager.dispose();
		}
	});

	// Per-scope isolation: one unusable scope must not cost the batch its other counts.
	test('an unusable count scope drops only itself', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 7) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{ key: 'bad', org: 'my org' },
					{ key: 'good', org: 'gitkraken' },
				],
			});

			assert.deepEqual(
				result.items.map(i => ({ key: i.key, count: i.count })),
				[{ key: 'good', count: 7 }],
			);
			assert.equal(result.fetchFailed, true);
			assert.equal(countCalls.length, 1);
		} finally {
			manager.dispose();
		}
	});

	test('an empty scope list is an empty success, not a refusal', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: () => [] });

			const result = await manager.countIssues({ providerId: GitCloudHostIntegrationId.GitHub, scopes: [] });

			assert.deepEqual(result.items, []);
			assert.deepEqual(result.warnings, [], 'nothing was asked for, so nothing is missing');
			assert.equal(result.fetchFailed, undefined);
			assert.equal(countCalls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	// `key` exists so the caller can match results without positional bookkeeping. Two results under one key make
	// that ambiguous for EVERY scope, not just the repeated one, so the whole call is refused rather than deduped.
	test('refuses the whole call on a duplicate key', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 1) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{ key: 'same', repos: [{ namespace: 'o', name: 'a' }] },
					{ key: 'same', repos: [{ namespace: 'o', name: 'b' }] },
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /Duplicate/);
			assert.equal(countCalls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('isolates a refused scope, still counting its siblings', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 5) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{ key: 'ok', repos: [{ namespace: 'o', name: 'a' }] },
					// Unscoped: meaningless on its own, but it must not cost the sibling its count.
					{ key: 'unscoped', criteria: { relationships: ['unassigned'] } },
				],
			});

			assert.deepEqual(
				result.items.map(i => i.key),
				['ok'],
			);
			assert.equal(result.fetchFailed, true, 'part of what was asked for is missing');
			assert.equal(result.warnings.length, 1);
			assert.match(result.warnings[0].message, /unscoped/);
			assert.deepEqual(countCalls[0].length, 1, 'the refused scope never reaches the provider');
		} finally {
			manager.dispose();
		}
	});

	// A relationship set is OR-ed across searches. One count could only sum them (double-counting anything that
	// matches two) or take the max (under-reporting), so it refuses instead: a missing number beats a wrong one.
	test('refuses a scope requesting several relationships', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 1) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{
						key: 'both',
						repos: [{ namespace: 'o', name: 'a' }],
						criteria: { relationships: ['authored', 'assigned'] },
					},
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /one scope per relationship/);
		} finally {
			manager.dispose();
		}
	});

	test('flags a count past the provider’s ceiling, so a caller can warn before fetching', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubApi(manager, { countIssues: () => [19240] });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'all', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.equal(result.items[0].count, 19240);
			assert.equal(result.items[0].exceedsProviderLimit, true);
			assert.equal(result.items[0].providerLimit, 1000);
		} finally {
			manager.dispose();
		}
	});

	// `undefined` means "not reported" and must never be rendered as 0 — that would tell the user a filter matches
	// nothing when it may match thousands.
	test('an unreported count is undefined and is not flagged against the ceiling', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubApi(manager, { countIssues: () => [undefined] });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'unknown', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.equal(result.items[0].count, undefined);
			assert.equal(result.items[0].exceedsProviderLimit, false, 'unknown-vs-limit is not a comparison');
		} finally {
			manager.dispose();
		}
	});

	// The batches are independent requests, so they run concurrently — sequentially they would spend exactly the
	// resource the probe exists to conserve (measured ~2s per batch, so 10 batches would be ~20s instead of ~4s).
	test('runs its batches concurrently rather than one after another', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			let inFlight = 0;
			let maxInFlight = 0;
			const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
			assert.ok(gh != null);
			(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
			const githubApi = await (
				gh as unknown as {
					authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
				}
			).authenticationService.apis.github;
			assert.ok(githubApi);
			githubApi.countIssues = async (_p: unknown, _t: unknown, scopes: Record<string, unknown>[]) => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Promise.resolve();
				inFlight--;
				return scopes.map(() => 1);
			};

			// 75 scopes ⇒ 3 batches of 25.
			await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: Array.from({ length: 75 }, (_, i) => ({
					key: `k${i}`,
					repos: [{ namespace: 'o', name: `r${i}` }],
				})),
			});

			assert.ok(maxInFlight > 1, `expected overlapping requests, saw at most ${maxInFlight} in flight`);
		} finally {
			manager.dispose();
		}
	});

	test('batches beyond the chunk size into several requests', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 1) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: Array.from({ length: 26 }, (_, i) => ({
					key: `k${i}`,
					repos: [{ namespace: 'o', name: `r${i}` }],
				})),
			});

			assert.equal(result.items.length, 26, 'every scope is answered');
			assert.deepEqual(
				countCalls.map(c => c.length),
				[25, 1],
				'chunked at 25, so a 26th scope starts a second request',
			);
		} finally {
			manager.dispose();
		}
	});

	// The riskiest consequence of batching concurrently: results come back per batch and are matched to scopes by
	// POSITION WITHIN the batch. If a middle batch fails, the surviving batches must still map to their own scopes
	// — a mis-alignment here would report one filter's count under another filter's name, which is worse than a
	// missing number because it looks authoritative.
	test('keeps every surviving batch aligned to its own scopes when a middle batch fails', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
			assert.ok(gh != null);
			(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
			const githubApi = await (
				gh as unknown as {
					authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
				}
			).authenticationService.apis.github;
			assert.ok(githubApi);

			// Each scope's count encodes the repo it belongs to, so a mis-alignment is visible rather than plausible.
			githubApi.countIssues = (_p: unknown, _t: unknown, scopes: { repos?: string[] }[]) => {
				// The second batch (scopes 26-50) fails outright.
				if (scopes[0]?.repos?.[0] === 'o/r25') return Promise.reject(new Error('batch boom'));

				return Promise.resolve(scopes.map(s => Number(/\d+/.exec(s.repos?.[0] ?? '0')?.[0] ?? 0)));
			};

			// 75 scopes ⇒ 3 batches of 25; the middle one fails.
			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: Array.from({ length: 75 }, (_, i) => ({
					key: `k${i}`,
					repos: [{ namespace: 'o', name: `r${i}` }],
				})),
			});

			assert.equal(result.fetchFailed, true, 'the failed batch is reported');
			assert.equal(result.items.length, 50, 'the other two batches survive in full');
			for (const item of result.items) {
				assert.equal(
					item.count,
					Number(item.key.slice(1)),
					`${item.key} must carry its OWN count, not a neighbour's`,
				);
			}
			// And the gap is exactly the failed batch, not an off-by-one slice of it.
			assert.deepEqual(
				result.items.map(i => i.key).filter(k => Number(k.slice(1)) >= 25 && Number(k.slice(1)) < 50),
				[],
			);
		} finally {
			manager.dispose();
		}
	});

	test('a provider with no count support refuses rather than reporting zeros', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubApi(manager, { countIssues: () => undefined });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'a', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
		} finally {
			manager.dispose();
		}
	});
});
