import * as assert from 'assert';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { execPath } from 'process';
import * as sinon from 'sinon';
import { normalizePath } from '@gitlens/utils/path.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import { CancelledRunError, RunError } from '../exec.errors.js';
import { run, runSpawn } from '../exec.js';
import type { GitResultCache } from '../exec.types.js';
import { defaultExceptionHandler, Git, GitError } from '../git.js';

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
	type Notified = { repoPaths: readonly string[]; changes: readonly string[] };

	function newGitWithBinder(): { git: Git; notified: Notified[] } {
		// A nonexistent binary makes every run fail fast (ENOENT) without ever spawning a real process —
		// `notify` is applied once the run SETTLES regardless of outcome, so a failure exercises it exactly
		// like a success would, and much faster than a real git invocation.
		const git = new Git(async () => ({ path: '/nonexistent/git-binary', version: '2.40.0' }));
		const notified: Notified[] = [];
		git.bindChangeNotifier((repoPaths, changes) => notified.push({ repoPaths: repoPaths, changes: changes }));
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
			{ repoPaths: [normalizePath(resolve('/repo', '/other')), '/repo'], changes: ['heads', 'remotes', 'tags'] },
		]);
	});

	test("notify: 'infer' on a -C branch-moving write announces the -C target, and only the branch move to cwd", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'commit', '-m', 'msg');

		assert.deepStrictEqual(notified, [
			{ repoPaths: [normalizePath(resolve('/repo', '/other'))], changes: ['head', 'heads', 'index', 'pausedOp'] },
			{ repoPaths: ['/repo'], changes: ['heads'] },
		]);
	});

	test("notify: 'infer' on a -C pull announces its worktree-local changes only to the -C target", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'pull');

		assert.strictEqual(notified.length, 2);
		assert.deepStrictEqual(notified[0].repoPaths, [normalizePath(resolve('/repo', '/other'))]);
		assert.deepStrictEqual(notified[1], { repoPaths: ['/repo'], changes: ['heads', 'remotes', 'tags'] });
	});

	test("notify: 'infer' on a -C stash push announces only the stash to cwd", async () => {
		const { git, notified } = newGitWithBinder();

		await git.run({ cwd: '/repo', errors: 'ignore', notify: 'infer' }, '-C', '/other', 'stash', 'push');

		assert.deepStrictEqual(notified, [
			{ repoPaths: [normalizePath(resolve('/repo', '/other'))], changes: ['stash', 'index'] },
			{ repoPaths: ['/repo'], changes: ['stash'] },
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
