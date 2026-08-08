import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../api/config.js';
import { GitHubApi } from '../api/github.js';
import type { GitHubTokenInfo } from '../api/token.js';
import type { GitHubIssue, GitHubPullRequestLite } from '../models.js';
import { fromGitHubIssue, fromGitHubPullRequestLite } from '../models.js';

/**
 * GitHub's GraphQL `Issue.author` is an `Actor` and is nullable — it comes back `null` once the
 * author's account is deleted. Mapping it unguarded threw a `TypeError` that discarded every issue
 * in the response, which surfaced as "No issues found" plus a prompt to connect an integration.
 */

const provider: Provider = {
	id: 'github',
	name: 'GitHub',
	domain: 'github.com',
	icon: 'github',
	getIgnoreSSLErrors: () => false,
	reauthenticate: () => Promise.resolve(),
	trackRequestException: () => {},
};

const token: GitHubTokenInfo = {
	providerId: 'github',
	accessToken: 'token',
	cloud: false,
	type: 'pat',
};

function createIssue(number: number, author: GitHubIssue['author']): GitHubIssue {
	return {
		id: `issue-${number}`,
		number: number,
		title: `Issue ${number}`,
		url: `https://github.com/gitkraken/vscode-gitlens/issues/${number}`,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T00:00:00Z',
		closed: false,
		closedAt: null,
		state: 'OPEN',
		author: author,
		assignees: { nodes: [] },
		repository: {
			name: 'vscode-gitlens',
			owner: { login: 'gitkraken' },
			viewerPermission: 'ADMIN',
			url: 'https://github.com/gitkraken/vscode-gitlens',
		},
		body: '',
	} as unknown as GitHubIssue;
}

const member = { login: 'eamodio', avatarUrl: 'https://avatars/eamodio', url: 'https://github.com/eamodio' };

suite('fromGitHubIssue', () => {
	test('maps a null author to undefined rather than throwing', () => {
		const issue = fromGitHubIssue(createIssue(2701, null), provider);

		assert.equal(issue.author, undefined, 'a deleted account yields no author');
		assert.equal(issue.id, '2701', 'the rest of the issue still maps');
		assert.equal(issue.title, 'Issue 2701');
	});

	test('maps a present author unchanged, carrying the login as the username', () => {
		const issue = fromGitHubIssue(createIssue(1, member), provider);

		assert.deepEqual(issue.author, {
			id: 'eamodio',
			name: 'eamodio',
			username: 'eamodio',
			avatarUrl: 'https://avatars/eamodio',
			url: 'https://github.com/eamodio',
		});
	});
});

/**
 * `stack`/`stackEntry` are only selected against github.com — GitHub Enterprise Server schemas lag and
 * reject the fields — so the mapper sees them absent (Enterprise), `null` (github.com, unstacked), or
 * populated. Only the last case may produce stack info.
 */
function createPullRequest(stack?: Pick<GitHubPullRequestLite, 'stack' | 'stackEntry'>): GitHubPullRequestLite {
	return {
		id: 'pr-5702',
		number: 5702,
		title: 'Route stacked merges through merge-async',
		url: 'https://github.com/gitkraken/vscode-gitlens/pull/5702',
		permalink: 'https://github.com/gitkraken/vscode-gitlens/pull/5702',
		createdAt: '2026-07-30T00:00:00Z',
		updatedAt: '2026-07-30T01:00:00Z',
		closed: false,
		closedAt: null,
		mergedAt: null,
		state: 'OPEN',
		isDraft: false,
		isCrossRepository: false,
		author: member,
		baseRefName: 'feature/stacks-model',
		baseRefOid: 'b21f904',
		headRefName: 'feature/stacks-merge',
		headRefOid: '7d5bdd3',
		headRepository: {
			isFork: false,
			name: 'vscode-gitlens',
			owner: { login: 'gitkraken' },
			sshUrl: 'git@github.com:gitkraken/vscode-gitlens.git',
			url: 'https://github.com/gitkraken/vscode-gitlens',
		},
		repository: {
			isFork: false,
			name: 'vscode-gitlens',
			owner: { login: 'gitkraken' },
			sshUrl: 'git@github.com:gitkraken/vscode-gitlens.git',
			url: 'https://github.com/gitkraken/vscode-gitlens',
			viewerPermission: 'ADMIN',
		},
		...stack,
	} as unknown as GitHubPullRequestLite;
}

