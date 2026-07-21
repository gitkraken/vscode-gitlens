import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationManager } from '../../index.js';

/**
 * Covers the page-number pagination surface added for read-API parity (#5435): getPagedResult must forward
 * an explicit page/pageSize to the provider (pageSize as both pageSize and GitHub's maxPageSize) and surface
 * numbered-page metadata (currentPage/nextPage/totalPages/totalCount) back on PagedResult.paging.
 */
async function seedGitHubConnection(runtime: ReturnType<typeof createFakeRuntime>, tokenId: string, token: string) {
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

type CapturingProvider = Record<string, (input: unknown, options?: { token?: string }) => Promise<unknown>>;

suite('page-number pagination (#5435)', () => {
	test('forwards page/pageSize to the provider and surfaces numbered-page metadata', async () => {
		const runtime = createFakeRuntime();
		await seedGitHubConnection(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let capturedInput: { page?: number; pageSize?: number; maxPageSize?: number } | undefined;
		const api = await (
			gh as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
		).getProvidersApi();
		(api.providers.github as CapturingProvider).getPullRequestsForReposFn = input => {
			capturedInput = input as typeof capturedInput;
			return Promise.resolve({
				data: [],
				pageInfo: { hasNextPage: true, nextPage: 3, currentPage: 2, totalPages: 5, totalCount: 42 },
			});
		};

		const result = await (
			gh as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: { page?: number; pageSize?: number },
					connectionId: string,
				) => Promise<{ paging?: Record<string, unknown> } | undefined>;
			}
		).getMyPullRequestsForRepos([{ namespace: 'octo', name: 'repo' }], { page: 2, pageSize: 20 }, 'sec-tok');

		assert.equal(capturedInput?.page, 2, 'explicit page forwarded to the provider');
		assert.equal(capturedInput?.pageSize, 20, 'pageSize forwarded for numbered providers');
		assert.equal(capturedInput?.maxPageSize, 20, 'pageSize also mapped to GitHub maxPageSize');

		assert.equal(result?.paging?.more, true);
		assert.equal(result?.paging?.page, 2, 'currentPage surfaced as page');
		assert.equal(result?.paging?.pageSize, 20);
		assert.equal(result?.paging?.nextPage, 3);
		assert.equal(result?.paging?.totalPages, 5);
		assert.equal(result?.paging?.totalCount, 42);

		manager.dispose();
	});

	test('leaves numbered metadata undefined for a cursor-based result', async () => {
		const runtime = createFakeRuntime();
		await seedGitHubConnection(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const api = await (
			gh as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
		).getProvidersApi();
		(api.providers.github as CapturingProvider).getPullRequestsForReposFn = () =>
			Promise.resolve({ data: [], pageInfo: { hasNextPage: true, endCursor: 'abc' } });

		const result = await (
			gh as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: undefined,
					connectionId: string,
				) => Promise<{ paging?: Record<string, unknown> } | undefined>;
			}
		).getMyPullRequestsForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

		assert.equal(result?.paging?.more, true);
		assert.equal(result?.paging?.page, undefined, 'no currentPage for cursor providers');
		assert.equal(result?.paging?.totalPages, undefined);
		assert.equal(
			result?.paging?.cursor,
			JSON.stringify({ value: 'abc', type: 'cursor' }),
			'cursor round-trip preserved',
		);

		manager.dispose();
	});
});

/**
 * Covers SDK collection metadata preservation at the `getPagedResult` boundary (#5438): metadata survives
 * normalization, `partial`/`unknown` completeness sets `paging.truncated` independently from `paging.more`,
 * a real cursor stays the only continuation, and absent metadata keeps the pre-metadata behavior.
 */
suite('collection metadata normalization (#5438)', () => {
	async function readForRepos(
		reposFn: CapturingProvider['getPullRequestsForReposFn'],
	): Promise<{ paging?: Record<string, unknown>; metadata?: unknown } | undefined> {
		const runtime = createFakeRuntime();
		await seedGitHubConnection(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const api = await (
			gh as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
		).getProvidersApi();
		(api.providers.github as CapturingProvider).getPullRequestsForReposFn = reposFn;

		const result = await (
			gh as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: undefined,
					connectionId: string,
				) => Promise<{ paging?: Record<string, unknown>; metadata?: unknown } | undefined>;
			}
		).getMyPullRequestsForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

		manager.dispose();
		return result;
	}

	test('preserves complete metadata without setting truncation', async () => {
		const result = await readForRepos(() =>
			Promise.resolve({ data: [], pageInfo: { hasNextPage: false }, metadata: { completeness: 'complete' } }),
		);

		assert.deepEqual(result?.metadata, { completeness: 'complete' });
		assert.equal(result?.paging?.truncated, undefined, 'complete does not set truncation');
	});

	test('sets truncation for partial and unknown completeness', async () => {
		const partial = await readForRepos(() =>
			Promise.resolve({ data: [], pageInfo: { hasNextPage: false }, metadata: { completeness: 'partial' } }),
		);
		assert.equal(partial?.paging?.truncated, true, 'partial sets truncation');

		const unknown = await readForRepos(() =>
			Promise.resolve({ data: [], pageInfo: { hasNextPage: false }, metadata: { completeness: 'unknown' } }),
		);
		assert.equal(unknown?.paging?.truncated, true, 'unknown sets truncation');
	});

	test('keeps a real cursor as the only continuation even when metadata is partial', async () => {
		const result = await readForRepos(() =>
			Promise.resolve({
				data: [],
				pageInfo: { hasNextPage: true, endCursor: 'abc' },
				metadata: { completeness: 'partial' },
			}),
		);

		// A failed sibling scope (`partial`) coexists with a real next page: `more`/`cursor` come from pageInfo,
		// `truncated` from metadata. Completeness never fabricates or suppresses the cursor.
		assert.equal(result?.paging?.more, true);
		assert.equal(result?.paging?.cursor, JSON.stringify({ value: 'abc', type: 'cursor' }));
		assert.equal(result?.paging?.truncated, true);
	});

	test('leaves truncation unset and metadata absent when the provider reports none', async () => {
		const result = await readForRepos(() => Promise.resolve({ data: [], pageInfo: { hasNextPage: false } }));

		assert.equal(result?.metadata, undefined, 'no metadata for metadata-free providers');
		assert.equal(result?.paging?.truncated, undefined, 'no truncation without metadata');
	});
});
