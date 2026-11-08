import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

/**
 * The merge-queue selection (`mergeQueueEntry`, `isMergeQueueEnabled` and the `timelineItems` connection that costs
 * a rate-limit request per pull request) is made only against github.com and only for a read that asks for it
 * (`mergeQueue: true`) or, when the read says nothing, a host that opts in with `getPullRequestReadOptions`. What
 * these pin is the document each pull request read sends.
 */
suite('GitHubApi merge-queue opt-in', () => {
	const provider = {
		id: 'github',
		name: 'GitHub',
		domain: 'github.com',
		icon: 'github',
		getIgnoreSSLErrors: () => false,
		reauthenticate: () => Promise.resolve(),
		trackRequestException: () => {},
	} as unknown as Provider;

	const token: GitHubTokenInfo = {
		providerId: 'github',
		accessToken: 'token',
		microHash: 'hash',
		cloud: true,
		type: undefined,
	};

	const enterprise = 'https://github.acme.com/api/v3';
	const sha = '0123456789abcdef0123456789abcdef01234567';

	/** What a read is handed: the host to address, and the per-read override. */
	type ReadOptions = { baseUrl?: string; mergeQueue?: boolean };

	type Read = {
		name: string;
		run: (api: GitHubApi, options: ReadOptions) => Promise<unknown>;
	};

	const coordinates = [{ owner: 'o', repo: 'a', number: 1 }];

	const reads: Read[] = [
		{
			name: 'getPullRequest',
			run: (api, o) => api.getPullRequest(provider, token, 'o', 'a', 1, o),
		},
		{
			name: 'getPullRequestForBranch',
			run: (api, o) => api.getPullRequestForBranch(provider, token, 'o', 'a', 'main', o),
		},
		{
			name: 'getPullRequestForCommit',
			run: (api, o) => api.getPullRequestForCommit(provider, token, 'o', 'a', sha, o),
		},
		{
			name: 'searchMyPullRequestsPage (full)',
			run: (api, o) => api.searchMyPullRequestsPage(provider, token, { user: 'octo', ...o, state: 'open' }),
		},
		{
			name: 'searchMyPullRequestsPage (summary)',
			run: (api, o) =>
				api.searchMyPullRequestsPage(provider, token, {
					user: 'octo',
					...o,
					state: 'open',
					summary: true,
				}),
		},
		{
			name: 'searchPullRequestsPage',
			run: (api, o) =>
				api.searchPullRequestsPage(provider, token, {
					repos: ['o/a'],
					...o,
					criteria: { relationships: [], states: ['open'] },
				}),
		},
		{
			name: 'searchPullRequests',
			run: (api, o) => api.searchPullRequests(provider, token, { user: 'octo', repos: ['o/a'], ...o }),
		},
		{
			name: 'getPullRequestsBatch',
			run: (api, o) => api.getPullRequestsBatch(provider, token, coordinates, o),
		},
		{
			name: 'getPullRequestsEtagFieldsBatch',
			run: (api, o) => api.getPullRequestsEtagFieldsBatch(provider, token, coordinates, o),
		},
		{
			name: 'getPullRequestsForBranches',
			run: (api, o) =>
				api.getPullRequestsForBranches(
					provider,
					token,
					[{ owner: 'o', repo: 'a', branch: 'main', headOwners: ['o'] }],
					{ ...o, limit: 10 },
				),
		},
	];

	/** Answers every request with an empty `data`, so only the documents sent matter; a read that can't map it rejects. */
	function capture(readOptions?: () => { readonly mergeQueue?: boolean }): {
		api: GitHubApi;
		queries: string[];
	} {
		const queries: string[] = [];
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { query?: string };
				queries.push(body.query ?? '');
				return new Response(JSON.stringify({ data: {} }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			...(readOptions != null ? { getPullRequestReadOptions: readOptions } : {}),
		} as unknown as GitHubApiConfig;
		return { api: new GitHubApi(config), queries: queries };
	}

	async function documentOf(
		read: Read,
		api: GitHubApi,
		queries: string[],
		options: ReadOptions = {},
	): Promise<string> {
		await read.run(api, options).catch(() => undefined);
		assert.ok(queries.length > 0, `${read.name} sent no request`);
		return queries.join('\n');
	}

	function assertSelectsMergeQueue(query: string): void {
		assert.match(query, /\bmergeQueueEntry\b/);
		assert.match(query, /\bisMergeQueueEnabled\b/);
		assert.match(query, /\btimelineItems\b/);
	}

	function assertSelectsNoMergeQueue(query: string): void {
		assert.doesNotMatch(query, /\bmergeQueueEntry\b/);
		assert.doesNotMatch(query, /\bisMergeQueueEnabled\b/);
		assert.doesNotMatch(query, /\btimelineItems\b/);
	}

	for (const read of reads) {
		test(`${read.name} selects no merge-queue data by default`, async () => {
			const { api, queries } = capture();
			const query = await documentOf(read, api, queries);

			assert.doesNotMatch(query, /\bmergeQueueEntry\b/);
			assert.doesNotMatch(query, /\bisMergeQueueEnabled\b/);
			assert.doesNotMatch(query, /\btimelineItems\b/);
		});

		test(`${read.name} selects no merge-queue data when the host answers no opt-in`, async () => {
			const { api, queries } = capture(() => ({}));
			const query = await documentOf(read, api, queries);

			assert.doesNotMatch(query, /\bmergeQueueEntry\b/);
			assert.doesNotMatch(query, /\bisMergeQueueEnabled\b/);
			assert.doesNotMatch(query, /\btimelineItems\b/);
		});

		test(`${read.name} selects the merge-queue data against github.com when the host opts in`, async () => {
			const { api, queries } = capture(() => ({ mergeQueue: true }));
			const query = await documentOf(read, api, queries);

			assertSelectsMergeQueue(query);
		});

		test(`${read.name} selects no merge-queue data against Enterprise even when the host opts in`, async () => {
			const { api, queries } = capture(() => ({ mergeQueue: true }));
			const query = await documentOf(read, api, queries, { baseUrl: enterprise });

			assertSelectsNoMergeQueue(query);
		});

		test(`${read.name} selects the merge-queue data against github.com when the read asks, with no host opt-in`, async () => {
			const { api, queries } = capture();
			const query = await documentOf(read, api, queries, { mergeQueue: true });

			assertSelectsMergeQueue(query);
		});

		test(`${read.name} selects the merge-queue data against github.com when the read asks and the host answers no opt-in`, async () => {
			const { api, queries } = capture(() => ({}));
			const query = await documentOf(read, api, queries, { mergeQueue: true });

			assertSelectsMergeQueue(query);
		});

		test(`${read.name} selects no merge-queue data when the read declines, whatever the host opts in to`, async () => {
			const { api, queries } = capture(() => ({ mergeQueue: true }));
			const query = await documentOf(read, api, queries, { mergeQueue: false });

			assertSelectsNoMergeQueue(query);
		});

		test(`${read.name} selects no merge-queue data against Enterprise even when the read asks`, async () => {
			const { api, queries } = capture(() => ({ mergeQueue: true }));
			const query = await documentOf(read, api, queries, { baseUrl: enterprise, mergeQueue: true });

			assertSelectsNoMergeQueue(query);
		});
	}

	test('the opt-in is read on every query build, so a change applies from the next read', async () => {
		let mergeQueue = false;
		const { api, queries } = capture(() => ({ mergeQueue: mergeQueue }));

		await api.getPullRequestsBatch(provider, token, coordinates).catch(() => undefined);
		mergeQueue = true;
		await api.getPullRequestsBatch(provider, token, coordinates).catch(() => undefined);

		assert.equal(queries.length, 2);
		assert.doesNotMatch(queries[0], /\bmergeQueueEntry\b/);
		assert.match(queries[1], /\bmergeQueueEntry\b/);
	});
});
