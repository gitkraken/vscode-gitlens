import * as assert from 'node:assert/strict';
import { suite, teardown, test } from 'mocha';
import type { PullRequestSearchCriteria, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { TokenWithInfo } from '../authentication/models.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import { createIntegrationService } from '../integrationService.js';
import type { IntegrationManager } from '../manager.js';
import { PullRequestFilter } from '../providerFilters.js';
import {
	countBitbucketServerPullRequests,
	searchBitbucketServerPullRequestsPage,
} from '../providers/bitbucket-server/pullRequestSearch.js';
import type { ProviderRepoInput, ProviderRequestFunction } from '../providers/models.js';
import type { ProviderPagedResult } from '../results.js';
import { createFakeRuntime } from './fakeRuntime.js';

const providerId = GitSelfManagedHostIntegrationId.BitbucketServer;
const connections = [
	{ id: 'account-a', baseUrl: 'https://one.test:8443/bitbucket', token: 'synthetic-a' },
	{ id: 'account-b', baseUrl: 'https://one.test:8443/bitbucket', token: 'synthetic-b' },
	{ id: 'host-b', baseUrl: 'https://two.test/other', token: 'synthetic-c' },
	{ id: 'path-b', baseUrl: 'https://one.test:8443/other', token: 'synthetic-d' },
];
type Connection = (typeof connections)[number];

type Status = 'UNAPPROVED' | 'NEEDS_WORK' | 'APPROVED';

/** A pull request as a test describes it; {@link toPullRequest} turns it into the REST payload. */
interface Row {
	id: number;
	repo?: number;
	state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
	updated?: number;
	title?: string;
	description?: string;
	draft?: boolean;
	archived?: boolean;
	author?: string;
	reviewers?: [string, Status][];
	participants?: [string, Status][];
}

const userIds: Record<string, number> = { me: 1, someone: 2, other: 3 };

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status: status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

function user(name: string, baseUrl: string) {
	return {
		id: userIds[name],
		name: name,
		slug: name,
		displayName: name,
		emailAddress: `${name}@example.test`,
		links: { self: [{ href: `${baseUrl}/users/${name}` }] },
	};
}

function toPullRequest(row: Row, baseUrl: string) {
	const repoId = row.repo ?? 1;
	const slug = `repo-${repoId}`;
	const repository = {
		id: repoId,
		slug: slug,
		name: slug,
		project: { key: 'PRJ' },
		archived: row.archived ?? false,
		links: {
			self: [{ href: `${baseUrl}/projects/PRJ/repos/${slug}/browse` }],
			clone: [
				{ name: 'http', href: `${baseUrl}/scm/PRJ/${slug}.git` },
				{ name: 'ssh', href: `ssh://git@${new URL(baseUrl).hostname}/PRJ/${slug}.git` },
			],
		},
	};
	const ref = { id: 'refs/heads/topic', displayId: 'topic', latestCommit: 'abc123', repository: repository };
	const participant =
		(role: string) =>
		([name, status]: [string, Status]) => ({
			user: user(name, baseUrl),
			role: role,
			status: status,
			approved: status === 'APPROVED',
		});
	return {
		id: row.id,
		version: 0,
		title: row.title ?? `Pull request ${row.id}`,
		description: row.description ?? '',
		state: row.state ?? 'OPEN',
		...(row.draft != null ? { draft: row.draft } : {}),
		createdDate: 1_000,
		updatedDate: row.updated ?? row.id * 1_000,
		closedDate: null,
		fromRef: ref,
		toRef: ref,
		author: { user: user(row.author ?? 'someone', baseUrl), role: 'AUTHOR', status: 'UNAPPROVED', approved: false },
		reviewers: (row.reviewers ?? []).map(participant('REVIEWER')),
		participants: (row.participants ?? []).map(participant('PARTICIPANT')),
		properties: { commentCount: 0 },
		links: { self: [{ href: `${baseUrl}/projects/PRJ/repos/${slug}/pull-requests/${row.id}` }] },
	};
}

type PullRequestPayload = ReturnType<typeof toPullRequest>;

/**
 * An in-memory Bitbucket Data Center answering both pull-request lists the way the REST API documents them: states,
 * participant filters, text, draft and `order`, paged by `start`/`limit` under the server's own page cap. `ignore`
 * drops a parameter the way a server that predates it would.
 */
function servePullRequests(
	url: URL,
	rows: Row[],
	connection: Connection,
	options?: { maxLimit?: number; ignore?: string[] },
): Response {
	const p = url.searchParams;
	let values = rows.map(row => toPullRequest(row, connection.baseUrl));

	const repo = /\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests$/.exec(url.pathname);
	if (repo != null) {
		const [project, slug] = [decodeURIComponent(repo[1]), decodeURIComponent(repo[2])];
		values = values.filter(
			pr =>
				pr.toRef.repository.project.key.toLowerCase() === project.toLowerCase() &&
				pr.toRef.repository.slug.toLowerCase() === slug.toLowerCase(),
		);
		const username = p.get('username.1');
		if (username != null) {
			const role = p.get('role.1');
			const approved = p.get('approved.1');
			values = values.filter(pr => {
				const author = pr.author.user.name === username;
				const reviewer = pr.reviewers.find(r => r.user.name === username);
				const other = pr.participants.find(r => r.user.name === username);
				if (role === 'AUTHOR' && !author) return false;
				if (role === 'REVIEWER' && reviewer == null) return false;
				if (role == null && !author && reviewer == null && other == null) return false;
				return approved == null || String((reviewer ?? other)?.status === 'APPROVED') === approved;
			});
		}
		const text = p.get('filterText')?.toLowerCase();
		if (text) {
			values = values.filter(
				pr => pr.title.toLowerCase().includes(text) || pr.description.toLowerCase().includes(text),
			);
		}
		if (p.has('draft') && !options?.ignore?.includes('draft')) {
			values = values.filter(pr => String(pr.draft === true) === p.get('draft'));
		}
		const state = p.get('state') ?? 'OPEN';
		if (state !== 'ALL') {
			values = values.filter(pr => pr.state === state);
		}
	} else {
		assert.ok(url.pathname.endsWith('/dashboard/pull-requests'), `unexpected request ${url.pathname}`);
		assert.equal(p.get('filterText'), null, 'the dashboard has no text filter');
		assert.equal(p.get('draft'), null, 'the dashboard has no draft filter');
		const role = p.get('role');
		values = values.filter(pr => {
			const author = pr.author.user.name === 'me';
			const reviewer = pr.reviewers.some(r => r.user.name === 'me');
			const other = pr.participants.some(r => r.user.name === 'me');
			if (role === 'AUTHOR') return author;
			if (role === 'REVIEWER') return reviewer;
			if (role === 'PARTICIPANT') return other;
			return author || reviewer || other;
		});
		// As a live 8.8 server does: the status only filters alongside a role, against that role's own list. Without
		// a role it is ignored and every pull request the user is involved in comes back.
		const statuses = p.get('participantStatus')?.split(',');
		if (statuses != null && (role === 'REVIEWER' || role === 'PARTICIPANT')) {
			const list = (pr: PullRequestPayload) => (role === 'REVIEWER' ? pr.reviewers : pr.participants);
			values = values.filter(pr => list(pr).some(r => r.user.name === 'me' && statuses.includes(r.status)));
		}
		const state = p.get('state');
		if (state != null) {
			values = values.filter(pr => pr.state === state);
		}
	}

	values.sort((a, b) =>
		p.get('order') === 'OLDEST' ? a.updatedDate - b.updatedDate : b.updatedDate - a.updatedDate,
	);
	const start = Number(p.get('start') ?? 0);
	const limit = Math.min(Number(p.get('limit') ?? 25), options?.maxLimit ?? 1000);
	const page = values.slice(start, start + limit);
	const isLastPage = start + limit >= values.length;
	return json({
		values: page,
		size: page.length,
		start: start,
		limit: limit,
		isLastPage: isLastPage,
		...(isLastPage ? {} : { nextPageStart: start + limit }),
	});
}

function repos(...ids: number[]): ProviderRepoInput[] {
	return ids.map(id => ({ namespace: 'PRJ', name: `repo-${id}` }));
}

function numbers(items: PullRequestShape[]): number[] {
	return items.map(pr => Number(pr.id));
}

suite('Bitbucket Data Center pull request search through the public manager', () => {
	const managers: IntegrationManager[] = [];
	teardown(() => {
		for (const manager of managers.splice(0)) {
			manager.dispose();
		}
	});

	async function createServer(respond: (url: URL, connection: Connection) => Response | Promise<Response>) {
		const runtime = createFakeRuntime();
		const requests: { url: URL; connectionId: string }[] = [];
		runtime.account.getAccount = async () => ({ id: 'me' });
		runtime.account.fetchGkApi = async path => {
			if (path === 'v1/provider-tokens') {
				return json({
					data: connections.map(connection => ({
						tokenId: connection.id,
						provider: toCloudIntegrationType[providerId],
						type: 'pat',
						domain: connection.baseUrl,
					})),
				});
			}

			const connection = connections.find(c => path.includes(`/tokens/${c.id}`)) ?? connections[0];
			return json({
				data: {
					tokenId: connection.id,
					accessToken: connection.token,
					expiresIn: 3600,
					scopes: '',
					type: 'pat',
					domain: connection.baseUrl,
				},
			});
		};
		runtime.http.fetch = async (input, init) => {
			const url = new URL(input);
			const authorization = new Headers(init?.headers).get('authorization');
			const connection = connections.find(c => authorization === `Bearer ${c.token}`);
			// Every request carries the selected connection's own credential, to its own host and context path.
			assert.ok(connection, 'each request uses a configured credential');
			assert.equal(url.origin, new URL(connection.baseUrl).origin);
			assert.ok(url.pathname.startsWith(`${new URL(connection.baseUrl).pathname}/rest/api/1.0/`));
			if (url.pathname.endsWith('/users')) {
				return json({ values: [user('me', connection.baseUrl)] }, 200, {
					'x-auserid': '1',
					'x-ausername': 'me',
				});
			}

			requests.push({ url: url, connectionId: connection.id });
			return respond(url, connection);
		};
		const manager = createIntegrationManager({ ...runtime, cache: undefined });
		managers.push(manager);
		await manager.refreshConnections();
		return { manager: manager, requests: requests, runtime: runtime };
	}

	function search(
		manager: IntegrationManager,
		options: {
			connectionId?: string;
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: PullRequestSearchCriteria;
			cursor?: string;
			page?: number;
			itemsPerPage?: number;
		},
	): Promise<ProviderPagedResult<PullRequestShape>> {
		return manager.searchPullRequestsPage({ providerId: providerId, connectionId: 'account-a', ...options });
	}

	/** Every page of a search, threading the cursor, so a count can be compared with the whole list it previews. */
	async function drain(manager: IntegrationManager, options: Parameters<typeof search>[1]) {
		const items: PullRequestShape[] = [];
		let cursor: string | undefined;
		for (let page = 1; page <= 50; page++) {
			const result = await search(manager, { ...options, cursor: cursor, page: page });
			assert.equal(result.fetchFailed, undefined, result.warnings[0]?.message);
			items.push(...result.items);
			if (!result.hasMore) return items;

			cursor = result.cursor;
		}
		throw new Error('The search did not terminate');
	}

	test('scopes to repositories, pages each by its own offset and keeps the context path', async () => {
		const rows: Row[] = [
			...[1, 2, 3, 4, 5].map(id => ({ id: id, repo: 1 })),
			{ id: 6, repo: 2 },
			{ id: 7, repo: 2 },
			{ id: 8, repo: 1, state: 'MERGED' as const },
		];
		const { manager, requests } = await createServer((url, c) => servePullRequests(url, rows, c));
		const scope = { repos: repos(1, 2), itemsPerPage: 2 };

		const first = await search(manager, scope);
		assert.deepEqual(numbers(first.items), [7, 6, 5, 4]);
		assert.equal(first.hasMore, true);
		assert.ok(first.cursor != null && !first.cursor.includes(connections[0].token));
		const second = await search(manager, { ...scope, cursor: first.cursor, page: 2 });
		assert.deepEqual(numbers(second.items), [3, 2]);
		assert.equal(second.page.currentPage, 2);
		const third = await search(manager, { ...scope, cursor: second.cursor, page: 3 });
		assert.deepEqual(numbers(third.items), [1]);
		assert.equal(third.hasMore, false);
		assert.equal(third.cursor, undefined);
		assert.equal(third.fetchFailed, undefined);
		assert.deepEqual(third.warnings, []);

		assert.deepEqual(
			requests.map(r => [r.url.pathname, r.url.searchParams.get('start')]),
			[
				['/bitbucket/rest/api/1.0/projects/PRJ/repos/repo-1/pull-requests', '0'],
				['/bitbucket/rest/api/1.0/projects/PRJ/repos/repo-2/pull-requests', '0'],
				// repo-2 answered its last page, so only repo-1 is read on.
				['/bitbucket/rest/api/1.0/projects/PRJ/repos/repo-1/pull-requests', '2'],
				['/bitbucket/rest/api/1.0/projects/PRJ/repos/repo-1/pull-requests', '4'],
			],
		);
		for (const { url } of requests) {
			assert.equal(url.searchParams.get('state'), 'OPEN');
			assert.equal(url.searchParams.get('order'), 'NEWEST');
			assert.equal(url.searchParams.get('limit'), '2');
		}

		// A page asked for by number alone walks the same continuations.
		requests.length = 0;
		const walked = await search(manager, { ...scope, page: 3 });
		assert.deepEqual(numbers(walked.items), [1]);
		assert.equal(walked.page.currentPage, 3);
		assert.equal(requests.length, 4);
	});

	test('sends one requested state to the server and keeps only the requested ones of several', async () => {
		const rows: Row[] = [
			{ id: 1, state: 'OPEN' },
			{ id: 2, state: 'DECLINED' },
			{ id: 3, state: 'MERGED' },
			// Closed by a newer pull request: not in the published schema, but a server can report it.
			{ id: 4, state: 'SUPERSEDED' },
		];
		const { manager, requests } = await createServer((url, c) => servePullRequests(url, rows, c));
		const cases: [PullRequestSearchCriteria['states'], string, number[]][] = [
			[undefined, 'OPEN', [1]],
			// `closed` is two server states, so it is read as every state and kept client-side.
			[['closed'], 'ALL', [4, 2]],
			[['merged'], 'MERGED', [3]],
			[['closed', 'merged'], 'ALL', [4, 3, 2]],
			[['all'], 'ALL', [4, 3, 2, 1]],
		];
		for (const [states, param, expected] of cases) {
			requests.length = 0;
			const result = await search(manager, { repos: repos(1), criteria: { states: states } });
			assert.deepEqual(numbers(result.items), expected, JSON.stringify(states));
			assert.equal(requests[0].url.searchParams.get('state'), param);
		}
		const all = await search(manager, { repos: repos(1), criteria: { states: ['all'] } });
		assert.equal(all.items.find(pr => pr.id === '4')?.state, 'closed');
	});

	test('reads relationships from the dashboard and re-checks what it cannot filter', async () => {
		const rows: Row[] = [
			{ id: 1, author: 'me', title: 'Fix login' },
			{ id: 2, author: 'me', draft: true, title: 'Draft work' },
			{ id: 3, reviewers: [['me', 'UNAPPROVED']] },
			{ id: 4, reviewers: [['me', 'NEEDS_WORK']] },
			{ id: 5, reviewers: [['me', 'APPROVED']] },
			{ id: 6, participants: [['me', 'APPROVED']] },
			{ id: 7, author: 'me', archived: true },
			{ id: 8, author: 'other' },
			{ id: 9, author: 'me', state: 'MERGED' },
		];
		const { manager, requests } = await createServer((url, c) => servePullRequests(url, rows, c));
		const cases: [PullRequestSearchCriteria, number[], Record<string, string>][] = [
			[{ relationships: [PullRequestFilter.Author] }, [2, 1], { role: 'AUTHOR', state: 'OPEN' }],
			[
				{ relationships: [PullRequestFilter.ReviewRequested] },
				[3],
				{ role: 'REVIEWER', participantStatus: 'UNAPPROVED' },
			],
			[{ relationships: [PullRequestFilter.Author], text: 'FIX' }, [1], { role: 'AUTHOR' }],
			[{ relationships: [PullRequestFilter.Author], draft: false }, [1], { role: 'AUTHOR' }],
			[{ relationships: [PullRequestFilter.Author], draft: true }, [2], { role: 'AUTHOR' }],
			[{ relationships: [PullRequestFilter.Author], includeArchived: true }, [7, 2, 1], { role: 'AUTHOR' }],
			[{ relationships: [PullRequestFilter.Author], states: ['open', 'merged'] }, [9, 2, 1], { role: 'AUTHOR' }],
		];
		for (const [criteria, expected, params] of cases) {
			requests.length = 0;
			const result = await search(manager, { criteria: criteria });
			assert.deepEqual(numbers(result.items), expected, JSON.stringify(criteria));
			assert.equal(result.fetchFailed, undefined);
			assert.equal(requests.length, 1);
			assert.equal(requests[0].url.pathname, '/bitbucket/rest/api/1.0/dashboard/pull-requests');
			for (const [name, value] of Object.entries(params)) {
				assert.equal(requests[0].url.searchParams.get(name), value, `${name} for ${JSON.stringify(criteria)}`);
			}
		}
		// Several states are read as every state, which the dashboard spells by omitting it.
		assert.equal(requests[0].url.searchParams.get('state'), null);

		// Reviewed reads the reviewer and the participant lists, each filtered by status server-side.
		requests.length = 0;
		const reviewed = await search(manager, { criteria: { relationships: [PullRequestFilter.Reviewed] } });
		assert.deepEqual(numbers(reviewed.items), [6, 5, 4]);
		assert.deepEqual(
			requests.map(r => [r.url.searchParams.get('role'), r.url.searchParams.get('participantStatus')]).sort(),
			[
				['PARTICIPANT', 'APPROVED,NEEDS_WORK'],
				['REVIEWER', 'APPROVED,NEEDS_WORK'],
			],
		);
	});

	test('reads only reviewed pull requests for Reviewed, not every one the user is involved in', async () => {
		// Many pull requests the user authored, a few reviewed. Without a role the dashboard would return all of them.
		const rows: Row[] = [
			...Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, author: 'me' })),
			{ id: 1, reviewers: [['me', 'APPROVED']] as [string, Status][] },
			{ id: 2, participants: [['me', 'NEEDS_WORK']] as [string, Status][] },
			{ id: 3, reviewers: [['me', 'UNAPPROVED']] as [string, Status][] },
		];
		const read: number[] = [];
		const { manager } = await createServer(async (url, c) => {
			const response = servePullRequests(url, rows, c);
			const body = (await response.clone().json()) as { values: unknown[] };
			read.push(body.values.length);
			return response;
		});
		const items = await drain(manager, {
			criteria: { relationships: [PullRequestFilter.Reviewed] },
			itemsPerPage: 10,
		});
		assert.deepEqual(numbers(items).sort(), [1, 2]);
		assert.ok(
			read.reduce((a, b) => a + b, 0) <= 2,
			`read ${read.reduce((a, b) => a + b, 0)} rows to find 2 reviewed ones`,
		);

		const counts = await manager.countPullRequests({
			providerId: providerId,
			connectionId: 'account-a',
			scopes: [{ key: 'reviewed', criteria: { relationships: [PullRequestFilter.Reviewed] } }],
		});
		assert.deepEqual(
			counts.items.map(i => [i.key, i.count, i.lowerBound]),
			[['reviewed', 2, undefined]],
		);
	});

	test('filters participants in a repository and re-checks the review state it cannot express', async () => {
		const rows: Row[] = [
			{ id: 3, reviewers: [['me', 'UNAPPROVED']] },
			{ id: 4, reviewers: [['me', 'NEEDS_WORK']] },
			{ id: 5, reviewers: [['other', 'UNAPPROVED']] },
		];
		const { manager, requests } = await createServer((url, c) => servePullRequests(url, rows, c));
		const result = await search(manager, {
			repos: repos(1),
			criteria: { relationships: [PullRequestFilter.ReviewRequested], text: 'pull' },
		});
		// `approved.1=false` also matches a reviewer who asked for changes; only a pending review is kept.
		assert.deepEqual(numbers(result.items), [3]);
		const params = requests[0].url.searchParams;
		assert.equal(params.get('username.1'), 'me');
		assert.equal(params.get('role.1'), 'REVIEWER');
		assert.equal(params.get('approved.1'), 'false');
		assert.equal(params.get('filterText'), 'pull');
	});

	test('keeps a draft constraint a server without draft support ignores', async () => {
		const rows: Row[] = [{ id: 1, draft: true }, { id: 2 }];
		const { manager, requests } = await createServer((url, c) =>
			servePullRequests(url, rows, c, { ignore: ['draft'] }),
		);
		const drafts = await search(manager, { repos: repos(1), criteria: { draft: true } });
		assert.deepEqual(numbers(drafts.items), [1]);
		assert.equal(requests[0].url.searchParams.get('draft'), 'true');
		const ready = await search(manager, { repos: repos(1), criteria: { draft: false } });
		assert.deepEqual(numbers(ready.items), [2]);
		assert.equal(ready.items[0].isDraft, false);
		assert.equal(drafts.items[0].isDraft, true);
	});

	test('finds matches past the first page instead of filtering one page', async () => {
		const rows: Row[] = [
			{ id: 1, author: 'me', title: 'Remove the needle' },
			...[2, 3, 4, 5].map(id => ({ id: id, author: 'me' })),
		];
		const { manager } = await createServer((url, c) => servePullRequests(url, rows, c));
		const criteria = { relationships: [PullRequestFilter.Author], text: 'needle' };
		const first = await search(manager, { criteria: criteria, itemsPerPage: 2 });
		assert.deepEqual(first.items, []);
		assert.equal(first.hasMore, true, 'an empty page still continues');
		const items = await drain(manager, { criteria: criteria, itemsPerPage: 2 });
		assert.deepEqual(numbers(items), [1]);
	});

	test('deduplicates a pull request several relationships match and orders the merged page', async () => {
		const rows: Row[] = [
			{ id: 1, author: 'me', updated: 3_000 },
			{ id: 2, author: 'me', participants: [['me', 'APPROVED']], updated: 1_000 },
			{ id: 3, reviewers: [['me', 'APPROVED']], updated: 2_000 },
		];
		const { manager, requests } = await createServer((url, c) => servePullRequests(url, rows, c));
		const result = await search(manager, {
			criteria: {
				relationships: [PullRequestFilter.Author, PullRequestFilter.Reviewed],
				sort: 'updated:asc',
			},
		});
		assert.deepEqual(numbers(result.items), [2, 3, 1]);
		assert.ok(requests.every(r => r.url.searchParams.get('order') === 'OLDEST'));
	});

	test('does not emit a pull request again when another relationship reaches it on a later page', async () => {
		// Pull request 1 is mine and I approved it as a participant. It is the newest I authored, so the author facet
		// serves it on page 1, but the oldest of the participant list, so that facet only reaches it on page 3.
		const rows: Row[] = [
			{ id: 1, author: 'me', participants: [['me', 'APPROVED']], updated: 5_000 },
			{ id: 2, author: 'me', updated: 1_000 },
			{ id: 3, reviewers: [['me', 'APPROVED']], updated: 8_000 },
			{ id: 4, reviewers: [['me', 'APPROVED']], updated: 7_000 },
			{ id: 5, participants: [['me', 'APPROVED']], updated: 9_000 },
			{ id: 6, participants: [['me', 'NEEDS_WORK']], updated: 6_000 },
		];
		const { manager } = await createServer((url, c) => servePullRequests(url, rows, c));
		const criteria = { relationships: [PullRequestFilter.Author, PullRequestFilter.Reviewed] };

		const items = await drain(manager, { criteria: criteria, itemsPerPage: 1 });
		assert.deepEqual(numbers(items).sort(), [1, 2, 3, 4, 5, 6]);

		// The shared row is settled by which relationship owns it, not by remembering what earlier pages emitted, so
		// the cursor stays the same size however many rows the search has read.
		const cursors: string[] = [];
		let cursor: string | undefined;
		for (let page = 1; ; page++) {
			const result = await search(manager, { criteria: criteria, itemsPerPage: 1, cursor: cursor, page: page });
			if (!result.hasMore) break;

			cursor = result.cursor!;
			cursors.push(cursor);
		}
		assert.ok(cursors.length >= 2);
		assert.ok(cursors.every(c => !('seen' in (JSON.parse(c) as object))));
		// Offsets are the only thing that changes, so the size stays within a few digits of the first cursor.
		assert.ok(cursors.every(c => Math.abs(c.length - cursors[0].length) <= 8));
		// The combined scope counts the same OR the search returns, as one exact union rather than a refusal.
		const counts = await manager.countPullRequests({
			providerId: providerId,
			connectionId: 'account-a',
			scopes: [
				{ key: 'both', criteria: criteria },
				...criteria.relationships.map(r => ({ key: r, criteria: { relationships: [r] } })),
			],
		});
		assert.equal(counts.fetchFailed, undefined);
		assert.deepEqual(
			counts.items.map(i => [i.key, i.count]),
			[
				['both', items.length],
				[PullRequestFilter.Author, 2],
				[PullRequestFilter.Reviewed, 5],
			],
		);
	});

	test('refuses what it cannot express before any request', async () => {
		const { manager, requests } = await createServer((url, c) => servePullRequests(url, [], c));
		const refused: Parameters<typeof search>[1][] = [
			{ criteria: { relationships: [PullRequestFilter.Assignee] } },
			{ criteria: { relationships: [PullRequestFilter.Mention] } },
			{ repos: repos(1), criteria: { updatedAfter: '2026-01-01' } },
			{ repos: repos(1), criteria: { createdAfter: '2026-01-01' } },
			{ repos: repos(1), criteria: { sort: 'created:desc' } },
			{ org: 'PRJ' },
			{},
		];
		for (const options of refused) {
			const result = await search(manager, options);
			assert.deepEqual(result.items, [], JSON.stringify(options));
			assert.equal(result.fetchFailed, true, JSON.stringify(options));
			assert.equal(result.warnings.length, 1, JSON.stringify(options));

			const counts = await manager.countPullRequests({
				providerId: providerId,
				connectionId: 'account-a',
				scopes: [{ key: 'scope', repos: options.repos, org: options.org, criteria: options.criteria }],
			});
			assert.deepEqual(counts.items, [], JSON.stringify(options));
			assert.equal(counts.fetchFailed, true, JSON.stringify(options));
		}
		assert.equal(requests.length, 0);
	});

	test('keeps the repositories that answered, retries the one that failed once, then reports it on every page', async () => {
		const rows: Row[] = [1, 2, 3, 4, 5].map(id => ({ id: id, repo: 1 }));
		const { manager, requests } = await createServer((url, c) =>
			url.pathname.includes('/repos/repo-9/')
				? json({ errors: [{ message: 'gone' }] }, 404)
				: servePullRequests(url, [...rows, { id: 30, repo: 3 }, { id: 31, repo: 3 }], c),
		);
		const scope = { repos: repos(1, 9), itemsPerPage: 2 };
		const first = await search(manager, scope);
		assert.deepEqual(numbers(first.items), [5, 4]);
		assert.equal(first.fetchFailed, true);
		assert.equal(first.warnings.length, 1);
		assert.equal(first.warnings[0].kind, 'not-found');
		assert.match(first.warnings[0].message, /PRJ\/repo-9/);
		assert.equal(first.page.truncated, true);
		assert.equal(first.hasMore, true);

		// Page 2 retries repo-9 at the offset it missed; it fails again, so it is dropped from here on.
		requests.length = 0;
		const second = await search(manager, { ...scope, cursor: first.cursor, page: 2 });
		assert.deepEqual(numbers(second.items), [3, 2]);
		assert.equal(second.fetchFailed, true);
		assert.equal(second.warnings[0].kind, 'not-found');
		assert.deepEqual(requests.map(r => r.url.pathname).sort(), [
			'/bitbucket/rest/api/1.0/projects/PRJ/repos/repo-1/pull-requests',
			'/bitbucket/rest/api/1.0/projects/PRJ/repos/repo-9/pull-requests',
		]);
		assert.equal(requests.find(r => r.url.pathname.includes('repo-9'))?.url.searchParams.get('start'), '0');

		requests.length = 0;
		const third = await search(manager, { ...scope, cursor: second.cursor, page: 3 });
		assert.deepEqual(numbers(third.items), [1]);
		assert.equal(third.fetchFailed, true, 'the missing repository is still missing from the result');
		assert.equal(third.warnings[0].kind, 'not-found');
		assert.deepEqual(
			requests.map(r => r.url.pathname),
			['/bitbucket/rest/api/1.0/projects/PRJ/repos/repo-1/pull-requests'],
		);

		// The completeness a cursor carries is signed, so a failure a caller writes into it is never reported as
		// written — a healthy continuation can't be made to report an auth failure, even with the key left intact. A
		// state that doesn't verify still says the read was incomplete, which is also what a cursor that outlived
		// its process looks like: it continues, reporting completeness as unconfirmed rather than as whole.
		const tampered = JSON.parse(second.cursor!) as { state: { failed: unknown[]; signature: string } };
		const unverified: { state: unknown; label: string }[] = [
			{
				label: 'extra auth failure',
				state: { ...tampered.state, failed: [...tampered.state.failed, { facet: 0, kind: 'authentication' }] },
			},
			{ label: 'relabelled kind', state: { ...tampered.state, failed: [{ facet: 1, kind: 'authentication' }] } },
			{ label: 'unknown kind', state: { ...tampered.state, failed: [{ facet: 1, kind: 'bogus' }] } },
			{ label: 'another process', state: { ...tampered.state, signature: 'signed-by-a-previous-process' } },
			// Every continuation carries a state, so a removed one reads as unconfirmed rather than as whole.
			{ label: 'removed', state: undefined },
		];
		requests.length = 0;
		for (const { state, label } of unverified) {
			const replayed = await search(manager, {
				...scope,
				cursor: JSON.stringify({ ...tampered, state: state }),
				page: 3,
			});
			assert.deepEqual(numbers(replayed.items), [1], label);
			assert.equal(replayed.page.truncated, true, label);
			assert.equal(replayed.warnings.length, 1, label);
			assert.equal(replayed.warnings[0].kind, 'other', label);
			assert.doesNotMatch(replayed.warnings[0].message, /repo-9|authentication/, label);
		}
		assert.ok(
			requests.every(r => r.url.pathname.endsWith('/repos/repo-1/pull-requests')),
			'an unverified state still reads only the facets the offsets continue',
		);

		// The signature covers the offsets: ending a facet early by nulling its offset can't pass for complete.
		const twoFacets = await search(manager, { repos: repos(1, 3), itemsPerPage: 1 });
		const edited = JSON.parse(twoFacets.cursor!) as { starts: (number | null)[] };
		assert.ok(edited.starts.filter(start => start != null).length === 2);
		edited.starts[0] = null;
		const shortened = await search(manager, {
			repos: repos(1, 3),
			itemsPerPage: 1,
			cursor: JSON.stringify(edited),
			page: 2,
		});
		assert.equal(shortened.page.truncated, true);

		// A read that never failed still signs its (complete) state, and its continuation stays complete.
		const clean = await search(manager, { repos: repos(1), itemsPerPage: 2 });
		const cleanState = (
			JSON.parse(clean.cursor!) as { state: { failed: unknown[]; retrying: unknown[]; truncated: boolean } }
		).state;
		assert.deepEqual([cleanState.failed, cleanState.retrying, cleanState.truncated], [[], [], false]);
		const next = await search(manager, { repos: repos(1), itemsPerPage: 2, cursor: clean.cursor, page: 2 });
		assert.equal(next.page.truncated, undefined);
		assert.deepEqual(next.warnings, []);
	});

	test('resolves the current user per installation when two context paths share a token', async () => {
		// Two servers on one host, mounted at different paths, whose users differ, reached with the same token string.
		const installs = [
			{ id: 'path-a', baseUrl: 'https://one.test/a', user: 'alice', userId: 11 },
			{ id: 'path-b', baseUrl: 'https://one.test/b', user: 'bob', userId: 12 },
		];
		const runtime = createFakeRuntime();
		runtime.account.getAccount = async () => ({ id: 'me' });
		runtime.account.fetchGkApi = async path => {
			if (path === 'v1/provider-tokens') {
				return json({
					data: installs.map(i => ({
						tokenId: i.id,
						provider: toCloudIntegrationType[providerId],
						type: 'pat',
						domain: i.baseUrl,
					})),
				});
			}

			const install = installs.find(i => path.includes(`/tokens/${i.id}`)) ?? installs[0];
			return json({
				data: {
					tokenId: install.id,
					accessToken: 'shared',
					expiresIn: 3600,
					scopes: '',
					type: 'pat',
					domain: install.baseUrl,
				},
			});
		};
		const usernames = new Map<string, string | null>();
		runtime.http.fetch = async input => {
			const url = new URL(input);
			const install = installs.find(i => url.pathname.startsWith(`${new URL(i.baseUrl).pathname}/rest/`))!;
			if (url.pathname.endsWith('/users')) {
				const account = {
					id: install.userId,
					name: install.user,
					slug: install.user,
					displayName: install.user,
					emailAddress: `${install.user}@example.test`,
					links: { self: [{ href: `${install.baseUrl}/users/${install.user}` }] },
				};
				return json({ values: [account] }, 200, {
					'x-auserid': String(install.userId),
					'x-ausername': install.user,
				});
			}

			usernames.set(install.id, url.searchParams.get('username.1'));
			return json({ values: [], size: 0, limit: 25, start: 0, isLastPage: true });
		};
		const manager = createIntegrationManager({ ...runtime, cache: undefined });
		managers.push(manager);
		await manager.refreshConnections();

		for (const install of installs) {
			const result = await manager.searchPullRequestsPage({
				providerId: providerId,
				connectionId: install.id,
				repos: repos(1),
				criteria: { relationships: [PullRequestFilter.Author] },
			});
			assert.equal(result.fetchFailed, undefined, result.warnings[0]?.message);
		}
		assert.deepEqual(Object.fromEntries(usernames), { 'path-a': 'alice', 'path-b': 'bob' });
	});

	test('settles a cancelled relationship search without waiting on the account lookup', async () => {
		const service = createIntegrationService(createFakeRuntime());
		managers.push(service);
		const integration = await service.get(providerId, 'one.test');
		assert.ok(integration != null);
		const internal = integration as unknown as {
			getProviderCurrentAccount: () => Promise<unknown>;
			searchProviderPullRequestsPage: (
				session: unknown,
				options: unknown,
				cancellation?: AbortSignal,
			) => Promise<unknown>;
			countProviderPullRequests: (
				session: unknown,
				scopes: unknown[],
				cancellation?: AbortSignal,
			) => Promise<unknown>;
		};
		// A cold account cache whose lookup never answers: only the signal can settle the read.
		internal.getProviderCurrentAccount = () => new Promise(() => {});
		const session = {
			id: 'account-a',
			accessToken: 'synthetic',
			domain: 'one.test',
			baseUrl: 'https://one.test/bitbucket',
		};
		const criteria = { relationships: [PullRequestFilter.Author] };

		const controller = new AbortController();
		const searched = internal.searchProviderPullRequestsPage(session, { criteria: criteria }, controller.signal);
		const counted = internal.countProviderPullRequests(session, [{ criteria: criteria }], controller.signal);
		controller.abort();
		await assert.rejects(searched, (ex: unknown) => isCancellationError(ex));
		await assert.rejects(counted, (ex: unknown) => isCancellationError(ex));
	});

	test('aborts in-flight requests when the search is cancelled', async () => {
		const token: TokenWithInfo<typeof providerId> = {
			providerId: providerId,
			accessToken: connections[0].token,
			microHash: undefined,
			cloud: true,
			type: 'pat',
			scopes: undefined,
		};
		// Never read: every request fails before a pull request is mapped.
		const provider: Provider = {
			id: providerId,
			name: 'Bitbucket Data Center',
			domain: 'one.test',
			icon: '',
			getIgnoreSSLErrors: () => false,
			reauthenticate: () => Promise.resolve(),
			trackRequestException: () => {},
		};
		const controller = new AbortController();
		const signals: (AbortSignal | undefined)[] = [];
		const request = (async (options: { signal?: AbortSignal }) => {
			signals.push(options.signal);
			controller.abort();
			// A fetch honoring the signal rejects with the abort as soon as it fires.
			await Promise.resolve();
			throw new DOMException('The operation was aborted.', 'AbortError');
		}) as unknown as ProviderRequestFunction;

		await assert.rejects(
			searchBitbucketServerPullRequestsPage(
				request,
				token,
				{
					baseUrl: `${connections[0].baseUrl}/rest/api/1.0`,
					connectionId: 'account-a',
					provider: provider,
					repos: repos(1, 2),
				},
				controller.signal,
			),
			(ex: unknown) => isCancellationError(ex),
		);
		assert.ok(signals.length > 0 && signals.every(s => s === controller.signal));

		// Called directly, past the facade's capability check, a criterion it can't express still refuses the read
		// before any request rather than widening it.
		signals.length = 0;
		for (const criteria of [{ updatedAfter: '2026-01-01' }, { createdAfter: '2026-01-01' }] as const) {
			await assert.rejects(
				searchBitbucketServerPullRequestsPage(
					request,
					token,
					{
						baseUrl: `${connections[0].baseUrl}/rest/api/1.0`,
						connectionId: 'account-a',
						provider: provider,
						repos: repos(1),
						criteria: criteria,
					},
					new AbortController().signal,
				),
				/cannot filter a pull request search by date/,
			);
			await assert.rejects(
				countBitbucketServerPullRequests(
					request,
					token,
					{ baseUrl: `${connections[0].baseUrl}/rest/api/1.0`, repos: repos(1), criteria: criteria },
					new AbortController().signal,
				),
				/cannot filter a pull request search by date/,
			);
		}
		assert.equal(signals.length, 0, 'a refused query sends nothing');

		// The username filters the participants server-side, so a cursor read for one username is refused under
		// another, even when the account id is the same.
		const pages = (async (options: { url: string }) => {
			const start = Number(new URL(options.url).searchParams.get('start'));
			return {
				body: { values: [], size: 0, limit: 1, start: start, isLastPage: false, nextPageStart: start + 1 },
				headers: {},
				status: 200,
			};
		}) as unknown as ProviderRequestFunction;
		const byUser = (username: string, cursor?: string) =>
			searchBitbucketServerPullRequestsPage(pages, token, {
				baseUrl: `${connections[0].baseUrl}/rest/api/1.0`,
				connectionId: 'account-a',
				provider: provider,
				repos: repos(1),
				criteria: { relationships: [PullRequestFilter.Author] },
				currentUser: { id: '1', username: username },
				cursor: cursor,
				pageSize: 1,
			});
		const firstPage = await byUser('me');
		assert.ok(firstPage.cursor != null);
		await assert.doesNotReject(byUser('me', firstPage.cursor));
		await assert.rejects(
			byUser('renamed', firstPage.cursor),
			/Invalid Bitbucket Data Center pull request search cursor/,
		);
		await assert.rejects(
			countBitbucketServerPullRequests(
				request,
				token,
				{ baseUrl: `${connections[0].baseUrl}/rest/api/1.0`, repos: repos(1) },
				new AbortController().signal,
			),
			(ex: unknown) => isCancellationError(ex),
			'an aborted request is the cancellation, not a failed count',
		);
	});

	test('keeps the rows a later page reads when every facet still being read fails', async () => {
		const rows: Row[] = [1, 2, 3].map(id => ({ id: id, repo: 1 }));
		let fail = false;
		const { manager } = await createServer((url, c) =>
			fail && url.pathname.includes('/repos/repo-1/')
				? json({ errors: [{ message: 'unavailable' }] }, 503)
				: servePullRequests(url, [...rows, { id: 4, repo: 2 }], c),
		);
		const scope = { repos: repos(1, 2), itemsPerPage: 2 };
		const first = await search(manager, scope);
		assert.deepEqual(numbers(first.items), [4, 3, 2]);
		assert.equal(first.fetchFailed, undefined);

		// repo-2 was exhausted on page 1, so page 2 reads only repo-1, which now fails. Page 1 already proved the
		// search answers; page 2 is a partial result reporting the failure, not a failed read, and keeps repo-1 for a
		// retry.
		fail = true;
		const second = await search(manager, { ...scope, cursor: first.cursor, page: 2 });
		assert.deepEqual(second.items, []);
		assert.equal(second.fetchFailed, true);
		assert.equal(second.page.truncated, true);
		assert.equal(second.hasMore, true);
		assert.equal(second.warnings.length, 1);
		assert.match(second.warnings[0].message, /PRJ\/repo-1/);

		// The retry recovers: a transient failure costs no rows.
		fail = false;
		const third = await search(manager, { ...scope, cursor: second.cursor, page: 3 });
		assert.deepEqual(numbers(third.items), [1]);
		assert.equal(third.fetchFailed, undefined);
		assert.deepEqual(third.warnings, []);
		assert.equal(third.page.truncated, undefined, 'a failure that recovered leaves nothing incomplete');
		assert.equal(third.hasMore, false);

		// A retry that fails too is dropped rather than retried forever, and the read ends reporting it.
		fail = true;
		const failedAgain = await search(manager, { ...scope, cursor: second.cursor, page: 3 });
		assert.deepEqual(failedAgain.items, []);
		assert.equal(failedAgain.hasMore, false);
		assert.equal(failedAgain.fetchFailed, true);
		assert.equal(failedAgain.page.truncated, true);
	});

	test('does not report a failure that recovered when a page walked past it fails', async () => {
		// repo-1 fails on page 1 and recovers on page 2's retry; page 3 then fails outright (a refused credential is the
		// one failure a later page throws). Asked for by number, the walk ends on the failed page, and the only
		// incompleteness left to report is that failure, not repo-1's.
		const rows: Row[] = [1, 2, 3, 4, 5, 6].map(id => ({ id: id, repo: 2 }));
		let reads = 0;
		const { manager } = await createServer((url, c) => {
			if (url.pathname.includes('/repos/repo-1/')) {
				reads++;
				if (reads === 1) return json({ errors: [{ message: 'transient' }] }, 503);
			}
			if (url.pathname.includes('/repos/repo-2/') && url.searchParams.get('start') === '4') {
				return json({ errors: [{ message: 'expired' }] }, 401);
			}
			return servePullRequests(url, [...rows, { id: 10, repo: 1 }], c);
		});
		const result = await search(manager, { repos: repos(1, 2), itemsPerPage: 2, page: 3 });
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => w.kind),
			['auth'],
		);
		assert.ok(
			result.warnings.every(w => !w.message.includes('repo-1')),
			result.warnings.map(w => w.message).join(' | '),
		);
	});

	test('throws a credential failure on a later page, recovering the session once instead of carrying it', async () => {
		// The reviewed facet still has pages after page 2, so a carried failure would ride its continuation.
		const rows: Row[] = [
			{ id: 1, author: 'me' },
			{ id: 2, author: 'me' },
			{ id: 3, reviewers: [['me', 'APPROVED']] },
			{ id: 4, reviewers: [['me', 'APPROVED']] },
			{ id: 5, reviewers: [['me', 'APPROVED']] },
		];
		let reject = false;
		const { manager, runtime } = await createServer((url, c) =>
			reject && url.searchParams.get('role') === 'AUTHOR'
				? json({ errors: [{ message: 'expired' }] }, 401)
				: servePullRequests(url, rows, c),
		);
		const refreshes: string[] = [];
		const fetchGkApi = runtime.account.fetchGkApi;
		runtime.account.fetchGkApi = async (path, init) => {
			if (path.endsWith('/refresh')) {
				refreshes.push(path);
			}
			return fetchGkApi(path, init);
		};
		const criteria = { relationships: [PullRequestFilter.Author, PullRequestFilter.Reviewed] };
		const first = await search(manager, { criteria: criteria, itemsPerPage: 1 });
		assert.equal(first.hasMore, true);

		reject = true;
		const second = await search(manager, { criteria: criteria, itemsPerPage: 1, cursor: first.cursor, page: 2 });
		assert.deepEqual(second.items, []);
		assert.equal(second.fetchFailed, true);
		assert.equal(second.warnings[0].kind, 'auth');
		assert.equal(second.cursor, undefined, 'a credential failure is not carried into a continuation');

		reject = false;
		const third = await search(manager, { criteria: criteria, itemsPerPage: 1 });
		assert.equal(third.fetchFailed, undefined);
		assert.equal(refreshes.length, 1, 'the rejected connection is refreshed once, on the next read');
	});

	test('throws a credential refused on a repository, but keeps the others past a repository it cannot read', async () => {
		const rows: Row[] = [1, 2, 3].map(id => ({ id: id, repo: 1 }));
		let status = 0;
		const { manager } = await createServer((url, c) =>
			status !== 0 && url.pathname.includes('/repos/repo-2/')
				? json({ errors: [{ message: 'refused' }] }, status)
				: servePullRequests(url, [...rows, { id: 4, repo: 2 }, { id: 5, repo: 2 }], c),
		);
		const scope = { repos: repos(1, 2), itemsPerPage: 1 };
		const first = await search(manager, scope);
		assert.equal(first.fetchFailed, undefined);

		// 403 on one repository is that repository refusing the token: the other one still answers.
		status = 403;
		const forbidden = await search(manager, { ...scope, cursor: first.cursor, page: 2 });
		assert.deepEqual(numbers(forbidden.items), [2]);
		assert.equal(forbidden.fetchFailed, true);
		assert.match(forbidden.warnings[0].message, /PRJ\/repo-2/);
		assert.equal(forbidden.hasMore, true);

		// 401 is the credential itself, wherever it lands: thrown, so the session recovers and nothing is carried.
		status = 401;
		const unauthorized = await search(manager, { ...scope, cursor: first.cursor, page: 2 });
		assert.deepEqual(unauthorized.items, []);
		assert.equal(unauthorized.warnings[0].kind, 'auth');
		assert.equal(unauthorized.cursor, undefined);
	});

	test('reads and counts a repository that refuses the token as that scope failing, not the credential', async () => {
		const { manager, runtime } = await createServer((url, c) =>
			url.pathname.includes('/repos/repo-2/')
				? json({ errors: [{ message: 'no access' }] }, 403)
				: servePullRequests(url, [{ id: 1 }], c),
		);
		const refreshes: string[] = [];
		const fetchGkApi = runtime.account.fetchGkApi;
		runtime.account.fetchGkApi = async (path, init) => {
			if (path.endsWith('/refresh')) {
				refreshes.push(path);
			}
			return fetchGkApi(path, init);
		};
		const count = (key: string, ...ids: number[]) =>
			manager.countPullRequests({
				providerId: providerId,
				connectionId: 'account-a',
				scopes: [{ key: key, repos: repos(...ids) }],
			});

		const refused = await count('refused', 2);
		assert.deepEqual(refused.items, []);
		assert.equal(refused.fetchFailed, true);
		assert.equal(refused.warnings[0].kind, 'other');
		assert.match(refused.warnings[0].message, /PRJ\/repo-2/);

		// A search of only that repository fails its first page outright, and still as the scope, not the credential.
		const searched = await manager.searchPullRequestsPage({
			providerId: providerId,
			connectionId: 'account-a',
			repos: repos(2),
		});
		assert.deepEqual(searched.items, []);
		assert.equal(searched.fetchFailed, true);
		assert.equal(searched.warnings[0].kind, 'other');
		assert.match(searched.warnings[0].message, /PRJ\/repo-2/);

		const healthy = await count('healthy', 1);
		assert.deepEqual(
			healthy.items.map(i => [i.key, i.count]),
			[['healthy', 1]],
		);
		assert.deepEqual(refreshes, [], 'an unreadable repository does not mark the connection for recovery');
		assert.equal(manager.getConfigured(providerId).length, connections.length);
	});

	test('reports a rejected credential as an authentication failure', async () => {
		const { manager } = await createServer(() => json({ errors: [{ message: 'no' }] }, 401));
		const result = await search(manager, { repos: repos(1, 2) });
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0].kind, 'auth');
		assert.equal(result.warnings[0].connectionId, 'account-a');
	});

	test('counts exactly the rows the search returns', async () => {
		const rows: Row[] = [
			...[1, 2, 3, 4, 5].map(id => ({ id: id, repo: 1, title: id % 2 ? 'Fix it' : 'Other' })),
			{ id: 6, repo: 2, state: 'MERGED' as const },
			{ id: 7, repo: 2, state: 'DECLINED' as const },
			{ id: 8, repo: 1, author: 'me', title: 'Fix mine' },
			{ id: 9, repo: 2, reviewers: [['me', 'UNAPPROVED']] },
			{ id: 10, repo: 2, reviewers: [['me', 'NEEDS_WORK']] },
		];
		const { manager, requests } = await createServer((url, c) => servePullRequests(url, rows, c));
		const scopes = [
			{ key: 'repos', repos: repos(1, 2), criteria: { states: ['open', 'merged'] } },
			{ key: 'text', repos: repos(1), criteria: { text: 'fix' } },
			{ key: 'review', criteria: { relationships: [PullRequestFilter.ReviewRequested] } },
			{ key: 'mine', repos: repos(1, 2), criteria: { relationships: [PullRequestFilter.Author] } },
		] satisfies { key: string; repos?: ProviderRepoInput[]; criteria: PullRequestSearchCriteria }[];

		const counts = await manager.countPullRequests({
			providerId: providerId,
			connectionId: 'account-a',
			scopes: scopes,
		});
		assert.equal(counts.fetchFailed, undefined);
		assert.deepEqual(counts.warnings, []);
		for (const scope of scopes) {
			const listed = await drain(manager, { repos: scope.repos, criteria: scope.criteria, itemsPerPage: 1 });
			const count = counts.items.find(i => i.key === scope.key);
			assert.deepEqual(count, {
				key: scope.key,
				count: listed.length,
				exceedsProviderLimit: false,
				providerLimit: undefined,
			});
		}
		assert.deepEqual(
			counts.items.map(i => [i.key, i.count]),
			[
				// Open 1-5 and 8 in repo-1, open 9 and 10 and merged 6 in repo-2; declined 7 is not requested.
				['repos', 9],
				['text', 4],
				['review', 1],
				['mine', 1],
			],
		);
		const countRequests = requests.filter(r => r.url.searchParams.get('limit') === '1000');
		assert.ok(countRequests.length > 0);
		assert.ok(
			countRequests
				.filter(r => r.url.pathname.includes('/repos/'))
				.every(r => r.url.searchParams.get('withProperties') === 'false'),
		);
	});

	test('reports a count past one page as a floor while the search still reads every row', async () => {
		const rows: Row[] = [1, 2, 3, 4, 5].map(id => ({ id: id }));
		const { manager } = await createServer((url, c) => servePullRequests(url, rows, c, { maxLimit: 3 }));
		const counts = await manager.countPullRequests({
			providerId: providerId,
			connectionId: 'account-a',
			scopes: [{ key: 'repo', repos: repos(1) }],
		});
		assert.deepEqual(counts.items, [
			{ key: 'repo', count: 3, lowerBound: true, exceedsProviderLimit: false, providerLimit: undefined },
		]);
		assert.equal((await drain(manager, { repos: repos(1) })).length, 5);
	});

	test('counts only the rows the search can show', async () => {
		// Pull request 2 has no self link, so it can't be mapped: the search skips it, and so must the count.
		const { manager } = await createServer(async (url, c) => {
			const response = servePullRequests(url, [{ id: 1 }, { id: 2 }, { id: 3 }], c);
			const body = (await response.json()) as { values: { id: number; links: unknown }[] };
			for (const pr of body.values) {
				if (pr.id === 2) {
					pr.links = { self: [] };
				}
			}
			return json(body);
		});
		const listed = await drain(manager, { repos: repos(1) });
		assert.deepEqual(numbers(listed), [3, 1]);
		const counts = await manager.countPullRequests({
			providerId: providerId,
			connectionId: 'account-a',
			scopes: [{ key: 'repo', repos: repos(1) }],
		});
		assert.deepEqual(
			counts.items.map(i => [i.key, i.count]),
			[['repo', listed.length]],
		);
	});

	test('drops only the count whose scope failed', async () => {
		const rows: Row[] = [{ id: 1 }];
		const { manager } = await createServer((url, c) =>
			url.pathname.includes('/repos/repo-9/') ? json({}, 404) : servePullRequests(url, rows, c),
		);
		const counts = await manager.countPullRequests({
			providerId: providerId,
			connectionId: 'account-a',
			scopes: [
				{ key: 'ok', repos: repos(1) },
				{ key: 'gone', repos: repos(9) },
			],
		});
		assert.deepEqual(
			counts.items.map(i => [i.key, i.count]),
			[['ok', 1]],
		);
		assert.equal(counts.fetchFailed, true);
		assert.equal(counts.warnings[0].kind, 'not-found');
	});

	test('keeps each account, host and installation apart, and binds its cursor to them', async () => {
		const rows: Row[] = [{ id: 1 }, { id: 2 }];
		const { manager, requests } = await createServer((url, c) => servePullRequests(url, rows, c));
		const cursors = new Map<string, string>();
		for (const connection of connections) {
			const first = await search(manager, { connectionId: connection.id, repos: repos(1), itemsPerPage: 1 });
			assert.deepEqual(numbers(first.items), [2]);
			assert.equal(first.items[0].url, `${connection.baseUrl}/projects/PRJ/repos/repo-1/pull-requests/2`);
			cursors.set(connection.id, first.cursor!);
			const second = await search(manager, {
				connectionId: connection.id,
				repos: repos(1),
				itemsPerPage: 1,
				cursor: first.cursor,
				page: 2,
			});
			assert.deepEqual(numbers(second.items), [1]);
		}
		assert.equal(new Set(cursors.values()).size, connections.length, 'no two connections share a cursor');

		requests.length = 0;
		const replays: [string, string, PullRequestSearchCriteria | undefined][] = [
			['account-a', 'account-b', undefined],
			['host-b', 'path-b', undefined],
			['account-a', 'account-a', { states: ['merged'] }],
		];
		for (const [from, to, criteria] of replays) {
			const replayed = await search(manager, {
				connectionId: to,
				repos: repos(1),
				criteria: criteria,
				itemsPerPage: 1,
				cursor: cursors.get(from),
				page: 2,
			});
			assert.deepEqual(replayed.items, [], `${from} -> ${to}`);
			assert.equal(replayed.fetchFailed, true, `${from} -> ${to}`);
		}
		assert.equal(requests.length, 0, 'a refused cursor reads nothing');
	});
});
