import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationKey } from '../models/integration.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Minimal `GitHostIntegration` subclass for exercising the base class's `mergePullRequest` eviction
 * contract without resolving a real session — `mergeProviderPullRequest` is the only member that call
 * path touches, so every other abstract member is an unexercised throwing stub.
 */
class FakeGitHostIntegration extends GitHostIntegration<GitCloudHostIntegrationId.GitHub> {
	readonly id = GitCloudHostIntegrationId.GitHub;

	get authProvider(): IntegrationAuthenticationProviderDescriptor {
		throw new Error('not implemented in test');
	}

	protected get key(): IntegrationKey<GitCloudHostIntegrationId.GitHub> {
		throw new Error('not implemented in test');
	}

	get name(): string {
		throw new Error('not implemented in test');
	}

	get domain(): string {
		throw new Error('not implemented in test');
	}

	constructor(
		ctx: IntegrationServiceContext,
		private readonly mergeResult: boolean,
	) {
		super(ctx, undefined as never, undefined as never, new Emitter());
		// No expiry and a GitHub id skips both branches of `refreshSessionIfExpired`, so this needs no
		// real auth/session resolution to reach `mergeProviderPullRequest`.
		const session: ProviderAuthenticationSession = {
			id: 'fake',
			accessToken: 'fake',
			account: { id: 'fake', label: 'fake' },
			scopes: [],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
		};
		this._session = session;
	}

	protected override mergeProviderPullRequest(): Promise<boolean> {
		return Promise.resolve(this.mergeResult);
	}

	protected override getProviderAccountForEmail(): Promise<Account | undefined> {
		throw new Error('not implemented in test');
	}

	protected override getProviderAccountForCommit(): Promise<Account | UnidentifiedAuthor | undefined> {
		throw new Error('not implemented in test');
	}

	protected override getProviderDefaultBranch(): Promise<DefaultBranch | undefined> {
		throw new Error('not implemented in test');
	}

	protected override getProviderRepositoryMetadata(): Promise<RepositoryMetadata | undefined> {
		throw new Error('not implemented in test');
	}

	protected override getProviderPullRequestForBranch(): Promise<PullRequest | undefined> {
		throw new Error('not implemented in test');
	}

	protected override getProviderPullRequestForCommit(): Promise<PullRequest | undefined> {
		throw new Error('not implemented in test');
	}

	protected override searchProviderMyPullRequests(): Promise<PullRequest[] | undefined> {
		throw new Error('not implemented in test');
	}

	protected override searchProviderMyIssues(): Promise<IssueShape[] | undefined> {
		throw new Error('not implemented in test');
	}

	protected override getProviderLinkedIssueOrPullRequest(): Promise<IssueOrPullRequest | undefined> {
		throw new Error('not implemented in test');
	}

	protected override getProviderIssue(): Promise<Issue | undefined> {
		throw new Error('not implemented in test');
	}
}

suite('GitHostIntegration.mergePullRequest — cache eviction', () => {
	test('a successful merge evicts the pull requests cache exactly once', async () => {
		const runtime = createFakeRuntime();
		const integration = new FakeGitHostIntegration(runtime, true);

		const merged = await integration.mergePullRequest({} as unknown as PullRequest);

		assert.equal(merged, true);
		assert.equal(runtime.deletePullRequestsCalls, 1, 'evicts the pull requests cache exactly once');
	});

	test('a failed merge still evicts the pull requests cache exactly once', async () => {
		const runtime = createFakeRuntime();
		const integration = new FakeGitHostIntegration(runtime, false);

		const merged = await integration.mergePullRequest({} as unknown as PullRequest);

		assert.equal(merged, false);
		assert.equal(
			runtime.deletePullRequestsCalls,
			1,
			'a failed attempt can still land partial server-side state, so it evicts too',
		);
	});
});
