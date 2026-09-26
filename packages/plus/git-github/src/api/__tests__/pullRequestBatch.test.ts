import assert from 'node:assert';
import { suite, test } from 'mocha';
import { AuthenticationError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

/**
 * The batch pull request read: N `(owner, repo, number)` coordinates in one aliased document. The pull-request
 * twin of `GitHubApi.getIssuesBatch` (see `issueSearch.test.ts`), sharing its aliased-repository shape and its
 * partial-`NOT_FOUND` tolerance.
 */
suite('GitHubApi.getPullRequestsBatch', () => {
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

	function batchServe(
		byAlias: Record<string, unknown>,
		errors?: { type: string; path?: string[]; message?: string; extensions?: Record<string, unknown> }[],
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

	/** A node carrying the FULL pull request fragment's fields, matching `gqlPullRequestFragment`. */
	function prNode(number: number): unknown {
		return {
			id: `node-${number}`,
			number: number,
			title: `PR ${number}`,
			body: `Body ${number}`,
			permalink: `https://github.com/o/a/pull/${number}`,
			url: `https://github.com/o/a/pull/${number}`,
			state: 'OPEN',
			createdAt: '2026-01-01T00:00:00Z',
			updatedAt: '2026-01-01T00:00:00Z',
			closedAt: null,
			mergedAt: null,
			closed: false,
			author: { login: 'octo', avatarUrl: '', url: 'https://github.com/octo' },
			baseRefName: 'main',
			baseRefOid: 'base',
			headRefName: 'feature',
			headRefOid: 'head',
			headRepository: {
				isFork: false,
				name: 'a',
				owner: { login: 'o' },
				sshUrl: 'git@github.com:o/a.git',
				url: 'https://github.com/o/a',
			},
			repository: {
				isFork: false,
				name: 'a',
				owner: { login: 'o' },
				sshUrl: 'git@github.com:o/a.git',
				url: 'https://github.com/o/a',
				viewerPermission: 'WRITE',
			},
			isCrossRepository: false,
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

	test('resolves every coordinate in one request, positionally, with the full fragment', async () => {
		const { config, getQuery, getVariables } = batchServe({
			p0: { pullRequest: prNode(1) },
			p1: { pullRequest: prNode(2) },
		});
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsBatch(provider, token, [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'b', number: 2 },
		]);

		assert.deepEqual(
			out.map(r => (r.status === 'fulfilled' ? r.value?.id : 'rejected')),
			['1', '2'],
		);
		// The full fragment — not the lite one — so a row carries review/check/diff fields.
		assert.match(getQuery(), /reviewDecision/);
		assert.match(getQuery(), /latestReviews/);
		assert.match(getQuery(), /changedFiles/);
		// Coordinates reach the query as VARIABLES, never interpolated into it, aliased p0../p1..
		assert.match(getQuery(), /p0: repository\(owner: \$o0, name: \$n0\)/);
		assert.match(getQuery(), /pullRequest\(number: \$k0\)/);
		assert.equal(getVariables().o0, 'o');
		assert.equal(getVariables().n1, 'b');
		assert.equal(getVariables().k1, 2);
	});

	test('a NOT_FOUND alongside real results yields absences, not a thrown batch', async () => {
		// GitHub's actual shape for a partly-resolvable batch: 200, full `data`, one NOT_FOUND per missing
		// coordinate. Throwing here would discard `p0` because `p1` and `p2` do not exist/are not visible.
		const { config } = batchServe({ p0: { pullRequest: prNode(1) }, p1: { pullRequest: null }, p2: null }, [
			{ type: 'NOT_FOUND', path: ['p1', 'pullRequest'] },
			{ type: 'NOT_FOUND', path: ['p2'] },
		]);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsBatch(provider, token, [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'a', number: 999 },
			{ owner: 'o', repo: 'gone', number: 1 },
		]);

		assert.ok(out.every(r => r.status === 'fulfilled'));
		assert.deepEqual(
			out.map(r => (r.status === 'fulfilled' ? r.value?.id : 'rejected')),
			['1', undefined, undefined],
		);
	});

	test('a target that fails on its own — e.g. SAML — rejects only that slot', async () => {
		// GitHub answers a SAML-enforcing org with HTTP 200: the other alias's data, plus a FORBIDDEN for the one
		// the token isn't authorized for. The token still worked, so this must not throw the whole batch, and
		// the rejection must NOT be an AuthenticationError (that would expire the session over a working token).
		const { config } = batchServe({ p0: { pullRequest: prNode(1) }, p1: { pullRequest: null } }, [
			{
				type: 'FORBIDDEN',
				path: ['p1'],
				message:
					'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.',
				extensions: { saml_failure: true },
			},
		]);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsBatch(provider, token, [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'saml-org', number: 2 },
		]);

		assert.equal(out[0].status, 'fulfilled');
		assert.equal(out[0].status === 'fulfilled' ? out[0].value?.id : undefined, '1');
		assert.equal(out[1].status, 'rejected');
		const reason = out[1].status === 'rejected' ? (out[1].reason as unknown) : undefined;
		assert.ok(
			!(reason instanceof AuthenticationError),
			'a SAML refusal on one target must not become auth failure',
		);
		assert.match((reason as Error).message, /SAML enforcement/);
	});

	test('NOT_FOUND on one alias and FORBIDDEN on another resolve independently', async () => {
		const { config } = batchServe({ p0: { pullRequest: null }, p1: { pullRequest: null } }, [
			{ type: 'NOT_FOUND', path: ['p0', 'pullRequest'] },
			{ type: 'FORBIDDEN', path: ['p1'], message: 'forbidden' },
		]);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsBatch(provider, token, [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'saml-org', number: 2 },
		]);

		assert.equal(out[0].status, 'fulfilled');
		assert.equal(out[0].status === 'fulfilled' ? out[0].value : undefined, undefined);
		assert.equal(out[1].status, 'rejected');
	});

	test('an alias reporting NOT_FOUND then FORBIDDEN rejects, not absent', async () => {
		// A later, non-NOT_FOUND error on the SAME alias must win: the node was never proven absent, it was
		// refused outright, and the rejection carries the refusal's own message.
		const { config } = batchServe({ p0: { pullRequest: null } }, [
			{ type: 'NOT_FOUND', path: ['p0', 'pullRequest'] },
			{ type: 'FORBIDDEN', path: ['p0'], message: 'forbidden after all' },
		]);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]);

		assert.equal(out[0].status, 'rejected');
		const reason = out[0].status === 'rejected' ? (out[0].reason as Error) : undefined;
		assert.match(reason?.message ?? '', /forbidden after all/);
	});

	test('a present node with a nested-path NOT_FOUND rejects rather than being trusted', async () => {
		// A NOT_FOUND nested under the alias — e.g. a sub-field GitHub couldn't resolve — is still an error ON
		// that alias. The top-level node coming back non-null does not make it safe to use.
		const { config } = batchServe({ p0: { pullRequest: prNode(1) } }, [
			{ type: 'NOT_FOUND', path: ['p0', 'pullRequest', 'headRepository'], message: 'head repository not found' },
		]);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]);

		assert.equal(out[0].status, 'rejected');
	});

	test('an error with no path still throws the whole call, typed as today', async () => {
		const { config } = batchServe({ p0: { pullRequest: prNode(1) } }, [{ type: 'RATE_LIMITED' }]);
		const api = new GitHubApi(config);

		await assert.rejects(
			() => api.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]),
			(ex: unknown) => ex instanceof RequestRateLimitError,
		);
	});

	test('FORBIDDEN with no path still throws AuthenticationError, as today', async () => {
		const { config } = batchServe({ p0: { pullRequest: prNode(1) } }, [{ type: 'FORBIDDEN' }]);
		const api = new GitHubApi(config);

		await assert.rejects(
			() => api.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]),
			(ex: unknown) => ex instanceof AuthenticationError,
		);
	});

	test('a response with no data throws rather than reading as a batch of absences', async () => {
		const { config } = batchServe(null as unknown as Record<string, unknown>);
		const api = new GitHubApi(config);

		await assert.rejects(() => api.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]));
	});

	test('no coordinates costs no request', async () => {
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

		assert.deepEqual(await api.getPullRequestsBatch(provider, token, []), []);
		assert.equal(called, false);
	});

	test('an unmappable node rejects its slot rather than being reported as a proven absence', async () => {
		// A mapping failure must NOT collapse to `undefined`: that would publish a LIVE pull request as
		// proven-not-found, and the consumer caches absences. Dropping `repository` makes `fromGitHubPullRequest`
		// throw when it reads `pr.repository.owner.login`. Per-slot rejection is possible now that the return
		// shape is settled results, so one bad node no longer has to take the whole call down.
		const { repository: _repository, ...unmappable } = prNode(1) as Record<string, unknown>;
		const { config } = batchServe({ p0: { pullRequest: unmappable } });
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]);

		assert.equal(out[0].status, 'rejected');
	});
});
