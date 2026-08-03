import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { IssueSearchCriteria, IssueSearchRelationship } from '@gitlens/git/models/issue.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

/**
 * The filtered issue search and its count probe, in their own file rather than appended to `github.test.ts`.
 *
 * Both assert the EMITTED REQUEST — which criterion becomes which qualifier, that user input can't inject one,
 * and that the count applies exactly the qualifiers the search would — so they share a fixture style with each
 * other and with nothing else in the API client's suite.
 */

suite('GitHubApi.searchIssuesPage', () => {
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

	/** Captures the GraphQL variables and document, answering every alias with an empty, non-truncated result. */
	function capture(count = 0): {
		config: GitHubApiConfig;
		getVariables: () => Record<string, unknown>;
		getQuery: () => string;
	} {
		let variables: Record<string, unknown> = {};
		let query = '';
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as {
					query?: string;
					variables?: Record<string, unknown>;
				};
				variables = body.variables ?? {};
				query = body.query ?? '';
				// Answer every alias the document declared, so the aliases under test are the ones that ran.
				const aliases = Array.from(query.matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
				const data = Object.fromEntries(
					aliases.map(alias => [
						alias,
						{ issueCount: count, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] },
					]),
				);
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		return { config: config, getVariables: () => variables, getQuery: () => query };
	}

	test('scopes by repos and org together, and always sorts by most recently updated', async () => {
		const { config, getVariables } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a', 'o/b'], org: 'acme' });

		const q = String(getVariables().matched);
		assert.match(q, /org:acme/);
		assert.match(q, /repo:o\/a/);
		assert.match(q, /repo:o\/b/, 'repos and org combine rather than one replacing the other');
		assert.match(q, /sort:updated/, 'ordering is part of the contract, not an option');
		assert.match(q, /type:issue/);
	});

	test('with no relationship, runs a single search over the scope alone', async () => {
		const { config, getQuery } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'] });

		const aliases = Array.from(getQuery().matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
		assert.deepEqual(aliases, ['matched'], 'one unaliased-by-relationship search, not three @me ones');
		assert.doesNotMatch(getQuery(), /@me/, 'nothing binds the search to the current user');
	});

	const relationships: [relationship: IssueSearchRelationship, qualifier: RegExp][] = [
		['authored', /author:@me/],
		['assigned', /assignee:@me/],
		['mentioned', /mentions:@me/],
		['any-assignee', /assignee:\*/],
		['unassigned', /no:assignee/],
	];
	for (const [relationship, qualifier] of relationships) {
		test(`maps the ${relationship} relationship to its qualifier`, async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { relationships: [relationship] },
			});

			const emitted = Object.entries(getVariables()).filter(([key]) => !key.endsWith('Cursor'));
			const queries = emitted.filter(([, v]) => typeof v === 'string').map(([, v]) => String(v));
			assert.equal(queries.length, 1, 'exactly one search runs');
			assert.match(queries[0], qualifier);
		});
	}

	test('runs one search per relationship so the set is OR-ed, not intersected', async () => {
		const { config, getQuery, getVariables } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: ['authored', 'any-assignee'] },
		});

		const aliases = Array.from(getQuery().matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
		assert.deepEqual(aliases, ['authored', 'anyAssignee'], 'each relationship gets its own aliased search');
		// A single query would AND the two qualifiers, returning the intersection instead of the union.
		assert.match(String(getVariables().authored), /author:@me/);
		assert.doesNotMatch(String(getVariables().authored), /assignee:\*/);
		assert.match(String(getVariables().anyAssignee), /assignee:\*/);
		assert.doesNotMatch(String(getVariables().anyAssignee), /author:@me/);
	});

	const criteriaCases: [label: string, criteria: IssueSearchCriteria, expected: RegExp][] = [
		['state closed', { state: 'closed' }, /is:closed/],
		['labels are quoted', { labels: ['needs triage'] }, /label:"needs triage"/],
		['milestone is quoted', { milestone: 'v1 0' }, /milestone:"v1 0"/],
		['updatedAfter', { updatedAfter: '2026-05-05' }, /updated:>=2026-05-05/],
		['createdAfter', { createdAfter: '2026-01-01' }, /created:>=2026-01-01/],
		['withoutLinkedPullRequest', { withoutLinkedPullRequest: true }, /-linked:pr/],
		['free text', { text: 'crash on startup' }, /crash on startup/],
	];
	for (const [label, criteria, expected] of criteriaCases) {
		test(`emits a qualifier for ${label}`, async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: criteria });

			assert.match(String(getVariables().matched), expected);
		});
	}

	test('defaults to open, non-archived issues and drops both constraints when asked', async () => {
		const { config, getVariables } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'] });
		assert.match(String(getVariables().matched), /is:open/);
		assert.match(String(getVariables().matched), /archived:false/);

		await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { state: 'all', includeArchived: true },
		});
		const all = String(getVariables().matched);
		assert.doesNotMatch(all, /is:open|is:closed/, '`all` constrains no state');
		assert.doesNotMatch(all, /archived:false/);
	});

	test('emits every label as its own AND-ed qualifier', async () => {
		const { config, getVariables } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: { labels: ['bug', 'ui'] } });

		const q = String(getVariables().matched);
		assert.match(q, /label:"bug"/);
		assert.match(q, /label:"ui"/);
	});

	// GitHub search has no escape syntax, so the only safe transformation is removal. What must never survive is a
	// value that closes its own quote or reads as a qualifier: `foo" org:someone-else` would otherwise re-scope the
	// search to another organization entirely.
	suite('injection', () => {
		// The injected text still APPEARS in the query — but only ever inside its own quoted value, where GitHub
		// reads it as part of the label/milestone name rather than as a qualifier. So these assert the exact query,
		// not the absence of a substring: what matters is that the value stays quoted, and that no second
		// unquoted qualifier was created.
		test('a quote in a label cannot close its own qualifier', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { labels: ['bug" org:evil'] },
			});

			assert.equal(
				String(getVariables().matched),
				'repo:o/a type:issue is:open archived:false label:"bug org:evil" sort:updated',
				'the injected qualifier stays inside the quoted label value; no `org:` scope is added',
			);
		});

		test('a quote in a milestone cannot close its own qualifier', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { milestone: 'v1" repo:evil/x' },
			});

			assert.equal(
				String(getVariables().matched),
				'repo:o/a type:issue is:open archived:false milestone:"v1 repo:evil/x" sort:updated',
				'the injected `repo:` stays inside the quoted milestone value; the scope is still just o/a',
			);
		});

		test('a qualifier-shaped token in free text is dropped whole', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { text: 'crash org:evil is:closed' },
			});

			const q = String(getVariables().matched);
			assert.match(q, /crash/, 'the bare words survive — they are the point of free text');
			assert.doesNotMatch(q, /org:evil/);
			// `is:open` is still there from the state default; what must not appear is the injected `is:closed`.
			assert.doesNotMatch(q, /is:closed/);
		});

		// A control character SEPARATES words, so deleting it fuses them: `graph\nperformance` became the single
		// token `graphperformance`, which matches nothing — a search that had results silently returning zero
		// (measured against the live API: 2 vs 0). Pasted and multi-line input is the ordinary way to hit this.
		test('a control character between words separates them rather than fusing them', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { text: 'graph\nperformance', labels: ['needs\ttriage'] },
			});

			const q = String(getVariables().matched);
			assert.match(q, /graph performance/, 'both words survive as separate terms');
			assert.doesNotMatch(q, /graphperformance/);
			assert.match(q, /label:"needs triage"/, 'and inside a quoted value too');
		});

		// The separation must not cost the injection guard: splitting on whitespace happens AFTER the control
		// character became one, so a qualifier hidden behind a newline is still dropped as its own token — while the
		// legitimate word next to it now survives, which it previously did not.
		test('a qualifier hidden behind a control character is still dropped, keeping the real term', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: { text: 'crash\norg:evil' } });

			const q = String(getVariables().matched);
			assert.match(q, /crash/, "the user's actual search term is kept");
			assert.doesNotMatch(q, /org:evil/, 'the smuggled qualifier is not');
		});

		test('control characters are stripped from values', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { text: 'crash\nrepo:evil/x', milestone: 'v1\u0000' },
			});

			const q = String(getVariables().matched);
			assert.doesNotMatch(q, /\n/);
			assert.doesNotMatch(q, /repo:evil\/x/);
			assert.match(q, /milestone:"v1"/);
		});

		test('a value emptied by sanitizing is dropped, not emitted as an empty qualifier', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { labels: ['"'], milestone: '"', text: '"' },
			});

			const q = String(getVariables().matched);
			assert.doesNotMatch(q, /label:""|milestone:""/, 'GitHub would reject an empty qualifier');
		});

		// The SCOPE values are user-adjacent too, and the same drop rule has to reach them: an org or repo that
		// sanitizes away must not leave a bare `org:`/`repo:`, which GitHub rejects outright — turning a narrow
		// search into a failed request rather than a wrong one, but a failure the caller can't explain.
		test('an org or repo emptied by sanitizing is dropped rather than left bare', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, { org: '"', repos: ['"', 'o/a'] });

			const q = String(getVariables().matched);
			assert.doesNotMatch(q, /org:(\s|$)/, 'no bare org: qualifier');
			assert.doesNotMatch(q, /repo:(\s|$)/, 'no bare repo: qualifier');
			assert.match(q, /repo:o\/a/, 'the usable repo still scopes the search');
		});
	});

	test('reports the total match count so a capped read can say how many were withheld', async () => {
		const { config } = capture(19240);
		const api = new GitHubApi(config);

		const result = await api.searchIssuesPage(provider, token, { repos: ['o/a'] });

		assert.equal(result?.totalCount, 19240);
		assert.equal(result?.truncated, true, 'past the 1,000-result ceiling the read cannot return everything');
	});

	// The composite cursor keys aliases at its top level, next to `page` and `truncated`, so an alias colliding
	// with either would overwrite it — and silently: the page number becomes a cursor string, reads back as page 1,
	// and the walk restarts with no error and no truncation flag. Reachable only by adding a relationship whose
	// alias is one of those names, so the guard is what makes that a build/test failure instead of a data bug.
	test('refuses an alias that collides with the cursor’s reserved keys', async () => {
		const { config } = capture();
		const api = new GitHubApi(config);
		const searchIssuesByAlias = (
			api as unknown as {
				searchIssuesByAlias: (
					p: unknown,
					t: unknown,
					searches: { alias: string; query: string }[],
				) => Promise<unknown>;
			}
		).searchIssuesByAlias.bind(api);

		for (const alias of ['page', 'truncated']) {
			await assert.rejects(
				() => searchIssuesByAlias(provider, token, [{ alias: alias, query: 'repo:o/a' }]),
				/reserved keys/,
				`'${alias}' must be refused`,
			);
		}
	});

	test('a count within the ceiling is not reported as truncated', async () => {
		const { config } = capture(999);
		const api = new GitHubApi(config);

		const result = await api.searchIssuesPage(provider, token, { repos: ['o/a'] });

		assert.equal(result?.totalCount, 999);
		assert.equal(result?.truncated, false);
	});

	/**
	 * The capability table (`ProviderMetadata.supportedIssueSearch`) is a PROMISE that every criterion it lists
	 * reaches the provider query. Nothing else enforces that: a criterion silently dropped by the builder would
	 * still be declared supported, the read would return a wider set than asked for, and neither the result shape
	 * nor a type error would say so.
	 *
	 * So this drives every declared criterion through the builder and asserts the query CHANGED. It deliberately
	 * doesn't assert which qualifier appeared — the per-criterion tests above pin the exact syntax; this one's job
	 * is to fail when the table and the implementation drift apart.
	 */
	test('every criterion GitHub declares supported reaches the query', async () => {
		// One sample value per criterion, keyed by its capability flag. Kept here rather than imported so a
		// criterion added to the model without a value here is visible as a missing case.
		const samples: [keyof IssueSearchCriteria, IssueSearchCriteria][] = [
			['text', { text: 'crash' }],
			['labels', { labels: ['bug'] }],
			['milestone', { milestone: 'v1' }],
			['updatedAfter', { updatedAfter: '2026-05-05' }],
			['createdAfter', { createdAfter: '2026-01-01' }],
			['withoutLinkedPullRequest', { withoutLinkedPullRequest: true }],
			['state', { state: 'closed' }],
			['includeArchived', { includeArchived: true }],
			['relationships', { relationships: ['any-assignee'] }],
		];

		const { config, getVariables, getQuery } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'] });
		const baseline = String(getVariables().matched);

		for (const [criterion, criteria] of samples) {
			await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: criteria });
			// The relationship case renames the alias, so read whichever search the document declared.
			const alias = Array.from(getQuery().matchAll(/^\s*(\w+): search\(/gm), m => m[1])[0];
			assert.notEqual(
				String(getVariables()[alias]),
				baseline,
				`\`${criterion}\` is declared supported but did not change the emitted query`,
			);
		}
	});
});

