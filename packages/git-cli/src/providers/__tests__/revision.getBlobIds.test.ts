import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { RevisionGitSubProvider } from '../revision.js';

const repoPath = '/repo';

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

function createProvider(git: Git): RevisionGitSubProvider {
	return new RevisionGitSubProvider(
		{} as unknown as GitServiceContext,
		git,
		new Cache(),
		{} as unknown as CliGitProviderInternal,
	);
}

suite('RevisionGitSubProvider.getBlobIds', () => {
	test('working: hashes every path in one process and maps output lines back in input order', async () => {
		const run = sinon.stub().resolves(exited('aaaa\nbbbb\n'));
		const provider = createProvider({ run: run } as unknown as Git);

		const ids = await provider.getBlobIds(repoPath, ['src/a.ts', 'src/b.ts'], 'working');

		assert.strictEqual(run.callCount, 1);
		const [options, ...args] = run.firstCall.args as [{ stdin?: string }, ...string[]];
		assert.deepStrictEqual(args, ['hash-object', '--stdin-paths']);
		assert.strictEqual(options.stdin, 'src/a.ts\nsrc/b.ts\n');
		assert.deepStrictEqual(
			[...ids],
			[
				['src/a.ts', 'aaaa'],
				['src/b.ts', 'bbbb'],
			],
		);
	});

	test('working: a short answer leaves the unhashed tail out instead of misassigning ids', async () => {
		const run = sinon.stub().resolves(exited('aaaa\n'));
		const provider = createProvider({ run: run } as unknown as Git);

		const ids = await provider.getBlobIds(repoPath, ['src/a.ts', 'src/b.ts'], 'working');

		assert.deepStrictEqual([...ids], [['src/a.ts', 'aaaa']]);
	});

	test('index: reads oids from ls-files --stage, keeping the first entry of a conflicted path', async () => {
		const run = sinon
			.stub()
			.resolves(
				exited('100644 1111 0\tsrc/a.ts\u0000100644 2222 1\tsrc/c.ts\u0000100644 3333 2\tsrc/c.ts\u0000'),
			);
		const provider = createProvider({ run: run } as unknown as Git);

		const ids = await provider.getBlobIds(repoPath, ['src/a.ts', 'src/c.ts'], 'index');

		const [, ...args] = run.firstCall.args as [unknown, ...string[]];
		assert.deepStrictEqual(args, ['ls-files', '-z', '--stage', '--', 'src/a.ts', 'src/c.ts']);
		assert.deepStrictEqual(
			[...ids],
			[
				['src/a.ts', '1111'],
				['src/c.ts', '2222'],
			],
		);
	});

	test('no paths: answers without spawning git', async () => {
		const run = sinon.stub();
		const provider = createProvider({ run: run } as unknown as Git);

		const ids = await provider.getBlobIds(repoPath, [], 'working');

		assert.strictEqual(ids.size, 0);
		assert.strictEqual(run.callCount, 0);
	});
});
