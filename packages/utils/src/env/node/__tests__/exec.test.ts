import * as assert from 'assert';
import * as process from 'process';
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
