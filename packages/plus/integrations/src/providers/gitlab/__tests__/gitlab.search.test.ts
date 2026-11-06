import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { GitLabApi } from '../gitlab.js';
import type { GitLabMergeRequestREST, GitLabMergeRequestState } from '../models.js';
import { gitLabProvider, gitLabToken } from './fixtures.js';

function restMR(iid: number, state: GitLabMergeRequestState): GitLabMergeRequestREST {
	return {
		id: iid,
		iid: iid,
		author: { id: `gid://gitlab/User/${iid}`, name: 'Author', avatar_url: '', web_url: '' },
		title: `MR ${iid}`,
		description: '',
		state: state,
		created_at: '2024-01-01T00:00:00Z',
		updated_at: '2024-01-02T00:00:00Z',
		closed_at: null,
		merged_at: state === 'merged' ? '2024-01-03T00:00:00Z' : null,
		diff_refs: { base_sha: 'b', head_sha: 'h', start_sha: 's' },
		source_branch: 'feature',
		source_project_id: 1,
		target_branch: 'main',
		target_project_id: 1,
		web_url: `https://gitlab.com/octo/repo/-/merge_requests/${iid}`,
	};
}

function jsonResponse(body: unknown): Response {
	return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

function createFakeFetch(pages: GitLabMergeRequestREST[][], requestedPages: number[]) {
	const config: ProviderApiConfig = {
		fetch: (input: string | URL) => {
			const url = new URL(input.toString());
			if (url.pathname.endsWith('/graphql')) {
				return Promise.resolve(
					jsonResponse({
						data: {
							mergeRequest_0: { project: { id: '1', fullPath: 'octo/repo', webUrl: '' } },
							mergeRequest_1: { project: { id: '1', fullPath: 'octo/repo', webUrl: '' } },
						},
					}),
				);
			}

			const page = Number(url.searchParams.get('page') ?? '1');
			requestedPages.push(page);
			return Promise.resolve(jsonResponse(pages[page - 1] ?? []));
		},
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
	};
	return config;
}

suite('GitLabApi.searchPullRequests state-filtered paging', () => {
	test('pages past the first page to find state matches crowded out of page 1', async () => {
		const page1 = Array.from({ length: 20 }, (_, i) => restMR(i + 1, 'opened'));
		const page2 = [
			restMR(21, 'merged'),
			restMR(22, 'merged'),
			...Array.from({ length: 18 }, (_, i) => restMR(i + 23, 'opened')),
		];

		const requestedPages: number[] = [];
		const api = new GitLabApi(createFakeFetch([page1, page2, []], requestedPages));

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			include: ['merged'],
		});

		assert.deepEqual(
			results.map(pr => pr.id),
			['21', '22'],
		);
		assert.ok(requestedPages.length > 1, 'fetched more than the first search page');
	});

	test('keeps single-page behavior when no state filter is requested', async () => {
		const page1 = Array.from({ length: 20 }, (_, i) => restMR(i + 1, 'opened'));

		const requestedPages: number[] = [];
		const api = new GitLabApi(createFakeFetch([page1, page1, []], requestedPages));

		await api.searchPullRequests(gitLabProvider, gitLabToken, { search: 'fix' });

		assert.deepEqual(requestedPages, [1], 'fetches only the first search page without a state filter');
	});

	test('keeps paging until matches are found beyond page 5', async () => {
		const fullOpenedPage = (page: number) =>
			Array.from({ length: 20 }, (_, i) => restMR(page * 100 + i + 1, 'opened'));
		const page6 = [restMR(601, 'merged'), ...Array.from({ length: 19 }, (_, i) => restMR(602 + i, 'opened'))];

		const requestedPages: number[] = [];
		const api = new GitLabApi(
			createFakeFetch(
				[
					fullOpenedPage(0),
					fullOpenedPage(1),
					fullOpenedPage(2),
					fullOpenedPage(3),
					fullOpenedPage(4),
					page6,
					[],
				],
				requestedPages,
			),
		);

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			include: ['merged'],
		});

		assert.deepEqual(
			results.map(pr => pr.id),
			['601'],
		);
		assert.deepEqual(requestedPages, [1, 2, 3, 4, 5, 6, 7]);
	});

	test('stops at the page backstop when matches never appear', async () => {
		// Every page is full (never a partial/last page) and holds no match, so the only thing that can stop
		// the drain is the 20-page backstop. More pages exist than the cap to prove it truncates rather than
		// running away.
		const fullOpenedPage = (page: number) =>
			Array.from({ length: 20 }, (_, i) => restMR(page * 100 + i + 1, 'opened'));
		const pages = Array.from({ length: 25 }, (_, page) => fullOpenedPage(page));

		const requestedPages: number[] = [];
		const api = new GitLabApi(createFakeFetch(pages, requestedPages));

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			include: ['merged'],
		});

		assert.deepEqual(results, []);
		assert.deepEqual(
			requestedPages,
			Array.from({ length: 20 }, (_, i) => i + 1),
		);
	});
});

function errorResponse(status: number): Response {
	return { ok: false, status: status, statusText: 'Error', text: () => Promise.resolve('') } as unknown as Response;
}

