import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';
import { gitHubPullRequestLite } from './fixtures.js';

/**
 * The read tag each GitLens-native read stamps. Every issue read's field presence assumes the body was selected, so
 * an issue read without `includeBody` must stay untagged rather than claim a description it never fetched.
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

const issueNode = {
	id: 'I_1',
	number: 1,
	title: 'Issue 1',
	url: 'https://github.com/o/r/issues/1',
	state: 'OPEN',
	closed: false,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-02T00:00:00Z',
	closedAt: null,
	author: null,
	assignees: { nodes: [] },
	comments: { totalCount: 0 },
	labels: { nodes: [] },
	reactions: { totalCount: 0 },
	repository: { name: 'r', owner: { login: 'o' }, viewerPermission: 'READ', url: 'https://github.com/o/r' },
	body: 'Body',
};

const pullRequestNode = gitHubPullRequestLite(
	1,
	{
		id: 'PR_1',
		body: '',
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T00:00:00Z',
		author: null,
		baseRefOid: 'base',
		headRepository: { isFork: false, name: 'r', owner: { login: 'o' }, sshUrl: '', url: 'https://github.com/o/r' },
		repository: {
			isFork: false,
			name: 'r',
			owner: { login: 'o' },
			sshUrl: '',
			url: 'https://github.com/o/r',
			viewerPermission: 'READ',
		},
	},
	{ owner: 'o', name: 'r' },
);

/** Answers every request with `data(query)`. */
function api(data: (query: string) => unknown): GitHubApi {
	return new GitHubApi({
		isWeb: false,
		fetch: (_url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as { query: string };
			return Promise.resolve(
				new Response(JSON.stringify({ data: data(body.query) }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			);
		},
		wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
	} as unknown as GitHubApiConfig);
}

suite('GitHubApi read tags', () => {
	test('the issue point read is tagged only when it selects the body', async () => {
		const github = api(() => ({ repository: { issue: issueNode } }));

		const withBody = await github.getIssue(provider, token, 'o', 'r', 1, { includeBody: true });
		const withoutBody = await github.getIssue(provider, token, 'o', 'r', 1);

		assert.strictEqual(withBody?.projection, 'point');
		assert.strictEqual(withoutBody?.projection, undefined);
	});

	test('the issue batch and searches are tagged only when they select the body', async () => {
		const github = api(query =>
			query.startsWith('query getIssuesBatch(')
				? { i0: { issue: issueNode } }
				: Object.fromEntries(
						Array.from(query.matchAll(/^\s*(\w+): search\(/gm), m => [
							m[1],
							{ issueCount: 1, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [issueNode] },
						]),
					),
		);
		const coordinates = [{ owner: 'o', repo: 'r', number: 1 }];

		for (const includeBody of [true, false]) {
			const [batch] = await github.getIssuesBatch(provider, token, coordinates, { includeBody: includeBody });
			const searched = await github.searchIssuesPage(provider, token, {
				repos: ['o/r'],
				includeBody: includeBody,
			});
			const mine = await github.searchMyIssues(provider, token, { includeBody: includeBody });

			assert.strictEqual(batch.status, 'fulfilled');
			assert.strictEqual(batch.value?.projection, includeBody ? 'batch' : undefined);
			assert.strictEqual(searched?.values[0]?.projection, includeBody ? 'search' : undefined);
			assert.strictEqual(mine?.values[0]?.projection, includeBody ? 'account' : undefined);
		}
	});

	test('the pull request reads follow their projection', async () => {
		const github = api(query =>
			query.startsWith('query getPullRequest(')
				? { repository: { pullRequest: pullRequestNode } }
				: {
						search: {
							issueCount: 1,
							pageInfo: { endCursor: null, hasNextPage: false },
							nodes: [pullRequestNode],
						},
					},
		);

		const point = await github.getPullRequest(provider, token, 'o', 'r', 1);
		const summary = await github.searchMyPullRequestsPage(provider, token, { summary: true });

		assert.strictEqual(point?.projection, 'point');
		assert.strictEqual(summary.values[0]?.projection, 'search-summary');
	});
});
