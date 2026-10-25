import * as assert from 'assert';
import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { execPath } from 'process';
import * as sinon from 'sinon';
import { normalizePath } from '@gitlens/utils/path.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import type { CommandChanges } from '../commandClassifier.js';
import { CancelledRunError, RunError } from '../exec.errors.js';
import type { ProcessSpawner } from '../exec.js';
import { run, runSpawn } from '../exec.js';
import type { GitResultCache } from '../exec.types.js';
import { defaultExceptionHandler, Git, GitError } from '../git.js';
import type { HeadState } from '../headState.js';

function nodeArgs(script: string): string[] {
	return ['-e', script];
}

function bufferLiteral(bytes: readonly number[]): string {
	return `Buffer.from([${bytes.join(', ')}])`;
}

suite('Shell Test Suite', () => {
	const nodeExecutable = execPath;

	suite('run()', () => {
		test('returns stdout and skips decode for utf8 output', async () => {
			const decodeSpy = sinon.spy(async (_buf: Uint8Array) => 'decoded');

			const result = await run(nodeExecutable, nodeArgs(`process.stdout.write('hello');`), 'utf8', {
				decode: decodeSpy,
			});

			assert.strictEqual(result, 'hello');
			assert.strictEqual(decodeSpy.callCount, 0);
		});

		test('passes raw bytes to decode for non-standard encodings', async () => {
			const bytes = [0x82, 0xb1];
			let receivedBuffer: Uint8Array | undefined;
			const decodeSpy = sinon.spy(async (buffer: Uint8Array, options?: { readonly encoding: string }) => {
				receivedBuffer = buffer;
				assert.deepStrictEqual(options, { encoding: 'shiftjis' });
				return 'decoded-output';
			});

			const result = await run(
				nodeExecutable,
				nodeArgs(`process.stdout.write(${bufferLiteral(bytes)});`),
				'shiftjis',
				{ encoding: 'binary', decode: decodeSpy },
			);

			assert.strictEqual(result, 'decoded-output');
			assert.strictEqual(decodeSpy.callCount, 1);
			assert.deepStrictEqual([...receivedBuffer!], bytes);
		});

		test('decodes stdout and stderr into RunError on failure', async () => {
			const stdoutBytes = [0x82, 0xb1];
			const stderrBytes = [0xa4, 0xa4];
			const decodeSpy = sinon
				.stub()
				.callsFake(async (buffer: Uint8Array, options?: { readonly encoding: string }) => {
					assert.deepStrictEqual(options, { encoding: 'shiftjis' });
					return `decoded:${Buffer.from(buffer).toString('hex')}`;
				});

			await assert.rejects(
				run(
					nodeExecutable,
					nodeArgs(
						`process.stdout.write(${bufferLiteral(stdoutBytes)});process.stderr.write(${bufferLiteral(stderrBytes)});process.exit(23);`,
					),
					'shiftjis',
					{ encoding: 'binary', decode: decodeSpy },
				),
				(error: unknown) => {
					assert.ok(error instanceof RunError);
					assert.strictEqual(error.code, 23);
					assert.strictEqual(error.stdout, 'decoded:82b1');
					assert.strictEqual(error.stderr, 'decoded:a4a4');
					assert.strictEqual(decodeSpy.callCount, 2);
					return true;
				},
			);
		});
	});

	suite('runSpawn()', () => {
		test('returns stdout, stderr, and exit code on success', async () => {
			const result = await runSpawn<string>(
				nodeExecutable,
				nodeArgs(`process.stdout.write('out');process.stderr.write('warn');`),
				'utf8',
				{},
			);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout, 'out');
			assert.strictEqual(result.stderr, 'warn');
		});

		test('writes stdin to the child process', async () => {
			const result = await runSpawn<string>(
				nodeExecutable,
				nodeArgs(
					`process.stdin.setEncoding('utf8');let input='';process.stdin.on('data', chunk => input += chunk);process.stdin.on('end', () => process.stdout.write(input.toUpperCase()));process.stdin.resume();`,
				),
				'utf8',
				{ stdin: 'hello from stdin' },
			);

			assert.strictEqual(result.stdout, 'HELLO FROM STDIN');
		});

		// An empty string is still stdin: the pipe has to close, or a process that reads to EOF (`hash-object
		// --stdin`, `commit -F -`) waits until the command timeout kills it.
		test('closes stdin when it is an empty string', async () => {
			const result = await runSpawn<string>(
				nodeExecutable,
				nodeArgs(`process.stdin.on('end', () => process.stdout.write('eof'));process.stdin.resume();`),
				'utf8',
				{ stdin: '', timeout: 5000 },
			);

			assert.strictEqual(result.stdout, 'eof');
		});

		test('returns the exit code without rejecting when exitCodeOnly is set', async () => {
			const result = await runSpawn(nodeExecutable, nodeArgs(`process.exit(7);`), 'utf8', {
				exitCodeOnly: true,
			});

			assert.strictEqual(result.exitCode, 7);
		});

		// Pins the premise behind `Git.run`'s SIGTERM branch: a native spawn `timeout` kills the child and
		// fires `close(null, 'SIGTERM')` WITHOUT an `error` event, so `exitCodeOnly` resolves a codeless result
		// rather than rejecting into `CancelledRunError` the way every other timeout does. If Node ever changes
		// that, the classification upstream is what breaks.
		test('exitCodeOnly resolves with the signal and no code when a timeout kills the process', async () => {
			const result = await runSpawn(nodeExecutable, nodeArgs(`setTimeout(() => {}, 5000);`), 'utf8', {
				exitCodeOnly: true,
				timeout: 300,
			});

			assert.strictEqual(result.exitCode, undefined, 'a timed-out process never reports an exit code');
			assert.strictEqual(result.signal, 'SIGTERM', 'the default kill signal, not a crash signal');
		});

		// A non-SIGTERM kill rejects with a `RunError` carrying the signal and NO code. That `code == null` is
		// what `Git.run` used to turn into `exitCode: 0` — a killed command reported as a clean success.
		//
		// POSIX-only: Windows has no signals, so `process.kill(pid, 'SIGKILL')` becomes `TerminateProcess` and
		// Node reports a plain `close(1, null)` — a non-zero exit, not the signalled case under test.
		(process.platform === 'win32' ? test.skip : test)(
			'rejects with the signal and no exit code when killed by a signal',
			async () => {
				const result = await runSpawn<string>(
					nodeExecutable,
					nodeArgs(`process.kill(process.pid, 'SIGKILL');setTimeout(() => {}, 1000);`),
					'utf8',
					{},
				).then(
					() => undefined,
					(ex: unknown) => ex,
				);

				assert.ok(result instanceof RunError, `expected a RunError, got ${String(result)}`);
				assert.strictEqual(result.code ?? undefined, undefined, 'a signalled process has no exit code');
				assert.strictEqual(result.signal, 'SIGKILL');
			},
		);

		test('returns raw buffers for buffer encoding', async () => {
			const stdoutBytes = [0xde, 0xad];
			const stderrBytes = [0xbe, 0xef];

			const result = await runSpawn<Buffer>(
				nodeExecutable,
				nodeArgs(
					`process.stdout.write(${bufferLiteral(stdoutBytes)});process.stderr.write(${bufferLiteral(stderrBytes)});`,
				),
				'buffer',
				{},
			);

			assert.deepStrictEqual([...result.stdout], stdoutBytes);
			assert.deepStrictEqual([...result.stderr], stderrBytes);
		});

		test('passes raw bytes to decode for real-world encodings', async () => {
			const encodingFixtures = [
				{ encoding: 'windows1252', bytes: [0xe9, 0xf1, 0xfc] },
				{ encoding: 'shiftjis', bytes: [0x82, 0xb1] },
				{ encoding: 'big5', bytes: [0xa4, 0xa4] },
				{ encoding: 'gbk', bytes: [0xc4, 0xe3] },
				{ encoding: 'euckr', bytes: [0xb0, 0xa1] },
				{ encoding: 'iso88591', bytes: [0xe0, 0xe8, 0xf2] },
			];

			for (const { encoding, bytes } of encodingFixtures) {
				const receivedBuffers: Uint8Array[] = [];
				const decodeSpy = sinon.spy(async (buffer: Uint8Array, options?: { readonly encoding: string }) => {
					receivedBuffers.push(buffer);
					assert.deepStrictEqual(options, { encoding: encoding });
					return 'decoded';
				});

				const result = await runSpawn<string>(
					nodeExecutable,
					nodeArgs(`process.stdout.write(${bufferLiteral(bytes)});`),
					encoding,
					{ decode: decodeSpy },
				);

				assert.strictEqual(result.stdout, 'decoded');
				assert.strictEqual(decodeSpy.callCount, 2);
				assert.deepStrictEqual([...receivedBuffers[0]], bytes);
				assert.strictEqual(receivedBuffers[1].length, 0);
			}
		});

		test('decodes stdout and stderr into RunError on failure', async () => {
			const decodeSpy = sinon
				.stub()
				.callsFake(async (buffer: Uint8Array, options?: { readonly encoding: string }) => {
					assert.deepStrictEqual(options, { encoding: 'shiftjis' });
					return `decoded:${Buffer.from(buffer).toString('hex')}`;
				});

			await assert.rejects(
				runSpawn<string>(
					nodeExecutable,
					nodeArgs(
						`process.stdout.write(${bufferLiteral([0x82, 0xb1])});process.stderr.write(${bufferLiteral([0xa4, 0xa4])});process.exit(19);`,
					),
					'shiftjis',
					{ decode: decodeSpy },
				),
				(error: unknown) => {
					assert.ok(error instanceof RunError);
					assert.strictEqual(error.code, 19);
					assert.strictEqual(error.stdout, 'decoded:82b1');
					assert.strictEqual(error.stderr, 'decoded:a4a4');
					assert.strictEqual(decodeSpy.callCount, 2);
					return true;
				},
			);
		});

		test('maps aborts to CancelledRunError', async () => {
			const controller = new AbortController();
			const promise = runSpawn<string>(nodeExecutable, nodeArgs(`setTimeout(() => {}, 1000);`), 'utf8', {
				cancellation: controller.signal,
			});

			setTimeout(() => controller.abort(), 50);

			await assert.rejects(promise, (error: unknown) => {
				assert.ok(error instanceof CancelledRunError);
				return true;
			});
		});
	});

	suite('Git.run() caching + cancellation', () => {
		// A superseded caller's abort must not reject a concurrent same-command rider. `git.run`'s caching
		// branch must (a) forward the caller's cancellation into `getOrCreate`'s options — so each caller's
		// own wait is raced independently — (b) bind the underlying run to the AGGREGATE signal the cache
		// passes to the factory (fires only when all callers abort), NOT this caller's signal, and (c) NOT
		// cache the empty result an aborted run produces.
		test('forwards caller cancellation, binds the run to the aggregate signal, and invalidates aborted results', async () => {
			const git = new Git(async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }));

			// A non-aborted caller signal — if the factory (incorrectly) bound the run to this instead of the
			// aggregate, the command would proceed to spawn rather than cancel.
			const caller = new AbortController();

			// The aggregate the cache hands the factory once every caller has aborted. Abort it exactly as the
			// real `AbortAggregate` does — bare, no reason — so `GitQueue.run` rejects the still-queued command
			// with a plain `Error` (not a `CancelledRunError`), which under `errors: 'ignore'` resolves an empty
			// `failed`/`unstarted` result. That empty result is exactly what must NOT be cached, so the factory
			// has to invalidate on the aborted aggregate signal too, not just on a non-`exited` completion.
			const aggregate = new AbortController();
			aggregate.abort();

			const cacheable = new CacheController();
			let seenOptions: { cancellation?: AbortSignal; accessTTL?: number } | undefined;
			const fakeCache: GitResultCache = {
				getOrCreate: (_repoPath, _key, factory, options) => {
					seenOptions = options;
					return factory(cacheable, aggregate.signal);
				},
				delete: () => {},
			};

			const result = await git.run(
				{
					cwd: '/repo',
					cancellation: caller.signal,
					errors: 'ignore',
					caching: { cache: fakeCache, options: { accessTTL: 1234 } },
				},
				'merge-base',
				'--is-ancestor',
				'a',
				'b',
			);

			assert.strictEqual(
				seenOptions?.cancellation,
				caller.signal,
				'caller cancellation forwarded to getOrCreate',
			);
			assert.strictEqual(seenOptions?.accessTTL, 1234, 'existing caching options preserved');
			assert.strictEqual(caller.signal.aborted, false, 'caller signal never aborted');
			// A bare-abort queue splice rejects with a plain `Error` (see `abortReason`), not a
			// `CancelledRunError` — so it is NOT a cancellation. It never spawned, which `completion` can now
			// say; the old boolean could only report `cancelled: false`, indistinguishable from success.
			assert.strictEqual(result.completion.status, 'failed', 'queue-spliced bare abort is a failure');
			assert.strictEqual(
				result.completion.status === 'failed' && result.completion.reason,
				'unstarted',
				'queue-spliced bare abort never started a process',
			);
			assert.strictEqual(cacheable.invalidated, true, 'aborted result invalidated so it is never cached');
		});

		// `caching.force` has to drop the cached (or in-flight) entry BEFORE `getOrCreate` runs — otherwise a
		// forced caller could still join a run that started before it, or return the value it deleted right
		// before we asked for a fresh one.
		test('caching.force deletes the cached entry before getOrCreate', async () => {
			const git = new Git(async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }));

			const calls: string[] = [];
			const fakeCache: GitResultCache = {
				delete: (repoPath, key) => {
					calls.push(`delete:${repoPath}:${key}`);
				},
				getOrCreate: (repoPath, key, factory) => {
					calls.push(`getOrCreate:${repoPath}:${key}`);
					return factory(new CacheController());
				},
			};

			await git.run({ cwd: '/repo', errors: 'ignore', caching: { cache: fakeCache, force: true } }, 'status');

			assert.deepStrictEqual(calls, ['delete:/repo:git status', 'getOrCreate:/repo:git status']);
		});

		// Identical argv is not an identical command when the environment differs (`GIT_INDEX_FILE` for a
		// temporary index, a credential helper, config injected through `GIT_CONFIG_*`).
		test('concurrent runs with the same argv but a different per-call env are not shared', async () => {
			const git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
			const cwd = await mkdtemp(join(tmpdir(), 'gitlens-exec-test-'));

			try {
				const read = (value: string) =>
					git.run(
						{
							cwd: cwd,
							errors: 'throw',
							env: {
								GIT_CONFIG_COUNT: '1',
								GIT_CONFIG_KEY_0: 'gitlens.probe',
								GIT_CONFIG_VALUE_0: value,
							},
						},
						'config',
						'--get',
						'gitlens.probe',
					);
				const [a, b] = await Promise.all([read('first'), read('second')]);

				assert.strictEqual(a.stdout.trim(), 'first');
				assert.strictEqual(b.stdout.trim(), 'second');
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
		});

		// The throwing form of the same queue refusal. A typed mutator catches a `GitError` as "git refused",
		// so a cancellation that surfaced as one read as a failure of the operation itself.
		test('a command the queue refuses for an aborted signal rejects as a CancellationError', async () => {
			const git = new Git(async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }));

			await assert.rejects(
				git.run({ cwd: '/repo', cancellation: AbortSignal.abort() }, 'update-ref', 'refs/x', 'HEAD'),
				(err: unknown) => err instanceof Error && err.name === 'CancellationError',
			);
			// Narrow on purpose: a command that failed to start with no abort in play is still a git failure.
			await assert.rejects(
				git.run({ cwd: '/repo' }, 'update-ref', 'refs/x', 'HEAD'),
				(err: unknown) => err instanceof Error && err.name !== 'CancellationError',
			);
		});
	});

	// `GitResult.completion` exists because `exitCode` alone cannot answer "can I trust `stdout`?" — several
	// distinct outcomes all reported `0`. These pin the ones reachable without a real git binary; the
	// warning classification is covered directly since it is pure.
	suite('GitResult.completion', () => {
		test("a spawn failure is 'failed'/'unstarted' rather than a clean empty exit", async () => {
			const git = new Git(async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }));

			const result = await git.run({ cwd: '/repo', errors: 'ignore' }, 'status');

			assert.strictEqual(result.completion.status, 'failed');
			assert.strictEqual(result.completion.status === 'failed' && result.completion.reason, 'unstarted');
			assert.strictEqual(result.exitCode, undefined, 'no exit code is claimed for a command that never ran');
		});

		// The swallow path is the one a bare `exitCode` check cannot see: git DID run and fail, but the error
		// matched `GitWarnings`, so it was discarded and `stdout` came back empty. Exercised against the real
		// git binary (a hard dev prerequisite) because the classification only triggers on genuine git stderr —
		// a fake binary can't produce it.
		test("a swallowed warning is 'warned', carrying the key and the real exit code", async () => {
			const git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
			const cwd = await mkdtemp(join(tmpdir(), 'gitlens-exec-test-'));

			try {
				// No `errors` option on purpose — the default handling is what consults `GitWarnings`.
				const result = await git.run({ cwd: cwd }, 'status');

				assert.strictEqual(result.completion.status, 'warned');
				assert.strictEqual(
					result.completion.status === 'warned' && result.completion.warning,
					'notARepository',
					'the key is what lets a caller tell this from a genuinely empty answer',
				);
				assert.strictEqual(result.stdout, '', 'the swallowed warning leaves empty stdout behind');
				assert.strictEqual(result.exitCode, 128, 'the process did exit, so its code is reported');
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
		});
	});

	// The swallow path is what produced the sticky wrong answers: a `GitWarnings` match is logged and
	// discarded, leaving empty stdout that callers read as a real result. Returning WHICH key matched is what
	// lets them tell a genuinely empty answer (`noCommits`) from a read that never happened.
	suite('defaultExceptionHandler()', () => {
		test('returns the matched warning key instead of swallowing silently', () => {
			const key = defaultExceptionHandler(new Error('fatal: Not a git repository'), '/repo');

			assert.strictEqual(key, 'notARepository');
		});

		test('distinguishes an empty-repo warning from a failed read', () => {
			const key = defaultExceptionHandler(
				new Error("fatal: your current branch 'main' does not have any commits yet"),
				'/repo',
			);

			assert.strictEqual(key, 'noCommits', 'this one IS a real empty answer, unlike notARepository');
		});

		test('rethrows anything that matches no warning', () => {
			assert.throws(() => defaultExceptionHandler(new Error('fatal: something genuinely broken'), '/repo'));
		});

		test('returns undefined for a swallow that matched no table entry', () => {
			// The `^3` special case (stash untracked lookups) is swallowed but is not a `GitWarnings` match.
			const key = defaultExceptionHandler(new Error("fatal: bad revision 'stash@{0}^3'"), '/repo');

			assert.strictEqual(key, undefined, 'unclassified swallow — callers must treat it as not-an-answer');
		});
	});

	suite('Git.run() expectedExitCodes', () => {
		let cwd: string;
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }));

		suiteSetup(async () => {
			cwd = await mkdtemp(join(tmpdir(), 'gitlens-exec-test-'));
			await git.run({ cwd: cwd, errors: 'throw' }, 'init');
			await writeFile(join(cwd, 'file.txt'), 'staged\n');
			await git.run({ cwd: cwd, errors: 'throw' }, 'add', 'file.txt');
			await writeFile(join(cwd, 'file.txt'), 'modified\n');
		});

		suiteTeardown(async () => {
			await rm(cwd, { recursive: true, force: true });
		});

		test('a listed exit code resolves as an exited answer even under errors: throw', async () => {
			const result = await git.run({ cwd: cwd, errors: 'throw', expectedExitCodes: [1] }, 'diff', '--quiet');

			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual(result.completion.status, 'exited');
		});

		test('an unlisted non-zero exit still rejects as a GitError', async () => {
			await assert.rejects(
				git.run({ cwd: cwd, errors: 'throw' }, 'diff', '--quiet'),
				(ex: unknown) => ex instanceof GitError,
			);
		});
	});
});

