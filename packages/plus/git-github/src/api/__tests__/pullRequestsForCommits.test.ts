import assert from 'node:assert';
import { suite, test } from 'mocha';
import { AuthenticationError, AuthenticationErrorReason } from '@gitlens/git/errors.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';
import { gitHubPullRequestLite } from './fixtures.js';

/**
 * The pull-requests-by-commit read: N commits of one repository in one aliased document, each answered with the pull
 * request the single-commit read (`getPullRequestForCommit`) would pick. Shares `getPullRequestsBatch`'s per-alias
 * error rules (see `pullRequestBatch.test.ts`), but aliases INSIDE one `repository` selection, so an alias's errors
 * are nested one level down.
 */
suite('GitHubApi.getPullRequestsForCommits', () => {
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

	const sha = (n: number): string => n.toString(16).padStart(40, '0').replace(/^0/, 'a');

	function serve(
		data: Record<string, unknown>,
		errors?: { type: string; path?: string[]; message?: string }[],
	): {
		config: GitHubApiConfig;
		getQueries: () => string[];
		getVariables: () => Record<string, unknown>[];
	} {
		const queries: string[] = [];
		const variables: Record<string, unknown>[] = [];
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { query?: string; variables?: Record<string, unknown> };
				queries.push(body.query ?? '');
				variables.push(body.variables ?? {});
				return new Response(JSON.stringify({ data: data, ...(errors != null ? { errors: errors } : {}) }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		} as unknown as GitHubApiConfig;
		return { config: config, getQueries: () => queries, getVariables: () => variables };
	}

	const ids = (out: PromiseSettledResult<{ id: string } | undefined>[]): (string | undefined)[] =>
		out.map(r => (r.status === 'fulfilled' ? r.value?.id : 'rejected'));

	test('resolves every SHA in one request, positionally, with the lite fragment', async () => {
		const { config, getQueries, getVariables } = serve({
			repository: {
				c0: { associatedPullRequests: { nodes: [gitHubPullRequestLite(1)] } },
				c1: { associatedPullRequests: { nodes: [gitHubPullRequestLite(2)] } },
			},
		});
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForCommits(provider, token, 'o', 'r', [sha(1), sha(2)]);

		assert.deepEqual(ids(out), ['1', '2']);
		assert.equal(getQueries().length, 1);
		const [query] = getQueries();
		// Aliases sit inside ONE repository selection, each asking for its first two associated pull requests.
		assert.equal(query.match(/\brepository\(/g)?.length, 1);
		assert.match(query, /repository\(name: \$repo, owner: \$owner\)/);
		assert.match(query, /c0: object\(oid: \$sha0\)/);
		assert.match(query, /c1: object\(oid: \$sha1\)/);
		assert.match(query, /associatedPullRequests\(first: 2, orderBy: \{field: UPDATED_AT, direction: DESC\}\)/);
		// The lite fragment, like the single-commit read — not the full one.
		assert.doesNotMatch(query, /reviewDecision/);
		// SHAs and the repository reach the query as VARIABLES, never interpolated into it.
		const [variables] = getVariables();
		assert.equal(variables.owner, 'o');
		assert.equal(variables.repo, 'r');
		assert.equal(variables.sha0, sha(1));
		assert.equal(variables.sha1, sha(2));
		assert.doesNotMatch(query, new RegExp(sha(1)));
	});

	test('a SHA with no associated pull request, or no commit, is a resolved none, not a rejection', async () => {
		const { config } = serve({
			repository: {
				c0: { associatedPullRequests: { nodes: [gitHubPullRequestLite(1)] } },
				// A commit that GitHub has but no pull request touched.
				c1: { associatedPullRequests: { nodes: [] } },
				// An object that isn't a commit (`... on Commit` matches nothing), and one it doesn't have at all.
				c2: {},
				c3: null,
			},
		});
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForCommits(provider, token, 'o', 'r', [sha(1), sha(2), sha(3), sha(4)]);

		assert.ok(out.every(r => r.status === 'fulfilled'));
		assert.deepEqual(ids(out), ['1', undefined, undefined, undefined]);
	});

	test('sends each SHA as given, one alias per SHA, and no request for none', async () => {
		const { config, getQueries, getVariables } = serve({
			repository: {
				c0: { associatedPullRequests: { nodes: [] } },
				c1: { associatedPullRequests: { nodes: [gitHubPullRequestLite(1)] } },
			},
		});
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForCommits(provider, token, 'o', 'r', [sha(2), sha(1)]);

		assert.deepEqual(ids(out), [undefined, '1']);
		assert.equal(getQueries().length, 1);
		assert.equal(getVariables()[0].sha0, sha(2));
		assert.equal(getVariables()[0].sha1, sha(1));

		const none = serve({});
		assert.deepEqual(await new GitHubApi(none.config).getPullRequestsForCommits(provider, token, 'o', 'r', []), []);
		assert.equal(none.getQueries().length, 0);
	});

	test('selects merge-queue data only when the read asks for it, against github.com', async () => {
		for (const [options, expected] of [
			[{ mergeQueue: true }, true],
			[{ mergeQueue: false }, false],
			[{}, false],
			[{ mergeQueue: true, baseUrl: 'https://github.acme.com/api/v3' }, false],
		] as const) {
			const { config, getQueries } = serve({ repository: { c0: { associatedPullRequests: { nodes: [] } } } });
			await new GitHubApi(config).getPullRequestsForCommits(provider, token, 'o', 'r', [sha(1)], options);

			assert.equal(/\bmergeQueueEntry\b/.test(getQueries()[0]), expected, JSON.stringify(options));
		}
	});

	test('chooses among associated pull requests exactly as the single-commit read does', async () => {
		// Fork pull requests are kept only when the repository owner owns the fork; then the owner's own, then a
		// merged one, then the most recently updated. The nodes cover each rule, so a drift in either read's ordering
		// shows up as a different winner.
		const open = gitHubPullRequestLite(1, { state: 'OPEN', updatedAt: '2026-03-01T00:00:00Z' });
		const merged = gitHubPullRequestLite(2, { state: 'MERGED', updatedAt: '2026-01-01T00:00:00Z' });
		const foreignFork = gitHubPullRequestLite(3, undefined, { owner: 'someone', name: 'r' });
		foreignFork.repository.isFork = true;
		const ownFork = gitHubPullRequestLite(
			4,
			{ state: 'MERGED', updatedAt: '2026-06-01T00:00:00Z' },
			{ owner: 'o', name: 'r' },
		);
		ownFork.repository.isFork = true;
		const cases: [string, (typeof open)[], string | undefined][] = [
			['a merged pull request wins over a newer open one', [open, merged], '2'],
			['a fork the owner does not own is dropped', [foreignFork], undefined],
			['a fork the owner owns is kept', [ownFork, open], '4'],
			['the remaining one is chosen when the other is a foreign fork', [foreignFork, open], '1'],
		];

		for (const [name, nodes, expected] of cases) {
			const single = serve({ repository: { object: { associatedPullRequests: { nodes: nodes } } } });
			const batch = serve({ repository: { c0: { associatedPullRequests: { nodes: nodes } } } });

			const one = await new GitHubApi(single.config).getPullRequestForCommit(provider, token, 'o', 'r', sha(1));
			const [many] = await new GitHubApi(batch.config).getPullRequestsForCommits(provider, token, 'o', 'r', [
				sha(1),
			]);

			assert.equal(one?.id, expected, `${name}: single-commit read`);
			assert.equal(many.status === 'fulfilled' ? many.value?.id : 'rejected', expected, `${name}: batch read`);
		}

		// The owner as a caller may spell it, against GitHub's login.
		const single = serve({ repository: { object: { associatedPullRequests: { nodes: [ownFork, open] } } } });
		const batch = serve({ repository: { c0: { associatedPullRequests: { nodes: [ownFork, open] } } } });
		const one = await new GitHubApi(single.config).getPullRequestForCommit(provider, token, 'O', 'r', sha(1));
		const [many] = await new GitHubApi(batch.config).getPullRequestsForCommits(provider, token, 'O', 'r', [sha(1)]);
		assert.equal(one?.id, '4', 'the owner is matched ignoring case: single-commit read');
		assert.equal(many.status === 'fulfilled' ? many.value?.id : 'rejected', '4', 'and batch read');
	});

	test('an error on one commit rejects only that SHA, and not as an authentication failure', async () => {
		const { config } = serve(
			{
				repository: {
					c0: { associatedPullRequests: { nodes: [gitHubPullRequestLite(1)] } },
					c1: null,
					c2: { associatedPullRequests: { nodes: [] } },
				},
			},
			[{ type: 'SERVICE_UNAVAILABLE', path: ['repository', 'c1'], message: 'Something went wrong' }],
		);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsForCommits(provider, token, 'o', 'r', [sha(1), sha(2), sha(3)]);

		assert.deepEqual(ids(out), ['1', 'rejected', undefined]);
		const reason = out[1].status === 'rejected' ? (out[1].reason as unknown) : undefined;
		assert.ok(!(reason instanceof AuthenticationError));
		assert.match((reason as Error).message, /Something went wrong/);
	});

	test('a repository GitHub cannot see answers every SHA as none, one refusing the token or a 401 fails the request without prompting, and any other repository error rejects them all', async () => {
		const missing = serve({ repository: null }, [{ type: 'NOT_FOUND', path: ['repository'], message: 'gone' }]);
		const gone = await new GitHubApi(missing.config).getPullRequestsForCommits(provider, token, 'o', 'r', [
			sha(1),
			sha(2),
		]);
		assert.deepEqual(ids(gone), [undefined, undefined]);

		let prompts = 0;
		const onAuthenticationFailure = () => {
			prompts++;
			return Promise.resolve(false);
		};

		const refused = serve({ repository: null }, [
			{
				type: 'FORBIDDEN',
				path: ['repository'],
				message: 'Resource protected by organization SAML enforcement.',
			},
		]);
		await assert.rejects(
			new GitHubApi({
				...refused.config,
				onAuthenticationFailure: onAuthenticationFailure,
			}).getPullRequestsForCommits(provider, token, 'o', 'r', [sha(1), sha(2)]),
			(ex: unknown) => ex instanceof AuthenticationError && ex.reason === AuthenticationErrorReason.Forbidden,
		);

		const unauthorized = {
			...serve({}).config,
			fetch: () =>
				Promise.resolve(
					new Response(JSON.stringify({ message: 'Bad credentials' }), {
						status: 401,
						headers: { 'content-type': 'application/json' },
					}),
				),
			onAuthenticationFailure: onAuthenticationFailure,
		} as unknown as GitHubApiConfig;
		await assert.rejects(
			new GitHubApi(unauthorized).getPullRequestsForCommits(provider, token, 'o', 'r', [sha(1), sha(2)]),
			(ex: unknown) => ex instanceof AuthenticationError && ex.reason === AuthenticationErrorReason.Unauthorized,
		);
		assert.equal(prompts, 0, 'the batch leaves the credential to its settlement');

		const failing = serve({ repository: null }, [
			{ type: 'SERVICE_UNAVAILABLE', path: ['repository'], message: 'Something went wrong' },
		]);
		const out = await new GitHubApi(failing.config).getPullRequestsForCommits(provider, token, 'o', 'r', [
			sha(1),
			sha(2),
		]);
		assert.deepEqual(ids(out), ['rejected', 'rejected']);
	});
});
