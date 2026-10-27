import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { ConfigGitSubProvider, parseConfigRegexNullOutput } from '../config.js';

function exited(stdout: string, exitCode = 0): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: exitCode, completion: { status: 'exited', code: exitCode } };
}

suite('parseConfigRegexNullOutput', () => {
	test('keeps every value of a repeated key in order, spaces and newlines included', () => {
		const parsed = parseConfigRegexNullOutput(
			'remote.origin.fetch\n+refs/heads/*:refs/remotes/origin/*\0' +
				'remote.origin.fetch\n+refs/tags/v 1:refs/tags/v 1\0' +
				'remote.up.fetch\nline one\nline two\0' +
				'remote.up.empty\n\0' +
				'remote.up.valueless\0',
		);

		assert.deepStrictEqual(
			[...parsed],
			[
				['remote.origin.fetch', ['+refs/heads/*:refs/remotes/origin/*', '+refs/tags/v 1:refs/tags/v 1']],
				['remote.up.fetch', ['line one\nline two']],
				['remote.up.empty', ['']],
			],
		);
	});

	test('reads no output as no keys', () => {
		assert.deepStrictEqual([...parseConfigRegexNullOutput('')], []);
		assert.deepStrictEqual([...parseConfigRegexNullOutput(undefined)], []);
	});
});

suite('ConfigGitSubProvider.getConfigRegexAll', () => {
	const commonPath = '/repo';
	const linkedPath = '/repo.worktrees/linked';
	const pattern = '^remote\\..+\\.fetch$';

	let run: sinon.SinonStub;
	let provider: ConfigGitSubProvider;

	setup(() => {
		run = sinon.stub();
		const git = { run: run } as unknown as Git;
		const entries = new Map<string, Promise<Map<string, string>>>();
		const getCommonPath = (repoPath: string) => (repoPath === linkedPath ? commonPath : repoPath);
		const cache = {
			setGkConfigReconciler: () => {},
			getCommonPath: getCommonPath,
			getConfigRegex: (
				repoPath: string,
				key: string,
				factory: () => Map<string, string> | Promise<Map<string, string>>,
			) => {
				const cacheKey = `${repoPath}\0${key}`;
				let entry = entries.get(cacheKey);
				if (entry == null) {
					entry = Promise.resolve(factory());
					entries.set(cacheKey, entry);
				}
				return entry;
			},
		} as unknown as Cache;
		provider = new ConfigGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		sinon.restore();
	});

	test('reads from the common path with --null, whichever worktree reads first, and serves every worktree that read', async () => {
		run.resolves(
			exited(
				'remote.origin.fetch\n+refs/heads/*:refs/remotes/origin/*\0remote.origin.fetch\n+refs/tags/*:refs/tags/*\0',
			),
		);

		const fromLinked = await provider.getConfigRegexAll(linkedPath, pattern);
		const fromMain = await provider.getConfigRegexAll(commonPath, pattern);

		sinon.assert.calledOnce(run);
		const [options, ...args] = run.firstCall.args as [{ cwd: string }, ...string[]];
		assert.strictEqual(options.cwd, commonPath, "never the calling worktree's directory");
		assert.deepStrictEqual(args, ['config', '--null', '--get-regexp', pattern]);
		const expected = [['remote.origin.fetch', ['+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*']]];
		assert.deepStrictEqual([...fromLinked], expected);
		assert.deepStrictEqual([...fromMain], expected);
	});

	test('reads no matching key as an empty map, and a failed read as a rejection', async () => {
		run.onFirstCall().resolves(exited('', 1));
		assert.deepStrictEqual([...(await provider.getConfigRegexAll(commonPath, pattern))], []);

		run.onSecondCall().resolves(exited('', 128));
		await assert.rejects(provider.getConfigRegexAll(commonPath, '^remote\\..+\\.url$'));
	});
});
