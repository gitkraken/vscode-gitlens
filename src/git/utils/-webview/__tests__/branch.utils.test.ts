import * as assert from 'assert';
import * as sinon from 'sinon';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Container } from '../../../../container.js';
import { getBranchMergeTargetName, isSelfMergeTarget } from '../branch.utils.js';

suite('git/-webview/branch.utils', () => {
	suite('isSelfMergeTarget', () => {
		test('the default branch, whose target resolves remote-qualified (desktop)', () => {
			// `getDefaultBranchName` runs `git symbolic-ref --short refs/remotes/origin/HEAD`, so the
			// fallback chain answers `origin/main` for a focal branch named `main` — the same branch.
			assert.strictEqual(isSelfMergeTarget('origin/main', 'main'), true);
		});

		test('the default branch, whose target resolves bare (GitHub provider)', () => {
			// The GitHub provider used by vscode.dev returns the GraphQL `defaultBranchRef.name` verbatim.
			assert.strictEqual(isSelfMergeTarget('main', 'main'), true);
		});

		test('the remote branch itself, focused directly', () => {
			assert.strictEqual(isSelfMergeTarget('origin/main', 'origin/main'), true);
		});

		test('a real target the focal branch is merely level with', () => {
			// The regression this exists for: `feature/github-stacked-prs` sat on the same commit as
			// `origin/main`, and a tip-SHA test condemned it as targetless — leaving the graph's scope
			// bare, which dims every row off the focal tip's first-parent line instead of re-rooting.
			assert.strictEqual(isSelfMergeTarget('origin/main', 'feature/github-stacked-prs'), false);
		});

		test('the remote strip is never applied to the focal branch name', () => {
			// `getBranchNameWithoutRemote` cuts at the first `/`, so stripping the focal side too would
			// reduce `feature/github-stacked-prs` to `github-stacked-prs` and match unrelated branches.
			assert.strictEqual(isSelfMergeTarget('origin/feature', 'feature/github-stacked-prs'), false);
			assert.strictEqual(isSelfMergeTarget('origin/github-stacked-prs', 'feature/github-stacked-prs'), false);
		});
	});

	suite('getBranchMergeTargetName', () => {
		const branch = { repoPath: '/repo', name: 'feature', remoteName: 'origin' } as unknown as GitBranch;

		let storedResolver: sinon.SinonStub;
		let storeMergeTarget: sinon.SinonStub;
		let checkRef: sinon.SinonStub;
		let container: Container;
		let svc: { branches: Record<string, unknown>; refs: Record<string, unknown> };

		function pullRequest(stacked: boolean): Promise<PullRequest | undefined> {
			return Promise.resolve({
				refs: { base: { branch: 'main' } },
				...(stacked ? { stack: { position: 1 } } : {}),
			} as unknown as PullRequest);
		}

		setup(() => {
			storedResolver = sinon.stub();
			storeMergeTarget = sinon.stub().resolves();

			checkRef = sinon.stub().callsFake((ref: string) => Promise.resolve({ name: ref, missing: false }));

			svc = {
				refs: { getSymbolicReferenceNameOrMissing: checkRef },
				branches: {
					getStoredMergeTargetBranchName: storedResolver,
					storeMergeTargetBranchName: storeMergeTarget,
					getBaseBranchName: () => Promise.resolve('origin/base'),
					getDefaultBranchName: () => Promise.resolve('origin/default'),
				},
			};
			container = { git: { getRepositoryService: () => svc } } as unknown as Container;
		});

		teardown(() => {
			sinon.restore();
		});

		test('uses the stored target the resolver returns', async () => {
			storedResolver.resolves('origin/parent');

			const result = await getBranchMergeTargetName(container, branch, {
				associatedPullRequest: pullRequest(true),
			});

			assert.deepStrictEqual(result, { value: 'origin/parent', paused: false });
			assert.strictEqual(storeMergeTarget.callCount, 0);
		});

		test('falls through to the PR base when the stored target is gone', async () => {
			storedResolver.resolves(undefined);

			const result = await getBranchMergeTargetName(container, branch, {
				associatedPullRequest: pullRequest(true),
			});

			assert.deepStrictEqual(result, { value: 'origin/main', paused: false });
			assert.strictEqual(storeMergeTarget.callCount, 0, 'a stacked PR base is never stored');
		});

		test('skips a stacked PR base whose branch is gone', async () => {
			storedResolver.resolves(undefined);
			checkRef.resolves({ name: undefined, missing: true });

			const result = await getBranchMergeTargetName(container, branch, {
				associatedPullRequest: pullRequest(true),
			});

			assert.deepStrictEqual(result, { value: 'origin/base', paused: false });
			assert.strictEqual(checkRef.firstCall.args[0], 'origin/main');
			assert.strictEqual(storeMergeTarget.callCount, 0);
		});

		test('skips a non-stacked PR base whose branch is gone, without storing it', async () => {
			storedResolver.resolves(undefined);
			checkRef.resolves({ name: undefined, missing: true });

			const result = await getBranchMergeTargetName(container, branch, {
				associatedPullRequest: pullRequest(false),
			});

			assert.deepStrictEqual(result, { value: 'origin/base', paused: false });
			assert.strictEqual(storeMergeTarget.callCount, 0);
		});

		test('uses and stores a non-stacked PR base that exists', async () => {
			storedResolver.resolves(undefined);

			const result = await getBranchMergeTargetName(container, branch, {
				associatedPullRequest: pullRequest(false),
			});

			assert.deepStrictEqual(result, { value: 'origin/main', paused: false });
			assert.strictEqual(storeMergeTarget.callCount, 1);
		});

		test('keeps the PR base when the provider cannot check it', async () => {
			storedResolver.resolves(undefined);
			svc.refs = {};

			const result = await getBranchMergeTargetName(container, branch, {
				associatedPullRequest: pullRequest(false),
			});

			assert.deepStrictEqual(result, { value: 'origin/main', paused: false });
		});

		test('keeps the PR base instead of rejecting when its check is cancelled after a timeout', async () => {
			storedResolver.resolves(undefined);
			checkRef.rejects(new CancellationError());
			const controller = new AbortController();
			let resolvePullRequest!: (pr: PullRequest | undefined) => void;
			const associatedPullRequest = new Promise<PullRequest | undefined>(resolve => {
				resolvePullRequest = resolve;
			});

			const result = await getBranchMergeTargetName(container, branch, {
				associatedPullRequest: associatedPullRequest,
				cancellation: controller.signal,
				timeout: 1,
			});
			assert.strictEqual(result.paused, true);

			controller.abort();
			resolvePullRequest({ refs: { base: { branch: 'main' } } } as unknown as PullRequest);

			assert.strictEqual(await result.value, 'origin/main');
		});

		test('forwards detectedOnly to the resolver', async () => {
			storedResolver.resolves('origin/detected');

			await getBranchMergeTargetName(container, branch, {
				associatedPullRequest: pullRequest(true),
				detectedOnly: true,
			});

			assert.strictEqual(storedResolver.firstCall.args[0], 'feature');
			assert.deepStrictEqual(storedResolver.firstCall.args[1], { detectedOnly: true });
		});

		test('asks for the full stored target by default', async () => {
			storedResolver.resolves('origin/parent');

			await getBranchMergeTargetName(container, branch, { associatedPullRequest: pullRequest(true) });

			assert.strictEqual(storedResolver.firstCall.args[1], undefined);
		});
	});
});
