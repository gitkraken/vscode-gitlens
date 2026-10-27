import * as assert from 'assert';
import { resolve } from 'path';
import { RunError } from '../exec.errors.js';
import type { RunResult } from '../exec.js';
import { Git, GitError, isRunHookFailure } from '../git.js';
import { indexLockRetryDelays, isConfigCommand, isConfigLockHeldError, isIndexWriteCommand } from '../indexLock.js';

type FakeSpawn = (
	args: readonly string[],
	cwd: string | undefined,
	env: Record<string, string | undefined>,
) => Promise<RunResult<string>>;

const lockMessage =
	"fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running";

function lockHeld(): RunError {
	return new RunError({ message: 'Command failed', code: 128 }, '', lockMessage);
}

function ok(): Promise<RunResult<string>> {
	return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
}

function sleep(ms: number): Promise<void> {
	return new Promise(r => setTimeout(r, ms));
}

suite('Git index.lock handling', () => {
	const repoA = resolve('/test/repo-a');
	const repoB = resolve('/test/repo-b');

	let git: Git;
	let spawned: { args: readonly string[]; cwd: string | undefined }[];

	function fake(impl: FakeSpawn): void {
		spawned = [];
		(git as unknown as { _runSpawn: unknown })._runSpawn = (
			_cmd: string,
			args: readonly string[],
			_encoding: string,
			options: { cwd?: string; env?: Record<string, string | undefined> },
		) => {
			spawned.push({ args: args, cwd: options.cwd });
			return impl(args, options.cwd, options.env ?? {});
		};
	}

	setup(() => {
		git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
	});

	suite('isIndexWriteCommand', () => {
		test('matches index-writing verbs, skipping leading global options', () => {
			for (const verb of [
				'add',
				'rm',
				'mv',
				'reset',
				'restore',
				'checkout',
				'switch',
				'commit',
				'update-index',
				'read-tree',
			]) {
				assert.ok(isIndexWriteCommand([verb, 'x']), verb);
			}
			assert.ok(isIndexWriteCommand(['-c', 'a.b=c', '-C', '/other', 'add', 'x']));
		});

		test('apply only counts with --index, --cached or --3way', () => {
			assert.ok(!isIndexWriteCommand(['apply', 'p.patch']));
			assert.ok(isIndexWriteCommand(['apply', '--cached', 'p.patch']));
			assert.ok(isIndexWriteCommand(['apply', '--index', 'p.patch']));
			assert.ok(isIndexWriteCommand(['apply', '--whitespace=warn', '--3way']), '--3way implies --index');
			assert.ok(isIndexWriteCommand(['apply', '-3', 'p.patch']), '-3 implies --index');
			assert.ok(!isIndexWriteCommand(['apply', '--check', '--index', 'p.patch']), '--check writes nothing');
			assert.ok(!isIndexWriteCommand(['apply', '--cached', '--check', 'p.patch']), '--check writes nothing');
		});

		test('leaves multi-step, long-running and read verbs alone', () => {
			for (const verb of ['stash', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull', 'status', 'log']) {
				assert.ok(!isIndexWriteCommand([verb]), verb);
			}
		});
	});

	suite('retry', () => {
		test('retries a run that finds the lock held, then resolves', async () => {
			let calls = 0;
			fake(() => (++calls === 1 ? Promise.reject(lockHeld()) : ok()));

			const result = await git.run({ cwd: repoA }, 'add', 'file.ts');

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(spawned.length, 2);
			assert.deepStrictEqual(spawned[0].args, spawned[1].args);
		});

		test('tells onSpawn of the first spawn only', async () => {
			let calls = 0;
			fake(() => (++calls === 1 ? Promise.reject(lockHeld()) : ok()));
			let spawns = 0;

			await git.run({ cwd: repoA, onSpawn: () => spawns++ }, 'add', 'file.ts');

			assert.strictEqual(spawned.length, 2);
			assert.strictEqual(spawns, 1);
		});

		test('gives up after the last delay and rethrows the lock error', async () => {
			fake(() => Promise.reject(lockHeld()));

			await assert.rejects(git.run({ cwd: repoA }, 'add', 'file.ts'), (ex: unknown) => {
				assert.ok(ex instanceof Error);
				assert.match(ex.message, /index\.lock/);
				return true;
			});
			assert.strictEqual(spawned.length, indexLockRetryDelays.length + 1);
		});

		test("retries before 'ignore' resolves the failed completion", async () => {
			let calls = 0;
			fake(() => (++calls < 3 ? Promise.reject(lockHeld()) : ok()));

			const result = await git.run({ cwd: repoA, errors: 'ignore' }, 'add', 'file.ts');

			assert.strictEqual(result.completion.status, 'exited');
			assert.strictEqual(spawned.length, 3);
		});

		test('does not retry a different failure', async () => {
			fake(() =>
				Promise.reject(
					new RunError({ message: 'Command failed', code: 128 }, '', 'fatal: pathspec x did not match'),
				),
			);

			await assert.rejects(git.run({ cwd: repoA }, 'add', 'x'));
			assert.strictEqual(spawned.length, 1);
		});

		test('does not retry when the lock line follows other output, as from a hook', async () => {
			fake(() =>
				Promise.reject(
					new RunError(
						{ message: 'Command failed', code: 1 },
						'',
						`running pre-commit checks\n${lockMessage}`,
					),
				),
			);

			await assert.rejects(git.run({ cwd: repoA, stdin: 'msg' }, 'commit', '-F', '-'));
			assert.strictEqual(spawned.length, 1);
		});

		test('does not retry the leading lock line when the run exited 1, as from a failing hook', async () => {
			fake(() => Promise.reject(new RunError({ message: 'Command failed', code: 1 }, '', lockMessage)));

			await assert.rejects(git.run({ cwd: repoA, stdin: 'msg' }, 'commit', '-F', '-'));
			assert.strictEqual(spawned.length, 1);
		});

		test("retries when the lock line follows git's own warning", async () => {
			let calls = 0;
			fake(() =>
				++calls === 1
					? Promise.reject(
							new RunError(
								{ message: 'Command failed', code: 128 },
								'',
								`warning: refname 'other' is ambiguous.\n${lockMessage}`,
							),
						)
					: ok(),
			);

			const result = await git.run({ cwd: repoA }, 'checkout', 'other');

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(spawned.length, 2);
		});

		test('does not retry a verb outside the set', async () => {
			fake(() => Promise.reject(lockHeld()));

			await assert.rejects(git.run({ cwd: repoA }, 'merge', 'topic'));
			assert.strictEqual(spawned.length, 1);
		});

		test('a cancellation during the wait rejects without another spawn', async () => {
			fake(() => Promise.reject(lockHeld()));
			const controller = new AbortController();

			const run = git.run({ cwd: repoA, cancellation: controller.signal }, 'add', 'file.ts');
			await sleep(30);
			controller.abort();

			await assert.rejects(run, (ex: unknown) => ex instanceof Error && ex.name === 'CancellationError');
			assert.strictEqual(spawned.length, 1);
		});
	});

	suite('beforeIndexLockRetry', () => {
		test('runs once per retry, with the lock error, after the wait', async () => {
			let calls = 0;
			fake(() => (++calls < 3 ? Promise.reject(lockHeld()) : ok()));
			const seen: { error: Error; spawns: number; at: number }[] = [];
			const start = Date.now();

			const result = await git.run(
				{
					cwd: repoA,
					beforeIndexLockRetry: error => {
						seen.push({ error: error, spawns: spawned.length, at: Date.now() - start });
					},
				},
				'commit',
				'-m',
				'x',
			);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(spawned.length, 3);
			assert.strictEqual(seen.length, 2);
			assert.deepStrictEqual(
				seen.map(s => s.spawns),
				[1, 2],
				'each call sits between the failed attempt and the next',
			);
			assert.ok(seen.every(s => s.error instanceof RunError && s.error.stderr.includes('index.lock')));
			assert.ok(seen[0].at >= indexLockRetryDelays[0] - 10, 'after the first delay');
			assert.ok(seen[1].at >= indexLockRetryDelays[0] + indexLockRetryDelays[1] - 10, 'after the second delay');
		});

		test('is not called when the first attempt succeeds', async () => {
			fake(() => ok());
			let calls = 0;

			await git.run({ cwd: repoA, beforeIndexLockRetry: () => void calls++ }, 'add', 'file.ts');

			assert.strictEqual(calls, 0);
		});

		test('waits for an async hook before the next attempt', async () => {
			let calls = 0;
			fake(() => (++calls === 1 ? Promise.reject(lockHeld()) : ok()));
			let hookDone = false;
			let hookDoneBeforeRetry = false;
			const inner = (git as unknown as { _runSpawn: (...a: unknown[]) => Promise<RunResult<string>> })._runSpawn;
			(git as unknown as { _runSpawn: unknown })._runSpawn = (...a: unknown[]) => {
				hookDoneBeforeRetry = hookDone;
				return inner(...a);
			};

			await git.run(
				{
					cwd: repoA,
					beforeIndexLockRetry: async () => {
						await sleep(30);
						hookDone = true;
					},
				},
				'add',
				'file.ts',
			);

			assert.strictEqual(spawned.length, 2);
			assert.ok(hookDoneBeforeRetry);
		});

		test('a rejecting hook stops the retrying and rejects with its error', async () => {
			fake(() => Promise.reject(lockHeld()));
			const failure = new Error('staged set changed');

			await assert.rejects(
				git.run(
					{
						cwd: repoA,
						beforeIndexLockRetry: () => {
							throw failure;
						},
					},
					'commit',
					'-m',
					'x',
				),
				(ex: unknown) => ex === failure,
			);
			assert.strictEqual(spawned.length, 1);
			assert.ok(isRunHookFailure(failure));
			assert.ok(!isRunHookFailure(new Error('staged set changed')));
			assert.ok(!isRunHookFailure('staged set changed'));
		});

		test("a rejecting hook rejects under errors: 'ignore' and 'throw' too", async () => {
			const failure = new Error('staged set changed');

			for (const errors of ['ignore', 'throw'] as const) {
				fake(() => Promise.reject(lockHeld()));

				await assert.rejects(
					git.run(
						{
							cwd: repoA,
							errors: errors,
							beforeIndexLockRetry: () => Promise.reject(failure),
						},
						'commit',
						'-m',
						'x',
					),
					(ex: unknown) => ex === failure,
					errors,
				);
				assert.strictEqual(spawned.length, 1, errors);
			}
		});

		test('throwing the lock error back opts out of the retry', async () => {
			fake(() => Promise.reject(lockHeld()));

			await assert.rejects(
				git.run(
					{
						cwd: repoA,
						beforeIndexLockRetry: error => {
							throw error;
						},
					},
					'commit',
					'-m',
					'x',
				),
				/index\.lock/,
			);
			assert.strictEqual(spawned.length, 1);
		});

		test('does not wedge the checkout when the hook rejects', async () => {
			let calls = 0;
			fake(() => (++calls === 1 ? Promise.reject(lockHeld()) : ok()));

			const first = git.run(
				{ cwd: repoA, beforeIndexLockRetry: () => Promise.reject(new Error('stop')) },
				'commit',
				'-m',
				'x',
			);
			const second = git.run({ cwd: repoA }, 'add', 'b.ts');

			await assert.rejects(first);
			assert.strictEqual((await second).exitCode, 0);
		});

		test('a run with the hook is not shared with an identical run without it', async () => {
			let release!: () => void;
			const gate = new Promise<void>(r => (release = r));
			fake(async () => {
				await gate;
				return ok();
			});

			const withHook = git.run({ cwd: repoA, beforeIndexLockRetry: () => {} }, 'commit', '-m', 'x');
			const without = git.run({ cwd: repoA }, 'commit', '-m', 'x');
			await sleep(20);
			release();
			await Promise.all([withHook, without]);

			assert.strictEqual(spawned.length, 2);
		});

		test('is not called for the config-lock retry', async () => {
			let calls = 0;
			fake(() =>
				++calls === 1
					? Promise.reject(
							new RunError(
								{ message: 'Command failed', code: 255 },
								'',
								'error: could not lock config file /repo/.git/config: File exists',
							),
						)
					: ok(),
			);
			let hookCalls = 0;

			await git.run({ cwd: repoA, beforeIndexLockRetry: () => void hookCalls++ }, 'config', 'a.b', 'c');

			assert.strictEqual(spawned.length, 2);
			assert.strictEqual(hookCalls, 0);
		});

		test('is not called for a failure that is not a lock failure', async () => {
			fake(() =>
				Promise.reject(
					new RunError({ message: 'Command failed', code: 128 }, '', 'fatal: pathspec x did not match'),
				),
			);
			let hookCalls = 0;

			await assert.rejects(git.run({ cwd: repoA, beforeIndexLockRetry: () => void hookCalls++ }, 'add', 'x'));

			assert.strictEqual(spawned.length, 1);
			assert.strictEqual(hookCalls, 0);
		});
	});

	suite('ordering', () => {
		/** Fakes a 40ms spawn and records how many were in flight at once, overall and per working directory. */
		function recordOverlap(): { overall: () => number; forCwd: (cwd: string) => number } {
			const active = new Map<string, number>();
			const peakByCwd = new Map<string, number>();
			let running = 0;
			let peak = 0;
			fake(async (_args, cwd) => {
				const key = cwd!;
				const now = (active.get(key) ?? 0) + 1;
				active.set(key, now);
				peakByCwd.set(key, Math.max(peakByCwd.get(key) ?? 0, now));
				peak = Math.max(peak, ++running);
				await sleep(40);
				running--;
				active.set(key, now - 1);
				return ok();
			});
			return { overall: () => peak, forCwd: cwd => peakByCwd.get(cwd) ?? 0 };
		}

		test('index writes on one cwd run one at a time, even across verbs', async () => {
			const peaks = recordOverlap();

			await Promise.all([
				git.run({ cwd: repoA }, 'add', 'a.ts'),
				git.run({ cwd: repoA }, 'commit', '-m', 'x'),
				git.run({ cwd: repoA }, 'add', 'b.ts'),
			]);

			assert.strictEqual(peaks.forCwd(repoA), 1);
		});

		test('index writes on different cwds overlap', async () => {
			const peaks = recordOverlap();

			await Promise.all([git.run({ cwd: repoA }, 'add', 'a.ts'), git.run({ cwd: repoB }, 'add', 'a.ts')]);

			assert.strictEqual(peaks.overall(), 2);
			assert.strictEqual(peaks.forCwd(repoA), 1);
		});

		test('a -C path decides the checkout a run belongs to', async () => {
			const peaks = recordOverlap();

			await Promise.all([
				git.run({ cwd: repoA }, 'add', 'a.ts'),
				git.run({ cwd: repoA }, '-C', repoB, 'add', 'a.ts'),
			]);

			assert.strictEqual(peaks.overall(), 2);
		});

		test('a run queued behind a slow one rejects promptly when aborted, without spawning', async () => {
			let release!: () => void;
			const gate = new Promise<void>(r => (release = r));
			fake(async () => {
				await gate;
				return ok();
			});

			const first = git.run({ cwd: repoA }, 'add', 'a.ts');
			await sleep(20);
			const controller = new AbortController();
			const queued = git.run({ cwd: repoA, cancellation: controller.signal }, 'add', 'b.ts');
			await sleep(20);
			controller.abort();

			await assert.rejects(queued, (ex: unknown) => ex instanceof Error && ex.name === 'CancellationError');
			assert.strictEqual(spawned.length, 1, 'the aborted run never spawned');

			// The aborted run must not release the checkout early: a later run still waits for the first
			const third = git.run({ cwd: repoA }, 'add', 'c.ts');
			await sleep(20);
			assert.strictEqual(spawned.length, 1);

			release();
			await Promise.all([first, third]);
			assert.strictEqual(spawned.length, 2);
		});

		test('a failing run does not wedge the checkout', async () => {
			let calls = 0;
			fake(() =>
				++calls === 1 ? Promise.reject(new RunError({ message: 'Command failed', code: 1 }, '', 'boom')) : ok(),
			);

			const first = git.run({ cwd: repoA }, 'add', 'a.ts');
			const second = git.run({ cwd: repoA }, 'add', 'b.ts');

			await assert.rejects(first);
			assert.strictEqual((await second).exitCode, 0);
		});

		test('a run with its own GIT_INDEX_FILE is not queued', async () => {
			const peaks = recordOverlap();

			await Promise.all([
				git.run({ cwd: repoA, env: { GIT_INDEX_FILE: '/tmp/idx-1' } }, 'add', 'a.ts'),
				git.run({ cwd: repoA, env: { GIT_INDEX_FILE: '/tmp/idx-2' } }, 'add', 'b.ts'),
			]);

			assert.strictEqual(peaks.forCwd(repoA), 2);
		});

		test('other verbs on the same cwd are not queued behind a write', async () => {
			const peaks = recordOverlap();

			await Promise.all([
				git.run({ cwd: repoA }, 'add', 'a.ts'),
				git.run({ cwd: repoA }, 'status'),
				git.run({ cwd: repoA }, 'merge', 'x'),
			]);

			assert.strictEqual(peaks.forCwd(repoA), 3);
		});
	});

	suite('config lock handling', () => {
		const configLockMessage = 'error: could not lock config file /repo/.git/gk/config: File exists';

		function configLockHeld(): RunError {
			return new RunError({ message: 'Command failed', code: 255 }, '', configLockMessage);
		}

		test('isConfigCommand finds the config verb past global options, and only that verb', () => {
			assert.ok(isConfigCommand(['config', '--local', 'a.b', 'c']));
			assert.ok(isConfigCommand(['-c', 'a.b=c', '-C', '/other', 'config', '--get', 'a.b']));
			for (const verb of ['branch', 'remote', 'add', 'status', 'worktree']) {
				assert.ok(!isConfigCommand([verb, 'config']), verb);
			}
			assert.ok(!isConfigCommand(['-c', 'config=x', 'branch', '-m', 'a', 'b']));
			assert.ok(!isConfigCommand([]));
		});

		test('isConfigLockHeldError matches git’s config lock failure', () => {
			assert.strictEqual(isConfigLockHeldError(configLockHeld()), true);
		});

		test('isConfigLockHeldError matches a reasonless failure and rejects permanent ones', () => {
			const failure = (stderr: string): RunError =>
				new RunError({ message: 'Command failed', code: 255 }, '', stderr);

			assert.strictEqual(
				isConfigLockHeldError(failure('error: could not lock config file C:/x/.git/config')),
				true,
			);
			assert.strictEqual(
				isConfigLockHeldError(failure('error: could not lock config file /x/.git/config: File exists\r\n')),
				true,
			);
			for (const reason of ['Permission denied', 'No such file or directory', 'Not a directory']) {
				assert.strictEqual(
					isConfigLockHeldError(failure(`error: could not lock config file /x/.git/config: ${reason}`)),
					false,
					reason,
				);
			}
		});

		test('a config run that fails permanently is not retried', async () => {
			for (const reason of ['Permission denied', 'No such file or directory']) {
				spawned.length = 0;
				fake(() =>
					Promise.reject(
						new RunError(
							{ message: 'Command failed', code: 255 },
							'',
							`error: could not lock config file /repo/.git/config: ${reason}`,
						),
					),
				);

				await assert.rejects(git.run({ cwd: repoA }, 'config', 'a.b', 'c'), /could not lock config file/);
				assert.strictEqual(spawned.length, 1, reason);
			}
		});

		test('a config run whose lock message has no reason is retried', async () => {
			let calls = 0;
			fake(() =>
				++calls === 1
					? Promise.reject(
							new RunError(
								{ message: 'Command failed', code: 255 },
								'',
								'error: could not lock config file /repo/.git/config',
							),
						)
					: ok(),
			);

			const result = await git.run({ cwd: repoA }, 'config', '--remove-section', 'a');

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(spawned.length, 2);
		});

		test('isConfigLockHeldError ignores unrelated failures', () => {
			assert.strictEqual(isConfigLockHeldError(lockHeld()), false);
			assert.strictEqual(
				isConfigLockHeldError(
					new RunError({ message: 'Command failed', code: 5 }, '', 'error: key does not contain a section'),
				),
				false,
			);
			assert.strictEqual(isConfigLockHeldError(new Error(configLockMessage)), false);
			assert.strictEqual(isConfigLockHeldError(new GitError(configLockHeld())), false);
			assert.strictEqual(isConfigLockHeldError(undefined), false);
		});

		test('a config run that finds the lock held is retried, then resolves', async () => {
			let calls = 0;
			fake(() => (++calls === 1 ? Promise.reject(configLockHeld()) : ok()));

			const result = await git.run({ cwd: repoA }, 'config', 'a.b', 'c');

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(spawned.length, 2);
		});

		test("retries before 'ignore' resolves the failed completion", async () => {
			let calls = 0;
			fake(() => (++calls < 3 ? Promise.reject(configLockHeld()) : ok()));

			const result = await git.run({ cwd: repoA, errors: 'ignore' }, 'config', '-f', '/x/config', 'a.b', 'c');

			assert.strictEqual(result.completion.status, 'exited');
			assert.strictEqual(spawned.length, 3);
		});

		test('gives up after the last delay: throws, or resolves the failure under ignore', async () => {
			fake(() => Promise.reject(configLockHeld()));

			await assert.rejects(git.run({ cwd: repoA }, 'config', 'a.b', 'c'), /could not lock config file/);
			assert.strictEqual(spawned.length, indexLockRetryDelays.length + 1);

			const result = await git.run({ cwd: repoA, errors: 'ignore' }, 'config', 'a.b', 'c');
			assert.match(result.stderr ?? '', /could not lock config file/);
			assert.strictEqual(spawned.length, (indexLockRetryDelays.length + 1) * 2);
		});

		test('does not retry other verbs that write config, or a different config failure', async () => {
			fake(() => Promise.reject(configLockHeld()));
			await assert.rejects(git.run({ cwd: repoA }, 'branch', '-m', 'a', 'b'));
			await assert.rejects(git.run({ cwd: repoA }, 'remote', 'add', 'o', 'url'));
			assert.strictEqual(spawned.length, 2);

			fake(() =>
				Promise.reject(
					new RunError({ message: 'Command failed', code: 5 }, '', 'error: key does not contain a section'),
				),
			);
			await assert.rejects(git.run({ cwd: repoA }, 'config', 'x', 'y'));
			assert.strictEqual(spawned.length, 1);
		});

		test('a config read that succeeds spawns once', async () => {
			fake(() => ok());

			await git.run({ cwd: repoA }, 'config', '--get', 'a.b');
			assert.strictEqual(spawned.length, 1);
		});
	});
});
