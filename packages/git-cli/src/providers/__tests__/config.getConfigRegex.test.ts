import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { WorkspaceUntrustedError } from '@gitlens/git/errors.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { ConfigGitSubProvider } from '../config.js';

const repoPath = '/repo';
const pattern = '^user\\.(name|email)$';

function exited(stdout: string, exitCode = 0): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: exitCode, completion: { status: 'exited', code: exitCode } };
}

const failures: [string, () => Promise<GitResult>][] = [
	[
		'a run that never started',
		() =>
			Promise.resolve({
				stdout: '',
				stderr: undefined,
				completion: { status: 'failed', reason: 'unstarted', error: new Error('spawn failed') },
			}),
	],
	['an abnormal exit', () => Promise.resolve(exited('', 128))],
	[
		'a swallowed warning',
		() =>
			Promise.resolve({
				stdout: '',
				stderr: 'warning',
				exitCode: 1,
				completion: { status: 'warned', warning: undefined, error: new Error('warned') },
			}),
	],
];

suite('ConfigGitSubProvider.getConfigRegex', () => {
	let cache: Cache;
	let run: sinon.SinonStub<[options: unknown, ...args: string[]], Promise<GitResult>>;
	let provider: ConfigGitSubProvider;

	setup(() => {
		cache = new Cache();
		run = sinon.stub<[options: unknown, ...args: string[]], Promise<GitResult>>();
		provider = new ConfigGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{ run: run } as unknown as Git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		sinon.restore();
		cache.dispose();
	});

	function testFailure(name: string, fail: () => Promise<GitResult>): void {
		test(`${name} rejects and is read again on the next call`, async () => {
			run.onFirstCall().callsFake(fail);
			run.onSecondCall().resolves(exited('user.name Alice\nuser.email alice@example.com\n'));

			await assert.rejects(provider.getConfigRegex(repoPath, pattern));

			const map = await provider.getConfigRegex(repoPath, pattern);
			assert.deepStrictEqual(Object.fromEntries(map), {
				'user.name': 'Alice',
				'user.email': 'alice@example.com',
			});
			assert.strictEqual(run.callCount, 2);
		});
	}

	for (const [name, fail] of failures) {
		testFailure(name, fail);
	}

	test('a global read that fails is read again on the next call', async () => {
		run.onFirstCall().resolves(exited('', 128));
		run.onSecondCall().resolves(exited('user.name Alice\n'));

		await assert.rejects(provider.getConfigRegex(undefined, pattern));
		assert.strictEqual((await provider.getConfigRegex(undefined, pattern)).get('user.name'), 'Alice');
		assert.strictEqual(run.callCount, 2);
	});

	test('no matching key (exit code 1) is an empty map that is kept', async () => {
		run.resolves(exited('', 1));

		assert.strictEqual((await provider.getConfigRegex(repoPath, pattern)).size, 0);
		assert.strictEqual((await provider.getConfigRegex(repoPath, pattern)).size, 0);
		assert.strictEqual(run.callCount, 1);
	});

	test('getConfigRegexAll that fails is read again on the next call', async () => {
		run.onFirstCall().resolves(exited('', 128));
		run.onSecondCall().resolves(exited('remote.origin.fetch\n+refs/heads/*:refs/remotes/origin/*\0'));

		await assert.rejects(provider.getConfigRegexAll(repoPath, '^remote\\..+\\.fetch$'));
		assert.strictEqual((await provider.getConfigRegexAll(repoPath, '^remote\\..+\\.fetch$')).size, 1);
		assert.strictEqual(run.callCount, 2);
	});

	suite('getSigningConfig', () => {
		const signing =
			'commit.gpgsign true\ngpg.format ssh\nuser.signingkey /keys/id.pub\ngpg.ssh.allowedsignersfile /keys/signers\n';

		test('a failed read answers the defaults, which are not kept', async () => {
			run.onFirstCall().resolves(exited('', 128));
			run.onSecondCall().resolves(exited(signing));

			const failed = await provider.getSigningConfig(repoPath);
			assert.strictEqual(failed.enabled, false);
			assert.strictEqual(failed.format, 'gpg');
			assert.strictEqual(failed.signingKey, undefined);

			const read = await provider.getSigningConfig(repoPath);
			assert.strictEqual(read.enabled, true);
			assert.strictEqual(read.format, 'ssh');
			assert.strictEqual(read.signingKey, '/keys/id.pub');
			assert.strictEqual(run.callCount, 2);
		});

		test('a failed read still honors the host-level signing override', async () => {
			provider = new ConfigGitSubProvider(
				{ hooks: {}, config: { signing: { enabled: true } } } as unknown as GitServiceContext,
				{ run: run } as unknown as Git,
				cache,
				{} as unknown as CliGitProviderInternal,
			);
			run.resolves(exited('', 128));

			assert.strictEqual((await provider.getSigningConfig(repoPath)).enabled, true);
		});

		test('an untrusted workspace still rejects', async () => {
			run.rejects(new WorkspaceUntrustedError(repoPath));

			await assert.rejects(provider.getSigningConfig(repoPath), (ex: unknown) => WorkspaceUntrustedError.is(ex));
		});
	});
});
