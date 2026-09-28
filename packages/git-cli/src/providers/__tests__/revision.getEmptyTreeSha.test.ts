import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { RevisionGitSubProvider } from '../revision.js';

const repoPath = '/repo';
const sha1EmptyTreeSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

function createProvider(cache: Cache, git: Git): RevisionGitSubProvider {
	return new RevisionGitSubProvider(
		{} as unknown as GitServiceContext,
		git,
		cache,
		{} as unknown as CliGitProviderInternal,
	);
}

suite('RevisionGitSubProvider.getEmptyTreeSha', () => {
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test('two concurrent calls spawn only one hash-object', async () => {
		let resolveRun: ((result: GitResult) => void) | undefined;
		const run = sinon.stub().callsFake(
			() =>
				new Promise<GitResult>(resolve => {
					resolveRun = resolve;
				}),
		);
		const provider = createProvider(cache, { run: run } as unknown as Git);

		const p1 = provider.getEmptyTreeSha(repoPath);
		const p2 = provider.getEmptyTreeSha(repoPath);

		assert.strictEqual(run.callCount, 1, 'only one spawn for two concurrent callers');

		resolveRun!(exited(sha1EmptyTreeSha));

		const [sha1, sha2] = await Promise.all([p1, p2]);
		assert.strictEqual(sha1, sha1EmptyTreeSha);
		assert.strictEqual(sha2, sha1EmptyTreeSha);
	});

	test('a failed spawn is not cached — the next call retries, and both calls reach git', async () => {
		const run = sinon.stub();
		run.onCall(0).rejects(new Error('spawn failed'));
		run.onCall(1).resolves(exited(sha1EmptyTreeSha));
		const provider = createProvider(cache, { run: run } as unknown as Git);

		await assert.rejects(provider.getEmptyTreeSha(repoPath));

		const sha = await provider.getEmptyTreeSha(repoPath);
		assert.strictEqual(sha, sha1EmptyTreeSha);
		assert.strictEqual(run.callCount, 2, 'both calls must reach git — the failure must not be cached');
	});
});