suite('Git.ensureSupports', () => {
	test('preserves the public prefix and suffix message contract', async () => {
		const git = new Git(async () => ({ path: 'git', version: '2.7.2' }));

		await assert.rejects(
			git.ensureSupports('git:stash:push:staged', 'Staging files', ' Please upgrade Git.'),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.strictEqual(
					error.message,
					'Staging files requires a newer version of Git (>= 2.35.0) than is currently installed (2.7.2). Please upgrade Git.',
				);
				return true;
			},
		);
	});

	test('supports a complete message formatter with both versions', async () => {
		const git = new Git(async () => ({ path: 'git', version: '2.7.2' }));

		await assert.rejects(
			git.ensureSupports(
				'git:stash:push:staged',
				(requiredVersion, installedVersion) =>
					`Need Git ${requiredVersion}; installed Git is ${installedVersion}`,
			),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.strictEqual(error.message, 'Need Git 2.35.0; installed Git is 2.7.2');
				return true;
			},
		);
	});
});

suite('Git base environment', () => {
	type TestableGit = {
		getBaseEnv(): Record<string, string | undefined>;
		buildEnv(perCallEnv: Record<string, string | undefined> | undefined): Record<string, string | undefined>;
	};

	function asTestable(git: Git): TestableGit {
		return git as unknown as TestableGit;
	}

	// Repository-location keys a parent git process (a hook, `rebase -x`, an editor invoked as
	// GIT_EDITOR) sets for ITSELF, and which must not leak into a command we run against a different cwd.
	const droppedRepoLocationKeys = [
		'GIT_DIR',
		'GIT_WORK_TREE',
		'GIT_INDEX_FILE',
		'GIT_COMMON_DIR',
		'GIT_OBJECT_DIRECTORY',
		'GIT_ALTERNATE_OBJECT_DIRECTORIES',
		'GIT_NAMESPACE',
	] as const;
	// What git tells a child about the command it's running — not ours to inherit either.
	const droppedGitCommandKeys = [
		'GIT_CONFIG_PARAMETERS',
		'GIT_EXEC_PATH',
		'GIT_PREFIX',
		'GIT_REFLOG_ACTION',
	] as const;
	// Deliberate user/tool config for every git process — must survive, unlike GIT_CONFIG_PARAMETERS.
	const keptConfigKeys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'] as const;
	// Dropped only when git launched the host (`GIT_EXEC_PATH` inherited).
	const identityKeys = [
		'GIT_AUTHOR_NAME',
		'GIT_AUTHOR_EMAIL',
		'GIT_AUTHOR_DATE',
		'GIT_COMMITTER_NAME',
		'GIT_COMMITTER_EMAIL',
		'GIT_COMMITTER_DATE',
	] as const;

	const allTouchedKeys = [...droppedRepoLocationKeys, ...droppedGitCommandKeys, ...keptConfigKeys, ...identityKeys];
	let originalValues: Record<string, string | undefined>;

	setup(() => {
		originalValues = {};
		for (const key of allTouchedKeys) {
			originalValues[key] = process.env[key];
		}
		for (const key of [...droppedRepoLocationKeys, ...droppedGitCommandKeys, ...identityKeys]) {
			process.env[key] = `inherited-${key}`;
		}
		process.env.GIT_CONFIG_COUNT = '1';
		process.env.GIT_CONFIG_KEY_0 = 'user.name';
		process.env.GIT_CONFIG_VALUE_0 = 'Test';
	});

	teardown(() => {
		for (const key of allTouchedKeys) {
			if (originalValues[key] === undefined) {
				Reflect.deleteProperty(process.env, key);
			} else {
				process.env[key] = originalValues[key];
			}
		}
	});

	test('drops the repository location and the launching command state inherited from process.env', () => {
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
		const env = asTestable(git).getBaseEnv();

		for (const key of [...droppedRepoLocationKeys, ...droppedGitCommandKeys]) {
			assert.strictEqual(env[key], undefined, `${key} should have been dropped`);
		}

		assert.strictEqual(env.GIT_CONFIG_COUNT, '1');
		assert.strictEqual(env.GIT_CONFIG_KEY_0, 'user.name');
		assert.strictEqual(env.GIT_CONFIG_VALUE_0, 'Test');
	});

	test('drops an inherited author and committer when git launched the host', () => {
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
		const env = asTestable(git).getBaseEnv();

		for (const key of identityKeys) {
			assert.strictEqual(env[key], undefined, `${key} should have been dropped`);
		}
	});

	test('keeps a deliberately set author and committer when git did not launch the host', () => {
		Reflect.deleteProperty(process.env, 'GIT_EXEC_PATH');
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
		const env = asTestable(git).getBaseEnv();

		for (const key of identityKeys) {
			assert.strictEqual(env[key], `inherited-${key}`, `${key} should have been kept`);
		}
		// The repository location is dropped either way: a host pointed at one repository can't serve the rest
		assert.strictEqual(env.GIT_DIR, undefined);
	});

	test('static options.env can still set a dropped key', () => {
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }), {
			env: { GIT_DIR: '/explicit/.git' },
		});
		const env = asTestable(git).getBaseEnv();

		assert.strictEqual(env.GIT_DIR, '/explicit/.git');
	});

	test('a per-call env override can still set a dropped key', () => {
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
		const env = asTestable(git).buildEnv({ GIT_INDEX_FILE: '/tmp/index.tmp' });

		assert.strictEqual(env.GIT_INDEX_FILE, '/tmp/index.tmp');
	});
});

