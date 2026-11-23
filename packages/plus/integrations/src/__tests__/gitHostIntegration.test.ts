import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethods,
	PullRequestMergeQueueActionResult,
} from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationKey } from '../models/publicIntegration.js';
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

type MergeQueueHook = (
	session: ProviderAuthenticationSession,
	pr: PullRequest,
	cancellation?: AbortSignal,
) => Promise<PullRequestMergeQueueActionResult>;

/** {@link FakeGitHostIntegration} with the merge-queue hooks a host implements only when it can act on its queue. */
class FakeMergeQueueGitHostIntegration extends FakeGitHostIntegration {
	readonly handledExceptions: Error[] = [];

	constructor(
		ctx: IntegrationServiceContext,
		private readonly enqueue: MergeQueueHook,
		private readonly dequeue: MergeQueueHook,
	) {
		super(ctx, false);
	}

	protected override enqueueProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		cancellation?: AbortSignal,
	): Promise<PullRequestMergeQueueActionResult> {
		return this.enqueue(session, pr, cancellation);
	}

	protected override dequeueProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		cancellation?: AbortSignal,
	): Promise<PullRequestMergeQueueActionResult> {
		return this.dequeue(session, pr, cancellation);
	}

	protected override handleProviderException(
		syncReqUsecase: Parameters<FakeGitHostIntegration['requestSessionSyncForUsecase']>[0],
		ex: Error,
		options?: {
			scope?: ScopedLogger | undefined;
			silent?: boolean;
			connectionId?: string;
		},
	): boolean {
		this.handledExceptions.push(ex);
		return super.handleProviderException(syncReqUsecase, ex, options);
	}
}

suite('GitHostIntegration merge-queue actions', () => {
	const pr = {} as unknown as PullRequest;
	const never: MergeQueueHook = () => Promise.reject(new Error('not called'));

	test('a host without a merge queue answers unsupported, without asking it', async () => {
		const runtime = createFakeRuntime();
		const integration = new FakeGitHostIntegration(runtime, false);

		assert.deepEqual(await integration.enqueuePullRequest(pr), {
			status: 'failed',
			reason: 'unsupported',
		});
		assert.deepEqual(await integration.dequeuePullRequest(pr), {
			status: 'failed',
			reason: 'unsupported',
		});
	});

	test("passes the host's answer through, success or refusal, and evicts the pull requests cache each time", async () => {
		const runtime = createFakeRuntime();
		const seen: { session: string; pr: PullRequest }[] = [];
		const integration = new FakeMergeQueueGitHostIntegration(
			runtime,
			(session, p) => {
				seen.push({ session: session.accessToken, pr: p });
				return Promise.resolve({ status: 'queued' });
			},
			() =>
				Promise.resolve({
					status: 'failed',
					reason: 'permission',
					message: 'Must have admin rights',
				}),
		);

		assert.deepEqual(await integration.enqueuePullRequest(pr), {
			status: 'queued',
		});
		assert.deepEqual(seen, [{ session: 'fake', pr: pr }], 'the connected session and the given pull request');
		assert.deepEqual(await integration.dequeuePullRequest(pr), {
			status: 'failed',
			reason: 'permission',
			message: 'Must have admin rights',
		});
		assert.equal(runtime.deletePullRequestsCalls, 2);
		assert.equal(integration.handledExceptions.length, 0, 'a refusal is an answer, not a failed request');
	});

	test("a request that fails is unknown, carrying its message, and runs the integration's failure handling", async () => {
		const runtime = createFakeRuntime();
		const failure = new Error('socket hang up');
		const integration = new FakeMergeQueueGitHostIntegration(runtime, () => Promise.reject(failure), never);

		assert.deepEqual(await integration.enqueuePullRequest(pr), {
			status: 'failed',
			reason: 'unknown',
			message: 'socket hang up',
		});
		assert.deepEqual(integration.handledExceptions, [failure]);
		assert.equal(runtime.deletePullRequestsCalls, 1);
	});

	test('cancellation still throws', async () => {
		const runtime = createFakeRuntime();
		const integration = new FakeMergeQueueGitHostIntegration(runtime, never, () =>
			Promise.reject(new CancellationError()),
		);

		await assert.rejects(integration.dequeuePullRequest(pr), (ex: unknown) => isCancellationError(ex));
		assert.equal(integration.handledExceptions.length, 0);
	});
});

