import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type { ProviderIssue, ProviderPullRequest, ProviderReposInput } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { assessCollectionMetadata } from '../results.js';
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
