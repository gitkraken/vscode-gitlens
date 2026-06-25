import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { CheckoutError, FetchError, PullError, PushError, ResetError } from '@gitlens/git/errors.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import { RunError } from '../../exec/exec.errors.js';
import type { Git } from '../../exec/git.js';
import { defaultExceptionHandler, GitError } from '../../exec/git.js';
import { OperationsGitSubProvider } from '../operations.js';

suite('OperationsGitSubProvider Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let operations: OperationsGitSubProvider;
	let gitStub: sinon.SinonStubbedInstance<Git>;

	const repoPath = '/repo';

	function branchRef(): GitBranchReference {
		return {
			refType: 'branch',
			name: 'feature',
			ref: 'feature',
			remote: false,
			upstream: { name: 'origin/feature', missing: false },
			repoPath: repoPath,
		};
	}

	function successResult(): GitResult {
		return { stdout: '', stderr: undefined, exitCode: 0, cancelled: false };
	}

	/**
	 * Stubs `git.run` to mirror the real {@link Git.runCore} error contract for a failing command:
	 * with `errors: 'throw'` the rejection is thrown; otherwise it is routed through the real
	 * {@link defaultExceptionHandler}, which swallows `GitWarnings` matches (resolving as success)
	 * and rethrows everything else. This reproduces the production swallow behavior without spawning
	 * a real git process, so the tests genuinely distinguish a push that surfaces a rejection from
	 * one that silently swallows it.
	 */
	function stubRunFailure(stderr: string): void {
		(gitStub.run as sinon.SinonStub).callsFake(
			async (options: GitRunOptions, ...args: readonly (string | undefined)[]) => {
				const ex = new GitError(
					new RunError(
						{ message: stderr, cmd: `git ${args.filter(a => a != null).join(' ')}`, code: 1 },
						'',
						stderr,
					),
				);
				if (options.errors === 'throw') throw ex;

				// Mirror Git.runCore: let the default handler decide fatal vs. non-fatal
				defaultExceptionHandler(ex, options.cwd);
				return successResult();
			},
		);
	}

	setup(() => {
		sandbox = sinon.createSandbox();

		class MockGit {
			supports(_feature: string) {
				return Promise.resolve(true);
			}
			run(..._args: any[]) {
				return Promise.resolve(successResult());
			}
		}

		gitStub = sandbox.createStubInstance(MockGit) as unknown as sinon.SinonStubbedInstance<Git>;
		(gitStub.run as sinon.SinonStub).resolves(successResult());

		const context = {} as unknown as GitServiceContext;
		const cache = {} as unknown as Cache;
		const provider = {} as unknown as CliGitProviderInternal;

		operations = new OperationsGitSubProvider(context, gitStub, cache, provider);
	});

	teardown(() => {
		sandbox.restore();
	});

	test('push passes `errors: throw` so rejections are not swallowed by the default handler', async () => {
		await operations.push(repoPath, { reference: branchRef() });

		const pushCall = (gitStub.run as sinon.SinonStub).getCalls().find(c => c.args.includes('push'));
		assert.ok(pushCall, 'expected git.run to be invoked with a push command');
		assert.strictEqual((pushCall.args[0] as GitRunOptions).errors, 'throw');
	});

	test('push surfaces a non-fast-forward (tipBehind) rejection as PushError', async () => {
		stubRunFailure(
			'To origin\n ! [rejected]        feature -> feature (non-fast-forward)\n' +
				"error: failed to push some refs to 'origin'\n" +
				'hint: Updates were rejected because the tip of your current branch is behind\n' +
				'hint: its remote counterpart.',
		);

		await assert.rejects(operations.push(repoPath, { reference: branchRef() }), (ex: unknown) =>
			PushError.is(ex, 'tipBehind'),
		);
	});

	test('push surfaces a remoteAhead rejection as PushError', async () => {
		stubRunFailure(
			"error: failed to push some refs to 'origin'\n" +
				'hint: Updates were rejected because the remote contains work that you do not have locally.',
		);

		await assert.rejects(operations.push(repoPath, { reference: branchRef() }), (ex: unknown) =>
			PushError.is(ex, 'remoteAhead'),
		);
	});

	test('fetch surfaces an unreachable-remote failure as FetchError', async () => {
		// `remoteConnectionError` is a GitWarning, so without `errors: 'throw'` the default handler
		// swallows it and the fetch resolves as if it succeeded.
		stubRunFailure('fatal: Could not read from remote repository.');

		await assert.rejects(operations.fetch(repoPath), (ex: unknown) => FetchError.is(ex, 'remoteConnectionFailed'));
	});

	test('pull surfaces an unreachable-remote failure as PullError', async () => {
		// `remoteConnectionError` is a GitWarning, so without `errors: 'throw'` the default handler
		// swallows it and the pull resolves as if it succeeded.
		stubRunFailure('fatal: Could not read from remote repository.');

		await assert.rejects(operations.pull(repoPath), (ex: unknown) => PullError.is(ex, 'remoteConnectionFailed'));
	});

	test('reset surfaces an invalid-revision failure as ResetError', async () => {
		// `unknownRevision` is a GitWarning, so without `errors: 'throw'` the default handler swallows
		// it and the reset resolves as if it succeeded (without resetting).
		stubRunFailure("fatal: ambiguous argument 'badref': unknown revision or path not in the working tree.");

		await assert.rejects(operations.reset(repoPath, 'badref'), (ex: unknown) =>
			ResetError.is(ex, 'ambiguousArgument'),
		);
	});

	test('checkout with createBranch passes -b and ref', async () => {
		await operations.checkout(repoPath, 'origin/main', { createBranch: 'feature/foo' });

		const call = (gitStub.run as sinon.SinonStub).getCalls().find(c => c.args.includes('checkout'));
		assert.ok(call, 'expected git.run to be invoked with checkout');
		const gitArgs = call.args.filter((a): a is string => typeof a === 'string');
		assert.deepStrictEqual(gitArgs, ['checkout', '-b', 'feature/foo', 'origin/main', '--']);
	});

	test('checkout with createBranch and noTracking passes --no-track', async () => {
		await operations.checkout(repoPath, 'origin/main', { createBranch: 'feature/foo', noTracking: true });

		const call = (gitStub.run as sinon.SinonStub).getCalls().find(c => c.args.includes('checkout'));
		assert.ok(call, 'expected git.run to be invoked with checkout');
		const gitArgs = call.args.filter((a): a is string => typeof a === 'string');
		assert.deepStrictEqual(gitArgs, ['checkout', '-b', 'feature/foo', '--no-track', 'origin/main', '--']);
	});

	test('checkout with createBranch and noTracking=false omits --no-track', async () => {
		await operations.checkout(repoPath, 'origin/main', { createBranch: 'feature/foo', noTracking: false });

		const call = (gitStub.run as sinon.SinonStub).getCalls().find(c => c.args.includes('checkout'));
		assert.ok(call, 'expected git.run to be invoked with checkout');
		const gitArgs = call.args.filter((a): a is string => typeof a === 'string');
		assert.deepStrictEqual(gitArgs, ['checkout', '-b', 'feature/foo', 'origin/main', '--']);
	});

	test('checkout surfaces an invalid-ref failure as CheckoutError', async () => {
		// `unknownRevision` is a GitWarning, so without `errors: 'throw'` the default handler swallows
		// it and the checkout resolves as if it succeeded.
		stubRunFailure("fatal: ambiguous argument 'badref': unknown revision or path not in the working tree.");

		await assert.rejects(operations.checkout(repoPath, 'badref'), (ex: unknown) =>
			CheckoutError.is(ex, 'pathspecNotFound'),
		);
	});

	test('restore surfaces an invalid-ref failure as CheckoutError', async () => {
		// restore is implemented via `git checkout`; `unknownRevision` is a GitWarning, so without
		// `errors: 'throw'` the default handler swallows it and the restore resolves as if it succeeded.
		stubRunFailure("fatal: ambiguous argument 'badref': unknown revision or path not in the working tree.");

		await assert.rejects(operations.restore(repoPath, 'file.ts', { ref: 'badref' }), (ex: unknown) =>
			CheckoutError.is(ex, 'pathspecNotFound'),
		);
	});
});
