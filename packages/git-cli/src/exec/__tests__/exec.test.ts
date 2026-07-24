import * as assert from 'assert';
import { execPath } from 'process';
import * as sinon from 'sinon';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import { CancelledRunError, RunError } from '../exec.errors.js';
import { run, runSpawn } from '../exec.js';
import type { GitResultCache } from '../exec.types.js';
import { Git } from '../git.js';

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

		test('returns the exit code without rejecting when exitCodeOnly is set', async () => {
			const result = await runSpawn(nodeExecutable, nodeArgs(`process.exit(7);`), 'utf8', {
				exitCodeOnly: true,
			});

			assert.strictEqual(result.exitCode, 7);
		});

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
			// with a plain `Error` (not a `CancelledRunError`), which under `errors: 'ignore'` resolves to
			// `{ exitCode: 0, cancelled: false }`. That empty, not-flagged result is exactly what must NOT be
			// cached, so the factory has to invalidate on the aborted aggregate signal (not just on `cancelled`).
			const aggregate = new AbortController();
			aggregate.abort();

			const cacheable = new CacheController();
			let seenOptions: { cancellation?: AbortSignal; accessTTL?: number } | undefined;
			const fakeCache: GitResultCache = {
				getOrCreate: (_repoPath, _key, factory, options) => {
					seenOptions = options;
					return factory(cacheable, aggregate.signal);
				},
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
			// A bare-abort queue splice is NOT flagged cancelled — proving `cancelled` alone can't gate caching.
			assert.strictEqual(result.cancelled, false, 'queue-spliced bare abort resolves cancelled:false');
			assert.strictEqual(cacheable.invalidated, true, 'aborted result invalidated so it is never cached');
		});
	});
});
