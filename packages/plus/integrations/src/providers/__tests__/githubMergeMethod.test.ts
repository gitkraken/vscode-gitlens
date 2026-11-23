import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequest, PullRequestMergeMethods } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { Emitter } from '@gitlens/utils/event.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import type { ProviderAuthenticationSession } from '../../authentication/models.js';
import { GitHubIntegration } from '../github.js';

const Merge = PullRequestMergeMethod.Merge;
const Squash = PullRequestMergeMethod.Squash;
const Rebase = PullRequestMergeMethod.Rebase;

const session: ProviderAuthenticationSession = {
	id: 'session-id',
	accessToken: 'token',
	account: { id: 'account-id', label: 'Test User' },
	scopes: [],
	cloud: true,
	type: undefined,
	domain: 'github.com',
	expiresAt: new Date(Date.now() + 60_000),
};

function createPullRequest(overrides?: { mergeQueueRequired?: boolean; stack?: { baseRef: string } }): PullRequest {
	return {
		id: '7',
		nodeId: 'PR_node',
		repository: { owner: 'gitkraken', repo: 'vscode-gitlens' },
		refs: { base: { branch: 'feature/below' }, head: { sha: 'abc123' } },
		mergeQueueRequired: overrides?.mergeQueueRequired,
		stack: overrides?.stack,
	} as unknown as PullRequest;
}

function setup(methods: PullRequestMergeMethods | undefined | Error): {
	integration: GitHubIntegration;
	reads: { key: string; owner: string; repo: string; branch: string }[];
	sent: { stacked: boolean; mergeMethod: PullRequestMergeMethod | undefined }[];
} {
	const reads: { key: string; owner: string; repo: string; branch: string }[] = [];
	const sent: { stacked: boolean; mergeMethod: PullRequestMergeMethod | undefined }[] = [];
	const runtime = createFakeRuntime();
	runtime.cache.getRepositoryMergeMethods = (repo: ResourceDescriptor, branch, _integration, loader) => {
		reads.push({ key: repo.key, owner: String(repo.owner), repo: String(repo.name), branch: branch });
		return loader({ invalidate: () => {} } as never).value;
	};

	const api = {
		getMergeMethodsForBranch: async () => {
			if (methods instanceof Error) throw methods;

			return methods;
		},
		mergePullRequest: async (
			_provider: unknown,
			_token: unknown,
			_id: string,
			_sha: string,
			options?: { mergeMethod?: PullRequestMergeMethod },
		) => {
			sent.push({ stacked: false, mergeMethod: options?.mergeMethod });
			return true;
		},
		mergeStackedPullRequest: async (
			_provider: unknown,
			_token: unknown,
			_owner: string,
			_repo: string,
			_number: number,
			_sha: string,
			options?: { mergeMethod?: PullRequestMergeMethod },
		) => {
			sent.push({ stacked: true, mergeMethod: options?.mergeMethod });
			return true;
		},
	};

	const integration = new GitHubIntegration(
		runtime,
		{ apis: { github: Promise.resolve(api) } } as never,
		async () => undefined as never,
		new Emitter(),
	);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = session;
	return { integration: integration, reads: reads, sent: sent };
}

suite('GitHubIntegration.mergePullRequest merge method', () => {
	test('sends the base branch preselected method when the caller omits one', async () => {
		const { integration, reads, sent } = setup({ allowed: [Squash, Rebase], default: Rebase });

		assert.equal(await integration.mergePullRequest(createPullRequest()), true);

		assert.deepEqual(sent, [{ stacked: false, mergeMethod: Rebase }]);
		assert.deepEqual(reads, [
			{
				key: 'github.com/gitkraken/vscode-gitlens',
				owner: 'gitkraken',
				repo: 'vscode-gitlens',
				branch: 'feature/below',
			},
		]);
	});

	test('sends the caller method without a read when the base is known not to queue', async () => {
		const { integration, reads, sent } = setup({ allowed: [Squash, Rebase], default: Rebase });

		await integration.mergePullRequest(createPullRequest({ mergeQueueRequired: false }), { mergeMethod: Squash });

		assert.deepEqual(sent, [{ stacked: false, mergeMethod: Squash }]);
		assert.equal(reads.length, 0);
	});

	test('sends no method on a base with a merge queue', async () => {
		const { integration, sent } = setup({ allowed: [Merge, Squash, Rebase], default: Merge, queue: Squash });

		await integration.mergePullRequest(createPullRequest());

		assert.deepEqual(sent, [{ stacked: false, mergeMethod: undefined }]);
	});

	test('drops an explicit method on a base with a merge queue', async () => {
		const { integration, sent } = setup({ allowed: [Merge, Squash, Rebase], default: Merge, queue: Squash });

		await integration.mergePullRequest(createPullRequest(), { mergeMethod: Rebase });

		assert.deepEqual(sent, [{ stacked: false, mergeMethod: undefined }]);
	});

	test('drops an explicit method without a read when the pull request requires the queue', async () => {
		const { integration, reads, sent } = setup({ allowed: [Merge], default: Merge });

		await integration.mergePullRequest(createPullRequest({ mergeQueueRequired: true }), { mergeMethod: Merge });

		assert.deepEqual(sent, [{ stacked: false, mergeMethod: undefined }]);
		assert.equal(reads.length, 0);
	});

	test('sends no method when the methods are unknown', async () => {
		const { integration, sent } = setup(undefined);

		assert.equal(await integration.mergePullRequest(createPullRequest()), true);

		assert.deepEqual(sent, [{ stacked: false, mergeMethod: undefined }]);
	});

	test('a failed read still merges, sending no method', async () => {
		const { integration, sent } = setup(new Error('boom'));

		assert.equal(await integration.mergePullRequest(createPullRequest()), true);

		assert.deepEqual(sent, [{ stacked: false, mergeMethod: undefined }]);
	});

	test('a stack resolves against its trunk, ignoring the layer below', async () => {
		const { integration, reads, sent } = setup({ allowed: [Squash, Rebase], default: Squash });

		await integration.mergePullRequest(
			createPullRequest({ mergeQueueRequired: false, stack: { baseRef: 'main' } }),
		);

		assert.deepEqual(sent, [{ stacked: true, mergeMethod: Squash }]);
		assert.deepEqual(
			reads.map(r => r.branch),
			['main'],
		);
	});

	test('a stack into a merge-queue trunk sends no method, even an explicit one', async () => {
		const { integration, sent } = setup({ allowed: [Merge, Squash, Rebase], default: Merge, queue: Squash });

		await integration.mergePullRequest(
			createPullRequest({ mergeQueueRequired: false, stack: { baseRef: 'main' } }),
			{ mergeMethod: Merge },
		);

		assert.deepEqual(sent, [{ stacked: true, mergeMethod: undefined }]);
	});
});