suite('fromGitHubPullRequestLite stack mapping', () => {
	test('maps a stacked pull request to its layer', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequest({
				stack: { id: 'stack-7', number: 7, size: 3, baseRefName: 'main' },
				stackEntry: { position: 2 },
			}),
			provider,
		);

		assert.deepEqual(pr.stack, { id: 'stack-7', number: 7, size: 3, position: 2, baseRef: 'main' });
	});

	test('keeps the stack base distinct from the pull request base', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequest({
				stack: { id: 'stack-7', number: 7, size: 3, baseRefName: 'main' },
				stackEntry: { position: 2 },
			}),
			provider,
		);

		// `refs.base` is the layer below (what this layer diffs against); `stack.baseRef` is the trunk.
		assert.equal(pr.refs?.base.branch, 'feature/stacks-model');
		assert.equal(pr.stack?.baseRef, 'main');
	});

	test('leaves an unstacked pull request without stack info', () => {
		const pr = fromGitHubPullRequestLite(createPullRequest({ stack: null, stackEntry: null }), provider);

		assert.equal(pr.stack, undefined);
	});

	test('leaves stack info off when the fields were never selected (Enterprise)', () => {
		const pr = fromGitHubPullRequestLite(createPullRequest(), provider);

		assert.equal(pr.stack, undefined);
	});

	test('requires both halves — a stack without an entry has no position to report', () => {
		const pr = fromGitHubPullRequestLite(
			createPullRequest({ stack: { id: 'stack-7', number: 7, size: 3, baseRefName: 'main' }, stackEntry: null }),
			provider,
		);

		assert.equal(pr.stack, undefined);
	});
});

suite('GitHubApi.searchMyIssues', () => {
	const config: GitHubApiConfig = {
		isWeb: false,
		fetch: () => Promise.reject(new Error('no network in tests')),
		wrapForForcedInsecureSSL: (_ignoreSSLErrors, fn) => fn(),
	};

	/** Stubs the private `graphql` so the search maps a canned response without any network access */
	function createApi(response: unknown): GitHubApi {
		const api = new GitHubApi(config);
		(api as unknown as { graphql: () => Promise<unknown> }).graphql = () => Promise.resolve(response);
		return api;
	}

	test('keeps the other issues when one node is unmappable', async () => {
		const api = createApi({
			authored: { nodes: [createIssue(1, member)] },
			assigned: { nodes: [createIssue(2, member)] },
			// A node that blows up in the mapper must not take the batch down with it
			mentioned: { nodes: [{ id: 'issue-3', number: 3, url: 'https://github.com/o/r/issues/3' }] },
		});

		const issues = await api.searchMyIssues(provider, token);

		assert.deepEqual(
			issues?.map(i => i.id),
			['2', '1'],
			'the unmappable node is skipped, the rest survive',
		);

		api.dispose();
	});

	test('maps a ghost-authored issue instead of discarding the batch', async () => {
		const api = createApi({
			authored: { nodes: [createIssue(1, member)] },
			assigned: { nodes: [] },
			mentioned: { nodes: [createIssue(2701, null)] },
		});

		const issues = await api.searchMyIssues(provider, token);

		assert.deepEqual(
			issues?.map(i => i.id),
			['2701', '1'],
			'a null author no longer discards every issue in the response',
		);
		assert.equal(issues?.find(i => i.id === '2701')?.author, undefined);

		api.dispose();
	});

	test('tolerates a nulled alias and null nodes', async () => {
		const api = createApi({
			authored: null,
			assigned: { nodes: null },
			mentioned: { nodes: [null, createIssue(1, member)] },
		});

		const issues = await api.searchMyIssues(provider, token);

		assert.deepEqual(
			issues?.map(i => i.id),
			['1'],
		);

		api.dispose();
	});
});
