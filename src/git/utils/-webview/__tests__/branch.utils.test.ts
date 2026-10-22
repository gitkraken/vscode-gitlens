import * as assert from 'assert';
import * as sinon from 'sinon';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { MergeTarget, MergeTargetOptions } from '@gitlens/git/providers/branches.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { Container } from '../../../../container.js';
import { getBranchMergeTarget } from '../branch.utils.js';

suite('git/-webview/branch.utils', () => {
	suite('getBranchMergeTarget', () => {
		const branch = { repoPath: '/repo', name: 'feature', remoteName: 'origin' } as unknown as GitBranch;
		const noPullRequestTarget: MergeTarget = { ref: 'origin/default', forkPoint: 'aaa', tier: 'default' };
		const pullRequestTarget: MergeTarget = { ref: 'origin/main', forkPoint: 'bbb', tier: 'pr' };

		let getMergeTarget: sinon.SinonStub;
		let getRemote: sinon.SinonStub;
		let container: Container;

		function optionsOf(call: number): MergeTargetOptions {
			return getMergeTarget.getCall(call).args[1] as MergeTargetOptions;
		}

		function pullRequest(): PullRequest {
			return { refs: { base: { branch: 'main' } } } as unknown as PullRequest;
		}

		// Answers like core does: the pull request's base wins when there is one
		function answerFromPullRequest(): void {
			getMergeTarget.callsFake(async (_name: string, options: MergeTargetOptions) => {
				const pr = await options.getAssociatedPullRequest?.();
				return pr?.refs?.base != null ? pullRequestTarget : noPullRequestTarget;
			});
		}

		setup(() => {
			getMergeTarget = sinon.stub().resolves(noPullRequestTarget);
			getRemote = sinon.stub().resolves(undefined);

			const svc = { branches: { getMergeTarget: getMergeTarget }, remotes: { getRemote: getRemote } };
			container = { git: { getRepositoryService: () => svc } } as unknown as Container;
		});

		teardown(() => {
			sinon.restore();
		});

		test('looks the target up by branch name with the base inferred and the default read from the remote', async () => {
			const result = await getBranchMergeTarget(container, branch);

			assert.deepStrictEqual(result, { target: noPullRequestTarget, pending: undefined });
			assert.strictEqual(getMergeTarget.callCount, 1);
			assert.strictEqual(getMergeTarget.firstCall.args[0], 'feature');

			const options = optionsOf(0);
			assert.strictEqual(options.inferBase, true);
			assert.strictEqual(options.defaultBranch, 'remote');
			assert.strictEqual(typeof options.getFallbackDefaultBranch, 'function');
			assert.strictEqual(typeof options.getAssociatedPullRequest, 'function');
		});

		test('forwards keepSelfAtTip and the cancellation', async () => {
			const controller = new AbortController();

			await getBranchMergeTarget(container, branch, { keepSelfAtTip: true, cancellation: controller.signal });

			assert.strictEqual(optionsOf(0).keepSelfAtTip, true);
			assert.strictEqual(getMergeTarget.firstCall.args[2], controller.signal);
		});

		test('does not fetch the pull request unless the lookup asks for it', async () => {
			await getBranchMergeTarget(container, branch);

			assert.strictEqual(getRemote.callCount, 0);
		});

		test('fetches the pull request once however many times the lookup asks', async () => {
			getMergeTarget.callsFake(async (_name: string, options: MergeTargetOptions) => {
				await options.getAssociatedPullRequest?.();
				await options.getAssociatedPullRequest?.();
				return noPullRequestTarget;
			});

			await getBranchMergeTarget(container, branch);

			assert.strictEqual(getRemote.callCount, 1);
		});

		test('uses the pull request it is given instead of fetching one', async () => {
			answerFromPullRequest();

			const result = await getBranchMergeTarget(container, branch, {
				associatedPullRequest: Promise.resolve(pullRequest()),
			});

			assert.deepStrictEqual(result, { target: pullRequestTarget, pending: undefined });
			assert.strictEqual(getRemote.callCount, 0);
		});

		test('has nothing pending when the pull request answers within the timeout', async () => {
			answerFromPullRequest();

			const result = await getBranchMergeTarget(container, branch, {
				associatedPullRequest: Promise.resolve(pullRequest()),
				timeout: 1000,
			});

			assert.deepStrictEqual(result, { target: pullRequestTarget, pending: undefined });
			assert.strictEqual(getMergeTarget.callCount, 1);
		});

		test('answers without a slow pull request and settles the late answer in pending', async () => {
			answerFromPullRequest();
			let resolvePullRequest!: (pr: PullRequest | undefined) => void;
			const associatedPullRequest = new Promise<PullRequest | undefined>(resolve => {
				resolvePullRequest = resolve;
			});

			const result = await getBranchMergeTarget(container, branch, {
				associatedPullRequest: associatedPullRequest,
				timeout: 1,
			});

			assert.deepStrictEqual(result.target, noPullRequestTarget);
			assert.ok(result.pending != null);

			resolvePullRequest(pullRequest());

			assert.deepStrictEqual(await result.pending, pullRequestTarget);
			assert.strictEqual(getMergeTarget.callCount, 2);
			assert.strictEqual(optionsOf(1).getAssociatedPullRequest, undefined);
		});

		test('answers without the pull request when the lookup outlasts the timeout before reaching it', async () => {
			// As when core joins another caller's lookup of the branch that is still waiting on its pull request
			getMergeTarget.onFirstCall().returns(new Promise<MergeTarget | undefined>(() => {}));
			getMergeTarget.onSecondCall().resolves(noPullRequestTarget);

			const result = await getBranchMergeTarget(container, branch, {
				associatedPullRequest: Promise.resolve(pullRequest()),
				timeout: 1,
			});

			assert.deepStrictEqual(result.target, noPullRequestTarget);
			assert.ok(result.pending != null);
			assert.strictEqual(optionsOf(1).getAssociatedPullRequest, undefined);
		});

		test('settles pending to undefined when the late answer names the same ref', async () => {
			let resolveFull!: (target: MergeTarget | undefined) => void;
			getMergeTarget.onFirstCall().returns(
				new Promise<MergeTarget | undefined>(resolve => {
					resolveFull = resolve;
				}),
			);
			getMergeTarget.onSecondCall().resolves(noPullRequestTarget);

			const result = await getBranchMergeTarget(container, branch, { timeout: 1 });
			resolveFull({ ...noPullRequestTarget });

			assert.strictEqual(await result.pending, undefined);
		});

		test('settles pending to undefined when the late lookup fails', async () => {
			let rejectFull!: (ex: Error) => void;
			getMergeTarget.onFirstCall().returns(
				new Promise<MergeTarget | undefined>((_resolve, reject) => {
					rejectFull = reject;
				}),
			);
			getMergeTarget.onSecondCall().resolves(noPullRequestTarget);

			const result = await getBranchMergeTarget(container, branch, { timeout: 1 });

			assert.deepStrictEqual(result.target, noPullRequestTarget);
			assert.ok(result.pending != null);

			rejectFull(new Error('boom'));

			assert.strictEqual(await result.pending, undefined);
		});

		test('rejects with a cancellation when cancelled while waiting on the lookup', async () => {
			getMergeTarget.onFirstCall().returns(new Promise<MergeTarget | undefined>(() => {}));
			const controller = new AbortController();

			const result = getBranchMergeTarget(container, branch, {
				cancellation: controller.signal,
				timeout: 1000,
			});
			controller.abort();

			await assert.rejects(result, (ex: unknown) => isCancellationError(ex));
			assert.strictEqual(getMergeTarget.callCount, 1);
		});
	});
});
