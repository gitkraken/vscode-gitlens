import * as assert from 'assert';
import { spawn } from 'child_process';
import * as process from 'process';
import type { ProcessSpawner } from '../exec.js';
import { CancelledRunError, run, RunError, runSpawn } from '../exec.js';

// Far past any OS pipe buffer, so the write is still in flight when the child goes away
const largeInput = Buffer.alloc(32 * 1024 * 1024, 'x');

const exitsWithoutReading = ['-e', 'process.exit(3)'];
const neverReads = ['-e', 'process.stdin.pause(); setTimeout(() => {}, 30000)'];

suite('Exec stdin Test Suite', () => {
	test('runSpawn rejects with the exit code when the child exits before reading its input', async () => {
		await assert.rejects(
			runSpawn(process.execPath, exitsWithoutReading, 'utf8', { stdin: largeInput }),
			(ex: unknown) => ex instanceof RunError && ex.code === 3,
		);
	});

	test('run rejects with the exit code when the child exits before reading its input', async () => {
		await assert.rejects(
			run(process.execPath, exitsWithoutReading, 'utf8', { stdin: largeInput }),
			(ex: unknown) => ex instanceof RunError && ex.code === 3,
		);
	});

	test('runSpawn rejects as cancelled when cancelled while its input is still being written', async () => {
		const controller = new AbortController();
		const promise = runSpawn(process.execPath, neverReads, 'utf8', {
			stdin: largeInput,
			cancellation: controller.signal,
		});
		setTimeout(() => controller.abort(), 100);
		await assert.rejects(promise, (ex: unknown) => ex instanceof CancelledRunError);
	});

	test('run rejects as cancelled when cancelled while its input is still being written', async () => {
		const controller = new AbortController();
		const promise = run(process.execPath, neverReads, 'utf8', {
			stdin: largeInput,
			cancellation: controller.signal,
		});
		setTimeout(() => controller.abort(), 100);
		await assert.rejects(promise, (ex: unknown) => ex instanceof RunError);
	});
});

const runsLong = ['-e', 'setTimeout(() => {}, 10000)'];

suite('Exec cancellation reason Test Suite', () => {
	test('runSpawn reports a spawn timeout kill as a timeout', async () => {
		await assert.rejects(
			runSpawn(process.execPath, runsLong, 'utf8', { timeout: 200 }),
			(ex: unknown) => ex instanceof CancelledRunError && ex.reason === 'timeout',
		);
	});

	test('runSpawn reports a caller abort as aborted', async () => {
		const controller = new AbortController();
		const promise = runSpawn(process.execPath, runsLong, 'utf8', { cancellation: controller.signal });
		setTimeout(() => controller.abort(), 50);
		await assert.rejects(promise, (ex: unknown) => ex instanceof CancelledRunError && ex.reason === 'aborted');
	});
});

suite('runSpawn spawner Test Suite', () => {
	test('runSpawn launches through an injected spawner with only the process options', async () => {
		const calls: { command: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
		const spawner: ProcessSpawner = (command, args, options) => {
			calls.push({ command: command, args: args, options: { ...options } });
			return spawn(command, args, options);
		};

		const args = ['-e', `process.stdout.write('hi')`];
		const direct = await runSpawn<string>(process.execPath, args, 'utf8', {});
		const result = await runSpawn<string>(process.execPath, args, 'utf8', {
			cwd: process.cwd(),
			timeout: 10000,
			maxBuffer: 1024,
			quiet: true,
			spawn: spawner,
		});

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].command, process.execPath);
		assert.deepStrictEqual(calls[0].args, args);
		assert.deepStrictEqual(Object.keys(calls[0].options).sort(), ['cwd', 'env', 'signal', 'stdio', 'timeout']);
		assert.strictEqual(result.stdout, direct.stdout);
		assert.strictEqual(result.exitCode, direct.exitCode);
	});

	test('runSpawn hands the spawner no timeout for 0 and the given timeout otherwise', async () => {
		const timeouts: (number | undefined)[] = [];
		const spawner: ProcessSpawner = (command, args, options) => {
			timeouts.push(options.timeout);
			return spawn(command, args, options);
		};
		const args = ['-e', `process.stdout.write('hi')`];

		await runSpawn<string>(process.execPath, args, 'utf8', { timeout: 0, spawn: spawner });
		await runSpawn<string>(process.execPath, args, 'utf8', { timeout: 500, spawn: spawner });

		assert.deepStrictEqual(timeouts, [undefined, 500]);
	});

	test('runSpawn rejects, rather than reading no output as empty, when the spawner pipes no stdout', async () => {
		const spawner: ProcessSpawner = (command, args, options) =>
			spawn(command, args, { ...options, stdio: ['ignore', 'ignore', 'ignore'] });

		await assert.rejects(
			runSpawn<string>(process.execPath, ['-e', `process.stdout.write('hi')`], 'utf8', { spawn: spawner }),
			(ex: unknown) => ex instanceof Error && !(ex instanceof RunError),
		);
	});
});
