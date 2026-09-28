import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitOperationRunOptions } from '@gitlens/git/providers/operations.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { StagingGitSubProvider } from '../staging.js';

suite('StagingGitSubProvider — runOptions passthrough', () => {
	const repoPath = '/repo';

	let run: sinon.SinonStub;
	let staging: StagingGitSubProvider;

	function successResult(): GitResult {
		return { stdout: '', stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
	}

	setup(() => {
		run = sinon.stub().resolves(successResult());
		const git = { run: run } as unknown as Git;
		const context = { hooks: {} } as unknown as GitServiceContext;
		const cache = {} as unknown as Cache;
		const provider = {} as unknown as CliGitProviderInternal;

		staging = new StagingGitSubProvider(context, git, cache, provider);
	});

	test('clean reaches git.run with a caller-passed runOptions, and none without it', async () => {
		await staging.clean(repoPath);
		assert.strictEqual(run.getCall(0).args[0].timeout, undefined, 'no runOptions: no timeout is set');

		const cancellation = new AbortController().signal;
		const runOptions: GitOperationRunOptions = { timeout: 1234, env: { X: '1' }, cancellation: cancellation };
		await staging.clean(repoPath, undefined, runOptions);

		const call = run.getCall(1);
		assert.strictEqual(call.args[0].timeout, 1234);
		assert.deepStrictEqual(call.args[0].env, { X: '1' });
		assert.strictEqual(call.args[0].cancellation, cancellation);
	});
});
