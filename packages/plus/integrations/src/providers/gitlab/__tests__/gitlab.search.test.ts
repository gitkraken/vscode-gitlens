import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { TokenWithInfo } from '../../../authentication/models.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { GitLabApi } from '../gitlab.js';
import type { GitLabMergeRequestREST, GitLabMergeRequestState } from '../models.js';

const provider = {
	id: 'gitlab',
	name: 'GitLab',
	domain: 'gitlab.com',
	icon: 'gitlab',
	getIgnoreSSLErrors: () => false,
	reauthenticate: () => Promise.resolve(),
	trackRequestException: () => {},
} as unknown as Provider;

const token = { accessToken: 'token', microHash: 'hash' } as unknown as TokenWithInfo;

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

		const results = await api.searchPullRequests(provider, token, { search: 'fix', include: ['merged'] });

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

		await api.searchPullRequests(provider, token, { search: 'fix' });

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

		const results = await api.searchPullRequests(provider, token, { search: 'fix', include: ['merged'] });

		assert.deepEqual(
			results.map(pr => pr.id),
			['601'],
		);
		assert.deepEqual(requestedPages, [1, 2, 3, 4, 5, 6, 7]);
	});
});
