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

function exitedWithError(stdout: string): GitResult {
	return {
		stdout: stdout,
		stderr: 'fatal: Unable to hash',
		exitCode: 128,
		completion: { status: 'exited', code: 128 },
	};
}

/** Answers `hash-object --stdin-paths` the way git does: ids in input order until the first unhashable path */
function hashObject(unhashable: readonly string[]) {
	return (options: { stdin?: string }): GitResult => {
		const paths = options.stdin!.split('\n').filter(Boolean);
		const ids: string[] = [];
		for (const path of paths) {
			if (unhashable.includes(path)) return exitedWithError(ids.map(id => `${id}\n`).join(''));

			ids.push(`id-${path}`);
		}
		return exited(ids.map(id => `${id}\n`).join(''));
	};
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
		assert.strictEqual(run.callCount, 1);
	});

	test('working: skips a path that stops the run and hashes the ones after it', async () => {
		const hash = hashObject(['dir', 'sub']);
		const run = sinon.stub().callsFake((options: { stdin?: string; cwd: string }, ...args: string[]) => {
			if (args[0] === 'hash-object') return Promise.resolve(hash(options));
			// `rev-parse --show-prefix HEAD`: the submodule is a repository of its own, the directory isn't
			return Promise.resolve(exited(options.cwd.endsWith('sub') ? '\nsubmodule-head\n' : 'dir/\nouter-head\n'));
		});
		const provider = createProvider({ run: run } as unknown as Git);

		const ids = await provider.getBlobIds(repoPath, ['a.ts', 'dir', 'b.ts', 'sub', 'c.ts'], 'working');

		const stdins = run
			.getCalls()
			.flatMap(c => (c.args[1] === 'hash-object' ? [(c.args[0] as { stdin?: string }).stdin] : []));
		assert.deepStrictEqual(stdins, ['a.ts\ndir\nb.ts\nsub\nc.ts\n', 'b.ts\nsub\nc.ts\n', 'c.ts\n']);
		assert.deepStrictEqual(
			new Map(ids),
			new Map([
				['a.ts', 'id-a.ts'],
				['b.ts', 'id-b.ts'],
				['c.ts', 'id-c.ts'],
				['sub', 'submodule-head'],
			]),
		);
	});

	test('working: an unhashable last path costs no extra run', async () => {
		const hash = hashObject(['dir']);
		const run = sinon
			.stub()
			.callsFake((options: { stdin?: string }, ...args: string[]) =>
				Promise.resolve(args[0] === 'hash-object' ? hash(options) : exited('dir/\nouter-head\n')),
			);
		const provider = createProvider({ run: run } as unknown as Git);

		const ids = await provider.getBlobIds(repoPath, ['a.ts', 'dir'], 'working');

		assert.deepStrictEqual([...ids], [['a.ts', 'id-a.ts']]);
		assert.strictEqual(run.getCalls().filter(c => c.args[1] === 'hash-object').length, 1);
	});

	test('working: a cancelled run is not retried', async () => {
		const controller = new AbortController();
		const run = sinon.stub().callsFake(() => {
			controller.abort();
			return Promise.resolve({
				stdout: 'aaaa\n',
				stderr: undefined,
				completion: { status: 'cancelled', reason: 'aborted', error: new Error('aborted') },
			} satisfies GitResult);
		});
		const provider = createProvider({ run: run } as unknown as Git);

		const ids = await provider.getBlobIds(repoPath, ['a.ts', 'b.ts', 'c.ts'], 'working', controller.signal);

		assert.deepStrictEqual([...ids], [['a.ts', 'aaaa']]);
		assert.strictEqual(run.callCount, 1);
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
		assert.deepStrictEqual(args, ['ls-files', '-z', '--stage', '--', ':(literal)src/a.ts', ':(literal)src/c.ts']);
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