suite('GitHubApi.countIssues', () => {
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

	function capture(counts: number[]): {
		config: GitHubApiConfig;
		getQuery: () => string;
		getVariables: () => Record<string, unknown>;
		getRequestCount: () => number;
	} {
		let query = '';
		let variables: Record<string, unknown> = {};
		let requests = 0;
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				requests++;
				const body = JSON.parse(init?.body ?? '{}') as {
					query?: string;
					variables?: Record<string, unknown>;
				};
				query = body.query ?? '';
				variables = body.variables ?? {};
				const data = Object.fromEntries(counts.map((c, i) => [`s${i}`, { issueCount: c }]));
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		return {
			config: config,
			getQuery: () => query,
			getVariables: () => variables,
			getRequestCount: () => requests,
		};
	}

	test('counts several scopes in one request, transferring no issues', async () => {
		const { config, getQuery, getRequestCount } = capture([111, 133]);
		const api = new GitHubApi(config);

		const counts = await api.countIssues(provider, token, [{ repos: ['o/a'] }, { repos: ['o/b'] }]);

		assert.deepEqual(counts, [111, 133], 'counts come back positionally, one per scope');
		assert.equal(getRequestCount(), 1, 'both scopes share a single request');
		// `first: 0` is what makes the probe cheap; a node selection would defeat its entire purpose.
		assert.match(getQuery(), /first: 0/);
		assert.doesNotMatch(getQuery(), /nodes/, 'no issue data is requested');
	});

	test('generates its own aliases, never deriving them from caller-controlled values', async () => {
		const { config, getQuery } = capture([1]);
		const api = new GitHubApi(config);

		await api.countIssues(provider, token, [{ org: 'acme' }]);

		const aliases = Array.from(getQuery().matchAll(/(\w+): search\(/g), m => m[1]);
		assert.deepEqual(aliases, ['s0'], 'positional and generated, so no caller text can break the document');
	});

	// The count only means anything if it applies the SAME qualifiers the search would — a count under different
	// constraints is a wrong number, not a missing one. Both go through one scope builder; this pins that, so a
	// change to either side that doesn't reach the other fails here.
	test('emits the same scope qualifiers as the search it previews', async () => {
		let searchQuery = '';
		const searchConfig: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { variables?: { matched?: string } };
				searchQuery = body.variables?.matched ?? '';
				return new Response(
					JSON.stringify({
						data: {
							matched: { issueCount: 0, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] },
						},
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				);
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		await new GitHubApi(searchConfig).searchIssuesPage(provider, token, { org: 'acme', repos: ['o/a', 'o/b'] });

		const { config, getVariables } = capture([1]);
		await new GitHubApi(config).countIssues(provider, token, [{ org: 'acme', repos: ['o/a', 'o/b'] }]);

		assert.equal(String(getVariables().q0), searchQuery);
	});

	test('applies the same criteria as the read it previews', async () => {
		const { config, getVariables } = capture([42]);
		const api = new GitHubApi(config);

		await api.countIssues(provider, token, [
			{ repos: ['o/a'], criteria: { relationships: ['unassigned'], updatedAfter: '2026-05-05' } },
		]);

		const q = String(getVariables().q0);
		assert.match(q, /repo:o\/a/);
		assert.match(q, /no:assignee/);
		assert.match(q, /updated:>=2026-05-05/);
	});

	test('an empty scope list makes no request', async () => {
		const { config, getRequestCount } = capture([]);
		const api = new GitHubApi(config);

		assert.deepEqual(await api.countIssues(provider, token, []), []);
		assert.equal(getRequestCount(), 0);
	});

	test('an alias the response omits is undefined, not zero', async () => {
		// Only `s0` comes back; `s1` is missing, which means "not reported" and must not read as no matches.
		const { config } = capture([7]);
		const api = new GitHubApi(config);

		const counts = await api.countIssues(provider, token, [{ repos: ['o/a'] }, { repos: ['o/b'] }]);

		assert.deepEqual(counts, [7, undefined]);
	});
});

// GitHub documents "a `403` or `429` response" for BOTH its primary and secondary rate limits
// (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). Only 403 was handled: `case 429`
// was commented out, so a throttled request fell through to the generic 4xx branch and surfaced as a
// `RequestClientError`. Downstream that reads as a generic failure rather than a retryable throttle — it drops
// the "temporary" framing and, in consumers that hold a snapshot on retryable failures, discards a good one.