suite('Git.run notify', () => {
	type Notified = {
		repoPaths: readonly string[];
		changes: readonly string[];
		sharedPaths?: readonly string[];
		named?: { readonly refs: readonly string[]; readonly configConfinedToRefs?: boolean };
	};

	function newGitWithBinder(): { git: Git; notified: Notified[] } {
		// A nonexistent binary makes every run fail fast (ENOENT) without ever spawning a real process —
		// `notify` is applied once the run SETTLES regardless of outcome, so a failure exercises it exactly
		// like a success would, and much faster than a real git invocation.
		const git = new Git(async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }));
		const notified: Notified[] = [];
		git.bindChangeNotifier((repoPaths, changes, sharedPaths, named) => {
			const entry: Notified = { repoPaths: repoPaths, changes: changes };
			if (sharedPaths != null) {
				entry.sharedPaths = sharedPaths;
			}
			if (named != null) {
				entry.named = named;
			}
			notified.push(entry);
		});
		return { git: git, notified: notified };
	}

	test("notify: 'infer' on a write calls the binder once with cwd and the verb's changes", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

		assert.deepStrictEqual(notified, [{ repoPaths: ['/repo'], changes: ['head', 'heads', 'index', 'pausedOp'] }]);
	});

	test("notify: 'infer' on a read-only command never calls the binder", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'status');

		assert.deepStrictEqual(notified, []);
	});

	test("notify: 'infer' on a -C shared-state write announces the -C target and cwd in one call", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'branch', '-d', 'x');

		assert.deepStrictEqual(notified, [
			{
				repoPaths: [normalizePath(resolve('/repo', '/other')), '/repo'],
				changes: ['config', 'heads'],
				named: { refs: ['refs/heads/x'], configConfinedToRefs: true },
			},
		]);
	});

	test("notify: 'infer' on a -C branch-moving write announces the -C target, and only the branch move to cwd", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'commit', '-m', 'msg');

		assert.deepStrictEqual(notified, [
			{
				repoPaths: [normalizePath(resolve('/repo', '/other'))],
				changes: ['head', 'heads', 'index', 'pausedOp'],
				sharedPaths: ['/repo'],
			},
		]);
	});

	test("notify: 'infer' on a -C pull announces its worktree-local changes only to the -C target", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'pull');

		assert.strictEqual(notified.length, 1);
		assert.deepStrictEqual(notified[0].repoPaths, [normalizePath(resolve('/repo', '/other'))]);
		assert.deepStrictEqual(notified[0].sharedPaths, ['/repo']);
	});

	test("notify: 'infer' classifies the argv git sees, which options.configs leads", async () => {
		const { git, notified } = newGitWithBinder();
		git.bindHeadReader(() => Promise.resolve({ branch: 'refs/heads/feature' }));

		await git.run(
			{ cwd: '/repo', errors: 'ignore', notify: 'infer', configs: ['-C', '/other'] },
			'branch',
			'-d',
			'x',
		);
		// Update-refs is provably off only through the `-c` in `configs`
		await git.run(
			{ cwd: '/repo', errors: 'ignore', notify: 'infer', configs: ['-c', 'rebase.updateRefs=false'] },
			'rebase',
			'main',
		);

		assert.strictEqual(notified.length, 2);
		assert.deepStrictEqual(notified[0].repoPaths, [normalizePath(resolve('/repo', '/other')), '/repo']);
		assert.deepStrictEqual(notified[1].named, { refs: ['refs/heads/feature'] });
	});

	test("notify: 'infer' on a -C stash push announces only the stash to cwd", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'stash', 'push');

		assert.deepStrictEqual(notified, [
			{
				repoPaths: [normalizePath(resolve('/repo', '/other'))],
				changes: ['stash', 'index'],
				sharedPaths: ['/repo'],
				named: { refs: ['refs/stash'] },
			},
		]);
	});

	test("notify: 'infer' on a -C write it can't classify resets cwd too, since what it shares is unknown", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'reflog', 'expire', '--all');

		assert.deepStrictEqual(notified, [
			{ repoPaths: [normalizePath(resolve('/repo', '/other')), '/repo'], changes: [] },
		]);
	});

	test("notify: 'infer' on a -C write that moves no branch announces only the -C target", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'add', 'file.ts');

		assert.deepStrictEqual(notified, [
			{ repoPaths: [normalizePath(resolve('/repo', '/other'))], changes: ['index'] },
		]);
	});

	test('an explicit notify array is announced exactly, regardless of the argv', async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: ['stash'] }, 'status');

		assert.deepStrictEqual(notified, [{ repoPaths: ['/repo'], changes: ['stash'] }]);
	});

	test('a FAILED run is still notified', async () => {
		const { git, notified } = newGitWithBinder();

		const result = await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

		assert.strictEqual(result.completion.status, 'failed');
		assert.deepStrictEqual(notified, [{ repoPaths: ['/repo'], changes: ['head', 'heads', 'index', 'pausedOp'] }]);
	});

	test('an unset notify never calls the binder', async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore' }, 'commit', '-m', 'msg');

		assert.deepStrictEqual(notified, []);
	});

	suite('ignored worktrees', () => {
		const sha = '0123456789abcdef0123456789abcdef01234567';
		const roots = [normalizePath(resolve('/repo/.git/sync-tools-worktrees'))];
		const ignored = resolve('/repo/.git/sync-tools-worktrees/x');
		// Inside the git dir, but under no folder the host registered: a user's own worktree
		const inGitDir = resolve('/repo/.git/my-worktrees/x');

		/** Binds a roots reader answering `answer` (an `Error` rejects), recording each path it reads */
		function readIgnoredRoots(git: Git, answer: readonly string[] | undefined | Error): string[] {
			const reads: string[] = [];
			git.bindIgnoredWorktreeRootsReader(path => {
				reads.push(path);
				if (answer instanceof Error) return Promise.reject(answer);

				return Promise.resolve(answer);
			});
			return reads;
		}

		test('adding, removing or locking a worktree under an ignored folder announces nothing', async () => {
			const { git, notified } = newGitWithBinder();
			const reads = readIgnoredRoots(git, roots);

			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'add',
				'--detach',
				'--force',
				'--end-of-options',
				ignored,
				sha,
			);
			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'remove',
				'--force',
				'--end-of-options',
				ignored,
			);
			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'worktree', 'lock', ignored);

			assert.deepStrictEqual(notified, []);
			assert.deepStrictEqual(reads, ['/repo', '/repo', '/repo']);
		});

		test('a worktree inside the git dir but under no ignored folder still announces worktrees', async () => {
			const { git, notified } = newGitWithBinder();
			readIgnoredRoots(git, roots);

			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'add',
				'--detach',
				inGitDir,
				sha,
			);
			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'worktree', 'remove', inGitDir);

			assert.deepStrictEqual(notified, [
				{ repoPaths: ['/repo'], changes: ['worktrees', 'worktreeHead'] },
				{ repoPaths: ['/repo'], changes: ['worktrees', 'worktreeHead'] },
			]);
		});

		test('a move announces nothing only when both ends are under an ignored folder', async () => {
			const { git, notified } = newGitWithBinder();
			readIgnoredRoots(git, roots);

			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'move',
				ignored,
				`${ignored}2`,
			);
			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'worktree', 'move', ignored, '/wt');

			assert.deepStrictEqual(notified, [{ repoPaths: ['/repo'], changes: ['worktrees'] }]);
		});

		test('a relative worktree still announces worktrees, reading nothing', async () => {
			const { git, notified } = newGitWithBinder();
			const reads = readIgnoredRoots(git, roots);

			// Resolves under the ignored folder, yet git may match it to the trailing components of another worktree
			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'lock',
				'.git/sync-tools-worktrees/x',
			);
			await git.run({ cwd: ignored, errors: 'ignore', notify: 'infer' }, 'worktree', 'remove', 'wt');

			assert.deepStrictEqual(notified, [
				{ repoPaths: ['/repo'], changes: ['worktrees'] },
				{ repoPaths: [normalizePath(ignored)], changes: ['worktrees', 'worktreeHead'] },
			]);
			assert.deepStrictEqual(reads, []);
		});

		test('adding a branch with a worktree under an ignored folder still announces the branch', async () => {
			const { git, notified } = newGitWithBinder();
			readIgnoredRoots(git, roots);

			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'add',
				'-b',
				'x',
				ignored,
				sha,
			);

			assert.deepStrictEqual(notified, [
				{ repoPaths: ['/repo'], changes: ['heads'], named: { refs: ['refs/heads/x'] } },
			]);
		});

		test('reads the ignored folders of the -C target, and tells cwd nothing either', async () => {
			const { git, notified } = newGitWithBinder();
			const reads = readIgnoredRoots(git, [normalizePath(resolve('/other/.git/sync-tools-worktrees'))]);

			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'-C',
				'/other',
				'worktree',
				'remove',
				resolve('/other/.git/sync-tools-worktrees/x'),
			);

			assert.deepStrictEqual(reads, [normalizePath(resolve('/repo', '/other'))]);
			assert.deepStrictEqual(notified, []);
		});

		test('a worktree outside every ignored folder still announces worktrees', async () => {
			const { git, notified } = newGitWithBinder();
			readIgnoredRoots(git, roots);

			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'add',
				'--detach',
				'--force',
				'--end-of-options',
				'/wt',
				sha,
			);
			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'worktree', 'remove', '/wt');
			// A sibling whose name only starts like the ignored folder
			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'remove',
				resolve('/repo/.git/sync-tools-worktreesx'),
			);

			assert.deepStrictEqual(notified, [
				{ repoPaths: ['/repo'], changes: ['worktrees', 'worktreeHead'] },
				{ repoPaths: ['/repo'], changes: ['worktrees', 'worktreeHead'] },
				{ repoPaths: ['/repo'], changes: ['worktrees', 'worktreeHead'] },
			]);
		});

		test('a path that leaves an ignored folder through `..` still announces worktrees', async () => {
			const { git, notified } = newGitWithBinder();
			readIgnoredRoots(git, roots);

			await git.run(
				{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
				'worktree',
				'remove',
				`${resolve('/repo/.git/sync-tools-worktrees')}/../my-worktrees/x`,
			);

			assert.deepStrictEqual(notified, [{ repoPaths: ['/repo'], changes: ['worktrees', 'worktreeHead'] }]);
		});

		test('announces worktrees as before when no folder is registered or the folders are unknown', async () => {
			for (const answer of [undefined, new Error('unreadable'), [], 'unbound'] as const) {
				const { git, notified } = newGitWithBinder();
				if (answer !== 'unbound') {
					readIgnoredRoots(git, answer);
				}

				await git.run(
					{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
					'worktree',
					'remove',
					'--force',
					ignored,
				);

				assert.deepStrictEqual(
					notified,
					[{ repoPaths: ['/repo'], changes: ['worktrees', 'worktreeHead'] }],
					String(answer),
				);
			}
		});
	});

	suite('names', () => {
		const otherPath = normalizePath(resolve('/repo', '/other'));
		const moveHead: CommandChanges = {
			changes: ['head', 'heads', 'index', 'pausedOp'],
			sharedChanges: ['heads'],
			movesHeadBranch: true,
		};

		/** Makes `notify: 'infer'` classify every argv as `classified`, whatever the classifier makes of it today */
		function classifyAs(git: Git, classified: CommandChanges): void {
			(git as unknown as { _classify: () => CommandChanges })._classify = () => classified;
		}

		/** Binds a head reader answering each read with the next of `states` (an `Error` rejects), recording it in `order` */
		function readHeads(git: Git, order: string[], ...states: (HeadState | Error)[]): void {
			git.bindHeadReader(path => {
				order.push(`read ${path}`);
				const state = states.shift();
				return state instanceof Error ? Promise.reject(state) : Promise.resolve(state);
			});
		}

		/** Records each spawn in `order`, so a test can tell a HEAD read before the run from one after it */
		function recordSpawns(git: Git, order: string[]): void {
			const inner = (git as unknown as { _runSpawn: (...a: unknown[]) => Promise<unknown> })._runSpawn;
			(git as unknown as { _runSpawn: unknown })._runSpawn = (...a: unknown[]) => {
				order.push('spawn');
				return inner(...a);
			};
		}

		test('the refs a classification names reach the binder, with its config confinement', async () => {
			const { git, notified } = newGitWithBinder();
			classifyAs(git, {
				changes: ['config', 'heads'],
				sharedChanges: ['config', 'heads'],
				refs: ['refs/heads/x'],
				configConfinedToRefs: true,
			});

			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'branch', '-d', 'x');

			assert.deepStrictEqual(notified, [
				{
					repoPaths: ['/repo'],
					changes: ['config', 'heads'],
					named: { refs: ['refs/heads/x'], configConfinedToRefs: true },
				},
			]);
		});

		test('a -C shared-state write passes its names with both paths', async () => {
			const { git, notified } = newGitWithBinder();
			classifyAs(git, {
				changes: ['tags'],
				pathOverride: '/other',
				sharedChanges: ['tags'],
				refs: ['refs/tags/v1'],
			});

			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'tag', 'v1');

			assert.deepStrictEqual(notified, [
				{ repoPaths: [otherPath, '/repo'], changes: ['tags'], named: { refs: ['refs/tags/v1'] } },
			]);
		});

		test('a -C write with local changes passes its names with the -C target and cwd as a shared path', async () => {
			const { git, notified } = newGitWithBinder();
			const order: string[] = [];
			classifyAs(git, { ...moveHead, pathOverride: '/other' });
			readHeads(git, order, { branch: 'refs/heads/feature' }, { branch: 'refs/heads/feature' });

			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'commit', '-m', 'msg');

			assert.deepStrictEqual(order, [`read ${otherPath}`, `read ${otherPath}`], 'HEAD is read where the run ran');
			assert.deepStrictEqual(notified, [
				{
					repoPaths: [otherPath],
					changes: ['head', 'heads', 'index', 'pausedOp'],
					sharedPaths: ['/repo'],
					named: { refs: ['refs/heads/feature'] },
				},
			]);
		});

		test("a verb that moves HEAD's branch names it when HEAD was on it before and after the run", async () => {
			const { git, notified } = newGitWithBinder();
			const order: string[] = [];
			classifyAs(git, moveHead);
			readHeads(git, order, { branch: 'refs/heads/main' }, { branch: 'refs/heads/main' });
			recordSpawns(git, order);

			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(order, ['read /repo', 'spawn', 'read /repo']);
			assert.deepStrictEqual(notified, [
				{
					repoPaths: ['/repo'],
					changes: ['head', 'heads', 'index', 'pausedOp'],
					named: { refs: ['refs/heads/main'] },
				},
			]);
		});

		test("HEAD's branch joins the refs the classification names", async () => {
			const { git, notified } = newGitWithBinder();
			classifyAs(git, { ...moveHead, refs: ['refs/heads/other'] });
			readHeads(git, [], { branch: 'refs/heads/main' }, { branch: 'refs/heads/main' });

			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(notified[0].named, { refs: ['refs/heads/other', 'refs/heads/main'] });
		});

		test('a detached HEAD both times moved no branch, so heads is not announced, here or to cwd', async () => {
			const { git, notified } = newGitWithBinder();
			classifyAs(git, moveHead);
			readHeads(git, [], 'detached', 'detached');

			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(notified, [{ repoPaths: ['/repo'], changes: ['head', 'index', 'pausedOp'] }]);

			const { git: cGit, notified: cNotified } = newGitWithBinder();
			classifyAs(cGit, { ...moveHead, pathOverride: '/other' });
			readHeads(cGit, [], 'detached', 'detached');

			await cGit.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'commit', '-m', 'msg');

			assert.deepStrictEqual(
				cNotified,
				[{ repoPaths: [otherPath], changes: ['head', 'index', 'pausedOp'] }],
				'with no branch moved, cwd shares nothing that changed',
			);
		});

		test('a detached HEAD both times announces nothing when a branch move was all the verb could change', async () => {
			const { git, notified } = newGitWithBinder();
			classifyAs(git, { changes: ['heads'], sharedChanges: ['heads'], movesHeadBranch: true });
			readHeads(git, [], 'detached', 'detached');

			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(notified, []);
		});

		test('HEAD on another branch after the run, detached on one side only, or unreadable, names nothing', async () => {
			const cases: [HeadState | Error, HeadState | Error][] = [
				[{ branch: 'refs/heads/main' }, { branch: 'refs/heads/other' }],
				[{ branch: 'refs/heads/main' }, 'detached'],
				['detached', { branch: 'refs/heads/main' }],
				[undefined, { branch: 'refs/heads/main' }],
				[{ branch: 'refs/heads/main' }, new Error('unreadable')],
				[new Error('unreadable'), 'detached'],
			];
			for (const [before, after] of cases) {
				const { git, notified } = newGitWithBinder();
				classifyAs(git, moveHead);
				readHeads(git, [], before, after);

				const result = await git.run(
					{ cwd: '/repo', errors: 'ignore', notify: 'infer' },
					'commit',
					'-m',
					'msg',
				);

				assert.strictEqual(result.completion.status, 'failed', 'the run settles as it would have');
				assert.deepStrictEqual(
					notified,
					[{ repoPaths: ['/repo'], changes: ['head', 'heads', 'index', 'pausedOp'] }],
					`${JSON.stringify(before)} → ${JSON.stringify(after)}`,
				);
			}
		});

		test('a rejecting head reader never turns a run that throws into another error', async () => {
			const { git, notified } = newGitWithBinder();
			classifyAs(git, moveHead);
			readHeads(git, [], new Error('before'), new Error('after'));

			await assert.rejects(
				git.run({ cwd: '/repo', errors: 'throw', notify: 'infer' }, 'commit', '-m', 'msg'),
				(ex: unknown) => ex instanceof Error && ex.message !== 'before' && ex.message !== 'after',
			);
			assert.strictEqual(notified.length, 1);
		});

		test('with no head reader bound, a branch move is announced unnamed', async () => {
			const { git, notified } = newGitWithBinder();
			classifyAs(git, moveHead);

			await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(notified, [
				{ repoPaths: ['/repo'], changes: ['head', 'heads', 'index', 'pausedOp'] },
			]);
		});

		test('an explicit notify array never reads HEAD', async () => {
			const { git, notified } = newGitWithBinder();
			const order: string[] = [];
			readHeads(git, order, { branch: 'refs/heads/main' }, { branch: 'refs/heads/main' });

			await git.run({ cwd: '/repo', errors: 'ignore', notify: ['head', 'heads'] }, 'commit', '-m', 'msg');

			assert.deepStrictEqual(order, []);
			assert.deepStrictEqual(notified, [{ repoPaths: ['/repo'], changes: ['head', 'heads'] }]);
		});
	});
});

