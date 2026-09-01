import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { IssueSearchCriteria, IssueSearchRelationship, IssueSorting } from '@gitlens/git/models/issue.js';
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

/**
 * Answers each alias the document declared with its own nodes, so a merged page's ordering is observable.
 *
 * `hasNextPage` makes every alias claim another page and hand back `<alias>-next`, which is what the cursor tests
 * need: they assert what gets threaded back, so they need a continuation to thread and no nodes at all.
 */
function serve(
	nodesByAlias: Record<string, unknown[]>,
	options?: { hasNextPage?: boolean },
): { config: GitHubApiConfig; getVariables: () => Record<string, unknown> } {
	let variables: Record<string, unknown> = {};
	const hasNextPage = options?.hasNextPage ?? false;
	const config: GitHubApiConfig = {
		isWeb: false,
		fetch: async (_url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as {
				query?: string;
				variables?: Record<string, unknown>;
			};
			variables = body.variables ?? {};
			const aliases = Array.from((body.query ?? '').matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
			const data = Object.fromEntries(
				aliases.map(alias => {
					const nodes = nodesByAlias[alias] ?? [];
					return [
						alias,
						{
							issueCount: nodes.length,
							pageInfo: {
								endCursor: hasNextPage ? `${alias}-next` : null,
								hasNextPage: hasNextPage,
							},
							nodes: nodes,
						},
					];
				}),
			);
			return new Response(JSON.stringify({ data: data }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		},
		wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
	} as unknown as GitHubApiConfig;
	return { config: config, getVariables: () => variables };
}

suite('GitHubApi.searchIssuesPage', () => {
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

		// The control-character rule must not spill onto ordinary punctuation: a hyphen is part of a repository
		// path, a label and a version, and turning one into a space would silently re-target the search
		// (`repo:gitkraken/vscode-gitlens` → `repo:gitkraken/vscode gitlens`, which matches nothing).
		test('leaves ordinary punctuation in a scope or value untouched', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['gitkraken/vscode-gitlens'],
				criteria: { milestone: 'v1.0-rc1', labels: ['needs-triage'] },
			});

			const q = String(getVariables().matched);
			assert.match(q, /repo:gitkraken\/vscode-gitlens/);
			assert.match(q, /milestone:"v1\.0-rc1"/);
			assert.match(q, /label:"needs-triage"/);
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

	// An exhausted alias is recorded as a `null` cursor slot, and that slot has to SURVIVE re-serialization on
	// every subsequent page — the cursor is rebuilt from scratch each time. Dropping the slot instead would make
	// the alias read as "never requested", which re-includes it and re-emits its FIRST page: duplicate issues
	// appearing several pages after the search that produced them. Page 2 alone can't catch that; the regression
	// only shows up once a page is built from a cursor that itself carried a null slot.
	test('an alias exhausted on page 1 stays excluded on page 3, not just page 2', async () => {
		const requests: Record<string, unknown>[] = [];
		let page = 0;
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { variables?: Record<string, unknown> };
				requests.push(body.variables ?? {});
				page++;
				// `authored` is exhausted immediately; `assigned` keeps paging.
				const data: Record<string, unknown> = {
					assigned: {
						issueCount: 5,
						pageInfo: { endCursor: `assigned-${page}`, hasNextPage: page < 3 },
						nodes: [],
					},
				};
				if (page === 1) {
					data.authored = { issueCount: 1, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] };
				}
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		const api = new GitHubApi(config);

		const criteria: IssueSearchCriteria = { relationships: ['assigned', 'authored'] };
		const p1 = await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: criteria });
		const p2 = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: criteria,
			cursor: p1?.cursor,
		});
		const p3 = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: criteria,
			cursor: p2?.cursor,
		});

		assert.equal(requests.length, 3);
		assert.equal(requests[1].includeAuthored, false, 'page 2 excludes the exhausted alias');
		assert.equal(requests[2].includeAuthored, false, 'and so does page 3, built from a cursor that carried it');
		assert.equal(requests[2].includeAssigned, true, 'while the live alias keeps advancing');
		assert.equal(requests[2].assignedCursor, 'assigned-2');
		assert.equal(p3?.page, 3);
	});

	// A consumer can persist a cursor and then change its filters — the criteria are UI state. A cursor carrying
	// slots for aliases the new search doesn't request must not resurrect them, and slots the new search does
	// request must still be honored. Nothing rejects a mismatched cursor, so this is the behavior that matters.
	test('a cursor from a wider search neither resurrects dropped relationships nor loses the kept one', async () => {
		const requests: Record<string, unknown>[] = [];
		let page = 0;
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { variables?: Record<string, unknown> };
				requests.push(body.variables ?? {});
				page++;
				const live = { issueCount: 5, pageInfo: { endCursor: `c-${page}`, hasNextPage: true }, nodes: [] };
				return new Response(JSON.stringify({ data: { assigned: live, authored: live } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		const api = new GitHubApi(config);

		const wide = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: ['assigned', 'authored'] },
		});
		// Same cursor, but the caller has since narrowed to one relationship.
		await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: ['assigned'] },
			cursor: wide?.cursor,
		});

		const narrowed = requests[1];
		assert.equal(narrowed.includeAssigned, true, 'the still-requested relationship runs');
		assert.equal(narrowed.assignedCursor, 'c-1', 'and resumes from where it left off');
		assert.equal(
			narrowed.includeAuthored,
			undefined,
			'the dropped relationship is absent from the document entirely, not re-run from its first page',
		);
	});

	test('reports the total match count so a capped read can say how many were withheld', async () => {
		const { config } = capture(19240);
		const api = new GitHubApi(config);

		const result = await api.searchIssuesPage(provider, token, { repos: ['o/a'] });

		assert.equal(result?.totalCount, 19240);
		assert.equal(result?.truncated, true, 'past the 1,000-result ceiling the read cannot return everything');
	});

	// The composite cursor keys aliases at its top level, next to `page`, `truncated` and `sort`, so an alias
	// colliding with one of them would overwrite it — and silently: the page number becomes a cursor string, reads back as page 1,
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

		for (const alias of ['page', 'truncated', 'sort']) {
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

suite('GitHubApi.searchIssuesPage ordering', () => {
	/** One GraphQL issue node, minimal but complete enough for `fromGitHubIssue` to map it. */
	function node(id: string, fields: { updatedAt?: string; createdAt?: string; comments?: number }) {
		return {
			id: id,
			number: 1,
			title: id,
			url: `https://github.com/o/a/issues/${id}`,
			createdAt: fields.createdAt ?? '2020-01-01T00:00:00Z',
			updatedAt: fields.updatedAt ?? '2020-01-01T00:00:00Z',
			closedAt: null,
			closed: false,
			state: 'OPEN',
			author: null,
			assignees: { nodes: [] },
			comments: { totalCount: fields.comments ?? 0 },
			reactions: { totalCount: 0 },
			repository: { name: 'a', owner: { login: 'o' }, url: 'https://github.com/o/a' },
		};
	}

	// The default has to stay byte-identical, not merely equivalent: `sort:updated` and `sort:updated-desc` are the
	// same query to GitHub, but every exact-query assertion in this file (and any recorded fixture) pins the former.
	test('an omitted sort emits exactly the query it emitted before ordering was an option', async () => {
		const { config, getVariables } = serve({});
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'] });

		assert.strictEqual(String(getVariables().matched), 'repo:o/a type:issue is:open archived:false sort:updated');
	});

	const sorts: [sort: IssueSorting, qualifier: string][] = [
		['created:asc', 'sort:created-asc'],
		['created:desc', 'sort:created-desc'],
		['updated:asc', 'sort:updated-asc'],
		['updated:desc', 'sort:updated'],
		['comments:asc', 'sort:comments-asc'],
		['comments:desc', 'sort:comments-desc'],
		// The per-emoji form, not the bare `sort:reactions`: the bare one orders by the total across every reaction
		// type, while `IssueShape.thumbsUpCount` — the number this client actually carries, and the one the merge
		// comparator reads — is thumbs-up only. See `gitHubIssueSortQualifiers`.
		['reactions:asc', 'sort:reactions-+1-asc'],
		['reactions:desc', 'sort:reactions-+1-desc'],
	];

	for (const [sort, qualifier] of sorts) {
		test(`translates ${sort} to its own qualifier`, async () => {
			const { config, getVariables } = serve({});
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: { sort: sort } });

			const q = String(getVariables().matched);
			assert.strictEqual(q, `repo:o/a type:issue is:open archived:false ${qualifier}`);
		});
	}

	// Each alias arrives ordered by the server; their concatenation does not, which is what this fixes. Without the
	// merge sort the page would read b1, b2, a1 — ordered within each alias and in no order across them.
	test('orders the merged page across relationships, not just within each one', async () => {
		const { config } = serve({
			assigned: [node('a1', { updatedAt: '2020-01-02T00:00:00Z' })],
			authored: [
				node('b1', { updatedAt: '2020-01-03T00:00:00Z' }),
				node('b2', { updatedAt: '2020-01-01T00:00:00Z' }),
			],
		});
		const api = new GitHubApi(config);

		const result = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: ['assigned', 'authored'] },
		});

		assert.deepEqual(
			result?.values.map(i => i.title),
			['b1', 'a1', 'b2'],
		);
	});

	test('orders by the requested key, not only by updated date', async () => {
		const { config } = serve({
			assigned: [node('few', { comments: 1 })],
			authored: [node('many', { comments: 9 })],
		});
		const api = new GitHubApi(config);

		const result = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: ['assigned', 'authored'], sort: 'comments:desc' },
		});

		assert.deepEqual(
			result?.values.map(i => i.title),
			['many', 'few'],
		);
	});

	// Continuations exhaust aliases one at a time, so a later page of a multi-relationship walk can come from ONE
	// surviving search — already ordered by the server. Re-sorting it could only reproduce that order, and would
	// hide a provider that ignored the qualifier, so the page is left exactly as it arrived. Guarding on
	// `searches.length` instead of the active count is what would re-sort it.
	test('leaves a page whose other relationships are exhausted in the order the server returned', async () => {
		const { config } = serve({
			authored: [
				node('out-of-order', { updatedAt: '2020-01-01T00:00:00Z' }),
				node('newer', { updatedAt: '2020-01-03T00:00:00Z' }),
			],
		});
		const api = new GitHubApi(config);

		// `assigned` exhausted (a `null` slot), `authored` still walking: one active search out of two.
		const cursor = JSON.stringify({ page: 2, sort: 'updated:desc', assigned: null, authored: 'authored-next' });
		const result = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: ['assigned', 'authored'], sort: 'updated:desc' },
			cursor: cursor,
		});

		assert.deepEqual(
			result?.values.map(i => i.title),
			['out-of-order', 'newer'],
			'a single-query page is published as the provider ordered it',
		);
	});

	// The merge sort runs AFTER the dedupe, and this is why: the alias order is also the dedupe's precedence, so
	// sorting first would hand `uniqueBy` a different first occurrence and change which copy survives. Both aliases
	// return the same url with different titles, so which one is kept is observable.
	test('keeps the alias precedence of the dedupe when it orders the page', async () => {
		const shared = { updatedAt: '2020-01-01T00:00:00Z' };
		const fromAssigned = { ...node('assigned-copy', shared), url: 'https://github.com/o/a/issues/1' };
		const fromAuthored = { ...node('authored-copy', shared), url: 'https://github.com/o/a/issues/1' };
		const { config } = serve({ assigned: [fromAssigned], authored: [fromAuthored] });
		const api = new GitHubApi(config);

		const result = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: ['assigned', 'authored'], sort: 'updated:desc' },
		});

		assert.deepEqual(
			result?.values.map(i => i.title),
			['assigned-copy'],
			'the assigned copy still wins, as `searchMyIssues` documents',
		);
	});
});