/** Serves each project's search from `byProject` (keyed by decoded full path), recording every REST request. */
function createProjectScopedFetch(
	byProject: Record<string, GitLabMergeRequestREST[] | 'not-found' | 'bad-request'>,
	requests: { pathname: string; search: URLSearchParams }[],
): ProviderApiConfig {
	return {
		fetch: (input: string | URL) => {
			const url = new URL(input.toString());
			if (url.pathname.endsWith('/graphql')) {
				return Promise.resolve(
					jsonResponse({
						data: Object.fromEntries(
							Array.from({ length: 40 }, (_, i) => [
								`mergeRequest_${i}`,
								{ project: { id: '1', fullPath: 'octo/repo', webUrl: '' } },
							]),
						),
					}),
				);
			}

			requests.push({ pathname: url.pathname, search: url.searchParams });
			const match = /\/v4\/projects\/([^/]+)\/search$/.exec(url.pathname);
			if (match == null) return Promise.resolve(jsonResponse([]));

			const result = byProject[decodeURIComponent(match[1])];
			if (result === 'not-found') return Promise.resolve(errorResponse(404));
			if (result === 'bad-request') return Promise.resolve(errorResponse(400));

			const page = Number(url.searchParams.get('page') ?? '1');
			return Promise.resolve(jsonResponse(page === 1 ? (result ?? []) : []));
		},
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
	};
}

suite('GitLabApi.searchPullRequests repository scope', () => {
	test('searches only the requested project instead of the whole instance', async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const api = new GitLabApi(createProjectScopedFetch({ 'octo/repo': [restMR(1, 'opened')] }, requests));

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			repos: ['octo/repo'],
		});

		assert.deepEqual(
			results.map(pr => pr.id),
			['1'],
		);
		assert.deepEqual(
			requests.map(r => r.pathname),
			['/api/v4/projects/octo%2Frepo/search'],
		);
		assert.equal(requests[0].search.get('scope'), 'merge_requests');
		assert.equal(requests[0].search.get('search'), 'fix');
	});

	test('addresses a nested-namespace project by its whole URL-encoded full path', async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const api = new GitLabApi(
			createProjectScopedFetch({ 'group/sub/deeper/repo': [restMR(1, 'opened')] }, requests),
		);

		await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			repos: ['group/sub/deeper/repo'],
		});

		assert.deepEqual(
			requests.map(r => r.pathname),
			['/api/v4/projects/group%2Fsub%2Fdeeper%2Frepo/search'],
		);
	});

	test('searches each project once, interleaving results by relevance and dropping duplicates', async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const api = new GitLabApi(
			createProjectScopedFetch(
				{
					'octo/a': [restMR(1, 'opened'), restMR(2, 'opened'), restMR(3, 'opened')],
					'octo/b': [restMR(10, 'opened'), restMR(2, 'opened')],
				},
				requests,
			),
		);

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			repos: ['octo/a', 'octo/b', 'octo/a'],
		});

		assert.deepEqual(requests.map(r => r.pathname).sort(), [
			'/api/v4/projects/octo%2Fa/search',
			'/api/v4/projects/octo%2Fb/search',
		]);
		assert.deepEqual(
			results.map(pr => pr.id),
			['1', '10', '2', '3'],
		);
	});

	test('keeps the combined result within the single-search cap', async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const full = (base: number) => Array.from({ length: 20 }, (_, i) => restMR(base + i, 'opened'));
		const api = new GitLabApi(createProjectScopedFetch({ 'octo/a': full(100), 'octo/b': full(200) }, requests));

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			repos: ['octo/a', 'octo/b'],
		});

		assert.equal(results.length, 20);
		assert.deepEqual(
			results.slice(0, 4).map(pr => pr.id),
			['100', '200', '101', '201'],
		);
	});

	test('applies the state filter within each project', async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const api = new GitLabApi(
			createProjectScopedFetch(
				{
					'octo/a': [restMR(1, 'opened'), restMR(2, 'merged')],
					'octo/b': [restMR(3, 'merged'), restMR(4, 'closed')],
				},
				requests,
			),
		);

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			repos: ['octo/a', 'octo/b'],
			include: ['merged'],
		});

		assert.deepEqual(
			results.map(pr => pr.id),
			['2', '3'],
		);
		assert.ok(requests.every(r => r.search.get('state') === 'merged'));
	});

	test('skips a project that is gone and still returns the others', async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const api = new GitLabApi(
			createProjectScopedFetch({ 'octo/gone': 'not-found', 'octo/b': [restMR(3, 'opened')] }, requests),
		);

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			repos: ['octo/gone', 'octo/b'],
		});

		assert.deepEqual(
			results.map(pr => pr.id),
			['3'],
		);
	});

	test("keeps the other projects' matches when one project fails", async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const api = new GitLabApi(
			createProjectScopedFetch({ 'octo/a': 'bad-request', 'octo/b': [restMR(3, 'opened')] }, requests),
		);

		const results = await api.searchPullRequests(gitLabProvider, gitLabToken, {
			search: 'fix',
			repos: ['octo/a', 'octo/b'],
		});

		assert.deepEqual(
			results.map(pr => pr.id),
			['3'],
		);
	});

	test('rejects when every project fails rather than reporting no matches', async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const api = new GitLabApi(
			createProjectScopedFetch({ 'octo/a': 'bad-request', 'octo/b': 'bad-request' }, requests),
		);

		await assert.rejects(
			api.searchPullRequests(gitLabProvider, gitLabToken, { search: 'fix', repos: ['octo/a', 'octo/b'] }),
		);
	});

	test('searches the whole instance when no repositories are given', async () => {
		const requests: { pathname: string; search: URLSearchParams }[] = [];
		const api = new GitLabApi(createProjectScopedFetch({}, requests));

		await api.searchPullRequests(gitLabProvider, gitLabToken, { search: 'fix', repos: [] });

		assert.deepEqual(
			requests.map(r => r.pathname),
			['/api/v4/search/'],
		);
	});
});