suite('Git.clearPendingCommands', () => {
	type PendingCommand = { cwd: string | undefined; promise: Promise<unknown> };

	/** Seeds one in-flight run per cwd, keyed the way `runCore` keys them, and returns the map. */
	function seedPending(git: Git, cwds: (string | undefined)[]): Map<string, PendingCommand> {
		const pending = (git as unknown as { pendingCommands: Map<string, PendingCommand> }).pendingCommands;
		for (const cwd of cwds) {
			pending.set(`[${cwd}] git status`, { cwd: cwd, promise: new Promise(() => {}) });
		}
		return pending;
	}

	function newGit(): Git {
		return new Git(async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }));
	}

	test("with no paths it drops every repository's pending runs", () => {
		const git = newGit();
		const pending = seedPending(git, ['/repo-a', '/repo-b', undefined]);

		git.clearPendingCommands();

		assert.strictEqual(pending.size, 0);
	});

	test('with paths it drops only runs in, or inside, one of them', () => {
		const git = newGit();
		const pending = seedPending(git, ['/repo-a', '/repo-a/sub', '/repo-a-wt', '/repo-ab', '/repo-b', undefined]);

		git.clearPendingCommands(['/repo-a', '/repo-a-wt']);

		assert.deepStrictEqual(
			Array.from(pending.values(), p => p.cwd),
			['/repo-ab', '/repo-b', undefined],
			'a run in another repository — even one whose path merely starts the same — keeps being shared',
		);
	});
});

