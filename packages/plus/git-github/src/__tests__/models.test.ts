import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../api/config.js';
import { GitHubApi } from '../api/github.js';
import type { GitHubTokenInfo } from '../api/token.js';
import type { GitHubIssue } from '../models.js';
import { fromGitHubIssue } from '../models.js';

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

	test('maps a present author unchanged', () => {
		const issue = fromGitHubIssue(createIssue(1, member), provider);

		assert.deepEqual(issue.author, {
			id: 'eamodio',
			name: 'eamodio',
			avatarUrl: 'https://avatars/eamodio',
			url: 'https://github.com/eamodio',
		});
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
