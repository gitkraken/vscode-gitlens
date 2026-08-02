import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { assessCollectionMetadata, isIncompleteCollection } from '../collectionMetadata.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type { ProviderIssue, ProviderPullRequest, ProviderReposInput } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies the result-returning read cores (`*Result`) introduced for the Kepler warning model:
 * they return `{ error }` when the provider throws and `{ value }` on success, the thin public
 * wrappers return `.value` (undefined on `{ error }`), and per-connection reads use the connection's
 * token, not the primary's.
 */

const repos: ProviderReposInput = [{ namespace: 'octocat', name: 'hello' }];

function primarySession(token: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: 'github.com',
	};
}

async function seedCloudConnection(runtime: ReturnType<typeof createFakeRuntime>, tokenId: string, token: string) {
	await runtime.storage.storeSecret(
		`integration.auth.cloud:github|${tokenId}`,
		JSON.stringify({
			id: tokenId,
			accessToken: token,
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
		}),
	);
}

/** Overrides the integration's providers-api with a stub exposing only the fields the read cores touch. */
function stubApi(gh: GitHostIntegration, api: Record<string, unknown>): void {
	(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () => Promise.resolve(api);
}

suite('read result cores (#5438)', () => {
	test('getMyPullRequestsForReposResult returns { value } on success; the wrapper unwraps it', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('primary-token');

		const pr = { id: '1' } as unknown as ProviderPullRequest;
		let capturedToken: string | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (token: { accessToken: string }) => {
				capturedToken = token.accessToken;
				return Promise.resolve({ values: [pr], paging: undefined } satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await gh.getMyPullRequestsForReposResult(repos);
		assert.deepEqual((result as { value: PagedResult<ProviderPullRequest> }).value.values, [pr]);
		assert.equal(capturedToken, 'primary-token', 'read used the primary session token');

		const unwrapped = await gh.getMyPullRequestsForRepos(repos);
		assert.deepEqual(unwrapped?.values, [pr], 'the public wrapper returns the core .value');

		manager.dispose();
	});

	test('getMyPullRequestsForReposResult recovers a thrown error into { error }; the wrapper returns undefined', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('primary-token');

		const failure = new Error('upstream down');
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.reject(failure),
		});

		const result = await gh.getMyPullRequestsForReposResult(repos);
		assert.equal((result as { error: Error }).error, failure, 'the core recovers the thrown error');

		const unwrapped = await gh.getMyPullRequestsForRepos(repos);
		assert.equal(unwrapped, undefined, 'the public wrapper swallows the error to undefined (compat)');

		manager.dispose();
	});

	test('getMyIssuesForReposResult returns { value } on success and { error } on failure', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('primary-token');

		const issue = { id: '7' } as unknown as ProviderIssue;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: () =>
				Promise.resolve({ values: [issue], paging: undefined } satisfies PagedResult<ProviderIssue>),
		});

		const ok = await gh.getMyIssuesForReposResult(repos);
		assert.deepEqual((ok as { value: PagedResult<ProviderIssue> }).value.values, [issue]);
		assert.deepEqual((await gh.getMyIssuesForRepos(repos))?.values, [issue]);

		const failure = new Error('boom');
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: () => Promise.reject(failure),
		});
		assert.equal(((await gh.getMyIssuesForReposResult(repos)) as { error: Error }).error, failure);
		assert.equal(await gh.getMyIssuesForRepos(repos), undefined);

		manager.dispose();
	});

	test('a non-primary connectionId reads with that connection token, not the primary', async () => {
		const runtime = createFakeRuntime();
		await seedCloudConnection(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		// A different primary token, to prove the read didn't fall back to it.
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('primary-token');

		let capturedToken: string | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (token: { accessToken: string }) => {
				capturedToken = token.accessToken;
				return Promise.resolve({ values: [], paging: undefined } satisfies PagedResult<ProviderPullRequest>);
			},
		});

		await gh.getMyPullRequestsForReposResult(repos, {}, 'sec-tok');
		assert.equal(capturedToken, 'token-secondary', 'per-connection read used the connection token');

		manager.dispose();
	});

	test('a core that returns value+error (soft warning) still yields value through the wrapper', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const pr = { id: '1' } as unknown as ProviderPullRequest;
		const soft: IntegrationResult<PagedResult<ProviderPullRequest>> = {
			value: { values: [pr], paging: undefined },
			error: new Error('partial'),
		};
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () => Promise.resolve(soft);

		const unwrapped = await gh.getMyPullRequestsForRepos(repos);
		assert.deepEqual(unwrapped?.values, [pr], 'a present soft-warning error does not suppress the value');

		manager.dispose();
	});
});

