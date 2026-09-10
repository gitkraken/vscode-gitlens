import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { stubApi } from '../../__tests__/sweepHelpers.js';
import type { ProviderAuthenticationSession } from '../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationService as createIntegrationManager } from '../../integrationService.js';
import type { AccountWideIssuesResult } from '../../models/integration.js';
import type { GitLabRepositoryDescriptor } from '../gitlab.js';

/**
 * `GitLabIntegrationBase.searchProviderMyIssues` (#branch fix): without `repos` to scope to, GitLab has no
 * repo-scoped read to fall back to, so it must hand off to the account-wide read
 * ({@link searchProviderMyIssuesWithTruncation}) instead of returning `undefined` — which is what made
 * Start Work with no repository open show no GitLab issues. This suite covers that routing decision
 * directly (both `repos` is `undefined` and `repos` is `[]`), the regression guard that a non-empty
 * `repos` still takes the repo-scoped path, and that the cancellation signal is forwarded to the
 * account-wide read.
 *
 * `searchProviderMyIssues` is `protected`; reached via a narrow cast, matching the idiom already used by
 * `accountWideIssueReadSeam.test.ts` for `searchMyIssuesWithTruncationResult`.
 */

type GitLabSearchHarness = {
	searchProviderMyIssues: (
		session: ProviderAuthenticationSession,
		repos?: GitLabRepositoryDescriptor[],
		cancellation?: AbortSignal,
	) => Promise<IssueShape[] | undefined>;
	searchProviderMyIssuesWithTruncation: (
		session: ProviderAuthenticationSession,
		repos?: GitLabRepositoryDescriptor[],
		cancellation?: AbortSignal,
	) => Promise<AccountWideIssuesResult | undefined>;
};

const session: ProviderAuthenticationSession = {
	id: 'primary',
	accessToken: 'token',
	account: { id: 'me', label: 'me' },
	scopes: ['api'],
	cloud: true,
	type: 'oauth',
	domain: 'gitlab.com',
};

const repo: GitLabRepositoryDescriptor = { key: 'octo/repo', owner: 'octo', name: 'repo' };

async function createGitLabHarness(): Promise<{ gl: GitLabSearchHarness; dispose: () => void }> {
	const runtime = createFakeRuntime();
	const manager = createIntegrationManager(runtime);
	const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
	// The repo-scoped path (non-empty `repos`) reaches provider-apis via `getProvidersApi`; stub it so that
	// path, when taken, resolves quickly instead of attempting a real network call.
	stubApi(gl, { getIssuesForRepos: () => Promise.resolve({ values: [] }) });
	return { gl: gl as unknown as GitLabSearchHarness, dispose: () => manager.dispose() };
}

function stubTruncation(gl: GitLabSearchHarness): {
	calls: Array<{
		session: ProviderAuthenticationSession;
		repos: GitLabRepositoryDescriptor[] | undefined;
		cancellation: AbortSignal | undefined;
	}>;
} {
	const calls: Array<{
		session: ProviderAuthenticationSession;
		repos: GitLabRepositoryDescriptor[] | undefined;
		cancellation: AbortSignal | undefined;
	}> = [];
	gl.searchProviderMyIssuesWithTruncation = (s, r, c) => {
		calls.push({ session: s, repos: r, cancellation: c });
		return Promise.resolve({ values: [{ id: 'account-wide-1' } as unknown as IssueShape], truncated: false });
	};

	return { calls: calls };
}

suite('GitLabIntegrationBase.searchProviderMyIssues routing (Start Work with no repository open)', () => {
	test('repos undefined delegates to the account-wide read and returns its values', async () => {
		const { gl, dispose } = await createGitLabHarness();
		try {
			const { calls } = stubTruncation(gl);

			const result = await gl.searchProviderMyIssues(session, undefined, undefined);

			assert.equal(calls.length, 1, 'the account-wide read was invoked exactly once');
			assert.deepEqual(result, [{ id: 'account-wide-1' }], 'the account-wide read values are returned unchanged');
		} finally {
			dispose();
		}
	});

	test('repos as an empty array delegates to the account-wide read and returns its values', async () => {
		const { gl, dispose } = await createGitLabHarness();
		try {
			const { calls } = stubTruncation(gl);

			const result = await gl.searchProviderMyIssues(session, [], undefined);

			assert.equal(calls.length, 1, 'the account-wide read was invoked exactly once');
			assert.deepEqual(result, [{ id: 'account-wide-1' }], 'the account-wide read values are returned unchanged');
		} finally {
			dispose();
		}
	});

	test('repos non-empty does not delegate to the account-wide read', async () => {
		const { gl, dispose } = await createGitLabHarness();
		try {
			const { calls } = stubTruncation(gl);

			await gl.searchProviderMyIssues(session, [repo], undefined);

			assert.equal(calls.length, 0, 'the account-wide read was not invoked for a repo-scoped search');
		} finally {
			dispose();
		}
	});

	test('the cancellation signal is forwarded to the account-wide read', async () => {
		const { gl, dispose } = await createGitLabHarness();
		try {
			const { calls } = stubTruncation(gl);
			const controller = new AbortController();

			await gl.searchProviderMyIssues(session, undefined, controller.signal);

			assert.equal(calls.length, 1, 'the account-wide read was invoked exactly once');
			assert.equal(
				calls[0].cancellation,
				controller.signal,
				'the same AbortSignal instance reaches the account-wide read',
			);
		} finally {
			dispose();
		}
	});
});
