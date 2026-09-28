import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { StashPushError } from '@gitlens/git/errors.js';
import type { GitOperationRunOptions } from '@gitlens/git/providers/operations.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { StashGitSubProvider } from '../stash.js';

suite('StashGitSubProvider — runOptions passthrough', () => {
	const repoPath = '/repo';

	let run: sinon.SinonStub;
	let stash: StashGitSubProvider;

	function successResult(): GitResult {
		return { stdout: '', stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
	}

	setup(() => {
		run = sinon.stub().resolves(successResult());
		const git = { run: run } as unknown as Git;
		const context = { hooks: {} } as unknown as GitServiceContext;
		const cache = {} as unknown as Cache;
		const provider = {} as unknown as CliGitProviderInternal;

		stash = new StashGitSubProvider(context, git, cache, provider);
	});

	test('applyStash reaches git.run with a caller-passed runOptions, and none without it', async () => {
		await stash.applyStash(repoPath, 'stash@{0}');
		assert.strictEqual(run.getCall(0).args[0].timeout, undefined, 'no runOptions: no timeout is set');

		const cancellation = new AbortController().signal;
		const runOptions: GitOperationRunOptions = { timeout: 1234, env: { X: '1' }, cancellation: cancellation };
		await stash.applyStash(repoPath, 'stash@{0}', undefined, runOptions);

		const call = run.getCall(1);
		assert.strictEqual(call.args[0].timeout, 1234);
		assert.deepStrictEqual(call.args[0].env, { X: '1' });
		assert.strictEqual(call.args[0].cancellation, cancellation);
	});

	test('saveStash reaches git.run with a caller-passed runOptions, and none without it', async () => {
		await stash.saveStash(repoPath, 'message');
		assert.strictEqual(run.getCall(0).args[0].timeout, undefined, 'no runOptions: no timeout is set');

		const cancellation = new AbortController().signal;
		const runOptions: GitOperationRunOptions = { timeout: 1234, env: { X: '1' }, cancellation: cancellation };
		await stash.saveStash(repoPath, 'message', undefined, undefined, runOptions);

		const call = run.getCall(1);
		assert.strictEqual(call.args[0].timeout, 1234);
		assert.deepStrictEqual(call.args[0].env, { X: '1' });
		assert.strictEqual(call.args[0].cancellation, cancellation);
	});

	test('a cancelled applyStash or saveStash rejects as a cancellation, not a stash failure', async () => {
		run.rejects(new CancellationError());

		await assert.rejects(stash.applyStash(repoPath, 'stash@{0}'), ex => isCancellationError(ex));
		await assert.rejects(stash.saveStash(repoPath, 'message'), ex => isCancellationError(ex));
	});

	test('a cancelled applyStash or saveStash still announces the stash change before rejecting', async () => {
		// A cancel can land after git already moved the stash list or the working tree
		const onReset = sinon.spy();
		const onChanged = sinon.spy();
		const context = {
			hooks: { cache: { onReset: onReset }, repository: { onChanged: onChanged } },
		} as unknown as GitServiceContext;
		const git = { run: sinon.stub().rejects(new CancellationError()) } as unknown as Git;
		const cancelled = new StashGitSubProvider(
			context,
			git,
			{} as unknown as Cache,
			{} as unknown as CliGitProviderInternal,
		);

		await assert.rejects(cancelled.applyStash(repoPath, 'stash@{0}'), ex => isCancellationError(ex));
		assert.deepStrictEqual(onReset.args, [[repoPath, 'stashes', 'status']]);
		assert.deepStrictEqual(onChanged.args, [[repoPath, ['stash']]]);

		onReset.resetHistory();
		onChanged.resetHistory();

		await assert.rejects(cancelled.saveStash(repoPath, 'message'), ex => isCancellationError(ex));
		assert.deepStrictEqual(onReset.args, [[repoPath, 'stashes', 'status']]);
		assert.deepStrictEqual(onChanged.args, [[repoPath, ['stash']]]);
	});

	test('a saveStash with nothing to save rejects without announcing a change', async () => {
		const onReset = sinon.spy();
		const onChanged = sinon.spy();
		const context = {
			hooks: { cache: { onReset: onReset }, repository: { onChanged: onChanged } },
		} as unknown as GitServiceContext;
		const git = {
			run: sinon.stub().resolves({ ...successResult(), stdout: 'No local changes to save\n' }),
		} as unknown as Git;
		const unchanged = new StashGitSubProvider(
			context,
			git,
			{} as unknown as Cache,
			{} as unknown as CliGitProviderInternal,
		);

		await assert.rejects(unchanged.saveStash(repoPath, 'message'), ex => StashPushError.is(ex, 'nothingToSave'));
		assert.deepStrictEqual(onReset.args, []);
		assert.deepStrictEqual(onChanged.args, []);
	});
});