suite('GitHubApi issue-search cursor ordering fingerprint', () => {
	/** Always claims another page, so every call yields a cursor to resume from. */
	const pagingConfig = () => serve({}, { hasNextPage: true });

	test('resumes under the same sort, threading the provider continuation', async () => {
		const { config, getVariables } = pagingConfig();
		const api = new GitHubApi(config);

		const first = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { sort: 'created:desc' },
		});
		const second = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { sort: 'created:desc' },
			cursor: first?.cursor,
		});

		assert.strictEqual(getVariables().matchedCursor, 'matched-next', 'the continuation was threaded');
		assert.strictEqual(second?.page, 2);
	});

	// Resuming a differently-ordered walk would re-emit rows already seen and skip rows never seen, with nothing in
	// the result to say so. Refused rather than silently restarted: this read is cursor-only, so the facade echoes
	// the `page` supplied alongside the cursor, and page 1's rows would then be published as page N.
	test('refuses a cursor produced under a different sort instead of resuming into a different order', async () => {
		const { config, getVariables } = pagingConfig();
		const api = new GitHubApi(config);

		const first = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { sort: 'created:desc' },
		});
		await assert.rejects(
			() =>
				api.searchIssuesPage(provider, token, {
					repos: ['o/a'],
					criteria: { sort: 'updated:desc' },
					cursor: first?.cursor,
				}),
			/produced under sort 'created:desc'/,
		);

		// Still the FIRST call's variables: a resumed read would have threaded `matched-next`, so an unset cursor
		// proves the refusal happened before any request went out.
		assert.strictEqual(getVariables().matchedCursor, undefined, 'the refusal costs no request at all');
	});

	// Absent is not "unknown order": this read always emitted `sort:updated`, so a legacy cursor is a walk under
	// `updated:desc` and asking for another key is the same mismatch as any other — accepting it would resume each
	// alias inside a re-ordered result set, which is what the fingerprint exists to stop.
	test('reads a legacy cursor as the order this read used to emit, and refuses another key against it', async () => {
		const { config, getVariables } = pagingConfig();
		const api = new GitHubApi(config);

		const legacy = JSON.stringify({ page: 4, matched: 'matched-next' });
		await assert.rejects(
			() =>
				api.searchIssuesPage(provider, token, {
					repos: ['o/a'],
					criteria: { sort: 'created:desc' },
					cursor: legacy,
				}),
			/produced under sort 'updated:desc'/,
		);

		assert.strictEqual(getVariables().matchedCursor, undefined, 'and it costs no request');
	});

	// `searchMyIssues`'s legacy order is a DIFFERENT one — it emitted no qualifier at all, so its old cursors are
	// relevance-ordered walks. The facade now resolves an omitted key to `updated:desc` and forwards it, so this
	// is the live path: a cursor a consumer persisted before the change, threaded through a query that gained an
	// order it did not have.
	test('reads a legacy `searchMyIssues` cursor as relevance-ordered, refusing a key against it and resuming with none', async () => {
		const { config, getVariables } = pagingConfig();
		const api = new GitHubApi(config);

		const legacy = JSON.stringify({ page: 4, assigned: 'assigned-next' });
		await assert.rejects(
			() =>
				api.searchMyIssues(provider, token, {
					repos: ['o/a'],
					categories: { assigned: true },
					sort: 'updated:desc',
					cursor: legacy,
				}),
			/produced under sort 'unsorted'/,
		);
		assert.strictEqual(getVariables().assignedCursor, undefined, 'the refusal costs no request');

		const resumed = await api.searchMyIssues(provider, token, {
			repos: ['o/a'],
			categories: { assigned: true },
			cursor: legacy,
		});

		assert.strictEqual(getVariables().assignedCursor, 'assigned-next', 'and asking for no order still resumes');
		assert.strictEqual(resumed?.page, 4);
	});

	// A key with a comparator but no GitHub qualifier would emit no `sort:` at all, leaving every alias in
	// relevance order, and the union would then be sorted by it — an arbitrary subset presented as ordered.
	// Unreachable through the facade, which never declares such a key; this is the direct caller's guard.
	test('refuses a key GitHub cannot express rather than sorting an unordered union by it', async () => {
		const { config, getVariables } = pagingConfig();
		const api = new GitHubApi(config);

		await assert.rejects(
			() =>
				api.searchMyIssues(provider, token, {
					repos: ['o/a'],
					categories: { assigned: true },
					sort: 'title:desc',
				}),
			/cannot order an issue search by 'title:desc'/,
		);

		assert.deepEqual(getVariables(), {}, 'and nothing was requested');
	});

	// A cursor persisted before this field existed carries no fingerprint. Treating absent as a mismatch would
	// restart every walk a consumer had already saved, which is the one case the field is meant to protect.
	test('resumes a cursor that predates the fingerprint rather than restarting it', async () => {
		const { config, getVariables } = pagingConfig();
		const api = new GitHubApi(config);

		const legacy = JSON.stringify({ page: 4, matched: 'matched-next' });
		const result = await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { sort: 'updated:desc' },
			cursor: legacy,
		});

		assert.strictEqual(getVariables().matchedCursor, 'matched-next', 'the old continuation was honored');
		assert.strictEqual(result?.page, 4);
		assert.ok(result.cursor != null);
		assert.strictEqual(
			(JSON.parse(result.cursor) as { sort?: string }).sort,
			'updated:desc',
			'and the cursor it hands back is sealed with the current key',
		);
	});
});

