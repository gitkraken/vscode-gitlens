import assert from 'node:assert';
import { suite, test } from 'mocha';
import { AuthenticationError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

/**
 * The pull-requests-by-branch read: N branches in one aliased document, each answered with every pull request whose
 * head is that branch. Shares `getPullRequestsBatch`'s per-alias error rules (see `pullRequestBatch.test.ts`); what
 * it adds is the head matching — by ref NAME, so a deleted branch still matches, and by head REPOSITORY, so a
 * same-named branch in some other fork doesn't.
 */
suite('GitHubApi.getPullRequestsForBranches', () => {
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

	const limit = { limit: 10 };

	function serve(
		byAlias: Record<string, unknown>,
		errors?: { type: string; path?: string[]; message?: string }[],
	): { config: GitHubApiConfig; getQuery: () => string; getVariables: () => Record<string, unknown> } {
		let query = '';
		let variables: Record<string, unknown> = {};
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { query?: string; variables?: Record<string, unknown> };
				query = body.query ?? '';
				variables = body.variables ?? {};
				return new Response(JSON.stringify({ data: byAlias, ...(errors != null ? { errors: errors } : {}) }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		} as unknown as GitHubApiConfig;
		return { config: config, getQuery: () => query, getVariables: () => variables };
	}

	/** A node carrying the full pull request fragment's fields plus `headRepositoryOwner`. */
	function prNode(
		number: number,
		options?: {
			branch?: string;
			state?: 'OPEN' | 'CLOSED' | 'MERGED';
			updatedAt?: string;
			/** The fork's owner; omitted means the pull request comes from the base repository `o/a`. */
			forkOwner?: string;
			/** The fork was deleted: GitHub keeps its owner but drops the repository. */
			forkDeleted?: boolean;
		},
	): Record<string, unknown> {
		const branch = options?.branch ?? 'feature';
		const headOwner = options?.forkOwner ?? 'o';
		const repository = {
			isFork: false,
			name: 'a',
			owner: { login: 'o' },
			sshUrl: 'git@github.com:o/a.git',
			url: 'https://github.com/o/a',
		};
		return {
			id: `node-${number}`,
			number: number,
			title: `PR ${number}`,
			body: `Body ${number}`,
			permalink: `https://github.com/o/a/pull/${number}`,
			url: `https://github.com/o/a/pull/${number}`,
			state: options?.state ?? 'OPEN',
			createdAt: '2026-01-01T00:00:00Z',
			updatedAt: options?.updatedAt ?? '2026-01-01T00:00:00Z',
			closedAt: options?.state === 'MERGED' ? (options.updatedAt ?? '2026-01-01T00:00:00Z') : null,
			mergedAt: options?.state === 'MERGED' ? (options.updatedAt ?? '2026-01-01T00:00:00Z') : null,
			closed: options?.state === 'MERGED' || options?.state === 'CLOSED',
			author: { login: 'octo', avatarUrl: '', url: 'https://github.com/octo' },
			baseRefName: 'main',
			baseRefOid: 'base',
			headRefName: branch,
			headRefOid: 'head',
			headRepository: options?.forkDeleted
				? null
				: {
						isFork: options?.forkOwner != null,
						name: 'a',
						owner: { login: headOwner },
						sshUrl: `git@github.com:${headOwner}/a.git`,
						url: `https://github.com/${headOwner}/a`,
					},
			headRepositoryOwner: { login: headOwner },
			repository: { ...repository, viewerPermission: 'WRITE' },
			isCrossRepository: options?.forkOwner != null,
			isDraft: false,
			additions: 1,
			deletions: 1,
			changedFiles: 1,
			checksUrl: '',
			mergeable: 'MERGEABLE',
			reviewDecision: 'APPROVED',
			latestReviews: { nodes: [] },
			viewerLatestReview: null,
			reviewRequests: { nodes: [] },
			assignees: { nodes: [] },
			commits: { totalCount: 0, nodes: [] },
			totalCommentsCount: 0,
			viewerCanUpdate: true,
		};
	}

	function connection(nodes: Record<string, unknown>[], totalCount: number = nodes.length): unknown {
		return { pullRequests: { totalCount: totalCount, nodes: nodes } };
	}

	function ids(slot: PromiseSettledResult<{ pullRequests: { id: string }[] }>): string[] | 'rejected' {
		return slot.status === 'fulfilled' ? slot.value.pullRequests.map(pr => pr.id) : 'rejected';
	}

	test('answers every branch in one request, keyed on the head ref name in every state, newest first', async () => {
		const { config, getQuery, getVariables } = serve({
			b0: connection([
				prNode(1, { state: 'OPEN', updatedAt: '2026-01-01T00:00:00Z' }),
				prNode(2, { state: 'MERGED', updatedAt: '2026-03-01T00:00:00Z' }),
			]),
			b1: connection([]),
		});
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[
				{ owner: 'o', repo: 'a', branch: 'feature' },
				{ owner: 'o', repo: 'b', branch: 'other' },
			],
			limit,
		);

		assert.deepEqual(out.map(ids), [['2', '1'], []]);
		assert.equal(out[0].status === 'fulfilled' ? out[0].value.truncated : undefined, false);
		// Keyed on the ref NAME, never on the ref itself: a merged pull request's branch is usually deleted, and the
		// ref lookup answers "none" for it.
		assert.match(getQuery(), /b0: repository\(owner: \$o0, name: \$n0\)/);
		assert.match(getQuery(), /pullRequests\(headRefName: \$h0, states: \[OPEN, CLOSED, MERGED\], first: \$limit/);
		assert.match(getQuery(), /orderBy: \{field: UPDATED_AT, direction: DESC\}/);
		assert.doesNotMatch(getQuery(), /ref\(qualifiedName/);
		assert.doesNotMatch(getQuery(), /associatedPullRequests/);
		// The full fragment, like the batch read.
		assert.match(getQuery(), /reviewDecision/);
		assert.match(getQuery(), /headRepositoryOwner/);
		assert.equal(getVariables().h0, 'feature');
		assert.equal(getVariables().n1, 'b');
		assert.equal(getVariables().limit, 10);
	});

	test('a merged pull request whose branch was deleted is found', async () => {
		// The branch is gone, so a ref-based lookup would get `ref: null` and report none; the pull request still
		// records its head ref name.
		const { config } = serve({ b0: connection([prNode(7, { state: 'MERGED' })]) });
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[{ owner: 'o', repo: 'a', branch: 'feature' }],
			limit,
		);

		assert.deepEqual(out.map(ids), [['7']]);
		const pr = out[0].status === 'fulfilled' ? out[0].value.pullRequests[0] : undefined;
		assert.equal(pr?.state, 'merged');
	});

	test('a same-named branch in a fork is excluded unless headOwner names that fork', async () => {
		const nodes = [
			prNode(1, { updatedAt: '2026-01-01T00:00:00Z' }),
			prNode(2, { forkOwner: 'forker', updatedAt: '2026-02-01T00:00:00Z' }),
			prNode(3, { forkOwner: 'someone-else', updatedAt: '2026-03-01T00:00:00Z' }),
		];
		const { config } = serve({ b0: connection(nodes), b1: connection(nodes), b2: connection(nodes) });
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[
				{ owner: 'o', repo: 'a', branch: 'feature' },
				{ owner: 'o', repo: 'a', branch: 'feature', headOwner: 'forker' },
				// GitHub logins are case-insensitive.
				{ owner: 'o', repo: 'a', branch: 'feature', headOwner: 'Forker' },
			],
			limit,
		);

		assert.deepEqual(out.map(ids), [['1'], ['2'], ['2']]);
	});

	test("a fork's pull request is still found after the fork was deleted", async () => {
		const { config } = serve({ b0: connection([prNode(4, { forkOwner: 'forker', forkDeleted: true })]) });
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[{ owner: 'o', repo: 'a', branch: 'feature', headOwner: 'forker' }],
			limit,
		);

		assert.deepEqual(out.map(ids), [['4']]);
	});

	test('truncated when GitHub matched more pull requests than it returned', async () => {
		const ten = Array.from({ length: 10 }, (_, i) => prNode(i + 1));
		const { config } = serve({ b0: connection(ten, 15), b1: connection(ten, 10) });
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[
				{ owner: 'o', repo: 'a', branch: 'feature' },
				{ owner: 'o', repo: 'b', branch: 'feature' },
			],
			limit,
		);

		assert.deepEqual(
			out.map(slot => (slot.status === 'fulfilled' ? slot.value.truncated : 'rejected')),
			[true, false],
		);
		assert.equal(out[0].status === 'fulfilled' ? out[0].value.pullRequests.length : 0, 10);
	});

	test('a missing base repository is a proven "none", not a failure', async () => {
		const { config } = serve({ b0: connection([prNode(1)]), b1: null }, [{ type: 'NOT_FOUND', path: ['b1'] }]);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[
				{ owner: 'o', repo: 'a', branch: 'feature' },
				{ owner: 'o', repo: 'gone', branch: 'feature' },
			],
			limit,
		);

		assert.deepEqual(out.map(ids), [['1'], []]);
	});

	test('a target that fails on its own — e.g. SAML — rejects only that slot, not as an auth failure', async () => {
		const { config } = serve({ b0: connection([prNode(1)]), b1: null }, [
			{
				type: 'FORBIDDEN',
				path: ['b1'],
				message: 'Resource protected by organization SAML enforcement.',
			},
		]);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[
				{ owner: 'o', repo: 'a', branch: 'feature' },
				{ owner: 'o', repo: 'saml-org', branch: 'feature' },
			],
			limit,
		);

		assert.deepEqual(ids(out[0]), ['1']);
		assert.equal(out[1].status, 'rejected');
		const reason = out[1].status === 'rejected' ? (out[1].reason as unknown) : undefined;
		assert.ok(!(reason instanceof AuthenticationError));
		assert.match((reason as Error).message, /SAML enforcement/);
	});

	test('a repository that arrived with an error on its alias rejects rather than being trusted', async () => {
		const { config } = serve({ b0: connection([prNode(1)]) }, [
			{ type: 'NOT_FOUND', path: ['b0', 'pullRequests', 'nodes', '0', 'headRepository'] },
		]);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[{ owner: 'o', repo: 'a', branch: 'feature' }],
			limit,
		);

		assert.equal(out[0].status, 'rejected');
	});

	test('an error with no path still throws the whole call, typed as today', async () => {
		const { config } = serve({ b0: connection([prNode(1)]) }, [{ type: 'RATE_LIMITED' }]);
		const api = new GitHubApi(config);

		await assert.rejects(
			() =>
				api.getPullRequestsForBranches(provider, token, [{ owner: 'o', repo: 'a', branch: 'feature' }], limit),
			(ex: unknown) => ex instanceof RequestRateLimitError,
		);
	});

	test('a response with no data throws rather than reading as a batch of "none"s', async () => {
		const { config } = serve(null as unknown as Record<string, unknown>);
		const api = new GitHubApi(config);

		await assert.rejects(() =>
			api.getPullRequestsForBranches(provider, token, [{ owner: 'o', repo: 'a', branch: 'feature' }], limit),
		);
	});

	test('an unmappable matching node rejects its slot; an unmappable fork row that never matched costs nothing', async () => {
		// Dropping `repository` makes `fromGitHubPullRequest` throw.
		const { repository: _repository, ...unmappable } = prNode(1);
		const { repository: _forkRepository, ...unmappableFork } = prNode(2, { forkOwner: 'forker' });
		const { config } = serve({ b0: connection([unmappable]), b1: connection([prNode(3), unmappableFork]) });
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForBranches(
			provider,
			token,
			[
				{ owner: 'o', repo: 'a', branch: 'feature' },
				{ owner: 'o', repo: 'b', branch: 'feature' },
			],
			limit,
		);

		assert.equal(out[0].status, 'rejected', 'a partial list would read as a complete answer');
		assert.deepEqual(ids(out[1]), ['3']);
	});

	test('no targets costs no request', async () => {
		let called = false;
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
			fetch: async () => {
				called = true;
				return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
			},
		} as unknown as GitHubApiConfig;
		const api = new GitHubApi(config);

		assert.deepEqual(await api.getPullRequestsForBranches(provider, token, [], limit), []);
		assert.equal(called, false);
	});
});