/**
 * Verifies the SDK collection-metadata → ProviderBackend signal mapping (#5438): structured failures become
 * scope-aware warnings classified by kind, partial data still preserves the successful items (`fetchFailed`
 * flags incompleteness rather than discarding them), and completeness maps to truncation without inventing a
 * second generic warning when a specific failure already explains it.
 */
suite('assessCollectionMetadata (#5438)', () => {
	const providerId = GitCloudHostIntegrationId.GitHub;

	test('metadata absent → no warnings, no failure, no truncation', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', undefined);
		assert.deepEqual(result, { warnings: [], fetchFailed: false, truncated: false });
	});

	test('complete metadata → no warnings, no failure, no truncation', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', { completeness: 'complete' });
		assert.deepEqual(result, { warnings: [], fetchFailed: false, truncated: false });
	});

	test('partial with no failures → generic incomplete warning, truncation, but no fetchFailed', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', { completeness: 'partial' });
		assert.equal(result.fetchFailed, false, 'no structured failure → not a fetch failure');
		assert.equal(result.truncated, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'other');
		assert.equal(result.warnings[0].isAuth, false);
	});

	test('unknown with no failures → generic unconfirmed warning, truncation, but no fetchFailed', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', { completeness: 'unknown' });
		assert.equal(result.fetchFailed, false);
		assert.equal(result.truncated, true);
		assert.equal(result.warnings.length, 1);
	});

	test('provider-limit omission → warning naming both counts, truncation, but no fetchFailed', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			omissions: [{ kind: 'provider-limit', limit: 1000, totalCount: 1393 }],
		});
		// A cap is a completeness fact, not a failed request: retrying returns the same truncated set, so
		// this must never be reported as a fetch failure.
		assert.equal(result.fetchFailed, false);
		assert.equal(result.truncated, true);
		assert.equal(result.warnings.length, 1, 'the omission explains the incompleteness; no generic warning too');
		assert.equal(result.warnings[0].kind, 'other');
		assert.equal(result.warnings[0].isAuth, false);
		assert.equal(result.warnings[0].message, 'Search matched 1393 results, but the provider exposes at most 1000');
		// The point of the structured field: a consumer distinguishes this from a genuine `other` failure
		// without reading the prose, which is English-only and subject to rewording.
		assert.deepEqual(result.warnings[0].omission, { kind: 'provider-limit', limit: 1000, totalCount: 1393 });
	});

	test('a SDK totalCount of null normalizes to absent, so consumers have one absence to handle, not two', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			omissions: [{ kind: 'provider-limit', limit: 1000, totalCount: null }],
		});
		// `deepEqual` is strict here, so this also pins that `totalCount` is absent rather than undefined.
		assert.deepEqual(result.warnings[0].omission, { kind: 'provider-limit', limit: 1000 });
	});

	test('failure-derived and generic-fallback warnings carry no omission', () => {
		// A failure is the opposite fact: the request did NOT succeed, so a retry may help.
		const failure = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			failures: [{ kind: 'rate-limit', scope: { repositoryId: 'acme/api' } }],
		});
		assert.equal(failure.warnings[0].omission, undefined);

		// The generic fallback fires when the SDK reported incompleteness without saying what was left out;
		// synthesizing an omission there would assert a specificity this layer does not have.
		for (const completeness of ['partial', 'unknown'] as const) {
			const generic = assessCollectionMetadata(providerId, 'github.com', 'c1', { completeness: completeness });
			assert.equal(generic.warnings[0].omission, undefined, `${completeness} fallback must stay unstructured`);
		}
	});

	test('provider-limit omission names the repository scope when the SDK attributes one', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			omissions: [{ kind: 'provider-limit', scope: { repositoryId: 'acme/web' }, limit: 1000, totalCount: 1393 }],
		});
		assert.equal(
			result.warnings[0].message,
			'Search (repository acme/web) matched 1393 results, but the provider exposes at most 1000',
		);
		assert.deepEqual(result.warnings[0].omission, {
			kind: 'provider-limit',
			scope: { repositoryId: 'acme/web' },
			limit: 1000,
			totalCount: 1393,
		});
	});

	test('provider-limit omission without a total falls back rather than printing undefined', () => {
		// Trello's shape: `/1/search` exposes no total, only that `cards_limit` was reached.
		const withLimit = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			omissions: [{ kind: 'provider-limit', limit: 1000 }],
		});
		assert.equal(withLimit.warnings[0].message, 'Search exceeded the provider limit of 1000 results');
		assert.deepEqual(withLimit.warnings[0].omission, { kind: 'provider-limit', limit: 1000 });

		const bare = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			omissions: [{ kind: 'provider-limit' }],
		});
		assert.equal(bare.warnings[0].message, "Search exceeded the provider's result limit");
		assert.deepEqual(bare.warnings[0].omission, { kind: 'provider-limit' }, 'kind alone is still a usable signal');
	});

	test('recovery-budget and pagination-incomplete omissions each get their own message', () => {
		const budget = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			omissions: [{ kind: 'recovery-budget', scope: { repositoryId: 'acme/web' }, limit: 128 }],
		});
		assert.equal(budget.fetchFailed, false);
		assert.equal(
			budget.warnings[0].message,
			'Stopped recovering omitted results (repository acme/web) after reaching the request budget of 128 requests',
		);
		// `limit` here is a REQUEST budget, not a result count — hence the separate warning on the field.
		assert.deepEqual(budget.warnings[0].omission, {
			kind: 'recovery-budget',
			scope: { repositoryId: 'acme/web' },
			limit: 128,
		});

		const paging = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			omissions: [{ kind: 'pagination-incomplete', scope: { projectId: 'p1' } }],
		});
		assert.equal(paging.fetchFailed, false);
		assert.equal(paging.warnings[0].message, 'More results are available (project p1) than this read returned');
		// The one kind with a remedy: `scope` is what the consumer re-reads, so it must survive structurally.
		assert.deepEqual(paging.warnings[0].omission, { kind: 'pagination-incomplete', scope: { projectId: 'p1' } });
	});

	test('a failure alongside an omission keeps both, and only the failure sets fetchFailed', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			failures: [{ kind: 'rate-limit', scope: { repositoryId: 'acme/api' } }],
			omissions: [{ kind: 'provider-limit', limit: 1000, totalCount: 1393 }],
		});
		assert.equal(result.fetchFailed, true, 'the failure, not the omission, is what makes this a fetch failure');
		assert.equal(result.truncated, true);
		assert.equal(
			result.warnings.length,
			2,
			'a failure and an omission are distinct facts; neither replaces the other',
		);
		assert.equal(result.warnings.filter(w => w.kind === 'rate-limit').length, 1);
		assert.equal(result.warnings.filter(w => w.kind === 'other').length, 1);
		// Both arrive as `kind: 'other'`-vs-`'rate-limit'` today, but the structured field is what separates
		// "succeeded, withheld" from "failed" without reading either message.
		assert.equal(result.warnings.find(w => w.kind === 'rate-limit')?.omission, undefined);
		assert.deepEqual(result.warnings.find(w => w.kind === 'other')?.omission, {
			kind: 'provider-limit',
			limit: 1000,
			totalCount: 1393,
		});
	});

	test('an omission forces truncation even when completeness claims complete', () => {
		// Defensive, not a live path: every SDK site that emits an omission degrades completeness in the same
		// call. Pinned because the two arrive as independent fields — warning about omitted results while
		// reporting `truncated: false` would tell the consumer to ignore the very thing being warned about.
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'complete',
			omissions: [{ kind: 'provider-limit', limit: 1000, totalCount: 1393 }],
		});
		assert.equal(result.truncated, true, 'the omission is the incompleteness; the label does not override it');
		assert.equal(result.fetchFailed, false);
		assert.equal(result.warnings.length, 1);
	});

	test('isIncompleteCollection is the one rule both the facade and getPagedResult read truncation from', () => {
		assert.equal(isIncompleteCollection(undefined), false, 'no metadata asserts nothing');
		assert.equal(isIncompleteCollection({ completeness: 'complete' }), false);
		assert.equal(isIncompleteCollection({ completeness: 'complete', omissions: [] }), false);
		assert.equal(isIncompleteCollection({ completeness: 'partial' }), true);
		assert.equal(isIncompleteCollection({ completeness: 'unknown' }), true);
		// The defensive clause: no SDK site emits this pairing today, but if one ever does, both layers must
		// agree it is incomplete rather than `getPagedResult` reporting whole and the facade truncated.
		assert.equal(
			isIncompleteCollection({ completeness: 'complete', omissions: [{ kind: 'provider-limit', limit: 1000 }] }),
			true,
		);
	});

	test('authentication failure → auth warning with isAuth, fetchFailed, truncation, scope in message', () => {
		const metadata: CollectionMetadata = {
			completeness: 'partial',
			failures: [{ kind: 'authentication', scope: { resourceId: 'r1' }, message: '401' }],
		};
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', metadata);
		assert.equal(result.fetchFailed, true, 'a structured failure means items are incomplete');
		assert.equal(result.truncated, true);
		assert.equal(result.warnings.length, 1, 'no extra generic warning when a failure already explains it');
		assert.equal(result.warnings[0].kind, 'auth');
		assert.equal(result.warnings[0].isAuth, true);
		assert.equal(result.warnings[0].connectionId, 'c1', 'warning carries the connection id');
		assert.ok(result.warnings[0].message.includes('r1'), 'the failed scope is identified in the message');
	});

	test('rate-limit and not-found failures keep their kinds', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			failures: [
				{ kind: 'rate-limit', scope: { repositoryId: 'repo1' } },
				{ kind: 'not-found', scope: { projectId: 'proj1' } },
			],
		});
		assert.equal(result.warnings.length, 2);
		assert.deepEqual(result.warnings.map(w => w.kind).sort(), ['not-found', 'rate-limit']);
		assert.equal(
			result.warnings.every(w => !w.isAuth),
			true,
		);
	});

	test('provider-classified HTTP failures recover auth, rate-limit, and not-found kinds', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			failures: [
				{
					kind: 'provider',
					scope: { repositoryId: 'throttled' },
					message: '(403) Forbidden. API rate limit exceeded',
				},
				{
					kind: 'provider',
					scope: { repositoryId: 'forbidden' },
					message: '(403) Forbidden. Missing repository permission',
				},
				{ kind: 'provider', scope: { repositoryId: 'gone' }, message: '(410) Gone.' },
				{ kind: 'provider', scope: { repositoryId: 'invalid' }, message: '(422) Unprocessable Entity.' },
			],
		});

		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['rate-limit', 'auth', 'not-found', 'not-found'],
		);
		assert.equal(result.warnings[1].isAuth, true);
	});

	test('network/provider/unknown failures map to the generic "other" kind, not a truncation-only read', () => {
		const result = assessCollectionMetadata(providerId, 'github.com', 'c1', {
			completeness: 'partial',
			failures: [
				{ kind: 'network', scope: { repositoryId: 'r' } },
				{ kind: 'provider', scope: { repositoryId: 's' } },
			],
		});
		assert.equal(result.fetchFailed, true, 'network/provider failures are real failures, not silent truncation');
		assert.equal(result.warnings.length, 2);
		assert.equal(
			result.warnings.every(w => w.kind === 'other'),
			true,
		);
	});
});