type MergeMethodsHook = (
	session: ProviderAuthenticationSession,
	repo: ResourceDescriptor,
	branch: string,
	cancellation?: AbortSignal,
) => Promise<PullRequestMergeMethods | undefined>;

/** {@link FakeGitHostIntegration} with the merge-methods hook a host implements only when it can read one. */
class FakeMergeMethodsGitHostIntegration extends FakeGitHostIntegration {
	constructor(
		ctx: IntegrationServiceContext,
		private readonly read: MergeMethodsHook,
	) {
		super(ctx, false);
	}

	protected override getProviderMergeMethods(
		session: ProviderAuthenticationSession,
		repo: ResourceDescriptor,
		branch: string,
		cancellation?: AbortSignal,
	): Promise<PullRequestMergeMethods | undefined> {
		return this.read(session, repo, branch, cancellation);
	}
}

suite('GitHostIntegration.getMergeMethods', () => {
	const repo: ResourceDescriptor = { key: 'o/r' };
	const methods: PullRequestMergeMethods = {
		allowed: [PullRequestMergeMethod.Squash, PullRequestMergeMethod.Rebase],
		default: PullRequestMergeMethod.Squash,
	};

	function track(runtime: ReturnType<typeof createFakeRuntime>): {
		reads: CacheController[];
		branches: string[];
	} {
		const reads: CacheController[] = [];
		const branches: string[] = [];
		runtime.cache.getRepositoryMergeMethods = (_repo, branch, _integration, loader) => {
			branches.push(branch);
			const cacheable = new CacheController();
			reads.push(cacheable);
			return loader(cacheable).value;
		};
		return { reads: reads, branches: branches };
	}

	test('a host without the hook answers unknown, without a session lookup or a cache read', async () => {
		const runtime = createFakeRuntime();
		const { branches } = track(runtime);
		let lookups = 0;
		class Unhooked extends FakeGitHostIntegration {
			protected override prepareSessionLookup(): ReturnType<FakeGitHostIntegration['prepareSessionLookup']> {
				lookups++;
				return super.prepareSessionLookup();
			}
		}
		const integration = new Unhooked(runtime, false);

		assert.equal(await integration.getMergeMethods(repo, 'main'), undefined);
		assert.equal(lookups, 0);
		assert.deepEqual(branches, []);
	});

	test("reads through the cache keyed by branch, passing the connected session and the caller's cancellation", async () => {
		const runtime = createFakeRuntime();
		const { reads, branches } = track(runtime);
		const seen: { session: string; repo: ResourceDescriptor; branch: string; cancellation?: AbortSignal }[] = [];
		const integration = new FakeMergeMethodsGitHostIntegration(runtime, (session, r, branch, cancellation) => {
			seen.push({ session: session.accessToken, repo: r, branch: branch, cancellation: cancellation });
			return Promise.resolve(methods);
		});
		const aborter = new AbortController();

		assert.equal(await integration.getMergeMethods(repo, 'release', { cancellation: aborter.signal }), methods);
		assert.deepEqual(branches, ['release']);
		assert.deepEqual(seen, [{ session: 'fake', repo: repo, branch: 'release', cancellation: aborter.signal }]);
		assert.deepEqual(
			reads.map(r => r.invalidated),
			[false],
		);
	});

	test('a failed read is unknown and is not kept in the cache', async () => {
		const runtime = createFakeRuntime();
		const { reads } = track(runtime);
		const integration = new FakeMergeMethodsGitHostIntegration(runtime, () =>
			Promise.reject(new Error('socket hang up')),
		);

		assert.equal(await integration.getMergeMethods(repo, 'main'), undefined);
		assert.deepEqual(
			reads.map(r => r.invalidated),
			[true],
		);
	});

	test("a canceled read's empty answer is not kept in the cache", async () => {
		const runtime = createFakeRuntime();
		const { reads } = track(runtime);
		const integration = new FakeMergeMethodsGitHostIntegration(runtime, () => Promise.resolve(undefined));
		const aborter = new AbortController();
		aborter.abort();

		assert.equal(await integration.getMergeMethods(repo, 'main', { cancellation: aborter.signal }), undefined);
		assert.deepEqual(
			reads.map(r => r.invalidated),
			[true],
		);
	});
});