suite('Git.run onSpawn', () => {
	type Spawn = { args: readonly string[]; finish: () => void };

	/** A Git with one process slot whose spawns wait for `finish` */
	function newGit(): { git: Git; spawns: Spawn[] } {
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }), { queue: { maxConcurrent: 1 } });
		const spawns: Spawn[] = [];
		(git as unknown as { _runSpawn: unknown })._runSpawn = (_cmd: string, args: readonly string[]) =>
			new Promise(resolve => {
				spawns.push({ args: args, finish: () => resolve({ exitCode: 0, stdout: '', stderr: '' }) });
			});
		return { git: git, spawns: spawns };
	}

	async function until(condition: () => boolean): Promise<void> {
		for (let i = 0; i < 100 && !condition(); i++) {
			await new Promise(resolve => setImmediate(resolve));
		}
		assert.ok(condition());
	}

	test('fires when the process spawns, not while the run waits in the queue', async () => {
		const { git, spawns } = newGit();
		const onSpawn = sinon.spy();

		const first = git.run({ cwd: '/repo' }, 'status');
		await until(() => spawns.length === 1);
		const second = git.run({ cwd: '/repo', onSpawn: onSpawn }, 'worktree', 'list', '--porcelain');
		await new Promise(resolve => setImmediate(resolve));
		sinon.assert.notCalled(onSpawn);

		spawns[0].finish();
		await until(() => spawns.length === 2);
		sinon.assert.calledOnce(onSpawn);

		spawns[1].finish();
		await Promise.all([first, second]);
		sinon.assert.calledOnce(onSpawn);
	});

	test('tells a call that joins an identical run when that run spawns, or at once if it has', async () => {
		const { git, spawns } = newGit();
		const queued = sinon.spy();
		const joinedQueued = sinon.spy();
		const joinedSpawned = sinon.spy();

		const blocker = git.run({ cwd: '/repo' }, 'status');
		await until(() => spawns.length === 1);
		const run = git.run({ cwd: '/repo', onSpawn: queued }, 'worktree', 'list');
		const rider = git.run({ cwd: '/repo', onSpawn: joinedQueued }, 'worktree', 'list');
		await new Promise(resolve => setImmediate(resolve));
		sinon.assert.notCalled(joinedQueued);

		spawns[0].finish();
		await until(() => spawns.length === 2);
		sinon.assert.calledOnce(queued);
		sinon.assert.calledOnce(joinedQueued);

		const lateRider = git.run({ cwd: '/repo', onSpawn: joinedSpawned }, 'worktree', 'list');
		await new Promise(resolve => setImmediate(resolve));
		sinon.assert.calledOnce(joinedSpawned);

		spawns[1].finish();
		await Promise.all([blocker, run, rider, lateRider]);
		assert.strictEqual(spawns.length, 2, 'the riders shared the run');
	});
});

