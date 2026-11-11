import * as assert from 'assert';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { ConfigGitSubProvider } from '../config.js';

const legacyPattern = '^branch\\..*\\.gk-';

function exited(stdout: string, exitCode = 0): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: exitCode, completion: { status: 'exited', code: exitCode } };
}

suite('ConfigGitSubProvider gk config migration', () => {
	let root: string;
	let gitDir: string;
	let gkConfigPath: string;
	let legacy: () => GitResult;
	let run: sinon.SinonStub<[options: unknown, ...args: string[]], Promise<GitResult>>;

	function createProvider(): { provider: ConfigGitSubProvider; cache: Cache } {
		const cache = new Cache();
		const provider = new ConfigGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{ run: run, isPathTrusted: () => true } as unknown as Git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
		sinon
			.stub(
				provider as unknown as { readGitDirsWithoutGit(repoPath: string): Promise<unknown> },
				'readGitDirsWithoutGit',
			)
			.resolves({ gitDir: gitDir, commonGitDir: gitDir });
		return { provider: provider, cache: cache };
	}

	function legacyReads(): number {
		return run.getCalls().filter(c => c.args.includes(legacyPattern)).length;
	}

	setup(() => {
		root = mkdtempSync(join(tmpdir(), 'gk-migration-'));
		gitDir = join(root, '.git');
		mkdirSync(gitDir);
		gkConfigPath = join(gitDir, 'gk', 'config');
		legacy = () => exited('', 1);
		run = sinon.stub<[options: unknown, ...args: string[]], Promise<GitResult>>().callsFake((_o, ...args) => {
			if (args.includes(legacyPattern)) return Promise.resolve(legacy());
			if (args[0] === 'config' && args[1] === '-f' && args.length === 5) {
				// Stands in for `git config -f <file> <key> <value>`
				appendFileSync(args[2], `${args[3]} ${args[4]}\n`);
				return Promise.resolve(exited(''));
			}
			return Promise.resolve(exited('', 1));
		});
	});

	teardown(() => {
		sinon.restore();
		rmSync(root, { recursive: true, force: true });
	});

	test('a failed legacy read creates no file, and the next session migrates the keys', async () => {
		legacy = () => exited('', 128);
		const first = createProvider();
		await first.provider.getGkConfig(root, 'gk.defaultRemote');
		assert.strictEqual(existsSync(gkConfigPath), false);
		first.cache.dispose();

		legacy = () => exited('branch.main.gk-merge-base main\n');
		const second = createProvider();
		await second.provider.getGkConfig(root, 'gk.defaultRemote');
		assert.strictEqual(existsSync(gkConfigPath), true);
		assert.ok(readFileSync(gkConfigPath, 'utf8').includes('branch.main.gk-merge-base'));
		second.cache.dispose();
	});

	test('a failed legacy read is not retried within the session', async () => {
		legacy = () => exited('', 128);
		const { provider, cache } = createProvider();
		await provider.getGkConfig(root, 'gk.defaultRemote');
		await provider.getGkConfig(root, 'gk.defaultRemote');

		assert.strictEqual(legacyReads(), 1);
		assert.strictEqual(existsSync(gkConfigPath), false);
		cache.dispose();
	});

	test('a read with no legacy keys creates the empty file', async () => {
		const { provider, cache } = createProvider();
		await provider.getGkConfig(root, 'gk.defaultRemote');

		assert.strictEqual(existsSync(gkConfigPath), true);
		assert.strictEqual(readFileSync(gkConfigPath, 'utf8'), '');
		cache.dispose();
	});

	test('a read with legacy keys writes them to the gk config and unsets them from git config', async () => {
		legacy = () => exited('branch.main.gk-merge-base main\n');
		const { provider, cache } = createProvider();
		await provider.getGkConfig(root, 'gk.defaultRemote');

		assert.ok(readFileSync(gkConfigPath, 'utf8').includes('branch.main.gk-merge-base'));
		assert.ok(
			run.getCalls().some(c => c.args.includes('--unset-all') && c.args.includes('branch.main.gk-merge-base')),
		);
		cache.dispose();
	});
});