/**
 * The CEILING SLIDE (#5805): GitHub caps a search at 1,000 results PER QUERY, so a walk that runs out of pages
 * against a capped query continues by re-issuing the search bounded to the far side of the last item served.
 * That turns the ceiling from terminal into continuable while keeping ONE query per page, so the order across
 * the whole read stays the provider's.
 */
suite('GitHubApi.searchIssuesPage ceiling slide (#5805)', () => {
	/** A capped result: `issueCount` over the limit, and a terminal page (nothing left to page to). */
	function cappedServe(nodes: unknown[], count = 1500) {
		let variables: Record<string, unknown> = {};
		const config = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { query?: string; variables?: Record<string, unknown> };
				variables = body.variables ?? {};
				const aliases = Array.from((body.query ?? '').matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
				return new Response(
					JSON.stringify({
						data: Object.fromEntries(
							aliases.map(a => [
								a,
								{ issueCount: count, pageInfo: { endCursor: null, hasNextPage: false }, nodes: nodes },
							]),
						),
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				);
			},
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		return { config: config, getVariables: () => variables };
	}

	/** One GraphQL issue node, complete enough for `fromGitHubIssue` to map it (a partial node maps to
	 * nothing, which would silently make every page below empty and every assertion vacuous). */
	const issue = (n: number, updatedAt: string) => ({
		id: `i${n}`,
		number: n,
		title: `issue ${n}`,
		url: `https://github.com/acme/repo/issues/${n}`,
		createdAt: updatedAt,
		updatedAt: updatedAt,
		closedAt: null,
		closed: false,
		state: 'OPEN',
		author: null,
		assignees: { nodes: [] },
		comments: { totalCount: 0 },
		reactions: { totalCount: 0 },
		repository: { name: 'repo', owner: { login: 'acme' }, url: 'https://github.com/acme/repo' },
	});

	test('a capped, page-exhausted walk continues with an inclusive boundary instead of reporting the ceiling', async () => {
		const { config } = cappedServe([issue(1, '2026-05-01T10:00:00Z'), issue(2, '2026-04-01T09:30:00Z')]);
		const api = new GitHubApi(config);

		const page = await api.searchIssuesPage(provider, token, { org: 'acme' });

		assert.equal(page?.truncated, false, 'a slidable ceiling is forward progress, not incompleteness');
		assert.equal(page?.hasMore, true, 'the remainder is reachable');
		assert.ok(page?.cursor != null);
		// Per-alias keys: aliases slide independently, so one shared bound would sit below where an
		// early-finishing alias stopped and re-serve what it had already delivered.
		const cursor = JSON.parse(page.cursor) as Record<string, unknown>;
		// INCLUSIVE (`<=`): GitHub timestamps are second-resolution and ties occur, so an exclusive bound would
		// silently drop every issue sharing the boundary second with the last one served.
		assert.equal(
			cursor['slide:matched'],
			'updated:<=2026-04-01T09:30:00Z',
			'bounded at the last item served, inclusive',
		);
		assert.equal(
			cursor['slideSeen:matched'],
			'https://github.com/acme/repo/issues/2',
			'the boundary second it re-serves is carried so the next page can drop it',
		);
	});

	test('the slid query carries the boundary and drops what the boundary second already served', async () => {
		const boundary = issue(2, '2026-04-01T09:30:00Z');
		const { config, getVariables } = cappedServe([boundary, issue(3, '2026-03-01T08:00:00Z')], 10);
		const api = new GitHubApi(config);

		const cursor = JSON.stringify({
			page: 2,
			sort: 'updated:desc',
			'slide:matched': 'updated:<=2026-04-01T09:30:00Z',
			'slideSeen:matched': boundary.url,
		});
		const page = await api.searchIssuesPage(provider, token, { org: 'acme', cursor: cursor });

		assert.match(
			String(getVariables().matched),
			/updated:<=2026-04-01T09:30:00Z/,
			'the continuation re-issues the search bounded to the far side of what was served',
		);
		assert.deepEqual(
			page?.values.map(v => v.url),
			['https://github.com/acme/repo/issues/3'],
			'the re-served boundary issue is dropped, so the walk emits no duplicate',
		);
	});

	test('a capped walk with pages remaining is not yet marked truncated', async () => {
		// The slide happens once the walk runs OUT of pages. Marking `truncated` earlier would seal it into the
		// cursor and keep it there for the rest of the read: a completed walk reporting omitted results it fetched.
		const { config } = serve({ matched: [issue(1, '2026-05-01T10:00:00Z')] }, { hasNextPage: true });
		const api = new GitHubApi(config);

		const page = await api.searchIssuesPage(provider, token, { org: 'acme' });

		assert.equal(page?.hasMore, true);
		assert.equal(page?.truncated, false, 'nothing is omitted while the walk can still page forward');
	});

	test('an unslidable sort key still reports the ceiling rather than continuing', async () => {
		// `comments` has a GitHub range qualifier, but its value moves under concurrent activity: an issue that
		// gains a comment mid-walk crosses the boundary and is dropped or repeated. Reporting the ceiling is the
		// honest answer there.
		const { config } = cappedServe([issue(1, '2026-05-01T10:00:00Z')]);
		const api = new GitHubApi(config);

		const page = await api.searchIssuesPage(provider, token, {
			org: 'acme',
			criteria: { sort: 'comments:desc' },
		});

		assert.equal(page?.truncated, true, 'an unreachable remainder is still reported as omitted');
		assert.equal(page?.hasMore, false, 'and never advertised as continuable');
	});

	test('a foreign or malformed slide in a cursor is ignored rather than injected into the query', async () => {
		// The slide is caller-supplied data on a round trip, so it is validated against the exact shape this
		// emits: anything else restarts the walk instead of reaching the query.
		const { config, getVariables } = cappedServe([issue(1, '2026-05-01T10:00:00Z')], 10);
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, {
			org: 'acme',
			cursor: JSON.stringify({ page: 2, sort: 'updated:desc', 'slide:matched': 'org:evil-corp' }),
		});

		const query = String(getVariables().matched);
		assert.ok(!query.includes('evil-corp'), 'an unrecognized slide never reaches the query');
		assert.match(query, /org:acme/, 'the caller-supplied scope is the only one applied');
	});
});

/**
 * The ceiling slide against a FAITHFUL provider: a fixture that honours the date bound, the per-query cap and
 * cursor paging, so a walk can actually be driven to completion and its result checked as a whole.
 *
 * The cases below are the ones that broke a first implementation. Each is a property of the WALK (no duplicates,
 * no gaps, one order) rather than of a single response, and none of them is observable from one page.
 */
suite('GitHubApi.searchIssuesPage ceiling slide, end to end (#5805)', () => {
	const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

	function node(id: string, updatedAt: string) {
		return {
			id: id,
			number: 1,
			title: id,
			url: `https://github.com/o/a/issues/${id}`,
			createdAt: updatedAt,
			updatedAt: updatedAt,
			closedAt: null,
			closed: false,
			state: 'OPEN',
			author: null,
			assignees: { nodes: [] },
			comments: { totalCount: 0 },
			reactions: { totalCount: 0 },
			repository: { name: 'a', owner: { login: 'o' }, url: 'https://github.com/o/a' },
		};
	}

	/** A provider that applies the emitted `updated:` bound, caps each query, and pages. */
	function faithful(corpusByAlias: Record<string, ReturnType<typeof node>[]>, cap = 1000, pageSize = 100) {
		return {
			isWeb: false,
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as {
					query?: string;
					variables?: Record<string, string | boolean | undefined>;
				};
				const aliases = Array.from((body.query ?? '').matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
				const data: Record<string, unknown> = {};
				for (const alias of aliases) {
					const q = body.variables?.[alias];
					if (typeof q !== 'string') continue;

					let items = (corpusByAlias[alias] ?? []).slice();
					const le = /updated:<=(\S+)/.exec(q);
					const ge = /updated:>=(\S+)/.exec(q);
					if (le != null) {
						items = items.filter(i => i.updatedAt <= le[1]);
					}
					if (ge != null) {
						items = items.filter(i => i.updatedAt >= ge[1]);
					}
					const asc = q.includes('sort:updated-asc');
					items.sort((a, b) =>
						asc ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt),
					);
					const total = items.length;
					const reachable = items.slice(0, cap);
					const after = body.variables?.[`${alias}Cursor`];
					const start = typeof after === 'string' ? Number(after.split(':')[1]) : 0;
					const on = body.variables?.[`include${alias[0].toUpperCase()}${alias.slice(1)}`] !== false;
					const slice = on ? reachable.slice(start, start + pageSize) : [];
					const next = start + slice.length;
					const hasNextPage = on && next < reachable.length;
					data[alias] = {
						issueCount: total,
						pageInfo: { endCursor: hasNextPage ? `${alias}:${next}` : null, hasNextPage: hasNextPage },
						nodes: slice,
					};
				}
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		} as unknown as GitHubApiConfig;
	}

	async function drain(api: GitHubApi, options: Parameters<GitHubApi['searchIssuesPage']>[2]) {
		const urls: string[] = [];
		const dates: number[] = [];
		let cursor: string | undefined;
		let truncated = false;
		for (let page = 1; page <= 80; page++) {
			const r = await api.searchIssuesPage(provider, token, { ...options, cursor: cursor });
			truncated = r?.truncated ?? false;
			for (const v of r?.values ?? []) {
				urls.push(v.url);
				dates.push(v.updatedDate?.getTime() ?? 0);
			}
			if (r?.hasMore !== true || r.cursor == null) break;

			cursor = r.cursor;
		}
		let inversions = 0;
		for (let i = 1; i < dates.length; i++) {
			if (dates[i] > dates[i - 1]) {
				inversions++;
			}
		}
		return { urls: urls, distinct: new Set(urls).size, inversions: inversions, truncated: truncated };
	}

	const spread = (n: number, prefix = 'N', from = Date.UTC(2026, 0, 1)) =>
		Array.from({ length: n }, (_, i) => node(`${prefix}${i}`, iso(from - i * 3_600_000)));

	test('a walk past the ceiling is complete, duplicate-free and in one order', async () => {
		const corpus = spread(1205);
		const api = new GitHubApi(faithful({ matched: corpus }));

		const { urls, distinct, inversions, truncated } = await drain(api, { org: 'o' });

		assert.equal(distinct, corpus.length, 'every matching issue is served');
		assert.equal(urls.length, distinct, 'and none of them twice');
		assert.equal(inversions, 0, 'the whole walk stays in the requested order');
		assert.equal(truncated, false, 'nothing was omitted, so nothing is reported as omitted');
	});

	test('a walk needing several slides still completes', async () => {
		const corpus = spread(2600);
		const api = new GitHubApi(faithful({ matched: corpus }));

		const { urls, distinct, inversions } = await drain(api, { org: 'o' });

		assert.equal(distinct, corpus.length);
		assert.equal(urls.length, distinct);
		assert.equal(inversions, 0);
	});

	test('an ascending walk slides the other way', async () => {
		// `updated:asc` walks toward newer, so the remainder is everything at or AFTER the boundary. Emitting
		// `<=` here would re-request the half already served, forever.
		const corpus = spread(1205);
		const api = new GitHubApi(faithful({ matched: corpus }));

		const { urls, distinct } = await drain(api, { org: 'o', criteria: { sort: 'updated:asc' } });

		assert.equal(distinct, corpus.length);
		assert.equal(urls.length, distinct);
	});

	test('a tied block spanning several pages is not re-served after the slide', async () => {
		// A bulk edit stamps hundreds of issues with ONE second. When that block straddles the cap it covers more
		// than one page, so the set of urls already served at the boundary has to accumulate across pages rather
		// than be rebuilt from the last one.
		const tie = iso(Date.UTC(2025, 5, 1));
		const corpus = [
			...spread(800),
			...Array.from({ length: 400 }, (_, i) => node(`T${i}`, tie)),
			...spread(50, 'O', Date.UTC(2024, 0, 1)),
		];
		const api = new GitHubApi(faithful({ matched: corpus }));

		const { urls, distinct } = await drain(api, { org: 'o' });

		assert.equal(distinct, corpus.length, 'the tied block is served in full');
		assert.equal(urls.length, distinct, 'and no part of it twice');
	});

	test('a union of relationships slides each alias at its OWN boundary', async () => {
		// Aliases exhaust independently, so one bound shared across the page would sit below where an
		// early-finishing alias stopped and re-serve everything it had already delivered. Bounding each alias at
		// its own last item is what makes a capped union both complete and duplicate-free: `authored` is capped
		// and slides, `assigned` finishes in one page and never does.
		const authored = spread(1200, 'A');
		const assigned = Array.from({ length: 5 }, (_, i) =>
			node(`B${i}`, iso(Date.UTC(2026, 0, 1) - (i * 400 + 50) * 3_600_000)),
		);
		const api = new GitHubApi(faithful({ authored: authored, assigned: assigned }));

		const { urls, distinct, truncated } = await drain(api, {
			org: 'o',
			criteria: { relationships: ['authored', 'assigned'] },
		});

		assert.equal(distinct, authored.length + assigned.length, 'both relationships are served in full');
		assert.equal(urls.length, distinct, 'and a union never double-serves');
		assert.equal(truncated, false, 'nothing is left unreachable, so nothing is reported as omitted');
	});

	test('a union where BOTH relationships are capped slides both', async () => {
		const authored = spread(1150, 'A');
		// Offset by half an hour so the two never share a timestamp: distinct boundaries, slid independently.
		const assigned = Array.from({ length: 1150 }, (_, i) =>
			node(`B${i}`, iso(Date.UTC(2026, 0, 1) - i * 3_600_000 - 1_800_000)),
		);
		const api = new GitHubApi(faithful({ authored: authored, assigned: assigned }));

		const { urls, distinct, truncated } = await drain(api, {
			org: 'o',
			criteria: { relationships: ['authored', 'assigned'] },
		});

		assert.equal(distinct, authored.length + assigned.length);
		assert.equal(urls.length, distinct);
		assert.equal(truncated, false);
		// Deliberately NOT asserting global ordering here. A union is ordered within a page but only per alias
		// across pages, and whether that shows up depends on the aliases' relative density: two evenly-matched
		// ones advance in step and look ordered, uneven ones do not. That is a property of the union and predates
		// the slide, so pinning it either way here would pin an accident of the fixture.
	});

	test('a bound that does nothing stops the walk instead of looping forever', async () => {
		// Defence in depth, not a reachable state: against a provider that honours the bound no walk repeats one
		// (a tied block larger than the cap terminates on its own, covered above). But a slide that silently did
		// nothing would be an unbounded request loop rather than a wrong answer, and this read pages until the
		// provider says stop, so the repeat is caught and reported as the ceiling it is.
		const items = spread(120, 'I');
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as {
					query?: string;
					variables?: Record<string, string | boolean | undefined>;
				};
				const aliases = Array.from((body.query ?? '').matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
				const data = Object.fromEntries(
					aliases.map(alias => {
						const after = body.variables?.[`${alias}Cursor`];
						const start = typeof after === 'string' ? Number(after.split(':')[1]) : 0;
						// The `updated:` bound is deliberately ignored here.
						const slice = items.slice(start, start + 100);
						const next = start + slice.length;
						return [
							alias,
							{
								issueCount: 5000,
								pageInfo: {
									endCursor: next < items.length ? `${alias}:${next}` : null,
									hasNextPage: next < items.length,
								},
								nodes: slice,
							},
						];
					}),
				);
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		} as unknown as GitHubApiConfig;
		const api = new GitHubApi(config);

		let cursor: string | undefined;
		let pages = 0;
		let truncated = false;
		for (; pages < 100;) {
			const r = await api.searchIssuesPage(provider, token, { org: 'o', cursor: cursor });
			pages++;
			truncated = r?.truncated ?? false;
			if (r?.hasMore !== true || r.cursor == null) break;

			cursor = r.cursor;
		}

		assert.ok(pages < 100, 'the walk terminates rather than paging forever');
		assert.equal(truncated, true, 'and reports the results it could not reach');
	});

	test('a tied block larger than the cap terminates and reports the ceiling', async () => {
		// The nearest thing to a repeated bound that a well-behaved provider can produce. It resolves without the
		// guard above: every page inside the block is filtered out by the per-alias `slideSeen`, so the walk ends
		// on an empty page with no boundary to slide from.
		const tie = iso(Date.UTC(2025, 5, 1));
		const corpus = [
			...Array.from({ length: 1200 }, (_, i) => node(`T${i}`, tie)),
			...spread(50, 'O', Date.UTC(2024, 0, 1)),
		];
		const api = new GitHubApi(faithful({ matched: corpus }));

		const { urls, distinct, truncated } = await drain(api, { org: 'o' });

		assert.equal(urls.length, distinct, 'no issue is served twice');
		assert.equal(distinct, 1000, 'the reachable window is served in full');
		assert.equal(truncated, true, 'and the unreachable remainder is reported');
	});

	test('an unslidable sort still reports the ceiling for a union', async () => {
		const api = new GitHubApi(faithful({ authored: spread(1200, 'A') }));

		const { truncated } = await drain(api, {
			org: 'o',
			criteria: { relationships: ['authored'], sort: 'comments:desc' },
		});

		assert.equal(truncated, true);
	});
});