suite('Git.stream stdin', () => {
	test('rejects, rather than crashing on EPIPE, when git exits before reading its input', async () => {
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
		// Far past any OS pipe buffer, so the write is still in flight when git refuses the option and exits
		const stdin = Buffer.alloc(8 * 1024 * 1024, 'x');

		await assert.rejects(async () => {
			const out: string[] = [];
			for await (const chunk of git.stream({ cwd: tmpdir(), stdin: stdin }, 'patch-id', '--no-such-option')) {
				out.push(chunk);
			}
		});
	});
});

suite('Git options.spawn', () => {
	test('launches git through the injected spawner for run and stream', async () => {
		const commands: string[] = [];
		const timeouts: (number | undefined)[] = [];
		const spawner: ProcessSpawner = (command, args, options) => {
			commands.push(command);
			timeouts.push(options.timeout);
			return spawn(command, args, options);
		};
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }), { spawn: spawner });

		await git.run({ cwd: tmpdir() }, '--version');
		assert.deepStrictEqual(commands, ['git']);

		const out: string[] = [];
		for await (const chunk of git.stream({ cwd: tmpdir(), timeout: 0 }, '--version')) {
			out.push(chunk);
		}

		assert.deepStrictEqual(commands, ['git', 'git']);
		assert.strictEqual(timeouts[1], undefined, 'a disabled (0) stream timeout reaches the spawner as none');
		assert.ok(out.join('').startsWith('git version'));
	});

	test("rejects a stream its own timeout killed with the 'timeout' reason", async () => {
		const spawner: ProcessSpawner = (_command, _args, options) =>
			spawn(execPath, nodeArgs('setTimeout(() => {}, 60000)'), options);
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }), { spawn: spawner });

		await assert.rejects(
			async () => {
				for await (const _chunk of git.stream({ cwd: tmpdir(), timeout: 300 }, '--version')) {
					// drain
				}
			},
			(ex: unknown) => ex instanceof CancelledRunError && ex.reason === 'timeout',
		);
	});

	test('rejects a stream whose spawner returned no stdout pipe rather than reading it as empty', async () => {
		const spawner: ProcessSpawner = (command, args, options) =>
			spawn(command, args, { ...options, stdio: ['pipe', 'ignore', 'pipe'] });
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }), { spawn: spawner });

		await assert.rejects(
			async () => {
				for await (const _chunk of git.stream({ cwd: tmpdir() }, '--version')) {
					// drain
				}
			},
			(ex: unknown) => ex instanceof Error && ex.message.includes('without a stdout pipe'),
		);
	});
});
