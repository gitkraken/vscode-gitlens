import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import { Git } from '../../exec/git.js';
import type { GitOptions } from '../../exec/git.js';
import { BranchesGitSubProvider, defaultBranchLookupClock } from '../branches.js';

const repoPath = '/repos/a';
const notSymbolicRef = Object.assign(new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref'), {
	stderr: 'fatal: ref refs/remotes/origin/HEAD is not a symbolic ref',
});

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

type RunArgs = [options: Record<string, any>, ...args: string[]];

suite('BranchesGitSubProvider.getDefaultBranchName networked lookup', () => {
	const failedLookupWait = 60 * 1000;

	let cache: Cache;
	let git: Git;
	let provider: BranchesGitSubProvider;
	let run: sinon.SinonStub<RunArgs, Promise<GitResult>>;
	let now: number;
	let gitOptions: GitOptions;

	/** Answers each command from `answers`; `symbolic-ref` answers "not a symbolic ref" until a `set-head` has run */
	let answers: { setHead: () => Promise<GitResult>; lsRemote: () => Promise<GitResult> };

	const networkCalls = () => run.getCalls().filter(c => c.args[1] === 'remote' || c.args[1] === 'ls-remote');

	/** Evicts the cached answer without advancing the drop stamp, which would itself end a held failure */
	const evictCachedAnswer = () => cache.defaultBranchName.delete(repoPath, 'origin');

	setup(() => {
		now = 0;
		gitOptions = {};
		sinon.stub(defaultBranchLookupClock, 'now').callsFake(() => now);

		cache = new Cache();
		answers = {
			setHead: () => Promise.resolve(exited('')),
			lsRemote: () => Promise.resolve(exited('')),
		};

		git = new Git(() => Promise.resolve({ path: '/nonexistent/git-binary', version: '2.40.0' }), gitOptions);
		run = sinon.stub(git, 'run') as unknown as sinon.SinonStub<RunArgs, Promise<GitResult>>;
		run.callsFake((_options, ...args) => {
			switch (args[0]) {
				case 'symbolic-ref':
					return Promise.reject(notSymbolicRef);
				case 'remote':
					return answers.setHead();
				case 'ls-remote':
					return answers.lsRemote();
				default:
					return Promise.resolve(exited(''));
			}
		});

		provider = new BranchesGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		sinon.restore();
		git.dispose();
		cache.dispose();
	});

	test('runs the network reads without credential prompts and with a time limit', async () => {
		await provider.getDefaultBranchName(repoPath, 'origin');

		const calls = networkCalls();
		assert.deepStrictEqual(
			calls.map(c => c.args.slice(1)),
			[
				['remote', 'set-head', '-a', 'origin'],
				['ls-remote', '--symref', 'origin', 'HEAD'],
			],
		);
		for (const call of calls) {
			const options = call.args[0];
			assert.strictEqual(options.timeout, 10_000);
			assert.strictEqual(options.env.GIT_TERMINAL_PROMPT, '0');
			assert.strictEqual(options.env.GIT_ASKPASS, '');
			assert.deepStrictEqual(options.configs, ['-c', 'credential.interactive=false']);
			assert.ok(options.cwd != null);
		}
	});

	test('without a host quiet-network environment the askpass defaults are unchanged', async () => {
		await provider.getDefaultBranchName(repoPath, 'origin');

		for (const call of networkCalls()) {
			assert.deepStrictEqual(call.args[0].env, {
				GIT_TERMINAL_PROMPT: '0',
				GIT_ASKPASS: '',
				SSH_ASKPASS: '',
				SSH_ASKPASS_REQUIRE: 'never',
				GCM_INTERACTIVE: 'never',
			});
		}
	});

	test('the host quiet-network environment replaces the askpass defaults for ls-remote and set-head', async () => {
		const hostEnv = {
			SSH_ASKPASS: '/host/askpass',
			SSH_ASKPASS_REQUIRE: 'force',
			// Not an askpass key: the quiet defaults still win
			GIT_ASKPASS: '/host/git-askpass',
			GIT_TERMINAL_PROMPT: '1',
		};
		gitOptions.getQuietNetworkEnvironment = () => hostEnv;

		await provider.getDefaultBranchName(repoPath, 'origin');

		const calls = networkCalls();
		assert.deepStrictEqual(
			calls.map(c => c.args[1]),
			['remote', 'ls-remote'],
		);
		for (const call of calls) {
			const env = call.args[0].env;
			assert.strictEqual(env.SSH_ASKPASS, '/host/askpass');
			assert.strictEqual(env.SSH_ASKPASS_REQUIRE, 'force');
			assert.strictEqual(env.GIT_ASKPASS, '');
			assert.strictEqual(env.GIT_TERMINAL_PROMPT, '0');
			assert.strictEqual(env.GCM_INTERACTIVE, 'never');
			assert.deepStrictEqual(call.args[0].configs, ['-c', 'credential.interactive=false']);
		}
	});

	test('the merged environment is reused while the host returns the same reference', async () => {
		const hostEnv = { SSH_ASKPASS: '/host/askpass' };
		gitOptions.getQuietNetworkEnvironment = () => hostEnv;

		await provider.getDefaultBranchName(repoPath, 'origin');
		await provider.setRemoteHeadIfMissing(repoPath, 'origin');

		const envs = networkCalls().map((c): unknown => c.args[0].env);
		assert.strictEqual(envs.length, 3);
		assert.ok(envs.every(e => e === envs[0]));
	});

	test('the merge is made again when the host returns a new reference', async () => {
		let hostEnv = { SSH_ASKPASS: '/host/one' };
		gitOptions.getQuietNetworkEnvironment = () => hostEnv;

		await provider.setRemoteHeadIfMissing(repoPath, 'origin');
		hostEnv = { SSH_ASKPASS: '/host/two' };
		await provider.setRemoteHeadIfMissing(repoPath, 'origin');

		assert.deepStrictEqual(
			networkCalls().map((c): unknown => c.args[0].env.SSH_ASKPASS),
			['/host/one', '/host/two'],
		);
	});

	test("an askpass key the host leaves out drops core's default, and one it sets to undefined is unset", async () => {
		gitOptions.getQuietNetworkEnvironment = () => ({ SSH_ASKPASS: undefined, DISPLAY: ':0' });

		await provider.getDefaultBranchName(repoPath, 'origin');

		const calls = networkCalls();
		assert.strictEqual(calls.length, 2);
		for (const call of calls) {
			assert.deepStrictEqual(call.args[0].env, {
				GIT_TERMINAL_PROMPT: '0',
				GIT_ASKPASS: '',
				SSH_ASKPASS: undefined,
				GCM_INTERACTIVE: 'never',
				DISPLAY: ':0',
			});
		}
	});

	test('an empty host environment leaves the ssh askpass to the inherited environment', async () => {
		gitOptions.getQuietNetworkEnvironment = () => ({});

		await provider.getDefaultBranchName(repoPath, 'origin');

		const calls = networkCalls();
		assert.strictEqual(calls.length, 2);
		for (const call of calls) {
			assert.deepStrictEqual(call.args[0].env, {
				GIT_TERMINAL_PROMPT: '0',
				GIT_ASKPASS: '',
				GCM_INTERACTIVE: 'never',
			});
		}
	});

	test('a lookup the local symref answers never asks the host for its environment', async () => {
		const getQuietNetworkEnvironment = sinon.stub<[], Record<string, string | undefined> | undefined>();
		gitOptions.getQuietNetworkEnvironment = getQuietNetworkEnvironment;
		run.callsFake((_options, ...args) =>
			Promise.resolve(exited(args[0] === 'symbolic-ref' ? 'origin/main\n' : '')),
		);

		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), 'origin/main');
		assert.strictEqual(networkCalls().length, 0);
		assert.strictEqual(getQuietNetworkEnvironment.callCount, 0);
	});

	test('a failed attempt is not repeated within the wait, and is after it', async () => {
		answers.setHead = () => Promise.reject(new Error('fatal: unable to access'));

		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), undefined);
		assert.strictEqual(networkCalls().length, 1);

		now += failedLookupWait - 1;
		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), undefined);
		assert.strictEqual(networkCalls().length, 1, 'no network run within the wait');
		assert.ok(
			run.getCalls().filter(c => c.args[1] === 'symbolic-ref').length >= 2,
			'the local symbolic-ref still runs',
		);

		now += 1;
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2, 'the network is tried again once the wait has passed');
	});

	test('a change to the remotes ends the wait, so a fixed remote is tried again straight away', async () => {
		answers.setHead = () => Promise.reject(new Error('fatal: unable to access'));

		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 1);

		// `git remote set-url`, or a sign-in that rewrote the remote's config
		cache.clearCaches(repoPath, 'remotes');
		now += 1000;
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2, 'the network is tried again within the wait');
	});

	test('a change to something else keeps the wait', async () => {
		answers.setHead = () => Promise.reject(new Error('fatal: unable to access'));

		await provider.getDefaultBranchName(repoPath, 'origin');
		cache.clearCaches(repoPath, 'stashes');
		now += 1000;
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 1);
	});

	test('a clock that went back ends the wait', async () => {
		answers.setHead = () => Promise.reject(new Error('fatal: unable to access'));

		await provider.getDefaultBranchName(repoPath, 'origin');
		now -= 1;
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2);
	});

	test('the lookup dropping its own cached local default branch keeps the failure that follows held', async () => {
		// `set-head` succeeds and drops the `local` variant, yet the symref still reads as missing and `ls-remote` fails
		answers.lsRemote = () => Promise.reject(new Error('fatal: unable to access'));

		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2);

		now += 1000;
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2, 'held off within the wait');
	});

	test('a failed ls-remote is remembered, per remote', async () => {
		answers.lsRemote = () => Promise.reject(new Error('fatal: unable to access'));

		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2);

		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2);

		await provider.getDefaultBranchName(repoPath, 'upstream');
		assert.strictEqual(networkCalls().length, 4, 'another remote is not held back');
	});

	test('a run that ran out of time is a failure, not a cancellation', async () => {
		answers.setHead = () => Promise.reject(new CancellationError(new Error('timed out'), 'timeout'));

		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), undefined);
		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), undefined);
		assert.strictEqual(networkCalls().length, 1);
	});

	test('a failure of an attempt that a change overlapped is not held off', async () => {
		answers.setHead = () => {
			// The remote's config changes while the attempt runs, so the failure may not be about the new one
			cache.clearCaches(repoPath, 'remotes');
			return Promise.reject(new Error('fatal: unable to access'));
		};

		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), undefined);
		assert.strictEqual(networkCalls().length, 1);

		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2, 'the network is tried again at once');
	});

	test('a failure of an attempt a change overlapped does not end the hold of one started after the change', async () => {
		const unableToAccess = () => new Error('fatal: unable to access');
		const inFlight: ((ex: Error) => void)[] = [];
		answers.setHead = () =>
			inFlight.length < 2
				? new Promise<GitResult>((_resolve, reject) => inFlight.push(reject))
				: Promise.reject(unableToAccess());
		const settle = async (count: number) => {
			while (inFlight.length < count) {
				await new Promise(resolve => setImmediate(resolve));
			}
		};

		const first = provider.getDefaultBranchName(repoPath, 'origin');
		await settle(1);
		// A write changes the remotes while the first attempt waits on the network, so the next call starts its own
		cache.evictCaches(repoPath, 'remotes');
		const second = provider.getDefaultBranchName(repoPath, 'origin');
		await settle(2);

		// The later attempt fails first, then the earlier one
		inFlight[1](unableToAccess());
		assert.strictEqual(await second, undefined);
		inFlight[0](unableToAccess());
		assert.strictEqual(await first, undefined);
		assert.strictEqual(networkCalls().length, 2);

		now += 1000;
		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), undefined);
		assert.strictEqual(networkCalls().length, 2, 'the later failure is still held');
	});

	test('a cancelled attempt is rethrown and not remembered', async () => {
		answers.setHead = () => Promise.reject(new CancellationError(new Error('aborted'), 'aborted'));

		await assert.rejects(provider.getDefaultBranchName(repoPath, 'origin'), isCancellationError);

		answers.setHead = () => Promise.resolve(exited(''));
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 3, 'the cancelled attempt did not hold the network back');
	});

	test('a cancelled ls-remote is rethrown too', async () => {
		answers.lsRemote = () => Promise.reject(new CancellationError(new Error('aborted'), 'aborted'));

		await assert.rejects(provider.getDefaultBranchName(repoPath, 'origin'), isCancellationError);
	});

	test('a lookup that succeeds clears the remembered failure', async () => {
		answers.setHead = () => Promise.reject(new Error('fatal: unable to access'));
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 1);

		// The symref turns up some other way (a fetch, the user), so the lookup answers without the network
		run.callsFake((_options, ...args) =>
			args[0] === 'symbolic-ref' ? Promise.resolve(exited('origin/main\n')) : Promise.resolve(exited('')),
		);
		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), 'origin/main');

		// ...and then goes again, still within the wait of the first failure
		run.callsFake((_options, ...args) => {
			switch (args[0]) {
				case 'symbolic-ref':
					return Promise.reject(notSymbolicRef);
				case 'remote':
					return answers.setHead();
				default:
					return Promise.resolve(exited(''));
			}
		});
		evictCachedAnswer();
		now += 1000;
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 2, 'the earlier failure is not held against the remote any more');
	});

	test('a remote that advertises no HEAD is an answer, not a failure', async () => {
		assert.strictEqual(await provider.getDefaultBranchName(repoPath, 'origin'), undefined);
		assert.strictEqual(networkCalls().length, 2);

		evictCachedAnswer();
		await provider.getDefaultBranchName(repoPath, 'origin');
		assert.strictEqual(networkCalls().length, 4, 'asked again, not held back');
	});
});
