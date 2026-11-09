import assert from 'node:assert';
import { suite, test } from 'mocha';
import { PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

/**
 * The per-branch merge-queue read (INTERIM, goals S6): every base branch's queue as an alias on one `repository`
 * selection, joined by the caller on pull request number.
 */
suite('GitHubApi.getMergeQueueEntriesForBranches', () => {
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

	function serve(
		repository: Record<string, unknown> | null,
		errors?: { type: string; path?: string[]; message?: string }[],
	): { config: GitHubApiConfig; getCalls: () => { query: string; variables: Record<string, unknown> }[] } {
		const calls: { query: string; variables: Record<string, unknown> }[] = [];
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { query?: string; variables?: Record<string, unknown> };
				calls.push({ query: body.query ?? '', variables: body.variables ?? {} });
				return new Response(
					JSON.stringify({ data: { repository: repository }, ...(errors != null ? { errors: errors } : {}) }),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				);
			},
		} as unknown as GitHubApiConfig;
		return { config: config, getCalls: () => calls };
	}

	function entry(number: number, state: string, estimatedTimeToMerge: number | null = null): unknown {
		return {
			state: state,
			enqueuedAt: '2026-10-27T10:00:00Z',
			estimatedTimeToMerge: estimatedTimeToMerge,
			mergeQueue: { url: 'https://github.com/o/a/queue/main' },
			position: number,
			pullRequest: { number: number },
		};
	}

	test('reads every branch in one request and keys the mapped entries by pull request number', async () => {
		const { config, getCalls } = serve({
			b0: { entries: { nodes: [entry(1, 'AWAITING_CHECKS', 600), entry(2, 'UNMERGEABLE')] } },
			// A branch without a merge queue answers `null`, and contributes nothing.
			b1: null,
		});

		const before = Date.now();
		const result = await new GitHubApi(config).getMergeQueueEntriesForBranches(provider, token, 'o', 'a', [
			'main',
			'release',
		]);
		const after = Date.now();

		assert.equal(getCalls().length, 1, 'every branch is aliased into one GraphQL request');
		const { query, variables } = getCalls()[0];
		assert.match(query, /repository\(owner: \$owner, name: \$repo\)/);
		assert.match(query, /b0: mergeQueue\(branch: \$b0\)/);
		assert.match(query, /b1: mergeQueue\(branch: \$b1\)/);
		assert.match(query, /entries\(first: 100\)/);
		// The same entry selection the per-pull-request fragment uses, so one mapper serves both.
		assert.match(query, /estimatedTimeToMerge/);
		// Shown in the queue status ("#2 in the merge queue").
		assert.match(query, /\bposition\b/);
		assert.match(query, /pullRequest \{\s*number\s*\}/);
		assert.equal(variables.b0, 'main');
		assert.equal(variables.b1, 'release');

		// The estimate is fixed to a date when read: 600 seconds from the moment the response was mapped.
		const estimatedMergeAt = result?.get(1)?.estimatedMergeAt?.getTime();
		assert.ok(
			estimatedMergeAt != null && estimatedMergeAt >= before + 600_000 && estimatedMergeAt <= after + 600_000,
			`expected an estimate 600s after the read, got ${estimatedMergeAt}`,
		);

		assert.deepEqual(
			[...(result ?? [])],
			[
				[
					1,
					{
						state: PullRequestMergeQueueState.AwaitingChecks,
						enqueuedAt: new Date('2026-10-27T10:00:00Z'),
						estimatedMergeAt: new Date(estimatedMergeAt),
						url: 'https://github.com/o/a/queue/main',
						position: 1,
					},
				],
				[
					2,
					{
						state: PullRequestMergeQueueState.Unmergeable,
						enqueuedAt: new Date('2026-10-27T10:00:00Z'),
						estimatedMergeAt: undefined,
						url: 'https://github.com/o/a/queue/main',
						position: 2,
					},
				],
			],
		);
	});

	test('answers undefined on GitHub Enterprise Server without a request', async () => {
		const { config, getCalls } = serve({});

		const result = await new GitHubApi(config).getMergeQueueEntriesForBranches(
			provider,
			token,
			'o',
			'a',
			['main'],
			{ baseUrl: 'https://ghe.example.com/api/v3' },
		);

		assert.equal(result, undefined);
		assert.equal(getCalls().length, 0);
	});

	test('answers an empty map without a request when no branch is asked about', async () => {
		const { config, getCalls } = serve({});

		const result = await new GitHubApi(config).getMergeQueueEntriesForBranches(provider, token, 'o', 'a', []);

		assert.equal(result?.size, 0);
		assert.equal(getCalls().length, 0);
	});

	test('answers undefined for a repository GitHub reports not found', async () => {
		const { config } = serve(null, [{ type: 'NOT_FOUND', path: ['repository'], message: 'Not found' }]);

		const result = await new GitHubApi(config).getMergeQueueEntriesForBranches(provider, token, 'o', 'a', ['main']);

		assert.equal(result, undefined);
	});

	test('rejects any other failure, for the caller to log and degrade', async () => {
		const { config } = serve(null, [{ type: 'INTERNAL', message: 'Something went wrong' }]);

		await assert.rejects(
			new GitHubApi(config).getMergeQueueEntriesForBranches(provider, token, 'o', 'a', ['main']),
		);
	});
});
